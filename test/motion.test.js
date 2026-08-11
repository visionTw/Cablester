import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceMotionState,
  createMotionState,
  isPlayerStandingOnMovingPlatform,
  parseMotionPath,
  resetMotionState,
  resolvePlayerAgainstMovingRect,
  validateMotionDefinition
} from "../src/motion.js";

const definition = {
  id: "moving-a",
  objectKind: "platform",
  w: 120,
  h: 24,
  path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
  speed: 100,
  acceleration: 0,
  dwellSeconds: 0,
  easing: "linear",
  loopMode: "pingpong",
  trigger: "auto",
  offscreenPolicy: "simulate",
  resetPolicy: "death"
};

test("motion paths parse, validate and advance deterministically", () => {
  assert.deepEqual(parseMotionPath("0,0;100,-20;220,0"), [
    { x: 0, y: 0 }, { x: 100, y: -20 }, { x: 220, y: 0 }
  ]);
  assert.deepEqual(validateMotionDefinition(definition), []);
  const first = advanceMotionState(createMotionState(definition), 0.5);
  const second = advanceMotionState(createMotionState(definition), 0.5);
  assert.deepEqual(first, second);
  assert.equal(first.x, 50);
  const endpoint = advanceMotionState(first, 0.5);
  assert.equal(endpoint.x, 100);
  const returned = advanceMotionState(endpoint, 1);
  assert.ok(Math.abs(returned.x) < 0.000001);
});

test("touch triggers and offscreen policies pause or reset motion", () => {
  const touchDefinition = { ...definition, trigger: "touch" };
  const waiting = advanceMotionState(createMotionState(touchDefinition), 0.5);
  assert.equal(waiting.x, 0);
  const moving = advanceMotionState(waiting, 0.5, { triggered: true });
  assert.equal(moving.x, 50);
  const paused = advanceMotionState({ ...moving, offscreenPolicy: "pause" }, 1, { offscreen: true });
  assert.equal(paused.x, 50);
  assert.equal(paused.deltaX, 0);
  const reset = advanceMotionState({ ...moving, offscreenPolicy: "reset" }, 1, { offscreen: true });
  assert.equal(reset.x, 0);
  assert.deepEqual(resetMotionState(moving).path, definition.path);
});

test("moving platforms carry grounded players and sweep high-speed contacts", () => {
  const platform = { ...createMotionState(definition), x: 0, y: 100, previousX: 0, previousY: 100 };
  const standing = { x: 50, y: 82, radius: 18, grounded: true };
  assert.equal(isPlayerStandingOnMovingPlatform(standing, platform), true);

  const highSpeedPlatform = {
    ...platform,
    w: 20,
    h: 20,
    previousX: 0,
    previousY: 0,
    x: 100,
    y: 0,
    velocityX: 100,
    velocityY: 0
  };
  const player = { x: 60, y: 10, previousX: 60, previousY: 10, vx: 0, vy: 0, radius: 5 };
  const contact = resolvePlayerAgainstMovingRect(player, highSpeedPlatform);
  assert.ok(contact);
  assert.deepEqual(contact.normal, { x: 1, y: 0 });
  assert.ok(contact.x > highSpeedPlatform.x + highSpeedPlatform.w);
  assert.equal(contact.vx, 100);
});

