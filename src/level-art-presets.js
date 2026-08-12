import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  GAME_ASSET_IDS,
  SCENE_ASSET_IDS,
  createVisualConfig
} from "./asset-library.js";
import { compileLevelDocument, levelToDocument } from "./level-objects.js";
import { createSceneLayer } from "./scene-layers.js";

export const REPRESENTATIVE_LEVEL_ID = "combined-horizontal";

const REPRESENTATIVE_OBJECT_VISUALS_BY_TYPE = Object.freeze({
  platform: Object.freeze({ assetId: GAME_ASSET_IDS.mossPlatform }),
  hazard: Object.freeze({ assetId: GAME_ASSET_IDS.thornHazard }),
  anchor: Object.freeze({ assetId: GAME_ASSET_IDS.ropeAnchor }),
  energyOrb: Object.freeze({ assetId: GAME_ASSET_IDS.energyOrb }),
  dashRefill: Object.freeze({ assetId: GAME_ASSET_IDS.energyOrb }),
  bashTarget: Object.freeze({ assetId: GAME_ASSET_IDS.bashBlossom }),
  checkpoint: Object.freeze({ assetId: GAME_ASSET_IDS.checkpointLantern }),
  spawn: Object.freeze({ assetId: GAME_ASSET_IDS.spawnGate }),
  goal: Object.freeze({ assetId: GAME_ASSET_IDS.goalGate })
});

const REPRESENTATIVE_SCENE_LAYERS_BY_ROLE = Object.freeze({
  background: Object.freeze({
    name: "远雾树干",
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.distantTrunks, weight: 1 }]),
    parallax: 0.14,
    opacity: 0.26,
    tint: "#7796ad",
    blur: 0,
    fog: 0,
    seamless: Object.freeze({ mode: "mirror", tileWidth: 400, overlap: 50 }),
    seed: "combined-horizontal-distant-trunks",
    spacing: 0,
    density: 1,
    drawCap: 8
  }),
  midground: Object.freeze({
    name: "月影古树林",
    depth: -28,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.ancientTree, weight: 1 }]),
    parallax: 0.46,
    opacity: 0.58,
    tint: "#9ac8c1",
    blur: 0,
    fog: 0,
    seamless: Object.freeze({ mode: "random", tileWidth: 420, overlap: 0 }),
    seed: "combined-horizontal-ancient-trees",
    spacing: 420,
    density: 1,
    drawCap: 4
  }),
  player: Object.freeze({
    name: "近路荧光植被",
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.mossBush, weight: 1 }]),
    opacity: 0.82,
    tint: "#ffffff",
    seamless: Object.freeze({ mode: "random", tileWidth: 220, overlap: 0 }),
    seed: "combined-horizontal-player-vegetation",
    spacing: 300,
    density: 1,
    drawCap: 5
  }),
  foreground: Object.freeze({
    name: "暗藤前景",
    depth: 90,
    assets: Object.freeze([
      { assetId: SCENE_ASSET_IDS.foregroundBranch, weight: 1 },
      { assetId: SCENE_ASSET_IDS.shadowFern, weight: 1.35 }
    ]),
    parallax: 1.15,
    opacity: 0.46,
    tint: "#789f9b",
    blur: 0,
    fog: 0,
    seamless: Object.freeze({ mode: "mirror", tileWidth: 500, overlap: 50 }),
    seed: "combined-horizontal-foreground-vines",
    spacing: 760,
    density: 1,
    drawCap: 3
  })
});

