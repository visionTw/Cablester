import {
  LEVEL_DOCUMENT_VERSION,
  migrateLevelDocument
} from "./level-objects.js";
import { createDefaultScene, validateScene } from "./scene-layers.js";
import {
  createVisualConfig,
  getTypeDefaultAssetId,
  validateVisualConfig
} from "./asset-library.js";
import {
  ASSET_REGISTRY_VERSION,
  DEFAULT_WORLD_REGISTRIES,
  PREFAB_REGISTRY_VERSION,
  TYPE_REGISTRY_VERSION,
  createDefaultWorldRegistries,
  createRegistryIndex,
  getRegistryEntries,
  selectWorldRegistries
} from "./world-registries.js";
import {
  CANONICAL_NUMBER_DECIMALS,
  computeContentHashSync,
  normalizeCanonicalValue,
  normalizeTransform
} from "./world-hash.js";

// The schema module is the stable facade used by repository scripts and both
// consumers. The implementation remains split by concern to keep browser
// hashing and diff logic independently testable.
export {
  computeContentHash,
  computeContentHashSync,
  serializeWorldPackage
} from "./world-hash.js";
export { resolveWorldPackage } from "./world-registries.js";
export {
  createSemanticProjection,
  godotDerivedAllowlist,
  semanticDiff
} from "./world-diff.js";

export const WORLD_SCHEMA_VERSION = 3;
export const CANONICAL_UNITS_PER_METRE = 64;
export const GODOT_BUILD_ID = "4.7.1.stable.official.a13da4feb";
export const WORLD_NAMESPACE_IDS = Object.freeze(["formal", "labs", "reference"]);
export const WORLD_ABILITY_IDS = Object.freeze([
  "rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"
]);

export const DEFAULT_STREAMING_POLICY = Object.freeze({
  prefetchDistance: 960,
  hysteresis: 256,
  unloadDelaySeconds: 2,
  keepAlive: false,
  memoryEstimateBytes: 0
});

export const DEFAULT_STATE_POLICY = Object.freeze({
  deathReset: "checkpoint",
  checkpointReset: "chunk",
  offscreen: "sleep-local",
  worldPersistence: []
});
export const STATE_POLICY_PERSISTENCE_IDS = Object.freeze(["abilities", "flags", "checkpoint"]);

const MANIFEST_VERSION_KEYS = Object.freeze([
  "gameplayTuningVersion",
  "assetRegistryVersion",
  "prefabRegistryVersion",
  "typeRegistryVersion"
]);
const KNOWN_LEVEL_KEYS = new Set([
  "schemaVersion", "metadata", "bounds", "dashCapacity", "startingAbilities",
  "reference", "statePolicy", "scene", "objects"
]);
const KNOWN_METADATA_KEYS = new Set([
  "id", "name", "category", "summary", "acceptanceLevel", "mode", "contentVersion"
]);
const KNOWN_OBJECT_KEYS = new Set([
  "id", "type", "position", "transform", "properties", "links", "tags"
]);
const VALID_DIRECTIONS = new Set(["left", "right", "up", "down", "both", "bidirectional"]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const APPROVED_GODOT_PREFAB_ROOT = "res://godot/prefabs/";

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function copyUnknown(source, knownKeys) {
  if (!isRecord(source)) return {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, value]) => [key, clone(value)]));
}

function nonEmptyRecord(value) {
  return isRecord(value) && Object.keys(value).length > 0;
}

