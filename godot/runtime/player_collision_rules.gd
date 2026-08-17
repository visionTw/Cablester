class_name PlayerCollisionRules
extends RefCounted

## Pure, engine-independent port of the Web player's collision equations.
##
## Inputs are Dictionaries/Arrays and are never mutated. Player states may use
## either Web fields (`x`, `y`, `previousX`, `vx`, ...) or Godot-friendly
## fields (`position`, `previous_position`, `velocity`). Collision objects may
## be compiled Web objects or canonical objects with `transform`/`properties`
## (resolved snapshots may provide `collisionBounds`).

const PLAYER_RADIUS := 18.0
const RECT_DISTANCE_EPSILON := 0.00001
const SWEEP_EPSILON := 0.0000001
const DEFAULT_SLOPE_THICKNESS := 10.0
const MAX_PASSES := 3


static func _vector(value: Variant, fallback := Vector2.ZERO) -> Vector2:
	if value is Vector2:
		return value
	if value is Dictionary:
		return Vector2(float(value.get("x", fallback.x)), float(value.get("y", fallback.y)))
	return fallback


static func _position(state: Dictionary) -> Vector2:
	if state.has("position"):
		return _vector(state.get("position"), Vector2.ZERO)
	return Vector2(float(state.get("x", 0.0)), float(state.get("y", 0.0)))


static func _previous_position(state: Dictionary) -> Vector2:
	if state.has("previous_position"):
		return _vector(state.get("previous_position"), _position(state))
	if state.has("previousPosition"):
		return _vector(state.get("previousPosition"), _position(state))
	return Vector2(
		float(state.get("previousX", _position(state).x)),
		float(state.get("previousY", _position(state).y))
	)


static func _velocity(state: Dictionary) -> Vector2:
	if state.has("velocity"):
		return _vector(state.get("velocity"), Vector2.ZERO)
	return Vector2(float(state.get("vx", 0.0)), float(state.get("vy", 0.0)))


static func _radius(state: Dictionary) -> float:
	return float(state.get("radius", PLAYER_RADIUS))


static func _set_motion(state: Dictionary, position: Vector2, velocity: Vector2) -> void:
	state["position"] = position
	state["velocity"] = velocity
	# Web aliases make a result directly comparable with replay output.
	state["x"] = position.x
	state["y"] = position.y
	state["vx"] = velocity.x
	state["vy"] = velocity.y


static func _properties(object: Dictionary) -> Dictionary:
	var value: Variant = object.get("properties", {})
	return value if value is Dictionary else {}


static func _object_value(object: Dictionary, key: String, fallback: Variant = null) -> Variant:
	if object.has(key):
		return object.get(key)
	return _properties(object).get(key, fallback)


static func _object_kind(object: Dictionary) -> String:
	return str(_object_value(object, "objectKind", _object_value(object, "object_kind", "")))


static func _object_id(object: Dictionary) -> String:
	return str(object.get("id", object.get("object_id", "")))


static func _transform(object: Dictionary) -> Dictionary:
	var resolved: Variant = object.get("resolvedTransform", object.get("resolved_transform", {}))
	if resolved is Dictionary and not resolved.is_empty():
		return resolved
	var authored: Variant = object.get("transform", {})
	return authored if authored is Dictionary else {}


static func _object_position(object: Dictionary) -> Vector2:
	if object.has("x") or object.has("y"):
		return Vector2(float(object.get("x", 0.0)), float(object.get("y", 0.0)))
	if object.has("position"):
		return _vector(object.get("position"), Vector2.ZERO)
	return _vector(_transform(object).get("position", {}), Vector2.ZERO)


