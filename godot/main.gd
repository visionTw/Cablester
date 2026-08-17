extends Node

const ACCEPTANCE_TOUR_SCRIPT := preload("res://godot/tests/acceptance_tour.gd")
const CONTINUOUS_ROUTE_SCRIPT := preload("res://godot/tests/continuous_route.gd")

var runtime: WorldRuntime


func _ready() -> void:
	var args := _user_args()
	if args.has("--import-world"):
		var path := _argument_value(args, "--import-world")
		var result := WorldImporter.new().import_file(path)
		_print_result("import-world", result)
		get_tree().quit(0 if result.ok else 1)
		return
	if args.has("--test-worlds"):
		var runner := HeadlessTestRunner.new()
		add_child(runner)
		var result := await runner.run_all()
		_print_result("test-worlds", result)
		get_tree().quit(0 if result.ok else 1)
		return
	if args.has("--acceptance-tour"):
		var path := _argument_value(args, "--acceptance-tour")
		var tour := ACCEPTANCE_TOUR_SCRIPT.new()
		add_child(tour)
		var result := await tour.run(path)
		_print_result("acceptance-tour", result)
		print(JSON.stringify(result))
		get_tree().quit(0 if result.ok else 1)
		return
	if args.has("--continuous-route"):
		var path := _argument_value(args, "--continuous-route")
		var route := CONTINUOUS_ROUTE_SCRIPT.new()
		add_child(route)
		var result := await route.run(path)
		_print_result("continuous-route", result)
		print(JSON.stringify(result))
		get_tree().quit(0 if result.ok else 1)
		return
	if args.has("--capture-runtime"):
		var path := _argument_value(args, "--capture-runtime")
		if DisplayServer.get_name() == "headless":
			var failure := {"ok": false, "errors": ["Runtime capture requires a normal display driver; headless dummy rendering is not accepted"]}
			_print_result("capture-runtime", failure)
			get_tree().quit(2)
			return
		runtime = WorldRuntime.new()
		add_child(runtime)
		var loaded := runtime.load_world(path, {"loadSave": false})
		if not loaded.ok:
			_print_result("capture-runtime", loaded)
			get_tree().quit(1)
			return
		await get_tree().process_frame
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		var image := get_viewport().get_texture().get_image()
		var output_root := "user://acceptance-artifacts" if OS.has_feature("template") else "artifacts/godot"
		var output_path := output_root.path_join("%s.runtime.png" % str(runtime.world.manifest.worldId))
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(output_root))
		var capture_error := image.save_png(output_path)
		var result := {"ok": capture_error == OK, "capturePath": output_path, "errors": [] if capture_error == OK else ["Cannot save viewport PNG (%s)" % capture_error]}
		_print_result("capture-runtime", result)
		print(JSON.stringify(result))
		get_tree().quit(0 if result.ok else 1)
		return
	if args.has("--replay"):
		var replay_path := _argument_value(args, "--replay")
		runtime = WorldRuntime.new()
		add_child(runtime)
		var result := runtime.run_replay(replay_path)
		if not result.ok:
			_print_result("replay", result)
			get_tree().quit(1)
			return
		runtime.replay_finished.connect(func(finished: Dictionary) -> void:
			_print_result("replay", finished)
			get_tree().quit(0 if finished.ok else 1)
		)
		return
	if args.has("--clean-godot-artifacts"):
		var error := CablesterFileUtils.remove_tree("artifacts/godot")
		print(JSON.stringify({"command": "clean-godot-artifacts", "ok": error == OK, "errorCode": error}))
		get_tree().quit(0 if error == OK else 1)
		return
	var default_world := _default_world_path()
	if default_world.is_empty():
		push_warning("No formal canonical World Package exists yet")
		return
	runtime = WorldRuntime.new()
	add_child(runtime)
	var result := runtime.load_world(default_world, {"loadSave": true})
	if not result.ok: push_error("Cannot start runtime: %s" % JSON.stringify(result.errors))


func _user_args() -> PackedStringArray:
	return OS.get_cmdline_user_args()


func _argument_value(args: PackedStringArray, flag: String) -> String:
	var index := args.find(flag)
	return args[index + 1] if index >= 0 and index + 1 < args.size() else ""


func _default_world_path() -> String:
	var paths := CablesterFileUtils.list_json_files("worlds/formal", ".world.json")
	return paths[0] if not paths.is_empty() else ""


func _print_result(command: String, result: Dictionary) -> void:
	print(JSON.stringify({
		"command": command,
		"ok": bool(result.get("ok", false)),
		"errors": result.get("errors", result.get("expectationErrors", [])),
		"warnings": result.get("warnings", []),
		"snapshotPath": result.get("snapshotPath", ""),
		"manifestPath": result.get("manifestPath", ""),
		"telemetryPath": result.get("telemetryPath", "")
	}))
