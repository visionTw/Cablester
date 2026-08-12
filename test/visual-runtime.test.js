import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY,
  assetDeliveryUrl,
  createAssetRegistry,
  createVisualConfig
} from "../src/asset-library.js";
import { calculateSeamlessPlacements, createDefaultScene } from "../src/scene-layers.js";
import {
  AssetImageLoader,
  LatestRequestCoordinator,
  MAX_TINT_VARIANTS_PER_ASSET,
  PreparedVisualLoadCoordinator,
  VisualRuntime,
  collectLevelAssetIds,
  detectVisualQualityTier,
  isObjectVisualVisible,
  objectVisualBounds,
  requiredSceneResidencyDraws,
  scenePassForLayer,
  stableSortRenderQueue,
  visualQualityProfile
} from "../src/visual-runtime.js";

function imageAsset(id, applicableTypes = ["*"]) {
  const fileStem = id.replace(/[^a-z0-9_-]/gi, "-");
  return {
    id,
    label: id,
    description: `${id} test image`,
    category: "test",
    kind: "image",
    path: `./assets/game/test/${fileStem}.webp`,
    thumbnailPath: null,
    applicableTypes,
    tags: ["test"],
    prompt: "original test asset",
    generationMethod: "test-fixture",
    width: 64,
    height: 32,
    fileSizeBytes: 128,
    license: { name: "test", scope: "tests", source: "local" }
  };
}

function registryWith(...assets) {
  return createAssetRegistry({
    assets: [structuredClone(DEFAULT_ASSET_REGISTRY.assets[0]), ...assets],
    typeDefaults: {},
    projectDefaultAssetId: BUILTIN_PROCEDURAL_ASSET_ID
  });
}

