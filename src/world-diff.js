import {
  IDENTITY_TRANSFORM,
  composeTransforms,
  normalizeCanonicalValue,
  normalizeTransform,
  stableStringify
} from "./world-hash.js";
import {
  createRegistryIndex,
  selectWorldRegistries
} from "./world-registries.js";

export const SEMANTIC_PROJECTION_VERSION = 2;

export const godotDerivedAllowlist = Object.freeze([
  "generatedAt",
  "importerVersion",
  "godotBuildId",
  "warnings",
  "errors",
  "telemetry",
  "regions[*].aabb",
  "regions[*].thumbnail",
  "regions[*].chunks[*].aabb",
  "regions[*].chunks[*].dependencies",
  "regions[*].chunks[*].telemetry",
  "regions[*].chunks[*].objects[*].collisionBounds",
  "regions[*].chunks[*].objects[*].collisionShapeId",
  "regions[*].chunks[*].objects[*].resourceUid",
  "regions[*].chunks[*].objects[*].telemetry"
]);

export const GODOT_DERIVED_ALLOWLIST = godotDerivedAllowlist;

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sortedById(values) {
  return [...values].sort((a, b) => String(a?.id || "").localeCompare(String(b?.id || ""), "en"));
}

function normalizedSet(values) {
  return [...new Set((values || []).filter((value) => typeof value === "string" && value))].sort();
}

function sortedSemanticArray(values) {
  return [...(values || [])]
    .map((value) => clone(value))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b), "en"));
}

function unknownFields(value, knownKeys) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !knownKeys.has(key))
    .map(([key, item]) => [key, clone(item)]));
}

function objectStateKeys(object) {
  return normalizedSet([
    object?.properties?.requiredFlag,
    object?.properties?.setFlag,
    object?.properties?.clearFlag,
    object?.properties?.clearedByFlag,
    ...(object?.stateReferences || []),
    ...(object?.properties?.stateKeys || [])
  ]);
}

function connectionProjection(connection) {
  return {
    id: connection.id,
    from: clone(connection.from || {}),
    to: clone(connection.to || {}),
    direction: connection.direction,
    oneWay: Boolean(connection.oneWay),
    requiredAbilities: normalizedSet(connection.requiredAbilities),
    requiredFlags: normalizedSet(connection.requiredFlags)
  };
}

function canonicalObjectProjection(object, resolvedTransform, typeIndex) {
  const typeEntry = typeIndex.get(object.type);
  return {
    id: object.id,
    type: object.type,
    resolvedTransform: normalizeTransform(resolvedTransform),
    properties: clone(object.properties || {}),
    links: sortedSemanticArray(object.links),
    tags: normalizedSet(object.tags),
    stateKeys: objectStateKeys(object),
    abilityGates: normalizedSet([
      object.properties?.requiredAbility,
      object.type === "abilityPickup" ? object.properties?.abilityId : null
    ]),
    assetId: object.properties?.visual?.assetId || object.properties?.assetId || typeEntry?.defaultAssetId || null,
    prefabId: object.prefabId || object.properties?.prefabId || typeEntry?.defaultPrefabId || null
  };
}

function canonicalProjection(world) {
  const registries = selectWorldRegistries(world);
  const typeIndex = createRegistryIndex(registries.typeRegistry);
  const regions = sortedById(world.regions || []).map((region) => {
    const regionTransform = composeTransforms(IDENTITY_TRANSFORM, region.transform);
    return {
      id: region.id,
      name: region.name || "",
      bounds: clone(region.bounds || {}),
      routes: sortedById(region.routes || []),
      landmarks: sortedById(region.landmarks || []),
      tags: normalizedSet(region.tags),
      resolvedTransform: regionTransform,
      chunks: sortedById(region.chunks || []).map((chunk) => {
        const chunkTransform = composeTransforms(regionTransform, chunk.transform);
        const connections = sortedById(chunk.connections || []).map(connectionProjection);
        const objects = sortedById(chunk.objects || []).map((object) => canonicalObjectProjection(
          object,
          composeTransforms(chunkTransform, object.transform),
          typeIndex
        ));
        return {
          id: chunk.id,
          name: chunk.name || "",
          bounds: clone(chunk.bounds || {}),
          streaming: clone(chunk.streaming || {}),
          scene: clone(chunk.scene || {}),
          statePolicy: clone(chunk.statePolicy || {}),
          gameplay: clone(chunk.gameplay || {}),
          tags: normalizedSet(chunk.tags),
          resolvedTransform: chunkTransform,
          connections,
          stateKeys: normalizedSet([
            ...(chunk.statePolicy?.stateKeys || []),
            ...connections.flatMap((connection) => connection.requiredFlags),
            ...objects.flatMap((object) => object.stateKeys)
          ]),
          objects
        };
      })
    };
  });
  const chunks = regions.flatMap((region) => region.chunks);
  const objects = chunks.flatMap((chunk) => chunk.objects);
  const connections = chunks.flatMap((chunk) => chunk.connections);
  return {
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    schemaVersion: world.schemaVersion,
    contentVersion: world.manifest?.contentVersion || "",
    contentHash: world.manifest?.contentHash || "",
    gameplayTuningVersion: world.manifest?.gameplayTuningVersion || "",
    assetRegistryVersion: world.manifest?.assetRegistryVersion || "",
    prefabRegistryVersion: world.manifest?.prefabRegistryVersion || "",
    typeRegistryVersion: world.manifest?.typeRegistryVersion || "",
    counts: {
      regions: regions.length,
      chunks: chunks.length,
      objects: objects.length,
      connections: connections.length
    },
    regions
  };
}

