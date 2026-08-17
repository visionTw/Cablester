class_name WorldPackageValidator
extends RefCounted

const SCHEMA_VERSION := 3
const REQUIRED_MANIFEST_FIELDS := [
	"worldId", "title", "namespace", "contentVersion", "contentHash",
	"gameplayTuningVersion", "assetRegistryVersion", "prefabRegistryVersion", "typeRegistryVersion"
]
const KNOWN_ABILITIES := {
	"rope": true, "hardBar": true, "wallGrab": true, "doubleJump": true,
	"glide": true, "bash": true, "dash": true
}
const REQUIRED_CHUNK_FIELDS := [
	"id", "name", "transform", "bounds", "streaming", "connections",
	"objects", "scene", "statePolicy", "tags"
]

var issues: Array[Dictionary] = []
var _namespace := "formal"
var _type_by_id: Dictionary = {}
var _asset_by_id: Dictionary = {}
var _prefab_by_id: Dictionary = {}
var _region_ids: Dictionary = {}
var _chunk_ids: Dictionary = {}
var _object_ids: Dictionary = {}
var _state_keys: Dictionary = {}


func validate(world: Dictionary, options: Dictionary = {}) -> Array[Dictionary]:
	issues = []
	var required_build := CablesterFileUtils.required_godot_build_id()
	var actual_build := CablesterFileUtils.godot_build_id()
	if required_build.is_empty() or actual_build != required_build:
		_add("error", "godot-build-id", "GODOT_VERSION", "Expected exact Godot build %s, running %s" % [required_build, actual_build])
	_namespace = str(world.get("manifest", {}).get("namespace", "formal"))
	_type_by_id = _registry_map(world.get("typeRegistry", {}), "typeRegistry")
	_asset_by_id = _registry_map(world.get("assetRegistry", {}), "assetRegistry")
	_prefab_by_id = _registry_map(world.get("prefabRegistry", {}), "prefabRegistry")
	_region_ids = {}
	_chunk_ids = {}
	_object_ids = {}
	_state_keys = {}

	_validate_root(world)
	_collect_ids_and_state_keys(world)
	_validate_regions(world, options)
	_validate_content_hash(world)
	return issues.duplicate(true)


func has_errors() -> bool:
	return issues.any(func(issue: Dictionary) -> bool: return issue.severity == "error")


func error_messages() -> PackedStringArray:
	var messages: PackedStringArray = []
	for issue in issues:
		if issue.severity == "error":
			messages.append("%s: %s" % [issue.path, issue.message])
	return messages


func _validate_root(world: Dictionary) -> void:
	if world.get("schemaVersion") != SCHEMA_VERSION:
		_add("error", "schema-version", "schemaVersion", "Expected canonical schemaVersion 3")
	var manifest: Variant = world.get("manifest")
	if not manifest is Dictionary:
		_add("error", "manifest", "manifest", "manifest must be an object")
		return
	for field in REQUIRED_MANIFEST_FIELDS:
		if not manifest.has(field) or str(manifest[field]).is_empty():
			_add("error", "manifest-field", "manifest.%s" % field, "Required manifest field is missing")
	if not world.get("regions") is Array:
		_add("error", "regions", "regions", "regions must be an array")
	for registry_name in ["typeRegistry", "assetRegistry", "prefabRegistry"]:
		_validate_registry(world.get(registry_name), registry_name, manifest)
	var tuning: Variant = world.get("gameplayTuning")
	if not tuning is Dictionary:
		_add("error", "tuning", "gameplayTuning", "gameplayTuning must be an object")
	else:
		if str(tuning.get("version", "")) != str(manifest.get("gameplayTuningVersion", "")):
			_add("error", "tuning-version", "gameplayTuning.version", "Version does not match manifest.gameplayTuningVersion")
		if not tuning.get("approved") is Dictionary:
			_add("error", "approved-tuning", "gameplayTuning.approved", "Approved tuning must be an object")


