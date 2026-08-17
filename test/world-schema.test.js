import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  GODOT_BUILD_ID,
  WORLD_SCHEMA_VERSION,
  applyLevelDocumentToChunk,
  chunkToLevelDocument,
  computeContentHash,
  isCompatibleGodotBuildId,
  migrateToWorldPackage,
  normalizeWorldPackage,
  serializeWorldPackage,
  validateWorldPackage
} from "../src/world-schema.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

function errors(issues) {
  return issues.filter((entry) => entry.severity === "error");
}

test("v1 and v2 fixtures migrate non-destructively and deterministically to the v3 golden package", async () => {
  const v1 = await readJson("../worlds/fixtures/legacy-v1.level.json");
  const v2 = await readJson("../worlds/fixtures/legacy-v2.level.json");
  const golden = await readJson("../worlds/fixtures/v3-golden.world.json");
  const originalV1 = structuredClone(v1);
  const originalV2 = structuredClone(v2);
  const migratedV1 = migrateToWorldPackage(v1, { namespace: "labs" });
  const migratedV2 = migrateToWorldPackage(v2, { namespace: "labs" });

  assert.deepEqual(v1, originalV1);
  assert.deepEqual(v2, originalV2);
  assert.equal(migratedV1.schemaVersion, WORLD_SCHEMA_VERSION);
  assert.deepEqual(migratedV1.regions[0].chunks[0].scene, migratedV2.regions[0].chunks[0].scene);
  assert.ok(migratedV1.regions[0].chunks[0].objects.every((object) => object.properties.visual));
  assert.deepEqual(migratedV2.regions[0].chunks[0].gameplay, {
    acceptanceLevel: "L1",
    category: "Fixture",
    dashCapacity: 1,
    startingAbilities: ["rope", "dash", "wallGrab"],
    summary: "Canonical migration golden"
  });
  assert.deepEqual(migratedV2.regions[0].chunks[0].reference, v2.reference);
  assert.deepEqual(migratedV2.regions[0].chunks[0].statePolicy, v2.statePolicy);
  assert.equal(migratedV2.regions[0].chunks[0].extensions.legacyMetadata.authoringNote, "preserve metadata extension");
  assert.equal(migratedV2.regions[0].chunks[0].extensions.legacyDocument.customExtension.preserved, true);
  assert.equal(migratedV2.regions[0].chunks[0].objects[0].editorExtension.lockedBy, "fixture");
  assert.equal(Object.is(migratedV2.regions[0].chunks[0].objects[0].properties.visual.offsetX, -0), false);

  const serialized = await serializeWorldPackage(migratedV2);
  assert.equal(serialized, await readFile(new URL("../worlds/fixtures/v3-golden.world.json", import.meta.url), "utf8"));
  assert.deepEqual(JSON.parse(serialized), golden);
  assert.equal(golden.manifest.contentHash, await computeContentHash(golden));
});

test("v3 normalization preserves allowed extensions while enforcing canonical transforms and numbers", async () => {
  const golden = await readJson("../worlds/fixtures/v3-golden.world.json");
  golden.customWorldExtension = { future: true, precision: 1.23456789 };
  golden.regions[0].futureRegionField = ["kept"];
  golden.regions[0].chunks[0].futureChunkField = { kept: true };
  golden.regions[0].chunks[0].objects[0].futureObjectField = "kept";
  golden.regions[0].chunks[0].objects[0].transform.position.x = -0;
  const normalized = normalizeWorldPackage(golden);
  assert.deepEqual(normalized.customWorldExtension, { future: true, precision: 1.234568 });
  assert.deepEqual(normalized.regions[0].futureRegionField, ["kept"]);
  assert.deepEqual(normalized.regions[0].chunks[0].futureChunkField, { kept: true });
  assert.equal(normalized.regions[0].chunks[0].objects[0].futureObjectField, "kept");
  assert.equal(Object.is(normalized.regions[0].chunks[0].objects[0].transform.position.x, -0), false);
});

