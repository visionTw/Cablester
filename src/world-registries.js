import { LEVEL_OBJECT_LIBRARY } from "./level-objects.js";
import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY as LEGACY_ASSET_REGISTRY,
  DEFAULT_TYPE_ASSET_IDS
} from "./asset-library.js";
import {
  IDENTITY_TRANSFORM,
  composeTransforms,
  normalizeCanonicalValue,
  normalizeTransform,
  transformBounds
} from "./world-hash.js";

export const TYPE_REGISTRY_VERSION = "1";
export const ASSET_REGISTRY_VERSION = "1";
export const PREFAB_REGISTRY_VERSION = "1";
export const GENERIC_GODOT_PREFAB_PATH = "res://godot/prefabs/canonical_object.tscn";

const RECT_TYPES = new Set([
  "checkpoint", "roomEntrance", "roomExit", "boundaryWall", "platform",
  "hazard", "windZone", "liquidZone", "darknessZone", "rotationTrigger",
  "movingObject", "launcher", "fragilePlatform", "gate", "stateTrigger"
]);
const POINT_TYPES = new Set(["spawn", "anchor", "bashTarget", "energyOrb", "abilityPickup", "sign"]);
const NON_COLLIDING_TYPES = new Set(["spawn", "goal", "sign", "backgroundSeed"]);

function clone(value) {
  return structuredClone(value);
}

function boundsAdapterFor(type) {
  if (RECT_TYPES.has(type)) return { kind: "rect", widthProperty: "w", heightProperty: "h" };
  if (type === "slope") return { kind: "slope", dxProperty: "dx", dyProperty: "dy", thicknessProperty: "thickness" };
  if (type === "goal" || type === "dashRefill") return { kind: "circle", radiusProperty: "radius" };
  if (type === "backgroundSeed") return { kind: "circle", radiusProperty: "size" };
  if (POINT_TYPES.has(type)) return { kind: "point", radius: type === "energyOrb" ? 16 : 12 };
  return { kind: "point", radius: 0 };
}

function pivotFor(type) {
  if (RECT_TYPES.has(type) || type === "slope") return { x: 0, y: 0, mode: "top-left" };
  return { x: 0.5, y: 0.5, mode: "center" };
}

function collisionSemanticsFor(type) {
  if (NON_COLLIDING_TYPES.has(type)) return "none";
  if (["hazard", "liquidZone"].includes(type)) return "trigger-and-contact";
  if (["windZone", "darknessZone", "rotationTrigger", "checkpoint", "roomEntrance", "roomExit", "stateTrigger", "abilityPickup", "energyOrb", "dashRefill"].includes(type)) {
    return "trigger";
  }
  return "solid";
}

export const TYPE_REGISTRY_ENTRIES = Object.freeze(Object.entries(LEVEL_OBJECT_LIBRARY).map(([id, definition]) => Object.freeze({
  id,
  label: definition.label,
  category: definition.category,
  pivot: Object.freeze(pivotFor(id)),
  boundsAdapter: Object.freeze(boundsAdapterFor(id)),
  editableProperties: clone(definition.properties),
  godotRuntimeHandler: id,
  collisionSemantics: collisionSemanticsFor(id),
  scaleSemantics: NON_COLLIDING_TYPES.has(id) ? "transform-only" : "gameplay-and-collision",
  required: true,
  defaultPrefabId: `prefab:${id}`,
  defaultAssetId: DEFAULT_TYPE_ASSET_IDS[id]
})));

function godotAssetPath(path) {
  return typeof path === "string" ? `res://${path.replace(/^\.\//, "")}` : null;
}

export const ASSET_REGISTRY_ENTRIES = Object.freeze(LEGACY_ASSET_REGISTRY.assets.map((asset) => Object.freeze({
  id: asset.id,
  label: asset.label,
  kind: asset.kind,
  applicableTypes: clone(asset.applicableTypes),
  platforms: Object.freeze({
    web: Object.freeze({ path: asset.path, thumbnailPath: asset.thumbnailPath }),
    godot: Object.freeze({ path: godotAssetPath(asset.path) })
  }),
  fallbackAllowed: true,
  fallbackAssetId: asset.id === BUILTIN_PROCEDURAL_ASSET_ID ? null : BUILTIN_PROCEDURAL_ASSET_ID,
  tags: clone(asset.tags),
  ...(asset.scaling ? { scaling: clone(asset.scaling) } : {}),
  license: clone(asset.license)
})));

export const PREFAB_REGISTRY_ENTRIES = Object.freeze(Object.keys(LEVEL_OBJECT_LIBRARY).map((type) => Object.freeze({
  id: `prefab:${type}`,
  type,
  godotScene: GENERIC_GODOT_PREFAB_PATH,
  required: true
})));