static func _rect(object: Dictionary) -> Dictionary:
	var collision_bounds: Variant = object.get("collisionBounds", object.get("collision_bounds", {}))
	if collision_bounds is Dictionary and not collision_bounds.is_empty():
		return {
			"x": float(collision_bounds.get("x", 0.0)),
			"y": float(collision_bounds.get("y", 0.0)),
			"w": float(collision_bounds.get("w", 0.0)),
			"h": float(collision_bounds.get("h", 0.0))
		}
	var origin := _object_position(object)
	return {
		"x": origin.x,
		"y": origin.y,
		"w": float(_object_value(object, "w", 0.0)),
		"h": float(_object_value(object, "h", 0.0))
	}


static func _slope_segment(object: Dictionary) -> Dictionary:
	if object.has("ax") or object.has("ay") or object.has("bx") or object.has("by"):
		return {
			"ax": float(object.get("ax", 0.0)), "ay": float(object.get("ay", 0.0)),
			"bx": float(object.get("bx", 0.0)), "by": float(object.get("by", 0.0)),
			"thickness": float(_object_value(object, "thickness", DEFAULT_SLOPE_THICKNESS))
		}
	var origin := _object_position(object)
	var transform := _transform(object)
	var scale := _vector(transform.get("scale", {}), Vector2.ONE)
	var endpoint := Vector2(
		float(_object_value(object, "dx", 0.0)) * scale.x,
		float(_object_value(object, "dy", 0.0)) * scale.y
	)
	endpoint = endpoint.rotated(deg_to_rad(float(transform.get("rotationDegrees", transform.get("rotation_degrees", 0.0)))))
	return {
		"ax": origin.x, "ay": origin.y,
		"bx": origin.x + endpoint.x, "by": origin.y + endpoint.y,
		"thickness": float(_object_value(object, "thickness", DEFAULT_SLOPE_THICKNESS)) * maxf(absf(scale.x), absf(scale.y))
	}


static func _normal_dictionary(normal: Vector2) -> Dictionary:
	return {"x": normal.x, "y": normal.y}


static func _contact(kind: String, normal: Vector2, object: Dictionary, extra := {}) -> Dictionary:
	var result := {
		"kind": kind,
		"id": _object_id(object),
		"normal": normal,
		"normal_web": _normal_dictionary(normal)
	}
	for key in extra:
		result[key] = extra[key]
	return result


static func _collision_result(
	state: Dictionary,
	position: Vector2,
	velocity: Vector2,
	normal: Vector2,
	kind: String,
	object: Dictionary,
	extra := {}
) -> Dictionary:
	var result := state.duplicate(true)
	_set_motion(result, position, velocity)
	result["normal"] = normal
	result["normal_web"] = _normal_dictionary(normal)
	result["contact"] = _contact(kind, normal, object, extra)
	return result


static func _remove_inward_velocity(velocity: Vector2, normal: Vector2) -> Vector2:
	var into_surface := velocity.dot(normal)
	return velocity - normal * into_surface if into_surface < 0.0 else velocity


static func resolve_circle_rect(state: Dictionary, object: Dictionary) -> Dictionary:
	var position := _position(state)
	var velocity := _velocity(state)
	var radius := _radius(state)
	var rect := _rect(object)
	var closest := Vector2(
		clampf(position.x, float(rect.x), float(rect.x) + float(rect.w)),
		clampf(position.y, float(rect.y), float(rect.y) + float(rect.h))
	)
	var offset := position - closest
	var distance := offset.length()
	if distance >= radius:
		return {}

	var normal: Vector2
	var penetration: float
	if distance > RECT_DISTANCE_EPSILON:
		normal = offset / distance
		penetration = radius - distance
	else:
		# Strict `<` preserves the Web array-sort tie order: left, right, top,
		# bottom. That matters for a circle whose centre is inside a rectangle.
		var edges := [
			{"distance": position.x - float(rect.x), "normal": Vector2.LEFT},
			{"distance": float(rect.x) + float(rect.w) - position.x, "normal": Vector2.RIGHT},
			{"distance": position.y - float(rect.y), "normal": Vector2.UP},
			{"distance": float(rect.y) + float(rect.h) - position.y, "normal": Vector2.DOWN}
		]
		var closest_edge: Dictionary = edges[0]
		for edge in edges.slice(1):
			if float(edge.distance) < float(closest_edge.distance):
				closest_edge = edge
		normal = closest_edge.normal
		penetration = radius + float(closest_edge.distance)

	return _collision_result(
		state,
		position + normal * penetration,
		_remove_inward_velocity(velocity, normal),
		normal,
		"rect",
		object,
		{"penetration": penetration}
	)


