class_name ChunkStreamer
extends Node2D

signal chunk_loaded(chunk_id: String)
signal chunk_unloaded(chunk_id: String)
signal chunk_state_changed(chunk_id: String, state: String)

var world: Dictionary = {}
var importer: WorldImporter
var state_store: WorldStateStore
var active_chunk_id := ""
var loaded_chunks: Dictionary = {}
var chunk_states: Dictionary = {}
var telemetry_events: Array = []
var generation := 0
var _chunk_by_id: Dictionary = {}
var _region_by_chunk: Dictionary = {}
var _adjacency: Dictionary = {}
var _unload_deadlines: Dictionary = {}
var _elapsed_seconds := 0.0


func configure(canonical_world: Dictionary, world_importer: WorldImporter, store: WorldStateStore) -> void:
	world = canonical_world
	importer = world_importer
	state_store = store
	_index_world()


func activate_chunk(chunk_id: String, velocity := Vector2.ZERO) -> Dictionary:
	if not _chunk_by_id.has(chunk_id):
		return {"ok": false, "error": "Unknown chunk: %s" % chunk_id}
	var previous_chunk_id := active_chunk_id
	generation += 1
	var request_generation := generation
	var needed: Dictionary = {chunk_id: "active"}
	for neighbor in _adjacency.get(chunk_id, []):
		needed[str(neighbor)] = "prefetch"
	for candidate_id in _directional_candidates(chunk_id, velocity):
		needed[candidate_id] = "prefetch"
	# Build every missing chunk off-tree first. If any build fails, no visible
	# streaming state changes: the transition is atomic.
	var prepared: Dictionary = {}
	for id in needed:
		if not loaded_chunks.has(id):
			var chunk_node := importer.instantiate_chunk(_region_by_chunk[id], _chunk_by_id[id], state_store.object_states)
			if chunk_node == null:
				for disposable in prepared.values(): disposable.queue_free()
				return {"ok": false, "error": "Failed to instantiate chunk: %s" % id}
			prepared[id] = chunk_node
	if request_generation != generation:
		for stale in prepared.values(): stale.queue_free()
		return {"ok": false, "discarded": true, "error": "A newer streaming request superseded this transition"}
	for id in prepared:
		add_child(prepared[id])
		loaded_chunks[id] = prepared[id]
		_apply_derived_persistent_state(prepared[id])
		_emit_event("load", id)
		chunk_loaded.emit(id)
	for id in needed:
		_set_chunk_state(id, needed[id])
		_unload_deadlines.erase(id)
	active_chunk_id = chunk_id
	state_store.enter_chunk(chunk_id, previous_chunk_id)
	state_store.visited_chunks[chunk_id] = true
	_schedule_unneeded(needed)
	return {"ok": true, "activeChunkId": active_chunk_id, "loaded": loaded_chunks.keys(), "generation": generation}


func unload_chunk(chunk_id: String, force := false) -> bool:
	if not loaded_chunks.has(chunk_id): return true
	var chunk: Dictionary = _chunk_by_id.get(chunk_id, {})
	if not force and bool(chunk.get("streaming", {}).get("keepAlive", false)):
		_set_chunk_state(chunk_id, "keep-alive")
		return false
	var node: Node = loaded_chunks[chunk_id]
	for object in node.find_children("*", "CanonicalObject", true, false):
		state_store.capture_object(object)
	loaded_chunks.erase(chunk_id)
	chunk_states.erase(chunk_id)
	_unload_deadlines.erase(chunk_id)
	node.queue_free()
	_emit_event("unload", chunk_id)
	chunk_unloaded.emit(chunk_id)
	return true


func reset_loaded_objects(policy: String) -> void:
	for chunk_node in loaded_chunks.values():
		for object in chunk_node.find_children("*", "CanonicalObject", true, false):
			object.reset_for_policy(policy)
			state_store.capture_object(object)


func memory_estimate_bytes() -> int:
	var total := 0
	for id in loaded_chunks:
		total += int(_chunk_by_id[id].get("streaming", {}).get("memoryEstimateBytes", 0))
	return total


func chunks_are_adjacent(from_id: String, to_id: String) -> bool:
	return from_id == to_id or _adjacency.get(from_id, []).has(to_id)


func chunk_bounds(chunk_id: String) -> Rect2:
	if not _chunk_by_id.has(chunk_id): return Rect2()
	var chunk: Dictionary = _chunk_by_id[chunk_id]
	var region: Dictionary = _region_by_chunk[chunk_id]
	var rt: Dictionary = region.get("transform", {})
	var ct: Dictionary = chunk.get("transform", {})
	var bounds: Dictionary = chunk.get("bounds", {})
	# Frozen formal/lab chunk transforms are axis-aligned. Import validation and
	# resolved snapshots remain authoritative for rotated object collision.
	var scale := Vector2(
		float(rt.get("scale", {}).get("x", 1.0)) * float(ct.get("scale", {}).get("x", 1.0)),
		float(rt.get("scale", {}).get("y", 1.0)) * float(ct.get("scale", {}).get("y", 1.0))
	)
	var origin := Vector2(
		float(rt.get("position", {}).get("x", 0.0)) + float(ct.get("position", {}).get("x", 0.0)),
		float(rt.get("position", {}).get("y", 0.0)) + float(ct.get("position", {}).get("y", 0.0))
	)
	var first := origin + Vector2(float(bounds.get("x", 0.0)), float(bounds.get("y", 0.0))) * scale
	var second := first + Vector2(float(bounds.get("w", 0.0)), float(bounds.get("h", 0.0))) * scale
	return Rect2(first, second - first).abs()


func _process(delta: float) -> void:
	_elapsed_seconds += delta
	for id in _unload_deadlines.keys():
		if _elapsed_seconds >= float(_unload_deadlines[id]):
			unload_chunk(id)