export const DEFAULT_TYPE_REGISTRY = Object.freeze({
  version: TYPE_REGISTRY_VERSION,
  entries: TYPE_REGISTRY_ENTRIES
});

export const DEFAULT_ASSET_REGISTRY = Object.freeze({
  version: ASSET_REGISTRY_VERSION,
  entries: ASSET_REGISTRY_ENTRIES
});

export const DEFAULT_PREFAB_REGISTRY = Object.freeze({
  version: PREFAB_REGISTRY_VERSION,
  entries: PREFAB_REGISTRY_ENTRIES
});

export const DEFAULT_WORLD_REGISTRIES = Object.freeze({
  typeRegistry: DEFAULT_TYPE_REGISTRY,
  assetRegistry: DEFAULT_ASSET_REGISTRY,
  prefabRegistry: DEFAULT_PREFAB_REGISTRY
});

export function createDefaultWorldRegistries() {
  return clone(DEFAULT_WORLD_REGISTRIES);
}

export function getRegistryEntries(registry) {
  if (Array.isArray(registry?.entries)) return registry.entries;
  if (Array.isArray(registry?.assets)) return registry.assets;
  return [];
}

export function createRegistryIndex(registry) {
  return new Map(getRegistryEntries(registry)
    .filter((entry) => entry && typeof entry.id === "string")
    .map((entry) => [entry.id, entry]));
}

export function selectWorldRegistries(world, registries = {}) {
  return {
    typeRegistry: registries.typeRegistry || world?.typeRegistry || DEFAULT_TYPE_REGISTRY,
    assetRegistry: registries.assetRegistry || world?.assetRegistry || DEFAULT_ASSET_REGISTRY,
    prefabRegistry: registries.prefabRegistry || world?.prefabRegistry || DEFAULT_PREFAB_REGISTRY
  };
}

function propertyStateReferences(properties = {}) {
  return [...new Set([
    properties.requiredFlag,
    properties.setFlag,
    properties.clearFlag,
    properties.clearedByFlag,
    ...(Array.isArray(properties.stateKeys) ? properties.stateKeys : [])
  ].filter((value) => typeof value === "string" && value.length > 0))].sort();
}

function assetIdFor(object, typeEntry) {
  return object?.properties?.visual?.assetId
    || object?.properties?.assetId
    || typeEntry?.defaultAssetId
    || BUILTIN_PROCEDURAL_ASSET_ID;
}

function prefabIdFor(object, typeEntry) {
  return object?.prefabId || object?.properties?.prefabId || typeEntry?.defaultPrefabId || null;
}

function localCollisionBounds(object, typeEntry) {
  const adapter = typeEntry?.boundsAdapter || { kind: "point", radius: 0 };
  const properties = object?.properties || {};
  if (adapter.kind === "rect") {
    return {
      x: 0,
      y: 0,
      w: properties[adapter.widthProperty] ?? 0,
      h: properties[adapter.heightProperty] ?? 0
    };
  }
  if (adapter.kind === "circle") {
    const radius = Math.abs(properties[adapter.radiusProperty] ?? adapter.radius ?? 0);
    return { x: -radius, y: -radius, w: radius * 2, h: radius * 2 };
  }
  if (adapter.kind === "slope") {
    const dx = properties[adapter.dxProperty] ?? 0;
    const dy = properties[adapter.dyProperty] ?? 0;
    const thickness = Math.abs(properties[adapter.thicknessProperty] ?? 0);
    return {
      x: Math.min(0, dx) - thickness / 2,
      y: Math.min(0, dy) - thickness / 2,
      w: Math.abs(dx) + thickness,
      h: Math.abs(dy) + thickness
    };
  }
  const radius = Math.abs(adapter.radius ?? 0);
  return { x: -radius, y: -radius, w: radius * 2, h: radius * 2 };
}

function resolutionSeverity(namespace, required) {
  return namespace === "formal" || required ? "error" : "warning";
}

/**
 * Resolves hierarchical transforms and all logical type/prefab/asset IDs. The
 * returned snapshot-like object is diagnostic and never mutates its input.
 */
