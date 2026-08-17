class_name PlayerVisualStateUnit
extends RefCounted

const VISUAL_STATE := preload("res://godot/runtime/player_visual_state.gd")
const STEP := 1.0 / 120.0

var passed := 0
var failed := 0
var failures: Array[String] = []


func run() -> Dictionary:
	passed = 0
	failed = 0
	failures.clear()
	_test_soft_body_spring_and_area()
	_test_fixed_step_frame_clamp()
	_test_axis_shortest_path()
	_test_jump_and_landing_edges()
	_test_tail_inertia_cap_and_turn()
	_test_rope_sag_smoothing_and_curve()
	return {
		"ok": failed == 0,
		"passed": passed,
		"failed": failed,
		"failures": failures.duplicate()
	}


func _test_soft_body_spring_and_area() -> void:
	var visual = _new_visual()
	visual.trigger_dash(Vector2.RIGHT)
	visual.update(_state({"velocity": Vector2(850, 0), "grounded": false, "dashing": true}), STEP)
	var first: Dictionary = visual.snapshot()
	var expected_acceleration := 0.42 * 18.0 * 18.0 - 1.25 * 2.0 * 0.72 * 18.0
	var expected_velocity := 1.25 + expected_acceleration * STEP
	var expected_stretch := expected_velocity * STEP
	_expect(_near(float(first.softBody.stretchVelocity), expected_velocity), "Soft-body spring uses frequency squared and damping ratio")
	_expect(_near(float(first.softBody.stretch), expected_stretch), "Soft-body spring integrates velocity before stretch")
	for index in range(18):
		visual.update(_state({"velocity": Vector2(850, 0), "grounded": false, "dashing": true}), STEP)
	var settled: Dictionary = visual.snapshot()
	var pose: Dictionary = settled.softBody.pose
	_expect(float(settled.softBody.stretch) > 0.3 and float(settled.softBody.stretch) <= 0.48, "Dash stretch eases toward the approved target without snapping")
	_expect(_near(float(pose.areaRatio), 1.0, 0.000001), "Soft-body long/cross radii preserve projected area")
	_expect(float(pose.longRadius) > 18.0 and float(pose.crossRadius) < 18.0, "Positive stretch lengthens one render axis and narrows the other")
	_expect(_near(float(settled.collisionRadius), 18.0), "Render deformation leaves the collision radius unchanged")

	var slower_tuning := _approved()
	slower_tuning.softBodySpringFrequency = 9.0
	var slower = VISUAL_STATE.new()
	slower.configure(slower_tuning, 18.0, 1.0)
	slower.trigger_dash(Vector2.RIGHT)
	slower.update(_state({"velocity": Vector2(850, 0), "grounded": false, "dashing": true}), STEP)
	var slower_first: Dictionary = slower.snapshot()
	_expect(float(slower_first.softBody.stretch) < float(first.softBody.stretch), "Perturbing softBodySpringFrequency changes the observed spring trajectory")


func _test_fixed_step_frame_clamp() -> void:
	var visual = _new_visual()
	visual.trigger_jump()
	visual.update(_state({"velocity": Vector2(0, -590), "grounded": false}), 0.5)
	var state: Dictionary = visual.snapshot()
	_expect(_near(float(state.timing.fixedStep), STEP, 0.000000001), "Canonical rounded fixedStep snaps to exact 120 Hz")
	_expect(_near(float(state.softBody.jumpTimer), 0.07, 0.000001), "A 0.5-second render stall advances visual timers by maxFrameDelta only")
	_expect(_near(float(state.timing.accumulator), 0.0, 0.000001), "Clamped visual frame resolves into deterministic fixed steps")


func _test_axis_shortest_path() -> void:
	var visual = _new_visual()
	var before_direction := Vector2(cos(1.55), sin(1.55))
	visual.trigger_dash(before_direction)
	var before := float(visual.snapshot().softBody.axisAngle)
	visual.update(_state({
		"velocity": Vector2(cos(-1.55), sin(-1.55)) * 850.0,
		"grounded": false,
		"dashing": true
	}), STEP)
	var after_state: Dictionary = visual.snapshot()
	var after := float(after_state.softBody.axisAngle)
	_expect(before > 1.5 and after > before, "Ellipse axis crosses the +PI/2 seam by the shortest equivalent-axis path")
	_expect(absf(after - before) < 0.05, "Shortest ellipse-axis interpolation avoids a near-PI rotation")


