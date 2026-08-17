class_name WorldStateStore
extends RefCounted

const SAVE_VERSION := 1

var world_id := ""
var content_hash := ""
var flags: Dictionary = {}
var abilities: Dictionary = {}
var object_states: Dictionary = {}
var checkpoint := {}
var visited_chunks: Dictionary = {}
var _state_definitions: Dictionary = {}
var active_chunk_id := ""
var _world: Dictionary = {}
var _initial_chunk_id := ""
var _chunk_by_id: Dictionary = {}
var _object_chunk_by_id: Dictionary = {}
var _object_policy_by_id: Dictionary = {}
var _checkpoint_state: Dictionary = {}


func configure(world: Dictionary, start_chunk_id := "") -> void:
	_world = world
	world_id = str(world.get("manifest", {}).get("worldId", ""))
	content_hash = str(world.get("manifest", {}).get("contentHash", ""))
	_state_definitions = world.get("stateDefinitions", {}).duplicate(true)
	_index_world(world)
	_initial_chunk_id = start_chunk_id if not start_chunk_id.is_empty() else _first_chunk_id(world)
	active_chunk_id = _initial_chunk_id
	flags = _default_flags(_state_definitions)
	abilities = _starting_abilities(world, active_chunk_id)
	object_states = {}
	checkpoint = {}
	visited_chunks = {}
	_checkpoint_state = {}


func set_flag(key: String, value := true) -> void:
	if key.is_empty(): return
	flags[key] = value


func clear_flag(key: String) -> void:
	if key.is_empty(): return
	flags[key] = false


func has_flag(key: String) -> bool:
	return key.is_empty() or bool(flags.get(key, false))


func unlock_ability(id: String) -> void:
	if not id.is_empty(): abilities[id] = true


func has_ability(id: String) -> bool:
	return id.is_empty() or bool(abilities.get(id, false))


func capture_object(object: CanonicalObject) -> void:
	var state := object.capture_state()
	if state.is_empty():
		object_states.erase(object.object_id)
	else:
		object_states[object.object_id] = state


func set_checkpoint(object: CanonicalObject) -> void:
	var properties := object.canonical_properties
	checkpoint = {
		"id": object.object_id,
		"chunkId": object.chunk_id,
		"position": {
			"x": object.global_position.x + float(properties.get("spawnOffsetX", 0.0)),
			"y": object.global_position.y + float(properties.get("spawnOffsetY", 0.0))
		}
	}
	_checkpoint_state = {
		"flags": flags.duplicate(true),
		"abilities": abilities.duplicate(true),
		"checkpoint": checkpoint.duplicate(true)
	}


func enter_chunk(chunk_id: String, from_chunk_id := "") -> void:
	if chunk_id.is_empty() or not _chunk_by_id.has(chunk_id): return
	var source := from_chunk_id if not from_chunk_id.is_empty() else active_chunk_id
	if not source.is_empty() and source != chunk_id:
		var persistence := _world_persistence(source)
		if not persistence.has("abilities"):
			abilities = _starting_abilities(_world, chunk_id)
		if not persistence.has("flags"):
			flags = _default_flags(_state_definitions)
		if not persistence.has("checkpoint"):
			checkpoint = {}
			_checkpoint_state = {}
		if str(state_policy(source).get("offscreen", "sleep-local")) == "reset-local":
			reset_chunk_local(source)
	active_chunk_id = chunk_id


func state_policy(chunk_id := "") -> Dictionary:
	var resolved_id := chunk_id if not chunk_id.is_empty() else active_chunk_id
	var chunk: Dictionary = _chunk_by_id.get(resolved_id, {})
	return chunk.get("statePolicy", {
		"deathReset": "checkpoint",
		"checkpointReset": "chunk",
		"offscreen": "sleep-local",
		"worldPersistence": []
	})


func world_persists(kind: String, chunk_id := "") -> bool:
	return _world_persistence(chunk_id if not chunk_id.is_empty() else active_chunk_id).has(kind)


