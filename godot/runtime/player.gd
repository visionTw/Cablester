class_name CablesterPlayer
extends CharacterBody2D

signal died
signal death_started
signal checkpoint_activated(object: CanonicalObject)
signal exit_reached(object: CanonicalObject)
signal state_changed
signal physics_step_completed
signal rotation_requested(delta_radians: float)

const ACTIONS := ["move_left", "move_right", "move_up", "move_down", "jump", "dash", "rope", "hard_bar", "bash", "grab", "reset"]
const RULES := preload("res://godot/runtime/player_physics_rules.gd")
const VISUAL_STATE := preload("res://godot/runtime/player_visual_state.gd")
const COLLISION_RULES := preload("res://godot/runtime/player_collision_rules.gd")

var world_root: Node
var canonical_world: Dictionary = {}
var state_store: WorldStateStore
var tuning: Dictionary = {}
var replay_input: Dictionary = {}
var use_replay_input := false
var aim_world := Vector2.ZERO
var radius := 18.0
var energy := 6.0
var health := 5.0
var dash_charges := 1
var maximum_dash_charges := 1
var gravity_direction := Vector2.DOWN
var checkpoint_position := Vector2.ZERO
var current_checkpoint_id := ""
var attached_object: CanonicalObject
var attached_world_point := Vector2.ZERO
var attached_target_id := ""
var attached_mode := ""
var attachment_length := 0.0
var bash_aim_target: CanonicalObject
var bash_aim_remaining := 0.0
var bash_target_id := ""
var dash_timer := 0.0
var coyote_timer := 0.0
var jump_buffer := 0.0
var air_jumps := 0
var invulnerability := 0.0
var exit_contact_cooldown := 0.0
var facing := 1.0
var distance_travelled := 0.0
var gliding := false
var collision_grounded := false
var collision_wall_normal := Vector2.ZERO
var updraft_exit_timer := 0.0
var time_since_energy_use := 99.0
var damage_recovery_timer := 0.0
var damage_recovery_jump := false
var respawn_timer := 0.0
var rope_phase := ""
var rope_tip := Vector2.ZERO
var rope_reel_speed := 0.0
var rope_reel_boost_applied := false
var swing_control := 0.0
var visual_state = VISUAL_STATE.new()
var _previous_actions: Dictionary = {}
var _launcher_cooldowns: Dictionary = {}
var _trigger_contacts: Dictionary = {}
var _bash_target_cooldowns: Dictionary = {}
var _updraft_was_active := false


func configure(runtime_root: Node, store: WorldStateStore, approved_tuning: Dictionary, world_data: Dictionary = {}) -> void:
	world_root = runtime_root
	canonical_world = world_data
	state_store = store
	tuning = approved_tuning.duplicate(true)
	radius = _t("playerRadius", 18.0)
	energy = _t("maximumEnergy", 6.0)
	health = _t("maximumHealth", 5.0)
	maximum_dash_charges = int(_t("dashCapacity", 1.0)) if state_store.has_ability("dash") else 0
	dash_charges = maximum_dash_charges
	air_jumps = 1 if state_store.has_ability("doubleJump") else 0
	visual_state.configure(tuning, radius, facing)
	_build_collision()
	queue_redraw()


func set_input_frame(actions: Dictionary, aim := Vector2.ZERO) -> void:
	replay_input = actions.duplicate(true)
	aim_world = aim
	use_replay_input = true


func clear_replay_input() -> void:
	use_replay_input = false
	replay_input = {}


func respawn() -> void:
	respawn_timer = 0.0
	global_position = checkpoint_position
	velocity = Vector2.ZERO
	health = _t("maximumHealth", 5.0)
	energy = _t("maximumEnergy", 6.0)
	dash_charges = maximum_dash_charges
	air_jumps = 1 if state_store.has_ability("doubleJump") else 0
	exit_contact_cooldown = 0.35
	dash_timer = 0.0
	coyote_timer = 0.0
	jump_buffer = 0.0
	invulnerability = 0.5
	damage_recovery_timer = 0.0
	damage_recovery_jump = false
	gliding = false
	updraft_exit_timer = 0.0
	time_since_energy_use = 99.0
	_trigger_contacts = {}
	detach()
	visual_state.reset(facing, velocity)
	collision_grounded = false
	collision_wall_normal = Vector2.ZERO
	died.emit()


func begin_respawn() -> void:
	if respawn_timer > 0.0: return
	respawn_timer = RULES.respawn_delay(tuning)
	velocity = Vector2.ZERO
	detach()
	death_started.emit()
	if respawn_timer <= 0.0: respawn()


