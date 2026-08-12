import { validateLevel } from "./level-validator.js";
import {
  LEVEL_DOCUMENT_VERSION,
  LEVEL_OBJECT_CATEGORIES,
  LEVEL_OBJECT_LIBRARY,
  compileLevelDocument,
  createBlankLevelDocument,
  createLevelObject,
  generateLevelDocument,
  getLevelObjectBounds,
  levelToDocument,
  migrateLevelDocument,
  validateLevelDocument
} from "./level-objects.js";
import { parseMotionPath } from "./motion.js";
import {
  SCENE_BLEND_MODES,
  SCENE_LAYER_ROLES,
  SCENE_SEAMLESS_MODES,
  addSceneLayer,
  calculateSeamlessPlacements,
  deleteSceneLayer,
  duplicateSceneLayer,
  moveSceneLayer,
  updateSceneLayer
} from "./scene-layers.js";
import {
  BUILTIN_PROCEDURAL_ASSET_ID,
  DEFAULT_ASSET_REGISTRY,
  assetScalingProfile,
  assetDeliveryUrl,
  createVisualConfig,
  getAssetById,
  getProjectDefaultAssetId,
  getTypeDefaultAssetId,
  isAssetApplicable,
  replaceAssetsForType,
  replaceObjectAsset,
  resolveAssetReference,
  resetAllObjectVisualsToProjectDefault,
  resetObjectVisualProperty,
  resetObjectVisualToProjectDefault,
  resetObjectVisualToTypeDefault,
  resetVisualsForTypeToTypeDefault,
  resolveObjectVisual,
  searchAssets,
  updateObjectVisual
} from "./asset-library.js";
import { drawScaledAssetImage } from "./asset-scaling.js";
import {
  DEFAULT_LEVEL_STARTING_ABILITIES,
  LEVEL_SUPPORT_ABILITY_IDS,
  analyzeLevelAbilitySupport,
  replaceStartingAbilities,
  setStartingAbility
} from "./level-support.js";

const STORAGE_KEY = "cablester.level-editor.documents.v2";
const LEGACY_STORAGE_KEY = "cablester.level-editor.documents.v1";
const GRID_SIZE = 20;
const PROCEDURAL_ASSET_ID = BUILTIN_PROCEDURAL_ASSET_ID;
const EDITOR_MODE_LABELS = Object.freeze({
  objects: "物件编辑",
  support: "关卡支持",
  assets: "物件素材",
  scene: "场景分层"
});

const SCENE_ROLE_LABELS = Object.freeze({
  background: "背景",
  midground: "中景",
  player: "玩家基准层",
  foreground: "前景",
  custom: "自定义深度"
});

const ASSET_CATEGORY_LABELS = Object.freeze({
  builtin: "默认与回退",
  terrain: "平台与地形",
  vegetation: "植物",
  foliage: "枝叶与灌木",
  trees: "树木",
  background: "远景",
  atmosphere: "雾气与光效",
  gameplay: "玩法物件",
  danger: "危险物",
  interaction: "交互物件",
  layout: "出生点与终点",
  other: "其他"
});

function ensureEditorDocument(document) {
  return migrateLevelDocument(document);
}

function isProtectedPlayerLayer(layer) {
  return layer?.role === "player";
}

function normalizeAssetRecord(record) {
  const id = String(record?.id || record?.assetId || "").trim();
  if (!id) return null;
  const applicableTypes = record.applicableTypes || record.objectTypes || record.types || record.appliesTo || [];
  return {
    ...record,
    id,
    name: String(record.name || record.label || id),
    category: String(record.category || "other"),
    categoryLabel: String(record.categoryLabel || record.category || "其他"),
    applicableTypes: Array.isArray(applicableTypes) ? applicableTypes.map(String) : [String(applicableTypes)],
    src: assetDeliveryUrl(record.src || record.url || record.path || record.file || record.filePath || ""),
    thumbnailSrc: assetDeliveryUrl(record.thumbnailSrc || record.thumbnailPath || record.src || record.url || record.path || ""),
    fallback: record.kind === "procedural" || id === PROCEDURAL_ASSET_ID
  };
}


function clone(value) {
  return structuredClone(value);
}

function safeFileName(value) {
  return String(value || "cablester-level").replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-");
}

function downloadJson(document) {
  const blob = new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: "application/json" });
  const link = documentBody().createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeFileName(document.metadata.id)}.cablester-level.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function documentBody() {
  return window.document;
}

function readStoredDocuments() {
  const documents = [];
  const ids = new Set();
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(value)) continue;
      for (const rawDocument of value) {
        const document = ensureEditorDocument(rawDocument);
        if (validateLevelDocument(document).length > 0 || ids.has(document.metadata.id)) continue;
        documents.push(document);
        ids.add(document.metadata.id);
      }
    } catch {
      // Invalid or unsupported browser data is ignored without affecting other documents.
    }
  }
  return documents;
}

function pointInBounds(point, bounds, padding = 0) {
  return point.x >= bounds.x - padding
    && point.x <= bounds.x + bounds.w + padding
    && point.y >= bounds.y - padding
    && point.y <= bounds.y + bounds.h + padding;
}

