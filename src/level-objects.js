import { formatMotionPath, parseMotionPath, validateMotionDefinition } from "./motion.js";
import {
  createVisualConfig,
  getTypeDefaultAssetId,
  validateVisualConfig
} from "./asset-library.js";
import { createDefaultScene, validateScene } from "./scene-layers.js";
import {
  LEVEL_SUPPORT_ABILITY_IDS,
  normalizeStartingAbilities,
  validateStartingAbilities
} from "./level-support.js";

const numberProperty = (label, defaultValue, min = -100000, max = 100000, step = 1) => ({
  label,
  kind: "number",
  default: defaultValue,
  min,
  max,
  step
});

const selectProperty = (label, defaultValue, options) => ({
  label,
  kind: "select",
  default: defaultValue,
  options
});

const textProperty = (label, defaultValue = "") => ({ label, kind: "text", default: defaultValue });
const booleanProperty = (label, defaultValue = false) => ({ label, kind: "boolean", default: defaultValue });

export const LEVEL_OBJECT_CATEGORIES = Object.freeze([
  { id: "layout", label: "关卡结构" },
  { id: "terrain", label: "地形" },
  { id: "danger", label: "危险与机关" },
  { id: "interaction", label: "交互物件" },
  { id: "guidance", label: "引导与装饰" }
]);