function snapshotObjectProjection(object) {
  return {
    ...unknownFields(object, new Set([
      "id", "type", "transform", "resolvedTransform", "properties", "links", "tags",
      "stateKeys", "stateReferences", "abilityGates", "assetId", "assetResolution",
      "prefabId", "prefabResolution", "collisionBounds", "collisionShapeId",
      "resourceUid", "telemetry"
    ])),
    id: object.id,
    type: object.type,
    resolvedTransform: normalizeTransform(object.resolvedTransform || object.transform),
    properties: clone(object.properties || {}),
    links: sortedSemanticArray(object.links),
    tags: normalizedSet(object.tags),
    stateKeys: normalizedSet(object.stateKeys || object.stateReferences || objectStateKeys(object)),
    abilityGates: normalizedSet(object.abilityGates || [
      object.properties?.requiredAbility,
      object.type === "abilityPickup" ? object.properties?.abilityId : null
    ]),
    assetId: object.assetId ?? object.assetResolution?.id ?? object.properties?.visual?.assetId ?? object.properties?.assetId ?? null,
    prefabId: object.prefabId ?? object.prefabResolution?.id ?? object.properties?.prefabId ?? null
  };
}

function snapshotProjection(snapshot) {
  const regions = sortedById(snapshot.regions || []).map((region) => ({
    ...unknownFields(region, new Set([
      "id", "name", "bounds", "routes", "landmarks", "tags", "transform", "resolvedTransform", "aabb", "chunks", "thumbnail"
    ])),
    id: region.id,
    name: region.name || "",
    bounds: clone(region.bounds || {}),
    routes: sortedById(region.routes || []),
    landmarks: sortedById(region.landmarks || []),
    tags: normalizedSet(region.tags),
    resolvedTransform: normalizeTransform(region.resolvedTransform || region.transform),
    chunks: sortedById(region.chunks || []).map((chunk) => {
      const connections = sortedById(chunk.connections || []).map(connectionProjection);
      const objects = sortedById(chunk.objects || []).map(snapshotObjectProjection);
      return {
        ...unknownFields(chunk, new Set([
          "id", "name", "bounds", "transform", "resolvedTransform", "aabb", "streaming",
          "connections", "scene", "statePolicy", "gameplay", "tags", "stateKeys", "objects", "dependencies", "telemetry"
        ])),
        id: chunk.id,
        name: chunk.name || "",
        bounds: clone(chunk.bounds || {}),
        streaming: clone(chunk.streaming || {}),
        scene: clone(chunk.scene || {}),
        statePolicy: clone(chunk.statePolicy || {}),
        gameplay: clone(chunk.gameplay || {}),
        tags: normalizedSet(chunk.tags),
        resolvedTransform: normalizeTransform(chunk.resolvedTransform || chunk.transform),
        connections,
        stateKeys: normalizedSet(chunk.stateKeys || [
          ...(chunk.statePolicy?.stateKeys || []),
          ...connections.flatMap((connection) => connection.requiredFlags),
          ...objects.flatMap((object) => object.stateKeys)
        ]),
        objects
      };
    })
  }));
  const chunks = regions.flatMap((region) => region.chunks);
  return {
    ...unknownFields(snapshot, new Set([
      "snapshotVersion", "projectionVersion", "schemaVersion", "contentVersion",
      "sourceContentHash", "contentHash", "manifest", "gameplayTuningVersion",
      "assetRegistryVersion", "prefabRegistryVersion", "typeRegistryVersion",
      "regions", "warnings", "errors", "generatedAt", "importerVersion", "godotBuildId",
      "telemetry", "semanticProjection"
    ])),
    projectionVersion: SEMANTIC_PROJECTION_VERSION,
    schemaVersion: snapshot.schemaVersion,
    contentVersion: snapshot.contentVersion || snapshot.manifest?.contentVersion || "",
    contentHash: snapshot.sourceContentHash || snapshot.contentHash || snapshot.manifest?.contentHash || "",
    gameplayTuningVersion: snapshot.gameplayTuningVersion || snapshot.manifest?.gameplayTuningVersion || "",
    assetRegistryVersion: snapshot.assetRegistryVersion || snapshot.manifest?.assetRegistryVersion || "",
    prefabRegistryVersion: snapshot.prefabRegistryVersion || snapshot.manifest?.prefabRegistryVersion || "",
    typeRegistryVersion: snapshot.typeRegistryVersion || snapshot.manifest?.typeRegistryVersion || "",
    counts: {
      regions: regions.length,
      chunks: chunks.length,
      objects: chunks.reduce((count, chunk) => count + chunk.objects.length, 0),
      connections: chunks.reduce((count, chunk) => count + chunk.connections.length, 0)
    },
    regions
  };
}

