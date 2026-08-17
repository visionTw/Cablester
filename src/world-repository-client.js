const DEFAULT_ENDPOINT = "/__cablester/world-repository";
const WORLD_PATH_PATTERN = /^worlds\/(formal|labs)\/[a-z0-9][a-z0-9._-]*\.world\.json$/i;
const REPOSITORY_CAPABILITY_PARAMETER = "cablester-repository-capability";
const REPOSITORY_CAPABILITY_HEADER = "x-cablester-repository-capability";

export class WorldRepositoryError extends Error {
  constructor(message, { code = "WORLD_REPOSITORY_ERROR", status = 0, details = null } = {}) {
    super(message);
    this.name = "WorldRepositoryError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ReadOnlyWorldRepositoryError extends WorldRepositoryError {
  constructor(message = "线上版本为只读；请在 localhost 开发服务器中保存仓库文件。") {
    super(message, { code: "WORLD_REPOSITORY_READ_ONLY", status: 403 });
    this.name = "ReadOnlyWorldRepositoryError";
  }
}

export function assertWorldRepositoryPath(path) {
  const normalized = String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!WORLD_PATH_PATTERN.test(normalized) || normalized.includes("..")) {
    throw new WorldRepositoryError(
      "世界仓库路径必须是 worlds/formal/*.world.json 或 worlds/labs/*.world.json。",
      { code: "INVALID_WORLD_REPOSITORY_PATH", status: 400, details: { path } }
    );
  }
  return normalized;
}

async function defaultSerialize(world) {
  const { serializeWorldPackage } = await import("./world-hash.js");
  return serializeWorldPackage(world);
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function absoluteUrl(endpoint, path = "") {
  if (/^https?:\/\//i.test(endpoint)) return `${endpoint}${path}`;
  if (typeof location === "undefined") return `${endpoint}${path}`;
  return new URL(`${endpoint}${path}`, location.href).href;
}

function normalizeWorldEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const candidate = typeof entry === "string" ? entry : entry?.path;
    try {
      const path = assertWorldRepositoryPath(candidate);
      if (seen.has(path)) continue;
      seen.add(path);
      result.push({ ...(typeof entry === "object" && entry ? entry : {}), path });
    } catch {
      // A repository capability response is untrusted network input. Ignore
      // entries outside the two checked-in canonical namespaces.
    }
  }
  return result;
}

export function readWorldRepositoryCapability({
  locationLike = globalThis.location,
  historyLike = globalThis.history
} = {}) {
  const hash = typeof locationLike?.hash === "string" ? locationLike.hash.replace(/^#/, "") : "";
  const parameters = new URLSearchParams(hash);
  const capability = String(
    parameters.get(REPOSITORY_CAPABILITY_PARAMETER)
      || historyLike?.state?.cablesterRepositoryCapability
      || ""
  ).trim();
  if (!capability) return "";
  parameters.delete(REPOSITORY_CAPABILITY_PARAMETER);
  if (typeof historyLike?.replaceState === "function") {
    const remainingHash = parameters.toString();
    const nextUrl = `${locationLike.pathname || "/"}${locationLike.search || ""}${remainingHash ? `#${remainingHash}` : ""}`;
    historyLike.replaceState({
      ...(historyLike.state && typeof historyLike.state === "object" ? historyLike.state : {}),
      cablesterRepositoryCapability: capability
    }, "", nextUrl);
  }
  return capability;
}

export class WorldRepositoryClient {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    endpoint = DEFAULT_ENDPOINT,
    serialize = defaultSerialize,
    repositoryCapability = readWorldRepositoryCapability()
  } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("WorldRepositoryClient requires fetch");
    this.fetch = fetchImpl;
    this.endpoint = endpoint.replace(/\/$/, "");
    this.serialize = serialize;
    this.repositoryCapability = String(repositoryCapability || "");
    this.capability = null;
    this.etags = new Map();
  }

  async inspect({ refresh = false } = {}) {
    if (this.capability && !refresh) return structuredClone(this.capability);
    try {
      const response = await this.fetch(absoluteUrl(this.endpoint), {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(this.repositoryCapability ? { [REPOSITORY_CAPABILITY_HEADER]: this.repositoryCapability } : {})
        },
        cache: "no-store"
      });
      const body = await responseJson(response);
      if (!response.ok) {
        throw new WorldRepositoryError(body.message || `HTTP ${response.status}`, {
          code: "WORLD_REPOSITORY_INSPECT_FAILED",
          status: response.status,
          details: body
        });
      }
      this.capability = {
        mode: body.mode === "read-write" ? "read-write" : "read-only",
        writable: body.mode === "read-write" && body.writable !== false,
        local: body.local !== false,
        worlds: normalizeWorldEntries(body.worlds),
        reason: body.reason || null
      };
    } catch (error) {
      this.capability = {
        mode: "read-only",
        writable: false,
        local: false,
        worlds: [],
        reason: error instanceof WorldRepositoryError && error.status === 403
          ? error.message
          : "当前页面没有经过授权的本地仓库写回能力；仓库为只读。"
      };
    }
    return structuredClone(this.capability);
  }

  async list({ refresh = true } = {}) {
    return (await this.inspect({ refresh })).worlds;
  }

  async load(path) {
    const safePath = assertWorldRepositoryPath(path);
    const response = await this.fetch(absoluteUrl("/", safePath), {
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!response.ok) {
      throw new WorldRepositoryError(`无法读取 ${safePath}（HTTP ${response.status}）`, {
        code: "WORLD_LOAD_FAILED",
        status: response.status,
        details: await responseJson(response)
      });
    }
    const etag = response.headers?.get?.("etag");
    if (etag) this.etags.set(safePath, etag);
    return response.json();
  }

  async save(path, world, { expectedEtag = this.etags.get(String(path)), force = false } = {}) {
    const safePath = assertWorldRepositoryPath(path);
    const capability = await this.inspect();
    if (!capability.writable) throw new ReadOnlyWorldRepositoryError(capability.reason || undefined);
    const contents = await this.serialize(world);
    const headers = {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-cablester-world-path": safePath,
      ...(this.repositoryCapability ? { [REPOSITORY_CAPABILITY_HEADER]: this.repositoryCapability } : {})
    };
    if (expectedEtag && !force) headers["if-match"] = expectedEtag;
    const response = await this.fetch(absoluteUrl(this.endpoint), {
      method: "PUT",
      headers,
      body: contents,
      cache: "no-store"
    });
    const body = await responseJson(response);
    if (response.status === 403) throw new ReadOnlyWorldRepositoryError(body.message);
    if (!response.ok) {
      throw new WorldRepositoryError(body.message || `仓库保存失败（HTTP ${response.status}）`, {
        code: response.status === 412 ? "WORLD_SAVE_CONFLICT" : "WORLD_SAVE_FAILED",
        status: response.status,
        details: body
      });
    }
    const etag = response.headers?.get?.("etag") || body.etag;
    if (etag) this.etags.set(safePath, etag);
    return {
      ...body,
      path: safePath,
      etag: etag || null,
      bytes: new TextEncoder().encode(contents).byteLength,
      contents
    };
  }
}

export function createWorldRepositoryClient(options) {
  return new WorldRepositoryClient(options);
}
