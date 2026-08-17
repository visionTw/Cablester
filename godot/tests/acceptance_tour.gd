class_name ForestAcceptanceTour
extends Node

## Scripted headless systems acceptance for the first formal forest. This is
## intentionally labelled as a contact/API tour, never as human playtesting.
## Geometry/3C physics is covered separately by the real-physics headless suite.

const TOUR_VERSION := 1
const INTERACTION_TYPES := ["abilityPickup", "stateTrigger", "checkpoint"]

var runtime: WorldRuntime
var world: Dictionary = {}
var source_path := ""
var errors: Array[String] = []
var visited_chunks: Dictionary = {}
var edge_coverage: Dictionary = {}
var interaction_counts: Dictionary = {}
var route_results: Array = []
var clearance_result: Dictionary = {}
var tour_tick := 0
var started_usec := 0


func run(path: String) -> Dictionary:
	started_usec = Time.get_ticks_usec()
	source_path = path
	var loaded := CablesterFileUtils.read_json(path)
	if not loaded.ok:
		return _read_failure(str(loaded.error))
	world = loaded.data
	if str(world.get("manifest", {}).get("namespace", "")) != "formal":
		return _read_failure("Acceptance tour requires a formal World Package")
	runtime = WorldRuntime.new()
	runtime.name = "AcceptanceTourRuntime"
	add_child(runtime)
	var main_route := _route_by_kind("main")
	if main_route.is_empty() or main_route.get("chunks", []).is_empty():
		return _read_failure("Formal world has no canonical main route")
	var start_chunk := str(main_route.chunks[0])
	var imported := runtime.load_world(path, {"startChunkId": start_chunk})
	if not imported.ok:
		return _read_failure("Importer failed: %s" % JSON.stringify(imported.get("errors", [])))

	# The canonical route declarations cover the 7 main edges plus four 2-edge
	# loops. Each route is traversed in both directions; the final main pass
	# demonstrates A-B-A state safety and reaches the formal exit.
	for route in _sorted_routes():
		await _traverse_route(route, false, "%s-forward" % route.id)
		if _route_is_bidirectional(route):
			await _traverse_route(route, true, "%s-reverse" % route.id)
	await _traverse_route(main_route, false, "main-route-final")
	await _touch_chunk_interactions(str(main_route.chunks[-1]))
	var goal := _find_object(str(main_route.chunks[-1]), "goal")
	if goal == null:
		_fail("Final main-route chunk has no formal goal")
	else:
		await _touch_object(goal)
		if runtime.last_exit_id != goal.object_id:
			_fail("Formal goal contact did not emit completion: %s" % goal.object_id)

	_validate_static_clearance()
	_validate_coverage()
	var persisted := await _verify_persistence(start_chunk)
	var telemetry := runtime.finish_telemetry({
		"acceptanceKind": "scripted-headless-contact-tour",
		"notHumanPlaytest": true,
		"goalId": goal.object_id if goal else "",
		"requiredChunks": _chunk_count(),
		"requiredEdges": _connections().size()
	}, "acceptance-tour")
	var result := _build_result(goal, persisted, telemetry)
	var artifact_root := "user://acceptance-artifacts" if OS.has_feature("template") else "artifacts/godot"
	var artifact_path := artifact_root.path_join("%s.acceptance-tour.json" % str(world.manifest.worldId))
	var write := CablesterFileUtils.write_json_atomic(artifact_path, result)
	result.artifactPath = artifact_path
	result.artifactWriteOk = bool(write.ok)
	if not write.ok:
		result.ok = false
		result.errors.append(str(write.error))
		# Try once more so the artifact itself contains the write diagnosis when
		# the first write only failed due to a newly-created parent directory.
		CablesterFileUtils.write_json_atomic(artifact_path, result)
	else:
		CablesterFileUtils.write_json_atomic(artifact_path, result)
	return result