function drawHexagon(ctx, x, y, radius) {
  ctx.beginPath();
  for (let side = 0; side < 6; side += 1) {
    const angle = side / 6 * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (side === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function createLevelEditor({ root, sourceLevels, onPlay, onSavedLevelsChange }) {
  const canvas = root.querySelector("#editor-canvas");
  const ctx = canvas.getContext("2d");
  const objectPanel = root.querySelector("#object-panel");
  const supportPanel = root.querySelector("#support-panel");
  const assetPanel = root.querySelector("#asset-panel");
  const scenePanel = root.querySelector("#scene-panel");
  const library = root.querySelector("#object-library");
  const supportList = root.querySelector("#support-list");
  const supportWarningSummary = root.querySelector("#support-warning-summary");
  const assetLibrary = root.querySelector("#asset-library");
  const assetSearch = root.querySelector("#asset-search");
  const assetCategory = root.querySelector("#asset-category");
  const assetCompatibleOnly = root.querySelector("#asset-compatible-only");
  const sceneLayerList = root.querySelector("#scene-layer-list");
  const inspector = root.querySelector("#object-inspector");
  const status = root.querySelector("#editor-status");
  const documentSelect = root.querySelector("#editor-document-select");
  const fileInput = root.querySelector("#editor-file-input");
  const generatorPanel = root.querySelector("#generator-panel");
  const generatorSeed = root.querySelector("#generator-seed");
  const generatorLength = root.querySelector("#generator-length");
  const generatorDifficulty = root.querySelector("#generator-difficulty");
  const snapInput = root.querySelector("#editor-snap");
  const objectSearch = root.querySelector("#object-search");
  const builtInDocuments = new Map(sourceLevels.map((level) => [level.id, ensureEditorDocument(levelToDocument(level))]));
  let savedDocuments = readStoredDocuments();
  let activeDocument = ensureEditorDocument(createBlankLevelDocument());
  let selectedId = null;
  let selectedLayerId = activeDocument.scene.layers.find((layer) => layer.role === "player")?.id || null;
  let selectedAssetId = PROCEDURAL_ASSET_ID;
  let editorMode = "objects";
  let hasOpened = false;
  let placingType = null;
  let dragState = null;
  let panState = null;
  let histories = [clone(activeDocument)];
  let historyIndex = 0;
  let statusTimer = 0;
  let view = { x: 800, y: 400, zoom: 0.72 };
  const assetRegistry = DEFAULT_ASSET_REGISTRY;
  let assetRecords = assetRegistry.assets.map(normalizeAssetRecord).filter(Boolean);
  const imageCache = new Map();
  const tintCache = new Map();

  function selectedObject() {
    return activeDocument.objects.find((object) => object.id === selectedId) || null;
  }

  function selectedLayer() {
    return activeDocument.scene?.layers?.find((layer) => layer.id === selectedLayerId) || null;
  }

  function assetRecord(assetId) {
    return assetRecords.find((asset) => asset.id === assetId)
      || normalizeAssetRecord(getAssetById(assetRegistry, assetId));
  }

  function assetAppliesTo(asset, type) {
    return isAssetApplicable(asset, type);
  }

  function typeDefaultAsset(type) {
    return assetRecord(getTypeDefaultAssetId(type, assetRegistry));
  }

  function resolvedObjectAsset(object) {
    const unavailableAssetIds = [...imageCache]
      .filter(([, entry]) => entry.state === "error")
      .map(([assetId]) => assetId);
    const resolved = resolveObjectVisual(object, assetRegistry, { unavailableAssetIds });
    return assetRecord(resolved.assetId) || typeDefaultAsset(object.type);
  }

  function imageForAsset(asset) {
    if (!asset?.src) return null;
    if (imageCache.has(asset.id)) return imageCache.get(asset.id);
    const entry = { state: "loading", image: null };
    imageCache.set(asset.id, entry);
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      entry.state = "ready";
      entry.image = image;
      renderAssetLibrary();
      renderInspector();
      render();
    }, { once: true });
    image.addEventListener("error", () => {
      entry.state = "error";
      renderAssetLibrary();
      renderInspector();
      render();
    }, { once: true });
    image.src = asset.src;
    return entry;
  }

  function updateModeChrome() {
    objectPanel.hidden = editorMode !== "objects";
    supportPanel.hidden = editorMode !== "support";
    assetPanel.hidden = editorMode !== "assets";
    scenePanel.hidden = editorMode !== "scene";
    const supportWarningCount = analyzeLevelAbilitySupport(activeDocument).warnings.length;
    for (const button of root.querySelectorAll(".editor-mode-tabs [data-mode]")) {
      const active = button.dataset.mode === editorMode;
      button.dataset.active = String(active);
      button.setAttribute("aria-pressed", String(active));
      if (button.dataset.mode === "support") {
        button.dataset.warning = String(supportWarningCount > 0);
        button.title = supportWarningCount ? `${supportWarningCount} 项能力覆盖提示` : "开局能力与机制覆盖正常";
      }
    }
    root.querySelector("#editor-mode-label").textContent = EDITOR_MODE_LABELS[editorMode];
    root.querySelector("#editor-canvas-help").textContent = editorMode === "scene"
      ? "场景实时预览 · 滚轮缩放 · 左键、右键或 ⌥ 拖动画布"
      : editorMode === "assets"
        ? "左键选择物件 · 素材加载失败时显示程序化回退 · 滚轮缩放"
        : editorMode === "support"
          ? "能力支持只改变开局能力 · 玩法物件与碰撞保持不变"
          : "左键选择/拖动 · 滚轮缩放 · 右键或 ⌥ 拖动画布";
  }

  function setEditorMode(mode) {
    if (!EDITOR_MODE_LABELS[mode]) return;
    editorMode = mode;
    if (mode !== "objects") placingType = null;
    if (mode === "assets" && selectedObject()) selectedAssetId = configuredObjectVisual(selectedObject()).assetId;
    if (mode === "scene" && selectedLayer()?.assets?.[0]?.assetId) selectedAssetId = selectedLayer().assets[0].assetId;
    updateModeChrome();
    renderLibrary();
    renderSupportPanel();
    renderAssetLibrary();
    renderSceneLayers();
    renderInspector();
    updateToolbarState();
    render();
  }

  function defaultStatusText() {
    if (placingType) return `放置模式 · ${LEVEL_OBJECT_LIBRARY[placingType].label}`;
    if (editorMode === "support") return "设置出生即用能力，并检查能力物件覆盖警告";
    if (editorMode === "assets") return "选择物件和素材后可单独或同类型批量应用";
    if (editorMode === "scene") return "场景图层与关卡文档共同保存，玩家基准层受保护";
    return "选择物件后可拖动，滚轮缩放画布";
  }

  function setStatus(message, tone = "normal") {
    status.textContent = message;
    status.dataset.tone = tone;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = defaultStatusText();
      status.dataset.tone = "normal";
    }, 2600);
  }

  function notifySavedLevels() {
    const compiled = [];
    for (const document of savedDocuments) {
      try {
        const level = compileLevelDocument(document);
        if (validateLevel(level).length === 0) compiled.push(level);
      } catch {
        // Invalid browser data is intentionally excluded from the playable list.
      }
    }
    onSavedLevelsChange?.(compiled);
  }

  function persistDocuments() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedDocuments));
    notifySavedLevels();
    renderDocumentSelect();
  }

  function pushHistory() {
    histories = histories.slice(0, historyIndex + 1);
    histories.push(clone(activeDocument));
    if (histories.length > 60) histories.shift();
    historyIndex = histories.length - 1;
    updateToolbarState();
  }

  function restoreHistory(nextIndex) {
    if (nextIndex < 0 || nextIndex >= histories.length) return;
    historyIndex = nextIndex;
    activeDocument = ensureEditorDocument(clone(histories[historyIndex]));
    if (!activeDocument.objects.some((object) => object.id === selectedId)) selectedId = null;
    if (!activeDocument.scene.layers.some((layer) => layer.id === selectedLayerId)) {
      selectedLayerId = activeDocument.scene.layers.find((layer) => layer.role === "player")?.id || activeDocument.scene.layers[0]?.id || null;
    }
    renderLibrary();
    renderSupportPanel();
    renderAssetLibrary();
    renderSceneLayers();
    renderInspector();
    updateToolbarState();
    render();
  }

  function resetHistory() {
    histories = [clone(activeDocument)];
    historyIndex = 0;
    updateToolbarState();
  }

  function commitMutation(callback) {
    callback();
    pushHistory();
    renderLibrary();
    renderSupportPanel();
    renderAssetLibrary();
    renderSceneLayers();
    renderInspector();
    updateToolbarState();
    render();
  }

  function snap(value) {
    return snapInput.checked ? Math.round(value / GRID_SIZE) * GRID_SIZE : Math.round(value);
  }

  function resizeCanvas() {
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    render();
  }

  function canvasSize() {
    const bounds = canvas.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }

  function worldToScreen(x, y) {
    const size = canvasSize();
    return {
      x: size.width / 2 + (x - view.x) * view.zoom,
      y: size.height / 2 + (y - view.y) * view.zoom
    };
  }

  function screenToWorld(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    const size = canvasSize();
    return {
      x: view.x + (clientX - bounds.left - size.width / 2) / view.zoom,
      y: view.y + (clientY - bounds.top - size.height / 2) / view.zoom
    };
  }

  function fitView() {
    const bounds = activeDocument.bounds;
    const size = canvasSize();
    view.x = bounds.x + bounds.w / 2;
    view.y = bounds.y + bounds.h / 2;
    view.zoom = Math.max(0.08, Math.min(1.4, Math.min(
      (size.width - 80) / bounds.w,
      (size.height - 80) / bounds.h
    )));
    render();
  }

  function drawGrid(size) {
    const topLeft = screenToWorld(canvas.getBoundingClientRect().left, canvas.getBoundingClientRect().top);
    const bottomRight = screenToWorld(canvas.getBoundingClientRect().right, canvas.getBoundingClientRect().bottom);
    const step = view.zoom < 0.25 ? GRID_SIZE * 5 : GRID_SIZE;
    ctx.save();
    ctx.strokeStyle = "rgba(121, 231, 226, 0.075)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
      const screen = worldToScreen(x, 0);
      ctx.moveTo(Math.round(screen.x) + 0.5, 0);
      ctx.lineTo(Math.round(screen.x) + 0.5, size.height);
    }
    for (let y = Math.floor(topLeft.y / step) * step; y <= bottomRight.y; y += step) {
      const screen = worldToScreen(0, y);
      ctx.moveTo(0, Math.round(screen.y) + 0.5);
      ctx.lineTo(size.width, Math.round(screen.y) + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRectObject(object, fillAlpha = "26", strokeAlpha = "aa") {
    const p = object.properties;
    ctx.fillStyle = `${LEVEL_OBJECT_LIBRARY[object.type].color}${fillAlpha}`;
    ctx.strokeStyle = `${LEVEL_OBJECT_LIBRARY[object.type].color}${strokeAlpha}`;
    ctx.lineWidth = 2 / view.zoom;
    ctx.fillRect(object.position.x, object.position.y, p.w, p.h);
    ctx.strokeRect(object.position.x, object.position.y, p.w, p.h);
  }

  function drawProceduralObject(object) {
    const { x, y } = object.position;
    const p = object.properties;
    const definition = LEVEL_OBJECT_LIBRARY[object.type];
    ctx.save();
    ctx.font = `${Math.max(11, 12 / view.zoom)}px ui-monospace, monospace`;
    ctx.lineWidth = 2 / view.zoom;
    if (object.type === "movingObject") {
      const points = parseMotionPath(p.pathPoints)
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({ x: x + point.x, y: y + point.y }));
      if (points.length > 1) {
        ctx.strokeStyle = `${definition.color}99`;
        ctx.setLineDash([10 / view.zoom, 8 / view.zoom]);
        ctx.beginPath();
        points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
        if (p.loopMode === "loop") ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (["platform", "hazard"].includes(p.objectKind)) drawRectObject(object, "36", "dd");
      else {
        ctx.fillStyle = `${definition.color}55`;
        ctx.strokeStyle = definition.color;
        ctx.beginPath();
        ctx.arc(x, y, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (object.type === "boundaryWall") {
      ctx.setLineDash([12 / view.zoom, 8 / view.zoom]);
      drawRectObject(object, "18", "dd");
      ctx.setLineDash([]);
      ctx.strokeStyle = definition.color;
      ctx.lineWidth = 4 / view.zoom;
      ctx.beginPath();
      if (p.blockingSide === "left") {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + p.h);
      } else if (p.blockingSide === "right") {
        ctx.moveTo(x + p.w, y);
        ctx.lineTo(x + p.w, y + p.h);
      } else if (p.blockingSide === "top") {
        ctx.moveTo(x, y);
        ctx.lineTo(x + p.w, y);
      } else if (p.blockingSide === "bottom") {
        ctx.moveTo(x, y + p.h);
        ctx.lineTo(x + p.w, y + p.h);
      }
      if (p.blockingSide !== "all") ctx.stroke();
    } else if (object.type === "platform") {
      drawRectObject(object, "42", "bb");
      ctx.fillStyle = `${definition.color}77`;
      ctx.fillRect(x, y, p.w, 4 / view.zoom);
    } else if (object.type === "hazard") {
      drawRectObject(object, "38", "dd");
      ctx.fillStyle = `${definition.color}aa`;
      const count = Math.max(1, Math.round(p.w / 28));
      ctx.beginPath();
      ctx.moveTo(x, y + p.h);
      for (let index = 0; index < count; index += 1) {
        const unit = p.w / count;
        ctx.lineTo(x + index * unit + unit * 0.5, y);
        ctx.lineTo(x + (index + 1) * unit, y + p.h);
      }
      ctx.fill();
    } else if (["windZone", "liquidZone", "darknessZone", "checkpoint", "roomEntrance", "roomExit", "rotationTrigger", "launcher", "fragilePlatform", "gate", "stateTrigger"].includes(object.type)) {
      ctx.setLineDash([12 / view.zoom, 8 / view.zoom]);
      drawRectObject(object, "20", "bb");
      ctx.setLineDash([]);
    } else if (object.type === "slope") {
      ctx.strokeStyle = definition.color;
      ctx.lineWidth = Math.max(3 / view.zoom, p.thickness);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + p.dx, y + p.dy);
      ctx.stroke();
    } else if (object.type === "backgroundSeed") {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = definition.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (object.type === "goal") {
      ctx.strokeStyle = definition.color;
      ctx.fillStyle = `${definition.color}24`;
      ctx.lineWidth = 4 / view.zoom;
      ctx.beginPath();
      ctx.arc(x, y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (object.type === "spawn") {
      ctx.strokeStyle = definition.color;
      ctx.fillStyle = `${definition.color}40`;
      ctx.beginPath();
      ctx.moveTo(x, y - 24);
      ctx.lineTo(x + 20, y + 16);
      ctx.lineTo(x - 20, y + 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (object.type === "bashTarget") {
      ctx.strokeStyle = definition.color;
      ctx.fillStyle = `${definition.color}40`;
      drawHexagon(ctx, x, y, 18);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = `${definition.color}55`;
      ctx.strokeStyle = definition.color;
      ctx.beginPath();
      ctx.arc(x, y, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (view.zoom >= 0.34 && object.type !== "backgroundSeed") {
      const rectangular = ["boundaryWall", "platform", "movingObject", "launcher", "fragilePlatform", "gate", "stateTrigger"].includes(object.type);
      const labelX = rectangular ? x + 7 : x + 20 / view.zoom;
      const labelY = rectangular ? y + 18 / view.zoom : y - 10 / view.zoom;
      ctx.fillStyle = "rgba(230, 255, 252, 0.78)";
      ctx.fillText(definition.label, labelX, labelY);
    }
    ctx.restore();
  }

  function configuredObjectVisual(object) {
    const typeDefault = getTypeDefaultAssetId(object.type, assetRegistry);
    try {
      return createVisualConfig(object.properties?.visual || { assetId: typeDefault });
    } catch {
      return createVisualConfig({ assetId: typeDefault });
    }
  }

  function tintedImageSource(asset, image, tint) {
    if (!tint || tint.toLowerCase() === "#ffffff" || tint.toLowerCase() === "#ffffffff") return image;
    const key = `${asset.id}:${tint}`;
    if (tintCache.has(key)) return tintCache.get(key);
    const width = Math.max(1, image.naturalWidth || image.width || 1);
    const height = Math.max(1, image.naturalHeight || image.height || 1);
    const buffer = documentBody().createElement("canvas");
    buffer.width = width;
    buffer.height = height;
    const bufferContext = buffer.getContext("2d");
    bufferContext.drawImage(image, 0, 0, width, height);
    bufferContext.globalCompositeOperation = "source-atop";
    bufferContext.globalAlpha = 0.42;
    bufferContext.fillStyle = tint;
    bufferContext.fillRect(0, 0, width, height);
    tintCache.set(key, buffer);
    return buffer;
  }

  function drawImageVisual(asset, visual, bounds) {
    const entry = imageForAsset(asset);
    if (!entry || entry.state !== "ready" || !entry.image) return false;
    const width = Math.max(1, bounds.w * visual.scaleX);
    const height = Math.max(1, bounds.h * visual.scaleY);
    const anchorX = bounds.x + bounds.w / 2 + visual.offsetX;
    const anchorY = bounds.y + bounds.h / 2 + visual.offsetY;
    const source = tintedImageSource(asset, entry.image, visual.tint);
    ctx.save();
    ctx.globalAlpha = visual.opacity;
    ctx.translate(anchorX, anchorY);
    ctx.scale(visual.flipX ? -1 : 1, visual.flipY ? -1 : 1);
    const result = drawScaledAssetImage(ctx, source, asset, visual, {
      x: -width * visual.anchorX,
      y: -height * visual.anchorY,
      width,
      height
    });
    ctx.restore();
    return result.drawn;
  }

  function createInspectorVisualCanvas(selected, asset, entry, visual) {
    const previewCanvas = documentBody().createElement("canvas");
    const previewWidth = 440;
    const previewHeight = 224;
    previewCanvas.width = previewWidth;
    previewCanvas.height = previewHeight;
    previewCanvas.setAttribute("aria-label", `${asset.name} 实时视觉配置预览`);
    const previewContext = previewCanvas.getContext("2d");
    const bounds = getLevelObjectBounds(selected);
    const configuredWidth = Math.max(1, bounds.w * visual.scaleX);
    const configuredHeight = Math.max(1, bounds.h * visual.scaleY);
    const extentWidth = Math.max(bounds.w, configuredWidth + Math.abs(visual.offsetX) * 2);
    const extentHeight = Math.max(bounds.h, configuredHeight + Math.abs(visual.offsetY) * 2);
    const previewScale = Math.min(
      (previewWidth - 72) / Math.max(1, extentWidth),
      (previewHeight - 54) / Math.max(1, extentHeight),
      5
    );
    const centerX = previewWidth / 2;
    const centerY = previewHeight / 2;
    const collisionWidth = bounds.w * previewScale;
    const collisionHeight = bounds.h * previewScale;
    previewContext.save();
    previewContext.strokeStyle = "rgba(139, 236, 231, 0.42)";
    previewContext.lineWidth = 2;
    previewContext.setLineDash([8, 6]);
    previewContext.strokeRect(
      centerX - collisionWidth / 2,
      centerY - collisionHeight / 2,
      collisionWidth,
      collisionHeight
    );
    previewContext.restore();
    const source = tintedImageSource(asset, entry.image, visual.tint);
    previewContext.save();
    previewContext.globalAlpha = visual.opacity;
    previewContext.translate(
      centerX + visual.offsetX * previewScale,
      centerY + visual.offsetY * previewScale
    );
    // Plan in world units and scale the context like the main canvas so
    // nine-slice borders and tile cadence keep the same proportions here.
    previewContext.scale(
      previewScale * (visual.flipX ? -1 : 1),
      previewScale * (visual.flipY ? -1 : 1)
    );
    const result = drawScaledAssetImage(previewContext, source, asset, visual, {
      x: -configuredWidth * visual.anchorX,
      y: -configuredHeight * visual.anchorY,
      width: configuredWidth,
      height: configuredHeight
    });
    if (result.plan?.resolvedMode === "nine-slice" && result.plan.guides) {
      previewContext.strokeStyle = "rgba(255, 230, 135, 0.68)";
      previewContext.lineWidth = 1 / previewScale;
      previewContext.setLineDash([4 / previewScale, 3 / previewScale]);
      previewContext.beginPath();
      for (const guideX of result.plan.guides.vertical) {
        previewContext.moveTo(guideX, result.plan.target.y);
        previewContext.lineTo(guideX, result.plan.target.y + result.plan.target.height);
      }
      for (const guideY of result.plan.guides.horizontal) {
        previewContext.moveTo(result.plan.target.x, guideY);
        previewContext.lineTo(result.plan.target.x + result.plan.target.width, guideY);
      }
      previewContext.stroke();
    }
    previewContext.restore();
    return previewCanvas;
  }

  function drawObjectAssetLabel(object) {
    if (view.zoom < 0.34) return;
    const definition = LEVEL_OBJECT_LIBRARY[object.type];
    const bounds = getLevelObjectBounds(object);
    ctx.save();
    ctx.font = `${Math.max(11, 12 / view.zoom)}px ui-monospace, monospace`;
    ctx.fillStyle = "rgba(230, 255, 252, 0.84)";
    ctx.fillText(definition.label, bounds.x + 7 / view.zoom, bounds.y + 17 / view.zoom);
    ctx.restore();
  }

  function drawObject(object) {
    const asset = resolvedObjectAsset(object);
    const visual = configuredObjectVisual(object);
    const drawn = asset?.kind === "image" && drawImageVisual(asset, visual, getLevelObjectBounds(object));
    if (!drawn) drawProceduralObject(object);
    else drawObjectAssetLabel(object);
  }

  function sceneBaselineY() {
    const size = canvasSize();
    return view.y + size.height / (2 * view.zoom);
  }

  function drawProceduralScenePlacement(layer, placement, drawX, baselineY) {
    const width = Math.max(44, Math.min(placement.width, 520));
    const height = width * (layer.role === "background" ? 1.35 : layer.role === "foreground" ? 0.72 : 0.96);
    ctx.save();
    ctx.translate(drawX + width / 2, baselineY);
    if (placement.flipX) ctx.scale(-1, 1);
    if (layer.role === "foreground") {
      ctx.strokeStyle = "rgba(7, 26, 28, 0.72)";
      ctx.lineWidth = Math.max(8, width * 0.035);
      ctx.beginPath();
      ctx.moveTo(-width * 0.52, height * 0.12);
      ctx.bezierCurveTo(-width * 0.18, -height * 0.28, width * 0.2, height * 0.28, width * 0.54, -height * 0.08);
      ctx.stroke();
    } else {
      const alpha = layer.role === "background" ? 0.2 : 0.36;
      ctx.fillStyle = `rgba(25, 85, 82, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(-width * 0.16, 0);
      ctx.lineTo(-width * 0.1, -height);
      ctx.lineTo(width * 0.08, -height * 0.96);
      ctx.lineTo(width * 0.17, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = `rgba(63, 146, 126, ${alpha * 0.72})`;
      ctx.beginPath();
      ctx.arc(-width * 0.18, -height * 0.72, width * 0.22, 0, Math.PI * 2);
      ctx.arc(width * 0.13, -height * 0.63, width * 0.27, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSceneLayer(layer) {
    const proceduralOnly = layer.assets.every((reference) => reference.assetId === PROCEDURAL_ASSET_ID);
    if (!layer.visible || (proceduralOnly && editorMode !== "scene")) return;
    const size = canvasSize();
    let placementResult;
    try {
      placementResult = calculateSeamlessPlacements(layer, {
        cameraX: view.x,
        viewportWidth: Math.max(1, size.width / view.zoom),
        overscan: Math.max(80, 180 / view.zoom),
        maxDraws: 64
      });
    } catch {
      return;
    }
    const baselineY = sceneBaselineY();
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.filter = layer.blur > 0 ? `blur(${layer.blur / Math.max(0.25, view.zoom)}px)` : "none";
    for (const placement of placementResult.placements) {
      const drawX = placement.x + view.x * (1 - layer.parallax);
      const resolved = resolveAssetReference(placement.assetId, "scene", assetRegistry, {
        unavailableAssetIds: [...imageCache]
          .filter(([, entry]) => entry.state === "error")
          .map(([assetId]) => assetId)
      });
      const asset = assetRecord(resolved.assetId);
      const entry = asset?.kind === "image" ? imageForAsset(asset) : null;
      if (entry?.state === "ready" && entry.image) {
        const source = tintedImageSource(asset, entry.image, layer.tint);
        const width = placement.width;
        const naturalWidth = asset.width || entry.image.naturalWidth || width;
        const naturalHeight = asset.height || entry.image.naturalHeight || width * 0.7;
        const height = Math.max(1, width * naturalHeight / Math.max(1, naturalWidth));
        ctx.save();
        ctx.translate(drawX + width / 2, baselineY);
        if (placement.flipX) ctx.scale(-1, 1);
        ctx.drawImage(source, -width / 2, -height, width, height);
        ctx.restore();
      } else if (layer.role !== "player") {
        drawProceduralScenePlacement(layer, placement, drawX, baselineY);
      }
    }
    ctx.filter = "none";
    if (layer.fog > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(0.34, layer.fog * 0.26);
      ctx.fillStyle = layer.tint;
      const viewportWidth = size.width / view.zoom;
      const viewportHeight = size.height / view.zoom;
      ctx.fillRect(
        view.x - viewportWidth / 2,
        view.y - viewportHeight / 2,
        viewportWidth,
        viewportHeight
      );
    }
    if (editorMode === "scene" && layer.id === selectedLayerId) {
      ctx.globalAlpha = 0.68;
      ctx.strokeStyle = "rgba(255, 236, 158, 0.72)";
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.setLineDash([10 / view.zoom, 8 / view.zoom]);
      ctx.beginPath();
      ctx.moveTo(activeDocument.bounds.x, baselineY);
      ctx.lineTo(activeDocument.bounds.x + activeDocument.bounds.w, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255, 239, 175, 0.84)";
      ctx.font = `${Math.max(10, 11 / view.zoom)}px ui-monospace, monospace`;
      ctx.fillText(`${layer.name} · depth ${layer.depth}`, activeDocument.bounds.x + 12 / view.zoom, baselineY - 8 / view.zoom);
    }
    ctx.restore();
  }

  function render() {
    if (root.hidden) return;
    const size = canvasSize();
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#071720";
    ctx.fillRect(0, 0, size.width, size.height);
    drawGrid(size);
    ctx.save();
    const origin = worldToScreen(0, 0);
    ctx.translate(origin.x, origin.y);
    ctx.scale(view.zoom, view.zoom);
    const bounds = activeDocument.bounds;
    ctx.fillStyle = "rgba(19, 66, 75, 0.12)";
    ctx.strokeStyle = "rgba(126, 243, 255, 0.26)";
    ctx.lineWidth = 2 / view.zoom;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    const sceneLayers = [...(activeDocument.scene?.layers || [])]
      .filter((layer) => layer.visible)
      .sort((left, right) => left.depth - right.depth);
    for (const layer of sceneLayers.filter((item) => item.depth <= 0)) drawSceneLayer(layer);
    const orderedObjects = activeDocument.objects
      .map((object, index) => ({ object, index, layer: configuredObjectVisual(object).drawLayer }))
      .sort((left, right) => left.layer - right.layer || left.index - right.index)
      .map(({ object }) => object);
    for (const object of orderedObjects) drawObject(object);
    for (const layer of sceneLayers.filter((item) => item.depth > 0)) drawSceneLayer(layer);
    const selected = selectedObject();
    if (selected) {
      const objectBounds = getLevelObjectBounds(selected);
      ctx.strokeStyle = "#fff2a6";
      ctx.lineWidth = 2 / view.zoom;
      ctx.setLineDash([8 / view.zoom, 5 / view.zoom]);
      ctx.strokeRect(objectBounds.x - 7 / view.zoom, objectBounds.y - 7 / view.zoom, objectBounds.w + 14 / view.zoom, objectBounds.h + 14 / view.zoom);
    }
    ctx.restore();
    root.querySelector("#editor-zoom-label").textContent = `${Math.round(view.zoom * 100)}%`;
    root.querySelector("#editor-object-count").textContent = `${activeDocument.objects.length} 个物件 · ${activeDocument.scene?.layers?.length || 0} 图层`;
  }

  function renderLibrary() {
    const query = objectSearch.value.trim().toLowerCase();
    library.replaceChildren();
    for (const category of LEVEL_OBJECT_CATEGORIES) {
      const entries = Object.entries(LEVEL_OBJECT_LIBRARY).filter(([type, definition]) => (
        definition.category === category.id
        && (!query || definition.label.toLowerCase().includes(query) || type.toLowerCase().includes(query))
      ));
      if (!entries.length) continue;
      const group = documentBody().createElement("section");
      group.className = "library-group";
      const title = documentBody().createElement("h3");
      title.textContent = category.label;
      group.append(title);
      for (const [type, definition] of entries) {
        const button = documentBody().createElement("button");
        button.type = "button";
        button.className = "library-item";
        button.dataset.active = String(type === placingType);
        button.innerHTML = `<span class="library-swatch" style="--swatch:${definition.color}"></span><span>${definition.label}</span><small>${type}</small>`;
        button.addEventListener("click", () => {
          placingType = placingType === type ? null : type;
          selectedId = null;
          renderLibrary();
          renderInspector();
          setStatus(placingType ? `点击画布放置 · ${definition.label}` : "已退出放置模式");
          render();
        });
        group.append(button);
      }
      library.append(group);
    }
  }

  function renderSupportPanel() {
    if (!supportList || !supportWarningSummary) return;
    const analysis = analyzeLevelAbilitySupport(activeDocument);
    const modeButton = root.querySelector("#editor-mode-support");
    modeButton.dataset.warning = String(analysis.warnings.length > 0);
    modeButton.title = analysis.warnings.length ? `${analysis.warnings.length} 项能力覆盖提示` : "开局能力与机制覆盖正常";
    const warningAbilityIds = new Set(analysis.warnings.map((warning) => warning.abilityId));
    supportList.replaceChildren();
    for (const item of analysis.coverage) {
      const row = documentBody().createElement("label");
      row.className = "support-ability-row";
      row.dataset.enabled = String(item.enabledAtStart);
      row.dataset.warning = String(warningAbilityIds.has(item.abilityId));
      const input = documentBody().createElement("input");
      input.type = "checkbox";
      input.checked = item.enabledAtStart;
      input.dataset.abilityId = item.abilityId;
      input.addEventListener("change", () => {
        commitMutation(() => {
          activeDocument = setStartingAbility(activeDocument, item.abilityId, input.checked);
        });
        setStatus(`${item.label}已${input.checked ? "加入" : "移出"}开局能力`, "success");
      });
      const copy = documentBody().createElement("span");
      copy.className = "support-ability-copy";
      const name = documentBody().createElement("strong");
      name.textContent = item.label;
      const detail = documentBody().createElement("small");
      const mechanismText = item.requirementSources.length ? ` · ${item.requirementSources.length} 处相关机制` : "";
      detail.textContent = `${item.input} · ${item.description}${mechanismText}`;
      copy.append(name, detail);
      const badge = documentBody().createElement("span");
      badge.className = "support-ability-badge";
      badge.textContent = item.enabledAtStart
        ? "开局可用"
        : item.pickupIds.length
          ? "关内获取"
          : item.required
            ? "未覆盖"
            : "未启用";
      row.append(input, copy, badge);
      supportList.append(row);
    }
    supportWarningSummary.dataset.tone = analysis.warnings.length ? "warning" : "normal";
    supportWarningSummary.textContent = analysis.warnings.length
      ? `${analysis.warnings.length} 项能力覆盖提示 · ${analysis.warnings.map((warning) => warning.message).join(" ")}`
      : `能力覆盖正常 · ${analysis.startingAbilities.length}/${LEVEL_SUPPORT_ABILITY_IDS.length} 项出生即用`;
  }

  function renderAssetCategoryOptions() {
    const current = assetCategory.value || "all";
    const categories = [...new Set(assetRecords.map((asset) => asset.category))].sort();
    assetCategory.replaceChildren();
    const all = documentBody().createElement("option");
    all.value = "all";
    all.textContent = "全部分类";
    assetCategory.append(all);
    for (const category of categories) {
      const option = documentBody().createElement("option");
      option.value = category;
      option.textContent = ASSET_CATEGORY_LABELS[category] || category;
      assetCategory.append(option);
    }
    assetCategory.value = [...assetCategory.options].some((option) => option.value === current) ? current : "all";
  }

  function appendFallbackThumbnail(container, objectType = null) {
    const glyph = documentBody().createElement("span");
    glyph.className = "asset-fallback-glyph";
    glyph.style.setProperty("--fallback-color", LEVEL_OBJECT_LIBRARY[objectType]?.color || "#63dcd4");
    container.append(glyph);
  }

  function renderAssetLibrary() {
    if (!assetLibrary) return;
    if (editorMode !== "assets") {
      assetLibrary.replaceChildren();
      return;
    }
    const selected = selectedObject();
    const filtered = searchAssets(assetRegistry, {
      query: assetSearch.value,
      category: assetCategory.value === "all" ? null : assetCategory.value,
      objectType: assetCompatibleOnly.checked && selected ? selected.type : null
    }).map(normalizeAssetRecord).filter(Boolean);
    assetLibrary.replaceChildren();
    if (!filtered.length) {
      const empty = documentBody().createElement("p");
      empty.className = "asset-empty-state";
      empty.textContent = selected
        ? "没有匹配当前物件类型的素材；可清空搜索或关闭适用类型过滤。"
        : "没有匹配的素材；先在画布选择一个物件可按适用类型筛选。";
      assetLibrary.append(empty);
      return;
    }
    for (const asset of filtered) {
      const compatible = !selected || assetAppliesTo(asset, selected.type);
      const button = documentBody().createElement("button");
      button.type = "button";
      button.className = "asset-card";
      button.dataset.selected = String(asset.id === selectedAssetId);
      button.dataset.compatible = String(compatible);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(asset.id === selectedAssetId));
      const thumbnail = documentBody().createElement("span");
      thumbnail.className = "asset-thumbnail";
      if (asset.kind === "image" && (asset.thumbnailSrc || asset.src)) {
        const image = documentBody().createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.src = asset.thumbnailSrc || asset.src;
        image.addEventListener("error", () => {
          image.remove();
          appendFallbackThumbnail(thumbnail, selected?.type);
        }, { once: true });
        thumbnail.append(image);
      } else {
        appendFallbackThumbnail(thumbnail, selected?.type);
      }
      const copy = documentBody().createElement("span");
      copy.className = "asset-card-copy";
      const name = documentBody().createElement("strong");
      name.textContent = asset.name;
      const id = documentBody().createElement("small");
      id.textContent = asset.id;
      const types = documentBody().createElement("span");
      types.className = "asset-card-types";
      const scaling = assetScalingProfile(asset);
      const scaleLabel = scaling.defaultMode === "nine-slice" ? "九宫格" : scaling.defaultMode === "tile" ? "平铺" : "拉伸";
      types.textContent = `${asset.applicableTypes.includes("*") ? "适用：全部类型" : `适用：${asset.applicableTypes.join(" · ")}`} · ${scaleLabel}`;
      copy.append(name, id, types);
      button.append(thumbnail, copy);
      button.title = compatible ? asset.description || asset.name : `不适用于 ${selected?.type}`;
      button.addEventListener("click", () => {
        selectedAssetId = asset.id;
        renderAssetLibrary();
        renderInspector();
        updateToolbarState();
      });
      assetLibrary.append(button);
    }
  }

  function renderSceneLayers() {
    if (!sceneLayerList) return;
    sceneLayerList.replaceChildren();
    for (const layer of activeDocument.scene?.layers || []) {
      const row = documentBody().createElement("div");
      row.className = "scene-layer-item";
      row.dataset.active = String(layer.id === selectedLayerId);
      row.dataset.visible = String(layer.visible);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(layer.id === selectedLayerId));
      row.tabIndex = 0;
      const visibility = documentBody().createElement("button");
      visibility.type = "button";
      visibility.className = "scene-layer-toggle";
      visibility.textContent = layer.visible ? "◉" : "○";
      visibility.title = layer.visible ? "隐藏图层" : "显示图层";
      visibility.setAttribute("aria-label", `${layer.visible ? "隐藏" : "显示"}${layer.name}`);
      visibility.addEventListener("click", (event) => {
        event.stopPropagation();
        commitMutation(() => {
          activeDocument.scene = updateSceneLayer(activeDocument.scene, layer.id, { visible: !layer.visible }, { force: true });
        });
      });
      const lock = documentBody().createElement("button");
      lock.type = "button";
      lock.className = "scene-layer-toggle";
      lock.textContent = layer.locked ? "◆" : "◇";
      lock.title = layer.locked ? "解锁图层" : "锁定图层";
      lock.setAttribute("aria-label", `${layer.locked ? "解锁" : "锁定"}${layer.name}`);
      lock.addEventListener("click", (event) => {
        event.stopPropagation();
        commitMutation(() => {
          activeDocument.scene = updateSceneLayer(activeDocument.scene, layer.id, { locked: !layer.locked });
        });
      });
      const copy = documentBody().createElement("span");
      copy.className = "scene-layer-copy";
      const name = documentBody().createElement("strong");
      name.textContent = layer.name;
      const role = documentBody().createElement("small");
      role.textContent = `${SCENE_ROLE_LABELS[layer.role] || layer.role} · ${layer.assets.length} 素材`;
      copy.append(name, role);
      const depth = documentBody().createElement("span");
      depth.className = isProtectedPlayerLayer(layer) ? "scene-player-badge" : "scene-depth";
      depth.textContent = isProtectedPlayerLayer(layer) ? "基准" : String(layer.depth);
      const select = () => {
        selectedLayerId = layer.id;
        renderSceneLayers();
        renderInspector();
        updateToolbarState();
        render();
      };
      row.addEventListener("click", select);
      row.addEventListener("keydown", (event) => {
        if (event.code === "Enter" || event.code === "Space") {
          event.preventDefault();
          select();
        }
      });
      row.append(visibility, lock, copy, depth);
      sceneLayerList.append(row);
    }
  }

  function fieldRow(labelText, input) {
    const label = documentBody().createElement("label");
    label.className = "inspector-field";
    const text = documentBody().createElement("span");
    text.textContent = labelText;
    label.append(text, input);
    return label;
  }

  function fieldRowWithReset(labelText, input, onReset) {
    const row = documentBody().createElement("div");
    row.className = "inspector-field-row";
    row.append(fieldRow(labelText, input));
    const reset = documentBody().createElement("button");
    reset.type = "button";
    reset.className = "field-reset";
    reset.title = `重置${labelText}`;
    reset.setAttribute("aria-label", `重置${labelText}`);
    reset.textContent = "↺";
    reset.addEventListener("click", onReset);
    row.append(reset);
    return row;
  }

  function makeInput(value, onChange, options = {}) {
    const input = documentBody().createElement("input");
    input.type = options.type || "text";
    input.value = value ?? "";
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    if (options.placeholder !== undefined) input.placeholder = options.placeholder;
    input.disabled = Boolean(options.disabled);
    input.addEventListener("change", () => onChange(input));
    return input;
  }

  function makeCheckbox(value, onChange, { disabled = false } = {}) {
    const input = documentBody().createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(value);
    input.disabled = disabled;
    input.addEventListener("change", () => onChange(input));
    return input;
  }

  function makeSelect(options, value, onChange, { disabled = false } = {}) {
    const select = documentBody().createElement("select");
    for (const [optionValue, label] of options) {
      const option = documentBody().createElement("option");
      option.value = optionValue;
      option.textContent = label;
      select.append(option);
    }
    select.value = value;
    select.disabled = disabled;
    select.addEventListener("change", () => onChange(select));
    return select;
  }

  function appendInspectorHeading(kicker, title, code) {
    const heading = documentBody().createElement("div");
    heading.className = "inspector-heading";
    const kickerElement = documentBody().createElement("span");
    kickerElement.textContent = kicker;
    const titleElement = documentBody().createElement("strong");
    titleElement.textContent = title;
    const codeElement = documentBody().createElement("code");
    codeElement.textContent = code;
    heading.append(kickerElement, titleElement, codeElement);
    inspector.append(heading);
  }

  function appendInspectorSection(title, note = "") {
    const section = documentBody().createElement("section");
    section.className = "inspector-section";
    const heading = documentBody().createElement("div");
    heading.className = "inspector-section-title";
    const label = documentBody().createElement("span");
    label.textContent = title;
    heading.append(label);
    if (note) {
      const small = documentBody().createElement("small");
      small.textContent = note;
      heading.append(small);
    }
    section.append(heading);
    inspector.append(section);
    return section;
  }

  function setSelectedVisualProperty(key, value) {
    const current = selectedObject();
    if (!current) return;
    activeDocument = updateObjectVisual(activeDocument, current.id, { [key]: value }, assetRegistry);
  }

  function commitSelectedVisualProperty(key, value) {
    try {
      commitMutation(() => setSelectedVisualProperty(key, value));
      return true;
    } catch (error) {
      setStatus(`视觉设置无效 · ${error.message.split("\n")[0]}`, "error");
      renderInspector();
      return false;
    }
  }

  function resetSelectedVisualKey(key) {
    const selected = selectedObject();
    if (!selected) return;
    activeDocument = resetObjectVisualProperty(activeDocument, selected.id, key, assetRegistry);
    if (key === "assetId") selectedAssetId = getTypeDefaultAssetId(selected.type, assetRegistry);
  }

  function renderDocumentInspector() {
    appendInspectorHeading("关卡设置", activeDocument.metadata.name, `schema v${LEVEL_DOCUMENT_VERSION}`);
    inspector.append(fieldRow("关卡名称", makeInput(activeDocument.metadata.name, (input) => commitMutation(() => { activeDocument.metadata.name = input.value.trim() || "未命名关卡"; }))));
    inspector.append(fieldRow("关卡 ID", makeInput(activeDocument.metadata.id, (input) => commitMutation(() => { activeDocument.metadata.id = safeFileName(input.value) || "custom-level"; }))));
    inspector.append(fieldRow("关卡简介", makeInput(activeDocument.metadata.summary, (input) => commitMutation(() => { activeDocument.metadata.summary = input.value; }))));
    inspector.append(fieldRow("冲刺容量", makeInput(activeDocument.dashCapacity ?? 1, (input) => commitMutation(() => {
      activeDocument.dashCapacity = Math.max(1, Math.min(3, Math.round(Number(input.value) || 1)));
    }), { type: "number", min: 1, max: 3, step: 1 })));
    for (const key of ["x", "y", "w", "h"]) {
      const labels = { x: "边界 X", y: "边界 Y", w: "边界宽度", h: "边界高度" };
      inspector.append(fieldRow(labels[key], makeInput(activeDocument.bounds[key], (input) => commitMutation(() => {
        activeDocument.bounds[key] = Number(input.value);
      }), { type: "number", step: 20 })));
    }
    const hint = documentBody().createElement("p");
    hint.className = "inspector-hint";
    hint.textContent = "所有玩法物件继续以 objects[] 保存；视觉配置位于各物件 properties.visual，场景数据位于同一关卡文档的 scene 中。";
    inspector.append(hint);
  }

  function renderSupportInspector() {
    const analysis = analyzeLevelAbilitySupport(activeDocument);
    appendInspectorHeading(
      "关卡支持",
      activeDocument.metadata.name,
      `${analysis.startingAbilities.length}/${LEVEL_SUPPORT_ABILITY_IDS.length} starting`
    );
    const summary = appendInspectorSection("开局能力", "canonical: startingAbilities");
    const coverageList = documentBody().createElement("div");
    coverageList.className = "support-coverage-list";
    for (const item of analysis.coverage) {
      const row = documentBody().createElement("div");
      row.className = "support-coverage-item";
      row.dataset.covered = String(!item.required || item.available);
      const name = documentBody().createElement("strong");
      name.textContent = item.label;
      const state = documentBody().createElement("span");
      state.textContent = item.enabledAtStart
        ? "出生即用"
        : item.pickupIds.length
          ? `关内拾取 ×${item.pickupIds.length}`
          : "未提供";
      const detail = documentBody().createElement("small");
      detail.textContent = item.requirementSources.length
        ? `相关机制：${item.requirementSources.map((source) => source.objectId).join("、")}`
        : `${item.input} · ${item.description}`;
      row.append(name, state, detail);
      coverageList.append(row);
    }
    summary.append(coverageList);
    summary.append(fieldRow("冲刺容量", makeInput(activeDocument.dashCapacity ?? 1, (input) => commitMutation(() => {
      activeDocument.dashCapacity = Math.max(1, Math.min(3, Math.round(Number(input.value) || 1)));
    }), { type: "number", min: 1, max: 3, step: 1 })));

    const warnings = appendInspectorSection("机制覆盖检查", analysis.warnings.length ? `${analysis.warnings.length} 项提示` : "已覆盖");
    if (analysis.warnings.length) {
      const list = documentBody().createElement("ul");
      list.className = "support-warning-list";
      for (const warning of analysis.warnings) {
        const item = documentBody().createElement("li");
        item.textContent = `${warning.message} 物件：${warning.objectIds.join("、")}`;
        list.append(item);
      }
      warnings.append(list);
    } else {
      const hint = documentBody().createElement("p");
      hint.className = "inspector-hint";
      hint.textContent = "锚点、猛击支点、冲刺补充、风场及能力门都有开局能力或关内拾取覆盖。";
      warnings.append(hint);
    }
    const hint = documentBody().createElement("p");
    hint.className = "inspector-hint";
    hint.textContent = "startingAbilities 是唯一开局能力数据源；切换能力不会修改 objects[]、碰撞或关卡路线。能力拾取只表示关内可获得，仍需试玩确认拾取顺序可达。";
    inspector.append(hint);
  }

  function renderGameplayObjectInspector(selected) {
    appendInspectorHeading("已选择", LEVEL_OBJECT_LIBRARY[selected.type].label, selected.id);
    inspector.append(fieldRow("物件 ID", makeInput(selected.id, (input) => {
      const next = safeFileName(input.value);
      if (!next || activeDocument.objects.some((object) => object !== selected && object.id === next)) {
        setStatus("物件 ID 不能为空或重复", "error");
        renderInspector();
        return;
      }
      commitMutation(() => { selected.id = next; selectedId = next; });
    })));
    for (const axis of ["x", "y"]) {
      inspector.append(fieldRow(`位置 ${axis.toUpperCase()}`, makeInput(selected.position[axis], (input) => commitMutation(() => {
        selected.position[axis] = Number(input.value);
      }), { type: "number", step: snapInput.checked ? GRID_SIZE : 1 })));
    }
    const definition = LEVEL_OBJECT_LIBRARY[selected.type];
    for (const [key, property] of Object.entries(definition.properties)) {
      let input;
      if (property.kind === "select") {
        input = makeSelect(property.options, selected.properties[key], (element) => commitMutation(() => { selected.properties[key] = element.value; }));
      } else if (property.kind === "boolean") {
        input = makeCheckbox(selected.properties[key], (element) => commitMutation(() => { selected.properties[key] = element.checked; }));
      } else {
        input = makeInput(selected.properties[key], (element) => commitMutation(() => {
          selected.properties[key] = property.kind === "number" ? Number(element.value) : element.value;
        }), {
          type: property.kind === "number" ? "number" : "text",
          min: property.min,
          max: property.max,
          step: property.step
        });
      }
      inspector.append(fieldRow(property.label, input));
    }
  }

  function renderVisualInspector(selected) {
    appendInspectorHeading("物件素材", LEVEL_OBJECT_LIBRARY[selected.type].label, selected.id);
    const section = appendInspectorSection("实时素材预览", selected.type);
    const preview = documentBody().createElement("div");
    preview.className = "inspector-asset-preview";
    const visual = configuredObjectVisual(selected);
    const resolved = resolveObjectVisual(selected, assetRegistry, {
      unavailableAssetIds: [...imageCache].filter(([, entry]) => entry.state === "error").map(([assetId]) => assetId)
    });
    const asset = assetRecord(resolved.assetId);
    const entry = asset?.kind === "image" ? imageForAsset(asset) : null;
    if (entry?.state === "ready" && entry.image) {
      preview.append(createInspectorVisualCanvas(selected, asset, entry, visual));
    } else {
      const fallback = documentBody().createElement("div");
      fallback.className = "inspector-preview-fallback";
      appendFallbackThumbnail(fallback, selected.type);
      const label = documentBody().createElement("span");
      label.textContent = resolved.usedFallback ? "素材不可用，当前使用安全回退" : "程序化安全回退";
      fallback.append(label);
      preview.append(fallback);
    }
    section.append(preview);

    const assetIdInput = makeInput(visual.assetId, (input) => {
      const assetId = input.value.trim() || getTypeDefaultAssetId(selected.type, assetRegistry);
      if (commitSelectedVisualProperty("assetId", assetId)) selectedAssetId = assetId;
    }, { placeholder: "素材 ID" });
    section.append(fieldRowWithReset("素材 ID", assetIdInput, () => commitMutation(() => resetSelectedVisualKey("assetId"))));
    const scaling = assetScalingProfile(asset);
    const scaleOptions = [
      ["asset", `遵循素材默认（${scaling.defaultMode === "nine-slice" ? "九宫格" : scaling.defaultMode === "tile" ? "平铺" : "拉伸"}）`],
      ...scaling.allowedModes.map((mode) => [mode, ({
        stretch: "整图拉伸",
        "nine-slice": "九宫格延伸",
        tile: "整图平铺"
      })[mode]])
    ];
    section.append(fieldRowWithReset(
      "缩放策略",
      makeSelect(scaleOptions, visual.scaleMode, (element) => commitSelectedVisualProperty("scaleMode", element.value)),
      () => commitMutation(() => resetSelectedVisualKey("scaleMode"))
    ));
    const scalingHint = documentBody().createElement("p");
    scalingHint.className = "inspector-hint asset-scaling-hint";
    if (scaling.nineSlice) {
      const slice = scaling.nineSlice;
      scalingHint.textContent = `九宫格切片 L${slice.left} / R${slice.right} / T${slice.top} / B${slice.bottom} px；黄虚线为固定边角范围。`;
    } else {
      scalingHint.textContent = "此素材未登记切片，保持整图拉伸；切片缺失时运行时也会安全降级为拉伸。";
    }
    section.append(scalingHint);
    const numericFields = [
      ["tileScale", "图块倍率", 0.1, 8, 0.1],
      ["scaleX", "横向缩放", 0.01, 16, 0.05],
      ["scaleY", "纵向缩放", 0.01, 16, 0.05],
      ["anchorX", "锚点 X", 0, 1, 0.05],
      ["anchorY", "锚点 Y", 0, 1, 0.05],
      ["offsetX", "X 偏移", -100000, 100000, 1],
      ["offsetY", "Y 偏移", -100000, 100000, 1],
      ["drawLayer", "绘制层级", -1000, 1000, 1],
      ["opacity", "透明度", 0, 1, 0.05]
    ];
    for (const [key, label, min, max, step] of numericFields) {
      const input = makeInput(visual[key], (element) => {
        const value = key === "drawLayer" ? Math.round(Number(element.value)) : Number(element.value);
        commitSelectedVisualProperty(key, value);
      }, { type: "number", min, max, step });
      section.append(fieldRowWithReset(label, input, () => commitMutation(() => resetSelectedVisualKey(key))));
    }
    for (const [key, label] of [["flipX", "水平翻转"], ["flipY", "垂直翻转"]]) {
      const input = makeCheckbox(visual[key], (element) => commitSelectedVisualProperty(key, element.checked));
      section.append(fieldRowWithReset(label, input, () => commitMutation(() => resetSelectedVisualKey(key))));
    }
    const tint = makeInput(visual.tint.slice(0, 7), (element) => commitSelectedVisualProperty("tint", element.value), { type: "color" });
    section.append(fieldRowWithReset("色调叠加", tint, () => commitMutation(() => resetSelectedVisualKey("tint"))));
    const actions = documentBody().createElement("div");
    actions.className = "inspector-actions";
    const resetType = documentBody().createElement("button");
    resetType.type = "button";
    resetType.textContent = "全部参数恢复类型默认";
    resetType.addEventListener("click", () => commitMutation(() => {
      activeDocument = resetObjectVisualToTypeDefault(activeDocument, selected.id, assetRegistry);
      selectedAssetId = getTypeDefaultAssetId(selected.type, assetRegistry);
    }));
    const resetProject = documentBody().createElement("button");
    resetProject.type = "button";
    resetProject.textContent = "恢复项目默认";
    resetProject.addEventListener("click", () => commitMutation(() => {
      activeDocument = resetObjectVisualToProjectDefault(activeDocument, selected.id, assetRegistry);
      selectedAssetId = getProjectDefaultAssetId(assetRegistry);
    }));
    actions.append(resetType, resetProject);
    section.append(actions);
  }

  function moveSceneLayerWithDepth(scene, layerId, targetIndex) {
    const sourceIndex = scene.layers.findIndex((layer) => layer.id === layerId);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= scene.layers.length) return scene;
    const source = scene.layers[sourceIndex];
    const target = scene.layers[targetIndex];
    let next = moveSceneLayer(scene, layerId, targetIndex);
    if (source.depth === target.depth) {
      const depth = sourceIndex > targetIndex ? target.depth - 1 : target.depth + 1;
      return updateSceneLayer(next, source.id, { depth });
    }
    next = updateSceneLayer(next, source.id, { depth: target.depth });
    return updateSceneLayer(next, target.id, { depth: source.depth });
  }

  function parseLayerAssets(value) {
    const references = String(value).split(/[,\n]+/).map((token) => token.trim()).filter(Boolean).map((token) => {
      const match = token.match(/^(.*?)(?:@([0-9]+(?:\.[0-9]+)?))?$/);
      return { assetId: match?.[1]?.trim() || PROCEDURAL_ASSET_ID, weight: Math.max(0.0001, Number(match?.[2]) || 1) };
    });
    return references.length ? references : [{ assetId: PROCEDURAL_ASSET_ID, weight: 1 }];
  }

  function commitSelectedLayerChanges(changes, options = {}) {
    const layer = selectedLayer();
    if (!layer) return;
    try {
      commitMutation(() => {
        activeDocument.scene = updateSceneLayer(activeDocument.scene, layer.id, changes, options);
      });
    } catch (error) {
      setStatus(`图层设置无效 · ${error.message.split("\n")[0]}`, "error");
      renderSceneLayers();
      renderInspector();
    }
  }

  function renderSceneInspector(layer) {
    appendInspectorHeading("场景图层", layer.name, layer.id);
    const locked = layer.locked;
    const protectedPlayer = isProtectedPlayerLayer(layer);
    if (locked) {
      const note = documentBody().createElement("p");
      note.className = "scene-layer-locked-note";
      note.textContent = protectedPlayer ? "玩家基准层受保护且当前锁定；可先在左侧解锁后调整允许的视觉参数。" : "图层已锁定；先在左侧图层列表解锁后编辑属性。";
      inspector.append(note);
    }
    const identity = appendInspectorSection("图层身份", protectedPlayer ? "受保护基准" : "可排序图层");
    identity.append(fieldRow("图层名称", makeInput(layer.name, (input) => commitSelectedLayerChanges({ name: input.value.trim() || "未命名图层" }), { disabled: locked })));
    const roleOptions = SCENE_LAYER_ROLES.map((role) => [role, SCENE_ROLE_LABELS[role] || role]);
    identity.append(fieldRow("角色", makeSelect(roleOptions, layer.role, (select) => commitSelectedLayerChanges({ role: select.value }), { disabled: locked || protectedPlayer })));
    identity.append(fieldRow("深度", makeInput(layer.depth, (input) => commitSelectedLayerChanges({ depth: Number(input.value) }), { type: "number", min: -10000, max: 10000, step: 1, disabled: locked || protectedPlayer })));
    identity.append(fieldRow("显示", makeCheckbox(layer.visible, (input) => commitSelectedLayerChanges({ visible: input.checked }, { force: true }))));
    identity.append(fieldRow("锁定", makeCheckbox(layer.locked, (input) => commitSelectedLayerChanges({ locked: input.checked }))));

    const assets = appendInspectorSection("图层素材", "素材ID@权重，可逗号分隔");
    const sceneAssets = assetRecords.filter((asset) => assetAppliesTo(asset, "scene"));
    const sceneAssetOptions = sceneAssets.map((asset) => [asset.id, `${ASSET_CATEGORY_LABELS[asset.category] || asset.category} · ${asset.name}`]);
    const currentQuickAsset = sceneAssets.some((asset) => asset.id === selectedAssetId)
      ? selectedAssetId
      : sceneAssets.find((asset) => asset.id === layer.assets[0]?.assetId)?.id || PROCEDURAL_ASSET_ID;
    const quickSelect = makeSelect(sceneAssetOptions, currentQuickAsset, (select) => {
      selectedAssetId = select.value;
      renderInspector();
    }, { disabled: locked });
    assets.append(fieldRow("从素材库选择", quickSelect));
    const quickActions = documentBody().createElement("div");
    quickActions.className = "inspector-actions scene-asset-picker-actions";
    const addAsset = documentBody().createElement("button");
    addAsset.type = "button";
    addAsset.textContent = "添加到图层";
    addAsset.disabled = locked;
    addAsset.addEventListener("click", () => {
      const assetId = quickSelect.value;
      const asset = assetRecord(assetId);
      if (!asset || !assetAppliesTo(asset, "scene")) return setStatus("该素材不适用于场景图层", "error");
      const existing = layer.assets.find((reference) => reference.assetId === assetId);
      if (existing) return setStatus("该素材已经在当前图层中", "error");
      selectedAssetId = assetId;
      commitSelectedLayerChanges({ assets: [...layer.assets, { assetId, weight: 1 }] });
      setStatus("素材已添加到当前图层", "success");
    });
    const replaceAssets = documentBody().createElement("button");
    replaceAssets.type = "button";
    replaceAssets.textContent = "替换图层素材";
    replaceAssets.disabled = locked;
    replaceAssets.addEventListener("click", () => {
      const assetId = quickSelect.value;
      const asset = assetRecord(assetId);
      if (!asset || !assetAppliesTo(asset, "scene")) return setStatus("该素材不适用于场景图层", "error");
      selectedAssetId = assetId;
      commitSelectedLayerChanges({ assets: [{ assetId, weight: 1 }] });
      setStatus("当前图层素材已替换", "success");
    });
    quickActions.append(addAsset, replaceAssets);
    assets.append(quickActions);
    const assetText = layer.assets.map((reference) => reference.weight === 1 ? reference.assetId : `${reference.assetId}@${reference.weight}`).join(", ");
    assets.append(fieldRow("多个素材", makeInput(assetText, (input) => commitSelectedLayerChanges({ assets: parseLayerAssets(input.value) }), { disabled: locked, placeholder: "asset.id@1, asset.variant@0.5" })));
    assets.append(fieldRow("随机种子", makeInput(layer.seed, (input) => commitSelectedLayerChanges({ seed: input.value.trim() || `${layer.id}-seed` }), { disabled: locked })));
    assets.append(fieldRow("素材间距", makeInput(layer.spacing, (input) => commitSelectedLayerChanges({ spacing: Number(input.value) }), { type: "number", min: -100000, max: 100000, step: 1, disabled: locked })));
    assets.append(fieldRow("密度", makeInput(layer.density, (input) => commitSelectedLayerChanges({ density: Number(input.value) }), { type: "number", min: 0.01, max: 100, step: 0.05, disabled: locked })));
    assets.append(fieldRow("绘制上限", makeInput(layer.drawCap, (input) => commitSelectedLayerChanges({ drawCap: Math.round(Number(input.value)) }), { type: "number", min: 1, max: 4096, step: 1, disabled: locked })));

    const appearance = appendInspectorSection("空间与表现", `depth ${layer.depth}`);
    appearance.append(fieldRow("视差速度", makeInput(layer.parallax, (input) => commitSelectedLayerChanges({ parallax: Number(input.value) }), { type: "number", min: -4, max: 4, step: 0.05, disabled: locked || protectedPlayer })));
    appearance.append(fieldRow("缩放", makeInput(layer.scale, (input) => commitSelectedLayerChanges({ scale: Number(input.value) }), { type: "number", min: 0.01, max: 16, step: 0.05, disabled: locked })));
    appearance.append(fieldRow("透明度", makeInput(layer.opacity, (input) => commitSelectedLayerChanges({ opacity: Number(input.value) }), { type: "number", min: 0, max: 1, step: 0.05, disabled: locked })));
    appearance.append(fieldRow("色调", makeInput(layer.tint.slice(0, 7), (input) => commitSelectedLayerChanges({ tint: input.value }), { type: "color", disabled: locked })));
    appearance.append(fieldRow("模糊", makeInput(layer.blur, (input) => commitSelectedLayerChanges({ blur: Number(input.value) }), { type: "number", min: 0, max: 100, step: 0.5, disabled: locked })));
    appearance.append(fieldRow("雾化", makeInput(layer.fog, (input) => commitSelectedLayerChanges({ fog: Number(input.value) }), { type: "number", min: 0, max: 1, step: 0.05, disabled: locked })));
    appearance.append(fieldRow("混合方式", makeSelect(SCENE_BLEND_MODES.map((mode) => [mode, mode]), layer.blendMode, (select) => commitSelectedLayerChanges({ blendMode: select.value }), { disabled: locked })));

    const repeat = appendInspectorSection("范围与无缝", layer.repeatX ? "横向延伸" : "单次绘制");
    repeat.append(fieldRow("横向重复", makeCheckbox(layer.repeatX, (input) => commitSelectedLayerChanges({ repeatX: input.checked }), { disabled: locked })));
    repeat.append(fieldRow("无缝规则", makeSelect(SCENE_SEAMLESS_MODES.map((mode) => [mode, mode]), layer.seamless.mode, (select) => commitSelectedLayerChanges({ seamless: { mode: select.value } }), { disabled: locked })));
    repeat.append(fieldRow("平铺宽度", makeInput(layer.seamless.tileWidth, (input) => commitSelectedLayerChanges({ seamless: { tileWidth: Number(input.value) } }), { type: "number", min: 1, max: 100000, step: 1, disabled: locked })));
    repeat.append(fieldRow("衔接重叠", makeInput(layer.seamless.overlap, (input) => commitSelectedLayerChanges({ seamless: { overlap: Number(input.value) } }), { type: "number", min: 0, max: Math.max(0, layer.seamless.tileWidth - 1), step: 1, disabled: locked })));
    repeat.append(fieldRow("原点 X", makeInput(layer.originX, (input) => commitSelectedLayerChanges({ originX: Number(input.value) }), { type: "number", step: 1, disabled: locked })));
    repeat.append(fieldRow("出现范围起点", makeInput(layer.range.startX, (input) => commitSelectedLayerChanges({ range: { startX: input.value === "" ? null : Number(input.value) } }), { type: "number", step: 1, disabled: locked, placeholder: "自动" })));
    repeat.append(fieldRow("出现范围终点", makeInput(layer.range.endX, (input) => commitSelectedLayerChanges({ range: { endX: input.value === "" ? null : Number(input.value) } }), { type: "number", step: 1, disabled: locked, placeholder: "自动" })));
  }

  function renderInspector() {
    inspector.replaceChildren();
    const selected = selectedObject();
    if (editorMode === "support") {
      renderSupportInspector();
      return;
    }
    if (editorMode === "scene") {
      const layer = selectedLayer();
      if (layer) renderSceneInspector(layer);
      else {
        appendInspectorHeading("场景分层", "尚未选择图层", activeDocument.metadata.id);
        const hint = documentBody().createElement("p");
        hint.className = "inspector-hint";
        hint.textContent = "从左侧选择一个图层，或新增自定义深度图层。";
        inspector.append(hint);
      }
      return;
    }
    if (editorMode === "assets") {
      if (selected) renderVisualInspector(selected);
      else {
        appendInspectorHeading("物件素材", "尚未选择物件", activeDocument.metadata.id);
        const hint = documentBody().createElement("p");
        hint.className = "inspector-hint";
        hint.textContent = "在画布中选择任意玩法物件，然后从左侧素材库应用素材。碰撞、交互与玩法属性不会改变。";
        inspector.append(hint);
      }
      return;
    }
    if (!selected) {
      renderDocumentInspector();
    } else {
      renderGameplayObjectInspector(selected);
    }
  }

  function updateToolbarState() {
    const selected = selectedObject();
    const supportAnalysis = analyzeLevelAbilitySupport(activeDocument);
    const asset = assetRecord(selectedAssetId);
    const compatible = Boolean(selected && asset && assetAppliesTo(asset, selected.type));
    const layer = selectedLayer();
    const layerIndex = layer ? activeDocument.scene.layers.findIndex((item) => item.id === layer.id) : -1;
    root.querySelector("#editor-undo").disabled = historyIndex <= 0;
    root.querySelector("#editor-redo").disabled = historyIndex >= histories.length - 1;
    root.querySelector("#editor-delete").disabled = editorMode !== "objects" || !selected;
    root.querySelector("#editor-duplicate").disabled = editorMode !== "objects" || !selected;
    root.querySelector("#asset-apply-selected").disabled = !compatible;
    root.querySelector("#asset-apply-type").disabled = !compatible;
    root.querySelector("#asset-reset-selected").disabled = !selected;
    root.querySelector("#asset-reset-type").disabled = !selected;
    root.querySelector("#asset-reset-all").disabled = activeDocument.objects.length === 0;
    root.querySelector("#support-auto-enable").disabled = supportAnalysis.uncoveredAbilityIds.length === 0;
    root.querySelector("#support-enable-all").disabled = supportAnalysis.startingAbilities.length === LEVEL_SUPPORT_ABILITY_IDS.length;
    root.querySelector("#support-reset-default").disabled = supportAnalysis.startingAbilities.length === DEFAULT_LEVEL_STARTING_ABILITIES.length
      && supportAnalysis.startingAbilities.every((abilityId) => DEFAULT_LEVEL_STARTING_ABILITIES.includes(abilityId));
    root.querySelector("#support-clear").disabled = supportAnalysis.startingAbilities.length === 0;
    root.querySelector("#scene-move-up").disabled = !layer || layer.locked || isProtectedPlayerLayer(layer) || layerIndex <= 0 || activeDocument.scene.layers[layerIndex - 1]?.locked || isProtectedPlayerLayer(activeDocument.scene.layers[layerIndex - 1]);
    root.querySelector("#scene-move-down").disabled = !layer || layer.locked || isProtectedPlayerLayer(layer) || layerIndex < 0 || layerIndex >= activeDocument.scene.layers.length - 1 || activeDocument.scene.layers[layerIndex + 1]?.locked || isProtectedPlayerLayer(activeDocument.scene.layers[layerIndex + 1]);
    root.querySelector("#scene-duplicate").disabled = !layer;
    root.querySelector("#scene-delete").disabled = !layer || layer.locked || isProtectedPlayerLayer(layer);
  }

  function renderDocumentSelect() {
    const current = documentSelect.value;
    documentSelect.replaceChildren();
    const addGroup = (label, documents, prefix) => {
      const group = documentBody().createElement("optgroup");
      group.label = label;
      for (const document of documents) {
        const option = documentBody().createElement("option");
        option.value = `${prefix}:${document.metadata.id}`;
        option.textContent = document.metadata.name;
        group.append(option);
      }
      documentSelect.append(group);
    };
    addGroup("内置关卡（打开为副本）", [...builtInDocuments.values()], "builtin");
    addGroup("我的关卡", savedDocuments, "custom");
    if ([...documentSelect.options].some((option) => option.value === current)) documentSelect.value = current;
  }

  function loadDocument(document, { builtIn = false } = {}) {
    activeDocument = ensureEditorDocument(document);
    if (builtIn) {
      activeDocument.metadata.id = `custom-${document.metadata.id}`;
      activeDocument.metadata.name = `${document.metadata.name} · 副本`;
      activeDocument.metadata.category = "自定义关卡";
    }
    selectedId = null;
    selectedLayerId = activeDocument.scene.layers.find((layer) => layer.role === "player")?.id || activeDocument.scene.layers[0]?.id || null;
    selectedAssetId = PROCEDURAL_ASSET_ID;
    placingType = null;
    resetHistory();
    renderLibrary();
    renderSupportPanel();
    renderAssetLibrary();
    renderSceneLayers();
    renderInspector();
    updateToolbarState();
    requestAnimationFrame(() => {
      resizeCanvas();
      fitView();
    });
  }

  function validateCurrent() {
    const documentErrors = validateLevelDocument(activeDocument);
    if (documentErrors.length) return documentErrors;
    try {
      return validateLevel(compileLevelDocument(activeDocument));
    } catch (error) {
      return [error.message];
    }
  }

  function saveCurrent() {
    const errors = validateCurrent();
    if (errors.length) {
      setStatus(`无法保存 · ${errors[0]}`, "error");
      return false;
    }
    activeDocument.metadata.category = "自定义关卡";
    const index = savedDocuments.findIndex((document) => document.metadata.id === activeDocument.metadata.id);
    if (index >= 0) savedDocuments[index] = clone(activeDocument);
    else savedDocuments.push(clone(activeDocument));
    persistDocuments();
    documentSelect.value = `custom:${activeDocument.metadata.id}`;
    const warningCount = analyzeLevelAbilitySupport(activeDocument).warnings.length;
    setStatus(warningCount
      ? `关卡已保存 · 仍有 ${warningCount} 项能力覆盖提示`
      : "关卡已保存到这台设备", warningCount ? "normal" : "success");
    return true;
  }

  function deleteSelected() {
    const selected = selectedObject();
    if (!selected) return;
    if (["spawn", "goal"].includes(selected.type)) {
      setStatus("出生点和终点是必需物件，不能直接删除", "error");
      return;
    }
    commitMutation(() => {
      activeDocument.objects = activeDocument.objects.filter((object) => object.id !== selected.id);
      selectedId = null;
    });
  }

  function duplicateSelected() {
    const selected = selectedObject();
    if (!selected) return;
    if (LEVEL_OBJECT_LIBRARY[selected.type].unique) {
      setStatus(`${LEVEL_OBJECT_LIBRARY[selected.type].label}只能有一个`, "error");
      return;
    }
    commitMutation(() => {
      const copy = createLevelObject(selected.type, selected.position.x + GRID_SIZE, selected.position.y + GRID_SIZE, activeDocument.objects, {
        properties: clone(selected.properties)
      });
      activeDocument.objects.push(copy);
      selectedId = copy.id;
    });
  }

  function findObjectAt(point) {
    const hitOrder = activeDocument.objects
      .map((object, index) => ({ object, index, layer: configuredObjectVisual(object).drawLayer }))
      .sort((left, right) => right.layer - left.layer || right.index - left.index)
      .map(({ object }) => object);
    return hitOrder.find((object) => {
      const padding = Math.max(6 / view.zoom, 4);
      if (object.type === "slope") {
        const { x, y } = object.position;
        const { dx, dy } = object.properties;
        const lengthSquared = dx * dx + dy * dy;
        const amount = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / lengthSquared));
        return Math.hypot(point.x - (x + dx * amount), point.y - (y + dy * amount)) <= padding + object.properties.thickness / 2;
      }
      return pointInBounds(point, getLevelObjectBounds(object), padding);
    }) || null;
  }

  function placeObject(point) {
    const definition = LEVEL_OBJECT_LIBRARY[placingType];
    if (definition.unique) {
      const existing = activeDocument.objects.find((object) => object.type === placingType);
      if (existing) {
        selectedId = existing.id;
        placingType = null;
        renderLibrary();
        renderInspector();
        setStatus(`${definition.label}已存在，已为你选中`, "error");
        return;
      }
    }
    commitMutation(() => {
      const object = createLevelObject(placingType, snap(point.x), snap(point.y), activeDocument.objects);
      activeDocument.objects.push(object);
      selectedId = object.id;
    });
    setStatus(`已放置 ${definition.label}`);
  }

  canvas.addEventListener("pointerdown", (event) => {
    const point = screenToWorld(event.clientX, event.clientY);
    if (event.button === 1 || event.button === 2 || event.altKey || (editorMode === "scene" && event.button === 0)) {
      panState = { clientX: event.clientX, clientY: event.clientY, viewX: view.x, viewY: view.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (editorMode === "objects" && placingType) {
      placeObject(point);
      return;
    }
    const object = findObjectAt(point);
    selectedId = object?.id || null;
    if (object && editorMode === "assets") {
      selectedAssetId = configuredObjectVisual(object).assetId;
      renderAssetLibrary();
    }
    if (object && editorMode === "objects") {
      dragState = {
        id: object.id,
        start: point,
        objectX: object.position.x,
        objectY: object.position.y,
        changed: false
      };
      canvas.setPointerCapture(event.pointerId);
    }
    renderInspector();
    updateToolbarState();
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (panState) {
      view.x = panState.viewX - (event.clientX - panState.clientX) / view.zoom;
      view.y = panState.viewY - (event.clientY - panState.clientY) / view.zoom;
      render();
      return;
    }
    if (!dragState) return;
    const object = activeDocument.objects.find((item) => item.id === dragState.id);
    const point = screenToWorld(event.clientX, event.clientY);
    if (!object) return;
    object.position.x = snap(dragState.objectX + point.x - dragState.start.x);
    object.position.y = snap(dragState.objectY + point.y - dragState.start.y);
    dragState.changed = true;
    renderInspector();
    render();
  });

  canvas.addEventListener("pointerup", (event) => {
    if (dragState?.changed) pushHistory();
    dragState = null;
    panState = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointercancel", () => {
    dragState = null;
    panState = null;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const before = screenToWorld(event.clientX, event.clientY);
    view.zoom = Math.max(0.08, Math.min(3, view.zoom * Math.exp(-event.deltaY * 0.0012)));
    const after = screenToWorld(event.clientX, event.clientY);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    render();
  }, { passive: false });

  root.querySelector("#editor-close").addEventListener("click", () => close());
  root.querySelector("#editor-new").addEventListener("click", () => {
    loadDocument(createBlankLevelDocument());
    documentSelect.value = "";
    setStatus("已创建空白关卡");
  });
  root.querySelector("#editor-save").addEventListener("click", saveCurrent);
  root.querySelector("#editor-export").addEventListener("click", () => {
    const errors = validateCurrent();
    if (errors.length) return setStatus(`无法导出 · ${errors[0]}`, "error");
    downloadJson(activeDocument);
    setStatus("关卡 JSON 已导出", "success");
  });
  root.querySelector("#editor-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const [file] = fileInput.files;
    fileInput.value = "";
    if (!file) return;
    try {
      const document = migrateLevelDocument(JSON.parse(await file.text()));
      const errors = validateLevelDocument(document);
      if (errors.length) throw new Error(errors[0]);
      loadDocument(document);
      setStatus("已导入关卡，请确认后保存", "success");
    } catch (error) {
      setStatus(`导入失败 · ${error.message}`, "error");
    }
  });
  root.querySelector("#editor-play").addEventListener("click", () => {
    const errors = validateCurrent();
    if (errors.length) return setStatus(`无法试玩 · ${errors[0]}`, "error");
    onPlay(compileLevelDocument(activeDocument));
  });
  root.querySelector("#editor-undo").addEventListener("click", () => restoreHistory(historyIndex - 1));
  root.querySelector("#editor-redo").addEventListener("click", () => restoreHistory(historyIndex + 1));
  root.querySelector("#editor-delete").addEventListener("click", deleteSelected);
  root.querySelector("#editor-duplicate").addEventListener("click", duplicateSelected);
  root.querySelector("#editor-fit").addEventListener("click", fitView);
  root.querySelector("#editor-zoom-in").addEventListener("click", () => { view.zoom = Math.min(3, view.zoom * 1.25); render(); });
  root.querySelector("#editor-zoom-out").addEventListener("click", () => { view.zoom = Math.max(0.08, view.zoom / 1.25); render(); });
  for (const button of root.querySelectorAll(".editor-mode-tabs [data-mode]")) {
    button.addEventListener("click", () => setEditorMode(button.dataset.mode));
  }
  assetSearch.addEventListener("input", renderAssetLibrary);
  assetCategory.addEventListener("change", renderAssetLibrary);
  assetCompatibleOnly.addEventListener("change", renderAssetLibrary);
  root.querySelector("#asset-apply-selected").addEventListener("click", () => {
    const selected = selectedObject();
    if (!selected) return;
    try {
      commitMutation(() => { activeDocument = replaceObjectAsset(activeDocument, selected.id, selectedAssetId, assetRegistry); });
      setStatus(`已为 ${selected.id} 应用素材`, "success");
    } catch (error) {
      setStatus(`素材应用失败 · ${error.message}`, "error");
    }
  });
  root.querySelector("#asset-apply-type").addEventListener("click", () => {
    const selected = selectedObject();
    if (!selected) return;
    try {
      const count = activeDocument.objects.filter((object) => object.type === selected.type).length;
      commitMutation(() => { activeDocument = replaceAssetsForType(activeDocument, selected.type, selectedAssetId, assetRegistry); });
      setStatus(`已批量替换 ${count} 个 ${LEVEL_OBJECT_LIBRARY[selected.type].label}`, "success");
    } catch (error) {
      setStatus(`批量替换失败 · ${error.message}`, "error");
    }
  });
  root.querySelector("#asset-reset-selected").addEventListener("click", () => {
    const selected = selectedObject();
    if (!selected) return;
    commitMutation(() => {
      activeDocument = resetObjectVisualToTypeDefault(activeDocument, selected.id, assetRegistry);
      selectedAssetId = getTypeDefaultAssetId(selected.type, assetRegistry);
    });
    setStatus("当前物件已恢复类型默认素材", "success");
  });
  root.querySelector("#asset-reset-type").addEventListener("click", () => {
    const selected = selectedObject();
    if (!selected) return;
    commitMutation(() => {
      activeDocument = resetVisualsForTypeToTypeDefault(activeDocument, selected.type, assetRegistry);
      selectedAssetId = getTypeDefaultAssetId(selected.type, assetRegistry);
    });
    setStatus("同类型物件已恢复类型默认素材", "success");
  });
  root.querySelector("#asset-reset-all").addEventListener("click", () => {
    commitMutation(() => {
      activeDocument = resetAllObjectVisualsToProjectDefault(activeDocument, assetRegistry);
      selectedAssetId = getProjectDefaultAssetId(assetRegistry);
    });
    setStatus("全部物件已恢复项目默认素材", "success");
  });
  root.querySelector("#support-auto-enable").addEventListener("click", () => {
    const analysis = analyzeLevelAbilitySupport(activeDocument);
    if (!analysis.uncoveredAbilityIds.length) return;
    commitMutation(() => {
      activeDocument = replaceStartingAbilities(activeDocument, [
        ...activeDocument.startingAbilities,
        ...analysis.uncoveredAbilityIds
      ]);
    });
    setStatus(`已补齐 ${analysis.uncoveredAbilityIds.length} 项机制所需能力`, "success");
  });
  root.querySelector("#support-enable-all").addEventListener("click", () => {
    commitMutation(() => {
      activeDocument = replaceStartingAbilities(activeDocument, LEVEL_SUPPORT_ABILITY_IDS);
    });
    setStatus("全部 3C 能力已设为出生即用", "success");
  });
  root.querySelector("#support-reset-default").addEventListener("click", () => {
    commitMutation(() => {
      activeDocument = replaceStartingAbilities(activeDocument, DEFAULT_LEVEL_STARTING_ABILITIES);
    });
    setStatus("已恢复项目默认开局能力", "success");
  });
  root.querySelector("#support-clear").addEventListener("click", () => {
    commitMutation(() => {
      activeDocument = replaceStartingAbilities(activeDocument, []);
    });
    setStatus("开局能力已全部关闭；关内拾取仍会生效", "success");
  });
  root.querySelector("#scene-add").addEventListener("click", () => {
    const role = root.querySelector("#scene-new-role").value;
    commitMutation(() => {
      activeDocument.scene = addSceneLayer(activeDocument.scene, { role });
      selectedLayerId = activeDocument.scene.layers.at(-1).id;
    });
    setStatus("已新增场景图层", "success");
  });
  root.querySelector("#scene-move-up").addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    const index = activeDocument.scene.layers.findIndex((item) => item.id === layer.id);
    try {
      commitMutation(() => { activeDocument.scene = moveSceneLayerWithDepth(activeDocument.scene, layer.id, index - 1); });
      setStatus("图层已上移");
    } catch (error) {
      setStatus(`无法移动图层 · ${error.message}`, "error");
    }
  });
  root.querySelector("#scene-move-down").addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    const index = activeDocument.scene.layers.findIndex((item) => item.id === layer.id);
    try {
      commitMutation(() => { activeDocument.scene = moveSceneLayerWithDepth(activeDocument.scene, layer.id, index + 1); });
      setStatus("图层已下移");
    } catch (error) {
      setStatus(`无法移动图层 · ${error.message}`, "error");
    }
  });
  root.querySelector("#scene-duplicate").addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    try {
      commitMutation(() => {
        const sourceIndex = activeDocument.scene.layers.findIndex((item) => item.id === layer.id);
        activeDocument.scene = duplicateSceneLayer(activeDocument.scene, layer.id);
        selectedLayerId = activeDocument.scene.layers[sourceIndex + 1].id;
      });
      setStatus("图层已复制", "success");
    } catch (error) {
      setStatus(`无法复制图层 · ${error.message}`, "error");
    }
  });
  root.querySelector("#scene-delete").addEventListener("click", () => {
    const layer = selectedLayer();
    if (!layer) return;
    try {
      commitMutation(() => {
        const index = activeDocument.scene.layers.findIndex((item) => item.id === layer.id);
        activeDocument.scene = deleteSceneLayer(activeDocument.scene, layer.id);
        selectedLayerId = activeDocument.scene.layers[Math.min(index, activeDocument.scene.layers.length - 1)]?.id || null;
      });
      setStatus("图层已删除", "success");
    } catch (error) {
      setStatus(`无法删除图层 · ${error.message}`, "error");
    }
  });
  root.querySelector("#editor-generator-toggle").addEventListener("click", () => {
    generatorPanel.hidden = !generatorPanel.hidden;
  });
  root.querySelector("#editor-generate").addEventListener("click", () => {
    const generated = generateLevelDocument({
      seed: generatorSeed.value.trim() || "cablester",
      length: Number(generatorLength.value),
      difficulty: Number(generatorDifficulty.value)
    });
    loadDocument(generated);
    generatorPanel.hidden = true;
    setStatus("新关卡已生成，可继续手工调整", "success");
  });
  objectSearch.addEventListener("input", renderLibrary);
  documentSelect.addEventListener("change", () => {
    const [kind, id] = documentSelect.value.split(":");
    const document = kind === "builtin"
      ? builtInDocuments.get(id)
      : savedDocuments.find((item) => item.metadata.id === id);
    if (document) loadDocument(document, { builtIn: kind === "builtin" });
  });

  window.addEventListener("keydown", (event) => {
    if (root.hidden) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName);
    if (event.code === "Escape" && placingType) {
      placingType = null;
      renderLibrary();
      setStatus("已退出放置模式");
      return;
    }
    if (event.code === "Escape" && !typing) {
      close();
      return;
    }
    if (typing) return;
    if ((event.metaKey || event.ctrlKey) && event.code === "KeyZ") {
      event.preventDefault();
      restoreHistory(historyIndex + (event.shiftKey ? 1 : -1));
    } else if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      if (editorMode === "scene") root.querySelector("#scene-delete").click();
      else if (editorMode === "objects") deleteSelected();
    } else if ((event.metaKey || event.ctrlKey) && event.code === "KeyD") {
      event.preventDefault();
      if (editorMode === "scene") root.querySelector("#scene-duplicate").click();
      else if (editorMode === "objects") duplicateSelected();
    }
  });

  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(canvas);
  updateModeChrome();
  renderLibrary();
  renderSupportPanel();
  renderAssetCategoryOptions();
  renderAssetLibrary();
  renderSceneLayers();
  renderInspector();
  renderDocumentSelect();
  updateToolbarState();
  notifySavedLevels();

  function open() {
    root.hidden = false;
    if (!hasOpened && builtInDocuments.size > 0) {
      hasOpened = true;
      const [sourceId, sourceDocument] = builtInDocuments.entries().next().value;
      documentSelect.value = `builtin:${sourceId}`;
      loadDocument(sourceDocument, { builtIn: true });
      return;
    }
    hasOpened = true;
    requestAnimationFrame(() => {
      resizeCanvas();
      fitView();
    });
  }

  function close() {
    root.hidden = true;
    placingType = null;
    dragState = null;
    panState = null;
  }

  function addSourceDocuments(documents) {
    for (const rawDocument of documents) {
      const document = migrateLevelDocument(rawDocument);
      const errors = validateLevelDocument(document);
      if (errors.length) throw new Error(`${document?.metadata?.id || "reference document"}: ${errors.join("\n")}`);
      builtInDocuments.set(document.metadata.id, document);
    }
    renderDocumentSelect();
  }

  return { open, close, addSourceDocuments, getSavedDocuments: () => clone(savedDocuments) };
}