function isApprovedGodotPrefabScene(path) {
  if (typeof path !== "string" || !path.startsWith(APPROVED_GODOT_PREFAB_ROOT) || !path.endsWith(".tscn")) return false;
  const relative = path.slice(APPROVED_GODOT_PREFAB_ROOT.length);
  return relative.length > ".tscn".length
    && !relative.includes("\\")
    && relative.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function slug(value, fallback = "world") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._:-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function defaultGameplayTuning(version = "approved-1") {
  return {
    version,
    draft: {},
    approved: {
      abilities: Object.fromEntries(WORLD_ABILITY_IDS.map((id) => [id, { id }])),
      inputDefinitions: {},
      stateSemantics: {},
      resourceCosts: {},
      tolerances: {}
    }
  };
}

function defaultBounds(bounds = {}) {
  return {
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
    w: bounds.w ?? 1,
    h: bounds.h ?? 1
  };
}

function normalizeConnection(connection = {}) {
  const knownAliases = new Set([
    "fromChunkId", "fromEntranceId", "toChunkId", "toEntranceId",
    "requiredAbility", "requiredFlag"
  ]);
  const extras = Object.fromEntries(Object.entries(connection)
    .filter(([key]) => !knownAliases.has(key)));
  return {
    ...extras,
    id: connection.id ?? "",
    from: {
      ...(isRecord(connection.from) ? connection.from : {}),
      chunkId: connection.from?.chunkId ?? connection.fromChunkId ?? "",
      entranceId: connection.from?.entranceId ?? connection.fromEntranceId ?? ""
    },
    to: {
      ...(isRecord(connection.to) ? connection.to : {}),
      chunkId: connection.to?.chunkId ?? connection.toChunkId ?? "",
      entranceId: connection.to?.entranceId ?? connection.toEntranceId ?? ""
    },
    direction: connection.direction ?? "both",
    requiredAbilities: Array.isArray(connection.requiredAbilities)
      ? connection.requiredAbilities
      : connection.requiredAbility ? [connection.requiredAbility] : [],
    requiredFlags: Array.isArray(connection.requiredFlags)
      ? connection.requiredFlags
      : connection.requiredFlag ? [connection.requiredFlag] : [],
    oneWay: connection.oneWay ?? false
  };
}

function normalizeObject(object = {}) {
  const result = { ...object };
  delete result.position;
  result.id = object.id ?? "";
  result.type = object.type ?? "";
  result.transform = normalizeTransform({
    ...(isRecord(object.transform) ? object.transform : {}),
    ...(isRecord(object.position) ? { position: object.position } : {})
  });
  result.properties = isRecord(object.properties) ? clone(object.properties) : {};
  result.links = Array.isArray(object.links) ? clone(object.links) : [];
  result.tags = Array.isArray(object.tags) ? clone(object.tags) : [];
  return result;
}

function normalizeStatePolicy(value = {}) {
  const policy = isRecord(value) ? value : {};
  const legacyKeys = new Set([
    "persistAbilities", "persistFlags", "persistCheckpoint",
    "resetMovingObjectsOnDeath", "resetFragilePlatformsOnDeath"
  ]);
  const unknown = Object.fromEntries(Object.entries(policy).filter(([key]) => !legacyKeys.has(key)));
  const worldPersistence = Array.isArray(policy.worldPersistence)
    ? policy.worldPersistence
    : [
      policy.persistAbilities === true ? "abilities" : null,
      policy.persistFlags === true ? "flags" : null,
      policy.persistCheckpoint === true ? "checkpoint" : null
    ].filter(Boolean);
  return {
    ...DEFAULT_STATE_POLICY,
    ...unknown,
    worldPersistence: [...new Set(worldPersistence)]
  };
}

function normalizeChunk(chunk = {}) {
  return {
    ...chunk,
    id: chunk.id ?? "",
    name: chunk.name ?? chunk.id ?? "",
    transform: normalizeTransform(chunk.transform),
    bounds: defaultBounds(chunk.bounds),
    streaming: { ...DEFAULT_STREAMING_POLICY, ...(isRecord(chunk.streaming) ? chunk.streaming : {}) },
    connections: Array.isArray(chunk.connections) ? chunk.connections.map(normalizeConnection) : [],
    objects: Array.isArray(chunk.objects) ? chunk.objects.map(normalizeObject) : [],
    scene: isRecord(chunk.scene) ? clone(chunk.scene) : createDefaultScene(),
    statePolicy: normalizeStatePolicy(chunk.statePolicy),
    tags: Array.isArray(chunk.tags) ? clone(chunk.tags) : [],
    ...(isRecord(chunk.gameplay) ? {
      gameplay: {
        ...chunk.gameplay,
        startingAbilities: Array.isArray(chunk.gameplay.startingAbilities)
          ? clone(chunk.gameplay.startingAbilities)
          : [],
        dashCapacity: chunk.gameplay.dashCapacity ?? 1
      }
    } : {})
  };
}

function normalizeRegion(region = {}) {
  return {
    ...region,
    id: region.id ?? "",
    name: region.name ?? region.id ?? "",
    transform: normalizeTransform(region.transform),
    bounds: defaultBounds(region.bounds),
    routes: Array.isArray(region.routes) ? clone(region.routes) : [],
    landmarks: Array.isArray(region.landmarks) ? clone(region.landmarks) : [],
    chunks: Array.isArray(region.chunks) ? region.chunks.map(normalizeChunk) : [],
    tags: Array.isArray(region.tags) ? clone(region.tags) : []
  };
}

function normalizeRegistry(registry, fallback) {
  const selected = isRecord(registry) ? registry : fallback;
  return {
    ...clone(selected),
    version: String(selected.version ?? fallback.version),
    entries: clone(getRegistryEntries(selected))
  };
}

export function normalizeWorldPackage(world) {
  if (!isRecord(world)) throw new TypeError("World Package must be an object");
  if (world.schemaVersion !== WORLD_SCHEMA_VERSION) return migrateToWorldPackage(world);

  const registries = createDefaultWorldRegistries();
  const normalized = {
    ...clone(world),
    schemaVersion: WORLD_SCHEMA_VERSION,
    manifest: {
      ...(isRecord(world.manifest) ? clone(world.manifest) : {}),
      worldId: world.manifest?.worldId ?? "world",
      title: world.manifest?.title ?? world.manifest?.worldId ?? "World",
      namespace: world.manifest?.namespace ?? "labs",
      contentVersion: world.manifest?.contentVersion ?? "1.0.0",
      contentHash: world.manifest?.contentHash ?? "",
      gameplayTuningVersion: world.manifest?.gameplayTuningVersion ?? "approved-1",
      assetRegistryVersion: String(world.manifest?.assetRegistryVersion ?? ASSET_REGISTRY_VERSION),
      prefabRegistryVersion: String(world.manifest?.prefabRegistryVersion ?? PREFAB_REGISTRY_VERSION),
      typeRegistryVersion: String(world.manifest?.typeRegistryVersion ?? TYPE_REGISTRY_VERSION)
    },
    regions: Array.isArray(world.regions) ? world.regions.map(normalizeRegion) : [],
    assetRegistry: normalizeRegistry(world.assetRegistry, registries.assetRegistry),
    prefabRegistry: normalizeRegistry(world.prefabRegistry, registries.prefabRegistry),
    typeRegistry: normalizeRegistry(world.typeRegistry, registries.typeRegistry),
    gameplayTuning: {
      ...defaultGameplayTuning(world.manifest?.gameplayTuningVersion ?? "approved-1"),
      ...(isRecord(world.gameplayTuning) ? clone(world.gameplayTuning) : {}),
      draft: isRecord(world.gameplayTuning?.draft) ? clone(world.gameplayTuning.draft) : {},
      approved: isRecord(world.gameplayTuning?.approved) ? clone(world.gameplayTuning.approved) : {}
    }
  };
  normalized.gameplayTuning.version = normalized.gameplayTuning.version
    ?? normalized.manifest.gameplayTuningVersion;
  return normalizeCanonicalValue(normalized);
}

function legacyObjectToCanonical(object) {
  const extras = copyUnknown(object, KNOWN_OBJECT_KEYS);
  const properties = isRecord(object.properties) ? clone(object.properties) : {};
  if (!isRecord(properties.visual) && typeof object.type === "string") {
    properties.visual = createVisualConfig({ assetId: getTypeDefaultAssetId(object.type) });
  }
  return {
    ...extras,
    id: object.id,
    type: object.type,
    transform: normalizeTransform({
      ...(isRecord(object.transform) ? object.transform : {}),
      position: object.position
    }),
    properties,
    links: Array.isArray(object.links) ? clone(object.links) : [],
    tags: Array.isArray(object.tags) ? clone(object.tags) : []
  };
}

/** Non-destructive, deterministic v1/v2 -> v3 migration. */
export function migrateToWorldPackage(input, options = {}) {
  if (!isRecord(input)) throw new TypeError("World Package input must be an object");
  if (input.schemaVersion === WORLD_SCHEMA_VERSION) return normalizeWorldPackage(clone(input));
  if (![1, LEVEL_DOCUMENT_VERSION].includes(input.schemaVersion)) {
    throw new Error(`Unsupported schema version: ${input.schemaVersion}`);
  }

  // The frozen contract requires v1 to use the existing v1 -> v2 adapter first.
  const level = migrateLevelDocument(input);
  const metadata = isRecord(level.metadata) ? level.metadata : {};
  const worldId = slug(options.worldId || metadata.id, "migrated-world");
  const regionId = options.regionId || `${worldId}:region`;
  const chunkId = options.chunkId || `${worldId}:chunk`;
  const namespace = options.namespace
    || (metadata.mode === "reference-room" || level.reference ? "reference" : "labs");
  const registryDefaults = createDefaultWorldRegistries();
  const selectedRegistries = {
    typeRegistry: options.typeRegistry || registryDefaults.typeRegistry,
    assetRegistry: options.assetRegistry || registryDefaults.assetRegistry,
    prefabRegistry: options.prefabRegistry || registryDefaults.prefabRegistry
  };
  const gameplayTuningVersion = options.gameplayTuningVersion || "approved-1";
  const unknownMetadata = copyUnknown(metadata, KNOWN_METADATA_KEYS);
  const unknownDocument = copyUnknown(level, KNOWN_LEVEL_KEYS);
  const extensions = {
    ...(nonEmptyRecord(unknownMetadata) ? { legacyMetadata: unknownMetadata } : {}),
    ...(nonEmptyRecord(unknownDocument) ? { legacyDocument: unknownDocument } : {})
  };
  const gameplay = {
    startingAbilities: Array.isArray(level.startingAbilities) ? clone(level.startingAbilities) : [],
    dashCapacity: level.dashCapacity ?? 1,
    ...(metadata.acceptanceLevel !== undefined ? { acceptanceLevel: clone(metadata.acceptanceLevel) } : {}),
    ...(metadata.category !== undefined ? { category: clone(metadata.category) } : {}),
    ...(metadata.summary !== undefined ? { summary: clone(metadata.summary) } : {})
  };
  const bounds = defaultBounds(level.bounds);

  const migrated = {
    schemaVersion: WORLD_SCHEMA_VERSION,
    manifest: {
      worldId,
      title: options.title || metadata.name || worldId,
      namespace,
      contentVersion: options.contentVersion || metadata.contentVersion || "1.0.0",
      contentHash: "",
      gameplayTuningVersion,
      assetRegistryVersion: String(selectedRegistries.assetRegistry.version),
      prefabRegistryVersion: String(selectedRegistries.prefabRegistry.version),
      typeRegistryVersion: String(selectedRegistries.typeRegistry.version)
    },
    regions: [{
      id: regionId,
      name: options.regionName || metadata.name || regionId,
      transform: normalizeTransform(),
      bounds: clone(bounds),
      routes: [],
      landmarks: [],
      chunks: [{
        id: chunkId,
        name: options.chunkName || metadata.name || chunkId,
        transform: normalizeTransform(),
        bounds: clone(bounds),
        streaming: clone(DEFAULT_STREAMING_POLICY),
        connections: [],
        objects: (level.objects || []).map(legacyObjectToCanonical),
        scene: isRecord(level.scene) ? clone(level.scene) : createDefaultScene(),
        statePolicy: isRecord(level.statePolicy) ? clone(level.statePolicy) : clone(DEFAULT_STATE_POLICY),
        gameplay,
        ...(level.reference !== undefined ? { reference: clone(level.reference) } : {}),
        ...(nonEmptyRecord(extensions) ? { extensions } : {}),
        tags: []
      }],
      tags: []
    }],
    assetRegistry: clone(selectedRegistries.assetRegistry),
    prefabRegistry: clone(selectedRegistries.prefabRegistry),
    typeRegistry: clone(selectedRegistries.typeRegistry),
    gameplayTuning: options.gameplayTuning
      ? clone(options.gameplayTuning)
      : defaultGameplayTuning(gameplayTuningVersion)
  };
  return normalizeWorldPackage(migrated);
}

function issue(issues, severity, code, path, message) {
  issues.push({ severity, code, path, message });
}

function validateId(issues, value, path) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    issue(issues, "error", "invalid-id", path, `${path} must be a non-empty stable ID no longer than 256 characters`);
    return false;
  }
  if (/\s/.test(value)) {
    issue(issues, "error", "invalid-id", path, `${path} must not contain whitespace`);
    return false;
  }
  return true;
}

