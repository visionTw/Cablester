import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { TUNING } from "../src/config.js";
import { LEVELS } from "../src/levels.js";
import { LEVEL_ART_PRESET_BY_ID, applyLevelArtPreset } from "../src/level-art-presets.js";
import {
  createBlankLevelDocument,
  createLevelObject,
  levelToDocument
} from "../src/level-objects.js";
import { createSceneLayer } from "../src/scene-layers.js";
import { serializeWorldPackage } from "../src/world-schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOREST_PRESET = LEVEL_ART_PRESET_BY_ID["combined-horizontal"];
const GODOT_BUILD_ID = (await readFile(resolve(root, "GODOT_VERSION"), "utf8")).trim();
const PLAYER_CLEARANCE = Number(TUNING.playerRadius || 18) + 4;
const SIDE_BOUNDARY_WIDTH = 40;

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function transform(position = { x: 0, y: 0 }) {
  return {
    position: { x: position.x, y: position.y },
    rotationDegrees: 0,
    scale: { x: 1, y: 1 }
  };
}

function approvedTuning() {
  return {
    version: "approved-1",
    draft: {
      status: "experimental-only",
      overrides: {}
    },
    approved: {
      fixedStepHz: 120,
      abilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
      values: structuredClone(TUNING),
      inputs: {
        moveLeft: ["KeyA", "JoyLeft"],
        moveRight: ["KeyD", "JoyRight"],
        jumpGlide: ["Space"],
        dash: ["Control"],
        rope: ["MouseLeft"],
        ropeWinch: ["KeyW", "ArrowUp"],
        hardBar: ["KeyF"],
        bash: ["KeyQ"],
        wallGrab: ["Shift"],
        resetCheckpoint: ["Backspace"]
      },
      tolerances: {
        tick: 1,
        runPosition: 18,
        jumpApexHeight: 18,
        ropeTrajectoryRms: 24,
        hardBarLength: 1,
        dashPosition: 18,
        bashPosition: 22,
        glideHeight: 24,
        wallMovementPosition: 22,
        exactResources: true,
        exactTargetIds: true
      }
    }
  };
}

function worldManifest(worldId, title, namespace, versions) {
  return {
    worldId,
    title,
    namespace,
    contentVersion: "1.0.0",
    contentHash: "",
    gameplayTuningVersion: "approved-1",
    assetRegistryVersion: versions.asset,
    prefabRegistryVersion: versions.prefab,
    typeRegistryVersion: versions.type
  };
}

function addObject(document, chunkId, type, shortId, x, y, properties = {}, tags = []) {
  const id = `${chunkId}:${shortId}`;
  const canonicalProperties = tags.includes("persistent-state") && ["stateTrigger", "abilityPickup"].includes(type)
    ? { ...properties, resetPolicy: properties.resetPolicy || "persistent" }
    : properties;
  const object = createLevelObject(type, x, y, document.objects, { id, properties: canonicalProperties });
  object.tags = tags;
  document.objects.push(object);
  return object;
}

function baseChunkDocument(spec) {
  const document = createBlankLevelDocument(spec.name);
  document.metadata = {
    id: spec.id,
    name: spec.name,
    category: spec.category || "暮种林",
    summary: spec.summary,
    acceptanceLevel: spec.acceptanceLevel || "L2",
    mode: "reference-room"
  };
  document.bounds = { x: 0, y: 0, w: 2200, h: 900 };
  document.dashCapacity = spec.dashCapacity || 1;
  document.startingAbilities = [...spec.startingAbilities];
  document.objects = [];
  addObject(document, spec.id, "spawn", "spawn", 140, 560);
  addObject(document, spec.id, "checkpoint", "checkpoint-main", 90, 510, {
    w: 90,
    h: 110,
    spawnOffsetX: 45,
    spawnOffsetY: 50
  }, ["safe-respawn"]);
  addObject(document, spec.id, "boundaryWall", "ceiling-wall", 0, -40, {
    w: 2200,
    h: 40,
    blockingSide: "bottom",
    grapple: false
  }, ["edge-safety"]);
  addObject(document, spec.id, "boundaryWall", "recovery-floor", 0, 860, {
    w: 2200,
    h: 40,
    blockingSide: "top",
    grapple: false
  }, ["edge-safety", "fall-recovery"]);
  addObject(document, spec.id, "boundaryWall", "left-boundary", 0, 0, {
    w: SIDE_BOUNDARY_WIDTH,
    h: 860,
    blockingSide: "all",
    grapple: false
  }, ["edge-safety", "side-boundary"]);
  addObject(document, spec.id, "boundaryWall", "right-boundary", 2200 - SIDE_BOUNDARY_WIDTH, 0, {
    w: SIDE_BOUNDARY_WIDTH,
    h: 860,
    blockingSide: "all",
    grapple: false
  }, ["edge-safety", "side-boundary"]);
  addObject(document, spec.id, "backgroundSeed", "seed-a", 520, 220, { size: 210 });
  addObject(document, spec.id, "backgroundSeed", "seed-b", 1420, 300, { size: 260 });
  return document;
}

