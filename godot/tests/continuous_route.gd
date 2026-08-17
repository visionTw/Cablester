class_name ContinuousPhysicsRoute
extends Node

# This driver is deliberately limited to the same public fixed-input surface as
# a recorded replay. It reads player/contact outcomes, but never writes player
# transforms and never invokes the runtime's contact processing directly.

var runtime: WorldRuntime
var physics_ticks := 0
var input_segments: Array = []
var stage_results: Array = []
var errors: Array[String] = []
var _last_input_signature := ""
var _open_segment_index := -1
var _wall_started_msec := 0
var _wall_timeout_msec := 240000
var _death_baseline := 0
var _stage_input_state: Dictionary = {}


func run(world_path: String, options: Dictionary = {}) -> Dictionary:
	_wall_started_msec = Time.get_ticks_msec()
	_wall_timeout_msec = maxi(5000, int(float(options.get("wallTimeoutSeconds", 240.0)) * 1000.0))
	runtime = WorldRuntime.new()
	runtime.name = "ContinuousPhysicsRouteRuntime"
	add_child(runtime)
	var loaded := runtime.load_world(world_path, {"loadSave": false})
	if not loaded.ok: return loaded
	if str(runtime.world.get("manifest", {}).get("worldId", "")) != "cablester-first-forest":
		return {"ok": false, "errors": ["Continuous route is frozen for the formal first-forest package"]}
	_death_baseline = int(runtime.telemetry.counters.deaths)
	await get_tree().physics_frame
	await get_tree().physics_frame

	var stages := _formal_route_stages()
	for stage in stages:
		var stage_result := await _drive_stage(stage)
		stage_results.append(stage_result)
		if not stage_result.ok:
			errors.append(str(stage_result.error))
			break
	_close_input_segment()
	runtime.player.clear_replay_input()

	var visited: Array = runtime.state_store.visited_chunks.keys()
	visited.sort()
	var edge_ids: Array = runtime.traversed_edges.map(func(edge: Dictionary) -> String: return str(edge.get("edgeId", "")))
	var required_main := [
		"seedgate-verge", "lantern-crossing", "root-aqueduct", "canopy-lift",
		"wind-terraces", "bellroot-court", "heartwood-ring", "afterglow-gate"
	]
	var route_checks := {
		"mainRouteVisited": required_main.all(func(id: String) -> bool: return visited.has(id)),
		"optionalBranchVisited": ["moss-cistern", "echo-burrow", "crown-overlook", "old-nursery"].all(func(id: String) -> bool: return visited.has(id)),
		"roundTripObserved": _has_round_trip(runtime.traversed_edges),
		"cisternTriangleComplete": _edge_was_traversed("loop-cistern-a", "root-aqueduct", "moss-cistern") and _edge_was_traversed("loop-cistern-b", "moss-cistern", "lantern-crossing"),
		"crownShortcutBothDirections": _edge_was_traversed("loop-crown-a", "bellroot-court", "crown-overlook") and _edge_was_traversed("loop-crown-a", "crown-overlook", "bellroot-court") and _edge_was_traversed("loop-crown-b", "crown-overlook", "heartwood-ring") and _edge_was_traversed("loop-crown-b", "heartwood-ring", "crown-overlook"),
		"nurseryLoopComplete": _edge_was_traversed("loop-nursery-a", "heartwood-ring", "old-nursery") and _edge_was_traversed("loop-nursery-b", "old-nursery", "afterglow-gate"),
		"goalReached": runtime.completed_goal_id == "afterglow-gate:forest-exit",
		"checkpointReached": not runtime.state_store.checkpoint.is_empty(),
		"deathRecoveryObserved": int(runtime.telemetry.counters.deaths) - _death_baseline > 0,
		"deathBudget": int(runtime.telemetry.counters.deaths) - _death_baseline <= 10,
		"mandatoryAbilities": ["doubleJump", "glide", "bash"].all(func(id: String) -> bool: return runtime.state_store.has_ability(id)),
		"routeFlags": ["cistern-sluice-open", "echo-seed-lit", "bellroot-bells-rung", "crown-route-open", "nursery-restored", "heartwood-awake"].all(func(id: String) -> bool: return runtime.state_store.has_flag(id))
	}
	for check_name in route_checks:
		if not bool(route_checks[check_name]): errors.append("Continuous route check failed: %s" % check_name)
	var save_persistence := await _verify_save_reload(world_path) if errors.is_empty() else {"ok": false, "skipped": true}
	route_checks.saveReload = bool(save_persistence.get("ok", false))
	if not bool(route_checks.saveReload): errors.append("Continuous route check failed: saveReload")
	var telemetry_result := runtime.finish_telemetry({}, "continuous-physics-route")
	var result := {
		"ok": errors.is_empty(),
		"generatedAt": Time.get_datetime_string_from_system(true),
		"acceptanceKind": "collision-driven-continuous-held-input",
		"humanConfirmation": "needed",
		"worldId": str(runtime.world.manifest.worldId),
		"contentHash": str(runtime.world.manifest.contentHash),
		"godotBuildId": CablesterFileUtils.godot_build_id(),
		"fixedDelta": 1.0 / 120.0,
		"physicsTicks": physics_ticks,
		"wallDurationSeconds": (Time.get_ticks_msec() - _wall_started_msec) / 1000.0,
		"driverRestrictions": {"directPlayerTransformWrites": 0, "directContactCalls": 0, "privateStateWrites": 0, "inputSurface": "CablesterPlayer.set_input_frame"},
		"inputSegments": input_segments,
		"stages": stage_results,
		"visitedChunks": visited,
		"traversedEdges": runtime.traversed_edges.duplicate(true),
		"traversedEdgeIds": edge_ids,
		"deaths": int(runtime.telemetry.counters.deaths) - _death_baseline,
		"goalId": runtime.completed_goal_id,
		"checkpoint": runtime.state_store.checkpoint.duplicate(true),
		"abilities": runtime.state_store.abilities.keys(),
		"flags": runtime.state_store.flags.duplicate(true),
		"finalPosition": {"x": runtime.player.global_position.x, "y": runtime.player.global_position.y},
		"finalResources": telemetry_result.get("finalResources", {}).duplicate(true),
		"routeChecks": route_checks,
		"savePersistence": save_persistence,
		"performance": telemetry_result.get("performance", {}).duplicate(true),
		"streaming": telemetry_result.get("streaming", {}).duplicate(true),
		"errors": errors
	}
	result.abilities.sort()
	var output_root := "user://acceptance-artifacts" if OS.has_feature("template") else "artifacts/godot"
	var artifact_path := output_root.path_join("first-forest.continuous-physics-route.acceptance.json")
	var written := CablesterFileUtils.write_json_atomic(artifact_path, result)
	result.artifactPath = artifact_path
	result.writeOk = bool(written.ok)
	if not written.ok and not OS.has_feature("template"):
		result.ok = false
		result.errors.append("Cannot write continuous route artifact: %s" % str(written.get("error", "unknown")))
	return result


