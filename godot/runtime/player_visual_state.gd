class_name PlayerVisualState
extends RefCounted

## Fixed-step, render-only state for the Cablester body, tail, and rope.
##
## This helper deliberately owns no Node2D, CollisionShape2D, or physics body. A
## player feeds successful gameplay transitions and immutable physics-derived
## values into `update()`, then `_draw()` consumes `snapshot()` and
## `rope_curve()`. Consequently, deformation can never change collision.
##
## Expected update state:
##   velocity: Vector2, gravity: Vector2, tangent: Vector2, facing: -1 or 1,
##   grounded/gliding/constrained/dashing: bool, distanceTravelled: float.
## Optional one-shot inputs are jumpTriggered, dashTriggered, and
## landingImpactSpeed. Optional rope state is:
##   {id, phase, start, end, length, displayLength}; start is the player point
##   and end is the anchor/animated tip. `phase` is attached/firing/retracting.

const HALF_TURN := PI
const QUARTER_TURN := PI * 0.5
const EPSILON := 0.000001

var _tuning: Dictionary = {}
var _radius := 18.0
var _fixed_step := 1.0 / 120.0
var _max_frame_delta := 0.1
var _accumulator := 0.0

var _stretch := 0.0
var _stretch_velocity := 0.0
var _axis_angle := 0.0
var _target_stretch := 0.0
var _target_axis := 0.0
var _jump_timer := 0.0
var _landing_timer := 0.0
var _landing_squash := 0.0
var _motion_tail_blend := 0.0
var _dash_blend := 0.0

var _tail_facing := 1.0
var _tail_facing_velocity := 0.0
var _tail_offset := Vector2(-42.0, 0.0)
var _tail_velocity := Vector2.ZERO
var _previous_player_velocity := Vector2.ZERO
var _tail_desired_length := 42.0
var _tail_body_acceleration := Vector2.ZERO
var _tail_relative_force := Vector2.ZERO

var _rope_active := false
var _rope_id := ""
var _rope_phase := ""
var _rope_start := Vector2.ZERO
var _rope_end := Vector2.ZERO
var _rope_authored_length := 0.0
var _rope_display_length := 0.0
var _rope_visual_sag := 0.0
var _rope_visual_tension := 0.0
var _rope_bend := Vector2.DOWN
var _rope_target_sag := 0.0
var _rope_physical_sag := 0.0
var _rope_animation_sag := 0.0
var _rope_target_tension := 0.0
var _rope_maximum_slack_sag := 0.0


func configure(approved_tuning: Dictionary, player_radius: float = -1.0, facing: float = 1.0) -> void:
	_tuning = approved_tuning.duplicate(true)
	_radius = player_radius if player_radius > 0.0 else _t("playerRadius", 18.0)
	# The package stores 0.008333 as its canonical rounded representation. Snap
	# it back to an exact reciprocal so render state cannot accumulate that
	# serialization error over a 120 Hz physics stream.
	var declared_fixed_step := _t("fixedStep", 0.008333)
	var declared_rate := roundf(1.0 / declared_fixed_step) if declared_fixed_step > 0.0 else 120.0
	_fixed_step = 1.0 / maxf(1.0, declared_rate)
	_max_frame_delta = maxf(_fixed_step, _t("maxFrameDelta", 0.1))
	reset(facing)


func reset(facing: float = 1.0, player_velocity := Vector2.ZERO) -> void:
	_accumulator = 0.0
	_stretch = 0.0
	_stretch_velocity = 0.0
	_axis_angle = 0.0
	_target_stretch = 0.0
	_target_axis = 0.0
	_jump_timer = 0.0
	_landing_timer = 0.0
	_landing_squash = 0.0
	_motion_tail_blend = 0.0
	_dash_blend = 0.0
	_tail_facing = -1.0 if facing < 0.0 else 1.0
	_tail_facing_velocity = 0.0
	_tail_offset = Vector2(-_t("tailRestLength", 42.0) * _tail_facing, 0.0)
	_tail_velocity = Vector2.ZERO
	_previous_player_velocity = _as_vector2(player_velocity, Vector2.ZERO)
	_tail_desired_length = _t("tailRestLength", 42.0)
	_tail_body_acceleration = Vector2.ZERO
	_tail_relative_force = Vector2.ZERO
	_clear_rope()