export const LEVEL_OBJECT_LIBRARY = Object.freeze({
  spawn: {
    label: "出生点",
    category: "layout",
    color: "#7cf7eb",
    unique: true,
    properties: {}
  },
  goal: {
    label: "终点",
    category: "layout",
    color: "#ffe184",
    unique: true,
    properties: { radius: numberProperty("触发半径", 34, 12, 120) }
  },
  checkpoint: {
    label: "检查点",
    category: "layout",
    color: "#83f4d8",
    properties: {
      w: numberProperty("宽度", 90, 20, 800),
      h: numberProperty("高度", 90, 20, 800),
      spawnOffsetX: numberProperty("复活点 X 偏移", 45, -1000, 1000),
      spawnOffsetY: numberProperty("复活点 Y 偏移", 40, -1000, 1000)
    }
  },
  roomEntrance: {
    label: "房间入口",
    category: "layout",
    color: "#83e7ff",
    properties: {
      w: numberProperty("入口宽度", 80, 20, 800),
      h: numberProperty("入口高度", 120, 20, 800),
      spawnOffsetX: numberProperty("出生点 X 偏移", 45, -1000, 1000),
      spawnOffsetY: numberProperty("出生点 Y 偏移", 60, -1000, 1000),
      facing: selectProperty("进入后朝向", "right", [["left", "向左"], ["right", "向右"]]),
      sourceRoomId: textProperty("来源房间 ID", "")
    }
  },
  roomExit: {
    label: "房间出口",
    category: "layout",
    color: "#ffd982",
    properties: {
      w: numberProperty("出口宽度", 80, 20, 800),
      h: numberProperty("出口高度", 120, 20, 800),
      targetRoomId: textProperty("目标房间 ID", ""),
      targetEntranceId: textProperty("目标入口 ID", "entry-main"),
      direction: selectProperty("移动方向", "right", [["left", "向左"], ["right", "向右"], ["up", "向上"], ["down", "向下"]]),
      exitKind: selectProperty("出口类型", "main", [["main", "主路线"], ["optional", "可选路线"], ["hidden", "隐藏路线"], ["return", "回访路线"]]),
      requiredAbility: textProperty("所需能力 ID", ""),
      oneWay: booleanProperty("单向出口", false)
    }
  },
  boundaryWall: {
    label: "空气墙",
    category: "layout",
    color: "#ff9bea",
    properties: {
      w: numberProperty("宽度", 40, 4, 4000),
      h: numberProperty("高度", 720, 4, 4000),
      blockingSide: selectProperty("生效面", "all", [
        ["all", "全部面"],
        ["left", "左侧面 · 角色留在左侧"],
        ["right", "右侧面 · 角色留在右侧"],
        ["top", "上侧面 · 角色留在上侧"],
        ["bottom", "下侧面 · 角色留在下侧"]
      ]),
      grapple: booleanProperty("允许绳索 / 硬杆连接", false)
    }
  },
  platform: {
    label: "平台",
    category: "terrain",
    color: "#66d8cf",
    properties: {
      w: numberProperty("宽度", 240, 20, 3000),
      h: numberProperty("高度", 80, 20, 1200)
    }
  },
  slope: {
    label: "斜面",
    category: "terrain",
    color: "#79d7ff",
    properties: {
      dx: numberProperty("终点 X 偏移", 220, -2000, 2000),
      dy: numberProperty("终点 Y 偏移", -80, -2000, 2000),
      thickness: numberProperty("厚度", 14, 2, 120),
      grapple: booleanProperty("可连接绳索", true)
    }
  },
  hazard: {
    label: "伤害区",
    category: "danger",
    color: "#ff6486",
    properties: {
      w: numberProperty("宽度", 180, 20, 2000),
      h: numberProperty("高度", 70, 20, 1000),
      damage: numberProperty("伤害", 1, 0.1, 20, 0.1),
      direction: selectProperty("尖刺方向", "up", [
        ["up", "向上"], ["down", "向下"], ["left", "向左"], ["right", "向右"]
      ])
    }
  },
  windZone: {
    label: "风场",
    category: "danger",
    color: "#72cfff",
    properties: {
      w: numberProperty("宽度", 220, 20, 2000),
      h: numberProperty("高度", 320, 20, 2000),
      forceX: numberProperty("水平风力", 0, -2000, 2000, 10),
      forceY: numberProperty("垂直风力", -520, -2000, 2000, 10)
    }
  },
  liquidZone: {
    label: "液体区域",
    category: "danger",
    color: "#4c9ed9",
    properties: {
      w: numberProperty("宽度", 320, 20, 3000),
      h: numberProperty("高度", 220, 20, 2000),
      liquidType: selectProperty("液体类型", "water", [["water", "水"], ["toxic", "危险液体"], ["lava", "熔岩"]]),
      gravityScale: numberProperty("重力倍率", 0.24, 0, 2, 0.05),
      drag: numberProperty("阻力", 2.4, 0, 20, 0.1),
      currentX: numberProperty("水平水流", 0, -2000, 2000, 10),
      currentY: numberProperty("垂直水流", 0, -2000, 2000, 10),
      swimAcceleration: numberProperty("游动加速度", 680, 0, 3000, 10),
      contactDamage: numberProperty("接触伤害", 0, 0, 20, 0.5)
    }
  },
  darknessZone: {
    label: "黑暗区域",
    category: "danger",
    color: "#59617e",
    properties: {
      w: numberProperty("宽度", 520, 20, 4000),
      h: numberProperty("高度", 420, 20, 3000),
      opacity: numberProperty("黑暗强度", 0.78, 0, 1, 0.05),
      revealRadius: numberProperty("玩家照明半径", 170, 20, 1000),
      clearedByFlag: textProperty("解除黑暗的世界标记", "")
    }
  },
  rotationTrigger: {
    label: "旋转触发区",
    category: "danger",
    color: "#df9cff",
    properties: {
      w: numberProperty("宽度", 120, 20, 2000),
      h: numberProperty("高度", 120, 20, 2000),
      deltaDegrees: numberProperty("旋转角度", 90, -360, 360, 15)
    }
  },
  anchor: {
    label: "绳索锚点",
    category: "interaction",
    color: "#64efe3",
    properties: {
      anchorType: selectProperty("锚点模式", "rope", [["rope", "软绳"], ["both", "软绳与硬杆"]])
    }
  },
  bashTarget: {
    label: "猛击支点",
    category: "interaction",
    color: "#ce8dff",
    properties: {}
  },
  energyOrb: {
    label: "能量球",
    category: "interaction",
    color: "#70bfff",
    properties: { amount: numberProperty("恢复量", 1, 0.1, 20, 0.1) }
  },
  dashRefill: {
    label: "冲刺补充",
    category: "interaction",
    color: "#8ee7ff",
    properties: {
      radius: numberProperty("触发半径", 20, 8, 120),
      charges: numberProperty("补充冲刺数", 1, 1, 3),
      restoreMode: selectProperty("恢复方式", "fill", [["fill", "补满"], ["add", "增加指定次数"]]),
      oneUse: booleanProperty("单次使用", false),
      respawnSeconds: numberProperty("重生秒数", 2.5, 0.1, 60, 0.1),
      resetOnDeath: booleanProperty("死亡时重置", true)
    }
  },
  movingObject: {
    label: "路径移动物件",
    category: "terrain",
    color: "#f6b66f",
    properties: {
      objectKind: selectProperty("物件类型", "platform", [
        ["platform", "移动平台"], ["hazard", "移动危险物"],
        ["anchor", "移动锚点"], ["bashTarget", "移动猛击支点"]
      ]),
      w: numberProperty("宽度", 180, 16, 1600),
      h: numberProperty("高度", 28, 12, 1000),
      damage: numberProperty("危险伤害", 1, 0.1, 20, 0.1),
      direction: selectProperty("危险方向", "up", [["up", "向上"], ["down", "向下"], ["left", "向左"], ["right", "向右"]]),
      anchorType: selectProperty("锚点模式", "both", [["rope", "软绳"], ["both", "软绳与硬杆"]]),
      pathPoints: textProperty("相对路径点", "0,0;320,0"),
      speed: numberProperty("最高速度", 160, 1, 3000),
      acceleration: numberProperty("加速度", 900, 0, 10000),
      dwellSeconds: numberProperty("节点停留秒数", 0.2, 0, 30, 0.05),
      easing: selectProperty("缓动", "smoothstep", [["linear", "线性"], ["smoothstep", "平滑"], ["ease-in-out", "三次缓入缓出"]]),
      loopMode: selectProperty("循环模式", "pingpong", [["loop", "循环"], ["pingpong", "往返"], ["once", "单次"]]),
      trigger: selectProperty("触发方式", "auto", [["auto", "自动"], ["touch", "接触"], ["switch", "外部开关"]]),
      offscreenPolicy: selectProperty("屏幕外策略", "simulate", [["simulate", "继续模拟"], ["pause", "暂停"], ["reset", "复位"]]),
      resetPolicy: selectProperty("重置策略", "death", [["death", "死亡重置"], ["room", "切房重置"], ["persistent", "保持状态"]]),
      grapple: booleanProperty("平台表面可抓取", true)
    }
  },
  launcher: {
    label: "发射器",
    category: "interaction",
    color: "#ffb85f",
    properties: {
      w: numberProperty("宽度", 70, 20, 800),
      h: numberProperty("高度", 28, 16, 500),
      launchX: numberProperty("水平发射速度", 0, -3000, 3000, 10),
      launchY: numberProperty("垂直发射速度", -900, -3000, 3000, 10),
      cooldownSeconds: numberProperty("冷却秒数", 0.35, 0.05, 10, 0.05),
      preserveMomentum: booleanProperty("叠加原有动量", false)
    }
  },
  fragilePlatform: {
    label: "碎裂平台",
    category: "terrain",
    color: "#f6cc7b",
    properties: {
      w: numberProperty("宽度", 180, 20, 1600),
      h: numberProperty("高度", 28, 16, 500),
      breakDelaySeconds: numberProperty("破裂延迟", 0.35, 0, 10, 0.05),
      respawnSeconds: numberProperty("重生秒数", 2.2, 0.1, 60, 0.1),
      fallSpeed: numberProperty("初始下落速度", 80, 0, 3000, 10),
      oneUse: booleanProperty("单次使用", false),
      resetOnDeath: booleanProperty("死亡时重置", true),
      grapple: booleanProperty("表面可抓取", true)
    }
  },
  gate: {
    label: "能力 / 状态门",
    category: "interaction",
    color: "#d7a4ff",
    properties: {
      w: numberProperty("宽度", 70, 20, 1000),
      h: numberProperty("高度", 240, 20, 1400),
      requiredAbility: textProperty("所需能力 ID", ""),
      requiredFlag: textProperty("所需世界标记", ""),
      openWhen: selectProperty("多条件规则", "any", [["any", "任一满足"], ["all", "全部满足"]]),
      initiallyOpen: booleanProperty("初始开启", false),
      latchOpen: booleanProperty("开启后保持", true),
      resetOnDeath: booleanProperty("死亡时复位", false)
    }
  },
  stateTrigger: {
    label: "世界状态触发区",
    category: "interaction",
    color: "#b99cff",
    properties: {
      w: numberProperty("宽度", 100, 20, 1600),
      h: numberProperty("高度", 120, 20, 1400),
      setFlag: textProperty("设置世界标记", "route-open"),
      clearFlag: textProperty("清除世界标记", ""),
      oneUse: booleanProperty("单次触发", true),
      resetOnDeath: booleanProperty("死亡时复位", false)
    }
  },
  abilityPickup: {
    label: "能力拾取",
    category: "interaction",
    color: "#f3a5ff",
    properties: {
      abilityId: selectProperty("能力", "doubleJump", [
        ["rope", "软绳"], ["hardBar", "硬杆"], ["bash", "猛击"],
        ["doubleJump", "二段跳"], ["glide", "滑翔"], ["dash", "冲刺"], ["wallGrab", "墙抓"]
      ]),
      source: textProperty("来源标记", "level-editor")
    }
  },
  sign: {
    label: "提示牌",
    category: "guidance",
    color: "#f2e4b8",
    properties: { text: textProperty("提示文字", "在这里输入提示") }
  },
  backgroundSeed: {
    label: "背景光晕",
    category: "guidance",
    color: "#2f8e9d",
    properties: { size: numberProperty("尺寸", 150, 20, 800) }
  }
});