func _validate_registry(registry: Variant, name: String, manifest: Dictionary) -> void:
	if not registry is Dictionary:
		_add("error", "registry", name, "%s must be an object" % name)
		return
	if not registry.get("entries") is Array:
		_add("error", "registry-entries", "%s.entries" % name, "Registry entries must be an array")
	var version_field: String = {
		"typeRegistry": "typeRegistryVersion",
		"assetRegistry": "assetRegistryVersion",
		"prefabRegistry": "prefabRegistryVersion"
	}[name]
	if str(registry.get("version", "")) != str(manifest.get(version_field, "")):
		_add("error", "registry-version", "%s.version" % name, "Registry version does not match manifest.%s" % version_field)
	if name == "prefabRegistry" and registry.get("entries") is Array:
		for entry_index in registry.entries.size():
			var entry: Variant = registry.entries[entry_index]
			if not entry is Dictionary:
				continue
			var scene_path := str(entry.get("godotScene", ""))
			if CablesterFileUtils.approved_prefab_scene_path(scene_path).is_empty():
				_add("error", "invalid-godot-scene", "%s.entries[%d].godotScene" % [name, entry_index], "Godot prefab scene must be a .tscn under %s" % CablesterFileUtils.APPROVED_PREFAB_ROOT)


func _registry_map(registry: Variant, path: String) -> Dictionary:
	var result := {}
	if not registry is Dictionary or not registry.get("entries") is Array:
		return result
	for index in registry.entries.size():
		var entry: Variant = registry.entries[index]
		if not entry is Dictionary or str(entry.get("id", "")).is_empty():
			_add("error", "registry-entry", "%s.entries[%d]" % [path, index], "Registry entry must have a stable id")
			continue
		var id := str(entry.id)
		if result.has(id):
			_add("error", "duplicate-registry-id", "%s.entries[%d].id" % [path, index], "Duplicate registry id: %s" % id)
		result[id] = entry
	return result


func _collect_ids_and_state_keys(world: Dictionary) -> void:
	_collect_state_policy(world.get("statePolicy", {}))
	_collect_state_policy(world.get("worldState", {}))
	_collect_state_policy(world.get("stateDefinitions", {}))
	for region_index in world.get("regions", []).size():
		var region: Variant = world.regions[region_index]
		if not region is Dictionary:
			continue
		_collect_unique_id(region, "regions[%d]" % region_index, _region_ids)
		_collect_state_policy(region.get("statePolicy", {}))
		for chunk_index in region.get("chunks", []).size():
			var chunk: Variant = region.chunks[chunk_index]
			if not chunk is Dictionary:
				continue
			_collect_unique_id(chunk, "regions[%d].chunks[%d]" % [region_index, chunk_index], _chunk_ids)
			_collect_state_policy(chunk.get("statePolicy", {}))
			for object_index in chunk.get("objects", []).size():
				var object: Variant = chunk.objects[object_index]
				if not object is Dictionary:
					continue
				_collect_unique_id(object, "regions[%d].chunks[%d].objects[%d]" % [region_index, chunk_index, object_index], _object_ids)
				_collect_state_policy(object.get("statePolicy", {}))


func _collect_unique_id(value: Dictionary, path: String, target: Dictionary) -> void:
	var id := str(value.get("id", ""))
	if id.is_empty():
		_add("error", "missing-id", path + ".id", "Stable id is required")
	elif target.has(id):
		_add("error", "duplicate-id", path + ".id", "Duplicate id: %s" % id)
	else:
		target[id] = path


func _collect_state_policy(value: Variant) -> void:
	if value is String and not value.is_empty():
		_state_keys[value] = true
	elif value is Array:
		for item in value:
			_collect_state_policy(item)
	elif value is Dictionary:
		if value.has("id") and (value.has("initialValue") or value.has("persistence") or value.has("default")):
			_state_keys[str(value.id)] = true
		for key in value:
			if key in ["defaults", "flags", "keys", "persistent", "persistentFlags", "resetOnDeath", "resetOnDeathFlags", "resetOnRoom", "resetOnRoomFlags", "allowedFlags", "worldFlags"]:
				if value[key] is Dictionary:
					for state_key in value[key]:
						_state_keys[str(state_key)] = true
				else:
					_collect_state_policy(value[key])


func _validate_regions(world: Dictionary, options: Dictionary) -> void:
	if not world.get("regions") is Array:
		return
	for region_index in world.regions.size():
		var region: Variant = world.regions[region_index]
		var path := "regions[%d]" % region_index
		if not region is Dictionary:
			_add("error", "region", path, "Region must be an object")
			continue
		_validate_transform(region.get("transform"), path + ".transform")
		_validate_bounds(region.get("bounds"), path + ".bounds")
		if not region.get("chunks") is Array:
			_add("error", "chunks", path + ".chunks", "chunks must be an array")
			continue
		for chunk_index in region.chunks.size():
			_validate_chunk(region.chunks[chunk_index], "%s.chunks[%d]" % [path, chunk_index], options)


