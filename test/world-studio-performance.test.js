import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const evidenceUrl = new URL("../artifacts/web/world-studio-performance.json", import.meta.url);

async function evidence() {
  return JSON.parse(await readFile(evidenceUrl, "utf8"));
}

async function currentSourceFingerprint(paths) {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(new URL(`../${path}`, import.meta.url)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

test("World Studio evidence is a fresh real-browser pass for forest and >=10x synthetic", async () => {
  const audit = await evidence();
  assert.equal(audit.schemaVersion, 1);
  assert.equal(audit.kind, "cablester-world-studio-browser-performance");
  assert.equal(audit.status, "pass");
  assert.equal(audit.configuration.standardRun, true);
  assert.equal(audit.acceptance.passed, true);
  assert.deepEqual(audit.acceptance.failures, []);
  assert.equal(audit.inputs.sourceFingerprint.value,
    await currentSourceFingerprint(audit.inputs.sourceFingerprint.paths),
    "browser evidence must match the current frozen World Studio sources and forest");
  assert.equal(audit.inputs.completionFingerprint.value, audit.inputs.sourceFingerprint.value,
    "World Studio sources and Godot evidence must remain unchanged throughout the browser run");
  assert.equal(audit.inputs.forest.sha256,
    `sha256:${createHash("sha256").update(await readFile(new URL("../worlds/formal/first-forest.world.json", import.meta.url))).digest("hex")}`);
  assert.equal(audit.inputs.forest.worldId, "cablester-first-forest");
  assert.equal(audit.inputs.forest.contentHash, "sha256:bd86d11711e237d8305594384fb0081ea41c003bb7121952f919030eed01c5d7");
  assert.ok(audit.inputs.forest.chunks >= 12);
  assert.ok(audit.inputs.forest.objects >= 250);
  assert.equal(audit.inputs.synthetic.regions, 10);
  assert.equal(audit.inputs.synthetic.chunks, 200);
  assert.ok(audit.inputs.synthetic.objects >= audit.inputs.forest.objects * 10,
    `synthetic ${audit.inputs.synthetic.objects} must be >= 10x forest ${audit.inputs.forest.objects}`);
  assert.ok(audit.inputs.synthetic.scaleVersusForest.objectMultiplier >= 10);
  assert.match(audit.notes.browserSurface, /real Google Chrome renderer/i);
  assert.match(audit.notes.canvasInput, /trusted mouse/i);
});

test("cold first load does not request or decode every full-resolution world asset", async () => {
  const audit = await evidence();
  const firstLoad = audit.firstLoad;
  assert.equal(firstLoad.emptyBrowserCache, true);
  assert.equal(firstLoad.totalColdNavigation.applicationErrorCount, 0);
  assert.ok(firstLoad.totalColdNavigation.requestCount > 0);
  assert.ok(firstLoad.fullResolutionWorldAssets.registryCount > 0);
  assert.ok(firstLoad.fullResolutionWorldAssets.requestedCount < firstLoad.fullResolutionWorldAssets.registryCount,
    `${firstLoad.fullResolutionWorldAssets.requestedCount}/${firstLoad.fullResolutionWorldAssets.registryCount} full assets were requested`);
  assert.ok(firstLoad.fullResolutionWorldAssets.notRequestedCount > 0);
  assert.equal(firstLoad.decodedEstimateDeltaBytes, 0,
    "opening World Studio must not increase the runtime's decoded full-resolution asset estimate");
  assert.match(firstLoad.fullResolutionWorldAssets.proof, /new profile/i);
});

test("real Canvas pan/zoom keeps forest and synthetic frame distributions inside gates", async () => {
  const audit = await evidence();
  for (const [label, sample] of [
    ["forest", audit.forest.canvasPanZoom],
    ["synthetic", audit.synthetic.canvasPanZoom]
  ]) {
    assert.ok(sample.frames.measuredDurationMs >= sample.frames.requestedDurationMs * 0.9, label);
    assert.ok(sample.frames.averageFps >= audit.configuration.thresholds.minimumAverageFps,
      `${label} ${sample.frames.averageFps} fps`);
    assert.ok(sample.frames.p95FrameMs <= audit.configuration.thresholds.maximumP95FrameMs,
      `${label} p95 ${sample.frames.p95FrameMs} ms`);
    assert.ok(sample.frames.p99FrameMs <= audit.configuration.thresholds.maximumP99FrameMs,
      `${label} p99 ${sample.frames.p99FrameMs} ms`);
    assert.ok(sample.realInputEvents.pointermove >= 50, label);
    assert.ok(sample.realInputEvents.wheel >= 2, label);
    assert.ok(sample.minimumCanvasDraws >= 52, label);
    assert.equal(sample.pixelEvidence.changed, true, `${label} Canvas pixels must visibly change during pan/zoom`);
    assert.ok(sample.inputToNextPaint.maximumMs < 100, `${label} input paint ${sample.inputToNextPaint.maximumMs} ms`);
  }
});

test("three-level Canvas moves, connection builder, undo, and background pan preserve canonical semantics", async () => {
  const audit = await evidence();
  const editing = audit.forest.canvasEditing;
  assert.deepEqual(editing.drags.map((item) => `${item.view}:${item.kind}`), [
    "world:region",
    "region:chunk",
    "chunk:object"
  ]);
  for (const drag of editing.drags) {
    assert.equal(drag.target.kind, drag.kind);
    assert.equal(drag.afterMove.dirty, true, `${drag.kind} drag must dirty the session`);
    assert.ok(drag.afterMove.changeCount > drag.before.changeCount, `${drag.kind} drag must add semantic diff`);
    assert.equal(drag.afterMove.semanticChanged, true);
    assert.equal(drag.afterUndo.semanticRestored, true, `${drag.kind} undo must restore bytes`);
    assert.equal(drag.afterUndo.changeCount, drag.before.changeCount);
  }
  assert.equal(editing.backgroundPan.after.semanticUnchanged, true);
  assert.equal(editing.backgroundPan.after.dirty, editing.backgroundPan.before.dirty);
  assert.equal(editing.backgroundPan.after.changeCount, editing.backgroundPan.before.changeCount);
  assert.equal(editing.connection.afterCreate.connectionCountDelta, 1);
  assert.equal(editing.connection.afterCreate.storedCopies, 1,
    "the builder stores one frozen edge only in the from Chunk");
  assert.equal(editing.connection.afterUndo.createdConnectionAbsent, true);
  assert.equal(editing.connection.afterUndo.semanticRestored, true);
  assert.equal(editing.final.dirty, false);
  assert.equal(editing.final.changeCount, 0);
  assert.equal(editing.final.semanticRestored, true);
});

test("four Canvas views contain overview, route, collision, snapshot and trajectory evidence", async () => {
  const audit = await evidence();
  const result = audit.forest.fourPreviewViews;
  assert.deepEqual(result.views.map((view) => view.view), ["world", "region", "chunk", "godot"]);
  assert.ok(result.distinctCanvasDigests >= 3);
  const views = Object.fromEntries(result.views.map((view) => [view.view, view]));
  for (const view of result.views) {
    assert.ok(view.canvas.nonTransparentPixels > 0, view.view);
    assert.ok(view.canvas.brightPixels > 0, view.view);
    assert.ok(Object.values(view.operationCounts).reduce((sum, value) => sum + value, 0) > 0, view.view);
    assert.equal(view.snapshotStatus.state, "current", view.view);
  }
  assert.ok(views.world.semanticLayers.overviewMarkers > 0);
  assert.ok(views.world.semanticLayers.landmarks > 0);
  assert.ok(views.world.semanticLayers.routeDefinitions > 0);
  assert.ok(views.region.semanticLayers.chunkNodes > 0);
  assert.ok(views.region.semanticLayers.routeEdges > 0);
  assert.ok(views.region.operationCounts.lineTo > 0);
  assert.ok(views.chunk.semanticLayers.canonicalCollisionProxies > 0);
  assert.ok(views.chunk.operationCounts.strokeRect > 0);
  assert.ok(views.godot.semanticLayers.godotSnapshotChunks > 0);
  assert.ok(views.godot.semanticLayers.godotCollisionProxies > 0);
  assert.ok(views.godot.semanticLayers.godotTrajectorySamples > 1);
  assert.ok(views.godot.operationCounts.lineTo > 0);
});

test("cleared browser drafts recover the exact formal repository package and current snapshot", async () => {
  const audit = await evidence();
  const recovery = audit.forest.storageRecovery;
  assert.equal(recovery.storage.beforeClear.localDraftPresent, true);
  assert.equal(recovery.storage.beforeClear.sessionDraftPresent, true);
  assert.deepEqual(recovery.storage.afterClear, {
    localLength: 0,
    sessionLength: 0,
    localDraftPresent: false,
    sessionDraftPresent: false
  });
  assert.equal(recovery.repositoryReadbackProved, true);
  assert.deepEqual(new Set(recovery.repositoryGetPaths), new Set([
    "/__cablester/world-repository",
    "/worlds/formal/first-forest.world.json"
  ]));
  assert.equal(recovery.recovered.worldId, "cablester-first-forest");
  assert.equal(recovery.recovered.contentHash, "sha256:bd86d11711e237d8305594384fb0081ea41c003bb7121952f919030eed01c5d7");
  assert.equal(recovery.recovered.chunks, 12);
  assert.equal(recovery.recovered.objects, 284);
  assert.equal(recovery.recovered.dirty, false);
  assert.equal(recovery.recovered.changeCount, 0);
  assert.equal(recovery.recovered.snapshotStatus.state, "current");
  assert.equal(recovery.recovered.snapshotStatus.current, true);
});

test("selection, view switching and edit feedback remain below 100 ms", async () => {
  const audit = await evidence();
  for (const [worldLabel, interactions] of [
    ["forest", audit.forest.interactions],
    ["synthetic", audit.synthetic.interactions]
  ]) {
    for (const action of ["selection", "viewSwitch", "edit"]) {
      assert.ok(interactions[action].paint.maximumMs < 100,
        `${worldLabel}.${action} maximum paint was ${interactions[action].paint.maximumMs} ms`);
      assert.ok(interactions[action].sync.maximumMs < interactions[action].paint.maximumMs);
      assert.ok(interactions[action].samples.length >= 6);
    }
    assert.equal(interactions.dirtyAfterUndo, false);
  }
});

test("dedicated Worker reports progress, completes forest, and cancels synthetic validation", async () => {
  const audit = await evidence();
  const forest = audit.forest.workerValidation;
  assert.equal(forest.transport, "dedicated-module-worker");
  assert.ok(forest.progress.length >= 3);
  assert.equal(forest.progressMonotonic, true);
  assert.equal(forest.result.summary.errors, 0);
  assert.equal(forest.result.summary.cancelled, false);
  const synthetic = audit.synthetic.workerCancellation;
  assert.equal(synthetic.transport, "dedicated-module-worker");
  assert.equal(synthetic.cancelled, true);
  assert.equal(synthetic.errorName, "AbortError");
  assert.ok(synthetic.progress.length >= 1);
  assert.ok(synthetic.cancelResponseMs < 1_000);
});

test("50 cross-region transitions reach cache hits and bounded heap/cache steady state", async () => {
  const audit = await evidence();
  const streaming = audit.synthetic.streamingCrossRegion;
  assert.equal(streaming.completedTransitions, 50);
  assert.ok(streaming.crossRegionTransitions >= 49);
  assert.equal(streaming.regionCount, 10);
  assert.ok(streaming.final.metrics.cacheHits > 0);
  assert.ok(streaming.final.metrics.cacheMisses > 0);
  assert.ok(streaming.cacheHitRate > 0);
  assert.ok(streaming.memorySteadyState.tailSampleCount >= 4);
  assert.ok(streaming.memorySteadyState.tailMaximumToMinimumRatio <= audit.configuration.thresholds.maximumStreamingTailRatio,
    `tail ratio ${streaming.memorySteadyState.tailMaximumToMinimumRatio}`);
  assert.ok(streaming.memorySteadyState.tailMaximumBytes <= streaming.memorySteadyState.allowedTotalBytes);
  assert.ok(streaming.final.metrics.cachedMemoryBytes <= streaming.memorySteadyState.cacheBudgetBytes);
  assert.ok(Number.isFinite(audit.synthetic.memory.retainedAfterStreamingBytes));
  assert.ok(audit.synthetic.memory.retainedAfterStreamingBytes <= audit.configuration.thresholds.maximumRetainedHeapGrowthBytes,
    `retained heap ${audit.synthetic.memory.retainedAfterStreamingBytes} bytes`);
});

test("World Studio browser run is free of fresh application errors", async () => {
  const audit = await evidence();
  assert.equal(audit.diagnostics.errorCount, 0);
  assert.deepEqual(audit.diagnostics.exceptions, []);
  assert.deepEqual(audit.diagnostics.consoleErrors, []);
  assert.deepEqual(audit.diagnostics.logErrors, []);
  assert.equal(audit.longTasks.supported, true);
  assert.equal(typeof audit.longTasks.maximumDurationMs, "number");
  assert.ok(projectRoot.endsWith("/Cablester/"));
});
