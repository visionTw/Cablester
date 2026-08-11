import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "../scripts/reference-library-fingerprint.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

test("browser audit evidence is gated by a current content fingerprint", async () => {
  const [audit, loadAudit, acceptanceAudit, graphAudit, fidelityAudit, performanceAudit, manifest, fingerprint] = await Promise.all([
    readFile(new URL("../levels/reference/continuous-run-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/browser-load-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/browser-acceptance-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/graph-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/fidelity-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/performance-audit.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../levels/reference/manifest.json", import.meta.url), "utf8").then(JSON.parse),
    referenceLibraryFingerprint(projectRoot)
  ]);

  assert.equal(audit.scope.collections, 44);
  assert.equal(audit.scope.rooms, 908);
  assert.equal(audit.scope.sequentialTransitions, 864);
  assert.equal(audit.result.passedCollections, 44);
  assert.equal(audit.result.visitedRooms, 908);
  assert.equal(audit.result.transitionsCompleted, 864);
  assert.equal(audit.result.deathsOrResets, 0);
  assert.equal(audit.result.failedCollections, 0);
  assert.equal(audit.result.freshConsoleErrorsOrWarnings, 0);
  assert.equal(audit.method.teleport, false);
  assert.equal(audit.method.directStateMutation, false);
  assert.deepEqual(audit.contentFingerprint, fingerprint);
  assert.deepEqual(loadAudit.contentFingerprint, fingerprint);
  assert.equal(loadAudit.result.passed, 908);
  assert.equal(loadAudit.result.entrancesInitialized, 2326);
  assert.equal(loadAudit.result.failed, 0);
  assert.deepEqual(acceptanceAudit.contentFingerprint, fingerprint);
  assert.equal(acceptanceAudit.result.passedRooms, 908);
  assert.equal(acceptanceAudit.result.checkpointResetChecks, 908);
  assert.equal(acceptanceAudit.result.connectionChecks, 3668);
  assert.equal(acceptanceAudit.result.menuReentries, 908);
  assert.equal(acceptanceAudit.result.finalCachedDocuments, 0);
  assert.equal(acceptanceAudit.result.failedRooms, 0);
  assert.deepEqual(graphAudit.contentFingerprint, fingerprint);
  assert.equal(graphAudit.totals.missingManifestConnections, 0);
  assert.equal(graphAudit.totals.invalidExitTargets, 0);
  assert.deepEqual(fidelityAudit.contentFingerprint, fingerprint);
  assert.equal(fidelityAudit.unmappedMechanisms.length, 0);
  assert.equal(fidelityAudit.missingMappedObjects.length, 0);
  assert.deepEqual(performanceAudit.contentFingerprint, fingerprint);
  assert.equal(performanceAudit.samples.length, 4);
  assert.ok(performanceAudit.samples.every((sample) => sample.averageFps >= 60));
  assert.equal(performanceAudit.freshConsoleErrorsOrWarnings, 0);
  assert.equal(manifest.auditEvidence.continuousRun.fresh, true);
  assert.equal(manifest.auditEvidence.continuousRun.passed, true);
  assert.equal(manifest.auditEvidence.browserAcceptance.passed, true);
  assert.equal(manifest.auditEvidence.validationStatusUpgraded, true);
  assert.ok(manifest.entries.every((entry) => entry.status.continuousRun === "passed"));
  assert.ok(manifest.entries.every((entry) => entry.status.playable === "playable"));
  assert.ok(manifest.entries.every((entry) => entry.status.browser === "passed"));
  assert.ok(manifest.entries.every((entry) => entry.status.validation === "validated"));
  assert.ok(manifest.entries.every((entry) => entry.humanConfirmation === "needed"));
});