func _drive_stage(stage: Dictionary) -> Dictionary:
	_stage_input_state = {}
	var started_tick := physics_ticks
	var started_deaths := int(runtime.telemetry.counters.deaths)
	var expected_chunk := str(stage.get("chunkId", ""))
	var max_ticks := int(stage.get("maxTicks", 2400))
	var start_edges := runtime.traversed_edges.size()
	if runtime.player.attached_mode == "hardBar" and not bool(stage.get("useHardBar", false)):
		# Hard bar is a toggle. Leave a completed rigid-bar waypoint through the
		# same one-tick input edge a player uses, never by mutating attachment state.
		var detach_actions := {"hard_bar": true}
		_apply_input_frame(detach_actions, runtime.player.global_position, "%s:detach-hard-bar" % str(stage.id))
		await get_tree().physics_frame
		physics_ticks += 1
	# A stage always begins from a stable held-state boundary. This prevents an
	# old jump/dash edge from leaking across a room transition while preserving
	# continuous physics (one real neutral tick, no transform write).
	runtime.player.set_input_frame({}, runtime.player.global_position)
	await get_tree().physics_frame
	physics_ticks += 1
	for stage_tick in max_ticks:
		if _stage_done(stage):
			return _stage_result(stage, true, started_tick, started_deaths, "")
		if Time.get_ticks_msec() - _wall_started_msec > _wall_timeout_msec:
			return _stage_result(stage, false, started_tick, started_deaths, "Continuous route wall-clock watchdog expired")
		if not expected_chunk.is_empty() and runtime.streamer.active_chunk_id != expected_chunk:
			if str(stage.get("kind", "")) == "exit" and runtime.streamer.active_chunk_id == str(stage.get("toChunkId", "")):
				return _stage_result(stage, true, started_tick, started_deaths, "")
			var recovery_key := "%s:recoveryObjectId" % runtime.streamer.active_chunk_id
			if not stage.has(recovery_key): recovery_key = "recoveryObjectId"
			if str(stage.get(recovery_key, "")).is_empty():
				return _stage_result(stage, false, started_tick, started_deaths, "Stage %s expected chunk %s but runtime is in %s" % [stage.id, expected_chunk, runtime.streamer.active_chunk_id])
			var recovered := await _drive_recovery_exit(stage, recovery_key)
			if not recovered:
				return _stage_result(stage, false, started_tick, started_deaths, "Stage %s could not recover from %s" % [stage.id, runtime.streamer.active_chunk_id])
			continue
		var target := _object_by_id(str(stage.get("objectId", "")))
		if target == null:
			return _stage_result(stage, false, started_tick, started_deaths, "Stage %s cannot resolve active object %s" % [stage.id, stage.get("objectId", "")])
		var actions_and_aim := _navigation_input(stage, target, stage_tick)
		_apply_input_frame(actions_and_aim.actions, actions_and_aim.aim, str(stage.id))
		await get_tree().physics_frame
		physics_ticks += 1
		# Goal activation records a terminal traversal edge on the same physics
		# frame.  Recognize the requested outcome before the generic non-exit guard;
		# otherwise a genuinely reached formal goal is mislabeled as an accidental
		# room transition even though completed_goal_id already matches this stage.
		if _stage_done(stage):
			return _stage_result(stage, true, started_tick, started_deaths, "")
		if str(stage.get("kind", "")) != "exit" and runtime.traversed_edges.size() > start_edges:
			return _stage_result(stage, false, started_tick, started_deaths, "Stage %s accidentally traversed an exit before reaching its target" % stage.id)
	return _stage_result(stage, _stage_done(stage), started_tick, started_deaths, "Stage %s exceeded %d physics ticks" % [stage.id, max_ticks])


