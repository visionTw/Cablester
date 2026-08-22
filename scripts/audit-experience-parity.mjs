#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createNetServer } from "node:net";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "http://127.0.0.1:4195/";
const DEFAULT_OUTPUT = join(PROJECT_ROOT, "artifacts", "web", "experience-parity");
const VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const LAB_PATH = "worlds/labs/cablester-experience-cues-lab.world.json";
const CUE_PLAN = Object.freeze({
  glide: Object.freeze(["before", "activation", "mid-animation", "stable", "exit"]),
  wind: Object.freeze(["before", "entry", "mid-animation", "stable", "exit", "direction-up", "direction-right", "direction-down", "direction-left"]),
  sign: Object.freeze(["idle", "idle-mid-animation", "nearby", "activated", "activated-stable", "reduced-motion", "completed", "disabled"]),
});
const TARGET_ROI_REGIONS = Object.freeze({
  glide: Object.freeze([{ x: 500, y: 270, w: 280, h: 220 }]),
  wind: Object.freeze([{ x: 480, y: 170, w: 320, h: 380 }]),
  sign: Object.freeze([{ x: 480, y: 230, w: 320, h: 125 }]),
});
const DYNAMIC_TARGET_PAIRS = Object.freeze({
  glide: Object.freeze([["activation", "mid-animation"]]),
  wind: Object.freeze([["entry", "mid-animation"]]),
  sign: Object.freeze([["idle", "idle-mid-animation"], ["activated", "activated-stable"]]),
});

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const slug = (value) => String(value).replaceAll(/[^A-Za-z0-9._-]+/g, "-");