func trigger_jump() -> void:
	_jump_timer = _t("softBodyJumpDuration", 0.17)
	_landing_timer = 0.0


func trigger_dash(direction: Vector2) -> void:
	if absf(_stretch) < 0.04 and direction.length_squared() > EPSILON:
		_axis_angle = direction.angle()
	_stretch_velocity = maxf(_stretch_velocity, 1.25)


func trigger_landing(gravity: Vector2, impact_speed: float) -> bool:
	var threshold := _t("softBodyLandingThreshold", 120.0)
	if impact_speed < threshold:
		return false
	var impact := clampf((impact_speed - threshold) / 720.0, 0.0, 1.0)
	_axis_angle = _normalized(gravity, Vector2.DOWN).angle()
	_landing_timer = _t("softBodyLandingDuration", 0.075)
	_landing_squash = 0.1 + impact * 0.16
	_stretch_velocity = minf(_stretch_velocity, -(2.4 + impact * 2.8))
	_jump_timer = 0.0
	return true


func update(state: Dictionary, delta: float) -> void:
	if bool(state.get("jumpTriggered", false)):
		trigger_jump()
	if bool(state.get("dashTriggered", false)):
		trigger_dash(_state_velocity(state))
	if state.has("landingImpactSpeed") and float(state.get("landingImpactSpeed", -1.0)) >= 0.0:
		trigger_landing(_state_gravity(state), float(state.get("landingImpactSpeed", -1.0)))
	if delta <= 0.0:
		return

	_accumulator += minf(delta, _max_frame_delta)
	while _accumulator + EPSILON >= _fixed_step:
		_step(state, _fixed_step)
		_accumulator -= _fixed_step
	if _accumulator < EPSILON:
		_accumulator = 0.0


func soft_body_pose() -> Dictionary:
	var long_scale := clampf(1.0 + _stretch, 0.76, 1.48)
	return {
		"angle": _axis_angle,
		"longRadius": _radius * long_scale,
		"crossRadius": _radius / long_scale,
		"areaRatio": long_scale * (1.0 / long_scale)
	}


func snapshot() -> Dictionary:
	return {
		"renderOnly": true,
		"collisionRadius": _radius,
		"softBody": {
			"stretch": _stretch,
			"stretchVelocity": _stretch_velocity,
			"axisAngle": _axis_angle,
			"targetStretch": _target_stretch,
			"targetAxis": _target_axis,
			"jumpTimer": _jump_timer,
			"landingTimer": _landing_timer,
			"landingSquash": _landing_squash,
			"motionTailBlend": _motion_tail_blend,
			"dashBlend": _dash_blend,
			"pose": soft_body_pose()
		},
		"tail": {
			"facing": _tail_facing,
			"facingVelocity": _tail_facing_velocity,
			"offset": _tail_offset,
			"velocity": _tail_velocity,
			"desiredLength": _tail_desired_length,
			"bodyAcceleration": _tail_body_acceleration,
			"relativeForce": _tail_relative_force
		},
		"rope": {
			"active": _rope_active,
			"id": _rope_id,
			"phase": _rope_phase,
			"start": _rope_start,
			"end": _rope_end,
			"authoredLength": _rope_authored_length,
			"displayLength": _rope_display_length,
			"visualSag": _rope_visual_sag,
			"visualTension": _rope_visual_tension,
			"bend": _rope_bend,
			"targetSag": _rope_target_sag,
			"physicalSag": _rope_physical_sag,
			"animationSag": _rope_animation_sag,
			"targetTension": _rope_target_tension,
			"maximumSlackSag": _rope_maximum_slack_sag
		},
		"timing": {
			"fixedStep": _fixed_step,
			"accumulator": _accumulator,
			"maxFrameDelta": _max_frame_delta
		}
	}


func rope_curve(point_count: int = 17) -> PackedVector2Array:
	var points := PackedVector2Array()
	if not _rope_active:
		return points
	var count := maxi(2, point_count)
	var control_shift := _rope_visual_sag * 1.28
	var first_control := _rope_end.lerp(_rope_start, 0.33) + _rope_bend * control_shift
	var second_control := _rope_end.lerp(_rope_start, 0.67) + _rope_bend * control_shift
	for index in range(count):
		var amount := float(index) / float(count - 1)
		var inverse := 1.0 - amount
		points.append(
			_rope_end * inverse * inverse * inverse
			+ first_control * 3.0 * inverse * inverse * amount
			+ second_control * 3.0 * inverse * amount * amount
			+ _rope_start * amount * amount * amount
		)
	return points


