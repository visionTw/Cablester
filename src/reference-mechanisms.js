const clampTimer = (value) => Math.max(0, value);

export function applyLiquidForces(velocity, zone, deltaTime, input = { x: 0, y: 0 }) {
  const dragFactor = Math.exp(-zone.drag * deltaTime);
  return {
    vx: velocity.vx * dragFactor + (zone.currentX + input.x * zone.swimAcceleration) * deltaTime,
    vy: velocity.vy * dragFactor + (zone.currentY + input.y * zone.swimAcceleration) * deltaTime
  };
}

export function createLauncherState(definition) {
  return {
    ...definition,
    cooldownTimer: 0,
    touching: false
  };
}

export function updateLauncherState(state, deltaTime) {
  return { ...state, cooldownTimer: clampTimer(state.cooldownTimer - deltaTime) };
}

export function leaveLauncher(state) {
  return state.touching ? { ...state, touching: false } : state;
}

export function tryActivateLauncher(state, touching, velocity = { vx: 0, vy: 0 }) {
  if (!touching) return { state: leaveLauncher(state), activated: false, velocity };
  if (state.touching || state.cooldownTimer > 0) return { state: { ...state, touching: true }, activated: false, velocity };
  return {
    state: { ...state, touching: true, cooldownTimer: state.cooldownSeconds },
    activated: true,
    velocity: {
      vx: state.preserveMomentum ? velocity.vx + state.launchX : state.launchX,
      vy: state.preserveMomentum ? velocity.vy + state.launchY : state.launchY
    }
  };
}

export function createFragilePlatformState(definition) {
  return {
    ...definition,
    phase: "solid",
    timer: 0,
    offsetY: 0,
    velocityY: 0
  };
}

export function touchFragilePlatform(state) {
  if (state.phase !== "solid") return state;
  return { ...state, phase: "cracking", timer: state.breakDelaySeconds };
}

export function updateFragilePlatformState(state, deltaTime) {
  if (state.phase === "solid") return state;
  if (state.phase === "cracking") {
    const timer = state.timer - deltaTime;
    if (timer > 0) return { ...state, timer };
    return { ...state, phase: "gone", timer: state.oneUse ? Infinity : state.respawnSeconds, velocityY: state.fallSpeed };
  }
  if (state.phase === "gone") {
    const timer = state.timer - deltaTime;
    const velocityY = state.velocityY + 1100 * deltaTime;
    const offsetY = state.offsetY + velocityY * deltaTime;
    if (timer > 0) return { ...state, timer, velocityY, offsetY };
    return { ...state, phase: "solid", timer: 0, velocityY: 0, offsetY: 0 };
  }
  return state;
}

export function resetFragilePlatformState(state, reason = "death") {
  if (reason === "death" && !state.resetOnDeath) return state;
  return { ...state, phase: "solid", timer: 0, offsetY: 0, velocityY: 0 };
}

export function createGateState(definition) {
  return { ...definition, latchedOpen: Boolean(definition.initiallyOpen) };
}

export function evaluateGateState(state, abilities, flags) {
  if (state.initiallyOpen || state.latchedOpen) return { ...state, open: true };
  const checks = [];
  if (state.requiredAbility) checks.push(abilities.has(state.requiredAbility));
  if (state.requiredFlag) checks.push(flags.has(state.requiredFlag));
  const unlocked = checks.length > 0 && (state.openWhen === "all" ? checks.every(Boolean) : checks.some(Boolean));
  return {
    ...state,
    open: unlocked,
    latchedOpen: state.latchOpen ? state.latchedOpen || unlocked : state.latchedOpen
  };
}

export function resetGateState(state, reason = "death") {
  if (reason === "death" && !state.resetOnDeath) return state;
  return { ...state, latchedOpen: Boolean(state.initiallyOpen), open: Boolean(state.initiallyOpen) };
}

export function createStateTriggerState(definition) {
  return { ...definition, used: false, touching: false };
}

export function activateStateTrigger(state, touching, flags) {
  if (!touching) return { state: state.touching ? { ...state, touching: false } : state, changed: false };
  if (state.touching || (state.oneUse && state.used)) return { state: { ...state, touching: true }, changed: false };
  if (state.setFlag) flags.add(state.setFlag);
  if (state.clearFlag) flags.delete(state.clearFlag);
  return { state: { ...state, touching: true, used: true }, changed: true };
}

export function resetStateTrigger(state, reason = "death") {
  if (reason === "death" && !state.resetOnDeath) return state;
  return { ...state, used: false, touching: false };
}
