#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  godotDerivedAllowlist,
  semanticDiff
} from "../src/world-schema.js";

const [canonicalPath, manifestPath] = process.argv.slice(2);
if (!canonicalPath || !manifestPath) {
  console.error("Usage: node scripts/world-semantic-diff.mjs <canonical.world.json> <normalized-manifest-or-snapshot.json>");
  process.exitCode = 2;
} else {
  try {
    const canonical = JSON.parse(await readFile(canonicalPath, "utf8"));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const differences = semanticDiff(canonical, manifest, godotDerivedAllowlist);
    if (differences.length) {
      console.error(JSON.stringify(differences, null, 2));
      process.exitCode = 1;
    } else {
      console.log(`${canonicalPath} and ${manifestPath}: semantic diff = 0`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}
