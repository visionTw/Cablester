const EPSILON = 0.000001;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function flagPresent(flags, flag) {
  if (!flag) return false;
  if (flags instanceof Set) return flags.has(flag);
  if (Array.isArray(flags)) return flags.includes(flag);
  return Boolean(flags?.[flag]);
}

export function resolveWindCue(forceX, forceY) {
  const x = finiteNumber(forceX);
  const y = finiteNumber(forceY);
  const strength = Math.hypot(x, y);
  if (strength <= EPSILON) {
    return { forceX: x, forceY: y, x: 0, y: 0, strength: 0, direction: "calm", calm: true };
  }
  const unitX = x / strength;
  const unitY = y / strength;
  let direction = "vector";
  if (Math.abs(unitX) >= 0.999) direction = unitX < 0 ? "left" : "right";
  else if (Math.abs(unitY) >= 0.999) direction = unitY < 0 ? "up" : "down";
  return { forceX: x, forceY: y, x: unitX, y: unitY, strength, direction, calm: false };
}

export function createWindCueState() {
  return { state: "idle", inside: false, exitTimer: 0 };
}

export function updateWindCueState(cue, inside, deltaTime, exitDuration = 0.32) {
  const wasInside = Boolean(cue.inside);
  cue.inside = Boolean(inside);
  if (cue.inside) {
    cue.exitTimer = 0;
    cue.state = "inside";
  } else {
    if (wasInside) cue.exitTimer = Math.max(0, finiteNumber(exitDuration, 0.32));
    cue.exitTimer = Math.max(0, cue.exitTimer - Math.max(0, finiteNumber(deltaTime)));
    cue.state = cue.exitTimer > 0 ? "exiting" : "idle";
  }
  return cue;
}

export function createGlideCueState() {
  return {
    state: "locked",
    blend: 0,
    facing: 1,
    gravity: { x: 0, y: 1 },
    reducedMotion: false
  };
}

export function updateGlideCueState(cue, runtime, deltaTime) {
  const unlocked = Boolean(runtime?.unlocked);
  const grounded = Boolean(runtime?.grounded);
  const gliding = Boolean(runtime?.gliding);
  const delta = Math.max(0, finiteNumber(deltaTime));
  const gravityLength = Math.hypot(finiteNumber(runtime?.gravity?.x), finiteNumber(runtime?.gravity?.y, 1));
  cue.facing = finiteNumber(runtime?.facing, 1) < 0 ? -1 : 1;
  cue.gravity = gravityLength > EPSILON
    ? { x: finiteNumber(runtime?.gravity?.x) / gravityLength, y: finiteNumber(runtime?.gravity?.y, 1) / gravityLength }
    : { x: 0, y: 1 };
  cue.reducedMotion = Boolean(runtime?.reducedMotion);

  if (!unlocked) {
    cue.state = "locked";
    cue.blend = 0;
    return cue;
  }
  if (grounded) {
    cue.state = "ready";
    cue.blend = 0;
    return cue;
  }

  const target = gliding ? 1 : 0;
  const rate = gliding ? 12 : 9;
  cue.blend += (target - cue.blend) * (1 - Math.exp(-rate * delta));
  cue.blend = clamp(cue.blend, 0, 1);
  if (gliding) cue.state = cue.blend >= 0.98 ? "gliding" : "opening";
  else if (cue.blend > 0.01) cue.state = "closing";
  else {
    cue.blend = 0;
    cue.state = "ready";
  }
  return cue;
}

export function glideWingPose(cue, elapsed = 0) {
  const gravity = cue?.gravity || { x: 0, y: 1 };
  const tangent = { x: gravity.y, y: -gravity.x };
  const blend = clamp(finiteNumber(cue?.blend), 0, 1);
  const flutter = cue?.reducedMotion || cue?.state !== "gliding"
    ? 0
    : Math.sin(finiteNumber(elapsed) * 8) * 2.2;
  return {
    state: cue?.state || "locked",
    blend,
    span: 12 + blend * 45,
    lift: 5 + blend * 24 + flutter,
    tangent,
    gravity,
    facing: cue?.facing < 0 ? -1 : 1,
    visible: blend > 0.01
  };
}

export function createSignCueState(saved = {}) {
  return {
    state: saved.completed ? "completed" : "idle",
    activatedOnce: Boolean(saved.activatedOnce || saved.completed),
    completed: Boolean(saved.completed),
    elapsed: 0
  };
}

export function updateSignCueState(cue, properties, runtime, deltaTime) {
  cue.elapsed += Math.max(0, finiteNumber(deltaTime));
  const completionFlag = String(properties?.completionFlag || "");
  const disabled = Boolean(properties?.disabled);
  const completedByProgress = flagPresent(runtime?.flags, completionFlag);
  if (disabled) {
    cue.state = "disabled";
    return cue;
  }
  if (completedByProgress) cue.completed = true;
  if (cue.completed) {
    cue.state = "completed";
    return cue;
  }

  const distance = Math.max(0, finiteNumber(runtime?.distance, Number.POSITIVE_INFINITY));
  const activationRadius = Math.max(12, finiteNumber(properties?.activationRadius, 48));
  const nearbyRadius = Math.max(activationRadius, finiteNumber(properties?.nearbyRadius, 140));
  if (distance <= activationRadius) {
    cue.activatedOnce = true;
    cue.state = "activated";
  } else if (Boolean(properties?.oneShot) && cue.activatedOnce) {
    cue.completed = true;
    cue.state = "completed";
  } else if (distance <= nearbyRadius) {
    cue.state = "nearby";
  } else {
    cue.state = "idle";
  }
  return cue;
}

export function signCuePresentation(cue, { reducedMotion = false } = {}) {
  const state = cue?.state || "idle";
  const emphasis = { idle: 0.35, nearby: 0.72, activated: 1, completed: 0.22, disabled: 0.12 }[state] ?? 0.35;
  const pulse = reducedMotion || state === "completed" || state === "disabled"
    ? 0
    : Math.sin(finiteNumber(cue?.elapsed) * (state === "activated" ? 5.5 : 2.4));
  return {
    state,
    emphasis,
    offsetY: reducedMotion ? 0 : pulse * (state === "activated" ? 3 : 1.5),
    scale: reducedMotion ? 1 : 1 + pulse * (state === "activated" ? 0.035 : 0.012),
    interactive: state === "nearby" || state === "activated"
  };
}

