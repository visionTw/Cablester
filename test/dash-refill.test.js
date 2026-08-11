import test from "node:test";
import assert from "node:assert/strict";
import {
  createDashRefillState,
  leaveDashRefill,
  resetDashRefillState,
  tryCollectDashRefill,
  updateDashRefillState
} from "../src/dash-refill.js";

const definition = {
  id: "refill-a",
  x: 100,
  y: 100,
  radius: 20,
  charges: 1,
  restoreMode: "fill",
  oneUse: false,
  respawnSeconds: 2,
  resetOnDeath: true
};

test("dash refill debounces contact and restores the configured capacity", () => {
  let state = createDashRefillState(definition);
  const full = tryCollectDashRefill(state, { dashCharges: 2, maximumDashCharges: 2 });
  assert.equal(full.collected, false);
  assert.equal(full.state.available, true);
  state = leaveDashRefill(full.state);
  const collected = tryCollectDashRefill(state, { dashCharges: 0, maximumDashCharges: 2 });
  assert.equal(collected.collected, true);
  assert.equal(collected.dashCharges, 2);
  assert.equal(collected.state.available, false);
  const heldContact = tryCollectDashRefill(collected.state, { dashCharges: 0, maximumDashCharges: 2 });
  assert.equal(heldContact.collected, false);
});

test("repeatable dash refill respawns while one-use state waits for reset", () => {
  let repeatable = tryCollectDashRefill(createDashRefillState(definition), { dashCharges: 0, maximumDashCharges: 1 }).state;
  repeatable = updateDashRefillState(repeatable, 1.9);
  assert.equal(repeatable.available, false);
  repeatable = updateDashRefillState(repeatable, 0.1);
  assert.equal(repeatable.available, true);

  const oneUseDefinition = { ...definition, oneUse: true };
  let oneUse = tryCollectDashRefill(createDashRefillState(oneUseDefinition), { dashCharges: 0, maximumDashCharges: 1 }).state;
  oneUse = updateDashRefillState(oneUse, 30);
  assert.equal(oneUse.available, false);
  oneUse = resetDashRefillState(oneUse, "death");
  assert.equal(oneUse.available, true);
});

test("persistent one-use dash refill survives death when configured", () => {
  const persistent = { ...definition, oneUse: true, resetOnDeath: false };
  const collected = tryCollectDashRefill(createDashRefillState(persistent), { dashCharges: 0, maximumDashCharges: 1 }).state;
  const reset = resetDashRefillState(collected, "death");
  assert.equal(reset.available, false);
  assert.equal(reset.consumed, true);
  assert.equal(reset.inside, false);
});

