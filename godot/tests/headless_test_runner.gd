class_name HeadlessTestRunner
extends Node

const PLAYER_PHYSICS_RULES := preload("res://godot/runtime/player_physics_rules.gd")
const PLAYER_VISUAL_STATE_UNIT := preload("res://godot/tests/player_visual_state_unit.gd")

var passed := 0
var failed := 0
var failures: Array[String] = []


func run_all() -> Dictionary:
	_expect(CablesterFileUtils.godot_build_id() == "4.7.1.stable.official.a13da4feb", "Exact Godot 4.7.1 build ID handshake")
	_test_input_map()
	_test_stable_json()
	var world := _fixture_world()
	_test_validator(world)
	_test_prefab_scene_boundary(world)
	_test_importer(world)
	_test_unknown_required_type(world)
	_test_state_store(world)
	_test_chunk_state_policy_persistence()
	await _test_reset_policy_matrix(world)
	_test_chunk_scoped_starting_abilities()
	_test_approved_tuning_values(world)
	_test_player_rule_helpers()
	_test_replay_contract(world)
	await _test_replay_physics_order(world)
	_test_gate_semantics(world)
	await _test_player_mechanics(world)
	await _test_runtime_and_streaming(world)
	await _test_checkpoint_load_and_bounds()
	await _test_lab_runtime_coverage()
	await _test_forest_scene_landmarks()
	await _test_scene_layer_semantics()
	var canonical_results := _test_canonical_world_files()
	return {
		"ok": failed == 0,
		"passed": passed,
		"failed": failed,
		"failures": failures,
		"errors": failures,
		"canonicalFiles": canonical_results
	}


func _test_stable_json() -> void:
	_expect(StableJson.stringify({"z": -0.0, "a": 1.23456789, "array": [2, true]}) == "{\"a\":1.234568,\"array\":[2,true],\"z\":0}", "Stable JSON ordering/number normalization")
	_expect(StableJson.stringify({"b": 2, "a": 1}).sha256_text() == "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777", "SHA-256 known vector")


func _test_input_map() -> void:
	for action in ["move_left", "move_right", "move_up", "move_down", "jump", "dash", "rope", "hard_bar", "bash", "grab", "reset"]:
		var events := InputMap.action_get_events(action)
		_expect(events.any(func(event: InputEvent) -> bool: return event is InputEventJoypadButton or event is InputEventJoypadMotion), "Controller mapping exists for %s" % action)
	for action in ["move_left", "move_right", "move_up", "move_down"]:
		_expect(InputMap.action_get_events(action).any(func(event: InputEvent) -> bool: return event is InputEventJoypadMotion), "Analog stick axis maps %s" % action)


func _test_validator(world: Dictionary) -> void:
	var issues := WorldPackageValidator.new().validate(world)
	_expect(issues.filter(func(issue: Dictionary) -> bool: return issue.severity == "error").is_empty(), "Synthetic canonical world validates")


func _test_prefab_scene_boundary(world: Dictionary) -> void:
	_expect(CablesterFileUtils.approved_prefab_scene_path("res://godot/prefabs/canonical_object.tscn") == "res://godot/prefabs/canonical_object.tscn", "Approved project prefab path is preserved")
	for unsafe_path in [
		"user://external.tscn",
		"/tmp/external.tscn",
		"res://godot/prefabs/../runtime/external.tscn",
		"res://godot/runtime/external.tscn",
		"res://godot/prefabs/external.scn"
	]:
		var invalid := world.duplicate(true)
		invalid.prefabRegistry.entries[0].godotScene = unsafe_path
		invalid.manifest.contentHash = StableJson.content_hash(invalid)
		var issues := WorldPackageValidator.new().validate(invalid)
		_expect(issues.any(func(issue: Dictionary) -> bool: return issue.code == "invalid-godot-scene" and issue.severity == "error"), "Unsafe prefab scene is rejected: %s" % unsafe_path)
		var result := WorldImporter.new().import_world(invalid, "<unsafe-prefab-fixture>", {"artifactDir": "artifacts/godot/test"})
		_expect(not bool(result.ok), "Importer refuses unsafe prefab scene before instantiation: %s" % unsafe_path)


func _test_importer(world: Dictionary) -> void:
	var importer := WorldImporter.new()
	var result := importer.import_world(world, "<headless-fixture>", {"artifactDir": "artifacts/godot/test"})
	_expect(bool(result.ok), "Importer accepts the synthetic world")
	_expect(str(result.snapshot.sourceContentHash) == str(world.manifest.contentHash), "Snapshot preserves source contentHash")
	_expect(int(result.normalizedManifest.semanticDiffCount) == 0, "Normalized manifest semantic diff is zero")
	var object: Dictionary = result.snapshot.regions[0].chunks[0].objects[0]
	_expect(object.resolvedTransform.position == {"x": 115, "y": 76}, "Region/chunk/object transforms compose deterministically")
	_expect(object.collisionBounds == {"x": 115, "y": 76, "w": 200, "h": 30}, "Resolved collision AABB uses registry pivot and gameplay scale")
	_expect(FileAccess.file_exists(CablesterFileUtils.project_path(result.snapshotPath)), "Resolved snapshot artifact is written")
	_expect(FileAccess.file_exists(CablesterFileUtils.project_path(result.manifestPath)), "Normalized manifest artifact is written")


func _test_unknown_required_type(world: Dictionary) -> void:
	var invalid := world.duplicate(true)
	invalid.regions[0].chunks[0].objects[0].type = "unknownRequiredMechanism"
	invalid.manifest.contentHash = StableJson.content_hash(invalid)
	var issues := WorldPackageValidator.new().validate(invalid)
	_expect(issues.any(func(issue: Dictionary) -> bool: return issue.code == "unknown-required-type" and issue.severity == "error"), "Unknown required type fails import")


func _test_state_store(world: Dictionary) -> void:
	var store := WorldStateStore.new()
	store.configure(world)
	store.set_flag("route-open")
	store.unlock_ability("doubleJump")
	store.checkpoint = {"id": "checkpoint", "chunkId": "c1", "position": {"x": 12, "y": 34}}
	var data := store.to_dictionary()
	var restored := WorldStateStore.new()
	restored.configure(world)
	var result := restored.from_dictionary(data)
	_expect(bool(result.ok) and restored.has_flag("route-open"), "Persistent world flag round-trips")
	_expect(restored.has_ability("doubleJump"), "Unlocked ability round-trips")
	_expect(restored.checkpoint.id == "checkpoint", "Checkpoint round-trips")
	var stale := data.duplicate(true)
	stale.contentHash = "sha256:stale"
	_expect(not bool(restored.from_dictionary(stale).ok), "Stale contentHash save is rejected")