func _drive_recovery_exit(stage: Dictionary, recovery_key: String) -> bool:
	var recovery_chunk := runtime.streamer.active_chunk_id
	var expected_chunk := str(stage.get("chunkId", ""))
	var prefix := recovery_key.trim_suffix("ObjectId")
	var recovery_object_id := str(stage.get(recovery_key, ""))
	var recovery_to_chunk := str(stage.get("%sToChunkId" % prefix, ""))
	var recovery_direction := str(stage.get("%sDirection" % prefix, "left"))
	for recovery_tick in int(stage.get("%sMaxTicks" % prefix, 3600)):
		if runtime.streamer.active_chunk_id == recovery_to_chunk or runtime.streamer.active_chunk_id == expected_chunk: return true
		if runtime.streamer.active_chunk_id != recovery_chunk: return false
		var target := _object_by_id(recovery_object_id)
		if target == null: return false
		var recovery_stage := {"direction": recovery_direction, "useRope": bool(stage.get("%sUseRope" % prefix, false))}
		var frame := _navigation_input(recovery_stage, target, recovery_tick)
		_apply_input_frame(frame.actions, frame.aim, "%s:recovery" % str(stage.id))
		await get_tree().physics_frame
		physics_ticks += 1
	return runtime.streamer.active_chunk_id in [recovery_to_chunk, expected_chunk]