func _physics_process(delta: float) -> void:
	if world_root == null or state_store == null: return
	if not use_replay_input:
		aim_world = _live_aim_world()
	if respawn_timer > 0.0:
		respawn_timer = maxf(0.0, respawn_timer - delta)
		if respawn_timer <= 0.0: respawn()
		_previous_actions = _current_actions()
		_update_visual_state(delta, false, false, false, 0.0)
		queue_redraw()
		physics_step_completed.emit()
		return
	invulnerability = maxf(0.0, invulnerability - delta)
	damage_recovery_timer = maxf(0.0, damage_recovery_timer - delta)
	if damage_recovery_timer <= 0.0: damage_recovery_jump = false
	exit_contact_cooldown = maxf(0.0, exit_contact_cooldown - delta)
	coyote_timer = maxf(0.0, coyote_timer - delta)
	jump_buffer = maxf(0.0, jump_buffer - delta)
	time_since_energy_use += delta
	for id in _launcher_cooldowns: _launcher_cooldowns[id] = maxf(0.0, float(_launcher_cooldowns[id]) - delta)
	for id in _bash_target_cooldowns: _bash_target_cooldowns[id] = maxf(0.0, float(_bash_target_cooldowns[id]) - delta)
	var was_on_floor := collision_grounded
	var was_gliding := gliding
	var previous_position := global_position
	var pre_move_down_speed := maxf(0.0, velocity.dot(gravity_direction))
	if was_on_floor and dash_timer <= 0.0:
		coyote_timer = _t("coyoteTime", 0.12)
		air_jumps = 1 if state_store.has_ability("doubleJump") else 0
		dash_charges = maximum_dash_charges
	var move_axis := _strength("move_right") - _strength("move_left")
	if absf(move_axis) > 0.001: facing = -1.0 if move_axis < 0.0 else 1.0
	if _just_pressed("jump"): jump_buffer = _t("jumpBufferTime", 0.12)
	if _just_pressed("dash"): _try_dash()
	if _just_pressed("rope"): _try_attach("rope")
	if _just_released("rope") and (attached_mode == "rope" or rope_phase == "firing"): _begin_rope_retract()
	# F is a toggle, matching the Web contract: press once to create the rigid
	# bar and press again to release while preserving tangential velocity.
	if _just_pressed("hard_bar"):
		if attached_mode == "hardBar": detach()
		else: _try_attach("hardBar")
	var bash_started := false
	if _just_pressed("bash"):
		_begin_bash_aim()
		bash_started = is_instance_valid(bash_aim_target)
	var bash_was_aiming := is_instance_valid(bash_aim_target)
	if bash_was_aiming:
		if not bash_started: bash_aim_remaining = maxf(0.0, bash_aim_remaining - delta)
		if not bash_started and (_just_released("bash") or bash_aim_remaining <= 0.0): _finish_bash_aim()
		# Web's bash aim owns the entire fixed step, including the release step.
		# Returning only while the target remained valid added gravity and run
		# acceleration immediately after release, creating a deterministic drift.
		_previous_actions = _current_actions()
		_update_visual_state(delta, false, false, false, 0.0)
		queue_redraw()
		physics_step_completed.emit()
		return
	if _just_pressed("reset"):
		begin_respawn()
		_previous_actions = _current_actions()
		physics_step_completed.emit()
		return
	var dashing := dash_timer > 0.0
	dash_timer = maxf(0.0, dash_timer - delta)
	# Web permits a wall jump from any precise previous-frame wall contact once
	# the ability is owned. Shift only controls the sustained wall-grab/slide.
	# Coupling the jump branch to Shift suppressed the authored recovery jumps at
	# platform corners and caused several fixed-input routes to diverge together.
	var has_wall_contact := state_store.has_ability("wallGrab") and not collision_wall_normal.is_zero_approx()
	var wall_grabbing := has_wall_contact and _held("grab")
	var liquid := _first_zone("liquidZone")

	var constrained_movement := attached_mode == "rope" or attached_mode == "hardBar"
	if not dashing and not constrained_movement:
		var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
		var target_speed := move_axis * _t("runSpeed", 350.0)
		var tangent_speed := velocity.dot(tangent)
		if absf(move_axis) > 0.001:
			var acceleration := _t("runAcceleration", 2500.0) if was_on_floor else _t("airAcceleration", 1100.0)
			tangent_speed = move_toward(tangent_speed, target_speed, acceleration * delta)
			velocity += tangent * (tangent_speed - velocity.dot(tangent))
		elif was_on_floor:
			velocity = RULES.apply_ground_friction(velocity, gravity_direction, true, attached_mode.is_empty(), false, move_axis, delta, tuning)
		var terminal := _t("terminalSpeed", 1180.0)
		var down_speed := velocity.dot(gravity_direction)
		if down_speed > terminal: velocity -= gravity_direction * (down_speed - terminal)

	if not dashing and jump_buffer > 0.0:
		if coyote_timer > 0.0:
			_jump(_t("jumpSpeed", 590.0))
		elif has_wall_contact:
			var normal := collision_wall_normal
			velocity = normal * _t("wallJumpAwaySpeed", 380.0) - gravity_direction * _t("wallJumpUpSpeed", 545.0)
			jump_buffer = 0.0
		elif damage_recovery_jump and damage_recovery_timer > 0.0:
			damage_recovery_jump = false
			_jump(_t("jumpSpeed", 590.0) * 0.92)
		elif state_store.has_ability("doubleJump") and air_jumps > 0:
			air_jumps -= 1
			_jump(_t("jumpSpeed", 590.0) * 0.94)

	# Match the Web fixed-step order: run/dash, jump, gravity, then liquid and
	# glide limits. Applying gravity before the jump and again afterward made
	# every airborne jump differ by exactly one 120 Hz gravity impulse.
	var gravity_scale := 0.0 if dashing else 1.0
	var falling_speed := velocity.dot(gravity_direction)
	var wants_glide := not dashing and attached_mode != "rope" and state_store.has_ability("glide") and _held("jump")
	gliding = not was_on_floor and wants_glide and (was_gliding or falling_speed > 40.0)
	if gliding: gravity_scale = _t("glideGravityScale", 0.2)
	if wall_grabbing:
		gravity_scale = 0.1
		var wall_down_speed := velocity.dot(gravity_direction)
		if wall_down_speed > _t("wallSlideSpeed", 85.0): velocity -= gravity_direction * (wall_down_speed - _t("wallSlideSpeed", 85.0))
	if liquid: gravity_scale *= float(liquid.canonical_properties.get("gravityScale", 0.24))
	velocity += gravity_direction * _t("gravity", 1550.0) * gravity_scale * delta
	if liquid and not dashing:
		var drag := float(liquid.canonical_properties.get("drag", 2.4))
		velocity = velocity.lerp(Vector2.ZERO, 1.0 - exp(-drag * delta))
		velocity += Vector2(float(liquid.canonical_properties.get("currentX", 0.0)), float(liquid.canonical_properties.get("currentY", 0.0))) * delta
		velocity += Vector2(_strength("move_right") - _strength("move_left"), _strength("move_down") - _strength("move_up")).normalized() * float(liquid.canonical_properties.get("swimAcceleration", 680.0)) * delta
	if gliding: velocity = RULES.apply_glide_fall_cap(velocity, gravity_direction, tuning)
	# Web advances a firing/retracting rope only after the unconstrained run,
	# jump, gravity, liquid and glide phases. Advancing it at the start of the
	# step made the exact attachment frame skip air acceleration and left a small
	# vertical offset that later selected a different platform-corner normal.
	_advance_rope_phase(delta)
	_apply_attachment(delta, move_axis)

	var current_winds := [] if dashing else _zones("windZone")
	var updraft_active := false
	for wind in current_winds:
		var multiplier := _t("glideWindMultiplier", 1.9) if gliding else 1.0
		var wind_force := Vector2(float(wind.canonical_properties.get("forceX", 0.0)), float(wind.canonical_properties.get("forceY", 0.0)))
		var lift_active := gliding and -wind_force.dot(gravity_direction) > 0.0
		if lift_active and not _updraft_was_active:
			velocity = RULES.apply_updraft_entry(velocity, gravity_direction, true, tuning)
		velocity += Vector2(float(wind.canonical_properties.get("forceX", 0.0)), float(wind.canonical_properties.get("forceY", 0.0))) * multiplier * delta
		if lift_active:
			velocity = RULES.apply_updraft_lift_cap(velocity, gravity_direction, tuning)
			updraft_active = true
	var updraft_exit := RULES.update_updraft_exit(velocity, gravity_direction, updraft_exit_timer, _updraft_was_active, updraft_active, gliding, delta, tuning)
	velocity = updraft_exit.velocity
	updraft_exit_timer = float(updraft_exit.timer)
	_updraft_was_active = updraft_active
	# The canonical Web contract uses an explicit radius-circle solver, not
	# engine-dependent CharacterBody slide semantics. Integrate once, project
	# constraints, then run the shared three-pass rect/segment/hazard-base rules.
	global_position += velocity * delta
	_constrain_attachment_position()
	_resolve_canonical_collisions(previous_position)
	# Web constrains a hard bar again after collision resolution, followed by a
	# final boundary pass. The second full pass is equivalent for valid authored
	# geometry and preserves the same deterministic three-pass cap.
	if attached_mode == "hardBar":
		_constrain_attachment_position()
		_resolve_canonical_collisions(previous_position)
	# Apply the wall cap on the first precise contact frame.
	if state_store.has_ability("wallGrab") and _held("grab") and not collision_wall_normal.is_zero_approx():
		var contact_fall_speed := velocity.dot(gravity_direction)
		if contact_fall_speed > _t("wallSlideSpeed", 85.0):
			velocity -= gravity_direction * (contact_fall_speed - _t("wallSlideSpeed", 85.0))
	_process_contacts(delta)
	distance_travelled += global_position.distance_to(previous_position)
	if collision_grounded and not dashing:
		air_jumps = 1 if state_store.has_ability("doubleJump") else 0
		dash_charges = maximum_dash_charges
	energy = RULES.regenerate_safe_energy(energy, collision_grounded, attached_mode == "rope", time_since_energy_use, delta, tuning)
	_update_visual_state(delta, not was_on_floor and collision_grounded, dashing, gliding, pre_move_down_speed)
	_previous_actions = _current_actions()
	queue_redraw()
	# WorldRuntime injects replay input before this callback and records the
	# trajectory from this signal.  Sampling here makes telemetry tick N describe
	# the state produced by input tick N instead of the previous physics frame.
	physics_step_completed.emit()