test("validator accepts the sealed golden package and validates the pinned Godot build", async () => {
  const golden = await readJson("../worlds/fixtures/v3-golden.world.json");
  assert.deepEqual(validateWorldPackage(golden, {
    contentHash: await computeContentHash(golden),
    godotBuildId: GODOT_BUILD_ID
  }), []);
  assert.equal(isCompatibleGodotBuildId("4.7.1.stable.official.a13da4feb"), true);
  assert.equal(isCompatibleGodotBuildId("4.6.2.stable.official"), false);
  assert.equal(isCompatibleGodotBuildId("4.7.2.stable.approved", { approvedGodotBuildIds: ["4.7.2.stable.approved"] }), true);
  const wrongBuild = validateWorldPackage(golden, { godotBuildId: "4.8.dev" });
  assert.ok(wrongBuild.some((entry) => entry.code === "incompatible-godot-build"));
  const wrongRequiredBuild = structuredClone(golden);
  wrongRequiredBuild.godotCompatibility = { requiredBuildId: "4.6.2.stable.official" };
  assert.ok(validateWorldPackage(wrongRequiredBuild).some((entry) => entry.code === "incompatible-godot-build"));
});

test("validator independently rejects a stale declared content hash", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  world.regions[0].name = "Tampered after sealing";
  assert.ok(validateWorldPackage(world).some((entry) => entry.code === "content-hash-mismatch"));
});

test("prefab registry accepts only canonical project prefab scenes", async () => {
  const golden = await readJson("../worlds/fixtures/v3-golden.world.json");
  for (const godotScene of [
    "user://external.tscn",
    "/tmp/external.tscn",
    "res://godot/prefabs/../runtime/external.tscn",
    "res://godot/runtime/external.tscn",
    "res://godot/prefabs/external.scn"
  ]) {
    const world = structuredClone(golden);
    world.prefabRegistry.entries[0].godotScene = godotScene;
    const issues = validateWorldPackage(world);
    assert.ok(
      issues.some((entry) => entry.code === "invalid-godot-scene"),
      `unsafe prefab scene was accepted: ${godotScene}`
    );
  }
  assert.equal(
    validateWorldPackage(golden).some((entry) => entry.code === "invalid-godot-scene"),
    false
  );
});

test("validator reports version, ID, type, prefab, asset, state, connection, and transform failures", async () => {
  const golden = await readJson("../worlds/fixtures/v3-golden.world.json");
  const world = structuredClone(golden);
  const chunk = world.regions[0].chunks[0];
  const platform = chunk.objects[0];
  const spawn = chunk.objects.find((object) => object.type === "spawn");
  const goal = chunk.objects.find((object) => object.type === "goal");
  world.schemaVersion = 2;
  assert.ok(validateWorldPackage(world).some((entry) => entry.code === "unsupported-schema-version"));
  world.schemaVersion = 3;
  world.manifest.typeRegistryVersion = "999";
  platform.id = spawn.id;
  platform.type = "unknownType";
  platform.prefabId = "prefab:missing";
  platform.properties.visual.assetId = "asset:missing";
  platform.transform.position.x = Number.NaN;
  goal.properties.requiredFlag = "never-declared";
  chunk.connections.push({
    id: "bad connection",
    from: { chunkId: chunk.id, entranceId: "missing-entrance" },
    to: { chunkId: "missing-chunk", entranceId: "missing-entrance" },
    direction: "diagonal",
    requiredAbilities: ["teleport"],
    requiredFlags: ["never-declared"],
    oneWay: "yes"
  });
  const issues = validateWorldPackage(world);
  for (const code of [
    "registry-version-mismatch", "duplicate-object-id", "unresolved-type",
    "unresolved-prefab", "unresolved-asset", "non-finite-number",
    "unresolved-state", "unresolved-connection-chunk", "unresolved-connection-entrance",
    "invalid-connection-direction", "unresolved-ability", "invalid-one-way", "invalid-id"
  ]) {
    assert.ok(issues.some((entry) => entry.code === code), `missing ${code}: ${JSON.stringify(issues, null, 2)}`);
  }
});

