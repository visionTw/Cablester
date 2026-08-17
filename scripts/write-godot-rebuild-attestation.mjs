#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  GODOT_BUILD_ID,
  computeContentHash,
  godotDerivedAllowlist,
  semanticDiff
} from "../src/world-schema.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_REPLAY_COUNT = 11;
const compareNames = (left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
const SOURCE_SCOPE = Object.freeze([
  "GODOT_VERSION",
  "project.godot",
  "export_presets.cfg",
  "package.json",
  "assets/game",
  "godot",
  "src",
  "worlds/formal",
  "worlds/labs",
  "worlds/registries",
  "worlds/replays",
  "scripts/export-godot.sh",
  "scripts/verify-godot-export.mjs",
  "scripts/godot.sh",
  "scripts/run-3c-parity.mjs",
  "scripts/audit-godot-tuning-coverage.mjs",
  "scripts/world-semantic-diff.mjs",
  "scripts/write-godot-rebuild-attestation.mjs"
]);

function usage() {
  return [
    "Usage:",
    "  node scripts/write-godot-rebuild-attestation.mjs fingerprint --output <path>",
    "  node scripts/write-godot-rebuild-attestation.mjs record --ledger <path> --label <label> --started-at <iso> --finished-at <iso> --status <code> --timeout-seconds <seconds> -- <command...>",
    "  node scripts/write-godot-rebuild-attestation.mjs verify-replays --output-list <path>",
    "  node scripts/write-godot-rebuild-attestation.mjs attest --ledger <path> --fingerprint-before <path> --fingerprint-after <path> --godot-build-file <path> --started-at <iso> --finished-at <iso> --output <path>"
  ].join("\n");
}

function parseOptions(argumentsList) {
  const options = { command: [] };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--") {
      options.command = argumentsList.slice(index + 1);
      break;
    }
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argumentsList[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(relativePath) {
  const absolutePath = resolve(root, relativePath);
  const metadata = await stat(absolutePath);
  if (metadata.isFile()) return [relativePath];
  if (!metadata.isDirectory()) throw new Error(`Fingerprint input is not a file or directory: ${relativePath}`);
  const files = [];
  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort(compareNames);
    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue;
      // Godot generates script UID sidecars during the first editor scan of a
      // clean checkout. The source script itself is fingerprinted; its derived
      // `.uid` neighbor must not make before/after rebuild identity unstable.
      if (entry.name.endsWith(".uid")) continue;
      const absoluteEntry = join(directory, entry.name);
      const relativeEntry = join(relativeDirectory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) await walk(absoluteEntry, relativeEntry);
      else if (entry.isFile()) files.push(relativeEntry);
      else throw new Error(`Fingerprint input contains an unsupported entry: ${relativeEntry}`);
    }
  }
  await walk(absolutePath, relativePath);
  return files;
}

