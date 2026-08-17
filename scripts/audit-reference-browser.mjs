#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceLibraryFingerprint } from "./reference-library-fingerprint.mjs";

export const EXPECTED_REFERENCE_TOTALS = Object.freeze({
  rooms: 908,
  entrances: 2326,
  checkpoints: 908,
  exits: 3668,
  collections: 44,
  transitions: 864,
  manifestConnections: 3678
});

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "http://127.0.0.1:4177/";
const DEFAULT_OUTPUT_DIR = join(projectRoot, "levels", "reference");
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const EVIDENCE_FILENAMES = Object.freeze({
  load: "browser-load-audit.json",
  acceptance: "browser-acceptance-audit.json",
  continuous: "continuous-run-audit.json"
});

const AUDIT_DEFINITIONS = Object.freeze([
  Object.freeze({ kind: "load", method: "runLoadAudit", state: "loadAudit" }),
  Object.freeze({ kind: "acceptance", method: "runAcceptanceAudit", state: "acceptanceAudit" }),
  Object.freeze({ kind: "continuous", method: "runContinuousAudit", state: "continuousAudit" })
]);

export function usage() {
  return `Usage: node scripts/audit-reference-browser.mjs [options]\n\n` +
    `  --url URL             Loopback product URL (${DEFAULT_URL})\n` +
    `  --chrome PATH         Installed Google Chrome executable\n` +
    `  --output-dir PATH     Evidence directory (${relative(projectRoot, DEFAULT_OUTPUT_DIR)})\n` +
    `  --timeout-ms N        Timeout for each production audit (${DEFAULT_TIMEOUT_MS})\n` +
    `  --dry-run             Run and validate without writing evidence\n` +
    `  --help                Show this help`;
}

