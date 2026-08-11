import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRightwardReferenceAutoplayInput,
  clearReferenceAutoplayInput,
  REFERENCE_AUTOPLAY_CONTROLLED_KEYS
} from "../src/reference-autoplay.js";

function inputState() {
  return { keys: new Set(), keyPresses: new Set(), keyReleases: new Set() };
}

test("reference autoplay holds right and jumps after movement stalls", () => {
  const input = inputState();
  applyRightwardReferenceAutoplayInput(input, {
    grounded: true,
    wallNormal: null,
    damageRecoveryJump: false,
    gliding: false,
    liquid: null,
    vy: 0,
    dashCharges: 1,
    dashTimer: 0
  }, 1, { stagnantSteps: 30 });
  assert.equal(input.keys.has("KeyD"), true);
  assert.equal(input.keys.has("ShiftRight"), true);
  assert.equal(input.keyPresses.has("Space"), true);
  assert.equal(input.keyPresses.has("ControlRight"), false);
});

test("reference autoplay cruises across a clear safe baseline without needless jumps", () => {
  const input = inputState();
  applyRightwardReferenceAutoplayInput(input, {
    grounded: true,
    wallNormal: null,
    damageRecoveryJump: false,
    gliding: false,
    liquid: null,
    vy: 0,
    dashCharges: 1,
    dashTimer: 0
  }, 12, { stagnantSteps: 0 });
  assert.equal(input.keys.has("KeyD"), true);
  assert.equal(input.keyPresses.has("Space"), false);
  assert.equal(input.keyPresses.has("ControlRight"), false);
});

test("reference autoplay uses an upward right dash while falling or swimming", () => {
  const input = inputState();
  applyRightwardReferenceAutoplayInput(input, {
    grounded: false,
    wallNormal: null,
    damageRecoveryJump: false,
    gliding: false,
    liquid: { id: "water" },
    vy: 420,
    dashCharges: 1,
    dashTimer: 0
  }, 19);
  assert.equal(input.keys.has("KeyW"), true);
  assert.equal(input.keyPresses.has("ControlRight"), true);
});

test("clearing reference autoplay removes only controlled keys", () => {
  const input = inputState();
  for (const code of REFERENCE_AUTOPLAY_CONTROLLED_KEYS) {
    input.keys.add(code);
    input.keyPresses.add(code);
    input.keyReleases.add(code);
  }
  input.keys.add("KeyQ");
  clearReferenceAutoplayInput(input);
  assert.equal(input.keys.has("KeyQ"), true);
  for (const code of REFERENCE_AUTOPLAY_CONTROLLED_KEYS) {
    assert.equal(input.keys.has(code), false);
    assert.equal(input.keyPresses.has(code), false);
    assert.equal(input.keyReleases.has(code), false);
  }
});
