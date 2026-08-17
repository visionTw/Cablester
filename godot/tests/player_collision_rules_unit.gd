extends SceneTree

const Rules = preload("res://godot/runtime/player_collision_rules.gd")

var passed := 0
var failed := 0


func _initialize() -> void:
	_test_rect_and_canonical_shapes()
	_test_slope_and_contact_classification()
	_test_boundary_walls()
	_test_hazard_base()
	_test_moving_platform_sweep()
	_test_three_pass_orchestration()
	print("PlayerCollisionRules: %d passed, %d failed" % [passed, failed])
	quit(0 if failed == 0 else 1)


func _expect(condition: bool, label: String) -> void:
	if condition:
		passed += 1
		print("PASS: %s" % label)
	else:
		failed += 1
		push_error("FAIL: %s" % label)


func _near(actual: float, expected: float, tolerance := 0.00001) -> bool:
	return absf(actual - expected) <= tolerance


func _vector_near(actual: Vector2, expected: Vector2, tolerance := 0.00001) -> bool:
	return actual.distance_to(expected) <= tolerance


func _state(position: Vector2, velocity := Vector2.ZERO, previous := Vector2.INF, radius := 18.0) -> Dictionary:
	return {
		"position": position,
		"previous_position": position if previous == Vector2.INF else previous,
		"velocity": velocity,
		"radius": radius
	}


func _merged(base: Dictionary, overrides: Dictionary) -> Dictionary:
	var result := base.duplicate(true)
	result.merge(overrides, true)
	return result


func _test_rect_and_canonical_shapes() -> void:
	var rect := {"id": "ground", "x": 0.0, "y": 100.0, "w": 200.0, "h": 40.0}
	_expect(Rules.resolve_circle_rect(_state(Vector2(80, 82)), rect).is_empty(), "exact radius tangency does not resolve")
	var shallow := Rules.resolve_circle_rect(_state(Vector2(80, 82.35), Vector2(25, 120)), rect)
	_expect(_near(shallow.position.y, 82.0), "rect resolves an authored 0.35 px shallow overlap exactly")
	_expect(_near(float(shallow.contact.penetration), 0.35), "rect reports the 0.35 px penetration")
	_expect(_vector_near(shallow.velocity, Vector2(25, 0)), "rect removes only inward normal velocity")

	var corner_offset := Vector2(-1, -1).normalized() * (18.0 - 0.35)
	var corner := Rules.resolve_circle_rect(_state(corner_offset, Vector2(80, 90)), {"id": "corner", "x": 0.0, "y": 0.0, "w": 100.0, "h": 100.0})
	_expect(_near(float(corner.contact.penetration), 0.35), "circle corner overlap preserves the Web 0.35 px depth")
	_expect(_near(corner.position.length(), 18.0), "corner separation leaves radius-exact contact")
	_expect(_near(corner.velocity.dot(corner.normal), 0.0), "corner response removes velocity into the diagonal normal")

	var inside := Rules.resolve_circle_rect(_state(Vector2(5, 5), Vector2(30, 0), Vector2(5, 5), 10), {"x": 0, "y": 0, "w": 10, "h": 10})
	_expect(inside.normal == Vector2.LEFT and inside.position == Vector2(-10, 5), "inside-rect ties preserve Web left-right-top-bottom ordering")

	var canonical := {
		"id": "canonical-platform",
		"type": "platform",
		"transform": {"position": {"x": 0, "y": 100}},
		"properties": {"w": 200, "h": 40}
	}
	var canonical_hit := Rules.resolve_circle_rect(_state(Vector2(80, 83)), canonical)
	_expect(_near(canonical_hit.position.y, 82.0), "canonical transform/properties adapt to the compiled Web rectangle")
	var resolved_snapshot := {"id": "snapshot-platform", "collisionBounds": {"x": 0, "y": 100, "w": 200, "h": 40}}
	_expect(_near(Rules.resolve_circle_rect(_state(Vector2(80, 83)), resolved_snapshot).position.y, 82.0), "resolved collisionBounds remain authoritative")


func _test_slope_and_contact_classification() -> void:
	var slope := {"id": "flat-slope", "ax": 0.0, "ay": 100.0, "bx": 200.0, "by": 100.0, "thickness": 14.0}
	var shallow := Rules.resolve_slope(_state(Vector2(80, 75.35), Vector2(40, 120)), slope, Vector2.DOWN)
	_expect(_near(shallow.position.y, 75.0), "slope includes half authored thickness in its 0.35 px resolution")
	_expect(_near(float(shallow.contact.penetration), 0.35), "slope exposes precise penetration evidence")
	_expect(shallow.normal == Vector2.UP and _near(shallow.velocity.y, 0.0), "slope uses the closest-point normal and removes inward velocity")

	var canonical_slope := {
		"id": "canonical-slope",
		"type": "slope",
		"resolvedTransform": {"position": {"x": 10, "y": 20}, "rotationDegrees": 90, "scale": {"x": 1, "y": 1}},
		"properties": {"dx": 100, "dy": 0, "thickness": 14}
	}
	var rotated := Rules.resolve_slope(_state(Vector2(-14.5, 70), Vector2(100, 0)), canonical_slope, Vector2.DOWN)
	_expect(not rotated.is_empty() and _near(rotated.position.x, -15.0), "canonical slope endpoint applies resolved rotation")

	var resolved := Rules.resolve_collisions(_state(Vector2(80, 75.35), Vector2(0, 120)), {"slopes": [slope]})
	_expect(resolved.grounded and resolved.wall_normal == null, "upward slope contact classifies as ground")
	_expect(resolved.contacts.size() == 1 and resolved.contact.kind == "slope", "orchestration returns structured contact evidence")


