#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSyntheticWorld } from "../src/world-preview.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "http://127.0.0.1:4193/";
const DEFAULT_OUTPUT = join(projectRoot, "artifacts", "web", "world-studio-performance.json");
const DEFAULT_CANVAS_DURATION_MS = 4_000;
const DEFAULT_INTERACTION_SAMPLES = 6;
const DEFAULT_TRANSITION_COUNT = 50;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const EXPECTED_FOREST_HASH = "sha256:6cf1cda4c2e221c77c135ff3a5c2c10aeefdae52bc61d64c06e500a4b347441e";
const SOURCE_FINGERPRINT_PATHS = Object.freeze([
  "scripts/audit-world-studio-performance.mjs",
  "test/world-studio-performance.test.js",
  "index.html",
  "styles.css",
  "scripts/serve.mjs",
  "src/game.js",
  "src/level-objects.js",
  "src/world-editor.js",
  "src/world-hash.js",
  "src/world-preview.js",
  "src/world-repository-client.js",
  "src/world-streaming.js",
  "src/world-validation-worker.js",
  "src/world-schema.js",
  "worlds/labs/cablester-composite-showcase.world.json"
]);

const THRESHOLDS = Object.freeze({
  minimumAverageFps: 59.5,
  maximumP95FrameMs: 20,
  maximumP99FrameMs: 33.3,
  maximumInteractionPaintMs: 100,
  maximumStreamingTailRatio: 1.35,
  streamingCacheBudgetBytes: 24 * 1024 * 1024,
  streamingLoadedHeadroomBytes: 12 * 1024 * 1024,
  maximumRetainedHeapGrowthBytes: 8 * 1024 * 1024
});

function parseArguments(argv) {
  const options = {
    url: DEFAULT_URL,
    output: DEFAULT_OUTPUT,
    chrome: process.env.CHROME_PATH || null,
    canvasDurationMs: DEFAULT_CANVAS_DURATION_MS,
    interactionSamples: DEFAULT_INTERACTION_SAMPLES,
    transitionCount: DEFAULT_TRANSITION_COUNT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--url" && value) options.url = value, index += 1;
    else if (argument === "--output" && value) options.output = resolve(projectRoot, value), index += 1;
    else if (argument === "--chrome" && value) options.chrome = value, index += 1;
    else if (argument === "--canvas-duration-ms" && value) options.canvasDurationMs = Number(value), index += 1;
    else if (argument === "--interaction-samples" && value) options.interactionSamples = Number(value), index += 1;
    else if (argument === "--transition-count" && value) options.transitionCount = Number(value), index += 1;
    else if (argument === "--help") {
      console.log(`Usage: node scripts/audit-world-studio-performance.mjs [options]\n\n` +
        `  --url URL                    Local Cablester URL (${DEFAULT_URL})\n` +
        `  --output PATH                Evidence path (${relative(projectRoot, DEFAULT_OUTPUT)})\n` +
        `  --chrome PATH                Google Chrome executable\n` +
        `  --canvas-duration-ms N       Real Canvas pan/zoom sample (${DEFAULT_CANVAS_DURATION_MS})\n` +
        `  --interaction-samples N      Samples per select/switch/edit action (${DEFAULT_INTERACTION_SAMPLES})\n` +
        `  --transition-count N         Synthetic cross-region transitions (${DEFAULT_TRANSITION_COUNT})`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (!Number.isFinite(options.canvasDurationMs) || options.canvasDurationMs < 2_000) {
    throw new Error("canvasDurationMs must be at least 2000");
  }
  if (!Number.isFinite(options.interactionSamples) || options.interactionSamples < 3) {
    throw new Error("interactionSamples must be at least 3");
  }
  if (!Number.isFinite(options.transitionCount) || options.transitionCount < 50) {
    throw new Error("transitionCount must be at least 50");
  }
  options.interactionSamples = Math.floor(options.interactionSamples);
  options.transitionCount = Math.floor(options.transitionCount);
  options.url = new URL(options.url).href;
  options.output = resolve(options.output);
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function distribution(values) {
  const clean = values.filter((value) => Number.isFinite(value) && value >= 0);
  const total = clean.reduce((sum, value) => sum + value, 0);
  return {
    count: clean.length,
    averageMs: Number((clean.length ? total / clean.length : 0).toFixed(3)),
    p50Ms: Number(percentile(clean, 0.5).toFixed(3)),
    p95Ms: Number(percentile(clean, 0.95).toFixed(3)),
    p99Ms: Number(percentile(clean, 0.99).toFixed(3)),
    maximumMs: Number((clean.length ? Math.max(...clean) : 0).toFixed(3))
  };
}

function frameMetrics(deltas, requestedDurationMs) {
  const valid = deltas.filter((value) => Number.isFinite(value) && value > 0 && value < 1_000);
  const total = valid.reduce((sum, value) => sum + value, 0);
  const average = valid.length ? total / valid.length : 0;
  return {
    requestedDurationMs,
    measuredDurationMs: Number(total.toFixed(3)),
    frameCount: valid.length,
    averageFps: Number((average ? 1_000 / average : 0).toFixed(3)),
    averageFrameMs: Number(average.toFixed(3)),
    p50FrameMs: Number(percentile(valid, 0.5).toFixed(3)),
    p95FrameMs: Number(percentile(valid, 0.95).toFixed(3)),
    p99FrameMs: Number(percentile(valid, 0.99).toFixed(3)),
    worstFrameMs: Number((valid.length ? Math.max(...valid) : 0).toFixed(3)),
    framesOver16_7Ms: valid.filter((value) => value > 16.7).length,
    framesOver33_3Ms: valid.filter((value) => value > 33.3).length,
    framesOver50Ms: valid.filter((value) => value > 50).length
  };
}

async function sha256File(path) {
  return `sha256:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
}

async function sourceFingerprint() {
  const hash = createHash("sha256");
  for (const path of SOURCE_FINGERPRINT_PATHS) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(projectRoot, path)));
    hash.update("\0");
  }
  return {
    algorithm: "sha256",
    value: `sha256:${hash.digest("hex")}`,
    paths: [...SOURCE_FINGERPRINT_PATHS]
  };
}

async function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through known Chrome locations.
    }
  }
  throw new Error("Google Chrome was not found; pass --chrome or set CHROME_PATH");
}

async function executableVersion(executable) {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("close", () => resolvePromise(output.trim() || "unknown"));
    child.once("error", () => resolvePromise("unknown"));
  });
}

async function ensureServer(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return { child: null, owned: false, output: () => "", navigationUrl: url };
  } catch {
    // Start a dedicated loopback server below.
  }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.port) {
    throw new Error(`Audit URL is unavailable and cannot be started as a loopback server: ${url}`);
  }
  const repositoryCapability = randomBytes(32).toString("base64url");
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CABLESTER_PORT: parsed.port,
      CABLESTER_REPOSITORY_CAPABILITY: repositoryCapability
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-24_000); });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Development server exited with ${child.exitCode}: ${output}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) {
        const navigationUrl = new URL(url);
        navigationUrl.hash = `cablester-repository-capability=${encodeURIComponent(repositoryCapability)}`;
        return { child, owned: true, output: () => output, navigationUrl: navigationUrl.href };
      }
    } catch {
      // Wait for listen().
    }
    await sleep(50);
  }
  child.kill("SIGTERM");
  throw new Error(`Development server did not become ready: ${output}`);
}

async function closeServer(server) {
  if (!server?.owned || !server.child || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => server.child.once("exit", resolvePromise)),
    sleep(2_000)
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

async function launchChrome(executable) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cablester-world-studio-perf-"));
  const profileDirectory = join(temporaryRoot, "profile");
  await mkdir(profileDirectory, { recursive: true });
  const port = await new Promise((resolvePromise, rejectPromise) => {
    const probe = createNetServer();
    probe.once("error", rejectPromise);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? rejectPromise(error) : resolvePromise(address.port));
    });
  });
  const child = spawn(executable, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    `--disk-cache-dir=${join(temporaryRoot, "cache")}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-frame-rate-limit",
    "--disable-renderer-backgrounding",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-features=CalculateNativeWinOcclusion,MediaRouter",
    "--metrics-recording-only",
    "--mute-audio",
    `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
  const deadline = Date.now() + 15_000;
  let browserWebSocketUrl;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error(`Chrome exited before CDP startup (${child.exitCode}): ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        browserWebSocketUrl = (await response.json()).webSocketDebuggerUrl;
        if (browserWebSocketUrl) break;
      }
    } catch {
      // Edge may hand off to a long-lived headless child on Windows.
    }
    await sleep(50);
  }
  if (!browserWebSocketUrl) {
    child.kill("SIGTERM");
    throw new Error(`Chrome did not expose CDP within 15 seconds: ${stderr}`);
  }
  return {
    child,
    port,
    temporaryRoot,
    browserWebSocketUrl,
    stderr: () => stderr,
    async close() {
      if (child.exitCode === null) child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolvePromise) => child.once("exit", resolvePromise)),
        sleep(2_000)
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      const safePrefix = join(tmpdir(), "cablester-world-studio-perf-");
      if (!temporaryRoot.startsWith(safePrefix) || !basename(temporaryRoot).startsWith("cablester-world-studio-perf-")) {
        throw new Error(`Refusing to remove unexpected temporary directory: ${temporaryRoot}`);
      }
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  };
}

