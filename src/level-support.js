import { ABILITIES } from "./config.js";

export const LEVEL_SUPPORT_ABILITY_IDS = Object.freeze([
  "rope",
  "hardBar",
  "bash",
  "doubleJump",
  "glide",
  "dash",
  "wallGrab"
]);

export const LEVEL_SUPPORT_DEFINITIONS = Object.freeze({
  rope: Object.freeze({ label: "软绳", input: "鼠标左键", description: "发射、摆荡与收绳" }),
  hardBar: Object.freeze({ label: "硬杆", input: "F", description: "连接表面并撑杆跳" }),
  bash: Object.freeze({ label: "猛击", input: "Q", description: "借猛击支点定向弹射" }),
  doubleJump: Object.freeze({ label: "二段跳", input: "Space", description: "空中追加一次跳跃" }),
  glide: Object.freeze({ label: "滑翔", input: "Space", description: "减缓下落并利用风场" }),
  dash: Object.freeze({ label: "冲刺", input: "Ctrl", description: "当前方向或八方向冲刺" }),
  wallGrab: Object.freeze({ label: "墙抓", input: "Shift", description: "贴墙抓取与墙跳" })
});

export const DEFAULT_LEVEL_STARTING_ABILITIES = Object.freeze(
  LEVEL_SUPPORT_ABILITY_IDS.filter((abilityId) => ABILITIES[abilityId]?.defaultUnlocked)
);

function clone(value) {
  return structuredClone(value);
}

function addRequirement(requirements, abilityId, object, label, advisory = false) {
  if (!LEVEL_SUPPORT_ABILITY_IDS.includes(abilityId)) return;
  const current = requirements.get(abilityId) || [];
  current.push({
    objectId: String(object?.id || object?.type || "unknown"),
    objectType: String(object?.type || "unknown"),
    label,
    advisory
  });
  requirements.set(abilityId, current);
}

/**
 * Produces one stable, duplicate-free ability order without rearranging an
 * existing level. Passing an explicit empty array keeps the level ability-free;
 * only a missing value receives defaults.
 */
export function normalizeStartingAbilities(value, { fallback = DEFAULT_LEVEL_STARTING_ABILITIES } = {}) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source)].filter((abilityId) => LEVEL_SUPPORT_ABILITY_IDS.includes(abilityId));
}

