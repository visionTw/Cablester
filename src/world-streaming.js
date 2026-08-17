const DEFAULT_CELL_SIZE = 2048;
const DEFAULT_CACHE_BUDGET_BYTES = 96 * 1024 * 1024;
const DEFAULT_MEMORY_BYTES = 512 * 1024;
const DEFAULT_MAXIMUM_WORLD_COORDINATE = 1_000_000_000;
const DEFAULT_MAXIMUM_CELLS_PER_ENTRY = 65_536;
const DEFAULT_MAXIMUM_CELL_MEMBERSHIPS = 1_000_000;

export const STREAMING_STATES = Object.freeze([
  "unloaded",
  "prefetch",
  "warm",
  "active",
  "keep-alive"
]);

export const WORLD_LOD_LEVELS = Object.freeze({
  INDEX_ONLY: "index-only",
  PROXY: "proxy",
  LOCAL_DETAIL: "local-detail"
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

export class WorldSpatialBudgetError extends RangeError {
  constructor(message, details = {}) {
    super(message);
    this.name = "WorldSpatialBudgetError";
    this.code = "WORLD_SPATIAL_BUDGET_EXCEEDED";
    this.details = details;
  }
}

export function normalizeBounds(bounds = {}) {
  const x = finite(bounds.x ?? bounds.left);
  const y = finite(bounds.y ?? bounds.top);
  const width = Math.max(0, finite(bounds.w ?? bounds.width, 0));
  const height = Math.max(0, finite(bounds.h ?? bounds.height, 0));
  return { x, y, w: width, h: height };
}

export function normalizeTransform(transform = {}) {
  return {
    position: {
      x: finite(transform.position?.x ?? transform.x),
      y: finite(transform.position?.y ?? transform.y)
    },
    rotationDegrees: finite(transform.rotationDegrees ?? transform.rotation),
    scale: {
      x: finite(transform.scale?.x, 1),
      y: finite(transform.scale?.y, 1)
    }
  };
}

export function applyTransform(point, transform = {}) {
  const normalized = normalizeTransform(transform);
  const radians = normalized.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scaledX = finite(point?.x) * normalized.scale.x;
  const scaledY = finite(point?.y) * normalized.scale.y;
  return {
    x: normalized.position.x + scaledX * cosine - scaledY * sine,
    y: normalized.position.y + scaledX * sine + scaledY * cosine
  };
}

export function invertTransform(point, transform = {}) {
  const normalized = normalizeTransform(transform);
  const radians = -normalized.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const translatedX = finite(point?.x) - normalized.position.x;
  const translatedY = finite(point?.y) - normalized.position.y;
  const rotatedX = translatedX * cosine - translatedY * sine;
  const rotatedY = translatedX * sine + translatedY * cosine;
  return {
    x: normalized.scale.x === 0 ? 0 : rotatedX / normalized.scale.x,
    y: normalized.scale.y === 0 ? 0 : rotatedY / normalized.scale.y
  };
}

export function applyTransformChain(point, transforms = []) {
  return transforms.reduceRight((result, transform) => applyTransform(result, transform), {
    x: finite(point?.x),
    y: finite(point?.y)
  });
}

export function invertTransformChain(point, transforms = []) {
  return transforms.reduce((result, transform) => invertTransform(result, transform), {
    x: finite(point?.x),
    y: finite(point?.y)
  });
}

export function transformBounds(bounds, transforms = []) {
  const normalized = normalizeBounds(bounds);
  const corners = [
    { x: normalized.x, y: normalized.y },
    { x: normalized.x + normalized.w, y: normalized.y },
    { x: normalized.x, y: normalized.y + normalized.h },
    { x: normalized.x + normalized.w, y: normalized.y + normalized.h }
  ].map((point) => applyTransformChain(point, transforms));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function boundsIntersect(first, second) {
  const a = normalizeBounds(first);
  const b = normalizeBounds(second);
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function expandBounds(bounds, amount) {
  const normalized = normalizeBounds(bounds);
  const padding = Math.max(0, finite(amount));
  return {
    x: normalized.x - padding,
    y: normalized.y - padding,
    w: normalized.w + padding * 2,
    h: normalized.h + padding * 2
  };
}

export function pointInBounds(point, bounds) {
  const normalized = normalizeBounds(bounds);
  return finite(point?.x) >= normalized.x
    && finite(point?.x) <= normalized.x + normalized.w
    && finite(point?.y) >= normalized.y
    && finite(point?.y) <= normalized.y + normalized.h;
}

function distanceToBounds(point, bounds) {
  const normalized = normalizeBounds(bounds);
  const x = Math.max(normalized.x, Math.min(finite(point?.x), normalized.x + normalized.w));
  const y = Math.max(normalized.y, Math.min(finite(point?.y), normalized.y + normalized.h));
  return Math.hypot(finite(point?.x) - x, finite(point?.y) - y);
}

function objectLocalBounds(object) {
  const properties = object?.properties || {};
  const width = Math.max(8, finite(properties.w ?? properties.width ?? properties.radius * 2, 32));
  const height = Math.max(8, finite(properties.h ?? properties.height ?? properties.radius * 2, 32));
  const position = normalizeTransform(object?.transform).position;
  return { x: position.x - width / 2, y: position.y - height / 2, w: width, h: height };
}

export class SpatialGridIndex {
  constructor({
    cellSize = DEFAULT_CELL_SIZE,
    maximumWorldCoordinate = DEFAULT_MAXIMUM_WORLD_COORDINATE,
    maximumCellsPerEntry = DEFAULT_MAXIMUM_CELLS_PER_ENTRY,
    maximumCellMemberships = DEFAULT_MAXIMUM_CELL_MEMBERSHIPS
  } = {}) {
    this.cellSize = positive(cellSize, DEFAULT_CELL_SIZE);
    this.maximumWorldCoordinate = positive(maximumWorldCoordinate, DEFAULT_MAXIMUM_WORLD_COORDINATE);
    this.maximumCellsPerEntry = positiveInteger(maximumCellsPerEntry, DEFAULT_MAXIMUM_CELLS_PER_ENTRY);
    this.maximumCellMemberships = positiveInteger(maximumCellMemberships, DEFAULT_MAXIMUM_CELL_MEMBERSHIPS);
    this.cellMemberships = 0;
    this.cells = new Map();
    this.entries = new Map();
  }

  #keysForBounds(bounds) {
    const normalized = normalizeBounds(bounds);
    const maximumEndpoint = Math.max(
      Math.abs(normalized.x),
      Math.abs(normalized.y),
      Math.abs(normalized.x + normalized.w),
      Math.abs(normalized.y + normalized.h)
    );
    if (!Number.isFinite(maximumEndpoint) || maximumEndpoint > this.maximumWorldCoordinate) {
      throw new WorldSpatialBudgetError("Spatial bounds exceed the supported world coordinate range", {
        bounds: normalized,
        maximumWorldCoordinate: this.maximumWorldCoordinate
      });
    }
    const startX = Math.floor(normalized.x / this.cellSize);
    const startY = Math.floor(normalized.y / this.cellSize);
    const endX = normalized.w === 0
      ? startX
      : Math.ceil((normalized.x + normalized.w) / this.cellSize) - 1;
    const endY = normalized.h === 0
      ? startY
      : Math.ceil((normalized.y + normalized.h) / this.cellSize) - 1;
    const columns = endX - startX + 1;
    const rows = endY - startY + 1;
    const cellCount = columns * rows;
    if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)
      || !Number.isSafeInteger(cellCount) || columns <= 0 || rows <= 0
      || cellCount > this.maximumCellsPerEntry) {
      throw new WorldSpatialBudgetError("Spatial bounds exceed the per-entry grid-cell budget", {
        bounds: normalized,
        columns,
        rows,
        cellCount,
        maximumCellsPerEntry: this.maximumCellsPerEntry
      });
    }
    const keys = [];
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  insert(entry) {
    if (!entry?.id) throw new TypeError("Spatial index entries require a stable id");
    const normalized = { ...entry, bounds: normalizeBounds(entry.bounds) };
    const keys = this.#keysForBounds(normalized.bounds);
    const existingMemberships = this.entries.get(normalized.id)?.cellKeys.length || 0;
    const nextMemberships = this.cellMemberships - existingMemberships + keys.length;
    if (!Number.isSafeInteger(nextMemberships) || nextMemberships > this.maximumCellMemberships) {
      throw new WorldSpatialBudgetError("Spatial index exceeds the aggregate grid-cell membership budget", {
        entryId: normalized.id,
        nextMemberships,
        maximumCellMemberships: this.maximumCellMemberships
      });
    }
    this.remove(entry.id);
    this.entries.set(normalized.id, { ...normalized, cellKeys: keys });
    this.cellMemberships += keys.length;
    for (const key of keys) {
      if (!this.cells.has(key)) this.cells.set(key, new Set());
      this.cells.get(key).add(normalized.id);
    }
    return normalized;
  }

  remove(id) {
    const existing = this.entries.get(id);
    if (!existing) return false;
    for (const key of existing.cellKeys) {
      const cell = this.cells.get(key);
      cell?.delete(id);
      if (cell?.size === 0) this.cells.delete(key);
    }
    this.cellMemberships -= existing.cellKeys.length;
    this.entries.delete(id);
    return true;
  }

  get(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const { cellKeys: _cellKeys, ...copy } = entry;
    return copy;
  }

  query(bounds, predicate = null) {
    const queryBounds = normalizeBounds(bounds);
    const ids = new Set();
    for (const key of this.#keysForBounds(queryBounds)) {
      for (const id of this.cells.get(key) || []) ids.add(id);
    }
    const matches = [];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry || !boundsIntersect(entry.bounds, queryBounds) || (predicate && !predicate(entry))) continue;
      const { cellKeys: _cellKeys, ...copy } = entry;
      matches.push(copy);
    }
    return matches;
  }

  values() {
    return [...this.entries.values()].map(({ cellKeys: _cellKeys, ...entry }) => entry);
  }

  get size() {
    return this.entries.size;
  }

  stats() {
    let maximumCellOccupancy = 0;
    let totalCellOccupancy = 0;
    for (const cell of this.cells.values()) {
      maximumCellOccupancy = Math.max(maximumCellOccupancy, cell.size);
      totalCellOccupancy += cell.size;
    }
    return {
      entries: this.entries.size,
      cells: this.cells.size,
      cellMemberships: this.cellMemberships,
      maximumCellOccupancy,
      averageCellOccupancy: this.cells.size ? totalCellOccupancy / this.cells.size : 0
    };
  }
}