func _navigation_input(stage: Dictionary, target: CanonicalObject, stage_tick: int) -> Dictionary:
	var player := runtime.player
	var target_point := target.world_interaction_bounds().get_center()
	var explicit_point: Variant = stage.get("targetPoint")
	if explicit_point is Dictionary:
		target_point = Vector2(float(explicit_point.get("x", target_point.x)), float(explicit_point.get("y", target_point.y)))
	target_point += Vector2(float(stage.get("aimOffsetX", 0.0)), float(stage.get("aimOffsetY", 0.0)))
	var delta := target_point - player.global_position
	var direction := str(stage.get("direction", target.canonical_properties.get("direction", "")))
	var actions := {}
	var input_profile := str(stage.get("inputProfile", ""))
	if input_profile == "windCornerDash":
		# The optional exit is reached through a fourteen-pixel-high safe centre
		# corridor below the rest island.  Stay outside the island's right corner
		# until the player enters that vertical band, then spend the preserved dash
		# on a purely horizontal crossing so gravity cannot carry the circle into the
		# thorns.  The x branch also recovers naturally from a checkpoint respawn.
		if player.global_position.x < 10778.0:
			actions.move_right = true
			actions.jump = true
		elif player.global_position.y < -472.0:
			if player.global_position.x < 10782.0: actions.move_right = true
			elif player.global_position.x > 10804.0: actions.move_left = true
		elif player.global_position.x > 10692.0:
			actions.move_left = true
			if player.dash_charges > 0: actions.dash = true
		return {"actions": actions, "aim": target_point}
	if input_profile == "echoHardBarExit":
		# Echo's upper knot is authored for both rope and hard bar.  A continuously
		# winched soft rope settles directly below it, so use the public F toggle to
		# preserve the full arrival radius, then spend one diagonal dash as tangential
		# swing velocity.  Reaching the upper arc toggles F again and carries that
		# momentum toward the real up-exit.  The driver state below belongs only to
		# this input recorder; it never writes player/runtime state.
		var phase := int(_stage_input_state.get("phase", 0))
		if phase == 0:
			actions.hard_bar = true
			_stage_input_state.phase = 1
		elif phase == 1:
			if player.attached_mode == "hardBar":
				actions.move_left = true
				actions.move_up = true
				if player.dash_charges > 0: actions.dash = true
				_stage_input_state.phase = 2
			elif stage_tick > 45:
				# A failed target acquisition gets a fresh toggle edge after a neutral
				# frame instead of mutating or forcing the attachment.
				_stage_input_state.phase = 0
		elif phase == 2:
			actions.move_left = true
			if player.global_position.y <= 2020.0:
				actions.hard_bar = true
				actions.move_up = true
				actions.jump = true
				_stage_input_state.phase = 3
		elif phase == 3:
			actions.move_left = true
			actions.move_up = true
			actions.jump = true
			if player.dash_charges > 0: actions.dash = true
		return {"actions": actions, "aim": target.global_position}
	if input_profile == "verticalDashExit":
		# A vertical portal above a solid hub platform needs the same three public
		# actions a player uses: first settle directly under the aperture, then use
		# repeated jump edges, vertical steering and one pure upward dash. Correcting
		# x while airborne carries too much tangential momentum past the 80px portal.
		var vertical_phase := int(_stage_input_state.get("phase", 0))
		if vertical_phase == 0:
			if delta.x > 5.0: actions.move_right = true
			elif delta.x < -5.0: actions.move_left = true
			elif absf(player.velocity.x) < 28.0:
				_stage_input_state.phase = 1
				_stage_input_state.ascentTicks = 0
		else:
			var ascent_ticks := int(_stage_input_state.get("ascentTicks", 0))
			_stage_input_state.ascentTicks = ascent_ticks + 1
			actions.move_up = true
			if ascent_ticks % 48 < 12: actions.jump = true
			if player.dash_charges > 0 and player.global_position.y < target_point.y + 390.0: actions.dash = true
			if player.global_position.y > target_point.y + 420.0 and ascent_ticks > 100:
				_stage_input_state.phase = 0
		return {"actions": actions, "aim": target_point}
	if input_profile == "rootMossDrop":
		# The optional portal sits underneath the solid mid-dam. Approach its right
		# lip from the knot, fall below the dam, then make one horizontal correction
		# into the trigger. Dropping from the west enters the recovery band too early.
		if player.global_position.x < 5928.0:
			actions.move_right = true
			if stage_tick % 54 < 10: actions.jump = true
			if player.dash_charges > 0 and stage_tick % 96 == 14: actions.dash = true
		elif player.global_position.y < 1270.0:
			actions.move_down = true
		elif player.global_position.x > 5870.0:
			actions.move_left = true
			if player.dash_charges > 0: actions.dash = true
		else:
			actions.move_down = true
		return {"actions": actions, "aim": target_point}
	if input_profile == "crownGlideDash":
		# Cross the authored Crown wind field above both thorn beds. Jump is held
		# long enough to exercise glide; diagonal dash pulses use only approved input
		# and the canonical refill volumes determine whether another pulse is legal.
		if delta.x > 14.0: actions.move_right = true
		elif delta.x < -14.0: actions.move_left = true
		if delta.y < -30.0: actions.move_up = true
		if stage_tick % 54 < 34: actions.jump = true
		if player.dash_charges > 0 and stage_tick % 96 == 14: actions.dash = true
		return {"actions": actions, "aim": target_point}
	if input_profile == "crownReverse":
		# Reverse the upper shortcut from the east entrance to the down portal. Keep
		# glide active while traversing left above the hazards, then release over the
		# portal so gravity—not a transform write—completes the return to Bellroot.
		if absf(delta.x) > 82.0:
			if delta.x < 0.0: actions.move_left = true
			else: actions.move_right = true
			actions.move_up = true
			if stage_tick % 54 < 34: actions.jump = true
			if player.dash_charges > 0 and stage_tick % 96 == 14: actions.dash = true
		else:
			actions.move_down = true
			if player.dash_charges > 0 and delta.y > 90.0 and stage_tick % 84 == 18: actions.dash = true
		return {"actions": actions, "aim": target_point}
	if input_profile == "bellrootCrownLanding":
		# The Crown return spawn is intentionally just below the same vertical portal.
		# Move horizontally out of its contact column while gravity settles the player
		# on the bell dais; jumping here would immediately bounce back into Crown.
		if player.global_position.x < 13325.0: actions.move_right = true
		elif player.global_position.x > 13355.0: actions.move_left = true
		return {"actions": actions, "aim": target_point}
	var horizontal_deadzone := float(stage.get("horizontalDeadzone", 12.0))
	var route_direction_sign := 1.0 if direction == "right" else -1.0 if direction == "left" else 0.0
	# Exit stages keep their authored route direction so a checkpoint respawn does
	# not steer back into an old doorway. Interaction/proximity stages instead
	# track their exact object and correct a small overshoot.
	if str(stage.get("kind", "exit")) != "exit": route_direction_sign = 0.0
	# After death/checkpoint recovery, a controller must not reverse toward an old
	# optional exit merely because that exit is geometrically closer than the
	# intended route endpoint. Horizontal route direction remains authoritative.
	if route_direction_sign > 0.0 and absf(delta.x) > horizontal_deadzone: actions.move_right = true
	elif route_direction_sign < 0.0 and absf(delta.x) > horizontal_deadzone: actions.move_left = true
	elif route_direction_sign == 0.0:
		if delta.x > horizontal_deadzone: actions.move_right = true
		elif delta.x < -horizontal_deadzone: actions.move_left = true
	if direction == "down" and delta.y > 28.0: actions.move_down = true
	elif direction == "up" and delta.y < -28.0: actions.move_up = true
	if bool(stage.get("holdUp", false)): actions.move_up = true

	# Horizontal authored routes are traversed with a deterministic rhythm of
	# held run, buffered jump/glide, dash and rope. All collision resolution and
	# trigger activation remains inside the real player/runtime physics code.
	var jump_phase := stage_tick % 54
	var wants_jump := direction != "down" and (absf(delta.x) > 90.0 or delta.y < -18.0)
	if wants_jump and jump_phase < (30 if runtime.state_store.has_ability("glide") else 9):
		actions.jump = true
	if not bool(stage.get("disableAutoDash", false)) and absf(delta.x) > 230.0 and stage_tick % 96 == 14:
		actions.dash = true
	if direction == "down" and absf(delta.x) < 90.0:
		actions.erase("jump")
		actions.erase("dash")
		actions.move_down = true
		# Entering a lower connection is intentional; release horizontal braking so
		# gravity carries the player through the authored vertical trigger.
		actions.erase("move_left")
		actions.erase("move_right")
	if not bool(stage.get("disableAutoDash", false)) and direction == "down" and delta.y > 90.0 and stage_tick % 84 == 18:
		# A downward dash is a normal approved input and breaks the water surface's
		# buoyancy/drag deterministically without bypassing collision.
		actions.dash = true
		actions.move_down = true

	var attachment_target := _forward_attachment_target(signf(delta.x), bool(stage.get("allowRearRope", false)))
	if bool(stage.get("exactAttachmentTarget", false)):
		# High-route waypoints may begin outside rope range while a previous knot is
		# still nearer.  Walk/jump toward the authored stage target until that exact
		# anchor is eligible instead of silently reattaching the old knot.
		var exact_distance := player.global_position.distance_to(target.global_position)
		attachment_target = target if target.runtime_handler == "anchor" and exact_distance >= 70.0 and exact_distance <= 465.0 else null
	var aim := attachment_target.global_position if attachment_target else target_point
	if bool(stage.get("useHardBar", false)): aim = target_point
	var rope_phase := stage_tick % 72
	var rope_window_active := stage_tick >= 18 if bool(stage.get("holdRope", false)) else rope_phase >= 18 and rope_phase < 48
	if bool(stage.get("useRope", false)) and attachment_target != null and rope_window_active and direction != "down":
		actions.rope = true
		# Reeling is itself an approved held input. Without it a valid rope merely
		# preserves the current radius and cannot lift the player over the aqueduct
		# dam before the lower branch trigger.
		actions.move_up = true
	if bool(stage.get("useHardBar", false)) and stage_tick == 8:
		# A one-tick edge toggles the rigid bar on; subsequent held movement is
		# resolved by the real attachment physics until the waypoint is reached.
		actions.hard_bar = true
	# Bash is a hold-to-aim/release action. It is used only after acquisition and
	# only when a target genuinely lies along the desired route.
	if runtime.state_store.has_ability("bash") and _forward_bash_target(target_point, signf(delta.x)) != null:
		var bash_phase := stage_tick % 120
		if bash_phase >= 36 and bash_phase < 48:
			actions.bash = true
		aim = _forward_bash_target(target_point, signf(delta.x)).global_position
	if direction == "up" and stage_tick % 180 >= 132 and stage_tick % 180 < 160:
		actions.grab = true
	return {"actions": actions, "aim": aim}


