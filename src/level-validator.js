import { ACCEPTANCE_LEVELS, KNOWN_ABILITY_IDS } from "./config.js";
import { pointInRect } from "./math.js";

export function validateLevel(level) {
  const errors = [];
  const ids = new Set();
  const collections = [
    "platforms",
    "slopes",
    "hazards",
    "anchors",
    "energyOrbs",
    "abilityPickups",
    "bashTargets",
    "windZones",
    "checkpoints",
    "rotationTriggers",
    "signs"
  ];

  if (!level.id) errors.push("Level must have an id");
  if (level.category === "单项3C" && !ACCEPTANCE_LEVELS.includes(level.acceptanceLevel)) {
    errors.push("Focused 3C level must define an acceptance level from L0 to L4");
  }
  if (!level.bounds || level.bounds.w <= 0 || level.bounds.h <= 0) errors.push("Level bounds must be positive");
  if (!level.spawn) errors.push("Level must have a spawn point");

  for (const collectionName of collections) {
    const collection = level[collectionName] || [];
    for (const item of collection) {
      if (!item.id) {
        errors.push(`${collectionName} contains an item without an id`);
      } else if (ids.has(item.id)) {
        errors.push(`Duplicate level item id: ${item.id}`);
      } else {
        ids.add(item.id);
      }

      if ((collectionName === "platforms" || collectionName === "hazards" || collectionName === "checkpoints" || collectionName === "rotationTriggers") && (item.w <= 0 || item.h <= 0)) {
        errors.push(`${item.id || collectionName} must have positive dimensions`);
      }
      if (collectionName === "windZones" && (item.w <= 0 || item.h <= 0 || !Number.isFinite(item.forceX) || !Number.isFinite(item.forceY))) {
        errors.push(`${item.id || collectionName} must define a valid wind zone`);
      }
      if (collectionName === "slopes" && (!Number.isFinite(item.ax) || !Number.isFinite(item.ay) || !Number.isFinite(item.bx) || !Number.isFinite(item.by) || item.thickness <= 0)) {
        errors.push(`${item.id || collectionName} must define a valid segment and positive thickness`);
      }
    }
  }

  for (const pickup of level.abilityPickups || []) {
    if (!KNOWN_ABILITY_IDS.has(pickup.abilityId)) errors.push(`${pickup.id} grants unknown ability ${pickup.abilityId}`);
  }

  for (const abilityId of level.startingAbilities || []) {
    if (!KNOWN_ABILITY_IDS.has(abilityId)) errors.push(`Level starts with unknown ability ${abilityId}`);
  }

  for (const anchor of level.anchors || []) {
    if (!new Set(["rope", "both"]).has(anchor.type)) errors.push(`${anchor.id} has unsupported anchor type ${anchor.type}`);
  }

  if (level.spawn && level.bounds && !pointInRect(level.spawn.x, level.spawn.y, level.bounds)) {
    errors.push("Spawn point must be inside level bounds");
  }
  if (!level.checkpoints?.length) errors.push("Level must have at least one checkpoint");
  if (!level.goal) errors.push("Level must have a goal");

  return errors;
}
