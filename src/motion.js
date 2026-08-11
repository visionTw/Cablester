const LOOP_MODES = new Set(["loop", "pingpong", "once"]);
const EASINGS = new Set(["linear", "smoothstep", "ease-in-out"]);
const TRIGGERS = new Set(["auto", "touch", "switch"]);
const OFFSCREEN_POLICIES = new Set(["simulate", "pause", "reset"]);
const RESET_POLICIES = new Set(["death", "room", "persistent"]);

function clone(value) {
  return structuredClone(value);
}

export function parseMotionPath(value) {
  if (Array.isArray(value)) {
    return value.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  }
  return String(value || "")
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [x, y, ...rest] = pair.split(",").map((part) => part.trim());
      if (rest.length > 0 || x === "" || y === "") return { x: Number.NaN, y: Number.NaN };
      return { x: Number(x), y: Number(y) };
    });
}

export function formatMotionPath(points) {
  return points.map((point) => `${point.x},${point.y}`).join(";");
}

export function validateMotionDefinition(definition) {
  const errors = [];
  if (!definition?.id) errors.push("Moving object must define an id");
  if (!Array.isArray(definition?.path) || definition.path.length < 2) {
    errors.push(`${definition?.id || "movingObject"} path must contain at least two points`);
  } else if (definition.path.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    errors.push(`${definition.id} path points must be finite`);
  } else if (definition.path.some((point, index) => index > 0 && point.x === definition.path[index - 1].x && point.y === definition.path[index - 1].y)) {
    errors.push(`${definition.id} path cannot contain consecutive duplicate points`);
  }
  if (!Number.isFinite(definition?.speed) || definition.speed <= 0) errors.push(`${definition?.id || "movingObject"} speed must be positive`);
  if (!Number.isFinite(definition?.acceleration) || definition.acceleration < 0) errors.push(`${definition?.id || "movingObject"} acceleration must be zero or positive`);
  if (!Number.isFinite(definition?.dwellSeconds) || definition.dwellSeconds < 0) errors.push(`${definition?.id || "movingObject"} dwellSeconds must be zero or positive`);
  if (!LOOP_MODES.has(definition?.loopMode)) errors.push(`${definition?.id || "movingObject"} has unsupported loopMode`);
  if (!EASINGS.has(definition?.easing)) errors.push(`${definition?.id || "movingObject"} has unsupported easing`);
  if (!TRIGGERS.has(definition?.trigger)) errors.push(`${definition?.id || "movingObject"} has unsupported trigger`);
  if (!OFFSCREEN_POLICIES.has(definition?.offscreenPolicy)) errors.push(`${definition?.id || "movingObject"} has unsupported offscreenPolicy`);
  if (!RESET_POLICIES.has(definition?.resetPolicy)) errors.push(`${definition?.id || "movingObject"} has unsupported resetPolicy`);
  return errors;
}

function ease(amount, easing) {
  const value = Math.max(0, Math.min(1, amount));
  if (easing === "smoothstep") return value * value * (3 - 2 * value);
  if (easing === "ease-in-out") {
    return value < 0.5
      ? 4 * value * value * value
      : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }
  return value;
}

function positionAlongSegment(state) {
  const from = state.path[state.currentIndex];
  const to = state.path[state.nextIndex];
  const amount = ease(state.segmentProgress, state.easing);
  state.x = from.x + (to.x - from.x) * amount;
  state.y = from.y + (to.y - from.y) * amount;
}

function advanceNode(state) {
  state.currentIndex = state.nextIndex;
  state.segmentProgress = 0;
  state.x = state.path[state.currentIndex].x;
  state.y = state.path[state.currentIndex].y;
  state.dwellRemaining = state.dwellSeconds;
  if (state.loopMode === "loop") {
    state.nextIndex = (state.currentIndex + 1) % state.path.length;
    return;
  }
  if (state.loopMode === "pingpong") {
    if (state.currentIndex === state.path.length - 1) state.direction = -1;
    if (state.currentIndex === 0) state.direction = 1;
    state.nextIndex = state.currentIndex + state.direction;
    return;
  }
  if (state.currentIndex === state.path.length - 1) {
    state.complete = true;
    state.nextIndex = state.currentIndex;
  } else {
    state.nextIndex = state.currentIndex + 1;
  }
}

export function createMotionState(definition) {
  const errors = validateMotionDefinition(definition);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const state = clone(definition);
  state.path = clone(definition.path);
  state.currentIndex = 0;
  state.nextIndex = 1;
  state.direction = 1;
  state.segmentProgress = 0;
  state.currentSpeed = definition.acceleration > 0 ? 0 : definition.speed;
  state.dwellRemaining = 0;
  state.active = definition.trigger === "auto";
  state.complete = false;
  state.x = state.path[0].x;
  state.y = state.path[0].y;
  state.previousX = state.x;
  state.previousY = state.y;
  state.deltaX = 0;
  state.deltaY = 0;
  state.velocityX = 0;
  state.velocityY = 0;
  return state;
}

export function resetMotionState(state) {
  return createMotionState(state);
}