function validateNumber(issues, value, path, { positive = false, nonNegative = false } = {}) {
  if (!Number.isFinite(value)) {
    issue(issues, "error", "non-finite-number", path, `${path} must be finite`);
    return;
  }
  if (positive && value <= 0) issue(issues, "error", "non-positive-number", path, `${path} must be greater than zero`);
  if (nonNegative && value < 0) issue(issues, "error", "negative-number", path, `${path} must not be negative`);
  if (Object.is(value, -0)) issue(issues, "warning", "negative-zero", path, `${path} will normalize to 0`);
  if (!Number.isInteger(value) && Math.abs(value) < 1e21 && Number(value.toFixed(CANONICAL_NUMBER_DECIMALS)) !== value) {
    issue(issues, "warning", "number-precision", path, `${path} will normalize to at most six decimal places`);
  }
}

function validateTransform(issues, transform, path) {
  if (!isRecord(transform)) {
    issue(issues, "error", "invalid-transform", path, `${path} must be an object`);
    return;
  }
  if (!isRecord(transform.position)) issue(issues, "error", "invalid-position", `${path}.position`, `${path}.position must be an object`);
  else {
    validateNumber(issues, transform.position.x, `${path}.position.x`);
    validateNumber(issues, transform.position.y, `${path}.position.y`);
  }
  validateNumber(issues, transform.rotationDegrees, `${path}.rotationDegrees`);
  if (!isRecord(transform.scale)) issue(issues, "error", "invalid-scale", `${path}.scale`, `${path}.scale must be an object`);
  else {
    validateNumber(issues, transform.scale.x, `${path}.scale.x`, { positive: true });
    validateNumber(issues, transform.scale.y, `${path}.scale.y`, { positive: true });
  }
}

function validateBounds(issues, bounds, path) {
  if (!isRecord(bounds)) {
    issue(issues, "error", "invalid-bounds", path, `${path} must be an object`);
    return;
  }
  validateNumber(issues, bounds.x, `${path}.x`);
  validateNumber(issues, bounds.y, `${path}.y`);
  validateNumber(issues, bounds.w, `${path}.w`, { positive: true });
  validateNumber(issues, bounds.h, `${path}.h`, { positive: true });
}

function validateJsonValues(issues, value, path = "$", seen = new WeakSet()) {
  if (typeof value === "number") {
    validateNumber(issues, value, path);
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    issue(issues, "error", "non-json-value", path, `${path} contains a non-JSON value`);
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) {
    issue(issues, "error", "cyclic-value", path, `${path} contains a cycle`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValues(issues, item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        issue(issues, "error", "forbidden-key", `${path}.${key}`, `${path}.${key} is forbidden`);
      } else {
        validateJsonValues(issues, item, `${path}.${key}`, seen);
      }
    }
  }
  seen.delete(value);
}

