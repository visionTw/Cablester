import test from "node:test";
import assert from "node:assert/strict";
import { advancePointTowards, applyConstraintDamping, applyMinimumUpdraftLift, applyRopeWinch, applySwingInput, applyWindForce, computeDamageRecoveryVelocity, computeDashVelocity, computeRopeVisualTarget, constrainRigidBar, decelerateUpdraftLift, firstLineOfSightBlocker, grantAbility, hasClearLineOfSight, hazardBaseSegment, hazardHardBarSurface, hazardTipSegment, limitSpeedAlongDirection, limitUpdraftLiftSpeed, resolveHazardBaseCollision, restoreResource, shouldReleaseBash, shouldUseRopeWinch, spendEnergy, takeDamage } from "../src/rules.js";

test("energy spending is atomic", () => {
  assert.deepEqual(spendEnergy(2, 0.5), { ok: true, value: 1.5 });
  assert.deepEqual(spendEnergy(0.25, 0.5), { ok: false, value: 0.25 });
});

test("resource restoration clamps to maximum", () => {
  assert.equal(restoreResource(5.5, 2, 6), 6);
});

test("invulnerability prevents repeated hazard damage", () => {
  assert.deepEqual(takeDamage(4, 1, 0.4), { applied: false, health: 4, defeated: false });
  assert.deepEqual(takeDamage(4, 1, 0), { applied: true, health: 3, defeated: false });
});

test("ability grants are idempotent and reject unknown ids", () => {
  const abilities = new Set(["rope"]);
  const known = new Set(["rope", "doubleJump"]);
  assert.deepEqual(grantAbility(abilities, "doubleJump", known), { granted: true, abilityId: "doubleJump" });
  assert.deepEqual(grantAbility(abilities, "doubleJump", known), { granted: false, abilityId: "doubleJump" });
  assert.throws(() => grantAbility(abilities, "teleport", known), /Unknown ability/);
});

test("held rope winch accelerates, shortens, and grants one completion boost", () => {
  const result = applyRopeWinch(
    { length: 100, reelSpeed: 20, vx: 10, vy: 20, boostApplied: false },
    { x: 1, y: 0 },
    0.1,
    {
      minimumLength: 80,
      maximumReelSpeed: 100,
      reelAcceleration: 200,
      acceleration: 100,
      speedAccelerationFactor: 1,
      completionBoost: 50
    }
  );
  assert.deepEqual(result, {
    length: 96,
    reelSpeed: 40,
    vx: -4,
    vy: 20,
    completed: false,
    boostApplied: false
  });

  const completed = applyRopeWinch(
    { length: 81, reelSpeed: 90, vx: 0, vy: 0, boostApplied: false },
    { x: 0, y: 1 },
    0.1,
    {
      minimumLength: 80,
      maximumReelSpeed: 100,
      reelAcceleration: 200,
      acceleration: 100,
      speedAccelerationFactor: 1,
      completionBoost: 50
    }
  );
  assert.equal(completed.length, 80);
  assert.equal(completed.reelSpeed, 100);
  assert.equal(completed.completed, true);
  assert.equal(completed.boostApplied, true);
  assert.equal(completed.vy, -70);
});

test("up input winches whenever the rope is attached", () => {
  assert.equal(shouldUseRopeWinch(true, true), true);
  assert.equal(shouldUseRopeWinch(false, true), false);
  assert.equal(shouldUseRopeWinch(true, false), false);
});

test("bash releases on key-up or when the time-stop expires", () => {
  assert.equal(shouldReleaseBash(true, 0.6), true);
  assert.equal(shouldReleaseBash(false, 0), true);
  assert.equal(shouldReleaseBash(false, 0.4), false);
});

test("gliding limits downward speed while preserving cross-axis momentum", () => {
  assert.deepEqual(
    limitSpeedAlongDirection({ vx: 320, vy: 480 }, { x: 0, y: 1 }, 190),
    { vx: 320, vy: 190 }
  );
  assert.deepEqual(
    limitSpeedAlongDirection({ vx: 320, vy: -40 }, { x: 0, y: 1 }, 190),
    { vx: 320, vy: -40 }
  );
});

test("wind force is amplified during gliding", () => {
  assert.deepEqual(
    applyWindForce({ vx: 100, vy: 50 }, { forceX: 300, forceY: -500 }, 0.1, 1.9),
    { vx: 157, vy: -45 }
  );
});

test("entering an updraft immediately turns falling speed into lift", () => {
  assert.deepEqual(
    applyMinimumUpdraftLift({ vx: 240, vy: 190 }, { x: 0, y: 1 }, 300),
    { vx: 240, vy: -300 }
  );
  assert.deepEqual(
    applyMinimumUpdraftLift({ vx: 240, vy: -420 }, { x: 0, y: 1 }, 300),
    { vx: 240, vy: -420 }
  );
});

