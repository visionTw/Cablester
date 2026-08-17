#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareWebGodotTelemetry, runWebFixedInputReplay } from "../src/web-replay-runner.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_CASE_COUNT = 10;

function parseArgs(argv) {
  const options = {
    world: "worlds/labs/cablester-3c-labs.world.json",
    replays: "worlds/replays/labs",
    telemetry: "artifacts/godot",
    output: ""
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--world") options.world = argv[++index];
    else if (argument === "--replays") options.replays = argv[++index];
    else if (argument === "--telemetry") options.telemetry = argv[++index];
    else if (argument === "--output") options.output = argv[++index];
    else if (["--help", "-h"].includes(argument)) options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/run-3c-parity.mjs [options]",
    "  --world <path>       canonical 3C world package",
    "  --replays <dir>      fixed-input replay v1 directory",
    "  --telemetry <dir>    Godot replay telemetry directory",
    "  --output <path>      optional JSON report path"
  ].join("\n");
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function compactFailure(assertion) {
  return `${assertion.name}: actual=${JSON.stringify(assertion.actual)} expected=${JSON.stringify(assertion.expected)} tolerance=${JSON.stringify(assertion.tolerance)}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const worldPath = resolve(root, options.world);
  const replayDirectory = resolve(root, options.replays);
  const telemetryDirectory = resolve(root, options.telemetry);
  const world = await json(worldPath);
  const chunks = (world.regions || []).flatMap((region) => region.chunks || []);
  if (chunks.length !== EXPECTED_CASE_COUNT) {
    throw new Error(`Expected ${EXPECTED_CASE_COUNT} canonical 3C chunks, found ${chunks.length}`);
  }

  const results = [];
  for (const chunk of chunks) {
    const replayPath = resolve(replayDirectory, `${chunk.id}.replay.json`);
    const telemetryPath = resolve(telemetryDirectory, `${world.manifest.worldId}.${chunk.id}.telemetry.json`);
    try {
      const [replay, godotTelemetry] = await Promise.all([json(replayPath), json(telemetryPath)]);
      const webTelemetry = runWebFixedInputReplay({ world, replay });
      const comparison = compareWebGodotTelemetry({ world, replay, webTelemetry, godotTelemetry });
      results.push({
        ...comparison,
        replayPath: relative(root, replayPath),
        godotTelemetryPath: relative(root, telemetryPath),
        webTelemetry
      });
    } catch (error) {
      results.push({
        caseId: chunk.id,
        ok: false,
        replayPath: relative(root, replayPath),
        godotTelemetryPath: relative(root, telemetryPath),
        assertions: [{
          name: "runner.completed",
          ok: false,
          actual: error instanceof Error ? error.message : String(error),
          expected: "completed",
          tolerance: "exact"
        }]
      });
    }
  }

  const report = {
    reportVersion: 1,
    worldId: world.manifest.worldId,
    contentHash: world.manifest.contentHash,
    gameplayTuningVersion: world.manifest.gameplayTuningVersion,
    caseCount: results.length,
    passedCases: results.filter((result) => result.ok).length,
    failedCases: results.filter((result) => !result.ok).length,
    ok: results.length === EXPECTED_CASE_COUNT && results.every((result) => result.ok),
    results
  };

  for (const result of results) {
    const failures = (result.assertions || []).filter((assertion) => !assertion.ok);
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.caseId} · ${result.assertions?.length || 0} assertions · ${failures.length} failed`);
    for (const failure of failures) console.log(`  ${compactFailure(failure)}`);
  }
  console.log(`3C parity: ${report.passedCases}/${report.caseCount} cases passed · ${report.ok ? "PASS" : "FAIL"}`);

  if (options.output) {
    const outputPath = resolve(root, options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report: ${relative(root, outputPath)}`);
  }
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
