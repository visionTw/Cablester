class_name CanonicalObject
extends Node2D

## Generic checked-in prefab. It never stores formal layout; the importer fills
## these exported fields from a canonical World Package on every rebuild.

@export var object_id := ""
@export var type_id := ""
@export var canonical_properties: Dictionary = {}
@export var canonical_links: Array = []
@export var canonical_tags: Array = []
@export var chunk_id := ""
@export var runtime_handler := ""
@export var fallback_visual := false

var _type_entry: Dictionary = {}
var _asset_entry: Dictionary = {}
var _initial_position := Vector2.ZERO
var _initial_rotation := 0.0
var _initial_scale := Vector2.ONE
var _motion_points: Array[Vector2] = []
var _motion_segment := 0
var _motion_direction := 1
var _motion_dwell := 0.0
var _motion_active := true
var _state: Dictionary = {}
var _solid_shape: CollisionShape2D
var _area_shape: CollisionShape2D
var runtime_previous_global_position := Vector2.ZERO
var runtime_velocity := Vector2.ZERO


func configure(object: Dictionary, type_entry: Dictionary, asset_entry: Dictionary = {}, saved_state: Dictionary = {}) -> void:
	object_id = str(object.get("id", ""))
	type_id = str(object.get("type", ""))
	runtime_handler = str(type_entry.get("godotRuntimeHandler", type_id))
	canonical_properties = object.get("properties", {}).duplicate(true)
	canonical_links = object.get("links", []).duplicate(true)
	canonical_tags = object.get("tags", []).duplicate(true)
	_type_entry = type_entry.duplicate(true)
	_asset_entry = asset_entry.duplicate(true)
	name = _safe_node_name(object_id)
	# Moving canonical objects must advance before Player's -10 fixed step so
	# the shared swept-collision solver sees the same current/previous pair as
	# Web updateRuntimeItems → updatePlayer.
	process_physics_priority = -15
	_initial_position = position
	_initial_rotation = rotation
	_initial_scale = scale
	add_to_group("canonical_objects")
	add_to_group("canonical_type_%s" % type_id)
	_build_physics()
	_build_visual()
	_setup_motion()
	restore_state(saved_state)
	runtime_previous_global_position = global_position


func capture_state() -> Dictionary:
	var result := _state.duplicate(true)
	if type_id == "movingObject":
		result.merge({
			"motionSegment": _motion_segment,
			"motionDirection": _motion_direction,
			"motionDwell": _motion_dwell,
			"position": {"x": position.x, "y": position.y}
		}, true)
	# Reset metadata travels with non-empty object state so unloaded chunks obey
	# the same policy as live nodes. Persistent progression objects must never be
	# resurrected merely because their chunk was streamed out.
	if not result.is_empty():
		result.resetPolicy = effective_reset_policy()
		result.resetOnDeath = bool(canonical_properties.get("resetOnDeath", true))
		result.objectType = type_id
	return result


func restore_state(saved_state: Dictionary) -> void:
	_state = saved_state.duplicate(true)
	_motion_segment = int(_state.get("motionSegment", 0))
	_motion_direction = int(_state.get("motionDirection", 1))
	_motion_dwell = float(_state.get("motionDwell", 0.0))
	if _state.get("position") is Dictionary:
		position = Vector2(float(_state.position.get("x", _initial_position.x)), float(_state.position.get("y", _initial_position.y)))
	if type_id == "gate":
		set_gate_open(bool(_state.get("open", canonical_properties.get("initiallyOpen", false))))
	if type_id == "fragilePlatform" and bool(_state.get("gone", false)):
		set_solid_enabled(false)
		visible = false


func reset_for_policy(policy: String) -> void:
	var reset_policy := effective_reset_policy()
	var reset_on_death := bool(canonical_properties.get("resetOnDeath", true))
	if reset_policy == "persistent": return
	if policy == "death" and (reset_policy != "death" or not reset_on_death): return
	if policy not in ["death", "room"]: return
	_state = {}
	position = _initial_position
	rotation = _initial_rotation
	scale = _initial_scale
	_motion_segment = 0
	_motion_direction = 1
	_motion_dwell = 0.0
	visible = true
	set_solid_enabled(true)
	if type_id == "gate":
		set_gate_open(bool(canonical_properties.get("initiallyOpen", false)))


