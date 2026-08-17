#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSemanticProjection } from "../src/world-diff.js";
import { resolveWorldPackage } from "../src/world-registries.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const worldPath = resolve(root, "worlds/fixtures/v3-golden.world.json");
const snapshotPath = resolve(root, "worlds/fixtures/godot-resolved-v1.golden.json");
const projectionPath = resolve(root, "worlds/fixtures/v3-semantic-projection.golden.json");

const world = JSON.parse(await readFile(worldPath, "utf8"));
const previousSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const snapshot = resolveWorldPackage(world);

// The registry resolver produces the same engine-independent core that the
// Godot importer consumes. Preserve stable importer evidence from the checked-in
// fixture, then add every semantic-projection-v2 field directly from canonical.
for (const key of ["generatedAt", "godotBuildId", "importerVersion"]) {
  if (previousSnapshot[key] !== undefined) snapshot[key] = previousSnapshot[key];
}
snapshot.regions = snapshot.regions.map((resolvedRegion) => {
  const region = world.regions.find((candidate) => candidate.id === resolvedRegion.id);
  return {
    ...resolvedRegion,
    name: region?.name || "",
    bounds: structuredClone(region?.bounds || {}),
    routes: structuredClone(region?.routes || []),
    landmarks: structuredClone(region?.landmarks || []),
    tags: structuredClone(region?.tags || []),
    chunks: resolvedRegion.chunks.map((resolvedChunk) => {
      const chunk = region?.chunks?.find((candidate) => candidate.id === resolvedChunk.id);
      return {
        ...resolvedChunk,
        name: chunk?.name || "",
        bounds: structuredClone(chunk?.bounds || {}),
        streaming: structuredClone(chunk?.streaming || {}),
        scene: structuredClone(chunk?.scene || {}),
        statePolicy: structuredClone(chunk?.statePolicy || {}),
        gameplay: structuredClone(chunk?.gameplay || {}),
        tags: structuredClone(chunk?.tags || [])
      };
    })
  };
});

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
await writeFile(snapshotPath, serialize(snapshot), "utf8");
await writeFile(projectionPath, serialize(createSemanticProjection(world)), "utf8");
console.log("Updated semantic projection v2 golden fixtures.");