func _process_contacts(_delta: float) -> void:
	var current_contacts: Dictionary = {}
	for object in world_root.get_tree().get_nodes_in_group("canonical_objects"):
		if not _object_is_active(object): continue
		var interaction: Rect2 = object.world_interaction_bounds()
		var goal_reached: bool = object.runtime_handler == "goal" and RULES.is_goal_reached(
			global_position, radius, interaction.get_center(), float(object.canonical_properties.get("radius", interaction.size.x * 0.5)), tuning
		)
		if not goal_reached and not _circle_intersects_rect(interaction): continue
		# Do not latch an exit as an existing contact during the transition guard;
		# once the guard expires, an overlapping endpoint must become a fresh enter.
		if object.runtime_handler in ["roomExit", "goal"] and exit_contact_cooldown > 0.0: continue
		current_contacts[object.object_id] = true
		var entering := not _trigger_contacts.has(object.object_id)
		match object.runtime_handler:
			"hazard": _take_damage(float(object.canonical_properties.get("damage", 1.0)), interaction.get_center())
			"movingObject":
				if str(object.canonical_properties.get("objectKind", "")) == "hazard": _take_damage(float(object.canonical_properties.get("damage", 1.0)), interaction.get_center())
				elif str(object.canonical_properties.get("trigger", "auto")) == "touch": object.activate_motion()
			"liquidZone":
				var damage := float(object.canonical_properties.get("contactDamage", 0.0))
				if damage > 0.0: _take_damage(damage, interaction.get_center())
			"launcher":
				if float(_launcher_cooldowns.get(object.object_id, 0.0)) <= 0.0:
					var impulse := Vector2(float(object.canonical_properties.get("launchX", 0.0)), float(object.canonical_properties.get("launchY", -900.0)))
					velocity = velocity + impulse if bool(object.canonical_properties.get("preserveMomentum", false)) else impulse
					_launcher_cooldowns[object.object_id] = float(object.canonical_properties.get("cooldownSeconds", 0.35))
			"fragilePlatform": object.trigger_fragile()
			"stateTrigger":
				if entering and not bool(object.capture_state().get("consumed", false)):
					state_store.set_flag(str(object.canonical_properties.get("setFlag", "")))
					state_store.clear_flag(str(object.canonical_properties.get("clearFlag", "")))
					if bool(object.canonical_properties.get("oneUse", true)): object.consume_pickup()
					state_store.capture_object(object)
					state_changed.emit()
			"abilityPickup":
				if object.is_available():
					var ability_id := str(object.canonical_properties.get("abilityId", ""))
					state_store.unlock_ability(ability_id)
					if ability_id == "dash":
						maximum_dash_charges = int(_t("dashCapacity", 1.0))
						dash_charges = maximum_dash_charges
					elif ability_id == "doubleJump": air_jumps = maxi(air_jumps, 1)
					object.consume_pickup()
					state_store.capture_object(object)
					state_changed.emit()
			"dashRefill":
				if object.is_available():
					var charges := int(object.canonical_properties.get("charges", 1))
					dash_charges = min(maximum_dash_charges, dash_charges + charges) if str(object.canonical_properties.get("restoreMode", "fill")) == "add" else maximum_dash_charges
					object.consume_pickup()
					state_store.capture_object(object)
			"energyOrb":
				if object.is_available():
					energy = minf(_t("maximumEnergy", 6.0), energy + float(object.canonical_properties.get("amount", 1.0)))
					object.consume_pickup()
					state_store.capture_object(object)
			"checkpoint":
				if current_checkpoint_id != object.object_id:
					current_checkpoint_id = object.object_id
					state_store.set_checkpoint(object)
					checkpoint_position = Vector2(float(state_store.checkpoint.position.x), float(state_store.checkpoint.position.y))
					checkpoint_activated.emit(object)
			"roomExit", "goal":
				if entering and exit_contact_cooldown <= 0.0 and _gate_satisfied(object): exit_reached.emit(object)
			"rotationTrigger":
				if entering: rotation_requested.emit(deg_to_rad(float(object.canonical_properties.get("deltaDegrees", 90.0))))
	_trigger_contacts = current_contacts
	_update_gates()