export function parseArguments(argv, { root = projectRoot } = {}) {
  const options = {
    url: DEFAULT_URL,
    chrome: process.env.CHROME_PATH || null,
    outputDir: resolve(root, "levels", "reference"),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    dryRun: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--url" && value) options.url = value, index += 1;
    else if (argument === "--chrome" && value) options.chrome = value, index += 1;
    else if (argument === "--output-dir" && value) options.outputDir = resolve(root, value), index += 1;
    else if (argument === "--timeout-ms" && value) options.timeoutMs = Number(value), index += 1;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("timeoutMs must be at least 1000");
  }
  const parsedUrl = new URL(options.url);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
    throw new Error(`Reference browser evidence must run against a loopback URL: ${parsedUrl.href}`);
  }
  options.url = parsedUrl.href;
  options.timeoutMs = Math.floor(options.timeoutMs);
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
      // Continue through the known installed browser locations.
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
    if (response.ok) return { child: null, owned: false, output: () => "" };
  } catch {
    // Start a dedicated loopback server below.
  }
  const parsed = new URL(url);
  if (!parsed.port) throw new Error(`Unavailable loopback URL must include a port: ${url}`);
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, CABLESTER_PORT: parsed.port },
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
      if (response.ok) return { child, owned: true, output: () => output };
    } catch {
      // Wait for the server to listen.
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
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cablester-reference-browser-"));
  const profileDirectory = join(temporaryRoot, "profile");
  await mkdir(profileDirectory, { recursive: true });
  const child = spawn(executable, [
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
    `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  let exited = null;
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
  child.once("exit", (code, signal) => { exited = { code, signal }; });

  const activePortPath = join(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + 15_000;
  let port;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`Chrome exited before CDP startup (${JSON.stringify(exited)}): ${stderr.trim()}`);
    try {
      const [portLine] = (await readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      port = Number(portLine);
      if (Number.isFinite(port)) break;
    } catch {
      // Chrome has not exposed its debugging port yet.
    }
    await sleep(50);
  }
  if (!Number.isFinite(port)) {
    child.kill("SIGTERM");
    throw new Error(`Chrome did not expose CDP within 15 seconds: ${stderr.trim()}`);
  }
  return {
    child,
    port,
    temporaryRoot,
    stderr: () => stderr,
    async close() {
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolvePromise) => child.once("exit", resolvePromise)),
        sleep(2_000)
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
      const safePrefix = join(tmpdir(), "cablester-reference-browser-");
      if (!temporaryRoot.startsWith(safePrefix) || !basename(temporaryRoot).startsWith("cablester-reference-browser-")) {
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

  waitForEvent(method, predicate = () => true, timeoutMs = 20_000) {
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
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

function emptyDiagnostics() {
  return { exceptions: [], consoleErrors: [], consoleWarnings: [], logErrors: [], logWarnings: [], ignored: [] };
}

function attachDiagnostics(cdp, diagnostics, baseUrl) {
  cdp.on("Runtime.exceptionThrown", (event) => diagnostics.exceptions.push({
    text: event.exceptionDetails?.text || "exception",
    description: event.exceptionDetails?.exception?.description || null,
    url: event.exceptionDetails?.url || null,
    lineNumber: event.exceptionDetails?.lineNumber ?? null
  }));
  cdp.on("Runtime.consoleAPICalled", (event) => {
    const values = (event.args || []).map((argument) => argument.value ?? argument.description ?? argument.type);
    const record = { type: event.type, values };
    if (event.type === "error") diagnostics.consoleErrors.push(record);
    else if (event.type === "warning") diagnostics.consoleWarnings.push(record);
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    const record = {
      source: entry.source,
      text: entry.text,
      url: entry.url || null,
      lineNumber: entry.lineNumber ?? null
    };
    const optionalFavicon404 = entry.level === "error"
      && entry.source === "network"
      && entry.url === new URL("favicon.ico", baseUrl).href
      && /404/.test(entry.text);
    if (optionalFavicon404) diagnostics.ignored.push({ ...record, reason: "implicit optional favicon request" });
    else if (entry.level === "error") diagnostics.logErrors.push(record);
    else if (entry.level === "warning") diagnostics.logWarnings.push(record);
  });
}

export function diagnosticErrorOrWarningCount(diagnostics) {
  return diagnostics.exceptions.length
    + diagnostics.consoleErrors.length
    + diagnostics.consoleWarnings.length
    + diagnostics.logErrors.length
    + diagnostics.logWarnings.length;
}

function diagnosticMark(diagnostics) {
  return Object.fromEntries(Object.entries(diagnostics).map(([key, value]) => [key, value.length]));
}

function diagnosticDeltaCount(diagnostics, mark) {
  return Object.entries(diagnostics)
    .filter(([key]) => key !== "ignored")
    .reduce((sum, [key, value]) => sum + Math.max(0, value.length - (mark[key] || 0)), 0);
}

async function navigateAndReadIndex(cdp, url) {
  const loaded = cdp.waitForEvent("Page.loadEventFired", () => true, 30_000);
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Page.navigate", { url });
  await loaded;
  return pollPage(cdp, `(() => {
    const api = window.cablesterReference;
    const index = api?.library?.index;
    if (!api || !index || !document.querySelector(".reference-room-search")) return null;
    const collections = index.collections || [];
    const rooms = Object.values(index.rooms || {});
    const collectionRoomIds = collections.flatMap((collection) => collection.roomIds || []);
    return {
      roomCount: rooms.length,
      collectionCount: collections.length,
      collectionRoomCount: collectionRoomIds.length,
      uniqueCollectionRoomCount: new Set(collectionRoomIds).size,
      sequentialTransitions: collections.reduce((sum, collection) => sum + Math.max(0, (collection.roomIds || []).length - 1), 0),
      manifestConnections: rooms.reduce((sum, room) => sum + (room.connections || []).length, 0)
    };
  })()`, "production reference library index", 30_000);
}

async function runProductionAudit(cdp, definition, timeoutMs, onProgress = () => {}) {
  const invocation = await evaluate(cdp, `(() => {
    const api = window.cablesterReference;
    if (!api || typeof api.${definition.method} !== "function") throw new Error("Missing production reference audit API: ${definition.method}");
    if (api.loadAudit.running || api.acceptanceAudit.running || api.continuousAudit.running) {
      throw new Error("A reference browser audit is already running");
    }
    const tracker = { kind: ${JSON.stringify(definition.kind)}, done: false, error: null };
    window.__cablesterReferenceEvidenceAudit = tracker;
    const promise = api.${definition.method}();
    tracker.startedRunning = Boolean(api.${definition.state}.running);
    Promise.resolve(promise).then(
      () => { tracker.done = true; },
      (error) => {
        tracker.error = { message: String(error?.message || error), stack: error?.stack || null };
        tracker.done = true;
      }
    );
    return { startedRunning: tracker.startedRunning, state: api.${definition.state} };
  })()`);
  if (!invocation?.startedRunning) {
    throw new Error(`Production audit ${definition.method} returned without entering running=true`);
  }

  const deadline = Date.now() + timeoutMs;
  let lastProgressAt = 0;
  while (Date.now() < deadline) {
    const snapshot = await evaluate(cdp, `(() => ({
      tracker: window.__cablesterReferenceEvidenceAudit || null,
      state: window.cablesterReference?.${definition.state} || null
    }))()`);
    if (snapshot?.tracker?.error) {
      throw new Error(`${definition.method} rejected: ${snapshot.tracker.error.stack || snapshot.tracker.error.message}`);
    }
    if (snapshot?.tracker?.done && snapshot.state && snapshot.state.running === false) return snapshot.state;
    if (Date.now() - lastProgressAt >= 5_000) {
      onProgress(snapshot?.state || null);
      lastProgressAt = Date.now();
    }
    await sleep(200);
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${definition.method} running=false`);
}

function sameFingerprint(left, right) {
  return left?.algorithm === right?.algorithm
    && left?.value === right?.value
    && left?.fileCount === right?.fileCount
    && left?.roomFileCount === right?.roomFileCount
    && left?.runtimeFileCount === right?.runtimeFileCount;
}

function visitedRooms(continuous) {
  return (continuous.collections || []).reduce(
    (sum, collection) => sum + (collection.passed ? Number(collection.transitions || 0) + 1 : 0),
    0
  );
}

export function validateAuditResults({ index, load, acceptance, continuous, diagnostics, fingerprints = null }) {
  const failures = [];
  const equal = (code, actual, expected) => {
    if (actual !== expected) failures.push({ code, actual, expected });
  };
  equal("index.rooms", index?.roomCount, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("index.collectionRooms", index?.collectionRoomCount, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("index.uniqueCollectionRooms", index?.uniqueCollectionRoomCount, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("index.collections", index?.collectionCount, EXPECTED_REFERENCE_TOTALS.collections);
  equal("index.transitions", index?.sequentialTransitions, EXPECTED_REFERENCE_TOTALS.transitions);
  equal("index.manifestConnections", index?.manifestConnections, EXPECTED_REFERENCE_TOTALS.manifestConnections);

  equal("load.running", load?.running, false);
  equal("load.total", load?.total, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("load.completed", load?.completed, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("load.entrances", load?.entrances, EXPECTED_REFERENCE_TOTALS.entrances);
  equal("load.failures", load?.failures?.length, 0);

  equal("acceptance.running", acceptance?.running, false);
  equal("acceptance.total", acceptance?.total, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("acceptance.completed", acceptance?.completed, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("acceptance.entrances", acceptance?.entranceChecks, EXPECTED_REFERENCE_TOTALS.entrances);
  equal("acceptance.checkpoints", acceptance?.checkpointResetChecks, EXPECTED_REFERENCE_TOTALS.checkpoints);
  equal("acceptance.exits", acceptance?.connectionChecks, EXPECTED_REFERENCE_TOTALS.exits);
  equal("acceptance.mechanismCycles", acceptance?.mechanismCycles, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("acceptance.menuReentries", acceptance?.menuReentries, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("acceptance.renderedRooms", acceptance?.renderedRooms, EXPECTED_REFERENCE_TOTALS.rooms);
  equal("acceptance.finalCachedDocuments", acceptance?.finalCachedDocuments, 0);
  equal("acceptance.failures", acceptance?.failures?.length, 0);

  equal("continuous.running", continuous?.running, false);
  equal("continuous.totalCollections", continuous?.totalCollections, EXPECTED_REFERENCE_TOTALS.collections);
  equal("continuous.collectionsCompleted", continuous?.collectionsCompleted, EXPECTED_REFERENCE_TOTALS.collections);
  equal("continuous.collectionResults", continuous?.collections?.length, EXPECTED_REFERENCE_TOTALS.collections);
  equal("continuous.failedCollectionResults", continuous?.collections?.filter((item) => !item.passed).length, 0);
  equal("continuous.totalTransitions", continuous?.totalTransitions, EXPECTED_REFERENCE_TOTALS.transitions);
  equal("continuous.transitionsCompleted", continuous?.transitionsCompleted, EXPECTED_REFERENCE_TOTALS.transitions);
  equal("continuous.visitedRooms", visitedRooms(continuous || {}), EXPECTED_REFERENCE_TOTALS.rooms);
  equal("continuous.deathsOrResets", continuous?.deaths, 0);
  equal("continuous.failures", continuous?.failures?.length, 0);
  equal("diagnostics.errorsOrWarnings", diagnosticErrorOrWarningCount(diagnostics), 0);
  if (fingerprints) {
    equal("contentFingerprint.stable", sameFingerprint(fingerprints.before, fingerprints.after), true);
    equal("contentFingerprint.roomFileCount", fingerprints.after?.roomFileCount, EXPECTED_REFERENCE_TOTALS.rooms);
  }
  return failures;
}

function elapsedSeconds(state) {
  return Number((Number(state.elapsedMs || 0) / 1_000).toFixed(1));
}

function localIsoTimestamp(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

export function buildEvidenceDocuments({
  index,
  load,
  acceptance,
  continuous,
  contentFingerprint,
  environment,
  diagnosticDeltas = { load: 0, acceptance: 0, continuous: 0 },
  ranAt = localIsoTimestamp()
}) {
  const common = { schemaVersion: 1, ranAt, environment, contentFingerprint };
  return {
    load: {
      ...common,
      scope: {
        rooms: load.total,
        stepsPerRoom: [
          "fetch local JSON through the browser",
          "validate and compile the level document",
          "initialize the Game runtime at the default spawn and every authored entrance",
          "render at least one browser frame"
        ]
      },
      result: {
        passed: load.completed - load.failures.length,
        entrancesInitialized: load.entrances,
        failed: load.failures.length,
        elapsedSeconds: elapsedSeconds(load),
        freshConsoleErrorsOrWarnings: diagnosticDeltas.load
      },
      statusPolicy: {
        browserStatusUpgraded: false,
        reason: "A load sweep does not prove route completion, death/reset behavior, feel, fidelity, or chapter/area continuous play. Per-room browser and continuousRun statuses remain separate."
      }
    },
    acceptance: {
      ...common,
      scope: {
        rooms: acceptance.total,
        entrances: acceptance.entranceChecks,
        checkpoints: acceptance.checkpointResetChecks,
        authoredExitObjects: acceptance.connectionChecks,
        manifestCandidateConnectionsCoveredByGraphAudit: index.manifestConnections,
        menuReentries: acceptance.menuReentries
      },
      method: {
        surface: "Visible local browser page and the production Game runtime",
        perRoom: [
          "fetch, validate and compile the authoritative local JSON",
          "initialize every authored room entrance and verify the exact legal spawn",
          "initialize every checkpoint, perturb velocity/resources, invoke normal death timing, and fixed-step until respawn",
          "advance runtime mechanisms and verify finite, count-stable state plus death-reset moving-object policies",
          "resolve every authored exit to its real target room and target entrance and initialize that entrance",
          "render the room, return to the visible menu, clear that room cache, and fetch/compile/reenter it again"
        ],
        routeCompletionEvidence: "Physical input completion is not inferred here; it is provided separately by the fingerprint-matched continuous-run audit."
      },
      result: {
        passedRooms: acceptance.completed - acceptance.failures.length,
        failedRooms: acceptance.failures.length,
        entranceChecks: acceptance.entranceChecks,
        checkpointResetChecks: acceptance.checkpointResetChecks,
        connectionChecks: acceptance.connectionChecks,
        mechanismCycles: acceptance.mechanismCycles,
        menuReentries: acceptance.menuReentries,
        renderedRooms: acceptance.renderedRooms,
        peakActiveObjects: acceptance.peakActiveObjects,
        finalCachedDocuments: acceptance.finalCachedDocuments,
        elapsedSeconds: elapsedSeconds(acceptance),
        freshConsoleErrorsOrWarnings: diagnosticDeltas.acceptance
      },
      statusPolicy: {
        browserAndPlayableMayUpgrade: true,
        validationRequiresCombinedEvidence: true,
        humanConfirmation: "needed",
        reason: "This is deterministic engineering acceptance for every local whitebox. Subjective feel and original-game geometric comparison remain explicitly human-confirmation-needed and are not represented as automated facts."
      }
    },
    continuous: {
      ...common,
      scope: {
        collections: continuous.totalCollections,
        rooms: visitedRooms(continuous),
        sequentialTransitions: continuous.totalTransitions,
        routePolicy: "One manifest-ordered sequential main route per Celeste Side or Ori area. Optional and inferred side exits are outside this run."
      },
      method: {
        input: "Progress-sensitive Cablester movement input holds right and only jumps or dashes after a stall, wall contact, fall or liquid contact.",
        simulation: "The real Game fixed-step update, collision, damage/death reset, room state reset and asynchronous room-exit loader are used.",
        teleport: false,
        directStateMutation: false
      },
      result: {
        passedCollections: continuous.collectionsCompleted,
        visitedRooms: visitedRooms(continuous),
        transitionsCompleted: continuous.transitionsCompleted,
        deathsOrResets: continuous.deaths,
        failedCollections: continuous.failures.length,
        elapsedSeconds: elapsedSeconds(continuous),
        freshConsoleErrorsOrWarnings: diagnosticDeltas.continuous
      },
      statusPolicy: {
        continuousRunStatusUpgraded: true,
        browserStatusUpgraded: false,
        validationStatusUpgraded: false,
        reason: "This proves an automated main-route traversal through every collection on the fingerprinted build. It does not prove every side exit, human feel, original-coordinate fidelity, art fidelity or room-by-room manual browser acceptance."
      }
    }
  };
}

export async function writeEvidenceDocuments(outputDir, documents) {
  await mkdir(outputDir, { recursive: true });
  const staged = [];
  try {
    for (const [kind, filename] of Object.entries(EVIDENCE_FILENAMES)) {
      const target = join(outputDir, filename);
      const temporary = join(outputDir, `.${filename}.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(documents[kind], null, 2)}\n`, "utf8");
      staged.push({ target, temporary });
    }
    for (const item of staged) await rename(item.temporary, item.target);
  } finally {
    await Promise.all(staged.map((item) => unlink(item.temporary).catch(() => {})));
  }
  return Object.fromEntries(Object.entries(EVIDENCE_FILENAMES).map(([kind, filename]) => [kind, join(outputDir, filename)]));
}

function environmentSnapshot() {
  return {
    deviceProfile: "local-desktop-redacted",
    privacy: "Host name, processor, memory and operating-system details are intentionally omitted from repository evidence.",
    viewport: `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}`
  };
}

function progressText(kind, state) {
  if (!state) return `${kind}: waiting for state`;
  if (kind === "load" || kind === "acceptance") return `${kind}: ${state.completed}/${state.total}`;
  return `${kind}: ${state.collections?.length || 0}/${state.totalCollections} collections · ${state.transitionsCompleted}/${state.totalTransitions} transitions`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  let server;
  let chrome;
  let pageCdp;
  let diagnostics = null;
  try {
    server = await ensureServer(options.url);
    const chromeExecutable = await findChrome(options.chrome);
    const chromeVersion = await executableVersion(chromeExecutable);
    const fingerprintBefore = await referenceLibraryFingerprint(projectRoot);
    chrome = await launchChrome(chromeExecutable);
    pageCdp = await createPageConnection(chrome);
    diagnostics = emptyDiagnostics();
    await Promise.all([
      pageCdp.send("Page.enable"),
      pageCdp.send("Runtime.enable"),
      pageCdp.send("Network.enable"),
      pageCdp.send("Log.enable"),
      pageCdp.send("Emulation.setDeviceMetricsOverride", {
        width: DEFAULT_VIEWPORT.width,
        height: DEFAULT_VIEWPORT.height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: DEFAULT_VIEWPORT.width,
        screenHeight: DEFAULT_VIEWPORT.height
      })
    ]);
    attachDiagnostics(pageCdp, diagnostics, options.url);
    const index = await navigateAndReadIndex(pageCdp, options.url);

    const states = {};
    const diagnosticDeltas = {};
    for (const definition of AUDIT_DEFINITIONS) {
      const mark = diagnosticMark(diagnostics);
      console.log(`Starting production ${definition.method}…`);
      states[definition.kind] = await runProductionAudit(
        pageCdp,
        definition,
        options.timeoutMs,
        (state) => console.log(progressText(definition.kind, state))
      );
      diagnosticDeltas[definition.kind] = diagnosticDeltaCount(diagnostics, mark);
      console.log(`${progressText(definition.kind, states[definition.kind])} · complete`);
    }

    const fingerprintAfter = await referenceLibraryFingerprint(projectRoot);
    const failures = validateAuditResults({
      index,
      load: states.load,
      acceptance: states.acceptance,
      continuous: states.continuous,
      diagnostics,
      fingerprints: { before: fingerprintBefore, after: fingerprintAfter }
    });
    if (failures.length) {
      const detail = failures.map((failure) => `${failure.code}: ${JSON.stringify(failure.actual)} != ${JSON.stringify(failure.expected)}`).join("\n");
      const diagnosticDetail = diagnosticErrorOrWarningCount(diagnostics) ? `\nDiagnostics: ${JSON.stringify(diagnostics, null, 2)}` : "";
      throw new Error(`Reference browser evidence gates failed:\n${detail}${diagnosticDetail}`);
    }

    const documents = buildEvidenceDocuments({
      index,
      load: states.load,
      acceptance: states.acceptance,
      continuous: states.continuous,
      contentFingerprint: fingerprintAfter,
      environment: environmentSnapshot(),
      diagnosticDeltas
    });
    if (options.dryRun) {
      console.log(`Reference browser evidence PASS (dry-run) · ${chromeVersion}`);
    } else {
      const paths = await writeEvidenceDocuments(options.outputDir, documents);
      console.log(`Reference browser evidence PASS · ${chromeVersion}`);
      for (const path of Object.values(paths)) console.log(relative(projectRoot, path));
    }
  } catch (error) {
    if (diagnostics && diagnosticErrorOrWarningCount(diagnostics) > 0 && !String(error.message).includes("Diagnostics:")) {
      error.message = `${error.message}\nDiagnostics: ${JSON.stringify(diagnostics, null, 2)}`;
    }
    throw error;
  } finally {
    pageCdp?.close();
    await chrome?.close();
    await closeServer(server);
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(`Reference browser evidence ERROR · ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
