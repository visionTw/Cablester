class_name WorldRuntime
extends Node

signal world_ready
signal replay_finished(result: Dictionary)

const RUNTIME_HUD_SCRIPT := preload("res://godot/runtime/runtime_hud.gd")
const PHYSICS_RULES := preload("res://godot/runtime/player_physics_rules.gd")

var world: Dictionary = {}
var source_path := ""
var importer := WorldImporter.new()
var state_store := WorldStateStore.new()
var streamer: ChunkStreamer
var player: CablesterPlayer
var telemetry := RuntimeTelemetry.new()
var replay_runner: ReplayRunner
var tick := 0
var last_exit_id := ""
var completed_goal_id := ""
var replay_done := false
var traversed_edges: Array = []
var replay_wall_timeout_msec := 30000
var _replay_wall_started_msec := 0
var _last_stream_position := Vector2.ZERO
var runtime_start_chunk_id := ""
var follow_camera: Camera2D
var runtime_hud: CanvasLayer
var respawn_chunk_id := ""
var _chunk_aabbs: Dictionary = {}
var _chunk_recovery_bands: Dictionary = {}
var _outside_world_ticks := 0
var _bounds_death_latched := false
var replay_input_tick := -1
var _physics_sample_pending := false
var _physics_sample_started_usec := 0
var _camera_rotation_from := 0.0
var _camera_rotation_to := 0.0
var _camera_rotation_elapsed := 0.0
var _camera_rotation_active := false


func _init() -> void:
	# Replay input must be injected before CablesterPlayer's physics callback.
	# Lower priorities execute first in Godot; the player is configured at -10.
	process_physics_priority = -20


func load_world(path: String, options: Dictionary = {}) -> Dictionary:
	var loaded := CablesterFileUtils.read_json(path)
	if not loaded.ok: return loaded
	world = loaded.data
	source_path = path
	var import_result := importer.import_world(world, path, options)
	if not import_result.ok: return import_result
	runtime_start_chunk_id = str(options.get("startChunkId", _initial_chunk_id()))
	var configured_start_chunk := runtime_start_chunk_id
	state_store.configure(world, configured_start_chunk)
	_index_resolved_chunk_bounds(import_result.snapshot)
	var save_load := {"requested": bool(options.get("loadSave", false)), "loaded": false, "checkpointRestored": false}
	if bool(options.get("loadSave", false)):
		var loaded_save := state_store.load_from_disk(str(options.get("saveSlot", "autosave")))
		save_load.loaded = bool(loaded_save.ok)
		if loaded_save.ok and not state_store.checkpoint.is_empty():
			if _checkpoint_is_valid(state_store.checkpoint):
				runtime_start_chunk_id = str(state_store.checkpoint.chunkId)
				save_load.checkpointRestored = true
			else:
				save_load.checkpointRejected = true
				state_store.checkpoint = {}
		elif not loaded_save.ok:
			save_load.error = str(loaded_save.get("error", "Save could not be loaded"))
	_build_runtime()
	telemetry.begin(world)
	import_result.saveLoad = save_load
	world_ready.emit()
	return import_result


func run_replay(replay_path: String, options: Dictionary = {}) -> Dictionary:
	var replay_data := CablesterFileUtils.read_json(replay_path)
	if not replay_data.ok: return replay_data
	var world_path := str(options.get("worldPath", _find_world_path(str(replay_data.data.get("worldId", "")))))
	if world_path.is_empty(): return {"ok": false, "error": "Cannot find canonical world for replay %s" % replay_path}
	var replay_options := options.duplicate(true)
	replay_options.startChunkId = str(replay_data.data.get("spawn", {}).get("chunkId", ""))
	var import_result := load_world(world_path, replay_options)
	if not import_result.ok: return import_result
	replay_runner = ReplayRunner.new()
	var configured := replay_runner.configure(replay_data.data, world)
	if not configured.ok: return configured
	telemetry.begin(world, replay_path)
	var spawn := replay_runner.spawn()
	if not str(spawn.get("chunkId", "")).is_empty():
		streamer.activate_chunk(str(spawn.chunkId))
	_spawn_player(spawn, true)
	tick = 0
	replay_input_tick = -1
	replay_done = false
	traversed_edges = []
	_replay_wall_started_msec = Time.get_ticks_msec()
	replay_wall_timeout_msec = maxi(1000, int(float(options.get("wallTimeoutSeconds", 30.0)) * 1000.0))
	return {"ok": true, "worldPath": world_path, "maximumTick": replay_runner.maximum_tick}


