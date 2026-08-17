#!/bin/sh
set -eu

required_version="$(tr -d '\r\n' < "$(dirname "$0")/../GODOT_VERSION")"
project_toolchain="${CABLESTER_GODOT_TOOLCHAIN:-${HOME}/.codex/toolchains/godot-4.7.1/Godot.app/Contents/MacOS/Godot}"
if [ -n "${CABLESTER_GODOT_BIN:-}" ]; then
  godot_binary="$CABLESTER_GODOT_BIN"
elif [ -x "$project_toolchain" ]; then
  godot_binary="$project_toolchain"
elif [ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]; then
  godot_binary="/Applications/Godot.app/Contents/MacOS/Godot"
elif command -v godot >/dev/null 2>&1; then
  godot_binary="$(command -v godot)"
else
  godot_binary="$project_toolchain"
fi

if [ ! -x "$godot_binary" ]; then
  echo "Cablester requires Godot $required_version." >&2
  echo "Set CABLESTER_GODOT_BIN to the matching Godot 4.7 executable." >&2
  exit 1
fi

actual_version="$($godot_binary --version)"
if [ "$actual_version" != "$required_version" ]; then
  echo "Godot version mismatch: expected $required_version, got $actual_version" >&2
  exit 1
fi

exec "$godot_binary" "$@"