const REPRESENTATIVE_ADDITIONAL_SCENE_LAYERS = Object.freeze([
  Object.freeze({
    id: "scene-deep-root-spires",
    name: "深远根峰",
    role: "custom",
    depth: -124,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.distantRootSpires, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0.07,
    scale: 1,
    opacity: 0.2,
    tint: "#7897aa",
    blur: 1.5,
    fog: 0.04,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "mirror", tileWidth: 430, overlap: 28 }),
    seed: "combined-horizontal-deep-root-spires",
    range: Object.freeze({ startX: null, endX: null }),
    originX: -120,
    spacing: 210,
    density: 1,
    drawCap: 5
  }),
  Object.freeze({
    id: "scene-far-canopy",
    name: "远景月影树冠",
    role: "custom",
    depth: -56,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.moonlitCanopy, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0.3,
    scale: 1,
    opacity: 0.34,
    tint: "#82a8b2",
    blur: 0.5,
    fog: 0.03,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "random", tileWidth: 540, overlap: 32 }),
    seed: "combined-horizontal-far-canopy",
    range: Object.freeze({ startX: null, endX: null }),
    originX: 60,
    spacing: 250,
    density: 1,
    drawCap: 4
  }),
  Object.freeze({
    id: "scene-mid-landmarks",
    name: "中景盘根遗迹",
    role: "custom",
    depth: -8,
    assets: Object.freeze([
      { assetId: SCENE_ASSET_IDS.rootStoneArch, weight: 0.85 },
      { assetId: SCENE_ASSET_IDS.mossRootBoulders, weight: 1.15 }
    ]),
    visible: true,
    locked: false,
    parallax: 0.76,
    scale: 1,
    opacity: 0.46,
    tint: "#9ac7b8",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "random", tileWidth: 390, overlap: 0 }),
    seed: "combined-horizontal-mid-landmarks",
    range: Object.freeze({ startX: null, endX: null }),
    originX: 260,
    spacing: 520,
    density: 1,
    drawCap: 3
  }),
  Object.freeze({
    id: "scene-near-bell-flowers",
    name: "近路水青铃花",
    role: "custom",
    depth: -3,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.aquaBellFlowers, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0.93,
    scale: 0.9,
    opacity: 0.72,
    tint: "#d8fff2",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "random", tileWidth: 170, overlap: 0 }),
    seed: "combined-horizontal-near-bell-flowers",
    range: Object.freeze({ startX: null, endX: null }),
    originX: 150,
    spacing: 420,
    density: 0.86,
    drawCap: 4
  }),
  Object.freeze({
    id: "scene-near-luminous-plants",
    name: "近路发光种荚",
    role: "custom",
    depth: -2,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.luminousPlant, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0.96,
    scale: 1,
    opacity: 0.86,
    tint: "#ffffff",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "random", tileWidth: 90, overlap: 0 }),
    seed: "combined-horizontal-luminous-plants",
    range: Object.freeze({ startX: null, endX: null }),
    originX: 90,
    spacing: 430,
    density: 1,
    drawCap: 4
  }),
  Object.freeze({
    id: "scene-far-mist-band",
    name: "远景游雾",
    role: "custom",
    depth: -72,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.mistBand, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0,
    scale: 1,
    opacity: 0.16,
    tint: "#b8e8ee",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: false,
    seamless: Object.freeze({ mode: "tile", tileWidth: 650, overlap: 0 }),
    seed: "combined-horizontal-far-mist",
    range: Object.freeze({ startX: null, endX: null }),
    originX: -325,
    spacing: 0,
    density: 1,
    drawCap: 1
  }),
  Object.freeze({
    id: "scene-mid-tree-clusters",
    name: "中远景树组",
    role: "custom",
    depth: -16,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.midTreeCluster, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0.62,
    scale: 1,
    opacity: 0.48,
    tint: "#91b5a9",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: true,
    seamless: Object.freeze({ mode: "random", tileWidth: 170, overlap: 0 }),
    seed: "combined-horizontal-mid-tree-clusters",
    range: Object.freeze({ startX: null, endX: null }),
    originX: 180,
    spacing: 560,
    density: 1,
    drawCap: 3
  }),
  Object.freeze({
    id: "scene-player-light-motes",
    name: "林间生物光点",
    role: "custom",
    depth: -1,
    assets: Object.freeze([{ assetId: SCENE_ASSET_IDS.lightMotes, weight: 1 }]),
    visible: true,
    locked: false,
    parallax: 0,
    scale: 1,
    opacity: 0.28,
    tint: "#ffffff",
    blur: 0,
    fog: 0,
    blendMode: "source-over",
    repeatX: false,
    seamless: Object.freeze({ mode: "tile", tileWidth: 450, overlap: 0 }),
    seed: "combined-horizontal-light-motes",
    range: Object.freeze({ startX: null, endX: null }),
    originX: -225,
    spacing: 500,
    density: 1,
    drawCap: 1
  })
]);