func finish_telemetry(expectations: Dictionary = {}, evidence_slug := "") -> Dictionary:
	var result := telemetry.finish(state_store, streamer, player, expectations)
	var latest_path: String = (
		"user://acceptance-artifacts/%s.telemetry.json" % str(world.manifest.worldId).validate_filename()
		if OS.has_feature("template")
		else importer.artifact_paths(str(world.manifest.worldId)).telemetry
	)
	var evidence_path := latest_path
	var replay_slug := str(evidence_slug).validate_filename().to_lower()
	if replay_slug.is_empty() and not telemetry.replay_path.is_empty():
		replay_slug = telemetry.replay_path.get_file().trim_suffix(".replay.json").trim_suffix(".json").validate_filename().to_lower()
	if not replay_slug.is_empty():
		evidence_path = latest_path.get_base_dir().path_join("%s.%s.telemetry.json" % [str(world.manifest.worldId).validate_filename(), replay_slug])
	result.telemetryPath = evidence_path
	result.latestTelemetryPath = latest_path
	result.replaySlug = replay_slug
	var evidence_write := CablesterFileUtils.write_json_atomic(evidence_path, result)
	var latest_write := evidence_write if evidence_path == latest_path else CablesterFileUtils.write_json_atomic(latest_path, result)
	result.writeOk = bool(evidence_write.ok) and bool(latest_write.ok)
	return result


func _build_runtime() -> void:
	for child in get_children(): child.queue_free()
	streamer = ChunkStreamer.new()
	streamer.name = "ChunkStreamer"
	add_child(streamer)
	streamer.configure(world, importer, state_store)
	player = CablesterPlayer.new()
	player.name = "Player"
	player.process_physics_priority = -10
	add_child(player)
	player.configure(streamer, state_store, world.get("gameplayTuning", {}).get("approved", {}), world)
	player.died.connect(_on_player_died)
	player.death_started.connect(_on_player_death_started)
	player.checkpoint_activated.connect(_on_checkpoint)
	player.exit_reached.connect(_on_exit)
	player.state_changed.connect(_on_state_changed)
	player.physics_step_completed.connect(_after_player_physics)
	player.rotation_requested.connect(_on_rotation_requested)
	follow_camera = Camera2D.new()
	follow_camera.name = "FollowCamera"
	follow_camera.enabled = true
	follow_camera.position_smoothing_enabled = false
	add_child(follow_camera)
	runtime_hud = RUNTIME_HUD_SCRIPT.new()
	runtime_hud.name = "RuntimeHUD"
	add_child(runtime_hud)
	runtime_hud.configure(self)
	var initial_chunk := runtime_start_chunk_id if not runtime_start_chunk_id.is_empty() else _initial_chunk_id()
	if not initial_chunk.is_empty(): streamer.activate_chunk(initial_chunk)
	if _checkpoint_is_valid(state_store.checkpoint):
		_spawn_player({
			"chunkId": str(state_store.checkpoint.chunkId),
			"checkpointId": str(state_store.checkpoint.id),
			"position": state_store.checkpoint.position.duplicate(true)
		}, true)
	else:
		_spawn_player({"chunkId": initial_chunk}, true)
	follow_camera.global_position = player.global_position
	follow_camera.rotation = 0.0
	_camera_rotation_active = false
	_last_stream_position = player.global_position
	_outside_world_ticks = 0
	_bounds_death_latched = false


func _physics_process(delta: float) -> void:
	_physics_sample_pending = false
	if player == null or streamer == null: return
	if _replay_watchdog_expired():
		_replay_timeout()
		return
	_physics_sample_started_usec = Time.get_ticks_usec()
	_update_camera_and_rotation(delta)
	if replay_runner and not replay_done:
		# Completion happens on the callback *after* maximumTick, so the player can
		# consume that final held frame later in this same physics step.
		if tick > replay_runner.maximum_tick:
			_replay_complete()
			return
		var input := replay_runner.input_for_tick(tick)
		player.set_input_frame(input.actions, input.aim)
		replay_input_tick = tick
	_enforce_world_bounds()
	streamer.update_streaming_context(player.global_position, player.velocity)
	_physics_sample_pending = true


func _after_player_physics() -> void:
	if not _physics_sample_pending or player == null or streamer == null: return
	_physics_sample_pending = false
	telemetry.sample_physics(tick, player, streamer.active_chunk_id, Time.get_ticks_usec() - _physics_sample_started_usec)
	telemetry.absorb_chunk_events(streamer)
	if tick % 12 == 0: _last_stream_position = player.global_position
	tick += 1


