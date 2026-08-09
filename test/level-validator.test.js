import test from "node:test";
import assert from "node:assert/strict";
import { PROTOTYPE_LEVEL } from "../src/level.js";
import { LEVEL_BY_ID, LEVELS } from "../src/levels.js";
import { validateLevel } from "../src/level-validator.js";

test("prototype level passes structural validation", () => {
  assert.deepEqual(validateLevel(PROTOTYPE_LEVEL), []);
});

test("all selectable levels pass structural validation", () => {
  for (const level of LEVELS) assert.deepEqual(validateLevel(level), [], level.id);
});

test("level suite contains six focused labs and four combined labs", () => {
  assert.equal(LEVELS.filter((level) => level.category === "单项3C").length, 6);
  assert.equal(LEVELS.filter((level) => level.category === "综合关卡").length, 4);
  const focusedLoadouts = new Set(LEVELS
    .filter((level) => level.category === "单项3C")
    .flatMap((level) => level.startingAbilities));
  for (const ability of ["rope", "hardBar", "bash", "doubleJump", "glide", "dash"]) {
    assert.ok(focusedLoadouts.has(ability), `missing focused lab for ${ability}`);
  }
  const focusedStatuses = Object.fromEntries(LEVELS
    .filter((level) => level.category === "单项3C")
    .map((level) => [level.id, level.acceptanceLevel]));
  assert.equal(focusedStatuses["movement-lab-01"], "L1");
  assert.equal(focusedStatuses["hard-bar-lab"], "L0");
  assert.equal(focusedStatuses["bash-lab"], "L1");
  assert.equal(focusedStatuses["double-jump-lab"], "L1");
  assert.equal(focusedStatuses["glide-lab"], "L0");
  assert.equal(focusedStatuses["dash-lab"], "L0");
});

test("hard bar uses surfaces while bash uses dedicated hex targets", () => {
  const hardBarLab = LEVEL_BY_ID.get("hard-bar-lab");
  const bashLab = LEVEL_BY_ID.get("bash-lab");
  assert.equal(hardBarLab.anchors.length, 0);
  assert.ok(hardBarLab.platforms.length > 0);
  assert.ok(bashLab.bashTargets.length > 0);
  assert.equal(bashLab.anchors.length, 0);
});

test("validator catches duplicate ids and unknown ability grants", () => {
  const broken = structuredClone(PROTOTYPE_LEVEL);
  broken.anchors[1].id = broken.anchors[0].id;
  broken.abilityPickups[0].abilityId = "unknown";
  broken.slopes[0].thickness = 0;
  broken.acceptanceLevel = "L5";
  const errors = validateLevel(broken);
  assert.ok(errors.some((error) => error.includes("Duplicate")));
  assert.ok(errors.some((error) => error.includes("unknown ability")));
  assert.ok(errors.some((error) => error.includes("valid segment")));
  assert.ok(errors.some((error) => error.includes("acceptance level")));
});
