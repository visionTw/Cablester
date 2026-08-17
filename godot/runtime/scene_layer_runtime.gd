class_name CanonicalSceneLayer
extends Node2D

var layer_id := ""
var canonical_layer: Dictionary = {}
var resolved_assets: Array[Dictionary] = []
var fallback_assets: Array[String] = []
var parallax_factor := 1.0
var blend_mode := "source-over"
var _base_position := Vector2.ZERO


func configure(layer: Dictionary, asset_by_id: Dictionary, chunk_bounds: Dictionary) -> void:
	canonical_layer = layer.duplicate(true)
	layer_id = str(layer.get("id", "scene-layer"))
	name = "Scene_%s" % layer_id.replace("/", "_").replace(":", "_")
	visible = bool(layer.get("visible", true))
	z_index = clampi(int(layer.get("depth", -1)), -4096, 4096)
	modulate = Color(str(layer.get("tint", "#ffffff")), float(layer.get("opacity", 1.0)))
	parallax_factor = float(layer.get("parallax", 1.0))
	blend_mode = str(layer.get("blendMode", "source-over"))
	set_meta("parallax", parallax_factor)
	set_meta("role", str(layer.get("role", "custom")))
	set_meta("blend_mode", blend_mode)
	var canvas_material := CanvasItemMaterial.new()
	canvas_material.blend_mode = {
		"lighter": CanvasItemMaterial.BLEND_MODE_ADD,
		"add": CanvasItemMaterial.BLEND_MODE_ADD,
		"multiply": CanvasItemMaterial.BLEND_MODE_MUL,
		"subtract": CanvasItemMaterial.BLEND_MODE_SUB
	}.get(blend_mode, CanvasItemMaterial.BLEND_MODE_MIX)
	material = canvas_material
	add_to_group("canonical_scene_layers")
	_build_sprites(asset_by_id, chunk_bounds)
	_base_position = position
	set_process(not is_equal_approx(parallax_factor, 1.0))


func _process(_delta: float) -> void:
	var camera := get_viewport().get_camera_2d()
	if camera == null or get_parent() == null: return
	var camera_in_chunk: Vector2 = get_parent().to_local(camera.global_position)
	position = _base_position + camera_in_chunk * (1.0 - parallax_factor)


func _build_sprites(asset_by_id: Dictionary, chunk_bounds: Dictionary) -> void:
	if not visible:
		return
	var candidates: Array = canonical_layer.get("assets", [])
	if candidates.is_empty():
		return
	var draw_cap := maxi(1, int(canonical_layer.get("drawCap", 1)))
	var repeat_x := bool(canonical_layer.get("repeatX", false))
	var spacing := float(canonical_layer.get("spacing", 0.0))
	var seamless: Dictionary = canonical_layer.get("seamless", {})
	if spacing <= 0.0:
		spacing = float(seamless.get("tileWidth", chunk_bounds.get("w", 1280.0)))
	var count := draw_cap if repeat_x else 1
	var range_value: Dictionary = canonical_layer.get("range", {})
	var range_start: Variant = range_value.get("startX")
	var range_end: Variant = range_value.get("endX")
	var origin_x := float(canonical_layer.get("originX", 0.0))
	if range_start is int or range_start is float:
		origin_x = float(range_start)
	if (range_start is int or range_start is float) and (range_end is int or range_end is float):
		var available_width := maxf(0.0, float(range_end) - float(range_start))
		if repeat_x and spacing > 0.0:
			count = mini(draw_cap, maxi(1, int(floor(available_width / spacing)) + 1))
	var layer_scale := float(canonical_layer.get("scale", 1.0))
	var role := str(canonical_layer.get("role", "custom"))
	var bottom := float(chunk_bounds.get("y", 0.0)) + float(chunk_bounds.get("h", 720.0))
	var middle := float(chunk_bounds.get("y", 0.0)) + float(chunk_bounds.get("h", 720.0)) * 0.5
	for index in count:
		var candidate: Variant = candidates[index % candidates.size()]
		if not candidate is Dictionary:
			continue
		var asset_id := str(candidate.get("assetId", ""))
		var entry: Dictionary = asset_by_id.get(asset_id, {})
		var path := _godot_path(entry)
		if path.is_empty() or not ResourceLoader.exists(path):
			fallback_assets.append(asset_id)
			continue
		var resource: Resource = load(path)
		if not resource is Texture2D:
			fallback_assets.append(asset_id)
			continue
		var sprite := Sprite2D.new()
		sprite.name = "Asset_%s_%d" % [asset_id.replace(":", "_"), index]
		sprite.texture = resource
		sprite.scale = Vector2.ONE * layer_scale
		sprite.position.x = origin_x + spacing * index
		var texture_height := float(resource.get_height()) * layer_scale
		sprite.position.y = middle if role in ["background", "midground"] else bottom - texture_height * 0.5
		if str(seamless.get("mode", "")) == "mirror" and index % 2 == 1:
			sprite.flip_h = true
		add_child(sprite)
		resolved_assets.append({"id": asset_id, "path": path, "position": {"x": sprite.position.x, "y": sprite.position.y}})
		sprite.add_to_group("canonical_scene_visuals")


func _godot_path(entry: Dictionary) -> String:
	var platforms: Dictionary = entry.get("platforms", {})
	var godot: Dictionary = platforms.get("godot", {}) if platforms.get("godot", {}) is Dictionary else {}
	var path_value: Variant = godot.get("path", entry.get("godotPath"))
	return CablesterFileUtils.project_path(str(path_value)) if path_value is String and not path_value.is_empty() else ""
