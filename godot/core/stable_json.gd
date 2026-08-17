class_name StableJson
extends RefCounted

## Cross-engine canonical JSON used by the World Package content hash.
## Dictionaries are key-sorted, arrays retain order and canonical numbers use
## at most six fractional digits as required by the frozen v3 contract.

const MAX_DECIMALS := 6


static func stringify(value: Variant) -> String:
	match typeof(value):
		TYPE_NIL:
			return "null"
		TYPE_BOOL:
			return "true" if value else "false"
		TYPE_INT:
			return str(value)
		TYPE_FLOAT:
			return _number_to_string(value)
		TYPE_STRING, TYPE_STRING_NAME:
			return JSON.stringify(str(value))
		TYPE_ARRAY:
			var parts: PackedStringArray = []
			for item in value:
				parts.append(stringify(item))
			return "[" + ",".join(parts) + "]"
		TYPE_DICTIONARY:
			var keys: Array = value.keys()
			keys.sort_custom(func(a: Variant, b: Variant) -> bool: return str(a) < str(b))
			var parts: PackedStringArray = []
			for key in keys:
				parts.append(JSON.stringify(str(key)) + ":" + stringify(value[key]))
			return "{" + ",".join(parts) + "}"
		_:
			push_error("StableJson cannot encode Variant type %s" % typeof(value))
			return "null"


static func pretty(value: Variant) -> String:
	# Pretty output is for checked diagnostics; content hashes always use stringify.
	return JSON.stringify(value, "  ", true, true) + "\n"


static func content_hash(world: Dictionary) -> String:
	var hash_input: Dictionary = world.duplicate(true)
	if not hash_input.has("manifest") or not hash_input.manifest is Dictionary:
		return ""
	hash_input.manifest["contentHash"] = ""
	return "sha256:" + stringify(hash_input).sha256_text()


static func semantic_clone(value: Variant) -> Variant:
	# JSON round-tripping removes Godot-only Variant types before diagnostics.
	return JSON.parse_string(stringify(value))


static func _number_to_string(value: float) -> String:
	if not is_finite(value):
		push_error("Canonical JSON rejects NaN and Infinity")
		return "null"
	if is_zero_approx(value):
		return "0"
	var rounded := snappedf(value, pow(10.0, -MAX_DECIMALS))
	if rounded == floor(rounded) and abs(rounded) <= 9007199254740991.0:
		return str(int(rounded))
	var rendered := ("%.6f" % rounded).trim_suffix("0")
	while rendered.ends_with("0") and rendered.contains("."):
		rendered = rendered.left(-1)
	if rendered.ends_with("."):
		rendered = rendered.left(-1)
	return rendered