func _circle_intersects_rect(rect: Rect2, extra_radius: float = 0.0) -> bool:
	# Exact counterpart of src/math.js circleIntersectsRect. An AABB-vs-AABB
	# contact over-reports every rounded corner by as much as 7.46 px for the
	# canonical radius, which made hazards and checkpoints fire on different
	# ticks than the Web runtime.
	var closest := Vector2(
		clampf(global_position.x, rect.position.x, rect.end.x),
		clampf(global_position.y, rect.position.y, rect.end.y)
	)
	var delta := global_position - closest
	var contact_radius := radius + extra_radius
	return delta.length_squared() <= contact_radius * contact_radius


func _object_is_active(object: CanonicalObject) -> bool:
	if not is_instance_valid(object) or not object.visible: return false
	if world_root is ChunkStreamer:
		return object.chunk_id == (world_root as ChunkStreamer).active_chunk_id
	return true


func _collision_object_dictionary(object: CanonicalObject) -> Dictionary:
	var bounds := object.world_interaction_bounds()
	var result := {
		"id": object.object_id,
		"type": object.type_id,
		"x": bounds.position.x,
		"y": bounds.position.y,
		"w": bounds.size.x,
		"h": bounds.size.y,
		"properties": object.canonical_properties.duplicate(true)
	}
	result.merge(object.canonical_properties, false)
	if object.runtime_handler == "slope":
		var endpoint := object.global_transform * Vector2(
			float(object.canonical_properties.get("dx", 0.0)),
			float(object.canonical_properties.get("dy", 0.0))
		)
		result.merge({
			"ax": object.global_position.x, "ay": object.global_position.y,
			"bx": endpoint.x, "by": endpoint.y
		}, true)
	if object.runtime_handler == "movingObject":
		var previous_object_position: Vector2 = object.runtime_previous_global_position
		var movement := object.global_position - previous_object_position
		result.merge({
			"objectKind": str(object.canonical_properties.get("objectKind", "platform")),
			"previousX": bounds.position.x - movement.x,
			"previousY": bounds.position.y - movement.y,
			"velocityX": object.runtime_velocity.x,
			"velocityY": object.runtime_velocity.y
		}, true)
	if object.runtime_handler == "gate":
		result.open = bool(object.capture_state().get("open", false))
	if object.runtime_handler == "fragilePlatform":
		result.phase = "gone" if bool(object.capture_state().get("gone", false)) else "active"
	return result


func _canonical_collision_collections() -> Dictionary:
	var collections := {
		"boundaryWalls": [], "platforms": [], "slopes": [], "hazards": [],
		"movingObjects": [], "fragilePlatforms": [], "gates": []
	}
	for object in world_root.get_tree().get_nodes_in_group("canonical_objects"):
		if not _object_is_active(object): continue
		var value := _collision_object_dictionary(object)
		match object.runtime_handler:
			"boundaryWall": collections.boundaryWalls.append(value)
			"platform": collections.platforms.append(value)
			"slope": collections.slopes.append(value)
			"hazard": collections.hazards.append(value)
			"movingObject": collections.movingObjects.append(value)
			"fragilePlatform": collections.fragilePlatforms.append(value)
			"gate": collections.gates.append(value)
	return collections


func _resolve_canonical_collisions(previous_position: Vector2) -> void:
	var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
	var resolved := COLLISION_RULES.resolve_collisions({
		"position": global_position,
		"previous_position": previous_position,
		"velocity": velocity,
		"radius": radius
	}, _canonical_collision_collections(), gravity_direction, tangent)
	global_position = resolved.position
	velocity = resolved.velocity
	collision_grounded = bool(resolved.grounded)
	collision_wall_normal = resolved.wall_normal if resolved.wall_normal is Vector2 else Vector2.ZERO


func _update_gates() -> void:
	for gate in world_root.get_tree().get_nodes_in_group("canonical_type_gate"):
		var open := bool(gate.canonical_properties.get("initiallyOpen", false))
		var required_ability := str(gate.canonical_properties.get("requiredAbility", ""))
		var required_flag := str(gate.canonical_properties.get("requiredFlag", ""))
		var checks: Array[bool] = []
		if not required_ability.is_empty(): checks.append(state_store.has_ability(required_ability))
		if not required_flag.is_empty(): checks.append(state_store.has_flag(required_flag))
		if not checks.is_empty():
			open = checks.all(func(value: bool) -> bool: return value) if str(gate.canonical_properties.get("openWhen", "any")) == "all" else checks.any(func(value: bool) -> bool: return value)
		if bool(gate.canonical_properties.get("latchOpen", true)) and bool(gate.capture_state().get("open", false)): open = true
		gate.set_gate_open(open)


func _try_dash() -> void:
	if not state_store.has_ability("dash") or dash_charges <= 0: return
	var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
	var direction := tangent * (_strength("move_right") - _strength("move_left")) + gravity_direction * (_strength("move_down") - _strength("move_up"))
	if direction.length_squared() < 0.01: direction = tangent * facing
	velocity = direction.normalized() * _t("dashSpeed", 850.0)
	dash_timer = _t("dashDuration", 0.16)
	dash_charges -= 1
	visual_state.trigger_dash(direction.normalized())


