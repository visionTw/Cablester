import {
  WORLD_LOD_LEVELS,
  applyTransformChain,
  buildWorldSpatialIndex,
  expandBounds,
  normalizeBounds,
  queryVisibleWorld
} from "./world-streaming.js";

export const WORLD_PREVIEW_VIEWS = Object.freeze(["world", "region", "chunk", "godot"]);

export const PREVIEW_SOURCE_KINDS = Object.freeze({
  CANONICAL: "canonical-prediction",
  WEB_CONTRACT: "web-contract",
  GODOT_SNAPSHOT: "godot-snapshot",
  GODOT_TELEMETRY: "godot-telemetry",
  GODOT_ONLY: "godot-only-proxy"
});

export const SNAPSHOT_STATES = Object.freeze({
  CURRENT: "current",
  STALE: "stale-content-hash",
  INCOMPATIBLE: "incompatible",
  MISSING: "missing/import-failed"
});

const SOURCE_LABELS = Object.freeze({
  [PREVIEW_SOURCE_KINDS.CANONICAL]: "Canonical 推算",
  [PREVIEW_SOURCE_KINDS.WEB_CONTRACT]: "Web 行为契约",
  [PREVIEW_SOURCE_KINDS.GODOT_SNAPSHOT]: "Godot resolved snapshot",
  [PREVIEW_SOURCE_KINDS.GODOT_TELEMETRY]: "Godot telemetry",
  [PREVIEW_SOURCE_KINDS.GODOT_ONLY]: "仅 Godot 验收代理"
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function centerOf(bounds) {
  const normalized = normalizeBounds(bounds);
  return { x: normalized.x + normalized.w / 2, y: normalized.y + normalized.h / 2 };
}

function getSnapshotHash(snapshot) {
  return snapshot?.sourceContentHash
    || snapshot?.manifest?.sourceContentHash
    || snapshot?.manifest?.contentHash
    || "";
}

function getSnapshotSchemaVersion(snapshot) {
  return Number(snapshot?.schemaVersion ?? snapshot?.manifest?.schemaVersion);
}

function getGodotBuildId(snapshot) {
  return String(snapshot?.godotBuildId || snapshot?.manifest?.godotBuildId || "");
}

function normalizeExpectedGodotVersion(expected) {
  const text = String(expected || "").trim();
  if (!text) return null;
  return text.split(".stable", 1)[0];
}

export function getSnapshotStatus(world, snapshot, {
  expectedGodotBuildId = null,
  compatibleGodotSeries = "4.7"
} = {}) {
  if (!snapshot || snapshot.importFailed || ["failed", "import-failed"].includes(snapshot.status) || (snapshot.errors?.length || 0) > 0) {
    return {
      state: SNAPSHOT_STATES.MISSING,
      current: false,
      reason: snapshot
        ? `Godot 导入失败${snapshot.errors?.[0]?.message ? `：${snapshot.errors[0].message}` : ""}`
        : "尚未生成 Godot resolved snapshot"
    };
  }
  if (getSnapshotSchemaVersion(snapshot) !== Number(world?.schemaVersion)) {
    return {
      state: SNAPSHOT_STATES.INCOMPATIBLE,
      current: false,
      reason: `snapshot schema v${getSnapshotSchemaVersion(snapshot) || "?"} 与 canonical v${world?.schemaVersion || "?"} 不兼容`
    };
  }
  const buildId = getGodotBuildId(snapshot);
  const expectedBuild = String(expectedGodotBuildId || "").trim();
  const compatibleSeries = normalizeExpectedGodotVersion(compatibleGodotSeries);
  const stableSeriesPattern = compatibleSeries
    ? new RegExp(`^${compatibleSeries.replaceAll(".", "\\.")}\\.\\d+\\.stable\\.`)
    : null;
  if ((expectedBuild && buildId !== expectedBuild) || (!expectedBuild && stableSeriesPattern && !stableSeriesPattern.test(buildId))) {
    return {
      state: SNAPSHOT_STATES.INCOMPATIBLE,
      current: false,
      reason: expectedBuild
        ? `Godot build ${buildId || "missing"}，要求 ${expectedBuild}`
        : `Godot build ${buildId || "missing"} 不属于允许的 ${compatibleSeries}.x stable 系列`
    };
  }
  const canonicalHash = String(world?.manifest?.contentHash || "");
  const snapshotHash = getSnapshotHash(snapshot);
  if (!canonicalHash || canonicalHash !== snapshotHash) {
    return {
      state: SNAPSHOT_STATES.STALE,
      current: false,
      reason: `snapshot ${snapshotHash || "无 hash"}，canonical ${canonicalHash || "无 hash"}`
    };
  }
  return { state: SNAPSHOT_STATES.CURRENT, current: true, reason: "contentHash 与 Godot 版本握手通过" };
}

function connectionEndpointIds(connection) {
  const endpoints = [
    connection?.from,
    connection?.to,
    connection?.a,
    connection?.b,
    ...(Array.isArray(connection?.endpoints) ? connection.endpoints : [])
  ];
  return [...new Set([
    connection?.fromChunkId,
    connection?.toChunkId,
    connection?.targetChunkId,
    ...endpoints.map((endpoint) => endpoint?.chunkId ?? endpoint?.id)
  ].filter(Boolean).map(String))];
}

export function createRegionGraph(world, spatialIndex = buildWorldSpatialIndex(world)) {
  const nodes = [...spatialIndex.regions.entries()].map(([id, record]) => ({
    id,
    kind: "region",
    label: record.region.name || id,
    bounds: record.bounds,
    position: centerOf(record.bounds),
    chunkCount: record.region.chunks?.length || 0,
    landmarks: (record.region.landmarks || record.region.metadata?.landmarks || []).map((landmark) => {
      const chunk = spatialIndex.chunks.get(String(landmark.chunkId || ""));
      return {
        ...landmark,
        worldPosition: chunk
          ? applyTransformChain(landmark.position || { x: 0, y: 0 }, chunk.transforms)
          : applyTransformChain(landmark.position || { x: 0, y: 0 }, record.transformChain)
      };
    }),
    routes: record.region.routes || [],
    tags: record.region.tags || []
  }));
  const chunkRegion = new Map([...spatialIndex.chunks.values()].map((record) => [record.id, record.regionId]));
  const edges = [];
  const seen = new Set();
  for (const record of spatialIndex.chunks.values()) {
    for (const connection of record.chunk.connections || []) {
      const fromRegionId = chunkRegion.get(String(connection.from?.chunkId || record.id));
      const targetRegionId = chunkRegion.get(String(connection.to?.chunkId || ""));
      if (!fromRegionId || !targetRegionId || targetRegionId === fromRegionId) continue;
      const directional = Boolean(connection.oneWay);
      const key = directional
        ? `${fromRegionId}>${targetRegionId}:${connection.id || ""}`
        : `${[fromRegionId, targetRegionId].sort().join("<>")}:${connection.id || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        id: connection.id || key,
        from: fromRegionId,
        to: targetRegionId,
        oneWay: directional,
        requiredAbilities: connection.requiredAbilities || [],
        requiredFlags: connection.requiredFlags || [],
        abilityGate: connection.requiredAbilities?.[0] || null,
        flagGate: connection.requiredFlags?.[0] || null,
        source: PREVIEW_SOURCE_KINDS.CANONICAL
      });
    }
  }
  return { kind: "RegionGraph", nodes, edges };
}

export function createChunkGraph(world, regionId = null, spatialIndex = buildWorldSpatialIndex(world)) {
  const records = [...spatialIndex.chunks.values()].filter((record) => !regionId || record.regionId === regionId);
  const visibleIds = new Set(records.map((record) => record.id));
  const nodes = records.map((record) => ({
    id: record.id,
    regionId: record.regionId,
    kind: "chunk",
    label: record.chunk.name || record.id,
    bounds: record.bounds,
    position: centerOf(record.bounds),
    objectCount: record.chunk.objects?.length || 0,
    streaming: record.chunk.streaming || {},
    tags: record.chunk.tags || []
  }));
  const edges = [];
  const seen = new Set();
  const routeMembership = new Map();
  for (const region of world?.regions || []) {
    for (const route of region.routes || []) {
      for (let index = 1; index < (route.chunks || []).length; index += 1) {
        const pair = [String(route.chunks[index - 1]), String(route.chunks[index])].sort().join("<>");
        const memberships = routeMembership.get(pair) || [];
        memberships.push({ id: route.id, kind: route.kind || "route" });
        routeMembership.set(pair, memberships);
      }
    }
  }
  for (const record of spatialIndex.chunks.values()) {
    for (const connection of record.chunk.connections || []) {
      const fromId = String(connection.from?.chunkId || record.id);
      const targetId = String(connection.to?.chunkId || "");
      if (!visibleIds.has(fromId) || !visibleIds.has(targetId) || targetId === fromId) continue;
      const oneWay = Boolean(connection.oneWay);
      const key = oneWay
        ? `${fromId}>${targetId}:${connection.id || ""}`
        : `${[fromId, targetId].sort().join("<>")}:${connection.id || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const routes = routeMembership.get([fromId, targetId].sort().join("<>")) || [];
      edges.push({
        id: connection.id || key,
        from: fromId,
        to: targetId,
        oneWay,
        direction: connection.direction || null,
        requiredAbilities: connection.requiredAbilities || [],
        requiredFlags: connection.requiredFlags || [],
        abilityGate: connection.requiredAbilities?.[0] || null,
        flagGate: connection.requiredFlags?.[0] || null,
        routeIds: routes.map((route) => route.id),
        routeKinds: [...new Set(routes.map((route) => route.kind))],
        routeKind: routes.some((route) => route.kind === "main")
          ? "main"
          : routes.some((route) => route.kind === "loop") ? "loop" : routes[0]?.kind || null,
        entrances: {
          from: connection.from?.entranceId || null,
          to: connection.to?.entranceId || null
        },
        source: PREVIEW_SOURCE_KINDS.CANONICAL
      });
    }
  }
  return { kind: "ChunkGraph", regionId, nodes, edges };
}

function oneHopChunkIds(graph, chunkId) {
  const ids = new Set([chunkId]);
  for (const edge of graph.edges) {
    if (edge.from === chunkId) ids.add(edge.to);
    if (edge.to === chunkId) ids.add(edge.from);
  }
  return ids;
}

function godotSnapshotEntities(snapshot) {
  const regions = snapshot?.regions || snapshot?.resolved?.regions || [];
  const chunks = [];
  const objects = [];
  for (const region of regions) {
    for (const chunk of region.chunks || []) {
      chunks.push({ ...chunk, regionId: region.id, source: PREVIEW_SOURCE_KINDS.GODOT_SNAPSHOT });
      for (const object of chunk.objects || []) {
        objects.push({ ...object, regionId: region.id, chunkId: chunk.id, source: PREVIEW_SOURCE_KINDS.GODOT_SNAPSHOT });
      }
    }
  }
  return { regions, chunks, objects };
}

function godotOnlyProxies(index, selectedChunkId = null) {
  const proxies = [];
  for (const record of index.objects.values()) {
    if (selectedChunkId && record.chunkId !== selectedChunkId) continue;
    const properties = record.object.properties || {};
    const godotOnly = properties.godotOnly || properties.prefabId || properties.shaderId || properties.audioId;
    if (!godotOnly) continue;
    proxies.push({
      id: record.id,
      chunkId: record.chunkId,
      bounds: record.bounds,
      type: record.object.type,
      proxyKind: properties.prefabId ? "prefab" : properties.shaderId ? "shader" : properties.audioId ? "audio" : "runtime",
      message: "此范围只在 Godot 中进行最终效果验收",
      source: PREVIEW_SOURCE_KINDS.GODOT_ONLY
    });
  }
  return proxies;
}

export function createWorldPreviewModel(world, {
  view = "world",
  regionId = null,
  chunkId = null,
  viewport = null,
  zoom = 1,
  spatialIndex = buildWorldSpatialIndex(world),
  snapshot = null,
  telemetry = null,
  streaming = null,
  expectedGodotBuildId = null
} = {}) {
  if (!WORLD_PREVIEW_VIEWS.includes(view)) throw new TypeError(`Unknown world preview view: ${view}`);
  const regionGraph = createRegionGraph(world, spatialIndex);
  const chunkGraph = createChunkGraph(world, regionId, spatialIndex);
  const allBounds = spatialIndex.chunkIndex.values().reduce((combined, record) => unionBounds(combined, record.bounds), null)
    || { x: 0, y: 0, w: 1280, h: 720 };
  const requestedViewport = viewport || expandBounds(allBounds, Math.max(allBounds.w, allBounds.h) * 0.04);
  let visible = queryVisibleWorld(spatialIndex, requestedViewport, { zoom });
  if (view === "region" && regionId) {
    visible = {
      ...visible,
      chunks: visible.chunks.filter((record) => record.regionId === regionId),
      objects: visible.objects.filter((record) => record.regionId === regionId)
    };
  }
  if (view === "chunk" && chunkId) {
    const neighborhood = oneHopChunkIds(createChunkGraph(world, null, spatialIndex), chunkId);
    visible = {
      ...visible,
      chunks: visible.chunks.filter((record) => neighborhood.has(record.id)),
      objects: visible.objects.filter((record) => neighborhood.has(record.chunkId))
    };
  }
  const snapshotStatus = getSnapshotStatus(world, snapshot, { expectedGodotBuildId });
  const overviewTypes = new Set(["spawn", "goal", "checkpoint", "gate", "abilityPickup", "stateTrigger"]);
  const overviewMarkers = [...spatialIndex.objects.values()]
    .filter((record) => overviewTypes.has(record.object?.type))
    .map((record) => ({
      id: record.id,
      kind: "object",
      type: record.object.type,
      chunkId: record.chunkId,
      regionId: record.regionId,
      position: record.worldPosition,
      bounds: record.bounds,
      requiredAbility: record.object.properties?.requiredAbility || null,
      requiredFlag: record.object.properties?.requiredFlag || null,
      stateFlag: record.object.properties?.setFlag || record.object.properties?.clearFlag || null
    }));
  return {
    worldId: world?.manifest?.worldId || "unknown-world",
    title: world?.manifest?.title || world?.manifest?.worldId || "Untitled world",
    view,
    regionId,
    chunkId,
    bounds: allBounds,
    viewport: requestedViewport,
    zoom,
    lod: visible.lod,
    visible,
    regionGraph,
    chunkGraph,
    snapshotStatus,
    snapshot: snapshotStatus.state === SNAPSHOT_STATES.CURRENT || view === "godot"
      ? godotSnapshotEntities(snapshot)
      : { regions: [], chunks: [], objects: [] },
    telemetry: telemetry || snapshot?.telemetry || null,
    streaming,
    godotOnlyProxies: godotOnlyProxies(spatialIndex, view === "chunk" ? chunkId : null),
    overviewMarkers,
    sourceLegend: Object.entries(SOURCE_LABELS).map(([id, label]) => ({ id, label })),
    spatialIndex
  };
}

export function unionBounds(first, second) {
  if (!first) return normalizeBounds(second);
  if (!second) return normalizeBounds(first);
  const a = normalizeBounds(first);
  const b = normalizeBounds(second);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y
  };
}

export function fitWorldView(bounds, canvasWidth, canvasHeight, padding = 52) {
  const normalized = normalizeBounds(bounds);
  const availableWidth = Math.max(1, finite(canvasWidth, 1280) - padding * 2);
  const availableHeight = Math.max(1, finite(canvasHeight, 720) - padding * 2);
  const zoom = Math.max(0.02, Math.min(4, Math.min(
    availableWidth / Math.max(1, normalized.w),
    availableHeight / Math.max(1, normalized.h)
  )));
  return { x: normalized.x + normalized.w / 2, y: normalized.y + normalized.h / 2, zoom };
}

function graphLookup(graph) {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function streamingColor(state) {
  return {
    unloaded: "#263743",
    prefetch: "#6879ff",
    warm: "#52c7d9",
    active: "#91f5af",
    "keep-alive": "#d5a75f"
  }[state] || "#263743";
}

function objectColor(type) {
  if (["spawn", "checkpoint"].includes(type)) return "#79e5ff";
  if (type === "goal") return "#ffdf7f";
  if (["hazard", "boundaryWall"].includes(type)) return "#ff6e7f";
  if (["roomEntrance", "roomExit"].includes(type)) return "#bc94ff";
  if (["gate", "stateTrigger", "abilityPickup"].includes(type)) return "#ffac64";
  return "#9bb3c2";
}

export class WorldPreviewCanvas {
  constructor(canvas, { onSelect = null, onMove = null } = {}) {
    this.canvas = canvas;
    this.context = canvas?.getContext?.("2d") || null;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.model = null;
    this.view = { x: 0, y: 0, zoom: 1 };
    this.hitTargets = [];
    this.drag = null;
    this.resizeObserver = null;
    if (canvas && typeof window !== "undefined") this.#bind();
  }

  #bind() {
    const resize = () => {
      const rect = this.canvas.getBoundingClientRect();
      const scale = Math.min(2, window.devicePixelRatio || 1);
      this.canvas.width = Math.max(1, Math.round(rect.width * scale));
      this.canvas.height = Math.max(1, Math.round(rect.height * scale));
      this.render();
    };
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    this.resizeObserver?.observe(this.canvas);
    resize();
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const before = this.screenToWorld(event.offsetX, event.offsetY);
      this.view.zoom = Math.max(0.02, Math.min(5, this.view.zoom * Math.exp(-event.deltaY * 0.0012)));
      const after = this.screenToWorld(event.offsetX, event.offsetY);
      this.view.x += before.x - after.x;
      this.view.y += before.y - after.y;
      this.render();
    }, { passive: false });
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture?.(event.pointerId);
      const target = this.hitTest(event.offsetX, event.offsetY);
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        viewX: this.view.x,
        viewY: this.view.y,
        moved: false,
        target,
        editTarget: this.#editableTarget(target),
        screenDx: 0,
        screenDy: 0
      };
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.hypot(dx, dy) > 3) this.drag.moved = true;
      if (this.drag.editTarget) {
        this.drag.screenDx = dx;
        this.drag.screenDy = dy;
      } else {
        this.view.x = this.drag.viewX - dx / this.view.zoom;
        this.view.y = this.drag.viewY - dy / this.view.zoom;
      }
      this.render();
    });
    this.canvas.addEventListener("pointerup", (event) => {
      if (this.drag?.moved && this.drag.editTarget) {
        this.onMove?.(this.drag.editTarget, {
          x: (event.clientX - this.drag.x) / this.view.zoom,
          y: (event.clientY - this.drag.y) / this.view.zoom
        });
      } else if (this.drag && !this.drag.moved) {
        const target = this.drag.target || this.hitTest(event.offsetX, event.offsetY);
        if (target) this.onSelect?.(target);
      }
      this.drag = null;
      this.render();
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.drag = null;
      this.render();
    });
  }

  #editableTarget(target) {
    if (!target || this.model?.view === 'godot') return null;
    const expectedKind = { world: 'region', region: 'chunk', chunk: 'object' }[this.model?.view];
    return target.kind === expectedKind ? target : null;
  }

  setModel(model, { fit = false } = {}) {
    this.model = model;
    if (fit) this.fit();
    else this.render();
  }

  fit() {
    if (!this.model || !this.canvas) return;
    const bounds = this.model.view === "chunk" && this.model.chunkId
      ? this.model.visible.chunks.find((record) => record.id === this.model.chunkId)?.bounds || this.model.bounds
      : this.model.view === "region" && this.model.regionId
        ? this.model.regionGraph.nodes.find((node) => node.id === this.model.regionId)?.bounds || this.model.bounds
        : this.model.bounds;
    this.view = fitWorldView(bounds, this.canvas.clientWidth || this.canvas.width, this.canvas.clientHeight || this.canvas.height);
    this.render();
  }

  worldToScreen(point) {
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    return {
      x: width / 2 + (finite(point?.x) - this.view.x) * this.view.zoom,
      y: height / 2 + (finite(point?.y) - this.view.y) * this.view.zoom
    };
  }

  screenToWorld(x, y) {
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    return {
      x: this.view.x + (finite(x) - width / 2) / this.view.zoom,
      y: this.view.y + (finite(y) - height / 2) / this.view.zoom
    };
  }

  hitTest(x, y) {
    return [...this.hitTargets].reverse().find((target) => (
      x >= target.screenBounds.x && x <= target.screenBounds.x + target.screenBounds.w
      && y >= target.screenBounds.y && y <= target.screenBounds.y + target.screenBounds.h
    )) || null;
  }

  #drawGraph(graph) {
    const ctx = this.context;
    const nodes = graphLookup(graph);
    ctx.save();
    ctx.lineWidth = 2;
    for (const edge of graph.edges) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) continue;
      const start = this.worldToScreen(from.position);
      const end = this.worldToScreen(to.position);
      ctx.strokeStyle = edge.abilityGate || edge.flagGate
        ? "#ffaf66"
        : edge.routeKind === "main" ? "#91f5af" : edge.routeKind === "loop" ? "#7fa9ff" : "#6e93a6";
      ctx.lineWidth = edge.routeKind === "main" ? 3 : 2;
      ctx.setLineDash(edge.oneWay ? [8, 6] : []);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (edge.oneWay) {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(midX + Math.cos(angle) * 8, midY + Math.sin(angle) * 8);
        ctx.lineTo(midX + Math.cos(angle + 2.5) * 8, midY + Math.sin(angle + 2.5) * 8);
        ctx.lineTo(midX + Math.cos(angle - 2.5) * 8, midY + Math.sin(angle - 2.5) * 8);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  #drawLandmarks() {
    if (this.model.view !== 'world') return;
    const ctx = this.context;
    ctx.save();
    for (const node of this.model.regionGraph.nodes) {
      for (const landmark of node.landmarks || []) {
        const position = this.worldToScreen(landmark.worldPosition || node.position);
        const radius = 8;
        ctx.fillStyle = '#ffdf7f';
        ctx.strokeStyle = '#4d3d1c';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let index = 0; index < 8; index += 1) {
          const angle = Math.PI / 4 * index - Math.PI / 2;
          const length = index % 2 === 0 ? radius : radius * 0.45;
          const x = position.x + Math.cos(angle) * length;
          const y = position.y + Math.sin(angle) * length;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (this.view.zoom > 0.08) {
          ctx.fillStyle = '#ffefbc';
          ctx.font = '11px system-ui';
          ctx.fillText(landmark.name || landmark.id, position.x + 12, position.y - 8);
        }
      }
    }
    ctx.restore();
  }

  #drawOverviewMarkers() {
    if (this.model.view !== 'world') return;
    const ctx = this.context;
    const markerShape = {
      spawn: 'S', goal: 'G', checkpoint: 'C', gate: '▮', abilityPickup: 'A', stateTrigger: 'F'
    };
    ctx.save();
    for (const marker of this.model.overviewMarkers || []) {
      const position = this.worldToScreen(marker.position);
      const size = marker.type === 'spawn' || marker.type === 'goal' ? 8 : 6;
      ctx.fillStyle = objectColor(marker.type);
      ctx.beginPath();
      ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#07131d';
      ctx.font = `700 ${Math.max(8, size + 2)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(markerShape[marker.type] || '·', position.x, position.y + 0.5);
      this.hitTargets.push({
        id: marker.id,
        kind: 'object',
        chunkId: marker.chunkId,
        regionId: marker.regionId,
        screenBounds: { x: position.x - size - 3, y: position.y - size - 3, w: size * 2 + 6, h: size * 2 + 6 }
      });
    }
    ctx.restore();
  }

  #drawRegionNodes() {
    if (this.model.view !== 'world') return;
    const ctx = this.context;
    ctx.save();
    for (const node of this.model.regionGraph.nodes) {
      const position = this.worldToScreen(node.position);
      const radius = 14;
      ctx.fillStyle = '#173547';
      ctx.strokeStyle = '#79e5ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dceaf0';
      ctx.font = '600 12px system-ui';
      ctx.fillText(node.label, position.x + 20, position.y + 4);
      this.hitTargets.push({
        id: node.id,
        kind: 'region',
        regionId: node.id,
        screenBounds: { x: position.x - radius - 4, y: position.y - radius - 4, w: radius * 2 + 8, h: radius * 2 + 8 }
      });
    }
    ctx.restore();
  }

  #drawChunk(record, streamingById) {
    const ctx = this.context;
    const topLeft = this.worldToScreen(record.bounds);
    const width = Math.max(3, record.bounds.w * this.view.zoom);
    const height = Math.max(3, record.bounds.h * this.view.zoom);
    const streamState = streamingById.get(record.id)?.state || "unloaded";
    ctx.fillStyle = `${streamingColor(streamState)}28`;
    ctx.strokeStyle = streamingColor(streamState);
    ctx.lineWidth = record.id === this.model.chunkId ? 3 : 1.25;
    ctx.setLineDash(streamState === "unloaded" ? [5, 5] : []);
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);
    ctx.setLineDash([]);
    if (this.view.zoom > 0.12) {
      ctx.fillStyle = "#dceaf0";
      ctx.font = "12px system-ui";
      ctx.fillText(record.chunk.name || record.id, topLeft.x + 7, topLeft.y + 17);
    }
    this.hitTargets.push({
      id: record.id,
      kind: "chunk",
      regionId: record.regionId,
      screenBounds: { x: topLeft.x, y: topLeft.y, w: width, h: height }
    });
  }

  #drawObject(record) {
    const ctx = this.context;
    const position = this.worldToScreen(record.worldPosition || centerOf(record.bounds));
    const size = this.model.lod === WORLD_LOD_LEVELS.LOCAL_DETAIL
      ? Math.max(5, Math.min(18, Math.max(record.bounds.w, record.bounds.h) * this.view.zoom))
      : 5;
    ctx.fillStyle = objectColor(record.object?.type);
    if (this.model.lod === WORLD_LOD_LEVELS.LOCAL_DETAIL) {
      const topLeft = this.worldToScreen(record.bounds);
      const width = Math.max(3, Math.min(260, record.bounds.w * this.view.zoom));
      const height = Math.max(3, Math.min(180, record.bounds.h * this.view.zoom));
      ctx.globalAlpha = 0.24;
      ctx.fillRect(topLeft.x, topLeft.y, width, height);
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = objectColor(record.object?.type);
      ctx.lineWidth = 1;
      ctx.strokeRect(topLeft.x, topLeft.y, width, height);
    }
    ctx.beginPath();
    ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
    ctx.fill();
    this.hitTargets.push({
      id: record.id,
      kind: "object",
      chunkId: record.chunkId,
      regionId: record.regionId,
      screenBounds: { x: position.x - size - 3, y: position.y - size - 3, w: size * 2 + 6, h: size * 2 + 6 }
    });
  }

  #drawGodotOverlay() {
    if (this.model.view !== "godot") return;
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = this.model.snapshotStatus.current ? "#d2a6ff" : "#ff6e7f";
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 2;
    for (const chunk of this.model.snapshot.chunks || []) {
      const bounds = normalizeBounds(chunk.worldAabb || chunk.aabb || chunk.bounds);
      if (bounds.w <= 0 || bounds.h <= 0) continue;
      const topLeft = this.worldToScreen(bounds);
      ctx.strokeRect(topLeft.x, topLeft.y, bounds.w * this.view.zoom, bounds.h * this.view.zoom);
    }
    ctx.strokeStyle = '#bc94ff';
    ctx.setLineDash([2, 3]);
    for (const object of this.model.snapshot.objects || []) {
      const bounds = normalizeBounds(object.collisionBounds || object.worldCollisionBounds || object.worldAabb || object.bounds);
      if (bounds.w <= 0 || bounds.h <= 0) continue;
      const topLeft = this.worldToScreen(bounds);
      ctx.strokeRect(topLeft.x, topLeft.y, bounds.w * this.view.zoom, bounds.h * this.view.zoom);
    }
    const trajectory = this.model.telemetry?.trajectory || [];
    if (trajectory.length > 1) {
      ctx.strokeStyle = '#ffdf7f';
      ctx.setLineDash([]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [index, sample] of trajectory.entries()) {
        const point = this.worldToScreen(sample.position || sample.worldPosition || sample);
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      const finalPoint = this.worldToScreen(trajectory.at(-1).position || trajectory.at(-1));
      ctx.fillStyle = '#ffdf7f';
      ctx.beginPath();
      ctx.arc(finalPoint.x, finalPoint.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawSceneProxies() {
    if (this.model.view !== 'chunk' || this.model.lod !== WORLD_LOD_LEVELS.LOCAL_DETAIL) return;
    const ctx = this.context;
    ctx.save();
    for (const record of this.model.visible.chunks) {
      const layers = (record.chunk.scene?.layers || []).filter((layer) => layer.visible !== false);
      if (layers.length === 0) continue;
      const topLeft = this.worldToScreen(record.bounds);
      const width = Math.max(3, record.bounds.w * this.view.zoom);
      const bandHeight = Math.min(22, Math.max(5, record.bounds.h * this.view.zoom * 0.04));
      for (const [index, layer] of layers.slice(0, 5).entries()) {
        ctx.fillStyle = index % 2 === 0 ? 'rgba(95, 185, 164, 0.12)' : 'rgba(121, 146, 255, 0.12)';
        ctx.fillRect(topLeft.x, topLeft.y + index * bandHeight, width, bandHeight - 1);
      }
      ctx.fillStyle = '#89a8b6';
      ctx.font = '10px system-ui';
      ctx.fillText(`${layers.length} canonical scene layers · Web proxy`, topLeft.x + 6, topLeft.y + Math.min(5, layers.length) * bandHeight + 12);
    }
    ctx.restore();
  }

  #drawGodotOnlyProxies() {
    const ctx = this.context;
    ctx.save();
    ctx.strokeStyle = "#ffcc78";
    ctx.setLineDash([3, 3]);
    for (const proxy of this.model.godotOnlyProxies || []) {
      const topLeft = this.worldToScreen(proxy.bounds);
      ctx.strokeRect(topLeft.x, topLeft.y, proxy.bounds.w * this.view.zoom, proxy.bounds.h * this.view.zoom);
    }
    ctx.restore();
  }

  #drawDragPreview() {
    if (!this.drag?.moved || !this.drag.editTarget) return;
    const bounds = this.drag.editTarget.screenBounds;
    const ctx = this.context;
    ctx.save();
    ctx.translate(this.drag.screenDx, this.drag.screenDy);
    ctx.strokeStyle = '#ffdf7f';
    ctx.fillStyle = 'rgba(255, 223, 127, 0.14)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.restore();
  }

  #refreshVisible() {
    if (!this.model?.spatialIndex || !this.canvas) return;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    const start = this.screenToWorld(0, 0);
    const end = this.screenToWorld(width, height);
    let visible = queryVisibleWorld(this.model.spatialIndex, {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x),
      h: Math.abs(end.y - start.y)
    }, { zoom: this.view.zoom, overscan: 128 / Math.max(0.02, this.view.zoom) });
    if (this.model.view === "region" && this.model.regionId) {
      visible = {
        ...visible,
        chunks: visible.chunks.filter((record) => record.regionId === this.model.regionId),
        objects: visible.objects.filter((record) => record.regionId === this.model.regionId)
      };
    }
    if (this.model.view === "chunk" && this.model.chunkId) {
      const neighborhood = oneHopChunkIds(createChunkGraph(this.model.spatialIndex, null, this.model.spatialIndex), this.model.chunkId);
      visible = {
        ...visible,
        chunks: visible.chunks.filter((record) => neighborhood.has(record.id)),
        objects: visible.objects.filter((record) => neighborhood.has(record.chunkId))
      };
    }
    this.model.visible = visible;
    this.model.lod = visible.lod;
    this.model.viewport = { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
    this.model.zoom = this.view.zoom;
  }

  render() {
    if (!this.context || !this.model) return;
    this.#refreshVisible();
    const ctx = this.context;
    const scaleX = this.canvas.width / Math.max(1, this.canvas.clientWidth || this.canvas.width);
    const scaleY = this.canvas.height / Math.max(1, this.canvas.clientHeight || this.canvas.height);
    ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#07131d");
    gradient.addColorStop(1, "#0b2027");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    this.hitTargets = [];
    const streamingById = new Map((this.model.streaming?.chunks || []).map((chunk) => [chunk.id, chunk]));
    this.#drawGraph(this.model.view === "world" ? this.model.regionGraph : this.model.chunkGraph);
    for (const record of this.model.visible.chunks) this.#drawChunk(record, streamingById);
    this.#drawSceneProxies();
    if (this.model.lod !== WORLD_LOD_LEVELS.INDEX_ONLY) {
      for (const record of this.model.visible.objects) this.#drawObject(record);
    }
    this.#drawOverviewMarkers();
    this.#drawLandmarks();
    this.#drawRegionNodes();
    this.#drawGodotOverlay();
    this.#drawGodotOnlyProxies();
    this.#drawDragPreview();
    ctx.fillStyle = "rgba(7, 19, 29, 0.82)";
    ctx.fillRect(12, 12, 248, 52);
    ctx.fillStyle = "#dceaf0";
    ctx.font = "600 12px system-ui";
    ctx.fillText(`${this.model.view.toUpperCase()} · ${this.model.lod}`, 24, 33);
    ctx.fillStyle = "#89a8b6";
    ctx.font = "11px system-ui";
    ctx.fillText(`${this.model.visible.chunks.length} chunks · ${this.model.visible.objects.length} objects`, 24, 51);
  }

  destroy() {
    this.resizeObserver?.disconnect();
  }
}

export function createSyntheticWorld({
  worldId = "synthetic-world-10x",
  regionCount = 10,
  chunksPerRegion = 20,
  objectsPerChunk = 50,
  chunkWidth = 1600,
  chunkHeight = 900,
  gap = 160
} = {}) {
  const regions = [];
  let objectOrdinal = 0;
  for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
    const chunks = [];
    for (let chunkIndex = 0; chunkIndex < chunksPerRegion; chunkIndex += 1) {
      const id = `synthetic-r${regionIndex}-c${chunkIndex}`;
      const nextId = chunkIndex + 1 < chunksPerRegion ? `synthetic-r${regionIndex}-c${chunkIndex + 1}` : null;
      const objects = [];
      for (let index = 0; index < objectsPerChunk; index += 1) {
        const column = index % 10;
        const row = Math.floor(index / 10);
        objects.push({
          id: `synthetic-object-${objectOrdinal++}`,
          type: index === 0 ? "checkpoint" : index % 13 === 0 ? "hazard" : "platform",
          transform: {
            position: { x: 80 + column * 140, y: 100 + row * 120 },
            rotationDegrees: 0,
            scale: { x: 1, y: 1 }
          },
          properties: index === 0 ? {} : { w: 120, h: 24 },
          links: [],
          tags: []
        });
      }
      const leftEntranceId = `${id}:entrance-left`;
      const rightEntranceId = `${id}:entrance-right`;
      objects.push({
        id: leftEntranceId,
        type: "roomEntrance",
        transform: { position: { x: 0, y: chunkHeight / 2 }, rotationDegrees: 0, scale: { x: 1, y: 1 } },
        properties: { w: 64, h: 160 },
        links: [],
        tags: ["synthetic"]
      }, {
        id: rightEntranceId,
        type: "roomEntrance",
        transform: { position: { x: chunkWidth - 64, y: chunkHeight / 2 }, rotationDegrees: 0, scale: { x: 1, y: 1 } },
        properties: { w: 64, h: 160 },
        links: [],
        tags: ["synthetic"]
      });
      const connections = nextId ? [{
        id: `${id}-to-${nextId}`,
        from: { chunkId: id, entranceId: rightEntranceId },
        to: { chunkId: nextId, entranceId: `${nextId}:entrance-left` },
        direction: "right",
        requiredAbilities: [],
        requiredFlags: [],
        oneWay: false
      }] : [];
      chunks.push({
        id,
        name: `Synthetic ${regionIndex + 1}.${chunkIndex + 1}`,
        transform: { position: { x: chunkIndex * (chunkWidth + gap), y: 0 }, rotationDegrees: 0, scale: { x: 1, y: 1 } },
        bounds: { x: 0, y: 0, w: chunkWidth, h: chunkHeight },
        streaming: {
          prefetchDistance: chunkWidth * 1.1,
          hysteresis: 360,
          unloadDelaySeconds: 1.5,
          keepAlive: chunkIndex % 8 === 0,
          memoryEstimateBytes: 512 * 1024 + objectsPerChunk * 4096
        },
        connections,
        objects,
        scene: { layers: [] },
        statePolicy: {
          deathReset: "checkpoint",
          checkpointReset: "chunk",
          offscreen: "sleep-local",
          worldPersistence: []
        },
        gameplay: { startingAbilities: [], dashCapacity: 1 },
        tags: ["synthetic", "performance-only"]
      });
    }
    regions.push({
      id: `synthetic-region-${regionIndex}`,
      name: `Synthetic Region ${regionIndex + 1}`,
      transform: {
        position: { x: 0, y: regionIndex * (chunkHeight + gap * 4) },
        rotationDegrees: 0,
        scale: { x: 1, y: 1 }
      },
      bounds: { x: 0, y: 0, w: chunksPerRegion * (chunkWidth + gap) - gap, h: chunkHeight },
      routes: [{ id: `synthetic-route-${regionIndex}`, kind: "main", chunks: chunks.map((chunk) => chunk.id) }],
      landmarks: [],
      chunks,
      tags: ["synthetic", "performance-only"]
    });
  }
  return {
    schemaVersion: 3,
    manifest: {
      worldId,
      title: "10x Synthetic Streaming World",
      namespace: "labs",
      contentVersion: "0.0.0-synthetic",
      contentHash: "",
      gameplayTuningVersion: "approved-1",
      assetRegistryVersion: "1",
      prefabRegistryVersion: "1",
      typeRegistryVersion: "1"
    },
    regions,
    assetRegistry: { version: "1", entries: [] },
    prefabRegistry: { version: "1", entries: [] },
    typeRegistry: { version: "1", entries: [] },
    gameplayTuning: { version: "approved-1", draft: {}, approved: {} }
  };
}

export function measurePreviewQuery(world, {
  iterations = 120,
  viewportWidth = 2560,
  viewportHeight = 1440,
  zoom = 0.5,
  now = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) {
  const buildStartedAt = now();
  const spatialIndex = buildWorldSpatialIndex(world);
  const indexBuildMs = now() - buildStartedAt;
  const samples = [];
  let returnedChunks = 0;
  let returnedObjects = 0;
  const bounds = spatialIndex.chunkIndex.values().reduce((combined, entry) => unionBounds(combined, entry.bounds), null)
    || { x: 0, y: 0, w: viewportWidth, h: viewportHeight };
  for (let index = 0; index < iterations; index += 1) {
    const progress = iterations <= 1 ? 0 : index / (iterations - 1);
    const viewport = {
      x: bounds.x + Math.max(0, bounds.w - viewportWidth) * progress,
      y: bounds.y + Math.max(0, bounds.h - viewportHeight) * ((index * 17) % Math.max(1, iterations)) / Math.max(1, iterations),
      w: viewportWidth,
      h: viewportHeight
    };
    const startedAt = now();
    const visible = queryVisibleWorld(spatialIndex, viewport, { zoom });
    samples.push(now() - startedAt);
    returnedChunks += visible.chunks.length;
    returnedObjects += visible.objects.length;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] || 0;
  return {
    regions: spatialIndex.regions.size,
    chunks: spatialIndex.chunkIndex.size,
    objects: spatialIndex.objectIndex.size,
    indexBuildMs,
    queryP50Ms: percentile(0.5),
    queryP95Ms: percentile(0.95),
    queryP99Ms: percentile(0.99),
    maximumQueryMs: sorted.at(-1) || 0,
    averageReturnedChunks: returnedChunks / Math.max(1, iterations),
    averageReturnedObjects: returnedObjects / Math.max(1, iterations),
    indexStats: spatialIndex.stats()
  };
}
