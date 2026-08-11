import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSoftBodyPose,
  createPlayerAnimation,
  triggerDashAnimation,
  triggerJumpAnimation,
  triggerLandingAnimation,
  updatePlayerAnimation
} from "../src/player-animation.js";

const baseState = {
  vx: 0,
  vy: 0,
  gravity: { x: 0, y: 1 },
  tangent: { x: 1, y: 0 },
  grounded: true,
  gliding: false,
  constrained: false,
  dashing: false,
  facing: 1,
  distanceTravelled: 0
};

test("dash deformation eases in instead of switching to a fixed ellipse", () => {
  const animation = createPlayerAnimation();
  triggerDashAnimation(animation, 1, 0);
  updatePlayerAnimation(animation, {
    ...baseState,
    vx: 850,
    grounded: false,
    dashing: true
  }, 1 / 120);

  assert.ok(animation.stretch > 0);
  assert.ok(animation.stretch < 0.1);

  for (let index = 0; index < 18; index += 1) {
    updatePlayerAnimation(animation, {
      ...baseState,
      vx: 850,
      grounded: false,
      dashing: true
    }, 1 / 120);
  }
  assert.ok(animation.stretch > 0.3);
});

test("soft body pose keeps its projected area while stretching", () => {
  const animation = createPlayerAnimation();
  animation.stretch = 0.42;
  const pose = computeSoftBodyPose(animation, 18);

  assert.ok(pose.longRadius > 18);
  assert.ok(pose.crossRadius < 18);
  assert.ok(Math.abs(pose.areaRatio - 1) < 0.000001);
});

test("rope swing stretch builds and relaxes without a shape snap", () => {
  const animation = createPlayerAnimation();
  const swinging = {
    ...baseState,
    vx: 700,
    grounded: false,
    constrained: true
  };

  for (let index = 0; index < 16; index += 1) {
    updatePlayerAnimation(animation, swinging, 1 / 120);
  }
  const attachedStretch = animation.stretch;
  assert.ok(attachedStretch > 0.2);

  updatePlayerAnimation(animation, {
    ...swinging,
    constrained: false
  }, 1 / 120);
  assert.ok(animation.stretch > 0);
  assert.ok(Math.abs(animation.stretch - attachedStretch) < 0.05);
});

test("jump starts with a small squash and then stretches vertically", () => {
  const animation = createPlayerAnimation();
  triggerJumpAnimation(animation);

  updatePlayerAnimation(animation, {
    ...baseState,
    vy: -590,
    grounded: false
  }, 1 / 120);
  assert.ok(animation.stretch < 0);

  for (let index = 0; index < 10; index += 1) {
    updatePlayerAnimation(animation, {
      ...baseState,
      vy: -500,
      grounded: false
    }, 1 / 120);
  }
  assert.ok(animation.stretch > 0);
});

test("landing impulse compresses the body before it rebounds", () => {
  const animation = createPlayerAnimation();
  animation.stretch = 0.18;
  const triggered = triggerLandingAnimation(animation, { x: 0, y: 1 }, 620);
  assert.equal(triggered, true);

  updatePlayerAnimation(animation, baseState, 1 / 120);
  assert.ok(animation.stretch < 0.18);
  assert.ok(animation.stretchVelocity < 0);
});

test("tail turns continuously when the facing direction changes", () => {
  const animation = createPlayerAnimation(1);
  updatePlayerAnimation(animation, { ...baseState, facing: -1 }, 1 / 120);

  assert.ok(animation.tailFacing < 1);
  assert.ok(animation.tailFacing > -1);

  for (let index = 0; index < 40; index += 1) {
    updatePlayerAnimation(animation, { ...baseState, facing: -1 }, 1 / 120);
  }
  assert.ok(animation.tailFacing < -0.9);
});

test("tail mass lags below the player during jump acceleration", () => {
  const animation = createPlayerAnimation(1);
  for (let index = 0; index < 24; index += 1) {
    updatePlayerAnimation(animation, baseState, 1 / 120);
  }
  const idleTailY = animation.tailOffsetY;
  triggerJumpAnimation(animation);

  for (let index = 0; index < 12; index += 1) {
    updatePlayerAnimation(animation, {
      ...baseState,
      vy: -590 + index * 13,
      grounded: false
    }, 1 / 120);
  }

  assert.ok(animation.tailOffsetY > idleTailY + 10);
  assert.ok(animation.tailVelocityY > 0);
});

test("tail whips opposite a changing rope swing direction", () => {
  const animation = createPlayerAnimation(1);
  for (let index = 0; index < 18; index += 1) {
    updatePlayerAnimation(animation, {
      ...baseState,
      vx: 650,
      grounded: false,
      constrained: true
    }, 1 / 120);
  }
  assert.ok(animation.tailOffsetX < -40);

  for (let index = 0; index < 18; index += 1) {
    updatePlayerAnimation(animation, {
      ...baseState,
      vy: 650,
      grounded: false,
      constrained: true
    }, 1 / 120);
  }
  assert.ok(animation.tailOffsetY < -20);
  assert.ok(Math.abs(animation.tailVelocityX) > 100);
});
