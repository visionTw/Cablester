#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/build"

mkdir -p "$OUTPUT_DIR/godot" "$OUTPUT_DIR/godot-web"
printf '%s\n' '# Generated Godot exports. Keep the project scanner out.' > "$OUTPUT_DIR/.gdignore"

"$ROOT_DIR/scripts/godot.sh" --headless --path "$ROOT_DIR" --export-release macOS "$OUTPUT_DIR/godot/Cablester.app"

if [[ "${1:-}" == "--with-web" ]]; then
  "$ROOT_DIR/scripts/godot.sh" --headless --path "$ROOT_DIR" --export-release Web "$OUTPUT_DIR/godot-web/index.html"
fi