function validateRegistry(issues, registry, kind, path) {
  if (!isRecord(registry)) {
    issue(issues, "error", `invalid-${kind}-registry`, path, `${path} must be an object`);
    return;
  }
  if (typeof registry.version !== "string" || !registry.version) {
    issue(issues, "error", `invalid-${kind}-registry-version`, `${path}.version`, `${path}.version must be non-empty text`);
  }
  if (!Array.isArray(registry.entries)) {
    issue(issues, "error", `invalid-${kind}-registry-entries`, `${path}.entries`, `${path}.entries must be an array`);
    return;
  }
  const ids = new Set();
  registry.entries.forEach((entry, index) => {
    const entryPath = `${path}.entries[${index}]`;
    if (!isRecord(entry)) {
      issue(issues, "error", `invalid-${kind}-entry`, entryPath, `${entryPath} must be an object`);
      return;
    }
    if (validateId(issues, entry.id, `${entryPath}.id`)) {
      if (ids.has(entry.id)) issue(issues, "error", `duplicate-${kind}-id`, `${entryPath}.id`, `Duplicate ${kind} ID: ${entry.id}`);
      ids.add(entry.id);
    }
    if (kind === "type") {
      if (!isRecord(entry.pivot)) issue(issues, "error", "invalid-type-pivot", `${entryPath}.pivot`, `${entryPath}.pivot is required`);
      if (!isRecord(entry.boundsAdapter)) issue(issues, "error", "invalid-bounds-adapter", `${entryPath}.boundsAdapter`, `${entryPath}.boundsAdapter is required`);
      if (typeof entry.godotRuntimeHandler !== "string" || !entry.godotRuntimeHandler) {
        issue(issues, "error", "invalid-runtime-handler", `${entryPath}.godotRuntimeHandler`, `${entryPath}.godotRuntimeHandler is required`);
      }
      if (typeof entry.defaultPrefabId !== "string" || !entry.defaultPrefabId) {
        issue(issues, "error", "invalid-default-prefab", `${entryPath}.defaultPrefabId`, `${entryPath}.defaultPrefabId is required`);
      }
    } else if (kind === "asset") {
      if (!isRecord(entry.platforms)) issue(issues, "error", "invalid-asset-platforms", `${entryPath}.platforms`, `${entryPath}.platforms is required`);
      if (typeof entry.fallbackAllowed !== "boolean") issue(issues, "error", "invalid-fallback-policy", `${entryPath}.fallbackAllowed`, `${entryPath}.fallbackAllowed must be boolean`);
    } else if (kind === "prefab") {
      if (typeof entry.type !== "string" || !entry.type) issue(issues, "error", "invalid-prefab-type", `${entryPath}.type`, `${entryPath}.type is required`);
      if (!isApprovedGodotPrefabScene(entry.godotScene)) {
        issue(issues, "error", "invalid-godot-scene", `${entryPath}.godotScene`, `${entryPath}.godotScene must be a .tscn under ${APPROVED_GODOT_PREFAB_ROOT}`);
      }
    }
  });
}

function abilityIdsFromTuning(tuning) {
  const abilities = tuning?.approved?.abilities;
  if (Array.isArray(abilities)) return abilities.map((item) => typeof item === "string" ? item : item?.id).filter(Boolean);
  if (isRecord(abilities)) return Object.keys(abilities);
  return [];
}

function declaredStateKeys(world) {
  const keys = new Set();
  for (const entry of world?.stateDefinitions?.flags || []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (id) keys.add(id);
  }
  for (const entry of world?.stateDefinitions?.keys || []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (id) keys.add(id);
  }
  for (const region of world?.regions || []) for (const chunk of region?.chunks || []) {
    for (const object of chunk?.objects || []) {
      if (object?.type === "stateTrigger" && object.properties?.setFlag) keys.add(object.properties.setFlag);
    }
  }
  return keys;
}

function validateEditableProperties(issues, object, typeEntry, path) {
  const definitions = typeEntry?.editableProperties;
  if (!isRecord(definitions) || !isRecord(object.properties)) return;
  for (const [key, definition] of Object.entries(definitions)) {
    const value = object.properties[key];
    if (value === undefined) {
      issue(issues, "error", "missing-type-property", `${path}.properties.${key}`, `${path}.properties.${key} is required for ${object.type}`);
      continue;
    }
    if (definition.kind === "number") {
      if (!Number.isFinite(value) || value < definition.min || value > definition.max) {
        issue(issues, "error", "invalid-type-property", `${path}.properties.${key}`, `${path}.properties.${key} must be from ${definition.min} to ${definition.max}`);
      }
    } else if (definition.kind === "boolean" && typeof value !== "boolean") {
      issue(issues, "error", "invalid-type-property", `${path}.properties.${key}`, `${path}.properties.${key} must be boolean`);
    } else if (definition.kind === "text" && typeof value !== "string") {
      issue(issues, "error", "invalid-type-property", `${path}.properties.${key}`, `${path}.properties.${key} must be text`);
    } else if (definition.kind === "select" && !definition.options?.some(([id]) => id === value)) {
      issue(issues, "error", "invalid-type-property", `${path}.properties.${key}`, `${path}.properties.${key} is not an allowed value`);
    }
  }
}

function referencedAssetIds(chunk) {
  const references = [];
  for (const [index, layer] of (chunk?.scene?.layers || []).entries()) {
    if (typeof layer?.assetId === "string" && layer.assetId) references.push({ id: layer.assetId, path: `scene.layers[${index}].assetId` });
    for (const [assetIndex, asset] of (Array.isArray(layer?.assets) ? layer.assets : []).entries()) {
      if (typeof asset?.assetId === "string" && asset.assetId) {
        references.push({ id: asset.assetId, path: `scene.layers[${index}].assets[${assetIndex}].assetId` });
      }
    }
  }
  return references;
}

export function isCompatibleGodotBuildId(buildId, { approvedGodotBuildIds = [] } = {}) {
  return buildId === GODOT_BUILD_ID || approvedGodotBuildIds.includes(buildId);
}

