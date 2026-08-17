import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

function allActions(overrides = {}) {
  return {
    move_left: false,
    move_right: false,
    move_up: false,
    move_down: false,
    jump: false,
    dash: false,
    rope: false,
    hard_bar: false,
    bash: false,
    grab: false,
    reset: false,
    ...overrides
  };
}

function autopilotFrames(maximumTick, {
  moveRight = true,
  jumpInterval = 84,
  jumpHoldTicks = 12,
  dashInterval = 210,
  dashOffset = 36,
  dashHoldTicks = 2,
  bashInterval = 330,
  bashOffset = 70,
  bashHoldTicks = 2,
  glideHoldTicks = 34,
  ropeWindows = [],
  hardBarPressTicks = [],
  aim = { x: 1000000, y: 500 },
  actionWindows = {},
  clearDefaultActions = []
} = {}) {
  const events = new Map();
  const state = allActions({ move_right: moveRight });
  const schedule = (tick, key, value) => {
    if (tick < 0 || tick > maximumTick) return;
    const changes = events.get(tick) || {};
    changes[key] = value;
    events.set(tick, changes);
  };
  events.set(0, { move_right: moveRight });
  if (!clearDefaultActions.includes("jump")) {
    for (let tick = 1; tick < maximumTick; tick += jumpInterval) {
      schedule(tick, "jump", true);
      schedule(tick + Math.max(jumpHoldTicks, glideHoldTicks), "jump", false);
    }
  }
  if (!clearDefaultActions.includes("dash")) {
    for (let tick = dashOffset; tick < maximumTick; tick += dashInterval) {
      schedule(tick, "dash", true);
      schedule(tick + dashHoldTicks, "dash", false);
    }
  }
  if (!clearDefaultActions.includes("bash")) {
    for (let tick = bashOffset; tick < maximumTick; tick += bashInterval) {
      schedule(tick, "bash", true);
      schedule(tick + bashHoldTicks, "bash", false);
    }
  }
  for (const window of ropeWindows) {
    schedule(Number(window.start), "rope", true);
    schedule(Number(window.end), "rope", false);
  }
  for (const tick of hardBarPressTicks) {
    schedule(Number(tick), "hard_bar", true);
    schedule(Number(tick) + 1, "hard_bar", false);
  }
  for (const [action, windows] of Object.entries(actionWindows)) {
    for (const window of windows) {
      schedule(Number(window.start), action, true);
      schedule(Number(window.end), action, false);
    }
  }
  const frames = [];
  for (const tick of [...events.keys()].sort((a, b) => a - b)) {
    Object.assign(state, events.get(tick));
    frames.push({
      tick,
      actions: structuredClone(state),
      aim: structuredClone(aim)
    });
  }
  if (frames.at(-1)?.tick !== maximumTick) {
    frames.push({ tick: maximumTick, actions: allActions(), aim: structuredClone(aim) });
  }
  return frames;
}

function replayFor(world, {
  spawnChunkId,
  maximumTick,
  expectations = {},
  autopilot = {}
}) {
  return {
    replayVersion: 1,
    worldId: world.manifest.worldId,
    contentHash: world.manifest.contentHash,
    gameplayTuningVersion: world.manifest.gameplayTuningVersion,
    fixedDelta: 1 / 120,
    spawn: { chunkId: spawnChunkId },
    frames: autopilotFrames(maximumTick, autopilot),
    expectations: {
      maxDurationSeconds: maximumTick / 120,
      ...expectations
    }
  };
}

