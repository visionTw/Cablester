import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ASSET_DRAW_PATCHES,
  createAssetDrawPlan,
  drawScaledAssetImage,
  resolveAssetScaleMode,
  validateAssetScaling
} from "../src/asset-scaling.js";
import { DEFAULT_ASSET_REGISTRY, GAME_ASSET_IDS } from "../src/asset-library.js";

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

function cocosStyleAsset() {
  return {
    id: "test:cocos-nine-slice-platform",
    width: 100,
    height: 50,
    scaling: {
      defaultMode: "nine-slice",
      allowedModes: ["stretch", "nine-slice"],
      nineSlice: { left: 20, right: 20, top: 10, bottom: 10 },
      tile: null
    }
  };
}

test("Cocos-style nine-slice keeps corners fixed, stretches edges on one axis and center on both", () => {
  const asset = cocosStyleAsset();
  assert.deepEqual(validateAssetScaling(asset.scaling, asset), []);
  const target = { x: -150, y: -40, width: 300, height: 80 };
  const plan = createAssetDrawPlan(asset, { scaleMode: "asset", tileScale: 1 }, { width: 100, height: 50 }, target);
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.equal(plan.fallbackReason, null);
  assert.equal(plan.patches.length, 9);
  assert.deepEqual(plan.guides, { vertical: [-130, 130], horizontal: [-30, 30] });

  const [topLeft, top, topRight, left, center, right, bottomLeft, bottom, bottomRight] = plan.patches;
  assert.deepEqual(topLeft, { sx: 0, sy: 0, sw: 20, sh: 10, dx: -150, dy: -40, dw: 20, dh: 10 });
  assert.deepEqual(topRight, { sx: 80, sy: 0, sw: 20, sh: 10, dx: 130, dy: -40, dw: 20, dh: 10 });
  assert.deepEqual(bottomLeft, { sx: 0, sy: 40, sw: 20, sh: 10, dx: -150, dy: 30, dw: 20, dh: 10 });
  assert.deepEqual(bottomRight, { sx: 80, sy: 40, sw: 20, sh: 10, dx: 130, dy: 30, dw: 20, dh: 10 });
  assert.deepEqual(top, { sx: 20, sy: 0, sw: 60, sh: 10, dx: -130, dy: -40, dw: 260, dh: 10 });
  assert.deepEqual(bottom, { sx: 20, sy: 40, sw: 60, sh: 10, dx: -130, dy: 30, dw: 260, dh: 10 });
  assert.deepEqual(left, { sx: 0, sy: 10, sw: 20, sh: 30, dx: -150, dy: -30, dw: 20, dh: 60 });
  assert.deepEqual(right, { sx: 80, sy: 10, sw: 20, sh: 30, dx: 130, dy: -30, dw: 20, dh: 60 });
  assert.deepEqual(center, { sx: 20, sy: 10, sw: 60, sh: 30, dx: -130, dy: -30, dw: 260, dh: 60 });
  assert.equal(plan.degraded, false);
});

test("the shipped moss platform stays a single nine-patch at tall gameplay sizes", () => {
  const asset = DEFAULT_ASSET_REGISTRY.assets.find((candidate) => candidate.id === GAME_ASSET_IDS.mossPlatform);
  const plan = createAssetDrawPlan(asset, { scaleMode: "asset", tileScale: 1 }, asset, {
    x: 0,
    y: 0,
    width: 1280,
    height: 300
  });
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.equal(plan.patches.length, 9);
  assert.equal(new Set(plan.patches.map((patch) => `${patch.dy}:${patch.dh}`)).size, 3);
  assert.equal(plan.patches[4].dh, 267);
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

test("legacy tiled nine-slice documents remain supported as an explicit extension", () => {
  const asset = scalableAsset();
  assert.deepEqual(validateAssetScaling(asset.scaling, asset), []);
  const plan = createAssetDrawPlan(asset, { scaleMode: "nine-slice", tileScale: 1 }, asset, {
    x: 0,
    y: 0,
    width: 300,
    height: 80
  });
  assert.equal(plan.resolvedMode, "nine-slice");
  assert.ok(plan.patches.length > 9);
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