func _forward_attachment_target(horizontal_sign: float, allow_rear := false) -> CanonicalObject:
	var player_position := runtime.player.global_position
	var best: CanonicalObject
	var best_score := INF
	for node in get_tree().get_nodes_in_group("canonical_objects"):
		if not node is CanonicalObject or node.runtime_handler != "anchor" or node.chunk_id != runtime.streamer.active_chunk_id: continue
		var offset: Vector2 = node.global_position - player_position
		if offset.length() < 70.0 or offset.length() > 465.0: continue
		var behind := horizontal_sign != 0.0 and signf(offset.x) != horizontal_sign
		if behind and not allow_rear: continue
		var score := absf(offset.x) + maxf(0.0, offset.y) * 2.0 + (260.0 if behind else 0.0)
		if score < best_score:
			best = node
			best_score = score
	return best


func _forward_bash_target(_fallback: Vector2, horizontal_sign: float) -> CanonicalObject:
	var player_position := runtime.player.global_position
	var best: CanonicalObject
	var best_distance := INF
	for node in get_tree().get_nodes_in_group("canonical_objects"):
		if not node is CanonicalObject or node.runtime_handler != "bashTarget" or node.chunk_id != runtime.streamer.active_chunk_id: continue
		var offset: Vector2 = node.global_position - player_position
		var distance := offset.length()
		if distance > 180.0 or (horizontal_sign != 0.0 and signf(offset.x) != horizontal_sign): continue
		if distance < best_distance:
			best = node
			best_distance = distance
	return best


func _stage_done(stage: Dictionary) -> bool:
	match str(stage.get("kind", "exit")):
		"exit": return runtime.streamer.active_chunk_id == str(stage.get("toChunkId", ""))
		"ability": return runtime.state_store.has_ability(str(stage.get("abilityId", "")))
		"flag": return runtime.state_store.has_flag(str(stage.get("flagId", "")))
		"checkpoint": return runtime.player.current_checkpoint_id == str(stage.get("objectId", ""))
		"goal": return runtime.completed_goal_id == str(stage.get("objectId", ""))
		"proximity":
			var target := _object_by_id(str(stage.get("objectId", "")))
			return target != null and runtime.player.global_position.distance_to(target.world_interaction_bounds().get_center()) <= float(stage.get("tolerance", 60.0))
		"point":
			var point: Dictionary = stage.get("targetPoint", {})
			return runtime.player.global_position.distance_to(Vector2(float(point.get("x", 0.0)), float(point.get("y", 0.0)))) <= float(stage.get("tolerance", 40.0))
		"safeBox":
			var box: Dictionary = stage.get("targetBox", {})
			var position := runtime.player.global_position
			return (
				position.x >= float(box.get("minX", 0.0))
				and position.x <= float(box.get("maxX", 0.0))
				and position.y >= float(box.get("minY", 0.0))
				and position.y <= float(box.get("maxY", 0.0))
			)
	return false


func _stage_result(stage: Dictionary, ok: bool, started_tick: int, started_deaths: int, error: String) -> Dictionary:
	return {
		"id": str(stage.get("id", "stage")), "ok": ok,
		"startTick": started_tick, "endTick": physics_ticks,
		"physicsTicks": physics_ticks - started_tick,
		"deaths": int(runtime.telemetry.counters.deaths) - started_deaths,
		"activeChunkId": runtime.streamer.active_chunk_id,
		"position": {"x": runtime.player.global_position.x, "y": runtime.player.global_position.y},
		"error": error if not ok else ""
	}


func _object_by_id(id: String) -> CanonicalObject:
	for node in get_tree().get_nodes_in_group("canonical_objects"):
		if node is CanonicalObject and node.object_id == id: return node
	return null


func _apply_input_frame(actions: Dictionary, world_aim: Vector2, stage_id: String) -> void:
	# CablesterPlayer consumes replay aim in active-chunk canonical coordinates
	# and resolves it back to world space.  Route navigation is intentionally
	# computed from live world geometry, so invert region/chunk transforms exactly
	# at this public input boundary instead of writing any runtime state directly.
	var canonical_aim := _world_aim_to_active_chunk(world_aim)
	_record_input(actions, canonical_aim, stage_id)
	runtime.player.set_input_frame(actions, canonical_aim)