export const LEVEL_DOCUMENT_VERSION = 2;

const COLLECTION_BY_TYPE = Object.freeze({
  boundaryWall: "boundaryWalls",
  platform: "platforms",
  slope: "slopes",
  hazard: "hazards",
  anchor: "anchors",
  energyOrb: "energyOrbs",
  dashRefill: "dashRefills",
  movingObject: "movingObjects",
  launcher: "launchers",
  fragilePlatform: "fragilePlatforms",
  gate: "gates",
  stateTrigger: "stateTriggers",
  abilityPickup: "abilityPickups",
  bashTarget: "bashTargets",
  windZone: "windZones",
  liquidZone: "liquidZones",
  darknessZone: "darknessZones",
  checkpoint: "checkpoints",
  roomEntrance: "roomEntrances",
  roomExit: "roomExits",
  rotationTrigger: "rotationTriggers",
  sign: "signs",
  backgroundSeed: "backgroundSeeds"
});

const TYPE_BY_COLLECTION = new Map(Object.entries(COLLECTION_BY_TYPE).map(([type, collection]) => [collection, type]));
const LEVEL_COLLECTIONS = [...new Set(Object.values(COLLECTION_BY_TYPE))];

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slug(value) {
  return String(value || "level")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "level";
}

export function createObjectId(type, objects = []) {
  const used = new Set(objects.map((object) => object.id));
  let index = 1;
  let candidate = `${type}-${index}`;
  while (used.has(candidate)) candidate = `${type}-${++index}`;
  return candidate;
}