func _try_attach(mode: String) -> void:
	if not state_store.has_ability(mode): return
	var cost := _t("ropeCost", 0.5) if mode == "rope" else _t("hardBarCost", 1.25)
	if energy < cost: return
	var maximum := _t("ropeRange", _t("ropeMaximumLength", 470.0)) if mode == "rope" else _t("hardBarMaximumLength", 330.0)
	var nearest: CanonicalObject
	var nearest_point := Vector2.ZERO
	var nearest_target_id := ""
	var nearest_score := INF
	var resolved_aim_world := _resolved_aim_world()
	var aim_direction := (resolved_aim_world - global_position).normalized()
	var aim_distance := resolved_aim_world.distance_to(global_position)
	var fallback_aim := aim_direction.length_squared() < 0.01
	if fallback_aim:
		aim_direction = Vector2(gravity_direction.y, -gravity_direction.x)
	if aim_distance < 0.01: aim_distance = maximum
	var aim_ray_end := global_position + aim_direction * maximum
	for object in world_root.get_tree().get_nodes_in_group("canonical_objects"):
		var point_target: bool = object.runtime_handler == "anchor" or (object.runtime_handler == "movingObject" and str(object.canonical_properties.get("objectKind", "")) == "anchor")
		var surface_target: bool = (
			object.runtime_handler in ["platform", "slope", "fragilePlatform"]
			or (object.runtime_handler == "movingObject" and str(object.canonical_properties.get("objectKind", "")) == "platform")
			or (object.runtime_handler == "hazard" and str(object.canonical_properties.get("direction", "up")) == "up")
		)
		if surface_target and mode == "rope" and not bool(object.canonical_properties.get("grapple", object.runtime_handler == "slope")):
			surface_target = false
		if not point_target and not surface_target: continue
		if point_target and mode == "hardBar" and str(object.canonical_properties.get("anchorType", "rope")) != "both": continue
		var candidates: Array = []
		if point_target:
			candidates = [{"point": object.global_position, "id": object.object_id, "kind": "point"}]
		elif mode == "rope":
			# Web selects grapple surfaces from the closest pair between the full
			# aim ray and each authored segment. Pointer clamping chooses a
			# different point whenever the pointer lies beyond or beside a face.
			for segment in _object_surface_segments(object):
				var match := _closest_points_between_segments(global_position, aim_ray_end, segment.a, segment.b)
				candidates.append({
					"point": match.second,
					"id": segment.id,
					"kind": "rope-surface",
					"surfaceDistance": match.distance,
					"score": match.firstT * maximum + match.distance * 2.2
				})
		else:
			for segment in _object_surface_segments(object):
				candidates.append({
					"point": _closest_point_on_segment(resolved_aim_world, segment.a, segment.b),
					"id": segment.id,
					"kind": "hardbar-surface"
				})
		for candidate in candidates:
			var candidate_point: Vector2 = candidate.point
			var offset: Vector2 = candidate_point - global_position
			var distance: float = offset.length()
			var forward: float = offset.dot(aim_direction)
			var perpendicular: float = absf(offset.cross(aim_direction))
			var assist := _t("ropeSurfaceAssist", 58.0) if surface_target else _t("ropeAnchorAssist", 92.0)
			if fallback_aim: assist = maximum
			var minimum_length := _t("hardBarMinimumLength", 120.0) if mode == "hardBar" else _t("ropeMinimumTargetDistance", 72.0)
			if distance > maximum or distance < minimum_length: continue
			if str(candidate.kind) == "rope-surface":
				if float(candidate.surfaceDistance) > assist: continue
			elif forward < minimum_length or perpendicular > assist:
				continue
			if not _attachment_line_of_sight(candidate_point, object): continue
			var score: float
			if str(candidate.kind) == "rope-surface":
				score = float(candidate.score)
			elif mode == "hardBar":
				var intended_length := clampf(aim_distance, _t("hardBarMinimumLength", 120.0), maximum)
				score = perpendicular * 2.6 + absf(distance - intended_length) * 0.35 - (18.0 if point_target else 0.0)
			else:
				score = forward + perpendicular * (1.8 if point_target else 2.2) - (26.0 if point_target else 0.0)
			if score < nearest_score or (is_equal_approx(score, nearest_score) and str(candidate.id) < nearest_target_id):
				nearest = object
				nearest_point = candidate_point
				nearest_target_id = str(candidate.id)
				nearest_score = score
	if nearest:
		energy -= cost
		time_since_energy_use = 0.0
		attached_object = nearest
		attached_world_point = nearest_point
		attached_target_id = nearest_target_id
		attachment_length = global_position.distance_to(nearest_point)
		if mode == "rope":
			attached_mode = ""
			rope_phase = "firing"
			rope_tip = global_position
			rope_reel_speed = 0.0
			rope_reel_boost_applied = false
			swing_control = 0.0
		else:
			attached_mode = mode
			rope_phase = ""
			swing_control = 0.0


func _advance_rope_phase(delta: float) -> void:
	if rope_phase.is_empty() or not is_instance_valid(attached_object): return
	# Attached is a steady state. Only an input release transitions it to
	# retracting; advancing it toward the player detached a healthy rope.
	if rope_phase == "attached":
		rope_tip = attached_world_point
		return
	var target := attached_world_point if rope_phase == "firing" else global_position
	var advanced := RULES.advance_rope_tip(rope_tip, target, rope_phase, delta, tuning)
	rope_tip = advanced.tip
	if not bool(advanced.reached): return
	if rope_phase == "firing":
		if not _attachment_line_of_sight(attached_world_point, attached_object):
			rope_phase = "retracting"
			return
		rope_phase = "attached"
		attached_mode = "rope"
		rope_tip = attached_world_point
	else:
		detach()


func _begin_rope_retract() -> void:
	if rope_phase == "retracting": return
	if rope_phase == "attached" or attached_mode == "rope": rope_tip = attached_world_point
	rope_phase = "retracting"
	attached_mode = ""
	swing_control = 0.0


func _apply_attachment(delta: float, move_axis: float) -> void:
	if not is_instance_valid(attached_object):
		detach()
		return
	if attached_mode.is_empty(): return
	var pivot := attached_object.global_position if attached_object.runtime_handler == "anchor" or (attached_object.runtime_handler == "movingObject" and str(attached_object.canonical_properties.get("objectKind", "")) == "anchor") else attached_world_point
	var radial := global_position - pivot
	var distance := radial.length()
	if distance < 0.001: return
	var normal := radial / distance
	var screen_right := Vector2(gravity_direction.y, -gravity_direction.x)
	var swing := RULES.apply_swing_input(velocity, global_position, pivot, screen_right, move_axis, swing_control, _just_pressed("move_left") or _just_pressed("move_right"), delta, tuning)
	velocity = swing.velocity
	swing_control = float(swing.control_strength)
	if _held("move_up") and attached_mode == "rope":
		var winched := RULES.apply_rope_winch({
			"length": attachment_length, "reel_speed": rope_reel_speed,
			"vx": velocity.x, "vy": velocity.y, "boost_applied": rope_reel_boost_applied
		}, normal, delta, tuning)
		attachment_length = float(winched.length)
		rope_reel_speed = float(winched.reel_speed)
		rope_reel_boost_applied = bool(winched.boost_applied)
		velocity = winched.velocity
	else:
		rope_reel_speed = RULES.decelerate_rope_reel(rope_reel_speed, delta, tuning)
	if attached_mode == "rope":
		var pulled := RULES.apply_rope_pull(velocity, global_position, pivot, attachment_length, delta, tuning)
		velocity = pulled.velocity
	var damped := RULES.apply_constraint_damping(velocity, global_position, pivot, attached_mode == "hardBar", attachment_length, delta, tuning)
	velocity = damped.velocity
	velocity = RULES.cap_attachment_speed(velocity, true, tuning)


