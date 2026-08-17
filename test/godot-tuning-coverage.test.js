import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Godot runtime consumes every approved 3C tuning value by its canonical key", async () => {
  const report = JSON.parse(await readFile(new URL("../artifacts/godot/tuning-coverage.json", import.meta.url), "utf8"));
  assert.equal(report.worldId, "cablester-3c-labs");
  assert.ok(report.totalApprovedValues >= 90, "the audit must cover the full approved table, not an allowlist");
  assert.equal(report.missingValues, 0, `missing Godot tuning keys: ${report.missing.map((entry) => entry.key).join(", ")}`);
  assert.equal(report.ok, true);
});