static func _closest_point_on_segment(point: Vector2, start: Vector2, end: Vector2) -> Vector2:
	var segment := end - start
	var length_squared := segment.length_squared()
	if length_squared < 0.000001:
		return start
	return start + segment * clampf((point - start).dot(segment) / length_squared, 0.0, 1.0)


static func resolve_slope(
	state: Dictionary,
	object: Dictionary,
	gravity := Vector2.DOWN,
	default_thickness := DEFAULT_SLOPE_THICKNESS
) -> Dictionary:
	var position := _position(state)
	var velocity := _velocity(state)
	var radius := _radius(state)
	var segment := _slope_segment(object)
	var start := Vector2(float(segment.ax), float(segment.ay))
	var end := Vector2(float(segment.bx), float(segment.by))
	var closest := _closest_point_on_segment(position, start, end)
	var offset := position - closest
	var distance := offset.length()
	var authored_thickness := float(segment.get("thickness", default_thickness))
	var collision_radius := radius + authored_thickness * 0.5
	if distance >= collision_radius:
		return {}
	var gravity_direction: Vector2 = _vector(gravity, Vector2.DOWN)
	if gravity_direction.length_squared() <= 0.000000000001:
		gravity_direction = Vector2.DOWN
	else:
		gravity_direction = gravity_direction.normalized()
	var normal := -gravity_direction if distance < 0.000001 else offset / distance
	var penetration := collision_radius - distance
	return _collision_result(
		state,
		position + normal * penetration,
		_remove_inward_velocity(velocity, normal),
		normal,
		"slope",
		object,
		{"penetration": penetration, "closest_point": closest}
	)


static func hazard_base_segment(hazard: Dictionary) -> Dictionary:
	var rect := _rect(hazard)
	var x := float(rect.x)
	var y := float(rect.y)
	var width := float(rect.w)
	var height := float(rect.h)
	var direction := str(_object_value(hazard, "direction", "up"))
	match direction:
		"down":
			return {"ax": x, "ay": y, "bx": x + width, "by": y, "normal": Vector2.DOWN}
		"left":
			return {"ax": x + width, "ay": y, "bx": x + width, "by": y + height, "normal": Vector2.LEFT}
		"right":
			return {"ax": x, "ay": y, "bx": x, "by": y + height, "normal": Vector2.RIGHT}
		_:
			return {"ax": x, "ay": y + height, "bx": x + width, "by": y + height, "normal": Vector2.UP}


static func resolve_hazard_base(state: Dictionary, hazard: Dictionary) -> Dictionary:
	var position := _position(state)
	var previous := _previous_position(state)
	var velocity := _velocity(state)
	var radius := _radius(state)
	var base := hazard if hazard.has("normal") and hazard.has("ax") else hazard_base_segment(hazard)
	var normal: Vector2 = _vector(
		base.get("normal", {"x": base.get("normalX", 0.0), "y": base.get("normalY", 0.0)}),
		Vector2.ZERO
	)
	var horizontal := is_equal_approx(float(base.get("ay", 0.0)), float(base.get("by", 0.0)))
	if horizontal:
		if position.x < minf(float(base.ax), float(base.bx)) - radius or position.x > maxf(float(base.ax), float(base.bx)) + radius:
			return {}
	elif position.y < minf(float(base.ay), float(base.by)) - radius or position.y > maxf(float(base.ay), float(base.by)) + radius:
		return {}

	var start := Vector2(float(base.ax), float(base.ay))
	var current_distance := (position - start).dot(normal)
	var previous_distance := (previous - start).dot(normal)
	if current_distance >= radius or (previous_distance < 0.0 and current_distance < 0.0):
		return {}
	var penetration := radius - current_distance
	return _collision_result(
		state,
		position + normal * penetration,
		_remove_inward_velocity(velocity, normal),
		normal,
		"hazard_base",
		hazard,
		{"penetration": penetration}
	)


