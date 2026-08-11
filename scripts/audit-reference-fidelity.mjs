import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "./reference-library-fingerprint.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(projectRoot, "levels", "reference");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

const MAPPINGS = [
  { pattern: /dash-refill/, target: "dashRefill" },
  { pattern: /double-dash/, target: "dashCapacity" },
  { pattern: /dash|wavedash|wall-bounce|jump|basic-movement|prologue-movement/, target: "ability" },
  { pattern: /wind|updraft|conveyor|gravity-field/, target: "windZone" },
  { pattern: /water|liquid|lava/, target: "liquidZone" },
  { pattern: /darkness/, target: "darknessZone" },
  { pattern: /spring|launcher|boost|bubble|bumper|badeline-orb/, target: "launcher" },
  { pattern: /crumble|falling-platform|fragile|cloud|breakable-wall|bridge-collapse|trap-bridge|stomp-floor/, target: "fragilePlatform" },
  { pattern: /moving|traffic-block|dream-block|kevin-block|core-block|carry-object|pushable-boulder/, target: "movingObject" },
  { pattern: /door|gate|lock|switch|key|barrier|world-state|toggle|seed-route|map-stone/, target: "gate-state" },
  { pattern: /hazard|spikes|thorn|fire|snowball|pursuit|chase|escape-autoscroll|escape-sequence|laser|crusher|saw/, target: "hazard" },
  { pattern: /bash|projectile|puffer|seeker/, target: "bashTarget" },
  { pattern: /grapple|lantern|swing|hook/, target: "anchor" },
  { pattern: /glide|feather|jellyfish/, target: "ability" },
  { pattern: /checkpoint/, target: "checkpoint" },
  { pattern: /route|portal|vertical|branch|hub|one-way|return|hidden/, target: "connection-layout" },
  { pattern: /ability-pickup|scripted-dash-grant/, target: "ability" },
  { pattern: /reconfiguring-map/, target: "rotationTrigger" },
  { pattern: /light-orb-escort/, target: "energyOrb" },
  { pattern: /endurance-room|safe-exploration|future-challenge-rule|stealth-cover/, target: "connection-layout" }
];

function mappingFor(mechanism) {
  return MAPPINGS.find((mapping) => mapping.pattern.test(mechanism))?.target || null;
}

function hasMappedObject(document, target) {
  const objects = document.objects;
  if (target === "dashCapacity") return (document.dashCapacity || 1) >= 2;
  if (target === "ability") return (document.startingAbilities || []).length > 0 || objects.some((object) => object.type === "abilityPickup");
  if (target === "gate-state") {
    const gates = objects.filter((object) => object.type === "gate");
    return gates.some((gate) => Boolean(gate.properties.requiredAbility))
      || (gates.length > 0 && objects.some((object) => object.type === "stateTrigger"));
  }
  if (target === "hazard") return objects.some((object) => object.type === "hazard" || (object.type === "movingObject" && object.properties.objectKind === "hazard") || (object.type === "liquidZone" && object.properties.contactDamage > 0));
  if (target === "connection-layout") return objects.some((object) => object.type === "roomExit");
  return objects.some((object) => object.type === target);
}

function markdown(audit) {
  const gaps = audit.unmappedMechanisms.map((item) => `| \`${item.mechanism}\` | ${item.entries} | ${item.games.join(", ")} | 需要机制/视觉/规则复核 |`).join("\n");
  const missingObjects = audit.missingMappedObjects.map((item) => `| \`${item.mechanism}\` | \`${item.mapping}\` | ${item.missingEntries}/${item.entries} | ${item.missingRoomIds.map((id) => `\`${id}\``).join("<br>")} |`).join("\n");
  return `# 参考关卡保真度差异审计\n\n` +
`本审计把“工程验证完成”和“原作几何/主观手感真人确认”分开。自动生成、机制等价映射或公开拓扑信号可证明本地白盒合同与机制覆盖，但不能替代合法游戏体验下的逐房几何、节奏和手感对照。\n\n` +
`## 当前分层\n\n` +
`| 指标 | 数量 |\n|---|---:|\n` +
`| 必需条目 | ${audit.totals.entries} |\n` +
`| 手工代表白盒 | ${audit.totals.handAuthored} |\n` +
`| 目录驱动首轮白盒 | ${audit.totals.catalogGenerated} |\n` +
`| 自动结构/编译通过 | ${audit.totals.automationPassed} |\n` +
`| 浏览器逐房状态通过 | ${audit.totals.browserPassed} |\n` +
`| 工程 validation 通过 | ${audit.totals.validated} |\n` +
`| continuousRun 通过 | ${audit.totals.continuousRunPassed} |\n\n` +
`Celeste 的公开净化尺寸/出生点信号覆盖 ${audit.totals.celesteLayoutSignals}/${audit.totals.celesteEntries} 房；这些信号只用于比例和候选拓扑。Ori 的 ${audit.totals.oriEntries} 个分区全部是原创本地加载边界，不是官方房间。\n\n` +
`机制使用映射：${audit.totals.mappedMechanismUses}/${audit.totals.mechanismUses} 条条目-机制使用已有 Cablester 等价系统；其中 ${audit.totals.mappedObjectPresent} 条在对应 JSON 中实际存在映射对象或能力。未映射不等于缺少关卡文件，而是保真度阻塞项。\n\n` +
`## 尚无明确等价映射的机制（${audit.unmappedMechanisms.length}）\n\n` +
`| 机制 | 涉及条目 | 游戏 | 后续动作 |\n|---|---:|---|---|\n${gaps || "| 无 | 0 | — | — |"}\n\n` +
`## 已有映射但 JSON 尚缺对应对象（${audit.missingMappedObjects.length} 个机制族）\n\n` +
`| 机制 | 预期映射 | 缺少条目 / 涉及条目 | 缺少对象的房间 |\n|---|---|---:|---|\n${missingObjects || "| 无 | — | 0/0 | — |"}\n\n` +
`## 完成门槛\n\n` +
`- 每个条目的主路线、可选连接、尺寸信号、出生点、危险物和状态变化都有显式来源、近似说明或待真人确认项；\n` +
`- 浏览器综合验收覆盖每房入口、出口目标、死亡重置、资源恢复、渲染和重进，连续审计以实际输入完成每个集合的主路线；\n` +
`- 每个 Side/区域连续通关并记录性能；\n` +
`- 机制映射、连接、自动测试、浏览器综合验收、连续主路线和性能证据全部与当前内容指纹一致后，\`validation\` 才可升为 \`validated\`；原作几何和主观手感继续单列 \`humanConfirmation=needed\`。\n`;
}

