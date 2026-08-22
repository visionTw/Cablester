import test from "node:test";
import assert from "node:assert/strict";
import {
  addSceneLayer,
  calculateSeamlessPlacements,
  createDefaultScene,
  createSceneLayer,
  deleteSceneLayer,
  duplicateSceneLayer,
  moveSceneLayer,
  sceneLayerBaselineY,
  sortSceneLayers,
  updateSceneLayer,
  validateScene,
  validateSceneLayer
} from "../src/scene-layers.js";

test("default scene defines background, midground, player and foreground around depth zero", () => {
  const scene = createDefaultScene();
  assert.deepEqual(validateScene(scene), []);
  assert.deepEqual(scene.layers.map((layer) => layer.role), ["background", "midground", "player", "foreground"]);
  const player = scene.layers.find((layer) => layer.role === "player");
  assert.equal(player.depth, 0);
  assert.equal(player.parallax, 1);
  assert.ok(scene.layers[0].parallax < player.parallax);
  assert.ok(scene.layers.at(-1).parallax > player.parallax);
});

test("scene layers can be created, updated, sorted, moved, duplicated and deleted immutably", () => {
  const original = createDefaultScene();
  const added = addSceneLayer(original, {
    name: "薄雾",
    role: "custom",
    depth: -60,
    parallax: 0.35,
    seed: "mist-layer"
  });
  assert.equal(original.layers.length, 4);
  assert.equal(added.layers.length, 5);
  const mist = added.layers.find((layer) => layer.name === "薄雾");
  const updated = updateSceneLayer(added, mist.id, { opacity: 0.55, fog: 0.7 });
  assert.equal(updated.layers.find((layer) => layer.id === mist.id).opacity, 0.55);
  assert.equal(added.layers.find((layer) => layer.id === mist.id).opacity, 1);

  const sorted = sortSceneLayers(updated);
  assert.deepEqual(sorted.layers.map((layer) => layer.depth), [-100, -60, -20, 0, 100]);
  const moved = moveSceneLayer(sorted, mist.id, 0);
  assert.equal(moved.layers[0].id, mist.id);

  const duplicated = duplicateSceneLayer(moved, mist.id, { id: "scene-mist-copy" });
  assert.equal(duplicated.layers.length, 6);
  assert.equal(duplicated.layers[1].name, "薄雾 副本");
  const deleted = deleteSceneLayer(duplicated, "scene-mist-copy");
  assert.equal(deleted.layers.length, 5);
  assert.deepEqual(validateScene(deleted), []);
});

test("player and locked layer invariants are enforced", () => {
  const scene = createDefaultScene();
  const player = scene.layers.find((layer) => layer.role === "player");
  assert.throws(() => addSceneLayer(scene, { id: scene.layers[0].id, role: "custom" }), /Duplicate scene layer id/);
  assert.throws(() => deleteSceneLayer(scene, player.id), /cannot be deleted/);
  assert.throws(() => moveSceneLayer(scene, player.id, 0), /locked/);

  const duplicate = duplicateSceneLayer(scene, player.id, { id: "scene-player-copy" });
  assert.equal(duplicate.layers.find((layer) => layer.id === "scene-player-copy").role, "custom");
  assert.deepEqual(validateScene(duplicate), []);

  const unlocked = updateSceneLayer(scene, player.id, { locked: false });
  assert.equal(unlocked.layers.find((layer) => layer.id === player.id).locked, false);
});

