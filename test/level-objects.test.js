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
  migrateLevelDocument,
  validateLevelDocument
} from "../src/level-objects.js";
import { createVisualConfig, getTypeDefaultAssetId } from "../src/asset-library.js";
import { addSceneLayer } from "../src/scene-layers.js";

test("object library exposes every editable runtime collection", () => {
  for (const type of [
    "spawn", "goal", "checkpoint", "roomEntrance", "roomExit", "boundaryWall", "platform", "slope", "hazard", "windZone", "liquidZone", "darknessZone",
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

test("dynamic sign cue properties round-trip without creating collision geometry", () => {
  const document = createBlankLevelDocument("动态提示点");
  document.objects.push(createLevelObject("sign", 240, 520, document.objects, {
    id: "sign-dynamic",
    properties: {
      text: "靠近查看",
      nearbyRadius: 180,
      activationRadius: 52,
      completionFlag: "intro-seen",
      oneShot: true,
      disabled: false
    }
  }));
  const compiled = compileLevelDocument(document);
  assert.deepEqual(compiled.signs[0], {
    id: "sign-dynamic",
    x: 240,
    y: 520,
    text: "靠近查看",
    nearbyRadius: 180,
    activationRadius: 52,
    completionFlag: "intro-seen",
    oneShot: true,
    disabled: false
  });
  const roundTrip = levelToDocument(compiled).objects.find((object) => object.id === "sign-dynamic");
  assert.equal(roundTrip.properties.nearbyRadius, 180);
  assert.equal(LEVEL_OBJECT_LIBRARY.sign.category, "guidance");
  assert.equal(Object.hasOwn(roundTrip.properties, "w"), false);
  assert.equal(Object.hasOwn(roundTrip.properties, "h"), false);
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

test("air walls preserve dimensions, blocking side and grapple policy through document round-trip", () => {
  const document = createBlankLevelDocument("边界阻挡往返");
  const wall = createLevelObject("boundaryWall", 1200, -400, document.objects, {
    id: "edge-right",
    properties: { w: 40, h: 1700, blockingSide: "left", grapple: false }
  });
  document.objects.push(wall);

  assert.deepEqual(validateLevelDocument(document), []);
  const level = compileLevelDocument(document);
  assert.deepEqual(level.boundaryWalls, [{
    id: "edge-right",
    x: 1200,
    y: -400,
    w: 40,
    h: 1700,
    blockingSide: "left",
    grapple: false
  }]);
  assert.deepEqual(validateLevel(level), []);
  assert.deepEqual(compileLevelDocument(levelToDocument(level)).boundaryWalls, level.boundaryWalls);

  wall.properties.blockingSide = "diagonal";
  wall.properties.w = 0;
  const errors = validateLevelDocument(document);
  assert.ok(errors.some((error) => error.includes("blockingSide")));
  assert.ok(errors.some((error) => error.includes("edge-right.w")));
});

test("schema v1 documents migrate without mutation and receive visual and scene defaults", () => {
  const versionTwo = createBlankLevelDocument("旧关卡迁移");
  const versionOne = structuredClone(versionTwo);
  versionOne.schemaVersion = 1;
  delete versionOne.scene;
  for (const object of versionOne.objects) delete object.properties.visual;
  const original = structuredClone(versionOne);

  const migrated = migrateLevelDocument(versionOne);
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(versionOne, original);
  assert.ok(migrated.objects.every((object) => (
    object.properties.visual.assetId === getTypeDefaultAssetId(object.type)
  )));
  assert.deepEqual(migrated.scene.layers.map((layer) => layer.role), ["background", "midground", "player", "foreground"]);
  assert.deepEqual(validateLevelDocument(versionOne), []);
  assert.deepEqual(validateLevelDocument(migrated), []);
});

test("older schema v2 visual objects receive newly added scaling defaults without mutation", () => {
  const original = createBlankLevelDocument("旧 v2 缩放字段");
  const legacy = structuredClone(original);
  for (const object of legacy.objects) {
    delete object.properties.visual.scaleMode;
    delete object.properties.visual.tileScale;
  }
  const migrated = migrateLevelDocument(legacy);
  assert.notEqual(migrated, legacy);
  assert.equal(legacy.objects[0].properties.visual.scaleMode, undefined);
  assert.ok(migrated.objects.every((object) => object.properties.visual.scaleMode === "asset"));
  assert.ok(migrated.objects.every((object) => object.properties.visual.tileScale === 1));
  assert.deepEqual(validateLevelDocument(legacy), []);
  assert.equal(compileLevelDocument(legacy).visuals[legacy.objects[0].id].scaleMode, "asset");
});

test("visual mappings and scene layers survive compile and document round-trip without changing gameplay arrays", () => {
  const document = createBlankLevelDocument("视觉往返");
  const platform = document.objects.find((object) => object.type === "platform");
  platform.properties.visual = createVisualConfig({
    assetId: "asset:missing-but-safe",
    scaleX: 1.4,
    scaleY: 0.8,
    anchorX: 0.25,
    anchorY: 0.75,
    offsetX: 12,
    offsetY: -8,
    flipX: true,
    flipY: false,
    drawLayer: 7,
    opacity: 0.7,
    tint: "#88ccffff"
  });
  document.scene = addSceneLayer(document.scene, {
    id: "scene-mist",
    role: "custom",
    name: "雾层",
    depth: -45,
    parallax: 0.4,
    originX: 320,
    originY: 640,
    opacity: 0.6,
    fog: 0.8,
    seed: "roundtrip-mist"
  });

  const level = compileLevelDocument(document);
  assert.deepEqual(level.visuals[platform.id], platform.properties.visual);
  assert.deepEqual(level.scene, document.scene);
  assert.equal(Object.hasOwn(level.platforms[0], "visual"), false);
  assert.deepEqual(Object.keys(level.platforms[0]).sort(), ["h", "id", "w", "x", "y"]);

  const roundTrip = levelToDocument(level);
  assert.deepEqual(roundTrip.objects.find((object) => object.id === platform.id).properties.visual, platform.properties.visual);
  assert.deepEqual(roundTrip.scene, document.scene);
  assert.deepEqual(compileLevelDocument(roundTrip).platforms, level.platforms);
});

test("schema v2 rejects malformed visual and scene configuration", () => {
  const missingVisual = createBlankLevelDocument("非法视觉");
  delete missingVisual.objects[0].properties.visual;
  assert.ok(validateLevelDocument(missingVisual).some((error) => error.includes("visual")));
  assert.throws(() => compileLevelDocument(missingVisual), /visual/);

  const invalidVisual = createBlankLevelDocument("非法缩放");
  invalidVisual.objects[0].properties.visual.scaleX = 0;
  invalidVisual.objects[0].properties.visual.tint = "blue";
  const visualErrors = validateLevelDocument(invalidVisual);
  assert.ok(visualErrors.some((error) => error.includes("scaleX")));
  assert.ok(visualErrors.some((error) => error.includes("tint")));

  const invalidScene = createBlankLevelDocument("非法场景");
  invalidScene.scene.layers = invalidScene.scene.layers.filter((layer) => layer.role !== "player");
  assert.ok(validateLevelDocument(invalidScene).some((error) => error.includes("player layer")));

  const malformedObjects = createBlankLevelDocument("非法物件数组");
  malformedObjects.objects.push(null);
  assert.ok(validateLevelDocument(malformedObjects).some((error) => error.includes("objects[")));
  malformedObjects.objects = {};
  assert.ok(validateLevelDocument(malformedObjects).some((error) => error.includes("objects array")));
});