const forestSpecs = [
  {
    id: "seedgate-verge",
    name: "种灯门缘",
    summary: "从安全林缘学习以绳、杆和冲刺保持动量。",
    worldPosition: { x: 0, y: 0 },
    startingAbilities: ["rope", "hardBar", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "start-ground", 0, 640, { w: 520, h: 180 }, ["main-route"]);
      addObject(document, this.id, "platform", "root-step-a", 720, 560, { w: 230, h: 100 }, ["main-route"]);
      addObject(document, this.id, "platform", "root-step-b", 1120, 450, { w: 260, h: 90 }, ["main-route"]);
      addObject(document, this.id, "platform", "gate-ground", 1570, 610, { w: 630, h: 180 }, ["main-route"]);
      addObject(document, this.id, "hazard", "bramble-a", 520, 690, { w: 200, h: 90, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "bramble-b", 950, 690, { w: 170, h: 90, damage: 1, direction: "up" });
      addObject(document, this.id, "anchor", "root-knot-a", 620, 310, { anchorType: "both" });
      addObject(document, this.id, "anchor", "root-knot-b", 1040, 260, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "root-knot-c", 1460, 330, { anchorType: "both" });
      addObject(document, this.id, "energyOrb", "energy-a", 820, 490, { amount: 1 });
      addObject(document, this.id, "energyOrb", "energy-b", 1280, 380, { amount: 1 });
      addObject(document, this.id, "sign", "route-sign", 250, 585, { text: "暮种林入口 · 软绳摆荡与硬杆撑跳都能通过" });
    }
  },
  {
    id: "lantern-crossing",
    name: "灯脉岔桥",
    summary: "第一处分岔：下层安全、上层快速，低位支路稍后回接。",
    worldPosition: { x: 2400, y: 0 },
    startingAbilities: ["rope", "hardBar", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "west-bank", 0, 640, { w: 430, h: 180 }, ["main-route"]);
      addObject(document, this.id, "platform", "low-island", 640, 600, { w: 280, h: 120 }, ["safe-route"]);
      addObject(document, this.id, "platform", "high-island", 1080, 380, { w: 260, h: 80 }, ["fast-route"]);
      addObject(document, this.id, "platform", "east-bank", 1540, 600, { w: 660, h: 180 }, ["main-route"]);
      addObject(document, this.id, "hazard", "root-pit-a", 430, 700, { w: 210, h: 90, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "root-pit-b", 1100, 700, { w: 440, h: 90, damage: 1, direction: "up" });
      addObject(document, this.id, "slope", "upper-rib-a", 440, 330, { dx: 280, dy: -90, thickness: 14, grapple: true });
      addObject(document, this.id, "slope", "upper-rib-b", 1320, 260, { dx: 260, dy: 100, thickness: 14, grapple: true });
      addObject(document, this.id, "anchor", "crossing-knot-a", 560, 300, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "crossing-knot-b", 960, 240, { anchorType: "both" });
      addObject(document, this.id, "anchor", "crossing-knot-c", 1410, 310, { anchorType: "rope" });
      addObject(document, this.id, "movingObject", "root-ferry", 920, 540, {
        objectKind: "platform", w: 190, h: 28, pathPoints: "0,0;300,-120", speed: 150,
        acceleration: 800, dwellSeconds: 0.3, easing: "smoothstep", loopMode: "pingpong",
        trigger: "auto", offscreenPolicy: "simulate", resetPolicy: "room", grapple: true
      });
      addObject(document, this.id, "sign", "fork-sign", 1760, 540, { text: "向下可进入苔蓄池 · 水闸开启后形成返回捷径" });
    }
  },
  {
    id: "root-aqueduct",
    name: "根脉水渠",
    summary: "穿越浅水与移动根桥，在主路旁建立第一个持久状态回环。",
    worldPosition: { x: 4800, y: 600 },
    startingAbilities: ["rope", "hardBar", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "west-sill", 0, 620, { w: 420, h: 190 }, ["main-route"]);
      addObject(document, this.id, "platform", "mid-dam", 820, 520, { w: 290, h: 120 }, ["main-route"]);
      addObject(document, this.id, "platform", "east-sill", 1600, 600, { w: 600, h: 190 }, ["main-route"]);
      addObject(document, this.id, "liquidZone", "aqueduct-water", 420, 560, {
        w: 1180, h: 230, liquidType: "water", gravityScale: 0.24, drag: 2.4,
        currentX: 90, currentY: 0, swimAcceleration: 680, contactDamage: 0
      }, ["water-route"]);
      addObject(document, this.id, "movingObject", "dam-lift", 1240, 500, {
        objectKind: "platform", w: 180, h: 28, pathPoints: "0,0;0,-260", speed: 130,
        acceleration: 700, dwellSeconds: 0.4, easing: "ease-in-out", loopMode: "pingpong",
        trigger: "auto", offscreenPolicy: "simulate", resetPolicy: "room", grapple: true
      });
      addObject(document, this.id, "stateTrigger", "sluice-lever", 950, 400, {
        w: 100, h: 120, setFlag: "cistern-sluice-open", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "gate", "sluice-gate", 1480, 360, {
        w: 70, h: 240, requiredAbility: "", requiredFlag: "cistern-sluice-open", openWhen: "any",
        initiallyOpen: false, latchOpen: true, resetOnDeath: false
      });
      addObject(document, this.id, "anchor", "canal-knot-a", 620, 310, { anchorType: "both" });
      addObject(document, this.id, "anchor", "canal-knot-b", 1450, 280, { anchorType: "rope" });
      addObject(document, this.id, "sign", "sluice-sign", 760, 465, { text: "触碰种灯阀门可永久开启返水闸" });
    }
  },
  {
    id: "canopy-lift",
    name: "冠层升井",
    summary: "在宽净空竖井取得二段跳，并用多种方式完成攀升。",
    worldPosition: { x: 7200, y: -1200 },
    startingAbilities: ["rope", "hardBar", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "lift-base", 0, 650, { w: 560, h: 170 }, ["main-route"]);
      addObject(document, this.id, "platform", "shelf-a", 650, 520, { w: 250, h: 70 }, ["main-route"]);
      addObject(document, this.id, "platform", "shelf-b", 1050, 360, { w: 250, h: 70 }, ["main-route"]);
      addObject(document, this.id, "platform", "shelf-c", 1480, 220, { w: 250, h: 70 }, ["main-route"]);
      addObject(document, this.id, "platform", "lift-top", 1760, 560, { w: 440, h: 200 }, ["main-route"]);
      addObject(document, this.id, "abilityPickup", "double-jump-seed", 420, 570, {
        abilityId: "doubleJump", source: "duskseed-main-route"
      }, ["mandatory-ability", "persistent-state"]);
      addObject(document, this.id, "hazard", "shaft-thorns-a", 560, 740, { w: 440, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "shaft-thorns-b", 1300, 740, { w: 460, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "anchor", "lift-knot-a", 720, 270, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "lift-knot-b", 1140, 170, { anchorType: "both" });
      addObject(document, this.id, "anchor", "lift-knot-c", 1570, 120, { anchorType: "rope" });
      addObject(document, this.id, "launcher", "seed-launcher", 1330, 600, {
        w: 70, h: 28, launchX: 380, launchY: -760, cooldownSeconds: 0.35, preserveMomentum: true
      });
      addObject(document, this.id, "sign", "ability-sign", 250, 590, { text: "取得回声种后可在空中再次跳跃" });
    }
  },
  {
    id: "wind-terraces",
    name: "风叶台地",
    summary: "取得滑翔后读取上升气流，验证方向预取和长距离空中路线。",
    worldPosition: { x: 9600, y: -1200 },
    startingAbilities: ["rope", "hardBar", "doubleJump", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "west-cliff", 0, 620, { w: 500, h: 160 }, ["main-route"]);
      addObject(document, this.id, "platform", "rest-island", 900, 610, { w: 260, h: 100 }, ["safe-route"]);
      addObject(document, this.id, "platform", "east-cliff", 1720, 620, { w: 480, h: 160 }, ["main-route"]);
      addObject(document, this.id, "abilityPickup", "glide-leaf", 340, 420, {
        abilityId: "glide", source: "duskseed-main-route"
      }, ["mandatory-ability", "persistent-state"]);
      addObject(document, this.id, "windZone", "updraft-west", 500, 250, { w: 300, h: 500, forceX: 70, forceY: -540 });
      addObject(document, this.id, "windZone", "crosswind-mid", 800, 280, { w: 720, h: 420, forceX: 330, forceY: -80 });
      addObject(document, this.id, "windZone", "updraft-east", 1520, 260, { w: 200, h: 480, forceX: 0, forceY: -610 });
      addObject(document, this.id, "hazard", "valley-thorns-west", 500, 760, { w: 430, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "valley-thorns-east", 1110, 760, { w: 610, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "anchor", "wind-knot-a", 760, 220, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "wind-knot-b", 1480, 210, { anchorType: "both" });
      addObject(document, this.id, "dashRefill", "air-refill", 1320, 410, {
        radius: 20, charges: 1, restoreMode: "fill", oneUse: false, respawnSeconds: 2.5, resetOnDeath: true
      });
      addObject(document, this.id, "sign", "glide-sign", 250, 445, { text: "下降时按住跳跃展开滑翔；气流会强化升力" });
    }
  },
  {
    id: "bellroot-court",
    name: "双根钟庭",
    summary: "中央枢纽取得猛击，点响双根钟并开启三向回环。",
    worldPosition: { x: 12000, y: 0 },
    startingAbilities: ["rope", "hardBar", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "court-west", 0, 620, { w: 520, h: 180 }, ["main-route"]);
      addObject(document, this.id, "platform", "bell-dais", 820, 520, { w: 560, h: 140 }, ["landmark"]);
      addObject(document, this.id, "platform", "court-east", 1680, 620, { w: 520, h: 180 }, ["main-route"]);
      addObject(document, this.id, "abilityPickup", "bash-bloom", 1080, 450, {
        abilityId: "bash", source: "duskseed-main-route"
      }, ["mandatory-ability", "persistent-state", "landmark"]);
      addObject(document, this.id, "bashTarget", "bell-left", 720, 310, {}, ["landmark"]);
      addObject(document, this.id, "bashTarget", "bell-right", 1480, 310, {}, ["landmark"]);
      addObject(document, this.id, "bashTarget", "bell-bridge", 1100, 250);
      addObject(document, this.id, "stateTrigger", "bell-trigger", 1000, 380, {
        w: 200, h: 140, setFlag: "bellroot-bells-rung", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "gate", "east-bell-gate", 1580, 380, {
        w: 70, h: 240, requiredAbility: "bash", requiredFlag: "bellroot-bells-rung", openWhen: "all",
        initiallyOpen: false, latchOpen: true, resetOnDeath: false
      });
      addObject(document, this.id, "hazard", "court-thorns-a", 520, 720, { w: 300, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "court-thorns-b", 1380, 720, { w: 300, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "sign", "bash-sign", 860, 475, { text: "按住猛击选向，点响两侧根钟后东门保持开启" });
    }
  },
  {
    id: "heartwood-ring",
    name: "心木环庭",
    summary: "在心木环路串联全部批准能力，并唤醒通往出口的种灯脉冲。",
    worldPosition: { x: 14400, y: 0 },
    startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "ring-west", 0, 640, { w: 420, h: 170 }, ["main-route"]);
      addObject(document, this.id, "platform", "ring-low", 740, 620, { w: 280, h: 100 }, ["safe-route"]);
      addObject(document, this.id, "platform", "ring-high", 1120, 350, { w: 280, h: 80 }, ["fast-route"]);
      addObject(document, this.id, "platform", "ring-east", 1740, 580, { w: 460, h: 220 }, ["main-route"]);
      addObject(document, this.id, "hazard", "ring-thorns-a", 420, 760, { w: 320, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "ring-thorns-b", 1100, 760, { w: 640, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "anchor", "heart-knot-a", 560, 300, { anchorType: "both" });
      addObject(document, this.id, "anchor", "heart-knot-b", 960, 220, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "heart-knot-c", 1510, 270, { anchorType: "both" });
      addObject(document, this.id, "bashTarget", "heart-bash-a", 840, 470);
      addObject(document, this.id, "bashTarget", "heart-bash-b", 1440, 430);
      addObject(document, this.id, "dashRefill", "heart-refill", 1280, 300, {
        radius: 20, charges: 1, restoreMode: "fill", oneUse: false, respawnSeconds: 2.5, resetOnDeath: true
      });
      addObject(document, this.id, "stateTrigger", "heart-awakening", 1820, 420, {
        w: 160, h: 160, setFlag: "heartwood-awake", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state", "landmark"]);
      addObject(document, this.id, "sign", "heart-sign", 1800, 530, { text: "抵达心木核会永久唤醒出口脉冲" });
    }
  },
  {
    id: "afterglow-gate",
    name: "余辉林门",
    summary: "回读持久状态、保存检查点并抵达第一阶段出口。",
    worldPosition: { x: 16800, y: 400 },
    startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "arrival", 0, 620, { w: 620, h: 180 }, ["main-route"]);
      addObject(document, this.id, "platform", "gate-steps", 820, 520, { w: 320, h: 130 }, ["main-route"]);
      addObject(document, this.id, "platform", "exit-ground", 1360, 600, { w: 840, h: 200 }, ["main-route"]);
      addObject(document, this.id, "gate", "afterglow-seal", 1240, 360, {
        w: 70, h: 240, requiredAbility: "", requiredFlag: "heartwood-awake", openWhen: "any",
        initiallyOpen: false, latchOpen: true, resetOnDeath: false
      });
      addObject(document, this.id, "checkpoint", "checkpoint-final", 1420, 510, {
        w: 90, h: 90, spawnOffsetX: 45, spawnOffsetY: 40
      }, ["safe-respawn", "save-anchor"]);
      addObject(document, this.id, "goal", "forest-exit", 1920, 530, { radius: 42 }, ["region-exit"]);
      addObject(document, this.id, "sign", "exit-sign", 1600, 545, { text: "暮种林出口 · 第一阶段到此停止" });
    }
  },
  {
    id: "moss-cistern",
    name: "苔蓄池",
    summary: "低位水路支线，提供返水闸回环和资源恢复。",
    worldPosition: { x: 5200, y: 2200 },
    startingAbilities: ["rope", "hardBar", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "cistern-west", 0, 600, { w: 520, h: 180 }, ["optional-route"]);
      addObject(document, this.id, "platform", "cistern-island", 900, 500, { w: 300, h: 110 }, ["optional-route"]);
      addObject(document, this.id, "platform", "cistern-east", 1640, 600, { w: 560, h: 180 }, ["optional-route"]);
      addObject(document, this.id, "liquidZone", "deep-water", 520, 520, {
        w: 1120, h: 260, liquidType: "water", gravityScale: 0.24, drag: 3.1,
        currentX: -80, currentY: 0, swimAcceleration: 720, contactDamage: 0
      });
      addObject(document, this.id, "energyOrb", "cistern-energy-a", 760, 470, { amount: 2 });
      addObject(document, this.id, "energyOrb", "cistern-energy-b", 1380, 460, { amount: 2 });
      addObject(document, this.id, "stateTrigger", "return-sluice", 1060, 370, {
        w: 120, h: 130, setFlag: "cistern-sluice-open", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "sign", "cistern-sign", 970, 455, { text: "点亮水下阀门后可返回灯脉岔桥" });
    }
  },
  {
    id: "echo-burrow",
    name: "回声暗穴",
    summary: "点亮种灯解除黑暗，形成风叶台地到钟庭的稳定回路。",
    worldPosition: { x: 9600, y: 1800 },
    startingAbilities: ["rope", "hardBar", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "burrow-west", 0, 620, { w: 480, h: 180 }, ["optional-route"]);
      addObject(document, this.id, "platform", "burrow-mid", 820, 540, { w: 360, h: 120 }, ["optional-route"]);
      addObject(document, this.id, "platform", "burrow-east", 1580, 620, { w: 620, h: 180 }, ["optional-route"]);
      addObject(document, this.id, "darknessZone", "burrow-darkness", 420, 150, {
        w: 1260, h: 560, opacity: 0.82, revealRadius: 175, clearedByFlag: "echo-seed-lit"
      });
      addObject(document, this.id, "anchor", "echo-knot-a", 650, 320, { anchorType: "rope" });
      addObject(document, this.id, "anchor", "echo-knot-b", 1360, 280, { anchorType: "both" });
      addObject(document, this.id, "stateTrigger", "echo-seed", 980, 400, {
        w: 130, h: 140, setFlag: "echo-seed-lit", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "sign", "echo-sign", 900, 490, { text: "靠近中央回声种可永久驱散洞穴黑暗" });
    }
  },
  {
    id: "crown-overlook",
    name: "冠顶眺台",
    summary: "需要滑翔的高速支线，完成后开放心木顶部捷径。",
    worldPosition: { x: 12600, y: -2400 },
    startingAbilities: ["rope", "hardBar", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "overlook-west", 0, 620, { w: 440, h: 160 }, ["optional-route"]);
      addObject(document, this.id, "platform", "overlook-rest", 980, 620, { w: 240, h: 100 }, ["safe-route"]);
      addObject(document, this.id, "platform", "overlook-east", 1760, 620, { w: 440, h: 160 }, ["optional-route"]);
      addObject(document, this.id, "windZone", "crown-wind", 440, 180, { w: 1320, h: 540, forceX: 380, forceY: -120 });
      addObject(document, this.id, "hazard", "crown-thorns-west", 440, 760, { w: 490, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "hazard", "crown-thorns-east", 1110, 760, { w: 650, h: 80, damage: 1, direction: "up" });
      addObject(document, this.id, "dashRefill", "crown-refill-a", 760, 360, {
        radius: 20, charges: 1, restoreMode: "fill", oneUse: false, respawnSeconds: 2.5, resetOnDeath: true
      });
      addObject(document, this.id, "dashRefill", "crown-refill-b", 1430, 330, {
        radius: 20, charges: 1, restoreMode: "fill", oneUse: false, respawnSeconds: 2.5, resetOnDeath: true
      });
      addObject(document, this.id, "stateTrigger", "crown-complete", 1840, 340, {
        w: 120, h: 140, setFlag: "crown-route-open", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "sign", "crown-sign", 180, 445, { text: "滑翔并串联空中冲刺；东端会开启顶部捷径" });
    }
  },
  {
    id: "old-nursery",
    name: "旧种圃",
    summary: "碎裂平台与移动机关支线，修复后提供备用出口。",
    worldPosition: { x: 14800, y: 2200 },
    startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
    build(document) {
      addObject(document, this.id, "platform", "nursery-west", 0, 620, { w: 430, h: 180 }, ["optional-route"]);
      addObject(document, this.id, "fragilePlatform", "seed-bed-a", 560, 540, {
        w: 210, h: 28, breakDelaySeconds: 0.45, respawnSeconds: 2.4, fallSpeed: 80,
        oneUse: false, resetOnDeath: true, grapple: true
      });
      addObject(document, this.id, "fragilePlatform", "seed-bed-b", 900, 430, {
        w: 210, h: 28, breakDelaySeconds: 0.4, respawnSeconds: 2.4, fallSpeed: 80,
        oneUse: false, resetOnDeath: true, grapple: true
      });
      addObject(document, this.id, "movingObject", "nursery-lift", 1260, 560, {
        objectKind: "platform", w: 200, h: 28, pathPoints: "0,0;0,-260", speed: 160,
        acceleration: 850, dwellSeconds: 0.3, easing: "smoothstep", loopMode: "pingpong",
        trigger: "touch", offscreenPolicy: "reset", resetPolicy: "death", grapple: true
      });
      addObject(document, this.id, "platform", "nursery-east", 1640, 600, { w: 560, h: 190 }, ["optional-route"]);
      addObject(document, this.id, "stateTrigger", "nursery-core", 1750, 450, {
        w: 140, h: 150, setFlag: "nursery-restored", clearFlag: "", oneUse: true, resetOnDeath: false
      }, ["persistent-state"]);
      addObject(document, this.id, "energyOrb", "nursery-energy", 1050, 340, { amount: 3 });
      addObject(document, this.id, "sign", "nursery-sign", 1650, 545, { text: "修复旧种圃后，余辉林门会保留备用返回口" });
    }
  }
];

const forestEdges = [
  { id: "main-01", a: "seedgate-verge", aSide: "right", b: "lantern-crossing", bSide: "left", kind: "main" },
  { id: "main-02", a: "lantern-crossing", aSide: "right", b: "root-aqueduct", bSide: "left", kind: "main" },
  { id: "main-03", a: "root-aqueduct", aSide: "right", b: "canopy-lift", bSide: "left", kind: "main" },
  { id: "main-04", a: "canopy-lift", aSide: "right", b: "wind-terraces", bSide: "left", kind: "main", requiredAbilities: ["doubleJump"] },
  { id: "main-05", a: "wind-terraces", aSide: "right", b: "bellroot-court", bSide: "left", kind: "main", requiredAbilities: ["glide"] },
  { id: "main-06", a: "bellroot-court", aSide: "right", b: "heartwood-ring", bSide: "left", kind: "main", requiredAbilities: ["bash"], requiredFlags: ["bellroot-bells-rung"] },
  { id: "main-07", a: "heartwood-ring", aSide: "right", b: "afterglow-gate", bSide: "left", kind: "main", requiredFlags: ["heartwood-awake"] },
  { id: "loop-cistern-a", a: "root-aqueduct", aSide: "down", b: "moss-cistern", bSide: "up", kind: "optional" },
  { id: "loop-cistern-b", a: "moss-cistern", aSide: "left", b: "lantern-crossing", bSide: "down", kind: "return", requiredFlags: ["cistern-sluice-open"] },
  { id: "loop-echo-a", a: "wind-terraces", aSide: "down", b: "echo-burrow", bSide: "up", kind: "optional" },
  { id: "loop-echo-b", a: "echo-burrow", aSide: "right", b: "bellroot-court", bSide: "down", kind: "return", requiredFlags: ["echo-seed-lit"] },
  { id: "loop-crown-a", a: "bellroot-court", aSide: "up", b: "crown-overlook", bSide: "down", kind: "optional", requiredAbilities: ["glide"] },
  { id: "loop-crown-b", a: "crown-overlook", aSide: "right", b: "heartwood-ring", bSide: "up", kind: "return", requiredAbilities: ["glide"], requiredFlags: ["crown-route-open"] },
  { id: "loop-nursery-a", a: "heartwood-ring", aSide: "down", b: "old-nursery", bSide: "up", kind: "optional" },
  { id: "loop-nursery-b", a: "old-nursery", aSide: "right", b: "afterglow-gate", bSide: "down", kind: "return", requiredFlags: ["nursery-restored"] }
];

function portPosition(side, lane = 0) {
  const offset = lane * 150;
  if (side === "left") return { x: SIDE_BOUNDARY_WIDTH, y: 500 + offset, direction: "left", facing: "right" };
  if (side === "right") return { x: 2200 - SIDE_BOUNDARY_WIDTH - 80, y: 500 + offset, direction: "right", facing: "left" };
  if (side === "up") return { x: 980 + offset, y: 20, direction: "up", facing: "right" };
  return { x: 980 + offset, y: 740, direction: "down", facing: "right" };
}

function rectIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function documentObjectBounds(object) {
  const properties = object.properties || {};
  const position = object.position || { x: 0, y: 0 };
  if (object.type === "slope") {
    const dx = Number(properties.dx || 0);
    const dy = Number(properties.dy || 0);
    const thickness = Number(properties.thickness || 14);
    return {
      x: position.x + Math.min(0, dx) - thickness / 2,
      y: position.y + Math.min(0, dy) - thickness / 2,
      w: Math.abs(dx) + thickness,
      h: Math.abs(dy) + thickness
    };
  }
  const radius = Number(properties.radius);
  const w = Number(properties.w ?? properties.width ?? (Number.isFinite(radius) ? radius * 2 : 32));
  const h = Number(properties.h ?? properties.height ?? (Number.isFinite(radius) ? radius * 2 : 32));
  return { x: position.x, y: position.y, w, h };
}

function isSolidDocumentObject(object) {
  return ["platform", "boundaryWall", "slope", "fragilePlatform", "gate"].includes(object.type)
    || (object.type === "movingObject" && object.properties?.objectKind === "platform");
}

function isHarmfulDocumentObject(object) {
  return object.type === "hazard"
    || (object.type === "movingObject" && object.properties?.objectKind === "hazard")
    || (object.type === "liquidZone" && Number(object.properties?.contactDamage || 0) > 0);
}

function safePortalSpawnOffset(document, port) {
  const candidates = {
    left: [
      { x: port.x + 120, y: port.y + 20 },
      { x: port.x + 120, y: port.y - 20 }
    ],
    right: [
      { x: port.x - 40, y: port.y + 20 },
      { x: port.x - 40, y: port.y - 20 }
    ],
    up: [
      { x: port.x + 40, y: port.y + 160 },
      { x: port.x - 60, y: port.y + 160 },
      { x: port.x + 140, y: port.y + 160 }
    ],
    down: [
      { x: port.x + 40, y: port.y - 40 },
      { x: port.x - 60, y: port.y - 40 },
      { x: port.x + 140, y: port.y - 40 },
      { x: port.x - 140, y: port.y - 40 },
      { x: port.x + 220, y: port.y - 40 }
    ]
  }[port.direction];
  const blockingObjects = document.objects.filter((object) => isSolidDocumentObject(object) || isHarmfulDocumentObject(object));
  const bounds = document.bounds;
  const candidate = candidates.find((point) => {
    const playerBounds = {
      x: point.x - PLAYER_CLEARANCE,
      y: point.y - PLAYER_CLEARANCE,
      w: PLAYER_CLEARANCE * 2,
      h: PLAYER_CLEARANCE * 2
    };
    return playerBounds.x >= bounds.x
      && playerBounds.y >= bounds.y
      && playerBounds.x + playerBounds.w <= bounds.x + bounds.w
      && playerBounds.y + playerBounds.h <= bounds.y + bounds.h
      && !blockingObjects.some((object) => rectIntersects(playerBounds, documentObjectBounds(object)));
  });
  if (!candidate) throw new Error(`No safe ${port.direction} portal spawn in ${document.metadata.id}`);
  return { x: candidate.x - port.x, y: candidate.y - port.y };
}

function attachForestPorts(documents) {
  const usedSides = new Map();
  const laneFor = (chunkId, side) => {
    const key = `${chunkId}:${side}`;
    const lane = usedSides.get(key) || 0;
    usedSides.set(key, lane + 1);
    return lane;
  };
  for (const edge of forestEdges) {
    const aDoc = documents.get(edge.a);
    const bDoc = documents.get(edge.b);
    const aPos = portPosition(edge.aSide, laneFor(edge.a, edge.aSide));
    const bPos = portPosition(edge.bSide, laneFor(edge.b, edge.bSide));
    const aSpawn = safePortalSpawnOffset(aDoc, aPos);
    const bSpawn = safePortalSpawnOffset(bDoc, bPos);
    const aEntranceId = `${edge.a}:entrance-${edge.b}`;
    const bEntranceId = `${edge.b}:entrance-${edge.a}`;
    addObject(aDoc, edge.a, "roomEntrance", `entrance-${edge.b}`, aPos.x, aPos.y, {
      w: 80, h: 120, spawnOffsetX: aSpawn.x,
      spawnOffsetY: aSpawn.y, facing: aPos.facing, sourceRoomId: edge.b
    }, [edge.kind]);
    addObject(bDoc, edge.b, "roomEntrance", `entrance-${edge.a}`, bPos.x, bPos.y, {
      w: 80, h: 120, spawnOffsetX: bSpawn.x,
      spawnOffsetY: bSpawn.y, facing: bPos.facing, sourceRoomId: edge.a
    }, [edge.kind]);
    addObject(aDoc, edge.a, "roomExit", `exit-${edge.b}`, aPos.x, aPos.y, {
      w: 80, h: 120, targetRoomId: edge.b, targetEntranceId: bEntranceId,
      direction: aPos.direction, exitKind: edge.kind, requiredAbility: edge.requiredAbilities?.[0] || "", oneWay: false
    }, [edge.kind]);
    addObject(bDoc, edge.b, "roomExit", `exit-${edge.a}`, bPos.x, bPos.y, {
      w: 80, h: 120, targetRoomId: edge.a, targetEntranceId: aEntranceId,
      direction: bPos.direction, exitKind: edge.kind === "main" ? "return" : edge.kind,
      requiredAbility: edge.requiredAbilities?.[0] || "", oneWay: false
    }, [edge.kind]);
  }
}

function documentObjectsToCanonical(document, idPrefix = "") {
  return document.objects.map((object) => ({
    id: idPrefix ? `${idPrefix}:${object.id}` : object.id,
    type: object.type,
    transform: transform(object.position),
    properties: structuredClone(object.properties),
    links: Array.isArray(object.links)
      ? object.links.map((link) => typeof link === "string" && idPrefix ? `${idPrefix}:${link}` : structuredClone(link))
      : [],
    tags: Array.isArray(object.tags) ? [...object.tags] : []
  }));
}

function canonicalChunkFromDocument(document, spec, connections = []) {
  const decorated = applyLevelArtPreset(document, FOREST_PRESET);
  const landmarkByChunk = {
    "seedgate-verge": {
      assetId: "landmark:duskseed-gate", name: "暮种灯门", originX: 1640, scale: 0.72
    },
    "bellroot-court": {
      assetId: "landmark:twin-root-bells", name: "双根钟", originX: 1100, scale: 0.76
    },
    "heartwood-ring": {
      assetId: "landmark:heartwood-core", name: "心木核环", originX: 1820, scale: 0.68
    }
  };
  const landmark = landmarkByChunk[spec.id];
  if (landmark) {
    decorated.scene.layers.push(createSceneLayer({
      id: `scene-landmark-${spec.id}`,
      name: landmark.name,
      role: "custom",
      depth: -1,
      assets: [{ assetId: landmark.assetId, weight: 1 }],
      visible: true,
      locked: true,
      parallax: 0.96,
      scale: landmark.scale,
      opacity: 1,
      tint: "#ffffff",
      blur: 0,
      fog: 0,
      blendMode: "source-over",
      repeatX: false,
      seamless: { mode: "tile", tileWidth: 500, overlap: 0 },
      seed: `${spec.id}-formal-landmark`,
      range: { startX: landmark.originX - 1, endX: landmark.originX + 1 },
      originX: landmark.originX,
      spacing: 500,
      density: 1,
      drawCap: 1
    }, decorated.scene.layers));
  }
  decorated.scene.layers = decorated.scene.layers.map((layer) => ({
    ...layer,
    seed: `${spec.id}-${layer.id}`
  }));
  return {
    id: spec.id,
    name: spec.name,
    transform: transform(spec.worldPosition),
    bounds: { x: 0, y: 0, w: 2200, h: 900 },
    streaming: {
      prefetchDistance: 900,
      hysteresis: 320,
      unloadDelaySeconds: 2.4,
      keepAlive: spec.id === "bellroot-court" || spec.id === "heartwood-ring",
      memoryEstimateBytes: 8_388_608
    },
    connections: structuredClone(connections),
    objects: documentObjectsToCanonical(decorated),
    scene: structuredClone(decorated.scene),
    statePolicy: {
      deathReset: "checkpoint",
      checkpointReset: "chunk",
      offscreen: "sleep-local",
      worldPersistence: ["abilities", "flags", "checkpoint"]
    },
    gameplay: {
      startingAbilities: [...document.startingAbilities],
      dashCapacity: document.dashCapacity,
      acceptanceLevel: document.metadata.acceptanceLevel,
      category: document.metadata.category,
      summary: document.metadata.summary
    },
    tags: [
      "formal",
      ...(spec.id === "seedgate-verge" ? ["start"] : []),
      ...(spec.id === "afterglow-gate" ? ["exit"] : []),
      ...(spec.id.includes("gate") || spec.id.includes("court") || spec.id.includes("ring") ? ["landmark"] : [])
    ]
  };
}

function buildForestRegion() {
  const documents = new Map();
  for (const spec of forestSpecs) {
    const document = baseChunkDocument(spec);
    spec.build(document);
    documents.set(spec.id, document);
  }
  attachForestPorts(documents);

  const connections = forestEdges.map((edge) => ({
    id: edge.id,
    from: { chunkId: edge.a, entranceId: `${edge.a}:entrance-${edge.b}` },
    to: { chunkId: edge.b, entranceId: `${edge.b}:entrance-${edge.a}` },
    direction: edge.aSide,
    requiredAbilities: [...(edge.requiredAbilities || [])],
    requiredFlags: [...(edge.requiredFlags || [])],
    oneWay: false
  }));

  return {
    id: "duskseed-reach",
    name: "暮种林",
    transform: transform({ x: 0, y: 0 }),
    bounds: { x: 0, y: -2600, w: 19200, h: 5700 },
    routes: [
      {
        id: "main-route",
        kind: "main",
        chunks: ["seedgate-verge", "lantern-crossing", "root-aqueduct", "canopy-lift", "wind-terraces", "bellroot-court", "heartwood-ring", "afterglow-gate"]
      },
      { id: "cistern-loop", kind: "loop", chunks: ["lantern-crossing", "root-aqueduct", "moss-cistern"] },
      { id: "echo-loop", kind: "loop", chunks: ["wind-terraces", "echo-burrow", "bellroot-court"] },
      { id: "crown-loop", kind: "loop", chunks: ["bellroot-court", "crown-overlook", "heartwood-ring"] },
      { id: "nursery-loop", kind: "loop", chunks: ["heartwood-ring", "old-nursery", "afterglow-gate"] }
    ],
    landmarks: [
      { id: "seedgate", name: "种灯门", chunkId: "seedgate-verge", position: { x: 1600, y: 480 }, assetId: "landmark:duskseed-gate" },
      { id: "twin-root-bells", name: "双根钟", chunkId: "bellroot-court", position: { x: 1100, y: 300 }, assetId: "landmark:twin-root-bells" },
      { id: "heartwood-core", name: "心木环庭", chunkId: "heartwood-ring", position: { x: 1820, y: 420 }, assetId: "landmark:heartwood-core" }
    ],
    chunks: forestSpecs.map((spec) => canonicalChunkFromDocument(
      documents.get(spec.id),
      spec,
      connections.filter((connection) => connection.from.chunkId === spec.id)
    )),
    tags: ["formal", "first-forest", "original"]
  };
}

function labChunkFromLevel(level, index) {
  const document = levelToDocument(level);
  const col = index % 5;
  const row = Math.floor(index / 5);
  return {
    id: level.id,
    name: level.name,
    transform: transform({ x: col * 6200, y: row * 3600 }),
    bounds: structuredClone(document.bounds),
    streaming: {
      prefetchDistance: 0,
      hysteresis: 0,
      unloadDelaySeconds: 0,
      keepAlive: false,
      memoryEstimateBytes: 4_194_304
    },
    connections: [],
    objects: documentObjectsToCanonical(document, level.id),
    scene: structuredClone(document.scene),
    statePolicy: {
      deathReset: "checkpoint",
      checkpointReset: "chunk",
      offscreen: "reset-local",
      worldPersistence: []
    },
    gameplay: {
      startingAbilities: [...document.startingAbilities],
      dashCapacity: document.dashCapacity,
      acceptanceLevel: document.metadata.acceptanceLevel || "L0",
      category: document.metadata.category,
      summary: document.metadata.summary,
      parityStatus: "implemented",
      humanConfirmation: "needed"
    },
    tags: ["3c-lab", document.metadata.category === "综合关卡" ? "combined" : "focused"]
  };
}

async function loadRegistries() {
  const [assetRegistry, prefabRegistry, typeRegistry] = await Promise.all([
    readJson("worlds/registries/asset-registry.json"),
    readJson("worlds/registries/prefab-registry.json"),
    readJson("worlds/registries/type-registry.json")
  ]);
  return {
    assetRegistry,
    prefabRegistry,
    typeRegistry,
    versions: {
      asset: String(assetRegistry.version ?? assetRegistry.schemaVersion ?? 1),
      prefab: String(prefabRegistry.version ?? prefabRegistry.schemaVersion ?? 1),
      type: String(typeRegistry.version ?? typeRegistry.schemaVersion ?? 1)
    }
  };
}

async function writeCanonical(path, world) {
  const serialized = await serializeWorldPackage(world);
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, serialized, "utf8");
  const parsed = JSON.parse(serialized);
  console.log(`${path} · ${parsed.manifest.contentHash}`);
}

async function main() {
  const registries = await loadRegistries();
  const common = {
    schemaVersion: 3,
    assetRegistry: registries.assetRegistry,
    prefabRegistry: registries.prefabRegistry,
    typeRegistry: registries.typeRegistry,
    gameplayTuning: approvedTuning(),
    godotCompatibility: {
      requiredBuildId: GODOT_BUILD_ID,
      importerContractVersion: "1"
    },
    stateDefinitions: {
      flags: [
        { id: "cistern-sluice-open", initialValue: false, persistence: "world" },
        { id: "echo-seed-lit", initialValue: false, persistence: "world" },
        { id: "bellroot-bells-rung", initialValue: false, persistence: "world" },
        { id: "crown-route-open", initialValue: false, persistence: "world" },
        { id: "nursery-restored", initialValue: false, persistence: "world" },
        { id: "heartwood-awake", initialValue: false, persistence: "world" }
      ],
      keys: ["checkpointId", "ownedAbilities", "consumedPickups", "openGates"]
    },
    godotDerivedAllowlist: [
      "generatedAt", "godotBuildId", "importerVersion", "regions.*.aabb", "regions.*.chunks.*.aabb",
      "regions.*.chunks.*.objects.*.collisionBounds", "regions.*.chunks.*.objects.*.resourceUid",
      "telemetry", "thumbnailPath"
    ]
  };

  const forest = {
    ...structuredClone(common),
    manifest: worldManifest("cablester-first-forest", "Cablester · 暮种林", "formal", registries.versions),
    regions: [buildForestRegion()]
  };
  const labs = {
    ...structuredClone(common),
    manifest: worldManifest("cablester-3c-labs", "Cablester · 3C 实验室", "labs", registries.versions),
    regions: [{
      id: "permanent-3c-labs",
      name: "永久 3C 实验室",
      transform: transform({ x: 0, y: 0 }),
      bounds: { x: -1000, y: -2500, w: 33000, h: 10000 },
      routes: [],
      landmarks: LEVELS.map((level, index) => ({
        id: `lab-marker-${level.id}`,
        name: level.name,
        chunkId: level.id,
        position: { x: (index % 5) * 6200, y: Math.floor(index / 5) * 3600 }
      })),
      chunks: LEVELS.map(labChunkFromLevel),
      tags: ["3c-labs", "non-release-world"]
    }]
  };

  await writeCanonical("worlds/formal/first-forest.world.json", forest);
  await writeCanonical("worlds/labs/cablester-3c-labs.world.json", labs);
}

await main();