class CDPConnection {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error(`CDP open timeout: ${this.webSocketUrl}`)), 10_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectPromise(new Error(`CDP connection failed: ${this.webSocketUrl}`));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.#message(event.data));
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("CDP WebSocket closed"));
      this.pending.clear();
    });
    return this;
  }

  #message(data) {
    const message = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  send(method, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP is not open for ${method}`));
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

async function createPageConnection(chrome) {
  const response = await fetch(`http://127.0.0.1:${chrome.port}/json/list`);
  if (!response.ok) throw new Error(`Could not list Chrome targets: HTTP ${response.status}`);
  const target = (await response.json()).find((candidate) => candidate.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Chrome did not expose a page target");
  return new CDPConnection(target.webSocketDebuggerUrl).open();
}

async function evaluate(cdp, expression, { awaitPromise = true } = {}) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || "page evaluation failed";
    throw new Error(description);
  }
  return response.result?.value;
}

async function pollPage(cdp, expression, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, expression);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

class NetworkRecorder {
  constructor(cdp, origin) {
    this.origin = origin;
    this.requests = new Map();
    this.inflight = new Set();
    this.sequence = 0;
    cdp.on("Network.requestWillBeSent", (event) => this.#request(event));
    cdp.on("Network.requestServedFromCache", (event) => this.#cache(event));
    cdp.on("Network.responseReceived", (event) => this.#response(event));
    cdp.on("Network.dataReceived", (event) => this.#data(event));
    cdp.on("Network.loadingFinished", (event) => this.#finished(event));
    cdp.on("Network.loadingFailed", (event) => this.#failed(event));
  }

  #accepts(url) {
    try { return new URL(url).origin === this.origin; } catch { return false; }
  }

  #request(event) {
    if (!this.#accepts(event.request?.url)) return;
    const record = {
      sequence: ++this.sequence,
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      type: event.type || "Other",
      status: null,
      mimeType: null,
      fromCache: false,
      transferBytes: 0,
      decodedBodyBytes: 0,
      failed: false,
      errorText: null
    };
    this.requests.set(event.requestId, record);
    this.inflight.add(event.requestId);
  }

  #cache(event) {
    const record = this.requests.get(event.requestId);
    if (record) record.fromCache = true;
  }

  #response(event) {
    const record = this.requests.get(event.requestId);
    if (!record) return;
    record.status = event.response.status;
    record.mimeType = event.response.mimeType;
    record.fromCache ||= Boolean(event.response.fromDiskCache || event.response.fromPrefetchCache || event.response.fromServiceWorker);
  }

  #data(event) {
    const record = this.requests.get(event.requestId);
    if (record) record.decodedBodyBytes += event.dataLength || 0;
  }

  #finished(event) {
    const record = this.requests.get(event.requestId);
    if (!record) return;
    record.transferBytes = event.encodedDataLength || 0;
    this.inflight.delete(event.requestId);
  }

  #failed(event) {
    const record = this.requests.get(event.requestId);
    if (!record) return;
    record.failed = true;
    record.errorText = event.errorText || "unknown network failure";
    this.inflight.delete(event.requestId);
  }

  mark() {
    return this.sequence;
  }

  async waitForIdle(idleMs = 500, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    let idleSince = null;
    while (Date.now() < deadline) {
      const pending = [...this.inflight].filter((requestId) => {
        const record = this.requests.get(requestId);
        return !record?.url.endsWith("/src/world-validation-worker.js");
      });
      if (pending.length === 0) {
        idleSince ||= Date.now();
        if (Date.now() - idleSince >= idleMs) return;
      } else idleSince = null;
      await sleep(50);
    }
    const pending = [...this.inflight].map((requestId) => this.requests.get(requestId)?.url || requestId);
    throw new Error(`Network did not become idle; ${this.inflight.size} request(s) remain: ${pending.join(", ")}`);
  }

  snapshot({ afterSequence = 0 } = {}) {
    const resources = [...this.requests.values()]
      .filter((record) => record.sequence > afterSequence)
      .map((record) => {
        const url = new URL(record.url);
        return { ...record, url: `${url.pathname}${url.search}` };
      });
    const byType = {};
    for (const resource of resources) byType[resource.type] = (byType[resource.type] || 0) + 1;
    return {
      requestCount: resources.length,
      failedCount: resources.filter((item) => item.failed).length,
      httpErrorCount: resources.filter((item) => Number(item.status) >= 400).length,
      applicationErrorCount: resources.filter((item) => item.failed || (Number(item.status) >= 400 && item.url !== "/favicon.ico")).length,
      cachedRequestCount: resources.filter((item) => item.fromCache).length,
      transferBytes: resources.reduce((sum, item) => sum + item.transferBytes, 0),
      decodedBodyBytes: resources.reduce((sum, item) => sum + item.decodedBodyBytes, 0),
      byType,
      resources
    };
  }
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    ...viewport,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    screenOrientation: { type: "landscapePrimary", angle: 0 }
  });
}

async function performanceMetrics(cdp) {
  const response = await cdp.send("Performance.getMetrics");
  const metrics = Object.fromEntries(response.metrics.map((entry) => [entry.name, entry.value]));
  return {
    documents: metrics.Documents ?? null,
    nodes: metrics.Nodes ?? null,
    jsEventListeners: metrics.JSEventListeners ?? null,
    jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null,
    jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null,
    layoutCount: metrics.LayoutCount ?? null,
    recalcStyleCount: metrics.RecalcStyleCount ?? null,
    taskDurationSeconds: metrics.TaskDuration ?? null,
    scriptDurationSeconds: metrics.ScriptDuration ?? null
  };
}

async function pageMemory(cdp) {
  return evaluate(cdp, `(() => performance.memory ? ({
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    usedJSHeapSize: performance.memory.usedJSHeapSize
  }) : null)()`);
}

async function memorySnapshot(cdp, { collectGarbage = false } = {}) {
  if (collectGarbage) {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(100);
  }
  return { cdp: await performanceMetrics(cdp), page: await pageMemory(cdp) };
}

async function collectCanvasSample(cdp, { label, durationMs }) {
  const token = `worldPerfCanvas${Date.now()}${Math.random().toString(16).slice(2)}`;
  const setup = await evaluate(cdp, `(async () => {
    const canvas = document.querySelector("#world-preview-canvas");
    if (!canvas || canvas.offsetParent === null) throw new Error("World Preview Canvas is not visible");
    const rect = canvas.getBoundingClientRect();
    const digest = () => {
      const probe = document.createElement("canvas");
      probe.width = 32;
      probe.height = 18;
      const context = probe.getContext("2d", { willReadFrequently: true });
      context.drawImage(canvas, 0, 0, probe.width, probe.height);
      const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 1) hash = Math.imul(hash ^ pixels[index], 16777619);
      return (hash >>> 0).toString(16).padStart(8, "0");
    };
    const state = {
      label: ${JSON.stringify(label)},
      startTime: performance.now(),
      deltas: [],
      inputPaintMs: [],
      eventCounts: { pointermove: 0, wheel: 0 },
      firstInputPixelDigest: null,
      startPixelDigest: digest(),
      longTaskStartIndex: window.__cablesterWorldPerf?.longTasks?.length || 0,
      canvas: { width: canvas.width, height: canvas.height, clientWidth: rect.width, clientHeight: rect.height },
      visibleLabel: document.querySelector("#world-visible-label")?.textContent || null,
      lodLabel: document.querySelector("#world-lod-label")?.textContent || null
    };
    const onInput = (event) => {
      if (event.type !== "pointermove" && event.type !== "wheel") return;
      state.eventCounts[event.type] += 1;
      const receivedAt = performance.now();
      if (!state.firstInputPixelDigest) state.firstInputPixelDigest = digest();
      requestAnimationFrame(() => state.inputPaintMs.push(performance.now() - receivedAt));
    };
    canvas.addEventListener("pointermove", onInput);
    canvas.addEventListener("wheel", onInput);
    window[${JSON.stringify(token)}] = new Promise((resolve) => {
      let previous = null;
      const tick = (timestamp) => {
        if (previous !== null) state.deltas.push(timestamp - previous);
        previous = timestamp;
        if (performance.now() - state.startTime >= ${JSON.stringify(durationMs)}) {
          canvas.removeEventListener("pointermove", onInput);
          canvas.removeEventListener("wheel", onInput);
          const longTasks = (window.__cablesterWorldPerf?.longTasks || []).slice(state.longTaskStartIndex)
            .filter((entry) => entry.startTime <= performance.now());
          resolve({
            ...state,
            endTime: performance.now(),
            endPixelDigest: digest(),
            longTasks
          });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, token: ${JSON.stringify(token)} };
  })()`);

  const centerX = Math.round(setup.x + setup.width / 2);
  const centerY = Math.round(setup.y + setup.height / 2);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: centerX, y: centerY });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: centerX, y: centerY, button: "left", buttons: 1, clickCount: 1
  });
  const intervalMs = 10;
  const steps = Math.ceil(durationMs / intervalMs);
  try {
    for (let index = 0; index < steps; index += 1) {
      const phase = index / 15;
      const x = Math.round(centerX + Math.sin(phase) * Math.min(90, setup.width * 0.16));
      const y = Math.round(centerY + Math.cos(phase * 0.71) * Math.min(55, setup.height * 0.12));
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      if (index > 0 && index % 40 === 0) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x,
          y,
          deltaX: 0,
          deltaY: (Math.floor(index / 40) % 2 === 0 ? -55 : 42)
        });
      }
      await sleep(intervalMs);
    }
  } finally {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: centerX, y: centerY, button: "left", buttons: 0, clickCount: 1
    });
  }
  const raw = await evaluate(cdp, `window[${JSON.stringify(token)}]`);
  await evaluate(cdp, `delete window[${JSON.stringify(token)}]; true`);
  return {
    label,
    canvas: raw.canvas,
    visibleLabel: raw.visibleLabel,
    lodLabel: raw.lodLabel,
    realInputEvents: raw.eventCounts,
    minimumCanvasDraws: raw.eventCounts.pointermove + raw.eventCounts.wheel,
    inputToNextPaint: distribution(raw.inputPaintMs),
    frames: frameMetrics(raw.deltas, durationMs),
    pixelEvidence: {
      start: raw.startPixelDigest,
      firstInput: raw.firstInputPixelDigest,
      end: raw.endPixelDigest,
      changed: new Set([raw.startPixelDigest, raw.firstInputPixelDigest, raw.endPixelDigest].filter(Boolean)).size > 1
    },
    longTasks: {
      count: raw.longTasks.length,
      totalDurationMs: Number(raw.longTasks.reduce((sum, entry) => sum + entry.duration, 0).toFixed(3)),
      maximumDurationMs: Number((raw.longTasks.length ? Math.max(...raw.longTasks.map((entry) => entry.duration)) : 0).toFixed(3)),
      entries: raw.longTasks
    }
  };
}

