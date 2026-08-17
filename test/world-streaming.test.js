import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_LOD_LEVELS,
  SpatialGridIndex,
  applyTransformChain,
  buildWorldSpatialIndex,
  createWorldStreamingSimulator,
  invertTransformChain,
  queryVisibleWorld
} from "../src/world-streaming.js";
import { createSyntheticWorld } from "../src/world-preview.js";

test("transform chains and inverse chains preserve canonical world positions", () => {
  const transforms = [
    { position: { x: 1200, y: -400 }, rotationDegrees: 12, scale: { x: 1.2, y: 0.8 } },
    { position: { x: 300, y: 180 }, rotationDegrees: -7, scale: { x: 0.9, y: 1.1 } }
  ];
  const local = { x: 87.5, y: -32.25 };
  const world = applyTransformChain(local, transforms);
  const roundTrip = invertTransformChain(world, transforms);
  assert.ok(Math.abs(roundTrip.x - local.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - local.y) < 1e-9);
});

test("spatial grid returns intersecting stable IDs without scanning every entry", () => {
  const index = new SpatialGridIndex({ cellSize: 100 });
  for (let ordinal = 0; ordinal < 1000; ordinal += 1) {
    index.insert({ id: `item-${ordinal}`, bounds: { x: ordinal * 20, y: 0, w: 10, h: 10 } });
  }
  const matches = index.query({ x: 995, y: -10, w: 80, h: 30 });
  assert.deepEqual(matches.map((entry) => entry.id), ["item-50", "item-51", "item-52", "item-53"]);
  assert.ok(index.stats().maximumCellOccupancy < index.size / 10);
});

test("spatial grid rejects unsafe per-entry and aggregate cell expansion before mutation", () => {
  const perEntry = new SpatialGridIndex({
    cellSize: 10,
    maximumCellsPerEntry: 16,
    maximumCellMemberships: 64
  });
  perEntry.insert({ id: "safe", bounds: { x: 0, y: 0, w: 20, h: 20 } });
  assert.throws(
    () => perEntry.insert({ id: "unsafe", bounds: { x: 0, y: 0, w: 100, h: 100 } }),
    (error) => error?.code === "WORLD_SPATIAL_BUDGET_EXCEEDED"
  );
  assert.equal(perEntry.size, 1);
  assert.equal(perEntry.get("safe").id, "safe");

  const aggregate = new SpatialGridIndex({
    cellSize: 10,
    maximumCellsPerEntry: 16,
    maximumCellMemberships: 6
  });
  aggregate.insert({ id: "first", bounds: { x: 0, y: 0, w: 20, h: 20 } });
  assert.throws(
    () => aggregate.insert({ id: "second", bounds: { x: 20, y: 0, w: 20, h: 20 } }),
    (error) => error?.code === "WORLD_SPATIAL_BUDGET_EXCEEDED"
  );
  assert.equal(aggregate.size, 1);
  assert.equal(aggregate.stats().cellMemberships, 4);
});

test("viewport culling selects index-only, proxy and local-detail LODs", () => {
  const world = createSyntheticWorld({ regionCount: 2, chunksPerRegion: 30, objectsPerChunk: 20 });
  const index = buildWorldSpatialIndex(world);
  const viewport = { x: 0, y: 0, w: 1800, h: 1000 };
  const overview = queryVisibleWorld(index, viewport, { zoom: 0.1, overscan: 0 });
  const proxy = queryVisibleWorld(index, viewport, { zoom: 0.35, overscan: 0 });
  const detail = queryVisibleWorld(index, viewport, { zoom: 1, overscan: 0 });
  assert.equal(overview.lod, WORLD_LOD_LEVELS.INDEX_ONLY);
  assert.equal(overview.objects.length, 0);
  assert.equal(proxy.lod, WORLD_LOD_LEVELS.PROXY);
  assert.ok(proxy.objects.length > 0);
  assert.equal(detail.lod, WORLD_LOD_LEVELS.LOCAL_DETAIL);
  assert.ok(detail.objects.length > proxy.objects.length);
  assert.ok(detail.chunks.length < index.chunkIndex.size / 4);
});