func _step(state: Dictionary, delta: float) -> void:
	var velocity := _state_velocity(state)
	var gravity := _state_gravity(state)
	var tangent := _normalized(
		_as_vector2(state.get("tangent", Vector2(gravity.y, -gravity.x)), Vector2(gravity.y, -gravity.x)),
		Vector2(gravity.y, -gravity.x)
	)
	var speed := velocity.length()
	var gravity_speed := absf(velocity.dot(gravity))
	var tangent_speed := absf(velocity.dot(tangent))
	var velocity_angle := velocity.angle() if speed > 0.001 else tangent.angle()
	var gravity_angle := gravity.angle()
	var grounded := bool(state.get("grounded", false))
	var gliding := bool(state.get("gliding", false))
	var constrained := bool(state.get("constrained", false))
	var dashing := bool(state.get("dashing", false))
	_target_stretch = 0.0
	_target_axis = tangent.angle()

	if _landing_timer > 0.0:
		_target_stretch = -_landing_squash
		_target_axis = gravity_angle
	elif dashing:
		_target_stretch = _t("softBodyDashStretch", 0.42)
		_target_axis = velocity_angle
	elif _jump_timer > 0.0:
		var squash_at_start := _jump_timer > _t("softBodyJumpDuration", 0.17) - _t("softBodyJumpSquashDuration", 0.035)
		_target_stretch = -_t("softBodyJumpSquash", 0.12) if squash_at_start else _t("softBodyJumpStretch", 0.3)
		_target_axis = gravity_angle
	elif constrained and speed > 45.0:
		var swing_amount := clampf(speed / _t("maximumSwingSpeed", 930.0), 0.0, 1.0)
		_target_stretch = 0.055 + swing_amount * _t("softBodySwingStretch", 0.34)
		_target_axis = velocity_angle
	elif not grounded and not gliding:
		_target_stretch = clampf(
			gravity_speed / _t("jumpSpeed", 590.0) * _t("softBodyAirStretch", 0.24),
			0.0,
			_t("softBodyAirStretch", 0.24)
		)
		_target_axis = gravity_angle
	elif grounded and tangent_speed > 35.0:
		var roll := 0.5 + sin(float(state.get("distanceTravelled", 0.0)) / 9.0) * 0.5
		_target_stretch = 0.018 + roll * 0.025

	var axis_rate := _t("softBodyAxisFollow", 15.0) + (16.0 if dashing else 0.0)
	var axis_amount := 1.0 - exp(-axis_rate * delta)
	_axis_angle += _shortest_axis_delta(_axis_angle, _target_axis) * axis_amount

	var body_spring := _step_spring(
		_stretch,
		_stretch_velocity,
		_target_stretch,
		_t("softBodySpringFrequency", 18.0),
		_t("softBodySpringDamping", 0.72),
		delta
	)
	_stretch = clampf(float(body_spring.value), -0.24, 0.48)
	_stretch_velocity = float(body_spring.velocity)

	var tail_spring := _step_spring(
		_tail_facing,
		_tail_facing_velocity,
		-1.0 if float(state.get("facing", 1.0)) < 0.0 else 1.0,
		_t("tailTurnSpringFrequency", 16.0),
		_t("tailTurnSpringDamping", 0.86),
		delta
	)
	_tail_facing = clampf(float(tail_spring.value), -1.08, 1.08)
	_tail_facing_velocity = float(tail_spring.velocity)
	_update_tail(state, velocity, gravity, tangent, speed, delta)
	_update_rope(state, velocity, gravity, delta)

	var uses_motion_tail := speed > 120.0 and (dashing or constrained)
	var motion_amount := 1.0 - exp(-(18.0 if uses_motion_tail else 9.0) * delta)
	_motion_tail_blend += ((1.0 if uses_motion_tail else 0.0) - _motion_tail_blend) * motion_amount
	var dash_amount := 1.0 - exp(-(28.0 if dashing else 10.0) * delta)
	_dash_blend += ((1.0 if dashing else 0.0) - _dash_blend) * dash_amount
	_jump_timer = maxf(0.0, _jump_timer - delta)
	_landing_timer = maxf(0.0, _landing_timer - delta)


