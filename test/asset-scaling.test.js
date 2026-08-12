import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ASSET_DRAW_PATCHES,
  createAssetDrawPlan,
  drawScaledAssetImage,
  resolveAssetScaleMode,
  validateAssetScaling
} from "../src/asset-scaling.js";

function scalableAsset() {
  return {
    id: "test:nine-slice-platform",
    width: 100,
    height: 50,
    scaling: {
      defaultMode: "nine-slice",
      allowedModes: ["stretch", "nine-slice", "tile"],
      nineSlice: {
        left: 20,
        right: 20,
        top: 10,
        bottom: 10,
        edgeMode: "tile",
        centerMode: "tile"
      },
      tile: { width: 50, height: 25 }
    }
  };
}

test("nine-slice plan preserves corners and covers arbitrary target bounds with bounded patches", () => {
  const asset = scalableAsset();
  const target = { x: -150, y: -40, width: 300, height: 80 };
  const plan = createAssetDrawPlan(asset, { scaleMode: "asset", tileScale: 1 }, { width: 100, height: 50 }, target);
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.equal(plan.fallbackReason, null);
  assert.deepEqual(plan.guides, { vertical: [-140, 140], horizontal: [-35, 35] });
  assert.ok(plan.patches.length > 9);
  assert.ok(plan.patches.length <= MAX_ASSET_DRAW_PATCHES);
  assert.ok(plan.patches.every((patch) => patch.sx >= 0 && patch.sy >= 0));
  assert.ok(plan.patches.every((patch) => patch.sx + patch.sw <= 100 && patch.sy + patch.sh <= 50));
  assert.equal(Math.min(...plan.patches.map((patch) => patch.dx)), target.x);
  assert.equal(Math.max(...plan.patches.map((patch) => patch.dx + patch.dw)), target.x + target.width);
  assert.equal(Math.min(...plan.patches.map((patch) => patch.dy)), target.y);
  assert.equal(Math.max(...plan.patches.map((patch) => patch.dy + patch.dh)), target.y + target.height);
});

test("nine-slice insets compress safely when a target is smaller than both fixed borders", () => {
  const asset = scalableAsset();
  const target = { x: 4, y: 7, width: 5, height: 3 };
  const plan = createAssetDrawPlan(asset, { scaleMode: "nine-slice", tileScale: 1 }, asset, target);
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.ok(plan.patches.length >= 4);
  assert.ok(plan.patches.every((patch) => patch.dw > 0 && patch.dh > 0));
  assert.ok(plan.patches.every((patch) => patch.dx >= target.x && patch.dx + patch.dw <= target.x + target.width + Number.EPSILON));
  assert.ok(plan.patches.every((patch) => patch.dy >= target.y && patch.dy + patch.dh <= target.y + target.height + Number.EPSILON));
});

test("stretch-only nine-slice draws without tile metadata", () => {
  const asset = {
    width: 64,
    height: 32,
    scaling: {
      defaultMode: "nine-slice",
      allowedModes: ["stretch", "nine-slice"],
      nineSlice: {
        left: 8,
        right: 8,
        top: 6,
        bottom: 6,
        edgeMode: "stretch",
        centerMode: "stretch"
      },
      tile: null
    }
  };
  assert.deepEqual(validateAssetScaling(asset.scaling, asset), []);
  const plan = createAssetDrawPlan(asset, { scaleMode: "nine-slice", tileScale: 1.5 }, asset, {
    x: 0,
    y: 0,
    width: 240,
    height: 96
  });
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.equal(plan.patches.length, 9);
  assert.equal(plan.degraded, false);
});

test("tiled plans cap draw calls and degrade only the oversized region to a safe stretch", () => {
  const asset = scalableAsset();
  asset.scaling.tile = { width: 1, height: 1 };
  const plan = createAssetDrawPlan(asset, { scaleMode: "tile", tileScale: 0.1 }, asset, { x: 0, y: 0, width: 5000, height: 2000 });
  assert.equal(plan.resolvedMode, "tile");
  assert.equal(plan.degraded, true);
  assert.equal(plan.patches.length, 1);
});

test("draw-time quality budget degrades before issuing excessive patch calls", () => {
  const asset = scalableAsset();
  const calls = [];
  const result = drawScaledAssetImage({ drawImage: (...args) => calls.push(args) }, { width: 100, height: 50 }, asset, {
    scaleMode: "nine-slice",
    tileScale: 0.2
  }, { x: 0, y: 0, width: 1200, height: 400 }, { maximumPatches: 12 });
  assert.equal(result.drawn, true);
  assert.equal(result.qualityDegraded, true);
  assert.equal(result.drawCalls, 1);
  assert.equal(calls.length, 1);
});

test("unsupported explicit modes and missing scale metadata use deterministic stretch fallback", () => {
  const asset = { id: "test:plain", width: 64, height: 32 };
  assert.deepEqual(resolveAssetScaleMode(asset, { scaleMode: "nine-slice" }), {
    requestedMode: "nine-slice",
    resolvedMode: "stretch",
    fallbackReason: "unsupported-scale-mode",
    profile: { defaultMode: "stretch", allowedModes: ["stretch"], nineSlice: null, tile: null }
  });
  const calls = [];
  const result = drawScaledAssetImage({ drawImage(...args) { calls.push(args); } }, { width: 64, height: 32 }, asset, { scaleMode: "nine-slice" }, { x: 2, y: 3, width: 400, height: 40 });
  assert.equal(result.drawn, true);
  assert.equal(result.plan.resolvedMode, "stretch");
  assert.deepEqual(calls[0].slice(-4), [2, 3, 400, 40]);
});

test("scale metadata validation rejects incomplete cuts, impossible centers and missing tile sizes", () => {
  const asset = scalableAsset();
  assert.deepEqual(validateAssetScaling(asset.scaling, asset), []);
  const malformed = structuredClone(asset.scaling);
  malformed.nineSlice.left = 80;
  malformed.nineSlice.right = 20;
  malformed.nineSlice.edgeMode = "mirror";
  delete malformed.tile.height;
  const errors = validateAssetScaling(malformed, asset);
  assert.ok(errors.some((error) => error.includes("positive center width")));
  assert.ok(errors.some((error) => error.includes("edgeMode")));
  assert.ok(errors.some((error) => error.includes("tile.height")));
});