export function createLevelObject(type, x, y, objects = [], overrides = {}) {
  const definition = LEVEL_OBJECT_LIBRARY[type];
  if (!definition) throw new Error(`Unknown level object type: ${type}`);
  const properties = Object.fromEntries(Object.entries(definition.properties)
    .map(([key, property]) => [key, property.default]));
  const overrideProperties = overrides.properties || {};
  const visual = createVisualConfig({
    assetId: getTypeDefaultAssetId(type),
    ...(overrideProperties.visual || {})
  });
  return {
    id: overrides.id || createObjectId(type, objects),
    type,
    position: { x: Math.round(x), y: Math.round(y) },
    properties: { ...properties, ...overrideProperties, visual }
  };
}

export function createBlankLevelDocument(name = "未命名关卡") {
  const objects = [];
  objects.push(createLevelObject("platform", -260, 640, objects, { properties: { w: 760, h: 180 } }));
  objects.push(createLevelObject("spawn", 120, 590, objects));
  objects.push(createLevelObject("checkpoint", 75, 550, objects));
  objects.push(createLevelObject("goal", 420, 585, objects));
  return {
    schemaVersion: LEVEL_DOCUMENT_VERSION,
    metadata: {
      id: `custom-${slug(name)}`,
      name,
      category: "自定义关卡",
      summary: "使用关卡工坊创建的关卡。"
    },
    bounds: { x: -500, y: -450, w: 2800, h: 1700 },
    dashCapacity: 1,
    startingAbilities: [...LEVEL_SUPPORT_ABILITY_IDS],
    scene: createDefaultScene(),
    objects
  };
}

function readObjectProperties(type, item) {
  switch (type) {
    case "boundaryWall": return { w: item.w, h: item.h, blockingSide: item.blockingSide || "all", grapple: Boolean(item.grapple) };
    case "platform": return { w: item.w, h: item.h };
    case "slope": return { dx: item.bx - item.ax, dy: item.by - item.ay, thickness: item.thickness, grapple: Boolean(item.grapple) };
    case "hazard": return { w: item.w, h: item.h, damage: item.damage ?? 1, direction: item.direction || "up" };
    case "anchor": return { anchorType: item.type || "rope" };
    case "energyOrb": return { amount: item.amount ?? 1 };
    case "dashRefill": return {
      radius: item.radius ?? 20,
      charges: item.charges ?? 1,
      restoreMode: item.restoreMode || "fill",
      oneUse: Boolean(item.oneUse),
      respawnSeconds: item.respawnSeconds ?? 2.5,
      resetOnDeath: item.resetOnDeath !== false
    };
    case "movingObject": return {
      objectKind: item.objectKind,
      w: item.w,
      h: item.h,
      damage: item.damage ?? 1,
      direction: item.direction || "up",
      anchorType: item.anchorType || "both",
      pathPoints: formatMotionPath(item.pathOffsets || item.path.map((point) => ({ x: point.x - item.originX, y: point.y - item.originY }))),
      speed: item.speed,
      acceleration: item.acceleration,
      dwellSeconds: item.dwellSeconds,
      easing: item.easing,
      loopMode: item.loopMode,
      trigger: item.trigger,
      offscreenPolicy: item.offscreenPolicy,
      resetPolicy: item.resetPolicy,
      grapple: Boolean(item.grapple)
    };
    case "launcher": return {
      w: item.w,
      h: item.h,
      launchX: item.launchX,
      launchY: item.launchY,
      cooldownSeconds: item.cooldownSeconds,
      preserveMomentum: Boolean(item.preserveMomentum)
    };
    case "fragilePlatform": return {
      w: item.w,
      h: item.h,
      breakDelaySeconds: item.breakDelaySeconds,
      respawnSeconds: item.respawnSeconds,
      fallSpeed: item.fallSpeed,
      oneUse: Boolean(item.oneUse),
      resetOnDeath: item.resetOnDeath !== false,
      grapple: item.grapple !== false
    };
    case "gate": return {
      w: item.w,
      h: item.h,
      requiredAbility: item.requiredAbility || "",
      requiredFlag: item.requiredFlag || "",
      openWhen: item.openWhen || "any",
      initiallyOpen: Boolean(item.initiallyOpen),
      latchOpen: item.latchOpen !== false,
      resetOnDeath: Boolean(item.resetOnDeath)
    };
    case "stateTrigger": return {
      w: item.w,
      h: item.h,
      setFlag: item.setFlag || "",
      clearFlag: item.clearFlag || "",
      oneUse: item.oneUse !== false,
      resetOnDeath: Boolean(item.resetOnDeath)
    };
    case "abilityPickup": return { abilityId: item.abilityId, source: item.source || "level-editor" };
    case "windZone": return { w: item.w, h: item.h, forceX: item.forceX, forceY: item.forceY };
    case "liquidZone": return { w: item.w, h: item.h, liquidType: item.liquidType, gravityScale: item.gravityScale, drag: item.drag, currentX: item.currentX, currentY: item.currentY, swimAcceleration: item.swimAcceleration, contactDamage: item.contactDamage };
    case "darknessZone": return { w: item.w, h: item.h, opacity: item.opacity, revealRadius: item.revealRadius, clearedByFlag: item.clearedByFlag || "" };
    case "checkpoint": return {
      w: item.w,
      h: item.h,
      spawnOffsetX: item.spawn.x - item.x,
      spawnOffsetY: item.spawn.y - item.y
    };
    case "roomEntrance": return {
      w: item.w,
      h: item.h,
      spawnOffsetX: item.spawn.x - item.x,
      spawnOffsetY: item.spawn.y - item.y,
      facing: item.facing || "right",
      sourceRoomId: item.sourceRoomId || ""
    };
    case "roomExit": return {
      w: item.w,
      h: item.h,
      targetRoomId: item.targetRoomId || "",
      targetEntranceId: item.targetEntranceId || "entry-main",
      direction: item.direction || "right",
      exitKind: item.exitKind || "main",
      requiredAbility: item.requiredAbility || "",
      oneWay: Boolean(item.oneWay)
    };
    case "rotationTrigger": return { w: item.w, h: item.h, deltaDegrees: item.delta * 180 / Math.PI };
    case "sign": return { text: item.text || "" };
    case "backgroundSeed": return { size: item.size };
    default: return {};
  }
}