test("updraft lift reaches a maximum speed and then stays constant", () => {
  assert.deepEqual(
    limitUpdraftLiftSpeed({ vx: 240, vy: -680 }, { x: 0, y: 1 }, 520),
    { vx: 240, vy: -520 }
  );
  assert.deepEqual(
    limitUpdraftLiftSpeed({ vx: 240, vy: -410 }, { x: 0, y: 1 }, 520),
    { vx: 240, vy: -410 }
  );
});

test("updraft lift decelerates smoothly after leaving the wind zone", () => {
  assert.deepEqual(
    decelerateUpdraftLift({ vx: 240, vy: -520 }, { x: 0, y: 1 }, 220, 0.5),
    { vx: 240, vy: -410 }
  );
  assert.deepEqual(
    decelerateUpdraftLift({ vx: 240, vy: -180 }, { x: 0, y: 1 }, 220, 1),
    { vx: 240, vy: 0 }
  );
});

test("rope endpoints visibly travel outward and snap only after reaching their target", () => {
  assert.deepEqual(
    advancePointTowards({ x: 0, y: 0 }, { x: 100, y: 0 }, 300, 0.1),
    { x: 30, y: 0, reached: false }
  );
  assert.deepEqual(
    advancePointTowards({ x: 90, y: 0 }, { x: 100, y: 0 }, 300, 0.1),
    { x: 100, y: 0, reached: true }
  );
});

test("dash supports facing fallback, diagonals, and rotated screen axes", () => {
  assert.deepEqual(
    computeDashVelocity(0, 0, -1, { x: 1, y: 0 }, { x: 0, y: 1 }, 800),
    { directionX: -1, directionY: 0, vx: -800, vy: 0 }
  );
  const diagonal = computeDashVelocity(1, -1, 1, { x: 1, y: 0 }, { x: 0, y: 1 }, 800);
  assert.ok(Math.abs(diagonal.vx - Math.SQRT1_2 * 800) < 0.000001);
  assert.ok(Math.abs(diagonal.vy + Math.SQRT1_2 * 800) < 0.000001);
  const rotated = computeDashVelocity(1, 0, 1, { x: 0, y: -1 }, { x: 1, y: 0 }, 800);
  assert.deepEqual(rotated, { directionX: 0, directionY: -1, vx: 0, vy: -800 });
});

test("constraint damping preserves radial motion while gradually reducing angular speed", () => {
  const damped = applyConstraintDamping(
    { x: 0, y: 10, vx: 120, vy: 35 },
    { x: 0, y: 0 },
    Math.log(2),
    1
  );
  assert.ok(Math.abs(damped.vx - 60) < 0.000001);
  assert.equal(damped.vy, 35);
});

