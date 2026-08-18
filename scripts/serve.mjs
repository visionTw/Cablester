import { createReadStream, existsSync, lstatSync, statSync } from "node:fs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { mediaAssetRelativePath } from "../src/asset-paths.js";
import { serializeWorldPackage, validateWorldPackage } from "../src/world-schema.js";
import { validateWorldInStages } from "../src/world-validation-worker.js";

const root = process.cwd();
const argumentsList = process.argv.slice(2);
let configuredFormalWorldRoot = process.env.CABLESTER_FORMAL_WORLD_ROOT || "";
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--formal-world-root") {
    configuredFormalWorldRoot = argumentsList[index + 1] || "";
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}
const port = Number(process.env.CABLESTER_PORT || 4173);
const worldRoots = Object.freeze({
  formal: resolve(root, configuredFormalWorldRoot || "worlds/formal"),
  labs: resolve(root, "worlds/labs")
});
const externalFormalWorldRoot = Boolean(configuredFormalWorldRoot);
if (externalFormalWorldRoot) {
  if (!existsSync(worldRoots.formal) || !statSync(worldRoots.formal).isDirectory()) {
    throw new Error(`Formal world root is not a directory: ${worldRoots.formal}`);
  }
  if (lstatSync(worldRoots.formal).isSymbolicLink()) {
    throw new Error("Formal world root must not be a symbolic link.");
  }
}
const worldPathPattern = /^worlds\/(formal|labs)\/[a-z0-9][a-z0-9._-]*\.world\.json$/i;
const maximumWorldBytes = 20 * 1024 * 1024;
const repositoryCapability = String(
  process.env.CABLESTER_REPOSITORY_CAPABILITY || randomBytes(32).toString("base64url")
);
const activeSaves = new Set();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".avif": "image/avif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function isLoopbackAuthority(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const hostname = new URL(`http://${value}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function isLoopbackOrigin(value) {
  if (value === undefined) return true;
  try {
    const hostname = new URL(String(value)).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function hasRepositoryCapability(request) {
  const supplied = String(request.headers["x-cablester-repository-capability"] || "");
  const expectedBytes = Buffer.from(repositoryCapability);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function isPublishedWebPath(relativePath) {
  const path = String(relativePath || "").replaceAll("\\", "/");
  if (!path || path.includes("\0") || path.split("/").some((part) => part.startsWith("."))) return false;
  if (["index.html", "styles.css", "og.png"].includes(path)) return true;
  if (/^src\/[a-z0-9._/-]+\.js$/i.test(path)) return true;
  if (/^levels\/[a-z0-9._/-]+\.json$/i.test(path)) return true;
  if (/^assets\/[a-z0-9._/-]+\.(?:avif|jpe?g|png|svg|webp)$/i.test(path)) return true;
  if (/^worlds\/(?:formal|labs|registries)\/[a-z0-9._/-]+\.json$/i.test(path)) return true;
  return false;
}

function safeWorldPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!worldPathPattern.test(normalized) || normalized.includes("..")) return null;
  const [, namespace, fileName] = normalized.match(/^worlds\/(formal|labs)\/([^/]+)$/i) || [];
  const namespaceRoot = worldRoots[String(namespace || "").toLowerCase()];
  if (!namespaceRoot) return null;
  const absolute = resolve(namespaceRoot, fileName);
  if (!absolute.startsWith(`${namespaceRoot}${sep}`)) return null;
  return { relative: normalized, absolute, root: namespaceRoot };
}

