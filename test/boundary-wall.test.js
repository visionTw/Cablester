import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryWallSegments,
  resolvePlayerAgainstBoundaryWall
} from "../src/boundary-wall.js";
import { BUILTIN_PROCEDURAL_ASSET_ID } from "../src/asset-library.js";
import { compileLevelDocument, levelToDocument } from "../src/level-objects.js";
import { LEVELS } from "../src/levels.js";
import { validateLevel } from "../src/level-validator.js";

const BASE_WALL = Object.freeze({
  id: "edge-wall",
  x: 100,
  y: 0,
  w: 20,
  h: 200,
  grapple: false
});

test("solid boundary walls resolve overlap without adding velocity", () => {
  const collision = resolvePlayerAgainstBoundaryWall({
    x: 95,
    y: 80,
    previousX: 90,
    previousY: 80,
    vx: 240,
    vy: 35,
    radius: 10
  }, { ...BASE_WALL, blockingSide: "all" });

  assert.deepEqual(collision, {
    x: 90,
    y: 80,
    vx: 0,
    vy: 35,
    normal: { x: -1, y: 0 }
  });
});

test("one-sided boundary walls catch crossings only from their allowed side", () => {
  const cases = [
    { side: "left", previous: { x: 80, y: 80 }, current: { x: 115, y: 80 }, velocity: { vx: 600, vy: 12 }, expected: { x: 90, y: 80, vx: 0, vy: 12, normal: { x: -1, y: 0 } } },
    { side: "right", previous: { x: 140, y: 80 }, current: { x: 105, y: 80 }, velocity: { vx: -600, vy: 12 }, expected: { x: 130, y: 80, vx: 0, vy: 12, normal: { x: 1, y: 0 } } },
    { side: "top", previous: { x: 110, y: -20 }, current: { x: 110, y: 15 }, velocity: { vx: 12, vy: 600 }, expected: { x: 110, y: -10, vx: 12, vy: 0, normal: { x: 0, y: -1 } } },
    { side: "bottom", previous: { x: 110, y: 220 }, current: { x: 110, y: 185 }, velocity: { vx: 12, vy: -600 }, expected: { x: 110, y: 210, vx: 12, vy: 0, normal: { x: 0, y: 1 } } }
  ];

  for (const item of cases) {
    const player = {
      ...item.current,
      previousX: item.previous.x,
      previousY: item.previous.y,
      ...item.velocity,
      radius: 10
    };
    assert.deepEqual(
      resolvePlayerAgainstBoundaryWall(player, { ...BASE_WALL, blockingSide: item.side }),
      item.expected,
      item.side
    );
  }

  assert.equal(resolvePlayerAgainstBoundaryWall({
    x: 95,
    y: 80,
    previousX: 140,
    previousY: 80,
    vx: -600,
    vy: 0,
    radius: 10
  }, { ...BASE_WALL, blockingSide: "left" }), null);
});

test("one-sided boundary walls recover a player stranded beyond the blocking plane", () => {
  const wall = { id: "right-edge", x: 100, y: 0, w: 20, h: 300, blockingSide: "left", grapple: false };
  const resolved = resolvePlayerAgainstBoundaryWall({
    x: 118,
    y: 140,
    previousX: 114,
    previousY: 140,
    vx: 80,
    vy: 0,
    radius: 12
  }, wall);
  assert.ok(resolved);
  assert.equal(resolved.x, 88);
  assert.equal(resolved.vx, 0);
});

test("one-sided boundary walls ignore crossings outside their finite span", () => {
  assert.equal(resolvePlayerAgainstBoundaryWall({
    x: 115,
    y: 240,
    previousX: 80,
    previousY: 240,
    vx: 600,
    vy: 0,
    radius: 10
  }, { ...BASE_WALL, blockingSide: "left" }), null);
});

test("boundary wall blocking surfaces remain non-grappleable by default", () => {
  assert.deepEqual(boundaryWallSegments({ ...BASE_WALL, blockingSide: "left" }), [{
    id: "edge-wall:left",
    ax: 100,
    ay: 200,
    bx: 100,
    by: 0,
    kind: "boundaryWall",
    grapple: false
  }]);
  assert.equal(boundaryWallSegments({ ...BASE_WALL, blockingSide: "all" }).length, 4);
});

test("all ten formal levels compile explicit edge walls without covering spawn, goal or fall exits", () => {
  assert.equal(LEVELS.length, 10);
  for (const level of LEVELS) {
    assert.deepEqual(validateLevel(level), [], level.id);
    assert.equal(level.boundaryWalls.length, level.id === "combined-vertical" ? 3 : 2, level.id);
    assert.ok(level.boundaryWalls.every((wall) => wall.grapple === false), level.id);
    assert.ok(level.boundaryWalls.every((wall) => level.visuals[wall.id]?.assetId === BUILTIN_PROCEDURAL_ASSET_ID), `${level.id}: invisible default`);
    assert.ok(level.boundaryWalls.some((wall) => wall.blockingSide === "right"), `${level.id}: left edge`);
    assert.ok(level.boundaryWalls.some((wall) => wall.blockingSide === "left"), `${level.id}: right edge`);
    assert.ok(level.boundaryWalls.every((wall) => wall.blockingSide !== "top"), `${level.id}: bottom remains a fall exit`);
    for (const point of [level.spawn, level.goal].filter(Boolean)) {
      assert.ok(level.boundaryWalls.every((wall) => (
        point.x < wall.x || point.x > wall.x + wall.w || point.y < wall.y || point.y > wall.y + wall.h
      )), `${level.id}: protected point ${point.id || "spawn"}`);
    }

    const roundTrip = compileLevelDocument(levelToDocument(level));
    assert.deepEqual(roundTrip.boundaryWalls, level.boundaryWalls, level.id);
  }
});
