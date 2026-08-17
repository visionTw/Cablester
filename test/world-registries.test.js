import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BUILTIN_LEVEL_OBJECT_TYPES, DEFAULT_ASSET_REGISTRY as LEGACY_ASSETS } from "../src/asset-library.js";
import {
  DEFAULT_ASSET_REGISTRY,
  DEFAULT_PREFAB_REGISTRY,
  DEFAULT_TYPE_REGISTRY,
  GENERIC_GODOT_PREFAB_PATH,
  createDefaultWorldRegistries,
  resolveWorldPackage
} from "../src/world-registries.js";
import { migrateToWorldPackage } from "../src/world-schema.js";
import { createBlankLevelDocument, createLevelObject } from "../src/level-objects.js";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("canonical registries cover all 25 object types, current 25 images plus fallback, and every prefab", async () => {
  assert.equal(DEFAULT_TYPE_REGISTRY.entries.length, 25);
  assert.equal(DEFAULT_ASSET_REGISTRY.entries.length, 26);
  assert.equal(DEFAULT_PREFAB_REGISTRY.entries.length, 25);
  assert.deepEqual(DEFAULT_TYPE_REGISTRY.entries.map((entry) => entry.id).sort(), [...BUILTIN_LEVEL_OBJECT_TYPES].sort());
  assert.deepEqual(DEFAULT_ASSET_REGISTRY.entries.map((entry) => entry.id).sort(), LEGACY_ASSETS.assets.map((entry) => entry.id).sort());
  assert.ok(DEFAULT_TYPE_REGISTRY.entries.every((entry) => entry.pivot && entry.boundsAdapter && entry.godotRuntimeHandler));
  assert.ok(DEFAULT_PREFAB_REGISTRY.entries.every((entry) => entry.godotScene === GENERIC_GODOT_PREFAB_PATH));
  assert.ok(DEFAULT_ASSET_REGISTRY.entries.filter((entry) => entry.kind === "image")
    .every((entry) => entry.platforms.web.path.startsWith("./assets/game/") && entry.platforms.godot.path.startsWith("res://assets/game/")));

  const diskTypes = await readJson("../worlds/registries/type-registry.json");
  const diskAssets = await readJson("../worlds/registries/asset-registry.json");
  const diskPrefabs = await readJson("../worlds/registries/prefab-registry.json");
  assert.deepEqual(diskTypes, DEFAULT_TYPE_REGISTRY);
  assert.deepEqual(diskAssets, DEFAULT_ASSET_REGISTRY);
  assert.deepEqual(diskPrefabs, DEFAULT_PREFAB_REGISTRY);
});

test("registry factory returns mutable isolation from frozen defaults", () => {
  const first = createDefaultWorldRegistries();
  const second = createDefaultWorldRegistries();
  first.typeRegistry.entries[0].label = "changed";
  assert.notEqual(second.typeRegistry.entries[0].label, "changed");
});

test("resolver composes hierarchy, collision bounds, state references, prefab and asset IDs", () => {
  const document = createBlankLevelDocument("Resolve");
  document.objects.push(createLevelObject("stateTrigger", 300, 400, document.objects, {
    id: "resolve-state",
    properties: { setFlag: "route-open", clearFlag: "", oneUse: true, resetOnDeath: false }
  }));
  const world = migrateToWorldPackage(document);
  world.regions[0].transform.position = { x: 1000, y: 200 };
  world.regions[0].chunks[0].transform.position = { x: 500, y: 40 };
  const object = world.regions[0].chunks[0].objects.find((entry) => entry.id === "resolve-state");
  const resolved = resolveWorldPackage(world);
  const result = resolved.regions[0].chunks[0].objects.find((entry) => entry.id === object.id);
  assert.deepEqual(result.resolvedTransform.position, { x: 1800, y: 640 });
  assert.deepEqual(result.stateReferences, ["route-open"]);
  assert.equal(result.prefabResolution.id, "prefab:stateTrigger");
  assert.equal(result.prefabResolution.status, "resolved");
  assert.equal(result.assetResolution.id, "builtin:procedural");
  assert.equal(result.assetResolution.status, "procedural");
  assert.ok(result.collisionBounds.w > 0);
  assert.deepEqual(resolved.errors, []);
  assert.deepEqual(resolved.warnings, []);
});

test("resolver reports unresolved required logical resources", () => {
  const world = migrateToWorldPackage(createBlankLevelDocument("Missing registry"), { namespace: "formal" });
  const object = world.regions[0].chunks[0].objects[0];
  object.type = "missingType";
  object.properties.visual.assetId = "asset:missing";
  object.prefabId = "prefab:missing";
  const result = resolveWorldPackage(world);
  assert.ok(result.errors.some((entry) => entry.code === "unresolved-type"));
  assert.ok(result.errors.some((entry) => entry.code === "unresolved-prefab"));
  assert.ok(result.errors.some((entry) => entry.code === "unresolved-asset"));
});