func _test_chunk_state_policy_persistence() -> void:
	var formal_loaded := CablesterFileUtils.read_json("worlds/formal/first-forest.world.json")
	var labs_loaded := CablesterFileUtils.read_json("worlds/labs/cablester-3c-labs.world.json")
	_expect(bool(formal_loaded.ok) and bool(labs_loaded.ok), "Formal and labs state-policy packages are readable")
	if not formal_loaded.ok or not labs_loaded.ok: return
	var cases := [
		{"label": "formal", "world": formal_loaded.data, "from": "seedgate-verge", "to": "lantern-crossing", "persists": true},
		{"label": "labs", "world": labs_loaded.data, "from": "movement-lab-01", "to": "hard-bar-lab", "persists": false}
	]
	for test_case in cases:
		var store := WorldStateStore.new()
		store.configure(test_case.world, test_case.from)
		store.unlock_ability("bash")
		store.set_flag("state-policy-probe")
		store.checkpoint = {"id": "probe", "chunkId": test_case.from, "position": {"x": 12, "y": 34}}
		store.enter_chunk(test_case.to, test_case.from)
		_expect(store.has_ability("bash") == bool(test_case.persists), "%s worldPersistence controls abilities across chunks" % test_case.label)
		_expect(store.has_flag("state-policy-probe") == bool(test_case.persists), "%s worldPersistence controls flags across chunks" % test_case.label)
		_expect((not store.checkpoint.is_empty()) == bool(test_case.persists), "%s worldPersistence controls checkpoint across chunks" % test_case.label)

	var labs_store := WorldStateStore.new()
	labs_store.configure(labs_loaded.data, "movement-lab-01")
	labs_store.unlock_ability("bash")
	labs_store.set_flag("state-policy-probe")
	var lab_save := labs_store.to_dictionary()
	_expect(lab_save.abilities.is_empty() and lab_save.flags.is_empty() and lab_save.checkpoint.is_empty(), "Labs empty worldPersistence excludes global progress from save data")
	var formal_store := WorldStateStore.new()
	formal_store.configure(formal_loaded.data, "seedgate-verge")
	formal_store.unlock_ability("bash")
	formal_store.set_flag("state-policy-probe")
	var formal_save := formal_store.to_dictionary()
	_expect(bool(formal_save.abilities.get("bash", false)) and bool(formal_save.flags.get("state-policy-probe", false)), "Formal worldPersistence serializes abilities and flags")


func _test_scene_layer_semantics() -> void:
	var root := Node2D.new()
	add_child(root)
	var camera := Camera2D.new()
	root.add_child(camera)
	camera.enabled = true
	var layer := CanonicalSceneLayer.new()
	root.add_child(layer)
	layer.configure({"id": "parallax-test", "visible": true, "parallax": 0.5, "blendMode": "multiply", "assets": []}, {}, {"x": 0, "y": 0, "w": 640, "h": 360})
	camera.global_position = Vector2(200, 100)
	layer._process(0.0)
	_expect(layer.position.is_equal_approx(Vector2(100, 50)), "Scene layer applies canonical parallax against active Camera2D")
	_expect(layer.material is CanvasItemMaterial and (layer.material as CanvasItemMaterial).blend_mode == CanvasItemMaterial.BLEND_MODE_MUL, "Scene layer applies canonical blend mode material")
	root.queue_free()
	await get_tree().process_frame


func _test_reset_policy_matrix(world: Dictionary) -> void:
	var root := Node2D.new()
	add_child(root)
	var cases := [
		{"id": "persistent-tag", "type": "stateTrigger", "tags": ["persistent-state"], "properties": {"oneUse": true, "resetOnDeath": false}, "death": true, "room": true},
		{"id": "explicit-persistent", "type": "stateTrigger", "tags": [], "properties": {"oneUse": true, "resetPolicy": "persistent"}, "death": true, "room": true},
		{"id": "death-scope", "type": "fragilePlatform", "tags": [], "properties": {"oneUse": true, "resetPolicy": "death", "resetOnDeath": true}, "death": false, "room": false},
		{"id": "room-scope", "type": "stateTrigger", "tags": [], "properties": {"oneUse": true, "resetPolicy": "room", "resetOnDeath": false}, "death": true, "room": false},
		{"id": "mandatory-pickup", "type": "abilityPickup", "tags": ["mandatory-ability", "persistent-state"], "properties": {"abilityId": "doubleJump"}, "death": true, "room": true}
	]
	for test_case in cases:
		for policy in ["death", "room"]:
			var object := CanonicalObject.new()
			root.add_child(object)
			object.configure({
				"id": test_case.id, "type": test_case.type, "transform": {"position": {"x": 0, "y": 0}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}},
				"properties": test_case.properties.duplicate(true), "links": [], "tags": test_case.tags.duplicate()
			}, {
				"id": test_case.type, "godotRuntimeHandler": test_case.type,
				"boundsAdapter": {"kind": "point", "radius": 12}, "pivot": {"x": 0.5, "y": 0.5, "mode": "center"}, "collisionSemantics": "trigger"
			})
			object.consume_pickup()
			object.reset_for_policy(policy)
			var remains_consumed := not object.is_available()
			_expect(remains_consumed == bool(test_case[policy]), "Reset matrix %s survives %s = %s" % [test_case.id, policy, test_case[policy]])
			object.queue_free()
	await get_tree().process_frame

	var pickup_store := WorldStateStore.new()
	pickup_store.configure(world, "c1")
	var pickup := CanonicalObject.new()
	root.add_child(pickup)
	pickup.configure({
		"id": "persisted-pickup", "type": "abilityPickup", "transform": {"position": {"x": 0, "y": 0}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}},
		"properties": {"abilityId": "doubleJump"}, "links": [], "tags": ["mandatory-ability", "persistent-state"]
	}, {"id": "abilityPickup", "godotRuntimeHandler": "abilityPickup", "boundsAdapter": {"kind": "point", "radius": 12}, "pivot": {"x": 0.5, "y": 0.5, "mode": "center"}, "collisionSemantics": "trigger"})
	pickup.consume_pickup()
	pickup_store.unlock_ability("doubleJump")
	pickup_store.capture_object(pickup)
	var saved := pickup_store.to_dictionary()
	var restored := WorldStateStore.new()
	restored.configure(world, "c1")
	_expect(bool(restored.from_dictionary(saved).ok) and restored.has_ability("doubleJump") and bool(restored.object_states.get("persisted-pickup", {}).get("consumed", false)), "Mandatory pickup consumed state survives save-load")
	pickup.queue_free()
	root.queue_free()


func _test_chunk_scoped_starting_abilities() -> void:
	var loaded := CablesterFileUtils.read_json("worlds/formal/first-forest.world.json")
	_expect(bool(loaded.ok), "Formal world is available for scoped ability test")
	if not loaded.ok: return
	var seedgate := WorldStateStore.new()
	seedgate.configure(loaded.data, "seedgate-verge")
	_expect(seedgate.has_ability("rope") and seedgate.has_ability("hardBar") and seedgate.has_ability("dash") and seedgate.has_ability("wallGrab"), "Start chunk grants its four declared initial abilities")
	_expect(not seedgate.has_ability("doubleJump") and not seedgate.has_ability("glide") and not seedgate.has_ability("bash"), "Start chunk does not union later-chunk abilities")
	var canopy := WorldStateStore.new()
	canopy.configure(loaded.data, "wind-terraces")
	_expect(canopy.has_ability("doubleJump") and not canopy.has_ability("glide") and not canopy.has_ability("bash"), "Replay spawn chunk selects only that chunk's declared ability set: %s" % JSON.stringify(canopy.abilities))


func _test_approved_tuning_values(world: Dictionary) -> void:
	var store := WorldStateStore.new()
	store.configure(world, "c1")
	var player := CablesterPlayer.new()
	player.state_store = store
	player.tuning = {"values": {"runSpeed": 777.0}}
	_expect(player._t("runSpeed", -1.0) == 777.0, "Player reads approved tuning values map")
	player.free()


