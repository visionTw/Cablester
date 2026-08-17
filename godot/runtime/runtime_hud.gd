extends CanvasLayer

## Lightweight export-safe status surface. It deliberately uses Godot-native
## controls and fonts so the formal build remains readable when art is missing.

var runtime: WorldRuntime
var info_label: Label


func configure(owner_runtime: WorldRuntime) -> void:
	runtime = owner_runtime
	layer = 100
	_build_controls()
	_refresh()


func _process(_delta: float) -> void:
	_refresh()


func _build_controls() -> void:
	var backdrop := ColorRect.new()
	backdrop.name = "Backdrop"
	backdrop.position = Vector2(14, 14)
	backdrop.size = Vector2(780, 68)
	backdrop.color = Color(0.025, 0.07, 0.09, 0.82)
	backdrop.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(backdrop)
	info_label = Label.new()
	info_label.name = "Info"
	info_label.position = Vector2(12, 8)
	info_label.size = Vector2(756, 52)
	info_label.add_theme_color_override("font_color", Color("d9fffa"))
	info_label.add_theme_font_size_override("font_size", 15)
	info_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	backdrop.add_child(info_label)


func _refresh() -> void:
	if info_label == null or runtime == null or runtime.streamer == null: return
	var chunk_id := runtime.streamer.active_chunk_id
	var completion := "    Goal: %s completed" % runtime.completed_goal_id if not runtime.completed_goal_id.is_empty() else ""
	info_label.text = "Chunk: %s    Godot: %s%s\nMove: WASD/Arrows  Jump: Space  Dash: Ctrl  Rope: C/Mouse1  Hard bar: F toggle  Bash: hold/release Q  Grab: Shift  Reset: Backspace" % [
		chunk_id if not chunk_id.is_empty() else "(loading)",
		CablesterFileUtils.godot_build_id(), completion
	]
