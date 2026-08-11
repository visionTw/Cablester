const CONTROLLED_KEYS = Object.freeze([
  "KeyA",
  "KeyD",
  "KeyW",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "Space"
]);

export function clearReferenceAutoplayInput(input) {
  for (const code of CONTROLLED_KEYS) {
    input.keys.delete(code);
    input.keyPresses.delete(code);
    input.keyReleases.delete(code);
  }
}

export function applyRightwardReferenceAutoplayInput(input, player, step, { stagnantSteps = 0 } = {}) {
  clearReferenceAutoplayInput(input);
  input.keys.add("KeyD");
  const blocked = stagnantSteps >= 24;
  if (blocked || player.wallNormal) input.keys.add("ShiftRight");

  const wantsJump = (blocked && player.grounded) || Boolean(player.wallNormal) || player.damageRecoveryJump;
  if (wantsJump) {
    input.keys.add("Space");
    input.keyPresses.add("Space");
  } else if (player.gliding || player.vy > 260) {
    input.keys.add("Space");
  }
  if (blocked && !player.grounded && step % 90 === 0) input.keyPresses.add("Space");

  const wantsLift = Boolean(player.liquid) || player.vy > 320;
  if (wantsLift) input.keys.add("KeyW");

  const dashReady = player.dashCharges > 0 && player.dashTimer <= 0;
  const shouldDash = dashReady
    && !player.grounded
    && (player.vy > 320 || player.liquid || (blocked && step % 75 === 0));
  if (shouldDash) {
    input.keys.add("KeyW");
    input.keys.add("ControlRight");
    input.keyPresses.add("ControlRight");
  }
}

export const REFERENCE_AUTOPLAY_CONTROLLED_KEYS = CONTROLLED_KEYS;