func _constrain_attachment_position() -> void:
	if not is_instance_valid(attached_object) or attached_mode.is_empty(): return
	var pivot := attached_object.global_position if attached_object.runtime_handler == "anchor" or (attached_object.runtime_handler == "movingObject" and str(attached_object.canonical_properties.get("objectKind", "")) == "anchor") else attached_world_point
	var radial := global_position - pivot
	var distance := radial.length()
	if distance < 0.001: return
	var normal := radial / distance
	if attached_mode == "hardBar" or distance > attachment_length:
		global_position = pivot + normal * attachment_length
		var outward := velocity.dot(normal)
		if outward > 0.0 or attached_mode == "hardBar": velocity -= normal * outward


func _begin_bash_aim() -> void:
	if is_instance_valid(bash_aim_target): return
	if not state_store.has_ability("bash") or energy < _t("bashCost", 0.75): return
	var nearest: CanonicalObject
	var nearest_score := INF
	var resolved_aim := _resolved_aim_world()
	for object in world_root.get_tree().get_nodes_in_group("canonical_objects"):
		var eligible: bool = object.runtime_handler == "bashTarget" or (object.runtime_handler == "movingObject" and str(object.canonical_properties.get("objectKind", "")) == "bashTarget")
		if not eligible: continue
		if float(_bash_target_cooldowns.get(object.object_id, 0.0)) > 0.0: continue
		var distance := global_position.distance_to(object.global_position)
		var pointer_distance := resolved_aim.distance_to(object.global_position)
		var score := distance + pointer_distance * 0.16
		if distance <= _t("bashRange", 185.0) and score < nearest_score:
			nearest = object
			nearest_score = score
	if nearest:
		energy -= _t("bashCost", 0.75)
		time_since_energy_use = 0.0
		bash_aim_target = nearest
		bash_target_id = nearest.object_id
		bash_aim_remaining = _t("bashAimDuration", 0.9)


func _finish_bash_aim() -> void:
	if not is_instance_valid(bash_aim_target):
		bash_aim_target = null
		bash_aim_remaining = 0.0
		return
	var target := bash_aim_target
	var direction := (_resolved_aim_world() - target.global_position).normalized()
	if direction.length_squared() < 0.01:
		direction = (global_position - target.global_position).normalized()
	if direction.length_squared() < 0.01:
		direction = Vector2(gravity_direction.y, -gravity_direction.x)
	velocity = direction * _t("bashSpeed", 960.0)
	_bash_target_cooldowns[target.object_id] = RULES.bash_target_cooldown(tuning)
	bash_aim_target = null
	bash_aim_remaining = 0.0
	detach()


# Kept as a deterministic test/runtime helper: it exercises the same aim state
# machine but completes immediately after selection.
func _try_bash() -> void:
	_begin_bash_aim()
	_finish_bash_aim()


func detach() -> void:
	attached_object = null
	attached_mode = ""
	attached_world_point = Vector2.ZERO
	attached_target_id = ""
	attachment_length = 0.0
	rope_phase = ""
	rope_tip = Vector2.ZERO
	rope_reel_speed = 0.0
	rope_reel_boost_applied = false
	swing_control = 0.0


func _closest_point_on_object_bounds(object: CanonicalObject, point: Vector2) -> Vector2:
	var bounds := object.world_interaction_bounds()
	var clamped := Vector2(clampf(point.x, bounds.position.x, bounds.end.x), clampf(point.y, bounds.position.y, bounds.end.y))
	# When the pointer lies inside a solid rectangle, choose the closest face.
	if bounds.has_point(point):
		var distances := [
			absf(point.x - bounds.position.x), absf(bounds.end.x - point.x),
			absf(point.y - bounds.position.y), absf(bounds.end.y - point.y)
		]
		var face := distances.find(distances.min())
		if face == 0: clamped.x = bounds.position.x
		elif face == 1: clamped.x = bounds.end.x
		elif face == 2: clamped.y = bounds.position.y
		else: clamped.y = bounds.end.y
	return clamped


func _attachment_target_id(object: CanonicalObject, point: Vector2) -> String:
	var point_target := object.runtime_handler == "anchor" or (object.runtime_handler == "movingObject" and str(object.canonical_properties.get("objectKind", "")) == "anchor")
	if point_target: return object.object_id
	var bounds := object.world_interaction_bounds()
	var distances := {
		"left": absf(point.x - bounds.position.x),
		"right": absf(point.x - bounds.end.x),
		"top": absf(point.y - bounds.position.y),
		"bottom": absf(point.y - bounds.end.y)
	}
	var face := "top"
	var closest := INF
	for id in ["top", "right", "bottom", "left"]:
		if float(distances[id]) < closest:
			closest = float(distances[id])
			face = id
	return "%s:%s" % [object.object_id, face]


func _object_surface_segments(object: CanonicalObject) -> Array[Dictionary]:
	if object.runtime_handler == "slope":
		return [{
			"id": object.object_id,
			"a": object.global_position,
			"b": object.global_transform * Vector2(float(object.canonical_properties.get("dx", 0.0)), float(object.canonical_properties.get("dy", 0.0)))
		}]
	var bounds := object.world_interaction_bounds()
	var segments: Array[Dictionary] = [
		{"id": "%s:top" % object.object_id, "a": bounds.position, "b": Vector2(bounds.end.x, bounds.position.y)},
		{"id": "%s:right" % object.object_id, "a": Vector2(bounds.end.x, bounds.position.y), "b": bounds.end},
		{"id": "%s:bottom" % object.object_id, "a": bounds.end, "b": Vector2(bounds.position.x, bounds.end.y)},
		{"id": "%s:left" % object.object_id, "a": Vector2(bounds.position.x, bounds.end.y), "b": bounds.position}
	]
	if object.runtime_handler == "hazard":
		var bottom: Dictionary = segments[2]
		segments.clear()
		segments.append(bottom)
	return segments


func _object_attachment_surfaces(object: CanonicalObject, pointer: Vector2) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for segment in _object_surface_segments(object):
		result.append({"id": segment.id, "point": _closest_point_on_segment(pointer, segment.a, segment.b)})
	return result


func _closest_point_on_target_surface(object: CanonicalObject, target_id: String, pointer: Vector2) -> Vector2:
	for candidate in _object_attachment_surfaces(object, pointer):
		if str(candidate.id) == target_id: return candidate.point
	return _closest_point_on_object_bounds(object, pointer)


func _closest_point_on_segment(point: Vector2, start: Vector2, end: Vector2) -> Vector2:
	var segment := end - start
	if segment.length_squared() <= 0.000001: return start
	return start + segment * clampf((point - start).dot(segment) / segment.length_squared(), 0.0, 1.0)


