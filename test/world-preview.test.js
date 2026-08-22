import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PREVIEW_SOURCE_KINDS,
  SNAPSHOT_STATES,
  createChunkGraph,
  createSyntheticWorld,
  createWorldPreviewModel,
  experienceCuePreviewForObject,
  getSnapshotStatus,
  measurePreviewQuery
} from "../src/world-preview.js";
import { buildWorldSpatialIndex } from "../src/world-streaming.js";

const root = new URL("..", import.meta.url);

test("world preview exposes canonical wind vectors and sign ranges without gameplay", () => {
  assert.deepEqual(experienceCuePreviewForObject({ type: "windZone", properties: { forceX: 520, forceY: 0 } }), {
    kind: "wind",
    forceX: 520,
    forceY: 0,
    x: 1,
    y: 0,
    strength: 520,
    direction: "right",
    calm: false,
    states: ["idle", "inside", "exiting"]
  });
  assert.deepEqual(experienceCuePreviewForObject({ type: "sign", properties: { nearbyRadius: 180, activationRadius: 52 } }), {
    kind: "sign",
    activationRadius: 52,
    nearbyRadius: 180,
    disabled: false,
    states: ["idle", "nearby", "activated", "completed", "disabled"]
  });
});

test("ChunkGraph consumes one frozen nested edge and derives bidirectional topology", () => {
  const world = createSyntheticWorld({ regionCount: 1, chunksPerRegion: 4, objectsPerChunk: 2 });
  const graph = createChunkGraph(world);
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 3, "a bidirectional connection is stored once, not duplicated on both chunks");
  assert.deepEqual(graph.edges[0], {
    id: "synthetic-r0-c0-to-synthetic-r0-c1",
    from: "synthetic-r0-c0",
    to: "synthetic-r0-c1",
    oneWay: false,
    direction: "right",
    requiredAbilities: [],
    requiredFlags: [],
    abilityGate: null,
    flagGate: null,
    routeIds: ["synthetic-route-0"],
    routeKinds: ["main"],
    routeKind: "main",
    entrances: {
      from: "synthetic-r0-c0:entrance-right",
      to: "synthetic-r0-c1:entrance-left"
    },
    source: PREVIEW_SOURCE_KINDS.CANONICAL
  });
});

test("snapshot handshake exposes current, stale, incompatible and missing/import-failed as exclusive states", () => {
  const world = createSyntheticWorld({ regionCount: 1, chunksPerRegion: 1, objectsPerChunk: 1 });
  world.manifest.contentHash = `sha256:${"a".repeat(64)}`;
  const base = {
    snapshotVersion: 1,
    schemaVersion: 3,
    sourceContentHash: world.manifest.contentHash,
    godotBuildId: "4.7.1.stable.official.a13da4feb",
    regions: [],
    warnings: [],
    errors: []
  };
  assert.equal(getSnapshotStatus(world, base).state, SNAPSHOT_STATES.CURRENT);
  assert.equal(getSnapshotStatus(world, { ...base, sourceContentHash: `sha256:${"b".repeat(64)}` }).state, SNAPSHOT_STATES.STALE);
  assert.equal(getSnapshotStatus(world, { ...base, godotBuildId: "4.8.dev" }).state, SNAPSHOT_STATES.INCOMPATIBLE);
  assert.equal(getSnapshotStatus(world, null).state, SNAPSHOT_STATES.MISSING);
  assert.equal(getSnapshotStatus(world, { ...base, status: "import-failed", errors: [{ message: "missing prefab" }] }).state, SNAPSHOT_STATES.MISSING);
});

test("four preview levels reuse one spatial index and make source boundaries explicit", () => {
  const world = createSyntheticWorld({ regionCount: 2, chunksPerRegion: 3, objectsPerChunk: 4 });
  const index = buildWorldSpatialIndex(world);
  const snapshot = {
    snapshotVersion: 1,
    schemaVersion: 3,
    sourceContentHash: "",
    godotBuildId: "4.7.1.stable.official.a13da4feb",
    regions: [],
    errors: []
  };
  for (const view of ["world", "region", "chunk", "godot"]) {
    const model = createWorldPreviewModel(world, {
      view,
      regionId: "synthetic-region-0",
      chunkId: "synthetic-r0-c1",
      spatialIndex: index,
      snapshot,
      viewport: { x: -100, y: -100, w: 6000, h: 1800 },
      zoom: 0.8
    });
    assert.equal(model.view, view);
    assert.equal(model.spatialIndex, index);
    assert.deepEqual(new Set(model.sourceLegend.map((source) => source.id)), new Set(Object.values(PREVIEW_SOURCE_KINDS)));
    if (view === "region") assert.ok(model.visible.chunks.every((chunk) => chunk.regionId === "synthetic-region-0"));
    if (view === "chunk") assert.ok(model.visible.chunks.length <= 3, "local view includes the current chunk and one-hop neighborhood only");
  }
});

test("10x synthetic world meets spatial-index preview query performance gates", () => {
  const world = createSyntheticWorld();
  const report = measurePreviewQuery(world, { iterations: 160, zoom: 0.8 });
  assert.equal(report.regions, 10);
  assert.equal(report.chunks, 200);
  assert.ok(report.objects >= 10000, `expected >= 10,000 objects, received ${report.objects}`);
  assert.ok(report.averageReturnedChunks < report.chunks / 5, "viewport query must cull most chunks");
  assert.ok(report.averageReturnedObjects < report.objects / 5, "viewport query must cull most objects");
  assert.ok(report.queryP95Ms <= 16.7, `p95 ${report.queryP95Ms.toFixed(2)} ms`);
  assert.ok(report.queryP99Ms <= 33.3, `p99 ${report.queryP99Ms.toFixed(2)} ms`);
});

test("real first-forest preview builds from canonical data without decoding its asset registry", async () => {
  const world = JSON.parse(await readFile(new URL("worlds/labs/cablester-composite-showcase.world.json", root), "utf8"));
  const index = buildWorldSpatialIndex(world);
  const model = createWorldPreviewModel(world, {
    spatialIndex: index,
    view: "world",
    viewport: { x: 0, y: -3000, w: 4200, h: 6200 },
    zoom: 0.12
  });
  assert.equal(model.lod, "index-only");
  assert.equal(model.visible.objects.length, 0);
  assert.equal(index.chunkIndex.size, 12);
  assert.equal(index.objectIndex.size, world.regions.flatMap((region) => region.chunks).reduce((sum, chunk) => sum + chunk.objects.length, 0));
  assert.equal(model.snapshotStatus.state, SNAPSHOT_STATES.MISSING);
  assert.equal(model.regionGraph.nodes[0].landmarks.length, 3);
  assert.ok(model.regionGraph.nodes[0].landmarks.every((landmark) => Number.isFinite(landmark.worldPosition.x)));
  assert.equal(model.chunkGraph.edges.filter((edge) => edge.routeKind === "main").length, 7);
  assert.ok(model.overviewMarkers.some((marker) => marker.type === "checkpoint"));
  assert.ok(model.overviewMarkers.some((marker) => marker.type === "abilityPickup"));
  assert.ok(model.overviewMarkers.some((marker) => marker.type === "stateTrigger"));
});