export function validateStartingAbilities(value, { path = "startingAbilities", allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return [];
  if (!Array.isArray(value)) return [`${path} must be an array`];
  const errors = [];
  const seen = new Set();
  for (const [index, abilityId] of value.entries()) {
    if (typeof abilityId !== "string" || !LEVEL_SUPPORT_ABILITY_IDS.includes(abilityId)) {
      errors.push(`${path}[${index}] is an unknown ability`);
      continue;
    }
    if (seen.has(abilityId)) errors.push(`${path} contains duplicate ability ${abilityId}`);
    seen.add(abilityId);
  }
  return errors;
}

export function setStartingAbility(document, abilityId, enabled) {
  if (!LEVEL_SUPPORT_ABILITY_IDS.includes(abilityId)) throw new Error(`Unknown ability: ${abilityId}`);
  const next = clone(document);
  const selected = normalizeStartingAbilities(next.startingAbilities);
  next.startingAbilities = enabled
    ? selected.includes(abilityId) ? selected : [...selected, abilityId]
    : selected.filter((id) => id !== abilityId);
  return next;
}

export function replaceStartingAbilities(document, abilityIds) {
  const errors = validateStartingAbilities(abilityIds);
  if (errors.length) throw new Error(errors.join("\n"));
  const next = clone(document);
  next.startingAbilities = normalizeStartingAbilities(abilityIds, { fallback: [] });
  return next;
}

export function inferAbilityRequirements(document) {
  const requirements = new Map(LEVEL_SUPPORT_ABILITY_IDS.map((abilityId) => [abilityId, []]));
  for (const object of Array.isArray(document?.objects) ? document.objects : []) {
    if (!object || typeof object !== "object") continue;
    const properties = object.properties || {};
    if (object.type === "anchor") {
      addRequirement(requirements, "rope", object, "绳索锚点");
      if (properties.anchorType === "both") addRequirement(requirements, "hardBar", object, "软绳与硬杆锚点");
    }
    if (object.type === "bashTarget") addRequirement(requirements, "bash", object, "猛击支点");
    if (object.type === "dashRefill") addRequirement(requirements, "dash", object, "冲刺补充");
    if (object.type === "windZone") addRequirement(requirements, "glide", object, "风场", true);
    if (object.type === "movingObject" && properties.objectKind === "anchor") {
      addRequirement(requirements, "rope", object, "移动绳索锚点");
      if (properties.anchorType === "both") addRequirement(requirements, "hardBar", object, "移动软绳与硬杆锚点");
    }
    if (object.type === "movingObject" && properties.objectKind === "bashTarget") {
      addRequirement(requirements, "bash", object, "移动猛击支点");
    }
    if (["gate", "roomExit"].includes(object.type) && properties.requiredAbility) {
      addRequirement(requirements, properties.requiredAbility, object, object.type === "gate" ? "能力门" : "能力出口");
    }
  }
  return requirements;
}

/**
 * Reports editor guidance only. It intentionally does not reject a document:
 * an author can place a future-mechanic pickup or decorative mechanism while
 * iterating, but the workshop makes the resulting playability risk explicit.
 */
export function analyzeLevelAbilitySupport(document) {
  const starting = new Set(normalizeStartingAbilities(document?.startingAbilities));
  const pickupsByAbility = new Map(LEVEL_SUPPORT_ABILITY_IDS.map((abilityId) => [abilityId, []]));
  for (const object of Array.isArray(document?.objects) ? document.objects : []) {
    if (object?.type !== "abilityPickup") continue;
    const abilityId = object.properties?.abilityId;
    if (pickupsByAbility.has(abilityId)) pickupsByAbility.get(abilityId).push(object.id);
  }
  const requirements = inferAbilityRequirements(document);
  const coverage = LEVEL_SUPPORT_ABILITY_IDS.map((abilityId) => {
    const requirementSources = requirements.get(abilityId) || [];
    const pickupIds = pickupsByAbility.get(abilityId) || [];
    const enabledAtStart = starting.has(abilityId);
    return {
      abilityId,
      ...LEVEL_SUPPORT_DEFINITIONS[abilityId],
      enabledAtStart,
      pickupIds,
      requirementSources,
      available: enabledAtStart || pickupIds.length > 0,
      required: requirementSources.length > 0
    };
  });
  const warnings = [];
  for (const item of coverage) {
    if (!item.required || item.available) continue;
    const strictSources = item.requirementSources.filter((source) => !source.advisory);
    const sources = strictSources.length ? strictSources : item.requirementSources;
    const sourceLabels = [...new Set(sources.map((source) => source.label))].join("、");
    warnings.push({
      code: `${item.abilityId}-support-missing`,
      abilityId: item.abilityId,
      tone: strictSources.length ? "warning" : "advisory",
      objectIds: sources.map((source) => source.objectId),
      message: `${sourceLabels}需要${item.label}，但开局能力和关内拾取均未提供。`
    });
  }
  return {
    startingAbilities: normalizeStartingAbilities(document?.startingAbilities),
    coverage,
    warnings,
    uncoveredAbilityIds: [...new Set(warnings.map((warning) => warning.abilityId))]
  };
}

/** Runtime resolution keeps an explicit [] meaningful and falls back only if
 * neither an override nor the level defines a capability list. */
export function resolveLevelStartingAbilities(level, override) {
  if (Array.isArray(override)) return normalizeStartingAbilities(override, { fallback: [] });
  if (Array.isArray(level?.startingAbilities)) {
    return normalizeStartingAbilities(level.startingAbilities, { fallback: [] });
  }
  return [...DEFAULT_LEVEL_STARTING_ABILITIES];
}
