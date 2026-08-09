import { clamp, dot, moveToward, normalize, segmentIntersection } from "./math.js";

export function spendEnergy(current, cost) {
  if (cost < 0) throw new Error("Energy cost cannot be negative");
  if (current + 0.000001 < cost) return { ok: false, value: current };
  return { ok: true, value: Math.max(0, current - cost) };
}

export function restoreResource(current, amount, maximum) {
  if (amount < 0 || maximum < 0) throw new Error("Resource values cannot be negative");
  return clamp(current + amount, 0, maximum);
}

export function takeDamage(currentHealth, amount, invulnerabilityRemaining) {
  if (amount < 0) throw new Error("Damage cannot be negative");
  if (invulnerabilityRemaining > 0) {
    return { applied: false, health: currentHealth, defeated: currentHealth <= 0 };
  }
  const health = Math.max(0, currentHealth - amount);
  return { applied: true, health, defeated: health <= 0 };
}

export function grantAbility(abilitySet, abilityId, knownAbilityIds) {
  if (!knownAbilityIds.has(abilityId)) throw new Error(`Unknown ability: ${abilityId}`);
  const alreadyOwned = abilitySet.has(abilityId);
  abilitySet.add(abilityId);
  return { granted: !alreadyOwned, abilityId };
}

export function shouldUseRopeWinch(ropeAttached, upHeld) {
  return Boolean(ropeAttached && upHeld);
}

export function shouldReleaseBash(keyReleased, remaining) {
  return Boolean(keyReleased || remaining <= 0);
}

export function limitSpeedAlongDirection(state, direction, maximumSpeed) {
  const speed = dot(state.vx, state.vy, direction.x, direction.y);
  if (speed <= maximumSpeed) return { vx: state.vx, vy: state.vy };
  const excess = speed - maximumSpeed;
  return {
    vx: state.vx - direction.x * excess,
    vy: state.vy - direction.y * excess
  };
}

export function applyWindForce(state, wind, deltaTime, multiplier = 1) {
  const scale = Math.max(0, multiplier) * Math.max(0, deltaTime);
  return {
    vx: state.vx + wind.forceX * scale,
    vy: state.vy + wind.forceY * scale
  };
}

export function applyMinimumUpdraftLift(state, gravity, minimumLiftSpeed) {
  const currentDownwardSpeed = dot(state.vx, state.vy, gravity.x, gravity.y);
  const targetDownwardSpeed = -Math.max(0, minimumLiftSpeed);
  if (currentDownwardSpeed <= targetDownwardSpeed) return { vx: state.vx, vy: state.vy };
  const correction = currentDownwardSpeed - targetDownwardSpeed;
  return {
    vx: state.vx - gravity.x * correction,
    vy: state.vy - gravity.y * correction
  };
}

export function limitUpdraftLiftSpeed(state, gravity, maximumLiftSpeed) {
  const currentDownwardSpeed = dot(state.vx, state.vy, gravity.x, gravity.y);
  const minimumDownwardSpeed = -Math.max(0, maximumLiftSpeed);
  if (currentDownwardSpeed >= minimumDownwardSpeed) return { vx: state.vx, vy: state.vy };
  const correction = minimumDownwardSpeed - currentDownwardSpeed;
  return {
    vx: state.vx + gravity.x * correction,
    vy: state.vy + gravity.y * correction
  };
}

export function decelerateUpdraftLift(state, gravity, deceleration, deltaTime) {
  const currentDownwardSpeed = dot(state.vx, state.vy, gravity.x, gravity.y);
  if (currentDownwardSpeed >= 0) return { vx: state.vx, vy: state.vy };
  const nextDownwardSpeed = moveToward(
    currentDownwardSpeed,
    0,
    Math.max(0, deceleration) * Math.max(0, deltaTime)
  );
  const correction = nextDownwardSpeed - currentDownwardSpeed;
  return {
    vx: state.vx + gravity.x * correction,
    vy: state.vy + gravity.y * correction
  };
}