func _validate_chunk(chunk: Variant, path: String, options: Dictionary) -> void:
	if not chunk is Dictionary:
		_add("error", "chunk", path, "Chunk must be an object")
		return
	for field in REQUIRED_CHUNK_FIELDS:
		if not chunk.has(field):
			_add("error", "chunk-field", "%s.%s" % [path, field], "Required chunk field is missing")
	_validate_transform(chunk.get("transform"), path + ".transform")
	_validate_bounds(chunk.get("bounds"), path + ".bounds")
	_validate_streaming(chunk.get("streaming"), path + ".streaming")
	if not chunk.get("connections") is Array:
		_add("error", "connections", path + ".connections", "connections must be an array")
	else:
		for index in chunk.connections.size():
			_validate_connection(chunk.connections[index], "%s.connections[%d]" % [path, index])
	if not chunk.get("objects") is Array:
		_add("error", "objects", path + ".objects", "objects must be an array")
		return
	for object_index in chunk.objects.size():
		_validate_object(chunk.objects[object_index], "%s.objects[%d]" % [path, object_index], options)
	_validate_scene(chunk.get("scene"), path + ".scene")


func _validate_scene(scene: Variant, path: String) -> void:
	if not scene is Dictionary or not scene.get("layers") is Array:
		_add("error", "scene", path, "scene.layers must be an array")
		return
	var layer_ids: Dictionary = {}
	for layer_index in scene.layers.size():
		var layer: Variant = scene.layers[layer_index]
		var layer_path := "%s.layers[%d]" % [path, layer_index]
		if not layer is Dictionary:
			_add("error", "scene-layer", layer_path, "Scene layer must be an object")
			continue
		var id := str(layer.get("id", ""))
		if id.is_empty() or layer_ids.has(id):
			_add("error", "scene-layer-id", layer_path + ".id", "Scene layer id must be stable and unique")
		layer_ids[id] = true
		if not layer.get("assets", []) is Array:
			_add("error", "scene-assets", layer_path + ".assets", "Scene layer assets must be an array")
			continue
		for asset_index in layer.get("assets", []).size():
			var candidate: Variant = layer.assets[asset_index]
			if not candidate is Dictionary or str(candidate.get("assetId", "")).is_empty():
				_add("error", "scene-asset", "%s.assets[%d]" % [layer_path, asset_index], "Scene asset requires an assetId")
				continue
			_validate_asset(str(candidate.assetId), "%s.assets[%d].assetId" % [layer_path, asset_index])


func _validate_streaming(streaming: Variant, path: String) -> void:
	if not streaming is Dictionary:
		_add("error", "streaming", path, "streaming must be an object")
		return
	for field in ["prefetchDistance", "hysteresis", "unloadDelaySeconds", "memoryEstimateBytes"]:
		if streaming.has(field) and (not _is_finite_number(streaming[field]) or float(streaming[field]) < 0.0):
			_add("error", "streaming-number", "%s.%s" % [path, field], "%s must be a finite non-negative number" % field)
	if streaming.has("keepAlive") and not streaming.keepAlive is bool:
		_add("error", "streaming-keep-alive", path + ".keepAlive", "keepAlive must be boolean")


