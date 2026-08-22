import { BUILTIN_PROCEDURAL_ASSET_ID } from "./asset-library.js";

export const SCENE_SCHEMA_VERSION = 1;
export const SCENE_LAYER_ROLES = Object.freeze(["background", "midground", "player", "foreground", "custom"]);
export const SCENE_BLEND_MODES = Object.freeze([
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "lighter"
]);
export const SCENE_SEAMLESS_MODES = Object.freeze(["tile", "mirror", "random"]);

const SCENE_KEYS = Object.freeze(["schemaVersion", "layers"]);
const LAYER_KEYS = Object.freeze([
  "id",
  "name",
  "role",
  "depth",
  "assets",
  "visible",
  "locked",
  "parallax",
  "scale",
  "opacity",
  "tint",
  "blur",
  "fog",
  "blendMode",
  "repeatX",
  "seamless",
  "seed",
  "range",
  "originX",
  "originY",
  "spacing",
  "density",
  "drawCap"
]);
const OPTIONAL_LAYER_KEYS = new Set(["originY"]);
const ASSET_REF_KEYS = Object.freeze(["assetId", "weight"]);
const SEAMLESS_KEYS = Object.freeze(["mode", "tileWidth", "overlap"]);
const RANGE_KEYS = Object.freeze(["startX", "endX"]);
const TINT_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unexpectedKeys(value, allowedKeys, path) {
  if (!isRecord(value)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${path}.${key} is not supported`);
}

function finiteInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function makeLayerId(role, layers = []) {
  const stem = `scene-${role || "custom"}`;
  const used = new Set(layers.map((layer) => layer.id));
  if (!used.has(stem)) return stem;
  let suffix = 2;
  while (used.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

const ROLE_DEFAULTS = Object.freeze({
  background: Object.freeze({ name: "背景", depth: -100, parallax: 0.18, opacity: 0.72, blur: 3, fog: 0.45 }),
  midground: Object.freeze({ name: "中景", depth: -20, parallax: 0.58, opacity: 0.9, blur: 1, fog: 0.18 }),
  player: Object.freeze({ name: "玩家层", depth: 0, parallax: 1, opacity: 1, blur: 0, fog: 0 }),
  foreground: Object.freeze({ name: "前景", depth: 100, parallax: 1.22, opacity: 0.82, blur: 0, fog: 0.08 }),
  custom: Object.freeze({ name: "自定义图层", depth: 20, parallax: 0.85, opacity: 1, blur: 0, fog: 0 })
});

export function createSceneLayer(overrides = {}, layers = []) {
  if (!isRecord(overrides)) throw new Error("Scene layer overrides must be an object");
  const role = overrides.role || "custom";
  const roleDefaults = ROLE_DEFAULTS[role] || ROLE_DEFAULTS.custom;
  const layer = {
    id: overrides.id || makeLayerId(role, layers),
    name: overrides.name ?? roleDefaults.name,
    role,
    depth: overrides.depth ?? roleDefaults.depth,
    assets: clone(overrides.assets || [{ assetId: BUILTIN_PROCEDURAL_ASSET_ID, weight: 1 }]),
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? (role === "player"),
    parallax: overrides.parallax ?? roleDefaults.parallax,
    scale: overrides.scale ?? 1,
    opacity: overrides.opacity ?? roleDefaults.opacity,
    tint: overrides.tint ?? "#ffffff",
    blur: overrides.blur ?? roleDefaults.blur,
    fog: overrides.fog ?? roleDefaults.fog,
    blendMode: overrides.blendMode ?? "source-over",
    repeatX: overrides.repeatX ?? true,
    seamless: {
      mode: overrides.seamless?.mode ?? "tile",
      tileWidth: overrides.seamless?.tileWidth ?? 1280,
      overlap: overrides.seamless?.overlap ?? 0
    },
    seed: overrides.seed ?? `${role}-default`,
    range: {
      startX: overrides.range?.startX ?? null,
      endX: overrides.range?.endX ?? null
    },
    originX: overrides.originX ?? 0,
    spacing: overrides.spacing ?? 0,
    density: overrides.density ?? 1,
    drawCap: overrides.drawCap ?? 256
  };
  if (Object.hasOwn(overrides, "originY")) layer.originY = overrides.originY;
  const errors = validateSceneLayer(layer);
  if (errors.length) throw new Error(errors.join("\n"));
  return layer;
}

export function createDefaultScene() {
  const layers = [];
  for (const role of ["background", "midground", "player", "foreground"]) {
    layers.push(createSceneLayer({ role }, layers));
  }
  return { schemaVersion: SCENE_SCHEMA_VERSION, layers };
}

export const DEFAULT_SCENE = deepFreeze(createDefaultScene());

export function validateSceneLayer(layer, path = "layer") {
  if (!isRecord(layer)) return [`${path} must be an object`];
  const errors = unexpectedKeys(layer, LAYER_KEYS, path);
  for (const key of LAYER_KEYS) {
    if (!OPTIONAL_LAYER_KEYS.has(key) && !Object.hasOwn(layer, key)) errors.push(`${path}.${key} is required`);
  }
  if (typeof layer.id !== "string" || !layer.id.trim()) errors.push(`${path}.id must be a non-empty string`);
  if (typeof layer.name !== "string" || !layer.name.trim()) errors.push(`${path}.name must be a non-empty string`);
  if (!SCENE_LAYER_ROLES.includes(layer.role)) errors.push(`${path}.role is not supported: ${layer.role}`);
  if (!finiteInRange(layer.depth, -10000, 10000)) errors.push(`${path}.depth must be a number from -10000 to 10000`);
  if (!Array.isArray(layer.assets) || layer.assets.length === 0) {
    errors.push(`${path}.assets must contain at least one asset`);
  } else {
    for (const [index, asset] of layer.assets.entries()) {
      const assetPath = `${path}.assets[${index}]`;
      if (!isRecord(asset)) {
        errors.push(`${assetPath} must be an object`);
        continue;
      }
      errors.push(...unexpectedKeys(asset, ASSET_REF_KEYS, assetPath));
      if (typeof asset.assetId !== "string" || !asset.assetId.trim()) errors.push(`${assetPath}.assetId must be a non-empty string`);
      if (!finiteInRange(asset.weight, 0.0001, 100000)) errors.push(`${assetPath}.weight must be a positive number`);
    }
  }
  for (const key of ["visible", "locked", "repeatX"]) {
    if (typeof layer[key] !== "boolean") errors.push(`${path}.${key} must be true or false`);
  }
  if (!finiteInRange(layer.parallax, -4, 4)) errors.push(`${path}.parallax must be a number from -4 to 4`);
  if (!finiteInRange(layer.scale, 0.01, 16)) errors.push(`${path}.scale must be a number from 0.01 to 16`);
  if (!finiteInRange(layer.opacity, 0, 1)) errors.push(`${path}.opacity must be a number from 0 to 1`);
  if (typeof layer.tint !== "string" || !TINT_PATTERN.test(layer.tint)) errors.push(`${path}.tint must be a #rrggbb or #rrggbbaa color`);
  if (!finiteInRange(layer.blur, 0, 100)) errors.push(`${path}.blur must be a number from 0 to 100`);
  if (!finiteInRange(layer.fog, 0, 1)) errors.push(`${path}.fog must be a number from 0 to 1`);
  if (!SCENE_BLEND_MODES.includes(layer.blendMode)) errors.push(`${path}.blendMode is not supported: ${layer.blendMode}`);
  if (!isRecord(layer.seamless)) {
    errors.push(`${path}.seamless must be an object`);
  } else {
    errors.push(...unexpectedKeys(layer.seamless, SEAMLESS_KEYS, `${path}.seamless`));
    for (const key of SEAMLESS_KEYS) {
      if (!Object.hasOwn(layer.seamless, key)) errors.push(`${path}.seamless.${key} is required`);
    }
    if (!SCENE_SEAMLESS_MODES.includes(layer.seamless.mode)) errors.push(`${path}.seamless.mode is not supported: ${layer.seamless.mode}`);
    if (!finiteInRange(layer.seamless.tileWidth, 1, 100000)) errors.push(`${path}.seamless.tileWidth must be a number from 1 to 100000`);
    if (!finiteInRange(layer.seamless.overlap, 0, 100000)) errors.push(`${path}.seamless.overlap must be a number from 0 to 100000`);
    if (Number.isFinite(layer.seamless.tileWidth) && Number.isFinite(layer.seamless.overlap) && layer.seamless.overlap >= layer.seamless.tileWidth) {
      errors.push(`${path}.seamless.overlap must be smaller than tileWidth`);
    }
  }
  if (typeof layer.seed !== "string" || !layer.seed) errors.push(`${path}.seed must be a non-empty string`);
  if (!isRecord(layer.range)) {
    errors.push(`${path}.range must be an object`);
  } else {
    errors.push(...unexpectedKeys(layer.range, RANGE_KEYS, `${path}.range`));
    for (const key of RANGE_KEYS) {
      if (!Object.hasOwn(layer.range, key)) errors.push(`${path}.range.${key} is required`);
      if (layer.range[key] !== null && !Number.isFinite(layer.range[key])) errors.push(`${path}.range.${key} must be a number or null`);
    }
    if (Number.isFinite(layer.range.startX) && Number.isFinite(layer.range.endX) && layer.range.startX > layer.range.endX) {
      errors.push(`${path}.range.startX must not be greater than endX`);
    }
  }
  if (!finiteInRange(layer.originX, -10000000, 10000000)) errors.push(`${path}.originX must be a finite number`);
  if (layer.originY !== undefined && layer.originY !== null && !finiteInRange(layer.originY, -10000000, 10000000)) {
    errors.push(`${path}.originY must be a finite number or null`);
  }
  if (!finiteInRange(layer.spacing, -100000, 100000)) errors.push(`${path}.spacing must be a number from -100000 to 100000`);
  if (!finiteInRange(layer.density, 0.01, 100)) errors.push(`${path}.density must be a number from 0.01 to 100`);
  if (!Number.isInteger(layer.drawCap) || layer.drawCap < 1 || layer.drawCap > 4096) errors.push(`${path}.drawCap must be an integer from 1 to 4096`);
  return [...new Set(errors)];
}

export function sceneLayerBaselineY(layer, fallbackY) {
  if (Number.isFinite(layer?.originY)) return layer.originY;
  if (!Number.isFinite(fallbackY)) throw new Error("Scene layer fallback Y must be finite");
  return fallbackY;
}

export function validateScene(scene) {
  if (!isRecord(scene)) return ["scene must be an object"];
  const errors = unexpectedKeys(scene, SCENE_KEYS, "scene");
  if (scene.schemaVersion !== SCENE_SCHEMA_VERSION) errors.push(`Unsupported scene schema version: ${scene.schemaVersion}`);
  if (!Array.isArray(scene.layers)) return [...errors, "scene.layers must be an array"];
  const ids = new Set();
  let playerLayerCount = 0;
  for (const [index, layer] of scene.layers.entries()) {
    errors.push(...validateSceneLayer(layer, `scene.layers[${index}]`));
    if (layer?.id && ids.has(layer.id)) errors.push(`Duplicate scene layer id: ${layer.id}`);
    if (layer?.id) ids.add(layer.id);
    if (layer?.role === "player") {
      playerLayerCount += 1;
      if (layer.depth !== 0) errors.push(`${layer.id || "player layer"} must use depth 0`);
      if (layer.parallax !== 1) errors.push(`${layer.id || "player layer"} must use parallax 1`);
    }
  }
  if (playerLayerCount !== 1) errors.push("scene must contain exactly one player layer");
  return [...new Set(errors)];
}

function assertValidScene(scene) {
  const errors = validateScene(scene);
  if (errors.length) throw new Error(errors.join("\n"));
}

export function addSceneLayer(scene, overrides = {}) {
  assertValidScene(scene);
  const next = clone(scene);
  const layer = createSceneLayer(overrides, next.layers);
  if (layer.role === "player") throw new Error("scene already contains its required player layer");
  next.layers.push(layer);
  assertValidScene(next);
  return next;
}

export function updateSceneLayer(scene, layerId, changes = {}, { force = false } = {}) {
  assertValidScene(scene);
  const next = clone(scene);
  const index = next.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`Unknown scene layer: ${layerId}`);
  const current = next.layers[index];
  if (current.locked && !force && Object.keys(changes).some((key) => key !== "locked")) throw new Error(`Scene layer is locked: ${layerId}`);
  if (current.role === "player" && changes.role && changes.role !== "player") throw new Error("The player layer role cannot be changed");
  const merged = createSceneLayer({
    ...current,
    ...clone(changes),
    seamless: { ...current.seamless, ...(changes.seamless || {}) },
    range: { ...current.range, ...(changes.range || {}) }
  }, next.layers.filter((_, candidateIndex) => candidateIndex !== index));
  next.layers[index] = merged;
  assertValidScene(next);
  return next;
}