func reset_chunk_local(chunk_id: String) -> void:
	for object_id in object_states.keys():
		if str(_object_chunk_by_id.get(object_id, "")) != chunk_id: continue
		if str(_object_policy_by_id.get(object_id, "death")) == "persistent": continue
		object_states.erase(object_id)


func apply_reset_policy(policy: String) -> void:
	var flags_to_reset: Array = []
	if policy == "death":
		flags_to_reset = _state_definitions.get("resetOnDeathFlags", _state_definitions.get("resetOnDeath", []))
	elif policy == "room":
		flags_to_reset = _state_definitions.get("resetOnRoomFlags", _state_definitions.get("resetOnRoom", []))
	var defaults := _default_flags(_state_definitions)
	for key in flags_to_reset:
		flags[str(key)] = bool(defaults.get(str(key), false))
	if policy == "death":
		_apply_chunk_death_policy()
	for object_id in object_states.keys():
		var state: Variant = object_states[object_id]
		if not state is Dictionary: continue
		var reset_policy := str(_object_policy_by_id.get(object_id, state.get("resetPolicy", "death")))
		if reset_policy == "persistent": continue
		if policy == "death" and (reset_policy != "death" or not bool(state.get("resetOnDeath", true))): continue
		if policy not in ["death", "room"]: continue
		object_states.erase(object_id)


func to_dictionary() -> Dictionary:
	var persisted_flags := flags.duplicate(true) if world_persists("flags") else {}
	var persisted_abilities := abilities.duplicate(true) if world_persists("abilities") else {}
	var persisted_checkpoint := checkpoint.duplicate(true) if world_persists("checkpoint") else {}
	return {
		"saveVersion": SAVE_VERSION,
		"worldId": world_id,
		"contentHash": content_hash,
		"flags": persisted_flags,
		"abilities": persisted_abilities,
		"objectStates": object_states.duplicate(true),
		"checkpoint": persisted_checkpoint,
		"checkpointState": _checkpoint_state.duplicate(true) if world_persists("checkpoint") else {},
		"activeChunkId": active_chunk_id,
		"visitedChunks": visited_chunks.keys(),
		"savedAt": Time.get_datetime_string_from_system(true)
	}


func from_dictionary(data: Dictionary, allow_content_mismatch := false) -> Dictionary:
	if int(data.get("saveVersion", 0)) != SAVE_VERSION:
		return {"ok": false, "error": "Unsupported save version"}
	if str(data.get("worldId", "")) != world_id:
		return {"ok": false, "error": "Save belongs to a different world"}
	if not allow_content_mismatch and str(data.get("contentHash", "")) != content_hash:
		return {"ok": false, "error": "Save contentHash does not match the current world"}
	if world_persists("flags"):
		flags.merge(data.get("flags", {}), true)
	if world_persists("abilities"):
		abilities.merge(data.get("abilities", {}), true)
	object_states = data.get("objectStates", {}).duplicate(true)
	checkpoint = data.get("checkpoint", {}).duplicate(true) if world_persists("checkpoint") else {}
	_checkpoint_state = data.get("checkpointState", {}).duplicate(true) if world_persists("checkpoint") else {}
	visited_chunks = {}
	for id in data.get("visitedChunks", []): visited_chunks[str(id)] = true
	return {"ok": true}


func save_to_disk(slot := "autosave") -> Dictionary:
	return CablesterFileUtils.write_json_atomic("user://saves/%s-%s.json" % [_safe(world_id), _safe(slot)], to_dictionary())


func load_from_disk(slot := "autosave") -> Dictionary:
	var result := CablesterFileUtils.read_json("user://saves/%s-%s.json" % [_safe(world_id), _safe(slot)])
	if not result.ok: return result
	return from_dictionary(result.data)