func _traverse_route(route: Dictionary, reversed: bool, label: String) -> void:
	var chunks: Array = route.get("chunks", []).duplicate()
	if reversed: chunks.reverse()
	var route_result := {"id": label, "chunks": chunks.duplicate(), "traversals": [], "ok": true}
	if chunks.is_empty():
		return
	var traversal_chunks := chunks.duplicate()
	# Loop declarations list each vertex once. Closing the final vertex back to
	# the first is what exercises the second side-loop edge (and proves the
	# canonical bidirectional A-B-A semantics instead of only visiting nodes).
	if str(route.get("kind", "")) == "loop" and chunks.size() > 1:
		traversal_chunks.append(chunks[0])
	await _activate_and_touch(str(chunks[0]))
	for index in traversal_chunks.size() - 1:
		var source := str(traversal_chunks[index])
		var target := str(traversal_chunks[index + 1])
		var connection := _connection_between(source, target)
		if connection.is_empty():
			_fail("Route %s has no canonical connection %s -> %s" % [route.id, source, target])
			route_result.ok = false
			continue
		var direction := _connection_direction(connection, source, target)
		if direction == "reverse" and bool(connection.get("oneWay", false)):
			_fail("Route %s illegally reverses one-way edge %s" % [route.id, connection.id])
			route_result.ok = false
			continue
		var exit := _find_exit(source, target, connection, direction)
		if exit == null:
			_fail("Missing canonical roomExit for %s -> %s (%s)" % [source, target, connection.id])
			route_result.ok = false
			continue
		var gates_ready := runtime.player._gate_satisfied(exit)
		if not gates_ready:
			_fail("Connection gate is not satisfied after canonical source interactions: %s" % connection.id)
			route_result.ok = false
			continue
		runtime.last_exit_id = ""
		await _touch_object(exit)
		var transitioned := runtime.streamer.active_chunk_id == target and runtime.last_exit_id == exit.object_id
		if not transitioned:
			_fail("Room exit %s did not atomically transition %s -> %s" % [exit.object_id, source, target])
			route_result.ok = false
		else:
			_record_edge(connection, direction)
			route_result.traversals.append({
				"edgeId": str(connection.id), "direction": direction,
				"from": source, "to": target, "exitId": exit.object_id,
				"requiredAbilities": connection.get("requiredAbilities", []).duplicate(),
				"requiredFlags": connection.get("requiredFlags", []).duplicate()
			})
		await _touch_chunk_interactions(target)
	route_results.append(route_result)


func _activate_and_touch(chunk_id: String) -> void:
	var activated := runtime.streamer.activate_chunk(chunk_id, runtime.player.velocity)
	if not activated.ok:
		_fail("Cannot activate chunk %s: %s" % [chunk_id, activated.get("error", "unknown")])
		return
	await _touch_chunk_interactions(chunk_id)


func _touch_chunk_interactions(chunk_id: String) -> void:
	visited_chunks[chunk_id] = true
	if runtime.streamer.active_chunk_id != chunk_id:
		var activated := runtime.streamer.activate_chunk(chunk_id, runtime.player.velocity)
		if not activated.ok:
			_fail("Cannot activate interaction chunk %s" % chunk_id)
			return
	for type_id in INTERACTION_TYPES:
		var objects := _find_objects(chunk_id, type_id)
		objects.sort_custom(func(a: CanonicalObject, b: CanonicalObject) -> bool: return a.object_id < b.object_id)
		for object in objects:
			# Consumed persistent interactions prove state restoration when revisited;
			# they do not need a second synthetic contact.
			if not object.visible and type_id in ["abilityPickup", "stateTrigger"]:
				continue
			await _touch_object(object)
			interaction_counts[type_id] = int(interaction_counts.get(type_id, 0)) + 1


