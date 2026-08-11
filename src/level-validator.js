import { ACCEPTANCE_LEVELS, KNOWN_ABILITY_IDS } from "./config.js";
import { pointInRect } from "./math.js";
import { validateMotionDefinition } from "./motion.js";

export function validateLevel(level) {
  const errors = [];
  const ids = new Set();
  const collections = [
    "platforms",
    "slopes",
    "hazards",
    "anchors",
    "energyOrbs",
    "dashRefills",
    "movingObjects",
    "launchers",
    "fragilePlatforms",
    "gates",
    "stateTriggers",
    "abilityPickups",
    "bashTargets",
    "windZones",
    "liquidZones",
    "darknessZones",
    "checkpoints",
    "roomEntrances",
    "roomExits",
    "rotationTriggers",
    "signs"
  ];

  if (!level.id) errors.push("Level must have an id");
  if (level.category === "单项3C" && !ACCEPTANCE_LEVELS.includes(level.acceptanceLevel)) {
    errors.push("Focused 3C level must define an acceptance level from L0 to L4");
  }
  if (!level.bounds || level.bounds.w <= 0 || level.bounds.h <= 0) errors.push("Level bounds must be positive");
  if (!level.spawn) errors.push("Level must have a spawn point");
  if (!Number.isInteger(level.dashCapacity ?? 1) || (level.dashCapacity ?? 1) < 1 || (level.dashCapacity ?? 1) > 3) {
    errors.push("Level dashCapacity must be an integer from 1 to 3");
  }

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

      if ((collectionName === "platforms" || collectionName === "hazards" || collectionName === "checkpoints" || collectionName === "roomEntrances" || collectionName === "roomExits" || collectionName === "rotationTriggers" || collectionName === "launchers" || collectionName === "fragilePlatforms" || collectionName === "gates" || collectionName === "stateTriggers") && (item.w <= 0 || item.h <= 0)) {
        errors.push(`${item.id || collectionName} must have positive dimensions`);
      }
      if (collectionName === "windZones" && (item.w <= 0 || item.h <= 0 || !Number.isFinite(item.forceX) || !Number.isFinite(item.forceY))) {
        errors.push(`${item.id || collectionName} must define a valid wind zone`);
      }
      if (collectionName === "liquidZones" && (item.w <= 0 || item.h <= 0 || !Number.isFinite(item.gravityScale) || !Number.isFinite(item.drag) || !Number.isFinite(item.currentX) || !Number.isFinite(item.currentY))) {
        errors.push(`${item.id || collectionName} must define a valid liquid zone`);
      }
      if (collectionName === "darknessZones" && (item.w <= 0 || item.h <= 0 || item.opacity < 0 || item.opacity > 1 || item.revealRadius <= 0)) {
        errors.push(`${item.id || collectionName} must define valid darkness dimensions, opacity and reveal radius`);
      }
      if (collectionName === "slopes" && (!Number.isFinite(item.ax) || !Number.isFinite(item.ay) || !Number.isFinite(item.bx) || !Number.isFinite(item.by) || item.thickness <= 0)) {
        errors.push(`${item.id || collectionName} must define a valid segment and positive thickness`);
      }
      if (collectionName === "dashRefills" && (!Number.isFinite(item.radius) || item.radius <= 0 || !Number.isInteger(item.charges) || item.charges < 1 || item.charges > 3)) {
        errors.push(`${item.id || collectionName} must define a positive radius and 1 to 3 charges`);
      }
      if (collectionName === "movingObjects") errors.push(...validateMotionDefinition(item));
    }
  }

  for (const movingObject of level.movingObjects || []) {
    if (!new Set(["platform", "hazard", "anchor", "bashTarget"]).has(movingObject.objectKind)) {
      errors.push(`${movingObject.id} has unsupported moving object kind ${movingObject.objectKind}`);
    }
    if (["platform", "hazard"].includes(movingObject.objectKind) && (movingObject.w <= 0 || movingObject.h <= 0)) {
      errors.push(`${movingObject.id} must define positive moving dimensions`);
    }
    for (const point of movingObject.path || []) {
      if (level.bounds && !pointInRect(point.x, point.y, level.bounds)) {
        errors.push(`${movingObject.id} path point must stay inside level bounds`);
      }
    }
  }

  for (const launcher of level.launchers || []) {
    if (!Number.isFinite(launcher.launchX) || !Number.isFinite(launcher.launchY) || launcher.cooldownSeconds <= 0) {
      errors.push(`${launcher.id} must define launch velocity and a positive cooldown`);
    }
  }

  for (const fragile of level.fragilePlatforms || []) {
    if (fragile.breakDelaySeconds < 0 || fragile.respawnSeconds <= 0 || fragile.fallSpeed < 0) {
      errors.push(`${fragile.id} must define non-negative break/fall values and a positive respawn`);
    }
  }

  for (const gate of level.gates || []) {
    if (gate.requiredAbility && !KNOWN_ABILITY_IDS.has(gate.requiredAbility)) errors.push(`${gate.id} requires unknown ability ${gate.requiredAbility}`);
    if (!gate.initiallyOpen && !gate.requiredAbility && !gate.requiredFlag) errors.push(`${gate.id} must define an unlock condition or start open`);
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

  for (const entrance of level.roomEntrances || []) {
    if (!entrance.spawn || !Number.isFinite(entrance.spawn.x) || !Number.isFinite(entrance.spawn.y)) {
      errors.push(`${entrance.id} must define a valid entrance spawn`);
    } else if (level.bounds && !pointInRect(entrance.spawn.x, entrance.spawn.y, level.bounds)) {
      errors.push(`${entrance.id} entrance spawn must be inside level bounds`);
    }
  }

  for (const exit of level.roomExits || []) {
    if (!exit.targetRoomId) errors.push(`${exit.id} must define targetRoomId`);
    if (!exit.targetEntranceId) errors.push(`${exit.id} must define targetEntranceId`);
    if (exit.requiredAbility && !KNOWN_ABILITY_IDS.has(exit.requiredAbility)) {
      errors.push(`${exit.id} requires unknown ability ${exit.requiredAbility}`);
    }
  }

  if (level.spawn && level.bounds && !pointInRect(level.spawn.x, level.spawn.y, level.bounds)) {
    errors.push("Spawn point must be inside level bounds");
  }
  if (!level.checkpoints?.length) errors.push("Level must have at least one checkpoint");
  if (!level.goal && !level.roomExits?.length) {
    errors.push("Level must have a goal");
  } else if (level.goal) {
    const goal = level.goal;
    if (!goal.id) {
      errors.push("Goal must have an id");
    } else if (ids.has(goal.id)) {
      errors.push(`Duplicate level item id: ${goal.id}`);
    }
    if (!Number.isFinite(goal.x) || !Number.isFinite(goal.y) || !Number.isFinite(goal.radius) || goal.radius <= 0) {
      errors.push("Goal must define a valid position and positive radius");
    } else {
      if (level.bounds && !pointInRect(goal.x, goal.y, level.bounds)) {
        errors.push("Goal center must be inside level bounds");
      }
      const blockingPlatform = (level.platforms || []).find((platform) => pointInRect(goal.x, goal.y, platform));
      if (blockingPlatform) errors.push(`Goal center cannot be embedded in platform ${blockingPlatform.id}`);
    }
  }

  return errors;
}