export function validateEvidenceSequences(sequences) {
  const issues = [];
	const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	const near = (left, right, tolerance = 0.000001) => Math.abs(Number(left) - Number(right)) <= tolerance;
  const states = (cue) => (sequences[cue] || []).map((entry) => entry.runtime?.cue?.state || entry.runtime?.cues?.find((item) => item.id === "wind-right")?.lifecycle);
  const expected = {
    glide: ["ready", "opening", "opening", "gliding", "closing"],
	sign: ["idle", "idle", "nearby", "activated", "activated", "activated", "completed", "disabled"],
  };
  for (const cue of ["glide", "sign"]) {
    if (JSON.stringify(states(cue)) !== JSON.stringify(expected[cue])) issues.push({ code: `${cue}-lifecycle-mismatch`, expected: expected[cue], actual: states(cue) });
  }
  const wind = sequences.wind || [];
  const lifecycle = wind.slice(0, 5).map((entry) => entry.runtime.cues.find((item) => item.id === "wind-right")?.lifecycle);
  if (JSON.stringify(lifecycle) !== JSON.stringify(["idle", "inside", "inside", "inside", "exiting"])) issues.push({ code: "wind-lifecycle-mismatch", actual: lifecycle });
  const directions = wind.slice(5).map((entry) => entry.runtime.cues.find((item) => item.lifecycle === "inside")?.direction);
  if (JSON.stringify(directions) !== JSON.stringify(["up", "right", "down", "left"])) issues.push({ code: "wind-direction-mismatch", actual: directions });
	for (const entry of wind) {
	  for (const cueEntry of entry.runtime?.cues || []) {
		const expectedCue = ({
		  "wind-up": [0, -520, "up"], "wind-right": [520, 0, "right"],
		  "wind-down": [0, 520, "down"], "wind-left": [-520, 0, "left"],
		})[cueEntry.id];
		if (!expectedCue) continue;
		const expectedStrength = Math.hypot(expectedCue[0], expectedCue[1]);
		if (!near(cueEntry.forceX, expectedCue[0]) || !near(cueEntry.forceY, expectedCue[1]) || !near(cueEntry.strength, expectedStrength) || cueEntry.direction !== expectedCue[2]) {
		  issues.push({ code: "wind-force-strength-drift", checkpoint: entry.checkpoint, id: cueEntry.id, actual: cueEntry });
		}
	  }
	  const vector = entry.runtime?.vectorProbe;
	  if (!vector || vector.direction !== "vector" || !near(vector.forceX, 300) || !near(vector.forceY, -400) || !near(vector.x, 0.6) || !near(vector.y, -0.8) || !near(vector.strength, 500)) {
		issues.push({ code: "wind-vector-probe-drift", checkpoint: entry.checkpoint, actual: vector || null });
	  }
	}
  for (const entry of Object.values(sequences).flat()) {
    if (entry.runtime?.player?.radius !== 18) issues.push({ code: "collision-radius-drift", cue: entry.cue, checkpoint: entry.checkpoint, actual: entry.runtime?.player?.radius });
	const invariants = entry.runtime?.invariants;
	if (!invariants?.trajectoryUnchanged || !invariants?.collisionUnchanged || !equal(invariants.trajectoryBefore, invariants.trajectoryAfter) || !equal(invariants.collisionBefore, invariants.collisionAfter)) {
	  issues.push({ code: "experience-runtime-invariant-drift", cue: entry.cue, checkpoint: entry.checkpoint, actual: invariants || null });
	}
  }
	const signCollision = sequences.sign?.every((entry) => entry.runtime?.sign?.collision?.solidEntryCount === 0 && entry.runtime?.sign?.collision?.blockingSurfaceIds?.length === 0);
  if (!signCollision) issues.push({ code: "sign-collision-semantic-drift" });
	if (!sequences.sign?.every((entry) => entry.runtime?.sign?.overlapsPlayer === false)) issues.push({ code: "sign-prompt-player-overlap" });
	if (!sequences.sign?.every((entry) => entry.runtime?.sign?.overlapsHud === false)) issues.push({ code: "sign-prompt-hud-overlap" });
	if (!sequences.sign?.every((entry) => entry.runtime?.sign?.insideViewportSafeArea === true)) issues.push({ code: "sign-prompt-viewport-overflow" });
	const reduced = sequences.sign?.find((entry) => entry.checkpoint === "reduced-motion");
	if (!reduced?.runtime?.reducedMotion || reduced.runtime?.sign?.presentation?.offsetY !== 0 || reduced.runtime?.sign?.presentation?.scale !== 1 || reduced.runtime?.cue?.state !== "activated") {
	  issues.push({ code: "sign-reduced-motion-missing", actual: reduced || null });
	}
  for (const [cueId, pairs] of Object.entries(DYNAMIC_TARGET_PAIRS)) {
    for (const [firstId, secondId] of pairs) {
      const first = sequences[cueId]?.find((entry) => entry.checkpoint === firstId);
      const second = sequences[cueId]?.find((entry) => entry.checkpoint === secondId);
      const firstRoi = first?.frame?.targetRoi;
      const secondRoi = second?.frame?.targetRoi;
      const firstGeometry = firstRoi ? { algorithm: firstRoi.algorithm, canvas: firstRoi.canvas, logicalCanvas: firstRoi.logicalCanvas || null, regions: firstRoi.regions } : null;
      const secondGeometry = secondRoi ? { algorithm: secondRoi.algorithm, canvas: secondRoi.canvas, logicalCanvas: secondRoi.logicalCanvas || null, regions: secondRoi.regions } : null;
      if (!firstRoi?.sha256 || !secondRoi?.sha256 || firstRoi.sha256 === secondRoi.sha256) issues.push({ code: "experience-animation-frame-static", cue: cueId, checkpoints: [firstId, secondId] });
      if (!equal(firstGeometry, secondGeometry)) issues.push({ code: "experience-animation-roi-drift", cue: cueId, checkpoints: [firstId, secondId], first: firstGeometry, second: secondGeometry });
      if (!equal(first?.runtime?.invariants?.trajectoryBefore, second?.runtime?.invariants?.trajectoryBefore)) issues.push({ code: "experience-animation-checkpoint-drift", cue: cueId, checkpoints: [firstId, secondId] });
    }
  }
  return issues;
}

async function atomicWrite(target, value) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, target);
}

async function findBrowser(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate); return resolve(candidate); } catch { /* keep searching */ }
  }
  throw new Error("Chrome/Edge was not found; pass --browser PATH");
}

async function ensureServer(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) return { owned: false, child: null, url };
  } catch { /* start a dedicated loopback server */ }
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !parsed.port) throw new Error(`Refusing non-loopback audit server: ${url}`);
  const capability = randomBytes(32).toString("base64url");
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, CABLESTER_PORT: parsed.port, CABLESTER_REPOSITORY_CAPABILITY: capability },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-16000); });
  child.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-16000); });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Audit server exited ${child.exitCode}: ${output}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return { owned: true, child, url };
    } catch { /* wait */ }
    await sleep(50);
  }
  child.kill();
  throw new Error(`Audit server did not start: ${output}`);
}