export class WorldSpatialIndex {
  constructor(world, {
    cellSize = DEFAULT_CELL_SIZE,
    maximumWorldCoordinate,
    maximumCellsPerEntry,
    maximumCellMemberships
  } = {}) {
    this.worldId = world?.manifest?.worldId || "unknown-world";
    const budgets = { maximumWorldCoordinate, maximumCellsPerEntry, maximumCellMemberships };
    this.chunkIndex = new SpatialGridIndex({ cellSize, ...budgets });
    this.objectIndex = new SpatialGridIndex({ cellSize: Math.max(256, cellSize / 4), ...budgets });
    this.regions = new Map();
    this.chunks = new Map();
    this.objects = new Map();
    this.#build(world);
  }

  #build(world) {
    for (const region of world?.regions || []) {
      const regionTransform = normalizeTransform(region.transform);
      const regionBounds = transformBounds(region.bounds, [regionTransform]);
      this.regions.set(region.id, { region, bounds: regionBounds, transformChain: [regionTransform] });
      for (const chunk of region.chunks || []) {
        const chunkTransform = normalizeTransform(chunk.transform);
        const transforms = [regionTransform, chunkTransform];
        const bounds = transformBounds(chunk.bounds, transforms);
        const record = { id: chunk.id, regionId: region.id, region, chunk, bounds, transforms };
        this.chunks.set(chunk.id, record);
        this.chunkIndex.insert({ ...record, kind: "chunk" });
        for (const object of chunk.objects || []) {
          const objectTransforms = [...transforms, normalizeTransform(object.transform)];
          const objectBounds = transformBounds(objectLocalBounds({
            ...object,
            transform: { ...normalizeTransform(object.transform), position: { x: 0, y: 0 } }
          }), objectTransforms);
          const objectRecord = {
            id: object.id,
            regionId: region.id,
            chunkId: chunk.id,
            region,
            chunk,
            object,
            bounds: objectBounds,
            worldPosition: applyTransformChain({ x: 0, y: 0 }, objectTransforms),
            transforms: objectTransforms
          };
          this.objects.set(object.id, objectRecord);
          this.objectIndex.insert({ ...objectRecord, kind: "object" });
        }
      }
    }
  }

  queryChunks(viewport, options) {
    return this.chunkIndex.query(expandBounds(viewport, options?.overscan || 0));
  }

  queryObjects(viewport, options) {
    return this.objectIndex.query(expandBounds(viewport, options?.overscan || 0));
  }

  chunkAt(point) {
    const matches = this.chunkIndex.query({ x: finite(point?.x), y: finite(point?.y), w: 0.001, h: 0.001 });
    return matches.sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h)[0] || null;
  }

  stats() {
    return {
      regions: this.regions.size,
      chunks: this.chunkIndex.stats(),
      objects: this.objectIndex.stats()
    };
  }
}

