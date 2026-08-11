export const ASSET_REGISTRY_VERSION = 1;
export const BUILTIN_PROCEDURAL_ASSET_ID = "builtin:procedural";

export const BUILTIN_LEVEL_OBJECT_TYPES = Object.freeze([
  "spawn", "goal", "checkpoint", "roomEntrance", "roomExit",
  "platform", "slope", "hazard", "windZone", "liquidZone", "darknessZone", "rotationTrigger",
  "anchor", "bashTarget", "energyOrb", "dashRefill", "movingObject", "launcher", "fragilePlatform",
  "gate", "stateTrigger", "abilityPickup", "sign", "backgroundSeed"
]);

export const GAME_ASSET_IDS = Object.freeze({
  mossPlatform: "gameplay:moss-platform",
  thornHazard: "gameplay:thorn-hazard",
  ropeAnchor: "gameplay:rope-anchor",
  energyOrb: "gameplay:energy-orb",
  bashBlossom: "gameplay:bash-blossom",
  checkpointLantern: "gameplay:checkpoint-lantern",
  spawnGate: "gameplay:spawn-gate",
  goalGate: "gameplay:goal-gate"
});

export const SCENE_ASSET_IDS = Object.freeze({
  mossBush: "scene:moss-bush-cluster",
  luminousPlant: "scene:cyan-seed-plant",
  foregroundBranch: "scene:overhang-vine-branch",
  ancientTree: "scene:ancient-amber-tree",
  distantTrunks: "scene:distant-trunk-grove",
  midTreeCluster: "scene:mid-tree-cluster",
  mistBand: "scene:cyan-mist-band",
  lightMotes: "scene:forest-light-motes"
});

export const DEFAULT_TYPE_ASSET_IDS = Object.freeze(Object.fromEntries(
  BUILTIN_LEVEL_OBJECT_TYPES.map((objectType) => [objectType, ({
    platform: GAME_ASSET_IDS.mossPlatform,
    hazard: GAME_ASSET_IDS.thornHazard,
    anchor: GAME_ASSET_IDS.ropeAnchor,
    energyOrb: GAME_ASSET_IDS.energyOrb,
    dashRefill: GAME_ASSET_IDS.energyOrb,
    bashTarget: GAME_ASSET_IDS.bashBlossom,
    checkpoint: GAME_ASSET_IDS.checkpointLantern,
    spawn: GAME_ASSET_IDS.spawnGate,
    goal: GAME_ASSET_IDS.goalGate
  })[objectType] || BUILTIN_PROCEDURAL_ASSET_ID])
));

export const VISUAL_CONFIG_KEYS = Object.freeze([
  "assetId",
  "scaleX",
  "scaleY",
  "anchorX",
  "anchorY",
  "offsetX",
  "offsetY",
  "flipX",
  "flipY",
  "drawLayer",
  "opacity",
  "tint"
]);

export const DEFAULT_VISUAL_CONFIG = Object.freeze({
  assetId: BUILTIN_PROCEDURAL_ASSET_ID,
  scaleX: 1,
  scaleY: 1,
  anchorX: 0.5,
  anchorY: 0.5,
  offsetX: 0,
  offsetY: 0,
  flipX: false,
  flipY: false,
  drawLayer: 0,
  opacity: 1,
  tint: "#ffffff"
});

const ASSET_KEYS = Object.freeze([
  "id",
  "label",
  "description",
  "category",
  "kind",
  "path",
  "thumbnailPath",
  "applicableTypes",
  "tags",
  "prompt",
  "generationMethod",
  "width",
  "height",
  "fileSizeBytes",
  "license"
]);