async function stopOwned(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), sleep(2000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

class CDP {
  constructor(url) { this.url = url; this.socket = null; this.id = 1; this.pending = new Map(); }
  async open() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => rejectPromise(new Error("CDP connection timeout")), 10000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolvePromise(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); rejectPromise(new Error("CDP connection failed")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8"));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
    });
    return this;
  }
  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

async function launchBrowser(executable) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "cablester-experience-parity-"));
  const profile = join(temporaryRoot, "profile");
  await mkdir(profile, { recursive: true });
  const debuggingPort = await new Promise((resolvePromise, rejectPromise) => {
    const probe = createNetServer();
    probe.once("error", rejectPromise);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? rejectPromise(error) : resolvePromise(address.port));
    });
  });
  const child = spawn(executable, [
    "--headless", "--disable-gpu", `--remote-debugging-port=${debuggingPort}`, `--user-data-dir=${profile}`,
    "--remote-allow-origins=*", "--no-first-run", "--disable-background-networking",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16000); });
  let targets;
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error(`Browser exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      if (response.ok) { targets = await response.json(); break; }
    } catch { /* Edge may hand off to its long-lived headless child on Windows */ }
    await sleep(50);
  }
  if (!targets) throw new Error(`Browser did not expose CDP: ${stderr}`);
  const target = targets.find((entry) => entry.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Browser page target is missing");
  return {
    cdp: await new CDP(target.webSocketDebuggerUrl).open(), child, temporaryRoot,
    async close() {
      try { await this.cdp.send("Browser.close"); } catch { /* browser may already be closing */ }
      if (child.exitCode === null) child.kill();
      await Promise.race([new Promise((resolvePromise) => child.once("exit", resolvePromise)), sleep(2000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
      const expectedPrefix = join(tmpdir(), "cablester-experience-parity-");
      if (!temporaryRoot.startsWith(expectedPrefix) || !basename(temporaryRoot).startsWith("cablester-experience-parity-")) throw new Error(`Refusing unsafe temporary cleanup: ${temporaryRoot}`);
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Page evaluation failed");
  return response.result?.value;
}

async function waitFor(cdp, expression, label) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try { if (await evaluate(cdp, expression)) return; } catch { /* wait for modules */ }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function screenshot(cdp) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: true });
  return Buffer.from(result.data, "base64");
}

async function canvasScreenshot(cdp) {
	const dataUrl = await evaluate(cdp, "document.querySelector('#game').toDataURL('image/png')");
	if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) throw new Error("Game canvas did not return a PNG data URL");
	return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
}

async function canvasTargetRoiScreenshot(cdp, cue) {
  const regions = TARGET_ROI_REGIONS[cue];
  if (!regions) throw new Error(`Missing target ROI definition for ${cue}`);
  const result = await evaluate(cdp, `(()=>{const source=document.querySelector('#game');if(!source)throw new Error('Game canvas is missing');const logicalCanvas=${JSON.stringify(VIEWPORT)};const regions=${JSON.stringify(regions)};const scaleX=source.width/logicalCanvas.width;const scaleY=source.height/logicalCanvas.height;if(!Number.isFinite(scaleX)||!Number.isFinite(scaleY)||scaleX<=0||scaleY<=0||Math.abs(scaleX-scaleY)>0.002)throw new Error('Game canvas backing scale is invalid');const masked=document.createElement('canvas');masked.width=source.width;masked.height=source.height;const context=masked.getContext('2d',{alpha:true});context.clearRect(0,0,masked.width,masked.height);for(const region of regions){if(region.x<0||region.y<0||region.w<=0||region.h<=0||region.x+region.w>logicalCanvas.width||region.y+region.h>logicalCanvas.height)throw new Error('Target ROI is outside the logical game canvas');const pixel={x:region.x*scaleX,y:region.y*scaleY,w:region.w*scaleX,h:region.h*scaleY};context.drawImage(source,pixel.x,pixel.y,pixel.w,pixel.h,pixel.x,pixel.y,pixel.w,pixel.h);}return{canvas:{width:source.width,height:source.height},logicalCanvas,scale:scaleX,dataUrl:masked.toDataURL('image/png')};})()`);
  if (!result?.canvas?.width || !result?.canvas?.height || result?.logicalCanvas?.width !== VIEWPORT.width || result?.logicalCanvas?.height !== VIEWPORT.height) throw new Error(`Unexpected game canvas identity for ${cue}`);
  if (typeof result.dataUrl !== "string" || !result.dataUrl.startsWith("data:image/png;base64,")) throw new Error(`Target ROI for ${cue} did not return a PNG data URL`);
  return {
    algorithm: "masked-rgba8-png-sha256-v1",
    canvas: result.canvas,
    logicalCanvas: result.logicalCanvas,
    scale: result.scale,
    regions: regions.map((region) => ({ ...region })),
    png: Buffer.from(result.dataUrl.slice("data:image/png;base64,".length), "base64"),
  };
}

function escaped(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function captureContactSheet(cdp, cue, frames) {
  const columns = 3;
  const rows = Math.ceil(frames.length / columns);
  const width = 1440;
  const height = 88 + rows * 310;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const cards = frames.map((frame) => `<figure><img src="data:image/png;base64,${frame.png.toString("base64")}"><figcaption>${escaped(frame.checkpoint)} · ${escaped(frame.state.runtime?.cue?.state || frame.state.runtime?.cues?.find((entry) => entry.lifecycle === "inside")?.direction || "runtime")}</figcaption></figure>`).join("");
  await evaluate(cdp, `document.documentElement.innerHTML=${JSON.stringify(`<head><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#061018;color:#dff;font-family:system-ui}h1{margin:0 0 18px;font-size:28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0;padding:10px;background:#0c1d29;border:1px solid #315569;border-radius:12px}img{display:block;width:100%;height:250px;object-fit:cover;border-radius:7px}figcaption{padding-top:8px;font:600 14px ui-monospace,monospace}</style></head><body><h1>Cablester Web · ${escaped(cue)} · runtime sequence</h1><div class="grid">${cards}</div></body>`)}`);
  await sleep(100);
  return screenshot(cdp);
}

function parseArguments(argv) {
  const options = { url: DEFAULT_URL, output: DEFAULT_OUTPUT, browser: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--url" && value) options.url = new URL(value).href, index += 1;
    else if (argv[index] === "--output" && value) options.output = resolve(PROJECT_ROOT, value), index += 1;
    else if (argv[index] === "--browser" && value) options.browser = value, index += 1;
    else if (argv[index] === "--check") options.check = true;
    else throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
  }
  if (!resolve(options.output).startsWith(resolve(PROJECT_ROOT, "artifacts", "web", "experience-parity"))) throw new Error("Evidence output must remain under artifacts/web/experience-parity");
  return options;
}

export async function runExperienceParityAudit(options) {
  const [browserPath, labBytes] = await Promise.all([findBrowser(options.browser), readFile(join(PROJECT_ROOT, LAB_PATH))]);
  const server = await ensureServer(options.url);
  let browser = null;
  const files = [];
  const sequences = {};
  const frameSets = {};
  try {
    browser = await launchBrowser(browserPath);
    const { cdp } = browser;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.navigate", { url: options.url });
    await waitFor(cdp, "Boolean(window.cablester)", "Cablester runtime");
    await evaluate(cdp, `(async()=>{const world=await (await fetch('./${LAB_PATH}',{cache:'no-store'})).json();const schema=await import('./src/world-schema.js');const objects=await import('./src/level-objects.js');const doc=schema.chunkToLevelDocument(world,'experience-region','experience-cues-01');const level=objects.compileLevelDocument(doc);window.cablester.start(level);window.cablester.running=false;document.querySelector('#start-card')?.classList.add('is-hidden');const style=document.createElement('style');style.textContent='#start-card{display:none!important}#experience-evidence-label{position:fixed;z-index:9999;left:18px;top:18px;max-width:900px;overflow:hidden;padding:8px 12px;border:1px solid #74dce3;border-radius:8px;background:#031018e8;color:#e7ffff;font:700 13px ui-monospace,monospace;white-space:pre}';document.head.append(style);const label=document.createElement('div');label.id='experience-evidence-label';document.body.append(label);return {id:level.id,abilities:[...window.cablester.abilities]};})()`);
    for (const [cue, checkpoints] of Object.entries(CUE_PLAN)) {
      sequences[cue] = [];
      const frames = [];
      for (const checkpoint of checkpoints) {
        const state = await evaluate(cdp, `(()=>{const value=window.cablester.applyExperienceParityCheckpoint(${JSON.stringify(cue)},${JSON.stringify(checkpoint)});document.querySelector('#experience-evidence-label').textContent=${JSON.stringify(`WEB · ${cue} · ${checkpoint}`)}+'\\n'+JSON.stringify(value.runtime.cue||value.runtime.cues,null,0);return value})()`);
        await sleep(60);
        const png = await canvasScreenshot(cdp);
        const targetRoi = await canvasTargetRoiScreenshot(cdp, cue);
        const relativePath = `${cue}/${String(checkpoints.indexOf(checkpoint) + 1).padStart(2, "0")}-${slug(checkpoint)}.png`;
        const target = join(options.output, relativePath);
        await atomicWrite(target, png);
        files.push({ kind: "runtime-frame", cue, checkpoint, path: relative(PROJECT_ROOT, target).replaceAll("\\", "/"), bytes: png.length, sha256: sha256(png) });
        const targetRoiRelativePath = `${cue}/${String(checkpoints.indexOf(checkpoint) + 1).padStart(2, "0")}-${slug(checkpoint)}.target-roi.png`;
        const targetRoiPath = join(options.output, targetRoiRelativePath);
        await atomicWrite(targetRoiPath, targetRoi.png);
        files.push({ kind: "target-roi-frame", cue, checkpoint, path: relative(PROJECT_ROOT, targetRoiPath).replaceAll("\\", "/"), bytes: targetRoi.png.length, sha256: sha256(targetRoi.png) });
        state.frame = {
          path: relative(PROJECT_ROOT, target).replaceAll("\\", "/"),
          sha256: sha256(png),
          targetRoi: {
            algorithm: targetRoi.algorithm,
            canvas: targetRoi.canvas,
            logicalCanvas: targetRoi.logicalCanvas,
            scale: targetRoi.scale,
            regions: targetRoi.regions,
            path: relative(PROJECT_ROOT, targetRoiPath).replaceAll("\\", "/"),
            sha256: sha256(targetRoi.png),
          },
        };
        sequences[cue].push(state);
        frames.push({ checkpoint, state, png });
      }
      frameSets[cue] = frames;
    }
    for (const [cue, frames] of Object.entries(frameSets)) {
      const contact = await captureContactSheet(cdp, cue, frames);
      const contactTarget = join(options.output, cue, "contact-sheet.png");
      await atomicWrite(contactTarget, contact);
      files.push({ kind: "contact-sheet", cue, path: relative(PROJECT_ROOT, contactTarget).replaceAll("\\", "/"), bytes: contact.length, sha256: sha256(contact) });
    }
  } finally {
    if (browser) {
      await browser.close();
      browser.cdp.close();
    }
    await stopOwned(server.child);
  }
  const issues = validateEvidenceSequences(sequences);
  const dynamicFrameComparisons = Object.fromEntries(Object.entries(DYNAMIC_TARGET_PAIRS).map(([cue, pairs]) => [cue, pairs.map((checkpoints) => {
    const frames = checkpoints.map((checkpoint) => sequences[cue].find((entry) => entry.checkpoint === checkpoint));
    return {
      checkpoints,
      wholeFrameHashes: frames.map((entry) => entry?.frame?.sha256 || null),
      targetRoiHashes: frames.map((entry) => entry?.frame?.targetRoi?.sha256 || null),
      targetChanged: Boolean(frames[0]?.frame?.targetRoi?.sha256 && frames[1]?.frame?.targetRoi?.sha256 && frames[0].frame.targetRoi.sha256 !== frames[1].frame.targetRoi.sha256),
    };
  })]));
  const report = {
    schemaVersion: 1,
    kind: "cablester-web-experience-parity-evidence",
    status: issues.length ? "failed" : "passed",
    generatedAt: new Date().toISOString(),
    authority: { approvedExperience: "cablester_godot", publicRuntime: "cablester_web" },
    browser: browserPath,
    world: { path: LAB_PATH, contentHash: JSON.parse(labBytes).manifest.contentHash, bytesSha256: sha256(labBytes) },
    minimumFramesPerCue: 5,
    runtimeStateAttached: true,
    singleScreenshotSufficient: false,
    sequences,
	dynamicFrameComparisons,
    files,
    issues,
  };
  const reportPath = join(options.output, "report.json");
  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath, reportSha256: sha256(await readFile(reportPath)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runExperienceParityAudit(parseArguments(process.argv.slice(2))).then((report) => {
    console.log(JSON.stringify({ ok: report.status === "passed", report: report.reportPath, sha256: report.reportSha256, frames: report.files.filter((entry) => entry.kind === "runtime-frame").length, issues: report.issues }));
    process.exitCode = report.status === "passed" ? 0 : 1;
  }).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}
