import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../levels/reference/manifest.json", import.meta.url), "utf8"));

test("reference manifest exposes the complete tracked scope with unique ids", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.entries.length, manifest.totals.allRequiredEntries);
  assert.equal(new Set(manifest.entries.map((entry) => entry.id)).size, manifest.entries.length);
  assert.equal(manifest.totals.celeste.chapters, 11);
  assert.equal(manifest.totals.celeste.sideSets, 27);
  assert.equal(manifest.totals.celeste.rooms, 804);
  assert.equal(manifest.totals.ori.areas, 17);
  assert.equal(manifest.totals.ori.partitions, 104);
});

test("reference manifest keeps the public source count discrepancy auditable", () => {
  assert.deepEqual(manifest.sourceCountDiscrepancies.map(({ chapterId, sideId, declared, enumerated }) => ({
    chapterId,
    sideId,
    declared,
    enumerated
  })), [{ chapterId: "summit", sideId: "b", declared: 29, enumerated: 28 }]);
});

test("every reference entry has hierarchy, sources, status and valid candidate connections", () => {
  const ids = new Set(manifest.entries.map((entry) => entry.id));
  for (const entry of manifest.entries) {
    assert.ok(entry.game, `${entry.id} must define a game`);
    assert.ok(entry.sourceVersion, `${entry.id} must define a source version`);
    assert.ok(entry.hierarchy && Object.keys(entry.hierarchy).length > 0, `${entry.id} must define hierarchy`);
    assert.ok(entry.localName, `${entry.id} must define an original local name`);
    assert.ok(entry.mapType, `${entry.id} must define a map type`);
    assert.ok(entry.sourceRefs.length > 0, `${entry.id} must cite at least one source`);
    assert.ok(Array.isArray(entry.unknownDifferences) && entry.unknownDifferences.length > 0, `${entry.id} must track unknown differences`);
    assert.deepEqual(Object.keys(entry.status).sort(), [
      "automation", "browser", "continuousRun", "load", "playable", "validation", "whitebox"
    ]);
    for (const connection of entry.connections) {
      assert.ok(ids.has(connection.target), `${entry.id} references missing connection ${connection.target}`);
      assert.ok(connection.evidence, `${entry.id} connection ${connection.target} must record evidence`);
      assert.ok(connection.confidence, `${entry.id} connection ${connection.target} must record confidence`);
    }
    if (entry.dataFile === null) {
      assert.equal(entry.status.whitebox, "not-started", `${entry.id} may omit a file only before whitebox authoring`);
    }
  }
});
