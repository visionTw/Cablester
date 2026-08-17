import { validateWorldPackage } from "./world-schema.js";

function finite(value) {
  return Number.isFinite(Number(value));
}

function issue(severity, code, path, message, details = undefined) {
  return { severity, code, path, message, ...(details === undefined ? {} : { details }) };
}

function normalizedIssue(value) {
  if (value && typeof value === "object") {
    return {
      severity: value.severity || "error",
      code: value.code || "schema.invalid",
      path: value.path || "$",
      message: value.message || JSON.stringify(value),
      ...(value.details === undefined ? {} : { details: value.details })
    };
  }
  return issue("error", "schema.invalid", "$", String(value));
}

function abortError() {
  return Object.assign(new Error("World validation cancelled"), { name: "AbortError", code: "VALIDATION_CANCELLED" });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function yieldTask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function allChunks(world) {
  return (world?.regions || []).flatMap((region) => (region.chunks || []).map((chunk) => ({ region, chunk })));
}

function objectMap(world) {
  return new Map(allChunks(world).flatMap(({ region, chunk }) => (
    (chunk.objects || []).map((object) => [object.id, { region, chunk, object }])
  )));
}

function chunkMap(world) {
  return new Map(allChunks(world).map((record) => [record.chunk.id, record]));
}

function registryIds(registry) {
  return new Set((registry?.entries || []).map((entry) => String(entry.id)));
}

function typeEntries(world) {
  return new Map((world?.typeRegistry?.entries || []).map((entry) => [String(entry.id), entry]));
}

function rectIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function objectBounds(world, object) {
  const typeEntry = typeEntries(world).get(String(object?.type)) || {};
  const adapter = typeEntry.boundsAdapter || {};
  const pivot = typeEntry.pivot || {};
  const properties = object?.properties || {};
  const transform = object?.transform || {};
  const position = transform.position || {};
  const scaleX = Math.abs(Number(transform.scale?.x ?? 1));
  const scaleY = Math.abs(Number(transform.scale?.y ?? 1));
  let local;
  if (["slope", "segment", "line"].includes(adapter.kind)) {
    const dx = Number(properties[adapter.dxProperty || "dx"] || 0) * scaleX;
    const dy = Number(properties[adapter.dyProperty || "dy"] || 0) * scaleY;
    const thickness = Number(properties[adapter.thicknessProperty || "thickness"] || 14);
    local = { x: Math.min(0, dx) - thickness / 2, y: Math.min(0, dy) - thickness / 2, w: Math.abs(dx) + thickness, h: Math.abs(dy) + thickness };
  } else if (["circle", "radius"].includes(adapter.kind)) {
    const radius = Number(properties[adapter.radiusProperty || "radius"] ?? adapter.radius ?? 22) * Math.max(scaleX, scaleY);
    local = { x: -radius, y: -radius, w: radius * 2, h: radius * 2 };
  } else if (adapter.kind === "point") {
    const radius = Number(adapter.radius ?? properties.size ?? 22) * Math.max(scaleX, scaleY);
    local = { x: -radius, y: -radius, w: radius * 2, h: radius * 2 };
  } else {
    const w = Number(properties[adapter.widthProperty || "w"] ?? properties.w ?? properties.width ?? 32) * scaleX;
    const h = Number(properties[adapter.heightProperty || "h"] ?? properties.h ?? properties.height ?? 32) * scaleY;
    local = { x: -Number(pivot.x || 0) * w, y: -Number(pivot.y || 0) * h, w, h };
  }
  const radians = Number(transform.rotationDegrees || 0) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const corners = [
    [local.x, local.y], [local.x + local.w, local.y],
    [local.x, local.y + local.h], [local.x + local.w, local.y + local.h]
  ].map(([x, y]) => ({
    x: Number(position.x || 0) + x * cosine - y * sine,
    y: Number(position.y || 0) + x * sine + y * cosine
  }));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function isSolidObject(world, object) {
  const entry = typeEntries(world).get(String(object?.type)) || {};
  return ["solid", "one-way-solid"].includes(entry.collisionSemantics)
    || ["platform", "boundaryWall", "slope", "fragilePlatform", "gate"].includes(entry.godotRuntimeHandler)
    || (object?.type === "movingObject" && object.properties?.objectKind === "platform");
}

function isHarmfulObject(object) {
  return object?.type === "hazard"
    || (object?.type === "movingObject" && object.properties?.objectKind === "hazard")
    || (object?.type === "liquidZone" && Number(object.properties?.contactDamage || 0) > 0);
}

function playerEnvelope(world, object, margin = 4) {
  const player = playerSize(world);
  const point = object?.transform?.position || {};
  const x = Number(point.x || 0) + Number(object?.properties?.spawnOffsetX || 0);
  const y = Number(point.y || 0) + Number(object?.properties?.spawnOffsetY || 0);
  return { x: x - player.w / 2 - margin, y: y - player.h / 2 - margin, w: player.w + margin * 2, h: player.h + margin * 2 };
}

function objectBoundsSize(object) {
  const properties = object?.properties || {};
  const radius = Number(properties.radius);
  const width = Number(properties.w ?? properties.width);
  const height = Number(properties.h ?? properties.height);
  return {
    w: Number.isFinite(width) ? width : Number.isFinite(radius) ? radius * 2 : 32,
    h: Number.isFinite(height) ? height : Number.isFinite(radius) ? radius * 2 : 32
  };
}

function connectionEndpoints(connection) {
  return [connection?.from, connection?.to].filter(Boolean);
}

function requiredAbilities(connection) {
  return Array.isArray(connection?.requiredAbilities)
    ? connection.requiredAbilities.map(String)
    : [connection?.requiredAbility].filter(Boolean).map(String);
}

function requiredFlags(connection) {
  return Array.isArray(connection?.requiredFlags)
    ? connection.requiredFlags.map(String)
    : [connection?.requiredFlag].filter(Boolean).map(String);
}

function approvedTuning(world) {
  return world?.gameplayTuning?.approved || {};
}

function maximumMovementSpeed(world) {
  const tuning = approvedTuning(world);
  const values = tuning.values || {};
  const candidates = [
    values.maximumSwingSpeed,
    values.bashSpeed,
    values.dashSpeed,
    tuning.maximumMovementSpeed,
    tuning.maxMovementSpeed,
    tuning.movement?.maximumSpeed,
    tuning.dash?.maximumSpeed
  ].map(Number).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : 1200;
}

function playerSize(world) {
  const tuning = approvedTuning(world);
  const values = tuning.values || {};
  const radius = Number(values.playerRadius);
  return {
    w: Number(tuning.player?.width ?? tuning.playerWidth ?? (Number.isFinite(radius) ? radius * 2 : 28)),
    h: Number(tuning.player?.height ?? tuning.playerHeight ?? (Number.isFinite(radius) ? radius * 2 : 44))
  };
}

function validateTransform(record, path, issues) {
  const transform = record?.transform || {};
  for (const [field, value] of [
    ["position.x", transform.position?.x],
    ["position.y", transform.position?.y],
    ["rotationDegrees", transform.rotationDegrees],
    ["scale.x", transform.scale?.x],
    ["scale.y", transform.scale?.y]
  ]) {
    if (!finite(value)) issues.push(issue("error", "transform.non-finite", `${path}.transform.${field}`, "transform 数值必须为有限数。"));
  }
  if (Number(transform.scale?.x) === 0 || Number(transform.scale?.y) === 0) {
    issues.push(issue("error", "transform.zero-scale", `${path}.transform.scale`, "玩法 transform.scale 不能为 0。"));
  }
}

function validateObjectReferences(world, record, path, issues, registries) {
  const { object } = record;
  if (registries.types.size > 0 && !registries.types.has(String(object.type))) {
    issues.push(issue("error", "reference.unknown-type", `${path}.type`, `未解析 type：${object.type}`));
  }
  const properties = object.properties || {};
  const assetIds = [properties.assetId, properties.visual?.assetId].filter(Boolean);
  const prefabIds = [properties.prefabId, properties.runtime?.prefabId].filter(Boolean);
  for (const assetId of assetIds) {
    if (registries.assets.size > 0 && !registries.assets.has(String(assetId))) {
      issues.push(issue("warning", "reference.unknown-asset", `${path}.properties`, `未解析 asset：${assetId}`));
    }
  }
  for (const prefabId of prefabIds) {
    if (registries.prefabs.size > 0 && !registries.prefabs.has(String(prefabId))) {
      issues.push(issue("error", "reference.unknown-prefab", `${path}.properties`, `未解析 prefab：${prefabId}`));
    }
  }
}

function validateObjectBounds(record, path, issues) {
  const chunkBounds = record.chunk.bounds || {};
  const position = record.object.transform?.position || {};
  const size = objectBoundsSize(record.object);
  const margin = 256;
  const inside = Number(position.x) + size.w / 2 >= Number(chunkBounds.x ?? 0) - margin
    && Number(position.x) - size.w / 2 <= Number(chunkBounds.x ?? 0) + Number(chunkBounds.w ?? chunkBounds.width ?? 0) + margin
    && Number(position.y) + size.h / 2 >= Number(chunkBounds.y ?? 0) - margin
    && Number(position.y) - size.h / 2 <= Number(chunkBounds.y ?? 0) + Number(chunkBounds.h ?? chunkBounds.height ?? 0) + margin;
  if (!inside) {
    issues.push(issue("warning", "object.out-of-chunk-bounds", `${path}.transform.position`, "物件显著超出 chunk-local bounds；请移动物件或调整区块边界。"));
  }
}

function validateChunkSafety(world, record, issues) {
  const { chunk } = record;
  const basePath = `regions.${record.region.id}.chunks.${chunk.id}`;
  const solids = (chunk.objects || []).filter((object) => isSolidObject(world, object));
  const harmful = (chunk.objects || []).filter(isHarmfulObject);
  const bounds = {
    x: Number(chunk.bounds?.x || 0), y: Number(chunk.bounds?.y || 0),
    w: Number(chunk.bounds?.w || 0), h: Number(chunk.bounds?.h || 0)
  };
  const safeKinds = new Map([
    ["spawn", "出生点"], ["checkpoint", "检查点复活点"], ["roomEntrance", "入口到达点"]
  ]);
  for (const object of chunk.objects || []) {
    if (!safeKinds.has(object.type)) continue;
    const envelope = playerEnvelope(world, object);
    const solidHits = solids.filter((candidate) => rectIntersects(envelope, objectBounds(world, candidate)));
    const harmfulHits = harmful.filter((candidate) => rectIntersects(envelope, objectBounds(world, candidate)));
    const path = `${basePath}.objects.${object.id}`;
    if (solidHits.length > 0) {
      issues.push(issue("error", "recovery.solid-overlap", path, `${safeKinds.get(object.type)}的玩家包络与实体碰撞重叠：${solidHits.map((item) => item.id).join("、")}`));
    }
    if (harmfulHits.length > 0) {
      issues.push(issue("error", "recovery.hazard-overlap", path, `${safeKinds.get(object.type)}的玩家包络与伤害区域重叠：${harmfulHits.map((item) => item.id).join("、")}`));
    }
    if (!rectContains(bounds, envelope)) {
      issues.push(issue("error", "recovery.out-of-bounds", path, `${safeKinds.get(object.type)}的玩家包络超出区块边界。`));
    }
  }
  for (const object of (chunk.objects || []).filter((candidate) => candidate.type === "roomExit")) {
    const exitBounds = objectBounds(world, object);
    const containingSolids = solids.filter((candidate) => rectContains(objectBounds(world, candidate), exitBounds));
    const harmfulHits = harmful.filter((candidate) => rectIntersects(exitBounds, objectBounds(world, candidate)));
    const path = `${basePath}.objects.${object.id}`;
    if (!rectContains(bounds, exitBounds)) {
      issues.push(issue("error", "connection.exit-out-of-bounds", path, "出口触发区必须完整位于区块边界内。"));
    }
    if (containingSolids.length > 0) {
      issues.push(issue("error", "connection.exit-contained-by-solid", path, `出口触发区被实体完全包住：${containingSolids.map((item) => item.id).join("、")}`));
    }
    if (harmfulHits.length > 0) {
      issues.push(issue("error", "connection.exit-hazard-overlap", path, `出口触发区与伤害区域重叠：${harmfulHits.map((item) => item.id).join("、")}`));
    }
  }
  if (world?.manifest?.namespace === "formal") {
    const sideWalls = (chunk.objects || []).filter((object) => object.type === "boundaryWall" && object.tags?.includes("side-boundary"));
    if (sideWalls.length !== 2) {
      issues.push(issue("error", "bounds.side-boundaries", `${basePath}.objects`, `正式区块必须有左右两面 side-boundary；当前为 ${sideWalls.length}。`));
    }
  }
}

function validateConnectionExitMapping(record, connection, maps, issues) {
  const directions = [
    { source: connection.from, target: connection.to },
    ...(connection.oneWay ? [] : [{ source: connection.to, target: connection.from }])
  ];
  for (const { source, target } of directions) {
    const sourceChunk = maps.chunks.get(String(source?.chunkId))?.chunk;
    if (!sourceChunk || !target) continue;
    const exits = (sourceChunk.objects || []).filter((object) => (
      object.type === "roomExit"
      && String(object.properties?.targetChunkId ?? object.properties?.targetRoomId ?? "") === String(target.chunkId)
      && String(object.properties?.targetEntranceId ?? "") === String(target.entranceId)
    ));
    if (exits.length !== 1) {
      issues.push(issue(
        "error", "connection.exit-mapping",
        `connections.${connection.id}.${source.chunkId}`,
        `连接 ${connection.id} 的 ${source.chunkId} → ${target.chunkId} 必须恰有一个 roomExit；当前为 ${exits.length}。`
      ));
    }
  }
}

function validateConnection(record, connection, connectionIndex, maps, issues, world) {
  const basePath = `regions.${record.region.id}.chunks.${record.chunk.id}.connections[${connectionIndex}]`;
  const endpoints = connectionEndpoints(connection);
  if (endpoints.length !== 2) {
    issues.push(issue("error", "connection.endpoints", basePath, "连接必须同时包含 from 与 to endpoint。"));
    return;
  }
  for (const [endpointIndex, endpoint] of endpoints.entries()) {
    const endpointPath = `${basePath}.${endpointIndex === 0 ? "from" : "to"}`;
    const endpointChunk = maps.chunks.get(String(endpoint.chunkId));
    if (!endpointChunk) {
      issues.push(issue("error", "connection.unknown-chunk", `${endpointPath}.chunkId`, `连接引用不存在的区块 ${endpoint.chunkId}`));
      continue;
    }
    const entrance = maps.objects.get(String(endpoint.entranceId));
    if (!entrance || entrance.chunk.id !== endpointChunk.chunk.id || entrance.object.type !== "roomEntrance") {
      issues.push(issue("error", "connection.unknown-entrance", `${endpointPath}.entranceId`, `入口 ${endpoint.entranceId} 不属于区块 ${endpoint.chunkId}`));
      continue;
    }
    const clearance = objectBoundsSize(entrance.object);
    const player = playerSize(world);
    if (clearance.w < player.w || clearance.h < player.h) {
      issues.push(issue("error", "connection.player-clearance", `${endpointPath}.entranceId`, `入口净空 ${clearance.w}×${clearance.h} 小于玩家 ${player.w}×${player.h}。`));
    }
  }
  const direction = String(connection.direction || "");
  if (!direction) issues.push(issue("warning", "connection.direction-missing", `${basePath}.direction`, "连接缺少方向，接缝与方向预取无法完整验证。"));
  const speed = maximumMovementSpeed(world);
  for (const endpoint of endpoints) {
    const endpointChunk = maps.chunks.get(String(endpoint.chunkId))?.chunk;
    if (!endpointChunk) continue;
    const streaming = endpointChunk.streaming || {};
    const loadBudgetSeconds = Number(streaming.loadBudgetSeconds ?? 0.5);
    const required = speed * loadBudgetSeconds;
    const actual = Number(streaming.prefetchDistance ?? streaming.prefetchRadius ?? 0);
    if (actual < required) {
      issues.push(issue("error", "streaming.prefetch-insufficient", `${basePath}.streaming`, `最大速度需要至少 ${Math.ceil(required)} units 预取，${endpointChunk.id} 仅配置 ${actual}。`, { required, actual }));
    }
  }
}

function evaluateGatedReachability(world, maps) {
  const chunks = [...maps.chunks.values()];
  const mainRouteStarts = (world?.regions || []).flatMap((region) => (
    (region.routes || []).filter((route) => route.kind === "main").map((route) => route.chunks?.[0]).filter(Boolean)
  ));
  const spawnChunks = mainRouteStarts.length > 0
    ? mainRouteStarts.map((chunkId) => maps.chunks.get(chunkId)).filter((record) => record?.chunk.objects?.some((object) => object.type === "spawn"))
    : chunks.filter(({ chunk }) => chunk.objects?.some((object) => object.type === "spawn"));
  const adjacency = new Map(chunks.map(({ chunk }) => [chunk.id, []]));
  for (const { chunk } of chunks) {
    for (const connection of chunk.connections || []) {
      const from = String(connection.from?.chunkId || "");
      const to = String(connection.to?.chunkId || "");
      if (!adjacency.has(from) || !adjacency.has(to)) continue;
      adjacency.get(from).push({ to, connection });
      if (!connection.oneWay) adjacency.get(to).push({ to: from, connection });
    }
  }
  const visited = new Set(spawnChunks.map(({ chunk }) => chunk.id));
  // Chunk startingAbilities supports isolated lab/preview entry. In a routed
  // formal world only actual start chunks grant them; entering later chunks
  // must not manufacture abilities and hide an unreachable mandatory pickup.
  const abilities = new Set(spawnChunks.flatMap(({ chunk }) => chunk.gameplay?.startingAbilities || []).map(String));
  const flags = new Set((world?.stateDefinitions?.flags || [])
    .filter((entry) => entry?.initialValue === true)
    .map((entry) => String(entry.id)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const chunkId of [...visited]) {
      const chunk = maps.chunks.get(chunkId)?.chunk;
      for (const object of chunk?.objects || []) {
        const ability = object.type === "abilityPickup" ? object.properties?.abilityId : null;
        const flag = object.type === "stateTrigger" ? object.properties?.setFlag : null;
        if (ability && !abilities.has(ability)) { abilities.add(String(ability)); changed = true; }
        if (flag && !flags.has(flag)) { flags.add(String(flag)); changed = true; }
      }
      for (const edge of adjacency.get(chunkId) || []) {
        const abilityReady = requiredAbilities(edge.connection).every((ability) => abilities.has(ability));
        const flagsReady = requiredFlags(edge.connection).every((flag) => flags.has(flag));
        if (abilityReady && flagsReady && !visited.has(edge.to)) {
          visited.add(edge.to);
          changed = true;
        }
      }
    }
  }
  return { visited, abilities, flags, spawnChunks };
}

function validateWorldReachability(world, maps, issues) {
  const chunks = [...maps.chunks.values()];
  const mainRouteGoals = (world?.regions || []).flatMap((region) => (
    (region.routes || []).filter((route) => route.kind === "main").map((route) => route.chunks?.at(-1)).filter(Boolean)
  ));
  const goalChunks = new Set(mainRouteGoals.length > 0
    ? mainRouteGoals.filter((chunkId) => maps.chunks.get(chunkId)?.chunk.objects?.some((object) => object.type === "goal"))
    : chunks.filter(({ chunk }) => chunk.objects?.some((object) => object.type === "goal")).map(({ chunk }) => chunk.id));
  const reachability = evaluateGatedReachability(world, maps);
  if (reachability.spawnChunks.length === 0) {
    issues.push(issue("error", "route.spawn-missing", "regions", "世界没有出生点。"));
    return reachability;
  }
  if (goalChunks.size === 0) {
    issues.push(issue("error", "route.goal-missing", "regions", "世界没有主出口目标。"));
    return reachability;
  }
  if (![...goalChunks].some((id) => reachability.visited.has(id))) {
    issues.push(issue("error", "route.goal-unreachable", "regions", "按能力与 flag 门状态迭代后，主出生点无法到达任何目标区块。"));
  }
  const unreachable = chunks.map(({ chunk }) => chunk.id).filter((id) => !reachability.visited.has(id));
  if (unreachable.length > 0) {
    issues.push(issue("error", "route.chunk-unreachable", "regions", `按真实起点能力、拾取物和 flag 迭代后仍有不可达区块：${unreachable.join("、")}`));
  }
  return reachability;
}

function validateStateAndAbilityGates(world, maps, issues) {
  const abilityLocations = new Map();
  const producedFlags = new Set();
  const definedFlags = new Set((world?.stateDefinitions?.flags || []).map((entry) => String(entry.id)));
  const initialTrueFlags = new Set((world?.stateDefinitions?.flags || [])
    .filter((entry) => entry?.initialValue === true).map((entry) => String(entry.id)));
  const initialAbilities = new Set(evaluateGatedReachability(world, maps).spawnChunks
    .flatMap(({ chunk }) => chunk.gameplay?.startingAbilities || []).map(String));
  for (const { chunk } of maps.chunks.values()) {
    for (const object of chunk.objects || []) {
      const ability = object.type === "abilityPickup" ? object.properties?.abilityId : null;
      if (ability) abilityLocations.set(String(ability), chunk.id);
      if (object.type === "stateTrigger" && object.properties?.setFlag) producedFlags.add(String(object.properties.setFlag));
      if (object.tags?.includes("persistent-state")
        && ["abilityPickup", "stateTrigger"].includes(object.type)
        && object.properties?.resetPolicy !== "persistent") {
        issues.push(issue("error", "state.persistent-reset-policy", `chunks.${chunk.id}.objects.${object.id}.properties.resetPolicy`, `${object.id} 标记为 persistent-state，resetPolicy 必须为 persistent。`));
      }
    }
  }
  for (const { chunk } of maps.chunks.values()) {
    for (const connection of chunk.connections || []) {
      for (const ability of requiredAbilities(connection)) {
        if (!initialAbilities.has(ability) && !abilityLocations.has(ability)) {
          issues.push(issue("error", "gate.ability-unobtainable", `connections.${connection.id}`, `能力门需要 ${ability}，但世界中没有批准的初始能力或对应拾取物。`));
        }
        const targetChunkId = String(connection.to?.chunkId || "");
        if (abilityLocations.get(ability) === targetChunkId && connection.oneWay) {
          issues.push(issue("warning", "gate.ability-cycle", `connections.${connection.id}`, `能力 ${ability} 位于受它自身单向门保护的目标区块，可能形成循环依赖。`));
        }
      }
      for (const flag of requiredFlags(connection)) {
        if (!definedFlags.has(flag)) {
          issues.push(issue("error", "gate.flag-undefined", `connections.${connection.id}`, `flag 门引用未声明的 ${flag}。`));
        } else if (!producedFlags.has(flag) && !initialTrueFlags.has(flag)) {
          issues.push(issue("error", "gate.flag-unproducible", `connections.${connection.id}`, `flag 门需要 ${flag}，但没有状态机关或初始状态能够产生它。`));
        }
      }
    }
    const policies = chunk.statePolicy || {};
    for (const object of chunk.objects || []) {
      if (object.type !== "gate") continue;
      const flag = object.properties?.requiredFlag;
      const definition = (world?.stateDefinitions?.flags || []).find((entry) => entry.id === flag);
      if (flag && object.properties?.latchOpen && !policies.worldPersistence?.includes("flags") && definition?.persistence !== "world") {
        issues.push(issue("warning", "state.cross-region-persistence", `chunks.${chunk.id}.statePolicy`, `锁存门 ${object.id} 使用 ${flag}，但 statePolicy 未明确持久化该 key。`));
      }
    }
  }
}

export async function validateWorldInStages(world, {
  signal = null,
  onProgress = () => {},
  coreValidate = validateWorldPackage,
  yieldEvery = 8
} = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const issues = [];
  const records = allChunks(world);
  const totalUnits = Math.max(1, 3 + records.length);
  let completedUnits = 0;
  const progress = (stage, label) => {
    onProgress({
      stage,
      label,
      completed: completedUnits,
      total: totalUnits,
      progress: Math.min(1, completedUnits / totalUnits),
      issueCount: issues.length
    });
  };

  throwIfAborted(signal);
  progress("schema", "验证 canonical schema");
  for (const coreIssue of coreValidate(world, { includeWarnings: true }) || []) issues.push(normalizedIssue(coreIssue));
  completedUnits += 1;
  await yieldTask();
  throwIfAborted(signal);

  const maps = { chunks: chunkMap(world), objects: objectMap(world) };
  const registries = {
    types: registryIds(world?.typeRegistry),
    assets: registryIds(world?.assetRegistry),
    prefabs: registryIds(world?.prefabRegistry)
  };
  progress("objects", "检查 transform、边界和 registry 引用");
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex];
    const chunkPath = `regions.${record.region.id}.chunks.${record.chunk.id}`;
    validateTransform(record.region, `regions.${record.region.id}`, issues);
    validateTransform(record.chunk, chunkPath, issues);
    for (const [objectIndex, object] of (record.chunk.objects || []).entries()) {
      const objectRecord = { ...record, object };
      const path = `${chunkPath}.objects[${objectIndex}]`;
      validateTransform(object, path, issues);
      validateObjectBounds(objectRecord, path, issues);
      validateObjectReferences(world, objectRecord, path, issues, registries);
    }
    for (const [connectionIndex, connection] of (record.chunk.connections || []).entries()) {
      validateConnection(record, connection, connectionIndex, maps, issues, world);
      validateConnectionExitMapping(record, connection, maps, issues);
    }
    validateChunkSafety(world, record, issues);
    completedUnits += 1;
    if (recordIndex % Math.max(1, yieldEvery) === 0) {
      progress("chunks", `检查区块 ${recordIndex + 1}/${records.length}`);
      await yieldTask();
      throwIfAborted(signal);
    }
  }

  progress("routes", "检查主路线、能力门和持久状态");
  validateWorldReachability(world, maps, issues);
  completedUnits += 1;
  await yieldTask();
  throwIfAborted(signal);
  validateStateAndAbilityGates(world, maps, issues);
  completedUnits += 1;
  progress("complete", "全图静态验证完成；仍需 Godot 固定输入回放或真人试玩");
  const finishedAt = globalThis.performance?.now?.() ?? Date.now();
  return {
    issues,
    summary: {
      errors: issues.filter((item) => item.severity === "error").length,
      warnings: issues.filter((item) => item.severity !== "error").length,
      regions: world?.regions?.length || 0,
      chunks: records.length,
      objects: maps.objects.size,
      durationMs: finishedAt - startedAt,
      cancelled: false
    }
  };
}

