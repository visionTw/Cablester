import test from "node:test";
import assert from "node:assert/strict";
import {
  LEVEL_ART_PRESET_BY_ID,
  LEVEL_ART_THEME_BY_ID,
  REPRESENTATIVE_LEVEL_ID,
  applyLevelArtPreset,
  createLevelArtDocument
} from "../src/level-art-presets.js";
import { compileLevelDocument, levelToDocument, validateLevelDocument } from "../src/level-objects.js";
import { LEGACY_LEVELS, LEVELS } from "../src/levels.js";
import {
  BUILTIN_LEVEL_OBJECT_TYPES,
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY,
  GAME_ASSET_IDS,
  SCENE_ASSET_IDS,
  createAssetRegistry,
  getAssetById,
  isAssetApplicable,
  resolveAssetReference,
  resolveVisualAsset
} from "../src/asset-library.js";

const RUNTIME_COLLECTIONS = Object.freeze([
  "backgroundSeeds", "platforms", "slopes", "hazards", "anchors", "energyOrbs", "dashRefills",
  "movingObjects", "launchers", "fragilePlatforms", "gates", "stateTriggers", "abilityPickups",
  "bashTargets", "windZones", "liquidZones", "darknessZones", "checkpoints", "roomEntrances",
  "roomExits", "rotationTriggers", "signs"
]);

const REPRESENTATIVE_ASSET_BY_TYPE = Object.freeze({
  platform: GAME_ASSET_IDS.mossPlatform,
  hazard: GAME_ASSET_IDS.thornHazard,
  anchor: GAME_ASSET_IDS.ropeAnchor,
  energyOrb: GAME_ASSET_IDS.energyOrb,
  bashTarget: GAME_ASSET_IDS.bashBlossom,
  checkpoint: GAME_ASSET_IDS.checkpointLantern,
  spawn: GAME_ASSET_IDS.spawnGate,
  goal: GAME_ASSET_IDS.goalGate
});

function gameplaySnapshot(level) {
  return {
    spawn: level.spawn,
    goal: level.goal,
    bounds: level.bounds,
    startingAbilities: level.startingAbilities,
    dashCapacity: level.dashCapacity ?? 1,
    collections: Object.fromEntries(RUNTIME_COLLECTIONS.map((key) => [key, level[key] || []]))
  };
}

test("all ten formal levels enter runtime through a valid v2 art document", () => {
  assert.equal(LEGACY_LEVELS.length, 10);
  assert.equal(LEVELS.length, 10);
  assert.deepEqual(Object.keys(LEVEL_ART_PRESET_BY_ID).sort(), LEGACY_LEVELS.map((level) => level.id).sort());

  for (const [index, sourceLevel] of LEGACY_LEVELS.entries()) {
    const document = createLevelArtDocument(sourceLevel);
    assert.equal(document.schemaVersion, 2, sourceLevel.id);
    assert.deepEqual(validateLevelDocument(document), [], sourceLevel.id);
    assert.deepEqual(compileLevelDocument(document), LEVELS[index], sourceLevel.id);
  }
});

test("all ten formal levels have distinct themes, registered object art and twelve registered scene layers", () => {
  const themeLabels = new Set();
  const themeSignatures = new Set();
  const expectedSceneAssetIds = Object.values(SCENE_ASSET_IDS).sort();

  for (const level of LEVELS) {
    const theme = LEVEL_ART_THEME_BY_ID[level.id];
    assert.ok(theme, `${level.id} has no theme`);
    assert.ok(theme.label, `${level.id} theme has no label`);
    themeLabels.add(theme.label);
    themeSignatures.add([
      theme.terrainTint,
      theme.backgroundTint,
      theme.midTint,
      theme.moteTint
    ].join("|"));

    const document = levelToDocument(level);
    const imageObjects = document.objects.filter((object) => object.properties.visual.assetId !== BUILTIN_PROCEDURAL_ASSET_ID);
    assert.ok(imageObjects.length > 0, `${level.id} has no configured object art`);
    for (const object of imageObjects) {
      const asset = getAssetById(DEFAULT_ASSET_REGISTRY, object.properties.visual.assetId);
      assert.ok(asset, `${level.id}.${object.id} references an unregistered object asset`);
      assert.equal(isAssetApplicable(asset, object.type), true, `${asset.id} does not apply to ${object.type}`);
    }
    for (const [type, assetId] of Object.entries(REPRESENTATIVE_ASSET_BY_TYPE)) {
      const objects = document.objects.filter((object) => object.type === type);
      if (!objects.length) continue;
      assert.ok(objects.every((object) => object.properties.visual.assetId === assetId), `${level.id}.${type} theme mapping`);
    }

    assert.equal(level.scene.layers.length, 12, `${level.id} scene layer count`);
    assert.equal(new Set(level.scene.layers.map((layer) => layer.id)).size, 12, `${level.id} scene layer ids`);
    assert.equal(level.scene.layers.filter((layer) => layer.role === "player").length, 1, `${level.id} player layer count`);
    assert.deepEqual(
      [...new Set(level.scene.layers.flatMap((layer) => layer.assets.map((asset) => asset.assetId)))].sort(),
      expectedSceneAssetIds,
      `${level.id} scene asset set`
    );
    for (const layer of level.scene.layers) {
      assert.match(layer.name, new RegExp(theme.label), `${level.id}.${layer.id} themed name`);
      assert.ok(layer.seed.startsWith(`${level.id}-`), `${level.id}.${layer.id} unique seed`);
      for (const reference of layer.assets) {
        const asset = getAssetById(DEFAULT_ASSET_REGISTRY, reference.assetId);
        assert.ok(asset, `${level.id}.${layer.id} references an unregistered scene asset`);
        assert.equal(isAssetApplicable(asset, "scene"), true, `${asset.id} does not apply to scene layers`);
      }
    }
  }

  assert.equal(themeLabels.size, 10, "formal level theme labels must be distinct");
  assert.equal(themeSignatures.size, 10, "formal level colour signatures must be distinct");
});

