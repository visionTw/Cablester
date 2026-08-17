import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSemanticProjection,
  godotDerivedAllowlist,
  semanticDiff
} from "../src/world-diff.js";
import { resolveWorldPackage } from "../src/world-registries.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("canonical package, resolved snapshot and normalized manifest share one semantic projection", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const resolved = await readJson("../worlds/fixtures/godot-resolved-v1.golden.json");
  const projection = await readJson("../worlds/fixtures/v3-semantic-projection.golden.json");
  assert.deepEqual(createSemanticProjection(world), projection);
  assert.deepEqual(createSemanticProjection(resolved), projection);
  assert.deepEqual(semanticDiff(world, resolved), []);
  assert.deepEqual(semanticDiff(world, resolveWorldPackage(world)), []);
});

test("projection sorts stable IDs while preserving property semantics", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const reordered = structuredClone(world);
  reordered.regions[0].chunks[0].objects.reverse();
  assert.deepEqual(createSemanticProjection(reordered), createSemanticProjection(world));
  reordered.regions[0].chunks[0].objects[0].properties.semanticChange = true;
  const diffs = semanticDiff(world, reordered);
  assert.ok(diffs.some((entry) => entry.path.includes("properties.semanticChange")));
});

test("semantic diff finds counts, transforms, properties, connections, state, ability, asset and prefab drift", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const projection = createSemanticProjection(world);
  const changed = structuredClone(projection);
  const object = changed.regions[0].chunks[0].objects[0];
  object.resolvedTransform.position.x += 1;
  object.properties.w += 1;
  object.stateKeys.push("changed-state");
  object.abilityGates.push("changed-ability");
  object.assetId = "asset:changed";
  object.prefabId = "prefab:changed";
  changed.counts.objects += 1;
  changed.regions[0].chunks[0].connections.push({
    id: "changed-connection",
    from: {}, to: {}, direction: "both", oneWay: false,
    requiredAbilities: [], requiredFlags: []
  });
  const paths = semanticDiff(projection, changed).map((entry) => entry.path);
  for (const fragment of [
    "counts.objects", "resolvedTransform.position.x", "properties.w", "stateKeys",
    "abilityGates", "assetId", "prefabId", "connections"
  ]) assert.ok(paths.some((path) => path.includes(fragment)), `missing ${fragment}: ${paths.join("\n")}`);
});

test("registered Godot-only derived fields are ignored and unrelated fields are not", async () => {
  const projection = await readJson("../worlds/fixtures/v3-semantic-projection.golden.json");
  const actual = structuredClone(projection);
  actual.generatedAt = "2026-08-12T00:00:00Z";
  actual.godotBuildId = "4.7.1.stable.official.a13da4feb";
  actual.regions[0].aabb = { x: 0, y: 0, w: 1, h: 1 };
  actual.regions[0].chunks[0].objects[0].collisionBounds = { x: 0, y: 0, w: 1, h: 1 };
  assert.deepEqual(semanticDiff(projection, actual, godotDerivedAllowlist), []);
  actual.regions[0].chunks[0].objects[0].hiddenLayoutTruth = true;
  assert.ok(semanticDiff(projection, actual).some((entry) => entry.path.endsWith("hiddenLayoutTruth")));
});

test("raw snapshot cannot smuggle an unregistered Godot-only field through projection", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const snapshot = resolveWorldPackage(world);
  snapshot.regions[0].chunks[0].objects[0].hiddenLayoutTruth = true;
  const differences = semanticDiff(world, snapshot);
  assert.ok(differences.some((entry) => entry.path.endsWith("hiddenLayoutTruth")));
  assert.deepEqual(semanticDiff(world, snapshot, [
    ...godotDerivedAllowlist,
    "regions[*].chunks[*].objects[*].hiddenLayoutTruth"
  ]), []);
});

test("custom allowlist patterns support array wildcards", async () => {
  const projection = await readJson("../worlds/fixtures/v3-semantic-projection.golden.json");
  const actual = structuredClone(projection);
  actual.regions[0].chunks[0].objects[0].customDerived = { value: 1 };
  assert.notDeepEqual(semanticDiff(projection, actual, []), []);
  assert.deepEqual(semanticDiff(projection, actual, ["regions[*].chunks[*].objects[*].customDerived"]), []);
  assert.deepEqual(semanticDiff(projection, actual, ["regions.*.chunks.*.objects.*.customDerived"]), []);
});
