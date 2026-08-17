class_name CablesterFileUtils
extends RefCounted

const APPROVED_PREFAB_ROOT := "res://godot/prefabs/"


static func godot_build_id() -> String:
	# `Engine.get_version_info().string` is display-oriented and omits the commit
	# hash. The frozen cross-engine handshake uses the exact `--version` shape.
	var info := Engine.get_version_info()
	var id := "%d.%d.%d.%s.%s" % [
		int(info.get("major", 0)), int(info.get("minor", 0)), int(info.get("patch", 0)),
		str(info.get("status", "")), str(info.get("build", ""))
	]
	var hash := str(info.get("hash", ""))
	if not hash.is_empty(): id += "." + hash.left(9)
	return id


static func required_godot_build_id() -> String:
	if not FileAccess.file_exists("res://GODOT_VERSION"): return ""
	return FileAccess.get_file_as_string("res://GODOT_VERSION").strip_edges()


static func project_path(path: String) -> String:
	if path.begins_with("res://") or path.begins_with("user://") or path.is_absolute_path():
		return path
	return "res://" + path.trim_prefix("./")


static func approved_prefab_scene_path(path: String) -> String:
	if not path.begins_with(APPROVED_PREFAB_ROOT) or not path.ends_with(".tscn") or path.contains("\\"):
		return ""
	var relative := path.trim_prefix(APPROVED_PREFAB_ROOT)
	if relative.length() <= ".tscn".length():
		return ""
	for segment in relative.split("/"):
		if segment.is_empty() or segment == "." or segment == "..":
			return ""
	return path


static func absolute_project_path(path: String) -> String:
	return ProjectSettings.globalize_path(project_path(path))


static func read_json(path: String) -> Dictionary:
	var resolved := project_path(path)
	if not FileAccess.file_exists(resolved):
		return {"ok": false, "error": "File does not exist: %s" % path}
	var text := FileAccess.get_file_as_string(resolved)
	var json := JSON.new()
	var parse_error := json.parse(text)
	if parse_error != OK:
		return {
			"ok": false,
			"error": "Invalid JSON in %s at line %d: %s" % [path, json.get_error_line(), json.get_error_message()]
		}
	if not json.data is Dictionary:
		return {"ok": false, "error": "JSON root must be an object: %s" % path}
	return {"ok": true, "data": json.data, "sourceText": text, "path": resolved}


static func write_json_atomic(path: String, data: Variant, pretty := true) -> Dictionary:
	var absolute := absolute_project_path(path)
	var parent := absolute.get_base_dir()
	var mkdir_error := DirAccess.make_dir_recursive_absolute(parent)
	if mkdir_error != OK and mkdir_error != ERR_ALREADY_EXISTS:
		return {"ok": false, "error": "Cannot create directory %s (%s)" % [parent, mkdir_error]}
	var temp_path := absolute + ".tmp"
	var file := FileAccess.open(temp_path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "error": "Cannot open temporary file: %s" % temp_path}
	file.store_string(StableJson.pretty(data) if pretty else StableJson.stringify(data))
	file.close()
	if FileAccess.file_exists(absolute):
		var remove_error := DirAccess.remove_absolute(absolute)
		if remove_error != OK:
			DirAccess.remove_absolute(temp_path)
			return {"ok": false, "error": "Cannot replace file %s (%s)" % [absolute, remove_error]}
	var rename_error := DirAccess.rename_absolute(temp_path, absolute)
	if rename_error != OK:
		DirAccess.remove_absolute(temp_path)
		return {"ok": false, "error": "Cannot commit file %s (%s)" % [absolute, rename_error]}
	return {"ok": true, "path": absolute}


static func list_json_files(path: String, suffix := ".json") -> PackedStringArray:
	var result: PackedStringArray = []
	var resolved := project_path(path)
	var directory := DirAccess.open(resolved)
	if directory == null:
		return result
	directory.list_dir_begin()
	var entry := directory.get_next()
	while not entry.is_empty():
		if not directory.current_is_dir() and entry.ends_with(suffix):
			result.append(resolved.path_join(entry))
		entry = directory.get_next()
	directory.list_dir_end()
	result.sort()
	return result


static func remove_tree(path: String) -> Error:
	var absolute := absolute_project_path(path)
	if not DirAccess.dir_exists_absolute(absolute):
		return OK
	var directory := DirAccess.open(absolute)
	if directory == null:
		return ERR_CANT_OPEN
	directory.list_dir_begin()
	var entry := directory.get_next()
	while not entry.is_empty():
		var child := absolute.path_join(entry)
		if directory.current_is_dir():
			var nested_error := remove_tree(child)
			if nested_error != OK:
				return nested_error
		else:
			var remove_error := DirAccess.remove_absolute(child)
			if remove_error != OK:
				return remove_error
		entry = directory.get_next()
	directory.list_dir_end()
	return DirAccess.remove_absolute(absolute)
