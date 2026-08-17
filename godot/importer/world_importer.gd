class_name WorldImporter
extends RefCounted

const IMPORTER_VERSION := "cablester-godot-importer-1"
const SNAPSHOT_VERSION := 1
const GENERIC_PREFAB := preload("res://godot/prefabs/canonical_object.tscn")
const SCENE_LAYER_RUNTIME := preload("res://godot/runtime/scene_layer_runtime.gd")
const DERIVED_ALLOWLIST := [
	"generatedAt", "godotBuildId", "importerVersion", "snapshotVersion",
	"warnings", "errors", "telemetry", "regions[*].aabb", "regions[*].thumbnail",
	"regions[*].chunks[*].aabb", "regions[*].chunks[*].dependencies", "regions[*].chunks[*].telemetry",
	"regions[*].chunks[*].objects[*].collisionBounds", "regions[*].chunks[*].objects[*].collisionShapeId",
	"regions[*].chunks[*].objects[*].resourceUid", "regions[*].chunks[*].objects[*].telemetry"
]

var last_result: Dictionary = {}
var _type_by_id: Dictionary = {}
var _asset_by_id: Dictionary = {}
var _prefab_by_id: Dictionary = {}


func import_file(path: String, options: Dictionary = {}) -> Dictionary:
	var loaded := CablesterFileUtils.read_json(path)
	if not loaded.ok:
		last_result = _failure(path, [loaded.error])
		return last_result
	return import_world(loaded.data, path, options)


func import_world(world: Dictionary, source_path := "<memory>", options: Dictionary = {}) -> Dictionary:
	var started_usec := Time.get_ticks_usec()
	var validator := WorldPackageValidator.new()
	var issues := validator.validate(world, options)
	var errors := issues.filter(func(issue: Dictionary) -> bool: return issue.severity == "error")
	var warnings := issues.filter(func(issue: Dictionary) -> bool: return issue.severity == "warning")
	var world_id := str(world.get("manifest", {}).get("worldId", source_path.get_file().get_basename()))
	var paths := artifact_paths(world_id, options)
	if not errors.is_empty():
		var failed_snapshot := _base_snapshot(world, source_path)
		failed_snapshot.warnings = warnings
		failed_snapshot.errors = errors
		failed_snapshot.status = "import-failed"
		_write_artifact(paths.snapshot, failed_snapshot)
		last_result = {
			"ok": false, "sourcePath": source_path, "issues": issues,
			"errors": errors, "warnings": warnings, "snapshot": failed_snapshot,
			"snapshotPath": paths.snapshot, "manifestPath": paths.manifest
		}
		return last_result

	_type_by_id = _registry_map(world.typeRegistry)
	_asset_by_id = _registry_map(world.assetRegistry)
	_prefab_by_id = _registry_map(world.prefabRegistry)
	var snapshot := _build_snapshot(world, source_path, warnings)
	snapshot.semanticProjection = _semantic_projection_from_snapshot(snapshot)
	var normalized_manifest := _build_normalized_manifest(world, snapshot)
	var canonical_projection := _semantic_projection_from_world(world)
	var snapshot_projection := _semantic_projection_from_snapshot(snapshot)
	var projection_match := StableJson.stringify(canonical_projection) == StableJson.stringify(snapshot_projection)
	normalized_manifest.semanticProjection = snapshot_projection
	normalized_manifest.semanticDiff = [] if projection_match else [{
		"path": "$", "kind": "projection-mismatch", "message": "Godot normalized projection differs from canonical projection"
	}]
	normalized_manifest.semanticDiffCount = normalized_manifest.semanticDiff.size()
	snapshot.status = "current" if projection_match else "import-failed"
	if not projection_match:
		snapshot.errors.append({"severity": "error", "code": "semantic-diff", "path": "$", "message": "Semantic diff is not zero"})
	var snapshot_write := _write_artifact(paths.snapshot, snapshot)
	var manifest_write := _write_artifact(paths.manifest, normalized_manifest)
	var duration_ms := (Time.get_ticks_usec() - started_usec) / 1000.0
	last_result = {
		"ok": projection_match and snapshot_write.ok and manifest_write.ok,
		"sourcePath": source_path,
		"sourceContentHash": str(world.manifest.contentHash),
		"issues": issues,
		"errors": snapshot.errors,
		"warnings": warnings,
		"snapshot": snapshot,
		"normalizedManifest": normalized_manifest,
		"snapshotPath": paths.snapshot,
		"manifestPath": paths.manifest,
		"durationMs": duration_ms
	}
	return last_result