func _world_aim_to_active_chunk(world_point: Vector2) -> Vector2:
	var active_chunk_id := runtime.streamer.active_chunk_id
	for region in runtime.world.get("regions", []):
		for chunk in region.get("chunks", []):
			if str(chunk.get("id", "")) != active_chunk_id: continue
			var region_local := _unapply_canonical_transform(world_point, region.get("transform", {}))
			return _unapply_canonical_transform(region_local, chunk.get("transform", {}))
	return world_point


func _unapply_canonical_transform(point: Vector2, transform: Dictionary) -> Vector2:
	var position_value: Dictionary = transform.get("position", {})
	var scale_value: Dictionary = transform.get("scale", {})
	var translated := point - Vector2(float(position_value.get("x", 0.0)), float(position_value.get("y", 0.0)))
	var unrotated := translated.rotated(-deg_to_rad(float(transform.get("rotationDegrees", 0.0))))
	var scale_x := float(scale_value.get("x", 1.0))
	var scale_y := float(scale_value.get("y", 1.0))
	return Vector2(unrotated.x / scale_x, unrotated.y / scale_y)


func _record_input(actions: Dictionary, aim: Vector2, stage_id: String) -> void:
	var aim_data := {"x": snappedf(aim.x, 0.01), "y": snappedf(aim.y, 0.01)}
	var signature := StableJson.stringify({"actions": actions, "aim": aim_data, "stageId": stage_id})
	if signature == _last_input_signature: return
	_close_input_segment()
	input_segments.append({"startTick": physics_ticks, "endTick": physics_ticks, "stageId": stage_id, "actions": actions.duplicate(true), "aim": aim_data})
	_open_segment_index = input_segments.size() - 1
	_last_input_signature = signature


func _close_input_segment() -> void:
	if _open_segment_index >= 0:
		input_segments[_open_segment_index].endTick = maxi(int(input_segments[_open_segment_index].startTick), physics_ticks - 1)
	_open_segment_index = -1


func _has_round_trip(edges: Array) -> bool:
	for first_index in edges.size():
		var first: Dictionary = edges[first_index]
		for second_index in range(first_index + 1, edges.size()):
			var second: Dictionary = edges[second_index]
			if str(first.fromChunkId) == str(second.toChunkId) and str(first.toChunkId) == str(second.fromChunkId): return true
	return false


func _edge_was_traversed(edge_id: String, from_chunk_id: String, to_chunk_id: String) -> bool:
	for edge in runtime.traversed_edges:
		if str(edge.get("edgeId", "")) == edge_id and str(edge.get("fromChunkId", "")) == from_chunk_id and str(edge.get("toChunkId", "")) == to_chunk_id:
			return true
	return false


func _verify_save_reload(world_path: String) -> Dictionary:
	var slot := "continuous-route"
	var expected := {
		"abilities": runtime.state_store.abilities.duplicate(true),
		"flags": runtime.state_store.flags.duplicate(true),
		"checkpoint": runtime.state_store.checkpoint.duplicate(true),
		"persistentObjectStates": _persistent_object_states(runtime.state_store.object_states)
	}
	var save := runtime.state_store.save_to_disk(slot)
	if not bool(save.get("ok", false)):
		return {"ok": false, "slot": slot, "error": str(save.get("error", "save failed"))}
	var restored := WorldRuntime.new()
	restored.name = "ContinuousRouteRestoredRuntime"
	add_child(restored)
	var loaded := restored.load_world(world_path, {"loadSave": true, "saveSlot": slot})
	var matches := bool(loaded.get("ok", false))
	if matches:
		matches = (
			StableJson.stringify(restored.state_store.abilities) == StableJson.stringify(expected.abilities)
			and StableJson.stringify(restored.state_store.flags) == StableJson.stringify(expected.flags)
			and StableJson.stringify(restored.state_store.checkpoint) == StableJson.stringify(expected.checkpoint)
			and StableJson.stringify(_persistent_object_states(restored.state_store.object_states)) == StableJson.stringify(expected.persistentObjectStates)
			and restored.streamer.active_chunk_id == str(expected.checkpoint.get("chunkId", ""))
		)
	var result := {
		"ok": matches,
		"slot": slot,
		"saveWrite": true,
		"runtimeLoad": bool(loaded.get("ok", false)),
		"checkpointRestored": bool(loaded.get("saveLoad", {}).get("checkpointRestored", false)),
		"activeChunkId": restored.streamer.active_chunk_id if bool(loaded.get("ok", false)) else "",
		"abilityCount": expected.abilities.size(),
		"flagCount": expected.flags.values().count(true),
		"persistentObjectStateCount": expected.persistentObjectStates.size()
	}
	if not matches: result.error = "Fresh WorldRuntime did not restore the completed route state exactly"
	restored.queue_free()
	return result


func _persistent_object_states(states: Dictionary) -> Dictionary:
	var persistent := {}
	for object_id in states:
		var state: Variant = states[object_id]
		if state is Dictionary and str(state.get("resetPolicy", "death")) == "persistent":
			persistent[str(object_id)] = state.duplicate(true)
	return persistent