async function listWorldFiles() {
  const files = [];
  for (const namespace of ["formal", "labs"]) {
    const directory = worldRoots[namespace];
    if (!existsSync(directory)) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".world.json")) continue;
      const path = `worlds/${namespace}/${entry.name}`;
      const stats = statSync(resolve(directory, entry.name));
      files.push({ path, namespace, bytes: stats.size, modifiedAt: stats.mtime.toISOString() });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function readRequestBody(request, limit = maximumWorldBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(Object.assign(new Error("World package exceeds the 20 MiB local save limit"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

function fileEtag(contents) {
  return `"sha256:${createHash("sha256").update(contents).digest("hex")}"`;
}

async function handleWorldRepository(request, response) {
  if (!hasRepositoryCapability(request)) {
    sendJson(response, 403, {
      message: "World repository access requires the capability URL printed by the local development server."
    });
    return;
  }
  if (request.method === "GET") {
    sendJson(response, 200, {
      mode: "read-write",
      writable: true,
      local: true,
      root: "worlds/",
      formalRootMode: externalFormalWorldRoot ? "external-private" : "repository-local",
      worlds: await listWorldFiles()
    });
    return;
  }
  if (request.method !== "PUT") {
    sendJson(response, 405, { message: "Use GET to inspect or PUT to save a world package." }, { allow: "GET, PUT" });
    return;
  }
  if (!isLoopbackOrigin(request.headers.origin)) {
    sendJson(response, 403, { message: "World saves accept only a localhost Origin." });
    return;
  }
  const target = safeWorldPath(request.headers["x-cablester-world-path"]);
  if (!target) {
    sendJson(response, 400, { message: "Save path must match worlds/formal/*.world.json or worlds/labs/*.world.json." });
    return;
  }
  if (activeSaves.has(target.absolute)) {
    sendJson(response, 409, { message: "Another save for this world is already in progress." });
    return;
  }
  activeSaves.add(target.absolute);
  try {
  let contents;
  let parsed;
  try {
    contents = await readRequestBody(request);
    parsed = JSON.parse(contents);
  } catch (error) {
    if (!response.headersSent) sendJson(response, error.status || 400, { message: error.message || "Invalid JSON body." });
    return;
  }
  if (!contents.endsWith("\n")) {
    sendJson(response, 400, { message: "Canonical repository saves require exactly one trailing newline." });
    return;
  }
  const targetNamespace = target.relative.split("/")[1];
  if (parsed?.manifest?.namespace !== targetNamespace) {
    sendJson(response, 422, {
      message: `World manifest namespace ${parsed?.manifest?.namespace || "<missing>"} does not match target namespace ${targetNamespace}.`
    });
    return;
  }
  const staged = await validateWorldInStages(parsed);
  const validationIssues = [
    ...validateWorldPackage(parsed),
    ...(staged.issues || [])
  ];
  const validationErrors = validationIssues.filter((item) => (item.severity || "error") === "error");
  if (validationErrors.length > 0) {
    sendJson(response, 422, {
      message: `Canonical validation failed with ${validationErrors.length} error(s).`,
      issues: validationErrors
    });
    return;
  }
  const deterministicContents = await serializeWorldPackage(parsed);
  if (contents !== deterministicContents) {
    sendJson(response, 422, {
      message: "World body is not the deterministic sealed representation (two spaces, canonical key order, current contentHash, one LF)."
    });
    return;
  }
  const existed = existsSync(target.absolute);
  if (existed && lstatSync(target.absolute).isSymbolicLink()) {
    sendJson(response, 400, { message: "Refusing to overwrite a symbolic link." });
    return;
  }
  if (existed && !request.headers["if-match"]) {
    sendJson(response, 428, { message: "Existing world saves require If-Match; reload the repository file first." });
    return;
  }
  if (existed) {
    const current = await readFile(target.absolute);
    if (fileEtag(current) !== request.headers["if-match"]) {
      sendJson(response, 412, { message: "World file changed on disk; reload before saving." });
      return;
    }
  }
  await mkdir(dirname(target.absolute), { recursive: true });
  const realParent = await realpath(dirname(target.absolute));
  if (realParent !== await realpath(target.root)) {
    sendJson(response, 400, { message: "Resolved save path leaves its configured world namespace." });
    return;
  }
  const temporary = resolve(dirname(target.absolute), `.${basename(target.absolute)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    if (!existed && existsSync(target.absolute)) {
      throw Object.assign(new Error("World file appeared while saving; reload before retrying."), { status: 409 });
    }
    if (existed) {
      const latest = await readFile(target.absolute);
      if (fileEtag(latest) !== request.headers["if-match"]) {
        throw Object.assign(new Error("World file changed while saving; reload before retrying."), { status: 412 });
      }
    }
    await rename(temporary, target.absolute);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    sendJson(response, error.status || 500, { message: `Atomic world save failed: ${error.message}` });
    return;
  }
  const etag = fileEtag(contents);
  sendJson(response, existed ? 200 : 201, {
    saved: true,
    path: target.relative,
    bytes: Buffer.byteLength(contents),
    atomic: true,
    etag
  }, { etag });
  } finally {
    activeSaves.delete(target.absolute);
  }
}

const server = createServer(async (request, response) => {
  if (!isLoopbackAuthority(request.headers.host)) {
    sendJson(response, 403, { message: "This development server accepts only localhost Host headers." });
    return;
  }
  const rawPath = (request.url || "/").split("?")[0];
  if (rawPath === "/__cablester/world-repository") {
    await handleWorldRepository(request, response).catch((error) => {
      if (!response.headersSent) sendJson(response, 500, { message: error.message });
      else response.end();
    });
    return;
  }
  const requestedMedia = /^\/media\//i.test(rawPath);
  const rawMediaRelativePath = mediaAssetRelativePath(rawPath);
  if (requestedMedia && !rawMediaRelativePath) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  let requestPath;
  try {
    requestPath = decodeURIComponent(rawPath);
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid URL encoding");
    return;
  }
  const assetPath = rawMediaRelativePath ? `/assets/${rawMediaRelativePath}` : requestPath;
  const relativePath = assetPath === "/" ? "index.html" : assetPath.slice(1);
  const safePath = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  if (!isPublishedWebPath(safePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    response.end("Not found");
    return;
  }
  const mappedWorldPath = safeWorldPath(safePath);
  let filePath = mappedWorldPath?.absolute || join(root, safePath);

  if ((!mappedWorldPath && !filePath.startsWith(root)) || !existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (mappedWorldPath) {
    const mappedRoot = await realpath(mappedWorldPath.root);
    if (lstatSync(filePath).isSymbolicLink() || dirname(await realpath(filePath)) !== mappedRoot) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
      response.end("Not found");
      return;
    }
  }

  if (!statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const headers = {
    "cache-control": requestPath.startsWith("/assets/") || requestPath.startsWith("/media/")
      ? "public, max-age=3600, must-revalidate"
      : "no-store",
    "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "x-content-type-options": "nosniff"
  };
  if (safeWorldPath(safePath)) headers.etag = fileEtag(await readFile(filePath));
  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Cablester prototype: http://127.0.0.1:${port}/#cablester-repository-capability=${encodeURIComponent(repositoryCapability)}`);
  if (externalFormalWorldRoot) console.log("Formal worlds: external private directory mapped to /worlds/formal/");
});
