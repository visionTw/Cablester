class_name ReplayRunner
extends RefCounted

const REPLAY_VERSION := 1
const ACTIONS := ["move_left", "move_right", "move_up", "move_down", "jump", "dash", "rope", "hard_bar", "bash", "grab", "reset"]

var replay: Dictionary = {}
var frames: Array = []
var current_actions: Dictionary = {}
var current_aim := Vector2.ZERO
var next_frame_index := 0
var maximum_tick := 0
var validation_errors: Array[String] = []


func load_file(path: String, world: Dictionary) -> Dictionary:
	var loaded := CablesterFileUtils.read_json(path)
	if not loaded.ok: return loaded
	return configure(loaded.data, world)


func configure(data: Dictionary, world: Dictionary) -> Dictionary:
	replay = data.duplicate(true)
	validation_errors = []
	if int(replay.get("replayVersion", 0)) != REPLAY_VERSION:
		validation_errors.append("replayVersion must be 1")
	if str(replay.get("worldId", "")) != str(world.get("manifest", {}).get("worldId", "")):
		validation_errors.append("Replay worldId does not match the imported world")
	if str(replay.get("contentHash", "")) != str(world.get("manifest", {}).get("contentHash", "")):
		validation_errors.append("Replay contentHash does not match the imported world")
	if str(replay.get("gameplayTuningVersion", "")) != str(world.get("manifest", {}).get("gameplayTuningVersion", "")):
		validation_errors.append("Replay gameplayTuningVersion does not match the imported world")
	var fixed_delta := float(replay.get("fixedDelta", 0.0))
	if absf(fixed_delta - 1.0 / 120.0) > 0.0000001:
		validation_errors.append("Replay fixedDelta must equal 1/120")
	if not replay.get("frames") is Array:
		validation_errors.append("Replay frames must be an array")
		frames = []
	else:
		frames = replay.frames.duplicate(true)
	var prior_tick := -1
	for index in frames.size():
		var frame: Variant = frames[index]
		if not frame is Dictionary:
			validation_errors.append("frames[%d] must be an object" % index)
			continue
		var tick := int(frame.get("tick", -1))
		if tick < 0 or tick <= prior_tick:
			validation_errors.append("frames[%d].tick must be non-negative and strictly increasing" % index)
		prior_tick = tick
		if not frame.get("actions", {}) is Dictionary:
			validation_errors.append("frames[%d].actions must be an object" % index)
		else:
			for action in frame.actions:
				if not ACTIONS.has(str(action)):
					validation_errors.append("frames[%d] contains unknown action %s" % [index, action])
				if not frame.actions[action] is bool:
					validation_errors.append("frames[%d].actions.%s must be boolean" % [index, action])
		if frame.has("aim") and (not frame.aim is Dictionary or not _finite(frame.aim.get("x")) or not _finite(frame.aim.get("y"))):
			validation_errors.append("frames[%d].aim must contain finite x/y" % index)
	maximum_tick = prior_tick
	var max_duration := float(replay.get("expectations", {}).get("maxDurationSeconds", 0.0))
	if max_duration > 0.0: maximum_tick = max(maximum_tick, int(ceil(max_duration * 120.0)))
	var expected: Variant = replay.get("expectations", {})
	if not expected is Dictionary:
		validation_errors.append("expectations must be an object")
	else:
		if expected.has("visitedChunks") and not expected.visitedChunks is Array:
			validation_errors.append("expectations.visitedChunks must be an array")
		if expected.has("maxDeaths") and (not (expected.maxDeaths is int or expected.maxDeaths is float) or int(expected.maxDeaths) < 0 or float(expected.maxDeaths) != floor(float(expected.maxDeaths))):
			validation_errors.append("expectations.maxDeaths must be a non-negative integer")
	reset()
	return {"ok": validation_errors.is_empty(), "errors": validation_errors.duplicate(), "maximumTick": maximum_tick}


func reset() -> void:
	current_actions = {}
	for action in ACTIONS: current_actions[action] = false
	current_aim = Vector2.ZERO
	next_frame_index = 0


func input_for_tick(tick: int) -> Dictionary:
	while next_frame_index < frames.size() and int(frames[next_frame_index].tick) == tick:
		var frame: Dictionary = frames[next_frame_index]
		# Every sparse frame is a complete held-state, per the frozen replay schema.
		for action in ACTIONS: current_actions[action] = bool(frame.actions.get(action, false))
		if frame.get("aim") is Dictionary:
			current_aim = Vector2(float(frame.aim.x), float(frame.aim.y))
		next_frame_index += 1
	return {"actions": current_actions.duplicate(true), "aim": current_aim}


func expectations() -> Dictionary:
	return replay.get("expectations", {}).duplicate(true)


func spawn() -> Dictionary:
	return replay.get("spawn", {}).duplicate(true)


func check_expectations(runtime: Node) -> Array[String]:
	var errors: Array[String] = []
	var expected := expectations()
	if expected.has("exitId") and str(runtime.last_exit_id) != str(expected.exitId):
		errors.append("Expected exit %s, reached %s" % [expected.exitId, runtime.last_exit_id])
	if expected.has("goalId") and str(runtime.last_exit_id) != str(expected.goalId):
		errors.append("Expected goal %s, reached %s" % [expected.goalId, runtime.last_exit_id])
	if expected.has("checkpointId") and str(runtime.player.current_checkpoint_id) != str(expected.checkpointId):
		errors.append("Expected checkpoint %s, reached %s" % [expected.checkpointId, runtime.player.current_checkpoint_id])
	for flag in expected.get("flags", []):
		if not runtime.state_store.has_flag(str(flag)): errors.append("Expected flag was not set: %s" % flag)
	for ability in expected.get("abilities", []):
		if not runtime.state_store.has_ability(str(ability)): errors.append("Expected ability was not unlocked: %s" % ability)
	for chunk_id in expected.get("visitedChunks", []):
		if not runtime.state_store.visited_chunks.has(str(chunk_id)): errors.append("Expected chunk was not visited: %s" % chunk_id)
	if expected.has("maxDeaths") and int(runtime.telemetry.counters.get("deaths", 0)) > int(expected.maxDeaths):
		errors.append("Expected at most %d deaths, recorded %d" % [int(expected.maxDeaths), int(runtime.telemetry.counters.get("deaths", 0))])
	return errors


func _finite(value: Variant) -> bool:
	return (value is int or value is float) and is_finite(float(value))
