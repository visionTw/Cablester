#!/bin/sh
set -u

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
project_root="$(CDPATH= cd -- "$script_dir/../.." && pwd)"
attestation_tool="$project_root/scripts/write-godot-rebuild-attestation.mjs"
run_tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/cablester-godot-rebuild.XXXXXX")"
[ -n "$run_tmp_dir" ] && [ -d "$run_tmp_dir" ] || exit 1
ledger_path="$run_tmp_dir/commands.jsonl"
fingerprint_before_path="$run_tmp_dir/source-before.json"
fingerprint_after_path="$run_tmp_dir/source-after.json"
godot_build_path="$run_tmp_dir/godot-build.txt"
replay_list_path="$run_tmp_dir/replays.txt"
pipeline_started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
pipeline_failed=0
step_number=0

cleanup_tmp() {
	rm -rf -- "$run_tmp_dir"
}

trap cleanup_tmp EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

record_result() {
	label="$1"
	started_at="$2"
	finished_at="$3"
	status="$4"
	timeout_seconds="$5"
	shift 5
	if ! node "$attestation_tool" record \
		--ledger "$ledger_path" \
		--label "$label" \
		--started-at "$started_at" \
		--finished-at "$finished_at" \
		--status "$status" \
		--timeout-seconds "$timeout_seconds" \
		-- "$@"; then
		echo "Could not record rebuild command result: $label" >&2
		pipeline_failed=1
	fi
}

run_step() {
	label="$1"
	timeout_seconds="$2"
	shift 2
	step_number=$((step_number + 1))
	started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	timeout_marker="$run_tmp_dir/timeout-$step_number"
	echo "==> $label"
	if [ "$timeout_seconds" -le 0 ]; then
		"$@"
		status=$?
	else
		"$@" &
		pid=$!
		(
			sleep "$timeout_seconds"
			if kill -0 "$pid" 2>/dev/null; then
				echo "Command watchdog timed out after ${timeout_seconds}s: $label" >&2
				: > "$timeout_marker"
				kill -TERM "$pid" 2>/dev/null || true
				sleep 2
				kill -KILL "$pid" 2>/dev/null || true
			fi
		) &
		watchdog_pid=$!
		if wait "$pid"; then status=0; else status=$?; fi
		kill -TERM "$watchdog_pid" 2>/dev/null || true
		wait "$watchdog_pid" 2>/dev/null || true
		if [ -f "$timeout_marker" ]; then status=124; fi
		rm -f -- "$timeout_marker"
	fi
	finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	record_result "$label" "$started_at" "$finished_at" "$status" "$timeout_seconds" "$@"
	if [ "$status" -ne 0 ]; then pipeline_failed=1; fi
	return 0
}

capture_step() {
	label="$1"
	output_path="$2"
	shift 2
	started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	echo "==> $label"
	"$@" > "$output_path"
	status=$?
	if [ -s "$output_path" ]; then cat "$output_path"; fi
	finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	record_result "$label" "$started_at" "$finished_at" "$status" 0 "$@"
	if [ "$status" -ne 0 ]; then pipeline_failed=1; fi
	return 0
}

run_godot_step() {
	label="$1"
	timeout_seconds="$2"
	shift 2
	run_step "$label" "$timeout_seconds" scripts/godot.sh "$@"
}

write_attestation() {
	pipeline_finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
	node "$attestation_tool" attest \
		--ledger "$ledger_path" \
		--fingerprint-before "$fingerprint_before_path" \
		--fingerprint-after "$fingerprint_after_path" \
		--godot-build-file "$godot_build_path" \
		--started-at "$pipeline_started_at" \
		--finished-at "$pipeline_finished_at" \
		--output "$project_root/artifacts/godot/rebuild-attestation.json"
	attestation_status=$?
	if [ "$attestation_status" -ne 0 ]; then pipeline_failed=1; fi
}

if [ ! -f "$project_root/project.godot" ] || [ ! -f "$project_root/GODOT_VERSION" ] || [ ! -f "$attestation_tool" ]; then
	echo "Refusing to rebuild outside the complete Cablester Godot project." >&2
	exit 1
fi

cd "$project_root"

run_step source-fingerprint-before 0 node "$attestation_tool" fingerprint --output "$fingerprint_before_path"
capture_step godot-version "$godot_build_path" scripts/godot.sh --version

# These directories contain only importer/editor derivatives. Formal layout and
# registries live under worlds/ and are deliberately never touched here.
run_step clean-godot-cache 0 rm -rf -- "$project_root/.godot"
run_step clean-godot-artifacts 0 rm -rf -- "$project_root/artifacts/godot"
run_step create-godot-artifact-root 0 mkdir -p -- "$project_root/artifacts/godot"

# A pristine project has no `.godot/global_script_class_cache.cfg`; run one
# deterministic editor scan so class_name dependencies are registered before
# invoking the command scene. This is still fully headless and non-interactive.
run_godot_step editor-import 180 --headless --editor --path . --quit
for world_path in worlds/formal/*.world.json worlds/labs/*.world.json; do
	[ -f "$world_path" ] || continue
	run_godot_step "import:$world_path" 180 --headless --path . -- --import-world "$world_path"
done

run_godot_step test-worlds 240 --headless --path . -- --test-worlds

formal_world="worlds/formal/first-forest.world.json"
run_godot_step acceptance-tour 180 --headless --path . -- --acceptance-tour "$formal_world"
# The collision-driven route intentionally advances at real 120 Hz physics and
# currently needs materially more than the old 45-second watchdog. Five minutes
# leaves CI/machine headroom without weakening any route assertion.
run_godot_step continuous-route 300 --headless --fixed-fps 120 --path . -- --continuous-route "$formal_world"

run_step replay-inventory 0 node "$attestation_tool" verify-replays --output-list "$replay_list_path"
if [ -f "$replay_list_path" ]; then
	while IFS= read -r replay_path; do
		[ -n "$replay_path" ] || continue
		run_godot_step "replay:$replay_path" 120 --headless --fixed-fps 120 --path . -- --replay "$replay_path"
	done < "$replay_list_path"
fi

run_step 3c-parity 0 node scripts/run-3c-parity.mjs --output artifacts/godot/3c-parity-report.json
run_step tuning-coverage 0 node scripts/audit-godot-tuning-coverage.mjs artifacts/godot/tuning-coverage.json

for world_path in worlds/formal/*.world.json worlds/labs/*.world.json; do
	[ -f "$world_path" ] || continue
	world_id="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).manifest.worldId)' "$world_path")"
	run_step "semantic-diff:$world_path" 0 node scripts/world-semantic-diff.mjs "$world_path" "artifacts/godot/$world_id.normalized-manifest.json"
done

run_step source-fingerprint-after 0 node "$attestation_tool" fingerprint --output "$fingerprint_after_path"
write_attestation

trap - EXIT HUP INT TERM
cleanup_tmp
if [ "$pipeline_failed" -ne 0 ]; then
	exit 1
fi
exit 0