func _process(_delta: float) -> void:
	if _replay_watchdog_expired():
		_replay_timeout()
		return
	if player: telemetry.sample_frame()


func _update_camera_and_rotation(delta: float) -> void:
	if player == null or follow_camera == null: return
	if _camera_rotation_active:
		var rotated := PHYSICS_RULES.rotation_step(_camera_rotation_from, _camera_rotation_to, _camera_rotation_elapsed, delta, world.get("gameplayTuning", {}).get("approved", {}))
		follow_camera.rotation = float(rotated.angle)
		_camera_rotation_elapsed = float(rotated.elapsed)
		_camera_rotation_active = not bool(rotated.complete)
		if not _camera_rotation_active: follow_camera.rotation = _camera_rotation_to
	player.gravity_direction = PHYSICS_RULES.gravity_for_camera_angle(follow_camera.rotation)
	var follow := PHYSICS_RULES.camera_follow_step(
		follow_camera.global_position, player.global_position, player.velocity,
		_camera_rotation_active, delta, world.get("gameplayTuning", {}).get("approved", {})
	)
	follow_camera.global_position = follow.position


func _on_rotation_requested(delta_radians: float) -> void:
	if follow_camera == null or _camera_rotation_active: return
	_camera_rotation_from = follow_camera.rotation
	_camera_rotation_to = follow_camera.rotation + delta_radians
	_camera_rotation_elapsed = 0.0
	_camera_rotation_active = true


func _spawn_player(spawn: Dictionary, establish_respawn := false) -> void:
	var entrance_id := str(spawn.get("entranceId", ""))
	var chunk_id := str(spawn.get("chunkId", streamer.active_chunk_id if streamer else ""))
	var spawn_position: Variant = spawn.get("position")
	if spawn_position is Dictionary:
		player.global_position = Vector2(float(spawn_position.get("x", 0.0)), float(spawn_position.get("y", 0.0)))
	else:
		var candidate: CanonicalObject
		var candidates: Array = []
		var chunk_node: Node = streamer.loaded_chunks.get(chunk_id) if streamer else null
		if chunk_node: candidates = chunk_node.find_children("*", "CanonicalObject", true, false)
		for object in candidates:
			if not entrance_id.is_empty() and object.object_id == entrance_id:
				candidate = object
				break
			if candidate == null and object.chunk_id == chunk_id and object.type_id == "spawn": candidate = object
			if candidate == null and object.chunk_id == chunk_id and object.type_id == "roomEntrance": candidate = object
		if candidate:
			var p := candidate.canonical_properties
			player.global_position = candidate.global_position + Vector2(float(p.get("spawnOffsetX", 0.0)), float(p.get("spawnOffsetY", 0.0)))
	if establish_respawn:
		player.checkpoint_position = player.global_position
		player.current_checkpoint_id = str(spawn.get("checkpointId", ""))
		respawn_chunk_id = chunk_id
	player.velocity = Vector2.ZERO
	player.exit_contact_cooldown = 0.35
	if follow_camera:
		follow_camera.global_position = player.global_position


func _on_player_death_started() -> void:
	telemetry.counters.deaths = int(telemetry.counters.deaths) + 1
	telemetry.record_death(replay_input_tick if replay_input_tick >= 0 else tick)


func _on_player_died() -> void:
	state_store.apply_reset_policy("death")
	streamer.reset_loaded_objects("death")
	var target_chunk := str(state_store.checkpoint.get("chunkId", respawn_chunk_id))
	if not target_chunk.is_empty() and _has_chunk(target_chunk):
		streamer.activate_chunk(target_chunk)
		respawn_chunk_id = target_chunk
	if _checkpoint_is_valid(state_store.checkpoint):
		player.global_position = Vector2(float(state_store.checkpoint.position.x), float(state_store.checkpoint.position.y))
		player.checkpoint_position = player.global_position
		player.current_checkpoint_id = str(state_store.checkpoint.id)
	_outside_world_ticks = 0


func _on_checkpoint(object: CanonicalObject) -> void:
	telemetry.counters.checkpoints = int(telemetry.counters.checkpoints) + 1
	respawn_chunk_id = object.chunk_id
	state_store.save_to_disk("autosave")