func instantiate_world(world: Dictionary, snapshot: Dictionary, saved_state: Dictionary = {}) -> Node2D:
	_type_by_id = _registry_map(world.typeRegistry)
	_asset_by_id = _registry_map(world.assetRegistry)
	_prefab_by_id = _registry_map(world.prefabRegistry)
	var root := Node2D.new()
	root.name = "ImportedWorld_%s" % _safe_name(str(world.manifest.worldId))
	root.set_meta("source_content_hash", str(world.manifest.contentHash))
	root.set_meta("schema_version", int(world.schemaVersion))
	root.set_meta("content_version", str(world.manifest.contentVersion))
	for region in world.regions:
		var region_node := Node2D.new()
		region_node.name = "Region_%s" % _safe_name(str(region.id))
		_apply_transform(region_node, _normalized_transform(region.get("transform", {})))
		region_node.set_meta("canonical_id", str(region.id))
		root.add_child(region_node)
		for chunk in region.chunks:
			var chunk_node := _instantiate_chunk(chunk, saved_state.get("objects", {}))
			region_node.add_child(chunk_node)
	return root


func instantiate_chunk(region: Dictionary, chunk: Dictionary, saved_objects: Dictionary = {}) -> Node2D:
	var chunk_node := _instantiate_chunk(chunk, saved_objects)
	# A streamed chunk is a direct child of the runtime streamer, so it needs the
	# complete Region -> Chunk transform exactly once. `_instantiate_chunk`
	# already applies the chunk-local transform for the nested-world path.
	var region_transform := _normalized_transform(region.get("transform", {}))
	var local_chunk_transform := _normalized_transform(chunk.get("transform", {}))
	_apply_transform(chunk_node, _compose_transform(region_transform, local_chunk_transform))
	return chunk_node


func artifact_paths(world_id: String, options: Dictionary = {}) -> Dictionary:
	# Exported PCK resources are read-only. Editor/headless acceptance keeps
	# checked evidence in res://artifacts; playable templates persist diagnostics
	# under user:// without weakening importer success.
	var default_dir := "user://artifacts/godot" if OS.has_feature("template") else "artifacts/godot"
	var artifact_dir := str(options.get("artifactDir", default_dir))
	var slug := _safe_file_name(world_id)
	return {
		"snapshot": artifact_dir.path_join("%s.resolved-snapshot.json" % slug),
		"manifest": artifact_dir.path_join("%s.normalized-manifest.json" % slug),
		"telemetry": artifact_dir.path_join("%s.telemetry.json" % slug)
	}


func _build_snapshot(world: Dictionary, source_path: String, validation_warnings: Array) -> Dictionary:
	var snapshot := _base_snapshot(world, source_path)
	snapshot.warnings = validation_warnings.duplicate(true)
	snapshot.errors = []
	for region in world.regions:
		var region_transform := _normalized_transform(region.get("transform", {}))
		var region_result := {
			"id": str(region.id),
			"name": str(region.get("name", "")),
			"bounds": region.get("bounds", {}).duplicate(true),
			"routes": _sorted_by_id_copy(region.get("routes", [])),
			"landmarks": _sorted_by_id_copy(region.get("landmarks", [])),
			"tags": _normalized_string_set(region.get("tags", [])),
			"resolvedTransform": region_transform,
			"aabb": _transform_bounds(region_transform, region.bounds),
			"chunks": []
		}
		for chunk in region.chunks:
			var chunk_transform := _compose_transform(region_transform, _normalized_transform(chunk.get("transform", {})))
			var chunk_result := {
				"id": str(chunk.id),
				"name": str(chunk.get("name", "")),
				"bounds": chunk.get("bounds", {}).duplicate(true),
				"regionId": str(region.id),
				"resolvedTransform": chunk_transform,
				"aabb": _transform_bounds(chunk_transform, chunk.bounds),
				"streaming": chunk.streaming.duplicate(true),
				"connections": chunk.connections.duplicate(true),
				"scene": chunk.get("scene", {}).duplicate(true),
				"statePolicy": chunk.get("statePolicy", {}).duplicate(true),
				"gameplay": chunk.get("gameplay", {}).duplicate(true),
				"tags": _normalized_string_set(chunk.get("tags", [])),
				"dependencies": _connection_dependencies(str(chunk.id), world),
				"sceneResolution": _resolve_scene(chunk.get("scene", {})),
				"objects": []
			}
			for object in chunk.objects:
				var resolved := _compose_transform(chunk_transform, _normalized_transform(object.get("transform", {})))
				var type_entry: Dictionary = _type_by_id.get(str(object.type), {})
				var resolution := _resolve_resources(object, type_entry)
				var collision := _resolved_collision_bounds(object, type_entry, resolved)
				chunk_result.objects.append({
					"id": str(object.id),
					"type": str(object.type),
					"resolvedTransform": resolved,
					"collisionBounds": collision,
					"properties": object.get("properties", {}).duplicate(true),
					"stateReferences": _state_references(object),
					"stateKeys": _state_references(object),
					"abilityGates": _ability_references(object),
					"assetId": resolution.asset.id,
					"prefabId": resolution.prefab.id,
					"prefabResolution": resolution.prefab,
					"assetResolution": resolution.asset,
					"fallback": bool(resolution.asset.get("fallback", false)),
					"links": object.get("links", []).duplicate(true),
					"tags": object.get("tags", []).duplicate(true)
				})
				if bool(resolution.asset.get("fallback", false)):
					snapshot.warnings.append({
						"severity": "warning", "code": "asset-fallback", "objectId": str(object.id),
						"message": "Procedural fallback is active for asset %s" % resolution.asset.get("id", "")
					})
			chunk_result.stateKeys = _chunk_state_keys(chunk, _project_connections(chunk.connections), chunk_result.objects)
			region_result.chunks.append(chunk_result)
		snapshot.regions.append(region_result)
	return snapshot


