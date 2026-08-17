class_name PlayerPhysicsRules
extends RefCounted

## Engine-independent gameplay equations shared by the Godot player/runtime.
##
## Every method is pure: callers own the returned state and decide when to
## commit it.  `tuning` may be the approved object (`{"values": {...}}`), the
## complete gameplay tuning object (`{"approved": {"values": {...}}}`), or the
## values dictionary itself.  Keeping the canonical lookup in each equation
## makes value perturbation observable in unit tests and replay diagnostics.

const EPSILON := 0.000001
const FIXED_STEP_SECONDS := 1.0 / 120.0


static func _values(tuning: Dictionary) -> Dictionary:
	var values := tuning
	if tuning.get("approved") is Dictionary:
		values = tuning["approved"]
	if values.get("values") is Dictionary:
		values = values["values"]
	return values


static func _value(tuning: Dictionary, key: String, fallback: float) -> float:
	return float(_values(tuning).get(key, fallback))


static func _safe_normalized(value: Vector2, fallback := Vector2.DOWN) -> Vector2:
	return fallback if value.length_squared() < EPSILON * EPSILON else value.normalized()


static func fixed_step_contract(replay_delta: float, tuning: Dictionary) -> Dictionary:
	var declared := _value(tuning, "fixedStep", 0.008333)
	return {
		"declared": declared,
		"expected": FIXED_STEP_SECONDS,
		"declared_matches_rounded_contract": absf(declared - FIXED_STEP_SECONDS) <= 0.000001,
		"replay_matches_exact_step": absf(replay_delta - FIXED_STEP_SECONDS) <= 0.000000001
	}


static func clamp_visual_delta(delta: float, tuning: Dictionary) -> float:
	return clampf(delta, 0.0, maxf(0.0, _value(tuning, "maxFrameDelta", 0.1)))


static func camera_follow_step(
	current: Vector2,
	player_position: Vector2,
	player_velocity: Vector2,
	rotation_active: bool,
	delta: float,
	tuning: Dictionary
) -> Dictionary:
	var frame_delta := clamp_visual_delta(delta, tuning)
	var look_ahead := 0.0 if rotation_active else _value(tuning, "cameraLookAhead", 0.18)
	var desired := player_position + Vector2(player_velocity.x * look_ahead, player_velocity.y * look_ahead * 0.45)
	var blend := 1.0 - exp(-maxf(0.0, _value(tuning, "cameraFollow", 7.5)) * frame_delta)
	return {"position": current.lerp(desired, blend), "desired": desired, "blend": blend}


static func rotation_step(from_angle: float, to_angle: float, elapsed: float, delta: float, tuning: Dictionary) -> Dictionary:
	var duration := maxf(EPSILON, _value(tuning, "rotationDuration", 1.25))
	var next_elapsed := minf(duration, maxf(0.0, elapsed) + clamp_visual_delta(delta, tuning))
	var progress := clampf(next_elapsed / duration, 0.0, 1.0)
	var eased := 4.0 * progress * progress * progress if progress < 0.5 else 1.0 - pow(-2.0 * progress + 2.0, 3.0) / 2.0
	return {
		"angle": lerpf(from_angle, to_angle, eased),
		"elapsed": next_elapsed,
		"progress": progress,
		"complete": progress >= 1.0
	}


static func gravity_for_camera_angle(camera_angle: float) -> Vector2:
	return Vector2.DOWN.rotated(-camera_angle)


static func apply_ground_friction(
	velocity: Vector2,
	gravity: Vector2,
	grounded: bool,
	unconstrained: bool,
	dashing: bool,
	input_axis: float,
	delta: float,
	tuning: Dictionary
) -> Vector2:
	if not grounded or not unconstrained or dashing or absf(input_axis) > EPSILON:
		return velocity
	var gravity_direction := _safe_normalized(gravity)
	var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
	var tangent_speed := velocity.dot(tangent)
	var next_speed := move_toward(tangent_speed, 0.0, maxf(0.0, _value(tuning, "groundFriction", 2900.0)) * maxf(0.0, delta))
	return velocity + tangent * (next_speed - tangent_speed)


static func compute_damage_recovery_velocity(
	velocity: Vector2,
	gravity: Vector2,
	away_from_source: Vector2,
	tuning: Dictionary
) -> Vector2:
	var gravity_direction := _safe_normalized(gravity)
	var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
	var falling_speed := maxf(0.0, velocity.dot(gravity_direction))
	var away_along_surface := away_from_source.dot(tangent)
	return velocity \
		- gravity_direction * falling_speed \
		- gravity_direction * _value(tuning, "damageLiftSpeed", 370.0) \
		+ tangent * away_along_surface * _value(tuning, "damageAwaySpeed", 150.0)


