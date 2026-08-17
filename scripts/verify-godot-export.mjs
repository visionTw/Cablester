#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(projectRoot, "build", "godot", "Cablester.app");
const executablePath = join(appPath, "Contents", "MacOS", "Cablester");
const userRoot = join(homedir(), "Library", "Application Support", "Godot", "app_userdata", "Cablester");
const exportedEvidenceRoot = join(projectRoot, "artifacts", "godot", "exported");
const reportPath = join(exportedEvidenceRoot, "exported-app-acceptance.json");
const expectedGodotBuild = "4.7.1.stable.official.a13da4feb";
const expectedForestHash = "sha256:bd86d11711e237d8305594384fb0081ea41c003bb7121952f919030eed01c5d7";
const expectedAbilities = ["bash", "dash", "doubleJump", "glide", "hardBar", "rope", "wallGrab"];
const expectedFlags = [
  "bellroot-bells-rung",
  "cistern-sluice-open",
  "crown-route-open",
  "echo-seed-lit",
  "heartwood-awake",
  "nursery-restored"
];

const generatedUserPaths = [
  join(userRoot, "acceptance-artifacts"),
  join(userRoot, "artifacts", "godot"),
  join(userRoot, "saves", "cablester-first-forest-acceptance-tour.json"),
  join(userRoot, "saves", "cablester-first-forest-continuous-route.json")
];

const expectedEvidence = [
  ["acceptance-artifacts", "cablester-first-forest.acceptance-tour.json"],
  ["acceptance-artifacts", "cablester-first-forest.acceptance-tour.telemetry.json"],
  ["acceptance-artifacts", "first-forest.continuous-physics-route.acceptance.json"],
  ["acceptance-artifacts", "cablester-first-forest.continuous-physics-route.telemetry.json"],
  ["acceptance-artifacts", "cablester-first-forest.runtime.png"],
  ["artifacts", "godot", "cablester-first-forest.normalized-manifest.json"],
  ["artifacts", "godot", "cablester-first-forest.resolved-snapshot.json"]
];

function parseArguments(argv) {
  const options = { skipExport: false };
  for (const argument of argv) {
    if (argument === "--skip-export") options.skipExport = true;
    else if (argument === "--help") {
      console.log("Usage: node scripts/verify-godot-export.mjs [--skip-export]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function run(command, args, { timeoutMs, label }) {
  return new Promise((resolvePromise) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const retain = (current, chunk) => `${current}${chunk}`.slice(-256_000);
    child.stdout.on("data", (chunk) => { stdout = retain(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = retain(stderr, chunk); });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolvePromise({
        label, command: portableCommand([command, ...args]), startedAt, finishedAt: new Date().toISOString(),
        durationSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
        status: -1, timedOut, stdout: portableText(stdout), stderr: portableText(`${stderr}\n${error.message}`.trim())
      });
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolvePromise({
        label, command: portableCommand([command, ...args]), startedAt, finishedAt: new Date().toISOString(),
        durationSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
        status: status ?? -1, signal: signal || null, timedOut,
        stdout: portableText(stdout), stderr: portableText(stderr)
      });
    });
  });
}

function portableText(value) {
  return String(value)
    .replaceAll(projectRoot, "<repo>")
    .replaceAll(homedir(), "<user-home>")
    .replaceAll(tmpdir(), "<temp>");
}

function portableCommand(command) {
  return command.map((argument) => portableText(argument));
}

async function backupUserData() {
  const backupRoot = await mkdtemp(join(tmpdir(), "cablester-export-userdata-"));
  const records = [];
  for (let index = 0; index < generatedUserPaths.length; index += 1) {
    const source = generatedUserPaths[index];
    if (!(await exists(source))) continue;
    const destination = join(backupRoot, `${index}-${basename(source)}`);
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    records.push({ source, destination });
  }
  return { backupRoot, records };
}

async function restoreUserData(backup) {
  for (const path of generatedUserPaths) await rm(path, { recursive: true, force: true });
  for (const record of backup.records) {
    await mkdir(dirname(record.source), { recursive: true });
    await rename(record.destination, record.source);
  }
  await rm(backup.backupRoot, { recursive: true, force: true });
}

async function findFile(root, predicate) {
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const result = await findFile(path, predicate);
      if (result) return result;
    } else if (entry.isFile() && predicate(path)) return path;
  }
  return null;
}

