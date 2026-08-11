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
    "spawn", "goal", "checkpoint", "roomEntrance", "roomExit", "platform", "slope", "hazard", "windZone", "liquidZone", "darknessZone",
    "rotationTrigger", "anchor", "bashTarget", "energyOrb", "dashRefill", "movingObject", "launcher", "fragilePlatform",
    "gate", "stateTrigger", "abilityPickup", "sign", "backgroundSeed"
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

test("dash refills and moving objects round-trip through workshop documents", () => {
  const document = createBlankLevelDocument("机关往返");
  document.dashCapacity = 2;
  document.objects.push(createLevelObject("dashRefill", 260, 540, document.objects, {
    properties: { charges: 2, restoreMode: "fill", oneUse: false, respawnSeconds: 1.5 }
  }));
  document.objects.push(createLevelObject("movingObject", 420, 520, document.objects, {
    properties: {
      objectKind: "platform",
      w: 180,
      h: 28,
      pathPoints: "0,0;320,-120;540,0",
      speed: 260,
      acceleration: 1200,
      dwellSeconds: 0.15,
      easing: "smoothstep",
      loopMode: "pingpong",
      trigger: "touch",
      offscreenPolicy: "simulate",
      resetPolicy: "death",
      grapple: true
    }
  }));
  assert.deepEqual(validateLevelDocument(document), []);
  const level = compileLevelDocument(document);
  assert.deepEqual(validateLevel(level), []);
  assert.equal(level.dashCapacity, 2);
  assert.equal(level.dashRefills[0].charges, 2);
  assert.equal(level.movingObjects[0].path.length, 3);
  const roundTrip = compileLevelDocument(levelToDocument(level));
  assert.deepEqual(roundTrip.dashRefills, level.dashRefills);
  assert.deepEqual(roundTrip.movingObjects, level.movingObjects);
});

test("launchers, fragile platforms, gates and state triggers round-trip through workshop documents", () => {
  const document = createBlankLevelDocument("状态机关往返");
  document.objects.push(createLevelObject("launcher", 220, 610, document.objects, {
    properties: { launchX: 180, launchY: -980, cooldownSeconds: 0.4, preserveMomentum: true }
  }));
  document.objects.push(createLevelObject("fragilePlatform", 430, 520, document.objects, {
    properties: { w: 220, breakDelaySeconds: 0.25, respawnSeconds: 1.8, oneUse: false }
  }));
  document.objects.push(createLevelObject("stateTrigger", 700, 500, document.objects, {
    properties: { setFlag: "test-open", clearFlag: "", oneUse: true, resetOnDeath: false }
  }));
  document.objects.push(createLevelObject("gate", 920, 360, document.objects, {
    properties: { w: 70, h: 280, requiredFlag: "test-open", latchOpen: true }
  }));
  document.objects.push(createLevelObject("liquidZone", 180, 380, document.objects, {
    properties: { w: 420, h: 200, liquidType: "water", gravityScale: 0.2, drag: 2.8, currentX: 90, currentY: -20, swimAcceleration: 720, contactDamage: 0 }
  }));
  document.objects.push(createLevelObject("darknessZone", 640, 240, document.objects, {
    properties: { w: 480, h: 380, opacity: 0.82, revealRadius: 190, clearedByFlag: "test-open" }
  }));
  assert.deepEqual(validateLevelDocument(document), []);
  const level = compileLevelDocument(document);
  assert.deepEqual(validateLevel(level), []);
  const roundTrip = compileLevelDocument(levelToDocument(level));
  for (const collection of ["launchers", "fragilePlatforms", "gates", "stateTriggers", "liquidZones", "darknessZones"]) {
    assert.deepEqual(roundTrip[collection], level[collection], collection);
  }
});