export class WorldValidationWorkerClient {
  constructor({
    WorkerImpl = globalThis.Worker,
    workerUrl = new URL("./world-validation-worker.js", import.meta.url)
  } = {}) {
    this.WorkerImpl = WorkerImpl;
    this.workerUrl = workerUrl;
    this.worker = null;
    this.active = null;
    this.sequence = 0;
  }

  #ensureWorker() {
    if (!this.WorkerImpl) return null;
    if (this.worker) return this.worker;
    this.worker = new this.WorkerImpl(this.workerUrl, { type: "module", name: "cablester-world-validation" });
    return this.worker;
  }

  validate(world, { onProgress = () => {} } = {}) {
    this.cancel();
    const requestId = `world-validation-${++this.sequence}`;
    const worker = this.#ensureWorker();
    if (!worker) {
      const controller = new AbortController();
      const promise = validateWorldInStages(world, { signal: controller.signal, onProgress });
      this.active = { requestId, controller, promise };
      return promise.finally(() => {
        if (this.active?.requestId === requestId) this.active = null;
      });
    }
    const promise = new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = event.data;
        if (message?.requestId !== requestId) return;
        if (message.type === "progress") onProgress(message.progress);
        if (message.type === "result") finish(resolve, message.result);
        if (message.type === "cancelled") finish(reject, abortError());
        if (message.type === "error") finish(reject, Object.assign(new Error(message.error?.message || "Worker validation failed"), message.error));
      };
      const onError = (event) => finish(reject, event.error || new Error(event.message));
      const finish = (callback, value) => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (this.active?.requestId === requestId) this.active = null;
        callback(value);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      this.active = { requestId, worker, promise: null };
      worker.postMessage({ type: "validate", requestId, world });
    });
    if (this.active?.requestId === requestId) this.active.promise = promise;
    return promise;
  }

  cancel() {
    if (!this.active) return false;
    if (this.active.controller) this.active.controller.abort();
    else this.active.worker?.postMessage({ type: "cancel", requestId: this.active.requestId });
    return true;
  }

  terminate() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
  }
}

const isWorkerScope = typeof WorkerGlobalScope !== "undefined" && globalThis instanceof WorkerGlobalScope;
if (isWorkerScope) {
  const controllers = new Map();
  globalThis.addEventListener("message", async (event) => {
    const message = event.data || {};
    if (message.type === "cancel") {
      controllers.get(message.requestId)?.abort();
      return;
    }
    if (message.type !== "validate") return;
    const controller = new AbortController();
    controllers.set(message.requestId, controller);
    try {
      const result = await validateWorldInStages(message.world, {
        signal: controller.signal,
        onProgress: (progress) => globalThis.postMessage({ type: "progress", requestId: message.requestId, progress })
      });
      globalThis.postMessage({ type: "result", requestId: message.requestId, result });
    } catch (error) {
      if (error?.name === "AbortError") globalThis.postMessage({ type: "cancelled", requestId: message.requestId });
      else globalThis.postMessage({
        type: "error",
        requestId: message.requestId,
        error: { name: error?.name, message: error?.message, stack: error?.stack }
      });
    } finally {
      controllers.delete(message.requestId);
    }
  });
}
