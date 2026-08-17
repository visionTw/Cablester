import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPECTED_REFERENCE_TOTALS,
  buildEvidenceDocuments,
  parseArguments,
  validateAuditResults,
  writeEvidenceDocuments
} from "../scripts/audit-reference-browser.mjs";

function passingRun() {
  const collections = Array.from({ length: EXPECTED_REFERENCE_TOTALS.collections }, (_, index) => ({
    collectionId: `collection-${index}`,
    transitions: index < 28 ? 20 : 19,
    deaths: 0,
    passed: true
  }));
  return {
    index: {
      roomCount: 908,
      collectionCount: 44,
      collectionRoomCount: 908,
      uniqueCollectionRoomCount: 908,
      sequentialTransitions: 864,
      manifestConnections: 3678
    },
    load: {
      running: false,
      completed: 908,
      total: 908,
      entrances: 2326,
      failures: [],
      elapsedMs: 7_640
    },
    acceptance: {
      running: false,
      completed: 908,
      total: 908,
      entranceChecks: 2326,
      checkpointResetChecks: 908,
      connectionChecks: 3668,
      mechanismCycles: 908,
      menuReentries: 908,
      renderedRooms: 908,
      peakActiveObjects: 53,
      finalCachedDocuments: 0,
      failures: [],
      elapsedMs: 9_540
    },
    continuous: {
      running: false,
      collectionsCompleted: 44,
      totalCollections: 44,
      transitionsCompleted: 864,
      totalTransitions: 864,
      deaths: 0,
      failures: [],
      collections,
      elapsedMs: 18_340
    },
    diagnostics: {
      exceptions: [],
      consoleErrors: [],
      consoleWarnings: [],
      logErrors: [],
      logWarnings: [],
      ignored: []
    }
  };
}

test("CLI exposes isolated output and no-write dry-run modes", () => {
  const options = parseArguments([
    "--url", "http://127.0.0.1:4999/",
    "--output-dir", "tmp/reference-evidence",
    "--timeout-ms", "120000",
    "--dry-run"
  ], { root: "/fixture/project" });
  assert.equal(options.url, "http://127.0.0.1:4999/");
  assert.equal(options.outputDir, "/fixture/project/tmp/reference-evidence");
  assert.equal(options.timeoutMs, 120000);
  assert.equal(options.dryRun, true);
  assert.throws(() => parseArguments(["--url", "https://example.com/"]), /loopback/);
});

test("strict gates require every frozen reference-library total and zero fresh diagnostics", () => {
  const run = passingRun();
  const fingerprint = { algorithm: "sha256", value: "current", fileCount: 944, roomFileCount: 908, runtimeFileCount: 36 };
  assert.deepEqual(validateAuditResults({ ...run, fingerprints: { before: fingerprint, after: { ...fingerprint } } }), []);

  run.acceptance.connectionChecks = 3667;
  run.continuous.failures.push({ collectionId: "broken" });
  run.diagnostics.consoleWarnings.push({ type: "warning", values: ["fresh"] });
  const changedFingerprint = { ...fingerprint, value: "changed", roomFileCount: 907 };
  assert.deepEqual(
    validateAuditResults({ ...run, fingerprints: { before: fingerprint, after: changedFingerprint } }).map((failure) => failure.code),
    [
      "acceptance.exits",
      "continuous.failures",
      "diagnostics.errorsOrWarnings",
      "contentFingerprint.stable",
      "contentFingerprint.roomFileCount"
    ]
  );
});

test("compatible evidence is formatted as 2-space JSON plus LF and atomically renamed", async () => {
  const run = passingRun();
  const fingerprint = { algorithm: "sha256", value: "abc", fileCount: 944, roomFileCount: 908, runtimeFileCount: 36 };
  const documents = buildEvidenceDocuments({
    ...run,
    contentFingerprint: fingerprint,
    environment: {
      device: "test",
      processor: "test",
      memory: "1 GB",
      operatingSystem: "test",
      timeZone: "Asia/Shanghai",
      viewport: "1280x720"
    },
    ranAt: "2026-08-13T01:02:03+08:00"
  });
  assert.equal(documents.load.result.passed, 908);
  assert.equal(documents.load.result.entrancesInitialized, 2326);
  assert.equal(documents.acceptance.result.checkpointResetChecks, 908);
  assert.equal(documents.acceptance.result.connectionChecks, 3668);
  assert.equal(documents.continuous.result.passedCollections, 44);
  assert.equal(documents.continuous.result.visitedRooms, 908);
  assert.equal(documents.continuous.result.transitionsCompleted, 864);
  assert.deepEqual(documents.continuous.contentFingerprint, fingerprint);

  const outputDir = await mkdtemp(join(tmpdir(), "cablester-reference-audit-test-"));
  try {
    await writeEvidenceDocuments(outputDir, documents);
    const files = (await readdir(outputDir)).sort();
    assert.deepEqual(files, ["browser-acceptance-audit.json", "browser-load-audit.json", "continuous-run-audit.json"]);
    const serialized = await readFile(join(outputDir, "browser-load-audit.json"), "utf8");
    assert.ok(serialized.endsWith("\n"));
    assert.ok(!serialized.endsWith("\n\n"));
    assert.match(serialized, /\n  "schemaVersion": 1,/);
    assert.deepEqual(JSON.parse(serialized), documents.load);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("script statically controls the production APIs through direct CDP", async () => {
  const source = await readFile(new URL("../scripts/audit-reference-browser.mjs", import.meta.url), "utf8");
  for (const required of [
    "--headless=new",
    "DevToolsActivePort",
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
    "runLoadAudit",
    "runAcceptanceAudit",
    "runContinuousAudit",
    "running=false",
    "referenceLibraryFingerprint",
    "rename(item.temporary, item.target)"
  ]) assert.ok(source.includes(required), `missing ${required}`);
});