func _base_snapshot(world: Dictionary, source_path: String) -> Dictionary:
	var manifest: Dictionary = world.get("manifest", {})
	return {
		"snapshotVersion": SNAPSHOT_VERSION,
		"schemaVersion": int(world.get("schemaVersion", 0)),
		"worldId": str(manifest.get("worldId", "")),
		"namespace": str(manifest.get("namespace", "")),
		"contentVersion": str(manifest.get("contentVersion", "")),
		"sourceContentHash": str(manifest.get("contentHash", "")),
		"gameplayTuningVersion": str(manifest.get("gameplayTuningVersion", "")),
		"assetRegistryVersion": str(manifest.get("assetRegistryVersion", "")),
		"prefabRegistryVersion": str(manifest.get("prefabRegistryVersion", "")),
		"typeRegistryVersion": str(manifest.get("typeRegistryVersion", "")),
		"importerVersion": IMPORTER_VERSION,
		"godotBuildId": CablesterFileUtils.godot_build_id(),
		"generatedAt": Time.get_datetime_string_from_system(true),
		"sourcePath": source_path,
		"worldUnitsPerMetre": 64,
		"regions": [],
		"warnings": [],
		"errors": [],
		"telemetry": null
	}


func _build_normalized_manifest(world: Dictionary, snapshot: Dictionary) -> Dictionary:
	var projection := _semantic_projection_from_snapshot(snapshot)
	return {
		"normalizedManifestVersion": 1,
		"schemaVersion": int(world.schemaVersion),
		"worldId": str(world.manifest.worldId),
		"namespace": str(world.manifest.namespace),
		"contentVersion": str(world.manifest.contentVersion),
		"sourceContentHash": str(world.manifest.contentHash),
		"gameplayTuningVersion": str(world.manifest.gameplayTuningVersion),
		"assetRegistryVersion": str(world.manifest.assetRegistryVersion),
		"prefabRegistryVersion": str(world.manifest.prefabRegistryVersion),
		"typeRegistryVersion": str(world.manifest.typeRegistryVersion),
		"importerVersion": IMPORTER_VERSION,
		"godotBuildId": CablesterFileUtils.godot_build_id(),
		"godotDerivedAllowlist": DERIVED_ALLOWLIST.duplicate(),
		"semanticProjection": projection
	}