function runtimeObjectId(level, type, index, fallbackId, objects) {
  return fallbackId
    || level.visualOrder?.[type]?.[index]
    || createObjectId(type, objects);
}

function runtimeObjectVisual(level, type, objectId) {
  return createVisualConfig({
    assetId: getTypeDefaultAssetId(type),
    ...(level.visuals?.[objectId] || {})
  });
}

export function levelToDocument(level) {
  const objects = [];
  for (const collection of LEVEL_COLLECTIONS) {
    const type = TYPE_BY_COLLECTION.get(collection);
    for (const [index, item] of (level[collection] || []).entries()) {
      const x = type === "slope" ? item.ax : item.x;
      const y = type === "slope" ? item.ay : item.y;
      const id = runtimeObjectId(level, type, index, item.id, objects);
      objects.push(createLevelObject(type, x, y, objects, {
        id,
        properties: {
          ...readObjectProperties(type, item),
          visual: runtimeObjectVisual(level, type, id)
        }
      }));
    }
  }
  if (level.spawn) {
    const id = level.visualOrder?.spawn?.[0] || "spawn";
    objects.push(createLevelObject("spawn", level.spawn.x, level.spawn.y, objects, {
      id,
      properties: { visual: runtimeObjectVisual(level, "spawn", id) }
    }));
  }
  if (level.goal) {
    const id = runtimeObjectId(level, "goal", 0, level.goal.id, objects);
    objects.push(createLevelObject("goal", level.goal.x, level.goal.y, objects, {
      id,
      properties: {
        radius: level.goal.radius,
        visual: runtimeObjectVisual(level, "goal", id)
      }
    }));
  }
  return {
    schemaVersion: LEVEL_DOCUMENT_VERSION,
    metadata: {
      id: level.id,
      name: level.name,
      category: level.category || "自定义关卡",
      summary: level.summary || "",
      ...(level.acceptanceLevel ? { acceptanceLevel: level.acceptanceLevel } : {}),
      ...(level.documentMode ? { mode: level.documentMode } : {})
    },
    bounds: clone(level.bounds),
    dashCapacity: level.dashCapacity ?? 1,
    startingAbilities: normalizeStartingAbilities(level.startingAbilities),
    ...(level.reference ? { reference: clone(level.reference) } : {}),
    ...(level.statePolicy ? { statePolicy: clone(level.statePolicy) } : {}),
    scene: level.scene ? clone(level.scene) : createDefaultScene(),
    objects
  };
}

