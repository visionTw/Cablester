import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY,
  DEFAULT_VISUAL_CONFIG,
  assetDeliveryUrl,
  getAssetById,
  resolveAssetReference,
  resolveVisualAsset
} from "./asset-library.js";
import { calculateSeamlessPlacements, validateScene } from "./scene-layers.js";

const QUALITY_PROFILES = Object.freeze({
  high: Object.freeze({ maxLayers: 48, maxLayerDraws: 256, maxSceneDraws: 1024, densityScale: 1, maxBlur: 12 }),
  balanced: Object.freeze({ maxLayers: 24, maxLayerDraws: 128, maxSceneDraws: 512, densityScale: 0.72, maxBlur: 6 }),
  low: Object.freeze({ maxLayers: 12, maxLayerDraws: 48, maxSceneDraws: 192, densityScale: 0.42, maxBlur: 2 })
});

const SCENE_PASSES = new Set(["background", "midground", "player", "foreground"]);
const WHITE_TINTS = new Set(["#ffffff", "#ffffffff"]);
export const MAX_TINT_VARIANTS_PER_ASSET = 6;

function imageDimensions(image, asset = {}) {
  return {
    width: Number(image?.naturalWidth || image?.width || asset.width || 0),
    height: Number(image?.naturalHeight || image?.height || asset.height || 0)
  };
}

function defaultResolveUrl(path) {
  if (typeof document === "undefined") return path;
  return new URL(path, document.baseURI).href;
}

function defaultLoadImage(url) {
  if (typeof Image === "undefined") return Promise.reject(new Error("Image loading is unavailable in this runtime"));
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      callback(value);
    };
    image.decoding = "async";
    image.onload = () => finish(resolve, image);
    image.onerror = () => finish(reject, new Error(`Unable to load image asset: ${url}`));
    image.src = url;
    if (typeof image.decode === "function") {
      image.decode().then(() => finish(resolve, image)).catch(() => {
        // Some browsers reject decode() while still completing through onload.
      });
    }
  });
}

function closeDrawable(drawable) {
  if (drawable && typeof drawable.close === "function") drawable.close();
}

export function detectVisualQualityTier({
  deviceMemory = globalThis.navigator?.deviceMemory,
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false
} = {}) {
  if (prefersReducedMotion || (Number.isFinite(deviceMemory) && deviceMemory <= 4) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 4)) return "low";
  if ((Number.isFinite(deviceMemory) && deviceMemory < 8) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency < 8) || devicePixelRatio >= 3) return "balanced";
  return "high";
}

export function visualQualityProfile(tier = "auto") {
  const resolvedTier = tier === "auto" ? detectVisualQualityTier() : tier;
  return { tier: QUALITY_PROFILES[resolvedTier] ? resolvedTier : "balanced", ...(QUALITY_PROFILES[resolvedTier] || QUALITY_PROFILES.balanced) };
}

export class AssetImageLoader {
  constructor({
    registry = DEFAULT_ASSET_REGISTRY,
    maxEntries = 96,
    preloadConcurrency = 6,
    loadImage = defaultLoadImage,
    resolveUrl = defaultResolveUrl
  } = {}) {
    this.registry = registry;
    this.maxEntries = Math.max(8, Math.floor(maxEntries));
    this.preloadConcurrency = Math.max(1, Math.min(16, Math.floor(preloadConcurrency)));
    this.loadImage = loadImage;
    this.resolveUrl = resolveUrl;
    this.entries = new Map();
    this.clock = 0;
    this.requests = 0;
    this.cacheHits = 0;
    this.evictions = 0;
  }

  resolveAsset(assetOrId) {
    if (assetOrId && typeof assetOrId === "object") return assetOrId;
    return getAssetById(this.registry, assetOrId);
  }