export function advanceMotionState(previousState, deltaTime, { triggered = false, offscreen = false } = {}) {
  if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new Error("Motion deltaTime must be zero or positive");
  if (offscreen && previousState.offscreenPolicy === "reset") return resetMotionState(previousState);
  const state = clone(previousState);
  state.previousX = previousState.x;
  state.previousY = previousState.y;
  state.deltaX = 0;
  state.deltaY = 0;
  state.velocityX = 0;
  state.velocityY = 0;
  if (offscreen && state.offscreenPolicy === "pause") return state;
  if (!state.active && (state.trigger === "auto" || triggered)) state.active = true;
  if (!state.active || state.complete || deltaTime === 0) return state;

  let remaining = deltaTime;
  let iterations = 0;
  while (remaining > 0.0000001 && !state.complete && iterations < 64) {
    iterations += 1;
    if (state.dwellRemaining > 0) {
      const spent = Math.min(remaining, state.dwellRemaining);
      state.dwellRemaining -= spent;
      remaining -= spent;
      if (remaining <= 0.0000001) break;
    }
    const from = state.path[state.currentIndex];
    const to = state.path[state.nextIndex];
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength <= 0.000001) {
      advanceNode(state);
      continue;
    }
    state.currentSpeed = state.acceleration > 0
      ? Math.min(state.speed, state.currentSpeed + state.acceleration * remaining)
      : state.speed;
    const distance = Math.max(0.000001, state.currentSpeed * remaining);
    const progressRemaining = 1 - state.segmentProgress;
    const progressDelta = distance / segmentLength;
    if (progressDelta + 0.0000001 < progressRemaining) {
      state.segmentProgress += progressDelta;
      positionAlongSegment(state);
      remaining = 0;
    } else {
      const usedRatio = Math.min(1, progressRemaining / progressDelta);
      remaining *= 1 - usedRatio;
      state.segmentProgress = 1;
      positionAlongSegment(state);
      advanceNode(state);
    }
  }
  state.deltaX = state.x - previousState.x;
  state.deltaY = state.y - previousState.y;
  state.velocityX = deltaTime > 0 ? state.deltaX / deltaTime : 0;
  state.velocityY = deltaTime > 0 ? state.deltaY / deltaTime : 0;
  return state;
}

export function isPlayerStandingOnMovingPlatform(player, platform, tolerance = 7) {
  return platform.objectKind === "platform"
    && Boolean(player.grounded)
    && player.x + player.radius > platform.x
    && player.x - player.radius < platform.x + platform.w
    && Math.abs(player.y + player.radius - platform.y) <= tolerance;
}

function sweptPointAgainstExpandedRect(start, end, rect, radius) {
  const minX = -radius;
  const maxX = rect.w + radius;
  const minY = -radius;
  const maxY = rect.h + radius;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  let entry = 0;
  let exit = 1;
  let normal = { x: 0, y: 0 };
  for (const axis of [
    { start: start.x, delta: deltaX, min: minX, max: maxX, nearNormal: deltaX > 0 ? { x: -1, y: 0 } : { x: 1, y: 0 } },
    { start: start.y, delta: deltaY, min: minY, max: maxY, nearNormal: deltaY > 0 ? { x: 0, y: -1 } : { x: 0, y: 1 } }
  ]) {
    if (Math.abs(axis.delta) < 0.0000001) {
      if (axis.start < axis.min || axis.start > axis.max) return null;
      continue;
    }
    const first = (axis.min - axis.start) / axis.delta;
    const second = (axis.max - axis.start) / axis.delta;
    const near = Math.min(first, second);
    const far = Math.max(first, second);
    if (near > entry) {
      entry = near;
      normal = axis.nearNormal;
    }
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  if (entry < 0 || entry > 1) return null;
  return {
    amount: entry,
    normal,
    relativeX: start.x + deltaX * entry,
    relativeY: start.y + deltaY * entry
  };
}

export function movingRectSweepContact(player, movingRect) {
  if (!Number.isFinite(movingRect.previousX) || !Number.isFinite(movingRect.previousY)) return null;
  const start = {
    x: player.previousX - movingRect.previousX,
    y: player.previousY - movingRect.previousY
  };
  const end = {
    x: player.x - movingRect.x,
    y: player.y - movingRect.y
  };
  return sweptPointAgainstExpandedRect(start, end, movingRect, player.radius);
}

export function resolvePlayerAgainstMovingRect(player, movingRect) {
  const contact = movingRectSweepContact(player, movingRect);
  if (!contact || (contact.normal.x === 0 && contact.normal.y === 0)) return null;
  const platformVelocityX = movingRect.velocityX || 0;
  const platformVelocityY = movingRect.velocityY || 0;
  let vx = player.vx;
  let vy = player.vy;
  const intoSurface = (vx - platformVelocityX) * contact.normal.x + (vy - platformVelocityY) * contact.normal.y;
  if (intoSurface < 0) {
    vx -= contact.normal.x * intoSurface;
    vy -= contact.normal.y * intoSurface;
  }
  return {
    x: movingRect.x + contact.relativeX + contact.normal.x * 0.01,
    y: movingRect.y + contact.relativeY + contact.normal.y * 0.01,
    vx,
    vy,
    normal: contact.normal,
    amount: contact.amount
  };
}