function compileObject(object) {
  const { x, y } = object.position;
  const p = object.properties || {};
  switch (object.type) {
    case "boundaryWall": return { id: object.id, x, y, w: p.w, h: p.h, blockingSide: p.blockingSide, grapple: Boolean(p.grapple) };
    case "platform": return { id: object.id, x, y, w: p.w, h: p.h };
    case "slope": return { id: object.id, ax: x, ay: y, bx: x + p.dx, by: y + p.dy, thickness: p.thickness, grapple: Boolean(p.grapple) };
    case "hazard": return { id: object.id, x, y, w: p.w, h: p.h, damage: p.damage, ...(p.direction === "up" ? {} : { direction: p.direction }) };
    case "anchor": return { id: object.id, x, y, type: p.anchorType };
    case "energyOrb": return { id: object.id, x, y, amount: p.amount };
    case "dashRefill": return {
      id: object.id,
      x,
      y,
      radius: p.radius,
      charges: p.charges,
      restoreMode: p.restoreMode,
      oneUse: Boolean(p.oneUse),
      respawnSeconds: p.respawnSeconds,
      resetOnDeath: Boolean(p.resetOnDeath)
    };
    case "movingObject": {
      const pathOffsets = parseMotionPath(p.pathPoints);
      return {
        id: object.id,
        objectKind: p.objectKind,
        originX: x,
        originY: y,
        x,
        y,
        w: p.w,
        h: p.h,
        damage: p.damage,
        direction: p.direction,
        anchorType: p.anchorType,
        pathOffsets,
        path: pathOffsets.map((point) => ({ x: x + point.x, y: y + point.y })),
        speed: p.speed,
        acceleration: p.acceleration,
        dwellSeconds: p.dwellSeconds,
        easing: p.easing,
        loopMode: p.loopMode,
        trigger: p.trigger,
        offscreenPolicy: p.offscreenPolicy,
        resetPolicy: p.resetPolicy,
        grapple: Boolean(p.grapple)
      };
    }
    case "launcher": return { id: object.id, x, y, w: p.w, h: p.h, launchX: p.launchX, launchY: p.launchY, cooldownSeconds: p.cooldownSeconds, preserveMomentum: Boolean(p.preserveMomentum) };
    case "fragilePlatform": return { id: object.id, x, y, w: p.w, h: p.h, breakDelaySeconds: p.breakDelaySeconds, respawnSeconds: p.respawnSeconds, fallSpeed: p.fallSpeed, oneUse: Boolean(p.oneUse), resetOnDeath: Boolean(p.resetOnDeath), grapple: Boolean(p.grapple) };
    case "gate": return { id: object.id, x, y, w: p.w, h: p.h, requiredAbility: p.requiredAbility, requiredFlag: p.requiredFlag, openWhen: p.openWhen, initiallyOpen: Boolean(p.initiallyOpen), latchOpen: Boolean(p.latchOpen), resetOnDeath: Boolean(p.resetOnDeath) };
    case "stateTrigger": return { id: object.id, x, y, w: p.w, h: p.h, setFlag: p.setFlag, clearFlag: p.clearFlag, oneUse: Boolean(p.oneUse), resetOnDeath: Boolean(p.resetOnDeath) };
    case "abilityPickup": return { id: object.id, x, y, abilityId: p.abilityId, source: p.source };
    case "bashTarget": return { id: object.id, x, y };
    case "windZone": return { id: object.id, x, y, w: p.w, h: p.h, forceX: p.forceX, forceY: p.forceY };
    case "liquidZone": return { id: object.id, x, y, w: p.w, h: p.h, liquidType: p.liquidType, gravityScale: p.gravityScale, drag: p.drag, currentX: p.currentX, currentY: p.currentY, swimAcceleration: p.swimAcceleration, contactDamage: p.contactDamage };
    case "darknessZone": return { id: object.id, x, y, w: p.w, h: p.h, opacity: p.opacity, revealRadius: p.revealRadius, clearedByFlag: p.clearedByFlag };
    case "checkpoint": return { id: object.id, x, y, w: p.w, h: p.h, spawn: { x: x + p.spawnOffsetX, y: y + p.spawnOffsetY } };
    case "roomEntrance": return {
      id: object.id,
      x,
      y,
      w: p.w,
      h: p.h,
      spawn: { x: x + p.spawnOffsetX, y: y + p.spawnOffsetY },
      facing: p.facing,
      sourceRoomId: p.sourceRoomId
    };
    case "roomExit": return {
      id: object.id,
      x,
      y,
      w: p.w,
      h: p.h,
      targetRoomId: p.targetRoomId,
      targetEntranceId: p.targetEntranceId,
      direction: p.direction,
      exitKind: p.exitKind,
      requiredAbility: p.requiredAbility,
      oneWay: Boolean(p.oneWay)
    };
    case "rotationTrigger": return { id: object.id, x, y, w: p.w, h: p.h, delta: p.deltaDegrees * Math.PI / 180 };
    case "sign": return { id: object.id, x, y, text: p.text };
    case "backgroundSeed": return { x, y, size: p.size };
    default: return null;
  }
}

export function migrateLevelDocument(document) {
  if (!isRecord(document)) throw new Error("Document must be an object");
  if (![1, LEVEL_DOCUMENT_VERSION].includes(document.schemaVersion)) {
    throw new Error(`Unsupported schema version: ${document.schemaVersion}`);
  }
  const migrated = clone(document);
  if (document.schemaVersion === 1) {
    migrated.schemaVersion = LEVEL_DOCUMENT_VERSION;
    migrated.scene = migrated.scene ? clone(migrated.scene) : createDefaultScene();
  }
  if (Array.isArray(migrated.objects)) migrated.objects = migrated.objects.map((object) => {
    if (!isRecord(object)) return object;
    const properties = isRecord(object.properties) ? object.properties : {};
    if (document.schemaVersion === LEVEL_DOCUMENT_VERSION && !isRecord(properties.visual)) return object;
    return {
      ...object,
      properties: {
        ...properties,
        visual: createVisualConfig({
          assetId: getTypeDefaultAssetId(object.type),
          ...(isRecord(properties.visual) ? properties.visual : {})
        })
      }
    };
  });
  if (migrated.startingAbilities === undefined) {
    migrated.startingAbilities = normalizeStartingAbilities(undefined);
  }
  return migrated;
}

