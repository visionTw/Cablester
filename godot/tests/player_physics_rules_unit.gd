extends SceneTree

const Rules = preload("res://godot/runtime/player_physics_rules.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	_test_timing_camera_and_rotation()
	_test_ground_damage_goal_and_recovery()
	_test_glide_and_updraft()
	_test_safe_energy()
	_test_rope_lifecycle_pull_and_winch()
	_test_swing_and_damping()
	_test_rope_visual_rules()
	print("PlayerPhysicsRules: %d passed, %d failed" % [passed, failed])
	quit(0 if failed == 0 else 1)


func _t(overrides := {}) -> Dictionary:
	var values := {
		"fixedStep": 0.008333,
		"maxFrameDelta": 0.1,
		"cameraFollow": 7.5,
		"cameraLookAhead": 0.18,
		"rotationDuration": 1.25,
		"groundFriction": 2900.0,
		"damageLiftSpeed": 370.0,
		"damageAwaySpeed": 150.0,
		"damageRecoveryWindow": 0.9,
		"respawnDelay": 0.45,
		"bashTargetCooldown": 0.55,
		"goalActivationPadding": 26.0,
		"hardBarThickness": 10.0,
		"glideMaximumFallSpeed": 190.0,
		"glideUpdraftEntrySpeed": 300.0,
		"glideUpdraftMaximumSpeed": 520.0,
		"glideUpdraftExitDampingDuration": 1.05,
		"glideUpdraftExitDeceleration": 220.0,
		"safeEnergyDelay": 0.65,
		"safeEnergyFloor": 2.0,
		"safeEnergyRegen": 1.35,
		"ropeLaunchSpeed": 2200.0,
		"ropeRetractSpeed": 2800.0,
		"ropeMinimumLength": 82.0,
		"ropeReelMaximumSpeed": 480.0,
		"ropeReelAcceleration": 1050.0,
		"ropeReelDeceleration": 1000.0,
		"ropeWinchAcceleration": 360.0,
		"ropeWinchSpeedFactor": 1.15,
		"ropeWinchCompletionBoost": 240.0,
		"ropePullStrength": 13.0,
		"swingInputSmoothing": 11.0,
		"swingPumpFullSpeed": 240.0,
		"swingStartKickSpeed": 82.0,
		"swingTargetSpeed": 720.0,
		"swingAcceleration": 920.0,
		"swingBraking": 1480.0,
		"ropeSwingDamping": 0.14,
		"hardBarSwingDamping": 0.48,
		"maximumSwingSpeed": 930.0,
		"ropeAnimationSagRatio": 0.14,
		"ropeVisualMinimumSag": 2.0,
		"ropeVisualMaximumSag": 72.0,
		"ropeVisualSagRatio": 0.18,
		"ropeVisualSmoothing": 7.5
	}
	for key in overrides:
		values[key] = overrides[key]
	return {"values": values}


func _expect(condition: bool, label: String) -> void:
	if condition:
		passed += 1
		print("PASS: %s" % label)
	else:
		failed += 1
		push_error("FAIL: %s" % label)


func _near(actual: float, expected: float, label: String, epsilon := 0.000001) -> void:
	_expect(absf(actual - expected) <= epsilon, "%s (actual %.9f, expected %.9f)" % [label, actual, expected])


func _vector_near(actual: Vector2, expected: Vector2, label: String, epsilon := 0.000001) -> void:
	_expect(actual.distance_to(expected) <= epsilon, "%s (actual %s, expected %s)" % [label, actual, expected])


func _test_timing_camera_and_rotation() -> void:
	var fixed := Rules.fixed_step_contract(1.0 / 120.0, _t())
	_expect(fixed.declared_matches_rounded_contract and fixed.replay_matches_exact_step, "fixed step accepts rounded declaration and exact replay delta")
	_expect(not Rules.fixed_step_contract(0.01, _t({"fixedStep": 0.01})).declared_matches_rounded_contract, "fixed-step perturbation changes the contract")
	_near(Rules.clamp_visual_delta(0.5, _t()), 0.1, "render delta is capped")
	_near(Rules.clamp_visual_delta(0.5, _t({"maxFrameDelta": 0.04})), 0.04, "frame-cap perturbation changes the result")

	var camera := Rules.camera_follow_step(Vector2.ZERO, Vector2(100, 50), Vector2(20, 40), false, 0.1, _t())
	var desired := Vector2(103.6, 53.24)
	var blend := 1.0 - exp(-7.5 * 0.1)
	_vector_near(camera.desired, desired, "camera look-ahead matches Web x/y equation")
	_vector_near(camera.position, desired * blend, "camera exponential follow matches Web")
	var rotating := Rules.camera_follow_step(Vector2.ZERO, Vector2(100, 50), Vector2(20, 40), true, 0.1, _t())
	_vector_near(rotating.desired, Vector2(100, 50), "camera rotation suppresses look-ahead")
	var slower := Rules.camera_follow_step(Vector2.ZERO, Vector2(100, 0), Vector2.ZERO, false, 0.1, _t({"cameraFollow": 1.0}))
	_expect(slower.position.x < camera.position.x, "cameraFollow perturbation changes convergence")

	var midpoint := Rules.rotation_step(0.0, 2.0, 0.525, 0.1, _t())
	_near(midpoint.angle, 1.0, "cubic rotation midpoint")
	var quarter := Rules.rotation_step(0.0, 2.0, 0.2125, 0.1, _t())
	_near(quarter.angle, 0.125, "cubic rotation quarter is eased rather than linear")
	_vector_near(Rules.gravity_for_camera_angle(PI / 2.0), Vector2.RIGHT, "inverse camera rotation keeps gravity screen-down")


func _test_ground_damage_goal_and_recovery() -> void:
	_vector_near(
		Rules.apply_ground_friction(Vector2(300, 80), Vector2.DOWN, true, true, false, 0.0, 0.05, _t()),
		Vector2(155, 80),
		"ground friction preserves gravity-axis speed"
	)
	_vector_near(
		Rules.apply_ground_friction(Vector2(300, 80), Vector2.DOWN, false, true, false, 0.0, 0.05, _t()),
		Vector2(300, 80),
		"ground friction does not affect air movement"
	)
	_vector_near(
		Rules.apply_ground_friction(Vector2(300, 80), Vector2.DOWN, true, true, false, 0.0, 0.05, _t({"groundFriction": 1000.0})),
		Vector2(250, 80),
		"ground-friction perturbation changes stopping rate"
	)

	_vector_near(
		Rules.compute_damage_recovery_velocity(Vector2(0, 500), Vector2.DOWN, Vector2.RIGHT, _t()),
		Vector2(150, -370),
		"damage recovery cancels fall and launches away exactly like Web"
	)
	_vector_near(
		Rules.compute_damage_recovery_velocity(Vector2(-120, -40), Vector2.RIGHT, Vector2.DOWN, _t()),
		Vector2(-490, 110),
		"damage recovery respects rotated gravity and signed tangent"
	)
	var recovery := Rules.begin_damage_recovery(_t())
	_near(recovery.timer, 0.9, "damage recovery window starts from tuning")
	var active := Rules.step_damage_recovery(recovery.timer, true, 0.4)
	_expect(active.jump_available and active.timer > 0.0, "recovery jump remains available inside window")
	var consumed := Rules.consume_damage_recovery_jump(active.timer, active.jump_available)
	_expect(consumed.consumed and not consumed.jump_available, "recovery jump is one-shot")
	var expired := Rules.step_damage_recovery(0.1, true, 0.2)
	_expect(not expired.jump_available and expired.timer == 0.0, "recovery jump expires with timer")
	_near(Rules.respawn_delay(_t({"respawnDelay": 0.3})), 0.3, "respawn delay reads perturbed tuning")
	_near(Rules.bash_target_cooldown(_t({"bashTargetCooldown": 0.4})), 0.4, "bash cooldown reads perturbed tuning")

	_expect(Rules.is_goal_reached(Vector2(78, 0), 18, Vector2.ZERO, 34, _t()), "goal padding includes exact boundary")
	_expect(not Rules.is_goal_reached(Vector2(78.01, 0), 18, Vector2.ZERO, 34, _t()), "goal padding excludes just-outside point")
	_expect(Rules.is_goal_reached(Vector2(60, 0), 18, Vector2.ZERO, 34, _t({"goalActivationPadding": 8.0})), "goal-padding perturbation is consumed")
	var fallback_bar := Rules.hard_bar_geometry(0.0, _t())
	_expect(fallback_bar == {"thickness": 10.0, "collision_radius": 5.0}, "hard-bar default thickness drives draw and collision radius")
	_expect(Rules.hard_bar_geometry(14.0, _t()).collision_radius == 7.0, "authored hard-bar thickness wins")


func _test_glide_and_updraft() -> void:
	_vector_near(Rules.apply_glide_fall_cap(Vector2(320, 480), Vector2.DOWN, _t()), Vector2(320, 190), "glide fall cap preserves tangent velocity")
	_vector_near(Rules.apply_glide_fall_cap(Vector2(320, 480), Vector2.DOWN, _t({"glideMaximumFallSpeed": 240.0})), Vector2(320, 240), "glide fall-cap perturbation changes result")
	_vector_near(Rules.apply_updraft_entry(Vector2(240, 190), Vector2.DOWN, true, _t()), Vector2(240, -300), "updraft entry applies immediate minimum lift")
	_vector_near(Rules.apply_updraft_entry(Vector2(240, -420), Vector2.DOWN, true, _t()), Vector2(240, -420), "updraft entry does not weaken existing lift")
	_vector_near(Rules.apply_updraft_entry(Vector2(240, 190), Vector2.DOWN, false, _t()), Vector2(240, 190), "updraft entry impulse is edge-triggered")
	_vector_near(Rules.apply_updraft_lift_cap(Vector2(240, -680), Vector2.DOWN, _t()), Vector2(240, -520), "updraft maximum lift cap")

	var exit := Rules.update_updraft_exit(Vector2(240, -520), Vector2.DOWN, 0.0, true, false, true, 0.5, _t())
	_expect(exit.started, "updraft exit starts only on active-to-inactive edge")
	_vector_near(exit.velocity, Vector2(240, -410), "updraft exit deceleration matches Web")
	_near(exit.timer, 0.55, "updraft exit timer decrements after the edge frame")
	var reentered := Rules.update_updraft_exit(Vector2(240, -410), Vector2.DOWN, 0.5, false, true, true, 0.1, _t())
	_expect(reentered.timer == 0.0 and reentered.velocity == Vector2(240, -410), "updraft re-entry clears damping")
	var perturbed := Rules.update_updraft_exit(Vector2(0, -520), Vector2.DOWN, 0.5, false, false, true, 0.5, _t({"glideUpdraftExitDeceleration": 100.0}))
	_near(perturbed.velocity.y, -470.0, "updraft-exit deceleration perturbation changes result")


func _test_safe_energy() -> void:
	_expect(not Rules.safe_energy_eligible(true, false, 0.649, 0.0, _t()), "safe energy waits for delay")
	_expect(Rules.safe_energy_eligible(true, false, 0.65, 0.0, _t()), "safe energy begins at delay boundary")
	_expect(not Rules.safe_energy_eligible(false, false, 1.0, 0.0, _t()), "safe energy requires ground")
	_expect(not Rules.safe_energy_eligible(true, true, 1.0, 0.0, _t()), "safe energy rejects rope attachment")
	_near(Rules.regenerate_safe_energy(0.0, true, false, 1.0, 1.0, _t()), 1.35, "safe energy regeneration rate")
	_near(Rules.regenerate_safe_energy(1.9, true, false, 1.0, 1.0, _t()), 2.0, "safe energy clamps to floor")
	_near(Rules.regenerate_safe_energy(5.0, true, false, 1.0, 1.0, _t()), 5.0, "safe recovery never reduces or raises energy above floor")
	_near(Rules.regenerate_safe_energy(0.0, true, false, 1.0, 1.0, _t({"safeEnergyRegen": 0.5, "safeEnergyFloor": 3.0})), 0.5, "safe-energy perturbation changes accumulation")


func _test_rope_lifecycle_pull_and_winch() -> void:
	var firing := Rules.advance_rope_tip(Vector2.ZERO, Vector2(1000, 0), "firing", 0.1, _t())
	_vector_near(firing.tip, Vector2(220, 0), "firing tip uses rope launch speed")
	_expect(not firing.reached, "firing tip stays unattached before arrival")
	var retraction := Rules.advance_rope_tip(Vector2.ZERO, Vector2(1000, 0), "retracting", 0.1, _t())
	_vector_near(retraction.tip, Vector2(280, 0), "retracting tip uses retract speed")
	var reached := Rules.advance_rope_tip(Vector2(90, 0), Vector2(100, 0), "firing", 0.1, _t())
	_expect(reached.reached and reached.tip == Vector2(100, 0), "rope tip snaps only on arrival")
	_vector_near(Rules.advance_rope_tip(Vector2.ZERO, Vector2(1000, 0), "firing", 0.1, _t({"ropeLaunchSpeed": 1000.0})).tip, Vector2(100, 0), "rope launch perturbation changes travel")

	var slack := Rules.apply_rope_pull(Vector2(20, 0), Vector2(80, 0), Vector2.ZERO, 100, 0.1, _t())
	_expect(not slack.applied and slack.velocity == Vector2(20, 0), "slack rope applies no pull")
	var taut := Rules.apply_rope_pull(Vector2.ZERO, Vector2(106, 0), Vector2.ZERO, 100, 0.1, _t())
	_vector_near(taut.velocity, Vector2(-13, 0), "rope stretch produces linear inward acceleration")
	var doubled := Rules.apply_rope_pull(Vector2.ZERO, Vector2(116, 0), Vector2.ZERO, 100, 0.1, _t())
	_near(doubled.velocity.x, -26.0, "doubling rope stretch doubles pull")

	var tune := _t({
		"ropeMinimumLength": 80.0,
		"ropeReelMaximumSpeed": 100.0,
		"ropeReelAcceleration": 200.0,
		"ropeWinchAcceleration": 100.0,
		"ropeWinchSpeedFactor": 1.0,
		"ropeWinchCompletionBoost": 50.0
	})
	var winched := Rules.apply_rope_winch({"length": 100.0, "reel_speed": 20.0, "vx": 10.0, "vy": 20.0, "boost_applied": false}, Vector2.RIGHT, 0.1, tune)
	_near(winched.length, 96.0, "winch reel ramp shortens continuously")
	_near(winched.reel_speed, 40.0, "winch reel acceleration matches Web")
	_vector_near(winched.velocity, Vector2(-4, 20), "winch base plus speed factor matches Web")
	_expect(not winched.completed and not winched.boost_applied, "winch does not boost before minimum crossing")
	var completed := Rules.apply_rope_winch({"length": 81.0, "reel_speed": 90.0, "vx": 0.0, "vy": 0.0, "boost_applied": false}, Vector2.DOWN, 0.1, tune)
	_expect(completed.completed and completed.boost_applied and completed.length == 80.0, "minimum crossing applies completion once")
	_vector_near(completed.velocity, Vector2(0, -70), "completion boost is an inward impulse")
	var no_repeat := Rules.apply_rope_winch({"length": 80.0, "reel_speed": 100.0, "vx": 0.0, "vy": 0.0, "boost_applied": true}, Vector2.DOWN, 0.1, tune)
	_expect(not no_repeat.completed, "completion boost never repeats at minimum length")
	_near(Rules.decelerate_rope_reel(80.0, 0.05, _t()), 30.0, "released reel decelerates without detach")
	_near(Rules.decelerate_rope_reel(80.0, 0.05, _t({"ropeReelDeceleration": 400.0})), 60.0, "reel-deceleration perturbation changes result")


func _test_swing_and_damping() -> void:
	var tune := _t({
		"swingInputSmoothing": 20.0,
		"swingAcceleration": 900.0,
		"swingBraking": 1500.0,
		"swingTargetSpeed": 700.0,
		"swingStartKickSpeed": 80.0,
		"swingPumpFullSpeed": 240.0
	})
	var accelerating := Rules.apply_swing_input(Vector2(100, 0), Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 1.0, 0.0, false, 0.1, tune)
	_expect(accelerating.velocity.x > 100.0 and accelerating.velocity.y == 0.0, "swing input pumps same-direction motion")
	var braking := Rules.apply_swing_input(Vector2(-100, 0), Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 1.0, 0.0, false, 0.1, tune)
	_expect(braking.velocity.x > -100.0 and braking.velocity.x + 100.0 > accelerating.velocity.x - 100.0, "opposite swing input brakes before reversal")
	var released := Rules.apply_swing_input(Vector2(80, 0), Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 0.0, 1.0, false, 0.1, tune)
	_expect(released.velocity == Vector2(80, 0) and released.control_strength < 1.0, "released swing control smooths to zero without altering speed")
	var kick := Rules.apply_swing_input(Vector2.ZERO, Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 1.0, 0.0, true, 0.1, tune)
	_vector_near(kick.velocity, Vector2(80, 0), "fresh swing press applies one start kick")
	var held := Rules.apply_swing_input(Vector2.ZERO, Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 1.0, 1.0, false, 0.1, tune)
	_vector_near(held.velocity, Vector2.ZERO, "held input does not repeatedly kick from rest")
	var changed_smoothing := Rules.apply_swing_input(Vector2(80, 0), Vector2(0, 10), Vector2.ZERO, Vector2.RIGHT, 0.0, 1.0, false, 0.1, _t({"swingInputSmoothing": 1.0}))
	_expect(changed_smoothing.control_strength > released.control_strength, "swing smoothing perturbation changes convergence")

	var rope_damped := Rules.apply_constraint_damping(Vector2(120, 35), Vector2(0, 100), Vector2.ZERO, false, 100.0, 1.0, _t({"ropeSwingDamping": log(2.0)}))
	_vector_near(rope_damped.velocity, Vector2(60, 35), "rope exponential damping preserves radial motion")
	var rope_slack := Rules.apply_constraint_damping(Vector2(120, 35), Vector2(0, 80), Vector2.ZERO, false, 100.0, 1.0, _t())
	_expect(not rope_slack.applied and rope_slack.velocity == Vector2(120, 35), "slack rope is not damped")
	var bar_damped := Rules.apply_constraint_damping(Vector2(120, 35), Vector2(0, 80), Vector2.ZERO, true, 100.0, 1.0, _t())
	_expect(bar_damped.applied and bar_damped.velocity.x < 120.0, "hard bar always damps tangential motion")
	var capped := Rules.cap_attachment_speed(Vector2(800, 800), true, _t())
	_near(capped.length(), 930.0, "attachment speed cap uses vector magnitude")
	_vector_near(Rules.cap_attachment_speed(Vector2(800, 800), false, _t()), Vector2(800, 800), "speed cap applies only while attached")
	_near(Rules.cap_attachment_speed(Vector2(800, 800), true, _t({"maximumSwingSpeed": 500.0})).length(), 500.0, "swing-speed perturbation changes cap", 0.0001)


func _test_rope_visual_rules() -> void:
	_near(Rules.rope_animation_sag(300, false, _t()), 42.0, "flight sag uses display length ratio")
	_near(Rules.rope_animation_sag(1000, false, _t()), 72.0, "flight sag is capped")
	_near(Rules.rope_animation_sag(300, true, _t()), 0.0, "attached rope has no animation sag")
	var short_sag := Rules.rope_visual_sag_limit(82, _t())
	_near(short_sag.slack_limit, 14.76, "rope sag uses authored length ratio")
	var long_sag := Rules.rope_visual_sag_limit(470, _t())
	_near(long_sag.slack_limit, 72.0, "rope slack sag clamps to maximum")
	var blended := Rules.rope_visual_blend(0.0, 72.0, 0.1, _t())
	_near(blended, 72.0 * (1.0 - exp(-7.5 * 0.1)), "rope visual smoothing uses exponential blend")
	_expect(blended > 0.0 and blended < 72.0, "rope visual does not snap in one frame")
