import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  BUILTIN_LEVEL_OBJECT_TYPES,
  DEFAULT_ASSET_REGISTRY,
  GAME_ASSET_IDS,
  GENERATED_GAME_ASSETS,
  SCENE_ASSET_IDS,
  createAssetRegistry,
  createVisualConfig,
  getProjectDefaultAssetId,
  getTypeDefaultAssetId,
  isAssetApplicable,
  replaceAssetsForType,
  replaceObjectAsset,
  replaceObjectVisual,
  resetAllObjectVisualsToProjectDefault,
  resetObjectVisualProperty,
  resetVisualsForTypeToTypeDefault,
  resolveAssetReference,
  resolveVisualAsset,
  searchAssets,
  updateObjectVisual,
  validateAssetRegistry,
  validateVisualConfig
} from "../src/asset-library.js";
import { createBlankLevelDocument, createLevelObject } from "../src/level-objects.js";

function imageAsset(id, applicableTypes, label = id) {
  return {
    id,
    label,
    description: `${label} test asset`,
    category: "terrain",
    kind: "image",
    path: `./assets/${id}.webp`,
    thumbnailPath: `./assets/${id}-thumb.webp`,
    applicableTypes,
    tags: ["forest", "test"],
    prompt: "original test prompt",
    generationMethod: "gpt-image-2",
    width: 256,
    height: 128,
    fileSizeBytes: 2048,
    license: { name: "project-generated", scope: "Cablester", source: "ImageGen" }
  };
}

function testRegistry() {
  return createAssetRegistry({
    assets: [
      structuredClone(DEFAULT_ASSET_REGISTRY.assets[0]),
      imageAsset("test:platform-moss", ["platform"], "苔藓平台"),
      imageAsset("test:platform-stone", ["platform"], "石质平台"),
      imageAsset("test:goal-light", ["goal"], "终点光芒")
    ],
    typeDefaults: { platform: "test:platform-moss", goal: "test:goal-light" },
    projectDefaultAssetId: BUILTIN_PROCEDURAL_ASSET_ID
  });
}

