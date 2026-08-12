import test from "node:test";
import assert from "node:assert/strict";
import { TUNING } from "../src/config.js";
import { PROTOTYPE_LEVEL } from "../src/level.js";
import { LEVEL_BY_ID, LEVELS } from "../src/levels.js";
import { validateLevel } from "../src/level-validator.js";

test("prototype level passes structural validation", () => {
  assert.deepEqual(validateLevel(PROTOTYPE_LEVEL), []);
});

test("soft rope rotation chamber has a player-sized entrance", () => {
  const leftWall = PROTOTYPE_LEVEL.platforms.find((platform) => platform.id === "chamber-left");
  const floor = PROTOTYPE_LEVEL.platforms.find((platform) => platform.id === "chamber-floor");
  const chamberCheckpoint = PROTOTYPE_LEVEL.checkpoints.find((checkpoint) => checkpoint.id === "cp-chamber");
  const passageY = chamberCheckpoint.spawn.y;

  assert.ok(passageY - TUNING.playerRadius > leftWall.y + leftWall.h);
  assert.ok(passageY + TUNING.playerRadius < floor.y);
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

test("validator rejects malformed runtime air-wall configuration", () => {
  const broken = structuredClone(PROTOTYPE_LEVEL);
  broken.boundaryWalls = [{
    id: "bad-edge",
    x: broken.bounds.x,
    y: broken.bounds.y,
    w: 0,
    h: broken.bounds.h,
    blockingSide: "diagonal",
    grapple: "yes"
  }];
  const errors = validateLevel(broken);
  assert.ok(errors.some((error) => error.includes("positive dimensions")));
  assert.ok(errors.some((error) => error.includes("unsupported boundary blocking side")));
  assert.ok(errors.some((error) => error.includes("grapple must be true or false")));
});

test("validator rejects unreachable or malformed goal placement", () => {
  const embedded = structuredClone(PROTOTYPE_LEVEL);
  embedded.goal = { id: "embedded-goal", x: 0, y: 700, radius: 34 };
  assert.ok(validateLevel(embedded).some((error) => error.includes("embedded in platform")));

  const outside = structuredClone(PROTOTYPE_LEVEL);
  outside.goal = { id: "outside-goal", x: outside.bounds.x - 1, y: 0, radius: 34 };
  assert.ok(validateLevel(outside).some((error) => error.includes("inside level bounds")));

  const malformed = structuredClone(PROTOTYPE_LEVEL);
  malformed.goal = { id: "malformed-goal", x: 100, y: 100, radius: 0 };
  assert.ok(validateLevel(malformed).some((error) => error.includes("positive radius")));
});