func _semantic_projection_from_world(world: Dictionary) -> Dictionary:
	var regions: Array = []
	var sorted_regions: Array = world.regions.duplicate(true)
	sorted_regions.sort_custom(_sort_by_id)
	for region in sorted_regions:
		var region_transform := _normalized_transform(region.get("transform", {}))
		var projected_region := {
			"id": str(region.id),
			"name": str(region.get("name", "")),
			"bounds": region.get("bounds", {}).duplicate(true),
			"routes": _sorted_by_id_copy(region.get("routes", [])),
			"landmarks": _sorted_by_id_copy(region.get("landmarks", [])),
			"tags": _normalized_string_set(region.get("tags", [])),
			"resolvedTransform": region_transform,
			"chunks": []
		}
		var sorted_chunks: Array = region.chunks.duplicate(true)
		sorted_chunks.sort_custom(_sort_by_id)
		for chunk in sorted_chunks:
			var chunk_transform := _compose_transform(region_transform, _normalized_transform(chunk.get("transform", {})))
			var connections := _project_connections(chunk.get("connections", []))
			var projected_chunk := {
				"id": str(chunk.id),
				"name": str(chunk.get("name", "")),
				"bounds": chunk.get("bounds", {}).duplicate(true),
				"streaming": chunk.get("streaming", {}).duplicate(true),
				"scene": chunk.get("scene", {}).duplicate(true),
				"statePolicy": chunk.get("statePolicy", {}).duplicate(true),
				"gameplay": chunk.get("gameplay", {}).duplicate(true),
				"tags": _normalized_string_set(chunk.get("tags", [])),
				"resolvedTransform": chunk_transform,
				"connections": connections,
				"stateKeys": [],
				"objects": []
			}
			var sorted_objects: Array = chunk.objects.duplicate(true)
			sorted_objects.sort_custom(_sort_by_id)
			for object in sorted_objects:
				var type_entry: Dictionary = _type_by_id.get(str(object.type), {})
				var resolution := _resolve_resources(object, type_entry)
				var object_projection := {
					"id": str(object.id), "type": str(object.type),
					"resolvedTransform": _compose_transform(chunk_transform, _normalized_transform(object.get("transform", {}))),
					"properties": object.get("properties", {}).duplicate(true),
					"links": _sorted_semantic_array(object.get("links", [])),
					"tags": _normalized_string_set(object.get("tags", [])),
					"stateKeys": _state_references(object),
					"abilityGates": _ability_references(object),
					"assetId": resolution.asset.id if not str(resolution.asset.id).is_empty() else null,
					"prefabId": resolution.prefab.id if not str(resolution.prefab.id).is_empty() else null
				}
				projected_chunk.objects.append(object_projection)
			projected_chunk.stateKeys = _chunk_state_keys(chunk, connections, projected_chunk.objects)
			projected_region.chunks.append(projected_chunk)
		regions.append(projected_region)
	return {
		"projectionVersion": 2,
		"schemaVersion": int(world.schemaVersion),
		"contentVersion": str(world.manifest.contentVersion),
		"contentHash": str(world.manifest.contentHash),
		"gameplayTuningVersion": str(world.manifest.gameplayTuningVersion),
		"assetRegistryVersion": str(world.manifest.assetRegistryVersion),
		"prefabRegistryVersion": str(world.manifest.prefabRegistryVersion),
		"typeRegistryVersion": str(world.manifest.typeRegistryVersion),
		"counts": _projection_counts(regions),
		"regions": regions
	}


