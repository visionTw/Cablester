#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import {
  migrateToWorldPackage,
  serializeWorldPackage
} from "../src/world-schema.js";

const [inputPath, outputPath, namespace = "labs"] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/world-migrate.mjs <v1-or-v2.json> <v3.world.json> [formal|labs|reference]");
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await readFile(inputPath, "utf8"));
    const world = migrateToWorldPackage(input, { namespace });
    await writeFile(outputPath, await serializeWorldPackage(world), "utf8");
    console.log(`${inputPath} -> ${outputPath} (${world.manifest.worldId})`);
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}