func _validate_connection(connection: Variant, path: String) -> void:
	if not connection is Dictionary:
		_add("error", "connection", path, "Connection must be an object")
		return
	if str(connection.get("id", "")).is_empty():
		_add("error", "connection-id", path + ".id", "Connection requires a stable id")
	# Frozen v3 representation is nested. Flat aliases remain import-compatible
	# only so an old derived snapshot can produce a useful error report.
	for endpoint_name in ["from", "to"]:
		var endpoint: Variant = connection.get(endpoint_name)
		if not endpoint is Dictionary:
			_add("error", "connection-endpoint", "%s.%s" % [path, endpoint_name], "Connection endpoint must be an object")
			continue
		var chunk_id := str(endpoint.get("chunkId", ""))
		var entrance_id := str(endpoint.get("entranceId", ""))
		if chunk_id.is_empty() or not _chunk_ids.has(chunk_id):
			_add("error", "connection-chunk", "%s.%s.chunkId" % [path, endpoint_name], "Unknown chunk id: %s" % chunk_id)
		if entrance_id.is_empty() or not _object_ids.has(entrance_id):
			_add("error", "connection-entrance", "%s.%s.entranceId" % [path, endpoint_name], "Unknown entrance object id: %s" % entrance_id)
	for field in ["fromChunkId", "toChunkId", "sourceChunkId", "targetChunkId", "chunkId"]:
		if connection.has(field) and not str(connection[field]).is_empty() and not _chunk_ids.has(str(connection[field])):
			_add("error", "connection-chunk", "%s.%s" % [path, field], "Unknown chunk id: %s" % connection[field])
	for field in ["fromEntranceId", "toEntranceId", "sourceEntranceId", "targetEntranceId", "entranceId"]:
		if connection.has(field) and not str(connection[field]).is_empty() and not _object_ids.has(str(connection[field])):
			_add("error", "connection-entrance", "%s.%s" % [path, field], "Unknown entrance object id: %s" % connection[field])
	if not connection.get("requiredAbilities", []) is Array:
		_add("error", "connection-abilities", path + ".requiredAbilities", "requiredAbilities must be an array")
	else:
		for ability_index in connection.get("requiredAbilities", []).size():
			_validate_ability(str(connection.requiredAbilities[ability_index]), "%s.requiredAbilities[%d]" % [path, ability_index])
	if not connection.get("requiredFlags", []) is Array:
		_add("error", "connection-flags", path + ".requiredFlags", "requiredFlags must be an array")
	else:
		for flag_index in connection.get("requiredFlags", []).size():
			_validate_state_reference(str(connection.requiredFlags[flag_index]), "%s.requiredFlags[%d]" % [path, flag_index])


func _validate_object(object: Variant, path: String, _options: Dictionary) -> void:
	if not object is Dictionary:
		_add("error", "object", path, "Object must be an object")
		return
	var type_id := str(object.get("type", ""))
	if type_id.is_empty():
		_add("error", "object-type", path + ".type", "Object type is required")
		return
	if not _type_by_id.has(type_id):
		_add("error", "unknown-required-type", path + ".type", "Unknown object type: %s" % type_id)
		return
	var type_entry: Dictionary = _type_by_id[type_id]
	if str(type_entry.get("godotRuntimeHandler", "")).is_empty():
		_add("error", "runtime-handler", path + ".type", "Type %s has no Godot runtime handler" % type_id)
	_validate_transform(object.get("transform"), path + ".transform")
	if not object.get("properties") is Dictionary:
		_add("error", "properties", path + ".properties", "properties must be an object")
	if not object.get("links", []) is Array:
		_add("error", "links", path + ".links", "links must be an array")
	else:
		for link_index in object.get("links", []).size():
			_validate_link(object.links[link_index], "%s.links[%d]" % [path, link_index])
	if not object.get("tags", []) is Array:
		_add("error", "tags", path + ".tags", "tags must be an array")
	elif type_id == "abilityPickup" and object.tags.has("mandatory-ability"):
		var reset_policy := str(object.get("properties", {}).get("resetPolicy", ""))
		if (not reset_policy.is_empty() and reset_policy != "persistent") or (not object.tags.has("persistent-state") and reset_policy != "persistent"):
			_add("error", "mandatory-ability-persistence", path + ".tags", "A mandatory ability pickup must be persistent across death, room transitions and save/load")
	_validate_object_references(object, type_entry, path)


func _validate_link(link: Variant, path: String) -> void:
	var target := ""
	if link is String:
		target = link
	elif link is Dictionary:
		target = str(link.get("targetId", link.get("id", "")))
	else:
		_add("error", "link", path, "Link must be a stable id or object")
		return
	if target.is_empty() or not _object_ids.has(target):
		_add("error", "link-target", path, "Unknown link target: %s" % target)


func _validate_object_references(object: Dictionary, type_entry: Dictionary, path: String) -> void:
	var properties: Dictionary = object.get("properties", {})
	var prefab_id := str(properties.get("prefabId", object.get("prefabId", type_entry.get("defaultPrefabId", ""))))
	if not prefab_id.is_empty():
		if not _prefab_by_id.has(prefab_id):
			_add("error", "prefab", path + ".properties.prefabId", "Unknown prefab id: %s" % prefab_id)
		else:
			var prefab: Dictionary = _prefab_by_id[prefab_id]
			var scene_path := str(prefab.get("godotScene", ""))
			var approved_scene_path := CablesterFileUtils.approved_prefab_scene_path(scene_path)
			if bool(prefab.get("required", false)) and (approved_scene_path.is_empty() or not ResourceLoader.exists(approved_scene_path)):
				_add("error", "prefab-resource", path + ".properties.prefabId", "Required Godot prefab is missing: %s" % scene_path)
	var visual: Variant = properties.get("visual")
	var asset_id := ""
	if visual is Dictionary:
		asset_id = str(visual.get("assetId", properties.get("assetId", type_entry.get("defaultAssetId", ""))))
	else:
		asset_id = str(properties.get("assetId", type_entry.get("defaultAssetId", "")))
	if not asset_id.is_empty():
		_validate_asset(asset_id, path + ".properties.visual.assetId")
	for field in ["requiredAbility", "abilityId"]:
		if properties.has(field):
			_validate_ability(str(properties[field]), "%s.properties.%s" % [path, field])
	for field in ["requiredFlag", "setFlag", "clearFlag", "clearedByFlag"]:
		if properties.has(field):
			_validate_state_reference(str(properties[field]), "%s.properties.%s" % [path, field])