static func begin_damage_recovery(tuning: Dictionary) -> Dictionary:
	return {"timer": maxf(0.0, _value(tuning, "damageRecoveryWindow", 0.9)), "jump_available": true}


static func step_damage_recovery(timer: float, jump_available: bool, delta: float) -> Dictionary:
	var next_timer := maxf(0.0, timer - maxf(0.0, delta))
	return {"timer": next_timer, "jump_available": jump_available and next_timer > 0.0}


static func consume_damage_recovery_jump(timer: float, jump_available: bool) -> Dictionary:
	var consumed := jump_available and timer > 0.0
	return {"consumed": consumed, "timer": timer, "jump_available": false if consumed else jump_available}


static func respawn_delay(tuning: Dictionary) -> float:
	return maxf(0.0, _value(tuning, "respawnDelay", 0.45))


static func bash_target_cooldown(tuning: Dictionary) -> float:
	return maxf(0.0, _value(tuning, "bashTargetCooldown", 0.55))


static func is_goal_reached(
	player_position: Vector2,
	player_radius: float,
	goal_position: Vector2,
	goal_radius: float,
	tuning: Dictionary
) -> bool:
	var padding := maxf(0.0, _value(tuning, "goalActivationPadding", 26.0))
	return player_position.distance_to(goal_position) <= player_radius + goal_radius + padding


static func hard_bar_geometry(authored_thickness: float, tuning: Dictionary) -> Dictionary:
	var default_thickness := maxf(0.0, _value(tuning, "hardBarThickness", 10.0))
	var thickness := authored_thickness if authored_thickness > 0.0 else default_thickness
	return {"thickness": thickness, "collision_radius": thickness * 0.5}


static func apply_glide_fall_cap(velocity: Vector2, gravity: Vector2, tuning: Dictionary) -> Vector2:
	var gravity_direction := _safe_normalized(gravity)
	var maximum_fall_speed := maxf(0.0, _value(tuning, "glideMaximumFallSpeed", 190.0))
	var down_speed := velocity.dot(gravity_direction)
	return velocity if down_speed <= maximum_fall_speed else velocity - gravity_direction * (down_speed - maximum_fall_speed)


static func apply_updraft_entry(velocity: Vector2, gravity: Vector2, entered_updraft: bool, tuning: Dictionary) -> Vector2:
	if not entered_updraft:
		return velocity
	var gravity_direction := _safe_normalized(gravity)
	var current_down_speed := velocity.dot(gravity_direction)
	var target_down_speed := -maxf(0.0, _value(tuning, "glideUpdraftEntrySpeed", 300.0))
	return velocity if current_down_speed <= target_down_speed else velocity - gravity_direction * (current_down_speed - target_down_speed)


static func apply_updraft_lift_cap(velocity: Vector2, gravity: Vector2, tuning: Dictionary) -> Vector2:
	var gravity_direction := _safe_normalized(gravity)
	var current_down_speed := velocity.dot(gravity_direction)
	var minimum_down_speed := -maxf(0.0, _value(tuning, "glideUpdraftMaximumSpeed", 520.0))
	return velocity if current_down_speed >= minimum_down_speed else velocity + gravity_direction * (minimum_down_speed - current_down_speed)


static func update_updraft_exit(
	velocity: Vector2,
	gravity: Vector2,
	timer: float,
	was_updraft_active: bool,
	is_updraft_active: bool,
	is_gliding: bool,
	delta: float,
	tuning: Dictionary
) -> Dictionary:
	var next_timer := maxf(0.0, timer)
	var started := was_updraft_active and not is_updraft_active and is_gliding
	if started:
		next_timer = maxf(0.0, _value(tuning, "glideUpdraftExitDampingDuration", 1.05))
	if not is_gliding or is_updraft_active:
		return {"velocity": velocity, "timer": 0.0, "started": started}
	if next_timer <= 0.0:
		return {"velocity": velocity, "timer": 0.0, "started": started}
	var gravity_direction := _safe_normalized(gravity)
	var current_down_speed := velocity.dot(gravity_direction)
	var next_velocity := velocity
	if current_down_speed < 0.0:
		var next_down_speed := move_toward(
			current_down_speed,
			0.0,
			maxf(0.0, _value(tuning, "glideUpdraftExitDeceleration", 220.0)) * maxf(0.0, delta)
		)
		next_velocity += gravity_direction * (next_down_speed - current_down_speed)
	return {"velocity": next_velocity, "timer": maxf(0.0, next_timer - maxf(0.0, delta)), "started": started}