function validateVersionTwoDocument(document) {
  const errors = [];
  if (!document || typeof document !== "object") return ["Document must be an object"];
  if (document.schemaVersion !== LEVEL_DOCUMENT_VERSION) errors.push(`Unsupported schema version: ${document.schemaVersion}`);
  if (!document.metadata?.id) errors.push("Document metadata must define an id");
  if (!document.metadata?.name) errors.push("Document metadata must define a name");
  if (document.metadata?.mode && !["standalone", "reference-room"].includes(document.metadata.mode)) {
    errors.push(`Unsupported document mode: ${document.metadata.mode}`);
  }
  if (!document.bounds || document.bounds.w <= 0 || document.bounds.h <= 0) errors.push("Document bounds must be positive");
  if (document.dashCapacity !== undefined && (!Number.isInteger(document.dashCapacity) || document.dashCapacity < 1 || document.dashCapacity > 3)) {
    errors.push("Document dashCapacity must be an integer from 1 to 3");
  }
  errors.push(...validateStartingAbilities(document.startingAbilities, { path: "Document startingAbilities" }));
  errors.push(...validateScene(document.scene));
  if (!Array.isArray(document.objects)) errors.push("Document must contain an objects array");
  const objects = Array.isArray(document.objects) ? document.objects : [];
  const ids = new Set();
  for (const [objectIndex, object] of objects.entries()) {
    if (!isRecord(object)) {
      errors.push(`objects[${objectIndex}] must be an object`);
      continue;
    }
    const definition = LEVEL_OBJECT_LIBRARY[object.type];
    if (!definition) errors.push(`Unknown object type: ${object.type}`);
    if (!object.id) errors.push("Every object must have an id");
    if (ids.has(object.id)) errors.push(`Duplicate object id: ${object.id}`);
    ids.add(object.id);
    if (!Number.isFinite(object.position?.x) || !Number.isFinite(object.position?.y)) errors.push(`${object.id || object.type} must have a finite position`);
    if (!isRecord(object.properties)) errors.push(`${object.id || object.type}.properties must be an object`);
    errors.push(...validateVisualConfig(object.properties?.visual, { path: `${object.id || object.type}.visual` }));
    for (const [key, property] of Object.entries(definition?.properties || {})) {
      const value = object.properties?.[key];
      if (property.kind === "number" && (!Number.isFinite(value) || value < property.min || value > property.max)) {
        errors.push(`${object.id || object.type}.${key} must be a number from ${property.min} to ${property.max}`);
      } else if (property.kind === "select" && !property.options.some(([option]) => option === value)) {
        errors.push(`${object.id || object.type}.${key} has an unsupported value`);
      } else if (property.kind === "text" && typeof value !== "string") {
        errors.push(`${object.id || object.type}.${key} must be text`);
      } else if (property.kind === "boolean" && typeof value !== "boolean") {
        errors.push(`${object.id || object.type}.${key} must be true or false`);
      }
    }
  }
  for (const [type, definition] of Object.entries(LEVEL_OBJECT_LIBRARY).filter(([, item]) => item.unique)) {
    const count = objects.filter((object) => isRecord(object) && object.type === type).length;
    if (type === "goal" && document.metadata?.mode === "reference-room") {
      if (count > 1) errors.push("Reference room document may contain at most one goal object");
    } else if (definition.unique && count !== 1) {
      errors.push(`Document must contain exactly one ${type} object`);
    }
  }
  for (const object of objects) {
    if (!isRecord(object)) continue;
    if (object.type === "roomExit" && !object.properties?.targetRoomId) {
      errors.push(`${object.id || "roomExit"}.targetRoomId must not be empty`);
    }
    if (object.type === "roomExit" && !object.properties?.targetEntranceId) {
      errors.push(`${object.id || "roomExit"}.targetEntranceId must not be empty`);
    }
    if (object.type === "movingObject") {
      const pathOffsets = parseMotionPath(object.properties?.pathPoints);
      errors.push(...validateMotionDefinition({
        id: object.id,
        path: pathOffsets.map((point) => ({ x: object.position.x + point.x, y: object.position.y + point.y })),
        speed: object.properties.speed,
        acceleration: object.properties.acceleration,
        dwellSeconds: object.properties.dwellSeconds,
        loopMode: object.properties.loopMode,
        easing: object.properties.easing,
        trigger: object.properties.trigger,
        offscreenPolicy: object.properties.offscreenPolicy,
        resetPolicy: object.properties.resetPolicy
      }));
    }
    if (object.type === "gate" && object.properties?.requiredAbility && !["rope", "hardBar", "wallGrab", "doubleJump", "glide", "bash", "dash"].includes(object.properties.requiredAbility)) {
      errors.push(`${object.id || "gate"}.requiredAbility is unknown`);
    }
    if (object.type === "gate" && !object.properties?.initiallyOpen && !object.properties?.requiredAbility && !object.properties?.requiredFlag) {
      errors.push(`${object.id || "gate"} must define an unlock condition or start open`);
    }
  }
  return errors;
}