func _closest_points_between_segments(first_start: Vector2, first_end: Vector2, second_start: Vector2, second_end: Vector2) -> Dictionary:
	# Exact port of src/math.js closestPointsBetweenSegments. Keeping the
	# clamping order identical makes surface IDs and attachment lengths stable
	# across the Web and Godot fixed-input runners.
	var first := first_end - first_start
	var second := second_end - second_start
	var offset := first_start - second_start
	var first_length_squared := first.dot(first)
	var cross_lengths := first.dot(second)
	var second_length_squared := second.dot(second)
	var first_offset := first.dot(offset)
	var second_offset := second.dot(offset)
	var denominator := first_length_squared * second_length_squared - cross_lengths * cross_lengths
	var epsilon := 0.000001
	var first_numerator: float
	var first_denominator := denominator
	var second_numerator: float
	var second_denominator := denominator
	if denominator < epsilon:
		first_numerator = 0.0
		first_denominator = 1.0
		second_numerator = second_offset
		second_denominator = second_length_squared
	else:
		first_numerator = cross_lengths * second_offset - second_length_squared * first_offset
		second_numerator = first_length_squared * second_offset - cross_lengths * first_offset
		if first_numerator < 0.0:
			first_numerator = 0.0
			second_numerator = second_offset
			second_denominator = second_length_squared
		elif first_numerator > first_denominator:
			first_numerator = first_denominator
			second_numerator = second_offset + cross_lengths
			second_denominator = second_length_squared
	if second_numerator < 0.0:
		second_numerator = 0.0
		if -first_offset < 0.0:
			first_numerator = 0.0
		elif -first_offset > first_length_squared:
			first_numerator = first_denominator
		else:
			first_numerator = -first_offset
			first_denominator = first_length_squared
	elif second_numerator > second_denominator:
		second_numerator = second_denominator
		var adjusted := -first_offset + cross_lengths
		if adjusted < 0.0:
			first_numerator = 0.0
		elif adjusted > first_length_squared:
			first_numerator = first_denominator
		else:
			first_numerator = adjusted
			first_denominator = first_length_squared
	var first_t := 0.0 if absf(first_numerator) < epsilon else first_numerator / first_denominator
	var second_t := 0.0 if absf(second_numerator) < epsilon else second_numerator / second_denominator
	var first_point := first_start + first * first_t
	var second_point := second_start + second * second_t
	return {
		"first": first_point,
		"second": second_point,
		"firstT": first_t,
		"secondT": second_t,
		"distance": first_point.distance_to(second_point)
	}


func _segment_intersection_fraction(first_start: Vector2, first_end: Vector2, second_start: Vector2, second_end: Vector2) -> float:
	var first := first_end - first_start
	var second := second_end - second_start
	var denominator := first.cross(second)
	if absf(denominator) < 0.000001: return -1.0
	var offset := second_start - first_start
	var first_t := offset.cross(second) / denominator
	var second_t := offset.cross(first) / denominator
	if first_t < 0.0 or first_t > 1.0 or second_t < 0.0 or second_t > 1.0: return -1.0
	return first_t


func _attachment_line_of_sight(point: Vector2, _target: CanonicalObject) -> bool:
	if world_root == null: return true
	var nearest_fraction := INF
	for candidate in world_root.get_tree().get_nodes_in_group("canonical_objects"):
		if not is_instance_valid(candidate) or not candidate.visible: continue
		var moving_platform: bool = candidate.runtime_handler == "movingObject" and str(candidate.canonical_properties.get("objectKind", "")) == "platform"
		var closed_gate: bool = candidate.runtime_handler == "gate" and not bool(candidate.capture_state().get("open", false))
		if candidate.runtime_handler not in ["platform", "slope", "fragilePlatform"] and not moving_platform and not closed_gate: continue
		for segment in _object_surface_segments(candidate):
			var fraction := _segment_intersection_fraction(global_position, point, segment.a, segment.b)
			# Web ignores contacts at either endpoint. This lets a ray terminate on
			# its target face and avoids treating the player's floor contact as an
			# immediate blocker.
			if fraction <= 0.002 or fraction >= 0.998: continue
			nearest_fraction = minf(nearest_fraction, fraction)
	return nearest_fraction == INF


func _live_aim_world() -> Vector2:
	# Mouse remains authoritative when no stick is active. A connected pad uses
	# its right stick as an aim ray, matching the canonical controller contract.
	for device_id in Input.get_connected_joypads():
		var stick := Vector2(
			Input.get_joy_axis(device_id, JOY_AXIS_RIGHT_X),
			Input.get_joy_axis(device_id, JOY_AXIS_RIGHT_Y)
		)
		if stick.length() >= 0.2:
			return global_position + stick.normalized() * _t("ropeMaximumLength", 470.0)
	return get_global_mouse_position()


func _resolved_aim_world() -> Vector2:
	if not use_replay_input or not world_root is ChunkStreamer: return aim_world
	var chunk_id := (world_root as ChunkStreamer).active_chunk_id
	for region in canonical_world.get("regions", []):
		for chunk in region.get("chunks", []):
			if str(chunk.get("id", "")) != chunk_id: continue
			var chunk_point := _apply_canonical_transform(aim_world, chunk.get("transform", {}))
			return _apply_canonical_transform(chunk_point, region.get("transform", {}))
	return aim_world


func _apply_canonical_transform(point: Vector2, transform: Dictionary) -> Vector2:
	var position_value: Dictionary = transform.get("position", {})
	var scale_value: Dictionary = transform.get("scale", {})
	var scaled := Vector2(
		point.x * float(scale_value.get("x", 1.0)),
		point.y * float(scale_value.get("y", 1.0))
	)
	return Vector2(float(position_value.get("x", 0.0)), float(position_value.get("y", 0.0))) + scaled.rotated(deg_to_rad(float(transform.get("rotationDegrees", 0.0))))


func _jump(speed: float) -> void:
	var down_speed := velocity.dot(gravity_direction)
	if down_speed > 0.0: velocity -= gravity_direction * down_speed
	velocity -= gravity_direction * speed
	jump_buffer = 0.0
	coyote_timer = 0.0
	visual_state.trigger_jump()


