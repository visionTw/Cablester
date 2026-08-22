import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8"
  });
}

test("world validation and semantic diff CLIs accept the golden fixtures", () => {
  const validation = run("scripts/world-validate.mjs", ["worlds/fixtures/v3-golden.world.json"]);
  assert.equal(validation.status, 0, validation.stderr);
  assert.match(validation.stdout, /valid \(sha256:/);

  const diff = run("scripts/world-semantic-diff.mjs", [
    "worlds/fixtures/v3-golden.world.json",
    "worlds/fixtures/godot-resolved-v1.golden.json"
  ]);
  assert.equal(diff.status, 0, diff.stderr);
  assert.match(diff.stdout, /semantic diff = 0/);
});

test("world migration CLI writes a sealed deterministic v3 file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cablester-world-cli-"));
  const output = join(directory, "migrated.world.json");
  try {
    const result = run("scripts/world-migrate.mjs", [
      "worlds/fixtures/legacy-v2.level.json",
      output,
      "labs"
    ]);
    assert.equal(result.status, 0, result.stderr);
    const migrated = await readFile(output, "utf8");
    const golden = await readFile(new URL("../worlds/fixtures/v3-golden.world.json", import.meta.url), "utf8");
    assert.equal(migrated, golden);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
