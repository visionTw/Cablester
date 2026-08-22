import {
  applyLevelDocumentToChunk,
  chunkToLevelDocument,
  createSemanticProjection,
  computeContentHash,
  godotDerivedAllowlist,
  migrateToWorldPackage,
  normalizeWorldPackage,
  semanticDiff,
  serializeWorldPackage,
  validateWorldPackage
} from "./world-schema.js";
import { stableStringify } from "./world-hash.js";
import { compileLevelDocument, createLevelObject, validateLevelDocument } from "./level-objects.js";
import {
  WorldPreviewCanvas,
  createWorldPreviewModel,
  getSnapshotStatus
} from "./world-preview.js";
import {
  applyTransformChain,
  buildWorldSpatialIndex,
  createWorldStreamingSimulator,
  invertTransformChain
} from "./world-streaming.js";
import { createWorldRepositoryClient } from "./world-repository-client.js";
import { WorldValidationWorkerClient } from "./world-validation-worker.js";

const DEFAULT_WORLD_PATHS = Object.freeze([
  "worlds/labs/cablester-composite-showcase.world.json",
  "worlds/labs/cablester-3c-labs.world.json"
]);

const ENTITY_KINDS = Object.freeze(["world", "region", "chunk", "object"]);

function clone(value) {
  return structuredClone(value);
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function slug(value, fallback) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function collectIds(world) {
  const ids = new Set([world?.manifest?.worldId].filter(Boolean));
  for (const region of world?.regions || []) {
    ids.add(region.id);
    for (const chunk of region.chunks || []) {
      ids.add(chunk.id);
      for (const connection of chunk.connections || []) ids.add(connection.id);
      for (const object of chunk.objects || []) ids.add(object.id);
    }
  }
  return ids;
}

export function nextStableId(base, existingIds) {
  const root = slug(base, "entity");
  const ids = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  if (!ids.has(root)) return root;
  for (let ordinal = 2; ordinal < Number.MAX_SAFE_INTEGER; ordinal += 1) {
    const candidate = `${root}-${ordinal}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a stable id for ${root}`);
}

function flattenEntities(world) {
  const entities = [{
    kind: "world",
    id: world?.manifest?.worldId || "world",
    label: world?.manifest?.title || world?.manifest?.worldId || "World",
    value: world,
    searchText: `${world?.manifest?.worldId || ""} ${world?.manifest?.title || ""}`.toLowerCase()
  }];
  for (const region of world?.regions || []) {
    entities.push({
      kind: "region",
      id: region.id,
      label: region.name || region.id,
      regionId: region.id,
      value: region,
      searchText: `${region.id} ${region.name || ""} ${(region.tags || []).join(" ")}`.toLowerCase()
    });
    for (const chunk of region.chunks || []) {
      entities.push({
        kind: "chunk",
        id: chunk.id,
        label: chunk.name || chunk.id,
        regionId: region.id,
        chunkId: chunk.id,
        value: chunk,
        searchText: `${chunk.id} ${chunk.name || ""} ${(chunk.tags || []).join(" ")}`.toLowerCase()
      });
      for (const object of chunk.objects || []) {
        entities.push({
          kind: "object",
          id: object.id,
          label: `${object.type} · ${object.id}`,
          type: object.type,
          regionId: region.id,
          chunkId: chunk.id,
          value: object,
          searchText: `${object.id} ${object.type} ${(object.tags || []).join(" ")} ${safeJson(object.properties || {})}`.toLowerCase()
        });
      }
    }
  }
  return entities;
}

function findEntity(world, kind, id) {
  if (kind === "world") return {
    kind: "world",
    id: world?.manifest?.worldId || "world",
    label: world?.manifest?.title || world?.manifest?.worldId || "World",
    value: world,
    searchText: `${world?.manifest?.worldId || ""} ${world?.manifest?.title || ""}`.toLowerCase()
  };
  for (const region of world?.regions || []) {
    if (kind === "region" && region.id === id) return {
      kind: "region", id: region.id, label: region.name || region.id, regionId: region.id, value: region
    };
    for (const chunk of region.chunks || []) {
      if (kind === "chunk" && chunk.id === id) return {
        kind: "chunk", id: chunk.id, label: chunk.name || chunk.id, regionId: region.id, chunkId: chunk.id, value: chunk
      };
      if (kind !== "object") continue;
      const object = (chunk.objects || []).find((candidate) => candidate.id === id);
      if (object) return {
        kind: "object",
        id: object.id,
        label: `${object.type} · ${object.id}`,
        type: object.type,
        regionId: region.id,
        chunkId: chunk.id,
        value: object
      };
    }
  }
  return null;
}

function findChunk(world, chunkId) {
  for (const region of world?.regions || []) {
    const chunk = region.chunks?.find((candidate) => candidate.id === chunkId);
    if (chunk) return { region, chunk };
  }
  return null;
}

function findObject(world, objectId) {
  for (const region of world?.regions || []) {
    for (const chunk of region.chunks || []) {
      const index = chunk.objects?.findIndex((candidate) => candidate.id === objectId) ?? -1;
      if (index >= 0) return { region, chunk, object: chunk.objects[index], index };
    }
  }
  return null;
}

function setNestedValue(target, path, value) {
  const segments = Array.isArray(path) ? path : String(path).split(".").filter(Boolean);
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    if (!cursor[segment] || typeof cursor[segment] !== "object") cursor[segment] = {};
    cursor = cursor[segment];
  }
  cursor[segments.at(-1)] = value;
}

function remapConnectionAfterChunkDelete(connection, chunkId) {
  return connection?.from?.chunkId !== chunkId && connection?.to?.chunkId !== chunkId;
}

function defaultTransform(position = { x: 0, y: 0 }) {
  return { position: { x: finite(position.x), y: finite(position.y) }, rotationDegrees: 0, scale: { x: 1, y: 1 } };
}

function defaultRegion(id, ordinal) {
  return {
    id,
    name: `新区域 ${ordinal}`,
    transform: defaultTransform({ x: ordinal * 2200, y: 0 }),
    bounds: { x: 0, y: 0, w: 1920, h: 1080 },
    routes: [],
    landmarks: [],
    chunks: [],
    tags: []
  };
}

function defaultChunk(id, ordinal) {
  return {
    id,
    name: `新区块 ${ordinal}`,
    transform: defaultTransform({ x: ordinal * 1760, y: 0 }),
    bounds: { x: 0, y: 0, w: 1600, h: 900 },
    streaming: {
      prefetchDistance: 1280,
      hysteresis: 320,
      unloadDelaySeconds: 1.5,
      keepAlive: false,
      memoryEstimateBytes: 524288
    },
    connections: [],
    objects: [],
    scene: { layers: [] },
    statePolicy: {
      deathReset: "checkpoint",
      checkpointReset: "chunk",
      offscreen: "sleep-local",
      worldPersistence: []
    },
    gameplay: { startingAbilities: [], dashCapacity: 1 },
    tags: []
  };
}

function defaultPropertiesForType(world, type) {
  const typeEntry = world?.typeRegistry?.entries?.find((entry) => entry.id === type);
  return Object.fromEntries(Object.entries(typeEntry?.editableProperties || {}).map(([key, definition]) => [key, clone(definition.default)]));
}

function defaultObject(id, type = "platform", properties = {}) {
  return {
    id,
    type,
    transform: defaultTransform({ x: 320, y: 540 }),
    properties: clone(properties),
    links: [],
    tags: []
  };
}

function rewriteObjectLinks(world, removedId) {
  for (const entity of flattenEntities(world).filter((item) => item.kind === "object")) {
    entity.value.links = (entity.value.links || []).filter((link) => {
      if (typeof link === "string") return link !== removedId;
      return link?.targetId !== removedId && link?.objectId !== removedId;
    });
  }
}

function compareDocuments(before, after, path, changes, limit) {
  if (changes.length >= limit || Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const keyed = [...before, ...after].every((item) => item && typeof item === "object" && typeof item.id === "string");
    if (keyed) {
      const beforeById = new Map(before.map((item) => [item.id, item]));
      const afterById = new Map(after.map((item) => [item.id, item]));
      const beforeOrder = before.map((item) => item.id);
      const afterOrder = after.map((item) => item.id);
      if (before.length === after.length && beforeOrder.some((id, index) => afterOrder[index] !== id)) {
        changes.push({ path: `${path}.$order`, kind: "changed", before: beforeOrder, after: afterOrder });
      }
      const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
      for (const id of [...ids].sort()) {
        if (changes.length >= limit) break;
        compareDocuments(beforeById.get(id), afterById.get(id), `${path}[id=${id}]`, changes, limit);
      }
      return;
    }
    const maximum = Math.max(before.length, after.length);
    for (let index = 0; index < maximum && changes.length < limit; index += 1) {
      compareDocuments(before[index], after[index], `${path}[${index}]`, changes, limit);
    }
    return;
  }
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) compareDocuments(before[key], after[key], path ? `${path}.${key}` : key, changes, limit);
    return;
  }
  changes.push({
    path: path || "$",
    kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
    before: before === undefined ? null : before,
    after: after === undefined ? null : after
  });
}

