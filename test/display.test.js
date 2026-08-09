import test from "node:test";
import assert from "node:assert/strict";
import { computeCanvasBackingSize } from "../src/display.js";

test("canvas backing store matches physical display pixels", () => {
  assert.deepEqual(
    computeCanvasBackingSize(1280, 720, 2, 1280, 720),
    { width: 2560, height: 1440, scale: 2, devicePixelRatio: 2 }
  );
  assert.deepEqual(
    computeCanvasBackingSize(1600, 900, 2, 1280, 720),
    { width: 3200, height: 1800, scale: 2.5, devicePixelRatio: 2 }
  );
});

test("canvas backing scale stays bounded on very dense displays", () => {
  assert.deepEqual(
    computeCanvasBackingSize(1920, 1080, 3, 1280, 720),
    { width: 3840, height: 2160, scale: 3, devicePixelRatio: 3 }
  );
});

test("small screens render at their physical resolution without changing logical coordinates", () => {
  assert.deepEqual(
    computeCanvasBackingSize(640, 360, 2, 1280, 720),
    { width: 1280, height: 720, scale: 1, devicePixelRatio: 2 }
  );
});