async function sourceFingerprint() {
  const paths = [];
  for (const scopePath of SOURCE_SCOPE) {
    if (!(await pathExists(resolve(root, scopePath)))) {
      throw new Error(`Required fingerprint input is missing: ${scopePath}`);
    }
    paths.push(...await collectFiles(scopePath));
  }
  const uniquePaths = [...new Set(paths)].sort();
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const path of uniquePaths) {
    const contents = await readFile(resolve(root, path));
    totalBytes += contents.byteLength;
    hash.update(path);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return {
    algorithm: "sha256",
    value: `sha256:${hash.digest("hex")}`,
    fileCount: uniquePaths.length,
    totalBytes,
    scope: [...SOURCE_SCOPE],
    exclusions: ["**/*.uid", "**/.DS_Store"],
    paths: uniquePaths
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonResult(path) {
  try {
    return { ok: true, data: await readJson(path), error: "" };
  } catch (error) {
    return { ok: false, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function worldPaths() {
  const paths = [];
  for (const namespace of ["formal", "labs"]) {
    const directory = resolve(root, "worlds", namespace);
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".world.json")).sort()) {
      paths.push(`worlds/${namespace}/${name}`);
    }
  }
  return paths;
}

async function expectedReplayPaths() {
  const formal = await readJson(resolve(root, "worlds/formal/first-forest.world.json"));
  const labs = await readJson(resolve(root, "worlds/labs/cablester-3c-labs.world.json"));
  const labChunkIds = (labs.regions || []).flatMap((region) => region.chunks || []).map((chunk) => chunk.id).sort();
  return {
    worlds: { formal, labs },
    paths: [
      "worlds/replays/first-forest-runtime-smoke.replay.json",
      ...labChunkIds.map((id) => `worlds/replays/labs/${id}.replay.json`)
    ]
  };
}

async function discoveredReplayPaths() {
  const paths = [];
  for (const [directory, prefix] of [
    [resolve(root, "worlds/replays"), "worlds/replays"],
    [resolve(root, "worlds/replays/labs"), "worlds/replays/labs"]
  ]) {
    for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".replay.json")).sort()) {
      paths.push(`${prefix}/${name}`);
    }
  }
  return paths.sort();
}

async function verifyReplayInventory(outputList = "") {
  const { worlds, paths: expected } = await expectedReplayPaths();
  const discovered = await discoveredReplayPaths();
  const errors = [];
  if (expected.length !== EXPECTED_REPLAY_COUNT) {
    errors.push(`Expected the canonical topology to define ${EXPECTED_REPLAY_COUNT} replays, found ${expected.length}`);
  }
  if (JSON.stringify(discovered) !== JSON.stringify([...expected].sort())) {
    errors.push(`Replay files differ from the exact expected inventory: ${JSON.stringify({ expected: [...expected].sort(), discovered })}`);
  }
  for (const path of expected) {
    try {
      const replay = await readJson(resolve(root, path));
      const world = path.includes("/labs/") ? worlds.labs : worlds.formal;
      if (replay.replayVersion !== 1) errors.push(`${path}: replayVersion must be 1`);
      if (replay.worldId !== world.manifest.worldId) errors.push(`${path}: worldId does not match ${world.manifest.worldId}`);
      if (replay.contentHash !== world.manifest.contentHash) errors.push(`${path}: contentHash does not match its canonical world`);
      if (replay.gameplayTuningVersion !== world.manifest.gameplayTuningVersion) {
        errors.push(`${path}: gameplayTuningVersion does not match its canonical world`);
      }
      if (replay.fixedDelta !== 1 / 120) errors.push(`${path}: fixedDelta must be exactly 1/120`);
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (outputList) {
    await mkdir(dirname(outputList), { recursive: true });
    await writeFile(outputList, `${expected.join("\n")}\n`, "utf8");
  }
  const result = {
    ok: errors.length === 0,
    expectedCount: EXPECTED_REPLAY_COUNT,
    actualCount: discovered.length,
    expected,
    discovered,
    errors
  };
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
  return result;
}

async function fileEvidence(path) {
  const absolutePath = resolve(root, path);
  const contents = await readFile(absolutePath);
  const metadata = await stat(absolutePath);
  return {
    path,
    sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    bytes: contents.byteLength,
    modifiedAt: metadata.mtime.toISOString()
  };
}

async function artifactFiles() {
  const artifactRoot = resolve(root, "artifacts/godot");
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort(compareNames)) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && entry.name !== "rebuild-attestation.json") files.push(relative(root, absolutePath));
    }
  }
  if (await pathExists(artifactRoot)) await walk(artifactRoot);
  return Promise.all(files.sort().map(fileEvidence));
}

function commandLine(command) {
  return command.map((argument) => /[^A-Za-z0-9_./:=+-]/.test(argument) ? JSON.stringify(argument) : argument).join(" ");
}