const LICENSE_KEYS = Object.freeze(["name", "scope", "source"]);
const TINT_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function clone(value) {
  return structuredClone(value);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unexpectedKeys(value, allowedKeys, path) {
  if (!isRecord(value)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${path}.${key} is not supported`);
}

function finiteInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

export function validateVisualConfig(config, {
  path = "visual",
  registry = null,
  objectType = null,
  requireRegisteredAsset = false
} = {}) {
  if (!isRecord(config)) return [`${path} must be an object`];
  const errors = unexpectedKeys(config, VISUAL_CONFIG_KEYS, path);
  for (const key of VISUAL_CONFIG_KEYS) {
    if (!Object.hasOwn(config, key)) errors.push(`${path}.${key} is required`);
  }
  if (typeof config.assetId !== "string" || config.assetId.trim().length === 0 || config.assetId.length > 256) {
    errors.push(`${path}.assetId must be a non-empty string no longer than 256 characters`);
  }
  for (const key of ["scaleX", "scaleY"]) {
    if (!finiteInRange(config[key], 0.01, 16)) errors.push(`${path}.${key} must be a number from 0.01 to 16`);
  }
  for (const key of ["anchorX", "anchorY", "opacity"]) {
    if (!finiteInRange(config[key], 0, 1)) errors.push(`${path}.${key} must be a number from 0 to 1`);
  }
  for (const key of ["offsetX", "offsetY"]) {
    if (!finiteInRange(config[key], -100000, 100000)) errors.push(`${path}.${key} must be a number from -100000 to 100000`);
  }
  for (const key of ["flipX", "flipY"]) {
    if (typeof config[key] !== "boolean") errors.push(`${path}.${key} must be true or false`);
  }
  if (!Number.isInteger(config.drawLayer) || config.drawLayer < -1000 || config.drawLayer > 1000) {
    errors.push(`${path}.drawLayer must be an integer from -1000 to 1000`);
  }
  if (typeof config.tint !== "string" || !TINT_PATTERN.test(config.tint)) {
    errors.push(`${path}.tint must be a #rrggbb or #rrggbbaa color`);
  }
  if (registry && requireRegisteredAsset && typeof config.assetId === "string") {
    const asset = getAssetById(registry, config.assetId);
    if (!asset) errors.push(`${path}.assetId references a missing asset: ${config.assetId}`);
    else if (objectType && !isAssetApplicable(asset, objectType)) {
      errors.push(`${path}.assetId ${config.assetId} does not apply to ${objectType}`);
    }
  }
  return [...new Set(errors)];
}

export function createVisualConfig(overrides = {}) {
  if (!isRecord(overrides)) throw new Error("Visual overrides must be an object");
  const config = { ...DEFAULT_VISUAL_CONFIG, ...clone(overrides) };
  const errors = validateVisualConfig(config);
  if (errors.length) throw new Error(errors.join("\n"));
  return config;
}

function validateAsset(asset, index) {
  const path = `registry.assets[${index}]`;
  if (!isRecord(asset)) return [`${path} must be an object`];
  const errors = unexpectedKeys(asset, ASSET_KEYS, path);
  if (typeof asset.id !== "string" || !asset.id.trim()) errors.push(`${path}.id must be a non-empty string`);
  if (typeof asset.label !== "string" || !asset.label.trim()) errors.push(`${path}.label must be a non-empty string`);
  if (typeof asset.description !== "string") errors.push(`${path}.description must be text`);
  if (typeof asset.category !== "string" || !asset.category.trim()) errors.push(`${path}.category must be a non-empty string`);
  if (!new Set(["procedural", "image"]).has(asset.kind)) errors.push(`${path}.kind must be procedural or image`);
  if (asset.kind === "image" && (typeof asset.path !== "string" || !asset.path.trim())) {
    errors.push(`${path}.path must be a non-empty string for image assets`);
  } else if (asset.kind === "procedural" && asset.path !== null) {
    errors.push(`${path}.path must be null for procedural assets`);
  }
  if (asset.thumbnailPath !== null && typeof asset.thumbnailPath !== "string") errors.push(`${path}.thumbnailPath must be text or null`);
  if (!Array.isArray(asset.applicableTypes) || asset.applicableTypes.length === 0 || asset.applicableTypes.some((type) => typeof type !== "string" || !type)) {
    errors.push(`${path}.applicableTypes must contain at least one object type or *`);
  }
  if (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string")) errors.push(`${path}.tags must be an array of strings`);
  if (asset.prompt !== null && typeof asset.prompt !== "string") errors.push(`${path}.prompt must be text or null`);
  if (typeof asset.generationMethod !== "string" || !asset.generationMethod.trim()) errors.push(`${path}.generationMethod must be a non-empty string`);
  for (const key of ["width", "height", "fileSizeBytes"]) {
    if (asset[key] !== null && (!Number.isInteger(asset[key]) || asset[key] <= 0)) errors.push(`${path}.${key} must be a positive integer or null`);
  }
  if (!isRecord(asset.license)) {
    errors.push(`${path}.license must be an object`);
  } else {
    errors.push(...unexpectedKeys(asset.license, LICENSE_KEYS, `${path}.license`));
    for (const key of LICENSE_KEYS) {
      if (typeof asset.license[key] !== "string" || !asset.license[key].trim()) errors.push(`${path}.license.${key} must be non-empty text`);
    }
  }
  return errors;
}

export function validateAssetRegistry(registry) {
  if (!isRecord(registry)) return ["Asset registry must be an object"];
  const errors = unexpectedKeys(registry, ["schemaVersion", "assets", "typeDefaults", "projectDefaultAssetId"], "registry");
  if (registry.schemaVersion !== ASSET_REGISTRY_VERSION) errors.push(`Unsupported asset registry version: ${registry.schemaVersion}`);
  if (!Array.isArray(registry.assets)) errors.push("registry.assets must be an array");
  if (!isRecord(registry.typeDefaults)) errors.push("registry.typeDefaults must be an object");
  if (typeof registry.projectDefaultAssetId !== "string" || !registry.projectDefaultAssetId) {
    errors.push("registry.projectDefaultAssetId must be a non-empty string");
  }
  const assets = Array.isArray(registry.assets) ? registry.assets : [];
  const typeDefaults = isRecord(registry.typeDefaults) ? registry.typeDefaults : {};
  const ids = new Set();
  for (const [index, asset] of assets.entries()) {
    errors.push(...validateAsset(asset, index));
    if (asset?.id && ids.has(asset.id)) errors.push(`Duplicate asset id: ${asset.id}`);
    if (asset?.id) ids.add(asset.id);
  }
  const assetsById = new Map(assets.filter((asset) => asset?.id).map((asset) => [asset.id, asset]));
  if (registry.projectDefaultAssetId && !assetsById.has(registry.projectDefaultAssetId)) {
    errors.push(`Project default asset is missing: ${registry.projectDefaultAssetId}`);
  } else if (registry.projectDefaultAssetId && !assetsById.get(registry.projectDefaultAssetId)?.applicableTypes?.includes("*")) {
    errors.push(`Project default asset must apply to every object type: ${registry.projectDefaultAssetId}`);
  }
  for (const [objectType, assetId] of Object.entries(typeDefaults)) {
    if (!objectType) errors.push("registry.typeDefaults keys must be non-empty object types");
    if (typeof assetId !== "string" || !assetsById.has(assetId)) {
      errors.push(`Type default ${objectType} references a missing asset: ${assetId}`);
    } else if (!isAssetApplicable(assetsById.get(assetId), objectType)) {
      errors.push(`Type default ${assetId} does not apply to ${objectType}`);
    }
  }
  return [...new Set(errors)];
}

export function createAssetRegistry({
  assets = DEFAULT_ASSET_REGISTRY.assets,
  typeDefaults = DEFAULT_ASSET_REGISTRY.typeDefaults,
  projectDefaultAssetId = DEFAULT_ASSET_REGISTRY.projectDefaultAssetId
} = {}) {
  const registry = {
    schemaVersion: ASSET_REGISTRY_VERSION,
    assets: clone(assets),
    typeDefaults: clone(typeDefaults),
    projectDefaultAssetId
  };
  const errors = validateAssetRegistry(registry);
  if (errors.length) throw new Error(errors.join("\n"));
  return registry;
}

const BUILTIN_PROCEDURAL_ASSET = Object.freeze({
  id: BUILTIN_PROCEDURAL_ASSET_ID,
  label: "原有程序化表现",
  description: "使用物件类型原有的 Canvas 程序化绘制；也是素材缺失或加载失败时的安全回退。",
  category: "builtin",
  kind: "procedural",
  path: null,
  thumbnailPath: null,
  applicableTypes: Object.freeze(["*"]),
  tags: Object.freeze(["builtin", "procedural", "fallback"]),
  prompt: null,
  generationMethod: "builtin-procedural",
  width: null,
  height: null,
  fileSizeBytes: null,
  license: Object.freeze({
    name: "Cablester project source",
    scope: "Cablester project runtime and editor",
    source: "builtin"
  })
});

const GENERATED_ASSET_LICENSE = Object.freeze({
  name: "Original AI-generated project asset",
  scope: "Cablester project runtime, editor, documentation, and public Sites deployment",
  source: "Generated for Cablester with OpenAI built-in ImageGen on 2026-08-11; no third-party game resources used"
});

export const GENERATED_GAME_ASSETS = Object.freeze([
  Object.freeze({
    id: GAME_ASSET_IDS.mossPlatform,
    label: "荧光苔藓根木平台",
    description: "深色根木与清晰苔藓顶边组成的横向平台表面，可在不改变碰撞尺寸的前提下替换平台外观。",
    category: "terrain",
    kind: "image",
    path: "./assets/game/terrain/moss-root-platform.webp",
    thumbnailPath: "./assets/game/thumbnails/moss-root-platform-thumb.webp",
    applicableTypes: Object.freeze(["platform"]),
    tags: Object.freeze(["平台", "根木", "苔藓", "生物光", "forest", "moss", "rootwood"]),
    prompt: "Create one original reusable 2D game sprite for a side-scrolling fantasy forest platform. A long horizontal rootwood platform slab, approximately 4:1 silhouette, with a crisp moss-covered top edge, dark navy-teal hand-painted wood underside, small turquoise bioluminescent sprouts, two restrained warm amber accents. Painterly gouache texture, strong readable collision silhouette, details remain clear when downscaled to 256x64. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP, not a concept painting.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 512,
    height: 120,
    fileSizeBytes: 20168,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.thornHazard,
    label: "绯红荆棘藤",
    description: "带高对比尖刺轮廓的危险物条带，保留原危险物碰撞与伤害语义。",
    category: "danger",
    kind: "image",
    path: "./assets/game/gameplay/crimson-thorn-vine.webp",
    thumbnailPath: "./assets/game/thumbnails/crimson-thorn-vine-thumb.webp",
    applicableTypes: Object.freeze(["hazard"]),
    tags: Object.freeze(["危险物", "荆棘", "藤蔓", "crimson", "thorn", "hazard"]),
    prompt: "Create one original reusable 2D game hazard sprite for a side-scrolling fantasy forest. A long horizontal strip of unmistakably dangerous sharp thorn vines, approximately 4:1 silhouette, deep crimson and violet thorn tips rising from a dark organic root base, subtle cold cyan rim light, hand-painted gouache texture, bold clean collision silhouette readable at 256x64. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP, not a concept painting.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 512,
    height: 124,
    fileSizeBytes: 35428,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.ropeAnchor,
    label: "水晶种荚锚点",
    description: "环状根木与青色水晶核心构成的可抓取锚点，保留原绳索连接和交互语义。",
    category: "interaction",
    kind: "image",
    path: "./assets/game/gameplay/crystal-rope-anchor.webp",
    thumbnailPath: "./assets/game/thumbnails/crystal-rope-anchor-thumb.webp",
    applicableTypes: Object.freeze(["anchor"]),
    tags: Object.freeze(["锚点", "水晶", "抓取", "rope", "anchor", "crystal"]),
    prompt: "Create one original reusable 2D game interaction sprite: a magical rope anchor for a dreamlike forest. A compact circular seed-pod ring made from curling dark teal wood, a bright cyan crystalline core, tiny leaf hooks that clearly suggest a grapple point, hand-painted gouache, cool bioluminescent glow with one warm gold accent, clean readable silhouette at 96x96. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No rope attached, no text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 177,
    height: 192,
    fileSizeBytes: 12946,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.energyOrb,
    label: "叶环能量种子",
    description: "青白核心与叶片弧环组成的能量拾取物，可用于能量球和冲刺补充物。",
    category: "gameplay",
    kind: "image",
    path: "./assets/game/gameplay/leaf-energy-orb.webp",
    thumbnailPath: "./assets/game/thumbnails/leaf-energy-orb-thumb.webp",
    applicableTypes: Object.freeze(["energyOrb", "dashRefill"]),
    tags: Object.freeze(["能量", "拾取物", "种子", "energy", "orb", "refill"]),
    prompt: "Create one original reusable 2D game pickup sprite: a compact forest energy orb. A luminous aqua seed sphere enclosed by three asymmetrical leaf-shaped arcs, painterly gouache, soft cyan-white core, violet outer petals, tiny warm amber spark, crisp silhouette readable at 80x80. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP. Keep the glow bounded and opaque enough for clean chroma key extraction.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 154,
    height: 160,
    fileSizeBytes: 14330,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.bashBlossom,
    label: "紫辉猛击花",
    description: "六瓣放射轮廓表现可从任意方向猛击的支点，冷却与选向状态仍由运行时提示表达。",
    category: "interaction",
    kind: "image",
    path: "./assets/game/gameplay/violet-bash-blossom.webp",
    thumbnailPath: "./assets/game/thumbnails/violet-bash-blossom-thumb.webp",
    applicableTypes: Object.freeze(["bashTarget"]),
    tags: Object.freeze(["猛击", "花朵", "支点", "bash", "blossom", "violet"]),
    prompt: "Create one original reusable 2D game interaction sprite: a kinetic bash blossom for a side-scrolling dreamlike forest. A compact six-petal star bloom with a bright violet-white core, curved cyan energy veins, dark indigo leaf tips, and a clear radial silhouette that suggests launching in any direction. Hand-painted gouache texture, readable at 96x96, bounded glow. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 141,
    height: 160,
    fileSizeBytes: 14974,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.checkpointLantern,
    label: "种灯检查点",
    description: "根木包裹青色火种与琥珀记忆晶体的检查点，激活状态由运行时高亮继续表达。",
    category: "gameplay",
    kind: "image",
    path: "./assets/game/gameplay/seed-lantern-checkpoint.webp",
    thumbnailPath: "./assets/game/thumbnails/seed-lantern-checkpoint-thumb.webp",
    applicableTypes: Object.freeze(["checkpoint"]),
    tags: Object.freeze(["检查点", "灯笼", "火种", "checkpoint", "lantern", "memory"]),
    prompt: "Create one original reusable 2D game checkpoint sprite for a side-scrolling fantasy forest. A slender seed-lantern shrine, approximately 2:3 silhouette, made from dark teal rootwood with a small cyan flame bud and one warm amber memory crystal near the base. Hand-painted gouache texture, strong readable shape at 80x120, bounded glow, suitable for an active-state overlay. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 98,
    height: 192,
    fileSizeBytes: 10070,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.spawnGate,
    label: "根木出生门",
    description: "带开口暗部与金色种子的根木拱门，用作玩家出生位置的可读视觉标记。",
    category: "layout",
    kind: "image",
    path: "./assets/game/layout/root-spawn-gate.webp",
    thumbnailPath: "./assets/game/thumbnails/root-spawn-gate-thumb.webp",
    applicableTypes: Object.freeze(["spawn"]),
    tags: Object.freeze(["出生点", "入口", "拱门", "spawn", "entrance", "root"]),
    prompt: "Create one original reusable 2D game spawn-point sprite for a side-scrolling fantasy forest. A compact arched doorway grown from two curling navy-teal roots, approximately 3:4 silhouette, open dark center, small cyan sprouts at the base and a restrained warm gold seed at the crown. Hand-painted gouache texture, clear entrance silhouette readable at 96x128, bounded light. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 160,
    height: 188,
    fileSizeBytes: 12780,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: GAME_ASSET_IDS.goalGate,
    label: "金辉终点门",
    description: "以白金种星为核心的仪式拱门，作为终点目标并保留运行时完成态提示。",
    category: "layout",
    kind: "image",
    path: "./assets/game/layout/golden-goal-gate.webp",
    thumbnailPath: "./assets/game/thumbnails/golden-goal-gate-thumb.webp",
    applicableTypes: Object.freeze(["goal"]),
    tags: Object.freeze(["终点", "目标", "拱门", "goal", "destination", "gold"]),
    prompt: "Create one original reusable 2D game goal sprite for a side-scrolling fantasy forest. A compact ceremonial root arch surrounding a floating white-gold seed star, approximately 3:4 silhouette, dark indigo wood, turquoise leaf curls, warm luminous destination core, hand-painted gouache texture, triumphant but clean and readable at 96x128, bounded glow. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 136,
    height: 192,
    fileSizeBytes: 19014,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.mossBush,
    label: "苔藓草灌丛",
    description: "低矮苔藓、草叶和圆叶灌木组合，可在玩家附近图层重复铺陈而不遮挡路线。",
    category: "vegetation",
    kind: "image",
    path: "./assets/game/scene/vegetation/moss-bush-cluster.webp",
    thumbnailPath: "./assets/game/thumbnails/moss-bush-cluster-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "草丛", "灌木", "苔藓", "scene", "bush", "moss"]),
    prompt: "Create one original reusable 2D scene sprite for a side-scrolling fantasy forest: a low cluster of mossy grass and rounded bush leaves, approximately 3:2 silhouette, dark teal base, cool turquoise leaf edges, three tiny warm amber buds, hand-painted gouache texture, readable when downscaled to 160x96. Designed to sit along the bottom of a scene layer without obscuring gameplay. Single isolated cluster, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no full scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 256,
    height: 115,
    fileSizeBytes: 11710,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.luminousPlant,
    label: "青露发光植物",
    description: "带三枚青色发光种荚的竖向植物，用作玩家层附近的可复用生物光装饰。",
    category: "vegetation",
    kind: "image",
    path: "./assets/game/scene/vegetation/cyan-seed-plant.webp",
    thumbnailPath: "./assets/game/thumbnails/cyan-seed-plant-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "发光植物", "种荚", "scene", "plant", "bioluminescent"]),
    prompt: "Create one original reusable 2D scene decoration sprite: a small bioluminescent forest plant, approximately 2:3 silhouette, three curling dark leaves supporting cyan glassy seed pods and a few violet spores, hand-painted gouache, bounded glow, readable at 80x120. Designed as a repeatable player-near decoration that does not hide collision edges. Single isolated plant, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no full scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 120,
    height: 174,
    fileSizeBytes: 13090,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.foregroundBranch,
    label: "前景垂藤暗枝",
    description: "近黑蓝的横向枝干与稀疏垂藤，用于前景镜像重复和低透明度剪影压边。",
    category: "foliage",
    kind: "image",
    path: "./assets/game/scene/foreground/overhang-vine-branch.webp",
    thumbnailPath: "./assets/game/thumbnails/overhang-vine-branch-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "前景", "藤蔓", "暗枝", "scene", "foreground", "vine"]),
    prompt: "Create one original reusable 2D foreground sprite for a side-scrolling fantasy forest: a long dark overhanging branch with curling vines and sparse pointed leaves, approximately 4:1 silhouette, near-black navy and deep teal, subtle cool rim light, hand-painted gouache, strong silhouette, suitable for horizontal repetition and mirroring without hiding the center route. Single isolated branch-and-vine piece, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no full scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 384,
    height: 111,
    fileSizeBytes: 14910,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.ancientTree,
    label: "琥珀树洞古树",
    description: "带盘根、稀疏树冠和暖色树洞的单株古树，适合中景随机镜像和视差重复。",
    category: "trees",
    kind: "image",
    path: "./assets/game/scene/trees/ancient-amber-tree.webp",
    thumbnailPath: "./assets/game/thumbnails/ancient-amber-tree-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "古树", "中景", "树洞", "scene", "tree", "midground"]),
    prompt: "Create one original reusable 2D midground tree sprite for a side-scrolling fantasy forest: a tall ancient tree with a broad twisting trunk, visible roots, asymmetrical sparse canopy, approximately 2:3 silhouette, deep blue-green bark, muted turquoise leaves, two restrained warm amber hollows, hand-painted gouache, readable at 192x288. Designed as a reusable midground layer element, not a full background painting. Single isolated tree, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery behind it, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 256,
    height: 339,
    fileSizeBytes: 42060,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.distantTrunks,
    label: "远景高干林影",
    description: "五株高大冷色树干构成的低细节远景剪影，用于低透明度慢速视差重复。",
    category: "background",
    kind: "image",
    path: "./assets/game/scene/background/distant-trunk-grove.webp",
    thumbnailPath: "./assets/game/thumbnails/distant-trunk-grove-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "远景", "树干", "剪影", "scene", "background", "trunks"]),
    prompt: "Create one original reusable 2D background sprite for a side-scrolling fantasy forest: a cluster of five very tall distant tree trunks fading upward, approximately 4:3 silhouette, deep desaturated blue and cool turquoise-black, sparse high branches, soft painted edges, no foreground detail, hand-painted gouache. Designed for low-opacity horizontal repetition and parallax, readable at 320x240. Single isolated cluster, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no full scene, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 337,
    height: 320,
    fileSizeBytes: 46290,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.midTreeCluster,
    label: "中远景三树组",
    description: "三株低细节细干树组成的中远景树组，可稀疏镜像并与单株古树交错。",
    category: "trees",
    kind: "image",
    path: "./assets/game/scene/trees/mid-tree-cluster.webp",
    thumbnailPath: "./assets/game/thumbnails/mid-tree-cluster-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "树群", "中远景", "scene", "trees", "cluster"]),
    prompt: "Create one original reusable 2D scene sprite for a side-scrolling fantasy forest: a loose cluster of three slender mid-distance trees with overlapping trunks and small layered canopies, approximately 3:2 silhouette, muted teal and blue-green, a few tiny warm amber leaf accents, hand-painted gouache, clearly less detailed than a hero tree. Designed for sparse midground repetition and mirroring at 240x160. Single isolated cluster, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no full scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 149,
    height: 192,
    fileSizeBytes: 17036,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.mistBand,
    label: "青蓝游雾带",
    description: "带羽化末端的横向浅青雾带，适合 screen 混合、重叠和平滑横向延伸。",
    category: "atmosphere",
    kind: "image",
    path: "./assets/game/scene/atmosphere/cyan-mist-band.webp",
    thumbnailPath: "./assets/game/thumbnails/cyan-mist-band-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "雾气", "气氛", "scene", "mist", "fog"]),
    prompt: "Create one original reusable 2D atmospheric sprite for a side-scrolling fantasy forest: a long horizontal ribbon of pale cyan-blue ground mist, approximately 5:1 silhouette, layered soft wisps with feathered ends, subtle transparent-looking interior, no hard rectangle, suitable for screen blending and seamless overlapping at 320x64. Single isolated mist band, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no landscape, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 512,
    height: 86,
    fileSizeBytes: 15556,
    license: GENERATED_ASSET_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.lightMotes,
    label: "林间生物光点",
    description: "包含青色、紫色与少量暖色光点的稀疏装饰组，用于轻量视差与 screen 混合。",
    category: "atmosphere",
    kind: "image",
    path: "./assets/game/scene/atmosphere/forest-light-motes.webp",
    thumbnailPath: "./assets/game/thumbnails/forest-light-motes-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "光点", "生物光", "scene", "motes", "bioluminescent"]),
    prompt: "Create one original reusable 2D atmospheric decoration sprite: a wide loose constellation of small forest light motes, approximately 4:2 distribution, mostly cyan and aqua dots with a few violet and warm amber specks, varied sizes, bounded soft glow, plenty of empty space, hand-painted, suitable for sparse parallax repetition at 240x120. Single isolated mote cluster, centered, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local key-colour unmatte, crop, resize, and WebP quality 88",
    width: 384,
    height: 146,
    fileSizeBytes: 17432,
    license: GENERATED_ASSET_LICENSE
  })
]);

export const DEFAULT_ASSET_REGISTRY = Object.freeze({
  schemaVersion: ASSET_REGISTRY_VERSION,
  assets: Object.freeze([BUILTIN_PROCEDURAL_ASSET, ...GENERATED_GAME_ASSETS]),
  typeDefaults: DEFAULT_TYPE_ASSET_IDS,
  projectDefaultAssetId: BUILTIN_PROCEDURAL_ASSET_ID
});

export function getAssetById(registry = DEFAULT_ASSET_REGISTRY, assetId) {
  return (registry?.assets || []).find((asset) => asset.id === assetId) || null;
}

export function isAssetApplicable(asset, objectType) {
  return Boolean(asset)
    && typeof objectType === "string"
    && (asset.applicableTypes?.includes("*") || asset.applicableTypes?.includes(objectType));
}

export function getProjectDefaultAssetId(registry = DEFAULT_ASSET_REGISTRY) {
  return getAssetById(registry, registry?.projectDefaultAssetId)
    ? registry.projectDefaultAssetId
    : BUILTIN_PROCEDURAL_ASSET_ID;
}

export function getTypeDefaultAssetId(objectType, registry = DEFAULT_ASSET_REGISTRY) {
  const candidate = registry?.typeDefaults?.[objectType];
  const asset = getAssetById(registry, candidate);
  return asset && isAssetApplicable(asset, objectType)
    ? candidate
    : getProjectDefaultAssetId(registry);
}

export function searchAssets(registry = DEFAULT_ASSET_REGISTRY, {
  query = "",
  category = null,
  objectType = null,
  kind = null
} = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  return (registry?.assets || [])
    .filter((asset) => !category || asset.category === category)
    .filter((asset) => !kind || asset.kind === kind)
    .filter((asset) => !objectType || isAssetApplicable(asset, objectType))
    .filter((asset) => {
      if (!normalizedQuery) return true;
      return [asset.id, asset.label, asset.description, asset.category, ...(asset.tags || [])]
        .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
    })
    .map(clone);
}

function fallbackCandidateIds(objectType, registry) {
  return [...new Set([
    getTypeDefaultAssetId(objectType, registry),
    getProjectDefaultAssetId(registry),
    BUILTIN_PROCEDURAL_ASSET_ID
  ].filter(Boolean))];
}

export function resolveAssetReference(assetId, objectType, registry = DEFAULT_ASSET_REGISTRY, {
  unavailableAssetIds = []
} = {}) {
  const unavailable = new Set(unavailableAssetIds);
  const requestedAsset = getAssetById(registry, assetId);
  let fallbackReason = null;
  if (!requestedAsset) fallbackReason = "missing-asset";
  else if (!isAssetApplicable(requestedAsset, objectType)) fallbackReason = "inapplicable-asset";
  else if (unavailable.has(assetId)) fallbackReason = "load-failed";
  let resolvedAsset = fallbackReason ? null : requestedAsset;
  if (!resolvedAsset) {
    resolvedAsset = fallbackCandidateIds(objectType, registry)
      .map((candidateId) => getAssetById(registry, candidateId))
      .find((asset) => asset && isAssetApplicable(asset, objectType) && !unavailable.has(asset.id)) || null;
  }
  const resolvedAssetId = resolvedAsset?.id || BUILTIN_PROCEDURAL_ASSET_ID;
  return {
    requestedAssetId: assetId,
    assetId: resolvedAssetId,
    asset: resolvedAsset ? clone(resolvedAsset) : null,
    usedFallback: Boolean(fallbackReason || resolvedAssetId !== assetId),
    fallbackReason
  };
}

export function resolveVisualAsset(visual, objectType, registry = DEFAULT_ASSET_REGISTRY, {
  unavailableAssetIds = []
} = {}) {
  const visualErrors = validateVisualConfig(visual);
  const normalizedVisual = visualErrors.length ? createVisualConfig() : clone(visual);
  const requestedAssetId = normalizedVisual.assetId;
  const reference = resolveAssetReference(requestedAssetId, objectType, registry, { unavailableAssetIds });
  const fallbackReason = visualErrors.length ? "invalid-visual" : reference.fallbackReason;
  return {
    requestedAssetId,
    assetId: reference.assetId,
    asset: reference.asset,
    visual: { ...normalizedVisual, assetId: reference.assetId },
    usedFallback: Boolean(fallbackReason || reference.usedFallback),
    fallbackReason,
    validationErrors: visualErrors
  };
}

export function resolveObjectVisual(object, registry = DEFAULT_ASSET_REGISTRY, options = {}) {
  return resolveVisualAsset(object?.properties?.visual, object?.type, registry, options);
}

function requireApplicableAsset(assetId, objectType, registry) {
  const asset = getAssetById(registry, assetId);
  if (!asset) throw new Error(`Unknown asset: ${assetId}`);
  if (!isAssetApplicable(asset, objectType)) throw new Error(`Asset ${assetId} does not apply to ${objectType}`);
  return asset;
}

function updateObject(document, objectId, updater) {
  const next = clone(document);
  const object = next?.objects?.find((candidate) => candidate.id === objectId);
  if (!object) throw new Error(`Unknown level object: ${objectId}`);
  updater(object);
  return next;
}

function setVisualAsset(object, assetId) {
  const current = createVisualConfig(object.properties?.visual || { assetId });
  object.properties = { ...(object.properties || {}), visual: { ...current, assetId } };
}

export function replaceObjectVisual(document, objectId, visual, registry = DEFAULT_ASSET_REGISTRY) {
  return updateObject(document, objectId, (object) => {
    const replacement = createVisualConfig(visual);
    requireApplicableAsset(replacement.assetId, object.type, registry);
    object.properties = { ...(object.properties || {}), visual: replacement };
  });
}

export function updateObjectVisual(document, objectId, changes, registry = DEFAULT_ASSET_REGISTRY) {
  if (!isRecord(changes)) throw new Error("Visual changes must be an object");
  return updateObject(document, objectId, (object) => {
    const current = createVisualConfig({
      assetId: getTypeDefaultAssetId(object.type, registry),
      ...(object.properties?.visual || {})
    });
    const updated = createVisualConfig({ ...current, ...clone(changes) });
    requireApplicableAsset(updated.assetId, object.type, registry);
    object.properties = { ...(object.properties || {}), visual: updated };
  });
}

export function replaceObjectAsset(document, objectId, assetId, registry = DEFAULT_ASSET_REGISTRY) {
  return updateObject(document, objectId, (object) => {
    requireApplicableAsset(assetId, object.type, registry);
    setVisualAsset(object, assetId);
  });
}

export function replaceAssetsForType(document, objectType, assetId, registry = DEFAULT_ASSET_REGISTRY) {
  requireApplicableAsset(assetId, objectType, registry);
  const next = clone(document);
  for (const object of next?.objects || []) {
    if (object.type === objectType) setVisualAsset(object, assetId);
  }
  return next;
}

function resetObjectVisual(document, objectId, assetIdSelector, registry) {
  return updateObject(document, objectId, (object) => {
    const assetId = assetIdSelector(object.type, registry);
    requireApplicableAsset(assetId, object.type, registry);
    object.properties = { ...(object.properties || {}), visual: createVisualConfig({ assetId }) };
  });
}

export function resetObjectVisualToTypeDefault(document, objectId, registry = DEFAULT_ASSET_REGISTRY) {
  return resetObjectVisual(document, objectId, getTypeDefaultAssetId, registry);
}

export function resetObjectVisualToProjectDefault(document, objectId, registry = DEFAULT_ASSET_REGISTRY) {
  return resetObjectVisual(document, objectId, (_objectType, selectedRegistry) => getProjectDefaultAssetId(selectedRegistry), registry);
}

export function resetVisualsForTypeToTypeDefault(document, objectType, registry = DEFAULT_ASSET_REGISTRY) {
  const assetId = getTypeDefaultAssetId(objectType, registry);
  requireApplicableAsset(assetId, objectType, registry);
  const next = clone(document);
  for (const object of next?.objects || []) {
    if (object.type !== objectType) continue;
    object.properties = { ...(object.properties || {}), visual: createVisualConfig({ assetId }) };
  }
  return next;
}

export function resetAllObjectVisualsToTypeDefaults(document, registry = DEFAULT_ASSET_REGISTRY) {
  const next = clone(document);
  for (const object of next?.objects || []) {
    const assetId = getTypeDefaultAssetId(object.type, registry);
    requireApplicableAsset(assetId, object.type, registry);
    object.properties = { ...(object.properties || {}), visual: createVisualConfig({ assetId }) };
  }
  return next;
}

export function resetAllObjectVisualsToProjectDefault(document, registry = DEFAULT_ASSET_REGISTRY) {
  const assetId = getProjectDefaultAssetId(registry);
  const next = clone(document);
  for (const object of next?.objects || []) {
    requireApplicableAsset(assetId, object.type, registry);
    object.properties = { ...(object.properties || {}), visual: createVisualConfig({ assetId }) };
  }
  return next;
}

export function resetObjectVisualProperty(document, objectId, property, registry = DEFAULT_ASSET_REGISTRY) {
  if (!VISUAL_CONFIG_KEYS.includes(property)) throw new Error(`Unknown visual property: ${property}`);
  return updateObject(document, objectId, (object) => {
    const defaults = createVisualConfig({ assetId: getTypeDefaultAssetId(object.type, registry) });
    const current = createVisualConfig(object.properties?.visual || defaults);
    object.properties = {
      ...(object.properties || {}),
      visual: { ...current, [property]: defaults[property] }
    };
  });
}