export function createWorldDocumentDiff(before, after, { limit = 500 } = {}) {
  const changes = [];
  compareDocuments(before, after, "", changes, limit);
  return { changes, truncated: changes.length >= limit };
}

export function createChunkWebPlaytestDocument(world, regionId, chunkId) {
  const canonicalBefore = stableStringify(world);
  const document = chunkToLevelDocument(world, regionId, chunkId);
  const existingGoal = document.objects.find((object) => object.type === "goal");
  if (existingGoal) {
    return { document, derivedGoal: false, goalId: existingGoal.id, suppressedRoomExitIds: [] };
  }
  const firstExit = document.objects.find((object) => object.type === "roomExit");
  const fallbackPosition = {
    x: finite(document.bounds?.x) + Math.max(96, finite(document.bounds?.w, 1280) - 120),
    y: finite(document.bounds?.y) + finite(document.bounds?.h, 720) / 2
  };
  const goalPosition = firstExit ? {
    x: finite(firstExit.position?.x) + finite(firstExit.properties?.w, 0) / 2,
    y: finite(firstExit.position?.y) + finite(firstExit.properties?.h, 0) / 2
  } : fallbackPosition;
  const goalId = nextStableId(`web-preview-derived-${chunkId}-goal`, new Set(document.objects.map((object) => object.id)));
  const suppressedRoomExitIds = document.objects.filter((object) => object.type === "roomExit").map((object) => object.id);
  document.objects = document.objects.filter((object) => object.type !== "roomExit");
  document.objects.push(createLevelObject("goal", goalPosition.x, goalPosition.y, document.objects, { id: goalId }));
  document.metadata = {
    ...document.metadata,
    name: `${document.metadata.name} · 单区块 Web 契约预览`,
    category: "Web 契约预览",
    summary: "由 canonical Chunk 临时生成终点代理；不表示跨区块运行或 Godot 最终效果。",
    webPreview: {
      mode: "single-chunk-contract",
      canonicalChunkId: chunkId,
      derivedGoalId: goalId,
      suppressedRoomExitIds
    }
  };
  if (stableStringify(world) !== canonicalBefore) throw new Error("Web playtest adapter must not mutate canonical data");
  const errors = validateLevelDocument(document);
  if (errors.length > 0) throw new Error(`Web playtest document is invalid: ${errors.join("; ")}`);
  return { document, derivedGoal: true, goalId, suppressedRoomExitIds };
}

export class WorldEditorSession {
  constructor(world, { historyLimit = 100 } = {}) {
    const migrated = migrateToWorldPackage(world);
    this.world = normalizeWorldPackage(migrated);
    this.baseline = clone(this.world);
    this.historyLimit = Math.max(2, historyLimit);
    this.history = [{ label: "打开世界", world: clone(this.world) }];
    this.historyIndex = 0;
    this.selection = { kind: "world", id: this.world.manifest.worldId };
    this.lastMutation = "打开世界";
    this.cachedDiff = { world: this.world, baseline: this.baseline, value: { changes: [], truncated: false } };
  }

  get canUndo() { return this.historyIndex > 0; }
  get canRedo() { return this.historyIndex + 1 < this.history.length; }
  get dirty() { return this.changes().changes.length > 0; }

  commit(label, mutation) {
    const next = clone(this.world);
    const result = mutation(next);
    this.world = result && typeof result === "object" && result.schemaVersion ? result : next;
    this.world.manifest.contentHash = "";
    this.history = this.history.slice(0, this.historyIndex + 1);
    // History entries are immutable snapshots: every subsequent mutation starts
    // from a fresh clone, so retaining this snapshot avoids a second full-world
    // clone on every edit (material for 10k-object authoring packages).
    this.history.push({ label, world: this.world });
    if (this.history.length > this.historyLimit) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.lastMutation = label;
    this.cachedDiff = null;
    return this.world;
  }

  undo() {
    if (!this.canUndo) return false;
    this.historyIndex -= 1;
    this.world = this.history[this.historyIndex].world;
    this.lastMutation = `撤销：${this.history[this.historyIndex + 1].label}`;
    this.cachedDiff = null;
    if (!findEntity(this.world, this.selection.kind, this.selection.id)) this.select("world", this.world.manifest.worldId);
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.historyIndex += 1;
    this.world = this.history[this.historyIndex].world;
    this.lastMutation = `重做：${this.history[this.historyIndex].label}`;
    this.cachedDiff = null;
    if (!findEntity(this.world, this.selection.kind, this.selection.id)) this.select("world", this.world.manifest.worldId);
    return true;
  }

  select(kind, id) {
    if (!ENTITY_KINDS.includes(kind)) return null;
    const entity = findEntity(this.world, kind, id);
    if (!entity) return null;
    this.selection = { kind, id: entity.id };
    return entity;
  }

  selected() {
    return findEntity(this.world, this.selection.kind, this.selection.id);
  }

  search(query = "", { kind = "all", type = "all", regionId = null, chunkId = null } = {}) {
    const needle = String(query).trim().toLowerCase();
    return flattenEntities(this.world).filter((entity) => (
      (kind === "all" || entity.kind === kind)
      && (type === "all" || entity.type === type)
      && (!regionId || entity.regionId === regionId)
      && (!chunkId || entity.chunkId === chunkId)
      && (!needle || entity.searchText.includes(needle))
    ));
  }

  updateSelected(path, value) {
    const selection = { ...this.selection };
    return this.commit(`编辑 ${selection.kind} ${selection.id}`, (world) => {
      const entity = findEntity(world, selection.kind, selection.id);
      if (!entity) throw new Error(`Missing selected ${selection.kind}: ${selection.id}`);
      if (selection.kind === "world") setNestedValue(world, path, value);
      else setNestedValue(entity.value, path, value);
    });
  }

  addRegion() {
    const ids = collectIds(this.world);
    const id = nextStableId(`${this.world.manifest.worldId}-region`, ids);
    this.commit(`新增区域 ${id}`, (world) => world.regions.push(defaultRegion(id, world.regions.length + 1)));
    this.select("region", id);
    return id;
  }

  addChunk(regionId = this.selected()?.regionId || this.selection.id) {
    const ids = collectIds(this.world);
    const region = this.world.regions.find((candidate) => candidate.id === regionId) || this.world.regions[0];
    if (!region) throw new Error("请先创建一个 Region。");
    const id = nextStableId(`${region.id}-chunk`, ids);
    this.commit(`新增区块 ${id}`, (world) => {
      const target = world.regions.find((candidate) => candidate.id === region.id);
      target.chunks.push(defaultChunk(id, target.chunks.length + 1));
    });
    this.select("chunk", id);
    return id;
  }

  addObject(chunkId = this.selected()?.chunkId || this.selection.id, type = "platform") {
    const target = findChunk(this.world, chunkId) || findChunk(this.world, flattenEntities(this.world).find((entity) => entity.kind === "chunk")?.id);
    if (!target) throw new Error("请先创建一个 Chunk。");
    const id = nextStableId(`${target.chunk.id}-${type}`, collectIds(this.world));
    const properties = defaultPropertiesForType(this.world, type);
    this.commit(`新增物件 ${id}`, (world) => findChunk(world, target.chunk.id).chunk.objects.push(defaultObject(id, type, properties)));
    this.select("object", id);
    return id;
  }

  duplicateSelected() {
    const selected = this.selected();
    if (!selected || selected.kind !== "object") return null;
    const source = findObject(this.world, selected.id);
    const id = nextStableId(`${source.object.id}-copy`, collectIds(this.world));
    this.commit(`复制物件 ${source.object.id}`, (world) => {
      const target = findObject(world, source.object.id);
      const copy = clone(target.object);
      copy.id = id;
      copy.transform.position.x = finite(copy.transform.position.x) + 32;
      copy.transform.position.y = finite(copy.transform.position.y) + 32;
      target.chunk.objects.splice(target.index + 1, 0, copy);
    });
    this.select("object", id);
    return id;
  }