func _test_player_rule_helpers() -> void:
	var loaded := CablesterFileUtils.read_json("worlds/labs/cablester-3c-labs.world.json")
	_expect(bool(loaded.ok), "Canonical approved tuning is readable for behavior-rule integration")
	if not loaded.ok: return
	var tuning: Dictionary = loaded.data.get("gameplayTuning", {}).get("approved", {})
	var rules = PLAYER_PHYSICS_RULES
	var fixed: Dictionary = rules.fixed_step_contract(1.0 / 120.0, tuning)
	_expect(bool(fixed.declared_matches_rounded_contract) and bool(fixed.replay_matches_exact_step), "Physics rules enforce exact 120 Hz and rounded package fixed-step contract")
	_expect(rules.apply_ground_friction(Vector2(300, 80), Vector2.DOWN, true, true, false, 0.0, 0.05, tuning).is_equal_approx(Vector2(155, 80)), "Physics rules consume approved ground friction")
	_expect(rules.compute_damage_recovery_velocity(Vector2(0, 500), Vector2.DOWN, Vector2.RIGHT, tuning).is_equal_approx(Vector2(150, -370)), "Physics rules consume approved damage lift and away speed")
	_expect(rules.is_goal_reached(Vector2(78, 0), 18, Vector2.ZERO, 34, tuning), "Physics rules include approved goal activation padding")
	_expect(rules.apply_glide_fall_cap(Vector2(40, 400), Vector2.DOWN, tuning).is_equal_approx(Vector2(40, 190)), "Physics rules cap glide fall speed")
	_expect(rules.apply_updraft_entry(Vector2(0, 200), Vector2.DOWN, true, tuning).is_equal_approx(Vector2(0, -300)), "Physics rules apply updraft entry lift")
	_expect(is_equal_approx(rules.regenerate_safe_energy(1.0, true, false, 1.0, 0.5, tuning), 1.675), "Physics rules regenerate only safe floor energy")
	var tip: Dictionary = rules.advance_rope_tip(Vector2.ZERO, Vector2(220, 0), "firing", 0.05, tuning)
	_expect(tip.tip.is_equal_approx(Vector2(110, 0)) and not bool(tip.reached), "Physics rules animate a finite-speed rope tip")
	var winch: Dictionary = rules.apply_rope_winch({"length": 90.0, "reel_speed": 480.0, "vx": 0.0, "vy": 0.0}, Vector2.RIGHT, 1.0 / 60.0, tuning)
	_expect(float(winch.length) == 82.0 and bool(winch.completed) and winch.velocity.x < -240.0, "Physics rules apply one-shot rope winch completion boost")
	var swing: Dictionary = rules.apply_swing_input(Vector2.ZERO, Vector2(0, 100), Vector2.ZERO, Vector2.RIGHT, 1.0, 0.0, true, 1.0 / 120.0, tuning)
	_expect(swing.velocity.length() >= 82.0, "Physics rules apply approved swing start kick")
	var camera: Dictionary = rules.camera_follow_step(Vector2.ZERO, Vector2(100, 50), Vector2(20, 40), false, 0.1, tuning)
	_expect(camera.position.x > 0.0 and camera.desired.is_equal_approx(Vector2(103.6, 53.24)), "Physics rules apply camera follow and velocity look-ahead")
	var rotation: Dictionary = rules.rotation_step(0.0, 2.0, 0.525, 0.1, tuning)
	_expect(is_equal_approx(float(rotation.angle), 1.0), "Physics rules apply approved cubic rotation duration")
	var visual_result: Dictionary = PLAYER_VISUAL_STATE_UNIT.new().run()
	passed += int(visual_result.passed)
	failed += int(visual_result.failed)
	for failure in visual_result.failures: failures.append("PlayerVisualState: %s" % failure)
	_expect(bool(visual_result.ok), "Player visual state helper passes all render-only behavior assertions")


func _test_replay_contract(world: Dictionary) -> void:
	var replay := {
		"replayVersion": 1,
		"worldId": world.manifest.worldId,
		"contentHash": world.manifest.contentHash,
		"gameplayTuningVersion": world.manifest.gameplayTuningVersion,
		"fixedDelta": 1.0 / 120.0,
		"spawn": {"chunkId": "c1", "entranceId": "entry-c1"},
		"frames": [
			{"tick": 0, "actions": {"move_right": true}},
			{"tick": 12, "actions": {"move_right": false, "jump": true}},
			{"tick": 13, "actions": {}}
		],
		"expectations": {"maxDurationSeconds": 0.2, "visitedChunks": ["c1"], "maxDeaths": 0}
	}
	var runner := ReplayRunner.new()
	var result := runner.configure(replay, world)
	_expect(bool(result.ok), "Fixed-input replay v1 validates")
	_expect(bool(runner.input_for_tick(0).actions.move_right), "Sparse replay frame starts held action")
	_expect(bool(runner.input_for_tick(5).actions.move_right), "Sparse replay action remains held")
	_expect(bool(runner.input_for_tick(12).actions.jump) and not bool(runner.current_actions.move_right), "Replay complete held-state replaces prior frame")
	var invalid := replay.duplicate(true)
	invalid.contentHash = "sha256:stale"
	_expect(not bool(ReplayRunner.new().configure(invalid, world).ok), "Replay contentHash mismatch is rejected")
	var expectation_runtime := WorldRuntime.new()
	expectation_runtime.last_exit_id = ""
	var expectation_store := WorldStateStore.new()
	expectation_store.configure(world, "c1")
	expectation_store.visited_chunks.c1 = true
	expectation_runtime.state_store = expectation_store
	var expectation_telemetry := RuntimeTelemetry.new()
	expectation_telemetry.counters.deaths = 0
	expectation_runtime.telemetry = expectation_telemetry
	_expect(runner.check_expectations(expectation_runtime).is_empty(), "Replay expectations validate visited chunks and max deaths")
	expectation_telemetry.counters.deaths = 1
	_expect(runner.check_expectations(expectation_runtime).any(func(message: String) -> bool: return "at most 0 deaths" in message), "Replay maxDeaths rejects excess deaths")
	expectation_runtime.free()


func _test_replay_physics_order(world: Dictionary) -> void:
	var root := Node2D.new()
	add_child(root)
	var store := WorldStateStore.new()
	store.configure(world, "c1")
	var player := CablesterPlayer.new()
	root.add_child(player)
	player.process_physics_priority = -10
	player.configure(root, store, {"values": {"gravity": 0.0, "runAcceleration": 3600.0, "airAcceleration": 3600.0, "runSpeed": 350.0}}, world)
	var replay := ReplayRunner.new()
	var replay_data := {
		"replayVersion": 1, "worldId": world.manifest.worldId, "contentHash": world.manifest.contentHash,
		"gameplayTuningVersion": world.manifest.gameplayTuningVersion, "fixedDelta": 1.0 / 120.0,
		"spawn": {"chunkId": "c1"}, "frames": [{"tick": 0, "actions": {"move_right": true}}],
		"expectations": {"maxDurationSeconds": 1.0}
	}
	_expect(bool(replay.configure(replay_data, world).ok), "Replay order fixture configures")
	var runtime := WorldRuntime.new()
	_expect(runtime.process_physics_priority < player.process_physics_priority, "WorldRuntime physics priority injects replay input before player")
	runtime.player = player
	runtime.streamer = ChunkStreamer.new()
	runtime.replay_runner = replay
	runtime.replay_done = false
	runtime.tick = 0
	runtime.telemetry.begin(world, "replay-order-fixture")
	player.physics_step_completed.connect(runtime._after_player_physics)
	runtime._physics_process(1.0 / 120.0)
	player._physics_process(1.0 / 120.0)
	_expect(player.velocity.x > 0.0 and runtime.replay_input_tick == 0, "Replay tick zero affects the player's first physics step")
	var first_sample: Dictionary = runtime.telemetry.trajectory[0] if not runtime.telemetry.trajectory.is_empty() else {}
	_expect(int(first_sample.get("tick", -1)) == 0 and float(first_sample.get("velocity", {}).get("x", 0.0)) > 0.0 and runtime.tick == 1, "Replay telemetry tick zero samples the post-player physics state")
	# maximumTick=0 is not cleared until the following runtime callback, proving
	# the final frame reaches the player before completion.
	_expect(player.use_replay_input and bool(player.replay_input.get("move_right", false)), "Replay final held frame is not cleared before player physics")
	runtime.streamer.free()
	runtime.free()
	player.queue_free()
	root.queue_free()
	await get_tree().process_frame