test("validator catches duplicate registry IDs, global object IDs, connection IDs and broken links", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const region = world.regions[0];
  const firstChunk = region.chunks[0];
  const secondChunk = structuredClone(firstChunk);
  secondChunk.id = "fixture-second-chunk";
  secondChunk.name = "Second";
  secondChunk.objects = secondChunk.objects.map((object) => ({ ...object, id: `second:${object.id}` }));
  secondChunk.connections = [];
  region.chunks.push(secondChunk);
  world.typeRegistry.entries.push(structuredClone(world.typeRegistry.entries[0]));
  firstChunk.objects[0].links.push("no-such-id");
  const issues = validateWorldPackage(world);
  assert.ok(issues.some((entry) => entry.code === "duplicate-type-id"));
  assert.ok(issues.some((entry) => entry.code === "unresolved-link"));

  secondChunk.objects[0].id = firstChunk.objects[0].id;
  assert.ok(validateWorldPackage(world).some((entry) => entry.code === "duplicate-object-id"));
});

test("validator resolves region landmark and nested scene-layer asset references", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const region = world.regions[0];
  region.landmarks.push({ id: "missing-landmark", assetId: "asset:missing-landmark" });
  region.chunks[0].scene.layers[0].assets = [{ assetId: "asset:missing-scene" }];
  const issues = validateWorldPackage(world);
  assert.ok(issues.some((entry) => entry.path.endsWith("landmarks[0].assetId")));
  assert.ok(issues.some((entry) => entry.path.endsWith("scene.layers[0].assets[0].assetId")));
});

test("chunk adapter round-trips transforms, visual/scene, gameplay, reference, state, tags, links and extensions", async () => {
  const world = await readJson("../worlds/fixtures/v3-golden.world.json");
  const region = world.regions[0];
  const chunk = region.chunks[0];
  const level = chunkToLevelDocument(world, region.id, chunk.id);
  assert.equal(level.schemaVersion, 2);
  assert.equal(level.metadata.acceptanceLevel, "L1");
  assert.deepEqual(level.startingAbilities, ["rope", "dash", "wallGrab"]);
  assert.deepEqual(level.scene, chunk.scene);
  assert.deepEqual(level.reference, chunk.reference);
  assert.deepEqual(level.statePolicy, chunk.statePolicy);
  assert.deepEqual(level.objects[0].worldAdapter.transform, chunk.objects[0].transform);
  assert.equal(level.objects[0].worldAdapter.extensions.editorExtension.lockedBy, "fixture");

  level.metadata.name = "Edited through v2 adapter";
  level.metadata.acceptanceLevel = "L2";
  level.objects[0].position.x += 24;
  level.objects[0].worldAdapter.transform.rotationDegrees = 22.5;
  level.objects[0].worldAdapter.links = [level.objects[1].id];
  level.objects[0].worldAdapter.tags = ["edited"];
  const updated = applyLevelDocumentToChunk(world, region.id, chunk.id, level);
  const updatedChunk = updated.regions[0].chunks[0];
  assert.equal(updated.manifest.contentHash, "");
  assert.equal(updatedChunk.name, "Edited through v2 adapter");
  assert.equal(updatedChunk.gameplay.acceptanceLevel, "L2");
  assert.equal(updatedChunk.objects[0].transform.position.x, chunk.objects[0].transform.position.x + 24);
  assert.equal(updatedChunk.objects[0].transform.rotationDegrees, 22.5);
  assert.deepEqual(updatedChunk.objects[0].links, [updatedChunk.objects[1].id]);
  assert.deepEqual(updatedChunk.objects[0].tags, ["edited"]);
  assert.equal(updatedChunk.objects[0].editorExtension.lockedBy, "fixture");
  assert.deepEqual(errors(validateWorldPackage(updated)), []);
});