  deleteSelected() {
    const selected = this.selected();
    if (!selected || selected.kind === "world") return false;
    const fallback = { kind: "world", id: this.world.manifest.worldId };
    this.commit(`删除 ${selected.kind} ${selected.id}`, (world) => {
      if (selected.kind === "region") {
        const removed = world.regions.find((region) => region.id === selected.id);
        const removedChunkIds = new Set((removed?.chunks || []).map((chunk) => chunk.id));
        world.regions = world.regions.filter((region) => region.id !== selected.id);
        for (const region of world.regions) {
          for (const chunk of region.chunks || []) {
            chunk.connections = (chunk.connections || []).filter((connection) => (
              !removedChunkIds.has(connection.from?.chunkId) && !removedChunkIds.has(connection.to?.chunkId)
            ));
          }
        }
      } else if (selected.kind === "chunk") {
        for (const region of world.regions) region.chunks = (region.chunks || []).filter((chunk) => chunk.id !== selected.id);
        for (const region of world.regions) {
          for (const chunk of region.chunks || []) chunk.connections = (chunk.connections || []).filter((connection) => remapConnectionAfterChunkDelete(connection, selected.id));
        }
      } else if (selected.kind === "object") {
        const source = findObject(world, selected.id);
        if (source) source.chunk.objects.splice(source.index, 1);
        rewriteObjectLinks(world, selected.id);
      }
    });
    this.select(fallback.kind, fallback.id);
    return true;
  }

  moveObject(objectId, targetChunkId, { preserveWorldPosition = true } = {}) {
    const source = findObject(this.world, objectId);
    const target = findChunk(this.world, targetChunkId);
    if (!source || !target) throw new Error("跨区块移动需要有效的物件与目标区块。" );
    if (source.chunk.id === target.chunk.id) return false;
    let targetPosition = clone(source.object.transform.position);
    if (preserveWorldPosition) {
      const worldPosition = applyTransformChain(source.object.transform.position, [source.region.transform, source.chunk.transform]);
      targetPosition = invertTransformChain(worldPosition, [target.region.transform, target.chunk.transform]);
    }
    this.commit(`移动 ${objectId} 到 ${targetChunkId}`, (world) => {
      const from = findObject(world, objectId);
      const to = findChunk(world, targetChunkId);
      const [object] = from.chunk.objects.splice(from.index, 1);
      object.transform.position = { x: targetPosition.x, y: targetPosition.y };
      to.chunk.objects.push(object);
    });
    this.select("object", objectId);
    return true;
  }

  moveEntityByWorldDelta(kind, id, delta = {}) {
    if (!['region', 'chunk', 'object'].includes(kind)) throw new TypeError(`Unsupported canvas move kind: ${kind}`);
    const record = findEntity(this.world, kind, id);
    if (!record) throw new Error(`Missing ${kind}: ${id}`);
    const worldDelta = { x: finite(delta.x), y: finite(delta.y) };
    if (Math.abs(worldDelta.x) < 1e-9 && Math.abs(worldDelta.y) < 1e-9) return false;

    let localDelta = worldDelta;
    if (kind === 'chunk') {
      const source = findChunk(this.world, id);
      const origin = invertTransformChain({ x: 0, y: 0 }, [source.region.transform]);
      const offset = invertTransformChain(worldDelta, [source.region.transform]);
      localDelta = { x: offset.x - origin.x, y: offset.y - origin.y };
    } else if (kind === 'object') {
      const source = findObject(this.world, id);
      const parents = [source.region.transform, source.chunk.transform];
      const origin = invertTransformChain({ x: 0, y: 0 }, parents);
      const offset = invertTransformChain(worldDelta, parents);
      localDelta = { x: offset.x - origin.x, y: offset.y - origin.y };
    }

    this.commit(`画布移动 ${kind} ${id}`, (world) => {
      const target = findEntity(world, kind, id)?.value;
      if (!target) throw new Error(`Missing ${kind}: ${id}`);
      target.transform ||= {};
      target.transform.position ||= { x: 0, y: 0 };
      target.transform.position.x = finite(target.transform.position.x) + localDelta.x;
      target.transform.position.y = finite(target.transform.position.y) + localDelta.y;
    });
    this.select(kind, id);
    return true;
  }

  addConnection(fromChunkId, toChunkId, {
    fromEntranceId,
    toEntranceId,
    direction = 'right',
    oneWay = false,
    requiredAbilities = [],
    requiredFlags = []
  } = {}) {
    const source = findChunk(this.world, fromChunkId);
    const target = findChunk(this.world, toChunkId);
    if (!source || !target || fromChunkId === toChunkId) throw new Error('连接需要两个不同的有效 Chunk。');
    const isEntrance = (chunk, entranceId) => chunk.objects?.some((object) => object.id === entranceId && object.type === 'roomEntrance');
    if (!isEntrance(source.chunk, fromEntranceId) || !isEntrance(target.chunk, toEntranceId)) {
      throw new Error('连接端点必须引用各自 Chunk 内的 roomEntrance 稳定 ID。');
    }
    const edgeExists = (this.world.regions || []).some((region) => (region.chunks || []).some((chunk) => (
      (chunk.connections || []).some((connection) => (
        connection.from?.chunkId === fromChunkId
        && connection.to?.chunkId === toChunkId
        && connection.from?.entranceId === fromEntranceId
        && connection.to?.entranceId === toEntranceId
      ))
    )));
    if (edgeExists) throw new Error('相同端点的 Connection 已存在。');
    const id = nextStableId(`${fromChunkId}-to-${toChunkId}`, collectIds(this.world));
    this.commit(`新增连接 ${id}`, (world) => {
      const from = findChunk(world, fromChunkId).chunk;
      from.connections ||= [];
      from.connections.push({
        id,
        from: { chunkId: fromChunkId, entranceId: fromEntranceId },
        to: { chunkId: toChunkId, entranceId: toEntranceId },
        direction: String(direction || 'right'),
        requiredAbilities: [...new Set(requiredAbilities.map(String))],
        requiredFlags: [...new Set(requiredFlags.map(String))],
        oneWay: Boolean(oneWay)
      });
    });
    this.select('chunk', fromChunkId);
    return id;
  }

  changeObjectType(objectId, type) {
    const record = findObject(this.world, objectId);
    if (!record || !this.world.typeRegistry?.entries?.some((entry) => entry.id === type)) {
      throw new Error(`未知物件 type：${type}`);
    }
    const properties = defaultPropertiesForType(this.world, type);
    this.commit(`变更 ${objectId} type 为 ${type}`, (world) => {
      const target = findObject(world, objectId).object;
      target.type = type;
      target.properties = properties;
    });
    this.select("object", objectId);
  }

  replaceChunkFromLevelDocument(regionId, chunkId, document) {
    const next = applyLevelDocumentToChunk(this.world, regionId, chunkId, document);
    const currentChunk = findChunk(this.world, chunkId)?.chunk;
    const nextChunk = findChunk(next, chunkId)?.chunk;
    if (currentChunk && nextChunk && !Object.hasOwn(currentChunk, "extensions") && Object.keys(nextChunk.extensions || {}).length === 0) {
      delete nextChunk.extensions;
    }
    const meaningfulChanges = createWorldDocumentDiff(this.world, next).changes
      .filter((change) => change.path !== "manifest.contentHash");
    if (meaningfulChanges.length === 0) return false;
    this.commit(`应用关卡文档到 ${chunkId}`, () => next);
    return true;
  }

  importWorld(input) {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    const next = normalizeWorldPackage(migrateToWorldPackage(parsed));
    this.world = next;
    this.baseline = clone(next);
    this.history = [{ label: "导入世界", world: clone(next) }];
    this.historyIndex = 0;
    this.cachedDiff = null;
    this.select("world", next.manifest.worldId);
    return next;
  }

  async serialize() {
    return serializeWorldPackage(this.world);
  }

  changes() {
    if (this.cachedDiff?.world === this.world && this.cachedDiff?.baseline === this.baseline) return this.cachedDiff.value;
    const value = createWorldDocumentDiff(this.baseline, this.world);
    this.cachedDiff = { world: this.world, baseline: this.baseline, value };
    return value;
  }

  markSaved(serializedWorld = null) {
    if (serializedWorld) this.world = normalizeWorldPackage(JSON.parse(serializedWorld));
    this.baseline = clone(this.world);
    this.history[this.historyIndex] = { ...this.history[this.historyIndex], world: clone(this.world) };
    this.cachedDiff = { world: this.world, baseline: this.baseline, value: { changes: [], truncated: false } };
  }
}

