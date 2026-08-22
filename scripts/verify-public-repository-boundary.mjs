#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const modes = new Set(process.argv.slice(2));
if (modes.size === 0) modes.add("--source");
for (const mode of modes) {
  if (!["--source", "--dist"].includes(mode)) throw new Error(`Unknown argument: ${mode}`);
}

const SOURCE_EXCLUDED_DIRECTORIES = new Set([".git", ".godot", "dist", "node_modules"]);

async function walk(directory, relative = "", { source = false } = {}) {
  const current = path.join(directory, relative);
  if (!existsSync(current)) return [];
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const child = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      if (source && (SOURCE_EXCLUDED_DIRECTORIES.has(entry.name) || child === "artifacts/godot")) continue;
      files.push(...await walk(directory, child, { source }));
    } else if (entry.isFile() && (!source || !child.endsWith(".import"))) {
      files.push(child);
    }
  }
  return files.sort();
}

function forbidden(files) {
  const forbiddenPrefixes = [
    "artifacts/godot/",
    "godot/",
    "levels/reference/",
    "worlds/formal/"
  ];
  const forbiddenExact = new Set([
    "GODOT_VERSION",
    "export_presets.cfg",
    "project.godot",
    "scripts/audit-godot-tuning-coverage.mjs",
    "scripts/export-godot.sh",
    "scripts/godot.sh",
    "scripts/run-3c-parity.mjs",
    "scripts/verify-godot-export.mjs",
    "scripts/write-godot-rebuild-attestation.mjs",
    "test/godot-tuning-coverage.test.js"
  ]);
  return files.filter((file) => forbiddenExact.has(file)
    || forbiddenPrefixes.some((prefix) => file.startsWith(prefix))
    || /(?:^|\/)\.godot(?:\/|$)/.test(file)
    || /\.(?:gd|tscn|tres|uid)$/.test(file));
}

const results = [];
if (modes.has("--source")) {
  const sourceFiles = await walk(root, "", { source: true });
  results.push({ target: "source", files: sourceFiles.length, violations: forbidden(sourceFiles) });
}
if (modes.has("--dist")) {
  const distRoot = path.join(root, "dist");
  if (!existsSync(distRoot)) throw new Error("dist/ does not exist; run npm run build first.");
  const distFiles = await walk(distRoot);
  results.push({ target: "dist", files: distFiles.length, violations: forbidden(distFiles) });
}

const violations = results.flatMap((result) => result.violations.map((file) => `${result.target}:${file}`));
if (violations.length > 0) {
  throw new Error(`Public repository boundary failed:\n${violations.map((file) => `- ${file}`).join("\n")}`);
}
process.stdout.write(`${JSON.stringify({ ok: true, checks: results.map(({ target, files }) => ({ target, files })), violations: [] })}\n`);
