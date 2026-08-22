import { createLevelObject, getLevelObjectBounds } from "./level-objects.js";
import { addSceneLayer } from "./scene-layers.js";

export const TERRAIN_TOOLS = Object.freeze({
  platform: Object.freeze({ id: "platform", label: "连续平台" }),
  slope: Object.freeze({ id: "slope", label: "斜面" }),
  erase: Object.freeze({ id: "erase", label: "擦除地形" })
});

export const TERRAIN_STAMPS = Object.freeze([
  Object.freeze({ id: "ascending-steps", label: "上升台阶", summary: "四段平台组成清晰的上升节奏。" }),
  Object.freeze({ id: "hazard-corridor", label: "危险走廊", summary: "安全起落台与中央荆棘组合。" }),
  Object.freeze({ id: "root-arch-island", label: "根桥地标", summary: "平台、检查点与单个中景地标。" })
]);

const STAMP_IDS = new Set(TERRAIN_STAMPS.map((stamp) => stamp.id));
const DEFAULT_GRID = 20;

function clone(value) {
  return structuredClone(value);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback, minimum = 1) {
  return Math.max(minimum, finite(value, fallback));
}

function normalizePoint(point, { snap = false, grid = DEFAULT_GRID } = {}) {
  const step = positive(grid, DEFAULT_GRID);
  const x = finite(point?.x);
  const y = finite(point?.y);
  return {
    x: snap ? Math.round(x / step) * step : Math.round(x),
    y: snap ? Math.round(y / step) * step : Math.round(y)
  };
}

function distance(left, right) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function sampleTerrainStroke(points, spacing = DEFAULT_GRID) {
  const source = (Array.isArray(points) ? points : [])
    .map((point) => ({ x: finite(point?.x), y: finite(point?.y) }));
  if (source.length === 0) return [];
  const step = positive(spacing, DEFAULT_GRID);
  const sampled = [source[0]];
  let cursor = source[0];
  let carry = 0;
  for (let index = 1; index < source.length; index += 1) {
    const target = source[index];
    let segmentLength = distance(cursor, target);
    if (segmentLength === 0) continue;
    while (carry + segmentLength >= step) {
      const amount = (step - carry) / segmentLength;
      cursor = {
        x: cursor.x + (target.x - cursor.x) * amount,
        y: cursor.y + (target.y - cursor.y) * amount
      };
      sampled.push(cursor);
      segmentLength = distance(cursor, target);
      carry = 0;
      if (segmentLength < 0.0001) break;
    }
    carry += segmentLength;
    cursor = target;
  }
  const last = source[source.length - 1];
  if (distance(sampled[sampled.length - 1], last) > step * 0.2) sampled.push(last);
  return sampled;
}

function intersects(left, right, padding = 0) {
  return left.x <= right.x + right.w + padding
    && left.x + left.w >= right.x - padding
    && left.y <= right.y + right.h + padding
    && left.y + left.h >= right.y - padding;
}

function createPlatformObjects(document, points, options) {
  const width = positive(options.width, 120, 20);
  const depth = positive(options.depth, 60, 20);
  const normalized = points.map((point) => normalizePoint(point, options));
  const samples = sampleTerrainStroke(normalized, Math.max(12, Math.min(width * 0.62, positive(options.spacing, 40))));
  const created = [];
  const objects = [...document.objects];
  for (const sample of samples) {
    const origin = normalizePoint({ x: sample.x - width / 2, y: sample.y }, options);
    const platform = createLevelObject("platform", origin.x, origin.y, [...objects, ...created], {
      properties: { w: Math.round(width), h: Math.round(depth) }
    });
    created.push(platform);
  }
  return created;
}

function createSlopeObjects(document, points, options) {
  if (points.length === 0) return [];
  const start = normalizePoint(points[0], options);
  const end = normalizePoint(points[points.length - 1], options);
  if (distance(start, end) < 4) return [];
  return [createLevelObject("slope", start.x, start.y, document.objects, {
    properties: {
      dx: end.x - start.x,
      dy: end.y - start.y,
      thickness: Math.round(positive(options.depth, 14, 2)),
      grapple: true
    }
  })];
}

