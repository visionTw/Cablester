import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "./reference-library-fingerprint.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(projectRoot, "levels", "reference");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function reachable(startId, adjacency) {
  const visited = new Set();
  const pending = startId ? [startId] : [];
  while (pending.length > 0) {
    const roomId = pending.pop();
    if (visited.has(roomId)) continue;
    visited.add(roomId);
    for (const target of adjacency.get(roomId) || []) if (!visited.has(target)) pending.push(target);
  }
  return visited;
}

function reverseAdjacency(roomIds, adjacency) {
  const reverse = new Map(roomIds.map((roomId) => [roomId, []]));
  for (const [source, targets] of adjacency) {
    for (const target of targets) if (reverse.has(target)) reverse.get(target).push(source);
  }
  return reverse;
}

function weakComponents(roomIds, adjacency) {
  const undirected = new Map(roomIds.map((roomId) => [roomId, new Set()]));
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      if (!undirected.has(target)) continue;
      undirected.get(source).add(target);
      undirected.get(target).add(source);
    }
  }
  const remaining = new Set(roomIds);
  const components = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const component = reachable(start, new Map([...undirected].map(([id, targets]) => [id, [...targets]])));
    for (const roomId of component) remaining.delete(roomId);
    components.push([...component].sort());
  }
  return components.sort((left, right) => right.length - left.length);
}