func _touch_object(object: CanonicalObject) -> void:
	if object == null or not is_instance_valid(object): return
	var started := Time.get_ticks_usec()
	# Several canonical checkpoints intentionally overlap the return exit at the
	# room entrance. Preserve an exit guard while touching non-exit interactions,
	# then clear it only for the roomExit/goal this scripted contact tour selected.
	# Continuous physical traversal is proven separately by continuous_route.gd.
	runtime.player.exit_contact_cooldown = 0.0 if object.runtime_handler in ["roomExit", "goal"] else 1.0
	runtime.player._trigger_contacts = {}
	runtime.player.global_position = object.world_interaction_bounds().get_center()
	runtime.player.velocity = Vector2.ZERO
	runtime.player._process_contacts(0.0)
	runtime.telemetry.sample_physics(tour_tick, runtime.player, runtime.streamer.active_chunk_id, Time.get_ticks_usec() - started)
	runtime.telemetry.sample_frame()
	runtime.telemetry.absorb_chunk_events(runtime.streamer)
	tour_tick += 1
	await get_tree().process_frame


func _verify_persistence(start_chunk: String) -> Dictionary:
	var save := runtime.state_store.save_to_disk("acceptance-tour")
	if not save.ok:
		_fail("Acceptance state could not be saved: %s" % save.get("error", "unknown"))
		return {"ok": false}
	var expected_abilities := runtime.state_store.abilities.duplicate(true)
	var expected_flags := runtime.state_store.flags.duplicate(true)
	var expected_checkpoint := runtime.state_store.checkpoint.duplicate(true)
	var expected_objects := runtime.state_store.object_states.duplicate(true)
	var restored_store := WorldStateStore.new()
	restored_store.configure(world, start_chunk)
	var store_load := restored_store.load_from_disk("acceptance-tour")
	var store_matches: bool = (
		bool(store_load.ok)
		and StableJson.stringify(restored_store.abilities) == StableJson.stringify(expected_abilities)
		and StableJson.stringify(restored_store.flags) == StableJson.stringify(expected_flags)
		and StableJson.stringify(restored_store.checkpoint) == StableJson.stringify(expected_checkpoint)
		and StableJson.stringify(restored_store.object_states) == StableJson.stringify(expected_objects)
	)
	if not store_matches: _fail("Fresh WorldStateStore did not restore abilities, flags and checkpoint exactly")

	var restored_runtime := WorldRuntime.new()
	restored_runtime.name = "RestoredAcceptanceRuntime"
	add_child(restored_runtime)
	var runtime_load := restored_runtime.load_world(source_path, {
		"startChunkId": start_chunk, "loadSave": true, "saveSlot": "acceptance-tour"
	})
	var runtime_matches: bool = (
		bool(runtime_load.ok)
		and StableJson.stringify(restored_runtime.state_store.abilities) == StableJson.stringify(expected_abilities)
		and StableJson.stringify(restored_runtime.state_store.flags) == StableJson.stringify(expected_flags)
		and StableJson.stringify(restored_runtime.state_store.checkpoint) == StableJson.stringify(expected_checkpoint)
		and StableJson.stringify(restored_runtime.state_store.object_states) == StableJson.stringify(expected_objects)
	)
	if not runtime_matches: _fail("Fresh WorldRuntime did not restore abilities, flags and checkpoint exactly")
	var result := {
		"ok": store_matches and runtime_matches,
		"storeReload": store_matches,
		"runtimeReload": runtime_matches,
		"abilities": expected_abilities.keys(),
		"flags": expected_flags.duplicate(true),
		"checkpoint": expected_checkpoint,
		"persistentObjectStateCount": expected_objects.size()
	}
	result.abilities.sort()
	restored_runtime.queue_free()
	return result