function eraseTerrainObjects(document, points, options) {
  const radius = positive(options.width, 80, 8) / 2;
  const normalized = sampleTerrainStroke(points.map((point) => normalizePoint(point, options)), Math.max(8, radius * 0.6));
  const erasableTypes = new Set(options.erasableTypes || ["platform", "slope"]);
  const removedIds = [];
  const objects = document.objects.filter((object) => {
    if (!erasableTypes.has(object.type)) return true;
    const bounds = getLevelObjectBounds(object);
    const hit = normalized.some((point) => intersects(bounds, { x: point.x, y: point.y, w: 0, h: 0 }, radius));
    if (hit) removedIds.push(object.id);
    return !hit;
  });
  return { objects, removedIds };
}

export function applyTerrainStroke(document, {
  tool = "platform",
  points = [],
  width = 120,
  depth = 60,
  spacing = 40,
  snap = false,
  grid = DEFAULT_GRID,
  erasableTypes
} = {}) {
  if (!TERRAIN_TOOLS[tool]) throw new Error(`Unknown terrain tool: ${tool}`);
  const next = clone(document);
  const sourcePoints = Array.isArray(points) ? points : [];
  if (sourcePoints.length === 0) return { document: next, createdIds: [], removedIds: [] };
  const options = { width, depth, spacing, snap, grid, erasableTypes };
  if (tool === "erase") {
    const erased = eraseTerrainObjects(next, sourcePoints, options);
    next.objects = erased.objects;
    return { document: next, createdIds: [], removedIds: erased.removedIds };
  }
  const created = tool === "slope"
    ? createSlopeObjects(next, sourcePoints, options)
    : createPlatformObjects(next, sourcePoints, options);
  next.objects.push(...created);
  return { document: next, createdIds: created.map((object) => object.id), removedIds: [] };
}

function appendObject(next, type, anchor, offset, properties = {}) {
  const object = createLevelObject(type, anchor.x + offset.x, anchor.y + offset.y, next.objects, { properties });
  next.objects.push(object);
  return object.id;
}

export function applyTerrainStamp(document, stampId, point, { snap = false, grid = DEFAULT_GRID } = {}) {
  if (!STAMP_IDS.has(stampId)) throw new Error(`Unknown terrain stamp: ${stampId}`);
  const next = clone(document);
  const anchor = normalizePoint(point, { snap, grid });
  const createdIds = [];
  const sceneLayerIds = [];
  if (stampId === "ascending-steps") {
    for (const [x, y, w] of [[0, 0, 180], [200, -80, 180], [400, -160, 180], [600, -240, 220]]) {
      createdIds.push(appendObject(next, "platform", anchor, { x, y }, { w, h: 60 }));
    }
  } else if (stampId === "hazard-corridor") {
    createdIds.push(appendObject(next, "platform", anchor, { x: 0, y: 0 }, { w: 180, h: 70 }));
    createdIds.push(appendObject(next, "hazard", anchor, { x: 180, y: 40 }, { w: 360, h: 30, damage: 1, direction: "up" }));
    createdIds.push(appendObject(next, "platform", anchor, { x: 540, y: 0 }, { w: 180, h: 70 }));
  } else if (stampId === "root-arch-island") {
    createdIds.push(appendObject(next, "platform", anchor, { x: 0, y: 0 }, { w: 420, h: 80 }));
    createdIds.push(appendObject(next, "checkpoint", anchor, { x: 185, y: -90 }));
    next.scene = addSceneLayer(next.scene, {
      name: "根桥地标",
      role: "midground",
      depth: -12,
      assets: [{ assetId: "scene:root-stone-arch", weight: 1 }],
      repeatX: false,
      originX: anchor.x + 82,
      originY: anchor.y,
      seamless: { mode: "tile", tileWidth: 256, overlap: 0 },
      seed: `root-arch-${Math.round(anchor.x)}-${Math.round(anchor.y)}`,
      range: { startX: anchor.x + 82, endX: anchor.x + 338 },
      spacing: 0,
      density: 1,
      drawCap: 1
    });
    sceneLayerIds.push(next.scene.layers[next.scene.layers.length - 1].id);
  }
  return { document: next, createdIds, sceneLayerIds };
}