export function resolveWorldPackage(world, registries = {}) {
  const selected = selectWorldRegistries(world, registries);
  const typeIndex = createRegistryIndex(selected.typeRegistry);
  const assetIndex = createRegistryIndex(selected.assetRegistry);
  const prefabIndex = createRegistryIndex(selected.prefabRegistry);
  const namespace = world?.manifest?.namespace || "labs";
  const warnings = [];
  const errors = [];

  const regions = (world?.regions || []).map((region) => {
    const regionTransform = composeTransforms(IDENTITY_TRANSFORM, region.transform);
    const resolvedRegion = {
      id: region.id,
      name: region.name || "",
      bounds: clone(region.bounds || {}),
      routes: clone(region.routes || []),
      landmarks: clone(region.landmarks || []),
      tags: clone(region.tags || []),
      transform: normalizeTransform(region.transform),
      resolvedTransform: regionTransform,
      aabb: transformBounds(regionTransform, region.bounds),
      chunks: (region.chunks || []).map((chunk) => {
        const chunkTransform = composeTransforms(regionTransform, chunk.transform);
        const resolvedChunk = {
          id: chunk.id,
          name: chunk.name || "",
          bounds: clone(chunk.bounds || {}),
          transform: normalizeTransform(chunk.transform),
          resolvedTransform: chunkTransform,
          aabb: transformBounds(chunkTransform, chunk.bounds),
          streaming: clone(chunk.streaming || {}),
          connections: clone(chunk.connections || []),
          scene: clone(chunk.scene || {}),
          statePolicy: clone(chunk.statePolicy || {}),
          gameplay: clone(chunk.gameplay || {}),
          tags: clone(chunk.tags || []),
          objects: (chunk.objects || []).map((object) => {
            const typeEntry = typeIndex.get(object.type) || null;
            if (!typeEntry) {
              errors.push({
                severity: "error",
                code: "unresolved-type",
                path: `objects.${object.id}.type`,
                message: `Object ${object.id} references unknown type ${object.type}`
              });
            }
            const resolvedTransform = composeTransforms(chunkTransform, object.transform);
            const prefabId = prefabIdFor(object, typeEntry);
            const prefab = prefabId ? prefabIndex.get(prefabId) || null : null;
            const assetId = assetIdFor(object, typeEntry);
            const asset = assetIndex.get(assetId) || null;

            if (prefabId && !prefab) {
              errors.push({
                severity: resolutionSeverity(namespace, typeEntry?.required !== false),
                code: "unresolved-prefab",
                path: `objects.${object.id}.prefabId`,
                message: `Object ${object.id} references missing prefab ${prefabId}`
              });
            }
            if (!asset) {
              errors.push({
                severity: resolutionSeverity(namespace, true),
                code: "unresolved-asset",
                path: `objects.${object.id}.assetId`,
                message: `Object ${object.id} references missing asset ${assetId}`
              });
            } else if (asset.kind === "procedural") {
              // Procedural rendering is a first-class registered implementation,
              // not evidence that a requested image failed to resolve.
            } else if (!asset.platforms?.godot?.path && asset.fallbackAllowed && asset.fallbackAssetId) {
              warnings.push({
                severity: "warning",
                code: "asset-fallback",
                path: `objects.${object.id}.assetId`,
                message: `Object ${object.id} uses the registered fallback for ${assetId}`
              });
            } else if (!asset.platforms?.godot?.path) {
              errors.push({
                severity: "error",
                code: "missing-godot-asset",
                path: `objects.${object.id}.assetId`,
                message: `Asset ${assetId} has no Godot resource and disallows fallback`
              });
            }

            return {
              id: object.id,
              type: object.type,
              transform: normalizeTransform(object.transform),
              resolvedTransform,
              collisionBounds: transformBounds(resolvedTransform, localCollisionBounds(object, typeEntry)),
              properties: clone(object.properties || {}),
              links: clone(object.links || []),
              tags: clone(object.tags || []),
              stateReferences: propertyStateReferences(object.properties),
              prefabResolution: {
                id: prefabId,
                status: prefab ? "resolved" : "missing",
                godotScene: prefab?.godotScene || null
              },
              assetResolution: {
                id: assetId,
                status: asset
                  ? asset.kind === "procedural"
                    ? "procedural"
                    : asset.platforms?.godot?.path ? "resolved" : "fallback"
                  : "missing",
                webPath: asset?.platforms?.web?.path || null,
                godotPath: asset?.platforms?.godot?.path || null,
                fallbackAssetId: asset?.fallbackAssetId || null
              }
            };
          })
        };
        return normalizeCanonicalValue(resolvedChunk);
      })
    };
    return normalizeCanonicalValue(resolvedRegion);
  });

  return normalizeCanonicalValue({
    snapshotVersion: 1,
    schemaVersion: world?.schemaVersion,
    contentVersion: world?.manifest?.contentVersion || "",
    sourceContentHash: world?.manifest?.contentHash || "",
    gameplayTuningVersion: world?.manifest?.gameplayTuningVersion || "",
    assetRegistryVersion: selected.assetRegistry?.version || "",
    prefabRegistryVersion: selected.prefabRegistry?.version || "",
    typeRegistryVersion: selected.typeRegistry?.version || "",
    regions,
    warnings,
    errors
  });
}
