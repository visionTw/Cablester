#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  GODOT_BUILD_ID,
  computeContentHash,
  validateWorldPackage
} from "../src/world-schema.js";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: node scripts/world-validate.mjs <world.json> [...]");
  process.exitCode = 2;
} else {
  let failures = 0;
  for (const path of paths) {
    try {
      const world = JSON.parse(await readFile(path, "utf8"));
      const computedHash = await computeContentHash(world);
      const issues = validateWorldPackage(world, {
        contentHash: computedHash,
        godotBuildId: GODOT_BUILD_ID
      });
      const errors = issues.filter((entry) => entry.severity === "error");
      for (const entry of issues) {
        const stream = entry.severity === "error" ? console.error : console.warn;
        stream(`${path}:${entry.path}: ${entry.severity} ${entry.code}: ${entry.message}`);
      }
      if (errors.length) failures += 1;
      else console.log(`${path}: valid (${computedHash}, ${issues.length} warning(s))`);
    } catch (error) {
      failures += 1;
      console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures) process.exitCode = 1;
}