func effective_reset_policy() -> String:
	var explicit := str(canonical_properties.get("resetPolicy", ""))
	if canonical_tags.has("persistent-state") or type_id == "abilityPickup": return "persistent"
	if explicit in ["death", "room", "persistent"]: return explicit
	# Legacy resetOnDeath=false promotes an otherwise death-scoped object to a
	# room-scoped lifecycle. Explicit persistent or a persistent-state tag is
	# still required for A-B-A/save durability.
	if not bool(canonical_properties.get("resetOnDeath", true)): return "room"
	return "death"


func set_gate_open(is_open: bool) -> void:
	_state.open = is_open
	visible = not is_open
	set_solid_enabled(not is_open)


func trigger_fragile() -> void:
	if type_id != "fragilePlatform" or bool(_state.get("gone", false)) or _state.has("breakTimer"):
		return
	_state.breakTimer = float(canonical_properties.get("breakDelaySeconds", 0.35))


func consume_pickup() -> void:
	_state.consumed = true
	visible = false
	if _area_shape:
		_area_shape.disabled = true
	if type_id == "dashRefill" and not bool(canonical_properties.get("oneUse", false)):
		_state.respawnTimer = float(canonical_properties.get("respawnSeconds", 2.5))


func is_available() -> bool:
	return visible and not bool(_state.get("consumed", false))


func set_solid_enabled(enabled: bool) -> void:
	if _solid_shape:
		_solid_shape.set_deferred("disabled", not enabled)


func interaction_bounds() -> Rect2:
	var adapter: Dictionary = _type_entry.get("boundsAdapter", {})
	var kind := str(adapter.get("kind", "point"))
	var pivot := _pivot_fraction()
	if kind == "rect":
		var width := float(canonical_properties.get(str(adapter.get("widthProperty", "w")), canonical_properties.get("w", 32.0)))
		var height := float(canonical_properties.get(str(adapter.get("heightProperty", "h")), canonical_properties.get("h", 32.0)))
		return Rect2(Vector2(-pivot.x * width, -pivot.y * height), Vector2(width, height))
	if kind in ["circle", "radius"]:
		var radius := float(canonical_properties.get(str(adapter.get("radiusProperty", "radius")), canonical_properties.get("radius", 22.0)))
		return Rect2(-Vector2.ONE * radius, Vector2.ONE * radius * 2.0)
	if kind in ["slope", "segment", "line"]:
		var endpoint := Vector2(float(canonical_properties.get("dx", 0.0)), float(canonical_properties.get("dy", 0.0)))
		var thickness := float(canonical_properties.get("thickness", 14.0))
		return Rect2(Vector2.ZERO, endpoint).abs().grow(thickness * 0.5)
	var size := float(adapter.get("radius", canonical_properties.get("size", 22.0)))
	return Rect2(-Vector2.ONE * size, Vector2.ONE * size * 2.0)


func world_interaction_bounds() -> Rect2:
	var rect := interaction_bounds()
	var corners := [rect.position, rect.end, Vector2(rect.end.x, rect.position.y), Vector2(rect.position.x, rect.end.y)]
	var first: Vector2 = global_transform * corners[0]
	var min_point := first
	var max_point := first
	for corner in corners.slice(1):
		var point: Vector2 = global_transform * corner
		min_point = min_point.min(point)
		max_point = max_point.max(point)
	return Rect2(min_point, max_point - min_point)


func _physics_process(delta: float) -> void:
	runtime_previous_global_position = global_position
	_update_motion(delta)
	runtime_velocity = (global_position - runtime_previous_global_position) / delta if delta > 0.0 else Vector2.ZERO
	_update_timers(delta)