func _test_gate_semantics(world: Dictionary) -> void:
	var store := WorldStateStore.new()
	store.configure(world)
	store.unlock_ability("dash")
	store.set_flag("route-open")
	var player := CablesterPlayer.new()
	player.state_store = store
	var object := CanonicalObject.new()
	object.canonical_properties = {"requiredAbility": "", "requiredFlag": ""}
	_expect(player._gate_satisfied(object), "Exit with no ability or flag gate is open")
	object.canonical_properties = {"requiredAbility": "dash", "requiredFlag": ""}
	_expect(player._gate_satisfied(object), "Ability-only exit gate is open when ability is owned")
	object.canonical_properties = {"requiredAbility": "", "requiredFlag": "route-open"}
	_expect(player._gate_satisfied(object), "Flag-only exit gate is open when flag is set")
	object.canonical_properties = {"requiredAbility": "dash", "requiredFlag": "route-open"}
	_expect(player._gate_satisfied(object), "Ability-and-flag exit gate requires both satisfied")
	object.canonical_properties = {"requiredAbility": "doubleJump", "requiredFlag": "route-open"}
	_expect(not player._gate_satisfied(object), "Ability-and-flag exit gate remains closed when one condition is missing")
	var connection_world := world.duplicate(true)
	connection_world.regions[0].chunks[0].connections[0].requiredAbilities = ["dash"]
	connection_world.regions[0].chunks[0].connections[0].requiredFlags = ["route-open"]
	player.canonical_world = connection_world
	object.chunk_id = "c1"
	object.canonical_properties = {"targetChunkId": "c2", "targetEntranceId": "entry-c2", "requiredAbility": "", "requiredFlag": ""}
	store.abilities = {}
	store.flags["route-open"] = false
	_expect(not player._gate_satisfied(object), "Canonical connection rejects exit when ability and flag are missing")
	store.unlock_ability("dash")
	_expect(not player._gate_satisfied(object), "Canonical connection remains closed until required flag is set")
	store.set_flag("route-open")
	_expect(player._gate_satisfied(object), "Canonical connection opens after required ability and flag are satisfied")
	player.free()
	object.free()


