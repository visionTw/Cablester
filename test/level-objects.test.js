import test from "node:test";
import assert from "node:assert/strict";
import { PROTOTYPE_LEVEL } from "../src/level.js";
import { validateLevel } from "../src/level-validator.js";
import {
  LEVEL_OBJECT_LIBRARY,
  compileLevelDocument,
  createBlankLevelDocument,
  createLevelObject,
  generateLevelDocument,
  levelToDocument,
  validateLevelDocument
} from "../src/level-objects.js";

test("object library exposes every editable runtime collection", () => {
  for (const type of [
    "spawn", "goal", "checkpoint", "platform", "slope", "hazard", "windZone",
    "rotationTrigger", "anchor", "bashTarget", "energyOrb", "abilityPickup", "sign", "backgroundSeed"
  ]) {
    assert.ok(LEVEL_OBJECT_LIBRARY[type], `missing object type ${type}`);
  }
});

test("blank object document compiles into a playable level", () => {
  const document = createBlankLevelDocument("测试工坊");
  assert.deepEqual(validateLevelDocument(document), []);
  const level = compileLevelDocument(document);
  assert.deepEqual(validateLevel(level), []);
  assert.equal(level.name, "测试工坊");
  assert.equal(level.platforms.length, 1);
  assert.equal(level.checkpoints.length, 1);
});

test("existing level round-trips through type, position and properties objects", () => {
  const document = levelToDocument(PROTOTYPE_LEVEL);
  const compiled = compileLevelDocument(document);
  assert.deepEqual(validateLevel(compiled), []);
  assert.deepEqual(compiled.spawn, PROTOTYPE_LEVEL.spawn);
  assert.deepEqual(compiled.goal, PROTOTYPE_LEVEL.goal);
  for (const collection of [
    "platforms", "slopes", "hazards", "anchors", "energyOrbs", "abilityPickups",
    "bashTargets", "windZones", "checkpoints", "rotationTriggers", "signs", "backgroundSeeds"
  ]) {
    assert.deepEqual(compiled[collection], PROTOTYPE_LEVEL[collection], collection);
  }
});

test("generator is deterministic and always produces a valid playable level", () => {
  const first = generateLevelDocument({ seed: "same-seed", length: 9, difficulty: 3 });
  const second = generateLevelDocument({ seed: "same-seed", length: 9, difficulty: 3 });
  assert.deepEqual(first, second);
  assert.deepEqual(validateLevelDocument(first), []);
  assert.deepEqual(validateLevel(compileLevelDocument(first)), []);
  assert.ok(first.objects.filter((object) => object.type === "platform").length >= 10);
  assert.ok(first.objects.some((object) => object.type === "windZone"));
});

test("document validation rejects duplicate ids, unknown types and missing unique objects", () => {
  const document = createBlankLevelDocument();
  document.objects.push(createLevelObject("platform", 0, 0, document.objects, { id: document.objects[0].id }));
  document.objects.push({ id: "unknown-1", type: "teleporter", position: { x: 0, y: 0 }, properties: {} });
  document.objects = document.objects.filter((object) => object.type !== "goal");
  const errors = validateLevelDocument(document);
  assert.ok(errors.some((error) => error.includes("Duplicate object id")));
  assert.ok(errors.some((error) => error.includes("Unknown object type")));
  assert.ok(errors.some((error) => error.includes("exactly one goal")));
});
