import test from "node:test";
import assert from "node:assert/strict";
import { closestPointOnSegment, closestPointsBetweenSegments, easeInOutCubic, inverseRotate, rotate, segmentIntersection } from "../src/math.js";

test("rotate and inverseRotate preserve a vector", () => {
  const rotated = rotate(12, -7, Math.PI / 2);
  const restored = inverseRotate(rotated.x, rotated.y, Math.PI / 2);
  assert.ok(Math.abs(restored.x - 12) < 0.000001);
  assert.ok(Math.abs(restored.y + 7) < 0.000001);
});

test("closestPointOnSegment clamps to segment endpoints", () => {
  assert.deepEqual(closestPointOnSegment(-5, 3, 0, 0, 10, 0), { x: 0, y: 0, t: 0 });
  assert.deepEqual(closestPointOnSegment(15, 3, 0, 0, 10, 0), { x: 10, y: 0, t: 1 });
  assert.deepEqual(closestPointOnSegment(4, 3, 0, 0, 10, 0), { x: 4, y: 0, t: 0.4 });
});

test("rotation easing stays within normalized bounds", () => {
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(2), 1);
});

test("closest segment points support ray-like surface targeting", () => {
  const crossing = closestPointsBetweenSegments(0, 0, 10, 0, 5, -5, 5, 5);
  assert.ok(crossing.distance < 0.000001);
  assert.ok(Math.abs(crossing.first.x - 5) < 0.000001);
  assert.ok(Math.abs(crossing.second.y) < 0.000001);

  const missed = closestPointsBetweenSegments(0, 0, 10, 0, 4, 3, 7, 3);
  assert.ok(Math.abs(missed.distance - 3) < 0.000001);
});

test("segment intersection reports the hit position on both segments", () => {
  const hit = segmentIntersection(0, 0, 10, 0, 4, -5, 4, 5);
  assert.ok(hit);
  assert.equal(hit.x, 4);
  assert.equal(hit.y, 0);
  assert.equal(hit.firstT, 0.4);
  assert.equal(hit.secondT, 0.5);
  assert.equal(segmentIntersection(0, 0, 3, 0, 4, -5, 4, 5), null);
});