func _test_player_mechanics(world: Dictionary) -> void:
	var root := Node2D.new()
	root.name = "BehaviorWorld"
	add_child(root)
	var store := WorldStateStore.new()
	store.configure(world, "c1")
	for ability in ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"]: store.unlock_ability(ability)
	var approved := {
		"values": {
			"gravity": 1550, "runSpeed": 350, "runAcceleration": 2500, "airAcceleration": 1100,
			"jumpSpeed": 590, "jumpBufferTime": 0.12, "coyoteTime": 0.12, "playerRadius": 18,
			"maximumEnergy": 6, "maximumHealth": 5, "dashCapacity": 1, "dashSpeed": 850, "dashDuration": 0.16,
			"ropeMaximumLength": 470, "ropeMinimumLength": 82, "ropeCost": 0.5,
			"hardBarMaximumLength": 330, "hardBarCost": 1.25, "bashRange": 185, "bashCost": 0.75, "bashSpeed": 960,
			"glideGravityScale": 0.2, "glideWindMultiplier": 1.9, "wallSlideSpeed": 85,
			"terminalSpeed": 1180, "damageInvulnerability": 1
		}
	}
	var player := CablesterPlayer.new()
	root.add_child(player)
	player.configure(root, store, approved, world)
	player.checkpoint_position = Vector2.ZERO

	player.set_input_frame({"move_right": true})
	player._physics_process(1.0 / 120.0)
	_expect(player.velocity.x > 0.0, "Run input accelerates player along the ground tangent")
	player.coyote_timer = 0.1
	player.set_input_frame({"jump": true})
	player._physics_process(1.0 / 120.0)
	_expect(player.velocity.y < 0.0 and player.jump_buffer == 0.0, "Coyote-time jump consumes the buffered jump")
	player.velocity = Vector2.ZERO
	player.coyote_timer = 0.0
	player.air_jumps = 0
	player._previous_actions = {}
	player.set_input_frame({"jump": true})
	player._physics_process(1.0 / 120.0)
	var buffered_before_landing := player.jump_buffer
	player.set_input_frame({})
	player.coyote_timer = 0.1
	player._physics_process(1.0 / 120.0)
	_expect(buffered_before_landing > 0.0 and player.velocity.y < 0.0, "Jump buffer fires when a valid coyote/landing window appears")

	player.velocity = Vector2.ZERO
	player.coyote_timer = 0.0
	player.air_jumps = 1
	player._previous_actions = {}
	player.set_input_frame({"jump": true})
	player._physics_process(1.0 / 120.0)
	_expect(player.air_jumps == 0 and player.velocity.y < 0.0, "Double jump consumes one air jump and applies lift")

	var anchor := _make_behavior_object(root, "anchor-test", "anchor", Vector2(160, 0), {"anchorType": "both"}, {"kind": "point", "radius": 12})
	player.global_position = Vector2.ZERO
	player.energy = 6.0
	player._try_attach("rope")
	_expect(player.attached_object == anchor and player.rope_phase == "firing" and player.attached_mode.is_empty() and player.energy == 5.5, "Soft rope starts its canonical firing phase and spends approved energy")
	for index in range(12): player._advance_rope_phase(1.0 / 120.0)
	_expect(player.attached_mode == "rope" and player.rope_phase == "attached", "Soft rope attaches only after its animated tip reaches the target")
	player.detach()
	player._try_attach("hardBar")
	_expect(player.attached_object == anchor and player.attached_mode == "hardBar" and player.energy == 4.25, "Hard bar attaches only to a both-mode anchor at fixed length")
	_expect(player.attached_target_id == "anchor-test", "Point attachment telemetry uses exact canonical anchor ID")
	player.detach()

	var bash_target := _make_behavior_object(root, "bash-test", "bashTarget", Vector2(120, 0), {}, {"kind": "point", "radius": 12})
	player.global_position = Vector2.ZERO
	player.aim_world = Vector2(500, -100)
	var energy_before_bash := player.energy
	player._begin_bash_aim()
	_expect(player.bash_aim_target == bash_target and player.velocity.length() < 950.0 and player.energy < energy_before_bash, "Bash press enters aim state and spends energy without launching")
	player._finish_bash_aim()
	_expect(player.velocity.length() > 950.0 and player.global_position.is_equal_approx(Vector2.ZERO), "Bash release launches without teleporting the player")

	player.global_position = Vector2.ZERO
	player.aim_world = anchor.global_position
	player.energy = 6.0
	player._previous_actions = {}
	player.set_input_frame({"hard_bar": true}, anchor.global_position)
	player._physics_process(1.0 / 120.0)
	var toggled_on := player.attached_mode == "hardBar"
	player.set_input_frame({}, anchor.global_position)
	player._physics_process(1.0 / 120.0)
	player.set_input_frame({"hard_bar": true}, anchor.global_position)
	player._physics_process(1.0 / 120.0)
	_expect(toggled_on and player.attached_mode.is_empty(), "Hard bar F input toggles attachment instead of requiring a hold")
	anchor.position = Vector2(1000, 0)
	var bar_surface := _make_behavior_object(root, "hard-bar-surface", "platform", Vector2(150, -20), {"w": 100, "h": 40}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2.ZERO
	player.aim_world = Vector2(150, 0)
	player.energy = 6.0
	player._try_attach("hardBar")
	_expect(player.attached_object == bar_surface and player.attached_mode == "hardBar", "Hard bar attaches to aimed platform collision surfaces without canonical anchors")
	_expect(player.attached_target_id == "hard-bar-surface:left", "Hard-bar surface telemetry uses stable object:face target ID")
	player.detach()

	player.global_position = Vector2(600, 0)
	player.velocity = Vector2.ZERO
	player.dash_charges = 1
	player.set_input_frame({"move_right": true})
	player._try_dash()
	_expect(player.dash_charges == 0 and player.dash_timer > 0.0 and player.velocity.x == 850.0, "Dash consumes a charge and applies approved speed")
	var refill := _make_behavior_object(root, "refill-test", "dashRefill", player.global_position, {"radius": 24, "charges": 1, "restoreMode": "fill", "oneUse": false, "respawnSeconds": 0.1}, {"kind": "circle", "radiusProperty": "radius"})
	player._process_contacts(0.0)
	_expect(player.dash_charges == 1 and not refill.visible, "Dash refill restores charge and enters cooldown")
	refill._update_timers(0.2)
	_expect(refill.visible and refill.is_available(), "Reusable dash refill respawns deterministically")

	var wind := _make_behavior_object(root, "wind-test", "windZone", Vector2(700, 0), {"w": 200, "h": 200, "forceX": 600, "forceY": -400}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(750, 50)
	player.velocity = Vector2(0, 300)
	player.dash_timer = 0.0
	player.air_jumps = 0
	player._previous_actions = {"jump": true}
	player.set_input_frame({"jump": true})
	player._physics_process(1.0 / 120.0)
	_expect(player.velocity.x > 5.0 and player.velocity.y < 300.0, "Glide multiplies wind and limits downward acceleration in a wind zone")

	var liquid := _make_behavior_object(root, "liquid-test", "liquidZone", Vector2(1000, 0), {"w": 200, "h": 200, "gravityScale": 0.24, "drag": 2.4, "currentX": 480, "currentY": 0, "swimAcceleration": 680, "contactDamage": 0}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(1050, 50)
	player.velocity = Vector2.ZERO
	player._previous_actions = {}
	player.set_input_frame({})
	player._physics_process(1.0 / 120.0)
	_expect(player._first_zone("liquidZone") == liquid and player.velocity.x > 0.0 and player.velocity.y < 10.0, "Liquid applies drag/current and scaled gravity (velocity=%s)" % player.velocity)

	var launcher := _make_behavior_object(root, "launcher-test", "launcher", Vector2(1300, 0), {"w": 80, "h": 40, "launchX": 240, "launchY": -900, "cooldownSeconds": 0.35, "preserveMomentum": false}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(1320, 20)
	player.velocity = Vector2.ZERO
	player._process_contacts(0.0)
	_expect(player.velocity == Vector2(240, -900) and float(player._launcher_cooldowns[launcher.object_id]) > 0.0, "Launcher applies exact configured impulse and cooldown")

	var moving := _make_behavior_object(root, "moving-test", "movingObject", Vector2(1500, 0), {"objectKind": "platform", "w": 80, "h": 20, "pathPoints": "0,0;100,0", "speed": 100, "dwellSeconds": 0, "loopMode": "pingpong", "trigger": "auto"}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	var moving_start := moving.position
	moving._update_motion(0.5)
	_expect(moving.position.x > moving_start.x and moving.position.x <= moving_start.x + 50.01, "Moving object advances deterministically along canonical path")

	var fragile := _make_behavior_object(root, "fragile-test", "fragilePlatform", Vector2(1700, 0), {"w": 100, "h": 20, "breakDelaySeconds": 0.05, "respawnSeconds": 0.1, "oneUse": false, "resetOnDeath": true}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	fragile.trigger_fragile()
	fragile._update_timers(0.06)
	_expect(not fragile.visible and bool(fragile.capture_state().get("gone", false)), "Fragile platform breaks after configured delay")
	fragile._update_timers(0.11)
	_expect(fragile.visible and not bool(fragile.capture_state().get("gone", false)), "Fragile platform respawns after configured delay")

	var gate := _make_behavior_object(root, "gate-test", "gate", Vector2(1900, 0), {"w": 40, "h": 120, "requiredFlag": "route-open", "requiredAbility": "", "openWhen": "any", "initiallyOpen": false, "latchOpen": true}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	var trigger := _make_behavior_object(root, "trigger-test", "stateTrigger", Vector2(1800, 0), {"w": 80, "h": 80, "setFlag": "route-open", "clearFlag": "", "oneUse": true}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	store.flags["route-open"] = false
	player.global_position = Vector2(1820, 20)
	player._process_contacts(0.0)
	_expect(store.has_flag("route-open") and not gate.visible and not trigger.visible, "State trigger persists flag, opens gate, and honors one-use policy")

	var checkpoint := _make_behavior_object(root, "checkpoint-test", "checkpoint", Vector2(2100, 0), {"w": 90, "h": 90, "spawnOffsetX": 45, "spawnOffsetY": 40}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(2120, 20)
	player._process_contacts(0.0)
	_expect(player.current_checkpoint_id == checkpoint.object_id and store.checkpoint.id == checkpoint.object_id, "Checkpoint records stable id, chunk and respawn position")
	player.global_position = Vector2(2500, 300)
	player.health = 1
	player.invulnerability = 0
	player._take_damage(2)
	_expect(player.respawn_timer > 0.0 and player.global_position != player.checkpoint_position, "Lethal damage begins the approved delayed respawn window")
	for index in range(70):
		player._physics_process(1.0 / 120.0)
		if player.respawn_timer <= 0.0: break
	_expect(player.global_position == player.checkpoint_position and player.health == 5.0, "Delayed death restores checkpoint position, health and movement resources")

	var rotation := _make_behavior_object(root, "rotation-test", "rotationTrigger", Vector2(2300, 0), {"w": 80, "h": 80, "deltaDegrees": 90}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(2320, 20)
	player.gravity_direction = Vector2.DOWN
	var rotation_requests: Array[float] = []
	player.rotation_requested.connect(func(delta: float) -> void: rotation_requests.append(delta))
	player._process_contacts(0.0)
	_expect(rotation_requests.size() == 1 and is_equal_approx(rotation_requests[0], PI * 0.5) and player.gravity_direction.is_equal_approx(Vector2.DOWN), "Rotation trigger requests a timed camera rotation without snapping player gravity")

	var exit := _make_behavior_object(root, "exit-test", "roomExit", Vector2(2500, 0), {"w": 80, "h": 120, "targetChunkId": "c2", "targetEntranceId": "entry-c2", "requiredAbility": "", "requiredFlag": ""}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	exit.chunk_id = "c1"
	var goal := _make_behavior_object(root, "goal-test", "goal", Vector2(2700, 0), {"radius": 34}, {"kind": "circle", "radiusProperty": "radius"})
	var reached: Array[String] = []
	player.exit_reached.connect(func(object: CanonicalObject) -> void: reached.append(object.object_id))
	# Synthetic connection is gated; satisfy it to prove canonical gates are used.
	store.unlock_ability("dash")
	store.set_flag("route-open")
	var gated_world := world.duplicate(true)
	gated_world.regions[0].chunks[0].connections[0].requiredAbilities = ["dash"]
	gated_world.regions[0].chunks[0].connections[0].requiredFlags = ["route-open"]
	player.canonical_world = gated_world
	player.exit_contact_cooldown = 0.0
	player.global_position = Vector2(2520, 20)
	player._process_contacts(0.0)
	player.global_position = Vector2(2700, 0)
	player._process_contacts(0.0)
	_expect(reached.has(exit.object_id) and reached.has(goal.object_id), "Satisfied room exit and goal emit deterministic completion events")

	# Wall grab consumes the same canonical radius-circle contact as Web.
	var wall := _make_behavior_object(root, "wall-grab-platform", "platform", Vector2(2920, 0), {"w": 20, "h": 300}, {"kind": "rect", "widthProperty": "w", "heightProperty": "h"})
	player.global_position = Vector2(2880, 100)
	player.velocity = Vector2(900, 420)
	player._previous_actions = {"grab": true}
	player.set_input_frame({"grab": true, "move_right": true})
	await get_tree().physics_frame
	player._physics_process(1.0 / 60.0)
	player._physics_process(1.0 / 60.0)
	player._physics_process(1.0 / 60.0)
	_expect(not player.collision_wall_normal.is_zero_approx() and player.velocity.dot(player.gravity_direction) < 150.0, "Wall grab caps fall speed against canonical circle collision (wallNormal=%s velocity=%s gravity=%s)" % [player.collision_wall_normal, player.velocity, player.gravity_direction])
	wall.queue_free()

	root.queue_free()


func _make_behavior_object(root: Node, id: String, type_id: String, position: Vector2, properties: Dictionary, adapter: Dictionary) -> CanonicalObject:
	var object := CanonicalObject.new()
	object.position = position
	root.add_child(object)
	object.configure({
		"id": id, "type": type_id,
		"properties": properties, "links": [], "tags": [],
		"transform": {"position": {"x": position.x, "y": position.y}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}
	}, {
		"id": type_id, "godotRuntimeHandler": type_id, "boundsAdapter": adapter,
		"pivot": {"x": 0, "y": 0, "mode": "top-left"} if adapter.kind == "rect" else {"x": 0.5, "y": 0.5, "mode": "center"},
		"collisionSemantics": "solid" if type_id in ["gate", "fragilePlatform", "movingObject"] else "trigger"
	})
	return object


func _make_static_rect(root: Node, center: Vector2, size: Vector2) -> StaticBody2D:
	var body := StaticBody2D.new()
	body.position = center
	body.collision_layer = 1
	body.collision_mask = 0
	var collision := CollisionShape2D.new()
	var shape := RectangleShape2D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)
	root.add_child(body)
	return body


func _test_runtime_and_streaming(world: Dictionary) -> void:
	var importer := WorldImporter.new()
	var imported := importer.import_world(world, "<runtime-fixture>", {"artifactDir": "artifacts/godot/test"})
	var store := WorldStateStore.new()
	store.configure(world)
	var streamer := ChunkStreamer.new()
	add_child(streamer)
	streamer.configure(world, importer, store)
	var first := streamer.activate_chunk("c1", Vector2.RIGHT * 350.0)
	_expect(bool(first.ok), "Chunk activation succeeds atomically")
	_expect(streamer.loaded_chunks.has("c1") and streamer.loaded_chunks.has("c2"), "Active chunk prefetches one-hop neighbor")
	_expect(streamer.chunk_states.c1 == "active" and streamer.chunk_states.c2 == "prefetch", "Streaming states distinguish active and prefetch")
	_expect(streamer.loaded_chunks.c2.process_mode == Node.PROCESS_MODE_DISABLED, "sleep-local prefetch chunk pauses local simulation")
	_expect(streamer._adjacency.c2.has("c1"), "Non-one-way canonical edge derives reverse adjacency")
	var prior_generation := streamer.generation
	var second := streamer.activate_chunk("c2", Vector2.LEFT * 350.0)
	_expect(bool(second.ok) and streamer.generation == prior_generation + 1, "A-B transition advances generation")
	var third := streamer.activate_chunk("c1", Vector2.LEFT * 350.0)
	_expect(bool(third.ok) and streamer.active_chunk_id == "c1", "A-B-A transition remains valid")
	var root := importer.instantiate_world(world, imported.snapshot)
	add_child(root)
	await get_tree().process_frame
	_expect(root.get_tree().get_nodes_in_group("canonical_objects").size() >= 6, "Importer instantiates canonical runtime nodes")
	root.queue_free()
	streamer.queue_free()


func _advance_runtime_respawn(runtime: WorldRuntime, target_deaths: int) -> void:
	for index in range(90):
		runtime.player._physics_process(1.0 / 120.0)
		if int(runtime.telemetry.counters.deaths) >= target_deaths and runtime.player.respawn_timer <= 0.0: return


func _test_checkpoint_load_and_bounds() -> void:
	var source_path := "worlds/formal/first-forest.world.json"
	var first := WorldRuntime.new()
	add_child(first)
	var loaded := first.load_world(source_path, {"startChunkId": "seedgate-verge"})
	_expect(bool(loaded.ok), "Formal runtime loads for checkpoint restore matrix")
	if not loaded.ok:
		first.queue_free()
		return
	first.streamer.activate_chunk("wind-terraces")
	var checkpoint_object: CanonicalObject
	var wind_node: Node = first.streamer.loaded_chunks.get("wind-terraces")
	for candidate in wind_node.find_children("*", "CanonicalObject", true, false):
		if candidate.type_id == "checkpoint":
			checkpoint_object = candidate
			break
	_expect(checkpoint_object != null, "Checkpoint restore fixture resolves canonical target checkpoint")
	if checkpoint_object == null:
		first.queue_free()
		return
	first.state_store.set_checkpoint(checkpoint_object)
	first.state_store.set_flag("echo-seed-lit")
	var expected_position := Vector2(float(first.state_store.checkpoint.position.x), float(first.state_store.checkpoint.position.y))
	var expected_checkpoint_id := str(first.state_store.checkpoint.id)
	var saved := first.state_store.save_to_disk("headless-checkpoint-restore")
	_expect(bool(saved.ok), "Checkpoint matrix persists a content-hash-bound save")

	var restored := WorldRuntime.new()
	add_child(restored)
	var restored_load := restored.load_world(source_path, {
		"startChunkId": "seedgate-verge", "loadSave": true, "saveSlot": "headless-checkpoint-restore"
	})
	_expect(bool(restored_load.ok) and bool(restored_load.get("saveLoad", {}).get("checkpointRestored", false)), "loadSave accepts and restores a valid canonical checkpoint")
	_expect(restored.streamer.active_chunk_id == "wind-terraces" and restored.player.global_position.is_equal_approx(expected_position) and restored.player.current_checkpoint_id == expected_checkpoint_id, "loadSave resumes exact checkpoint chunk, position and stable id")
	_expect(restored.state_store.has_flag("echo-seed-lit") and not restored.state_store.has_ability("doubleJump"), "Checkpoint resume keeps saved state without granting destination chunk starting abilities")
	_expect(restored.follow_camera != null and restored.follow_camera.get_parent() == restored and restored.follow_camera.enabled, "Playable runtime enables an independently smoothed Camera2D")
	var camera_before := restored.follow_camera.global_position
	restored.player.velocity = Vector2(200, -100)
	restored._update_camera_and_rotation(1.0 / 120.0)
	_expect(restored.follow_camera.global_position != camera_before, "Playable camera consumes approved exponential follow and look-ahead")
	restored._on_rotation_requested(PI * 0.5)
	for index in range(151): restored._update_camera_and_rotation(1.0 / 120.0)
	_expect(not restored._camera_rotation_active and is_equal_approx(restored.follow_camera.rotation, PI * 0.5) and restored.player.gravity_direction.is_equal_approx(Vector2.RIGHT), "Timed camera rotation completes with inverse screen-down gravity")
	_expect(restored.runtime_hud != null and restored.runtime_hud.get_node_or_null("Backdrop/Info") != null, "Playable runtime exposes chunk, controls and build HUD")

	var deaths_before := int(restored.telemetry.counters.deaths)
	var recovery_band: Rect2 = restored._chunk_recovery_bands["wind-terraces"]
	restored.player.global_position = Vector2(recovery_band.get_center().x, recovery_band.position.y - restored.player.radius + 0.25)
	restored._enforce_world_bounds()
	_expect(restored.player.respawn_timer > 0.0 and int(restored.telemetry.counters.deaths) == deaths_before + 1, "Fall-recovery band records death at the start of its deterministic delay")
	_advance_runtime_respawn(restored, deaths_before + 1)
	_expect(int(restored.telemetry.counters.deaths) == deaths_before + 1 and restored.player.global_position.is_equal_approx(expected_position), "Fall-recovery band resumes exact checkpoint after approved delay")
	deaths_before = int(restored.telemetry.counters.deaths)
	restored.player.global_position = Vector2(1000000, 1000000)
	restored._enforce_world_bounds()
	_advance_runtime_respawn(restored, deaths_before + 1)
	_expect(int(restored.telemetry.counters.deaths) == deaths_before + 1 and restored.streamer.active_chunk_id == "wind-terraces" and restored.player.global_position.is_equal_approx(expected_position), "World bounds escape triggers one death and restores checkpoint chunk/position")

	var adjacent: String = str(restored.streamer._adjacency["wind-terraces"][0])
	var adjacent_center: Vector2 = restored._chunk_aabbs[adjacent].get_center()
	var adjacent_deaths := int(restored.telemetry.counters.deaths)
	restored.player.global_position = adjacent_center
	restored._enforce_world_bounds()
	_expect(restored.streamer.active_chunk_id == adjacent and int(restored.telemetry.counters.deaths) == adjacent_deaths, "World bounds accepts a legal adjacent chunk transition")
	var nonadjacent := ""
	for candidate_id in restored._chunk_aabbs:
		if candidate_id != adjacent and not restored.streamer.chunks_are_adjacent(adjacent, str(candidate_id)):
			nonadjacent = str(candidate_id)
			break
	_expect(not nonadjacent.is_empty(), "Bounds matrix resolves a non-adjacent canonical chunk")
	if not nonadjacent.is_empty():
		restored.player.global_position = restored._chunk_aabbs[nonadjacent].get_center()
		restored._enforce_world_bounds()
		restored._enforce_world_bounds()
		_advance_runtime_respawn(restored, adjacent_deaths + 1)
		_expect(int(restored.telemetry.counters.deaths) == adjacent_deaths + 1 and restored.streamer.active_chunk_id == "wind-terraces", "Non-adjacent bounds jump is rejected and respawns once")
	var telemetry_result := restored.telemetry.finish(restored.state_store, restored.streamer, restored.player, {})
	_expect(telemetry_result.has("finalPosition") and telemetry_result.has("finalResources") and telemetry_result.has("finalState") and telemetry_result.has("visitedChunks") and telemetry_result.has("deaths"), "Replay telemetry records final position, resources, state, visited chunks and deaths")
	first.queue_free()
	restored.queue_free()
	await get_tree().process_frame


func _test_lab_runtime_coverage() -> void:
	var loaded := CablesterFileUtils.read_json("worlds/labs/cablester-3c-labs.world.json")
	_expect(bool(loaded.ok), "Canonical 6+4 laboratory package is readable")
	if not loaded.ok: return
	var importer := WorldImporter.new()
	var imported := importer.import_world(loaded.data, "worlds/labs/cablester-3c-labs.world.json", {"artifactDir": "artifacts/godot/test"})
	_expect(bool(imported.ok), "Canonical 6+4 laboratory package imports without errors")
	if not imported.ok: return
	var type_ids: Dictionary = {}
	for entry in loaded.data.typeRegistry.entries: type_ids[str(entry.id)] = true
	var chunk_count := 0
	var instantiated_types: Dictionary = {}
	for region in loaded.data.regions:
		for chunk in region.chunks:
			chunk_count += 1
			var node := importer.instantiate_chunk(region, chunk)
			add_child(node)
			var runtime_objects := node.find_children("*", "CanonicalObject", true, false)
			var valid: bool = runtime_objects.size() == chunk.objects.size()
			for object in runtime_objects:
				valid = valid and not object.runtime_handler.is_empty() and type_ids.has(object.type_id)
				instantiated_types[object.type_id] = true
			_expect(valid, "Lab chunk %s instantiates every object with a registered handler" % chunk.id)
			node.queue_free()
	_expect(chunk_count == 10, "Godot runtime covers all 6 focused labs and 4 combined cases")
	var package_types: Dictionary = {}
	for region in loaded.data.regions:
		for chunk in region.chunks:
			for object in chunk.objects: package_types[str(object.type)] = true
	_expect(package_types.keys().all(func(id: String) -> bool: return instantiated_types.has(id)) and package_types.size() == 15, "6+4 labs instantiate all 15 object types present in canonical lab data")


func _test_forest_scene_landmarks() -> void:
	var loaded := CablesterFileUtils.read_json("worlds/formal/first-forest.world.json")
	_expect(bool(loaded.ok), "Formal forest is readable for scene-layer runtime test")
	if not loaded.ok: return
	var importer := WorldImporter.new()
	var imported := importer.import_world(loaded.data, "worlds/formal/first-forest.world.json", {"artifactDir": "artifacts/godot/test"})
	_expect(bool(imported.ok), "Formal forest imports all scene-layer asset references")
	if not imported.ok: return
	var expected := {
		"seedgate-verge": "landmark:duskseed-gate",
		"bellroot-court": "landmark:twin-root-bells",
		"heartwood-ring": "landmark:heartwood-core"
	}
	for region in loaded.data.regions:
		for chunk in region.chunks:
			if not expected.has(str(chunk.id)): continue
			var node := importer.instantiate_chunk(region, chunk)
			add_child(node)
			var found := false
			for layer in node.get_node("SceneLayers").get_children():
				for asset in layer.resolved_assets:
					if str(asset.id) == str(expected[chunk.id]) and not str(asset.path).is_empty(): found = true
			_expect(found, "Forest landmark %s is instantiated as a visible Godot Sprite2D" % expected[chunk.id])
			node.queue_free()
	var snapshot_landmarks := 0
	for region in imported.snapshot.regions:
		for chunk in region.chunks:
			for layer in chunk.sceneResolution:
				for asset in layer.assets:
					if str(asset.id).begins_with("landmark:") and asset.status == "resolved": snapshot_landmarks += 1
	_expect(snapshot_landmarks == 3, "Resolved snapshot records all three formal forest landmark assets")


func _test_canonical_world_files() -> Dictionary:
	var paths: PackedStringArray = []
	paths.append_array(CablesterFileUtils.list_json_files("worlds/formal", ".world.json"))
	paths.append_array(CablesterFileUtils.list_json_files("worlds/labs", ".world.json"))
	var imported := 0
	var importer := WorldImporter.new()
	for path in paths:
		var result := importer.import_file(path)
		_expect(bool(result.ok), "Canonical file imports: %s" % path)
		if result.ok:
			imported += 1
			_expect(int(result.normalizedManifest.semanticDiffCount) == 0, "Canonical file semantic diff is zero: %s" % path)
	return {"discovered": paths.size(), "imported": imported, "paths": paths}


func _fixture_world() -> Dictionary:
	var identity := {"position": {"x": 0, "y": 0}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}
	var type_ids := ["platform", "spawn", "roomEntrance", "roomExit"]
	var type_entries: Array = []
	for id in type_ids:
		var rect: bool = id in ["platform", "roomEntrance", "roomExit"]
		type_entries.append({
			"id": id,
			"pivot": {"x": 0, "y": 0, "mode": "top-left"} if rect else {"x": 0.5, "y": 0.5, "mode": "center"},
			"boundsAdapter": {"kind": "rect", "widthProperty": "w", "heightProperty": "h"} if rect else {"kind": "point"},
			"godotRuntimeHandler": id,
			"collisionSemantics": "solid" if id == "platform" else "trigger" if id in ["roomEntrance", "roomExit"] else "none",
			"scaleSemantics": "gameplay-and-collision",
			"required": true,
			"defaultPrefabId": "prefab:%s" % id,
			"defaultAssetId": "builtin:procedural"
		})
	var prefab_entries: Array = []
	for id in type_ids:
		prefab_entries.append({"id": "prefab:%s" % id, "type": id, "godotScene": "res://godot/prefabs/canonical_object.tscn", "required": true})
	var chunk_1 := {
		"id": "c1", "name": "One", "transform": {"position": {"x": 10, "y": 20}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}},
		"bounds": {"x": 0, "y": 0, "w": 640, "h": 360},
		"streaming": {"prefetchDistance": 700, "hysteresis": 96, "unloadDelaySeconds": 0.1, "keepAlive": false, "memoryEstimateBytes": 1024},
		"connections": [{"id": "c1-c2", "from": {"chunkId": "c1", "entranceId": "entry-c1"}, "to": {"chunkId": "c2", "entranceId": "entry-c2"}, "direction": "right", "requiredAbilities": [], "requiredFlags": [], "oneWay": false}],
		"objects": [
			{"id": "ground-c1", "type": "platform", "transform": {"position": {"x": 5, "y": 6}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "properties": {"w": 200, "h": 30}, "links": [], "tags": []},
			{"id": "spawn-c1", "type": "spawn", "transform": {"position": {"x": 80, "y": 100}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "properties": {}, "links": [], "tags": []},
			{"id": "entry-c1", "type": "roomEntrance", "transform": {"position": {"x": 0, "y": 80}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "properties": {"w": 80, "h": 120, "spawnOffsetX": 50, "spawnOffsetY": 60}, "links": [], "tags": []}
		],
		"scene": {"layers": []}, "statePolicy": {"deathReset": "checkpoint", "checkpointReset": "chunk", "offscreen": "sleep-local", "worldPersistence": ["abilities", "flags", "checkpoint"]}, "gameplay": {"startingAbilities": ["rope", "hardBar", "wallGrab", "dash"]}, "tags": ["start"]
	}
	var chunk_2 := {
		"id": "c2", "name": "Two", "transform": {"position": {"x": 650, "y": 20}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}},
		"bounds": {"x": 0, "y": 0, "w": 640, "h": 360},
		"streaming": {"prefetchDistance": 700, "hysteresis": 96, "unloadDelaySeconds": 0.1, "keepAlive": false, "memoryEstimateBytes": 1024},
		"connections": [],
		"objects": [
			{"id": "ground-c2", "type": "platform", "transform": identity.duplicate(true), "properties": {"w": 200, "h": 30}, "links": [], "tags": []},
			{"id": "entry-c2", "type": "roomEntrance", "transform": {"position": {"x": 0, "y": 80}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "properties": {"w": 80, "h": 120, "spawnOffsetX": 50, "spawnOffsetY": 60}, "links": [], "tags": []},
			{"id": "exit-c2", "type": "roomExit", "transform": {"position": {"x": 540, "y": 80}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "properties": {"w": 80, "h": 120, "targetChunkId": "c1", "targetEntranceId": "entry-c1", "requiredAbility": "", "requiredFlag": ""}, "links": [], "tags": []}
		],
		"scene": {"layers": []}, "statePolicy": {"deathReset": "checkpoint", "checkpointReset": "chunk", "offscreen": "sleep-local", "worldPersistence": ["abilities", "flags", "checkpoint"]}, "gameplay": {"startingAbilities": ["rope", "hardBar", "wallGrab", "dash"]}, "tags": []
	}
	var world := {
		"schemaVersion": 3,
		"manifest": {
			"worldId": "godot-headless-fixture", "title": "Godot headless fixture", "namespace": "labs", "contentVersion": "1.0.0", "contentHash": "",
			"gameplayTuningVersion": "approved-1", "assetRegistryVersion": "1", "prefabRegistryVersion": "1", "typeRegistryVersion": "1"
		},
		"regions": [{"id": "r1", "name": "Fixture", "transform": {"position": {"x": 100, "y": 50}, "rotationDegrees": 0, "scale": {"x": 1, "y": 1}}, "bounds": {"x": 0, "y": 0, "w": 1400, "h": 500}, "routes": [], "landmarks": [], "chunks": [chunk_1, chunk_2]}],
		"assetRegistry": {"version": "1", "entries": [{"id": "builtin:procedural", "kind": "procedural", "platforms": {"web": {"path": null}, "godot": {"path": null}}, "fallbackAllowed": true, "applicableTypes": ["*"]}]},
		"prefabRegistry": {"version": "1", "entries": prefab_entries},
		"typeRegistry": {"version": "1", "entries": type_entries},
		"gameplayTuning": {"version": "approved-1", "draft": {}, "approved": {"startingAbilities": ["rope", "hardBar", "wallGrab", "dash"]}},
		"stateDefinitions": {"flags": {"route-open": {"default": false}}, "resetOnDeathFlags": []}
	}
	world.manifest.contentHash = StableJson.content_hash(world)
	return world


func _expect(condition: bool, label: String) -> void:
	if condition:
		passed += 1
		print("PASS: %s" % label)
	else:
		failed += 1
		failures.append(label)
		push_error("FAIL: %s" % label)