func _semantic_projection_from_snapshot(snapshot: Dictionary) -> Dictionary:
	var regions: Array = []
	var sorted_regions: Array = snapshot.get("regions", []).duplicate(true)
	sorted_regions.sort_custom(_sort_by_id)
	for region in sorted_regions:
		var projected_region := {
			"id": str(region.id),
			"name": str(region.get("name", "")),
			"bounds": region.get("bounds", {}).duplicate(true),
			"routes": _sorted_by_id_copy(region.get("routes", [])),
			"landmarks": _sorted_by_id_copy(region.get("landmarks", [])),
			"tags": _normalized_string_set(region.get("tags", [])),
			"resolvedTransform": _normalized_transform(region.get("resolvedTransform", region.get("transform", {}))),
			"chunks": []
		}
		var sorted_chunks: Array = region.get("chunks", []).duplicate(true)
		sorted_chunks.sort_custom(_sort_by_id)
		for chunk in sorted_chunks:
			var connections := _project_connections(chunk.get("connections", []))
			var objects: Array = []
			var sorted_objects: Array = chunk.get("objects", []).duplicate(true)
			sorted_objects.sort_custom(_sort_by_id)
			for object in sorted_objects:
				var properties: Dictionary = object.get("properties", {})
				objects.append({
					"id": str(object.id), "type": str(object.type),
					"resolvedTransform": _normalized_transform(object.get("resolvedTransform", object.get("transform", {}))),
					"properties": properties.duplicate(true),
					"links": _sorted_semantic_array(object.get("links", [])),
					"tags": _normalized_string_set(object.get("tags", [])),
					"stateKeys": _normalized_string_set(object.get("stateKeys", object.get("stateReferences", _state_references(object)))),
					"abilityGates": _normalized_string_set(object.get("abilityGates", _ability_references(object))),
					"assetId": object.get("assetId", object.get("assetResolution", {}).get("id", properties.get("visual", {}).get("assetId", properties.get("assetId")))),
					"prefabId": object.get("prefabId", object.get("prefabResolution", {}).get("id", properties.get("prefabId")))
				})
			projected_region.chunks.append({
				"id": str(chunk.id),
				"name": str(chunk.get("name", "")),
				"bounds": chunk.get("bounds", {}).duplicate(true),
				"streaming": chunk.get("streaming", {}).duplicate(true),
				"scene": chunk.get("scene", {}).duplicate(true),
				"statePolicy": chunk.get("statePolicy", {}).duplicate(true),
				"gameplay": chunk.get("gameplay", {}).duplicate(true),
				"tags": _normalized_string_set(chunk.get("tags", [])),
				"resolvedTransform": _normalized_transform(chunk.get("resolvedTransform", chunk.get("transform", {}))),
				"connections": connections,
				"stateKeys": _normalized_string_set(chunk.get("stateKeys", _chunk_state_keys(chunk, connections, objects))),
				"objects": objects
			})
		regions.append(projected_region)
	return {
		"projectionVersion": 2,
		"schemaVersion": int(snapshot.get("schemaVersion", 0)),
		"contentVersion": str(snapshot.get("contentVersion", snapshot.get("manifest", {}).get("contentVersion", ""))),
		"contentHash": str(snapshot.get("sourceContentHash", snapshot.get("contentHash", snapshot.get("manifest", {}).get("contentHash", "")))),
		"gameplayTuningVersion": str(snapshot.get("gameplayTuningVersion", snapshot.get("manifest", {}).get("gameplayTuningVersion", ""))),
		"assetRegistryVersion": str(snapshot.get("assetRegistryVersion", snapshot.get("manifest", {}).get("assetRegistryVersion", ""))),
		"prefabRegistryVersion": str(snapshot.get("prefabRegistryVersion", snapshot.get("manifest", {}).get("prefabRegistryVersion", ""))),
		"typeRegistryVersion": str(snapshot.get("typeRegistryVersion", snapshot.get("manifest", {}).get("typeRegistryVersion", ""))),
		"counts": _projection_counts(regions),
		"regions": regions
	}


func _instantiate_chunk(chunk: Dictionary, saved_objects: Dictionary) -> Node2D:
	var node := Node2D.new()
	node.name = "Chunk_%s" % _safe_name(str(chunk.id))
	_apply_transform(node, _normalized_transform(chunk.get("transform", {})))
	node.set_meta("canonical_id", str(chunk.id))
	node.set_meta("streaming", chunk.streaming.duplicate(true))
	node.set_meta("connections", chunk.connections.duplicate(true))
	var scene_root := Node2D.new()
	scene_root.name = "SceneLayers"
	node.add_child(scene_root)
	for layer in chunk.get("scene", {}).get("layers", []):
		var scene_layer: Node2D = SCENE_LAYER_RUNTIME.new()
		scene_layer.configure(layer, _asset_by_id, chunk.get("bounds", {}))
		scene_root.add_child(scene_layer)
	for object in chunk.objects:
		var type_entry: Dictionary = _type_by_id.get(str(object.type), {})
		var resolution := _resolve_resources(object, type_entry)
		var prefab: PackedScene = GENERIC_PREFAB
		var scene_path := CablesterFileUtils.approved_prefab_scene_path(str(resolution.prefab.get("path", "")))
		if not scene_path.is_empty() and ResourceLoader.exists(scene_path):
			var loaded: Resource = load(scene_path)
			if loaded is PackedScene:
				prefab = loaded
		var instance: Node = prefab.instantiate()
		if not instance is CanonicalObject:
			push_error("Prefab %s must instantiate CanonicalObject" % scene_path)
			instance.queue_free()
			continue
		_apply_transform(instance, _normalized_transform(object.get("transform", {})))
		instance.chunk_id = str(chunk.id)
		instance.configure(object, type_entry, _asset_by_id.get(str(resolution.asset.get("id", "")), {}), saved_objects.get(str(object.id), {}))
		node.add_child(instance)
	return node