func _formal_route_stages() -> Array:
	return [
		{"id": "seed-to-lantern", "kind": "exit", "chunkId": "seedgate-verge", "objectId": "seedgate-verge:exit-lantern-crossing", "toChunkId": "lantern-crossing", "direction": "right"},
		{"id": "lantern-roundtrip-return", "kind": "exit", "chunkId": "lantern-crossing", "objectId": "lantern-crossing:exit-seedgate-verge", "toChunkId": "seedgate-verge", "direction": "left"},
		{"id": "seed-roundtrip-out", "kind": "exit", "chunkId": "seedgate-verge", "objectId": "seedgate-verge:exit-lantern-crossing", "toChunkId": "lantern-crossing", "direction": "right"},
		{"id": "lantern-to-root", "kind": "exit", "chunkId": "lantern-crossing", "objectId": "lantern-crossing:exit-root-aqueduct", "toChunkId": "root-aqueduct", "direction": "right", "maxTicks": 3200},
		# Complete the low Cistern triangle before climbing the aqueduct: Root ->
		# Moss, open the persistent sluice, Moss -> Lantern, then Lantern -> Root.
		{"id": "root-moss-approach-knot-a", "kind": "proximity", "chunkId": "root-aqueduct", "objectId": "root-aqueduct:canal-knot-a", "direction": "right", "useRope": true, "holdRope": true, "tolerance": 150.0, "maxTicks": 1800},
		{"id": "root-to-moss-cistern", "kind": "exit", "chunkId": "root-aqueduct", "objectId": "root-aqueduct:exit-moss-cistern", "toChunkId": "moss-cistern", "direction": "down", "inputProfile": "rootMossDrop", "disableAutoDash": true, "maxTicks": 2400},
		{"id": "open-cistern-sluice", "kind": "flag", "chunkId": "moss-cistern", "objectId": "moss-cistern:return-sluice", "flagId": "cistern-sluice-open", "direction": "down", "disableAutoDash": true, "maxTicks": 2400},
		{"id": "moss-to-lantern-shortcut", "kind": "exit", "chunkId": "moss-cistern", "objectId": "moss-cistern:exit-lantern-crossing", "toChunkId": "lantern-crossing", "direction": "left", "maxTicks": 3600},
		{"id": "lantern-to-root-after-cistern", "kind": "exit", "chunkId": "lantern-crossing", "objectId": "lantern-crossing:exit-root-aqueduct", "toChunkId": "root-aqueduct", "direction": "right", "maxTicks": 3600},
		{"id": "root-rope-knot-a", "kind": "proximity", "chunkId": "root-aqueduct", "objectId": "root-aqueduct:canal-knot-a", "direction": "right", "useRope": true, "holdRope": true, "tolerance": 150.0, "maxTicks": 1800},
		{"id": "root-to-canopy", "kind": "exit", "chunkId": "root-aqueduct", "objectId": "root-aqueduct:exit-canopy-lift", "toChunkId": "canopy-lift", "direction": "right", "useRope": true, "allowRearRope": true, "holdUp": true, "maxTicks": 5200,
			"moss-cistern:recoveryObjectId": "moss-cistern:exit-lantern-crossing", "moss-cistern:recoveryToChunkId": "lantern-crossing", "moss-cistern:recoveryDirection": "left", "moss-cistern:recoveryMaxTicks": 3600,
			"lantern-crossing:recoveryObjectId": "lantern-crossing:exit-root-aqueduct", "lantern-crossing:recoveryToChunkId": "root-aqueduct", "lantern-crossing:recoveryDirection": "right", "lantern-crossing:recoveryMaxTicks": 3600},
		{"id": "collect-double-jump", "kind": "ability", "chunkId": "canopy-lift", "objectId": "canopy-lift:double-jump-seed", "abilityId": "doubleJump", "direction": "right"},
		{"id": "canopy-rope-knot-a", "kind": "proximity", "chunkId": "canopy-lift", "objectId": "canopy-lift:lift-knot-a", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "tolerance": 150.0, "maxTicks": 1600},
		{"id": "canopy-rope-knot-b", "kind": "proximity", "chunkId": "canopy-lift", "objectId": "canopy-lift:lift-knot-b", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "tolerance": 160.0, "maxTicks": 1800},
		{"id": "canopy-rope-knot-c", "kind": "proximity", "chunkId": "canopy-lift", "objectId": "canopy-lift:lift-knot-c", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "tolerance": 160.0, "maxTicks": 1800},
		{"id": "canopy-to-wind", "kind": "exit", "chunkId": "canopy-lift", "objectId": "canopy-lift:exit-wind-terraces", "toChunkId": "wind-terraces", "direction": "right", "useRope": true, "maxTicks": 3600},
		{"id": "collect-glide", "kind": "ability", "chunkId": "wind-terraces", "objectId": "wind-terraces:glide-leaf", "abilityId": "glide", "direction": "right"},
		{"id": "wind-rope-knot-a", "kind": "proximity", "chunkId": "wind-terraces", "objectId": "wind-terraces:wind-knot-a", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "tolerance": 160.0, "maxTicks": 1800},
		{"id": "wind-rope-knot-b", "kind": "proximity", "chunkId": "wind-terraces", "objectId": "wind-terraces:wind-knot-b", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "tolerance": 170.0, "maxTicks": 2200},
		# Walking off the rest island and steering down-left reaches the real optional
		# trigger through collision and recovery physics. Treat the actual chunk
		# transition as the outcome instead of requiring an artificial intermediate
		# proximity point that may be crossed on the same physics frame as the exit.
		{"id": "wind-to-optional-echo", "kind": "exit", "chunkId": "wind-terraces", "objectId": "wind-terraces:exit-echo-burrow", "toChunkId": "echo-burrow", "targetPoint": {"x": 10788.0, "y": -470.0}, "direction": "down", "disableAutoDash": true, "maxTicks": 1600},
		{"id": "light-echo-seed", "kind": "flag", "chunkId": "echo-burrow", "objectId": "echo-burrow:echo-seed", "flagId": "echo-seed-lit", "direction": "right", "maxTicks": 3200},
		# Return through loop-echo-a before taking main-05. This deliberately enters
		# Bellroot Court at its west/main entrance (12160, 520 after spawn offset),
		# avoiding the optional branch arrival underneath the solid bell dais.
		{"id": "echo-return-to-wind", "kind": "exit", "chunkId": "echo-burrow", "objectId": "echo-burrow:echo-knot-b", "toChunkId": "wind-terraces", "direction": "up", "inputProfile": "echoHardBarExit", "maxTicks": 2200},
		{"id": "wind-to-bellroot-main", "kind": "exit", "chunkId": "wind-terraces", "objectId": "wind-terraces:exit-bellroot-court", "toChunkId": "bellroot-court", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "maxTicks": 4200},
		{"id": "collect-bash", "kind": "ability", "chunkId": "bellroot-court", "objectId": "bellroot-court:bash-bloom", "abilityId": "bash", "direction": "right"},
		{"id": "ring-bells", "kind": "flag", "chunkId": "bellroot-court", "objectId": "bellroot-court:bell-trigger", "flagId": "bellroot-bells-rung", "direction": "right"},
		# Traverse the Crown shortcut in both directions. The forward pass enters
		# Heartwood through loop-crown-b; the reverse pass returns over loop-crown-a,
		# after which the authored Bellroot main exit is used normally.
		{"id": "bellroot-to-crown", "kind": "exit", "chunkId": "bellroot-court", "objectId": "bellroot-court:exit-crown-overlook", "toChunkId": "crown-overlook", "direction": "up", "inputProfile": "verticalDashExit", "maxTicks": 2600},
		{"id": "open-crown-route", "kind": "flag", "chunkId": "crown-overlook", "objectId": "crown-overlook:crown-complete", "flagId": "crown-route-open", "direction": "right", "inputProfile": "crownGlideDash", "maxTicks": 3600},
		{"id": "crown-to-heartwood", "kind": "exit", "chunkId": "crown-overlook", "objectId": "crown-overlook:exit-heartwood-ring", "toChunkId": "heartwood-ring", "direction": "right", "inputProfile": "crownGlideDash", "maxTicks": 2600},
		{"id": "heartwood-back-to-crown", "kind": "exit", "chunkId": "heartwood-ring", "objectId": "heartwood-ring:exit-crown-overlook", "toChunkId": "crown-overlook", "direction": "up", "inputProfile": "verticalDashExit", "maxTicks": 2200},
		{"id": "crown-back-to-bellroot", "kind": "exit", "chunkId": "crown-overlook", "objectId": "crown-overlook:exit-bellroot-court", "toChunkId": "bellroot-court", "direction": "down", "inputProfile": "crownReverse", "maxTicks": 3600},
		{"id": "bellroot-clear-crown-portal", "kind": "safeBox", "chunkId": "bellroot-court", "objectId": "bellroot-court:bell-right", "targetPoint": {"x": 13340.0, "y": 502.0}, "targetBox": {"minX": 13320.0, "maxX": 13360.0, "minY": 475.0, "maxY": 510.0}, "inputProfile": "bellrootCrownLanding", "maxTicks": 800},
		{"id": "bellroot-to-heartwood", "kind": "exit", "chunkId": "bellroot-court", "objectId": "bellroot-court:exit-heartwood-ring", "toChunkId": "heartwood-ring", "direction": "right", "maxTicks": 3200},
		{"id": "heartwood-rope-knot-b", "kind": "proximity", "chunkId": "heartwood-ring", "objectId": "heartwood-ring:heart-knot-b", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "exactAttachmentTarget": true, "tolerance": 170.0, "maxTicks": 2200},
		{"id": "heartwood-rope-knot-c", "kind": "proximity", "chunkId": "heartwood-ring", "objectId": "heartwood-ring:heart-knot-c", "direction": "right", "useRope": true, "holdRope": true, "holdUp": true, "exactAttachmentTarget": true, "tolerance": 180.0, "maxTicks": 2600},
		{"id": "awaken-heartwood", "kind": "flag", "chunkId": "heartwood-ring", "objectId": "heartwood-ring:heart-awakening", "flagId": "heartwood-awake", "direction": "right", "maxTicks": 3200},
		# Complete the authored Nursery branch from its hub to its alternate Afterglow
		# return. This proves the persistent flag survives the fragile/moving sequence
		# and that the branch rejoins the final route without a hidden layout change.
		{"id": "heartwood-to-nursery", "kind": "exit", "chunkId": "heartwood-ring", "objectId": "heartwood-ring:exit-old-nursery", "toChunkId": "old-nursery", "direction": "down", "maxTicks": 3000},
		{"id": "restore-nursery", "kind": "flag", "chunkId": "old-nursery", "objectId": "old-nursery:nursery-core", "flagId": "nursery-restored", "direction": "right", "maxTicks": 3600},
		{"id": "nursery-to-afterglow", "kind": "exit", "chunkId": "old-nursery", "objectId": "old-nursery:exit-afterglow-gate", "toChunkId": "afterglow-gate", "direction": "right", "maxTicks": 3200},
		{"id": "final-checkpoint", "kind": "checkpoint", "chunkId": "afterglow-gate", "objectId": "afterglow-gate:checkpoint-final", "direction": "right"},
		{"id": "formal-goal", "kind": "goal", "chunkId": "afterglow-gate", "objectId": "afterglow-gate:forest-exit", "direction": "right"}
	]