function markdown(audit) {
  const rows = audit.collections.map((collection) => `| \`${collection.id}\` | ${collection.game} | ${collection.rooms} | ${collection.internalEdges} | ${collection.weakComponents} | ${collection.forwardReachable}/${collection.rooms} | ${collection.reverseReachable}/${collection.rooms} | ${collection.strongFromFirst ? "是" : "否"} |`);
  return `# 参考关卡连接图审计\n\n` +
`本报告只审计机器可读连接图、JSON 出口覆盖和目标入口解析。它不能替代实际输入下的路线通关、机制手感或高保真核对。\n\n` +
`## 总结\n\n` +
`- 必需条目：${audit.totals.rooms}；集合：${audit.totals.collections}；候选有向连接：${audit.totals.manifestConnections}；\n` +
`- JSON 已实现候选连接：${audit.totals.authoredManifestConnections}/${audit.totals.manifestConnections}；缺少 ${audit.totals.missingManifestConnections}；\n` +
`- JSON 额外出口：${audit.totals.extraAuthoredExits}；无效目标或入口：${audit.totals.invalidExitTargets}；\n` +
`- 弱连通集合：${audit.totals.weaklyConnectedCollections}/${audit.totals.collections}；从首房可双向覆盖全部集合：${audit.totals.strongFromFirstCollections}/${audit.totals.collections}。\n\n` +
`手工代表房只实现已核对的连接，因此“缺少候选连接”不自动视为错误；候选低置信度边也不能因为生成器已放出口就升级为已验证。\n\n` +
`## 集合结果\n\n` +
`| 集合 | 游戏 | 房间 | 内部边 | 弱连通分量 | 首房正向 | 首房反向 | 首房双向全覆盖 |\n|---|---|---:|---:|---:|---:|---:|---|\n${rows.join("\n")}\n\n` +
`## 未实现候选连接（${audit.missingManifestConnections.length}）\n\n` +
`${audit.missingManifestConnections.length ? audit.missingManifestConnections.map((item) => `- \`${item.source}\` → \`${item.target}\`（${item.direction}）`).join("\n") : "无"}\n\n` +
`## 额外 JSON 出口（${audit.extraAuthoredExits.length}）\n\n` +
`${audit.extraAuthoredExits.length ? audit.extraAuthoredExits.map((item) => `- \`${item.source}\` → \`${item.target}\`（\`${item.exitId}\`）`).join("\n") : "无"}\n`;
}

async function main() {
  const manifest = await readJson(path.join(referenceRoot, "manifest.json"));
  const index = await readJson(path.join(referenceRoot, "playable-index.json"));
  const entryById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const documentById = new Map();
  for (const room of Object.values(index.rooms)) {
    documentById.set(room.id, await readJson(path.join(projectRoot, room.dataFile)));
  }

  const missingManifestConnections = [];
  const extraAuthoredExits = [];
  const invalidExitTargets = [];
  let authoredManifestConnections = 0;
  for (const entry of manifest.entries) {
    const document = documentById.get(entry.id);
    const exits = document.objects.filter((object) => object.type === "roomExit");
    const authoredTargets = new Set(exits.map((exit) => exit.properties.targetRoomId));
    const manifestTargets = new Set(entry.connections.map((connection) => connection.target));
    for (const connection of entry.connections) {
      if (authoredTargets.has(connection.target)) authoredManifestConnections += 1;
      else missingManifestConnections.push({ source: entry.id, target: connection.target, direction: connection.direction });
    }
    for (const exit of exits) {
      if (!manifestTargets.has(exit.properties.targetRoomId)) extraAuthoredExits.push({ source: entry.id, target: exit.properties.targetRoomId, exitId: exit.id });
      const targetDocument = documentById.get(exit.properties.targetRoomId);
      const entranceExists = targetDocument?.objects.some((object) => object.type === "roomEntrance" && object.id === exit.properties.targetEntranceId);
      if (!entryById.has(exit.properties.targetRoomId) || !entranceExists) {
        invalidExitTargets.push({ source: entry.id, exitId: exit.id, target: exit.properties.targetRoomId, entrance: exit.properties.targetEntranceId });
      }
    }
  }

  const collections = index.collections.map((collection) => {
    const roomSet = new Set(collection.roomIds);
    const adjacency = new Map(collection.roomIds.map((roomId) => [roomId, []]));
    let internalEdges = 0;
    for (const roomId of collection.roomIds) {
      for (const connection of entryById.get(roomId).connections) {
        if (!roomSet.has(connection.target)) continue;
        adjacency.get(roomId).push(connection.target);
        internalEdges += 1;
      }
    }
    const first = collection.roomIds[0];
    const forward = reachable(first, adjacency);
    const reverse = reachable(first, reverseAdjacency(collection.roomIds, adjacency));
    const components = weakComponents(collection.roomIds, adjacency);
    return {
      id: collection.id,
      game: collection.game,
      rooms: collection.roomIds.length,
      internalEdges,
      weakComponents: components.length,
      largestWeakComponent: components[0]?.length || 0,
      forwardReachable: forward.size,
      reverseReachable: reverse.size,
      strongFromFirst: forward.size === collection.roomIds.length && reverse.size === collection.roomIds.length
    };
  });

  const manifestConnections = manifest.entries.reduce((sum, entry) => sum + entry.connections.length, 0);
  const contentFingerprint = await referenceLibraryFingerprint(projectRoot, {
    dataFiles: Object.values(index.rooms).map((room) => room.dataFile)
  });
  const audit = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: "Graph audit only; does not upgrade playable, browser, validation, or continuousRun status.",
    contentFingerprint,
    totals: {
      rooms: manifest.entries.length,
      collections: collections.length,
      manifestConnections,
      authoredManifestConnections,
      missingManifestConnections: missingManifestConnections.length,
      extraAuthoredExits: extraAuthoredExits.length,
      invalidExitTargets: invalidExitTargets.length,
      weaklyConnectedCollections: collections.filter((collection) => collection.weakComponents === 1).length,
      strongFromFirstCollections: collections.filter((collection) => collection.strongFromFirst).length
    },
    collections,
    missingManifestConnections,
    extraAuthoredExits,
    invalidExitTargets
  };
  await writeFile(path.join(referenceRoot, "graph-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_GRAPH_AUDIT.md"), markdown(audit));
  if (invalidExitTargets.length > 0) throw new Error(`${invalidExitTargets.length} authored exits have invalid targets or entrances`);
  console.log(`Reference graph audit: ${audit.totals.rooms} rooms, ${audit.totals.collections} collections, ${audit.totals.weaklyConnectedCollections} weakly connected.`);
}

await main();