export function buildWorldSpatialIndex(world, options) {
  return new WorldSpatialIndex(world, options);
}

export function lodForZoom(zoom) {
  const value = positive(zoom, 1);
  if (value >= 0.72) return WORLD_LOD_LEVELS.LOCAL_DETAIL;
  if (value >= 0.2) return WORLD_LOD_LEVELS.PROXY;
  return WORLD_LOD_LEVELS.INDEX_ONLY;
}

export function queryVisibleWorld(index, viewport, { zoom = 1, overscan = 96 } = {}) {
  const lod = lodForZoom(zoom);
  const chunks = index.queryChunks(viewport, { overscan });
  const objects = lod === WORLD_LOD_LEVELS.INDEX_ONLY
    ? []
    : index.queryObjects(viewport, { overscan }).filter((object) => (
      lod === WORLD_LOD_LEVELS.LOCAL_DETAIL || ["spawn", "goal", "checkpoint", "roomEntrance", "roomExit", "gate", "abilityPickup"].includes(object.object?.type)
    ));
  return {
    lod,
    chunks,
    objects,
    culledChunkCount: Math.max(0, index.chunkIndex.size - chunks.length),
    culledObjectCount: Math.max(0, index.objectIndex.size - objects.length)
  };
}

function connectionTargetIds(connection, ownChunkId) {
  const endpoints = [
    connection?.from,
    connection?.to,
    connection?.a,
    connection?.b,
    ...(Array.isArray(connection?.endpoints) ? connection.endpoints : [])
  ];
  const ids = new Set([
    connection?.targetChunkId,
    connection?.toChunkId,
    connection?.chunkId,
    ...endpoints.map((endpoint) => endpoint?.chunkId ?? endpoint?.id)
  ].filter(Boolean).map(String));
  ids.delete(String(ownChunkId));
  return [...ids];
}