static func _boundary_definition(side: String) -> Dictionary:
	match side:
		"left": return {"axis": "x", "tangent": "y", "normal": Vector2.LEFT}
		"right": return {"axis": "x", "tangent": "y", "normal": Vector2.RIGHT}
		"top": return {"axis": "y", "tangent": "x", "normal": Vector2.UP}
		"bottom": return {"axis": "y", "tangent": "x", "normal": Vector2.DOWN}
		_: return {}


static func _axis_value(point: Vector2, axis: String) -> float:
	return point.x if axis == "x" else point.y


static func _face_position(rect: Dictionary, side: String) -> float:
	if side == "left": return float(rect.x)
	if side == "right": return float(rect.x) + float(rect.w)
	if side == "top": return float(rect.y)
	return float(rect.y) + float(rect.h)


static func resolve_boundary_wall(state: Dictionary, wall: Dictionary) -> Dictionary:
	if _radius(state) <= 0.0:
		return {}
	var side := str(_object_value(wall, "blockingSide", _object_value(wall, "blocking_side", "all")))
	if side == "all" or side.is_empty():
		var solid := resolve_circle_rect(state, wall)
		if solid.is_empty():
			return {}
		solid.contact = _contact("boundary_wall", solid.normal, wall, {"side": "all", "penetration": solid.contact.get("penetration", 0.0)})
		return solid

	var definition := _boundary_definition(side)
	if definition.is_empty():
		return {}
	var position := _position(state)
	var previous := _previous_position(state)
	var velocity := _velocity(state)
	var radius := _radius(state)
	var rect := _rect(wall)
	var normal: Vector2 = definition.normal
	var axis := str(definition.axis)
	var tangent_axis := str(definition.tangent)
	var plane := _face_position(rect, side)
	var normal_axis := normal.x if axis == "x" else normal.y
	var previous_distance := (_axis_value(previous, axis) - plane) * normal_axis
	var current_distance := (_axis_value(position, axis) - plane) * normal_axis
	var crossed := previous_distance >= radius - RECT_DISTANCE_EPSILON and current_distance < radius
	var stranded := previous_distance < radius and current_distance < radius and current_distance <= previous_distance + RECT_DISTANCE_EPSILON
	if (not crossed and not stranded) or current_distance >= radius:
		return {}

	var denominator := previous_distance - current_distance
	var crossing_amount := clampf((previous_distance - radius) / denominator, 0.0, 1.0) if crossed and denominator > 0.0 else 1.0
	var crossing_tangent := lerpf(_axis_value(previous, tangent_axis), _axis_value(position, tangent_axis), crossing_amount)
	var tangent_min := float(rect.y) if axis == "x" else float(rect.x)
	var tangent_max := tangent_min + (float(rect.h) if axis == "x" else float(rect.w))
	if crossing_tangent < tangent_min - radius or crossing_tangent > tangent_max + radius:
		return {}

	var resolved_position := position
	if axis == "x":
		resolved_position.x = plane + normal.x * radius
	else:
		resolved_position.y = plane + normal.y * radius
	return _collision_result(
		state,
		resolved_position,
		_remove_inward_velocity(velocity, normal),
		normal,
		"boundary_wall",
		wall,
		{"side": side}
	)


