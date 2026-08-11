import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLiquidForces,
  activateStateTrigger,
  createFragilePlatformState,
  createGateState,
  createLauncherState,
  createStateTriggerState,
  evaluateGateState,
  resetFragilePlatformState,
  tryActivateLauncher,
  touchFragilePlatform,
  updateFragilePlatformState,
  updateLauncherState
} from "../src/reference-mechanisms.js";

test("liquid forces apply deterministic drag, current and swim input", () => {
  const velocity = applyLiquidForces(
    { vx: 400, vy: 200 },
    { drag: 2, currentX: 80, currentY: -40, swimAcceleration: 600 },
    0.1,
    { x: 1, y: -1 }
  );
  assert.ok(velocity.vx > 300 && velocity.vx < 400);
  assert.ok(velocity.vy < 100);
  assert.deepEqual(velocity, applyLiquidForces({ vx: 400, vy: 200 }, { drag: 2, currentX: 80, currentY: -40, swimAcceleration: 600 }, 0.1, { x: 1, y: -1 }));
});

test("launcher applies configured velocity once per contact and respects cooldown", () => {
  let state = createLauncherState({ launchX: 140, launchY: -820, cooldownSeconds: 0.4, preserveMomentum: false });
  let result = tryActivateLauncher(state, true, { vx: 30, vy: 90 });
  assert.equal(result.activated, true);
  assert.deepEqual(result.velocity, { vx: 140, vy: -820 });
  state = result.state;
  assert.equal(tryActivateLauncher(state, true).activated, false);
  state = updateLauncherState({ ...state, touching: false }, 0.5);
  assert.equal(tryActivateLauncher(state, true).activated, true);
});

test("fragile platform cracks, disappears, respawns and resets deterministically", () => {
  let state = createFragilePlatformState({ breakDelaySeconds: 0.2, respawnSeconds: 0.5, fallSpeed: 80, oneUse: false, resetOnDeath: true });
  state = touchFragilePlatform(state);
  assert.equal(state.phase, "cracking");
  state = updateFragilePlatformState(state, 0.2);
  assert.equal(state.phase, "gone");
  state = updateFragilePlatformState(state, 0.5);
  assert.equal(state.phase, "solid");
  assert.equal(resetFragilePlatformState(touchFragilePlatform(state)).phase, "solid");
});

test("state trigger updates flags and a latched gate stays open", () => {
  const flags = new Set();
  let trigger = createStateTriggerState({ setFlag: "route-open", clearFlag: "", oneUse: true, resetOnDeath: false });
  const activation = activateStateTrigger(trigger, true, flags);
  trigger = activation.state;
  assert.equal(activation.changed, true);
  assert.equal(flags.has("route-open"), true);
  assert.equal(activateStateTrigger(trigger, true, flags).changed, false);
  let gate = createGateState({ requiredAbility: "", requiredFlag: "route-open", openWhen: "any", latchOpen: true, initiallyOpen: false, resetOnDeath: false });
  gate = evaluateGateState(gate, new Set(), flags);
  assert.equal(gate.open, true);
  flags.clear();
  assert.equal(evaluateGateState(gate, new Set(), flags).open, true);
});