func _update_tail(state: Dictionary, velocity: Vector2, gravity: Vector2, tangent: Vector2, speed: float, delta: float) -> void:
	var facing_back := -tangent * _tail_facing
	var fallback_back := facing_back if facing_back.length() > 0.05 else -tangent * (-1.0 if float(state.get("facing", 1.0)) < 0.0 else 1.0)
	var motion_back := -velocity / speed if speed > 0.001 else fallback_back
	var tail_is_free := not bool(state.get("grounded", false)) or bool(state.get("constrained", false)) or bool(state.get("dashing", false))
	var motion_influence := clampf(0.18 + speed / 680.0, 0.18, 0.94) if tail_is_free else 0.0
	var gravity_sag := 0.1 if bool(state.get("grounded", false)) else 0.22 * (1.0 - motion_influence)
	var desired := fallback_back * (1.0 - motion_influence) + motion_back * motion_influence + gravity * gravity_sag
	_tail_desired_length = _t("tailRestLength", 42.0) + clampf(speed / _t("maximumSwingSpeed", 930.0), 0.0, 1.0) * 10.0
	if desired.length_squared() < EPSILON:
		desired = fallback_back
	var target := desired.normalized() * _tail_desired_length

	_tail_body_acceleration = _limit_vector((velocity - _previous_player_velocity) / delta, _t("tailMaximumBodyAcceleration", 4200.0))
	_tail_relative_force = (-_tail_body_acceleration + gravity * _t("gravity", 1550.0)) * _t("tailInertia", 0.18)
	var frequency := _t("tailPhysicsFrequency", 10.5)
	var damping := 2.0 * _t("tailPhysicsDamping", 0.64) * frequency
	var acceleration := (target - _tail_offset) * frequency * frequency - _tail_velocity * damping + _tail_relative_force
	_tail_velocity += acceleration * delta
	_tail_offset += _tail_velocity * delta

	var maximum_length := _t("tailMaximumLength", 58.0)
	var limited_offset := _limit_vector(_tail_offset, maximum_length)
	if not limited_offset.is_equal_approx(_tail_offset):
		var radial := limited_offset / maximum_length if maximum_length > EPSILON else Vector2.ZERO
		var outward_speed := _tail_velocity.dot(radial)
		if outward_speed > 0.0:
			_tail_velocity -= radial * outward_speed
		_tail_offset = limited_offset
	_previous_player_velocity = velocity


