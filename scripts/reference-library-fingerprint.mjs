import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

async function indexedRoomFiles(projectRoot) {
  const index = JSON.parse(await readFile(path.join(projectRoot, "levels", "reference", "playable-index.json"), "utf8"));
  return Object.values(index.rooms).map((room) => room.dataFile);
}

async function runtimeSourceFiles(projectRoot) {
  const entries = await readdir(path.join(projectRoot, "src"), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `src/${entry.name}`);
}

export async function referenceLibraryFingerprint(projectRoot, options = {}) {
  const roomFiles = options.dataFiles || await indexedRoomFiles(projectRoot);
  const runtimeFiles = await runtimeSourceFiles(projectRoot);
  const files = [...new Set([
    "index.html",
    "styles.css",
    ...runtimeFiles,
    ...roomFiles
  ].map(normalizeRelativePath))].sort();
  const hash = createHash("sha256");

  for (const relativePath of files) {
    const content = await readFile(path.join(projectRoot, relativePath));
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
    fileCount: files.length,
    roomFileCount: roomFiles.length,
    runtimeFileCount: runtimeFiles.length + 2
  };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  console.log(JSON.stringify(await referenceLibraryFingerprint(projectRoot), null, 2));
}