function chunkMemoryBytes(chunk) {
  const streaming = chunk?.streaming || {};
  if (Number.isFinite(Number(streaming.memoryEstimateBytes))) return Math.max(0, Number(streaming.memoryEstimateBytes));
  if (Number.isFinite(Number(streaming.estimatedMemoryBytes))) return Math.max(0, Number(streaming.estimatedMemoryBytes));
  if (Number.isFinite(Number(streaming.estimatedMemoryMb))) return Math.max(0, Number(streaming.estimatedMemoryMb) * 1024 * 1024);
  if (Number.isFinite(Number(streaming.memoryEstimateMb))) return Math.max(0, Number(streaming.memoryEstimateMb) * 1024 * 1024);
  return DEFAULT_MEMORY_BYTES + (chunk?.objects?.length || 0) * 4096;
}

function desiredPriority(state) {
  return { unloaded: 0, "keep-alive": 1, prefetch: 2, warm: 3, active: 4 }[state] || 0;
}

function strongestState(first, second) {
  return desiredPriority(first) >= desiredPriority(second) ? first : second;
}

export class WorldStreamingSimulator {
  constructor(world, {
    spatialIndex = buildWorldSpatialIndex(world),
    loader = async (record) => ({ chunkId: record.id }),
    cacheBudgetBytes = DEFAULT_CACHE_BUDGET_BYTES,
    now = () => globalThis.performance?.now?.() ?? Date.now()
  } = {}) {
    this.world = world;
    this.spatialIndex = spatialIndex;
    this.loader = loader;
    this.cacheBudgetBytes = positive(cacheBudgetBytes, DEFAULT_CACHE_BUDGET_BYTES);
    this.now = now;
    this.entries = new Map();
    this.cache = new Map();
    this.adjacency = new Map([...spatialIndex.chunks.keys()].map((id) => [id, new Set()]));
    this.pending = new Set();
    this.generation = 0;
    this.metrics = {
      requests: 0,
      completedLoads: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lateResultsDiscarded: 0,
      unloads: 0,
      teleports: 0,
      directionPrefetches: 0,
      estimatedMemoryBytes: 0,
      cachedMemoryBytes: 0,
      peakEstimatedMemoryBytes: 0
    };
    for (const record of spatialIndex.chunks.values()) {
      this.entries.set(record.id, {
        id: record.id,
        record,
        state: "unloaded",
        desiredState: "unloaded",
        loading: false,
        data: null,
        requestToken: 0,
        desiredAt: -Infinity,
        lastActiveAt: -Infinity,
        keepAliveUntil: -Infinity,
        loadedAt: null
      });
      for (const connection of record.chunk.connections || []) {
        const from = String(connection?.from?.chunkId || record.id);
        const to = String(connection?.to?.chunkId || "");
        if (!this.adjacency.has(from) || !this.adjacency.has(to) || from === to) continue;
        this.adjacency.get(from).add(to);
        if (!connection.oneWay) this.adjacency.get(to).add(from);
      }
    }
    this.lastPosition = null;
  }