  request(assetOrId) {
    const asset = this.resolveAsset(assetOrId);
    if (!asset || asset.kind !== "image" || !asset.path) return null;
    const deliveryUrl = assetDeliveryUrl(asset.path);
    if (!deliveryUrl) return null;
    const cached = this.entries.get(asset.id);
    if (cached) {
      this.cacheHits += 1;
      cached.lastUsed = ++this.clock;
      return cached;
    }
    const entry = {
      assetId: asset.id,
      asset,
      url: this.resolveUrl(deliveryUrl),
      status: "loading",
      image: null,
      error: null,
      width: 0,
      height: 0,
      decodedBytes: 0,
      lastUsed: ++this.clock,
      tintCache: new Map(),
      promise: null
    };
    this.requests += 1;
    this.entries.set(asset.id, entry);
    entry.promise = Promise.resolve()
      .then(() => this.loadImage(entry.url, asset))
      .then((image) => {
        const dimensions = imageDimensions(image, asset);
        if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error(`Image asset has invalid dimensions: ${asset.id}`);
        entry.status = "ready";
        entry.image = image;
        entry.width = dimensions.width;
        entry.height = dimensions.height;
        entry.decodedBytes = dimensions.width * dimensions.height * 4;
        entry.lastUsed = ++this.clock;
        this.prune();
        return entry;
      })
      .catch((error) => {
        entry.status = "error";
        entry.error = error instanceof Error ? error : new Error(String(error));
        entry.lastUsed = ++this.clock;
        this.prune();
        return entry;
      });
    this.prune();
    return entry;
  }

  peek(assetId) {
    const entry = this.entries.get(assetId) || null;
    if (entry) entry.lastUsed = ++this.clock;
    return entry;
  }

  async preload(assetIds = []) {
    const ids = [...new Set(assetIds)];
    const entries = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const assetId = ids[cursor++];
        const entry = this.request(assetId);
        if (!entry) continue;
        entries.push(entry);
        await entry.promise;
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.preloadConcurrency, ids.length) },
      () => worker()
    ));
    return entries;
  }

  prune() {
    if (this.entries.size <= this.maxEntries) return;
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.status !== "loading")
      .sort((left, right) => left.lastUsed - right.lastUsed);
    while (this.entries.size > this.maxEntries && candidates.length) {
      const entry = candidates.shift();
      this.entries.delete(entry.assetId);
      closeDrawable(entry.image);
      for (const drawable of entry.tintCache.values()) closeDrawable(drawable);
      this.evictions += 1;
    }
  }

  clear() {
    for (const entry of this.entries.values()) {
      closeDrawable(entry.image);
      for (const drawable of entry.tintCache.values()) closeDrawable(drawable);
    }
    this.entries.clear();
  }

  unavailableAssetIds() {
    return [...this.entries.values()].filter((entry) => entry.status === "error").map((entry) => entry.assetId);
  }

  stats() {
    const values = [...this.entries.values()];
    const tintVariants = values.reduce((sum, entry) => sum + entry.tintCache.size, 0);
    const estimatedTintBytes = values.reduce(
      (sum, entry) => sum + entry.width * entry.height * 4 * entry.tintCache.size,
      0
    );
    return {
      requests: this.requests,
      cacheHits: this.cacheHits,
      ready: values.filter((entry) => entry.status === "ready").length,
      loading: values.filter((entry) => entry.status === "loading").length,
      error: values.filter((entry) => entry.status === "error").length,
      estimatedDecodedBytes: values.reduce((sum, entry) => sum + entry.decodedBytes, 0),
      estimatedTintBytes,
      tintVariants,
      cacheEntries: values.length,
      evictions: this.evictions
    };
  }
}

function addAssetId(target, assetId) {
  if (typeof assetId === "string" && assetId && assetId !== BUILTIN_PROCEDURAL_ASSET_ID) target.add(assetId);
}

export function collectLevelAssetIds(level) {
  const ids = new Set();
  for (const visual of Object.values(level?.visuals || {})) addAssetId(ids, visual?.assetId);
  for (const layer of level?.scene?.layers || []) {
    for (const reference of layer.assets || []) addAssetId(ids, typeof reference === "string" ? reference : reference?.assetId);
  }
  return [...ids];
}

export function stableSortRenderQueue(commands = []) {
  return commands
    .map((command, index) => ({ ...command, __queueIndex: index }))
    .sort((left, right) => (left.drawLayer || 0) - (right.drawLayer || 0)
      || (left.defaultOrder || 0) - (right.defaultOrder || 0)
      || left.__queueIndex - right.__queueIndex)
    .map(({ __queueIndex, ...command }) => command);
}