func _update_motion(delta: float) -> void:
	if type_id != "movingObject" or not _motion_active or _motion_points.size() < 2:
		return
	if _motion_dwell > 0.0:
		_motion_dwell = maxf(0.0, _motion_dwell - delta)
		return
	var next_index: int = _motion_segment + _motion_direction
	if next_index < 0 or next_index >= _motion_points.size():
		var loop_mode := str(canonical_properties.get("loopMode", "pingpong"))
		if loop_mode == "loop":
			_motion_segment = 0
			next_index = 1
			position = _initial_position + _motion_points[0]
		elif loop_mode == "pingpong":
			_motion_direction *= -1
			next_index = _motion_segment + _motion_direction
		else:
			_motion_active = false
			return
	var target := _initial_position + _motion_points[next_index]
	var speed := float(canonical_properties.get("speed", 160.0))
	position = position.move_toward(target, speed * delta)
	if position.is_equal_approx(target):
		_motion_segment = next_index
		_motion_dwell = float(canonical_properties.get("dwellSeconds", 0.2))


func _update_timers(delta: float) -> void:
	if _state.has("breakTimer"):
		_state.breakTimer = float(_state.breakTimer) - delta
		if _state.breakTimer <= 0.0:
			_state.erase("breakTimer")
			_state.gone = true
			visible = false
			set_solid_enabled(false)
			if not bool(canonical_properties.get("oneUse", false)):
				_state.respawnTimer = float(canonical_properties.get("respawnSeconds", 2.2))
	if _state.has("respawnTimer"):
		_state.respawnTimer = float(_state.respawnTimer) - delta
		if _state.respawnTimer <= 0.0:
			_state.erase("respawnTimer")
			_state.erase("gone")
			_state.erase("consumed")
			visible = true
			set_solid_enabled(true)
			if _area_shape:
				_area_shape.set_deferred("disabled", false)


func _build_physics() -> void:
	var collision_semantics := str(_type_entry.get("collisionSemantics", "none"))
	match runtime_handler:
		"platform", "boundaryWall", "slope", "fragilePlatform", "gate":
			_build_solid()
		"movingObject":
			if str(canonical_properties.get("objectKind", "platform")) == "platform":
				_build_solid(true)
			else:
				_build_area()
		"spawn", "backgroundSeed", "sign":
			pass
		_:
			if collision_semantics in ["solid", "one-way-solid"]:
				_build_solid()
			elif collision_semantics != "none":
				_build_area()


func _build_solid(animatable := false) -> void:
	var body: PhysicsBody2D = AnimatableBody2D.new() if animatable else StaticBody2D.new()
	body.name = "Solid"
	body.collision_layer = 1
	body.collision_mask = 0
	add_child(body)
	_solid_shape = CollisionShape2D.new()
	_solid_shape.name = "Collision"
	_solid_shape.shape = _make_shape()
	_solid_shape.position = get_meta("shape_center", Vector2.ZERO)
	if type_id == "boundaryWall" and str(canonical_properties.get("blockingSide", "all")) != "all":
		_solid_shape.one_way_collision = true
		_solid_shape.rotation = {
			"top": 0.0, "bottom": PI, "left": PI * 0.5, "right": -PI * 0.5
		}.get(str(canonical_properties.get("blockingSide")), 0.0)
	body.add_child(_solid_shape)


func _build_area() -> void:
	var area := Area2D.new()
	area.name = "Area"
	area.collision_layer = 4
	area.collision_mask = 2
	area.monitoring = true
	area.monitorable = true
	add_child(area)
	_area_shape = CollisionShape2D.new()
	_area_shape.name = "Collision"
	_area_shape.shape = _make_shape()
	_area_shape.position = get_meta("shape_center", Vector2.ZERO)
	area.add_child(_area_shape)