export function applyRopeWinch(state, radial, deltaTime, tuning) {
  const reelSpeed = Math.min(
    tuning.maximumReelSpeed,
    Math.max(0, state.reelSpeed) + tuning.reelAcceleration * deltaTime
  );
  const length = Math.max(tuning.minimumLength, state.length - reelSpeed * deltaTime);
  const completed = !state.boostApplied && state.length > tuning.minimumLength && length <= tuning.minimumLength;
  const pullAcceleration = tuning.acceleration + reelSpeed * tuning.speedAccelerationFactor;
  const completionBoost = completed ? tuning.completionBoost : 0;
  return {
    length,
    reelSpeed,
    vx: state.vx - radial.x * (pullAcceleration * deltaTime + completionBoost),
    vy: state.vy - radial.y * (pullAcceleration * deltaTime + completionBoost),
    completed,
    boostApplied: state.boostApplied || completed
  };
}

export function advancePointTowards(point, target, speed, deltaTime) {
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const distance = Math.hypot(dx, dy);
  const travel = Math.max(0, speed) * Math.max(0, deltaTime);
  if (distance <= travel || distance < 0.000001) {
    return { x: target.x, y: target.y, reached: true };
  }
  return {
    x: point.x + dx / distance * travel,
    y: point.y + dy / distance * travel,
    reached: false
  };
}

export function computeDashVelocity(inputX, inputY, facing, screenRight, screenDown, speed) {
  const screenDirection = normalize(inputX, inputY, facing || 1, 0);
  const worldX = screenRight.x * screenDirection.x + screenDown.x * screenDirection.y;
  const worldY = screenRight.y * screenDirection.x + screenDown.y * screenDirection.y;
  const worldDirection = normalize(worldX, worldY, screenRight.x * (facing || 1), screenRight.y * (facing || 1));
  return {
    directionX: worldDirection.x,
    directionY: worldDirection.y,
    vx: worldDirection.x * speed,
    vy: worldDirection.y * speed
  };
}

export function applyConstraintDamping(state, pivot, damping, deltaTime) {
  const radial = normalize(state.x - pivot.x, state.y - pivot.y, 0, 1);
  const tangent = { x: radial.y, y: -radial.x };
  const tangentialSpeed = dot(state.vx, state.vy, tangent.x, tangent.y);
  const retainedSpeed = tangentialSpeed * Math.exp(-Math.max(0, damping) * Math.max(0, deltaTime));
  const speedDelta = retainedSpeed - tangentialSpeed;
  return {
    vx: state.vx + tangent.x * speedDelta,
    vy: state.vy + tangent.y * speedDelta
  };
}

export function computeRopeVisualTarget(state, anchor, gravity, ropeLength, tuning) {
  const offsetX = state.x - anchor.x;
  const offsetY = state.y - anchor.y;
  const distance = Math.hypot(offsetX, offsetY);
  const radial = normalize(offsetX, offsetY, 0, 1);
  const circleTangent = { x: radial.y, y: -radial.x };
  const gravityDirection = normalize(gravity.x, gravity.y, 0, 1);
  const hangAlignment = clamp(dot(radial.x, radial.y, gravityDirection.x, gravityDirection.y), -1, 1);
  const bottomness = clamp((hangAlignment + 0.15) / 1.15, 0, 1);
  const tangentialSpeed = Math.abs(dot(state.vx, state.vy, circleTangent.x, circleTangent.y));
  const speedTension = clamp(tangentialSpeed / tuning.maximumSwingSpeed, 0, 1);
  const tautness = clamp(distance / Math.max(ropeLength, 0.0001), 0, 1);
  const slackness = clamp((1 - tautness) / 0.35, 0, 1);
  const tension = clamp((bottomness * 0.85 + speedTension * 0.35) * tautness, 0, 1);
  const curveRatio = clamp((1 - tension) * 0.75 + slackness * 0.75, 0, 1);
  const maximumSag = clamp(
    ropeLength * tuning.sagRatio,
    tuning.minimumSag,
    tuning.maximumSag
  );
  const sag = tuning.minimumSag + (maximumSag - tuning.minimumSag) * curveRatio;

  const gravityAlongRope = dot(gravityDirection.x, gravityDirection.y, radial.x, radial.y);
  const perpendicularGravity = {
    x: gravityDirection.x - radial.x * gravityAlongRope,
    y: gravityDirection.y - radial.y * gravityAlongRope
  };
  const perpendicularMagnitude = Math.hypot(perpendicularGravity.x, perpendicularGravity.y);
  let bend;
  if (perpendicularMagnitude > 0.05) {
    bend = { x: perpendicularGravity.x / perpendicularMagnitude, y: perpendicularGravity.y / perpendicularMagnitude };
  } else {
    const tangentialDirection = dot(state.vx, state.vy, circleTangent.x, circleTangent.y) < 0 ? -1 : 1;
    bend = { x: circleTangent.x * tangentialDirection, y: circleTangent.y * tangentialDirection };
  }
  return { sag, tension, bendX: bend.x, bendY: bend.y };
}