test("non-one-way connection prefetch works from either endpoint even when stored only on from chunk", async () => {
  const world = createSyntheticWorld({ regionCount: 1, chunksPerRegion: 3, objectsPerChunk: 2, gap: 800 });
  for (const chunk of world.regions[0].chunks) {
    chunk.streaming.prefetchDistance = 20;
    chunk.streaming.keepAlive = false;
  }
  const simulator = createWorldStreamingSimulator(world);
  const middle = simulator.spatialIndex.chunks.get("synthetic-r0-c1");
  simulator.update({
    position: { x: middle.bounds.x + middle.bounds.w / 2, y: middle.bounds.y + middle.bounds.h / 2 },
    activeChunkId: middle.id,
    velocity: { x: 0, y: 0 },
    now: 0
  });
  await simulator.settle();
  const states = new Map(simulator.snapshot().chunks.map((chunk) => [chunk.id, chunk.state]));
  assert.equal(states.get("synthetic-r0-c1"), "active");
  assert.equal(states.get("synthetic-r0-c0"), "prefetch", "reverse adjacency must be derived from the single c0 -> c1 edge");
  assert.equal(states.get("synthetic-r0-c2"), "prefetch");
});

test("hysteresis, late-result discard and cache reuse survive teleport and A-B-A", async () => {
  const world = createSyntheticWorld({ regionCount: 1, chunksPerRegion: 2, objectsPerChunk: 2, gap: 4000 });
  for (const chunk of world.regions[0].chunks) {
    chunk.streaming.prefetchDistance = 10;
    chunk.streaming.hysteresis = 0;
    chunk.streaming.unloadDelaySeconds = 0;
    chunk.streaming.keepAlive = false;
  }
  let resolveFirstLoad;
  let deferFirstLoad = true;
  const loader = (record) => {
    if (record.id !== "synthetic-r0-c0" || !deferFirstLoad) return Promise.resolve({ id: record.id });
    deferFirstLoad = false;
    return new Promise((resolve) => { resolveFirstLoad = resolve; });
  };
  const simulator = createWorldStreamingSimulator(world, { loader });
  const first = simulator.spatialIndex.chunks.get("synthetic-r0-c0");
  const firstPosition = { x: first.bounds.x + 20, y: first.bounds.y + 20 };

  simulator.update({ position: firstPosition, activeChunkId: first.id, now: 0 });
  await Promise.resolve();
  simulator.update({ position: { x: 100000, y: 100000 }, now: 1, teleport: true });
  resolveFirstLoad?.({ id: first.id, generation: "late" });
  await simulator.settle();
  assert.ok(simulator.snapshot().metrics.lateResultsDiscarded >= 1);

  simulator.update({ position: firstPosition, activeChunkId: first.id, now: 2 });
  await simulator.settle();
  simulator.update({ position: { x: 100000, y: 100000 }, now: 3, teleport: true });
  simulator.update({ position: firstPosition, activeChunkId: first.id, now: 4, teleport: true });
  assert.ok(simulator.snapshot().metrics.cacheHits >= 1);
  assert.ok(simulator.snapshot().metrics.teleports >= 3);
});

test("50 cross-region transitions keep loaded and cached memory bounded", async () => {
  const world = createSyntheticWorld({ regionCount: 2, chunksPerRegion: 5, objectsPerChunk: 8, gap: 1200 });
  for (const region of world.regions) {
    for (const chunk of region.chunks) {
      chunk.streaming.keepAlive = false;
      chunk.streaming.unloadDelaySeconds = 0;
      chunk.streaming.prefetchDistance = 100;
      chunk.streaming.memoryEstimateBytes = 1024;
    }
  }
  const simulator = createWorldStreamingSimulator(world, { cacheBudgetBytes: 16384 });
  const records = simulator.spatialIndex.chunkIndex.values();
  for (let ordinal = 0; ordinal < 50; ordinal += 1) {
    const target = records[ordinal % records.length];
    simulator.update({
      position: { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 },
      activeChunkId: target.id,
      velocity: { x: ordinal % 2 ? 800 : -800, y: 0 },
      now: ordinal * 1000,
      teleport: true
    });
    await simulator.settle();
  }
  const result = simulator.snapshot();
  assert.ok(result.metrics.cachedMemoryBytes <= 16384);
  assert.ok(result.metrics.estimatedMemoryBytes <= 4 * 1024);
  assert.ok(result.metrics.cacheHits > 0);
});