func _resolve_resources(object: Dictionary, type_entry: Dictionary) -> Dictionary:
	var properties: Dictionary = object.get("properties", {})
	var prefab_id := str(properties.get("prefabId", object.get("prefabId", type_entry.get("defaultPrefabId", ""))))
	var prefab_entry: Dictionary = _prefab_by_id.get(prefab_id, {})
	var prefab_path := str(prefab_entry.get("godotScene", "res://godot/prefabs/canonical_object.tscn"))
	var approved_prefab_path := CablesterFileUtils.approved_prefab_scene_path(prefab_path)
	var visual: Dictionary = properties.get("visual", {}) if properties.get("visual", {}) is Dictionary else {}
	var asset_id := str(visual.get("assetId", properties.get("assetId", type_entry.get("defaultAssetId", ""))))
	var asset_entry: Dictionary = _asset_by_id.get(asset_id, {})
	var platforms: Dictionary = asset_entry.get("platforms", {})
	var godot: Dictionary = platforms.get("godot", {}) if platforms.get("godot", {}) is Dictionary else {}
	var path_value: Variant = godot.get("path", asset_entry.get("godotPath", ""))
	var asset_path := str(path_value) if path_value is String else ""
	var procedural := str(asset_entry.get("kind", "")) == "procedural"
	var asset_exists := procedural or (not asset_path.is_empty() and ResourceLoader.exists(CablesterFileUtils.project_path(asset_path)))
	return {
		"prefab": {
			"id": prefab_id,
			"path": approved_prefab_path,
			"resolved": not prefab_id.is_empty() and not approved_prefab_path.is_empty() and ResourceLoader.exists(approved_prefab_path),
			"status": "resolved" if not prefab_id.is_empty() and not approved_prefab_path.is_empty() and ResourceLoader.exists(approved_prefab_path) else "missing",
			"godotScene": approved_prefab_path
		},
			"asset": {
			"id": asset_id,
			"path": CablesterFileUtils.project_path(asset_path) if not asset_path.is_empty() else "",
			"resolved": asset_exists,
			"renderingMode": "procedural" if procedural else "asset" if asset_exists else "missing",
			"status": "procedural" if procedural else "resolved" if asset_exists else "fallback" if bool(asset_entry.get("fallbackAllowed", false)) else "missing",
			"webPath": asset_entry.get("platforms", {}).get("web", {}).get("path"),
			"godotPath": CablesterFileUtils.project_path(asset_path) if not asset_path.is_empty() else null,
			"fallbackAssetId": asset_entry.get("fallbackAssetId"),
			"fallbackAllowed": bool(asset_entry.get("fallbackAllowed", asset_id.is_empty())),
			"fallback": not asset_exists
		}
	}


func _resolve_scene(scene: Dictionary) -> Array:
	var result: Array = []
	for layer in scene.get("layers", []):
		var assets: Array = []
		for candidate in layer.get("assets", []):
			if not candidate is Dictionary: continue
			var id := str(candidate.get("assetId", ""))
			var entry: Dictionary = _asset_by_id.get(id, {})
			var platforms: Dictionary = entry.get("platforms", {})
			var godot: Dictionary = platforms.get("godot", {}) if platforms.get("godot", {}) is Dictionary else {}
			var path_value: Variant = godot.get("path")
			var path := CablesterFileUtils.project_path(str(path_value)) if path_value is String and not path_value.is_empty() else ""
			var procedural := str(entry.get("kind", "")) == "procedural"
			var resolved := procedural or (not path.is_empty() and ResourceLoader.exists(path))
			assets.append({
				"id": id, "path": path if not path.is_empty() else null,
				"status": "procedural" if procedural else "resolved" if resolved else "fallback" if bool(entry.get("fallbackAllowed", false)) else "missing",
				"fallbackAssetId": entry.get("fallbackAssetId")
			})
		result.append({
			"id": str(layer.get("id", "")), "visible": bool(layer.get("visible", true)),
			"role": str(layer.get("role", "custom")), "depth": int(layer.get("depth", 0)),
			"assets": assets
		})
	return result