function countResolutionStatus(value, counts = {}) {
  if (Array.isArray(value)) {
    for (const child of value) countResolutionStatus(child, counts);
  } else if (value && typeof value === "object") {
    const status = typeof value.status === "string" ? value.status : null;
    if (status) counts[status] = (counts[status] || 0) + 1;
    for (const child of Object.values(value)) countResolutionStatus(child, counts);
  }
  return counts;
}

function pngDimensions(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function addCheck(checks, name, ok, actual, expected) {
  checks.push({ name, ok: Boolean(ok), actual, expected });
}

async function copyEvidence() {
  await rm(exportedEvidenceRoot, { recursive: true, force: true });
  await mkdir(exportedEvidenceRoot, { recursive: true });
  const files = [];
  for (const parts of expectedEvidence) {
    const source = join(userRoot, ...parts);
    const destination = join(exportedEvidenceRoot, parts.at(-1));
    if (!(await exists(source))) {
      files.push({ name: parts.at(-1), source, missing: true });
      continue;
    }
    await copyFile(source, destination);
    const metadata = await stat(destination);
    files.push({
      name: basename(destination),
      path: relative(projectRoot, destination),
      bytes: metadata.size,
      sha256: await sha256(destination),
      missing: false
    });
  }
  return files;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const runs = [];
  if (!options.skipExport) {
    const exportRun = await run("scripts/export-godot.sh", [], { timeoutMs: 300_000, label: "export-release-macos" });
    runs.push(exportRun);
    if (exportRun.status !== 0) throw new Error(`macOS export failed (${exportRun.status}): ${exportRun.stderr.slice(-4_000)}`);
  }
  if (!(await exists(executablePath))) throw new Error(`Exported executable is missing: ${executablePath}`);

  const rebuildAttestationPath = join(projectRoot, "artifacts", "godot", "rebuild-attestation.json");
  const canonicalPath = join(projectRoot, "worlds", "formal", "first-forest.world.json");
  const rebuildAttestation = await readJson(rebuildAttestationPath);
  const canonical = await readJson(canonicalPath);
  const backup = await backupUserData();
  let copiedFiles = [];
  try {
    const common = ["--headless", "--fixed-fps", "120", "--"];
    const acceptanceRun = await run(executablePath,
      [...common, "--acceptance-tour", "res://worlds/formal/first-forest.world.json"],
      { timeoutMs: 180_000, label: "exported-app-acceptance-tour" });
    runs.push(acceptanceRun);
    const routeRun = await run(executablePath,
      [...common, "--continuous-route", "res://worlds/formal/first-forest.world.json"],
      { timeoutMs: 300_000, label: "exported-app-continuous-route" });
    runs.push(routeRun);
    const captureRun = await run(executablePath,
      ["--", "--capture-runtime", "res://worlds/formal/first-forest.world.json"],
      { timeoutMs: 60_000, label: "exported-app-runtime-capture" });
    runs.push(captureRun);
    copiedFiles = await copyEvidence();

    const acceptance = await readJson(join(exportedEvidenceRoot, "cablester-first-forest.acceptance-tour.json"));
    const route = await readJson(join(exportedEvidenceRoot, "first-forest.continuous-physics-route.acceptance.json"));
    const normalized = await readJson(join(exportedEvidenceRoot, "cablester-first-forest.normalized-manifest.json"));
    const snapshot = await readJson(join(exportedEvidenceRoot, "cablester-first-forest.resolved-snapshot.json"));
    const captureBuffer = await readFile(join(exportedEvidenceRoot, "cablester-first-forest.runtime.png"));
    const pckPath = await findFile(appPath, (path) => path.endsWith(".pck"));
    const resolutionStatuses = countResolutionStatus(snapshot);
    const checks = [];

    addCheck(checks, "rebuildAttestation.ok", rebuildAttestation.ok, rebuildAttestation.ok, true);
    addCheck(checks, "runs.allExitZero", runs.every((entry) => entry.status === 0 && !entry.timedOut),
      runs.map(({ label, status, timedOut }) => ({ label, status, timedOut })), "all status=0 and timedOut=false");
    addCheck(checks, "godot.buildId", snapshot.godotBuildId === expectedGodotBuild,
      snapshot.godotBuildId, expectedGodotBuild);
    addCheck(checks, "canonical.contentHash", canonical.manifest.contentHash === expectedForestHash,
      canonical.manifest.contentHash, expectedForestHash);
    addCheck(checks, "normalized.contentHash", normalized.sourceContentHash === expectedForestHash,
      normalized.sourceContentHash, expectedForestHash);
    addCheck(checks, "snapshot.contentHash", snapshot.sourceContentHash === expectedForestHash,
      snapshot.sourceContentHash, expectedForestHash);
    addCheck(checks, "snapshot.errors", Array.isArray(snapshot.errors) && snapshot.errors.length === 0,
      snapshot.errors || null, []);
    addCheck(checks, "snapshot.warnings", Array.isArray(snapshot.warnings) && snapshot.warnings.length === 0,
      snapshot.warnings || null, []);
    addCheck(checks, "snapshot.noMissingOrFallbackAssets",
      !(resolutionStatuses.missing || resolutionStatuses.fallback || resolutionStatuses.error),
      resolutionStatuses, "missing=0, fallback=0, error=0");
    addCheck(checks, "acceptanceTour.scriptedAndOk", acceptance.ok && acceptance.notHumanPlaytest === true,
      { ok: acceptance.ok, notHumanPlaytest: acceptance.notHumanPlaytest }, { ok: true, notHumanPlaytest: true });
    addCheck(checks, "acceptanceTour.coverage",
      acceptance.counts?.visitedChunks === 12 && acceptance.counts?.edges === 15
        && acceptance.counts?.forwardEdgeCoverage === 15 && acceptance.counts?.reverseEdgeCoverage === 15,
      acceptance.counts, { visitedChunks: 12, edges: 15, forwardEdgeCoverage: 15, reverseEdgeCoverage: 15 });
    addCheck(checks, "acceptanceTour.persistence", acceptance.persistence?.ok === true,
      acceptance.persistence || null, { ok: true });
    addCheck(checks, "continuousRoute.okAndCollisionDriven",
      route.ok && route.acceptanceKind === "collision-driven-continuous-held-input"
        && route.driverRestrictions?.directPlayerTransformWrites === 0
        && route.driverRestrictions?.directContactCalls === 0,
      { ok: route.ok, kind: route.acceptanceKind, restrictions: route.driverRestrictions },
      "collision-driven public input only");
    addCheck(checks, "continuousRoute.allChunks", new Set(route.visitedChunks || []).size === 12,
      route.visitedChunks || [], "12 distinct chunks");
    addCheck(checks, "continuousRoute.allAbilities", expectedAbilities.every((id) => (route.abilities || []).includes(id)),
      route.abilities || [], expectedAbilities);
    addCheck(checks, "continuousRoute.allFlags", expectedFlags.every((id) => route.flags?.[id] === true),
      route.flags || {}, expectedFlags);
    addCheck(checks, "continuousRoute.goalAndCheckpoint",
      route.goalId === "afterglow-gate:forest-exit" && route.checkpoint?.chunkId === "afterglow-gate",
      { goalId: route.goalId, checkpoint: route.checkpoint },
      { goalId: "afterglow-gate:forest-exit", checkpointChunkId: "afterglow-gate" });
    addCheck(checks, "continuousRoute.allRouteChecks",
      Object.keys(route.routeChecks || {}).length >= 13 && Object.values(route.routeChecks || {}).every(Boolean),
      route.routeChecks || {}, "all true");
    addCheck(checks, "continuousRoute.saveReload", route.savePersistence?.ok === true && route.routeChecks?.saveReload === true,
      route.savePersistence || null, { ok: true });
    addCheck(checks, "continuousRoute.performance",
      Number(route.performance?.frameTimeP95Ms) <= 16.7 && Number(route.performance?.frameTimeP99Ms) <= 33.3,
      route.performance || null, { frameTimeP95Ms: "<=16.7", frameTimeP99Ms: "<=33.3" });
    const dimensions = pngDimensions(captureBuffer);
    addCheck(checks, "runtimeCapture.visiblePng", Boolean(dimensions?.width && dimensions?.height),
      dimensions, "non-empty PNG dimensions");
    addCheck(checks, "evidence.allFreshFilesPresent", copiedFiles.every((entry) => !entry.missing),
      copiedFiles.filter((entry) => entry.missing), []);
    addCheck(checks, "bundle.pckPresent", Boolean(pckPath), pckPath ? relative(projectRoot, pckPath) : null, "*.pck");

    const executableMetadata = await stat(executablePath);
    const pckMetadata = pckPath ? await stat(pckPath) : null;
    const failures = checks.filter((check) => !check.ok);
    const report = {
      schemaVersion: 1,
      kind: "cablester-exported-macos-app-acceptance",
      generatedAt: new Date().toISOString(),
      status: failures.length ? "fail" : "pass",
      humanConfirmation: "needed",
      provenance: {
        sourceRebuildAttestation: relative(projectRoot, rebuildAttestationPath),
        sourceRebuildAttestationSha256: await sha256(rebuildAttestationPath),
        sourceFingerprint: rebuildAttestation.sourceFingerprint,
        godotBuildId: expectedGodotBuild,
        contentHash: expectedForestHash
      },
      bundle: {
        appPath: relative(projectRoot, appPath),
        executable: { path: relative(projectRoot, executablePath), bytes: executableMetadata.size, sha256: await sha256(executablePath) },
        pck: pckPath ? { path: relative(projectRoot, pckPath), bytes: pckMetadata.size, sha256: await sha256(pckPath) } : null
      },
      runs: runs.map(({ stdout, stderr, ...entry }) => ({
        ...entry,
        stdoutTail: stdout.slice(-8_000),
        stderrTail: stderr.slice(-8_000)
      })),
      evidence: copiedFiles,
      acceptanceSummary: {
        scriptedContactTour: { ok: acceptance.ok, notHumanPlaytest: acceptance.notHumanPlaytest, counts: acceptance.counts, persistence: acceptance.persistence },
        collisionDrivenContinuousRoute: {
          ok: route.ok,
          humanConfirmation: route.humanConfirmation,
          physicsTicks: route.physicsTicks,
          wallDurationSeconds: route.wallDurationSeconds,
          deaths: route.deaths,
          visitedChunks: route.visitedChunks,
          abilities: route.abilities,
          flags: route.flags,
          goalId: route.goalId,
          checkpoint: route.checkpoint,
          routeChecks: route.routeChecks,
          savePersistence: route.savePersistence,
          performance: route.performance,
          streaming: route.streaming
        },
        runtimeCapture: { dimensions, path: "artifacts/godot/exported/cablester-first-forest.runtime.png" },
        importer: { errors: snapshot.errors || [], warnings: snapshot.warnings || [], resolutionStatuses }
      },
      checks,
      failures
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Exported macOS app acceptance ${report.status.toUpperCase()} · ${relative(projectRoot, reportPath)}`);
    console.log(`route ${route.visitedChunks?.length || 0}/12 chunks · ${route.deaths} deaths · p95 ${route.performance?.frameTimeP95Ms} ms`);
    if (failures.length) {
      for (const failure of failures) console.error(`FAIL ${failure.name}: ${JSON.stringify(failure.actual)}`);
      process.exitCode = 1;
    }
  } finally {
    await restoreUserData(backup);
  }
}

main().catch((error) => {
  console.error(`Exported macOS app acceptance ERROR · ${error.stack || error.message}`);
  process.exitCode = 1;
});
