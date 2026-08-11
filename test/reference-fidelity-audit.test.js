import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fidelity audit closes engineering gaps while keeping human confirmation separate", async () => {
  const audit = JSON.parse(await readFile(new URL("../levels/reference/fidelity-audit.json", import.meta.url), "utf8"));
  assert.equal(audit.totals.entries, 908);
  assert.equal(audit.totals.mappedMechanismUses, audit.totals.mechanismUses);
  assert.equal(audit.unmappedMechanisms.length, 0);
  assert.equal(audit.totals.mappedObjectPresent, audit.totals.mechanismUses);
  assert.equal(audit.missingMappedObjects.length, 0);
  assert.equal(audit.totals.validated, 908);
  assert.equal(audit.totals.continuousRunPassed, 908);
});
