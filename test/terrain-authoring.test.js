import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createBlankLevelDocument } from "../src/level-objects.js";
import { applyTerrainStamp, applyTerrainStroke, sampleTerrainStroke } from "../src/terrain-authoring.js";
import { applyLevelDocumentToChunk, chunkToLevelDocument, validateWorldPackage } from "../src/world-schema.js";

test("terrain stroke sampling is deterministic across sparse pointer input", () => {
  const sparse = sampleTerrainStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }], 20);
  const dense = sampleTerrainStroke([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 100, y: 0 }], 20);
  assert.deepEqual(sparse, dense);
  assert.deepEqual(sparse.map((point) => Math.round(point.x)), [0, 20, 40, 60, 80, 100]);
});

test("continuous platform brush preserves input and emits existing platform primitives", () => {
  const source = createBlankLevelDocument();
  const before = structuredClone(source);
  const result = applyTerrainStroke(source, {
    tool: "platform",
    points: [{ x: 13, y: 417 }, { x: 247, y: 417 }],
    width: 100,
    depth: 40,
    spacing: 40,
    snap: false
  });
  assert.deepEqual(source, before);
  assert.ok(result.createdIds.length >= 4);
  const created = result.document.objects.filter((object) => result.createdIds.includes(object.id));
  assert.ok(created.every((object) => object.type === "platform"));
  assert.equal(created[0].position.x, -37);
  assert.equal(created[0].position.y, 417);
  assert.equal(created[0].properties.w, 100);
  assert.equal(created[0].properties.h, 40);
});

test("grid snapping is optional rather than canonical", () => {
  const source = createBlankLevelDocument();
  const free = applyTerrainStroke(source, { tool: "slope", points: [{ x: 13, y: 17 }, { x: 117, y: 83 }], snap: false });
  const snapped = applyTerrainStroke(source, { tool: "slope", points: [{ x: 13, y: 17 }, { x: 117, y: 83 }], snap: true, grid: 20 });
  const freeSlope = free.document.objects.at(-1);
  const snappedSlope = snapped.document.objects.at(-1);
  assert.deepEqual(freeSlope.position, { x: 13, y: 17 });
  assert.deepEqual(freeSlope.properties.dx, 104);
  assert.deepEqual(snappedSlope.position, { x: 20, y: 20 });
  assert.deepEqual(snappedSlope.properties.dx, 100);
  assert.deepEqual(snappedSlope.properties.dy, 60);
});

test("eraser only removes terrain primitives and protects gameplay anchors", () => {
  const source = createBlankLevelDocument();
  const spawnId = source.objects.find((object) => object.type === "spawn").id;
  const result = applyTerrainStroke(source, {
    tool: "erase",
    points: [{ x: 120, y: 590 }],
    width: 180
  });
  assert.ok(result.document.objects.some((object) => object.id === spawnId));
  assert.ok(result.removedIds.every((id) => source.objects.find((object) => object.id === id)?.type === "platform"));
});

test("compositional stamps expand into canonical objects and bounded scene layers", () => {
  const source = createBlankLevelDocument();
  const playerLayerId = source.scene.layers.find((layer) => layer.role === "player").id;
  const steps = applyTerrainStamp(source, "ascending-steps", { x: 10, y: 510 }, { snap: true });
  assert.equal(steps.createdIds.length, 4);
  assert.ok(steps.document.objects.filter((object) => steps.createdIds.includes(object.id)).every((object) => object.type === "platform"));

  const island = applyTerrainStamp(steps.document, "root-arch-island", { x: 901, y: 500 });
  assert.equal(island.createdIds.length, 2);
  assert.equal(island.sceneLayerIds.length, 1);
  assert.equal(island.document.scene.layers.filter((layer) => layer.role === "player").length, 1);
  assert.equal(island.document.scene.layers.find((layer) => layer.role === "player").id, playerLayerId);
  const landmark = island.document.scene.layers.find((layer) => island.sceneLayerIds.includes(layer.id));
  assert.equal(landmark.repeatX, false);
  assert.equal(landmark.drawCap, 1);
  assert.deepEqual(landmark.assets, [{ assetId: "scene:root-stone-arch", weight: 1 }]);
});

test("stamp IDs stay stable when the document already contains matching primitive IDs", () => {
  const source = createBlankLevelDocument();
  const first = applyTerrainStamp(source, "hazard-corridor", { x: 0, y: 0 });
  const second = applyTerrainStamp(first.document, "hazard-corridor", { x: 800, y: 0 });
  const ids = second.document.objects.map((object) => object.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(second.createdIds.length, 3);
});

test("terrain authoring round-trips through the frozen Chunk adapter without erasing extensions", async () => {
  const world = JSON.parse(await readFile(new URL("../worlds/fixtures/v3-golden.world.json", import.meta.url), "utf8"));
  const region = world.regions[0];
  const chunk = region.chunks[0];
  const preserved = structuredClone(chunk.objects[0]);
  const document = chunkToLevelDocument(world, region.id, chunk.id);
  const stroke = applyTerrainStroke(document, {
    tool: "platform",
    points: [{ x: 777, y: 333 }, { x: 1017, y: 333 }],
    width: 120,
    depth: 40,
    snap: false
  });
  const stamped = applyTerrainStamp(stroke.document, "root-arch-island", { x: 1200, y: 500 });
  const nextWorld = applyLevelDocumentToChunk(world, region.id, chunk.id, stamped.document);
  const nextChunk = nextWorld.regions[0].chunks[0];
  const existing = nextChunk.objects.find((object) => object.id === preserved.id);
  assert.deepEqual(existing.editorExtension, preserved.editorExtension);
  assert.deepEqual(existing.transform, preserved.transform);
  assert.deepEqual(existing.links, preserved.links);
  assert.deepEqual(existing.tags, preserved.tags);
  assert.ok(stroke.createdIds.every((id) => nextChunk.objects.some((object) => object.id === id && object.type === "platform")));
  assert.equal(nextChunk.scene.layers.filter((layer) => layer.role === "player").length, 1);
  assert.equal(validateWorldPackage(nextWorld).some((issue) => (issue.severity || "error") === "error"), false);
  const roundTrip = chunkToLevelDocument(nextWorld, region.id, chunk.id);
  assert.ok(stroke.createdIds.every((id) => roundTrip.objects.some((object) => object.id === id)));
});