func _validate_coverage() -> void:
	var all_connections := _connections()
	if visited_chunks.size() != _chunk_count():
		_fail("Acceptance tour visited %d/%d chunks" % [visited_chunks.size(), _chunk_count()])
	if all_connections.size() != 15:
		_fail("Frozen first forest must expose 15 canonical edges, found %d" % all_connections.size())
	for connection in all_connections:
		var coverage: Dictionary = edge_coverage.get(str(connection.id), {})
		if int(coverage.get("forward", 0)) < 1:
			_fail("Canonical edge lacks forward coverage: %s" % connection.id)
		if not bool(connection.get("oneWay", false)) and int(coverage.get("reverse", 0)) < 1:
			_fail("Bidirectional canonical edge lacks reverse coverage: %s" % connection.id)
	for required_type in INTERACTION_TYPES:
		if int(interaction_counts.get(required_type, 0)) < 1:
			_fail("Acceptance tour did not exercise %s through player contact" % required_type)
	if runtime.state_store.checkpoint.is_empty():
		_fail("Acceptance tour did not persist a checkpoint")
	var declared_flags: Array = world.get("stateDefinitions", {}).get("flags", [])
	for definition in declared_flags:
		if definition is Dictionary and not runtime.state_store.has_flag(str(definition.get("id", ""))):
			_fail("Acceptance tour did not set formal world flag %s" % definition.id)
	for ability in world.get("gameplayTuning", {}).get("approved", {}).get("abilities", []):
		if not runtime.state_store.has_ability(str(ability)):
			_fail("Acceptance tour did not acquire approved ability %s" % ability)


func _build_result(goal: CanonicalObject, persisted: Dictionary, telemetry: Dictionary) -> Dictionary:
	var edge_details: Array = []
	for connection in _connections():
		edge_details.append({
			"id": str(connection.id),
			"from": str(connection.get("from", {}).get("chunkId", "")),
			"to": str(connection.get("to", {}).get("chunkId", "")),
			"oneWay": bool(connection.get("oneWay", false)),
			"forwardTraversals": int(edge_coverage.get(str(connection.id), {}).get("forward", 0)),
			"reverseTraversals": int(edge_coverage.get(str(connection.id), {}).get("reverse", 0))
		})
	var visited: Array = visited_chunks.keys()
	visited.sort()
	return {
		"acceptanceTourVersion": TOUR_VERSION,
		"acceptanceKind": "scripted-headless-contact-tour",
		"notHumanPlaytest": true,
		"ok": errors.is_empty() and bool(persisted.get("ok", false)),
		"worldId": str(world.manifest.worldId),
		"schemaVersion": int(world.schemaVersion),
		"contentVersion": str(world.manifest.contentVersion),
		"sourceContentHash": str(world.manifest.contentHash),
		"gameplayTuningVersion": str(world.manifest.gameplayTuningVersion),
		"godotBuildId": CablesterFileUtils.godot_build_id(),
		"generatedAt": Time.get_datetime_string_from_system(true),
		"durationSeconds": (Time.get_ticks_usec() - started_usec) / 1000000.0,
		"counts": {
			"chunks": _chunk_count(), "visitedChunks": visited.size(),
			"edges": edge_details.size(),
			"forwardEdgeCoverage": edge_details.filter(func(edge: Dictionary) -> bool: return edge.forwardTraversals > 0).size(),
			"reverseEdgeCoverage": edge_details.filter(func(edge: Dictionary) -> bool: return edge.oneWay or edge.reverseTraversals > 0).size(),
			"physicsContactSteps": tour_tick,
			"interactionContacts": interaction_counts.duplicate(true),
			"staticClearanceEndpoints": int(clearance_result.get("endpointPairs", 0))
		},
		"visitedChunks": visited,
		"edges": edge_details,
		"routes": route_results.duplicate(true),
		"goalId": goal.object_id if goal else "",
		"finalAbilities": _sorted_true_keys(runtime.state_store.abilities),
		"finalFlags": runtime.state_store.flags.duplicate(true),
		"checkpoint": runtime.state_store.checkpoint.duplicate(true),
		"staticClearance": clearance_result.duplicate(true),
		"persistence": persisted,
		"performance": telemetry.get("performance", {}).duplicate(true),
		"telemetryPath": telemetry.get("telemetryPath", ""),
		"telemetryCounters": telemetry.get("counters", {}).duplicate(true),
		"errors": errors.duplicate()
	}


func _sorted_routes() -> Array:
	var main: Array = []
	var loops: Array = []
	for region in world.get("regions", []):
		for route in region.get("routes", []):
			if str(route.get("kind", "")) == "main": main.append(route)
			else: loops.append(route)
	loops.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.id) < str(b.id))
	main.append_array(loops)
	return main