static func moving_rect_sweep_contact(state: Dictionary, moving_rect: Dictionary) -> Dictionary:
	if not moving_rect.has("previousX") and not moving_rect.has("previous_x") and not moving_rect.has("previous_position"):
		return {}
	var current_rect := _rect(moving_rect)
	var current_origin := Vector2(float(current_rect.x), float(current_rect.y))
	var previous_origin: Vector2
	if moving_rect.has("previous_position"):
		previous_origin = _vector(moving_rect.previous_position, current_origin)
	else:
		previous_origin = Vector2(
			float(moving_rect.get("previousX", moving_rect.get("previous_x", current_origin.x))),
			float(moving_rect.get("previousY", moving_rect.get("previous_y", current_origin.y)))
		)
	var start := _previous_position(state) - previous_origin
	var end := _position(state) - current_origin
	var radius := _radius(state)
	var minimum := Vector2(-radius, -radius)
	var maximum := Vector2(float(current_rect.w) + radius, float(current_rect.h) + radius)
	var delta := end - start
	var entry := 0.0
	var exit := 1.0
	var normal := Vector2.ZERO
	for axis in [
		{"start": start.x, "delta": delta.x, "min": minimum.x, "max": maximum.x, "near": Vector2.LEFT if delta.x > 0.0 else Vector2.RIGHT},
		{"start": start.y, "delta": delta.y, "min": minimum.y, "max": maximum.y, "near": Vector2.UP if delta.y > 0.0 else Vector2.DOWN}
	]:
		if absf(float(axis.delta)) < SWEEP_EPSILON:
			if float(axis.start) < float(axis.min) or float(axis.start) > float(axis.max):
				return {}
			continue
		var first := (float(axis.min) - float(axis.start)) / float(axis.delta)
		var second := (float(axis.max) - float(axis.start)) / float(axis.delta)
		var near := minf(first, second)
		var far := maxf(first, second)
		if near > entry:
			entry = near
			normal = axis.near
		exit = minf(exit, far)
		if entry > exit:
			return {}
	if entry < 0.0 or entry > 1.0:
		return {}
	return {
		"amount": entry,
		"normal": normal,
		"relative_position": start + delta * entry,
		"relativeX": start.x + delta.x * entry,
		"relativeY": start.y + delta.y * entry
	}


static func resolve_moving_rect(state: Dictionary, moving_rect: Dictionary) -> Dictionary:
	var sweep := moving_rect_sweep_contact(state, moving_rect)
	if sweep.is_empty() or sweep.normal == Vector2.ZERO:
		return {}
	var rect := _rect(moving_rect)
	var platform_velocity := Vector2(
		float(moving_rect.get("velocityX", moving_rect.get("velocity_x", 0.0))),
		float(moving_rect.get("velocityY", moving_rect.get("velocity_y", 0.0)))
	)
	if moving_rect.get("velocity") is Vector2 or moving_rect.get("velocity") is Dictionary:
		platform_velocity = _vector(moving_rect.velocity, platform_velocity)
	var normal: Vector2 = sweep.normal
	var velocity := _velocity(state)
	var into_surface := (velocity - platform_velocity).dot(normal)
	if into_surface < 0.0:
		velocity -= normal * into_surface
	var position: Vector2 = Vector2(float(rect.x), float(rect.y)) + _vector(sweep.relative_position, Vector2.ZERO) + normal * 0.01
	return _collision_result(
		state,
		position,
		velocity,
		normal,
		"moving_rect_sweep",
		moving_rect,
		{"amount": sweep.amount, "platform_velocity": platform_velocity}
	)


static func _append_array(target: Array, value: Variant) -> void:
	if value is Array:
		for item in value:
			if item is Dictionary:
				target.append(item)


