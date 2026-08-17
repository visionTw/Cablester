import { assetDeliveryUrl, isCanonicalAssetPath } from "./asset-paths.js";
import {
  ASSET_SCALE_MODES,
  assetScalingProfile,
  resolveAssetScaleMode,
  validateAssetScaling
} from "./asset-scaling.js";

export { assetDeliveryUrl, isCanonicalAssetPath } from "./asset-paths.js";
export { ASSET_SCALE_MODES, assetScalingProfile, resolveAssetScaleMode } from "./asset-scaling.js";

export const ASSET_REGISTRY_VERSION = 1;
export const BUILTIN_PROCEDURAL_ASSET_ID = "builtin:procedural";

export const BUILTIN_LEVEL_OBJECT_TYPES = Object.freeze([
  "spawn", "goal", "checkpoint", "roomEntrance", "roomExit",
  "platform", "slope", "boundaryWall", "hazard", "windZone", "liquidZone", "darknessZone", "rotationTrigger",
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
  lightMotes: "scene:forest-light-motes",
  moonlitCanopy: "scene:moonlit-canopy-cluster",
  distantRootSpires: "scene:distant-root-spires",
  rootStoneArch: "scene:root-stone-arch",
  shadowFern: "scene:shadow-fern-cluster",
  mossRootBoulders: "scene:moss-root-boulders",
  aquaBellFlowers: "scene:aqua-bell-flowers"
});