func _route_by_kind(kind: String) -> Dictionary:
	for region in world.get("regions", []):
		for route in region.get("routes", []):
			if str(route.get("kind", "")) == kind: return route
	return {}


func _route_is_bidirectional(route: Dictionary) -> bool:
	var chunks: Array = route.get("chunks", [])
	var traversal_chunks := chunks.duplicate()
	if str(route.get("kind", "")) == "loop" and chunks.size() > 1:
		traversal_chunks.append(chunks[0])
	for index in traversal_chunks.size() - 1:
		var connection := _connection_between(str(traversal_chunks[index]), str(traversal_chunks[index + 1]))
		if connection.is_empty() or bool(connection.get("oneWay", false)): return false
	return true


func _validate_static_clearance() -> void:
	var diameter := runtime.player.radius * 2.0
	var capsule_size := Vector2(runtime.player.radius * 1.44, diameter)
	clearance_result = {
		"ok": true,
		"playerDiameter": diameter,
		"endpointPairs": 0,
		"triggerBoundsChecked": 0,
		"spawnPointsChecked": 0,
		"solidOverlapChecks": 0,
		"minimumTriggerWidth": INF,
		"minimumTriggerHeight": INF,
		"details": []
	}
	for connection in _connections():
		var endpoints := [
			{"source": connection.get("from", {}), "target": connection.get("to", {}), "direction": "forward"},
			{"source": connection.get("to", {}), "target": connection.get("from", {}), "direction": "reverse"}
		]
		if bool(connection.get("oneWay", false)): endpoints.resize(1)
		for endpoint in endpoints:
			var source: Dictionary = endpoint.source
			var target: Dictionary = endpoint.target
			var chunk_id := str(source.get("chunkId", ""))
			var entrance_id := str(source.get("entranceId", ""))
			var entrance := _find_object_by_id(chunk_id, entrance_id)
			var exit := _find_exit(chunk_id, str(target.get("chunkId", "")), connection, str(endpoint.direction))
			clearance_result.endpointPairs = int(clearance_result.endpointPairs) + 1
			if entrance == null or exit == null:
				clearance_result.ok = false
				_fail("Static clearance cannot resolve endpoint pair for %s in %s" % [connection.id, chunk_id])
				continue
			var detail := {
				"edgeId": str(connection.id), "direction": str(endpoint.direction),
				"chunkId": chunk_id, "entranceId": entrance.object_id, "exitId": exit.object_id,
				"solidOverlaps": []
			}
			for trigger in [entrance, exit]:
				var trigger_bounds: Rect2 = trigger.world_interaction_bounds()
				clearance_result.triggerBoundsChecked = int(clearance_result.triggerBoundsChecked) + 1
				clearance_result.minimumTriggerWidth = minf(float(clearance_result.minimumTriggerWidth), trigger_bounds.size.x)
				clearance_result.minimumTriggerHeight = minf(float(clearance_result.minimumTriggerHeight), trigger_bounds.size.y)
				if trigger_bounds.size.x + 0.001 < diameter or trigger_bounds.size.y + 0.001 < diameter:
					clearance_result.ok = false
					_fail("Endpoint trigger %s is smaller than the %.1f player diameter" % [trigger.object_id, diameter])
			var spawn_position := entrance.global_position + Vector2(
				float(entrance.canonical_properties.get("spawnOffsetX", 0.0)),
				float(entrance.canonical_properties.get("spawnOffsetY", 0.0))
			)
			var player_bounds := Rect2(spawn_position - capsule_size * 0.5, capsule_size).grow(-0.25)
			var chunk_node: Node = runtime.streamer.loaded_chunks.get(chunk_id)
			if chunk_node:
				for candidate in chunk_node.find_children("*", "CanonicalObject", true, false):
					if candidate._solid_shape == null or not candidate.visible: continue
					if candidate.type_id not in ["platform", "slope", "boundaryWall"]: continue
					clearance_result.solidOverlapChecks = int(clearance_result.solidOverlapChecks) + 1
					if player_bounds.intersects(candidate.world_interaction_bounds()):
						detail.solidOverlaps.append(candidate.object_id)
			clearance_result.spawnPointsChecked = int(clearance_result.spawnPointsChecked) + 1
			detail.spawnPosition = {"x": spawn_position.x, "y": spawn_position.y}
			clearance_result.details.append(detail)
			if not detail.solidOverlaps.is_empty():
				clearance_result.ok = false
				_fail("Endpoint spawn %s overlaps static collision: %s" % [entrance.object_id, ", ".join(detail.solidOverlaps)])
	if clearance_result.minimumTriggerWidth == INF: clearance_result.minimumTriggerWidth = 0.0
	if clearance_result.minimumTriggerHeight == INF: clearance_result.minimumTriggerHeight = 0.0