function portableArgument(argument) {
  const value = String(argument).replaceAll("\\", "/");
  const repositoryRoot = root.replaceAll("\\", "/");
  const temporaryRoot = tmpdir().replaceAll("\\", "/").replace(/\/$/, "");
  if (value === repositoryRoot) return "<repo>";
  if (value.startsWith(`${repositoryRoot}/`)) return `<repo>/${value.slice(repositoryRoot.length + 1)}`;
  if (value === temporaryRoot) return "<temp>";
  if (value.startsWith(`${temporaryRoot}/`)) return `<temp>/${basename(value)}`;
  return value;
}

async function recordCommand(options) {
  for (const name of ["ledger", "label", "startedAt", "finishedAt", "status", "timeoutSeconds"]) {
    if (options[name] === undefined) throw new Error(`record requires --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  if (!options.command.length) throw new Error("record requires a command after --");
  const status = Number(options.status);
  const startedMs = Date.parse(options.startedAt);
  const finishedMs = Date.parse(options.finishedAt);
  const portableCommand = options.command.map(portableArgument);
  const entry = {
    label: options.label,
    command: portableCommand,
    commandLine: commandLine(portableCommand),
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    durationSeconds: Number.isFinite(startedMs) && Number.isFinite(finishedMs)
      ? Math.max(0, Number(((finishedMs - startedMs) / 1_000).toFixed(3)))
      : null,
    timeoutSeconds: Number(options.timeoutSeconds),
    status,
    timedOut: status === 124,
    ok: status === 0
  };
  await mkdir(dirname(options.ledger), { recursive: true });
  await appendFile(options.ledger, `${JSON.stringify(entry)}\n`, "utf8");
}

async function loadLedger(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    return [{
      label: "ledger-read",
      command: [],
      commandLine: "",
      startedAt: "",
      finishedAt: "",
      durationSeconds: null,
      timeoutSeconds: 0,
      status: 1,
      timedOut: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }];
  }
}

function addCheck(checks, name, ok, actual, expected, detail = "") {
  checks.push({ name, ok: Boolean(ok), actual, expected, ...(detail ? { detail } : {}) });
}

async function safeFingerprint(path) {
  const result = await readJsonResult(path);
  return result.ok ? result.data : { error: result.error };
}

async function buildAttestation(options) {
  for (const name of ["ledger", "fingerprintBefore", "fingerprintAfter", "godotBuildFile", "startedAt", "finishedAt", "output"]) {
    if (!options[name]) throw new Error(`attest requires --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  const checks = [];
  const commands = await loadLedger(options.ledger);
  const before = await safeFingerprint(options.fingerprintBefore);
  const after = await safeFingerprint(options.fingerprintAfter);
  const requiredBuildId = (await readFile(resolve(root, "GODOT_VERSION"), "utf8")).trim();
  let actualBuildId = "";
  try {
    actualBuildId = (await readFile(options.godotBuildFile, "utf8")).trim();
  } catch {
    // A failed version command is represented by both an empty build and its command result.
  }
  addCheck(checks, "godot.exactBuild", actualBuildId === requiredBuildId, actualBuildId, requiredBuildId);
  addCheck(checks, "godot.schemaBuild", GODOT_BUILD_ID === requiredBuildId, GODOT_BUILD_ID, requiredBuildId);
  addCheck(checks, "sourceFingerprint.beforeReadable", Boolean(before.value), before.value || before.error || "", "sha256:<64 lowercase hex>");
  addCheck(checks, "sourceFingerprint.afterReadable", Boolean(after.value), after.value || after.error || "", "sha256:<64 lowercase hex>");
  addCheck(checks, "sourceFingerprint.unchanged", Boolean(before.value) && before.value === after.value, after.value || after.error || "", before.value || before.error || "");

  const canonicalWorlds = [];
  const canonicalById = new Map();
  for (const path of await worldPaths()) {
    const absolutePath = resolve(root, path);
    const worldResult = await readJsonResult(absolutePath);
    if (!worldResult.ok) {
      addCheck(checks, `canonical.${path}.readable`, false, worldResult.error, "valid JSON");
      continue;
    }
    const world = worldResult.data;
    const worldId = world.manifest?.worldId || "";
    const declaredContentHash = world.manifest?.contentHash || "";
    const computedContentHash = await computeContentHash(world);
    canonicalById.set(worldId, { path, world });
    addCheck(checks, `canonical.${worldId}.contentHash`, declaredContentHash === computedContentHash, declaredContentHash, computedContentHash);
    addCheck(checks, `canonical.${worldId}.requiredBuild`, world.godotCompatibility?.requiredBuildId === requiredBuildId,
      world.godotCompatibility?.requiredBuildId || "", requiredBuildId);

    const normalizedPath = `artifacts/godot/${worldId}.normalized-manifest.json`;
    const snapshotPath = `artifacts/godot/${worldId}.resolved-snapshot.json`;
    const normalizedResult = await readJsonResult(resolve(root, normalizedPath));
    const snapshotResult = await readJsonResult(resolve(root, snapshotPath));
    let semanticDifferences = null;
    if (normalizedResult.ok) semanticDifferences = semanticDiff(world, normalizedResult.data, godotDerivedAllowlist);
    addCheck(checks, `artifact.${worldId}.normalizedManifest`, normalizedResult.ok, normalizedResult.ok ? normalizedPath : normalizedResult.error, normalizedPath);
    addCheck(checks, `artifact.${worldId}.semanticDiff`, normalizedResult.ok && semanticDifferences.length === 0,
      normalizedResult.ok ? semanticDifferences.length : normalizedResult.error, 0);
    addCheck(checks, `artifact.${worldId}.snapshot`, snapshotResult.ok, snapshotResult.ok ? snapshotPath : snapshotResult.error, snapshotPath);
    if (normalizedResult.ok) {
      addCheck(checks, `artifact.${worldId}.normalizedBuild`, normalizedResult.data.godotBuildId === requiredBuildId,
        normalizedResult.data.godotBuildId || "", requiredBuildId);
      addCheck(checks, `artifact.${worldId}.normalizedHash`, normalizedResult.data.sourceContentHash === declaredContentHash,
        normalizedResult.data.sourceContentHash || "", declaredContentHash);
    }
    if (snapshotResult.ok) {
      addCheck(checks, `artifact.${worldId}.snapshotBuild`, snapshotResult.data.godotBuildId === requiredBuildId,
        snapshotResult.data.godotBuildId || "", requiredBuildId);
      addCheck(checks, `artifact.${worldId}.snapshotHash`, snapshotResult.data.sourceContentHash === declaredContentHash,
        snapshotResult.data.sourceContentHash || "", declaredContentHash);
      addCheck(checks, `artifact.${worldId}.snapshotErrors`, Array.isArray(snapshotResult.data.errors) && snapshotResult.data.errors.length === 0,
        snapshotResult.data.errors ?? null, []);
      addCheck(checks, `artifact.${worldId}.snapshotWarnings`, Array.isArray(snapshotResult.data.warnings) && snapshotResult.data.warnings.length === 0,
        snapshotResult.data.warnings ?? null, []);
    }
    canonicalWorlds.push({
      path,
      namespace: world.manifest?.namespace || "",
      worldId,
      declaredContentHash,
      computedContentHash,
      hashValid: declaredContentHash === computedContentHash,
      normalizedManifest: {
        path: normalizedPath,
        readable: normalizedResult.ok,
        semanticDiffCount: semanticDifferences?.length ?? null
      },
      resolvedSnapshot: { path: snapshotPath, readable: snapshotResult.ok }
    });
  }
  addCheck(checks, "canonical.worldCount", canonicalWorlds.length === 2, canonicalWorlds.length, 2);

  const replayInventory = await verifyReplayInventory("");
  const expectedLabels = [
    "source-fingerprint-before",
    "godot-version",
    "clean-godot-cache",
    "clean-godot-artifacts",
    "create-godot-artifact-root",
    "editor-import",
    ...canonicalWorlds.map((world) => `import:${world.path}`),
    "test-worlds",
    "acceptance-tour",
    "continuous-route",
    "replay-inventory",
    ...replayInventory.expected.map((path) => `replay:${path}`),
    "3c-parity",
    "tuning-coverage",
    ...canonicalWorlds.map((world) => `semantic-diff:${world.path}`),
    "source-fingerprint-after"
  ];
  for (const label of expectedLabels) {
    const matching = commands.filter((command) => command.label === label);
    addCheck(checks, `command.${label}`, matching.length === 1 && matching[0].status === 0,
      matching.length === 1 ? matching[0].status : `${matching.length} records`, 0);
  }
  const unexpectedCommands = commands.filter((command) => !expectedLabels.includes(command.label));
  addCheck(checks, "commands.unexpected", unexpectedCommands.length === 0, unexpectedCommands.map((command) => command.label), []);
  addCheck(checks, "commands.allPassed", commands.length === expectedLabels.length && commands.every((command) => command.status === 0),
    { total: commands.length, failed: commands.filter((command) => command.status !== 0).length },
    { total: expectedLabels.length, failed: 0 });
  const pipelineStartMs = Date.parse(options.startedAt);
  const pipelineFinishMs = Date.parse(options.finishedAt);
  const invalidTimestampCommands = commands.filter((command) => {
    const startedMs = Date.parse(command.startedAt);
    const finishedMs = Date.parse(command.finishedAt);
    return !Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs
      || startedMs < pipelineStartMs - 1_000 || finishedMs > pipelineFinishMs + 1_000;
  });
  addCheck(checks, "commands.timestamps", Number.isFinite(pipelineStartMs) && Number.isFinite(pipelineFinishMs)
    && pipelineFinishMs >= pipelineStartMs && invalidTimestampCommands.length === 0,
    invalidTimestampCommands.map((command) => ({ label: command.label, startedAt: command.startedAt, finishedAt: command.finishedAt })),
    "valid ordered timestamps within the rebuild interval");

  const forest = canonicalById.get("cablester-first-forest")?.world;
  const labs = canonicalById.get("cablester-3c-labs")?.world;
  const acceptancePath = "artifacts/godot/cablester-first-forest.acceptance-tour.json";
  const continuousPath = "artifacts/godot/first-forest.continuous-physics-route.acceptance.json";
  const parityPath = "artifacts/godot/3c-parity-report.json";
  const tuningPath = "artifacts/godot/tuning-coverage.json";
  const acceptance = await readJsonResult(resolve(root, acceptancePath));
  const continuous = await readJsonResult(resolve(root, continuousPath));
  const parity = await readJsonResult(resolve(root, parityPath));
  const tuning = await readJsonResult(resolve(root, tuningPath));
  addCheck(checks, "acceptanceTour.ok", acceptance.ok && acceptance.data.ok === true, acceptance.ok ? acceptance.data.ok : acceptance.error, true);
  if (acceptance.ok && forest) {
    addCheck(checks, "acceptanceTour.build", acceptance.data.godotBuildId === requiredBuildId, acceptance.data.godotBuildId || "", requiredBuildId);
    addCheck(checks, "acceptanceTour.contentHash", acceptance.data.sourceContentHash === forest.manifest.contentHash,
      acceptance.data.sourceContentHash || "", forest.manifest.contentHash);
    addCheck(checks, "acceptanceTour.errors", Array.isArray(acceptance.data.errors) && acceptance.data.errors.length === 0, acceptance.data.errors ?? null, []);
  }
  addCheck(checks, "continuousRoute.ok", continuous.ok && continuous.data.ok === true, continuous.ok ? continuous.data.ok : continuous.error, true);
  if (continuous.ok && forest) {
    const restrictions = continuous.data.driverRestrictions || {};
    const routeChecks = continuous.data.routeChecks || {};
    const visitedChunks = new Set(continuous.data.visitedChunks || []);
    const traversedEdges = continuous.data.traversedEdges || [];
    const routes = (forest.regions || []).flatMap((region) => region.routes || []);
    const mainRoute = routes.find((route) => route.kind === "main") || { chunks: [] };
    const mainChunks = new Set(mainRoute.chunks || []);
    const allChunkIds = (forest.regions || []).flatMap((region) => region.chunks || []).map((chunk) => chunk.id).sort();
    const declaredFlags = (forest.stateDefinitions?.flags || []).map((entry) => entry.id).sort();
    const approvedAbilities = [...(forest.gameplayTuning?.approved?.abilities || [])].sort();
    addCheck(checks, "continuousRoute.kind", continuous.data.acceptanceKind === "collision-driven-continuous-held-input",
      continuous.data.acceptanceKind || "", "collision-driven-continuous-held-input");
    addCheck(checks, "continuousRoute.humanConfirmation", continuous.data.humanConfirmation === "needed",
      continuous.data.humanConfirmation || "", "needed");
    addCheck(checks, "continuousRoute.build", continuous.data.godotBuildId === requiredBuildId, continuous.data.godotBuildId || "", requiredBuildId);
    addCheck(checks, "continuousRoute.contentHash", continuous.data.contentHash === forest.manifest.contentHash,
      continuous.data.contentHash || "", forest.manifest.contentHash);
    addCheck(checks, "continuousRoute.driverRestrictions",
      restrictions.directPlayerTransformWrites === 0 && restrictions.directContactCalls === 0 && restrictions.privateStateWrites === 0
        && restrictions.inputSurface === "CablesterPlayer.set_input_frame", restrictions,
      { directPlayerTransformWrites: 0, directContactCalls: 0, privateStateWrites: 0, inputSurface: "CablesterPlayer.set_input_frame" });
    addCheck(checks, "continuousRoute.routeChecks", Object.keys(routeChecks).length > 0 && Object.values(routeChecks).every((value) => value === true), routeChecks, "every declared route check true");
    addCheck(checks, "continuousRoute.allCanonicalChunksVisited", allChunkIds.every((id) => visitedChunks.has(id)),
      [...visitedChunks].sort(), allChunkIds);
    addCheck(checks, "continuousRoute.allFormalFlags", declaredFlags.every((id) => continuous.data.flags?.[id] === true),
      Object.fromEntries(declaredFlags.map((id) => [id, continuous.data.flags?.[id] === true])),
      Object.fromEntries(declaredFlags.map((id) => [id, true])));
    addCheck(checks, "continuousRoute.allApprovedAbilities", approvedAbilities.every((id) => (continuous.data.abilities || []).includes(id)),
      [...(continuous.data.abilities || [])].sort(), approvedAbilities);
    for (const loop of routes.filter((route) => route.kind === "loop")) {
      const branchChunks = (loop.chunks || []).filter((id) => !mainChunks.has(id));
      const covered = branchChunks.length > 0 && branchChunks.every((branchId) =>
        traversedEdges.some((edge) => edge.toChunkId === branchId)
        && traversedEdges.some((edge) => edge.fromChunkId === branchId && edge.toChunkId));
      addCheck(checks, `continuousRoute.loop.${loop.id}`, covered,
        { branchChunks, traversedEdges: traversedEdges.filter((edge) => branchChunks.includes(edge.fromChunkId) || branchChunks.includes(edge.toChunkId)) },
        "each optional branch has a collision-driven entry and exit");
    }
    addCheck(checks, "continuousRoute.goal", continuous.data.goalId === "afterglow-gate:forest-exit",
      continuous.data.goalId || "", "afterglow-gate:forest-exit");
    addCheck(checks, "continuousRoute.checkpoint", Boolean(continuous.data.checkpoint?.id), continuous.data.checkpoint || {}, "non-empty checkpoint");
    addCheck(checks, "continuousRoute.errors", Array.isArray(continuous.data.errors) && continuous.data.errors.length === 0, continuous.data.errors ?? null, []);
  }
  addCheck(checks, "parity.ok", parity.ok && parity.data.ok === true, parity.ok ? parity.data.ok : parity.error, true);
  if (parity.ok && labs) {
    addCheck(checks, "parity.cases", parity.data.caseCount === 10 && parity.data.passedCases === 10 && parity.data.failedCases === 0,
      { caseCount: parity.data.caseCount, passedCases: parity.data.passedCases, failedCases: parity.data.failedCases },
      { caseCount: 10, passedCases: 10, failedCases: 0 });
    addCheck(checks, "parity.contentHash", parity.data.contentHash === labs.manifest.contentHash, parity.data.contentHash || "", labs.manifest.contentHash);
  }
  addCheck(checks, "tuning.ok", tuning.ok && tuning.data.ok === true, tuning.ok ? tuning.data.ok : tuning.error, true);
  if (tuning.ok && labs) {
    addCheck(checks, "tuning.coverage", tuning.data.totalApprovedValues === 97 && tuning.data.consumedValues === 97 && tuning.data.missingValues === 0,
      { totalApprovedValues: tuning.data.totalApprovedValues, consumedValues: tuning.data.consumedValues, missingValues: tuning.data.missingValues },
      { totalApprovedValues: 97, consumedValues: 97, missingValues: 0 });
    addCheck(checks, "tuning.contentHash", tuning.data.contentHash === labs.manifest.contentHash, tuning.data.contentHash || "", labs.manifest.contentHash);
  }

  for (const path of replayInventory.expected) {
    const replay = await readJsonResult(resolve(root, path));
    const slug = basename(path, ".replay.json");
    const world = path.includes("/labs/") ? labs : forest;
    const telemetryPath = world ? `artifacts/godot/${world.manifest.worldId}.${slug}.telemetry.json` : "";
    const telemetry = telemetryPath ? await readJsonResult(resolve(root, telemetryPath)) : { ok: false, error: "canonical world missing", data: null };
    addCheck(checks, `replay.${slug}.telemetry`, telemetry.ok, telemetry.ok ? telemetryPath : telemetry.error, telemetryPath);
    if (replay.ok && telemetry.ok && world) {
      addCheck(checks, `replay.${slug}.build`, telemetry.data.godotBuildId === requiredBuildId, telemetry.data.godotBuildId || "", requiredBuildId);
      addCheck(checks, `replay.${slug}.contentHash`, telemetry.data.sourceContentHash === world.manifest.contentHash,
        telemetry.data.sourceContentHash || "", world.manifest.contentHash);
      addCheck(checks, `replay.${slug}.expectations`,
        isDeepStrictEqual(telemetry.data.expectations || {}, replay.data.expectations || {}),
        telemetry.data.expectations || {}, replay.data.expectations || {});
      addCheck(checks, `replay.${slug}.fixedPhysicsHz`, telemetry.data.fixedPhysicsHz === 120, telemetry.data.fixedPhysicsHz ?? null, 120);
      addCheck(checks, `replay.${slug}.trajectory`, Array.isArray(telemetry.data.trajectory) && telemetry.data.trajectory.length > 0,
        Array.isArray(telemetry.data.trajectory) ? telemetry.data.trajectory.length : null, "> 0 samples");
    }
  }

  const artifacts = await artifactFiles();
  const rebuildStartedMs = Date.parse(options.startedAt);
  const requiredArtifactPaths = [
    ...canonicalWorlds.flatMap((world) => [world.normalizedManifest.path, world.resolvedSnapshot.path]),
    acceptancePath,
    "artifacts/godot/cablester-first-forest.acceptance-tour.telemetry.json",
    continuousPath,
    "artifacts/godot/cablester-first-forest.continuous-physics-route.telemetry.json",
    parityPath,
    tuningPath,
    ...replayInventory.expected.map((path) => {
      const worldId = path.includes("/labs/") ? "cablester-3c-labs" : "cablester-first-forest";
      return `artifacts/godot/${worldId}.${basename(path, ".replay.json")}.telemetry.json`;
    })
  ];
  for (const path of [...new Set(requiredArtifactPaths)]) {
    const evidence = artifacts.find((artifact) => artifact.path === path);
    addCheck(checks, `artifactFreshness.${path}`, Boolean(evidence) && Date.parse(evidence.modifiedAt) >= rebuildStartedMs - 1_000,
      evidence?.modifiedAt || "missing", `>= ${options.startedAt}`);
  }

  const failures = checks.filter((check) => !check.ok);
  const report = {
    attestationVersion: 1,
    kind: "cablester-godot-clean-rebuild",
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    godot: { requiredBuildId, actualBuildId, schemaBuildId: GODOT_BUILD_ID, exactMatch: actualBuildId === requiredBuildId && GODOT_BUILD_ID === requiredBuildId },
    contentHashes: Object.fromEntries(canonicalWorlds.map((world) => [world.worldId, world.declaredContentHash])),
    sourceFingerprint: { before, after, unchanged: Boolean(before.value) && before.value === after.value },
    replayInventory,
    canonicalWorlds,
    commands,
    artifacts,
    summary: {
      commandCount: commands.length,
      passedCommands: commands.filter((command) => command.status === 0).length,
      failedCommands: commands.filter((command) => command.status !== 0).length,
      checkCount: checks.length,
      passedChecks: checks.length - failures.length,
      failedChecks: failures.length,
      artifactCount: artifacts.length
    },
    checks,
    failures
  };
  await mkdir(dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Godot clean rebuild attestation: ${report.ok ? "PASS" : "FAIL"} · ${report.summary.passedChecks}/${report.summary.checkCount} checks`);
  console.log(`Attestation: ${relative(root, options.output)}`);
  if (!report.ok) process.exitCode = 1;
}

let emergencyAttestationOutput = "";

async function main() {
  const [subcommand, ...argumentsList] = process.argv.slice(2);
  const options = parseOptions(argumentsList);
  if (subcommand === "fingerprint") {
    if (!options.output) throw new Error("fingerprint requires --output");
    const fingerprint = await sourceFingerprint();
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(fingerprint, null, 2)}\n`, "utf8");
    console.log(`${fingerprint.value} · ${fingerprint.fileCount} source files · ${fingerprint.totalBytes} bytes`);
  } else if (subcommand === "record") {
    await recordCommand(options);
  } else if (subcommand === "verify-replays") {
    await verifyReplayInventory(options.outputList || "");
  } else if (subcommand === "attest") {
    emergencyAttestationOutput = options.output || "";
    await buildAttestation(options);
  } else {
    console.error(usage());
    process.exitCode = 2;
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  if (emergencyAttestationOutput) {
    try {
      await mkdir(dirname(emergencyAttestationOutput), { recursive: true });
      await writeFile(emergencyAttestationOutput, `${JSON.stringify({
        attestationVersion: 1,
        kind: "cablester-godot-clean-rebuild",
        generatedAt: new Date().toISOString(),
        ok: false,
        summary: { failedChecks: 1 },
        checks: [{ name: "attestation.generated", ok: false, actual: message, expected: "complete machine-readable attestation" }],
        failures: [{ name: "attestation.generated", ok: false, actual: message, expected: "complete machine-readable attestation" }]
      }, null, 2)}\n`, "utf8");
    } catch (writeError) {
      console.error(`Could not write emergency attestation: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
    }
  }
  process.exitCode = 1;
});
