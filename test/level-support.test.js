import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { LEVELS } from "../src/levels.js";
import {
  compileLevelDocument,
  createBlankLevelDocument,
  createLevelObject,
  levelToDocument,
  migrateLevelDocument,
  validateLevelDocument
} from "../src/level-objects.js";
import {
  DEFAULT_LEVEL_STARTING_ABILITIES,
  LEVEL_SUPPORT_ABILITY_IDS,
  analyzeLevelAbilitySupport,
  replaceStartingAbilities,
  resolveLevelStartingAbilities,
  setStartingAbility
} from "../src/level-support.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("startingAbilities is canonical, immutable and keeps an explicit empty loadout", () => {
  const source = createBlankLevelDocument("能力配置");
  const original = structuredClone(source);
  const ropeDisabled = setStartingAbility(source, "rope", false);
  assert.deepEqual(source, original);
  assert.equal(ropeDisabled.startingAbilities.includes("rope"), false);
  assert.throws(() => setStartingAbility(source, "teleport", true), /Unknown ability/);

  const empty = replaceStartingAbilities(source, []);
  assert.deepEqual(empty.startingAbilities, []);
  const compiled = compileLevelDocument(empty);
  assert.deepEqual(compiled.startingAbilities, []);
  assert.deepEqual(levelToDocument(compiled).startingAbilities, []);
  assert.deepEqual(resolveLevelStartingAbilities(compiled), []);
  assert.deepEqual(resolveLevelStartingAbilities({}), DEFAULT_LEVEL_STARTING_ABILITIES);
  assert.deepEqual(resolveLevelStartingAbilities(compiled, []), []);
});

test("ability support analysis detects uncovered mechanism objects and accepts pickups", () => {
  let document = replaceStartingAbilities(createBlankLevelDocument("覆盖检查"), []);
  document.objects.push(createLevelObject("anchor", 200, 300, document.objects));
  document.objects.push(createLevelObject("bashTarget", 300, 300, document.objects));
  document.objects.push(createLevelObject("dashRefill", 400, 300, document.objects));
  document.objects.push(createLevelObject("windZone", 500, 300, document.objects));
  document.objects.push(createLevelObject("gate", 800, 300, document.objects, {
    properties: { requiredAbility: "hardBar" }
  }));

  let analysis = analyzeLevelAbilitySupport(document);
  assert.deepEqual(analysis.uncoveredAbilityIds, ["rope", "hardBar", "bash", "glide", "dash"]);
  assert.ok(analysis.warnings.some((warning) => warning.code === "rope-support-missing" && warning.objectIds.includes("anchor-1")));
  assert.equal(analysis.warnings.find((warning) => warning.abilityId === "glide").tone, "advisory");

  document.objects.push(createLevelObject("abilityPickup", 120, 560, document.objects, {
    properties: { abilityId: "rope" }
  }));
  analysis = analyzeLevelAbilitySupport(document);
  assert.equal(analysis.warnings.some((warning) => warning.abilityId === "rope"), false);
  assert.equal(analysis.coverage.find((item) => item.abilityId === "rope").pickupIds.length, 1);
});

test("old documents receive support defaults while malformed support is rejected", () => {
  const versionTwo = createBlankLevelDocument("旧能力文档");
  delete versionTwo.startingAbilities;
  const original = structuredClone(versionTwo);
  const migrated = migrateLevelDocument(versionTwo);
  assert.deepEqual(versionTwo, original);
  assert.deepEqual(migrated.startingAbilities, DEFAULT_LEVEL_STARTING_ABILITIES);

  const versionOne = structuredClone(versionTwo);
  versionOne.schemaVersion = 1;
  for (const object of versionOne.objects) delete object.properties.visual;
  assert.deepEqual(migrateLevelDocument(versionOne).startingAbilities, DEFAULT_LEVEL_STARTING_ABILITIES);

  const malformed = createBlankLevelDocument("非法能力");
  malformed.startingAbilities = ["rope", "rope", "teleport"];
  const errors = validateLevelDocument(malformed);
  assert.ok(errors.some((error) => error.includes("duplicate ability rope")));
  assert.ok(errors.some((error) => error.includes("unknown ability")));
  malformed.startingAbilities = "rope";
  assert.ok(validateLevelDocument(malformed).some((error) => error.includes("must be an array")));
});

test("all ten formal levels cover every detectable 3C mechanism", () => {
  assert.equal(LEVELS.length, 10);
  for (const level of LEVELS) {
    const document = levelToDocument(level);
    const analysis = analyzeLevelAbilitySupport(document);
    assert.deepEqual(analysis.warnings, [], level.id);
  }
});

test("anchors marked for rope and hard bar require both capabilities", () => {
  let document = replaceStartingAbilities(createBlankLevelDocument("双模式锚点"), ["rope"]);
  document.objects.push(createLevelObject("anchor", 440, 220, document.objects, {
    properties: { anchorType: "both" }
  }));
  const analysis = analyzeLevelAbilitySupport(document);
  assert.ok(analysis.warnings.some((warning) => warning.abilityId === "hardBar"));
  document = setStartingAbility(document, "hardBar", true);
  assert.equal(analyzeLevelAbilitySupport(document).warnings.some((warning) => warning.abilityId === "hardBar"), false);
});

test("workshop exposes the seven ability support controls as a visible mode", async () => {
  const [html, editorSource] = await Promise.all([
    readFile(resolve(root, "index.html"), "utf8"),
    readFile(resolve(root, "src/level-editor.js"), "utf8")
  ]);
  assert.match(html, /id="editor-mode-support"[^>]*>关卡支持<\/button>/);
  assert.match(html, /id="support-panel"/);
  assert.match(html, /id="support-auto-enable"/);
  assert.match(editorSource, /analyzeLevelAbilitySupport\(activeDocument\)/);
  assert.deepEqual(LEVEL_SUPPORT_ABILITY_IDS, [
    "rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"
  ]);
});