function objectBounds(item, type) {
  if (Number.isFinite(item?.ax) && Number.isFinite(item?.ay) && Number.isFinite(item?.bx) && Number.isFinite(item?.by)) {
    const half = Math.max(8, (Number(item.thickness) || 0) / 2);
    return {
      x: Math.min(item.ax, item.bx) - half,
      y: Math.min(item.ay, item.by) - half,
      width: Math.abs(item.bx - item.ax) + half * 2,
      height: Math.abs(item.by - item.ay) + half * 2
    };
  }
  const x = Number(item?.x) || 0;
  const y = (Number(item?.y) || 0) + (type === "fragilePlatform" ? Number(item?.offsetY) || 0 : 0);
  if (Number.isFinite(item?.w) && Number.isFinite(item?.h)) {
    return { x, y, width: Math.max(1, item.w), height: Math.max(1, item.h) };
  }
  const radius = type === "backgroundSeed"
    ? Number(item?.size) || 22
    : ["goal", "dashRefill"].includes(type)
      ? Number(item?.radius) || 22
      : 22;
  return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 };
}

function createTintCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function tintedDrawable(entry, tint) {
  if (!entry?.image || WHITE_TINTS.has(String(tint).toLowerCase())) return entry?.image || null;
  const cacheKey = String(tint).toLowerCase();
  if (entry.tintCache.has(cacheKey)) {
    const cached = entry.tintCache.get(cacheKey);
    entry.tintCache.delete(cacheKey);
    entry.tintCache.set(cacheKey, cached);
    return cached;
  }
  const canvas = createTintCanvas(entry.width, entry.height);
  const context = canvas?.getContext?.("2d");
  if (!context) return entry.image;
  context.drawImage(entry.image, 0, 0, entry.width, entry.height);
  context.globalCompositeOperation = "source-atop";
  context.globalAlpha = 0.42;
  context.fillStyle = cacheKey;
  context.fillRect(0, 0, entry.width, entry.height);
  while (entry.tintCache.size >= MAX_TINT_VARIANTS_PER_ASSET) {
    const oldestKey = entry.tintCache.keys().next().value;
    const oldestDrawable = entry.tintCache.get(oldestKey);
    entry.tintCache.delete(oldestKey);
    closeDrawable(oldestDrawable);
  }
  entry.tintCache.set(cacheKey, canvas);
  return canvas;
}

function drawObjectImage(ctx, entry, item, type, visual) {
  const source = tintedDrawable(entry, visual.tint);
  if (!source) return false;
  const bounds = objectBounds(item, type);
  const width = Math.max(1, bounds.width * visual.scaleX);
  const height = Math.max(1, bounds.height * visual.scaleY);
  const originX = bounds.x + bounds.width / 2 + visual.offsetX;
  const originY = bounds.y + bounds.height / 2 + visual.offsetY;
  ctx.save();
  ctx.globalAlpha *= visual.opacity;
  ctx.translate(originX, originY);
  ctx.scale(visual.flipX ? -1 : 1, visual.flipY ? -1 : 1);
  ctx.drawImage(source, -width * visual.anchorX, -height * visual.anchorY, width, height);
  ctx.restore();
  return true;
}

export function scenePassForLayer(layer) {
  if (layer.role === "player" || layer.depth === 0) return "player";
  if (layer.depth < -50) return "background";
  if (layer.depth < 0) return "midground";
  return "foreground";
}

export function selectSceneLayersForQuality(scene, profile) {
  const indexed = (scene?.layers || []).map((layer, index) => ({ layer, index }));
  if (indexed.length <= profile.maxLayers) return indexed.sort((a, b) => a.layer.depth - b.layer.depth || a.index - b.index);
  const rolePriority = { player: 0, midground: 1, foreground: 2, background: 3, custom: 4 };
  return indexed
    .sort((a, b) => (rolePriority[a.layer.role] ?? 4) - (rolePriority[b.layer.role] ?? 4)
      || Math.abs(a.layer.depth) - Math.abs(b.layer.depth)
      || a.index - b.index)
    .slice(0, profile.maxLayers)
    .sort((a, b) => a.layer.depth - b.layer.depth || a.index - b.index);
}