func _make_shape() -> Shape2D:
	var adapter: Dictionary = _type_entry.get("boundsAdapter", {})
	var kind := str(adapter.get("kind", "point"))
	var pivot := _pivot_fraction()
	if kind == "rect":
		var width := maxf(1.0, float(canonical_properties.get(str(adapter.get("widthProperty", "w")), canonical_properties.get("w", 32.0))))
		var height := maxf(1.0, float(canonical_properties.get(str(adapter.get("heightProperty", "h")), canonical_properties.get("h", 32.0))))
		var rectangle := RectangleShape2D.new()
		rectangle.size = Vector2(width, height)
		var center := Vector2((0.5 - pivot.x) * width, (0.5 - pivot.y) * height)
		# Shape is returned before CollisionShape exists; caller applies center below.
		set_meta("shape_center", center)
		return rectangle
	if kind in ["slope", "segment", "line"] or type_id == "slope":
		var endpoint := Vector2(float(canonical_properties.get("dx", 220.0)), float(canonical_properties.get("dy", -80.0)))
		var half := maxf(1.0, float(canonical_properties.get("thickness", 14.0)) * 0.5)
		var normal := Vector2(-endpoint.y, endpoint.x).normalized() * half
		var polygon := ConvexPolygonShape2D.new()
		polygon.points = PackedVector2Array([normal, endpoint + normal, endpoint - normal, -normal])
		return polygon
	var radius := maxf(2.0, float(canonical_properties.get(str(adapter.get("radiusProperty", "radius")), adapter.get("radius", canonical_properties.get("radius", canonical_properties.get("size", 22.0))))))
	var circle := CircleShape2D.new()
	circle.radius = radius
	return circle


func _build_visual() -> void:
	var resource_path := _godot_asset_path()
	if not resource_path.is_empty() and ResourceLoader.exists(resource_path):
		var texture: Resource = load(resource_path)
		if texture is Texture2D:
			var visual: Dictionary = canonical_properties.get("visual", {})
			var gameplay_bounds := interaction_bounds()
			var target_size := Vector2(
				maxf(1.0, gameplay_bounds.size.x * absf(float(visual.get("scaleX", 1.0)))),
				maxf(1.0, gameplay_bounds.size.y * absf(float(visual.get("scaleY", 1.0))))
			)
			var anchor := Vector2(float(visual.get("anchorX", 0.5)), float(visual.get("anchorY", 0.5)))
			var offset := Vector2(float(visual.get("offsetX", 0.0)), float(visual.get("offsetY", 0.0)))
			var holder := Node2D.new()
			holder.name = "VisualTransform"
			holder.position = gameplay_bounds.position + gameplay_bounds.size * 0.5 + offset
			holder.scale = Vector2(-1.0 if bool(visual.get("flipX", false)) else 1.0, -1.0 if bool(visual.get("flipY", false)) else 1.0)
			holder.z_index = clampi(int(visual.get("drawLayer", 0)), -4096, 4096)
			holder.modulate = Color(str(visual.get("tint", "#ffffff")), float(visual.get("opacity", 1.0)))
			add_child(holder)

			var scaling: Dictionary = _asset_entry.get("scaling", {}) if _asset_entry.get("scaling", {}) is Dictionary else {}
			var requested_mode := str(visual.get("scaleMode", "asset"))
			var resolved_mode := str(scaling.get("defaultMode", "stretch")) if requested_mode == "asset" else requested_mode
			if not scaling.get("allowedModes", ["stretch"]).has(resolved_mode): resolved_mode = "stretch"
			var visual_control: Control
			if resolved_mode == "nine-slice" and scaling.get("nineSlice") is Dictionary:
				var patch := NinePatchRect.new()
				patch.texture = texture
				var slice: Dictionary = scaling.nineSlice
				# Patch margins are source-image cuts. Web's tileScale only affects
				# destination cadence, never the source slice coordinates.
				patch.set_patch_margin(SIDE_LEFT, int(round(float(slice.get("left", 0.0)))))
				patch.set_patch_margin(SIDE_TOP, int(round(float(slice.get("top", 0.0)))))
				patch.set_patch_margin(SIDE_RIGHT, int(round(float(slice.get("right", 0.0)))))
				patch.set_patch_margin(SIDE_BOTTOM, int(round(float(slice.get("bottom", 0.0)))))
				patch.axis_stretch_horizontal = NinePatchRect.AXIS_STRETCH_MODE_TILE if str(slice.get("edgeMode", "stretch")) == "tile" else NinePatchRect.AXIS_STRETCH_MODE_STRETCH
				patch.axis_stretch_vertical = patch.axis_stretch_horizontal
				patch.draw_center = true
				patch.set_meta("center_mode", str(slice.get("centerMode", "stretch")))
				visual_control = patch
			else:
				var rect := TextureRect.new()
				rect.texture = texture
				rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
				rect.stretch_mode = TextureRect.STRETCH_TILE if resolved_mode == "tile" else TextureRect.STRETCH_SCALE
				if resolved_mode == "tile": rect.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
				visual_control = rect
			visual_control.name = "Visual"
			visual_control.position = -target_size * anchor
			visual_control.size = target_size
			visual_control.mouse_filter = Control.MOUSE_FILTER_IGNORE
			visual_control.set_meta("resolved_scale_mode", resolved_mode)
			visual_control.set_meta("canonical_target_size", target_size)
			holder.add_child(visual_control)
			fallback_visual = false
			return
	fallback_visual = true
	queue_redraw()