static func safe_energy_eligible(
	grounded: bool,
	rope_attached: bool,
	time_since_energy_use: float,
	energy: float,
	tuning: Dictionary
) -> bool:
	var delay := maxf(0.0, _value(tuning, "safeEnergyDelay", 0.65))
	var floor := maxf(0.0, _value(tuning, "safeEnergyFloor", 2.0))
	return grounded and not rope_attached and time_since_energy_use >= delay and energy < floor


static func regenerate_safe_energy(
	energy: float,
	grounded: bool,
	rope_attached: bool,
	time_since_energy_use: float,
	delta: float,
	tuning: Dictionary
) -> float:
	if not safe_energy_eligible(grounded, rope_attached, time_since_energy_use, energy, tuning):
		return energy
	var floor := maxf(0.0, _value(tuning, "safeEnergyFloor", 2.0))
	var regen := maxf(0.0, _value(tuning, "safeEnergyRegen", 1.35))
	return minf(floor, energy + regen * maxf(0.0, delta))


static func advance_rope_tip(tip: Vector2, target: Vector2, phase: String, delta: float, tuning: Dictionary) -> Dictionary:
	var speed := _value(tuning, "ropeLaunchSpeed", 2200.0) if phase == "firing" else _value(tuning, "ropeRetractSpeed", 2800.0)
	var offset := target - tip
	var distance := offset.length()
	var travel := maxf(0.0, speed) * maxf(0.0, delta)
	if distance <= travel or distance < EPSILON:
		return {"tip": target, "reached": true}
	return {"tip": tip + offset / distance * travel, "reached": false}


static func apply_rope_pull(
	velocity: Vector2,
	player_position: Vector2,
	anchor: Vector2,
	rope_length: float,
	delta: float,
	tuning: Dictionary
) -> Dictionary:
	var offset := player_position - anchor
	var distance := offset.length()
	var taut_length := maxf(0.0, rope_length) * 0.96
	var stretch := maxf(0.0, distance - taut_length)
	if stretch <= 0.0 or distance < EPSILON:
		return {"velocity": velocity, "stretch": 0.0, "applied": false}
	var radial := offset / distance
	var acceleration := stretch * maxf(0.0, _value(tuning, "ropePullStrength", 13.0))
	return {
		"velocity": velocity - radial * acceleration * maxf(0.0, delta),
		"stretch": stretch,
		"applied": true
	}


static func apply_rope_winch(state: Dictionary, radial: Vector2, delta: float, tuning: Dictionary) -> Dictionary:
	var step := maxf(0.0, delta)
	var minimum_length := maxf(0.0, _value(tuning, "ropeMinimumLength", 82.0))
	var maximum_reel_speed := maxf(0.0, _value(tuning, "ropeReelMaximumSpeed", 480.0))
	var reel_speed := minf(
		maximum_reel_speed,
		maxf(0.0, float(state.get("reel_speed", state.get("reelSpeed", 0.0))))
			+ maxf(0.0, _value(tuning, "ropeReelAcceleration", 1050.0)) * step
	)
	var old_length := float(state.get("length", minimum_length))
	var length := maxf(minimum_length, old_length - reel_speed * step)
	var boost_applied := bool(state.get("boost_applied", state.get("boostApplied", false)))
	var completed := not boost_applied and old_length > minimum_length and length <= minimum_length
	var pull_acceleration := maxf(0.0, _value(tuning, "ropeWinchAcceleration", 360.0)) \
		+ reel_speed * maxf(0.0, _value(tuning, "ropeWinchSpeedFactor", 1.15))
	var completion_boost := maxf(0.0, _value(tuning, "ropeWinchCompletionBoost", 240.0)) if completed else 0.0
	var direction := _safe_normalized(radial, Vector2.RIGHT)
	var velocity := Vector2(float(state.get("vx", 0.0)), float(state.get("vy", 0.0)))
	velocity -= direction * (pull_acceleration * step + completion_boost)
	return {
		"length": length,
		"reel_speed": reel_speed,
		"velocity": velocity,
		"completed": completed,
		"boost_applied": boost_applied or completed
	}


static func decelerate_rope_reel(reel_speed: float, delta: float, tuning: Dictionary) -> float:
	return move_toward(
		maxf(0.0, reel_speed),
		0.0,
		maxf(0.0, _value(tuning, "ropeReelDeceleration", 1000.0)) * maxf(0.0, delta)
	)