test("seamless placement is deterministic, continuous and bounded by draw cap", () => {
  const layer = createSceneLayer({
    id: "scene-repeat-test",
    role: "custom",
    name: "重复测试",
    assets: [
      { assetId: "asset:a", weight: 1 },
      { assetId: "asset:b", weight: 2 }
    ],
    seamless: { mode: "mirror", tileWidth: 100, overlap: 10 },
    seed: "same-seed",
    spacing: 0,
    density: 1,
    drawCap: 64
  });
  const first = calculateSeamlessPlacements(layer, { cameraX: 800, viewportWidth: 640, overscan: 80 });
  const second = calculateSeamlessPlacements(layer, { cameraX: 800, viewportWidth: 640, overscan: 80 });
  assert.deepEqual(first, second);
  assert.ok(first.placements.length > 1);
  for (let index = 1; index < first.placements.length; index += 1) {
    assert.equal(first.placements[index].x - first.placements[index - 1].x, 90);
  }
  assert.ok(first.placements.every((placement) => ["asset:a", "asset:b"].includes(placement.assetId)));

  const cappedLayer = { ...layer, drawCap: 3 };
  const capped = calculateSeamlessPlacements(cappedLayer, { cameraX: 800, viewportWidth: 1600, overscan: 200 });
  assert.equal(capped.placements.length, 3);
  assert.equal(capped.capped, true);
  assert.ok(capped.candidateCount > capped.placements.length);
});

test("placement respects finite ranges, visibility and non-repeating layers", () => {
  const layer = createSceneLayer({
    id: "scene-range-test",
    role: "custom",
    name: "范围测试",
    repeatX: false,
    originX: 200,
    range: { startX: 100, endX: 500 },
    seamless: { mode: "tile", tileWidth: 120, overlap: 0 }
  });
  const result = calculateSeamlessPlacements(layer, { cameraX: 300, viewportWidth: 600 });
  assert.equal(result.placements.length, 1);
  assert.equal(result.placements[0].x, 200);
  assert.deepEqual(calculateSeamlessPlacements({ ...layer, visible: false }, { cameraX: 300, viewportWidth: 600 }).placements, []);
  assert.deepEqual(calculateSeamlessPlacements(layer, { cameraX: 2000, viewportWidth: 200 }).placements, []);
});

test("scene layers support an optional world-space Y anchor without invalidating legacy JSON", () => {
  const legacy = createSceneLayer({ id: "scene-legacy-y", role: "background" });
  assert.equal(Object.hasOwn(legacy, "originY"), false);
  assert.deepEqual(validateSceneLayer(legacy), []);
  assert.equal(sceneLayerBaselineY(legacy, 720), 720);

  const scene = createDefaultScene();
  const background = scene.layers.find((layer) => layer.role === "background");
  const anchored = updateSceneLayer(scene, background.id, { originY: 460 });
  assert.equal(anchored.layers.find((layer) => layer.id === background.id).originY, 460);
  assert.equal(Object.hasOwn(background, "originY"), false);
  assert.equal(sceneLayerBaselineY(anchored.layers[0], 720), 460);

  assert.deepEqual(validateSceneLayer({ ...legacy, originY: null }), []);
  assert.ok(validateSceneLayer({ ...legacy, originY: Infinity }).some((error) => error.includes("originY")));
  assert.ok(validateSceneLayer({ ...legacy, originY: 10000001 }).some((error) => error.includes("originY")));
  assert.ok(validateSceneLayer({ ...legacy, originY: "460" }).some((error) => error.includes("originY")));
});

test("strict scene validation rejects malformed or unknown fields", () => {
  const layer = createSceneLayer({ id: "scene-invalid-base", role: "custom" });
  const errors = validateSceneLayer({
    ...layer,
    opacity: 1.2,
    tint: "white",
    drawCap: 0,
    unknown: true,
    seamless: { ...layer.seamless, overlap: layer.seamless.tileWidth }
  });
  assert.ok(errors.some((error) => error.includes("opacity")));
  assert.ok(errors.some((error) => error.includes("tint")));
  assert.ok(errors.some((error) => error.includes("drawCap")));
  assert.ok(errors.some((error) => error.includes("unknown")));
  assert.ok(errors.some((error) => error.includes("overlap")));

  const scene = createDefaultScene();
  scene.layers.push(structuredClone(scene.layers.find((candidate) => candidate.role === "player")));
  assert.ok(validateScene(scene).some((error) => error.includes("exactly one player layer")));
});