func _test_jump_and_landing_edges() -> void:
	var visual = _new_visual()
	visual.trigger_jump()
	visual.update(_state({"velocity": Vector2(0, -590), "grounded": false}), STEP)
	var squash: Dictionary = visual.snapshot()
	_expect(float(squash.softBody.targetStretch) == -0.12 and float(squash.softBody.stretch) < 0.0, "Jump begins with the approved short squash phase")
	for index in range(10):
		visual.update(_state({"velocity": Vector2(0, -500), "grounded": false}), STEP)
	var stretched: Dictionary = visual.snapshot()
	_expect(float(stretched.softBody.targetStretch) == 0.3 and float(stretched.softBody.stretch) > 0.0, "Jump transitions to the approved stretch without resetting its spring")
	_expect(not visual.trigger_landing(Vector2.DOWN, 119.0), "Landing below the approved impact threshold does not animate")
	_expect(visual.trigger_landing(Vector2.DOWN, 120.0), "Landing exactly at the approved threshold animates")
	visual.update(_state(), STEP)
	var landed: Dictionary = visual.snapshot()
	_expect(float(landed.softBody.targetStretch) < 0.0 and float(landed.softBody.landingTimer) > 0.0, "Qualifying landing holds one render-only squash state")
	_expect(float(landed.softBody.jumpTimer) == 0.0, "Landing clears the jump visual timer")
	for index in range(10):
		visual.update(_state(), STEP)
	_expect(float(visual.snapshot().softBody.landingTimer) == 0.0, "Landing timer expires at fixed-step cadence")


func _test_tail_inertia_cap_and_turn() -> void:
	var visual = _new_visual()
	for index in range(24):
		visual.update(_state(), STEP)
	var idle: Dictionary = visual.snapshot()
	visual.trigger_jump()
	visual.update(_state({"velocity": Vector2(0, -590), "grounded": false}), STEP)
	var jump: Dictionary = visual.snapshot()
	_expect(float(jump.tail.relativeForce.y) > 0.0, "Jump acceleration produces downward tail inertia")
	_expect(float(jump.tail.offset.y) > float(idle.tail.offset.y), "Tail mass lags below the body during a jump impulse")

	visual.update(_state({"velocity": Vector2(10000, 10000), "grounded": false, "dashing": true}), STEP)
	var diagonal: Dictionary = visual.snapshot()
	_expect(_near((diagonal.tail.bodyAcceleration as Vector2).length(), 4200.0, 0.001), "Tail body acceleration uses vector-magnitude capping")
	for index in range(80):
		var impulse := Vector2(12000, -12000) if index % 2 == 0 else Vector2(-12000, 12000)
		visual.update(_state({"velocity": impulse, "grounded": false, "dashing": true, "constrained": true}), STEP)
	var capped: Dictionary = visual.snapshot()
	_expect((capped.tail.offset as Vector2).length() <= 58.0001, "Tail offset never exceeds tailMaximumLength under dash impulses")
	var radial := (capped.tail.offset as Vector2).normalized()
	_expect((capped.tail.velocity as Vector2).dot(radial) <= 0.001 or (capped.tail.offset as Vector2).length() < 57.999, "Tail cap removes only outward radial velocity")

	visual.reset(1.0)
	visual.update(_state({"facing": -1.0}), STEP)
	var first_turn: Dictionary = visual.snapshot()
	_expect(float(first_turn.tail.facing) < 1.0 and float(first_turn.tail.facing) > -1.0, "Tail facing reverses through a spring instead of flipping")
	for index in range(40):
		visual.update(_state({"facing": -1.0}), STEP)
	var turned: Dictionary = visual.snapshot()
	_expect(float(turned.tail.facing) < -0.9 and absf(float(turned.tail.facing)) <= 1.0801, "Tail turn settles with the approved overshoot bound")

	visual.reset(1.0)
	visual.update(_state(), STEP)
	var rest: Dictionary = visual.snapshot()
	visual.reset(1.0)
	visual.update(_state({"velocity": Vector2(930, 0), "grounded": false, "constrained": true}), STEP)
	var swing: Dictionary = visual.snapshot()
	_expect(_near(float(rest.tail.desiredLength), 42.0) and _near(float(swing.tail.desiredLength), 52.0), "Tail rest length gains ten pixels at maximumSwingSpeed")