func _draw() -> void:
	if not fallback_visual:
		return
	# Canonical boundary walls are collision/safety affordances (including the
	# generated side and recovery bounds), not scene art.
	if type_id == "boundaryWall": return
	var bounds := interaction_bounds()
	var color := _fallback_color()
	if type_id in ["anchor", "bashTarget", "energyOrb", "dashRefill", "abilityPickup", "goal", "spawn"]:
		draw_circle(Vector2.ZERO, maxf(8.0, minf(bounds.size.x, bounds.size.y) * 0.5), color)
		draw_arc(Vector2.ZERO, maxf(10.0, minf(bounds.size.x, bounds.size.y) * 0.55), 0, TAU, 32, color.lightened(0.35), 2.0)
	elif type_id == "slope":
		draw_line(Vector2.ZERO, Vector2(float(canonical_properties.get("dx", 0.0)), float(canonical_properties.get("dy", 0.0))), color, float(canonical_properties.get("thickness", 14.0)))
	else:
		draw_rect(bounds, color, true)
		draw_rect(bounds, color.lightened(0.32), false, 2.0)


func _fallback_color() -> Color:
	return {
		"platform": Color("3a887e"), "slope": Color("50a6cc"), "hazard": Color("d84d6e"),
		"anchor": Color("56ded1"), "bashTarget": Color("bd7de8"), "energyOrb": Color("62aee8"),
		"dashRefill": Color("7bd8ef"), "goal": Color("e8ca69"), "spawn": Color("64dacf"),
		"gate": Color("a77ccc"), "windZone": Color(0.3, 0.72, 0.95, 0.25),
		"liquidZone": Color(0.18, 0.48, 0.78, 0.55), "darknessZone": Color(0.08, 0.09, 0.16, 0.75)
	}.get(type_id, Color("a8b5ba"))


func _setup_motion() -> void:
	if type_id != "movingObject":
		return
	var path_value: Variant = canonical_properties.get("pathPoints", "0,0;320,0")
	if path_value is String:
		for encoded in path_value.split(";", false):
			var parts: PackedStringArray = str(encoded).split(",", false)
			if parts.size() == 2 and parts[0].is_valid_float() and parts[1].is_valid_float():
				_motion_points.append(Vector2(float(parts[0]), float(parts[1])))
	elif path_value is Array:
		for point in path_value:
			if point is Dictionary:
				_motion_points.append(Vector2(float(point.get("x", 0.0)), float(point.get("y", 0.0))))
	if _motion_points.size() < 2:
		_motion_points = [Vector2.ZERO, Vector2(320.0, 0.0)]
	_motion_active = str(canonical_properties.get("trigger", "auto")) == "auto"


func activate_motion() -> void:
	_motion_active = true


func _pivot_fraction() -> Vector2:
	var pivot: Dictionary = _type_entry.get("pivot", {})
	return Vector2(float(pivot.get("x", 0.5)), float(pivot.get("y", 0.5)))


func _godot_asset_path() -> String:
	var platforms: Dictionary = _asset_entry.get("platforms", {})
	var godot: Dictionary = platforms.get("godot", {}) if platforms.get("godot", {}) is Dictionary else {}
	var path_value: Variant = godot.get("path", _asset_entry.get("godotPath", ""))
	var path := str(path_value) if path_value is String else ""
	return CablesterFileUtils.project_path(path) if not path.is_empty() else ""


func _safe_node_name(value: String) -> String:
	return value.replace("/", "_").replace(":", "_").replace("@", "_")