func _update_rope(state: Dictionary, velocity: Vector2, gravity: Vector2, delta: float) -> void:
	var rope_value = state.get("rope", {})
	if not (rope_value is Dictionary) or rope_value.is_empty() or str(rope_value.get("phase", "")) in ["", "none"]:
		_clear_rope()
		return
	var rope: Dictionary = rope_value
	var rope_id := str(rope.get("id", "rope"))
	var is_new_rope := not _rope_active or rope_id != _rope_id
	_rope_active = true
	_rope_id = rope_id
	_rope_phase = str(rope.get("phase", "attached"))
	_rope_start = _as_vector2(rope.get("start", Vector2.ZERO), Vector2.ZERO)
	_rope_end = _as_vector2(rope.get("end", _rope_start), _rope_start)
	var distance := _rope_start.distance_to(_rope_end)
	_rope_authored_length = maxf(EPSILON, float(rope.get("length", distance)))
	_rope_display_length = maxf(
		_t("ropeMinimumLength", 82.0),
		float(rope.get("displayLength", distance))
	)
	var minimum_sag := _t("ropeVisualMinimumSag", 2.0)
	var maximum_sag := _t("ropeVisualMaximumSag", 72.0)
	if is_new_rope:
		_rope_visual_sag = minimum_sag
		_rope_visual_tension = 0.0
		_rope_bend = _normalized(gravity, Vector2.DOWN)

	var radial := _normalized(_rope_start - _rope_end, Vector2.DOWN)
	var circle_tangent := Vector2(radial.y, -radial.x)
	var gravity_direction := _normalized(gravity, Vector2.DOWN)
	var hang_alignment := clampf(radial.dot(gravity_direction), -1.0, 1.0)
	var bottomness := clampf((hang_alignment + 0.15) / 1.15, 0.0, 1.0)
	var tangential_speed := absf(velocity.dot(circle_tangent))
	var speed_tension := clampf(tangential_speed / _t("maximumSwingSpeed", 930.0), 0.0, 1.0)
	var tautness := clampf(distance / _rope_authored_length, 0.0, 1.0)
	var slackness := clampf((1.0 - tautness) / 0.35, 0.0, 1.0)
	_rope_target_tension = clampf((bottomness * 0.85 + speed_tension * 0.35) * tautness, 0.0, 1.0)
	var curve_ratio := clampf((1.0 - _rope_target_tension) * 0.75 + slackness * 0.75, 0.0, 1.0)
	_rope_maximum_slack_sag = clampf(_rope_authored_length * _t("ropeVisualSagRatio", 0.18), minimum_sag, maximum_sag)
	_rope_physical_sag = minimum_sag + (_rope_maximum_slack_sag - minimum_sag) * curve_ratio
	_rope_animation_sag = 0.0 if _rope_phase == "attached" else minf(maximum_sag, _rope_display_length * _t("ropeAnimationSagRatio", 0.14))
	_rope_target_sag = clampf(_rope_physical_sag + _rope_animation_sag, minimum_sag, maximum_sag)
	var target_tension := _rope_target_tension if _rope_phase == "attached" else _rope_target_tension * 0.2

	var gravity_along_rope := gravity_direction.dot(radial)
	var perpendicular_gravity := gravity_direction - radial * gravity_along_rope
	var target_bend: Vector2
	if perpendicular_gravity.length() > 0.05:
		target_bend = perpendicular_gravity.normalized()
	else:
		var tangential_direction := -1.0 if velocity.dot(circle_tangent) < 0.0 else 1.0
		target_bend = circle_tangent * tangential_direction
	var blend := 1.0 - exp(-_t("ropeVisualSmoothing", 7.5) * delta)
	_rope_visual_sag = clampf(lerpf(_rope_visual_sag, _rope_target_sag, blend), minimum_sag, maximum_sag)
	_rope_visual_tension = lerpf(_rope_visual_tension, target_tension, blend)
	_rope_bend = _normalized(_rope_bend.lerp(target_bend, blend), target_bend)


func _clear_rope() -> void:
	_rope_active = false
	_rope_id = ""
	_rope_phase = ""
	_rope_start = Vector2.ZERO
	_rope_end = Vector2.ZERO
	_rope_authored_length = 0.0
	_rope_display_length = 0.0
	_rope_visual_sag = 0.0
	_rope_visual_tension = 0.0
	_rope_bend = Vector2.DOWN
	_rope_target_sag = 0.0
	_rope_physical_sag = 0.0
	_rope_animation_sag = 0.0
	_rope_target_tension = 0.0
	_rope_maximum_slack_sag = 0.0


func _state_velocity(state: Dictionary) -> Vector2:
	if state.has("velocity"):
		return _as_vector2(state.velocity, Vector2.ZERO)
	return Vector2(float(state.get("vx", 0.0)), float(state.get("vy", 0.0)))


func _state_gravity(state: Dictionary) -> Vector2:
	return _normalized(_as_vector2(state.get("gravity", Vector2.DOWN), Vector2.DOWN), Vector2.DOWN)


func _as_vector2(value, fallback: Vector2) -> Vector2:
	if value is Vector2:
		return value
	if value is Dictionary:
		return Vector2(float(value.get("x", fallback.x)), float(value.get("y", fallback.y)))
	return fallback


func _normalized(value: Vector2, fallback: Vector2) -> Vector2:
	return value.normalized() if value.length_squared() > EPSILON else fallback.normalized()


func _limit_vector(value: Vector2, maximum_length: float) -> Vector2:
	if maximum_length <= 0.0:
		return Vector2.ZERO
	return value.limit_length(maximum_length)


func _shortest_axis_delta(from_angle: float, to_angle: float) -> float:
	return fposmod(to_angle - from_angle + QUARTER_TURN, HALF_TURN) - QUARTER_TURN


func _step_spring(value: float, velocity: float, target: float, frequency: float, damping: float, delta: float) -> Dictionary:
	var acceleration := (target - value) * frequency * frequency - velocity * 2.0 * damping * frequency
	var next_velocity := velocity + acceleration * delta
	return {"value": value + next_velocity * delta, "velocity": next_velocity}


func _t(key: String, fallback: float) -> float:
	return float(_tuning.get(key, fallback))
