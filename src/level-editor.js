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
  validateLevelDocument
} from "./level-objects.js";
import { parseMotionPath } from "./motion.js";

const STORAGE_KEY = "cablester.level-editor.documents.v1";
const GRID_SIZE = 20;

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
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((document) => validateLevelDocument(document).length === 0)
      : [];
  } catch {
    return [];
  }
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
  const library = root.querySelector("#object-library");
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
  const builtInDocuments = new Map(sourceLevels.map((level) => [level.id, levelToDocument(level)]));
  let savedDocuments = readStoredDocuments();
  let activeDocument = createBlankLevelDocument();
  let selectedId = null;
  let placingType = null;
  let dragState = null;
  let panState = null;
  let histories = [clone(activeDocument)];
  let historyIndex = 0;
  let statusTimer = 0;
  let view = { x: 800, y: 400, zoom: 0.72 };

  function selectedObject() {
    return activeDocument.objects.find((object) => object.id === selectedId) || null;
  }

  function setStatus(message, tone = "normal") {
    status.textContent = message;
    status.dataset.tone = tone;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = placingType ? `放置模式 · ${LEVEL_OBJECT_LIBRARY[placingType].label}` : "选择物件后可拖动，滚轮缩放画布";
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
    activeDocument = clone(histories[historyIndex]);
    if (!activeDocument.objects.some((object) => object.id === selectedId)) selectedId = null;
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
    renderInspector();
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

  function drawObject(object) {
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
      const rectangular = ["platform", "movingObject", "launcher", "fragilePlatform", "gate", "stateTrigger"].includes(object.type);
      const labelX = rectangular ? x + 7 : x + 20 / view.zoom;
      const labelY = rectangular ? y + 18 / view.zoom : y - 10 / view.zoom;
      ctx.fillStyle = "rgba(230, 255, 252, 0.78)";
      ctx.fillText(definition.label, labelX, labelY);
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
    for (const object of activeDocument.objects.filter((item) => item.id !== selectedId)) drawObject(object);
    const selected = selectedObject();
    if (selected) {
      drawObject(selected);
      const objectBounds = getLevelObjectBounds(selected);
      ctx.strokeStyle = "#fff2a6";
      ctx.lineWidth = 2 / view.zoom;
      ctx.setLineDash([8 / view.zoom, 5 / view.zoom]);
      ctx.strokeRect(objectBounds.x - 7 / view.zoom, objectBounds.y - 7 / view.zoom, objectBounds.w + 14 / view.zoom, objectBounds.h + 14 / view.zoom);
    }
    ctx.restore();
    root.querySelector("#editor-zoom-label").textContent = `${Math.round(view.zoom * 100)}%`;
    root.querySelector("#editor-object-count").textContent = `${activeDocument.objects.length} 个物件`;
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

  function fieldRow(labelText, input) {
    const label = documentBody().createElement("label");
    label.className = "inspector-field";
    const text = documentBody().createElement("span");
    text.textContent = labelText;
    label.append(text, input);
    return label;
  }

  function makeInput(value, onChange, options = {}) {
    const input = documentBody().createElement("input");
    input.type = options.type || "text";
    input.value = value;
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step !== undefined) input.step = options.step;
    input.addEventListener("change", () => onChange(input));
    return input;
  }

  function renderInspector() {
    inspector.replaceChildren();
    const heading = documentBody().createElement("div");
    heading.className = "inspector-heading";
    const selected = selectedObject();
    heading.innerHTML = selected
      ? `<span>已选择</span><strong>${LEVEL_OBJECT_LIBRARY[selected.type].label}</strong><code>${selected.id}</code>`
      : `<span>关卡设置</span><strong>${activeDocument.metadata.name}</strong><code>schema v${LEVEL_DOCUMENT_VERSION}</code>`;
    inspector.append(heading);

    if (!selected) {
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
      hint.textContent = "所有关卡都以 objects[] 保存：type 决定物件，position 决定位置，properties 保存类型专属参数。";
      inspector.append(hint);
      return;
    }

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
        input = documentBody().createElement("select");
        for (const [value, label] of property.options) {
          const option = documentBody().createElement("option");
          option.value = value;
          option.textContent = label;
          input.append(option);
        }
        input.value = selected.properties[key];
        input.addEventListener("change", () => commitMutation(() => { selected.properties[key] = input.value; }));
      } else if (property.kind === "boolean") {
        input = documentBody().createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(selected.properties[key]);
        input.addEventListener("change", () => commitMutation(() => { selected.properties[key] = input.checked; }));
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

  function updateToolbarState() {
    root.querySelector("#editor-undo").disabled = historyIndex <= 0;
    root.querySelector("#editor-redo").disabled = historyIndex >= histories.length - 1;
    root.querySelector("#editor-delete").disabled = !selectedObject();
    root.querySelector("#editor-duplicate").disabled = !selectedObject();
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
    activeDocument = clone(document);
    if (builtIn) {
      activeDocument.metadata.id = `custom-${document.metadata.id}`;
      activeDocument.metadata.name = `${document.metadata.name} · 副本`;
      activeDocument.metadata.category = "自定义关卡";
    }
    selectedId = null;
    placingType = null;
    resetHistory();
    renderLibrary();
    renderInspector();
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
    setStatus("关卡已保存到这台设备", "success");
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
    return [...activeDocument.objects].reverse().find((object) => {
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
    if (event.button === 1 || event.button === 2 || event.altKey) {
      panState = { clientX: event.clientX, clientY: event.clientY, viewX: view.x, viewY: view.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (placingType) {
      placeObject(point);
      return;
    }
    const object = findObjectAt(point);
    selectedId = object?.id || null;
    if (object) {
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
      const document = JSON.parse(await file.text());
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
      deleteSelected();
    } else if ((event.metaKey || event.ctrlKey) && event.code === "KeyD") {
      event.preventDefault();
      duplicateSelected();
    }
  });

  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(canvas);
  renderLibrary();
  renderInspector();
  renderDocumentSelect();
  updateToolbarState();
  notifySavedLevels();

  function open() {
    root.hidden = false;
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
    for (const document of documents) {
      const errors = validateLevelDocument(document);
      if (errors.length) throw new Error(`${document?.metadata?.id || "reference document"}: ${errors.join("\n")}`);
      builtInDocuments.set(document.metadata.id, clone(document));
    }
    renderDocumentSelect();
  }

  return { open, close, addSourceDocuments, getSavedDocuments: () => clone(savedDocuments) };
}