test("art compilation preserves formal-level gameplay counts and collision semantics", () => {
  for (const [index, sourceLevel] of LEGACY_LEVELS.entries()) {
    const compiled = LEVELS[index];
    assert.deepEqual(gameplaySnapshot(compiled), gameplaySnapshot(sourceLevel), sourceLevel.id);
    for (const collection of RUNTIME_COLLECTIONS) {
      assert.equal((compiled[collection] || []).length, (sourceLevel[collection] || []).length, `${sourceLevel.id}.${collection}`);
    }
  }
});

test("all eight representative gameplay assets survive document and runtime round-trip", () => {
  const level = LEVELS.find((candidate) => candidate.id === REPRESENTATIVE_LEVEL_ID);
  assert.ok(level);
  const document = levelToDocument(level);
  assert.equal(Object.keys(REPRESENTATIVE_ASSET_BY_TYPE).length, 8);
  assert.deepEqual([...new Set(Object.values(REPRESENTATIVE_ASSET_BY_TYPE))].sort(), Object.values(GAME_ASSET_IDS).sort());

  for (const [type, assetId] of Object.entries(REPRESENTATIVE_ASSET_BY_TYPE)) {
    const objects = document.objects.filter((object) => object.type === type);
    assert.ok(objects.length > 0, `representative level has no ${type}`);
    assert.ok(objects.every((object) => object.properties.visual.assetId === assetId), `${type} document visual`);
    assert.ok(objects.every((object) => level.visuals[object.id].assetId === assetId), `${type} runtime visual`);
    const asset = getAssetById(DEFAULT_ASSET_REGISTRY, assetId);
    assert.ok(asset, `${assetId} is not registered`);
    assert.equal(isAssetApplicable(asset, type), true, `${assetId} does not apply to ${type}`);
  }

  const roundTrip = compileLevelDocument(document);
  assert.deepEqual(roundTrip.visuals, level.visuals);
  assert.deepEqual(gameplaySnapshot(roundTrip), gameplaySnapshot(level));
});

test("representative scene references reusable assets in canonical v2 layers", () => {
  const level = LEVELS.find((candidate) => candidate.id === REPRESENTATIVE_LEVEL_ID);
  const sceneAssetIds = new Set(level.scene.layers.flatMap((layer) => layer.assets.map((asset) => asset.assetId)));
  assert.ok(Object.values(SCENE_ASSET_IDS).every((assetId) => sceneAssetIds.has(assetId)));
  assert.equal(level.scene.layers.length, 12);
  assert.equal(level.scene.layers.find((layer) => layer.id === "scene-deep-root-spires").depth, -124);
  assert.equal(level.scene.layers.find((layer) => layer.id === "scene-far-canopy").depth, -56);
  assert.equal(level.scene.layers.find((layer) => layer.id === "scene-mid-landmarks").depth, -8);
  assert.equal(level.scene.layers.find((layer) => layer.id === "scene-near-bell-flowers").depth, -3);
  assert.equal(level.scene.layers.find((layer) => layer.id === "scene-near-luminous-plants").depth, -2);
  assert.equal(level.scene.layers.find((layer) => layer.role === "player").depth, 0);
  assert.equal(level.scene.layers.find((layer) => layer.role === "player").parallax, 1);
  const roundTrip = compileLevelDocument(levelToDocument(level));
  assert.deepEqual(roundTrip.scene, level.scene);
});

test("missing preset assets safely resolve to the procedural project fallback", () => {
  const registry = createAssetRegistry({
    assets: DEFAULT_ASSET_REGISTRY.assets.filter((asset) => asset.id === BUILTIN_PROCEDURAL_ASSET_ID),
    typeDefaults: Object.fromEntries(BUILTIN_LEVEL_OBJECT_TYPES.map((type) => [type, BUILTIN_PROCEDURAL_ASSET_ID]))
  });
  const source = LEGACY_LEVELS.find((level) => level.id === REPRESENTATIVE_LEVEL_ID);
  const document = applyLevelArtPreset(levelToDocument(source));
  for (const [type, assetId] of Object.entries(REPRESENTATIVE_ASSET_BY_TYPE)) {
    const object = document.objects.find((candidate) => candidate.type === type);
    assert.equal(object.properties.visual.assetId, assetId);
    const resolved = resolveVisualAsset(object.properties.visual, type, registry);
    assert.equal(resolved.asset.id, BUILTIN_PROCEDURAL_ASSET_ID);
    assert.equal(resolved.usedFallback, true);
    assert.equal(resolved.fallbackReason, "missing-asset");
  }
  for (const assetId of Object.values(SCENE_ASSET_IDS)) {
    const resolved = resolveAssetReference(assetId, "scene", registry);
    assert.equal(resolved.asset.id, BUILTIN_PROCEDURAL_ASSET_ID);
    assert.equal(resolved.usedFallback, true);
    assert.equal(resolved.fallbackReason, "missing-asset");
  }
});
