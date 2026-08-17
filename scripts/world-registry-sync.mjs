#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import {
  DEFAULT_ASSET_REGISTRY,
  DEFAULT_PREFAB_REGISTRY,
  DEFAULT_TYPE_REGISTRY
} from "../src/world-registries.js";
import { canonicalFileString } from "../src/world-hash.js";

const target = new URL("../worlds/registries/", import.meta.url);
await mkdir(target, { recursive: true });
for (const [name, registry] of [
  ["type-registry.json", DEFAULT_TYPE_REGISTRY],
  ["asset-registry.json", DEFAULT_ASSET_REGISTRY],
  ["prefab-registry.json", DEFAULT_PREFAB_REGISTRY]
]) {
  await writeFile(new URL(name, target), canonicalFileString(registry), "utf8");
  console.log(`worlds/registries/${name}: ${registry.entries.length} entries`);
}