function fakeContext() {
  const calls = [];
  const ctx = {
    calls,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    filter: "none",
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    translate(x, y) { calls.push(["translate", x, y]); },
    scale(x, y) { calls.push(["scale", x, y]); },
    drawImage(...args) { calls.push(["drawImage", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    beginPath() { calls.push(["beginPath"]); },
    closePath() { calls.push(["closePath"]); },
    moveTo(...args) { calls.push(["moveTo", ...args]); },
    lineTo(...args) { calls.push(["lineTo", ...args]); },
    bezierCurveTo(...args) { calls.push(["bezierCurveTo", ...args]); },
    arc(...args) { calls.push(["arc", ...args]); },
    fill() { calls.push(["fill"]); },
    stroke() { calls.push(["stroke"]); }
  };
  return ctx;
}

test("AssetImageLoader deduplicates requests, records decoded bytes and contains the LRU", async () => {
  const assets = Array.from({ length: 9 }, (_, index) => imageAsset(`test:image-${index}`));
  const registry = registryWith(...assets);
  const loader = new AssetImageLoader({
    registry,
    maxEntries: 8,
    resolveUrl: (path) => `resolved:${path}`,
    loadImage: async (_url, asset) => ({ width: asset.width, height: asset.height })
  });
  const first = loader.request(assets[0].id);
  assert.equal(loader.request(assets[0].id), first);
  assert.equal(first.url, `resolved:${assetDeliveryUrl(assets[0].path)}`);
  await first.promise;
  assert.deepEqual(loader.stats(), {
    requests: 1,
    cacheHits: 1,
    ready: 1,
    loading: 0,
    error: 0,
    estimatedDecodedBytes: 64 * 32 * 4,
    estimatedTintBytes: 0,
    tintVariants: 0,
    cacheEntries: 1,
    residentEntries: 0,
    evictions: 0
  });

  for (const asset of assets.slice(1)) await loader.request(asset.id).promise;
  const stats = loader.stats();
  assert.equal(stats.cacheEntries, 8);
  assert.equal(stats.evictions, 1);
  assert.equal(loader.peek(assets[0].id), null);
});

test("tint canvases use a bounded per-asset LRU and expose estimated memory", async () => {
  const asset = imageAsset("test:tinted", ["platform"]);
  const registry = registryWith(asset);
  const loader = new AssetImageLoader({
    registry,
    loadImage: async () => ({ width: asset.width, height: asset.height })
  });
  await loader.preload([asset.id]);
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  class TestOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        fillStyle: "#000000",
        drawImage() {},
        fillRect() {}
      };
    }
  }
  globalThis.OffscreenCanvas = TestOffscreenCanvas;
  try {
    const runtime = new VisualRuntime({ registry, loader, qualityTier: "high" });
    const ctx = fakeContext();
    for (let index = 0; index < MAX_TINT_VARIANTS_PER_ASSET + 2; index += 1) {
      runtime.renderObject(ctx, {
        type: "platform",
        item: { x: 0, y: 0, w: 100, h: 30 },
        visual: createVisualConfig({ assetId: asset.id, tint: `#${(0x110000 + index * 0x101).toString(16).padStart(6, "0")}` }),
        fallback() {}
      });
    }
    const entry = loader.peek(asset.id);
    assert.equal(entry.tintCache.size, MAX_TINT_VARIANTS_PER_ASSET);
    assert.equal(entry.tintCache.has("#110000"), false);
    const stats = loader.stats();
    assert.equal(stats.tintVariants, MAX_TINT_VARIANTS_PER_ASSET);
    assert.equal(stats.estimatedTintBytes, asset.width * asset.height * 4 * MAX_TINT_VARIANTS_PER_ASSET);
  } finally {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test("AssetImageLoader retains an inspectable error state without rejecting preload", async () => {
  const asset = imageAsset("test:broken");
  const loader = new AssetImageLoader({
    registry: registryWith(asset),
    loadImage: async () => { throw new Error("broken fixture"); }
  });
  await loader.preload([asset.id, asset.id]);
  assert.equal(loader.peek(asset.id).status, "error");
  assert.match(loader.peek(asset.id).error.message, /broken fixture/);
  assert.deepEqual(loader.unavailableAssetIds(), [asset.id]);
  assert.equal(loader.stats().requests, 1);
});

test("prepared visual loads wait for decode, pin the active neighborhood and ignore stale completions", async () => {
  const assetA = imageAsset("test:prepared-a");
  const assetB = imageAsset("test:prepared-b");
  const releases = new Map();
  const loader = new AssetImageLoader({
    registry: registryWith(assetA, assetB),
    loadImage: (url, asset) => new Promise((resolve) => releases.set(asset.id, () => resolve({ width: 64, height: 32 })))
  });
  const runtime = new VisualRuntime({ registry: registryWith(assetA, assetB), loader, qualityTier: "high" });
  const coordinator = new PreparedVisualLoadCoordinator(runtime);
  const levelA = { visuals: { platform: { assetId: assetA.id } }, scene: { layers: [] } };
  const levelB = { visuals: { platform: { assetId: assetB.id } }, scene: { layers: [] } };
  const first = coordinator.prepare(levelA);
  await Promise.resolve();
  const second = coordinator.prepare(levelB);
  await Promise.resolve();
  assert.equal(loader.stats().ready, 0);
  releases.get(assetB.id)();
  const preparedB = await second;
  assert.equal(preparedB.current, true);
  releases.get(assetA.id)();
  const preparedA = await first;
  assert.equal(preparedA.current, false);
  assert.equal(loader.stats().ready, 2);
  assert.equal(loader.stats().residentEntries, 1);
  const requestCount = loader.stats().requests;
  await coordinator.prepare(levelB);
  assert.equal(loader.stats().requests, requestCount);
});

test("a later level entry cancels an earlier request before its async neighborhood is ready", async () => {
  const coordinator = new LatestRequestCoordinator();
  let releaseReference;
  const committed = [];
  const startReference = async () => {
    const generation = coordinator.begin();
    await new Promise((resolve) => { releaseReference = resolve; });
    if (coordinator.isCurrent(generation)) committed.push("reference");
  };
  const pendingReference = startReference();
  await Promise.resolve();
  const formalGeneration = coordinator.begin();
  if (coordinator.isCurrent(formalGeneration)) committed.push("formal");
  releaseReference();
  await pendingReference;
  assert.deepEqual(committed, ["formal"]);
});

test("prepared visual loads settle broken assets for a stable procedural fallback", async () => {
  const asset = imageAsset("test:prepared-broken");
  const loader = new AssetImageLoader({
    registry: registryWith(asset),
    loadImage: async () => { throw new Error("decode failed"); }
  });
  const runtime = new VisualRuntime({ registry: registryWith(asset), loader, qualityTier: "high" });
  const coordinator = new PreparedVisualLoadCoordinator(runtime);
  const prepared = await coordinator.prepare({ visuals: { platform: { assetId: asset.id } }, scene: { layers: [] } });
  assert.equal(prepared.current, true);
  assert.equal(loader.peek(asset.id).status, "error");
  assert.equal(loader.stats().loading, 0);
});

test("scene residency budget covers every placement phase without exceeding declared caps", () => {
  const layer = createDefaultScene().layers.find((candidate) => candidate.role === "background");
  layer.assets = [{ assetId: "test:scene", weight: 1 }];
  layer.seamless = { mode: "mirror", tileWidth: 400, overlap: 50 };
  layer.scale = 1;
  layer.spacing = 0;
  layer.density = 1;
  layer.drawCap = 64;
  const viewportWidth = 1280;
  const overscan = 400;
  const required = requiredSceneResidencyDraws(layer, viewportWidth, overscan);
  for (let cameraX = 0; cameraX < 350; cameraX += 7) {
    const result = calculateSeamlessPlacements(layer, { cameraX, viewportWidth, overscan });
    assert.ok(required >= result.candidateCount, `${cameraX}: ${required} < ${result.candidateCount}`);
    assert.ok(required - result.candidateCount <= 1, `${cameraX}: budget is needlessly high`);
  }
  assert.equal(requiredSceneResidencyDraws({ ...layer, repeatX: false }, viewportWidth, overscan), 1);
});

test("level asset collection and stable draw sorting preserve default order", () => {
  assert.deepEqual(collectLevelAssetIds({
    visuals: {
      platform: { assetId: "test:platform" },
      fallback: { assetId: BUILTIN_PROCEDURAL_ASSET_ID }
    },
    scene: { layers: [{ assets: [{ assetId: "test:mist" }, { assetId: "test:platform" }] }] }
  }).sort(), ["test:mist", "test:platform"]);

  const fallback = imageAsset("test:platform-fallback", ["platform"]);
  const custom = imageAsset("test:platform-custom", ["platform"]);
  const fallbackRegistry = createAssetRegistry({
    assets: [structuredClone(DEFAULT_ASSET_REGISTRY.assets[0]), fallback, custom],
    typeDefaults: { platform: fallback.id },
    projectDefaultAssetId: BUILTIN_PROCEDURAL_ASSET_ID
  });
  assert.deepEqual(collectLevelAssetIds({
    visualOrder: { platform: ["ground"] },
    visuals: { ground: { ...createVisualConfig(), assetId: "missing:ground" } },
    scene: { layers: [] }
  }, fallbackRegistry).sort(), ["missing:ground", fallback.id].sort());
  assert.deepEqual(collectLevelAssetIds({
    visualOrder: { platform: ["ground"] },
    visuals: { ground: { ...createVisualConfig(), assetId: custom.id } },
    scene: { layers: [] }
  }, fallbackRegistry).sort(), [custom.id, fallback.id].sort());

  const queue = stableSortRenderQueue([
    { id: "default-b", drawLayer: 0, defaultOrder: 2 },
    { id: "front", drawLayer: 4, defaultOrder: 0 },
    { id: "default-a", drawLayer: 0, defaultOrder: 1 },
    { id: "back", drawLayer: -2, defaultOrder: 9 },
    { id: "same-a", drawLayer: 0, defaultOrder: 3 },
    { id: "same-b", drawLayer: 0, defaultOrder: 3 }
  ]);
  assert.deepEqual(queue.map((item) => item.id), ["back", "default-a", "default-b", "same-a", "same-b", "front"]);
});

test("object visibility uses actual offset, anchor, flip, fragile offset and camera rotation", () => {
  const camera = { x: 0, y: 0, angle: 0, width: 640, height: 360 };
  const farGameplay = { x: 1200, y: 140, w: 200, h: 40 };
  const offsetVisual = createVisualConfig({ offsetX: -1000, anchorX: 0, scaleX: 2 });
  const offsetBounds = objectVisualBounds(farGameplay, "platform", offsetVisual);
  assert.equal(offsetBounds.x, 300);
  assert.equal(isObjectVisualVisible(farGameplay, "platform", offsetVisual, camera, 0), true);

  const flipped = objectVisualBounds(
    { x: 700, y: 140, w: 100, h: 40 },
    "platform",
    createVisualConfig({ anchorX: 0, flipX: true, scaleX: 4 })
  );
  assert.equal(flipped.x, 350);
  assert.equal(flipped.width, 450);

  const fragile = objectVisualBounds(
    { x: 220, y: -500, w: 120, h: 30, offsetY: 620 },
    "fragilePlatform",
    createVisualConfig({ anchorY: 1 })
  );
  assert.equal(fragile.y, 105);
  assert.equal(fragile.y + fragile.height, 150);
  assert.equal(isObjectVisualVisible(
    { x: 220, y: -500, w: 120, h: 30, offsetY: 620 },
    "fragilePlatform",
    createVisualConfig({ anchorY: 1 }),
    camera,
    0
  ), true);

  const rotatedCamera = { ...camera, angle: Math.PI / 2 };
  assert.equal(isObjectVisualVisible(
    { x: 0, y: -300, w: 40, h: 40 },
    "platform",
    createVisualConfig(),
    rotatedCamera,
    0
  ), true);
  assert.equal(isObjectVisualVisible(
    { x: 0, y: -900, w: 40, h: 40 },
    "platform",
    createVisualConfig(),
    rotatedCamera,
    0
  ), false);
});

test("object image rendering matches editor bounds while loading and errors use procedural fallback", async () => {
  const asset = imageAsset("test:platform", ["platform"]);
  const registry = registryWith(asset);
  let resolveLoad;
  const loader = new AssetImageLoader({
    registry,
    loadImage: () => new Promise((resolve) => { resolveLoad = resolve; })
  });
  const runtime = new VisualRuntime({ registry, loader, qualityTier: "high" });
  const ctx = fakeContext();
  let fallbacks = 0;
  let overlays = 0;
  const command = {
    type: "platform",
    item: { x: 10, y: 20, w: 200, h: 40 },
    visual: createVisualConfig({
      assetId: asset.id,
      scaleX: 1.5,
      scaleY: 0.5,
      anchorX: 0.25,
      anchorY: 0.75,
      offsetX: 4,
      offsetY: -3,
      flipX: true,
      opacity: 0.6
    }),
    fallback: () => { fallbacks += 1; },
    overlay: () => { overlays += 1; }
  };
  assert.equal(runtime.renderObject(ctx, command).fallback, true);
  assert.equal(fallbacks, 1);
  assert.equal(overlays, 0);
  await Promise.resolve();
  resolveLoad({ width: 64, height: 32 });
  await loader.peek(asset.id).promise;
  assert.equal(runtime.renderObject(ctx, command).drawn, true);
  assert.equal(fallbacks, 1);
  assert.equal(overlays, 1);
  assert.deepEqual(ctx.calls.find((call) => call[0] === "translate"), ["translate", 114, 37]);
  assert.deepEqual(ctx.calls.find((call) => call[0] === "scale"), ["scale", -1, 1]);
  const draw = ctx.calls.find((call) => call[0] === "drawImage");
  assert.deepEqual(draw.slice(-4), [-75, -15, 300, 20]);
  assert.equal(runtime.stats().objectAssetDraws, 1);
  assert.equal(runtime.stats().fallbackDraws, 1);
});

test("nine-slice platform rendering remains compatible with flip, tint and opacity", async () => {
  const asset = imageAsset("test:nine-platform", ["platform"]);
  asset.width = 100;
  asset.height = 50;
  asset.scaling = {
    defaultMode: "nine-slice",
    allowedModes: ["stretch", "nine-slice", "tile"],
    nineSlice: { left: 20, right: 20, top: 10, bottom: 10, edgeMode: "tile", centerMode: "tile" },
    tile: { width: 50, height: 25 }
  };
  const registry = registryWith(asset);
  const loader = new AssetImageLoader({ registry, loadImage: async () => ({ width: 100, height: 50 }) });
  await loader.preload([asset.id]);
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  class TestOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    getContext() {
      return {
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        fillStyle: "#000000",
        drawImage() {},
        fillRect() {}
      };
    }
  }
  globalThis.OffscreenCanvas = TestOffscreenCanvas;
  try {
    const runtime = new VisualRuntime({ registry, loader, qualityTier: "high" });
    const ctx = fakeContext();
    const result = runtime.renderObject(ctx, {
      type: "platform",
      item: { x: 10, y: 20, w: 600, h: 120 },
      visual: createVisualConfig({
        assetId: asset.id,
        scaleMode: "nine-slice",
        tileScale: 1.5,
        flipX: true,
        flipY: true,
        tint: "#77ccaa",
        opacity: 0.45
      }),
      fallback() {}
    });
    const imageDraws = ctx.calls.filter((call) => call[0] === "drawImage");
    assert.equal(result.drawn, true);
    assert.ok(imageDraws.length > 9);
    assert.ok(imageDraws.every((call) => call[1] instanceof TestOffscreenCanvas));
    assert.deepEqual(ctx.calls.find((call) => call[0] === "scale"), ["scale", -1, -1]);
    assert.equal(ctx.globalAlpha, 0.45);
    assert.equal(loader.peek(asset.id).tintCache.has("#77ccaa"), true);
    assert.equal(runtime.stats().objectAssetDraws, 1);
  } finally {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test("low quality caps object nine-slice patches and reports degradation", async () => {
  const asset = imageAsset("test:low-nine-platform", ["platform"]);
  asset.width = 100;
  asset.height = 50;
  asset.scaling = {
    defaultMode: "nine-slice",
    allowedModes: ["stretch", "nine-slice", "tile"],
    nineSlice: { left: 20, right: 20, top: 10, bottom: 10, edgeMode: "tile", centerMode: "tile" },
    tile: { width: 50, height: 25 }
  };
  const registry = registryWith(asset);
  const loader = new AssetImageLoader({ registry, loadImage: async () => ({ width: 100, height: 50 }) });
  await loader.preload([asset.id]);
  const runtime = new VisualRuntime({ registry, loader, qualityTier: "low" });
  const ctx = fakeContext();
  runtime.renderObject(ctx, {
    type: "platform",
    item: { x: 0, y: 0, w: 5000, h: 700 },
    visual: createVisualConfig({ assetId: asset.id, scaleMode: "nine-slice", tileScale: 1 }),
    fallback() {}
  });
  const stats = runtime.stats();
  assert.equal(stats.objectAssetDraws, 1);
  assert.equal(stats.objectPatchDraws, 1);
  assert.equal(stats.objectQualityDegrades, 1);
  assert.equal(ctx.calls.filter((call) => call[0] === "drawImage").length, 1);
});

test("procedural object rendering uses the zero-request fast path", () => {
  const runtime = new VisualRuntime({ qualityTier: "high" });
  let fallbacks = 0;
  const result = runtime.renderObject(fakeContext(), {
    type: "platform",
    item: { x: 0, y: 0, w: 100, h: 30 },
    visual: createVisualConfig(),
    fallback: () => { fallbacks += 1; }
  });
  assert.equal(result.status, "procedural");
  assert.equal(fallbacks, 1);
  assert.equal(runtime.stats().requests, 0);
  assert.equal(runtime.stats().fallbackDraws, 1);
});

test("boundary walls stay invisible by default but render an explicit compatible image", async () => {
  const asset = imageAsset("test:visible-boundary", ["boundaryWall"]);
  const registry = registryWith(asset);
  const loader = new AssetImageLoader({ registry, loadImage: async () => ({ width: 64, height: 32 }) });
  await loader.preload([asset.id]);
  const runtime = new VisualRuntime({ registry, loader, qualityTier: "high" });
  const ctx = fakeContext();
  const wall = { x: 20, y: 10, w: 30, h: 200 };
  const hidden = runtime.renderObject(ctx, {
    type: "boundaryWall",
    item: wall,
    visual: createVisualConfig(),
    fallback: null
  });
  assert.equal(hidden.drawn, false);
  assert.equal(ctx.calls.some((call) => call[0] === "drawImage"), false);

  const visible = runtime.renderObject(ctx, {
    type: "boundaryWall",
    item: wall,
    visual: createVisualConfig({ assetId: asset.id }),
    fallback: null
  });
  assert.equal(visible.drawn, true);
  assert.equal(ctx.calls.some((call) => call[0] === "drawImage"), true);

  const missing = runtime.renderObject(ctx, {
    type: "boundaryWall",
    item: wall,
    visual: createVisualConfig({ assetId: "missing:boundary" }),
    fallback: null
  });
  assert.equal(missing.drawn, false);
});

test("scene rendering uses canonical placements, pass selection and low-tier caps", async () => {
  const asset = imageAsset("test:forest", ["scene"]);
  const registry = registryWith(asset);
  const loader = new AssetImageLoader({
    registry,
    loadImage: async () => ({ width: 200, height: 100 })
  });
  const runtime = new VisualRuntime({ registry, loader, qualityTier: "low" });
  const scene = createDefaultScene();
  const layer = scene.layers.find((candidate) => candidate.role === "background");
  layer.assets = [{ assetId: asset.id, weight: 1 }];
  layer.seamless = { mode: "mirror", tileWidth: 100, overlap: 0 };
  layer.drawCap = 4096;
  layer.density = 100;
  await runtime.preloadLevel({ visuals: {}, scene });
  runtime.beginFrame();
  const ctx = fakeContext();
  runtime.renderScenePass(ctx, scene, "background", { x: 400, y: 0, width: 640, height: 360 });
  runtime.renderScenePass(ctx, scene, "foreground", { x: 400, y: 0, width: 640, height: 360 });
  const stats = runtime.stats();
  assert.equal(stats.qualityTier, "low");
  assert.ok(stats.sceneDraws > 0);
  assert.ok(stats.sceneDraws <= visualQualityProfile("low").maxLayerDraws + 1);
  assert.ok(stats.cullCount > 0);
  assert.ok(stats.sceneResidencyDeficits > 0);
  assert.equal(stats.objectAssetDraws, 0);
  assert.equal(ctx.calls.filter((call) => call[0] === "drawImage").length + 1, stats.sceneDraws);
});

test("missing scene images draw a bounded procedural fallback and fog overlay", () => {
  const runtime = new VisualRuntime({ registry: registryWith(), qualityTier: "low" });
  const scene = createDefaultScene();
  const layer = scene.layers.find((candidate) => candidate.role === "midground");
  layer.assets = [{ assetId: "missing:trees", weight: 1 }];
  layer.seamless = { mode: "tile", tileWidth: 240, overlap: 0 };
  const ctx = fakeContext();
  runtime.beginFrame();
  runtime.renderScenePass(ctx, scene, "midground", { x: 0, y: 0, width: 640, height: 360 });
  const stats = runtime.stats();
  assert.ok(stats.fallbackDraws > 0);
  assert.ok(stats.sceneDraws > 0);
  assert.equal(stats.objectAssetDraws, 0);
  assert.equal(ctx.calls.some((call) => call[0] === "fill"), true);
  assert.equal(ctx.calls.some((call) => call[0] === "fillRect" && call[1] === 0 && call[2] === 0 && call[3] === 640 && call[4] === 360), true);
});

test("quality detection has deterministic low, balanced and high paths", () => {
  assert.equal(detectVisualQualityTier({ deviceMemory: 4, hardwareConcurrency: 16, devicePixelRatio: 1 }), "low");
  assert.equal(detectVisualQualityTier({ deviceMemory: 8, hardwareConcurrency: 8, devicePixelRatio: 3 }), "balanced");
  assert.equal(detectVisualQualityTier({ deviceMemory: 16, hardwareConcurrency: 12, devicePixelRatio: 1 }), "high");
  assert.equal(visualQualityProfile("unknown").tier, "balanced");
});

test("scene passes follow editable depth while preserving the player baseline", () => {
  assert.equal(scenePassForLayer({ role: "background", depth: 20 }), "foreground");
  assert.equal(scenePassForLayer({ role: "custom", depth: -80 }), "background");
  assert.equal(scenePassForLayer({ role: "foreground", depth: -10 }), "midground");
  assert.equal(scenePassForLayer({ role: "custom", depth: 0 }), "player");
});