export function sortSceneLayers(scene, direction = "ascending") {
  assertValidScene(scene);
  if (!new Set(["ascending", "descending"]).has(direction)) throw new Error(`Unsupported sort direction: ${direction}`);
  const next = clone(scene);
  const factor = direction === "ascending" ? 1 : -1;
  next.layers = next.layers
    .map((layer, index) => ({ layer, index }))
    .sort((left, right) => (left.layer.depth - right.layer.depth) * factor || left.index - right.index)
    .map(({ layer }) => layer);
  return next;
}

export function moveSceneLayer(scene, layerId, targetIndex, { force = false } = {}) {
  assertValidScene(scene);
  if (!Number.isInteger(targetIndex)) throw new Error("Scene layer target index must be an integer");
  const next = clone(scene);
  const sourceIndex = next.layers.findIndex((layer) => layer.id === layerId);
  if (sourceIndex < 0) throw new Error(`Unknown scene layer: ${layerId}`);
  if (next.layers[sourceIndex].locked && !force) throw new Error(`Scene layer is locked: ${layerId}`);
  const boundedIndex = Math.max(0, Math.min(next.layers.length - 1, targetIndex));
  const [layer] = next.layers.splice(sourceIndex, 1);
  next.layers.splice(boundedIndex, 0, layer);
  return next;
}

