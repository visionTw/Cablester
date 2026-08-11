import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "../scripts/reference-library-fingerprint.mjs";
import { GENERATED_GAME_ASSETS } from "../src/asset-library.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("current browser performance evidence covers startup, frames, memory and low-tier degradation", async () => {
  const [audit, referenceAudit, fingerprint] = await Promise.all([
    readFile(new URL("../levels/art/performance-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/performance-audit.json", import.meta.url), "utf8").then(JSON.parse),
    referenceLibraryFingerprint(projectRoot)
  ]);

  assert.equal(audit.status, "pass");
  assert.equal(audit.configuration.standardRun, true);
  assert.equal(audit.acceptance.passed, true);
  assert.deepEqual(audit.acceptance.failures, []);
  assert.equal(audit.diagnostics.errorCount, 0);
  assert.equal(audit.diagnostics.warningCount, 0);

  assert.equal(audit.startup.cold.network.applicationErrorCount, 0);
  assert.equal(audit.startup.warm.network.applicationErrorCount, 0);
  assert.ok(audit.startup.cold.network.requestCount > 0);
  assert.ok(audit.startup.cold.network.transferBytes > 0);
  assert.ok(audit.startup.cold.network.decodedBodyBytes > 0);
  assert.ok(audit.startup.warm.network.cachedRequestCount > 0);
  assert.ok(audit.startup.warm.network.transferBytes < audit.startup.cold.network.transferBytes);
  assert.ok(audit.startup.cold.network.byType.Image <= GENERATED_GAME_ASSETS.length,
    "hidden workshop must not preload asset-library thumbnails");
  assert.equal(audit.startup.cold.network.resources.filter((resource) => (
    resource.type === "Image" && /\/thumbnails\//.test(resource.url)
  )).length, 0);

  assert.deepEqual(audit.formalRepresentative.samples.map((sample) => sample.viewport), [
    { width: 1280, height: 720 },
    { width: 1600, height: 1000 },
    { width: 800, height: 900 }
  ]);
  for (const sample of audit.formalRepresentative.samples) {
    assert.ok(sample.metrics.measuredDurationMs >= 9_000);
    assert.ok(sample.metrics.averageFps >= 30);
    assert.ok(sample.movement.cameraRangeX >= 20);
    assert.ok(sample.movement.cameraCumulativeX >= sample.movement.cameraRangeX);
    assert.ok(sample.input.heldRightMs >= 8_500);
    assert.equal(sample.after.visualStats.error, 0);
  }
  assert.deepEqual(audit.formalLevels.samples.map((sample) => (
    `${sample.levelId}@${sample.viewport.width}x${sample.viewport.height}`
  )), [
    "combined-horizontal@1280x720",
    "combined-horizontal@1600x1000",
    "combined-horizontal@800x900",
    "combined-vertical@1280x720",
    "combined-hazards@1280x720"
  ]);
  for (const sample of audit.additionalFormalLevels.samples) {
    assert.ok(sample.metrics.measuredDurationMs >= 9_000);
    assert.ok(sample.metrics.averageFps >= 30);
    assert.equal(sample.before.levelId, sample.levelId);
    assert.equal(sample.after.levelId, sample.levelId);
    assert.equal(sample.after.visualStats.error, 0);
  }

  assert.equal(audit.heaviestReferenceRooms.samples.length, 4);
  assert.deepEqual(audit.heaviestReferenceRooms.samples.map((sample) => (
    `${sample.selection.id}@${sample.viewport.width}x${sample.viewport.height}`
  )), [
    "celeste.temple.a.d-01@1280x720",
    "ori.mount-horu.central-shaft@1280x720",
    "ori.mount-horu.central-shaft@1600x1000",
    "ori.mount-horu.central-shaft@800x900"
  ]);
  for (const sample of audit.heaviestReferenceRooms.samples) {
    assert.equal(sample.before.levelId, sample.selection.id);
    assert.equal(sample.after.levelId, sample.selection.id);
    assert.ok(sample.metrics.measuredDurationMs >= 9_000);
  }

  assert.equal(audit.switchStress.completedSwitchCount, 20);
  assert.ok(Number.isFinite(audit.switchStress.heap.retainedJsHeapDeltaBytes));
  assert.equal(audit.switchStress.visualRuntime.error, 0);
  assert.equal(audit.switchStress.visualRuntime.loading, 0);
  assert.ok(audit.switchStress.textureMemoryEstimate.combinedBytes > 0);
  assert.match(audit.switchStress.textureMemoryEstimate.method, /estimate, not measured GPU memory/i);
  assert.equal(audit.environment.gpuMemoryMeasurement.available, false);

  const low = audit.lowPerformanceDegradation;
  assert.equal(low.controlledHardwareConcurrency, 4);
  assert.equal(low.cpuThrottlingRate, 4);
  assert.equal(low.sample.after.visualStats.qualityTier, "low");
  assert.equal(low.lowProfile.tier, "low");
  assert.ok(low.lowProfile.maxSceneDraws < low.highOrAutoProfile.maxSceneDraws);
  assert.ok(low.sample.movement.cameraRangeX >= 20);

  assert.deepEqual(audit.referenceContentFingerprint, fingerprint);
  assert.deepEqual(referenceAudit.contentFingerprint, fingerprint);
  assert.equal(referenceAudit.samples.length, 4);
  assert.equal(referenceAudit.freshConsoleErrorsOrWarnings, 0);
});
