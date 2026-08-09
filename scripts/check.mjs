import { LEVELS } from "../src/levels.js";
import { validateLevel } from "../src/level-validator.js";

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

if (failureCount > 0) {
  process.exitCode = 1;
} else {
  console.log(`${LEVELS.length} levels passed structural validation.`);
}