export function computeDamageRecoveryVelocity(velocity, gravity, tangent, away, tuning) {
  const fallingSpeed = Math.max(0, dot(velocity.vx, velocity.vy, gravity.x, gravity.y));
  const awayAlongSurface = dot(away.x, away.y, tangent.x, tangent.y);
  return {
    vx: velocity.vx - gravity.x * fallingSpeed - gravity.x * tuning.liftSpeed + tangent.x * awayAlongSurface * tuning.awaySpeed,
    vy: velocity.vy - gravity.y * fallingSpeed - gravity.y * tuning.liftSpeed + tangent.y * awayAlongSurface * tuning.awaySpeed
  };
}

export function constrainRigidBar(state, pivot, fixedLength) {
  const radial = normalize(state.x - pivot.x, state.y - pivot.y, 0, -1);
  const radialSpeed = dot(state.vx, state.vy, radial.x, radial.y);
  return {
    x: pivot.x + radial.x * fixedLength,
    y: pivot.y + radial.y * fixedLength,
    vx: state.vx - radial.x * radialSpeed,
    vy: state.vy - radial.y * radialSpeed
  };
}

export function firstLineOfSightBlocker(start, end, surfaces, endpointTolerance = 0.002) {
  let nearest = null;
  for (const surface of surfaces) {
    const hit = segmentIntersection(
      start.x,
      start.y,
      end.x,
      end.y,
      surface.ax,
      surface.ay,
      surface.bx,
      surface.by
    );
    if (!hit || hit.firstT <= endpointTolerance || hit.firstT >= 1 - endpointTolerance) continue;
    if (!nearest || hit.firstT < nearest.firstT) nearest = { ...hit, surface };
  }
  return nearest;
}

export function hasClearLineOfSight(start, end, surfaces) {
  return firstLineOfSightBlocker(start, end, surfaces) === null;
}

export function applySwingInput(state, pivot, screenRight, inputAxis, deltaTime, tuning) {
  const radial = normalize(state.x - pivot.x, state.y - pivot.y, 0, 1);
  const circleTangent = { x: radial.y, y: -radial.x };
  const horizontalProjection = dot(circleTangent.x, circleTangent.y, screenRight.x, screenRight.y);
  const requestedControl = clamp(inputAxis, -1, 1) * horizontalProjection;
  const targetStrength = Math.abs(requestedControl);
  const blend = 1 - Math.exp(-tuning.smoothing * deltaTime);
  const controlStrength = state.controlStrength + (targetStrength - state.controlStrength) * blend;

  if (inputAxis === 0 || Math.abs(requestedControl) < 0.0001) {
    return { vx: state.vx, vy: state.vy, controlStrength };
  }

  const tangentialSpeed = dot(state.vx, state.vy, circleTangent.x, circleTangent.y);
  const requestedDirection = Math.sign(requestedControl);
  const speedMagnitude = Math.abs(tangentialSpeed);
  const speedFactor = clamp(speedMagnitude / tuning.pumpFullSpeed, 0, 1);
  const movingWithInput = speedMagnitude < 0.001 || Math.sign(tangentialSpeed) === requestedDirection;
  let nextTangentialSpeed = tangentialSpeed;
  if (state.kick && speedMagnitude < tuning.startKickSpeed) {
    nextTangentialSpeed = requestedDirection * tuning.startKickSpeed;
  } else if (movingWithInput) {
    nextTangentialSpeed = moveToward(
      tangentialSpeed,
      requestedDirection * tuning.targetSpeed,
      tuning.acceleration * speedFactor * controlStrength * deltaTime
    );
  } else {
    nextTangentialSpeed = moveToward(
      tangentialSpeed,
      0,
      tuning.braking * speedFactor * controlStrength * deltaTime
    );
  }
  const speedDelta = nextTangentialSpeed - tangentialSpeed;
  return {
    vx: state.vx + circleTangent.x * speedDelta,
    vy: state.vy + circleTangent.y * speedDelta,
    controlStrength
  };
}