/** Returns machine-readable issues; callers decide whether warnings block. */
export function validateWorldPackage(world, options = {}) {
  const issues = [];
  if (!isRecord(world)) return [{ severity: "error", code: "invalid-world", path: "$", message: "World Package must be an object" }];
  validateJsonValues(issues, world);
  if (world.schemaVersion !== WORLD_SCHEMA_VERSION) {
    issue(issues, "error", "unsupported-schema-version", "schemaVersion", `schemaVersion must be ${WORLD_SCHEMA_VERSION}`);
    return issues;
  }

  const manifest = world.manifest;
  if (!isRecord(manifest)) {
    issue(issues, "error", "missing-manifest", "manifest", "manifest is required");
  } else {
    validateId(issues, manifest.worldId, "manifest.worldId");
    if (typeof manifest.title !== "string" || !manifest.title.trim()) issue(issues, "error", "invalid-title", "manifest.title", "manifest.title is required");
    if (!WORLD_NAMESPACE_IDS.includes(manifest.namespace)) issue(issues, "error", "invalid-namespace", "manifest.namespace", `manifest.namespace must be one of ${WORLD_NAMESPACE_IDS.join(", ")}`);
    if (typeof manifest.contentVersion !== "string" || !manifest.contentVersion) issue(issues, "error", "invalid-content-version", "manifest.contentVersion", "manifest.contentVersion is required");
    if (manifest.contentHash !== "" && (typeof manifest.contentHash !== "string" || !HASH_PATTERN.test(manifest.contentHash))) {
      issue(issues, "error", "invalid-content-hash", "manifest.contentHash", "manifest.contentHash must be empty or sha256: followed by 64 lowercase hex characters");
    }
    for (const key of MANIFEST_VERSION_KEYS) {
      if (typeof manifest[key] !== "string" || !manifest[key]) issue(issues, "error", "missing-version", `manifest.${key}`, `manifest.${key} is required`);
    }
    let computedHash = options.contentHash;
    if (computedHash === undefined && HASH_PATTERN.test(manifest.contentHash)) {
      try {
        computedHash = computeContentHashSync(world);
      } catch {
        // The JSON/value diagnostics above provide the more useful error when
        // malformed data cannot be hashed.
      }
    }
    if (computedHash && manifest.contentHash !== computedHash) {
      issue(issues, "error", "content-hash-mismatch", "manifest.contentHash", `Declared contentHash ${manifest.contentHash} does not match ${computedHash}`);
    }
  }

  const buildIds = [
    [options.godotBuildId, "godotBuildId"],
    [world.godotCompatibility?.requiredBuildId, "godotCompatibility.requiredBuildId"],
    [manifest?.godotBuildId || manifest?.requiredGodotBuildId, "manifest.godotBuildId"]
  ].filter(([buildId]) => Boolean(buildId));
  for (const [buildId, path] of buildIds) {
    if (!isCompatibleGodotBuildId(buildId, options)) {
      issue(issues, "error", "incompatible-godot-build", path, `Godot build ${buildId} is not approved; expected ${GODOT_BUILD_ID}`);
    }
  }

  validateRegistry(issues, world.typeRegistry, "type", "typeRegistry");
  validateRegistry(issues, world.assetRegistry, "asset", "assetRegistry");
  validateRegistry(issues, world.prefabRegistry, "prefab", "prefabRegistry");
  if (manifest) {
    if (world.typeRegistry?.version !== manifest.typeRegistryVersion) issue(issues, "error", "registry-version-mismatch", "manifest.typeRegistryVersion", "Type registry version does not match the manifest");
    if (world.assetRegistry?.version !== manifest.assetRegistryVersion) issue(issues, "error", "registry-version-mismatch", "manifest.assetRegistryVersion", "Asset registry version does not match the manifest");
    if (world.prefabRegistry?.version !== manifest.prefabRegistryVersion) issue(issues, "error", "registry-version-mismatch", "manifest.prefabRegistryVersion", "Prefab registry version does not match the manifest");
    if (world.gameplayTuning?.version !== manifest.gameplayTuningVersion) issue(issues, "error", "tuning-version-mismatch", "manifest.gameplayTuningVersion", "Gameplay tuning version does not match the manifest");
  }
  if (!isRecord(world.gameplayTuning) || !isRecord(world.gameplayTuning.draft) || !isRecord(world.gameplayTuning.approved)) {
    issue(issues, "error", "invalid-gameplay-tuning", "gameplayTuning", "gameplayTuning requires version, draft, and approved channels");
  }

  const selected = selectWorldRegistries(world, options.registries || {});
  const typeIndex = createRegistryIndex(selected.typeRegistry);
  const assetIndex = createRegistryIndex(selected.assetRegistry);
  const prefabIndex = createRegistryIndex(selected.prefabRegistry);
  for (const [typeId, typeEntry] of typeIndex) {
    if (!prefabIndex.has(typeEntry.defaultPrefabId)) {
      issue(issues, "error", "unresolved-default-prefab", `typeRegistry.entries.${typeId}.defaultPrefabId`, `Type ${typeId} references missing default prefab ${typeEntry.defaultPrefabId}`);
    }
    if (typeEntry.defaultAssetId && !assetIndex.has(typeEntry.defaultAssetId)) {
      issue(issues, "error", "unresolved-default-asset", `typeRegistry.entries.${typeId}.defaultAssetId`, `Type ${typeId} references missing default asset ${typeEntry.defaultAssetId}`);
    }
  }
  for (const [prefabId, prefab] of prefabIndex) {
    if (!typeIndex.has(prefab.type)) {
      issue(issues, "error", "unresolved-prefab-type", `prefabRegistry.entries.${prefabId}.type`, `Prefab ${prefabId} references missing type ${prefab.type}`);
    }
  }
  const knownAbilities = new Set([...WORLD_ABILITY_IDS, ...abilityIdsFromTuning(world.gameplayTuning)]);
  const knownStateKeys = declaredStateKeys(world);
  const regionIds = new Set();
  const chunkIds = new Set();
  const objectIds = new Set();
  const connectionIds = new Set();
  const chunksById = new Map();
  const entrancesByChunk = new Map();
  const pendingConnections = [];
  const pendingLinks = [];
  const pendingStateReferences = [];
  const pendingRouteChunks = [];
  const pendingLandmarkChunks = [];

  if (!Array.isArray(world.regions) || world.regions.length === 0) {
    issue(issues, "error", "missing-regions", "regions", "regions must contain at least one region");
  }
  for (const [regionIndex, region] of (Array.isArray(world.regions) ? world.regions : []).entries()) {
    const regionPath = `regions[${regionIndex}]`;
    if (!isRecord(region)) {
      issue(issues, "error", "invalid-region", regionPath, `${regionPath} must be an object`);
      continue;
    }
    if (validateId(issues, region.id, `${regionPath}.id`)) {
      if (regionIds.has(region.id)) issue(issues, "error", "duplicate-region-id", `${regionPath}.id`, `Duplicate region ID: ${region.id}`);
      regionIds.add(region.id);
    }
    if (typeof region.name !== "string" || !region.name) issue(issues, "error", "invalid-region-name", `${regionPath}.name`, `${regionPath}.name is required`);
    validateTransform(issues, region.transform, `${regionPath}.transform`);
    validateBounds(issues, region.bounds, `${regionPath}.bounds`);
    if (!Array.isArray(region.routes)) issue(issues, "error", "invalid-routes", `${regionPath}.routes`, `${regionPath}.routes must be an array`);
    if (!Array.isArray(region.landmarks)) issue(issues, "error", "invalid-landmarks", `${regionPath}.landmarks`, `${regionPath}.landmarks must be an array`);
    if (!Array.isArray(region.tags) || region.tags.some((tag) => typeof tag !== "string")) issue(issues, "error", "invalid-tags", `${regionPath}.tags`, `${regionPath}.tags must contain strings`);
    const routeIds = new Set();
    for (const [routeIndex, route] of (Array.isArray(region.routes) ? region.routes : []).entries()) {
      const routePath = `${regionPath}.routes[${routeIndex}]`;
      if (!isRecord(route)) {
        issue(issues, "error", "invalid-route", routePath, `${routePath} must be an object`);
        continue;
      }
      if (validateId(issues, route.id, `${routePath}.id`)) {
        if (routeIds.has(route.id)) issue(issues, "error", "duplicate-route-id", `${routePath}.id`, `Duplicate route ID: ${route.id}`);
        routeIds.add(route.id);
      }
      if (!Array.isArray(route.chunks)) issue(issues, "error", "invalid-route-chunks", `${routePath}.chunks`, `${routePath}.chunks must be an array`);
      else pendingRouteChunks.push(...route.chunks.map((chunkId, index) => ({ chunkId, path: `${routePath}.chunks[${index}]` })));
    }
    const landmarkIds = new Set();
    for (const [landmarkIndex, landmark] of (Array.isArray(region.landmarks) ? region.landmarks : []).entries()) {
      const landmarkPath = `${regionPath}.landmarks[${landmarkIndex}]`;
      if (!isRecord(landmark)) {
        issue(issues, "error", "invalid-landmark", landmarkPath, `${landmarkPath} must be an object`);
        continue;
      }
      if (validateId(issues, landmark.id, `${landmarkPath}.id`)) {
        if (landmarkIds.has(landmark.id)) issue(issues, "error", "duplicate-landmark-id", `${landmarkPath}.id`, `Duplicate landmark ID: ${landmark.id}`);
        landmarkIds.add(landmark.id);
      }
      if (landmark?.assetId && !assetIndex.has(landmark.assetId)) {
        issue(issues, "error", "unresolved-asset", `${landmarkPath}.assetId`, `Missing landmark asset: ${landmark.assetId}`);
      }
      if (landmark.chunkId) pendingLandmarkChunks.push({ chunkId: landmark.chunkId, path: `${landmarkPath}.chunkId` });
      if (landmark.position !== undefined) {
        if (!isRecord(landmark.position)) issue(issues, "error", "invalid-landmark-position", `${landmarkPath}.position`, `${landmarkPath}.position must be an object`);
        else {
          validateNumber(issues, landmark.position.x, `${landmarkPath}.position.x`);
          validateNumber(issues, landmark.position.y, `${landmarkPath}.position.y`);
        }
      }
    }
    if (!Array.isArray(region.chunks) || region.chunks.length === 0) issue(issues, "error", "missing-chunks", `${regionPath}.chunks`, `${regionPath}.chunks must not be empty`);

    for (const [chunkIndex, chunk] of (Array.isArray(region.chunks) ? region.chunks : []).entries()) {
      const chunkPath = `${regionPath}.chunks[${chunkIndex}]`;
      if (!isRecord(chunk)) {
        issue(issues, "error", "invalid-chunk", chunkPath, `${chunkPath} must be an object`);
        continue;
      }
      if (validateId(issues, chunk.id, `${chunkPath}.id`)) {
        if (chunkIds.has(chunk.id)) issue(issues, "error", "duplicate-chunk-id", `${chunkPath}.id`, `Duplicate chunk ID: ${chunk.id}`);
        chunkIds.add(chunk.id);
        chunksById.set(chunk.id, chunk);
      }
      if (typeof chunk.name !== "string" || !chunk.name) issue(issues, "error", "invalid-chunk-name", `${chunkPath}.name`, `${chunkPath}.name is required`);
      validateTransform(issues, chunk.transform, `${chunkPath}.transform`);
      validateBounds(issues, chunk.bounds, `${chunkPath}.bounds`);
      if (!isRecord(chunk.streaming)) issue(issues, "error", "invalid-streaming", `${chunkPath}.streaming`, `${chunkPath}.streaming is required`);
      else {
        validateNumber(issues, chunk.streaming.prefetchDistance, `${chunkPath}.streaming.prefetchDistance`, { nonNegative: true });
        validateNumber(issues, chunk.streaming.hysteresis, `${chunkPath}.streaming.hysteresis`, { nonNegative: true });
        validateNumber(issues, chunk.streaming.unloadDelaySeconds, `${chunkPath}.streaming.unloadDelaySeconds`, { nonNegative: true });
        validateNumber(issues, chunk.streaming.memoryEstimateBytes, `${chunkPath}.streaming.memoryEstimateBytes`, { nonNegative: true });
        if (typeof chunk.streaming.keepAlive !== "boolean") issue(issues, "error", "invalid-keep-alive", `${chunkPath}.streaming.keepAlive`, `${chunkPath}.streaming.keepAlive must be boolean`);
      }
      if (!isRecord(chunk.scene) || !Array.isArray(chunk.scene.layers)) issue(issues, "error", "invalid-scene", `${chunkPath}.scene`, `${chunkPath}.scene.layers must be an array`);
      else for (const sceneError of validateScene(chunk.scene)) issue(issues, "error", "invalid-scene", `${chunkPath}.scene`, sceneError);
      if (!isRecord(chunk.statePolicy)) issue(issues, "error", "invalid-state-policy", `${chunkPath}.statePolicy`, `${chunkPath}.statePolicy must be an object`);
      else {
        if (!["checkpoint", "chunk", "world"].includes(chunk.statePolicy.deathReset)) issue(issues, "error", "invalid-state-policy", `${chunkPath}.statePolicy.deathReset`, `${chunkPath}.statePolicy.deathReset must be checkpoint, chunk, or world`);
        if (!["chunk", "world"].includes(chunk.statePolicy.checkpointReset)) issue(issues, "error", "invalid-state-policy", `${chunkPath}.statePolicy.checkpointReset`, `${chunkPath}.statePolicy.checkpointReset must be chunk or world`);
        if (!["sleep-local", "reset-local", "simulate"].includes(chunk.statePolicy.offscreen)) issue(issues, "error", "invalid-state-policy", `${chunkPath}.statePolicy.offscreen`, `${chunkPath}.statePolicy.offscreen must be sleep-local, reset-local, or simulate`);
        if (!Array.isArray(chunk.statePolicy.worldPersistence)
          || chunk.statePolicy.worldPersistence.some((id) => !STATE_POLICY_PERSISTENCE_IDS.includes(id))
          || new Set(chunk.statePolicy.worldPersistence).size !== chunk.statePolicy.worldPersistence.length) {
          issue(issues, "error", "invalid-state-policy", `${chunkPath}.statePolicy.worldPersistence`, `${chunkPath}.statePolicy.worldPersistence must contain unique abilities, flags, and/or checkpoint IDs`);
        }
      }
      if (!Array.isArray(chunk.tags)) issue(issues, "error", "invalid-tags", `${chunkPath}.tags`, `${chunkPath}.tags must be an array`);
      if (chunk.gameplay !== undefined) {
        if (!isRecord(chunk.gameplay)) issue(issues, "error", "invalid-gameplay", `${chunkPath}.gameplay`, `${chunkPath}.gameplay must be an object`);
        else {
          if (!Array.isArray(chunk.gameplay.startingAbilities)) issue(issues, "error", "invalid-starting-abilities", `${chunkPath}.gameplay.startingAbilities`, `${chunkPath}.gameplay.startingAbilities must be an array`);
          else for (const [abilityIndex, ability] of chunk.gameplay.startingAbilities.entries()) {
            if (!knownAbilities.has(ability)) issue(issues, "error", "unresolved-ability", `${chunkPath}.gameplay.startingAbilities[${abilityIndex}]`, `Unknown ability: ${ability}`);
          }
          if (!Number.isInteger(chunk.gameplay.dashCapacity) || chunk.gameplay.dashCapacity < 1 || chunk.gameplay.dashCapacity > 3) {
            issue(issues, "error", "invalid-dash-capacity", `${chunkPath}.gameplay.dashCapacity`, `${chunkPath}.gameplay.dashCapacity must be an integer from 1 to 3`);
          }
        }
      }

      const entranceIds = new Set();
      if (!Array.isArray(chunk.objects)) issue(issues, "error", "invalid-objects", `${chunkPath}.objects`, `${chunkPath}.objects must be an array`);
      for (const [objectIndex, object] of (Array.isArray(chunk.objects) ? chunk.objects : []).entries()) {
        const objectPath = `${chunkPath}.objects[${objectIndex}]`;
        if (!isRecord(object)) {
          issue(issues, "error", "invalid-object", objectPath, `${objectPath} must be an object`);
          continue;
        }
        if (validateId(issues, object.id, `${objectPath}.id`)) {
          if (objectIds.has(object.id)) issue(issues, "error", "duplicate-object-id", `${objectPath}.id`, `Duplicate global object ID: ${object.id}`);
          objectIds.add(object.id);
          if (object.type === "roomEntrance") entranceIds.add(object.id);
        }
        if (typeof object.type !== "string" || !object.type) issue(issues, "error", "invalid-object-type", `${objectPath}.type`, `${objectPath}.type is required`);
        validateTransform(issues, object.transform, `${objectPath}.transform`);
        if (!isRecord(object.properties)) issue(issues, "error", "invalid-properties", `${objectPath}.properties`, `${objectPath}.properties must be an object`);
        else if (object.properties.visual !== undefined) {
          for (const visualError of validateVisualConfig(object.properties.visual, { path: `${objectPath}.properties.visual` })) {
            issue(issues, "error", "invalid-visual", `${objectPath}.properties.visual`, visualError);
          }
        }
        if (!Array.isArray(object.links)) issue(issues, "error", "invalid-links", `${objectPath}.links`, `${objectPath}.links must be an array`);
        else pendingLinks.push(...object.links.map((link, index) => ({ link, path: `${objectPath}.links[${index}]` })));
        if (!Array.isArray(object.tags) || object.tags.some((tag) => typeof tag !== "string")) issue(issues, "error", "invalid-tags", `${objectPath}.tags`, `${objectPath}.tags must contain strings`);

        const typeEntry = typeIndex.get(object.type);
        if (!typeEntry) {
          issue(issues, manifest?.namespace === "formal" ? "error" : "warning", "unresolved-type", `${objectPath}.type`, `Unknown object type: ${object.type}`);
          const explicitPrefabId = object.prefabId || object.properties?.prefabId;
          if (explicitPrefabId && !prefabIndex.has(explicitPrefabId)) {
            issue(issues, "error", "unresolved-prefab", `${objectPath}.prefabId`, `Missing prefab: ${explicitPrefabId}`);
          }
        } else {
          validateEditableProperties(issues, object, typeEntry, objectPath);
          const prefabId = object.prefabId || object.properties?.prefabId || typeEntry.defaultPrefabId;
          if (!prefabIndex.has(prefabId)) issue(issues, "error", "unresolved-prefab", `${objectPath}.prefabId`, `Missing prefab: ${prefabId}`);
          else if (prefabIndex.get(prefabId).type !== object.type) issue(issues, "error", "prefab-type-mismatch", `${objectPath}.prefabId`, `Prefab ${prefabId} is registered for ${prefabIndex.get(prefabId).type}, not ${object.type}`);
          const assetId = object.properties?.visual?.assetId || object.properties?.assetId || typeEntry.defaultAssetId;
          if (assetId && !assetIndex.has(assetId)) issue(issues, "error", "unresolved-asset", `${objectPath}.properties.visual.assetId`, `Missing asset: ${assetId}`);
          else if (assetId) {
            const asset = assetIndex.get(assetId);
            if (!asset.applicableTypes?.includes("*") && !asset.applicableTypes?.includes(object.type)) {
              issue(issues, "error", "asset-type-mismatch", `${objectPath}.properties.visual.assetId`, `Asset ${assetId} is not registered for ${object.type}`);
            }
          }
        }
        const explicitAssetId = object.properties?.visual?.assetId || object.properties?.assetId;
        if (explicitAssetId && !assetIndex.has(explicitAssetId)) issue(issues, "error", "unresolved-asset", `${objectPath}.properties.visual.assetId`, `Missing asset: ${explicitAssetId}`);
        const requiredAbility = object.properties?.requiredAbility || (object.type === "abilityPickup" ? object.properties?.abilityId : null);
        if (requiredAbility && !knownAbilities.has(requiredAbility)) issue(issues, "error", "unresolved-ability", `${objectPath}.properties.requiredAbility`, `Unknown ability: ${requiredAbility}`);
        for (const key of ["requiredFlag", "clearFlag", "clearedByFlag"]) {
          if (object.properties?.[key]) pendingStateReferences.push({ id: object.properties[key], path: `${objectPath}.properties.${key}` });
        }
      }
      entrancesByChunk.set(chunk.id, entranceIds);

      for (const reference of referencedAssetIds(chunk)) {
        if (!assetIndex.has(reference.id)) issue(issues, "error", "unresolved-asset", `${chunkPath}.${reference.path}`, `Missing scene asset: ${reference.id}`);
      }
      if (!Array.isArray(chunk.connections)) issue(issues, "error", "invalid-connections", `${chunkPath}.connections`, `${chunkPath}.connections must be an array`);
      for (const [connectionIndex, connection] of (Array.isArray(chunk.connections) ? chunk.connections : []).entries()) {
        const connectionPath = `${chunkPath}.connections[${connectionIndex}]`;
        if (!isRecord(connection)) {
          issue(issues, "error", "invalid-connection", connectionPath, `${connectionPath} must be an object`);
          continue;
        }
        if (validateId(issues, connection.id, `${connectionPath}.id`)) {
          if (connectionIds.has(connection.id)) issue(issues, "error", "duplicate-connection-id", `${connectionPath}.id`, `Duplicate connection ID: ${connection.id}`);
          connectionIds.add(connection.id);
        }
        if (!isRecord(connection.from) || !isRecord(connection.to)) issue(issues, "error", "invalid-connection-endpoint", connectionPath, `${connectionPath} requires from and to endpoints`);
        if (connection.from?.chunkId !== chunk.id) issue(issues, "error", "connection-owner-mismatch", `${connectionPath}.from.chunkId`, `Connection ${connection.id} must be stored on its from chunk ${connection.from?.chunkId}`);
        if (!VALID_DIRECTIONS.has(connection.direction)) issue(issues, "error", "invalid-connection-direction", `${connectionPath}.direction`, `Unsupported direction: ${connection.direction}`);
        if (typeof connection.oneWay !== "boolean") issue(issues, "error", "invalid-one-way", `${connectionPath}.oneWay`, `${connectionPath}.oneWay must be boolean`);
        if (!Array.isArray(connection.requiredAbilities)) issue(issues, "error", "invalid-ability-gates", `${connectionPath}.requiredAbilities`, `${connectionPath}.requiredAbilities must be an array`);
        else for (const [index, ability] of connection.requiredAbilities.entries()) {
          if (!knownAbilities.has(ability)) issue(issues, "error", "unresolved-ability", `${connectionPath}.requiredAbilities[${index}]`, `Unknown ability: ${ability}`);
        }
        if (!Array.isArray(connection.requiredFlags)) issue(issues, "error", "invalid-flag-gates", `${connectionPath}.requiredFlags`, `${connectionPath}.requiredFlags must be an array`);
        else for (const [index, flag] of connection.requiredFlags.entries()) pendingStateReferences.push({ id: flag, path: `${connectionPath}.requiredFlags[${index}]` });
        pendingConnections.push({ connection, path: connectionPath });
      }
    }
  }

  for (const { connection, path } of pendingConnections) {
    for (const endpointName of ["from", "to"]) {
      const endpoint = connection[endpointName];
      if (!chunksById.has(endpoint?.chunkId)) issue(issues, "error", "unresolved-connection-chunk", `${path}.${endpointName}.chunkId`, `Unknown chunk: ${endpoint?.chunkId}`);
      const entrances = entrancesByChunk.get(endpoint?.chunkId);
      if (!entrances?.has(endpoint?.entranceId)) issue(issues, "error", "unresolved-connection-entrance", `${path}.${endpointName}.entranceId`, `Unknown roomEntrance ${endpoint?.entranceId} in chunk ${endpoint?.chunkId}`);
    }
  }
  for (const reference of pendingRouteChunks) {
    if (!chunkIds.has(reference.chunkId)) issue(issues, "error", "unresolved-route-chunk", reference.path, `Unknown route chunk: ${reference.chunkId}`);
  }
  for (const reference of pendingLandmarkChunks) {
    if (!chunkIds.has(reference.chunkId)) issue(issues, "error", "unresolved-landmark-chunk", reference.path, `Unknown landmark chunk: ${reference.chunkId}`);
  }
  const allStableIds = new Set([...regionIds, ...chunkIds, ...objectIds, ...connectionIds]);
  for (const { link, path } of pendingLinks) {
    const target = typeof link === "string" ? link : link?.targetId || link?.objectId || link?.chunkId || link?.id;
    if (typeof target !== "string" || !allStableIds.has(target)) issue(issues, "error", "unresolved-link", path, `Link target is missing: ${target}`);
  }
  for (const reference of pendingStateReferences) {
    if (!knownStateKeys.has(reference.id)) issue(issues, "error", "unresolved-state", reference.path, `Unknown state key: ${reference.id}`);
  }
  return issues;
}

