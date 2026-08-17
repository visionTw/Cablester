#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = resolve(root, "godot/runtime");
const canonical = JSON.parse(await readFile(resolve(root, "worlds/labs/cablester-3c-labs.world.json"), "utf8"));
const approved = canonical.gameplayTuning?.approved?.values || {};
const files = (await readdir(runtimeRoot)).filter((name) => name.endsWith(".gd")).sort();
const sources = await Promise.all(files.map(async (name) => ({
  path: relative(root, resolve(runtimeRoot, name)),
  text: await readFile(resolve(runtimeRoot, name), "utf8")
})));

const ignoredOccurrences = Object.freeze([
  /^\s*#/, // comments cannot count as runtime consumption
  /audit/i,
  /coverage/i,
  /unused/i
]);

function executableOccurrences(key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`[\"']${escaped}[\"']`);
  const matches = [];
  for (const source of sources) {
    for (const [index, line] of source.text.split("\n").entries()) {
      if (!pattern.test(line) || ignoredOccurrences.some((matcher) => matcher.test(line))) continue;
      matches.push({ path: source.path, line: index + 1, source: line.trim() });
    }
  }
  return matches;
}

const entries = Object.entries(approved).map(([key, value]) => {
  const evidence = executableOccurrences(key);
  return { key, value, consumed: evidence.length > 0, evidence };
});
const report = {
  reportVersion: 1,
  worldId: canonical.manifest.worldId,
  contentHash: canonical.manifest.contentHash,
  gameplayTuningVersion: canonical.manifest.gameplayTuningVersion,
  scope: sources.map((source) => source.path),
  methodology: "A key counts only when a quoted approved-values key occurs on an executable non-comment Godot runtime line. This is a conservative static gate; passing still requires behavioral tests.",
  totalApprovedValues: entries.length,
  consumedValues: entries.filter((entry) => entry.consumed).length,
  missingValues: entries.filter((entry) => !entry.consumed).length,
  coverageRatio: entries.length ? entries.filter((entry) => entry.consumed).length / entries.length : 1,
  consumed: entries.filter((entry) => entry.consumed),
  missing: entries.filter((entry) => !entry.consumed).map(({ key, value }) => ({ key, value })),
  ok: entries.every((entry) => entry.consumed)
};

const output = resolve(root, process.argv[2] || "artifacts/godot/tuning-coverage.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Godot approved tuning coverage: ${report.consumedValues}/${report.totalApprovedValues} consumed · ${report.missingValues} missing`);
console.log(`Report: ${relative(root, output)}`);
if (!report.ok) process.exitCode = 1;