export function validateLevelDocument(document) {
  try {
    return validateVersionTwoDocument(migrateLevelDocument(document));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export function compileLevelDocument(document) {
  const migrated = migrateLevelDocument(document);
  const documentErrors = validateVersionTwoDocument(migrated);
  if (documentErrors.length) throw new Error(documentErrors.join("\n"));
  document = migrated;
  const level = {
    id: document.metadata.id,
    name: document.metadata.name,
    category: document.metadata.category || "自定义关卡",
    summary: document.metadata.summary || "",
    documentMode: document.metadata.mode || "standalone",
    ...(document.metadata.acceptanceLevel ? { acceptanceLevel: document.metadata.acceptanceLevel } : {}),
    startingAbilities: normalizeStartingAbilities(document.startingAbilities, { fallback: [] }),
    dashCapacity: document.dashCapacity ?? 1,
    bounds: clone(document.bounds),
    scene: clone(document.scene),
    visuals: {},
    visualOrder: {},
    backgroundSeeds: [],
    boundaryWalls: [],
    platforms: [],
    slopes: [],
    hazards: [],
    anchors: [],
    energyOrbs: [],
    dashRefills: [],
    movingObjects: [],
    launchers: [],
    fragilePlatforms: [],
    gates: [],
    stateTriggers: [],
    abilityPickups: [],
    bashTargets: [],
    windZones: [],
    liquidZones: [],
    darknessZones: [],
    checkpoints: [],
    roomEntrances: [],
    roomExits: [],
    rotationTriggers: [],
    signs: [],
    ...(document.reference ? { reference: clone(document.reference) } : {}),
    ...(document.statePolicy ? { statePolicy: clone(document.statePolicy) } : {})
  };
  for (const object of document.objects) {
    level.visuals[object.id] = clone(object.properties.visual);
    if (!level.visualOrder[object.type]) level.visualOrder[object.type] = [];
    level.visualOrder[object.type].push(object.id);
    if (object.type === "spawn") {
      level.spawn = clone(object.position);
    } else if (object.type === "goal") {
      level.goal = { id: object.id, ...clone(object.position), radius: object.properties.radius };
    } else {
      const collection = COLLECTION_BY_TYPE[object.type];
      level[collection].push(compileObject(object));
    }
  }
  return level;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed || "cablester")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function generateLevelDocument({ seed = "cablester", length = 7, difficulty = 2 } = {}) {
  const random = seededRandom(seed);
  const segmentCount = Math.max(4, Math.min(16, Math.round(length)));
  const challenge = Math.max(1, Math.min(3, Math.round(difficulty)));
  const document = createBlankLevelDocument(`生成关卡 · ${seed}`);
  document.metadata.id = `generated-${slug(seed)}-${segmentCount}-${challenge}`;
  document.metadata.summary = `种子 ${seed} · ${segmentCount} 段 · 难度 ${challenge}`;
  document.objects = [];
  const add = (type, x, y, properties = {}) => {
    const object = createLevelObject(type, x, y, document.objects, { properties });
    document.objects.push(object);
    return object;
  };

  add("platform", -320, 640, { w: 720, h: 180 });
  add("spawn", 100, 590);
  add("checkpoint", 55, 550);
  add("sign", 190, 585, { text: `自动生成 · ${seed}` });

  let x = 400;
  let previousY = 590;
  for (let index = 0; index < segmentCount; index += 1) {
    const gap = 125 + challenge * 35 + Math.round(random() * (45 + challenge * 24));
    const width = 160 + Math.round(random() * 150);
    const rise = Math.round((random() - 0.5) * (130 + challenge * 35));
    const topY = Math.max(300, Math.min(620, previousY + rise));
    const platformX = x + gap;
    add("hazard", x, 690, { w: gap, h: 100, damage: 1, direction: "up" });
    if (challenge >= 2 || random() > 0.45) {
      add("anchor", x + gap * 0.5, Math.min(previousY, topY) - 210 - Math.round(random() * 70), {
        anchorType: index % 3 === 1 ? "both" : "rope"
      });
    }
    if (challenge >= 3 && index % 4 === 2) add("bashTarget", x + gap * 0.55, Math.min(previousY, topY) - 70);
    add("energyOrb", x + gap * 0.55, Math.min(previousY, topY) - 125, { amount: 0.8 + challenge * 0.15 });
    add("platform", platformX, topY, { w: width, h: Math.max(80, 760 - topY) });
    if (index > 0 && index % 3 === 0) add("checkpoint", platformX + 24, topY - 90);
    if (challenge === 3 && index % 5 === 3) {
      add("windZone", platformX - gap, topY - 320, { w: gap + width * 0.5, h: 300, forceX: 120, forceY: -460 });
    }
    x = platformX + width;
    previousY = topY;
  }

  const goalX = x + 180;
  add("hazard", x, 690, { w: 180, h: 100, damage: 1, direction: "up" });
  add("platform", goalX, 560, { w: 620, h: 220 });
  add("goal", goalX + 350, 510, { radius: 36 });
  document.bounds = { x: -500, y: -500, w: goalX + 1400, h: 1900 };
  return document;
}

export function getLevelObjectBounds(object) {
  const { x, y } = object.position;
  const p = object.properties || {};
  if (["boundaryWall", "platform", "hazard", "windZone", "liquidZone", "darknessZone", "checkpoint", "roomEntrance", "roomExit", "rotationTrigger", "movingObject", "launcher", "fragilePlatform", "gate", "stateTrigger"].includes(object.type)) {
    return { x, y, w: p.w, h: p.h };
  }
  if (object.type === "slope") {
    const half = Math.max(8, p.thickness / 2);
    const minX = Math.min(x, x + p.dx) - half;
    const minY = Math.min(y, y + p.dy) - half;
    return { x: minX, y: minY, w: Math.abs(p.dx) + half * 2, h: Math.abs(p.dy) + half * 2 };
  }
  const radius = object.type === "backgroundSeed" ? p.size : ["goal", "dashRefill"].includes(object.type) ? p.radius : 22;
  return { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 };
}