export function duplicateSceneLayer(scene, layerId, overrides = {}) {
  assertValidScene(scene);
  const next = clone(scene);
  const sourceIndex = next.layers.findIndex((layer) => layer.id === layerId);
  if (sourceIndex < 0) throw new Error(`Unknown scene layer: ${layerId}`);
  const source = next.layers[sourceIndex];
  const duplicateRole = source.role === "player" ? "custom" : source.role;
  const duplicate = createSceneLayer({
    ...source,
    id: overrides.id,
    name: overrides.name || `${source.name} 副本`,
    role: overrides.role || duplicateRole,
    depth: overrides.depth ?? (source.depth + 1),
    locked: overrides.locked ?? false,
    seed: overrides.seed || `${source.seed}-copy`,
    ...clone(overrides)
  }, next.layers);
  next.layers.splice(sourceIndex + 1, 0, duplicate);
  assertValidScene(next);
  return next;
}

export function deleteSceneLayer(scene, layerId, { force = false } = {}) {
  assertValidScene(scene);
  const next = clone(scene);
  const index = next.layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) throw new Error(`Unknown scene layer: ${layerId}`);
  const layer = next.layers[index];
  if (layer.role === "player") throw new Error("The required player layer cannot be deleted");
  if (layer.locked && !force) throw new Error(`Scene layer is locked: ${layerId}`);
  next.layers.splice(index, 1);
  assertValidScene(next);
  return next;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chooseAsset(assets, seed, index) {
  const totalWeight = assets.reduce((sum, asset) => sum + asset.weight, 0);
  let value = (hashSeed(`${seed}:${index}:asset`) / 4294967296) * totalWeight;
  for (const asset of assets) {
    value -= asset.weight;
    if (value <= 0) return asset.assetId;
  }
  return assets.at(-1).assetId;
}

