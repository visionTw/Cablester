import { TUNING } from "./config.js";
import { clamp, dot, length } from "./math.js";

const HALF_TURN = Math.PI;
const QUARTER_TURN = Math.PI / 2;

function shortestAxisDelta(from, to) {
  let delta = (to - from + QUARTER_TURN) % HALF_TURN;
  if (delta < 0) delta += HALF_TURN;
  return delta - QUARTER_TURN;
}

function stepSpring(value, velocity, target, frequency, damping, deltaTime) {
  const acceleration = (target - value) * frequency * frequency
    - velocity * 2 * damping * frequency;
  const nextVelocity = velocity + acceleration * deltaTime;
  return {
    value: value + nextVelocity * deltaTime,
    velocity: nextVelocity
  };
}

function limitVector(x, y, maximumLength) {
  const magnitude = length(x, y);
  if (magnitude <= maximumLength || magnitude < 0.000001) return { x, y };
  return {
    x: x / magnitude * maximumLength,
    y: y / magnitude * maximumLength
  };
}

function updateTailPhysics(animation, state, speed, deltaTime) {
  const facingBackX = -state.tangent.x * animation.tailFacing;
  const facingBackY = -state.tangent.y * animation.tailFacing;
  const fallbackBack = length(facingBackX, facingBackY) > 0.05
    ? { x: facingBackX, y: facingBackY }
    : { x: -state.tangent.x * state.facing, y: -state.tangent.y * state.facing };
  const motionBack = speed > 0.001
    ? { x: -state.vx / speed, y: -state.vy / speed }
    : fallbackBack;
  const tailIsFree = !state.grounded || state.constrained || state.dashing;
  const motionInfluence = tailIsFree
    ? clamp(0.18 + speed / 680, 0.18, 0.94)
    : 0;
  const gravitySag = state.grounded ? 0.1 : 0.22 * (1 - motionInfluence);
  const desiredX = fallbackBack.x * (1 - motionInfluence)
    + motionBack.x * motionInfluence
    + state.gravity.x * gravitySag;
  const desiredY = fallbackBack.y * (1 - motionInfluence)
    + motionBack.y * motionInfluence
    + state.gravity.y * gravitySag;
  const desiredLength = TUNING.tailRestLength
    + clamp(speed / TUNING.maximumSwingSpeed, 0, 1) * 10;
  const desiredMagnitude = Math.max(0.000001, length(desiredX, desiredY));
  const targetX = desiredX / desiredMagnitude * desiredLength;
  const targetY = desiredY / desiredMagnitude * desiredLength;

  const rawBodyAccelerationX = (state.vx - animation.previousPlayerVx) / deltaTime;
  const rawBodyAccelerationY = (state.vy - animation.previousPlayerVy) / deltaTime;
  const bodyAcceleration = limitVector(
    rawBodyAccelerationX,
    rawBodyAccelerationY,
    TUNING.tailMaximumBodyAcceleration
  );
  const relativeForceX = (-bodyAcceleration.x + state.gravity.x * TUNING.gravity)
    * TUNING.tailInertia;
  const relativeForceY = (-bodyAcceleration.y + state.gravity.y * TUNING.gravity)
    * TUNING.tailInertia;
  const springFrequency = TUNING.tailPhysicsFrequency;
  const damping = 2 * TUNING.tailPhysicsDamping * springFrequency;
  const accelerationX = (targetX - animation.tailOffsetX) * springFrequency * springFrequency
    - animation.tailVelocityX * damping
    + relativeForceX;
  const accelerationY = (targetY - animation.tailOffsetY) * springFrequency * springFrequency
    - animation.tailVelocityY * damping
    + relativeForceY;

  animation.tailVelocityX += accelerationX * deltaTime;
  animation.tailVelocityY += accelerationY * deltaTime;
  animation.tailOffsetX += animation.tailVelocityX * deltaTime;
  animation.tailOffsetY += animation.tailVelocityY * deltaTime;

  const limitedOffset = limitVector(
    animation.tailOffsetX,
    animation.tailOffsetY,
    TUNING.tailMaximumLength
  );
  if (limitedOffset.x !== animation.tailOffsetX || limitedOffset.y !== animation.tailOffsetY) {
    const radial = {
      x: limitedOffset.x / TUNING.tailMaximumLength,
      y: limitedOffset.y / TUNING.tailMaximumLength
    };
    const outwardSpeed = dot(
      animation.tailVelocityX,
      animation.tailVelocityY,
      radial.x,
      radial.y
    );
    if (outwardSpeed > 0) {
      animation.tailVelocityX -= radial.x * outwardSpeed;
      animation.tailVelocityY -= radial.y * outwardSpeed;
    }
    animation.tailOffsetX = limitedOffset.x;
    animation.tailOffsetY = limitedOffset.y;
  }

  animation.previousPlayerVx = state.vx;
  animation.previousPlayerVy = state.vy;
}

export function createPlayerAnimation(facing = 1) {
  return {
    stretch: 0,
    stretchVelocity: 0,
    axisAngle: 0,
    tailFacing: facing < 0 ? -1 : 1,
    tailFacingVelocity: 0,
    tailOffsetX: -TUNING.tailRestLength * (facing < 0 ? -1 : 1),
    tailOffsetY: 0,
    tailVelocityX: 0,
    tailVelocityY: 0,
    previousPlayerVx: 0,
    previousPlayerVy: 0,
    motionTailBlend: 0,
    dashBlend: 0,
    jumpTimer: 0,
    landingTimer: 0,
    landingSquash: 0
  };
}

