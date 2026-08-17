class_name RuntimeTelemetry
extends RefCounted

const TELEMETRY_VERSION := 1

var world_id := ""
var content_hash := ""
var gameplay_tuning_version := ""
var replay_path := ""
var started_usec := 0
var frame_times_usec: Array[float] = []
var physics_times_usec: Array[float] = []
var trajectory: Array = []
var chunk_events: Array = []
var target_state := {
	"ropeTargets": [], "hardBarTargets": [], "bashTargets": [],
	"dashTicks": [], "doubleJumpTicks": [], "glideTicks": [], "windZoneTicks": [],
	"hazardDamageTicks": [], "deathTicks": []
}
var counters := {
	"physicsTicks": 0,
	"chunkLoads": 0,
	"chunkUnloads": 0,
	"checkpoints": 0,
	"deaths": 0,
	"exits": 0
}
var _last_frame_usec := 0
var _previous_dash_charges := 0
var _previous_air_jumps := 0
var _previous_health := 0.0


func begin(world: Dictionary, source_replay := "") -> void:
	world_id = str(world.get("manifest", {}).get("worldId", ""))
	content_hash = str(world.get("manifest", {}).get("contentHash", ""))
	gameplay_tuning_version = str(world.get("manifest", {}).get("gameplayTuningVersion", ""))
	replay_path = source_replay
	started_usec = Time.get_ticks_usec()
	_last_frame_usec = started_usec
	frame_times_usec = []
	physics_times_usec = []
	trajectory = []
	chunk_events = []
	target_state = {
		"ropeTargets": [], "hardBarTargets": [], "bashTargets": [],
		"dashTicks": [], "doubleJumpTicks": [], "glideTicks": [], "windZoneTicks": [],
		"hazardDamageTicks": [], "deathTicks": []
	}
	_previous_dash_charges = 0
	_previous_air_jumps = 0
	_previous_health = 0.0
	counters = {"physicsTicks": 0, "chunkLoads": 0, "chunkUnloads": 0, "checkpoints": 0, "deaths": 0, "exits": 0}


func sample_frame() -> void:
	var now := Time.get_ticks_usec()
	frame_times_usec.append(float(now - _last_frame_usec))
	_last_frame_usec = now


func sample_physics(tick: int, player: CablesterPlayer, chunk_id: String, elapsed_usec: int) -> void:
	physics_times_usec.append(float(elapsed_usec))
	counters.physicsTicks = int(counters.physicsTicks) + 1
	if not player.attached_target_id.is_empty():
		var target_key := "hardBarTargets" if player.attached_mode == "hardBar" else "ropeTargets"
		if not target_state[target_key].has(player.attached_target_id): target_state[target_key].append(player.attached_target_id)
	if not player.bash_target_id.is_empty() and not target_state.bashTargets.has(player.bash_target_id):
		target_state.bashTargets.append(player.bash_target_id)
	if int(counters.physicsTicks) > 1:
		if player.dash_charges < _previous_dash_charges: target_state.dashTicks.append(tick)
		if player.air_jumps < _previous_air_jumps and player.state_store.has_ability("doubleJump"): target_state.doubleJumpTicks.append(tick)
		if player.health < _previous_health: target_state.hazardDamageTicks.append(tick)
	if player.gliding:
		target_state.glideTicks.append(tick)
	if not player._zones("windZone").is_empty(): target_state.windZoneTicks.append(tick)
	_previous_dash_charges = player.dash_charges
	_previous_air_jumps = player.air_jumps
	_previous_health = player.health
	# 20 Hz trajectory at 120 Hz physics keeps diagnostics compact.
	if tick % 6 == 0:
		trajectory.append({
			"tick": tick,
			"timeSeconds": tick / 120.0,
			"chunkId": chunk_id,
			"position": {"x": _round(player.global_position.x), "y": _round(player.global_position.y)},
			"velocity": {"x": _round(player.velocity.x), "y": _round(player.velocity.y)},
			"health": _round(player.health),
			"energy": _round(player.energy),
			"dashCharges": player.dash_charges,
			"attachedMode": player.attached_mode,
			"ropePhase": player.rope_phase,
			"attachmentTargetId": player.attached_target_id,
			"attachmentLength": _round(player.attachment_length) if not player.attached_target_id.is_empty() else 0,
			"bashTargetId": player.bash_target_id
		})


func absorb_chunk_events(streamer: ChunkStreamer) -> void:
	for event in streamer.telemetry_events:
		chunk_events.append(event.duplicate(true))
		if event.kind == "load": counters.chunkLoads = int(counters.chunkLoads) + 1
		elif event.kind == "unload": counters.chunkUnloads = int(counters.chunkUnloads) + 1
	streamer.telemetry_events.clear()


