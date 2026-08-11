import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("reference graph audit covers every manifest edge and every collection is connected", async () => {
  const audit = JSON.parse(await readFile(new URL("../levels/reference/graph-audit.json", import.meta.url), "utf8"));
  assert.equal(audit.totals.rooms, 908);
  assert.equal(audit.totals.authoredManifestConnections, audit.totals.manifestConnections);
  assert.equal(audit.totals.missingManifestConnections, 0);
  assert.equal(audit.totals.invalidExitTargets, 0);
  assert.equal(audit.totals.weaklyConnectedCollections, audit.totals.collections);
  assert.equal(audit.totals.strongFromFirstCollections, audit.totals.collections);
});