func _connections() -> Array:
	var result: Array = []
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			result.append_array(chunk.get("connections", []))
	result.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a.id) < str(b.id))
	return result


func _connection_between(source: String, target: String) -> Dictionary:
	for connection in _connections():
		var from_id := str(connection.get("from", {}).get("chunkId", ""))
		var to_id := str(connection.get("to", {}).get("chunkId", ""))
		if from_id == source and to_id == target: return connection
		if not bool(connection.get("oneWay", false)) and from_id == target and to_id == source: return connection
	return {}


func _connection_direction(connection: Dictionary, source: String, target: String) -> String:
	return "forward" if str(connection.get("from", {}).get("chunkId", "")) == source and str(connection.get("to", {}).get("chunkId", "")) == target else "reverse"


func _find_exit(source: String, target: String, connection: Dictionary, direction: String) -> CanonicalObject:
	var endpoint: Dictionary = connection.get("to", {}) if direction == "forward" else connection.get("from", {})
	var target_entrance := str(endpoint.get("entranceId", ""))
	for object in _find_objects(source, "roomExit"):
		var target_chunk := str(object.canonical_properties.get("targetChunkId", object.canonical_properties.get("targetRoomId", "")))
		var entrance := str(object.canonical_properties.get("targetEntranceId", ""))
		if target_chunk == target and (target_entrance.is_empty() or entrance == target_entrance):
			return object
	return null


func _find_object(chunk_id: String, type_id: String) -> CanonicalObject:
	var objects := _find_objects(chunk_id, type_id)
	return objects[0] if not objects.is_empty() else null


func _find_object_by_id(chunk_id: String, object_id: String) -> CanonicalObject:
	var chunk_node: Node = runtime.streamer.loaded_chunks.get(chunk_id)
	if chunk_node == null: return null
	for object in chunk_node.find_children("*", "CanonicalObject", true, false):
		if object.object_id == object_id: return object
	return null


func _find_objects(chunk_id: String, type_id: String) -> Array[CanonicalObject]:
	var result: Array[CanonicalObject] = []
	var chunk_node: Node = runtime.streamer.loaded_chunks.get(chunk_id)
	if chunk_node == null: return result
	for object in chunk_node.find_children("*", "CanonicalObject", true, false):
		if object.type_id == type_id: result.append(object)
	return result


func _record_edge(connection: Dictionary, direction: String) -> void:
	var id := str(connection.id)
	if not edge_coverage.has(id): edge_coverage[id] = {"forward": 0, "reverse": 0}
	edge_coverage[id][direction] = int(edge_coverage[id].get(direction, 0)) + 1


func _chunk_count() -> int:
	var result := 0
	for region in world.get("regions", []): result += region.get("chunks", []).size()
	return result


func _sorted_true_keys(values: Dictionary) -> Array:
	var result: Array = []
	for key in values:
		if bool(values[key]): result.append(str(key))
	result.sort()
	return result


func _fail(message: String) -> void:
	errors.append(message)
	push_error("ACCEPTANCE TOUR: %s" % message)


func _read_failure(message: String) -> Dictionary:
	return {
		"ok": false, "acceptanceTourVersion": TOUR_VERSION,
		"acceptanceKind": "scripted-headless-contact-tour", "notHumanPlaytest": true,
		"errors": [message]
	}