async function measureEditorInteractions(cdp, sampleCount) {
  return evaluate(cdp, `(async () => {
    const waitForPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const measure = async (action) => {
      const startedAt = performance.now();
      action();
      const syncMs = performance.now() - startedAt;
      await waitForPaint();
      return { syncMs, paintMs: performance.now() - startedAt };
    };
    const samples = { selection: [], viewSwitch: [], edit: [] };
    for (let index = 0; index < ${JSON.stringify(sampleCount)}; index += 1) {
      const chunks = [...document.querySelectorAll('.world-tree-item[data-kind="chunk"]')];
      const target = chunks[index % 2 === 0 ? 0 : Math.max(0, chunks.length - 1)];
      if (!target) throw new Error("No chunk tree targets are available");
      samples.selection.push(await measure(() => target.click()));
    }
    const viewNames = ["world", "region", "chunk"];
    for (let index = 0; index < ${JSON.stringify(sampleCount)}; index += 1) {
      const target = document.querySelector('[data-world-view="' + viewNames[index % viewNames.length] + '"]');
      if (!target) throw new Error("Missing World Studio view tab");
      samples.viewSwitch.push(await measure(() => target.click()));
    }
    document.querySelector('.world-tree-item[data-kind="chunk"]')?.click();
    await waitForPaint();
    for (let index = 0; index < ${JSON.stringify(sampleCount)}; index += 1) {
      const input = document.querySelector('#world-inspector input[data-world-path="name"]');
      if (!input) throw new Error("Chunk name editor was not rendered");
      const original = input.value;
      samples.edit.push(await measure(() => {
        input.value = original + "-perf-" + index;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }));
      document.querySelector("#world-undo")?.click();
      await waitForPaint();
    }
    const summarize = (records) => {
      const summarizeValues = (values) => {
        const sorted = [...values].sort((a, b) => a - b);
        const pick = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || 0;
        return {
          count: values.length,
          averageMs: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
          p50Ms: pick(0.5), p95Ms: pick(0.95), p99Ms: pick(0.99), maximumMs: sorted.at(-1) || 0
        };
      };
      return {
        sync: summarizeValues(records.map((record) => record.syncMs)),
        paint: summarizeValues(records.map((record) => record.paintMs)),
        samples: records
      };
    };
    return {
      selection: summarize(samples.selection),
      viewSwitch: summarize(samples.viewSwitch),
      edit: summarize(samples.edit),
      dirtyAfterUndo: window.cablesterWorldStudio.session.dirty,
      worldId: window.cablesterWorldStudio.session.world.manifest.worldId
    };
  })()`);
}

async function sessionState(cdp) {
  return evaluate(cdp, `(() => {
    const studio = window.cablesterWorldStudio;
    const session = studio.session;
    const changes = session.changes();
    const serialized = JSON.stringify(session.world);
    let digest = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) digest = Math.imul(digest ^ serialized.charCodeAt(index), 16777619);
    return {
      worldId: session.world.manifest.worldId,
      dirty: session.dirty,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      selection: { ...session.selection },
      lastMutation: session.lastMutation,
      changeCount: changes.changes.length,
      changes,
      semanticBytes: new Blob([serialized]).size,
      semanticDigest: (digest >>> 0).toString(16).padStart(8, "0")
    };
  })()`);
}

async function locateEditableCanvasTarget(cdp, view, kind) {
  const setup = await evaluate(cdp, `(async () => {
    const { createWorldPreviewModel, fitWorldView } = await import("./src/world-preview.js");
    const { buildWorldSpatialIndex } = await import("./src/world-streaming.js");
    const studio = window.cablesterWorldStudio;
    const world = studio.session.world;
    const region = world.regions[0];
    const chunk = region?.chunks?.[0];
    if (!region || !chunk) throw new Error("World needs a region and chunk for Canvas editing audit");
    if (${JSON.stringify(view)} === "world") studio.session.select("world", world.manifest.worldId);
    else if (${JSON.stringify(view)} === "region") studio.session.select("region", region.id);
    else studio.session.select("chunk", chunk.id);
    document.querySelector('[data-world-view="${view}"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.querySelector("#world-preview-canvas");
    const rect = canvas.getBoundingClientRect();
    const index = buildWorldSpatialIndex(world);
    const model = createWorldPreviewModel(world, {
      view: ${JSON.stringify(view)},
      regionId: region.id,
      chunkId: chunk.id,
      spatialIndex: index,
      zoom: 1
    });
    const fitBounds = ${JSON.stringify(view)} === "chunk"
      ? index.chunks.get(chunk.id).bounds
      : ${JSON.stringify(view)} === "region"
        ? model.regionGraph.nodes.find((node) => node.id === region.id).bounds
        : model.bounds;
    const camera = fitWorldView(fitBounds, rect.width, rect.height);
    let target;
    if (${JSON.stringify(kind)} === "region") target = model.regionGraph.nodes.find((node) => node.id === region.id);
    else if (${JSON.stringify(kind)} === "chunk") target = model.chunkGraph.nodes.find((node) => node.id === chunk.id);
    else {
      const record = [...index.objects.values()].find((candidate) => candidate.chunkId === chunk.id
        && !["boundaryWall"].includes(candidate.object.type));
      target = record ? { id: record.id, position: record.worldPosition } : null;
    }
    if (!target?.position) throw new Error("No ${kind} target position in ${view} view");
    return {
      view: ${JSON.stringify(view)},
      kind: ${JSON.stringify(kind)},
      canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      point: {
        x: rect.x + rect.width / 2 + (target.position.x - camera.x) * camera.zoom,
        y: rect.y + rect.height / 2 + (target.position.y - camera.y) * camera.zoom
      },
      expectedId: target.id,
      camera
    };
  })()`);
  const point = { x: Math.round(setup.point.x), y: Math.round(setup.point.y) };
  // Do not pre-click: selecting Region and Chunk intentionally drills down to the next
  // view, which would invalidate the coordinates before the real drag begins.
  return { ...setup, point, selection: { kind, id: setup.expectedId, computedFromPublicModel: true } };
}

async function dragCanvasPoint(cdp, point, delta) {
  const start = { x: Math.round(point.x), y: Math.round(point.y) };
  const end = { x: Math.round(point.x + delta.x), y: Math.round(point.y + delta.y) };
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", ...start, button: "left", buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(start.x + (end.x - start.x) * step / 8),
      y: Math.round(start.y + (end.y - start.y) * step / 8),
      button: "left",
      buttons: 1
    });
    await sleep(8);
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...end, button: "left", buttons: 0, clickCount: 1 });
  await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  return { start, end, delta };
}