export function triggerJumpAnimation(animation) {
  animation.jumpTimer = TUNING.softBodyJumpDuration;
  animation.landingTimer = 0;
}

export function triggerDashAnimation(animation, directionX, directionY) {
  if (Math.abs(animation.stretch) < 0.04) {
    animation.axisAngle = Math.atan2(directionY, directionX);
  }
  animation.stretchVelocity = Math.max(animation.stretchVelocity, 1.25);
}

export function triggerLandingAnimation(animation, gravity, impactSpeed) {
  if (impactSpeed < TUNING.softBodyLandingThreshold) return false;
  const impact = clamp(
    (impactSpeed - TUNING.softBodyLandingThreshold) / 720,
    0,
    1
  );
  animation.axisAngle = Math.atan2(gravity.y, gravity.x);
  animation.landingTimer = TUNING.softBodyLandingDuration;
  animation.landingSquash = 0.1 + impact * 0.16;
  animation.stretchVelocity = Math.min(
    animation.stretchVelocity,
    -(2.4 + impact * 2.8)
  );
  return true;
}

export function updatePlayerAnimation(animation, state, deltaTime) {
  if (!(deltaTime > 0)) return animation;

  const speed = length(state.vx, state.vy);
  const gravitySpeed = Math.abs(dot(state.vx, state.vy, state.gravity.x, state.gravity.y));
  const tangentSpeed = Math.abs(dot(state.vx, state.vy, state.tangent.x, state.tangent.y));
  const velocityAngle = speed > 0.001
    ? Math.atan2(state.vy, state.vx)
    : Math.atan2(state.tangent.y, state.tangent.x);
  const gravityAngle = Math.atan2(state.gravity.y, state.gravity.x);
  let targetStretch = 0;
  let targetAxis = Math.atan2(state.tangent.y, state.tangent.x);

  if (animation.landingTimer > 0) {
    targetStretch = -animation.landingSquash;
    targetAxis = gravityAngle;
  } else if (state.dashing) {
    targetStretch = TUNING.softBodyDashStretch;
    targetAxis = velocityAngle;
  } else if (animation.jumpTimer > 0) {
    const squashAtStart = animation.jumpTimer
      > TUNING.softBodyJumpDuration - TUNING.softBodyJumpSquashDuration;
    targetStretch = squashAtStart
      ? -TUNING.softBodyJumpSquash
      : TUNING.softBodyJumpStretch;
    targetAxis = gravityAngle;
  } else if (state.constrained && speed > 45) {
    const swingAmount = clamp(speed / TUNING.maximumSwingSpeed, 0, 1);
    targetStretch = 0.055 + swingAmount * TUNING.softBodySwingStretch;
    targetAxis = velocityAngle;
  } else if (!state.grounded && !state.gliding) {
    targetStretch = clamp(
      gravitySpeed / TUNING.jumpSpeed * TUNING.softBodyAirStretch,
      0,
      TUNING.softBodyAirStretch
    );
    targetAxis = gravityAngle;
  } else if (state.grounded && tangentSpeed > 35) {
    const roll = 0.5 + Math.sin(state.distanceTravelled / 9) * 0.5;
    targetStretch = 0.018 + roll * 0.025;
  }

  const axisAmount = 1 - Math.exp(
    -(TUNING.softBodyAxisFollow + (state.dashing ? 16 : 0)) * deltaTime
  );
  animation.axisAngle += shortestAxisDelta(animation.axisAngle, targetAxis) * axisAmount;

  const bodySpring = stepSpring(
    animation.stretch,
    animation.stretchVelocity,
    targetStretch,
    TUNING.softBodySpringFrequency,
    TUNING.softBodySpringDamping,
    deltaTime
  );
  animation.stretch = clamp(bodySpring.value, -0.24, 0.48);
  animation.stretchVelocity = bodySpring.velocity;

  const tailSpring = stepSpring(
    animation.tailFacing,
    animation.tailFacingVelocity,
    state.facing < 0 ? -1 : 1,
    TUNING.tailTurnSpringFrequency,
    TUNING.tailTurnSpringDamping,
    deltaTime
  );
  animation.tailFacing = clamp(tailSpring.value, -1.08, 1.08);
  animation.tailFacingVelocity = tailSpring.velocity;
  updateTailPhysics(animation, state, speed, deltaTime);

  const usesMotionTail = speed > 120 && (state.dashing || state.constrained);
  const motionTailAmount = 1 - Math.exp(-(usesMotionTail ? 18 : 9) * deltaTime);
  animation.motionTailBlend += ((usesMotionTail ? 1 : 0) - animation.motionTailBlend) * motionTailAmount;
  const dashAmount = 1 - Math.exp(-(state.dashing ? 28 : 10) * deltaTime);
  animation.dashBlend += ((state.dashing ? 1 : 0) - animation.dashBlend) * dashAmount;

  animation.jumpTimer = Math.max(0, animation.jumpTimer - deltaTime);
  animation.landingTimer = Math.max(0, animation.landingTimer - deltaTime);
  return animation;
}

export function computeSoftBodyPose(animation, radius) {
  const longScale = clamp(1 + animation.stretch, 0.76, 1.48);
  return {
    angle: animation.axisAngle,
    longRadius: radius * longScale,
    crossRadius: radius / longScale,
    areaRatio: longScale * (1 / longScale)
  };
}
