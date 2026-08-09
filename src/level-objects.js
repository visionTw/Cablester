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

export const LEVEL_DOCUMENT_VERSION = 1;

const COLLECTION_BY_TYPE = Object.freeze({
  platform: "platforms",
  slope: "slopes",
  hazard: "hazards",
  anchor: "anchors",
  energyOrb: "energyOrbs",
  abilityPickup: "abilityPickups",
  bashTarget: "bashTargets",
  windZone: "windZones",
  checkpoint: "checkpoints",
  rotationTrigger: "rotationTriggers",
  sign: "signs",
  backgroundSeed: "backgroundSeeds"
});

const TYPE_BY_COLLECTION = new Map(Object.entries(COLLECTION_BY_TYPE).map(([type, collection]) => [collection, type]));
const LEVEL_COLLECTIONS = [...new Set(Object.values(COLLECTION_BY_TYPE))];

function clone(value) {
  return structuredClone(value);
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
  return {
    id: overrides.id || createObjectId(type, objects),
    type,
    position: { x: Math.round(x), y: Math.round(y) },
    properties: { ...properties, ...(overrides.properties || {}) }
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
    startingAbilities: ["rope", "hardBar", "bash", "doubleJump", "glide", "dash", "wallGrab"],
    objects
  };
}

function readObjectProperties(type, item) {
  switch (type) {
    case "platform": return { w: item.w, h: item.h };
    case "slope": return { dx: item.bx - item.ax, dy: item.by - item.ay, thickness: item.thickness, grapple: Boolean(item.grapple) };
    case "hazard": return { w: item.w, h: item.h, damage: item.damage ?? 1, direction: item.direction || "up" };
    case "anchor": return { anchorType: item.type || "rope" };
    case "energyOrb": return { amount: item.amount ?? 1 };
    case "abilityPickup": return { abilityId: item.abilityId, source: item.source || "level-editor" };
    case "windZone": return { w: item.w, h: item.h, forceX: item.forceX, forceY: item.forceY };
    case "checkpoint": return {
      w: item.w,
      h: item.h,
      spawnOffsetX: item.spawn.x - item.x,
      spawnOffsetY: item.spawn.y - item.y
    };
    case "rotationTrigger": return { w: item.w, h: item.h, deltaDegrees: item.delta * 180 / Math.PI };
    case "sign": return { text: item.text || "" };
    case "backgroundSeed": return { size: item.size };
    default: return {};
  }
}

export function levelToDocument(level) {
  const objects = [];
  for (const collection of LEVEL_COLLECTIONS) {
    const type = TYPE_BY_COLLECTION.get(collection);
    for (const item of level[collection] || []) {
      const x = type === "slope" ? item.ax : item.x;
      const y = type === "slope" ? item.ay : item.y;
      objects.push(createLevelObject(type, x, y, objects, {
        id: item.id || createObjectId(type, objects),
        properties: readObjectProperties(type, item)
      }));
    }
  }
  if (level.spawn) objects.push(createLevelObject("spawn", level.spawn.x, level.spawn.y, objects, { id: "spawn" }));
  if (level.goal) objects.push(createLevelObject("goal", level.goal.x, level.goal.y, objects, {
    id: level.goal.id || "goal",
    properties: { radius: level.goal.radius }
  }));
  return {
    schemaVersion: LEVEL_DOCUMENT_VERSION,
    metadata: {
      id: level.id,
      name: level.name,
      category: level.category || "自定义关卡",
      summary: level.summary || "",
      ...(level.acceptanceLevel ? { acceptanceLevel: level.acceptanceLevel } : {})
    },
    bounds: clone(level.bounds),
    startingAbilities: [...(level.startingAbilities || [])],
    objects
  };
}