export const LEVEL_ART_THEME_BY_ID = Object.freeze({
  "movement-lab-01": Object.freeze({
    label: "月绳幽径", terrainTint: "#d5f2e8", hazardTint: "#ffd0dd", objectTint: "#d2efff", accentTint: "#e4fbff",
    backgroundTint: "#6d8fa3", midTint: "#99c5b8", playerTint: "#d7f1df", foregroundTint: "#6d8d87",
    mistTint: "#b9e7ef", moteTint: "#d2ffff"
  }),
  "hard-bar-lab": Object.freeze({
    label: "琥珀根庭", terrainTint: "#f6d9a2", hazardTint: "#f7b7b5", objectTint: "#ffe1a5", accentTint: "#fff0bd",
    backgroundTint: "#7c806d", midTint: "#c1ad83", playerTint: "#d7c795", foregroundTint: "#776a59",
    mistTint: "#d8cfaa", moteTint: "#ffe5a0", backgroundOpacity: 0.23, midOpacity: 0.52, mistOpacity: 0.12, moteOpacity: 0.22
  }),
  "bash-lab": Object.freeze({
    label: "紫辉花林", terrainTint: "#ddd0ff", hazardTint: "#ffc5de", objectTint: "#e4d4ff", accentTint: "#f3e6ff",
    backgroundTint: "#786f9b", midTint: "#b8a7d2", playerTint: "#d6c9f0", foregroundTint: "#675c78",
    mistTint: "#d9c9f2", moteTint: "#e8dbff", moteOpacity: 0.34
  }),
  "double-jump-lab": Object.freeze({
    label: "青苔跃谷", terrainTint: "#caefd1", hazardTint: "#ffc7c7", objectTint: "#cdf5e8", accentTint: "#e8fff1",
    backgroundTint: "#668d7d", midTint: "#91bda2", playerTint: "#cce6c6", foregroundTint: "#5e7a68",
    mistTint: "#b8e1d0", moteTint: "#d7ffdc"
  }),
  "glide-lab": Object.freeze({
    label: "雾风树冠", terrainTint: "#d7edf2", hazardTint: "#ffd0d0", objectTint: "#d9f4ff", accentTint: "#effbff",
    backgroundTint: "#718ca6", midTint: "#a8c4ce", playerTint: "#d3e8e8", foregroundTint: "#667b86",
    mistTint: "#d2eff5", moteTint: "#e4fbff", backgroundParallax: 0.1, midParallax: 0.38,
    foregroundParallax: 1.24, mistOpacity: 0.23, moteOpacity: 0.2
  }),
  "dash-lab": Object.freeze({
    label: "电光裂林", terrainTint: "#c8dcff", hazardTint: "#ffbfd8", objectTint: "#bedbff", accentTint: "#e1f4ff",
    backgroundTint: "#536f9a", midTint: "#779bc4", playerTint: "#b7d6ef", foregroundTint: "#4e637f",
    mistTint: "#9dd9ed", moteTint: "#b8e8ff", moteOpacity: 0.38
  }),
  "combined-speed": Object.freeze({
    label: "金萤飞径", terrainTint: "#f4ddb0", hazardTint: "#ffc5bc", objectTint: "#ffe3ad", accentTint: "#fff2c9",
    backgroundTint: "#7d806b", midTint: "#b7aa7d", playerTint: "#dbc994", foregroundTint: "#6d6954",
    mistTint: "#dacfa8", moteTint: "#ffe6a3", moteOpacity: 0.36
  }),
  "combined-horizontal": Object.freeze({
    label: "深月长廊", terrainTint: "#ffffff", hazardTint: "#ffffff", objectTint: "#ffffff", accentTint: "#ffffff",
    backgroundTint: "#7796ad", midTint: "#9ac8c1", playerTint: "#ffffff", foregroundTint: "#789f9b",
    mistTint: "#b8e8ee", moteTint: "#ffffff"
  }),
  "combined-vertical": Object.freeze({
    label: "天穹古树", terrainTint: "#dceaff", hazardTint: "#ffd0de", objectTint: "#d9ebff", accentTint: "#f1f6ff",
    backgroundTint: "#657fa3", midTint: "#9ab4cb", playerTint: "#cedfea", foregroundTint: "#5a6d83",
    mistTint: "#c6e1ee", moteTint: "#e5f2ff", backgroundParallax: 0.08, midParallax: 0.34
  }),
  "combined-hazards": Object.freeze({
    label: "绯荆沼泽", terrainTint: "#d8c6d3", hazardTint: "#ffb7c8", objectTint: "#e2c9df", accentTint: "#ffe0e7",
    backgroundTint: "#725f79", midTint: "#9f7f91", playerTint: "#c9a9b5", foregroundTint: "#5f4c5b",
    mistTint: "#c8a9bd", moteTint: "#ffc6d6", foregroundOpacity: 0.54, moteOpacity: 0.3
  })
});