async function exerciseCanvasEditing(cdp) {
  const original = await sessionState(cdp);
  const drags = [];
  for (const spec of [
    { view: "world", kind: "region", delta: { x: 34, y: 22 } },
    { view: "region", kind: "chunk", delta: { x: 37, y: -19 } },
    { view: "chunk", kind: "object", delta: { x: 41, y: 23 } }
  ]) {
    const located = await locateEditableCanvasTarget(cdp, spec.view, spec.kind);
    const before = await sessionState(cdp);
    const pointer = await dragCanvasPoint(cdp, located.point, spec.delta);
    const afterMove = await sessionState(cdp);
    await evaluate(cdp, `(() => { document.querySelector("#world-undo").click(); return true; })()`);
    await evaluate(cdp, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    const afterUndo = await sessionState(cdp);
    drags.push({
      ...spec,
      target: located.selection,
      pointer,
      before: {
        dirty: before.dirty,
        changeCount: before.changeCount,
        semanticDigest: before.semanticDigest,
        lastMutation: before.lastMutation
      },
      afterMove: {
        dirty: afterMove.dirty,
        changeCount: afterMove.changeCount,
        semanticChanged: afterMove.semanticDigest !== before.semanticDigest,
        lastMutation: afterMove.lastMutation
      },
      afterUndo: {
        dirty: afterUndo.dirty,
        changeCount: afterUndo.changeCount,
        semanticRestored: afterUndo.semanticDigest === before.semanticDigest,
        lastMutation: afterUndo.lastMutation
      }
    });
  }

  await evaluate(cdp, `(async () => {
    document.querySelector('[data-world-view="world"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  const beforePan = await sessionState(cdp);
  const canvasRect = await evaluate(cdp, `(() => {
    const rect = document.querySelector("#world-preview-canvas").getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  })()`);
  // Bottom-right is kept outside graph labels/nodes/chunks after fit in the canonical forest.
  // Verify the session selection remains untouched and fail if a future layout makes it a target.
  const panPoint = { x: canvasRect.x + canvasRect.width - 24, y: canvasRect.y + canvasRect.height - 24 };
  const panPointer = await dragCanvasPoint(cdp, panPoint, { x: -74, y: -46 });
  const afterPan = await sessionState(cdp);
  const backgroundPan = {
    pointer: panPointer,
    before: { dirty: beforePan.dirty, changeCount: beforePan.changeCount, semanticDigest: beforePan.semanticDigest },
    after: {
      dirty: afterPan.dirty,
      changeCount: afterPan.changeCount,
      semanticUnchanged: afterPan.semanticDigest === beforePan.semanticDigest,
      lastMutation: afterPan.lastMutation
    }
  };

  const connection = await evaluate(cdp, `(async () => {
    document.querySelector('[data-world-view="chunk"]').click();
    const chunkButtons = [...document.querySelectorAll('.world-tree-item[data-kind="chunk"]')];
    for (const button of chunkButtons) {
      button.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const create = document.querySelector('[data-world-action="add-connection"]:not(:disabled)');
      const target = document.querySelector("#world-connection-to");
      if (!create || !target?.options?.length) continue;
      const session = window.cablesterWorldStudio.session;
      const beforeDigest = JSON.stringify(session.world);
      const beforeConnections = session.world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.connections || []);
      const originalOptionCount = target.options.length;
      const fromEntranceId = document.querySelector("#world-connection-from")?.value;
      const unusedOption = [...target.options].find((option) => {
        const [encodedChunkId = "", encodedEntranceId = ""] = option.value.split("|");
        const toChunkId = decodeURIComponent(encodedChunkId);
        const toEntranceId = decodeURIComponent(encodedEntranceId);
        return !beforeConnections.some((edge) => edge.from?.chunkId === button.dataset.id
          && edge.to?.chunkId === toChunkId
          && edge.from?.entranceId === fromEntranceId
          && edge.to?.entranceId === toEntranceId);
      });
      if (!unusedOption) continue;
      target.value = unusedOption.value;
      create.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const afterConnections = session.world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.connections || []);
      const created = afterConnections.find((edge) => !beforeConnections.some((candidate) => candidate.id === edge.id));
      if (!created) continue;
      const afterCreate = {
        dirty: session.dirty,
        changeCount: session.changes().changes.length,
        connectionCountDelta: session.world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.connections || []).length - beforeConnections.length,
        created,
        storedCopies: session.world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.connections || []).filter((edge) => edge.id === created.id).length
      };
      document.querySelector("#world-undo").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        sourceChunkId: button.dataset.id,
        targetOptionCount: originalOptionCount,
        beforeConnectionCount: beforeConnections.length,
        afterCreate,
        afterUndo: {
          dirty: session.dirty,
          changeCount: session.changes().changes.length,
          semanticRestored: JSON.stringify(session.world) === beforeDigest,
          createdConnectionAbsent: !session.world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.connections || []).some((edge) => edge.id === created.id)
        }
      };
    }
    return {
      skipped: true,
      reason: "no-unused-room-entrance-pair",
      proof: "All 30 roomEntrance objects in the public showcase are already consumed by its 15 canonical connections; unit tests cover connection creation and undo."
    };
  })()`);

  const final = await sessionState(cdp);
  return {
    original: { dirty: original.dirty, changeCount: original.changeCount, semanticDigest: original.semanticDigest },
    drags,
    backgroundPan,
    connection,
    final: {
      dirty: final.dirty,
      changeCount: final.changeCount,
      semanticRestored: final.semanticDigest === original.semanticDigest
    }
  };
}

async function auditWebPreviewViews(cdp) {
  return evaluate(cdp, `(async () => {
    const { createWorldPreviewModel } = await import("./src/world-preview.js");
    const { buildWorldSpatialIndex } = await import("./src/world-streaming.js");
    const studio = window.cablesterWorldStudio;
    const world = studio.session.world;
    const region = world.regions[0];
    const chunk = region?.chunks?.[0];
    const index = buildWorldSpatialIndex(world);
    const canvas = document.querySelector("#world-preview-canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const digest = () => {
      const probe = document.createElement("canvas");
      probe.width = 64;
      probe.height = 36;
      const probeContext = probe.getContext("2d", { willReadFrequently: true });
      probeContext.drawImage(canvas, 0, 0, probe.width, probe.height);
      const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
      let hash = 2166136261;
      let nonTransparentPixels = 0;
      let brightPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] > 0) nonTransparentPixels += 1;
        if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 330) brightPixels += 1;
        hash = Math.imul(hash ^ pixels[offset], 16777619);
        hash = Math.imul(hash ^ pixels[offset + 1], 16777619);
        hash = Math.imul(hash ^ pixels[offset + 2], 16777619);
        hash = Math.imul(hash ^ pixels[offset + 3], 16777619);
      }
      return { hash: (hash >>> 0).toString(16).padStart(8, "0"), nonTransparentPixels, brightPixels };
    };
    const results = [];
    for (const view of ["world", "region", "chunk"]) {
      if (view === "world") studio.session.select("world", world.manifest.worldId);
      else if (view === "region") studio.session.select("region", region.id);
      else studio.session.select("chunk", chunk.id);
      const operationCounts = Object.fromEntries(["arc", "fillRect", "strokeRect", "lineTo", "fillText"].map((name) => [name, 0]));
      const originals = {};
      for (const name of Object.keys(operationCounts)) {
        originals[name] = context[name];
        context[name] = function(...args) {
          operationCounts[name] += 1;
          return originals[name].apply(this, args);
        };
      }
      try {
        document.querySelector('[data-world-view="' + view + '"]').click();
        document.querySelector("#world-fit").click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      } finally {
        for (const [name, original] of Object.entries(originals)) context[name] = original;
      }
      const model = createWorldPreviewModel(world, {
        view,
        regionId: region.id,
        chunkId: chunk.id,
        spatialIndex: index,
        viewport: index.chunks.get(chunk.id)?.bounds,
        zoom: view === "world" ? 0.12 : 1
      });
      const canonicalCollisionProxies = model.visible.objects.filter((record) => record.bounds?.w > 0 && record.bounds?.h > 0);
      results.push({
        view,
        canvas: digest(),
        operationCounts,
        visible: { chunks: model.visible.chunks.length, objects: model.visible.objects.length, lod: model.lod },
        semanticLayers: {
          regionNodes: model.regionGraph.nodes.length,
          chunkNodes: model.chunkGraph.nodes.length,
          chunkEdges: model.chunkGraph.edges.length,
          routeDefinitions: model.regionGraph.nodes.reduce((sum, node) => sum + (node.routes?.length || 0), 0),
          routeEdges: model.chunkGraph.edges.filter((edge) => (edge.routeIds?.length || 0) > 0).length,
          landmarks: model.regionGraph.nodes.reduce((sum, node) => sum + (node.landmarks?.length || 0), 0),
          overviewMarkers: model.overviewMarkers.length,
          canonicalCollisionProxies: canonicalCollisionProxies.length
        },
        snapshotStatus: model.snapshotStatus,
        visibleLabel: document.querySelector("#world-visible-label")?.textContent || null,
        lodLabel: document.querySelector("#world-lod-label")?.textContent || null
      });
    }
    return {
      views: results,
      distinctCanvasDigests: new Set(results.map((result) => result.canvas.hash)).size
    };
  })()`);
}

async function auditStorageRecovery(cdp, network) {
  const preReloadLongTasks = await evaluate(cdp, `(() => {
    const entries = window.__cablesterWorldPerf?.longTasks || [];
    return {
      label: "initial-navigation-and-forest",
      supported: !window.__cablesterWorldPerf?.longTaskObserverError,
      observerError: window.__cablesterWorldPerf?.longTaskObserverError || null,
      count: entries.length,
      totalDurationMs: entries.reduce((sum, entry) => sum + entry.duration, 0),
      maximumDurationMs: entries.length ? Math.max(...entries.map((entry) => entry.duration)) : 0,
      entries
    };
  })()`);
  const storage = await evaluate(cdp, `(() => {
    localStorage.setItem("cablester:world-draft:performance-audit", JSON.stringify({
      manifest: { worldId: "poison-local-draft", contentHash: "sha256:invalid" },
      regions: [{ id: "not-the-repository-world" }]
    }));
    sessionStorage.setItem("cablester:world-draft:performance-audit", JSON.stringify({
      manifest: { worldId: "poison-session-draft", contentHash: "sha256:invalid" },
      regions: []
    }));
    const beforeClear = {
      localLength: localStorage.length,
      sessionLength: sessionStorage.length,
      localDraftPresent: localStorage.getItem("cablester:world-draft:performance-audit") !== null,
      sessionDraftPresent: sessionStorage.getItem("cablester:world-draft:performance-audit") !== null
    };
    localStorage.clear();
    sessionStorage.clear();
    return {
      beforeClear,
      afterClear: {
        localLength: localStorage.length,
        sessionLength: sessionStorage.length,
        localDraftPresent: localStorage.getItem("cablester:world-draft:performance-audit") !== null,
        sessionDraftPresent: sessionStorage.getItem("cablester:world-draft:performance-audit") !== null
      }
    };
  })()`);
  const afterSequence = network.mark();
  await cdp.send("Page.reload", { ignoreCache: true });
  await pollPage(cdp, `(() => window.cablesterWorldStudio && document.querySelector("#open-world-studio"))()`, "World Studio after storage-cleared reload");
  await evaluate(cdp, `(() => { document.querySelector("#open-world-studio").click(); return true; })()`);
  const recovered = await pollPage(cdp, `(() => {
    const studio = window.cablesterWorldStudio;
    if (!studio?.session || document.querySelector("#world-studio")?.hidden) return null;
    if (!studio.snapshotStatus || studio.snapshotStatus.state === "loading") return null;
    const world = studio.session.world;
    const chunks = world.regions.flatMap((region) => region.chunks || []);
    return {
      worldId: world.manifest.worldId,
      contentHash: world.manifest.contentHash,
      regions: world.regions.length,
      chunks: chunks.length,
      objects: chunks.flatMap((chunk) => chunk.objects || []).length,
      dirty: studio.session.dirty,
      changeCount: studio.session.changes().changes.length,
      snapshotStatus: studio.snapshotStatus,
      localStorageLength: localStorage.length,
      sessionStorageLength: sessionStorage.length
    };
  })()`, "canonical forest repository recovery and snapshot handshake", 60_000);
  await network.waitForIdle(500, 60_000);
  const requests = network.snapshot({ afterSequence });
  const repositoryGets = requests.resources.filter((resource) => resource.method === "GET" && (
    resource.url === "/__cablester/world-repository"
    || resource.url === "/worlds/labs/cablester-composite-showcase.world.json"
  ));
  return {
    storage,
    preReloadLongTasks,
    reload: { ignoreCache: true },
    recovered,
    network: requests,
    repositoryGets,
    repositoryGetPaths: repositoryGets.map((resource) => resource.url),
    repositoryReadbackProved: new Set(repositoryGets.map((resource) => resource.url)).size === 2
  };
}

async function runForestWorkerValidation(cdp) {
  return evaluate(cdp, `(async () => {
    const { WorldValidationWorkerClient } = await import("./src/world-validation-worker.js");
    const client = new WorldValidationWorkerClient();
    const progress = [];
    const startedAt = performance.now();
    try {
      const result = await client.validate(structuredClone(window.cablesterWorldStudio.session.world), {
        onProgress(value) { progress.push({ ...value, observedAtMs: performance.now() - startedAt }); }
      });
      return {
        transport: "dedicated-module-worker",
        durationMs: performance.now() - startedAt,
        progress,
        progressMonotonic: progress.every((item, index) => index === 0 || item.progress >= progress[index - 1].progress),
        result
      };
    } finally {
      client.terminate();
    }
  })()`);
}

async function importSyntheticWorld(cdp) {
  const started = await evaluate(cdp, `(async () => {
    const { createSyntheticWorld } = await import("./src/world-preview.js");
    const world = createSyntheticWorld();
    const contents = JSON.stringify(world);
    const file = new File([contents], "synthetic-world-10x.world.json", { type: "application/json" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#world-file-input");
    input.files = transfer.files;
    window.__worldSyntheticImportStartedAt = performance.now();
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { bytes: new Blob([contents]).size, worldId: world.manifest.worldId };
  })()`);
  return pollPage(cdp, `(() => {
    const studio = window.cablesterWorldStudio;
    if (studio?.session?.world?.manifest?.worldId !== ${JSON.stringify(started.worldId)}) return null;
    const world = studio.session.world;
    return {
      durationMs: performance.now() - window.__worldSyntheticImportStartedAt,
      sourceBytes: ${JSON.stringify(started.bytes)},
      normalizedBytes: new Blob([JSON.stringify(world)]).size,
      worldId: world.manifest.worldId,
      regions: world.regions.length,
      chunks: world.regions.flatMap((region) => region.chunks || []).length,
      objects: world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.objects || []).length,
      treeItems: document.querySelectorAll("#world-tree .world-tree-item").length,
      visibleLabel: document.querySelector("#world-visible-label")?.textContent || null,
      lodLabel: document.querySelector("#world-lod-label")?.textContent || null
    };
  })()`, "10x synthetic world import", 60_000);
}

async function runSyntheticWorkerCancellation(cdp) {
  return evaluate(cdp, `(async () => {
    const { WorldValidationWorkerClient } = await import("./src/world-validation-worker.js");
    const client = new WorldValidationWorkerClient();
    const progress = [];
    const heartbeatGaps = [];
    let previousBeat = performance.now();
    const heartbeat = setInterval(() => {
      const now = performance.now();
      heartbeatGaps.push(now - previousBeat);
      previousBeat = now;
    }, 16);
    let cancelRequestedAt = null;
    const startedAt = performance.now();
    try {
      await client.validate(structuredClone(window.cablesterWorldStudio.session.world), {
        onProgress(value) {
          progress.push({ ...value, observedAtMs: performance.now() - startedAt });
          if (cancelRequestedAt === null) {
            cancelRequestedAt = performance.now();
            client.cancel();
          }
        }
      });
      return { cancelled: false, reason: "validation completed before cancellation", progress };
    } catch (error) {
      return {
        transport: "dedicated-module-worker",
        cancelled: error?.name === "AbortError",
        errorName: error?.name || null,
        errorCode: error?.code || null,
        durationMs: performance.now() - startedAt,
        cancelResponseMs: cancelRequestedAt === null ? null : performance.now() - cancelRequestedAt,
        progress,
        mainThreadHeartbeat: {
          count: heartbeatGaps.length,
          p95GapMs: heartbeatGaps.length ? [...heartbeatGaps].sort((a, b) => a - b)[Math.ceil(heartbeatGaps.length * 0.95) - 1] : 0,
          maximumGapMs: heartbeatGaps.length ? Math.max(...heartbeatGaps) : 0
        }
      };
    } finally {
      clearInterval(heartbeat);
      client.terminate();
    }
  })()`);
}

async function runStreamingStress(cdp, transitionCount) {
  return evaluate(cdp, `(async () => {
    const { buildWorldSpatialIndex, createWorldStreamingSimulator } = await import("./src/world-streaming.js");
    const world = window.cablesterWorldStudio.session.world;
    const index = buildWorldSpatialIndex(world);
    let logicalNow = 0;
    const simulator = createWorldStreamingSimulator(world, {
      spatialIndex: index,
      cacheBudgetBytes: ${JSON.stringify(THRESHOLDS.streamingCacheBudgetBytes)},
      now: () => logicalNow,
      loader: async (record) => ({ chunkId: record.id, payloadBytes: record.chunk.streaming?.memoryEstimateBytes || 0 })
    });
    const byRegion = new Map();
    for (const record of index.chunks.values()) {
      if (!byRegion.has(record.regionId)) byRegion.set(record.regionId, []);
      byRegion.get(record.regionId).push(record);
    }
    const regions = [...byRegion.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const records of byRegion.values()) records.sort((left, right) => left.id.localeCompare(right.id));
    const samples = [];
    let previousRegionId = null;
    let crossRegionTransitions = 0;
    for (let ordinal = 0; ordinal < ${JSON.stringify(transitionCount)}; ordinal += 1) {
      const [regionId, records] = regions[ordinal % regions.length];
      const candidateIndex = ordinal % 2 === 0 ? 1 : Math.max(1, records.length - 2);
      const target = records[Math.min(records.length - 1, candidateIndex)];
      if (previousRegionId && previousRegionId !== regionId) crossRegionTransitions += 1;
      previousRegionId = regionId;
      logicalNow += 2_400;
      simulator.update({
        position: { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 },
        velocity: { x: ordinal % 2 === 0 ? 900 : -900, y: 0 },
        activeChunkId: target.id,
        now: logicalNow,
        teleport: true
      });
      await simulator.settle();
      logicalNow += 1_800;
      const snapshot = simulator.update({
        position: { x: target.bounds.x + target.bounds.w / 2, y: target.bounds.y + target.bounds.h / 2 },
        velocity: { x: 0, y: 0 },
        activeChunkId: target.id,
        now: logicalNow
      });
      await simulator.settle();
      if (ordinal < 5 || (ordinal + 1) % 5 === 0 || ordinal + 1 === ${JSON.stringify(transitionCount)}) {
        samples.push({
          ordinal: ordinal + 1,
          regionId,
          chunkId: target.id,
          activeMemoryBytes: snapshot.metrics.estimatedMemoryBytes,
          cachedMemoryBytes: snapshot.metrics.cachedMemoryBytes,
          totalMemoryBytes: snapshot.metrics.estimatedMemoryBytes + snapshot.metrics.cachedMemoryBytes,
          cacheEntries: snapshot.cacheEntries,
          cacheHits: snapshot.metrics.cacheHits,
          cacheMisses: snapshot.metrics.cacheMisses,
          states: snapshot.states
        });
      }
    }
    const final = simulator.snapshot();
    const tail = samples.filter((sample) => sample.ordinal > ${JSON.stringify(Math.floor(transitionCount * 0.6))});
    const tailTotals = tail.map((sample) => sample.totalMemoryBytes);
    const tailMinimum = tailTotals.length ? Math.min(...tailTotals) : 0;
    const tailMaximum = tailTotals.length ? Math.max(...tailTotals) : 0;
    return {
      requestedTransitions: ${JSON.stringify(transitionCount)},
      completedTransitions: ${JSON.stringify(transitionCount)},
      crossRegionTransitions,
      regionCount: regions.length,
      samples,
      final,
      cacheHitRate: final.metrics.cacheHits / Math.max(1, final.metrics.cacheHits + final.metrics.cacheMisses),
      memorySteadyState: {
        tailSampleCount: tail.length,
        tailMinimumBytes: tailMinimum,
        tailMaximumBytes: tailMaximum,
        tailMaximumToMinimumRatio: tailMinimum > 0 ? tailMaximum / tailMinimum : null,
        cacheBudgetBytes: ${JSON.stringify(THRESHOLDS.streamingCacheBudgetBytes)},
        allowedTotalBytes: ${JSON.stringify(THRESHOLDS.streamingCacheBudgetBytes + THRESHOLDS.streamingLoadedHeadroomBytes)}
      }
    };
  })()`);
}

function summarizeWorld(world, bytes) {
  const chunks = world.regions.flatMap((region) => region.chunks || []);
  return {
    worldId: world.manifest.worldId,
    contentHash: world.manifest.contentHash || "",
    regions: world.regions.length,
    chunks: chunks.length,
    objects: chunks.reduce((sum, chunk) => sum + (chunk.objects?.length || 0), 0),
    bytes
  };
}

function validateCanvas(failures, sample, prefix) {
  const check = (condition, gate, actual) => {
    if (!condition) failures.push({ gate: `${prefix}.${gate}`, actual });
  };
  check(sample.frames.measuredDurationMs >= sample.frames.requestedDurationMs * 0.9,
    "duration", `${sample.frames.measuredDurationMs}/${sample.frames.requestedDurationMs} ms`);
  check(sample.frames.averageFps >= THRESHOLDS.minimumAverageFps,
    "averageFps", sample.frames.averageFps);
  check(sample.frames.p95FrameMs <= THRESHOLDS.maximumP95FrameMs,
    "p95FrameMs", sample.frames.p95FrameMs);
  check(sample.frames.p99FrameMs <= THRESHOLDS.maximumP99FrameMs,
    "p99FrameMs", sample.frames.p99FrameMs);
  check(sample.realInputEvents.pointermove >= 50 && sample.realInputEvents.wheel >= 2,
    "realInput", sample.realInputEvents);
  check(sample.minimumCanvasDraws >= 52, "canvasDraws", sample.minimumCanvasDraws);
  check(sample.pixelEvidence.changed, "pixelChange", sample.pixelEvidence);
}

function validateInteractions(failures, interactions, prefix) {
  for (const action of ["selection", "viewSwitch", "edit"]) {
    if (interactions[action].paint.maximumMs >= THRESHOLDS.maximumInteractionPaintMs) {
      failures.push({
        gate: `${prefix}.${action}.paintMaximumMs`,
        actual: interactions[action].paint.maximumMs,
        expected: `< ${THRESHOLDS.maximumInteractionPaintMs}`
      });
    }
  }
  if (interactions.dirtyAfterUndo) failures.push({ gate: `${prefix}.undoRestoresCleanState`, actual: true });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const forestPath = join(projectRoot, "worlds", "labs", "cablester-composite-showcase.world.json");
  const forestContents = await readFile(forestPath);
  const forestWorld = JSON.parse(forestContents);
  const syntheticWorld = createSyntheticWorld();
  const syntheticContents = Buffer.from(JSON.stringify(syntheticWorld));
  const inputs = {
    sourceFingerprint: await sourceFingerprint(),
    forest: {
      path: relative(projectRoot, forestPath),
      sha256: await sha256File(forestPath),
      ...summarizeWorld(forestWorld, forestContents.length)
    },
    synthetic: {
      generator: "createSyntheticWorld() defaults",
      ...summarizeWorld(syntheticWorld, syntheticContents.length)
    }
  };
  inputs.synthetic.scaleVersusForest = {
    regionMultiplier: inputs.synthetic.regions / Math.max(1, inputs.forest.regions),
    chunkMultiplier: inputs.synthetic.chunks / Math.max(1, inputs.forest.chunks),
    objectMultiplier: inputs.synthetic.objects / Math.max(1, inputs.forest.objects),
    byteMultiplier: inputs.synthetic.bytes / Math.max(1, inputs.forest.bytes)
  };
  const fullResolutionAssetPaths = (forestWorld.assetRegistry?.entries || [])
    .filter((entry) => entry.kind === "image" && entry.platforms?.web?.path)
    .map((entry) => new URL(String(entry.platforms.web.path).replace(/^\.\//, ""), options.url).pathname);

  const server = await ensureServer(options.url);
  const navigationUrl = server.navigationUrl || options.url;
  const chromeExecutable = await findChrome(options.chrome);
  const chromeVersion = await executableVersion(chromeExecutable);
  const chrome = await launchChrome(chromeExecutable);
  let browserCdp;
  let pageCdp;
  const diagnostics = { exceptions: [], consoleErrors: [], consoleWarnings: [], logErrors: [], logWarnings: [], ignored: [] };
  try {
    browserCdp = await new CDPConnection(chrome.browserWebSocketUrl).open();
    const browserVersion = await browserCdp.send("Browser.getVersion");
    pageCdp = await createPageConnection(chrome);
    await Promise.all([
      pageCdp.send("Page.enable"),
      pageCdp.send("Runtime.enable"),
      pageCdp.send("Network.enable", { maxTotalBufferSize: 64 * 1024 * 1024 }),
      pageCdp.send("Performance.enable"),
      pageCdp.send("HeapProfiler.enable"),
      pageCdp.send("Log.enable")
    ]);
    pageCdp.on("Runtime.exceptionThrown", (event) => diagnostics.exceptions.push({
      text: event.exceptionDetails?.text || "exception",
      description: event.exceptionDetails?.exception?.description || null,
      url: event.exceptionDetails?.url || null,
      lineNumber: event.exceptionDetails?.lineNumber ?? null
    }));
    pageCdp.on("Runtime.consoleAPICalled", (event) => {
      const record = { type: event.type, values: (event.args || []).map((argument) => argument.value ?? argument.description ?? argument.type) };
      if (event.type === "error") diagnostics.consoleErrors.push(record);
      else if (event.type === "warning") diagnostics.consoleWarnings.push(record);
    });
    pageCdp.on("Log.entryAdded", ({ entry }) => {
      const record = { source: entry.source, text: entry.text, url: entry.url || null, lineNumber: entry.lineNumber || null };
      const favicon = entry.level === "error" && entry.source === "network" && /favicon\.ico/.test(entry.url || "") && /404/.test(entry.text || "");
      if (favicon) diagnostics.ignored.push({ ...record, reason: "implicit optional favicon" });
      else if (entry.level === "error") diagnostics.logErrors.push(record);
      else if (entry.level === "warning") diagnostics.logWarnings.push(record);
    });
    await pageCdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const state = { longTasks: [] };
        Object.defineProperty(window, "__cablesterWorldPerf", { value: state, configurable: true });
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) state.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration
            });
          }).observe({ type: "longtask", buffered: true });
        } catch (error) {
          state.longTaskObserverError = String(error?.message || error);
        }
      })();`
    });
    await setViewport(pageCdp, DEFAULT_VIEWPORT);
    await pageCdp.send("Network.clearBrowserCache");
    const network = new NetworkRecorder(pageCdp, new URL(options.url).origin);
    const loadStartedAt = Date.now();
    await pageCdp.send("Page.navigate", { url: navigationUrl });
    await pollPage(pageCdp, `(() => window.cablesterWorldStudio && document.querySelector("#open-world-studio"))()`, "World Studio bootstrap");
    await network.waitForIdle();
    const beforeStudioMark = network.mark();
    const beforeStudioResources = network.snapshot();
    const visualBeforeStudio = await evaluate(pageCdp, `(() => window.cablester?.visualRuntime?.stats?.() || null)()`);
    const memoryBeforeStudio = await memorySnapshot(pageCdp, { collectGarbage: true });
    const openStartedAt = await evaluate(pageCdp, `(() => {
      window.__worldStudioOpenStartedAt = performance.now();
      document.querySelector("#open-world-studio").click();
      return window.__worldStudioOpenStartedAt;
    })()`);
    const forestOpened = await pollPage(pageCdp, `(() => {
      const studio = window.cablesterWorldStudio;
      const root = document.querySelector("#world-studio");
      if (!studio?.session || root?.hidden) return null;
      const world = studio.session.world;
      return {
        durationMs: performance.now() - ${JSON.stringify(openStartedAt)},
        worldId: world.manifest.worldId,
        regions: world.regions.length,
        chunks: world.regions.flatMap((region) => region.chunks || []).length,
        objects: world.regions.flatMap((region) => region.chunks || []).flatMap((chunk) => chunk.objects || []).length,
        visibleLabel: document.querySelector("#world-visible-label")?.textContent || null,
        lodLabel: document.querySelector("#world-lod-label")?.textContent || null
      };
    })()`, "public composite showcase in World Studio");
    await network.waitForIdle();
    const studioResources = network.snapshot({ afterSequence: beforeStudioMark });
    const allColdResources = network.snapshot();
    const requestedFullResolutionPaths = [...new Set(allColdResources.resources
      .map((resource) => resource.url.split("?", 1)[0])
      .filter((path) => fullResolutionAssetPaths.includes(path)))];
    const visualAfterStudio = await evaluate(pageCdp, `(() => window.cablester?.visualRuntime?.stats?.() || null)()`);
    const firstLoad = {
      emptyBrowserCache: true,
      wallDurationToBootstrapMs: Date.now() - loadStartedAt,
      beforeStudio: beforeStudioResources,
      worldStudioOpen: studioResources,
      totalColdNavigation: allColdResources,
      fullResolutionWorldAssets: {
        registryCount: fullResolutionAssetPaths.length,
        requestedCount: requestedFullResolutionPaths.length,
        requestedRatio: requestedFullResolutionPaths.length / Math.max(1, fullResolutionAssetPaths.length),
        requestedPaths: requestedFullResolutionPaths,
        notRequestedCount: fullResolutionAssetPaths.length - requestedFullResolutionPaths.length,
        proof: "Chrome used a new profile and Network.clearBrowserCache before navigation; an asset absent from the network trace could not be decoded from a prior cache."
      },
      visualRuntimeBeforeStudio: visualBeforeStudio,
      visualRuntimeAfterStudio: visualAfterStudio,
      decodedEstimateDeltaBytes: visualBeforeStudio && visualAfterStudio
        ? visualAfterStudio.estimatedDecodedBytes - visualBeforeStudio.estimatedDecodedBytes
        : null
    };

    const forestCanvas = await collectCanvasSample(pageCdp, { label: "first-forest-world-overview", durationMs: options.canvasDurationMs });
    const forestCanvasEditing = await exerciseCanvasEditing(pageCdp);
    const forestInteractions = await measureEditorInteractions(pageCdp, options.interactionSamples);
    const forestWorker = await runForestWorkerValidation(pageCdp);
    const webPreviewViews = await auditWebPreviewViews(pageCdp);
    const storageRecovery = await auditStorageRecovery(pageCdp, network);
    const memoryAfterForest = await memorySnapshot(pageCdp, { collectGarbage: true });

    const memoryBeforeSynthetic = await memorySnapshot(pageCdp, { collectGarbage: true });
    const syntheticImport = await importSyntheticWorld(pageCdp);
    const memoryAfterSyntheticImport = await memorySnapshot(pageCdp, { collectGarbage: true });
    const syntheticCanvas = await collectCanvasSample(pageCdp, { label: "synthetic-10x-world-overview", durationMs: options.canvasDurationMs });
    const syntheticInteractions = await measureEditorInteractions(pageCdp, options.interactionSamples);
    const syntheticCancellation = await runSyntheticWorkerCancellation(pageCdp);
    const memoryBeforeStreaming = await memorySnapshot(pageCdp, { collectGarbage: true });
    const streaming = await runStreamingStress(pageCdp, options.transitionCount);
    const memoryAfterStreaming = await memorySnapshot(pageCdp, { collectGarbage: true });
    const retainedAfterStreamingBytes = memoryAfterStreaming.cdp.jsHeapUsedBytes - memoryBeforeStreaming.cdp.jsHeapUsedBytes;
    const postReloadLongTasks = await evaluate(pageCdp, `(() => {
      const entries = window.__cablesterWorldPerf?.longTasks || [];
      return {
        label: "storage-cleared-reload-and-synthetic",
        supported: !window.__cablesterWorldPerf?.longTaskObserverError,
        observerError: window.__cablesterWorldPerf?.longTaskObserverError || null,
        count: entries.length,
        totalDurationMs: entries.reduce((sum, entry) => sum + entry.duration, 0),
        maximumDurationMs: entries.length ? Math.max(...entries.map((entry) => entry.duration)) : 0,
        entries
      };
    })()`);
    const longTaskSessions = [storageRecovery.preReloadLongTasks, postReloadLongTasks];
    const globalLongTasks = {
      supported: longTaskSessions.every((session) => session.supported),
      observerErrors: longTaskSessions.map((session) => session.observerError).filter(Boolean),
      count: longTaskSessions.reduce((sum, session) => sum + session.count, 0),
      totalDurationMs: longTaskSessions.reduce((sum, session) => sum + session.totalDurationMs, 0),
      maximumDurationMs: Math.max(0, ...longTaskSessions.map((session) => session.maximumDurationMs)),
      sessions: longTaskSessions
    };
    const environment = await evaluate(pageCdp, `(() => ({
      devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      longTaskApiSupported: PerformanceObserver.supportedEntryTypes?.includes("longtask") || false
    }))()`);
    environment.deviceProfile = "local-desktop-redacted";
    environment.privacy = "Host and hardware-identifying fields are intentionally omitted from repository evidence.";
    environment.chromeExecutableVersion = chromeVersion;
    environment.browserProtocolVersion = {
      protocolVersion: browserVersion.protocolVersion || null,
      product: browserVersion.product || null
    };

    const failures = [];
    const check = (condition, gate, actual, expected = undefined) => {
      if (!condition) failures.push({ gate, actual, ...(expected === undefined ? {} : { expected }) });
    };
    check(inputs.synthetic.objects >= inputs.forest.objects * 10,
      "inputs.synthetic.objectMultiplier", inputs.synthetic.scaleVersusForest.objectMultiplier, ">= 10");
    check(inputs.forest.contentHash === EXPECTED_FOREST_HASH,
      "inputs.forest.canonicalContentHash", inputs.forest.contentHash, EXPECTED_FOREST_HASH);
    check(firstLoad.totalColdNavigation.applicationErrorCount === 0,
      "firstLoad.network.applicationErrors", firstLoad.totalColdNavigation.applicationErrorCount, 0);
    check(requestedFullResolutionPaths.length < fullResolutionAssetPaths.length,
      "firstLoad.doesNotDecodeAllFullResolutionAssets", `${requestedFullResolutionPaths.length}/${fullResolutionAssetPaths.length}`, "strictly fewer than all");
    check(firstLoad.decodedEstimateDeltaBytes === null || firstLoad.decodedEstimateDeltaBytes === 0,
      "firstLoad.worldStudioDecodedEstimateDeltaBytes", firstLoad.decodedEstimateDeltaBytes, 0);
    check(forestOpened.worldId === inputs.forest.worldId, "forest.worldId", forestOpened.worldId, inputs.forest.worldId);
    validateCanvas(failures, forestCanvas, "forest.canvas");
    for (const drag of forestCanvasEditing.drags) {
      check(drag.afterMove.dirty && drag.afterMove.changeCount > drag.before.changeCount && drag.afterMove.semanticChanged,
        `forest.canvasEditing.${drag.kind}.moveProducesDiff`, drag.afterMove);
      check(drag.afterUndo.semanticRestored && drag.afterUndo.changeCount === drag.before.changeCount,
        `forest.canvasEditing.${drag.kind}.undoRestores`, drag.afterUndo);
    }
    check(forestCanvasEditing.backgroundPan.after.semanticUnchanged
      && forestCanvasEditing.backgroundPan.after.dirty === forestCanvasEditing.backgroundPan.before.dirty
      && forestCanvasEditing.backgroundPan.after.changeCount === forestCanvasEditing.backgroundPan.before.changeCount,
    "forest.canvasEditing.backgroundPanCanonicalUnchanged", forestCanvasEditing.backgroundPan);
    if (forestCanvasEditing.connection.skipped) {
      check(forestCanvasEditing.connection.reason === "no-unused-room-entrance-pair",
        "forest.canvasEditing.connectionCoverage", forestCanvasEditing.connection);
    } else {
      check(forestCanvasEditing.connection.afterCreate.dirty
        && forestCanvasEditing.connection.afterCreate.connectionCountDelta === 1
        && forestCanvasEditing.connection.afterCreate.storedCopies === 1,
      "forest.canvasEditing.connectionUniqueStorage", forestCanvasEditing.connection.afterCreate);
      check(forestCanvasEditing.connection.afterUndo.semanticRestored
        && forestCanvasEditing.connection.afterUndo.createdConnectionAbsent,
      "forest.canvasEditing.connectionUndo", forestCanvasEditing.connection.afterUndo);
    }
    check(forestCanvasEditing.final.semanticRestored && !forestCanvasEditing.final.dirty && forestCanvasEditing.final.changeCount === 0,
      "forest.canvasEditing.finalCanonicalRestored", forestCanvasEditing.final);
    validateInteractions(failures, forestInteractions, "forest.interactions");
    check(forestWorker.transport === "dedicated-module-worker", "forest.worker.transport", forestWorker.transport);
    check(forestWorker.progress.length >= 3, "forest.worker.progressEvents", forestWorker.progress.length, ">= 3");
    check(forestWorker.progressMonotonic, "forest.worker.progressMonotonic", forestWorker.progress.map((item) => item.progress));
    check(forestWorker.result.summary.errors === 0, "forest.worker.errors", forestWorker.result.summary.errors, 0);
    const viewByName = Object.fromEntries(webPreviewViews.views.map((view) => [view.view, view]));
    check(webPreviewViews.views.length === 3 && webPreviewViews.distinctCanvasDigests >= 3,
      "forest.webViews.distinctCanvas", { count: webPreviewViews.views.length, distinct: webPreviewViews.distinctCanvasDigests },
      "3 Web views and 3 distinct Canvas digests");
    for (const view of webPreviewViews.views) {
      check(view.canvas.nonTransparentPixels > 0 && view.canvas.brightPixels > 0,
        `forest.webViews.${view.view}.canvasNonEmpty`, view.canvas);
      check(Object.values(view.operationCounts).reduce((sum, value) => sum + value, 0) > 0,
        `forest.webViews.${view.view}.drawOperations`, view.operationCounts);
    }
    check(viewByName.world.semanticLayers.overviewMarkers > 0
      && viewByName.world.semanticLayers.landmarks > 0
      && viewByName.world.semanticLayers.routeDefinitions > 0,
    "forest.webViews.world.markersLandmarksRoutes", viewByName.world.semanticLayers);
    check(viewByName.region.semanticLayers.chunkNodes > 0
      && viewByName.region.semanticLayers.routeEdges > 0
      && viewByName.region.operationCounts.lineTo > 0,
    "forest.webViews.region.routeGraph", { semantic: viewByName.region.semanticLayers, operations: viewByName.region.operationCounts });
    check(viewByName.chunk.semanticLayers.canonicalCollisionProxies > 0
      && viewByName.chunk.operationCounts.strokeRect > 0,
    "forest.webViews.chunk.collisionProxies", { semantic: viewByName.chunk.semanticLayers, operations: viewByName.chunk.operationCounts });
    check(storageRecovery.storage.beforeClear.localDraftPresent
      && storageRecovery.storage.beforeClear.sessionDraftPresent,
    "storageRecovery.draftsWritten", storageRecovery.storage.beforeClear);
    check(storageRecovery.storage.afterClear.localLength === 0
      && storageRecovery.storage.afterClear.sessionLength === 0
      && !storageRecovery.storage.afterClear.localDraftPresent
      && !storageRecovery.storage.afterClear.sessionDraftPresent,
    "storageRecovery.allStorageCleared", storageRecovery.storage.afterClear);
    check(storageRecovery.repositoryReadbackProved,
      "storageRecovery.repositoryGets", storageRecovery.repositoryGetPaths,
      ["/__cablester/world-repository", "/worlds/labs/cablester-composite-showcase.world.json"]);
    check(storageRecovery.recovered.worldId === inputs.forest.worldId
      && storageRecovery.recovered.contentHash === EXPECTED_FOREST_HASH
      && storageRecovery.recovered.chunks === 12
      && storageRecovery.recovered.objects === 285
      && !storageRecovery.recovered.dirty
      && storageRecovery.recovered.changeCount === 0,
    "storageRecovery.canonicalFormalReadback", storageRecovery.recovered);
    check(storageRecovery.recovered.snapshotStatus.state === "missing/import-failed",
      "storageRecovery.godotSnapshotOptional", storageRecovery.recovered.snapshotStatus);
    check(syntheticImport.objects >= inputs.forest.objects * 10,
      "synthetic.import.objectMultiplier", syntheticImport.objects / inputs.forest.objects, ">= 10");
    validateCanvas(failures, syntheticCanvas, "synthetic.canvas");
    validateInteractions(failures, syntheticInteractions, "synthetic.interactions");
    check(syntheticCancellation.cancelled, "synthetic.worker.cancelled", syntheticCancellation);
    check(syntheticCancellation.progress.length >= 1, "synthetic.worker.progressEvents", syntheticCancellation.progress.length, ">= 1");
    check(streaming.completedTransitions === options.transitionCount,
      "synthetic.streaming.transitions", streaming.completedTransitions, options.transitionCount);
    check(streaming.crossRegionTransitions >= options.transitionCount - 1,
      "synthetic.streaming.crossRegionTransitions", streaming.crossRegionTransitions, `>= ${options.transitionCount - 1}`);
    check(streaming.final.metrics.cacheHits > 0, "synthetic.streaming.cacheHits", streaming.final.metrics.cacheHits, "> 0");
    check(streaming.memorySteadyState.tailMaximumToMinimumRatio !== null
      && streaming.memorySteadyState.tailMaximumToMinimumRatio <= THRESHOLDS.maximumStreamingTailRatio,
    "synthetic.streaming.tailMemoryRatio", streaming.memorySteadyState.tailMaximumToMinimumRatio,
    `<= ${THRESHOLDS.maximumStreamingTailRatio}`);
    check(streaming.memorySteadyState.tailMaximumBytes <= streaming.memorySteadyState.allowedTotalBytes,
      "synthetic.streaming.memoryBudget", streaming.memorySteadyState.tailMaximumBytes, `<= ${streaming.memorySteadyState.allowedTotalBytes}`);
    check(retainedAfterStreamingBytes <= THRESHOLDS.maximumRetainedHeapGrowthBytes,
      "synthetic.streaming.retainedHeapGrowthBytes", retainedAfterStreamingBytes,
      `<= ${THRESHOLDS.maximumRetainedHeapGrowthBytes}`);
    check(diagnostics.exceptions.length === 0, "diagnostics.exceptions", diagnostics.exceptions);
    check(diagnostics.consoleErrors.length === 0, "diagnostics.consoleErrors", diagnostics.consoleErrors);
    check(diagnostics.logErrors.length === 0, "diagnostics.logErrors", diagnostics.logErrors);
    const completionFingerprint = await sourceFingerprint();
    check(completionFingerprint.value === inputs.sourceFingerprint.value,
      "provenance.sourceFingerprintUnchanged",
      { started: inputs.sourceFingerprint.value, completed: completionFingerprint.value },
      { started: inputs.sourceFingerprint.value, completed: inputs.sourceFingerprint.value });

    const report = {
      schemaVersion: 1,
      kind: "cablester-world-studio-browser-performance",
      generatedAt: new Date().toISOString(),
      status: failures.length === 0 ? "pass" : "fail",
      configuration: {
        standardRun: options.canvasDurationMs === DEFAULT_CANVAS_DURATION_MS
          && options.interactionSamples === DEFAULT_INTERACTION_SAMPLES
          && options.transitionCount === DEFAULT_TRANSITION_COUNT,
        url: new URL(options.url).origin + new URL(options.url).pathname,
        viewport: DEFAULT_VIEWPORT,
        canvasDurationMs: options.canvasDurationMs,
        interactionSamples: options.interactionSamples,
        transitionCount: options.transitionCount,
        thresholds: THRESHOLDS
      },
      inputs: { ...inputs, completionFingerprint },
      environment,
      firstLoad,
      forest: {
        open: forestOpened,
        canvasPanZoom: forestCanvas,
        canvasEditing: forestCanvasEditing,
        interactions: forestInteractions,
        workerValidation: forestWorker,
        webPreviewViews,
        storageRecovery,
        memory: { beforeStudio: memoryBeforeStudio, afterForest: memoryAfterForest }
      },
      synthetic: {
        import: syntheticImport,
        canvasPanZoom: syntheticCanvas,
        interactions: syntheticInteractions,
        workerCancellation: syntheticCancellation,
        streamingCrossRegion: streaming,
        memory: {
          beforeImport: memoryBeforeSynthetic,
          afterImport: memoryAfterSyntheticImport,
          beforeStreaming: memoryBeforeStreaming,
          afterStreaming: memoryAfterStreaming,
          retainedAfterStreamingBytes
        }
      },
      longTasks: globalLongTasks,
      diagnostics: {
        ...diagnostics,
        errorCount: diagnostics.exceptions.length + diagnostics.consoleErrors.length + diagnostics.logErrors.length,
        warningCount: diagnostics.consoleWarnings.length + diagnostics.logWarnings.length
      },
      acceptance: { passed: failures.length === 0, failures },
      notes: {
		browserSurface: `A fresh real Chromium-family renderer (${environment.browserProtocolVersion.product || "unknown product"}) was controlled over its native DevTools protocol; no jsdom or Node-only Canvas was used.`,
        canvasInput: "CDP dispatched trusted mouse press/move/wheel/release events to the visible #world-preview-canvas while consecutive requestAnimationFrame timestamps, Long Tasks, paint latency, draw-trigger count and pixel digests were collected in-page.",
        synthetic: "The browser imported createSyntheticWorld() through the real hidden file input, so the same WorldEditorSession, tree, inspector, Canvas, Worker client and streaming implementation were exercised as the product UI.",
        heap: "Renderer heap is Performance.getMetrics after HeapProfiler.collectGarbage. Streaming memory is the product simulator's explicit active plus cache estimate, not measured GPU memory."
      }
    };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`World Studio performance audit ${report.status.toUpperCase()} · ${relative(projectRoot, options.output)}`);
    console.log(`forest Canvas ${forestCanvas.frames.averageFps.toFixed(1)} fps · p95 ${forestCanvas.frames.p95FrameMs.toFixed(2)} ms · p99 ${forestCanvas.frames.p99FrameMs.toFixed(2)} ms`);
    console.log(`synthetic ${syntheticImport.regions} regions · ${syntheticImport.chunks} chunks · ${syntheticImport.objects} objects · Canvas ${syntheticCanvas.frames.averageFps.toFixed(1)} fps`);
    console.log(`interaction paint maxima forest/synthetic ${Math.max(...[forestInteractions.selection, forestInteractions.viewSwitch, forestInteractions.edit].map((entry) => entry.paint.maximumMs)).toFixed(1)}/${Math.max(...[syntheticInteractions.selection, syntheticInteractions.viewSwitch, syntheticInteractions.edit].map((entry) => entry.paint.maximumMs)).toFixed(1)} ms`);
    console.log(`streaming ${streaming.completedTransitions} transitions · cache ${streaming.final.metrics.cacheHits}/${streaming.final.metrics.cacheMisses} hit/miss · tail ratio ${streaming.memorySteadyState.tailMaximumToMinimumRatio?.toFixed(3)}`);
    if (failures.length) {
      for (const failure of failures) console.error(`FAIL ${failure.gate}: ${JSON.stringify(failure.actual)}`);
      process.exitCode = 1;
    }
  } finally {
    pageCdp?.close();
    await browserCdp?.send("Browser.close").catch(() => {});
    browserCdp?.close();
    await chrome.close();
    await closeServer(server);
  }
}

main().catch(async (error) => {
  console.error(`World Studio performance audit ERROR · ${error.stack || error.message}`);
  process.exitCode = 1;
});