func _validate_asset(asset_id: String, path: String) -> void:
	if not _asset_by_id.has(asset_id):
		_add("error", "asset", path, "Unknown asset id: %s" % asset_id)
		return
	var asset: Dictionary = _asset_by_id[asset_id]
	if str(asset.get("kind", "")) == "procedural":
		return
	var platforms: Dictionary = asset.get("platforms", {})
	var godot: Dictionary = platforms.get("godot", {}) if platforms.get("godot", {}) is Dictionary else {}
	var path_value: Variant = godot.get("path", asset.get("godotPath", ""))
	var resource_path := str(path_value) if path_value is String else ""
	if resource_path.is_empty() or not ResourceLoader.exists(CablesterFileUtils.project_path(resource_path)):
		if bool(asset.get("fallbackAllowed", false)):
			_add("warning", "asset-fallback", path, "Godot asset is missing; procedural fallback will be used: %s" % resource_path)
		else:
			_add("error", "asset-resource", path, "Required Godot asset is missing: %s" % resource_path)


func _validate_ability(ability_id: String, path: String) -> void:
	if not ability_id.is_empty() and not KNOWN_ABILITIES.has(ability_id):
		_add("error", "ability", path, "Unknown ability id: %s" % ability_id)


func _validate_state_reference(state_key: String, path: String) -> void:
	if state_key.is_empty():
		return
	if not _state_keys.has(state_key):
		_add("error", "state-reference", path, "Undeclared world state key: %s" % state_key)


func _validate_content_hash(world: Dictionary) -> void:
	if not world.get("manifest") is Dictionary:
		return
	var declared := str(world.manifest.get("contentHash", ""))
	var actual := StableJson.content_hash(world)
	if declared != actual:
		_add("error", "content-hash", "manifest.contentHash", "Declared %s does not match computed %s" % [declared, actual])


func _validate_transform(transform: Variant, path: String) -> void:
	if not transform is Dictionary:
		_add("error", "transform", path, "Transform must be an object")
		return
	var position: Variant = transform.get("position")
	var scale: Variant = transform.get("scale")
	if not position is Dictionary or not _is_finite_number(position.get("x")) or not _is_finite_number(position.get("y")):
		_add("error", "transform-position", path + ".position", "Position must contain finite x/y")
	if not _is_finite_number(transform.get("rotationDegrees")):
		_add("error", "transform-rotation", path + ".rotationDegrees", "rotationDegrees must be finite")
	if not scale is Dictionary or not _is_finite_number(scale.get("x")) or not _is_finite_number(scale.get("y")):
		_add("error", "transform-scale", path + ".scale", "Scale must contain finite x/y")
	elif is_zero_approx(float(scale.x)) or is_zero_approx(float(scale.y)):
		_add("error", "transform-scale-zero", path + ".scale", "Gameplay scale cannot be zero")


func _validate_bounds(bounds: Variant, path: String) -> void:
	if not bounds is Dictionary:
		_add("error", "bounds", path, "Bounds must be an object")
		return
	for field in ["x", "y", "w", "h"]:
		if not _is_finite_number(bounds.get(field)):
			_add("error", "bounds-number", "%s.%s" % [path, field], "Bounds values must be finite")
	if _is_finite_number(bounds.get("w")) and float(bounds.w) <= 0.0:
		_add("error", "bounds-width", path + ".w", "Bounds width must be positive")
	if _is_finite_number(bounds.get("h")) and float(bounds.h) <= 0.0:
		_add("error", "bounds-height", path + ".h", "Bounds height must be positive")


func _is_finite_number(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))


func _add(severity: String, code: String, path: String, message: String) -> void:
	issues.append({"severity": severity, "code": code, "path": path, "message": message})