function placementFlip(layer, index) {
  if (layer.seamless.mode === "mirror") return Math.abs(index) % 2 === 1;
  if (layer.seamless.mode === "random") return Boolean(hashSeed(`${layer.seed}:${index}:flip`) & 1);
  return false;
}

export function calculateSeamlessPlacements(layer, {
  cameraX = 0,
  viewportWidth = 1280,
  overscan = 0,
  maxDraws = null
} = {}) {
  const errors = validateSceneLayer(layer);
  if (errors.length) throw new Error(errors.join("\n"));
  if (!Number.isFinite(cameraX)) throw new Error("cameraX must be finite");
  if (!finiteInRange(viewportWidth, 1, 100000)) throw new Error("viewportWidth must be a number from 1 to 100000");
  if (!finiteInRange(overscan, 0, 100000)) throw new Error("overscan must be a number from 0 to 100000");
  if (maxDraws !== null && (!Number.isInteger(maxDraws) || maxDraws < 1)) throw new Error("maxDraws must be a positive integer or null");
  if (!layer.visible) return { placements: [], candidateCount: 0, capped: false, step: 0, tileWidth: 0 };

  const tileWidth = layer.seamless.tileWidth * layer.scale;
  const overlap = layer.seamless.overlap * layer.scale;
  const step = Math.max(1, (tileWidth - overlap + layer.spacing) / layer.density);
  const center = cameraX * layer.parallax;
  const visibleLeft = center - viewportWidth / 2 - overscan;
  const visibleRight = center + viewportWidth / 2 + overscan;
  const rangeLeft = layer.range.startX ?? -Infinity;
  const rangeRight = layer.range.endX ?? Infinity;
  const clippedLeft = Math.max(visibleLeft, rangeLeft);
  const clippedRight = Math.min(visibleRight, rangeRight);
  if (clippedLeft > clippedRight) return { placements: [], candidateCount: 0, capped: false, step, tileWidth };

  const drawCap = Math.min(layer.drawCap, maxDraws ?? layer.drawCap);
  let firstIndex = 0;
  let lastIndex = -1;
  if (!layer.repeatX) {
    const placementX = layer.originX;
    if (placementX + tileWidth >= clippedLeft && placementX <= clippedRight) lastIndex = 0;
  } else {
    firstIndex = Math.ceil((clippedLeft - layer.originX - tileWidth) / step);
    lastIndex = Math.floor((clippedRight - layer.originX) / step);
  }
  const candidateCount = Math.max(0, lastIndex - firstIndex + 1);
  let selectedFirstIndex = firstIndex;
  let selectedCount = candidateCount;
  if (candidateCount > drawCap) {
    const centerIndex = Math.round((center - layer.originX - tileWidth / 2) / step);
    selectedFirstIndex = Math.max(firstIndex, Math.min(lastIndex - drawCap + 1, centerIndex - Math.floor((drawCap - 1) / 2)));
    selectedCount = drawCap;
  }
  const indexes = Array.from({ length: selectedCount }, (_, offset) => selectedFirstIndex + offset);
  const placements = indexes
    .map((index) => ({
      index,
      x: layer.originX + index * step,
      assetId: chooseAsset(layer.assets, layer.seed, index),
      flipX: placementFlip(layer, index),
      width: tileWidth
    }))
    .filter((placement) => placement.x + tileWidth >= clippedLeft && placement.x <= clippedRight)
    .filter((placement) => placement.x + tileWidth >= rangeLeft && placement.x <= rangeRight);
  return {
    placements,
    candidateCount,
    capped: candidateCount > placements.length,
    step,
    tileWidth
  };
}
