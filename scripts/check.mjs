import { LEVELS } from "../src/levels.js";
import { validateLevel } from "../src/level-validator.js";
import { compileLevelDocument, validateLevelDocument } from "../src/level-objects.js";
import { computeContentHash, validateWorldPackage } from "../src/world-schema.js";
import { validateWorldInStages } from "../src/world-validation-worker.js";
import { readFile } from "node:fs/promises";

let failureCount = 0;
for (const level of LEVELS) {
  const errors = validateLevel(level);
  if (errors.length > 0) {
    failureCount += 1;
    console.error(`Level ${level.id} validation failed:`);
    for (const error of errors) console.error(`- ${error}`);
  } else {
    console.log(`✓ ${level.id}: ${level.platforms.length} platforms, ${level.slopes.length} slopes, ${level.anchors.length} anchors.`);
  }
}

let worldPassCount = 0;
for (const path of [
  "../worlds/formal/first-forest.world.json",
  "../worlds/labs/cablester-3c-labs.world.json"
]) {
  const world = JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
  const issues = [
    ...validateWorldPackage(world),
    ...(await validateWorldInStages(world)).issues
  ];
  const computedHash = await computeContentHash(world);
  if (world.manifest.contentHash !== computedHash) {
    issues.push({ severity: "error", code: "content-hash-mismatch", message: `${world.manifest.contentHash} != ${computedHash}` });
  }
  if (issues.length > 0) {
    failureCount += 1;
    console.error(`World ${world.manifest.worldId} validation failed:`);
    for (const item of issues) console.error(`- ${item.code || item.severity}: ${item.message || item}`);
  } else {
    worldPassCount += 1;
    console.log(`✓ ${world.manifest.worldId}: ${world.regions.flatMap((region) => region.chunks).length} canonical chunks, sealed ${world.manifest.contentHash}.`);
  }
}

const referenceIndex = JSON.parse(await readFile(new URL("../levels/reference/playable-index.json", import.meta.url), "utf8"));
let referencePassCount = 0;
for (const [roomId, metadata] of Object.entries(referenceIndex.rooms)) {
  const documentData = JSON.parse(await readFile(new URL(`../${metadata.dataFile}`, import.meta.url), "utf8"));
  const errors = [
    ...validateLevelDocument(documentData),
    ...validateLevel(compileLevelDocument(documentData))
  ];
  if (documentData.metadata.id !== roomId) errors.push(`Document id ${documentData.metadata.id} does not match ${roomId}`);
  if (errors.length > 0) {
    failureCount += 1;
    console.error(`Reference room ${roomId} validation failed:`);
    for (const error of errors) console.error(`- ${error}`);
  } else {
    referencePassCount += 1;
    console.log(`✓ ${roomId}: authored reference room is loadable.`);
  }
}

if (failureCount > 0) {
  process.exitCode = 1;
} else {
  console.log(`${LEVELS.length} built-in levels, ${worldPassCount} canonical worlds, and ${referencePassCount} authored reference rooms passed structural validation.`);
}