export class WorldExportValidationError extends Error {
  constructor(issues) {
    const errors = Array.isArray(issues) ? issues : [];
    super(`Canonical world export blocked by ${errors.length} validation error${errors.length === 1 ? "" : "s"}.`);
    this.name = "WorldExportValidationError";
    this.issues = errors;
  }
}

export async function serializeValidatedWorldPackage(world) {
  const errors = validateWorldPackage(world)
    .filter((item) => (item.severity || "error") === "error");
  if (errors.length > 0) throw new WorldExportValidationError(errors);

  const contents = await serializeWorldPackage(world);
  const sealedWorld = JSON.parse(contents);
  const sealedErrors = validateWorldPackage(sealedWorld)
    .filter((item) => (item.severity || "error") === "error");
  if (sealedErrors.length > 0) throw new WorldExportValidationError(sealedErrors);
  return contents;
}

function download(name, contents, type = "application/json") {
  const blob = new Blob([contents], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setHidden(element, hidden) {
  if (element) element.hidden = hidden;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inputField(label, path, value, { type = "text", step = "any", readonly = false } = {}) {
  return `<label class="world-field"><span>${escapeHtml(label)}</span><input data-world-path="${escapeHtml(path)}" type="${type}" step="${step}" value="${escapeHtml(value)}" ${readonly ? "readonly" : ""}></label>`;
}

function numberField(label, path, value) {
  return inputField(label, path, value, { type: "number", step: "any" });
}

function snapshotBadge(status) {
  return `<span class="world-snapshot-badge" data-state="${escapeHtml(status.state)}">${escapeHtml(status.state)}</span>`;
}

export function createWorldStudio({
  root,
  repository = createWorldRepositoryClient(),
  validation = new WorldValidationWorkerClient(),
  expectedGodotBuildId = "4.7.1.stable.official.a13da4feb"
} = {}) {
  if (!root) throw new TypeError("createWorldStudio requires a root element");
  const canvasElement = root.querySelector("#world-preview-canvas");
  const tree = root.querySelector("#world-tree");
  const inspector = root.querySelector("#world-inspector");
  const diagnostics = root.querySelector("#world-diagnostics");
  const status = root.querySelector("#world-status");
  const pathSelect = root.querySelector("#world-path-select");
  const search = root.querySelector("#world-search");
  const filter = root.querySelector("#world-filter");
  const fileInput = root.querySelector("#world-file-input");
  const validationProgress = root.querySelector("#world-validation-progress");
  const validationLabel = root.querySelector("#world-validation-label");
  let session = null;
  let currentPath = null;
  let snapshot = null;
  let normalizedManifest = null;
  let telemetry = null;
  let spatialIndex = null;
  let streaming = null;
  let streamingPosition = { x: 0, y: 0 };
  let streamingVelocity = { x: 720, y: 0 };
  let streamingTimer = null;
  let currentView = "world";
  let validationResult = null;
  let capability = { writable: false, reason: "正在检查本地仓库能力…" };
  let diagnosticsTimer = null;

  const preview = new WorldPreviewCanvas(canvasElement, {
    onSelect(target) {
      if (!session) return;
      session.select(target.kind, target.id);
      if (target.kind === "region") currentView = "region";
      if (target.kind === "chunk") currentView = "chunk";
      renderSelection({ rebuildTree: true });
    },
    onMove(target, delta) {
      if (!session || currentView === 'godot') return;
      try {
        session.moveEntityByWorldDelta(target.kind, target.id, delta);
        renderMutation({ rebuild: true });
        setStatus(`已在画布移动 ${target.kind} ${target.id}；可撤销。`, 'success');
      } catch (error) {
        setStatus(`画布移动失败：${error.message}`, 'error');
      }
    }
  });

  function setStatus(message, tone = "neutral") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function selectedContext() {
    const selected = session?.selected();
    const regionId = selected?.regionId || (selected?.kind === "region" ? selected.id : session?.world.regions?.[0]?.id) || null;
    const chunkId = selected?.chunkId || (selected?.kind === "chunk" ? selected.id : session?.world.regions?.find((region) => region.id === regionId)?.chunks?.[0]?.id) || null;
    return { selected, regionId, chunkId };
  }

  function createStreaming() {
    if (!session) return;
    spatialIndex = buildWorldSpatialIndex(session.world);
    streaming = createWorldStreamingSimulator(session.world, {
      spatialIndex,
      loader: (record) => new Promise((resolve) => {
        const delay = 24 + [...record.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 120;
        setTimeout(() => resolve({ chunkId: record.id, simulated: true }), delay);
      })
    });
    const first = spatialIndex.chunkIndex.values()[0];
    streamingPosition = first ? { x: first.bounds.x + first.bounds.w / 2, y: first.bounds.y + first.bounds.h / 2 } : { x: 0, y: 0 };
    streaming.update({ position: streamingPosition, velocity: streamingVelocity });
  }

  function previewViewport() {
    const width = canvasElement.clientWidth || 1000;
    const height = canvasElement.clientHeight || 650;
    const start = preview.screenToWorld(0, 0);
    const end = preview.screenToWorld(width, height);
    return { x: start.x, y: start.y, w: Math.max(1, end.x - start.x), h: Math.max(1, end.y - start.y) };
  }

  function renderPreview({ fit = false } = {}) {
    if (!session || !spatialIndex) return;
    const { regionId, chunkId } = selectedContext();
    const model = createWorldPreviewModel(session.world, {
      view: currentView,
      regionId,
      chunkId,
      spatialIndex,
      viewport: previewViewport(),
      zoom: preview.view.zoom,
      snapshot,
      telemetry,
      streaming: streaming?.snapshot(),
      expectedGodotBuildId
    });
    preview.setModel(model, { fit });
    for (const button of root.querySelectorAll("[data-world-view]")) {
      const active = button.dataset.worldView === currentView;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
    }
    root.querySelector("#world-lod-label").textContent = `LOD ${model.lod}`;
    root.querySelector("#world-visible-label").textContent = `${model.visible.chunks.length}/${spatialIndex.chunkIndex.size} 区块 · ${model.visible.objects.length}/${spatialIndex.objectIndex.size} 物件`;
  }

  function renderTree() {
    if (!session) {
      tree.innerHTML = '<p class="world-empty">导入或打开 canonical World Package。</p>';
      return;
    }
    const query = search.value;
    const kind = filter.value;
    const showAll = !query && kind === "all";
    // A large authoring package can contain tens of thousands of objects. Keep
    // the hierarchy useful without creating one DOM button per object: the
    // selected Chunk is expanded, while search/filter reveals all matches.
    const matching = showAll
      ? null
      : new Set(session.search(query, { kind }).map((entity) => `${entity.kind}:${entity.id}`));
    const selection = session.selection;
    const selectedEntity = session.selected();
    const expandedChunkId = selection.kind === "chunk" ? selection.id : selectedEntity?.chunkId || null;
    const parts = [];
    let remainingObjectRows = showAll ? 120 : 600;
    const worldEntity = findEntity(session.world, "world", session.world.manifest.worldId);
    if (showAll || matching?.has(`world:${worldEntity.id}`)) {
      parts.push(`<button class="world-tree-item world-tree-world" data-kind="world" data-id="${escapeHtml(worldEntity.id)}" data-selected="${selection.kind === "world"}"><span>WORLD</span><strong>${escapeHtml(worldEntity.label)}</strong><small>${escapeHtml(worldEntity.id)}</small></button>`);
    }
    for (const region of session.world.regions || []) {
      const regionMatches = showAll || matching?.has(`region:${region.id}`);
      const descendantMatches = showAll || (region.chunks || []).some((chunk) => (
        matching?.has(`chunk:${chunk.id}`) || (chunk.objects || []).some((object) => matching?.has(`object:${object.id}`))
      ));
      if (!showAll && !regionMatches && !descendantMatches) continue;
      parts.push(`<button class="world-tree-item world-tree-region" data-kind="region" data-id="${escapeHtml(region.id)}" data-selected="${selection.kind === "region" && selection.id === region.id}"><span>REGION</span><strong>${escapeHtml(region.name || region.id)}</strong><small>${escapeHtml(region.id)}</small></button>`);
      for (const chunk of region.chunks || []) {
        const chunkMatches = matching?.has(`chunk:${chunk.id}`);
        const objectMatches = showAll ? [] : (chunk.objects || []).filter((object) => matching?.has(`object:${object.id}`));
        if (!showAll && !chunkMatches && objectMatches.length === 0) continue;
        parts.push(`<button class="world-tree-item world-tree-chunk" data-kind="chunk" data-id="${escapeHtml(chunk.id)}" data-selected="${selection.kind === "chunk" && selection.id === chunk.id}"><span>CHUNK</span><strong>${escapeHtml(chunk.name || chunk.id)}</strong><small>${chunk.objects?.length || 0} objects</small></button>`);
        const visibleObjects = showAll
          ? (chunk.id === expandedChunkId ? (chunk.objects || []) : [])
          : objectMatches;
        const renderedObjects = visibleObjects.slice(0, Math.max(0, remainingObjectRows));
        remainingObjectRows -= renderedObjects.length;
        for (const object of renderedObjects) {
          parts.push(`<button class="world-tree-item world-tree-object" data-kind="object" data-id="${escapeHtml(object.id)}" data-selected="${selection.kind === "object" && selection.id === object.id}"><span>${escapeHtml(object.type)}</span><strong>${escapeHtml(object.id)}</strong></button>`);
        }
        if (visibleObjects.length > renderedObjects.length) parts.push(`<p class="world-tree-more">另有 ${visibleObjects.length - renderedObjects.length} 个匹配物件；请缩小搜索或使用稳定 ID。</p>`);
      }
    }
    tree.innerHTML = parts.join("") || '<p class="world-empty">没有匹配的稳定 ID、类型或标签。</p>';
  }

  function renderInspector() {
    if (!session) {
      inspector.innerHTML = '<p class="world-empty">尚未加载世界。</p>';
      return;
    }
    const { selected } = selectedContext();
    if (!selected) return;
    const value = selected.value;
    let fields = "";
    let actions = "";
    if (selected.kind === "world") {
      fields = [
        inputField("稳定 worldId", "manifest.worldId", session.world.manifest.worldId, { readonly: true }),
        inputField("标题", "manifest.title", session.world.manifest.title || ""),
        inputField("内容版本", "manifest.contentVersion", session.world.manifest.contentVersion || ""),
        inputField("Namespace", "manifest.namespace", session.world.manifest.namespace || "formal", { readonly: true }),
        `<label class="world-field world-field-wide"><span>Gameplay tuning (draft / approved) JSON</span><textarea data-world-json-path="gameplayTuning" rows="9">${escapeHtml(safeJson(session.world.gameplayTuning || {}))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>State definitions JSON</span><textarea data-world-json-path="stateDefinitions" rows="6">${escapeHtml(safeJson(session.world.stateDefinitions || { flags: [], keys: [] }))}</textarea></label>`
      ].join("");
      actions = '<button type="button" data-world-action="add-region">新增 Region</button>';
    } else if (selected.kind === "region") {
      fields = [
        inputField("稳定 ID", "id", value.id, { readonly: true }),
        inputField("名称", "name", value.name || ""),
        numberField("位置 X", "transform.position.x", value.transform?.position?.x),
        numberField("位置 Y", "transform.position.y", value.transform?.position?.y),
        numberField("宽度", "bounds.w", value.bounds?.w),
        numberField("高度", "bounds.h", value.bounds?.h),
        `<label class="world-field world-field-wide"><span>Routes JSON</span><textarea data-world-json-path="routes" rows="7">${escapeHtml(safeJson(value.routes || []))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Landmarks JSON</span><textarea data-world-json-path="landmarks" rows="5">${escapeHtml(safeJson(value.landmarks || []))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Tags JSON</span><textarea data-world-json-path="tags" rows="3">${escapeHtml(safeJson(value.tags || []))}</textarea></label>`
      ].join("");
      actions = '<button type="button" data-world-action="add-chunk">新增 Chunk</button><button class="danger-subtle" type="button" data-world-action="delete">删除 Region</button>';
    } else if (selected.kind === "chunk") {
      const stream = value.streaming || {};
      const sourceEntrances = (value.objects || []).filter((object) => object.type === 'roomEntrance');
      const connectionTargets = (session.world.regions || [])
        .flatMap((region) => region.chunks || [])
        .filter((chunk) => chunk.id !== value.id)
        .flatMap((chunk) => (chunk.objects || [])
          .filter((object) => object.type === 'roomEntrance')
          .map((object) => ({ chunkId: chunk.id, chunkLabel: chunk.name || chunk.id, entranceId: object.id })));
      const sourceEntranceOptions = sourceEntrances.map((object) => `<option value="${escapeHtml(object.id)}">${escapeHtml(object.id)}</option>`).join('');
      const targetEntranceOptions = connectionTargets.map((entry) => `<option value="${encodeURIComponent(entry.chunkId)}|${encodeURIComponent(entry.entranceId)}">${escapeHtml(entry.chunkLabel)} · ${escapeHtml(entry.entranceId)}</option>`).join('');
      fields = [
        inputField("稳定 ID", "id", value.id, { readonly: true }),
        inputField("名称", "name", value.name || ""),
        numberField("位置 X", "transform.position.x", value.transform?.position?.x),
        numberField("位置 Y", "transform.position.y", value.transform?.position?.y),
        numberField("宽度", "bounds.w", value.bounds?.w),
        numberField("高度", "bounds.h", value.bounds?.h),
        numberField("预取距离", "streaming.prefetchDistance", stream.prefetchDistance),
        numberField("滞回距离", "streaming.hysteresis", stream.hysteresis),
        numberField("卸载延迟 (s)", "streaming.unloadDelaySeconds", stream.unloadDelaySeconds),
        `<label class="world-field"><span>Keep-alive</span><select data-world-path="streaming.keepAlive"><option value="false" ${stream.keepAlive ? "" : "selected"}>否</option><option value="true" ${stream.keepAlive ? "selected" : ""}>是</option></select></label>`,
        numberField("估算内存 bytes", "streaming.memoryEstimateBytes", stream.memoryEstimateBytes),
        `<fieldset class="world-connection-builder world-field-wide"><legend>ChunkGraph 连线</legend><label class="world-field"><span>本端 roomEntrance</span><select id="world-connection-from">${sourceEntranceOptions || '<option value="">无可用入口</option>'}</select></label><label class="world-field"><span>目标 Chunk / roomEntrance</span><select id="world-connection-to">${targetEntranceOptions || '<option value="">无可用目标</option>'}</select></label><label class="world-field"><span>方向</span><select id="world-connection-direction"><option value="right">right</option><option value="left">left</option><option value="up">up</option><option value="down">down</option><option value="both">both</option><option value="bidirectional">bidirectional</option></select></label><label class="world-field world-check-field"><span>单向</span><input id="world-connection-one-way" type="checkbox" /></label><button type="button" data-world-action="add-connection" ${sourceEntrances.length && connectionTargets.length ? '' : 'disabled'}>创建唯一 Connection</button><small>边只写入 from Chunk；非单向边自动派生双向拓扑。</small></fieldset>`,
        `<label class="world-field world-field-wide"><span>Connections JSON（每条边只存于 from chunk）</span><textarea data-world-json-path="connections" rows="10">${escapeHtml(safeJson(value.connections || []))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>State policy JSON</span><textarea data-world-json-path="statePolicy" rows="6">${escapeHtml(safeJson(value.statePolicy || {}))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Chunk gameplay JSON</span><textarea data-world-json-path="gameplay" rows="6">${escapeHtml(safeJson(value.gameplay || { startingAbilities: [], dashCapacity: 1 }))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Scene layers JSON</span><textarea data-world-json-path="scene" rows="8">${escapeHtml(safeJson(value.scene || { layers: [] }))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Tags JSON</span><textarea data-world-json-path="tags" rows="3">${escapeHtml(safeJson(value.tags || []))}</textarea></label>`
      ].join("");
      actions = '<button type="button" data-world-action="add-object">新增 Object</button><button type="button" data-world-action="play">Web 试玩</button><button class="danger-subtle" type="button" data-world-action="delete">删除 Chunk</button>';
    } else {
      const chunkOptions = (session.world.regions || []).flatMap((region) => region.chunks || []).map((chunk) => `<option value="${escapeHtml(chunk.id)}" ${chunk.id === selected.chunkId ? "selected" : ""}>${escapeHtml(chunk.name || chunk.id)}</option>`).join("");
      const typeOptions = (session.world.typeRegistry?.entries || []).map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === value.type ? "selected" : ""}>${escapeHtml(entry.label || entry.id)}</option>`).join("");
      fields = [
        inputField("稳定 ID", "id", value.id, { readonly: true }),
        `<label class="world-field"><span>Type</span><select data-world-path="type">${typeOptions || `<option>${escapeHtml(value.type)}</option>`}</select></label>`,
        numberField("位置 X", "transform.position.x", value.transform?.position?.x),
        numberField("位置 Y", "transform.position.y", value.transform?.position?.y),
        numberField("旋转 °", "transform.rotationDegrees", value.transform?.rotationDegrees),
        numberField("玩法 Scale X", "transform.scale.x", value.transform?.scale?.x),
        numberField("玩法 Scale Y", "transform.scale.y", value.transform?.scale?.y),
        `<label class="world-field world-field-wide"><span>Properties JSON</span><textarea data-world-json-path="properties" rows="8">${escapeHtml(safeJson(value.properties || {}))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Links JSON（只引用稳定 ID）</span><textarea data-world-json-path="links" rows="5">${escapeHtml(safeJson(value.links || []))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>Tags JSON</span><textarea data-world-json-path="tags" rows="3">${escapeHtml(safeJson(value.tags || []))}</textarea></label>`,
        `<label class="world-field world-field-wide"><span>移动到 Chunk（保持世界坐标）</span><select id="world-move-target">${chunkOptions}</select></label>`
      ].join("");
      actions = '<button type="button" data-world-action="move-object">跨区块移动</button><button type="button" data-world-action="duplicate">复制 Object</button><button class="danger-subtle" type="button" data-world-action="delete">删除 Object</button>';
    }
    inspector.innerHTML = `<div class="world-inspector-heading"><span>${selected.kind.toUpperCase()}</span><strong>${escapeHtml(selected.label)}</strong><small>${escapeHtml(selected.id)}</small></div><div class="world-inspector-fields">${fields}</div><div class="world-inspector-actions">${actions}</div>`;
  }

  function renderDiagnostics() {
    if (!session) {
      diagnostics.innerHTML = '<p class="world-empty">诊断会在打开世界后显示。</p>';
      return;
    }
    const snapshotStatus = getSnapshotStatus(session.world, snapshot, { expectedGodotBuildId });
    const changes = session.changes();
    let godotDiff = [];
    if (normalizedManifest) {
      try {
        godotDiff = semanticDiff(session.world, normalizedManifest, godotDerivedAllowlist) || [];
      } catch (error) {
        godotDiff = [{ path: "$", message: error.message }];
      }
    }
    const streamingSnapshot = streaming?.snapshot();
    const issues = validationResult?.issues || validateWorldPackage(session.world);
    const issueRows = issues.slice(0, 30).map((item) => `<li data-severity="${escapeHtml(item.severity || "error")}"><strong>${escapeHtml(item.code || item.severity || "issue")}</strong><span>${escapeHtml(item.path || "$")}</span><p>${escapeHtml(item.message || item)}</p></li>`).join("");
    const diffRows = changes.changes.slice(0, 24).map((change) => `<li><strong>${escapeHtml(change.kind)}</strong><code>${escapeHtml(change.path)}</code></li>`).join("");
    const stateRows = Object.entries(streamingSnapshot?.states || {}).map(([state, count]) => `<span data-stream-state="${state}">${state} ${count}</span>`).join("");
    diagnostics.innerHTML = `
      <section class="world-diagnostic-card">
        <header><strong>版本握手</strong>${snapshotBadge(snapshotStatus)}</header>
        <dl><div><dt>Canonical</dt><dd>${escapeHtml(session.world.manifest.contentVersion)} · ${escapeHtml(session.world.manifest.contentHash || "未封存")}</dd></div><div><dt>Godot</dt><dd>${escapeHtml(snapshot?.godotBuildId || "无 snapshot")}</dd></div></dl>
        <p>${escapeHtml(snapshotStatus.reason)}</p>
      </section>
      <section class="world-diagnostic-card">
        <header><strong>来源边界</strong></header>
        <ul class="world-source-list"><li data-source="canonical-prediction">Canonical 推算</li><li data-source="web-contract">Web 行为契约</li><li data-source="godot-snapshot">Godot snapshot</li><li data-source="godot-telemetry">Godot telemetry</li><li data-source="godot-only-proxy">Godot-only 代理</li></ul>
        <p>Canvas 近似不代表 Godot 最终 Shader、灯光、粒子、动画树、音频或精确物理。</p>
      </section>
      <section class="world-diagnostic-card">
        <header><strong>修改 diff</strong><span>${changes.changes.length} 项</span></header>
        <ul class="world-mini-list">${diffRows || "<li>相对打开/保存版本无修改</li>"}</ul>
      </section>
      <section class="world-diagnostic-card">
        <header><strong>Semantic diff</strong><span>${normalizedManifest ? `${godotDiff.length} 项` : "等待 Godot"}</span></header>
        <p>${normalizedManifest ? (godotDiff.length ? "Canonical 与 Godot normalized manifest 尚有差异。" : "除 allowlist 派生字段外差异为零。") : "运行 Godot 导入后回读 normalized manifest。"}</p>
      </section>
      <section class="world-diagnostic-card">
        <header><strong>流式预测</strong><span>不能替代 Godot telemetry</span></header>
        <div class="world-stream-states">${stateRows}</div>
        <dl><div><dt>加载请求</dt><dd>${streamingSnapshot?.metrics.requests || 0}</dd></div><div><dt>缓存命中</dt><dd>${streamingSnapshot?.metrics.cacheHits || 0}</dd></div><div><dt>迟到丢弃</dt><dd>${streamingSnapshot?.metrics.lateResultsDiscarded || 0}</dd></div><div><dt>估算内存</dt><dd>${((streamingSnapshot?.metrics.estimatedMemoryBytes || 0) / 1048576).toFixed(1)} MiB</dd></div></dl>
      </section>
      <section class="world-diagnostic-card world-issues-card">
        <header><strong>Validation</strong><span>${issues.length} 项</span></header>
        <ul class="world-issue-list">${issueRows || "<li>静态检查暂无问题；仍需 Godot 回放或真人试玩。</li>"}</ul>
      </section>`;
  }

  function renderToolbar() {
    const loaded = Boolean(session);
    for (const selector of ["#world-save", "#world-export", "#world-validate", "#world-play", "#world-godot-command", "#world-edit-chunk"]) root.querySelector(selector).disabled = !loaded;
    root.querySelector("#world-save").disabled = !loaded || !capability.writable;
    root.querySelector("#world-save").title = capability.writable ? "确定性原子写回仓库" : capability.reason || "线上只读";
    root.querySelector("#world-undo").disabled = !session?.canUndo;
    root.querySelector("#world-redo").disabled = !session?.canRedo;
    root.querySelector("#world-duplicate").disabled = session?.selection.kind !== "object";
    root.querySelector("#world-delete").disabled = !session || session.selection.kind === "world";
    root.querySelector("#world-dirty-label").textContent = session?.dirty ? `未保存 · ${session.changes().changes.length} 项` : "已同步";
    root.querySelector("#world-repository-mode").textContent = capability.writable ? "LOCAL REPOSITORY · 可写" : "ONLINE / STATIC · 只读";
    root.querySelector("#world-repository-mode").dataset.writable = String(Boolean(capability.writable));
  }

  function refreshSelectedSpatialReference() {
    if (!session || !spatialIndex) return;
    const selected = session.selected();
    if (!selected) return;
    if (selected.kind === "region") {
      const record = spatialIndex.regions.get(selected.id);
      if (record) spatialIndex.regions.set(selected.id, { ...record, region: selected.value });
      return;
    }
    if (selected.kind === "chunk") {
      const source = findChunk(session.world, selected.id);
      const record = spatialIndex.chunks.get(selected.id);
      if (!source || !record) return;
      const updated = { ...record, region: source.region, chunk: source.chunk };
      spatialIndex.chunks.set(selected.id, updated);
      spatialIndex.chunkIndex.insert({ ...updated, kind: "chunk" });
      return;
    }
    if (selected.kind === "object") {
      const source = findObject(session.world, selected.id);
      const record = spatialIndex.objects.get(selected.id);
      if (!source || !record) return;
      const updated = { ...record, region: source.region, chunk: source.chunk, object: source.object };
      spatialIndex.objects.set(selected.id, updated);
      spatialIndex.objectIndex.insert({ ...updated, kind: "object" });
    }
  }

  function scheduleDiagnostics() {
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => {
      diagnosticsTimer = null;
      if (!root.hidden) renderDiagnostics();
    }, 180);
  }

  function renderSelection({ fit = false, rebuildTree = false } = {}) {
    if (rebuildTree) renderTree();
    else {
      for (const item of tree.querySelectorAll(".world-tree-item[data-kind][data-id]")) {
        item.dataset.selected = String(item.dataset.kind === session?.selection.kind && item.dataset.id === session?.selection.id);
      }
    }
    renderInspector();
    renderToolbar();
    renderPreview({ fit });
  }

  function renderMutation({ rebuild = false } = {}) {
    if (rebuild || !spatialIndex) createStreaming();
    else refreshSelectedSpatialReference();
    renderTree();
    renderInspector();
    renderToolbar();
    renderPreview();
    scheduleDiagnostics();
  }

  function renderAll({ fit = false, rebuild = false } = {}) {
    if (session && (rebuild || !spatialIndex)) createStreaming();
    renderTree();
    renderInspector();
    renderDiagnostics();
    renderToolbar();
    renderPreview({ fit });
  }

  async function loadDiagnosticsArtifacts() {
    snapshot = null;
    normalizedManifest = null;
    telemetry = null;
    // Godot diagnostics live in the private sibling project after the split.
    // The Web project intentionally starts without engine-derived artifacts.
  }

  async function openWorld(path) {
    setStatus(`正在打开 ${path}…`);
    try {
      const world = await repository.load(path);
      session = new WorldEditorSession(world);
      currentPath = path;
      currentView = "world";
      validationResult = null;
      await loadDiagnosticsArtifacts();
      createStreaming();
      renderAll({ fit: true });
      setStatus(`已打开 ${session.world.manifest.title || session.world.manifest.worldId}`, "success");
    } catch (error) {
      setStatus(error.message, "error");
      throw error;
    }
  }

  async function refreshRepository() {
    capability = await repository.inspect({ refresh: true });
    let worlds = capability.worlds || [];
    if (worlds.length === 0) worlds = DEFAULT_WORLD_PATHS.map((path) => ({ path }));
    else worlds = [...worlds].sort((left, right) => {
      const leftPriority = DEFAULT_WORLD_PATHS.indexOf(left.path);
      const rightPriority = DEFAULT_WORLD_PATHS.indexOf(right.path);
      const normalizedLeft = leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const normalizedRight = rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority;
      return normalizedLeft - normalizedRight || left.path.localeCompare(right.path);
    });
    pathSelect.innerHTML = worlds.map((entry) => `<option value="${escapeHtml(entry.path)}">${escapeHtml(entry.path)}</option>`).join("");
    renderToolbar();
    return worlds;
  }

  async function open() {
    root.hidden = false;
    const worlds = await refreshRepository();
    if (!session) {
      for (const entry of worlds) {
        try {
          await openWorld(entry.path);
          pathSelect.value = entry.path;
          break;
        } catch {
          // Try the next canonical path; import remains available if none exist.
        }
      }
    } else renderAll();
    if (!session) setStatus("未找到 canonical 世界文件；可导入 .world.json。", "warning");
    root.querySelector("#world-close").focus();
  }

  function close() {
    root.hidden = true;
    stopStreaming();
    validation.cancel();
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = null;
  }

  async function save() {
    if (!session) return;
    if (!currentPath) currentPath = pathSelect.value || null;
    if (!currentPath) {
      setStatus("请选择 worlds/formal 或 worlds/labs 下的仓库路径。", "warning");
      return;
    }
    setStatus("正在验证并确定性保存…");
    const errors = validateWorldPackage(session.world).filter((item) => (item.severity || "error") === "error");
    if (errors.length > 0) {
      validationResult = { issues: errors };
      renderDiagnostics();
      setStatus(`保存已阻止：${errors.length} 个 schema 错误。`, "error");
      return;
    }
    try {
      const result = await repository.save(currentPath, session.world);
      session.markSaved(result.contents);
      createStreaming();
      renderAll();
      setStatus(`已原子写入 ${result.path} · ${result.bytes} bytes`, "success");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function runValidation() {
    if (!session) return;
    root.querySelector("#world-validate").disabled = true;
    root.querySelector("#world-validation-cancel").disabled = false;
    validationProgress.value = 0;
    validationLabel.textContent = "准备 Worker…";
    try {
      validationResult = await validation.validate(session.world, {
        onProgress(progress) {
          validationProgress.value = progress.progress;
          validationLabel.textContent = `${progress.label} · ${Math.round(progress.progress * 100)}% · ${progress.issueCount} 项`;
        }
      });
      validationProgress.value = 1;
      validationLabel.textContent = `完成 · ${validationResult.summary.errors} 错误 · ${validationResult.summary.warnings} 警告 · ${validationResult.summary.durationMs.toFixed(1)} ms`;
      setStatus("全图静态验证完成；下一步仍需 Godot 固定输入回放或真人试玩。", validationResult.summary.errors ? "error" : "success");
      renderDiagnostics();
    } catch (error) {
      if (error.name === "AbortError") {
        validationLabel.textContent = "验证已取消";
        setStatus("Worker validation 已取消。", "warning");
      } else setStatus(error.message, "error");
    } finally {
      root.querySelector("#world-validate").disabled = false;
      root.querySelector("#world-validation-cancel").disabled = true;
    }
  }

  async function playSelectedChunk() {
    if (!session) return;
    const { regionId, chunkId } = selectedContext();
    if (!regionId || !chunkId) return setStatus("请先选择一个 Chunk。", "warning");
    try {
      const prepared = createChunkWebPlaytestDocument(session.world, regionId, chunkId);
      const { document } = prepared;
      const level = compileLevelDocument(document);
      if (!globalThis.cablester?.startPrepared) throw new Error("Web 运行时尚未初始化。");
      const started = await globalThis.cablester.startPrepared(level);
      if (!started) throw new Error("Web 试玩准备被较新的请求取代。");
      close();
      documentBody().querySelector("#start-card")?.classList.add("is-hidden");
      documentBody().querySelector("#game")?.focus();
      globalThis.cablester.showToast?.(
        prepared.derivedGoal
          ? "单区块 Web 契约预览 · 终点为内存代理，不写回 canonical"
          : "Canonical 单区块 Web 契约预览",
        4,
        prepared.derivedGoal ? "warning" : "ability"
      );
    } catch (error) {
      setStatus(`无法试玩：${error.message}`, "error");
    }
  }

  function editSelectedChunk() {
    if (!session) return;
    const { regionId, chunkId } = selectedContext();
    if (!regionId || !chunkId) return setStatus("请先选择一个 Chunk。", "warning");
    const levelEditor = globalThis.cablesterLevelEditor;
    if (!levelEditor?.openDocument) return setStatus("关卡工坊尚未初始化。", "error");
    try {
      const document = chunkToLevelDocument(session.world, regionId, chunkId);
      const chunkName = session.world.regions
        .find((region) => region.id === regionId)?.chunks
        .find((chunk) => chunk.id === chunkId)?.name || chunkId;
      root.hidden = true;
      levelEditor.openDocument(document, {
        sourceLabel: `${chunkName} · ${chunkId}`,
        onApply(nextDocument) {
          const changed = session.replaceChunkFromLevelDocument(regionId, chunkId, nextDocument);
          if (changed) createStreaming();
          renderAll({ rebuild: changed });
          setStatus(changed
            ? `已将关卡工坊草稿回写到 ${chunkId}；请验证后保存 canonical 世界。`
            : `${chunkId} 没有内容变化；canonical 世界保持同步。`, "success");
        },
        onClose() {
          root.hidden = false;
          renderAll();
          root.querySelector("#world-edit-chunk").focus();
        }
      });
    } catch (error) {
      root.hidden = false;
      setStatus(`无法打开 Chunk：${error.message}`, "error");
    }
  }

  function documentBody() {
    return globalThis.document;
  }

  async function copyGodotCommand() {
    if (!session || !currentPath) return;
    const command = `scripts/godot.sh --headless --path . -- --import-world ${currentPath}`;
    try {
      await navigator.clipboard.writeText(command);
      setStatus(`已复制 Godot 4.7.1 导入命令：${command}`, "success");
    } catch {
      setStatus(`请在仓库执行：${command}`, "warning");
    }
  }

  function streamingStep({ teleport = false } = {}) {
    if (!streaming || !spatialIndex) return;
    const now = globalThis.performance?.now?.() ?? Date.now();
    if (teleport) {
      const records = spatialIndex.chunkIndex.values();
      const target = records.at(-1);
      if (target) streamingPosition = { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 };
    } else {
      streamingPosition.x += streamingVelocity.x * 0.16;
      streamingPosition.y += streamingVelocity.y * 0.16;
      const bounds = spatialIndex.chunkIndex.values().reduce((combined, record) => ({
        min: Math.min(combined.min, record.bounds.x),
        max: Math.max(combined.max, record.bounds.x + record.bounds.w)
      }), { min: Infinity, max: -Infinity });
      if (streamingPosition.x > bounds.max || streamingPosition.x < bounds.min) streamingVelocity.x *= -1;
    }
    streaming.update({ position: streamingPosition, velocity: streamingVelocity, now, teleport });
    renderPreview();
    renderDiagnostics();
  }

  function startStreaming() {
    if (streamingTimer) return;
    streamingTimer = setInterval(streamingStep, 160);
    root.querySelector("#world-stream-toggle").textContent = "暂停流式预测";
  }

  function stopStreaming() {
    if (streamingTimer) clearInterval(streamingTimer);
    streamingTimer = null;
    root.querySelector("#world-stream-toggle").textContent = "播放流式预测";
  }

  root.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    if (target.dataset.kind && target.dataset.id && session) {
      session.select(target.dataset.kind, target.dataset.id);
      if (target.dataset.kind === "region") currentView = "region";
      if (target.dataset.kind === "chunk" || target.dataset.kind === "object") currentView = "chunk";
      renderSelection({ rebuildTree: true });
      return;
    }
    if (target.dataset.worldView) {
      currentView = target.dataset.worldView;
      renderPreview({ fit: true });
      return;
    }
    const action = target.dataset.worldAction;
    if (action === "add-region") session.addRegion();
    if (action === "add-chunk") session.addChunk(selectedContext().regionId);
    if (action === "add-object") session.addObject(selectedContext().chunkId);
    if (action === 'add-connection') {
      const fromChunkId = selectedContext().chunkId;
      const fromEntranceId = root.querySelector('#world-connection-from')?.value;
      const encodedTarget = root.querySelector('#world-connection-to')?.value || '';
      const [encodedChunkId = '', encodedEntranceId = ''] = encodedTarget.split('|');
      const toChunkId = decodeURIComponent(encodedChunkId);
      const toEntranceId = decodeURIComponent(encodedEntranceId);
      try {
        session.addConnection(fromChunkId, toChunkId, {
          fromEntranceId,
          toEntranceId,
          direction: root.querySelector('#world-connection-direction')?.value,
          oneWay: root.querySelector('#world-connection-one-way')?.checked
        });
        setStatus(`已创建 ${fromChunkId} → ${toChunkId} 的 canonical Connection。`, 'success');
      } catch (error) {
        setStatus(`创建连接失败：${error.message}`, 'error');
      }
    }
    if (action === "duplicate") session.duplicateSelected();
    if (action === "delete") session.deleteSelected();
    if (action === "move-object") session.moveObject(session.selection.id, root.querySelector("#world-move-target").value);
    if (action === "play") return playSelectedChunk();
    if (action) renderMutation({ rebuild: true });
  });

  root.addEventListener("change", (event) => {
    if (!session) return;
    const target = event.target;
    if (target.matches("[data-world-path]")) {
      const value = target.type === "number"
        ? Number(target.value)
        : target.dataset.worldPath === "streaming.keepAlive"
          ? target.value === "true"
          : target.value;
      if (target.dataset.worldPath === "type" && session.selection.kind === "object") {
        session.changeObjectType(session.selection.id, value);
      } else session.updateSelected(target.dataset.worldPath, value);
      const path = target.dataset.worldPath;
      const rebuild = path === "type" || path.startsWith("transform.") || path.startsWith("bounds.") || path.startsWith("properties.");
      renderMutation({ rebuild });
    }
    if (target.matches("[data-world-json-path]")) {
      try {
        session.updateSelected(target.dataset.worldJsonPath, JSON.parse(target.value));
        renderMutation({ rebuild: true });
      } catch (error) {
        setStatus(`Properties JSON 无效：${error.message}`, "error");
      }
    }
  });

  search.addEventListener("input", renderTree);
  filter.addEventListener("change", renderTree);
  root.querySelector("#world-close").addEventListener("click", close);
  root.querySelector("#world-open").addEventListener("click", () => openWorld(pathSelect.value));
  root.querySelector("#world-refresh").addEventListener("click", async () => {
    await refreshRepository();
    await loadDiagnosticsArtifacts();
    renderAll();
  });
  root.querySelector("#world-save").addEventListener("click", save);
  root.querySelector("#world-import").addEventListener("click", () => fileInput.click());
  root.querySelector("#world-export").addEventListener("click", async () => {
    if (!session) return;
    try {
      const contents = await serializeValidatedWorldPackage(session.world);
      download(`${session.world.manifest.worldId}.world.json`, contents);
      setStatus("已校验、封存并导出 canonical JSON；导出不等于仓库保存。", "success");
    } catch (error) {
      const issues = error instanceof WorldExportValidationError ? error.issues : [];
      if (issues.length > 0) {
        validationResult = { issues };
        renderDiagnostics();
        setStatus(`导出已阻止：${issues.length} 个 canonical 错误。`, "error");
      } else setStatus(`导出失败：${error.message}`, "error");
    }
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      session = new WorldEditorSession(JSON.parse(await file.text()));
      const importedNamespace = session.world.manifest?.namespace;
      const importedWorldId = session.world.manifest?.worldId;
      const matchingEntry = [...pathSelect.options].find((option) => {
        const match = option.value.match(/^worlds\/(formal|labs)\/([^/]+)\.world\.json$/i);
        return match && match[1] === importedNamespace && match[2] === importedWorldId;
      });
      currentPath = matchingEntry?.value || null;
      pathSelect.value = currentPath || "";
      snapshot = null;
      normalizedManifest = null;
      telemetry = null;
      createStreaming();
      renderAll({ fit: true });
      setStatus(currentPath
        ? `已导入浏览器草稿；保存目标已按 worldId 匹配为 ${currentPath}。`
        : "已导入浏览器草稿；未找到相同 namespace/worldId 的仓库文件，已禁止直接覆盖现有世界。请先导出并建立明确目标文件。", "warning");
    } catch (error) {
      setStatus(`导入失败：${error.message}`, "error");
    } finally {
      fileInput.value = "";
    }
  });
  root.querySelector("#world-undo").addEventListener("click", () => { if (session.undo()) renderMutation({ rebuild: true }); });
  root.querySelector("#world-redo").addEventListener("click", () => { if (session.redo()) renderMutation({ rebuild: true }); });
  root.querySelector("#world-duplicate").addEventListener("click", () => { session?.duplicateSelected(); renderMutation({ rebuild: true }); });
  root.querySelector("#world-delete").addEventListener("click", () => { session?.deleteSelected(); renderMutation({ rebuild: true }); });
  root.querySelector("#world-fit").addEventListener("click", () => preview.fit());
  root.querySelector("#world-validate").addEventListener("click", runValidation);
  root.querySelector("#world-validation-cancel").addEventListener("click", () => validation.cancel());
  root.querySelector("#world-play").addEventListener("click", playSelectedChunk);
  root.querySelector("#world-edit-chunk").addEventListener("click", editSelectedChunk);
  root.querySelector("#world-godot-command").addEventListener("click", copyGodotCommand);
  root.querySelector("#world-stream-toggle").addEventListener("click", () => streamingTimer ? stopStreaming() : startStreaming());
  root.querySelector("#world-stream-turn").addEventListener("click", () => { streamingVelocity.x *= -1; streamingVelocity.y *= -1; streamingStep(); });
  root.querySelector("#world-stream-teleport").addEventListener("click", () => streamingStep({ teleport: true }));
  root.querySelector("#world-stream-aba").addEventListener("click", () => {
    streamingStep({ teleport: true });
    setTimeout(() => {
      const first = spatialIndex?.chunkIndex.values()[0];
      if (!first) return;
      streamingPosition = { x: first.bounds.x + first.bounds.w / 2, y: first.bounds.y + first.bounds.h / 2 };
      streaming.update({ position: streamingPosition, velocity: { x: -streamingVelocity.x, y: 0 }, teleport: true });
      renderAll();
    }, 40);
  });

  renderAll();
  return {
    open,
    close,
    openWorld,
    refreshRepository,
    get session() { return session; },
    get snapshotStatus() { return session ? getSnapshotStatus(session.world, snapshot, { expectedGodotBuildId }) : null; },
    destroy() {
      stopStreaming();
      if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
      validation.terminate();
      preview.destroy();
    }
  };
}

function autoInitializeWorldStudio() {
  if (typeof document === "undefined") return;
  const root = document.querySelector("#world-studio");
  const openButton = document.querySelector("#open-world-studio");
  if (!root || !openButton) return;
  const studio = createWorldStudio({ root });
  openButton.addEventListener("click", () => studio.open());
  globalThis.cablesterWorldStudio = studio;
}

autoInitializeWorldStudio();