function compileObject(object) {
  const { x, y } = object.position;
  const p = object.properties || {};
  switch (object.type) {
    case "platform": return { id: object.id, x, y, w: p.w, h: p.h };
    case "slope": return { id: object.id, ax: x, ay: y, bx: x + p.dx, by: y + p.dy, thickness: p.thickness, grapple: Boolean(p.grapple) };
    case "hazard": return { id: object.id, x, y, w: p.w, h: p.h, damage: p.damage, ...(p.direction === "up" ? {} : { direction: p.direction }) };
    case "anchor": return { id: object.id, x, y, type: p.anchorType };
    case "energyOrb": return { id: object.id, x, y, amount: p.amount };
    case "abilityPickup": return { id: object.id, x, y, abilityId: p.abilityId, source: p.source };
    case "bashTarget": return { id: object.id, x, y };
    case "windZone": return { id: object.id, x, y, w: p.w, h: p.h, forceX: p.forceX, forceY: p.forceY };
    case "checkpoint": return { id: object.id, x, y, w: p.w, h: p.h, spawn: { x: x + p.spawnOffsetX, y: y + p.spawnOffsetY } };
    case "rotationTrigger": return { id: object.id, x, y, w: p.w, h: p.h, delta: p.deltaDegrees * Math.PI / 180 };
    case "sign": return { id: object.id, x, y, text: p.text };
    case "backgroundSeed": return { x, y, size: p.size };
    default: return null;
  }
}

export function validateLevelDocument(document) {
  const errors = [];
  if (!document || typeof document !== "object") return ["Document must be an object"];
  if (document.schemaVersion !== LEVEL_DOCUMENT_VERSION) errors.push(`Unsupported schema version: ${document.schemaVersion}`);
  if (!document.metadata?.id) errors.push("Document metadata must define an id");
  if (!document.metadata?.name) errors.push("Document metadata must define a name");
  if (!document.bounds || document.bounds.w <= 0 || document.bounds.h <= 0) errors.push("Document bounds must be positive");
  if (!Array.isArray(document.objects)) errors.push("Document must contain an objects array");
  const ids = new Set();
  for (const object of document.objects || []) {
    const definition = LEVEL_OBJECT_LIBRARY[object.type];
    if (!definition) errors.push(`Unknown object type: ${object.type}`);
    if (!object.id) errors.push("Every object must have an id");
    if (ids.has(object.id)) errors.push(`Duplicate object id: ${object.id}`);
    ids.add(object.id);
    if (!Number.isFinite(object.position?.x) || !Number.isFinite(object.position?.y)) errors.push(`${object.id || object.type} must have a finite position`);
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
    const count = (document.objects || []).filter((object) => object.type === type).length;
    if (definition.unique && count !== 1) errors.push(`Document must contain exactly one ${type} object`);
  }
  return errors;
}

export function compileLevelDocument(document) {
  const documentErrors = validateLevelDocument(document);
  if (documentErrors.length) throw new Error(documentErrors.join("\n"));
  const level = {
    id: document.metadata.id,
    name: document.metadata.name,
    category: document.metadata.category || "自定义关卡",
    summary: document.metadata.summary || "",
    ...(document.metadata.acceptanceLevel ? { acceptanceLevel: document.metadata.acceptanceLevel } : {}),
    startingAbilities: [...(document.startingAbilities || [])],
    bounds: clone(document.bounds),
    backgroundSeeds: [],
    platforms: [],
    slopes: [],
    hazards: [],
    anchors: [],
    energyOrbs: [],
    abilityPickups: [],
    bashTargets: [],
    windZones: [],
    checkpoints: [],
    rotationTriggers: [],
    signs: []
  };
  for (const object of document.objects) {
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
  if (["platform", "hazard", "windZone", "checkpoint", "rotationTrigger"].includes(object.type)) {
    return { x, y, w: p.w, h: p.h };
  }
  if (object.type === "slope") {
    const half = Math.max(8, p.thickness / 2);
    const minX = Math.min(x, x + p.dx) - half;
    const minY = Math.min(y, y + p.dy) - half;
    return { x: minX, y: minY, w: Math.abs(p.dx) + half * 2, h: Math.abs(p.dy) + half * 2 };
  }
  const radius = object.type === "backgroundSeed" ? p.size : object.type === "goal" ? p.radius : 22;
  return { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 };
}