func _default_flags(definitions: Dictionary) -> Dictionary:
	var result := {}
	var values: Variant = definitions.get("flags", definitions.get("defaults", {}))
	if values is Dictionary:
		for key in values:
			var definition: Variant = values[key]
			result[str(key)] = bool(definition.get("default", false)) if definition is Dictionary else bool(definition)
	elif values is Array:
		for item in values:
			if item is Dictionary:
				result[str(item.get("id", ""))] = bool(item.get("initialValue", item.get("default", false)))
			else:
				result[str(item)] = false
	return result


func _starting_abilities(world: Dictionary, start_chunk_id: String) -> Dictionary:
	var result := {}
	var starting: Variant = []
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			if str(chunk.get("id", "")) == start_chunk_id:
				starting = chunk.get("gameplay", {}).get("startingAbilities", [])
				break
		if not (starting as Array).is_empty(): break
	# In-memory unit fixtures and legacy migrated packages may still carry an
	# approved/root fallback. Canonical v3 formal/labs always resolves by spawn chunk.
	if starting is Array and starting.is_empty():
		var approved: Dictionary = world.get("gameplayTuning", {}).get("approved", {})
		starting = approved.get("startingAbilities", world.get("startingAbilities", []))
	if starting is Array:
		for id in starting: result[str(id)] = true
	elif starting is Dictionary:
		for id in starting: result[str(id)] = bool(starting[id])
	return result


func _apply_chunk_death_policy() -> void:
	var policy := state_policy()
	var scope := str(policy.get("deathReset", "checkpoint"))
	var persistence := _world_persistence(active_chunk_id)
	if scope == "checkpoint" and not _checkpoint_state.is_empty():
		if not persistence.has("flags"): flags = _checkpoint_state.get("flags", _default_flags(_state_definitions)).duplicate(true)
		if not persistence.has("abilities"): abilities = _checkpoint_state.get("abilities", _starting_abilities(_world, active_chunk_id)).duplicate(true)
		if not persistence.has("checkpoint"): checkpoint = _checkpoint_state.get("checkpoint", checkpoint).duplicate(true)
	elif scope in ["chunk", "world"]:
		if not persistence.has("flags"): flags = _default_flags(_state_definitions)
		if not persistence.has("abilities"): abilities = _starting_abilities(_world, active_chunk_id if scope == "chunk" else _initial_chunk_id)
		if not persistence.has("checkpoint"): checkpoint = {}
	if scope == "chunk":
		reset_chunk_local(active_chunk_id)
	elif scope == "world":
		for object_id in object_states.keys():
			if str(_object_policy_by_id.get(object_id, "death")) != "persistent": object_states.erase(object_id)


func _world_persistence(chunk_id: String) -> Array:
	var policy := state_policy(chunk_id)
	var value: Variant = policy.get("worldPersistence", [])
	return value if value is Array else []


func _index_world(world: Dictionary) -> void:
	_chunk_by_id = {}
	_object_chunk_by_id = {}
	_object_policy_by_id = {}
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			var chunk_id := str(chunk.get("id", ""))
			_chunk_by_id[chunk_id] = chunk
			for object in chunk.get("objects", []):
				var object_id := str(object.get("id", ""))
				_object_chunk_by_id[object_id] = chunk_id
				_object_policy_by_id[object_id] = _effective_object_policy(object)


func _effective_object_policy(object: Dictionary) -> String:
	var tags: Array = object.get("tags", [])
	var properties: Dictionary = object.get("properties", {})
	if tags.has("persistent-state") or str(object.get("type", "")) == "abilityPickup": return "persistent"
	var explicit := str(properties.get("resetPolicy", ""))
	if explicit in ["death", "room", "persistent"]: return explicit
	return "room" if not bool(properties.get("resetOnDeath", true)) else "death"


func _first_chunk_id(world: Dictionary) -> String:
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			if chunk.get("tags", []).has("start"): return str(chunk.get("id", ""))
	for region in world.get("regions", []):
		if not region.get("chunks", []).is_empty(): return str(region.chunks[0].get("id", ""))
	return ""


func _safe(value: String) -> String:
	return value.to_lower().replace("/", "-").replace(":", "-").replace(" ", "-")