func _resolved_collision_bounds(object: Dictionary, type_entry: Dictionary, transform: Dictionary) -> Dictionary:
	var adapter: Dictionary = type_entry.get("boundsAdapter", {})
	var properties: Dictionary = object.get("properties", {})
	var kind := str(adapter.get("kind", "point"))
	var pivot: Dictionary = type_entry.get("pivot", {})
	var pivot_x := float(pivot.get("x", 0.5))
	var pivot_y := float(pivot.get("y", 0.5))
	var bounds := {"x": -22.0, "y": -22.0, "w": 44.0, "h": 44.0}
	if kind == "rect":
		var width := float(properties.get(str(adapter.get("widthProperty", "w")), properties.get("w", 32.0)))
		var height := float(properties.get(str(adapter.get("heightProperty", "h")), properties.get("h", 32.0)))
		bounds = {"x": -pivot_x * width, "y": -pivot_y * height, "w": width, "h": height}
	elif kind in ["circle", "radius"]:
		var radius := float(properties.get(str(adapter.get("radiusProperty", "radius")), properties.get("radius", 22.0)))
		bounds = {"x": -radius, "y": -radius, "w": radius * 2.0, "h": radius * 2.0}
	elif kind in ["slope", "segment", "line"] or str(object.type) == "slope":
		var dx := float(properties.get("dx", 0.0))
		var dy := float(properties.get("dy", 0.0))
		var half := float(properties.get("thickness", 14.0)) * 0.5
		bounds = {"x": minf(0.0, dx) - half, "y": minf(0.0, dy) - half, "w": absf(dx) + half * 2.0, "h": absf(dy) + half * 2.0}
	elif str(object.type) == "backgroundSeed":
		var size := float(properties.get("size", 150.0))
		bounds = {"x": -size, "y": -size, "w": size * 2.0, "h": size * 2.0}
	elif kind == "point":
		var radius := float(adapter.get("radius", 0.0))
		bounds = {"x": -radius, "y": -radius, "w": radius * 2.0, "h": radius * 2.0}
	return _transform_bounds(transform, bounds)


func _connection_dependencies(chunk_id: String, world: Dictionary) -> Array:
	var dependencies: Dictionary = {}
	for region in world.regions:
		for chunk in region.chunks:
			for connection in chunk.connections:
				var from_id := str(connection.get("from", {}).get("chunkId", ""))
				var to_id := str(connection.get("to", {}).get("chunkId", ""))
				if from_id == chunk_id and not to_id.is_empty():
					dependencies[to_id] = true
				elif to_id == chunk_id and not bool(connection.get("oneWay", false)) and not from_id.is_empty():
					dependencies[from_id] = true
	var result: Array = dependencies.keys()
	result.sort()
	return result


func _state_references(object: Dictionary) -> Array:
	var result: Dictionary = {}
	var properties: Dictionary = object.get("properties", {})
	for key in ["requiredFlag", "setFlag", "clearFlag", "clearedByFlag"]:
		var value := str(properties.get(key, ""))
		if not value.is_empty(): result[value] = true
	for link in object.get("links", []):
		if link is Dictionary and str(link.get("kind", "")) in ["state", "flag"]:
			var value := str(link.get("targetId", link.get("id", "")))
			if not value.is_empty(): result[value] = true
	var array: Array = result.keys()
	array.sort()
	return array


func _ability_references(object: Dictionary) -> Array:
	var result: Dictionary = {}
	var properties: Dictionary = object.get("properties", {})
	for key in ["requiredAbility", "abilityId"]:
		var value := str(properties.get(key, ""))
		if not value.is_empty(): result[value] = true
	var array: Array = result.keys()
	array.sort()
	return array


func _project_connections(values: Array) -> Array:
	var result: Array = []
	for connection in values:
		result.append({
			"id": str(connection.get("id", "")),
			"from": connection.get("from", {}).duplicate(true),
			"to": connection.get("to", {}).duplicate(true),
			"direction": connection.get("direction"),
			"oneWay": bool(connection.get("oneWay", false)),
			"requiredAbilities": _normalized_string_set(connection.get("requiredAbilities", [])),
			"requiredFlags": _normalized_string_set(connection.get("requiredFlags", []))
		})
	result.sort_custom(_sort_by_id)
	return result


func _chunk_state_keys(chunk: Dictionary, connections: Array, objects: Array) -> Array:
	var values: Array = []
	var state_policy: Dictionary = chunk.get("statePolicy", {})
	values.append_array(state_policy.get("stateKeys", []))
	for connection in connections: values.append_array(connection.get("requiredFlags", []))
	for object in objects: values.append_array(object.get("stateKeys", object.get("stateReferences", [])))
	return _normalized_string_set(values)


func _normalized_string_set(values: Variant) -> Array:
	var unique: Dictionary = {}
	if values is Array:
		for value in values:
			if value is String and not value.is_empty(): unique[value] = true
	var result: Array = unique.keys()
	result.sort()
	return result


func _sorted_semantic_array(values: Variant) -> Array:
	var result: Array = values.duplicate(true) if values is Array else []
	result.sort_custom(func(a: Variant, b: Variant) -> bool: return StableJson.stringify(a) < StableJson.stringify(b))
	return result


func _sorted_by_id_copy(values: Variant) -> Array:
	var result: Array = values.duplicate(true) if values is Array else []
	result.sort_custom(_sort_by_id)
	return result


