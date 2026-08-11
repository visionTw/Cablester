function clone(value) {
  return structuredClone(value);
}

export function createDashRefillState(definition) {
  return {
    ...clone(definition),
    available: true,
    cooldown: 0,
    inside: false,
    consumed: false,
    pulse: 0
  };
}

export function updateDashRefillState(previousState, deltaTime) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new Error("Dash refill deltaTime must be zero or positive");
  const state = clone(previousState);
  state.pulse += deltaTime;
  if (!state.available && !state.oneUse) {
    state.cooldown = Math.max(0, state.cooldown - deltaTime);
    if (state.cooldown <= 0.000001) {
      state.cooldown = 0;
      state.available = true;
      state.consumed = false;
    }
  }
  return state;
}

export function leaveDashRefill(previousState) {
  return { ...clone(previousState), inside: false };
}

export function tryCollectDashRefill(previousState, { dashCharges, maximumDashCharges }) {
  const state = clone(previousState);
  if (state.inside || !state.available || dashCharges >= maximumDashCharges) {
    state.inside = true;
    return { state, collected: false, dashCharges };
  }
  const nextCharges = state.restoreMode === "add"
    ? Math.min(maximumDashCharges, dashCharges + state.charges)
    : maximumDashCharges;
  state.inside = true;
  state.available = false;
  state.consumed = true;
  state.cooldown = state.oneUse ? 0 : state.respawnSeconds;
  return { state, collected: true, dashCharges: nextCharges };
}

export function resetDashRefillState(previousState, reason = "death") {
  if (reason === "death" && !previousState.resetOnDeath) {
    return { ...clone(previousState), inside: false };
  }
  return createDashRefillState(previousState);
}