func _test_rope_sag_smoothing_and_curve() -> void:
	var visual = _new_visual()
	var taut_bottom := _state({
		"velocity": Vector2(930, 0),
		"grounded": false,
		"constrained": true,
		"rope": _rope("bottom", "attached", Vector2(0, 200), Vector2.ZERO, 200.0)
	})
	visual.update(taut_bottom, STEP)
	var minimum: Dictionary = visual.snapshot()
	_expect(_near(float(minimum.rope.targetSag), 2.0) and float(minimum.rope.visualSag) >= 2.0, "Taut bottom rope retains ropeVisualMinimumSag")

	for rope_length in [82.0, 300.0, 470.0]:
		visual.reset()
		visual.update(_state({
			"grounded": false,
			"constrained": true,
			"rope": _rope("slack-%s" % rope_length, "attached", Vector2.ZERO, Vector2.ZERO, rope_length)
		}), STEP)
		var slack: Dictionary = visual.snapshot()
		var expected_maximum := clampf(rope_length * 0.18, 2.0, 72.0)
		_expect(_near(float(slack.rope.maximumSlackSag), expected_maximum), "Rope length %s drives its approved sag-ratio ceiling" % rope_length)
		_expect(_near(float(slack.rope.physicalSag), expected_maximum), "Fully slack rope %s reaches its length-derived physical sag" % rope_length)

	visual.reset()
	var high_side := _state({
		"velocity": Vector2.ZERO,
		"grounded": false,
		"constrained": true,
		"rope": _rope("smooth", "attached", Vector2(200, 0), Vector2.ZERO, 200.0)
	})
	visual.update(high_side, STEP)
	var first: Dictionary = visual.snapshot()
	_expect(float(first.rope.visualSag) > 2.0 and float(first.rope.visualSag) < float(first.rope.targetSag), "Rope sag approaches its target without a one-frame snap")
	for index in range(120):
		visual.update(high_side, STEP)
	var smoothed: Dictionary = visual.snapshot()
	_expect(absf(float(smoothed.rope.visualSag) - float(smoothed.rope.targetSag)) < 0.05, "Rope sag converges under exponential smoothing")
	_expect(_near((smoothed.rope.bend as Vector2).length(), 1.0, 0.00001), "Smoothed rope bend remains normalized")

	visual.reset()
	visual.update(_state({
		"rope": _rope("phase-attached", "attached", Vector2(0, 200), Vector2.ZERO, 200.0)
	}), STEP)
	var attached: Dictionary = visual.snapshot()
	visual.reset()
	visual.update(_state({
		"rope": _rope("phase-firing", "firing", Vector2(0, 200), Vector2.ZERO, 200.0)
	}), STEP)
	var firing: Dictionary = visual.snapshot()
	_expect(float(attached.rope.animationSag) == 0.0 and _near(float(firing.rope.animationSag), 28.0), "Only firing/retracting phases add display-length animation sag")
	visual.reset()
	visual.update(_state({
		"rope": _rope("phase-cap", "firing", Vector2(0, 1000), Vector2.ZERO, 1000.0)
	}), STEP)
	var capped_phase: Dictionary = visual.snapshot()
	_expect(_near(float(capped_phase.rope.animationSag), 72.0) and _near(float(capped_phase.rope.targetSag), 72.0), "Physical plus phase sag is capped by ropeVisualMaximumSag")
	for index in range(30):
		visual.update(_state({
			"rope": _rope("phase-cap", "firing", Vector2(0, 1000), Vector2.ZERO, 1000.0)
		}), STEP)

	var curve: PackedVector2Array = visual.rope_curve(9)
	_expect(curve.size() == 9 and curve[0].is_equal_approx(Vector2.ZERO) and curve[8].is_equal_approx(Vector2(0, 1000)), "Rope curve returns stable anchor-to-player endpoints")
	_expect(absf(curve[4].x) > 1.0, "Rope curve exposes visible cubic bend rather than a straight collision proxy")


func _new_visual():
	var visual = VISUAL_STATE.new()
	visual.configure(_approved(), 18.0, 1.0)
	return visual


func _state(overrides: Dictionary = {}) -> Dictionary:
	var state := {
		"velocity": Vector2.ZERO,
		"gravity": Vector2.DOWN,
		"tangent": Vector2.RIGHT,
		"facing": 1.0,
		"grounded": true,
		"gliding": false,
		"constrained": false,
		"dashing": false,
		"distanceTravelled": 0.0
	}
	for key in overrides:
		state[key] = overrides[key]
	return state


func _rope(id: String, phase: String, start: Vector2, end: Vector2, length: float) -> Dictionary:
	return {"id": id, "phase": phase, "start": start, "end": end, "length": length}


func _approved() -> Dictionary:
	return {
		"fixedStep": 0.008333,
		"maxFrameDelta": 0.1,
		"gravity": 1550.0,
		"jumpSpeed": 590.0,
		"maximumSwingSpeed": 930.0,
		"playerRadius": 18.0,
		"ropeAnimationSagRatio": 0.14,
		"ropeMinimumLength": 82.0,
		"ropeVisualMinimumSag": 2.0,
		"ropeVisualMaximumSag": 72.0,
		"ropeVisualSagRatio": 0.18,
		"ropeVisualSmoothing": 7.5,
		"softBodyAirStretch": 0.24,
		"softBodyAxisFollow": 15.0,
		"softBodyDashStretch": 0.42,
		"softBodyJumpDuration": 0.17,
		"softBodyJumpSquash": 0.12,
		"softBodyJumpSquashDuration": 0.035,
		"softBodyJumpStretch": 0.3,
		"softBodyLandingDuration": 0.075,
		"softBodyLandingThreshold": 120.0,
		"softBodySpringDamping": 0.72,
		"softBodySpringFrequency": 18.0,
		"softBodySwingStretch": 0.34,
		"tailInertia": 0.18,
		"tailMaximumBodyAcceleration": 4200.0,
		"tailMaximumLength": 58.0,
		"tailPhysicsDamping": 0.64,
		"tailPhysicsFrequency": 10.5,
		"tailRestLength": 42.0,
		"tailTurnSpringDamping": 0.86,
		"tailTurnSpringFrequency": 16.0
	}


func _near(actual: float, expected: float, tolerance: float = 0.00001) -> bool:
	return absf(actual - expected) <= tolerance


func _expect(condition: bool, label: String) -> void:
	if condition:
		passed += 1
		print("PASS: %s" % label)
	else:
		failed += 1
		failures.append(label)
		push_error("FAIL: %s" % label)
