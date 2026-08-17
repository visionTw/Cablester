#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "./reference-library-fingerprint.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "http://127.0.0.1:4175/";
const DEFAULT_OUTPUT = join(projectRoot, "levels", "art", "performance-audit.json");
const REFERENCE_OUTPUT = join(projectRoot, "levels", "reference", "performance-audit.json");
const REPRESENTATIVE_LEVEL_ID = "combined-horizontal";
const STANDARD_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1280, height: 720 }),
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 800, height: 900 })
]);
const ADDITIONAL_FORMAL_SAMPLE_PLAN = Object.freeze([
  Object.freeze({ levelId: "combined-vertical", viewport: STANDARD_VIEWPORTS[0] }),
  Object.freeze({ levelId: "combined-hazards", viewport: STANDARD_VIEWPORTS[0] })
]);
const DEFAULT_FRAME_DURATION_MS = 10_000;
const DEFAULT_REFERENCE_DURATION_MS = 10_000;
const DEFAULT_LOW_DURATION_MS = 5_000;
const DEFAULT_WARMUP_MS = 2_500;
const DEFAULT_SWITCH_COUNT = 20;

function parseArguments(argv) {
  const options = {
    url: DEFAULT_URL,
    output: DEFAULT_OUTPUT,
    chrome: process.env.CHROME_PATH || null,
    frameDurationMs: DEFAULT_FRAME_DURATION_MS,
    referenceDurationMs: DEFAULT_REFERENCE_DURATION_MS,
    lowDurationMs: DEFAULT_LOW_DURATION_MS,
    warmupMs: DEFAULT_WARMUP_MS,
    switchCount: DEFAULT_SWITCH_COUNT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--url" && value) options.url = value, index += 1;
    else if (argument === "--output" && value) options.output = resolve(projectRoot, value), index += 1;
    else if (argument === "--chrome" && value) options.chrome = value, index += 1;
    else if (argument === "--frame-duration-ms" && value) options.frameDurationMs = Number(value), index += 1;
    else if (argument === "--reference-duration-ms" && value) options.referenceDurationMs = Number(value), index += 1;
    else if (argument === "--low-duration-ms" && value) options.lowDurationMs = Number(value), index += 1;
    else if (argument === "--warmup-ms" && value) options.warmupMs = Number(value), index += 1;
    else if (argument === "--switch-count" && value) options.switchCount = Number(value), index += 1;
    else if (argument === "--help") {
      console.log(`Usage: node scripts/audit-browser-performance.mjs [options]\n\n` +
        `  --url URL                    Local Cablester URL (${DEFAULT_URL})\n` +
        `  --output PATH                JSON evidence path\n` +
        `  --chrome PATH                Google Chrome executable\n` +
        `  --frame-duration-ms N        Formal-level rAF window (${DEFAULT_FRAME_DURATION_MS})\n` +
        `  --reference-duration-ms N    Per-reference-room rAF window (${DEFAULT_REFERENCE_DURATION_MS})\n` +
        `  --low-duration-ms N          Throttled low-tier rAF window (${DEFAULT_LOW_DURATION_MS})\n` +
        `  --warmup-ms N                Pre-sample warmup (${DEFAULT_WARMUP_MS})\n` +
        `  --switch-count N             Formal-level switch count (${DEFAULT_SWITCH_COUNT})`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  for (const [key, minimum] of [
    ["frameDurationMs", 500],
    ["referenceDurationMs", 500],
    ["lowDurationMs", 500],
    ["warmupMs", 100],
    ["switchCount", 1]
  ]) {
    if (!Number.isFinite(options[key]) || options[key] < minimum) {
      throw new Error(`${key} must be at least ${minimum}`);
    }
  }
  options.switchCount = Math.floor(options.switchCount);
  options.url = new URL(options.url).href;
  options.output = resolve(options.output);
  return options;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
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
      // Try the next known location.
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

async function launchChrome(executable) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cablester-browser-perf-"));
  const profileDirectory = join(temporaryRoot, "profile");
  await mkdir(profileDirectory, { recursive: true });
  const argumentsList = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    `--disk-cache-dir=${join(temporaryRoot, "cache")}`,
    "--remote-allow-origins=*",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-sync",
    "--disable-features=CalculateNativeWinOcclusion,MediaRouter",
    "--metrics-recording-only",
    "--mute-audio",
    "--window-size=1280,720",
    "about:blank"
  ];
  const child = spawn(executable, argumentsList, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-32_000);
  });
  let exited = null;
  child.once("exit", (code, signal) => { exited = { code, signal }; });

  const activePortPath = join(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  let port;
  let browserPath;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Chrome exited before CDP startup (${JSON.stringify(exited)}): ${stderr.trim()}`);
    try {
      const [portLine, pathLine] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      port = Number(portLine);
      browserPath = pathLine;
      if (Number.isFinite(port) && browserPath) break;
    } catch {
      // Chrome has not written the active port yet.
    }
    await sleep(50);
  }
  if (!Number.isFinite(port) || !browserPath) {
    child.kill("SIGTERM");
    throw new Error(`Chrome did not expose CDP within 15 seconds: ${stderr.trim()}`);
  }

  return {
    child,
    temporaryRoot,
    profileDirectory,
    port,
    browserWebSocketUrl: `ws://127.0.0.1:${port}${browserPath}`,
    stderr: () => stderr,
    async close() {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolvePromise) => child.once("exit", resolvePromise)),
        sleep(2_000)
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      const safePrefix = join(tmpdir(), "cablester-browser-perf-");
      if (!temporaryRoot.startsWith(safePrefix) || !basename(temporaryRoot).startsWith("cablester-browser-perf-")) {
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
      const timeout = setTimeout(() => rejectPromise(new Error(`CDP WebSocket open timeout: ${this.webSocketUrl}`)), 10_000);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener("error", () => {
        clearTimeout(timeout);
        rejectPromise(new Error(`CDP WebSocket failed: ${this.webSocketUrl}`));
      }, { once: true });
    });
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP WebSocket closed"));
      this.pending.clear();
    });
    return this;
  }

  handleMessage(data) {
    const message = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    if (!message.method) return;
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP is not open for ${method}`));
    }
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

  waitForEvent(method, predicate = () => true, timeoutMs = 15_000) {
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        rejectPromise(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const unsubscribe = this.on(method, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timeout);
        unsubscribe();
        resolvePromise(params);
      });
    });
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
  }
}

class NetworkMeasurement {
  constructor(cdp, origin) {
    this.cdp = cdp;
    this.origin = origin;
    this.active = null;
    cdp.on("Network.requestWillBeSent", (event) => this.requestWillBeSent(event));
    cdp.on("Network.requestServedFromCache", (event) => this.requestServedFromCache(event));
    cdp.on("Network.responseReceived", (event) => this.responseReceived(event));
    cdp.on("Network.dataReceived", (event) => this.dataReceived(event));
    cdp.on("Network.loadingFinished", (event) => this.loadingFinished(event));
    cdp.on("Network.loadingFailed", (event) => this.loadingFailed(event));
  }

  accepts(url) {
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }

  start(label) {
    if (this.active) throw new Error(`Network measurement ${this.active.label} is already running`);
    this.active = { label, startedAt: Date.now(), requests: new Map(), inflight: new Set() };
  }

  requestWillBeSent(event) {
    if (!this.active || !this.accepts(event.request?.url)) return;
    const previous = this.active.requests.get(event.requestId);
    this.active.requests.set(event.requestId, {
      requestId: event.requestId,
      url: event.request.url,
      type: event.type || previous?.type || "Other",
      method: event.request.method,
      status: null,
      mimeType: null,
      protocol: null,
      fromCache: false,
      decodedBodyBytes: 0,
      encodedChunkBytes: 0,
      transferBytes: 0,
      failed: false,
      errorText: null
    });
    this.active.inflight.add(event.requestId);
  }

  requestServedFromCache(event) {
    const request = this.active?.requests.get(event.requestId);
    if (request) request.fromCache = true;
  }

  responseReceived(event) {
    const request = this.active?.requests.get(event.requestId);
    if (!request) return;
    request.status = event.response.status;
    request.mimeType = event.response.mimeType;
    request.protocol = event.response.protocol;
    request.fromCache ||= Boolean(event.response.fromDiskCache || event.response.fromPrefetchCache || event.response.fromServiceWorker);
  }

  dataReceived(event) {
    const request = this.active?.requests.get(event.requestId);
    if (!request) return;
    request.decodedBodyBytes += event.dataLength || 0;
    request.encodedChunkBytes += event.encodedDataLength || 0;
  }

  loadingFinished(event) {
    const request = this.active?.requests.get(event.requestId);
    if (!request) return;
    request.transferBytes = event.encodedDataLength || 0;
    this.active.inflight.delete(event.requestId);
  }

  loadingFailed(event) {
    const request = this.active?.requests.get(event.requestId);
    if (!request) return;
    request.failed = true;
    request.errorText = event.errorText || "unknown network failure";
    this.active.inflight.delete(event.requestId);
  }

  async waitForIdle(idleMs = 650, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let idleSince = null;
    while (Date.now() < deadline) {
      if (!this.active) throw new Error("No active network measurement");
      if (this.active.inflight.size === 0) {
        idleSince ||= Date.now();
        if (Date.now() - idleSince >= idleMs) return;
      } else {
        idleSince = null;
      }
      await sleep(50);
    }
    throw new Error(`Network did not become idle; ${this.active?.inflight.size || 0} requests remain`);
  }

  finish() {
    if (!this.active) throw new Error("No active network measurement to finish");
    const measurement = this.active;
    this.active = null;
    const resources = [...measurement.requests.values()].map((request) => ({
      ...request,
      url: new URL(request.url).pathname + new URL(request.url).search
    }));
    const byType = {};
    for (const resource of resources) byType[resource.type] = (byType[resource.type] || 0) + 1;
    return {
      label: measurement.label,
      elapsedWallMs: Date.now() - measurement.startedAt,
      requestCount: resources.length,
      completedCount: resources.filter((resource) => !resource.failed).length,
      failedCount: resources.filter((resource) => resource.failed).length,
      httpErrorCount: resources.filter((resource) => Number(resource.status) >= 400).length,
      ignoredOptionalRequestCount: resources.filter((resource) => Number(resource.status) >= 400 && resource.url === "/favicon.ico").length,
      applicationErrorCount: resources.filter((resource) => resource.failed
        || (Number(resource.status) >= 400 && resource.url !== "/favicon.ico")).length,
      cachedRequestCount: resources.filter((resource) => resource.fromCache).length,
      transferBytes: resources.reduce((sum, resource) => sum + resource.transferBytes, 0),
      decodedBodyBytes: resources.reduce((sum, resource) => sum + resource.decodedBodyBytes, 0),
      byType,
      resources
    };
  }
}

async function createPageConnection(chrome) {
  const response = await fetch(`http://127.0.0.1:${chrome.port}/json/list`);
  if (!response.ok) throw new Error(`Could not list Chrome targets: HTTP ${response.status}`);
  const targets = await response.json();
  const target = targets.find((candidate) => candidate.type === "page");
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

async function pollPage(cdp, expression, label, timeoutMs = 20_000) {
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

async function setViewport(cdp, { width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: { type: "landscapePrimary", angle: 0 }
  });
}

async function resourceTimingSnapshot(cdp) {
  return evaluate(cdp, `(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const entries = [navigation, ...resources].filter(Boolean);
    return {
      navigation: navigation ? {
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadEventMs: navigation.loadEventEnd,
        responseEndMs: navigation.responseEnd,
        transferSize: navigation.transferSize,
        encodedBodySize: navigation.encodedBodySize,
        decodedBodySize: navigation.decodedBodySize
      } : null,
      entryCount: entries.length,
      transferBytes: entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      encodedBodyBytes: entries.reduce((sum, entry) => sum + (entry.encodedBodySize || 0), 0),
      decodedBodyBytes: entries.reduce((sum, entry) => sum + (entry.decodedBodySize || 0), 0)
    };
  })()`);
}

async function measureStartup(cdp, network, { label, url, navigate = false, clearCache = false }) {
  if (clearCache) await cdp.send("Network.clearBrowserCache");
  network.start(label);
  const loadPromise = cdp.waitForEvent("Page.loadEventFired", () => true, 25_000);
  if (navigate) await cdp.send("Page.navigate", { url });
  else await cdp.send("Page.reload", { ignoreCache: false });
  await loadPromise;
  const formalInteractive = await pollPage(cdp, `(() => window.cablester?.levels?.length >= 10 && ({
    elapsedMs: performance.now(),
    formalLevelCount: window.cablester.levels.length,
    readyState: document.readyState
  }))()`, `${label} formal interaction`, 25_000);
  const referenceReady = await pollPage(cdp, `(() => document.querySelector(".reference-room-search") && ({
    elapsedMs: performance.now(),
    visibleReferenceButtons: document.querySelectorAll('.level-button[data-category="参考白盒"]').length
  }))()`, `${label} reference index`, 25_000);
  const visualReady = await pollPage(cdp, `(() => {
    const stats = window.cablester?.visualRuntime?.stats?.();
    return stats && stats.loading === 0 && ({ elapsedMs: performance.now(), stats: { ...stats } });
  })()`, `${label} visual assets`, 25_000);
  await network.waitForIdle(650, 25_000);
  const networkResult = network.finish();
  return {
    formalInteractive,
    referenceReady,
    visualReady,
    resourceTiming: await resourceTimingSnapshot(cdp),
    network: networkResult
  };
}

async function pageState(cdp) {
  return evaluate(cdp, `(() => {
    const game = window.cablester;
    const visualStats = game.visualRuntime.stats();
    return {
      levelId: game.level?.id || null,
      levelName: game.level?.name || null,
      running: game.running,
      paused: game.paused,
      camera: { x: game.camera.x, y: game.camera.y, angle: game.camera.angle },
      player: {
        x: game.player.x,
        y: game.player.y,
        vx: game.player.vx,
        vy: game.player.vy,
        distanceTravelled: game.player.distanceTravelled,
        respawnTimer: game.player.respawnTimer
      },
      viewport: {
        innerWidth,
        innerHeight,
        devicePixelRatio,
        canvasWidth: document.querySelector("#game")?.width || null,
        canvasHeight: document.querySelector("#game")?.height || null
      },
      activeObjects: game.debugStats.activeObjects,
      renderedObjects: game.debugStats.renderedObjects,
      collisionCandidates: game.debugStats.collisionCandidates,
      sceneLayerCount: game.level?.scene?.layers?.length || 0,
      frameMetrics: { ...game.frameMetrics, samples: undefined },
      qualityProfile: { ...game.visualRuntime.quality },
      visualStats: { ...visualStats }
    };
  })()`);
}

async function waitForPageMilliseconds(cdp, milliseconds) {
  await evaluate(cdp, `new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => performance.now() - startedAt >= ${JSON.stringify(milliseconds)}
      ? resolve(true)
      : requestAnimationFrame(tick);
    requestAnimationFrame(tick);
  })`);
}

async function startFormalLevel(cdp, levelId) {
  return evaluate(cdp, `(async () => {
    const game = window.cablester;
    const level = game.levels.find((candidate) => candidate.id === ${JSON.stringify(levelId)});
    if (!level) throw new Error("Unknown formal level: " + ${JSON.stringify(levelId)});
    const levelIndex = game.levels.indexOf(level);
    const adjacentLevels = [game.levels[levelIndex - 1], game.levels[levelIndex + 1]].filter(Boolean);
    const started = await game.startPrepared(level, {}, adjacentLevels);
    const assetStats = { ...game.visualRuntime.stats() };
    if (!started || assetStats.loading !== 0) throw new Error("Prepared formal level committed before visual assets settled");
    return { id: level.id, name: level.name, category: level.category, prepared: true, assetStats };
  })()`);
}

async function startReferenceLevel(cdp, roomId) {
  return evaluate(cdp, `(async () => {
    const library = window.cablesterReference.library;
    const neighborhood = await library.preloadRoomNeighborhood(${JSON.stringify(roomId)});
    const level = neighborhood.levels.get(${JSON.stringify(roomId)});
    if (!level) throw neighborhood.errors[0]?.error || new Error("Unable to prepare reference level");
    const adjacentLevels = [...neighborhood.levels.entries()]
      .filter(([candidateId]) => candidateId !== ${JSON.stringify(roomId)})
      .map(([, candidateLevel]) => candidateLevel);
    window.cablester.setRoomExitHandler(null);
    const started = await window.cablester.startPrepared(level, {}, adjacentLevels);
    const assetStats = { ...window.cablester.visualRuntime.stats() };
    if (!started || assetStats.loading !== 0) throw new Error("Prepared reference level committed before visual assets settled");
    return { id: level.id, name: level.name, category: level.category, prepared: true, assetStats };
  })()`);
}

const KEY_DEFINITIONS = Object.freeze({
  KeyD: Object.freeze({ key: "d", code: "KeyD", text: "d", windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 68 }),
  Space: Object.freeze({ key: " ", code: "Space", text: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }),
  ShiftLeft: Object.freeze({ key: "Shift", code: "ShiftLeft", text: "", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 })
});

async function dispatchKey(cdp, code, type) {
  const definition = KEY_DEFINITIONS[code];
  await cdp.send("Input.dispatchKeyEvent", { type, ...definition });
}

async function tapKey(cdp, code, holdMs = 45) {
  await dispatchKey(cdp, code, "keyDown");
  await sleep(holdMs);
  await dispatchKey(cdp, code, "keyUp");
}

async function driveRightwardInput(cdp, durationMs) {
  let jumpCount = 0;
  let dashCount = 0;
  const startedAt = Date.now();
  await dispatchKey(cdp, "KeyD", "keyDown");
  try {
    while (Date.now() - startedAt < durationMs - 180) {
      const remaining = durationMs - (Date.now() - startedAt) - 180;
      await sleep(Math.max(1, Math.min(850, remaining)));
      if (Date.now() - startedAt >= durationMs - 140) break;
      await tapKey(cdp, "Space");
      jumpCount += 1;
      if (jumpCount % 3 === 0 && Date.now() - startedAt < durationMs - 250) {
        await tapKey(cdp, "ShiftLeft");
        dashCount += 1;
      }
    }
  } finally {
    await dispatchKey(cdp, "KeyD", "keyUp");
    await dispatchKey(cdp, "Space", "keyUp");
    await dispatchKey(cdp, "ShiftLeft", "keyUp");
  }
  return { heldRightMs: Date.now() - startedAt, jumpPresses: jumpCount, dashPresses: dashCount };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function frameMetrics(deltas, requestedDurationMs) {
  const valid = deltas.filter((value) => Number.isFinite(value) && value > 0 && value < 1_000);
  const sorted = [...valid].sort((left, right) => left - right);
  const durationMs = valid.reduce((sum, value) => sum + value, 0);
  const averageMs = valid.length ? durationMs / valid.length : 0;
  return {
    requestedDurationMs,
    measuredDurationMs: Number(durationMs.toFixed(3)),
    frameCount: valid.length,
    averageFps: Number((averageMs > 0 ? 1_000 / averageMs : 0).toFixed(3)),
    averageFrameMs: Number(averageMs.toFixed(3)),
    p50FrameMs: Number(percentile(sorted, 0.5).toFixed(3)),
    p95FrameMs: Number(percentile(sorted, 0.95).toFixed(3)),
    p99FrameMs: Number(percentile(sorted, 0.99).toFixed(3)),
    worstFrameMs: Number((sorted.at(-1) || 0).toFixed(3)),
    framesOver16_7Ms: valid.filter((value) => value > 16.7).length,
    framesOver33_3Ms: valid.filter((value) => value > 33.3).length,
    framesOver50Ms: valid.filter((value) => value > 50).length
  };
}

async function collectRafSample(cdp, { label, durationMs, warmupMs }) {
  await evaluate(cdp, `document.querySelector("#game")?.focus()`);
  await waitForPageMilliseconds(cdp, warmupMs);
  const before = await pageState(cdp);
  const framePromise = evaluate(cdp, `new Promise((resolve) => {
    const deltas = [];
    const startedAt = performance.now();
    let previous = null;
    let previousCameraX = window.cablester.camera.x;
    let cameraMinX = previousCameraX;
    let cameraMaxX = previousCameraX;
    let cameraCumulativeX = 0;
    const tick = (timestamp) => {
      if (previous !== null) deltas.push(timestamp - previous);
      previous = timestamp;
      const cameraX = window.cablester.camera.x;
      cameraMinX = Math.min(cameraMinX, cameraX);
      cameraMaxX = Math.max(cameraMaxX, cameraX);
      cameraCumulativeX += Math.abs(cameraX - previousCameraX);
      previousCameraX = cameraX;
      if (performance.now() - startedAt >= ${JSON.stringify(durationMs)}) {
        resolve({ deltas, wallDurationMs: performance.now() - startedAt, cameraMinX, cameraMaxX, cameraCumulativeX });
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  })`);
  const inputPromise = driveRightwardInput(cdp, durationMs);
  const [frames, input] = await Promise.all([framePromise, inputPromise]);
  const after = await pageState(cdp);
  return {
    label,
    metrics: frameMetrics(frames.deltas, durationMs),
    pageWallDurationMs: Number(frames.wallDurationMs.toFixed(3)),
    input,
    movement: {
      cameraDeltaX: Number((after.camera.x - before.camera.x).toFixed(3)),
      cameraDeltaY: Number((after.camera.y - before.camera.y).toFixed(3)),
      cameraRangeX: Number((frames.cameraMaxX - frames.cameraMinX).toFixed(3)),
      cameraCumulativeX: Number(frames.cameraCumulativeX.toFixed(3)),
      playerDeltaX: Number((after.player.x - before.player.x).toFixed(3)),
      playerDeltaY: Number((after.player.y - before.player.y).toFixed(3)),
      distanceTravelledDelta: Number((after.player.distanceTravelled - before.player.distanceTravelled).toFixed(3))
    },
    before,
    after
  };
}

async function performanceMetrics(cdp) {
  const result = await cdp.send("Performance.getMetrics");
  const values = Object.fromEntries(result.metrics.map((metric) => [metric.name, metric.value]));
  return {
    timestamp: values.Timestamp ?? null,
    documents: values.Documents ?? null,
    nodes: values.Nodes ?? null,
    jsEventListeners: values.JSEventListeners ?? null,
    jsHeapUsedBytes: values.JSHeapUsedSize ?? null,
    jsHeapTotalBytes: values.JSHeapTotalSize ?? null,
    layoutCount: values.LayoutCount ?? null,
    recalcStyleCount: values.RecalcStyleCount ?? null,
    taskDurationSeconds: values.TaskDuration ?? null,
    scriptDurationSeconds: values.ScriptDuration ?? null
  };
}

async function pageMemory(cdp) {
  return evaluate(cdp, `(() => performance.memory ? {
    jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
    totalJSHeapSize: performance.memory.totalJSHeapSize,
    usedJSHeapSize: performance.memory.usedJSHeapSize
  } : null)()`);
}

async function runSwitchStress(cdp, network, switchCount) {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(100);
  const before = {
    cdp: await performanceMetrics(cdp),
    page: await pageMemory(cdp),
    state: await pageState(cdp)
  };
  network.start("twenty-formal-level-switches");
  const sequence = await evaluate(cdp, `(async () => {
    const game = window.cablester;
    const sequence = [];
    for (let index = 0; index < ${JSON.stringify(switchCount)}; index += 1) {
      const levelIndex = index % game.levels.length;
      const level = game.levels[levelIndex];
      const adjacentLevels = [game.levels[levelIndex - 1], game.levels[levelIndex + 1]].filter(Boolean);
      const started = await game.startPrepared(level, {}, adjacentLevels);
      if (!started || game.visualRuntime.stats().loading !== 0) throw new Error("Switch stress committed an unprepared level");
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      sequence.push({
        index: index + 1,
        levelId: level.id,
        visualStats: { ...game.visualRuntime.stats() }
      });
    }
    return sequence;
  })()`);
  await network.waitForIdle(350, 20_000);
  const switchNetwork = network.finish();
  const beforeGc = {
    cdp: await performanceMetrics(cdp),
    page: await pageMemory(cdp),
    state: await pageState(cdp)
  };
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(100);
  const afterGc = {
    cdp: await performanceMetrics(cdp),
    page: await pageMemory(cdp),
    state: await pageState(cdp)
  };
  const visualStats = afterGc.state.visualStats;
  return {
    requestedSwitchCount: switchCount,
    completedSwitchCount: sequence.length,
    levelSequence: sequence.map((item) => item.levelId),
    snapshots: sequence.filter((_item, index) => index === 0 || (index + 1) % 5 === 0),
    network: switchNetwork,
    heap: {
      before,
      afterBeforeGc: beforeGc,
      afterForcedGc: afterGc,
      retainedJsHeapDeltaBytes: afterGc.cdp.jsHeapUsedBytes - before.cdp.jsHeapUsedBytes
    },
    visualRuntime: visualStats,
    textureMemoryEstimate: {
      method: "VisualRuntime decoded image dimensions plus tint-canvas dimensions multiplied by four RGBA bytes; this is an estimate, not measured GPU memory.",
      decodedBytes: visualStats.estimatedDecodedBytes,
      tintBytes: visualStats.estimatedTintBytes,
      combinedBytes: visualStats.estimatedDecodedBytes + visualStats.estimatedTintBytes
    }
  };
}

async function discoverHeaviestReferenceRooms() {
  const index = JSON.parse(await readFile(join(projectRoot, "levels", "reference", "playable-index.json"), "utf8"));
  const candidates = [];
  for (const room of Object.values(index.rooms)) {
    const document = JSON.parse(await readFile(join(projectRoot, room.dataFile), "utf8"));
    candidates.push({
      id: room.id,
      game: room.game,
      localName: room.localName,
      mapType: room.mapType,
      dataFile: room.dataFile,
      objectCount: Array.isArray(document.objects) ? document.objects.length : 0,
      boundsArea: Number(document.bounds?.w || 0) * Number(document.bounds?.h || 0)
    });
  }
  const choose = (game) => candidates
    .filter((candidate) => candidate.game === game)
    .sort((left, right) => right.objectCount - left.objectCount
      || right.boundsArea - left.boundsArea
      || left.id.localeCompare(right.id))[0];
  return {
    selectionMethod: "Highest unified document object count per source game; ties use larger bounds area, then lexical room ID.",
    scannedRoomCount: candidates.length,
    rooms: [choose("celeste"), choose("ori-blind-forest-definitive-edition")]
  };
}

async function environmentSnapshot(cdp, chromeVersion, browserInfo) {
  const page = await evaluate(cdp, `(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      devicePixelRatio,
      prefersReducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      crossOriginIsolated,
      webgl: gl ? {
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        version: gl.getParameter(gl.VERSION)
      } : null
    };
  })()`);
  return {
    chromeVersion,
    browserProduct: browserInfo?.product || null,
    browserProtocolVersion: browserInfo?.protocolVersion || null,
    ...page
  };
}

function portableEnvironment(snapshot, { controlledHardwareConcurrency = null } = {}) {
  return {
    chromeVersion: snapshot.chromeVersion,
    browserProduct: snapshot.browserProduct,
    browserProtocolVersion: snapshot.browserProtocolVersion,
    deviceProfile: controlledHardwareConcurrency === null ? "local-desktop-redacted" : "controlled-low-tier",
    controlledHardwareConcurrency,
    devicePixelRatio: snapshot.devicePixelRatio,
    prefersReducedMotion: snapshot.prefersReducedMotion,
    crossOriginIsolated: snapshot.crossOriginIsolated,
    webglAvailable: Boolean(snapshot.webgl),
    privacy: "Host, OS, processor, memory and GPU-identifying fields are intentionally omitted from repository evidence."
  };
}

async function collectInputFingerprint() {
  const roots = [
    join(projectRoot, "index.html"),
    join(projectRoot, "styles.css"),
    join(projectRoot, "src"),
    join(projectRoot, "assets", "game"),
    join(projectRoot, "levels", "reference", "playable-index.json"),
    join(projectRoot, "scripts", "audit-browser-performance.mjs")
  ];
  const files = [];
  const walk = async (path) => {
    const info = await stat(path);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await walk(join(path, entry));
    } else if (/\.(?:html|css|js|mjs|json|webp)$/.test(path)) {
      files.push(path);
    }
  };
  for (const root of roots) await walk(root);
  const digest = createHash("sha256");
  for (const file of files.sort()) {
    const content = await readFile(file);
    digest.update(relative(projectRoot, file));
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }
  return { algorithm: "sha256", value: digest.digest("hex"), fileCount: files.length };
}

function addFailure(failures, condition, code, detail) {
  if (!condition) failures.push({ code, detail });
}

function validateFrameSample(failures, sample, prefix, { requireMovement = false, minimumFps = 20 } = {}) {
  addFailure(failures, sample.metrics.measuredDurationMs >= sample.metrics.requestedDurationMs * 0.9,
    `${prefix}.duration`, `${sample.metrics.measuredDurationMs}/${sample.metrics.requestedDurationMs} ms`);
  addFailure(failures, sample.metrics.averageFps >= minimumFps,
    `${prefix}.fps`, `${sample.metrics.averageFps} fps is below ${minimumFps}`);
  addFailure(failures, sample.after.visualStats.error === 0 && sample.after.visualStats.loading === 0,
    `${prefix}.assets`, JSON.stringify(sample.after.visualStats));
  if (requireMovement) {
    addFailure(failures, Math.max(sample.movement.cameraRangeX, sample.movement.cameraCumulativeX) >= 20,
      `${prefix}.cameraMovement`, `camera range/cumulative X were ${sample.movement.cameraRangeX}/${sample.movement.cameraCumulativeX}`);
    addFailure(failures, sample.input.heldRightMs >= sample.metrics.requestedDurationMs * 0.85,
      `${prefix}.realInput`, `right key was held ${sample.input.heldRightMs} ms`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const serverResponse = await fetch(options.url, { cache: "no-store" });
  if (!serverResponse.ok) throw new Error(`Baseline URL returned HTTP ${serverResponse.status}: ${options.url}`);
  const chromeExecutable = await findChrome(options.chrome);
  const chromeVersion = await executableVersion(chromeExecutable);
  const inputFingerprint = await collectInputFingerprint();
  const referenceContentFingerprint = await referenceLibraryFingerprint(projectRoot);
  const referenceSelection = await discoverHeaviestReferenceRooms();
  const chrome = await launchChrome(chromeExecutable);
  let pageCdp;
  let browserCdp;
  const diagnostics = { exceptions: [], consoleErrors: [], consoleWarnings: [], logErrors: [], logWarnings: [], ignored: [] };
  try {
    browserCdp = await new CDPConnection(chrome.browserWebSocketUrl).open();
    const browserInfo = await browserCdp.send("Browser.getVersion");
    let gpuInfo = null;
    try {
      const systemInfo = await browserCdp.send("SystemInfo.getInfo");
      gpuInfo = {
        devices: systemInfo.gpu?.devices || [],
        auxAttributes: systemInfo.gpu?.auxAttributes || null,
        featureStatus: systemInfo.gpu?.featureStatus || null,
        modelName: systemInfo.modelName || null,
        modelVersion: systemInfo.modelVersion || null
      };
    } catch (error) {
      gpuInfo = { unavailable: error.message };
    }

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
      const values = (event.args || []).map((argument) => argument.value ?? argument.description ?? argument.type);
      const record = { type: event.type, values };
      if (event.type === "error") diagnostics.consoleErrors.push(record);
      else if (event.type === "warning") diagnostics.consoleWarnings.push(record);
    });
    pageCdp.on("Log.entryAdded", ({ entry }) => {
      const record = { source: entry.source, text: entry.text, url: entry.url || null, lineNumber: entry.lineNumber || null };
      const optionalFavicon404 = entry.level === "error"
        && entry.source === "network"
        && entry.url === new URL("favicon.ico", options.url).href
        && /404/.test(entry.text);
      if (optionalFavicon404) diagnostics.ignored.push({ ...record, reason: "Chrome's implicit optional favicon request is not an application resource." });
      else if (entry.level === "error") diagnostics.logErrors.push(record);
      else if (entry.level === "warning") diagnostics.logWarnings.push(record);
    });

    await setViewport(pageCdp, STANDARD_VIEWPORTS[0]);
    const network = new NetworkMeasurement(pageCdp, new URL(options.url).origin);
    const coldStartup = await measureStartup(pageCdp, network, {
      label: "cold-start-empty-cache",
      url: options.url,
      navigate: true,
      clearCache: true
    });
    const coldEnvironment = await environmentSnapshot(pageCdp, chromeVersion, browserInfo);
    const initialQualityTier = coldStartup.visualReady.stats.qualityTier;
    const warmStartup = await measureStartup(pageCdp, network, {
      label: "warm-reload-populated-cache",
      url: options.url,
      navigate: false,
      clearCache: false
    });

    const formalSamples = [];
    for (const viewport of STANDARD_VIEWPORTS) {
      await setViewport(pageCdp, viewport);
      await startFormalLevel(pageCdp, REPRESENTATIVE_LEVEL_ID);
      formalSamples.push({
        viewport,
        ...(await collectRafSample(pageCdp, {
          label: `${REPRESENTATIVE_LEVEL_ID}-${viewport.width}x${viewport.height}`,
          durationMs: options.frameDurationMs,
          warmupMs: options.warmupMs
        }))
      });
    }
    const additionalFormalSamples = [];
    for (const { levelId, viewport } of ADDITIONAL_FORMAL_SAMPLE_PLAN) {
      await setViewport(pageCdp, viewport);
      await startFormalLevel(pageCdp, levelId);
      additionalFormalSamples.push({
        levelId,
        viewport,
        ...(await collectRafSample(pageCdp, {
          label: `${levelId}-${viewport.width}x${viewport.height}`,
          durationMs: options.frameDurationMs,
          warmupMs: options.warmupMs
        }))
      });
    }
    const allFormalSamples = [
      ...formalSamples.map((sample) => ({ levelId: REPRESENTATIVE_LEVEL_ID, ...sample })),
      ...additionalFormalSamples
    ];

    await setViewport(pageCdp, STANDARD_VIEWPORTS[0]);
    const [celesteRoom, oriRoom] = referenceSelection.rooms;
    const referenceSamplePlan = [
      { room: celesteRoom, viewport: STANDARD_VIEWPORTS[0] },
      ...STANDARD_VIEWPORTS.map((viewport) => ({ room: oriRoom, viewport }))
    ];
    const referenceSamples = [];
    for (const { room, viewport } of referenceSamplePlan) {
      await setViewport(pageCdp, viewport);
      await startReferenceLevel(pageCdp, room.id);
      referenceSamples.push({
        selection: room,
        viewport,
        ...(await collectRafSample(pageCdp, {
          label: `${room.id}-${viewport.width}x${viewport.height}`,
          durationMs: options.referenceDurationMs,
          warmupMs: options.warmupMs
        }))
      });
    }

    const switchStress = await runSwitchStress(pageCdp, network, options.switchCount);

    await pageCdp.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: 4 });
    await pageCdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const lowReload = await measureStartup(pageCdp, network, {
      label: "controlled-low-tier-reload",
      url: options.url,
      navigate: false,
      clearCache: false
    });
    await setViewport(pageCdp, STANDARD_VIEWPORTS[0]);
    await startFormalLevel(pageCdp, REPRESENTATIVE_LEVEL_ID);
    const lowSample = await collectRafSample(pageCdp, {
      label: `${REPRESENTATIVE_LEVEL_ID}-low-tier-4x-cpu`,
      durationMs: options.lowDurationMs,
      warmupMs: Math.max(options.warmupMs, 2_000)
    });
    const lowEnvironment = await environmentSnapshot(pageCdp, chromeVersion, browserInfo);
    await pageCdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    const failures = [];
    for (const startup of [coldStartup, warmStartup, lowReload]) {
      addFailure(failures, startup.network.applicationErrorCount === 0,
        `startup.${startup.network.label}.network`, `${startup.network.applicationErrorCount} application request errors`);
      addFailure(failures, startup.formalInteractive.elapsedMs < 15_000,
        `startup.${startup.network.label}.interactive`, `${startup.formalInteractive.elapsedMs} ms`);
      addFailure(failures, startup.visualReady.stats.error === 0,
        `startup.${startup.network.label}.assets`, JSON.stringify(startup.visualReady.stats));
    }
    formalSamples.forEach((sample, index) => validateFrameSample(failures, sample, `formal.${index}`, { requireMovement: true }));
    additionalFormalSamples.forEach((sample, index) => validateFrameSample(failures, sample, `formalAdditional.${index}`));
    referenceSamples.forEach((sample, index) => {
      validateFrameSample(failures, sample, `reference.${index}`);
      addFailure(failures, sample.before.levelId === sample.selection.id && sample.after.levelId === sample.selection.id,
        `reference.${index}.roomRetention`, `${sample.before.levelId} -> ${sample.after.levelId}`);
    });
    validateFrameSample(failures, lowSample, "lowTier", { requireMovement: true, minimumFps: 5 });
    addFailure(failures, switchStress.completedSwitchCount === options.switchCount,
      "switchStress.count", `${switchStress.completedSwitchCount}/${options.switchCount}`);
    addFailure(failures, switchStress.visualRuntime.error === 0 && switchStress.visualRuntime.loading === 0,
      "switchStress.assets", JSON.stringify(switchStress.visualRuntime));
    addFailure(failures, switchStress.network.applicationErrorCount === 0,
      "switchStress.network", `${switchStress.network.applicationErrorCount} application request errors`);
    addFailure(failures, lowSample.after.visualStats.qualityTier === "low",
      "lowTier.selection", `Expected low, got ${lowSample.after.visualStats.qualityTier}`);
    addFailure(failures, lowEnvironment.hardwareConcurrency === 4,
      "lowTier.hardwareConcurrency", `Expected controlled value 4, got ${lowEnvironment.hardwareConcurrency}`);
    addFailure(failures, diagnostics.exceptions.length === 0 && diagnostics.consoleErrors.length === 0 && diagnostics.logErrors.length === 0,
      "diagnostics.errors", JSON.stringify(diagnostics));

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: failures.length === 0 ? "pass" : "fail",
      inputFingerprint,
      referenceContentFingerprint,
      configuration: {
        url: options.url,
        representativeLevelId: REPRESENTATIVE_LEVEL_ID,
        formalViewports: STANDARD_VIEWPORTS,
        additionalFormalSamples: ADDITIONAL_FORMAL_SAMPLE_PLAN,
        formalFrameDurationMs: options.frameDurationMs,
        referenceFrameDurationMs: options.referenceDurationMs,
        lowTierFrameDurationMs: options.lowDurationMs,
        warmupMs: options.warmupMs,
        switchCount: options.switchCount,
        standardRun: options.frameDurationMs === DEFAULT_FRAME_DURATION_MS
          && options.referenceDurationMs === DEFAULT_REFERENCE_DURATION_MS
          && options.lowDurationMs === DEFAULT_LOW_DURATION_MS
          && options.switchCount === DEFAULT_SWITCH_COUNT
      },
      methodology: {
        browser: "Installed Google Chrome headless=new controlled directly through the Chrome DevTools Protocol; no browser automation package.",
        startup: "Cold start clears the Chrome cache; warm start reloads the same page with the populated cache. Request/transfer/decoded bytes come from CDP Network events and same-origin Resource Timing.",
        frames: "Each sample warms the real running page, then records consecutive requestAnimationFrame timestamp deltas while CDP dispatches real KeyD, Space, and Shift key events. Reference-room exits are temporarily disconnected so each labeled sample remains inside the selected heaviest room for its full window.",
        jsHeap: "Renderer JavaScript heap comes from CDP Performance.getMetrics before switching, after switching, and after HeapProfiler.collectGarbage.",
        textureMemory: "VisualRuntime estimates decoded and tint RGBA bytes from image/canvas dimensions. GPU memory is not directly exposed and is explicitly not claimed as measured.",
        lowTier: "A controlled CDP hardwareConcurrency=4 override triggers the runtime auto low tier; 4x CPU throttling supplies a separate slower-device frame sample. This is controlled emulation, not the host hardware baseline."
      },
      environment: {
        cold: portableEnvironment(coldEnvironment),
        lowTierControlled: portableEnvironment(lowEnvironment, { controlledHardwareConcurrency: 4 }),
        gpuInfo: { available: Boolean(gpuInfo), detailsRedacted: true },
        gpuMemoryMeasurement: {
          available: false,
          reason: "Chrome/CDP does not expose reliable per-page GPU texture memory for this Canvas workload; texture bytes are reported only as a VisualRuntime estimate."
        },
        initialVisualQualityTier: initialQualityTier
      },
      startup: { cold: coldStartup, warm: warmStartup },
      formalRepresentative: {
        levelId: REPRESENTATIVE_LEVEL_ID,
        samples: formalSamples
      },
      formalLevels: {
        selectionMethod: "Representative horizontal art level at three required viewports, plus the formal vertical-navigation and hazard-density levels at 1280x720.",
        samples: allFormalSamples
      },
      additionalFormalLevels: {
        samples: additionalFormalSamples
      },
      heaviestReferenceRooms: {
        selectionMethod: referenceSelection.selectionMethod,
        scannedRoomCount: referenceSelection.scannedRoomCount,
        samples: referenceSamples
      },
      switchStress,
      lowPerformanceDegradation: {
        controlledHardwareConcurrency: 4,
        cpuThrottlingRate: 4,
        reload: lowReload,
        sample: lowSample,
        highOrAutoProfile: formalSamples[0].after.qualityProfile,
        lowProfile: lowSample.after.qualityProfile
      },
      diagnostics: {
        ...diagnostics,
        errorCount: diagnostics.exceptions.length + diagnostics.consoleErrors.length + diagnostics.logErrors.length,
        warningCount: diagnostics.consoleWarnings.length + diagnostics.logWarnings.length
      },
      acceptance: {
        passed: failures.length === 0,
        failures
      }
    };
    const freshConsoleErrorsOrWarnings = diagnostics.exceptions.length
      + diagnostics.consoleErrors.length
      + diagnostics.consoleWarnings.length
      + diagnostics.logErrors.length
      + diagnostics.logWarnings.length;
    const referencePerformanceAudit = {
      schemaVersion: 2,
      ranAt: report.generatedAt,
      environment: {
        chromeVersion: coldEnvironment.chromeVersion,
        deviceProfile: "local-desktop-redacted",
        privacy: "Host and hardware-identifying fields are intentionally omitted from repository evidence.",
        browserSurface: "Installed Google Chrome headless=new through direct CDP"
      },
      contentFingerprint: referenceContentFingerprint,
      method: "From the same direct-CDP performance run as levels/art/performance-audit.json: dynamically select the highest unified object-count Celeste and Ori rooms, keep each sample in its selected room by temporarily disconnecting exits, warm the live runtime, then collect a 10-second requestAnimationFrame distribution while dispatching real keyboard input.",
      samples: referenceSamples.map((sample) => ({
        roomId: sample.selection.id,
        selectionReason: referenceSelection.selectionMethod,
        documentObjects: sample.selection.objectCount,
        viewport: `${sample.viewport.width}x${sample.viewport.height}`,
        requestedDurationMs: sample.metrics.requestedDurationMs,
        measuredDurationMs: sample.metrics.measuredDurationMs,
        averageFps: sample.metrics.averageFps,
        averageFrameMs: sample.metrics.averageFrameMs,
        p95FrameMs: sample.metrics.p95FrameMs,
        worstFrameMs: sample.metrics.worstFrameMs,
        activeObjects: sample.after.activeObjects,
        drawnObjects: sample.after.renderedObjects,
        collisionCandidates: sample.after.collisionCandidates,
        realKeyboardInput: sample.input,
        cameraMovement: {
          netX: sample.movement.cameraDeltaX,
          rangeX: sample.movement.cameraRangeX,
          cumulativeX: sample.movement.cameraCumulativeX
        },
        visualRuntime: sample.after.visualStats
      })),
      freshConsoleErrorsOrWarnings,
      sourceAudit: relative(projectRoot, options.output),
      caveat: "Headless Chrome rAF cadence and controlled input are reproducible evidence for this machine and checkout, not a promise for every device. GPU memory is not directly measured; the linked art audit reports only decoded/tint texture estimates."
    };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`);
    if (report.configuration.standardRun) {
      await writeFile(REFERENCE_OUTPUT, `${JSON.stringify(referencePerformanceAudit, null, 2)}\n`);
    }
    console.log(`Browser performance audit ${report.status.toUpperCase()} · ${relative(projectRoot, options.output)}`);
    console.log(`startup cold/warm ${coldStartup.formalInteractive.elapsedMs.toFixed(1)}/${warmStartup.formalInteractive.elapsedMs.toFixed(1)} ms · requests ${coldStartup.network.requestCount}/${warmStartup.network.requestCount}`);
    for (const sample of allFormalSamples) {
      console.log(`${sample.levelId} ${sample.viewport.width}x${sample.viewport.height} · ${sample.metrics.averageFps.toFixed(1)} fps · p95 ${sample.metrics.p95FrameMs.toFixed(2)} ms · worst ${sample.metrics.worstFrameMs.toFixed(2)} ms · camera ${sample.movement.cameraDeltaX.toFixed(1)}`);
    }
    for (const sample of referenceSamples) {
      console.log(`${sample.selection.id} · ${sample.metrics.averageFps.toFixed(1)} fps · p95 ${sample.metrics.p95FrameMs.toFixed(2)} ms · objects ${sample.after.activeObjects}`);
    }
    console.log(`switches ${switchStress.completedSwitchCount} · JS retained ${(switchStress.heap.retainedJsHeapDeltaBytes / 1024 / 1024).toFixed(2)} MiB · texture estimate ${(switchStress.textureMemoryEstimate.combinedBytes / 1024 / 1024).toFixed(2)} MiB · asset errors ${switchStress.visualRuntime.error}`);
    console.log(`controlled low tier ${lowSample.after.visualStats.qualityTier} · ${lowSample.metrics.averageFps.toFixed(1)} fps · scene draws ${lowSample.after.visualStats.sceneDraws}`);
    if (failures.length) {
      for (const failure of failures) console.error(`FAIL ${failure.code}: ${failure.detail}`);
      process.exitCode = 1;
    }
  } finally {
    try {
      if (pageCdp) await pageCdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    } catch {
      // Chrome may already be closing.
    }
    pageCdp?.close();
    browserCdp?.close();
    await chrome.close();
  }
}

main().catch((error) => {
  console.error(`Browser performance audit ERROR · ${error.stack || error.message}`);
  process.exitCode = 1;
});