function findChunk(world, regionId, chunkId) {
  const region = world.regions?.find((entry) => entry.id === regionId);
  if (!region) throw new Error(`Unknown region: ${regionId}`);
  const chunk = region.chunks?.find((entry) => entry.id === chunkId);
  if (!chunk) throw new Error(`Unknown chunk: ${chunkId}`);
  return { region, chunk };
}

function objectToLevelObject(object) {
  const properties = clone(object.properties || {});
  const hadVisual = isRecord(properties.visual);
  if (!hadVisual) properties.visual = createVisualConfig({ assetId: getTypeDefaultAssetId(object.type) });
  const extensions = copyUnknown(object, new Set(["id", "type", "transform", "properties", "links", "tags"]));
  return {
    id: object.id,
    type: object.type,
    position: clone(object.transform.position),
    properties,
    worldAdapter: {
      transform: clone(object.transform),
      links: clone(object.links || []),
      tags: clone(object.tags || []),
      hadVisual,
      extensions
    }
  };
}

export function chunkToLevelDocument(world, regionId, chunkId) {
  const normalized = normalizeWorldPackage(world);
  const { chunk } = findChunk(normalized, regionId, chunkId);
  const gameplay = isRecord(chunk.gameplay) ? chunk.gameplay : {};
  const legacyMetadata = isRecord(chunk.extensions?.legacyMetadata) ? chunk.extensions.legacyMetadata : {};
  return normalizeCanonicalValue({
    schemaVersion: LEVEL_DOCUMENT_VERSION,
    metadata: {
      ...clone(legacyMetadata),
      id: chunk.id,
      name: chunk.name,
      category: gameplay.category ?? "Canonical 区块",
      summary: gameplay.summary ?? "由 World Package v3 区块适配。",
      ...(gameplay.acceptanceLevel !== undefined ? { acceptanceLevel: clone(gameplay.acceptanceLevel) } : {})
    },
    bounds: clone(chunk.bounds),
    dashCapacity: gameplay.dashCapacity ?? 1,
    startingAbilities: Array.isArray(gameplay.startingAbilities) ? clone(gameplay.startingAbilities) : [],
    ...(chunk.reference !== undefined ? { reference: clone(chunk.reference) } : {}),
    statePolicy: clone(chunk.statePolicy),
    scene: clone(chunk.scene),
    objects: chunk.objects.map(objectToLevelObject),
    worldAdapter: { regionId, chunkId }
  });
}