test("asset registry supports search, applicability and project/type defaults", () => {
  const registry = testRegistry();
  assert.deepEqual(validateAssetRegistry(registry), []);
  assert.equal(getProjectDefaultAssetId(registry), BUILTIN_PROCEDURAL_ASSET_ID);
  assert.equal(getTypeDefaultAssetId("platform", registry), "test:platform-moss");
  assert.equal(getTypeDefaultAssetId("hazard", registry), BUILTIN_PROCEDURAL_ASSET_ID);
  assert.equal(isAssetApplicable(registry.assets[1], "platform"), true);
  assert.equal(isAssetApplicable(registry.assets[1], "hazard"), false);
  assert.deepEqual(searchAssets(registry, { query: "苔藓", objectType: "platform" }).map((asset) => asset.id), ["test:platform-moss"]);
  assert.deepEqual(searchAssets(registry, { category: "terrain", objectType: "goal" }).map((asset) => asset.id), ["test:goal-light"]);
  assert.equal(getTypeDefaultAssetId("platform", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.mossPlatform);
  assert.equal(getTypeDefaultAssetId("hazard", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.thornHazard);
  assert.equal(getTypeDefaultAssetId("anchor", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.ropeAnchor);
  assert.equal(getTypeDefaultAssetId("energyOrb", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.energyOrb);
  assert.equal(getTypeDefaultAssetId("dashRefill", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.energyOrb);
  assert.equal(getTypeDefaultAssetId("bashTarget", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.bashBlossom);
  assert.equal(getTypeDefaultAssetId("checkpoint", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.checkpointLantern);
  assert.equal(getTypeDefaultAssetId("spawn", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.spawnGate);
  assert.equal(getTypeDefaultAssetId("goal", DEFAULT_ASSET_REGISTRY), GAME_ASSET_IDS.goalGate);
  assert.ok(BUILTIN_LEVEL_OBJECT_TYPES
    .filter((type) => ![
      "platform", "hazard", "anchor", "energyOrb", "dashRefill",
      "bashTarget", "checkpoint", "spawn", "goal"
    ].includes(type))
    .every((type) => getTypeDefaultAssetId(type, DEFAULT_ASSET_REGISTRY) === BUILTIN_PROCEDURAL_ASSET_ID));
});

test("generated project assets have complete metadata and files matching the registry", () => {
  assert.deepEqual(validateAssetRegistry(DEFAULT_ASSET_REGISTRY), []);
  assert.deepEqual(createAssetRegistry(), structuredClone(DEFAULT_ASSET_REGISTRY));
  assert.equal(GENERATED_GAME_ASSETS.length, 16);
  assert.deepEqual(
    searchAssets(DEFAULT_ASSET_REGISTRY, { objectType: "scene", kind: "image" }).map((asset) => asset.id),
    Object.values(SCENE_ASSET_IDS)
  );
  for (const asset of GENERATED_GAME_ASSETS) {
    assert.match(asset.prompt, /original|Create one original/i);
    assert.match(asset.generationMethod, /gpt-image-2/);
    assert.match(asset.license.scope, /runtime.*editor.*documentation.*Sites/i);
    const assetFile = fileURLToPath(new URL(`../${asset.path.replace(/^\.\//, "")}`, import.meta.url));
    const thumbnailFile = fileURLToPath(new URL(`../${asset.thumbnailPath.replace(/^\.\//, "")}`, import.meta.url));
    assert.equal(statSync(assetFile).size, asset.fileSizeBytes, `${asset.id} file size metadata`);
    assert.ok(statSync(thumbnailFile).size > 0, `${asset.id} thumbnail exists`);
  }
});

test("single and same-type asset replacement are immutable and preserve gameplay properties", () => {
  const registry = testRegistry();
  const document = createBlankLevelDocument("素材替换");
  document.objects.push(createLevelObject("platform", 720, 500, document.objects, { properties: { w: 220, h: 60 } }));
  const platformIds = document.objects.filter((object) => object.type === "platform").map((object) => object.id);
  const single = replaceObjectAsset(document, platformIds[0], "test:platform-stone", registry);
  assert.equal(single.objects.find((object) => object.id === platformIds[0]).properties.visual.assetId, "test:platform-stone");
  assert.equal(single.objects.find((object) => object.id === platformIds[0]).properties.w, 760);
  assert.equal(document.objects.find((object) => object.id === platformIds[0]).properties.visual.assetId, GAME_ASSET_IDS.mossPlatform);

  const batch = replaceAssetsForType(single, "platform", "test:platform-moss", registry);
  assert.ok(batch.objects.filter((object) => object.type === "platform").every((object) => object.properties.visual.assetId === "test:platform-moss"));
  assert.equal(batch.objects.find((object) => object.type === "spawn").properties.visual.assetId, GAME_ASSET_IDS.spawnGate);
  assert.throws(() => replaceObjectAsset(document, platformIds[0], "test:goal-light", registry), /does not apply/);
});

test("visual update, full replacement and property reset keep one canonical config shape", () => {
  const registry = testRegistry();
  const document = createBlankLevelDocument("视觉设置");
  const platform = document.objects.find((object) => object.type === "platform");
  const updated = updateObjectVisual(document, platform.id, {
    assetId: "test:platform-stone",
    scaleX: 1.75,
    offsetY: -12,
    opacity: 0.65,
    tint: "#aabbcc"
  }, registry);
  const visual = updated.objects.find((object) => object.id === platform.id).properties.visual;
  assert.equal(visual.scaleX, 1.75);
  assert.equal(visual.scaleY, 1);
  assert.equal(visual.opacity, 0.65);

  const resetScale = resetObjectVisualProperty(updated, platform.id, "scaleX", registry);
  assert.equal(resetScale.objects.find((object) => object.id === platform.id).properties.visual.scaleX, 1);
  assert.equal(resetScale.objects.find((object) => object.id === platform.id).properties.visual.opacity, 0.65);

  const replacement = createVisualConfig({ assetId: "test:platform-moss", flipX: true, drawLayer: 4 });
  const replaced = replaceObjectVisual(resetScale, platform.id, replacement, registry);
  assert.deepEqual(replaced.objects.find((object) => object.id === platform.id).properties.visual, replacement);
});

test("type-wide and document-wide reset restore canonical defaults", () => {
  const registry = testRegistry();
  let document = createBlankLevelDocument("批量重置");
  document.objects.push(createLevelObject("platform", 700, 520, document.objects));
  document = replaceAssetsForType(document, "platform", "test:platform-stone", registry);
  for (const object of document.objects.filter((item) => item.type === "platform")) {
    object.properties.visual.scaleX = 2;
    object.properties.visual.opacity = 0.4;
  }
  const typeReset = resetVisualsForTypeToTypeDefault(document, "platform", registry);
  assert.ok(typeReset.objects.filter((object) => object.type === "platform").every((object) => (
    object.properties.visual.assetId === "test:platform-moss"
    && object.properties.visual.scaleX === 1
    && object.properties.visual.opacity === 1
  )));

  const allReset = resetAllObjectVisualsToProjectDefault(typeReset, registry);
  assert.ok(allReset.objects.every((object) => object.properties.visual.assetId === BUILTIN_PROCEDURAL_ASSET_ID));
  assert.ok(allReset.objects.every((object) => object.properties.visual.scaleX === 1 && object.properties.visual.opacity === 1));
});

test("missing, inapplicable and failed assets resolve to the procedural fallback", () => {
  const registry = testRegistry();
  const missing = resolveVisualAsset(createVisualConfig({ assetId: "missing:asset" }), "platform", registry);
  assert.equal(missing.assetId, "test:platform-moss");
  assert.equal(missing.usedFallback, true);
  assert.equal(missing.fallbackReason, "missing-asset");

  const inapplicable = resolveVisualAsset(createVisualConfig({ assetId: "test:goal-light" }), "platform", registry);
  assert.equal(inapplicable.assetId, "test:platform-moss");
  assert.equal(inapplicable.fallbackReason, "inapplicable-asset");

  const failed = resolveVisualAsset(createVisualConfig({ assetId: "test:platform-moss" }), "platform", registry, {
    unavailableAssetIds: ["test:platform-moss"]
  });
  assert.equal(failed.assetId, BUILTIN_PROCEDURAL_ASSET_ID);
  assert.equal(failed.fallbackReason, "load-failed");

  const missingSceneAsset = resolveAssetReference("missing:scene", "scene", registry);
  assert.equal(missingSceneAsset.assetId, BUILTIN_PROCEDURAL_ASSET_ID);
  assert.equal(missingSceneAsset.fallbackReason, "missing-asset");
});

test("visual and registry validation reject malformed configuration", () => {
  const invalidVisual = { ...createVisualConfig(), scaleX: 0, opacity: 2, tint: "blue", extra: true };
  const visualErrors = validateVisualConfig(invalidVisual);
  assert.ok(visualErrors.some((error) => error.includes("scaleX")));
  assert.ok(visualErrors.some((error) => error.includes("opacity")));
  assert.ok(visualErrors.some((error) => error.includes("tint")));
  assert.ok(visualErrors.some((error) => error.includes("extra")));

  const registry = testRegistry();
  registry.typeDefaults.hazard = "test:platform-moss";
  assert.ok(validateAssetRegistry(registry).some((error) => error.includes("does not apply")));
});