function drawSceneImage(ctx, entry, asset, layer, placement, camera, profile) {
  const source = tintedDrawable(entry, layer.tint);
  const dimensions = imageDimensions(source, asset);
  if (!(dimensions.width > 0 && dimensions.height > 0)) return false;
  const width = placement.width;
  const height = width * dimensions.height / dimensions.width;
  const screenX = camera.width / 2 + placement.x - camera.x * layer.parallax;
  const screenY = camera.height - height;
  const blur = Math.min(profile.maxBlur, layer.blur);
  ctx.save();
  ctx.globalAlpha *= layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  if (blur > 0 && "filter" in ctx) {
    ctx.filter = `blur(${blur.toFixed(2)}px)`;
  }
  ctx.translate(placement.flipX ? screenX + width : screenX, screenY);
  ctx.scale(placement.flipX ? -1 : 1, 1);
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();
  return true;
}

function drawProceduralScenePlacement(ctx, layer, placement, camera, profile) {
  if (layer.role === "player") return false;
  const width = Math.max(44, Math.min(placement.width, 520));
  const height = width * (layer.role === "background" ? 1.35 : layer.role === "foreground" ? 0.72 : 0.96);
  const screenX = camera.width / 2 + placement.x - camera.x * layer.parallax;
  const blur = Math.min(profile.maxBlur, layer.blur);
  ctx.save();
  ctx.globalAlpha *= layer.opacity;
  ctx.globalCompositeOperation = layer.blendMode;
  if (blur > 0 && "filter" in ctx) ctx.filter = `blur(${blur.toFixed(2)}px)`;
  ctx.translate(screenX + width / 2, camera.height);
  if (placement.flipX) ctx.scale(-1, 1);
  if (layer.role === "foreground") {
    ctx.strokeStyle = "rgba(7, 26, 28, 0.72)";
    ctx.lineWidth = Math.max(8, width * 0.035);
    ctx.beginPath();
    ctx.moveTo(-width * 0.52, height * 0.12);
    ctx.bezierCurveTo(-width * 0.18, -height * 0.28, width * 0.2, height * 0.28, width * 0.54, -height * 0.08);
    ctx.stroke();
  } else {
    const alpha = layer.role === "background" ? 0.2 : 0.36;
    ctx.fillStyle = `rgba(25, 85, 82, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(-width * 0.16, 0);
    ctx.lineTo(-width * 0.1, -height);
    ctx.lineTo(width * 0.08, -height * 0.96);
    ctx.lineTo(width * 0.17, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(63, 146, 126, ${alpha * 0.72})`;
    ctx.beginPath();
    ctx.arc(-width * 0.18, -height * 0.72, width * 0.22, 0, Math.PI * 2);
    ctx.arc(width * 0.13, -height * 0.63, width * 0.27, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return true;
}

function drawSceneFog(ctx, layer, camera) {
  if (!(layer.fog > 0)) return false;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.min(0.34, layer.fog * 0.26);
  ctx.fillStyle = layer.tint;
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.restore();
  return true;
}

export class VisualRuntime {
  constructor({
    registry = DEFAULT_ASSET_REGISTRY,
    loader = null,
    qualityTier = "auto",
    maxCacheEntries = 96,
    loadImage,
    resolveUrl
  } = {}) {
    this.registry = registry;
    this.loader = loader || new AssetImageLoader({ registry, maxEntries: maxCacheEntries, loadImage, resolveUrl });
    this.quality = visualQualityProfile(qualityTier);
    this.sceneCache = new WeakMap();
    this.beginFrame();
  }

  beginFrame() {
    this.frameStats = { sceneDraws: 0, objectAssetDraws: 0, fallbackDraws: 0, cullCount: 0 };
    this.frameScenes = new WeakSet();
  }

  setQualityTier(tier) {
    this.quality = visualQualityProfile(tier);
    this.sceneCache = new WeakMap();
  }

  async preloadLevel(level) {
    return this.loader.preload(collectLevelAssetIds(level));
  }

  renderObject(ctx, { type, item, visual = DEFAULT_VISUAL_CONFIG, fallback, overlay }) {
    if (visual?.assetId === BUILTIN_PROCEDURAL_ASSET_ID) {
      if (typeof fallback === "function") {
        fallback();
        this.frameStats.fallbackDraws += 1;
      }
      return {
        drawn: false,
        fallback: true,
        status: "procedural",
        resolved: {
          requestedAssetId: BUILTIN_PROCEDURAL_ASSET_ID,
          assetId: BUILTIN_PROCEDURAL_ASSET_ID,
          asset: getAssetById(this.registry, BUILTIN_PROCEDURAL_ASSET_ID),
          visual,
          usedFallback: false,
          fallbackReason: null,
          validationErrors: []
        }
      };
    }
    const resolved = resolveVisualAsset(visual, type, this.registry, {
      unavailableAssetIds: this.loader.unavailableAssetIds()
    });
    if (resolved.asset?.kind === "image") {
      const entry = this.loader.request(resolved.asset);
      if (entry?.status === "ready" && drawObjectImage(ctx, entry, item, type, resolved.visual)) {
        if (typeof overlay === "function") overlay();
        this.frameStats.objectAssetDraws += 1;
        return { drawn: true, fallback: false, status: "ready", resolved };
      }
    }
    if (typeof fallback === "function") {
      fallback();
      this.frameStats.fallbackDraws += 1;
    }
    const status = resolved.asset?.kind === "image"
      ? this.loader.peek(resolved.asset.id)?.status || "missing"
      : "procedural";
    return { drawn: false, fallback: true, status, resolved };
  }

  renderScenePass(ctx, scene, pass, camera) {
    if (!SCENE_PASSES.has(pass) || !scene) return;
    let cachedScene = this.sceneCache.get(scene);
    if (!cachedScene) {
      const valid = validateScene(scene).length === 0;
      cachedScene = {
        valid,
        selected: valid ? selectSceneLayersForQuality(scene, this.quality) : []
      };
      this.sceneCache.set(scene, cachedScene);
    }
    if (!cachedScene.valid) return;
    const selected = cachedScene.selected;
    if (!this.frameScenes.has(scene)) {
      this.frameScenes.add(scene);
      this.frameStats.cullCount += Math.max(0, scene.layers.length - selected.length);
    }
    let remainingFrameDraws = Math.max(0, this.quality.maxSceneDraws - this.frameStats.sceneDraws);
    for (const { layer } of selected) {
      if (!layer.visible || scenePassForLayer(layer) !== pass || remainingFrameDraws <= 0) continue;
      const unavailableAssetIds = this.loader.unavailableAssetIds();
      const hasExternalAsset = layer.assets.some((reference) => reference.assetId !== BUILTIN_PROCEDURAL_ASSET_ID);
      if (!hasExternalAsset) continue;
      const effectiveLayer = {
        ...layer,
        density: Math.max(0.01, layer.density * this.quality.densityScale),
        drawCap: Math.min(layer.drawCap, this.quality.maxLayerDraws, remainingFrameDraws)
      };
      let result;
      try {
        result = calculateSeamlessPlacements(effectiveLayer, {
          cameraX: camera.x,
          viewportWidth: camera.width,
          overscan: Math.min(camera.width, effectiveLayer.seamless.tileWidth * effectiveLayer.scale),
          maxDraws: effectiveLayer.drawCap
        });
      } catch {
        this.frameStats.fallbackDraws += 1;
        continue;
      }
      this.frameStats.cullCount += Math.max(0, result.candidateCount - result.placements.length);
      for (const placement of result.placements) {
        const resolved = resolveAssetReference(placement.assetId, "scene", this.registry, { unavailableAssetIds });
        const asset = resolved.asset;
        const entry = asset?.kind === "image" ? this.loader.request(asset) : null;
        const imageDrawn = entry?.status === "ready"
          && drawSceneImage(ctx, entry, asset, effectiveLayer, placement, camera, this.quality);
        if (imageDrawn) {
          this.frameStats.sceneDraws += 1;
          remainingFrameDraws -= 1;
        } else {
          this.frameStats.fallbackDraws += 1;
          if (drawProceduralScenePlacement(ctx, effectiveLayer, placement, camera, this.quality)) {
            this.frameStats.sceneDraws += 1;
            remainingFrameDraws -= 1;
          }
        }
        if (remainingFrameDraws <= 0) break;
      }
      if (remainingFrameDraws > 0 && drawSceneFog(ctx, effectiveLayer, camera)) {
        this.frameStats.sceneDraws += 1;
        remainingFrameDraws -= 1;
      }
    }
  }

  stats() {
    return Object.freeze({
      ...this.loader.stats(),
      ...this.frameStats,
      qualityTier: this.quality.tier
    });
  }
}