test("soft rope bends more near a high swing point than at the fast bottom", () => {
  const tuning = { minimumSag: 2, maximumSag: 72, sagRatio: 0.18, maximumSwingSpeed: 900 };
  const bottom = computeRopeVisualTarget(
    { x: 0, y: 200, vx: 600, vy: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    200,
    tuning
  );
  const highSide = computeRopeVisualTarget(
    { x: 200, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    200,
    tuning
  );
  const slackHighSide = computeRopeVisualTarget(
    { x: 150, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    200,
    tuning
  );
  assert.ok(bottom.sag < highSide.sag);
  assert.ok(bottom.tension > highSide.tension);
  assert.ok(slackHighSide.sag > highSide.sag);
  assert.ok(highSide.bendY > 0.99);
});

test("damage recovery cancels falling speed and launches away from gravity", () => {
  const result = computeDamageRecoveryVelocity(
    { vx: 0, vy: 500 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 1, y: 0 },
    { liftSpeed: 370, awaySpeed: 150 }
  );
  assert.deepEqual(result, { vx: 150, vy: -370 });
});

test("rigid bar preserves fixed length and removes radial velocity", () => {
  const result = constrainRigidBar(
    { x: 6, y: 8, vx: 30, vy: 40 },
    { x: 0, y: 0 },
    20
  );
  assert.ok(Math.abs(Math.hypot(result.x, result.y) - 20) < 0.000001);
  assert.ok(Math.abs(result.vx) < 0.000001);
  assert.ok(Math.abs(result.vy) < 0.000001);

  const tangential = constrainRigidBar(
    { x: 10, y: 0, vx: 0, vy: 50 },
    { x: 0, y: 0 },
    10
  );
  assert.equal(tangential.vx, 0);
  assert.equal(tangential.vy, 50);
});

test("line of sight rejects surfaces and anchors behind solid geometry", () => {
  const surfaces = [
    { id: "ground:top", ax: 0, ay: 0, bx: 10, by: 0 },
    { id: "ground:bottom", ax: 10, ay: 10, bx: 0, by: 10 },
    { id: "wall", ax: 12, ay: -10, bx: 12, by: 10 }
  ];

  const underground = firstLineOfSightBlocker({ x: 5, y: -5 }, { x: 5, y: 10 }, surfaces);
  assert.equal(underground.surface.id, "ground:top");
  assert.equal(hasClearLineOfSight({ x: 5, y: -5 }, { x: 5, y: 10 }, surfaces), false);
  assert.equal(hasClearLineOfSight({ x: 5, y: -5 }, { x: 5, y: 0 }, surfaces), true);
  assert.equal(hasClearLineOfSight({ x: 5, y: -5 }, { x: 15, y: -5 }, surfaces), false);
  assert.equal(hasClearLineOfSight({ x: 5, y: -5 }, { x: 10, y: -5 }, surfaces), true);
});

test("swing input pumps existing motion, brakes proportionally, and cannot hold a static angle", () => {
  const tuning = {
    smoothing: 20,
    acceleration: 900,
    braking: 1500,
    targetSpeed: 700,
    startKickSpeed: 80,
    pumpFullSpeed: 240
  };
  const accelerating = applySwingInput(
    { x: 0, y: 10, vx: 100, vy: 0, controlStrength: 0, kick: false },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    1,
    0.1,
    tuning
  );
  assert.ok(accelerating.vx > 100);
  assert.equal(accelerating.vy, 0);

  const braking = applySwingInput(
    { x: 0, y: 10, vx: -100, vy: 0, controlStrength: 0, kick: false },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    1,
    0.1,
    tuning
  );
  assert.ok(braking.vx > -100);
  assert.ok(braking.vx + 100 > accelerating.vx - 100);

  const released = applySwingInput(
    { x: 0, y: 10, vx: 80, vy: 0, controlStrength: 1, kick: false },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    0,
    0.1,
    tuning
  );
  assert.equal(released.vx, 80);
  assert.ok(released.controlStrength < 1);

  const staticHold = applySwingInput(
    { x: -30, y: 100, vx: 0, vy: 0, controlStrength: 1, kick: false },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    -1,
    0.1,
    tuning
  );
  assert.equal(staticHold.vx, 0);
  assert.equal(staticHold.vy, 0);

  const startingKick = applySwingInput(
    { x: 0, y: 10, vx: 0, vy: 0, controlStrength: 0, kick: true },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    1,
    0.1,
    tuning
  );
  assert.equal(startingKick.vx, 80);
});

test("hazards expose separate damaging-tip and collision-base geometry", () => {
  const upward = { x: 10, y: 20, w: 100, h: 40 };
  assert.deepEqual(hazardTipSegment(upward), { ax: 10, ay: 20, bx: 110, by: 20 });
  assert.deepEqual(hazardBaseSegment(upward), { ax: 10, ay: 60, bx: 110, by: 60, normalX: 0, normalY: -1 });

  const leftward = { x: 10, y: 20, w: 30, h: 80, direction: "left" };
  assert.deepEqual(hazardTipSegment(leftward), { ax: 10, ay: 20, bx: 10, by: 100 });
  assert.deepEqual(hazardBaseSegment(leftward), { ax: 40, ay: 20, bx: 40, by: 100, normalX: -1, normalY: 0 });
});

test("hard bars attach to the hazard collision base instead of its damaging tip", () => {
  assert.deepEqual(
    hazardHardBarSurface({ id: "spikes", x: 10, y: 20, w: 100, h: 40 }),
    {
      id: "spikes:collision-base",
      kind: "hazard",
      attachment: "base",
      ax: 10,
      ay: 60,
      bx: 110,
      by: 60
    }
  );
  assert.deepEqual(
    hazardHardBarSurface({ id: "ceiling", x: 20, y: 30, w: 80, h: 50, direction: "down" }),
    {
      id: "ceiling:collision-base",
      kind: "hazard",
      attachment: "base",
      ax: 20,
      ay: 30,
      bx: 100,
      by: 30
    }
  );
});

test("hazard base collision catches a falling player without trapping players behind it", () => {
  const base = hazardBaseSegment({ x: 10, y: 20, w: 100, h: 40 });
  const caught = resolveHazardBaseCollision(
    { x: 50, y: 55, previousX: 50, previousY: 40, vx: 25, vy: 200 },
    base,
    10
  );
  assert.deepEqual(caught, { x: 50, y: 50, vx: 25, vy: 0, normal: { x: 0, y: -1 } });

  const behind = resolveHazardBaseCollision(
    { x: 50, y: 75, previousX: 50, previousY: 70, vx: 0, vy: 100 },
    base,
    10
  );
  assert.equal(behind, null);
});