static func _collections(objects: Dictionary) -> Dictionary:
	var boundaries: Array = []
	var platforms: Array = []
	var slopes: Array = []
	var hazards: Array = []
	_append_array(boundaries, objects.get("boundaryWalls", objects.get("boundary_walls", [])))
	_append_array(platforms, objects.get("platforms", []))
	_append_array(platforms, objects.get("movingPlatforms", objects.get("moving_platforms", [])))
	_append_array(slopes, objects.get("slopes", []))
	_append_array(hazards, objects.get("hazards", []))
	_append_array(hazards, objects.get("movingHazards", objects.get("moving_hazards", [])))

	var fragile: Array = []
	_append_array(fragile, objects.get("fragilePlatforms", objects.get("fragile_platforms", [])))
	for item in fragile:
		if str(item.get("phase", "")) != "gone": platforms.append(item)
	var gates: Array = []
	_append_array(gates, objects.get("gates", []))
	for item in gates:
		if not bool(item.get("open", false)): platforms.append(item)
	var moving: Array = []
	_append_array(moving, objects.get("movingObjects", objects.get("moving_objects", [])))
	for item in moving:
		if _object_kind(item) == "platform": platforms.append(item)
		elif _object_kind(item) == "hazard": hazards.append(item)
	return {"boundaries": boundaries, "platforms": platforms, "slopes": slopes, "hazards": hazards}


static func _is_moving_platform(object: Dictionary) -> bool:
	return _object_kind(object) == "platform" or str(object.get("type", "")) == "movingObject" and _object_kind(object) == "platform"


static func _commit_collision(state: Dictionary, collision: Dictionary, classify: bool, gravity: Vector2, tangent: Vector2) -> void:
	_set_motion(state, collision.position, collision.velocity)
	var contact: Dictionary = collision.contact.duplicate(true)
	state.contacts.append(contact)
	state.contact = contact
	if not classify:
		return
	var normal: Vector2 = collision.normal
	var ground_alignment := normal.dot(-gravity)
	if ground_alignment > 0.56:
		state.grounded = true
	var wall_alignment := absf(normal.dot(tangent))
	if wall_alignment > 0.66 and ground_alignment < 0.55:
		state.wall_normal = normal
		state.wallNormal = _normal_dictionary(normal)


static func resolve_collisions(
	input_state: Dictionary,
	objects: Dictionary,
	gravity := Vector2.DOWN,
	tangent := Vector2.ZERO
) -> Dictionary:
	var result := input_state.duplicate(true)
	var gravity_direction: Vector2 = _vector(gravity, Vector2.DOWN)
	gravity_direction = Vector2.DOWN if gravity_direction.length_squared() < 0.000000000001 else gravity_direction.normalized()
	var tangent_direction: Vector2 = _vector(tangent, Vector2.ZERO)
	if tangent_direction.length_squared() < 0.000000000001:
		tangent_direction = Vector2(gravity_direction.y, -gravity_direction.x)
	else:
		tangent_direction = tangent_direction.normalized()
	var collections := _collections(objects)
	_set_motion(result, _position(input_state), _velocity(input_state))
	result["previous_position"] = _previous_position(input_state)
	result["previousX"] = _previous_position(input_state).x
	result["previousY"] = _previous_position(input_state).y
	result["radius"] = _radius(input_state)
	result["grounded"] = false
	result["wall_normal"] = null
	result["wallNormal"] = null
	result["contact"] = null
	result["contacts"] = []
	result["passes"] = 0

	for pass_index in MAX_PASSES:
		var resolved_any := false
		result.passes = pass_index + 1
		for wall in collections.boundaries:
			var collision := resolve_boundary_wall(result, wall)
			if collision.is_empty(): continue
			_commit_collision(result, collision, false, gravity_direction, tangent_direction)
			resolved_any = true
		for platform in collections.platforms:
			var collision := resolve_circle_rect(result, platform)
			if collision.is_empty() and _is_moving_platform(platform):
				collision = resolve_moving_rect(result, platform)
			if collision.is_empty(): continue
			_commit_collision(result, collision, true, gravity_direction, tangent_direction)
			resolved_any = true
		for slope in collections.slopes:
			var collision := resolve_slope(result, slope, gravity_direction)
			if collision.is_empty(): continue
			_commit_collision(result, collision, true, gravity_direction, tangent_direction)
			resolved_any = true
		for hazard in collections.hazards:
			var collision := resolve_hazard_base(result, hazard)
			if collision.is_empty(): continue
			_commit_collision(result, collision, true, gravity_direction, tangent_direction)
			resolved_any = true
		if not resolved_any:
			break
	return result