export function createSemanticProjection(worldOrSnapshot) {
  if (!isRecord(worldOrSnapshot)) throw new TypeError("Semantic projection input must be an object");
  if (worldOrSnapshot.projectionVersion === SEMANTIC_PROJECTION_VERSION) {
    return normalizeCanonicalValue(worldOrSnapshot);
  }
  if (isRecord(worldOrSnapshot.semanticProjection)
    && worldOrSnapshot.semanticProjection.projectionVersion === SEMANTIC_PROJECTION_VERSION) {
    return normalizeCanonicalValue(worldOrSnapshot.semanticProjection);
  }
  const projection = worldOrSnapshot.schemaVersion === 3 && isRecord(worldOrSnapshot.manifest)
    && Array.isArray(worldOrSnapshot.assetRegistry?.entries)
    ? canonicalProjection(worldOrSnapshot)
    : snapshotProjection(worldOrSnapshot);
  return normalizeCanonicalValue(projection);
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function allowlistPattern(pattern) {
  const normalizedPattern = pattern.replace(/\.\*(?=\.|$)/g, "[*]");
  let source = escapeRegex(normalizedPattern);
  source = source.replace(/\\\[\*\\\]/g, "\\[\\d+\\]");
  source = source.replace(/\*\*/g, ".*");
  source = source.replace(/\*/g, "[^.\\[\\]]+");
  return new RegExp(`^${source}(?:$|\\.|\\[)`);
}

function allowed(path, matchers) {
  return matchers.some((matcher) => matcher.test(path));
}

function compareValues(canonical, actual, path, matchers, diffs) {
  if (allowed(path, matchers)) return;
  if (Array.isArray(canonical) || Array.isArray(actual)) {
    if (!Array.isArray(canonical) || !Array.isArray(actual)) {
      diffs.push({ path, kind: "type", canonical: clone(canonical), actual: clone(actual) });
      return;
    }
    const length = Math.max(canonical.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${path}[${index}]`;
      if (index >= canonical.length) {
        if (!allowed(itemPath, matchers)) diffs.push({ path: itemPath, kind: "unexpected", canonical: null, actual: clone(actual[index]) });
      } else if (index >= actual.length) {
        diffs.push({ path: itemPath, kind: "missing", canonical: clone(canonical[index]), actual: null });
      } else {
        compareValues(canonical[index], actual[index], itemPath, matchers, diffs);
      }
    }
    return;
  }
  if (isRecord(canonical) || isRecord(actual)) {
    if (!isRecord(canonical) || !isRecord(actual)) {
      diffs.push({ path, kind: "type", canonical: clone(canonical), actual: clone(actual) });
      return;
    }
    const keys = [...new Set([...Object.keys(canonical), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      const itemPath = path ? `${path}.${key}` : key;
      if (!Object.hasOwn(canonical, key)) {
        if (!allowed(itemPath, matchers)) diffs.push({ path: itemPath, kind: "unexpected", canonical: null, actual: clone(actual[key]) });
      } else if (!Object.hasOwn(actual, key)) {
        diffs.push({ path: itemPath, kind: "missing", canonical: clone(canonical[key]), actual: null });
      } else {
        compareValues(canonical[key], actual[key], itemPath, matchers, diffs);
      }
    }
    return;
  }
  if (!Object.is(canonical, actual)) diffs.push({ path, kind: "value", canonical, actual });
}

export function semanticDiff(canonical, normalizedManifest, allowlist = godotDerivedAllowlist) {
  const expected = createSemanticProjection(canonical);
  const actual = createSemanticProjection(normalizedManifest);
  const matchers = (allowlist || []).map(allowlistPattern);
  const diffs = [];
  compareValues(expected, actual, "", matchers, diffs);
  return diffs;
}