static func apply_swing_input(
	velocity: Vector2,
	position: Vector2,
	pivot: Vector2,
	screen_right: Vector2,
	input_axis: float,
	control_strength: float,
	just_pressed: bool,
	delta: float,
	tuning: Dictionary
) -> Dictionary:
	var radial := _safe_normalized(position - pivot)
	var circle_tangent := Vector2(radial.y, -radial.x)
	var requested_control := clampf(input_axis, -1.0, 1.0) * circle_tangent.dot(_safe_normalized(screen_right, Vector2.RIGHT))
	var target_strength := absf(requested_control)
	var blend := 1.0 - exp(-maxf(0.0, _value(tuning, "swingInputSmoothing", 11.0)) * maxf(0.0, delta))
	var next_control := control_strength + (target_strength - control_strength) * blend
	if absf(input_axis) < EPSILON or absf(requested_control) < 0.0001:
		return {"velocity": velocity, "control_strength": next_control}

	var tangential_speed := velocity.dot(circle_tangent)
	var requested_direction := 1.0 if requested_control > 0.0 else -1.0
	var speed_magnitude := absf(tangential_speed)
	var pump_full_speed := maxf(EPSILON, _value(tuning, "swingPumpFullSpeed", 240.0))
	var speed_factor := clampf(speed_magnitude / pump_full_speed, 0.0, 1.0)
	var moving_with_input := speed_magnitude < 0.001 or (tangential_speed > 0.0) == (requested_direction > 0.0)
	var next_tangential_speed := tangential_speed
	var start_kick_speed := maxf(0.0, _value(tuning, "swingStartKickSpeed", 82.0))
	if just_pressed and speed_magnitude < start_kick_speed:
		next_tangential_speed = requested_direction * start_kick_speed
	elif moving_with_input:
		next_tangential_speed = move_toward(
			tangential_speed,
			requested_direction * maxf(0.0, _value(tuning, "swingTargetSpeed", 720.0)),
			maxf(0.0, _value(tuning, "swingAcceleration", 920.0)) * speed_factor * next_control * maxf(0.0, delta)
		)
	else:
		next_tangential_speed = move_toward(
			tangential_speed,
			0.0,
			maxf(0.0, _value(tuning, "swingBraking", 1480.0)) * speed_factor * next_control * maxf(0.0, delta)
		)
	return {
		"velocity": velocity + circle_tangent * (next_tangential_speed - tangential_speed),
		"control_strength": next_control,
		"tangential_speed": next_tangential_speed
	}


static func apply_constraint_damping(
	velocity: Vector2,
	position: Vector2,
	pivot: Vector2,
	is_hard_bar: bool,
	rope_length: float,
	delta: float,
	tuning: Dictionary
) -> Dictionary:
	var offset := position - pivot
	if not is_hard_bar and offset.length() < maxf(0.0, rope_length) * 0.9:
		return {"velocity": velocity, "applied": false}
	var radial := _safe_normalized(offset)
	var tangent := Vector2(radial.y, -radial.x)
	var tangential_speed := velocity.dot(tangent)
	var damping := _value(tuning, "hardBarSwingDamping", 0.48) if is_hard_bar else _value(tuning, "ropeSwingDamping", 0.14)
	var retained_speed := tangential_speed * exp(-maxf(0.0, damping) * maxf(0.0, delta))
	return {"velocity": velocity + tangent * (retained_speed - tangential_speed), "applied": true}


static func cap_attachment_speed(velocity: Vector2, attached: bool, tuning: Dictionary) -> Vector2:
	if not attached:
		return velocity
	var maximum_speed := maxf(0.0, _value(tuning, "maximumSwingSpeed", 930.0))
	return velocity if velocity.length() <= maximum_speed or velocity.length() < EPSILON else velocity.normalized() * maximum_speed


static func rope_animation_sag(display_length: float, attached: bool, tuning: Dictionary) -> float:
	if attached:
		return 0.0
	return minf(
		maxf(0.0, _value(tuning, "ropeVisualMaximumSag", 72.0)),
		maxf(0.0, display_length) * maxf(0.0, _value(tuning, "ropeAnimationSagRatio", 0.14))
	)


static func rope_visual_sag_limit(rope_length: float, tuning: Dictionary) -> Dictionary:
	var minimum_sag := maxf(0.0, _value(tuning, "ropeVisualMinimumSag", 2.0))
	var maximum_sag := maxf(minimum_sag, _value(tuning, "ropeVisualMaximumSag", 72.0))
	var ratio := maxf(0.0, _value(tuning, "ropeVisualSagRatio", 0.18))
	return {"minimum": minimum_sag, "maximum": maximum_sag, "slack_limit": clampf(maxf(0.0, rope_length) * ratio, minimum_sag, maximum_sag)}


static func rope_visual_blend(current: float, target: float, delta: float, tuning: Dictionary) -> float:
	var blend := 1.0 - exp(-maxf(0.0, _value(tuning, "ropeVisualSmoothing", 7.5)) * maxf(0.0, delta))
	return lerpf(current, target, blend)