export const LANDMARK_ASSET_IDS = Object.freeze({
  duskseedGate: "landmark:duskseed-gate",
  twinRootBells: "landmark:twin-root-bells",
  heartwoodCore: "landmark:heartwood-core"
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
  "scaleMode",
  "tileScale",
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
  scaleMode: "asset",
  tileScale: 1,
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
  "scaling",
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
  if (!ASSET_SCALE_MODES.includes(config.scaleMode)) {
    errors.push(`${path}.scaleMode must be asset, stretch, nine-slice, or tile`);
  }
  if (!finiteInRange(config.tileScale, 0.1, 8)) errors.push(`${path}.tileScale must be a number from 0.1 to 8`);
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
    } else if (config.scaleMode !== "asset") {
      const resolution = resolveAssetScaleMode(asset, config);
      if (resolution.fallbackReason) errors.push(`${path}.scaleMode ${config.scaleMode} is not supported by ${config.assetId}`);
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
  if (asset.kind === "image" && !isCanonicalAssetPath(asset.path)) {
    errors.push(`${path}.path must be a canonical ./assets/game image path`);
  } else if (asset.kind === "procedural" && asset.path !== null) {
    errors.push(`${path}.path must be null for procedural assets`);
  }
  if (asset.thumbnailPath !== null && !isCanonicalAssetPath(asset.thumbnailPath)) {
    errors.push(`${path}.thumbnailPath must be a canonical ./assets/game image path or null`);
  }
  if (!Array.isArray(asset.applicableTypes) || asset.applicableTypes.length === 0 || asset.applicableTypes.some((type) => typeof type !== "string" || !type)) {
    errors.push(`${path}.applicableTypes must contain at least one object type or *`);
  }
  if (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== "string")) errors.push(`${path}.tags must be an array of strings`);
  if (asset.prompt !== null && typeof asset.prompt !== "string") errors.push(`${path}.prompt must be text or null`);
  if (typeof asset.generationMethod !== "string" || !asset.generationMethod.trim()) errors.push(`${path}.generationMethod must be a non-empty string`);
  for (const key of ["width", "height", "fileSizeBytes"]) {
    if (asset[key] !== null && (!Number.isInteger(asset[key]) || asset[key] <= 0)) errors.push(`${path}.${key} must be a positive integer or null`);
  }
  if (asset.kind === "procedural" && asset.scaling !== undefined) {
    errors.push(`${path}.scaling is only supported for image assets`);
  } else if (asset.kind === "image") {
    errors.push(...validateAssetScaling(asset.scaling, asset, `${path}.scaling`));
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

const GENERATED_SCENE_EXPANSION_LICENSE = Object.freeze({
  name: "Original AI-generated project asset",
  scope: "Cablester project runtime, editor, documentation, and public Sites deployment",
  source: "Generated for Cablester with OpenAI built-in ImageGen on 2026-08-12; no third-party game resources used"
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
    applicableTypes: Object.freeze(["platform", "boundaryWall"]),
    tags: Object.freeze(["平台", "根木", "苔藓", "生物光", "forest", "moss", "rootwood"]),
    prompt: "Create one original reusable 2D game sprite for a side-scrolling fantasy forest platform. A long horizontal rootwood platform slab, approximately 4:1 silhouette, with a crisp moss-covered top edge, dark navy-teal hand-painted wood underside, small turquoise bioluminescent sprouts, two restrained warm amber accents. Painterly gouache texture, strong readable collision silhouette, details remain clear when downscaled to 256x64. Single isolated object, centered, generous margin, exact flat solid #ff00ff background for chroma key removal. No text, no character, no logo, no interface, no scenery, no existing game IP, not a concept painting.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 512,
    height: 120,
    fileSizeBytes: 20168,
    scaling: Object.freeze({
      defaultMode: "nine-slice",
      allowedModes: Object.freeze(["stretch", "nine-slice", "tile"]),
      nineSlice: Object.freeze({
        left: 96,
        right: 96,
        top: 32,
        bottom: 34,
        edgeMode: "stretch",
        centerMode: "stretch"
      }),
      tile: Object.freeze({ width: 256, height: 60 })
    }),
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
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.moonlitCanopy,
    label: "月影远景树冠",
    description: "四组不规则冷色树冠与细远干组成的宽幅远景剪影，用于稀疏镜像和慢速视差。",
    category: "background",
    kind: "image",
    path: "./assets/game/scene/background/moonlit-canopy-cluster.webp",
    thumbnailPath: "./assets/game/thumbnails/moonlit-canopy-cluster-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "远景", "树冠", "剪影", "scene", "background", "canopy"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester far-background layer. Primary request: an original panoramic cluster of layered fantasy forest canopy silhouettes, with four irregular rounded tree crowns and a few thin distant trunks, designed to enrich horizontal parallax depth without covering gameplay. Style/medium: hand-painted gouache game sprite, dreamlike bioluminescent forest visual language, entirely original, not based on or copying any existing game artwork. Composition/framing: one isolated wide cluster, approximately 3:1 silhouette; all foliage fully inside frame; generous clean padding; asymmetrical and suitable for mirror/random repetition; readable when reduced to 384x128. Lighting/mood: very subdued moonlit cyan rim light, deep desaturated navy-teal masses, faint cool mist gaps. Color palette: dark blue-green, muted slate cyan, tiny restrained pale turquoise accents. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform corner-to-corner with no shadow, gradient, texture, floor, reflection, or lighting variation. Constraints: reusable sprite only; no full scenery; no ground platform; no character; no text; no logo; no UI; no watermark; no cast shadow; crisp separated outer silhouette; avoid recognizable existing-game designs or IP.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 499,
    height: 220,
    fileSizeBytes: 32596,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.distantRootSpires,
    label: "雾化远根尖塔",
    description: "三组低细节古根与岩峰剪影，作为树干之后的最远空间层。",
    category: "background",
    kind: "image",
    path: "./assets/game/scene/background/distant-root-spires.webp",
    thumbnailPath: "./assets/game/thumbnails/distant-root-spires-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "远景", "古根", "岩峰", "scene", "background", "spires"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester deep-background layer. Primary request: an original distant root-and-mountain silhouette cluster: three tapering ancient roots or rock spires rising at varied heights with a soft organic contour and sparse tiny branches, used behind forest trunks to create another depth plane. Style/medium: hand-painted gouache game sprite with simplified low-detail silhouette, dreamy atmospheric forest language, entirely original and not derived from any existing game artwork. Composition/framing: one isolated wide cluster, approximately 2:1 silhouette, strong asymmetry and generous padding, all tips fully contained, suitable for mirror/random repetition at 320x180. Lighting/mood: very distant, fog-softened, cool moonlit. Color palette: desaturated blue-gray, deep muted teal, subtle pale cyan edge only. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadow, gradient, texture, floor, reflection, or lighting variation. Constraints: reusable sprite only, no complete background scene, no character, no text, no logo, no UI, no watermark, no recognizable existing-game motifs or IP, clean isolated silhouette.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 375,
    height: 240,
    fileSizeBytes: 19798,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.rootStoneArch,
    label: "盘根石拱",
    description: "根系缠绕的破损石拱与明确中央留空，作为中景地标而不暗示碰撞。",
    category: "structures",
    kind: "image",
    path: "./assets/game/scene/structures/root-stone-arch.webp",
    thumbnailPath: "./assets/game/thumbnails/root-stone-arch-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "中景", "石拱", "盘根", "scene", "structure", "arch"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester midground layer. Primary request: an original natural stone-and-root forest arch fragment: two mossy root-wrapped stone columns joined by a broken curved arch, with open negative space through the center, designed as a midground landmark behind the player. Style/medium: hand-painted gouache game sprite, richly textured but readable, dreamlike bioluminescent forest language, completely original and not copying any existing game art. Composition/framing: one isolated medium-wide arch, about 5:3 silhouette; entire object inside frame with generous padding; center opening remains clear; reusable at 256x180 and compatible with tinting. Lighting/mood: cool teal ambient light, modest warm amber mineral seams, a few small cyan moss lights. Color palette: deep charcoal stone, teal roots and moss, restrained amber and cyan accents. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadow, gradient, texture, floor, reflection, or lighting variation. Constraints: sprite only, no full scenery, no platform collision implication, no character, no text, no logo, no UI, no watermark, no existing-game IP, crisp isolated silhouette.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 320,
    height: 227,
    fileSizeBytes: 21244,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.shadowFern,
    label: "暗影蕨叶组",
    description: "低矮宽幅的深色蕨叶、阔叶与卷藤，用作不会遮挡主路线的前景压边。",
    category: "foliage",
    kind: "image",
    path: "./assets/game/scene/foreground/shadow-fern-cluster.webp",
    thumbnailPath: "./assets/game/thumbnails/shadow-fern-cluster-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "前景", "蕨叶", "藤蔓", "scene", "foreground", "fern"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester foreground layer. Primary request: an original dense foreground foliage cluster made of sweeping dark fern fronds, broad leaves, thin curling vines, and two small hanging seed pods, designed to frame a screen edge without hiding the main route. Style/medium: hand-painted gouache side-scroller sprite, bold layered silhouette, dreamlike bioluminescent forest language, fully original and not copying any existing game artwork. Composition/framing: one isolated wide low cluster, approximately 2.5:1 silhouette, directional crescent shape with most visual mass along the lower edge and open upper negative space; entire object inside frame, generous padding; suitable for flip/mirror repetition and 320x140 use. Lighting/mood: near-black indigo and deep teal foliage with a restrained cyan rim and tiny dim violet-blue specks. Color palette: dark navy, petrol teal, muted blue-violet. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadow, gradient, texture, floor, reflection, or lighting variation. Constraints: foreground decoration only; no scenery, no platform, no character, no text, no logo, no UI, no watermark, no existing-game IP, crisp isolated outline.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 384,
    height: 170,
    fileSizeBytes: 28064,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.mossRootBoulders,
    label: "苔根岩组",
    description: "三枚矮岩与盘根、苔台和细小菌簇构成的中景深度地标。",
    category: "structures",
    kind: "image",
    path: "./assets/game/scene/structures/moss-root-boulders.webp",
    thumbnailPath: "./assets/game/thumbnails/moss-root-boulders-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "中景", "岩石", "盘根", "苔藓", "scene", "boulders"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester midground layer. Primary request: an original cluster of three rounded forest boulders interlocked with exposed roots, moss ledges, a few small shelf fungi, and two dim bioluminescent buds, used as a midground depth landmark behind playable terrain. Style/medium: hand-painted gouache side-scroller game sprite, organic texture and strong readable silhouette, dreamlike forest atmosphere, entirely original and not copying existing game artwork. Composition/framing: one isolated horizontal cluster approximately 2:1, all stones and roots fully inside frame with generous padding; low enough not to resemble a blocking gameplay wall; reusable at 300x160 and compatible with tinting and mirroring. Lighting/mood: soft cool teal ambient shade with restrained warm amber stone seams and tiny cyan glow. Color palette: charcoal stone, moss green-teal, muted amber, cyan points. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform corner-to-corner, no shadows, gradient, texture, floor, reflection, or lighting variation. Constraints: decoration sprite only, no full scenery, no character, no text, no logo, no UI, no watermark, no recognizable existing-game IP, crisp separated silhouette.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 360,
    height: 164,
    fileSizeBytes: 18460,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: SCENE_ASSET_IDS.aquaBellFlowers,
    label: "水青铃花",
    description: "三株高低错落的半透明铃形花与卷草叶，作为玩家附近的轻量生物光点缀。",
    category: "vegetation",
    kind: "image",
    path: "./assets/game/scene/vegetation/aqua-bell-flowers.webp",
    thumbnailPath: "./assets/game/thumbnails/aqua-bell-flowers-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["场景", "近景", "铃花", "发光植物", "scene", "flower", "bioluminescent"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game scene sprite for Cablester near-player decoration layer. Primary request: an original cluster of translucent bell-shaped forest flowers and curling grass blades, three varied-height stems rising from a compact moss base, with softly glowing turquoise petals and small warm seed centers. Style/medium: hand-painted gouache game sprite, clear readable shapes at small scale, dreamlike bioluminescent forest language, fully original and not copying any existing game artwork. Composition/framing: one isolated compact plant cluster approximately 4:3, entirely inside frame with generous padding, open gaps between stems, suitable for random placement and horizontal flipping at about 140x110. Lighting/mood: luminous but bounded glow, calm cool moonlight. Color palette: deep teal leaves, aqua and pale cyan petals, tiny amber centers. Do not use magenta in the subject. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadows, gradient, texture, floor, reflection, or lighting variation. Constraints: small decoration only, no full scene, no character, no text, no logo, no UI, no watermark, no existing-game IP, clean opaque-enough edges for chroma removal.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 160,
    height: 177,
    fileSizeBytes: 18306,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: LANDMARK_ASSET_IDS.duskseedGate,
    label: "暮种灯门",
    description: "两股盘根围合成的入口拱门与悬挂种灯，作为暮种林入口和世界地图的稳定地标代理。",
    category: "landmarks",
    kind: "image",
    path: "./assets/game/scene/landmarks/duskseed-gate.webp",
    thumbnailPath: "./assets/game/thumbnails/duskseed-gate-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["地标", "入口", "种灯", "盘根", "landmark", "gate", "duskseed"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game landmark sprite for the Cablester canonical world editor and Godot runtime. Primary request: an original Duskseed Gate landmark, a compact asymmetrical arch grown from two intertwined mossy roots around a small suspended seed lantern, designed as a modular entrance marker. Style/medium: hand-painted gouache 2D game sprite, clear silhouette and readable at small scale, dreamlike bioluminescent forest atmosphere, entirely original. Composition/framing: isolated full object, roughly square, generous padding, front three-quarter view, no ground plane. Lighting/mood: cool cyan moonlight with one restrained amber seed glow. Color palette: deep teal, blue-green moss, pale cyan edge light, warm amber focal glow. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Constraints: small modular landmark only; no full scene; crisp separated edges; do not use #ff00ff in the subject; no character, text, logo, UI, watermark, or existing-game IP; no cast/contact shadow.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 373,
    height: 420,
    fileSizeBytes: 52678,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: LANDMARK_ASSET_IDS.twinRootBells,
    label: "双根钟",
    description: "共享根枝上悬挂的两枚发光种荚钟，作为钟庭猛击机关与区域图的原创地标。",
    category: "landmarks",
    kind: "image",
    path: "./assets/game/scene/landmarks/twin-root-bells.webp",
    thumbnailPath: "./assets/game/thumbnails/twin-root-bells-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["地标", "根钟", "猛击", "钟庭", "landmark", "bell", "bash"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game landmark sprite for the Cablester canonical world editor and Godot runtime. Primary request: an original Twin Root Bells landmark, two hollow bell-shaped seed pods grown from a shared curling root branch, each bell with a small luminous clapper, suitable as a bash-interaction landmark module. Style/medium: hand-painted gouache 2D game sprite, bold readable silhouette at small scale, dreamlike bioluminescent forest atmosphere, entirely original. Composition/framing: isolated horizontal cluster, approximately 4:3, entire branch and both bells inside frame with generous padding, no ground plane. Lighting/mood: cool cyan rim light with restrained violet-blue bell glow and tiny warm amber centers. Color palette: deep teal wood, moss green, aqua/cyan, muted violet, small amber accents. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Constraints: small modular landmark only; no full scene; crisp separated edges; do not use #ff00ff in subject; no character, text, logo, UI, watermark, or existing-game IP; no cast/contact shadow.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 420,
    height: 302,
    fileSizeBytes: 55424,
    license: GENERATED_SCENE_EXPANSION_LICENSE
  }),
  Object.freeze({
    id: LANDMARK_ASSET_IDS.heartwoodCore,
    label: "心木核环",
    description: "盘根圆环守护发光种心的模块化核心，用于心木环庭和世界图的最终主地标。",
    category: "landmarks",
    kind: "image",
    path: "./assets/game/scene/landmarks/heartwood-core.webp",
    thumbnailPath: "./assets/game/thumbnails/heartwood-core-thumb.webp",
    applicableTypes: Object.freeze(["scene"]),
    tags: Object.freeze(["地标", "心木", "种心", "环庭", "landmark", "heartwood", "core"]),
    prompt: "Use case: stylized-concept. Asset type: reusable small 2D game landmark sprite for the Cablester canonical world editor and Godot runtime. Primary request: an original Heartwood Core landmark, a compact circular ring of intertwined roots protecting a floating faceted seed-heart, with a few small moss fronds, designed as a modular world-map and in-level focal marker. Style/medium: hand-painted gouache 2D game sprite, strong circular silhouette and readable at small scale, dreamlike bioluminescent forest atmosphere, entirely original. Composition/framing: isolated full object, roughly square, centered ring with generous padding, no ground plane. Lighting/mood: cool cyan moonlight around the roots with a restrained amber-white glow from the seed-heart. Color palette: deep teal and blue-green roots, moss green, pale cyan accents, warm amber core. Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, uniform with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Constraints: small modular landmark only; no full scene; crisp separated edges; do not use #ff00ff in subject; no character, text, logo, UI, watermark, or existing-game IP; no cast/contact shadow.",
    generationMethod: "OpenAI built-in ImageGen (gpt-image-2); #ff00ff chroma-key extraction; local crop, resize, and WebP quality 88",
    width: 358,
    height: 360,
    fileSizeBytes: 61180,
    license: GENERATED_SCENE_EXPANSION_LICENSE
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
  const compatibleVisual = isRecord(visual)
    ? { scaleMode: DEFAULT_VISUAL_CONFIG.scaleMode, tileScale: DEFAULT_VISUAL_CONFIG.tileScale, ...clone(visual) }
    : visual;
  const visualErrors = validateVisualConfig(compatibleVisual);
  const normalizedVisual = visualErrors.length ? createVisualConfig() : compatibleVisual;
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