async function writeJson(path, value) {
  const absolute = resolve(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(absolute, contents, "utf8");
  console.log(`${path} · ${Buffer.byteLength(contents)} bytes · ${value.frames.length} sparse frames`);
}

const [forest, labs] = await Promise.all([
  readJson("worlds/formal/first-forest.world.json"),
  readJson("worlds/labs/cablester-3c-labs.world.json")
]);

await writeJson("worlds/replays/first-forest-runtime-smoke.replay.json", replayFor(forest, {
  spawnChunkId: "seedgate-verge",
  maximumTick: 12000,
  expectations: {
    visitedChunks: ["seedgate-verge"],
    abilities: ["rope", "hardBar", "dash", "wallGrab"],
    maxDeaths: 80
  },
  autopilot: { jumpInterval: 72, jumpHoldTicks: 14, glideHoldTicks: 38, dashInterval: 180, bashInterval: 240 }
}));

const labChunks = labs.regions.flatMap((region) => region.chunks);
const labInputOverrides = {
  "movement-lab-01": {
    aim: { x: 530, y: 340 },
    ropeWindows: [{ start: 18, end: 86 }, { start: 150, end: 214 }]
  },
  "hard-bar-lab": {
    aim: { x: 390, y: 640 },
    hardBarPressTicks: [6]
  },
  "bash-lab": {
    aim: { x: 1000, y: 520 },
    bashOffset: 8,
    bashInterval: 180,
    bashHoldTicks: 14,
    clearDefaultActions: ["dash"]
  },
  "double-jump-lab": {
    clearDefaultActions: ["jump", "dash", "bash"],
    actionWindows: {
      jump: [{ start: 30, end: 38 }, { start: 50, end: 58 }]
    }
  },
  "glide-lab": {
    clearDefaultActions: ["jump", "dash", "bash"],
    actionWindows: { jump: [{ start: 1, end: 150 }, { start: 190, end: 310 }] }
  },
  "dash-lab": {
    clearDefaultActions: ["jump", "dash", "bash"],
    actionWindows: {
      jump: [{ start: 1, end: 12 }, { start: 150, end: 162 }, { start: 300, end: 312 }],
      dash: [{ start: 36, end: 38 }, { start: 186, end: 188 }, { start: 336, end: 338 }]
    }
  },
  "combined-speed": {
    aim: { x: 520, y: 270 },
    clearDefaultActions: ["jump", "dash", "bash"],
    ropeWindows: [{ start: 18, end: 86 }, { start: 150, end: 214 }],
    actionWindows: {
      jump: [{ start: 1, end: 12 }, { start: 110, end: 122 }, { start: 260, end: 272 }],
      dash: [{ start: 96, end: 98 }, { start: 246, end: 248 }]
    }
  },
  "combined-horizontal": {
    aim: { x: 560, y: 250 },
    clearDefaultActions: ["jump", "dash", "bash"],
    ropeWindows: [{ start: 18, end: 86 }, { start: 150, end: 214 }],
    actionWindows: {
      jump: [{ start: 1, end: 12 }, { start: 110, end: 122 }, { start: 260, end: 272 }],
      dash: [{ start: 96, end: 98 }, { start: 246, end: 248 }]
    }
  },
  "combined-vertical": {
    aim: { x: 370, y: 420 },
    clearDefaultActions: ["jump", "dash", "bash"],
    ropeWindows: [{ start: 18, end: 86 }],
    actionWindows: {
      jump: [{ start: 1, end: 12 }, { start: 96, end: 108 }, { start: 230, end: 242 }],
      move_up: [{ start: 24, end: 72 }, { start: 156, end: 204 }]
    }
  },
  "combined-hazards": {
    clearDefaultActions: ["jump", "dash", "bash"],
    actionWindows: {
      jump: [{ start: 1, end: 12 }, { start: 70, end: 82 }, { start: 150, end: 162 }, { start: 230, end: 242 }, { start: 310, end: 322 }],
      dash: [{ start: 36, end: 38 }, { start: 116, end: 118 }, { start: 196, end: 198 }, { start: 276, end: 278 }]
    }
  }
};
for (const chunk of labChunks) {
  await writeJson(`worlds/replays/labs/${chunk.id}.replay.json`, replayFor(labs, {
    spawnChunkId: chunk.id,
    maximumTick: 600,
    expectations: {
      visitedChunks: [chunk.id],
      abilities: [...(chunk.gameplay?.startingAbilities || [])],
      maxDeaths: 8
    },
    autopilot: {
      jumpInterval: chunk.id.includes("vertical") ? 54 : 78,
      jumpHoldTicks: chunk.id.includes("glide") ? 48 : 12,
      glideHoldTicks: chunk.id.includes("glide") ? 48 : 30,
      dashInterval: chunk.id.includes("dash") || chunk.id.includes("speed") ? 120 : 210,
      bashInterval: chunk.id.includes("bash") ? 120 : 300,
      ...(labInputOverrides[chunk.id] || {})
    }
  }));
}