func _on_exit(object: CanonicalObject) -> void:
	last_exit_id = object.object_id
	if object.type_id == "goal": completed_goal_id = object.object_id
	telemetry.counters.exits = int(telemetry.counters.exits) + 1
	var target_chunk := str(object.canonical_properties.get("targetChunkId", object.canonical_properties.get("targetRoomId", "")))
	var connection := _connection_for_exit(object, target_chunk)
	traversed_edges.append({
		"tick": replay_input_tick if replay_input_tick >= 0 else tick,
		"edgeId": str(connection.get("id", "goal:%s" % object.object_id if object.type_id == "goal" else "")),
		"exitId": object.object_id,
		"fromChunkId": object.chunk_id,
		"toChunkId": target_chunk,
		"reverse": bool(connection.get("reverse", false))
	})
	if not target_chunk.is_empty() and _has_chunk(target_chunk):
		state_store.apply_reset_policy("room")
		streamer.reset_loaded_objects("room")
		streamer.activate_chunk(target_chunk, player.velocity)
		_spawn_player({"chunkId": target_chunk, "entranceId": str(object.canonical_properties.get("targetEntranceId", ""))}, false)


func _on_state_changed() -> void:
	state_store.save_to_disk("autosave")


func _replay_complete() -> void:
	replay_done = true
	player.clear_replay_input()
	var expectation_errors := replay_runner.check_expectations(self)
	var result := finish_telemetry(replay_runner.expectations())
	result.ok = expectation_errors.is_empty()
	result.expectationErrors = expectation_errors
	result.finalPosition = result.get("finalPlayer", {}).get("position", {}).duplicate(true)
	result.resources = result.get("finalResources", {}).duplicate(true)
	result.state = result.get("finalState", {}).duplicate(true)
	result.visitedChunks = result.get("visitedChunks", []).duplicate()
	result.deaths = int(result.get("deaths", 0))
	result.traversedEdges = traversed_edges.duplicate(true)
	replay_finished.emit(result)


func _replay_watchdog_expired() -> bool:
	return replay_runner != null and not replay_done and _replay_wall_started_msec > 0 and Time.get_ticks_msec() - _replay_wall_started_msec > replay_wall_timeout_msec


func _replay_timeout() -> void:
	if replay_done: return
	replay_done = true
	player.clear_replay_input()
	var result := finish_telemetry(replay_runner.expectations())
	result.ok = false
	result.watchdogTimedOut = true
	result.expectationErrors = ["Replay wall-clock watchdog exceeded %.3f seconds at tick %d/%d" % [replay_wall_timeout_msec / 1000.0, tick, replay_runner.maximum_tick]]
	result.traversedEdges = traversed_edges.duplicate(true)
	replay_finished.emit(result)


func _initial_chunk_id() -> String:
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			if chunk.get("tags", []).has("start"): return str(chunk.id)
	for region in world.get("regions", []):
		if not region.get("chunks", []).is_empty(): return str(region.chunks[0].id)
	return ""


func _chunk_containing_point(point: Vector2) -> String:
	if not is_finite(point.x) or not is_finite(point.y): return ""
	if streamer and _chunk_aabbs.has(streamer.active_chunk_id):
		var active_bounds: Rect2 = _chunk_aabbs[streamer.active_chunk_id]
		if active_bounds.grow(0.5).has_point(point): return streamer.active_chunk_id
	var ids: Array = _chunk_aabbs.keys()
	ids.sort()
	for chunk_id in ids:
		var rect: Rect2 = _chunk_aabbs[chunk_id]
		if rect.grow(0.5).has_point(point): return str(chunk_id)
	return ""


func _enforce_world_bounds() -> void:
	if _chunk_aabbs.is_empty(): return
	if _bounds_death_latched: return
	var containing := _chunk_containing_point(player.global_position)
	# `fall-recovery` floors are deliberately collidable so a missed jump cannot
	# escape the physics world. They are not playable platforms: once the player
	# capsule reaches the recovery band, respawn immediately instead of leaving
	# it trapped in the narrow corridor below the authored route.
	if not containing.is_empty() and _in_recovery_band(containing, player.global_position):
		_trigger_bounds_death()
		return
	var legal_chunk := not containing.is_empty() and (
		streamer.active_chunk_id.is_empty() or streamer.chunks_are_adjacent(streamer.active_chunk_id, containing)
	)
	if legal_chunk:
		_outside_world_ticks = 0
		if containing != streamer.active_chunk_id:
			streamer.activate_chunk(containing, player.global_position - _last_stream_position)
		return
	_outside_world_ticks += 1
	# A one-tick grace tolerates an exact connection seam while still making a
	# fall or invalid non-adjacent teleport deterministic at 120 Hz.
	if _outside_world_ticks < 2 and not containing.is_empty(): return
	_trigger_bounds_death()