func update_streaming_context(player_position: Vector2, velocity: Vector2) -> void:
	if active_chunk_id.is_empty() or not _chunk_by_id.has(active_chunk_id): return
	var streaming: Dictionary = _chunk_by_id[active_chunk_id].get("streaming", {})
	var prefetch_distance := float(streaming.get("prefetchDistance", 0.0))
	var active_bounds := chunk_bounds(active_chunk_id)
	if prefetch_distance > 0.0 and velocity.length_squared() > 1.0:
		var projected := player_position + velocity.normalized() * prefetch_distance
		if not active_bounds.has_point(projected):
			for neighbor in _adjacency.get(active_chunk_id, []):
				if chunk_bounds(str(neighbor)).grow(prefetch_distance).has_point(projected) and not loaded_chunks.has(str(neighbor)):
					activate_chunk(active_chunk_id, velocity)
	for id in _unload_deadlines.keys():
		var hysteresis := float(_chunk_by_id[id].get("streaming", {}).get("hysteresis", 0.0))
		if chunk_bounds(str(id)).grow(hysteresis).has_point(player_position):
			_unload_deadlines.erase(id)
			_set_chunk_state(str(id), "warm")


func _apply_derived_persistent_state(chunk_node: Node) -> void:
	for object in chunk_node.find_children("*", "CanonicalObject", true, false):
		var derived_consumed := false
		if object.type_id == "abilityPickup":
			derived_consumed = state_store.has_ability(str(object.canonical_properties.get("abilityId", "")))
		elif object.type_id == "stateTrigger" and object.effective_reset_policy() == "persistent" and bool(object.canonical_properties.get("oneUse", true)):
			var set_flag := str(object.canonical_properties.get("setFlag", ""))
			var clear_flag := str(object.canonical_properties.get("clearFlag", ""))
			derived_consumed = (not set_flag.is_empty() and state_store.has_flag(set_flag)) or (not clear_flag.is_empty() and not state_store.has_flag(clear_flag))
		if derived_consumed and object.is_available():
			object.consume_pickup()
			state_store.capture_object(object)


func _index_world() -> void:
	_chunk_by_id = {}
	_region_by_chunk = {}
	_adjacency = {}
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			var id := str(chunk.id)
			_chunk_by_id[id] = chunk
			_region_by_chunk[id] = region
			_adjacency[id] = []
	# Each canonical edge is stored once in its from chunk. Derive the reverse
	# adjacency only for non-one-way edges.
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			for connection in chunk.get("connections", []):
				var from_id := str(connection.get("from", {}).get("chunkId", ""))
				var to_id := str(connection.get("to", {}).get("chunkId", ""))
				if _adjacency.has(from_id) and _adjacency.has(to_id):
					if not _adjacency[from_id].has(to_id): _adjacency[from_id].append(to_id)
					if not bool(connection.get("oneWay", false)) and not _adjacency[to_id].has(from_id): _adjacency[to_id].append(from_id)
	for id in _adjacency: _adjacency[id].sort()


func _schedule_unneeded(needed: Dictionary) -> void:
	for id in loaded_chunks.keys():
		if needed.has(id): continue
		var streaming: Dictionary = _chunk_by_id[id].get("streaming", {})
		if bool(streaming.get("keepAlive", false)):
			_set_chunk_state(id, "keep-alive")
			continue
		_set_chunk_state(id, "warm")
		_unload_deadlines[id] = _elapsed_seconds + float(streaming.get("unloadDelaySeconds", 0.5))


func _directional_candidates(chunk_id: String, velocity: Vector2) -> Array[String]:
	var result: Array[String] = []
	if velocity.length_squared() < 1.0: return result
	var origin := _chunk_center(chunk_id)
	for neighbor in _adjacency.get(chunk_id, []):
		var direction := (_chunk_center(neighbor) - origin).normalized()
		if direction.dot(velocity.normalized()) > 0.35:
			for second_hop in _adjacency.get(neighbor, []):
				if second_hop != chunk_id and not result.has(second_hop): result.append(second_hop)
	return result


func _chunk_center(chunk_id: String) -> Vector2:
	var chunk: Dictionary = _chunk_by_id[chunk_id]
	var region: Dictionary = _region_by_chunk[chunk_id]
	var rt: Dictionary = region.get("transform", {})
	var ct: Dictionary = chunk.get("transform", {})
	var bounds: Dictionary = chunk.get("bounds", {})
	return Vector2(
		float(rt.get("position", {}).get("x", 0.0)) + float(ct.get("position", {}).get("x", 0.0)) + float(bounds.get("x", 0.0)) + float(bounds.get("w", 0.0)) * 0.5,
		float(rt.get("position", {}).get("y", 0.0)) + float(ct.get("position", {}).get("y", 0.0)) + float(bounds.get("y", 0.0)) + float(bounds.get("h", 0.0)) * 0.5
	)


func _set_chunk_state(id: String, state: String) -> void:
	if chunk_states.get(id) == state: return
	chunk_states[id] = state
	if loaded_chunks.has(id):
		var offscreen := str(_chunk_by_id[id].get("statePolicy", {}).get("offscreen", "sleep-local"))
		loaded_chunks[id].process_mode = Node.PROCESS_MODE_INHERIT if state == "active" or offscreen == "simulate" else Node.PROCESS_MODE_DISABLED
	chunk_state_changed.emit(id, state)
	_emit_event("state", id, {"state": state})


func _emit_event(kind: String, chunk_id: String, extra: Dictionary = {}) -> void:
	var event := {"timeUsec": Time.get_ticks_usec(), "kind": kind, "chunkId": chunk_id}
	event.merge(extra, true)
	telemetry_events.append(event)