function themedObjectVisuals(theme) {
  return Object.fromEntries(Object.entries(REPRESENTATIVE_OBJECT_VISUALS_BY_TYPE).map(([type, visual]) => {
    const tint = ["platform"].includes(type)
      ? theme.terrainTint
      : type === "hazard"
        ? theme.hazardTint
        : ["goal", "checkpoint", "spawn"].includes(type)
          ? theme.accentTint
          : theme.objectTint;
    return [type, { ...clone(visual), tint }];
  }));
}

function themedSceneLayersByRole(levelId, theme) {
  const layers = clone(REPRESENTATIVE_SCENE_LAYERS_BY_ROLE);
  layers.background = {
    ...layers.background,
    name: `${theme.label} · 远景`,
    tint: theme.backgroundTint,
    opacity: theme.backgroundOpacity ?? layers.background.opacity,
    parallax: theme.backgroundParallax ?? layers.background.parallax,
    seed: `${levelId}-distant-trunks`
  };
  layers.midground = {
    ...layers.midground,
    name: `${theme.label} · 古树林`,
    tint: theme.midTint,
    opacity: theme.midOpacity ?? layers.midground.opacity,
    parallax: theme.midParallax ?? layers.midground.parallax,
    seed: `${levelId}-ancient-trees`
  };
  layers.player = {
    ...layers.player,
    name: `${theme.label} · 近路植被`,
    tint: theme.playerTint,
    opacity: theme.playerOpacity ?? layers.player.opacity,
    seed: `${levelId}-player-vegetation`
  };
  layers.foreground = {
    ...layers.foreground,
    name: `${theme.label} · 暗藤前景`,
    tint: theme.foregroundTint,
    opacity: theme.foregroundOpacity ?? layers.foreground.opacity,
    parallax: theme.foregroundParallax ?? layers.foreground.parallax,
    seed: `${levelId}-foreground-vines`
  };
  return layers;
}

function themedAdditionalSceneLayers(levelId, theme) {
  return clone(REPRESENTATIVE_ADDITIONAL_SCENE_LAYERS).map((layer) => {
    const next = { ...layer, seed: `${levelId}-${layer.id}` };
    if (layer.id === "scene-deep-root-spires") {
      next.name = `${theme.label} · 深远根峰`;
      next.tint = theme.backgroundTint;
      next.opacity = (theme.backgroundOpacity ?? 0.26) * 0.72;
      next.parallax = Math.max(0.04, (theme.backgroundParallax ?? 0.14) * 0.5);
    } else if (layer.id === "scene-far-canopy") {
      next.name = `${theme.label} · 月影树冠`;
      next.tint = theme.backgroundTint;
      next.opacity = (theme.backgroundOpacity ?? 0.26) * 1.18;
      next.parallax = Math.max(0.2, (theme.midParallax ?? 0.46) * 0.64);
    } else if (layer.id === "scene-mid-landmarks") {
      next.name = `${theme.label} · 盘根遗迹`;
      next.tint = theme.midTint;
      next.opacity = (theme.midOpacity ?? 0.58) * 0.78;
      next.parallax = Math.min(0.84, (theme.midParallax ?? 0.46) + 0.28);
    } else if (layer.id === "scene-near-bell-flowers") {
      next.name = `${theme.label} · 水青铃花`;
      next.tint = theme.playerTint;
      next.opacity = (theme.playerOpacity ?? 0.82) * 0.88;
    } else if (layer.id === "scene-near-luminous-plants") {
      next.name = `${theme.label} · 发光种荚`;
      next.tint = theme.playerTint;
      next.opacity = theme.plantOpacity ?? layer.opacity;
    } else if (layer.id === "scene-far-mist-band") {
      next.name = `${theme.label} · 游雾`;
      next.tint = theme.mistTint;
      next.opacity = theme.mistOpacity ?? layer.opacity;
    } else if (layer.id === "scene-mid-tree-clusters") {
      next.name = `${theme.label} · 树组`;
      next.tint = theme.midTint;
      next.opacity = theme.midClusterOpacity ?? layer.opacity;
    } else if (layer.id === "scene-player-light-motes") {
      next.name = `${theme.label} · 生物光点`;
      next.tint = theme.moteTint;
      next.opacity = theme.moteOpacity ?? layer.opacity;
    }
    return next;
  });
}