  #settings(entry) {
    const streaming = entry.record.chunk.streaming || {};
    return {
      prefetchDistance: Math.max(0, finite(streaming.prefetchDistance ?? streaming.prefetchRadius, 960)),
      hysteresisDistance: Math.max(0, finite(streaming.hysteresis ?? streaming.hysteresisDistance, 320)),
      unloadDelayMs: Math.max(0, finite(streaming.unloadDelayMs, finite(streaming.unloadDelaySeconds, 1.5) * 1000)),
      keepAliveMs: streaming.keepAlive === true
        ? Number.POSITIVE_INFINITY
        : Math.max(0, finite(streaming.keepAliveMs, finite(streaming.keepAliveSeconds, 0) * 1000)),
      memoryBytes: chunkMemoryBytes(entry.record.chunk)
    };
  }

  #markDesired(desired, id, state) {
    if (!this.entries.has(id)) return;
    desired.set(id, strongestState(desired.get(id) || "unloaded", state));
  }

  #activeChunk(position, explicitId) {
    if (explicitId && this.entries.has(explicitId)) return this.entries.get(explicitId).record;
    return this.spatialIndex.chunkAt(position);
  }

  #buildDesired(position, velocity, activeChunkId) {
    const desired = new Map();
    const active = this.#activeChunk(position, activeChunkId);
    if (active) {
      this.#markDesired(desired, active.id, "active");
      for (const targetId of this.adjacency.get(active.id) || []) this.#markDesired(desired, targetId, "prefetch");
    }
    for (const entry of this.entries.values()) {
      const settings = this.#settings(entry);
      const distance = distanceToBounds(position, entry.record.bounds);
      if (distance <= settings.prefetchDistance * 0.45) this.#markDesired(desired, entry.id, "warm");
      else if (distance <= settings.prefetchDistance) this.#markDesired(desired, entry.id, "prefetch");
      if (entry.state !== "unloaded" && distance <= settings.prefetchDistance + settings.hysteresisDistance) {
        this.#markDesired(desired, entry.id, entry.state === "active" ? "warm" : entry.state);
      }
    }
    const speed = Math.hypot(finite(velocity?.x), finite(velocity?.y));
    if (speed > 1) {
      const leadSeconds = Math.min(2.5, Math.max(0.4, speed / 900));
      const predicted = {
        x: finite(position?.x) + finite(velocity?.x) * leadSeconds,
        y: finite(position?.y) + finite(velocity?.y) * leadSeconds
      };
      const directionRadius = Math.min(4096, 640 + speed * 1.3);
      for (const record of this.spatialIndex.queryChunks({
        x: predicted.x - directionRadius,
        y: predicted.y - directionRadius,
        w: directionRadius * 2,
        h: directionRadius * 2
      })) {
        const centerX = record.bounds.x + record.bounds.w / 2 - finite(position?.x);
        const centerY = record.bounds.y + record.bounds.h / 2 - finite(position?.y);
        const dot = centerX * finite(velocity?.x) + centerY * finite(velocity?.y);
        if (dot > 0 && !desired.has(record.id)) {
          this.#markDesired(desired, record.id, "prefetch");
          this.metrics.directionPrefetches += 1;
        }
      }
    }
    return { desired, active };
  }

  #restoreFromCache(entry, state, timestamp) {
    const cached = this.cache.get(entry.id);
    if (!cached) return false;
    this.cache.delete(entry.id);
    entry.data = cached.data;
    entry.loadedAt = timestamp;
    entry.loading = false;
    entry.state = state;
    this.metrics.cacheHits += 1;
    this.#recalculateMemory();
    return true;
  }

  #request(entry, timestamp) {
    if (entry.loading || entry.data) return;
    if (this.#restoreFromCache(entry, entry.desiredState, timestamp)) return;
    this.metrics.cacheMisses += 1;
    this.metrics.requests += 1;
    const token = ++entry.requestToken;
    entry.loading = true;
    const promise = Promise.resolve().then(() => this.loader(entry.record, {
      requestToken: token,
      generation: this.generation,
      desiredState: entry.desiredState
    })).then((data) => {
      if (entry.requestToken !== token || entry.desiredState === "unloaded") {
        this.metrics.lateResultsDiscarded += 1;
        return;
      }
      entry.loading = false;
      entry.data = data ?? { chunkId: entry.id };
      entry.loadedAt = this.now();
      entry.state = entry.desiredState;
      this.metrics.completedLoads += 1;
      this.#recalculateMemory();
    }).catch((error) => {
      if (entry.requestToken !== token) return;
      entry.loading = false;
      entry.error = String(error?.message || error);
      entry.state = "unloaded";
    }).finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  #cacheEntry(entry, timestamp) {
    if (!entry.data) return;
    const memoryBytes = this.#settings(entry).memoryBytes;
    this.cache.delete(entry.id);
    this.cache.set(entry.id, { data: entry.data, memoryBytes, usedAt: timestamp });
    entry.data = null;
    while ([...this.cache.values()].reduce((sum, item) => sum + item.memoryBytes, 0) > this.cacheBudgetBytes) {
      const oldestId = this.cache.keys().next().value;
      if (oldestId === undefined) break;
      this.cache.delete(oldestId);
    }
  }

  #unload(entry, timestamp) {
    entry.requestToken += 1;
    entry.loading = false;
    this.#cacheEntry(entry, timestamp);
    entry.state = "unloaded";
    entry.desiredState = "unloaded";
    entry.loadedAt = null;
    this.metrics.unloads += 1;
  }

  #recalculateMemory() {
    this.metrics.estimatedMemoryBytes = [...this.entries.values()]
      .filter((entry) => entry.data)
      .reduce((sum, entry) => sum + this.#settings(entry).memoryBytes, 0);
    this.metrics.cachedMemoryBytes = [...this.cache.values()].reduce((sum, item) => sum + item.memoryBytes, 0);
    this.metrics.peakEstimatedMemoryBytes = Math.max(
      this.metrics.peakEstimatedMemoryBytes,
      this.metrics.estimatedMemoryBytes
    );
  }

  update({ position, velocity = { x: 0, y: 0 }, activeChunkId = null, now = this.now(), teleport = false } = {}) {
    const safePosition = { x: finite(position?.x), y: finite(position?.y) };
    if (teleport || (this.lastPosition && Math.hypot(
      safePosition.x - this.lastPosition.x,
      safePosition.y - this.lastPosition.y
    ) > 8192)) this.metrics.teleports += 1;
    this.lastPosition = safePosition;
    this.generation += 1;
    const { desired, active } = this.#buildDesired(safePosition, velocity, activeChunkId);

    for (const entry of this.entries.values()) {
      const requestedState = desired.get(entry.id) || "unloaded";
      const settings = this.#settings(entry);
      if (requestedState !== "unloaded") {
        entry.desiredAt = now;
        if (requestedState === "active") {
          entry.lastActiveAt = now;
          entry.keepAliveUntil = Math.max(entry.keepAliveUntil, now + settings.keepAliveMs);
        }
        entry.desiredState = requestedState;
        entry.state = requestedState;
        this.#request(entry, now);
        continue;
      }

      const unloadAt = entry.desiredAt + settings.unloadDelayMs;
      const keepAliveUntil = Math.max(entry.keepAliveUntil, unloadAt);
      if ((entry.data || entry.loading) && now < keepAliveUntil) {
        entry.desiredState = "keep-alive";
        entry.state = "keep-alive";
      } else if (entry.state !== "unloaded" || entry.loading || entry.data) {
        this.#unload(entry, now);
      }
    }
    this.#recalculateMemory();
    return { activeChunkId: active?.id || null, ...this.snapshot() };
  }

  async settle() {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
    return this.snapshot();
  }

  invalidate(chunkId = null) {
    const targets = chunkId ? [this.entries.get(chunkId)].filter(Boolean) : [...this.entries.values()];
    for (const entry of targets) {
      entry.requestToken += 1;
      entry.loading = false;
      entry.data = null;
      entry.state = "unloaded";
      entry.desiredState = "unloaded";
      this.cache.delete(entry.id);
    }
    this.#recalculateMemory();
  }

  snapshot() {
    const states = Object.fromEntries(STREAMING_STATES.map((state) => [state, 0]));
    const chunks = [...this.entries.values()].map((entry) => {
      states[entry.state] += 1;
      return {
        id: entry.id,
        regionId: entry.record.regionId,
        state: entry.state,
        desiredState: entry.desiredState,
        loading: entry.loading,
        cached: this.cache.has(entry.id),
        memoryBytes: this.#settings(entry).memoryBytes,
        error: entry.error || null
      };
    });
    return {
      generation: this.generation,
      chunks,
      states,
      cacheEntries: this.cache.size,
      metrics: { ...this.metrics }
    };
  }
}

export function createWorldStreamingSimulator(world, options) {
  return new WorldStreamingSimulator(world, options);
}