func record_death(tick: int) -> void:
	target_state.deathTicks.append(tick)


func finish(state_store: WorldStateStore, streamer: ChunkStreamer, player: CablesterPlayer, expectations: Dictionary = {}) -> Dictionary:
	absorb_chunk_events(streamer)
	var finished_usec := Time.get_ticks_usec()
	# A save dictionary intentionally drops abilities/flags/checkpoints when the
	# active chunk's worldPersistence policy excludes them.  Replay finalState is
	# an observation of the live runtime, not a save-file projection, so preserve
	# both representations explicitly.
	var persisted_state := state_store.to_dictionary()
	var runtime_state := persisted_state.duplicate(true)
	runtime_state.flags = state_store.flags.duplicate(true)
	runtime_state.abilities = state_store.abilities.duplicate(true)
	runtime_state.objectStates = state_store.object_states.duplicate(true)
	runtime_state.checkpoint = state_store.checkpoint.duplicate(true)
	runtime_state.activeChunkId = state_store.active_chunk_id
	runtime_state.visitedChunks = state_store.visited_chunks.keys()
	var visited: Array = state_store.visited_chunks.keys()
	visited.sort()
	var final_player := {
		"position": {"x": _round(player.global_position.x), "y": _round(player.global_position.y)},
		"velocity": {"x": _round(player.velocity.x), "y": _round(player.velocity.y)},
		"health": _round(player.health),
		"energy": _round(player.energy),
		"dashCharges": player.dash_charges,
		"maximumDashCharges": player.maximum_dash_charges,
		"airJumps": player.air_jumps,
		"attachedMode": player.attached_mode,
		"ropePhase": player.rope_phase,
		"attachmentTargetId": player.attached_target_id,
		"attachmentLength": _round(player.attachment_length) if not player.attached_target_id.is_empty() else 0,
		"bashTargetId": player.bash_target_id,
		"checkpointId": player.current_checkpoint_id,
		"gravityDirection": {"x": _round(player.gravity_direction.x), "y": _round(player.gravity_direction.y)}
	}
	final_player.visualState = player.visual_state.snapshot()
	for key in target_state: target_state[key].sort()
	return {
		"telemetryVersion": TELEMETRY_VERSION,
		"worldId": world_id,
		"sourceContentHash": content_hash,
		"gameplayTuningVersion": gameplay_tuning_version,
		"godotBuildId": CablesterFileUtils.godot_build_id(),
		"replayPath": replay_path,
		"fixedPhysicsHz": Engine.physics_ticks_per_second,
		"startedAtUsec": started_usec,
		"durationSeconds": (finished_usec - started_usec) / 1000000.0,
		"performance": {
			"frameTimeP50Ms": _percentile(frame_times_usec, 0.50) / 1000.0,
			"frameTimeP95Ms": _percentile(frame_times_usec, 0.95) / 1000.0,
			"frameTimeP99Ms": _percentile(frame_times_usec, 0.99) / 1000.0,
			"physicsTimeP50Ms": _percentile(physics_times_usec, 0.50) / 1000.0,
			"physicsTimeP95Ms": _percentile(physics_times_usec, 0.95) / 1000.0,
			"physicsTimeP99Ms": _percentile(physics_times_usec, 0.99) / 1000.0,
			"loadedChunkCount": streamer.loaded_chunks.size(),
			"estimatedMemoryBytes": streamer.memory_estimate_bytes()
		},
		"counters": counters.duplicate(true),
		"trajectory": trajectory.duplicate(true),
		"targetState": target_state.duplicate(true),
		"chunkEvents": chunk_events.duplicate(true),
		"visitedChunks": visited,
		"deaths": int(counters.deaths),
		"finalPosition": final_player.position.duplicate(true),
		"finalResources": {
			"health": final_player.health, "energy": final_player.energy,
			"dashCharges": final_player.dashCharges, "airJumps": final_player.airJumps
		},
		"finalPlayer": final_player,
		"finalState": runtime_state,
		"persistedState": persisted_state,
		"expectations": expectations.duplicate(true)
	}


func _percentile(values: Array[float], percentile: float) -> float:
	if values.is_empty(): return 0.0
	var sorted := values.duplicate()
	sorted.sort()
	var index := clampi(int(ceil(percentile * sorted.size())) - 1, 0, sorted.size() - 1)
	return sorted[index]


func _round(value: float) -> Variant:
	var rounded := snappedf(value, 0.000001)
	return int(rounded) if rounded == floor(rounded) else rounded