function createThemedForestPreset(levelId, theme) {
  return {
    objectVisualsByType: themedObjectVisuals(theme),
    sceneLayersByRole: themedSceneLayersByRole(levelId, theme),
    additionalSceneLayers: themedAdditionalSceneLayers(levelId, theme)
  };
}

export const LEVEL_ART_PRESET_BY_ID = Object.freeze(Object.fromEntries(
  Object.entries(LEVEL_ART_THEME_BY_ID)
    .map(([levelId, theme]) => [levelId, Object.freeze(createThemedForestPreset(levelId, theme))])
));

function clone(value) {
  return structuredClone(value);
}

function mergeSceneLayer(layer, changes) {
  return {
    ...layer,
    ...clone(changes),
    seamless: {
      ...layer.seamless,
      ...(changes.seamless ? clone(changes.seamless) : {})
    },
    range: {
      ...layer.range,
      ...(changes.range ? clone(changes.range) : {})
    }
  };
}

function applySceneLayerOverrides(scene, preset) {
  if (preset.scene) return clone(preset.scene);
  if (!preset.sceneLayersById && !preset.sceneLayersByRole && !preset.additionalSceneLayers) return scene;
  const byId = preset.sceneLayersById || {};
  const byRole = preset.sceneLayersByRole || {};
  const layers = scene.layers.map((layer) => {
    const changes = {
      ...(byRole[layer.role] || {}),
      ...(byId[layer.id] || {})
    };
    return Object.keys(changes).length ? mergeSceneLayer(layer, changes) : layer;
  });
  for (const layer of preset.additionalSceneLayers || []) {
    layers.push(createSceneLayer(clone(layer), layers));
  }
  return {
    ...scene,
    layers
  };
}

/**
 * Applies art-only changes to a level document. Gameplay properties and object
 * positions are never rewritten here. Asset registration is deliberately not
 * required: the runtime resolver owns missing-asset fallback behavior.
 */
export function applyLevelArtPreset(document, preset = LEVEL_ART_PRESET_BY_ID[document?.metadata?.id]) {
  const next = clone(document);
  if (!preset) return next;
  const visualsByType = preset.objectVisualsByType || {};
  const visualsById = preset.objectVisualsById || {};
  next.objects = next.objects.map((object) => {
    const changes = {
      ...(visualsByType[object.type] || {}),
      ...(visualsById[object.id] || {})
    };
    if (!Object.keys(changes).length) return object;
    return {
      ...object,
      properties: {
        ...object.properties,
        visual: createVisualConfig({
          ...object.properties.visual,
          ...changes
        })
      }
    };
  });
  next.scene = applySceneLayerOverrides(next.scene, preset);
  return next;
}

function legacyLevelToArtDocument(sourceLevel) {
  const document = levelToDocument(sourceLevel);
  if (sourceLevel.visuals) return document;
  return {
    ...document,
    objects: document.objects.map((object) => ({
      ...object,
      properties: {
        ...object.properties,
        visual: createVisualConfig({
          ...object.properties.visual,
          assetId: BUILTIN_PROCEDURAL_ASSET_ID
        })
      }
    }))
  };
}

export function createLevelArtDocument(sourceLevel) {
  return applyLevelArtPreset(legacyLevelToArtDocument(sourceLevel));
}

export function compileLevelWithArtPreset(sourceLevel) {
  return compileLevelDocument(createLevelArtDocument(sourceLevel));
}