func _projection_counts(regions: Array) -> Dictionary:
	var chunks := 0
	var objects := 0
	var connections := 0
	for region in regions:
		chunks += region.chunks.size()
		for chunk in region.chunks:
			objects += chunk.objects.size()
			connections += chunk.connections.size()
	return {"regions": regions.size(), "chunks": chunks, "objects": objects, "connections": connections}


func _sort_by_id(a: Variant, b: Variant) -> bool:
	return str(a.get("id", "")) < str(b.get("id", ""))


func _counts(world: Dictionary) -> Dictionary:
	var chunk_count := 0
	var object_count := 0
	for region in world.regions:
		chunk_count += region.chunks.size()
		for chunk in region.chunks:
			object_count += chunk.objects.size()
	return {"regions": world.regions.size(), "chunks": chunk_count, "objects": object_count}


func _registry_map(registry: Dictionary) -> Dictionary:
	var result := {}
	for entry in registry.get("entries", []):
		result[str(entry.id)] = entry
	return result


func _normalized_transform(value: Dictionary) -> Dictionary:
	var position: Dictionary = value.get("position", {})
	var scale_value: Dictionary = value.get("scale", {})
	return {
		"position": {"x": _number(position.get("x", 0.0)), "y": _number(position.get("y", 0.0))},
		"rotationDegrees": _number(value.get("rotationDegrees", 0.0)),
		"scale": {"x": _number(scale_value.get("x", 1.0)), "y": _number(scale_value.get("y", 1.0))}
	}


func _compose_transform(parent: Dictionary, child: Dictionary) -> Dictionary:
	var radians := deg_to_rad(float(parent.rotationDegrees))
	var scaled := Vector2(float(child.position.x) * float(parent.scale.x), float(child.position.y) * float(parent.scale.y))
	var rotated := scaled.rotated(radians)
	return _normalized_transform({
		"position": {"x": float(parent.position.x) + rotated.x, "y": float(parent.position.y) + rotated.y},
		"rotationDegrees": float(parent.rotationDegrees) + float(child.rotationDegrees),
		"scale": {"x": float(parent.scale.x) * float(child.scale.x), "y": float(parent.scale.y) * float(child.scale.y)}
	})


func _transform_bounds(transform: Dictionary, bounds: Dictionary) -> Dictionary:
	var points := [
		Vector2(float(bounds.x), float(bounds.y)),
		Vector2(float(bounds.x) + float(bounds.w), float(bounds.y)),
		Vector2(float(bounds.x), float(bounds.y) + float(bounds.h)),
		Vector2(float(bounds.x) + float(bounds.w), float(bounds.y) + float(bounds.h))
	]
	var transformed: Array[Vector2] = []
	var radians := deg_to_rad(float(transform.rotationDegrees))
	for point in points:
		var scaled := Vector2(point.x * float(transform.scale.x), point.y * float(transform.scale.y))
		transformed.append(Vector2(float(transform.position.x), float(transform.position.y)) + scaled.rotated(radians))
	var min_point := transformed[0]
	var max_point := transformed[0]
	for point in transformed.slice(1):
		min_point = min_point.min(point)
		max_point = max_point.max(point)
	return {"x": _number(min_point.x), "y": _number(min_point.y), "w": _number(max_point.x - min_point.x), "h": _number(max_point.y - min_point.y)}


func _apply_transform(node: Node2D, transform: Dictionary) -> void:
	node.position = Vector2(float(transform.position.x), float(transform.position.y))
	node.rotation_degrees = float(transform.rotationDegrees)
	node.scale = Vector2(float(transform.scale.x), float(transform.scale.y))


func _number(value: Variant) -> Variant:
	var rounded := snappedf(float(value), 0.000001)
	return int(rounded) if rounded == floor(rounded) and absf(rounded) <= 9007199254740991.0 else rounded


func _write_artifact(path: String, data: Variant) -> Dictionary:
	return CablesterFileUtils.write_json_atomic(path, data)


func _failure(path: String, messages: Array) -> Dictionary:
	var errors: Array = []
	for message in messages:
		errors.append({"severity": "error", "code": "read", "path": path, "message": str(message)})
	return {"ok": false, "sourcePath": path, "errors": errors, "warnings": [], "issues": errors}


func _safe_name(value: String) -> String:
	return value.replace("/", "_").replace(":", "_").replace("@", "_")


func _safe_file_name(value: String) -> String:
	var result := value.to_lower()
	for character in ["/", "\\", ":", "@", " ", "\t", "\n"]:
		result = result.replace(character, "-")
	return result if not result.is_empty() else "world"