async function main() {
  const manifest = await readJson(path.join(referenceRoot, "manifest.json"));
  const index = await readJson(path.join(referenceRoot, "playable-index.json"));
  const manual = await readJson(path.join(referenceRoot, "status-overrides.json"));
  const manualIds = new Set(Object.keys(manual.entries));
  const mechanismStats = new Map();
  let mechanismUses = 0;
  let mappedMechanismUses = 0;
  let mappedObjectPresent = 0;
  for (const entry of manifest.entries) {
    const document = await readJson(path.join(projectRoot, index.rooms[entry.id].dataFile));
    for (const mechanism of entry.mechanisms) {
      mechanismUses += 1;
      const stat = mechanismStats.get(mechanism) || { mechanism, entries: 0, games: new Set(), mapping: mappingFor(mechanism), mappedPresent: 0, mappedMissing: 0, missingRoomIds: [] };
      stat.entries += 1;
      stat.games.add(entry.game === "celeste" ? "Celeste" : "Ori DE");
      mechanismStats.set(mechanism, stat);
      if (!stat.mapping) continue;
      mappedMechanismUses += 1;
      if (hasMappedObject(document, stat.mapping)) {
        mappedObjectPresent += 1;
        stat.mappedPresent += 1;
      } else {
        stat.mappedMissing += 1;
        stat.missingRoomIds.push(entry.id);
      }
    }
  }
  const contentFingerprint = await referenceLibraryFingerprint(projectRoot, {
    dataFiles: Object.values(index.rooms).map((room) => room.dataFile)
  });
  const audit = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    policy: "Gap audit only; does not upgrade validation status.",
    contentFingerprint,
    totals: {
      entries: manifest.entries.length,
      handAuthored: manifest.entries.filter((entry) => manualIds.has(entry.id)).length,
      catalogGenerated: manifest.entries.filter((entry) => !manualIds.has(entry.id)).length,
      automationPassed: manifest.entries.filter((entry) => entry.status.automation === "passed").length,
      browserPassed: manifest.entries.filter((entry) => entry.status.browser === "passed").length,
      validated: manifest.entries.filter((entry) => entry.status.validation === "validated").length,
      continuousRunPassed: manifest.entries.filter((entry) => entry.status.continuousRun === "passed").length,
      celesteEntries: manifest.entries.filter((entry) => entry.game === "celeste").length,
      celesteLayoutSignals: manifest.entries.filter((entry) => entry.game === "celeste" && entry.referenceLayout?.size && entry.referenceLayout?.spawns).length,
      oriEntries: manifest.entries.filter((entry) => entry.game !== "celeste").length,
      mechanismUses,
      mappedMechanismUses,
      mappedObjectPresent
    },
    unmappedMechanisms: [...mechanismStats.values()]
      .filter((stat) => !stat.mapping)
      .map((stat) => ({ mechanism: stat.mechanism, entries: stat.entries, games: [...stat.games].sort() }))
      .sort((left, right) => right.entries - left.entries || left.mechanism.localeCompare(right.mechanism)),
    missingMappedObjects: [...mechanismStats.values()]
      .filter((stat) => stat.mapping && stat.mappedMissing > 0)
      .map((stat) => ({ mechanism: stat.mechanism, entries: stat.entries, missingEntries: stat.mappedMissing, mapping: stat.mapping, missingRoomIds: stat.missingRoomIds }))
      .sort((left, right) => right.missingEntries - left.missingEntries || left.mechanism.localeCompare(right.mechanism)),
    mechanismMappings: [...mechanismStats.values()]
      .filter((stat) => stat.mapping)
      .map((stat) => ({ mechanism: stat.mechanism, entries: stat.entries, games: [...stat.games].sort(), mapping: stat.mapping }))
      .sort((left, right) => right.entries - left.entries || left.mechanism.localeCompare(right.mechanism))
  };
  await writeFile(path.join(referenceRoot, "fidelity-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_FIDELITY_AUDIT.md"), markdown(audit));
  console.log(`Reference fidelity gap audit: ${audit.totals.mappedMechanismUses}/${audit.totals.mechanismUses} mechanism uses mapped; ${audit.unmappedMechanisms.length} unmapped families and ${audit.missingMappedObjects.length} mapped families with missing per-room objects remain explicit gaps.`);
}

await main();