func _test_boundary_walls() -> void:
	var wall := {"id": "edge", "x": 100.0, "y": 0.0, "w": 20.0, "h": 200.0}
	var solid := Rules.resolve_boundary_wall(_state(Vector2(95, 80), Vector2(240, 35), Vector2(90, 80), 10), _merged(wall, {"blockingSide": "all"}))
	_expect(solid.position == Vector2(90, 80) and solid.velocity == Vector2(0, 35), "solid boundary matches Web circle-rectangle response")
	var crossing := Rules.resolve_boundary_wall(_state(Vector2(115, 80), Vector2(600, 12), Vector2(80, 80), 10), _merged(wall, {"blockingSide": "left"}))
	_expect(crossing.position == Vector2(90, 80) and crossing.velocity == Vector2(0, 12), "one-sided boundary catches a crossing from its allowed face")
	var wrong_side := Rules.resolve_boundary_wall(_state(Vector2(95, 80), Vector2(-600, 0), Vector2(140, 80), 10), _merged(wall, {"blockingSide": "left"}))
	_expect(wrong_side.is_empty(), "one-sided boundary does not trap entry from the opposite face")
	var outside_span := Rules.resolve_boundary_wall(_state(Vector2(115, 240), Vector2(600, 0), Vector2(80, 240), 10), _merged(wall, {"blockingSide": "left"}))
	_expect(outside_span.is_empty(), "one-sided crossing honours the finite wall span")

	var overall := Rules.resolve_collisions(_state(Vector2(115, 80), Vector2(600, 12), Vector2(80, 80), 10), {"boundaryWalls": [_merged(wall, {"blockingSide": "left"})]})
	_expect(overall.contact.kind == "boundary_wall" and overall.contacts.size() == 1, "boundary contact appears in the pure collision result")
	_expect(not overall.grounded and overall.wall_normal == null, "boundary walls remain non-wall-grabbable like Web resolveCollisions")


func _test_hazard_base() -> void:
	var hazard := {"id": "spikes", "x": 10.0, "y": 20.0, "w": 100.0, "h": 40.0, "direction": "up"}
	var base := Rules.hazard_base_segment(hazard)
	_expect(base.normal == Vector2.UP and base.ay == 60.0 and base.by == 60.0, "up hazard exposes its non-damaging base edge")
	var caught := Rules.resolve_hazard_base(_state(Vector2(50, 55), Vector2(25, 200), Vector2(50, 40), 10), hazard)
	_expect(caught.position == Vector2(50, 50) and caught.velocity == Vector2(25, 0), "hazard solid base catches a player approaching from the safe side")
	var behind := Rules.resolve_hazard_base(_state(Vector2(50, 75), Vector2(0, 100), Vector2(50, 70), 10), hazard)
	_expect(behind.is_empty(), "hazard base does not trap a player already behind it")

	var right_hazard := {"id": "right-spikes", "x": 20.0, "y": 30.0, "w": 40.0, "h": 80.0, "direction": "right"}
	var right_hit := Rules.resolve_hazard_base(_state(Vector2(25, 60), Vector2(-200, 20), Vector2(40, 60), 10), right_hazard)
	_expect(right_hit.position == Vector2(30, 60) and right_hit.normal == Vector2.RIGHT, "directional hazard base uses the Web-authored normal")

	var overall := Rules.resolve_collisions(_state(Vector2(50, 55), Vector2(25, 200), Vector2(50, 40), 10), {"hazards": [hazard]})
	_expect(overall.grounded and overall.contact.kind == "hazard_base", "hazard base contributes a ground-classified contact")


func _test_moving_platform_sweep() -> void:
	var platform := {
		"id": "fast-platform", "type": "movingObject", "objectKind": "platform",
		"x": 100.0, "y": 0.0, "previousX": 0.0, "previousY": 0.0,
		"w": 20.0, "h": 20.0, "velocityX": 100.0, "velocityY": 0.0
	}
	var player := _state(Vector2(60, 10), Vector2.ZERO, Vector2(60, 10), 5)
	var contact := Rules.moving_rect_sweep_contact(player, platform)
	_expect(not contact.is_empty() and contact.normal == Vector2.RIGHT, "relative swept AABB detects a high-speed moving platform")
	var resolved := Rules.resolve_moving_rect(player, platform)
	_expect(resolved.position.x > 120.0 and _near(resolved.velocity.x, 100.0), "moving platform transfers normal velocity and adds the Web 0.01 separation")
	var overall := Rules.resolve_collisions(player, {"movingObjects": [platform]})
	_expect(overall.contact.kind == "moving_rect_sweep" and overall.wall_normal == Vector2.RIGHT, "three-pass orchestrator uses sweep only after ordinary rect overlap misses")


func _test_three_pass_orchestration() -> void:
	# These rectangles leave less than one diameter between opposing faces. The
	# Web algorithm intentionally stops after three deterministic passes instead
	# of looping forever on malformed/impossible geometry.
	var pinched := Rules.resolve_collisions(
		_state(Vector2(15, 50), Vector2.ZERO, Vector2(15, 50), 18),
		{"platforms": [
			{"id": "left", "x": 0, "y": 0, "w": 10, "h": 100},
			{"id": "right", "x": 30, "y": 0, "w": 10, "h": 100}
		]}
	)
	_expect(pinched.passes == 3, "impossible overlap is bounded to the Web maximum of three passes")
	_expect(pinched.contacts.size() == 6, "both opposing contacts are resolved in each of three passes")
	_expect(_near(pinched.position.x, 12.0), "three-pass ordering is deterministic")