export function hazardTipSegment(hazard) {
  const direction = hazard.direction || "up";
  if (direction === "down") return { ax: hazard.x, ay: hazard.y + hazard.h, bx: hazard.x + hazard.w, by: hazard.y + hazard.h };
  if (direction === "left") return { ax: hazard.x, ay: hazard.y, bx: hazard.x, by: hazard.y + hazard.h };
  if (direction === "right") return { ax: hazard.x + hazard.w, ay: hazard.y, bx: hazard.x + hazard.w, by: hazard.y + hazard.h };
  return { ax: hazard.x, ay: hazard.y, bx: hazard.x + hazard.w, by: hazard.y };
}

export function hazardBaseSegment(hazard) {
  const direction = hazard.direction || "up";
  if (direction === "down") {
    return { ax: hazard.x, ay: hazard.y, bx: hazard.x + hazard.w, by: hazard.y, normalX: 0, normalY: 1 };
  }
  if (direction === "left") {
    return { ax: hazard.x + hazard.w, ay: hazard.y, bx: hazard.x + hazard.w, by: hazard.y + hazard.h, normalX: -1, normalY: 0 };
  }
  if (direction === "right") {
    return { ax: hazard.x, ay: hazard.y, bx: hazard.x, by: hazard.y + hazard.h, normalX: 1, normalY: 0 };
  }
  return { ax: hazard.x, ay: hazard.y + hazard.h, bx: hazard.x + hazard.w, by: hazard.y + hazard.h, normalX: 0, normalY: -1 };
}

export function hazardHardBarSurface(hazard) {
  const base = hazardBaseSegment(hazard);
  return {
    id: `${hazard.id}:collision-base`,
    kind: "hazard",
    attachment: "base",
    ax: base.ax,
    ay: base.ay,
    bx: base.bx,
    by: base.by
  };
}

export function resolveHazardBaseCollision(state, base, radius) {
  const horizontal = base.ay === base.by;
  if (horizontal) {
    if (state.x < Math.min(base.ax, base.bx) - radius || state.x > Math.max(base.ax, base.bx) + radius) return null;
  } else if (state.y < Math.min(base.ay, base.by) - radius || state.y > Math.max(base.ay, base.by) + radius) {
    return null;
  }

  const currentDistance = dot(state.x - base.ax, state.y - base.ay, base.normalX, base.normalY);
  const previousDistance = dot(state.previousX - base.ax, state.previousY - base.ay, base.normalX, base.normalY);
  if (currentDistance >= radius || (previousDistance < 0 && currentDistance < 0)) return null;

  const penetration = radius - currentDistance;
  let vx = state.vx;
  let vy = state.vy;
  const intoSurface = dot(vx, vy, base.normalX, base.normalY);
  if (intoSurface < 0) {
    vx -= base.normalX * intoSurface;
    vy -= base.normalY * intoSurface;
  }
  return {
    x: state.x + base.normalX * penetration,
    y: state.y + base.normalY * penetration,
    vx,
    vy,
    normal: { x: base.normalX, y: base.normalY }
  };
}