function levelObjectToCanonical(object) {
  const adapter = isRecord(object.worldAdapter) ? object.worldAdapter : {};
  const properties = isRecord(object.properties) ? clone(object.properties) : {};
  if (adapter.hadVisual === false) delete properties.visual;
  return {
    ...(isRecord(adapter.extensions) ? clone(adapter.extensions) : {}),
    id: object.id,
    type: object.type,
    transform: normalizeTransform({
      ...(isRecord(adapter.transform) ? adapter.transform : {}),
      position: object.position
    }),
    properties,
    links: Array.isArray(adapter.links) ? clone(adapter.links) : Array.isArray(object.links) ? clone(object.links) : [],
    tags: Array.isArray(adapter.tags) ? clone(adapter.tags) : Array.isArray(object.tags) ? clone(object.tags) : []
  };
}

export function applyLevelDocumentToChunk(world, regionId, chunkId, document) {
  const normalized = normalizeWorldPackage(world);
  const migratedDocument = migrateLevelDocument(document);
  const { chunk } = findChunk(normalized, regionId, chunkId);
  const metadata = isRecord(migratedDocument.metadata) ? migratedDocument.metadata : {};
  const unknownMetadata = copyUnknown(metadata, KNOWN_METADATA_KEYS);
  chunk.name = metadata.name || chunk.name;
  chunk.bounds = defaultBounds(migratedDocument.bounds);
  chunk.scene = isRecord(migratedDocument.scene) ? clone(migratedDocument.scene) : chunk.scene;
  chunk.statePolicy = isRecord(migratedDocument.statePolicy) ? clone(migratedDocument.statePolicy) : chunk.statePolicy;
  chunk.objects = Array.isArray(migratedDocument.objects) ? migratedDocument.objects.map(levelObjectToCanonical) : [];
  chunk.gameplay = {
    ...(isRecord(chunk.gameplay) ? chunk.gameplay : {}),
    startingAbilities: Array.isArray(migratedDocument.startingAbilities) ? clone(migratedDocument.startingAbilities) : [],
    dashCapacity: migratedDocument.dashCapacity ?? 1,
    ...(metadata.acceptanceLevel !== undefined ? { acceptanceLevel: clone(metadata.acceptanceLevel) } : {}),
    ...(metadata.category !== undefined ? { category: clone(metadata.category) } : {}),
    ...(metadata.summary !== undefined ? { summary: clone(metadata.summary) } : {})
  };
  if (migratedDocument.reference !== undefined) chunk.reference = clone(migratedDocument.reference);
  else delete chunk.reference;
  chunk.extensions = {
    ...(isRecord(chunk.extensions) ? chunk.extensions : {}),
    ...(nonEmptyRecord(unknownMetadata) ? { legacyMetadata: unknownMetadata } : {})
  };
  normalized.manifest.contentHash = "";
  return normalizeWorldPackage(normalized);
}