func _update_visual_state(delta: float, landed: bool, dashing: bool, is_gliding: bool, impact_speed: float) -> void:
	var tangent := Vector2(gravity_direction.y, -gravity_direction.x)
	var rope_state := {}
	if is_instance_valid(attached_object) and (not rope_phase.is_empty() or attached_mode == "rope"):
		var endpoint := attached_world_point if rope_phase in ["attached", ""] else rope_tip
		rope_state = {
			"id": attached_target_id,
			"phase": rope_phase if not rope_phase.is_empty() else "attached",
			"start": global_position,
			"end": endpoint,
			"length": maxf(attachment_length, global_position.distance_to(endpoint)),
			"displayLength": global_position.distance_to(endpoint)
		}
	visual_state.update({
		"velocity": velocity,
		"gravity": gravity_direction,
		"tangent": tangent,
		"facing": facing,
		"grounded": collision_grounded,
		"gliding": is_gliding,
		"constrained": not attached_mode.is_empty(),
		"dashing": dashing,
		"distanceTravelled": distance_travelled,
		"landingImpactSpeed": impact_speed if landed else -1.0,
		"rope": rope_state
	}, delta)


func _take_damage(amount: float, source_position := Vector2.ZERO) -> void:
	if invulnerability > 0.0: return
	health -= amount
	invulnerability = _t("damageInvulnerability", 1.0)
	var recovery := RULES.begin_damage_recovery(tuning)
	damage_recovery_timer = float(recovery.timer)
	damage_recovery_jump = bool(recovery.jump_available)
	var away := global_position - source_position
	velocity = RULES.compute_damage_recovery_velocity(velocity, gravity_direction, away.normalized(), tuning)
	if health <= 0.0: begin_respawn()


func _gate_satisfied(object: CanonicalObject) -> bool:
	var ability := str(object.canonical_properties.get("requiredAbility", ""))
	var flag := str(object.canonical_properties.get("requiredFlag", ""))
	if not ((ability.is_empty() or state_store.has_ability(ability)) and (flag.is_empty() or state_store.has_flag(flag))):
		return false
	var connection := _connection_for_exit(object)
	if connection.is_empty():
		return true
	for required_ability in connection.get("requiredAbilities", []):
		if not state_store.has_ability(str(required_ability)): return false
	for required_flag in connection.get("requiredFlags", []):
		if not state_store.has_flag(str(required_flag)): return false
	return true


func _connection_for_exit(object: CanonicalObject) -> Dictionary:
	var target_chunk := str(object.canonical_properties.get("targetChunkId", object.canonical_properties.get("targetRoomId", "")))
	var target_entrance := str(object.canonical_properties.get("targetEntranceId", ""))
	if target_chunk.is_empty(): return {}
	for region in canonical_world.get("regions", []):
		for chunk in region.get("chunks", []):
			for connection in chunk.get("connections", []):
				var from: Dictionary = connection.get("from", {})
				var to: Dictionary = connection.get("to", {})
				var forward := str(from.get("chunkId", "")) == object.chunk_id and str(to.get("chunkId", "")) == target_chunk
				var reverse := not bool(connection.get("oneWay", false)) and str(to.get("chunkId", "")) == object.chunk_id and str(from.get("chunkId", "")) == target_chunk
				if not forward and not reverse: continue
				var endpoint: Dictionary = to if forward else from
				if target_entrance.is_empty() or str(endpoint.get("entranceId", "")) == target_entrance:
					return connection
	return {}


func _zones(type_id: String) -> Array[CanonicalObject]:
	var result: Array[CanonicalObject] = []
	var bounds := Rect2(global_position - Vector2.ONE * radius, Vector2.ONE * radius * 2.0)
	for object in world_root.get_tree().get_nodes_in_group("canonical_type_%s" % type_id):
		if object.visible and bounds.intersects(object.world_interaction_bounds()): result.append(object)
	return result


func _first_zone(type_id: String) -> CanonicalObject:
	var values := _zones(type_id)
	return values[0] if not values.is_empty() else null


func _held(action: String) -> bool:
	return bool(replay_input.get(action, false)) if use_replay_input else Input.is_action_pressed(action)


func _strength(action: String) -> float:
	return (1.0 if bool(replay_input.get(action, false)) else 0.0) if use_replay_input else Input.get_action_strength(action)


func _just_pressed(action: String) -> bool:
	return _held(action) and not bool(_previous_actions.get(action, false))


func _just_released(action: String) -> bool:
	return not _held(action) and bool(_previous_actions.get(action, false))


func _current_actions() -> Dictionary:
	var result := {}
	for action in ACTIONS: result[action] = _held(action)
	return result


func _t(key: String, fallback: float) -> float:
	var values: Dictionary = tuning.get("values", {}) if tuning.get("values", {}) is Dictionary else {}
	var physics: Dictionary = tuning.get("physics", {}) if tuning.get("physics", {}) is Dictionary else {}
	var resources: Dictionary = tuning.get("resources", {}) if tuning.get("resources", {}) is Dictionary else {}
	return float(values.get(key, tuning.get(key, physics.get(key, resources.get(key, fallback)))))


func _build_collision() -> void:
	collision_layer = 2
	collision_mask = 1
	var shape_node := CollisionShape2D.new()
	shape_node.name = "PlayerCollision"
	# The approved Web contract resolves a radius-18 circle. Godot uses the same
	# circle so ground, corner and hazard contacts do not silently drift merely
	# because an engine-default capsule was narrower than canonical clearance.
	var circle := CircleShape2D.new()
	circle.radius = radius
	shape_node.shape = circle
	add_child(shape_node)


func _draw() -> void:
	var visual: Dictionary = visual_state.snapshot()
	var tail: Dictionary = visual.get("tail", {})
	var tail_offset: Vector2 = tail.get("offset", Vector2(-42.0, 0.0))
	draw_line(Vector2.ZERO, tail_offset, Color("58cfc8"), 8.0, true)
	draw_circle(tail_offset, 5.0, Color("75efe2"))
	var pose: Dictionary = visual.get("softBody", {}).get("pose", {})
	var long_radius := float(pose.get("longRadius", radius))
	var cross_radius := float(pose.get("crossRadius", radius))
	draw_set_transform(Vector2.ZERO, float(pose.get("angle", 0.0)), Vector2(long_radius / radius, cross_radius / radius))
	draw_circle(Vector2.ZERO, radius, Color("75efe2"))
	draw_arc(Vector2.ZERO, radius, 0, TAU, 32, Color("d4fffa"), 2.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var curve: PackedVector2Array = visual_state.rope_curve(17)
	if curve.size() >= 2:
		var local_curve := PackedVector2Array()
		for point in curve: local_curve.append(to_local(point))
		draw_polyline(local_curve, Color("80fff1"), 3.0, true)
	elif is_instance_valid(attached_object) and attached_mode == "hardBar":
		var geometry := RULES.hard_bar_geometry(float(attached_object.canonical_properties.get("thickness", 0.0)), tuning)
		draw_line(Vector2.ZERO, to_local(attached_world_point), Color("e8cfff"), float(geometry.thickness), true)