func _index_resolved_chunk_bounds(snapshot: Dictionary) -> void:
	_chunk_aabbs = {}
	_chunk_recovery_bands = {}
	for region in snapshot.get("regions", []):
		for chunk in region.get("chunks", []):
			var aabb: Dictionary = chunk.get("aabb", {})
			_chunk_aabbs[str(chunk.id)] = Rect2(
				Vector2(float(aabb.get("x", 0.0)), float(aabb.get("y", 0.0))),
				Vector2(float(aabb.get("w", 0.0)), float(aabb.get("h", 0.0)))
			).abs()
			for object in chunk.get("objects", []):
				if str(object.get("type", "")) != "boundaryWall" or not object.get("tags", []).has("fall-recovery"):
					continue
				var collision: Dictionary = object.get("collisionBounds", {})
				var band := Rect2(
					Vector2(float(collision.get("x", 0.0)), float(collision.get("y", 0.0))),
					Vector2(float(collision.get("w", 0.0)), float(collision.get("h", 0.0)))
				).abs()
				if band.size.x > 0.0 and band.size.y > 0.0:
					_chunk_recovery_bands[str(chunk.id)] = band


func _in_recovery_band(chunk_id: String, point: Vector2) -> bool:
	if not _chunk_recovery_bands.has(chunk_id): return false
	var band: Rect2 = _chunk_recovery_bands[chunk_id]
	# The capsule enters the death band when its lower edge reaches the authored
	# recovery-floor top. Horizontal growth covers boundary contact precisely.
	# Godot keeps a small collision-safe margin (~0.07 px in the formal scene),
	# so include a sub-pixel tolerance or a resting capsule would never enter.
	return point.y + player.radius + 0.5 >= band.position.y and point.x >= band.position.x - player.radius and point.x <= band.end.x + player.radius


func _trigger_bounds_death() -> void:
	_bounds_death_latched = true
	player.begin_respawn()
	_bounds_death_latched = false


func _checkpoint_is_valid(value: Dictionary) -> bool:
	if value.is_empty() or not value.get("position") is Dictionary: return false
	var chunk_id := str(value.get("chunkId", ""))
	var id := str(value.get("id", ""))
	var position: Dictionary = value.position
	if chunk_id.is_empty() or id.is_empty() or not _chunk_aabbs.has(chunk_id): return false
	if not (position.get("x") is int or position.get("x") is float) or not (position.get("y") is int or position.get("y") is float): return false
	var point := Vector2(float(position.x), float(position.y))
	if not is_finite(point.x) or not is_finite(point.y) or not (_chunk_aabbs[chunk_id] as Rect2).grow(0.5).has_point(point): return false
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			if str(chunk.id) != chunk_id: continue
			for object in chunk.get("objects", []):
				if str(object.id) == id and str(object.type) == "checkpoint": return true
	return false


func _has_chunk(id: String) -> bool:
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			if str(chunk.id) == id: return true
	return false


func _connection_for_exit(object: CanonicalObject, target_chunk: String) -> Dictionary:
	if target_chunk.is_empty(): return {}
	var target_entrance := str(object.canonical_properties.get("targetEntranceId", ""))
	for region in world.get("regions", []):
		for chunk in region.get("chunks", []):
			for connection in chunk.get("connections", []):
				var from: Dictionary = connection.get("from", {})
				var to: Dictionary = connection.get("to", {})
				var forward := str(from.get("chunkId", "")) == object.chunk_id and str(to.get("chunkId", "")) == target_chunk
				var reverse := not bool(connection.get("oneWay", false)) and str(to.get("chunkId", "")) == object.chunk_id and str(from.get("chunkId", "")) == target_chunk
				if not forward and not reverse: continue
				var endpoint: Dictionary = to if forward else from
				if target_entrance.is_empty() or str(endpoint.get("entranceId", "")) == target_entrance:
					var resolved: Dictionary = connection.duplicate(true)
					resolved.reverse = reverse
					return resolved
	return {}


func _find_world_path(world_id: String) -> String:
	for directory in ["worlds/formal", "worlds/labs"]:
		for path in CablesterFileUtils.list_json_files(directory, ".world.json"):
			var loaded := CablesterFileUtils.read_json(path)
			if loaded.ok and str(loaded.data.get("manifest", {}).get("worldId", "")) == world_id:
				return path
	return ""
