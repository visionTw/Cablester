import { Game } from "./game.js";
import { compileLevelDocument } from "./level-objects.js";
import { chunkToLevelDocument } from "./world-schema.js";
import { invertTransformChain } from "./world-streaming.js";

export const REPLAY_ACTIONS = Object.freeze([
  "move_left", "move_right", "move_up", "move_down", "jump", "dash",
  "rope", "hard_bar", "bash", "grab", "reset"
]);

const ACTION_KEYS = Object.freeze({
  move_left: "KeyA",
  move_right: "KeyD",
  move_up: "KeyW",
  move_down: "KeyS",
  jump: "Space",
  dash: "ControlLeft",
  rope: "KeyE",
  hard_bar: "KeyF",
  bash: "KeyQ",
  grab: "ShiftLeft",
  reset: "Backspace"
});

const CASE_TOLERANCE = Object.freeze({
  "movement-lab-01": "ropeTrajectoryRms",
  "hard-bar-lab": "hardBarLength",
  "bash-lab": "bashPosition",
  "double-jump-lab": "jumpApexHeight",
  "glide-lab": "glideHeight",
  "dash-lab": "dashPosition",
  "combined-horizontal": "runPosition",
  "combined-vertical": "wallMovementPosition",
  "combined-speed": "dashPosition",
  "combined-hazards": "wallMovementPosition"
});

const CASE_ACTION_REQUIREMENTS = Object.freeze({
  "movement-lab-01": { held: ["move_right"], pressed: ["rope"], released: ["rope"], minimumHoldTicks: { rope: 12 } },
  "hard-bar-lab": { pressed: ["hard_bar"] },
  "bash-lab": { pressed: ["bash"], released: ["bash"], minimumHoldTicks: { bash: 2 } },
  "double-jump-lab": { minimumPresses: { jump: 2 } },
  "glide-lab": { minimumHoldTicks: { jump: 30 } },
  "dash-lab": { pressed: ["dash"] },
  "combined-horizontal": { held: ["move_right"], pressed: ["jump", "rope", "dash"], released: ["rope"] },
  "combined-vertical": { held: ["move_right", "move_up"], pressed: ["jump", "rope"], released: ["rope"] },
  "combined-speed": { held: ["move_right"], pressed: ["rope", "dash"], released: ["rope"] },
  "combined-hazards": { held: ["move_right"], pressed: ["jump", "dash"] }
});

const CASE_MECHANISM_EVIDENCE = Object.freeze({
  "movement-lab-01": { mode: "rope", targetKey: "ropeTargets", targetIds: ["movement-lab-01:a01"] },
  "hard-bar-lab": { mode: "hardBar", targetKey: "hardBarTargets", targetIds: ["hard-bar-lab:hb-start:top"], requireLength: true },
  "bash-lab": { targetKey: "bashTargets", targetIds: ["bash-lab:bash-t0", "bash-lab:bash-t4"] },
  "double-jump-lab": { eventKey: "doubleJumpTicks" },
  "glide-lab": { eventKey: "glideTicks", secondaryEventKey: "windZoneTicks" },
  "dash-lab": { eventKey: "dashTicks" },
  "combined-speed": { mode: "rope", targetKey: "ropeTargets", targetIds: ["combined-speed:speed-a1"], eventKey: "dashTicks" },
  "combined-horizontal": { mode: "rope", targetKey: "ropeTargets", targetIds: ["combined-horizontal:hor-s1"], eventKey: "dashTicks" },
  "combined-vertical": { mode: "rope", targetKey: "ropeTargets", targetIds: ["combined-vertical:vert-a1"] },
  "combined-hazards": { eventKey: "hazardDamageTicks" }
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  const rounded = Math.round(Number(value) * 1_000_000) / 1_000_000;
  return Number.isInteger(rounded) ? Math.trunc(rounded) : rounded;
}

function sorted(values) {
  return [...new Set(values)].map(String).sort();
}

function sameMembers(left, right) {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function worldChunks(world) {
  return (world?.regions || []).flatMap((region) => (region.chunks || []).map((chunk) => ({ region, chunk })));
}

function findChunk(world, chunkId) {
  return worldChunks(world).find(({ chunk }) => chunk.id === chunkId) || null;
}

function replayMaximumTick(replay) {
  const finalFrameTick = replay.frames.length > 0 ? Number(replay.frames.at(-1).tick) : 0;
  const durationTick = Math.ceil(Number(replay.expectations?.maxDurationSeconds || 0) * 120);
  return Math.max(finalFrameTick, durationTick);
}

function actionStatistics(replay) {
  const maximumTick = replayMaximumTick(replay);
  const frames = replay.frames || [];
  const state = Object.fromEntries(REPLAY_ACTIONS.map((action) => [action, false]));
  const prior = { ...state };
  const stats = Object.fromEntries(REPLAY_ACTIONS.map((action) => [action, { presses: 0, releases: 0, heldTicks: 0 }]));
  let frameIndex = 0;
  for (let tick = 0; tick <= maximumTick; tick += 1) {
    while (frameIndex < frames.length && Number(frames[frameIndex].tick) === tick) {
      for (const action of REPLAY_ACTIONS) state[action] = Boolean(frames[frameIndex].actions?.[action]);
      frameIndex += 1;
    }
    for (const action of REPLAY_ACTIONS) {
      if (state[action] && !prior[action]) stats[action].presses += 1;
      if (!state[action] && prior[action]) stats[action].releases += 1;
      if (state[action]) stats[action].heldTicks += 1;
      prior[action] = state[action];
    }
  }
  return stats;
}

function actionCoverageAssertions(replay) {
  const caseId = replay.spawn?.chunkId;
  const requirements = CASE_ACTION_REQUIREMENTS[caseId] || {};
  const stats = actionStatistics(replay);
  const assertions = [];
  for (const action of requirements.held || []) {
    assertions.push({
      name: `replay.action.${action}.held`,
      ok: stats[action].heldTicks > 0,
      actual: stats[action].heldTicks,
      expected: "> 0",
      tolerance: "exact"
    });
  }
  for (const action of requirements.pressed || []) {
    assertions.push({
      name: `replay.action.${action}.pressed`,
      ok: stats[action].presses > 0,
      actual: stats[action].presses,
      expected: "> 0",
      tolerance: "exact"
    });
  }
  for (const action of requirements.released || []) {
    assertions.push({
      name: `replay.action.${action}.released`,
      ok: stats[action].releases > 0,
      actual: stats[action].releases,
      expected: "> 0",
      tolerance: "exact"
    });
  }
  for (const [action, minimum] of Object.entries(requirements.minimumPresses || {})) {
    assertions.push({
      name: `replay.action.${action}.presses`,
      ok: stats[action].presses >= minimum,
      actual: stats[action].presses,
      expected: `>= ${minimum}`,
      tolerance: "exact"
    });
  }
  for (const [action, minimum] of Object.entries(requirements.minimumHoldTicks || {})) {
    assertions.push({
      name: `replay.action.${action}.holdTicks`,
      ok: stats[action].heldTicks >= minimum,
      actual: stats[action].heldTicks,
      expected: `>= ${minimum}`,
      tolerance: "exact"
    });
  }
  return assertions;
}

export function validateFixedInputReplay(replay, world) {
  const errors = [];
  if (!replay || typeof replay !== "object" || Array.isArray(replay)) return ["Replay must be an object"];
  if (replay.replayVersion !== 1) errors.push("replayVersion must be 1");
  if (replay.worldId !== world?.manifest?.worldId) errors.push("Replay worldId does not match the world");
  if (replay.contentHash !== world?.manifest?.contentHash) errors.push("Replay contentHash does not match the world");
  if (replay.gameplayTuningVersion !== world?.manifest?.gameplayTuningVersion) errors.push("Replay gameplayTuningVersion does not match the world");
  if (Math.abs(Number(replay.fixedDelta) - 1 / 120) > 0.0000001) errors.push("Replay fixedDelta must equal 1/120");
  const chunkId = replay.spawn?.chunkId;
  if (!findChunk(world, chunkId)) errors.push(`Unknown replay spawn chunk: ${chunkId || "(missing)"}`);
  if (!Array.isArray(replay.frames)) {
    errors.push("Replay frames must be an array");
    return errors;
  }
  let priorTick = -1;
  for (const [index, frame] of replay.frames.entries()) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      errors.push(`frames[${index}] must be an object`);
      continue;
    }
    if (!Number.isInteger(frame.tick) || frame.tick < 0 || frame.tick <= priorTick) {
      errors.push(`frames[${index}].tick must be non-negative and strictly increasing`);
    }
    priorTick = Number(frame.tick);
    if (!frame.actions || typeof frame.actions !== "object" || Array.isArray(frame.actions)) {
      errors.push(`frames[${index}].actions must be an object`);
    } else {
      for (const [action, value] of Object.entries(frame.actions)) {
        if (!REPLAY_ACTIONS.includes(action)) errors.push(`frames[${index}] contains unknown action ${action}`);
        if (typeof value !== "boolean") errors.push(`frames[${index}].actions.${action} must be boolean`);
      }
    }
    if (frame.aim !== undefined && (!frame.aim || !finite(frame.aim.x) || !finite(frame.aim.y))) {
      errors.push(`frames[${index}].aim must contain finite x/y`);
    }
  }
  if (!replay.expectations || typeof replay.expectations !== "object" || Array.isArray(replay.expectations)) {
    errors.push("expectations must be an object");
  }
  return errors;
}

export class FixedReplayInput {
  constructor() {
    this.keys = new Set();
    this.keyPresses = new Set();
    this.keyReleases = new Set();
    this.mouse = { x: 0, y: 0, left: false };
    this.aimWorld = { x: 0, y: 0 };
    this.mousePresses = new Set();
    this.actions = Object.fromEntries(REPLAY_ACTIONS.map((action) => [action, false]));
  }

  applyFrame(frame) {
    const nextActions = Object.fromEntries(REPLAY_ACTIONS.map((action) => [action, Boolean(frame.actions?.[action])]));
    for (const action of REPLAY_ACTIONS) {
      const key = ACTION_KEYS[action];
      const wasHeld = this.actions[action];
      const held = nextActions[action];
      if (held && !wasHeld) this.keyPresses.add(key);
      if (!held && wasHeld) this.keyReleases.add(key);
      if (held) this.keys.add(key);
      else this.keys.delete(key);
    }
    if (nextActions.rope && !this.actions.rope) this.mousePresses.add("left");
    this.mouse.left = nextActions.rope;
    this.actions = nextActions;
    if (frame.aim) {
      this.aimWorld.x = Number(frame.aim.x);
      this.aimWorld.y = Number(frame.aim.y);
    }
  }

  down(...codes) {
    return codes.some((code) => this.keys.has(code));
  }

  pressed(...codes) {
    return codes.some((code) => this.keyPresses.has(code));
  }

  released(...codes) {
    return codes.some((code) => this.keyReleases.has(code));
  }

  mousePressed(button) {
    return this.mousePresses.has(button);
  }

  finishSimulationStep() {
    this.keyPresses.clear();
    this.keyReleases.clear();
    this.mousePresses.clear();
  }
}

function targetSnapshot(game, events) {
  const cooledBashTargets = game.runtime.bashTargets.filter((target) => target.cooldown > 0).map((target) => target.id);
  for (const id of cooledBashTargets) events.bashTargets.add(id);
  if (game.player.rope?.anchorId) events.ropeTargets.add(game.player.rope.anchorId);
  if (game.runtime.hardBar?.anchorId) events.hardBarTargets.add(game.runtime.hardBar.anchorId);
  if (game.runtime.goalReached && game.level.goal?.id) events.goals.add(game.level.goal.id);
  if (game.currentCheckpoint?.id) events.checkpoints.add(game.currentCheckpoint.id);
}

function sample(game, tick, chunkId) {
  return {
    tick,
    timeSeconds: tick / 120,
    chunkId,
    position: { x: round(game.player.x), y: round(game.player.y) },
    velocity: { x: round(game.player.vx), y: round(game.player.vy) },
    health: round(game.player.health),
    energy: round(game.player.energy),
    dashCharges: game.player.dashCharges,
    attachedMode: game.runtime.hardBar ? "hardBar" : game.isRopeAttached() ? "rope" : "",
    attachmentTargetId: game.runtime.hardBar?.anchorId || game.player.rope?.anchorId || "",
    attachmentLength: round(game.runtime.hardBar?.length || game.player.rope?.length || 0)
  };
}

export function runWebFixedInputReplay({ world, replay, sampleEveryTicks = 1 }) {
  const validationErrors = validateFixedInputReplay(replay, world);
  if (validationErrors.length > 0) throw new Error(validationErrors.join("\n"));
  const spawnChunkId = replay.spawn.chunkId;
  const match = findChunk(world, spawnChunkId);
  const level = compileLevelDocument(chunkToLevelDocument(world, match.region.id, spawnChunkId));
  const input = new FixedReplayInput();
  const game = new Game({}, input, [level], { autoFrame: false, preloadVisuals: false });
  const trajectory = [];
  const events = {
    bashTargets: new Set(), ropeTargets: new Set(), hardBarTargets: new Set(),
    goals: new Set(), exits: new Set(), checkpoints: new Set(),
    dashTicks: new Set(), doubleJumpTicks: new Set(), glideTicks: new Set(),
    windZoneTicks: new Set(), hazardDamageTicks: new Set(), deathTicks: new Set()
  };
  game.setRoomExitHandler((exit) => {
    events.exits.add(exit.id);
    game.runtime.transitioning = false;
  });
  let frameIndex = 0;
  let deaths = 0;
  let respawning = false;
  let previousDashCharges = game.player.dashCharges;
  let previousAirJumps = game.player.airJumps;
  let previousHealth = game.player.health;
  const maximumTick = replayMaximumTick(replay);
  for (let tick = 0; tick <= maximumTick; tick += 1) {
    while (frameIndex < replay.frames.length && replay.frames[frameIndex].tick === tick) {
      input.applyFrame(replay.frames[frameIndex]);
      frameIndex += 1;
    }
    const screenAim = game.worldToScreen(input.aimWorld.x, input.aimWorld.y);
    input.mouse.x = screenAim.x;
    input.mouse.y = screenAim.y;
    game.update(replay.fixedDelta);
    if (game.player.dashCharges < previousDashCharges) events.dashTicks.add(tick);
    if (game.player.airJumps < previousAirJumps) events.doubleJumpTicks.add(tick);
    if (game.player.gliding) events.glideTicks.add(tick);
    if (game.player.wind) events.windZoneTicks.add(tick);
    if (game.player.health < previousHealth) events.hazardDamageTicks.add(tick);
    if (!respawning && game.player.respawnTimer > 0) {
      deaths += 1;
      events.deathTicks.add(tick);
    }
    respawning = game.player.respawnTimer > 0;
    previousDashCharges = game.player.dashCharges;
    previousAirJumps = game.player.airJumps;
    previousHealth = game.player.health;
    targetSnapshot(game, events);
    if (tick % sampleEveryTicks === 0) trajectory.push(sample(game, tick, spawnChunkId));
    input.finishSimulationStep();
  }
  const finalState = {
    abilities: Object.fromEntries(sorted(game.abilities).map((id) => [id, true])),
    flags: Object.fromEntries(sorted(game.runtime.flags).map((id) => [id, true])),
    checkpoint: {
      chunkId: spawnChunkId,
      id: game.currentCheckpoint?.id || "",
      position: clone(game.currentCheckpoint?.spawn || { x: game.player.x, y: game.player.y })
    }
  };
  return {
    telemetryVersion: 1,
    runtime: "web",
    worldId: world.manifest.worldId,
    sourceContentHash: world.manifest.contentHash,
    gameplayTuningVersion: world.manifest.gameplayTuningVersion,
    fixedPhysicsHz: 120,
    trajectorySampleEveryTicks: sampleEveryTicks,
    replaySlug: spawnChunkId,
    counters: { physicsTicks: maximumTick + 1, deaths },
    trajectory,
    visitedChunks: [spawnChunkId],
    deaths,
    finalPosition: { x: round(game.player.x), y: round(game.player.y) },
    finalResources: {
      health: round(game.player.health),
      energy: round(game.player.energy),
      dashCharges: game.player.dashCharges,
      airJumps: game.player.airJumps
    },
    finalState,
    targetState: Object.fromEntries(Object.entries(events).map(([key, value]) => [key, sorted(value)])),
    expectations: clone(replay.expectations || {})
  };
}

function localizeGodotPoint(world, chunkId, point) {
  const match = findChunk(world, chunkId);
  if (!match) return { x: Number(point?.x), y: Number(point?.y) };
  return invertTransformChain(
    { x: Number(point?.x), y: Number(point?.y) },
    [match.region.transform, match.chunk.transform]
  );
}

function localizeGodotVector(world, chunkId, vector) {
  const match = findChunk(world, chunkId);
  if (!match) return { x: Number(vector?.x), y: Number(vector?.y) };
  const transforms = [match.region.transform, match.chunk.transform];
  const origin = invertTransformChain({ x: 0, y: 0 }, transforms);
  const endpoint = invertTransformChain(
    { x: Number(vector?.x), y: Number(vector?.y) },
    transforms
  );
  return { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
}

function localizeGodotSample(world, entry) {
  const match = findChunk(world, entry.chunkId);
  return {
    ...entry,
    position: match ? localizeGodotPoint(world, entry.chunkId, entry.position) : clone(entry.position),
    velocity: match ? localizeGodotVector(world, entry.chunkId, entry.velocity) : clone(entry.velocity)
  };
}

function samplesAtGlobalTickOffset(webTrajectory, godotTrajectory, tickOffset) {
  const webByTick = new Map(webTrajectory.map((entry) => [Number(entry.tick), entry]));
  const webTicks = webTrajectory.map((entry) => Number(entry.tick)).filter(Number.isFinite);
  const minimumWebTick = Math.min(...webTicks);
  const maximumWebTick = Math.max(...webTicks);
  const pairs = [];
  let eligibleGodotSamples = 0;
  for (const godot of godotTrajectory) {
    const webTick = Number(godot.tick) + tickOffset;
    if (webTick >= minimumWebTick && webTick <= maximumWebTick) eligibleGodotSamples += 1;
    const web = webByTick.get(webTick);
    if (web) pairs.push({ web, godot });
  }
  return { pairs, eligibleGodotSamples };
}

function metricsForPairs(pairs, webTrajectory, godotTrajectory) {
  const distances = pairs.map(({ web, godot }) => Math.hypot(web.position.x - godot.position.x, web.position.y - godot.position.y));
  const horizontal = pairs.map(({ web, godot }) => Math.abs(web.position.x - godot.position.x));
  const vertical = pairs.map(({ web, godot }) => Math.abs(web.position.y - godot.position.y));
  const attachmentLengthErrors = pairs
    .filter(({ web, godot }) => web.attachedMode && web.attachedMode === godot.attachedMode
      && finite(web.attachmentLength) && finite(godot.attachmentLength))
    .map(({ web, godot }) => Math.abs(Number(web.attachmentLength) - Number(godot.attachmentLength)));
  const rms = distances.length > 0 ? Math.sqrt(distances.reduce((sum, value) => sum + value * value, 0) / distances.length) : Infinity;
  const webMinY = Math.min(...webTrajectory.map((entry) => entry.position.y));
  const godotMinY = Math.min(...godotTrajectory.map((entry) => entry.position.y));
  return {
    samplePairs: pairs.length,
    trajectoryRms: round(rms),
    maximumPositionError: round(Math.max(0, ...distances)),
    finalHorizontalError: round(horizontal.at(-1) ?? Infinity),
    finalVerticalError: round(vertical.at(-1) ?? Infinity),
    apexHeightError: round(Math.abs(webMinY - godotMinY)),
    attachmentLengthSamples: attachmentLengthErrors.length,
    attachmentLengthError: round(Math.max(0, ...attachmentLengthErrors))
  };
}

function calibrationError(pairs) {
  const firstDynamicPair = pairs.find(({ godot }) => Number(godot.tick) > 0);
  if (!firstDynamicPair) return Infinity;
  const { web, godot } = firstDynamicPair;
  const positionError = Math.hypot(web.position.x - godot.position.x, web.position.y - godot.position.y);
  const velocityError = Math.hypot(
    Number(web.velocity?.x || 0) - Number(godot.velocity?.x || 0),
    Number(web.velocity?.y || 0) - Number(godot.velocity?.y || 0)
  ) / 120;
  return round(positionError + velocityError);
}

function trajectoryMetrics(world, webTelemetry, godotTelemetry, tickTolerance) {
  const webTrajectory = webTelemetry.trajectory || [];
  const godotTrajectory = (godotTelemetry.trajectory || []).map((entry) => localizeGodotSample(world, entry));
  const maximumOffset = Math.max(0, Math.floor(Math.abs(tickTolerance)));
  const candidates = [];
  for (let tickOffset = -maximumOffset; tickOffset <= maximumOffset; tickOffset += 1) {
    const { pairs, eligibleGodotSamples } = samplesAtGlobalTickOffset(webTrajectory, godotTrajectory, tickOffset);
    const metrics = metricsForPairs(pairs, webTrajectory, godotTrajectory);
    candidates.push({
      ...metrics,
      tickOffset,
      calibrationError: calibrationError(pairs),
      eligibleGodotSamples,
      completeInteriorCoverage: pairs.length === eligibleGodotSamples
    });
  }
  candidates.sort((left, right) => {
    if (left.completeInteriorCoverage !== right.completeInteriorCoverage) return left.completeInteriorCoverage ? -1 : 1;
    if (left.calibrationError !== right.calibrationError) return left.calibrationError - right.calibrationError;
    if (left.samplePairs !== right.samplePairs) return right.samplePairs - left.samplePairs;
    return Math.abs(left.tickOffset) - Math.abs(right.tickOffset);
  });
  const selected = candidates[0] || {
    ...metricsForPairs([], webTrajectory, godotTrajectory),
    tickOffset: null,
    calibrationError: Infinity,
    eligibleGodotSamples: 0,
    completeInteriorCoverage: false
  };
  return {
    ...selected,
    webSamples: webTrajectory.length,
    godotSamples: godotTrajectory.length,
    tickOffsetConvention: "webTick = godotTick + tickOffset"
  };
}

function resourceAssertions(web, godot, exact) {
  const assertions = [];
  for (const key of ["health", "energy", "dashCharges", "airJumps"]) {
    const left = Number(web?.[key]);
    const right = Number(godot?.[key]);
    const tolerance = exact ? 0.000001 : key === "energy" ? 0.01 : 0;
    assertions.push({
      name: `resource.${key}`,
      ok: finite(left) && finite(right) && Math.abs(left - right) <= tolerance,
      actual: left,
      expected: right,
      tolerance
    });
  }
  return assertions;
}

function targetAssertions(world, replay, webTelemetry, godotTelemetry, exactTargetIds) {
  if (!exactTargetIds) return [];
  const startingAbilities = new Set(findChunk(world, replay.spawn?.chunkId)?.chunk?.gameplay?.startingAbilities || []);
  const actions = actionStatistics(replay);
  const checks = [];
  for (const [action, ability, key] of [["rope", "rope", "ropeTargets"], ["hard_bar", "hardBar", "hardBarTargets"], ["bash", "bash", "bashTargets"]]) {
    if (!startingAbilities.has(ability) || actions[action].presses === 0) continue;
    const actual = sorted(webTelemetry.targetState?.[key] || []);
    const expectedValue = godotTelemetry.targetState?.[key];
    const available = Array.isArray(expectedValue);
    const expected = sorted(expectedValue || []);
    checks.push({
      name: `targetIds.${key}.available`,
      ok: available,
      actual: available ? "available" : "missing",
      expected: "available",
      tolerance: "exact"
    });
    checks.push({
      name: `targetIds.${key}.exact`,
      ok: available && sameMembers(actual, expected),
      actual,
      expected,
      tolerance: "exact"
    });
  }
  return checks;
}

function trueStateIds(value) {
  return sorted(Object.entries(value || {}).filter(([, enabled]) => Boolean(enabled)).map(([id]) => id));
}

function observedTargetIds(telemetry, key, scalarKeys = []) {
  const ids = Array.isArray(telemetry.targetState?.[key]) ? [...telemetry.targetState[key]] : [];
  for (const scalarKey of scalarKeys) {
    if (telemetry[scalarKey]) ids.push(String(telemetry[scalarKey]));
  }
  return sorted(ids);
}

function expectedPositionSpec(expectations) {
  const value = expectations.finalPosition;
  if (!value || typeof value !== "object" || !finite(value.x) || !finite(value.y)) return null;
  const tolerance = finite(value.tolerance)
    ? Number(value.tolerance)
    : finite(expectations.finalPositionTolerance)
      ? Number(expectations.finalPositionTolerance)
      : 0;
  return { x: Number(value.x), y: Number(value.y), tolerance };
}

function telemetryFinalPosition(world, replay, telemetry, runtimeLabel) {
  const position = telemetry.finalPosition || telemetry.finalPlayer?.position;
  if (!position) return null;
  if (runtimeLabel === "web") return { x: Number(position.x), y: Number(position.y) };
  const chunkId = telemetry.trajectory?.at(-1)?.chunkId
    || telemetry.finalState?.checkpoint?.chunkId
    || replay.spawn?.chunkId;
  return localizeGodotPoint(world, chunkId, position);
}

function expectationAssertions(world, replay, telemetry, runtimeLabel) {
  const expected = replay.expectations || {};
  const prefix = `${runtimeLabel}.expectations`;
  const assertions = [];
  const outcomeKeys = Object.keys(expected).filter((key) => key !== "maxDurationSeconds" && key !== "finalPositionTolerance");
  const supported = new Set([
    "goalId", "exitId", "checkpointId", "flags", "abilities", "visitedChunks", "maxDeaths",
    "finalPosition", "finalResources", "targetState"
  ]);
  const unknown = outcomeKeys.filter((key) => !supported.has(key));
  assertions.push({
    name: `${prefix}.outcomeDeclared`,
    ok: outcomeKeys.length > 0,
    actual: outcomeKeys,
    expected: "at least one outcome beyond maxDurationSeconds",
    tolerance: "exact"
  });
  assertions.push({
    name: `${prefix}.keysSupported`,
    ok: unknown.length === 0,
    actual: unknown,
    expected: [],
    tolerance: "exact"
  });

  if (expected.goalId !== undefined) {
    const actual = observedTargetIds(telemetry, "goals", ["lastGoalId", "finalGoalId"]);
    assertions.push({ name: `${prefix}.goalId`, ok: actual.includes(String(expected.goalId)), actual, expected: String(expected.goalId), tolerance: "exact" });
  }
  if (expected.exitId !== undefined) {
    const actual = observedTargetIds(telemetry, "exits", ["lastExitId", "finalExitId"]);
    assertions.push({ name: `${prefix}.exitId`, ok: actual.includes(String(expected.exitId)), actual, expected: String(expected.exitId), tolerance: "exact" });
  }
  if (expected.checkpointId !== undefined) {
    const actual = String(telemetry.finalState?.checkpoint?.id || telemetry.finalPlayer?.checkpointId || "");
    assertions.push({ name: `${prefix}.checkpointId`, ok: actual === String(expected.checkpointId), actual, expected: String(expected.checkpointId), tolerance: "exact" });
  }
  for (const [key, source] of [["flags", telemetry.finalState?.flags], ["abilities", telemetry.finalState?.abilities]]) {
    if (expected[key] === undefined) continue;
    const expectedIds = sorted(expected[key]);
    const actualIds = trueStateIds(source);
    const missing = expectedIds.filter((id) => !actualIds.includes(id));
    assertions.push({ name: `${prefix}.${key}`, ok: missing.length === 0, actual: actualIds, expected: expectedIds, tolerance: "contains" });
  }
  if (expected.visitedChunks !== undefined) {
    const expectedIds = sorted(expected.visitedChunks);
    const actualIds = sorted(telemetry.visitedChunks || telemetry.finalState?.visitedChunks || []);
    const missing = expectedIds.filter((id) => !actualIds.includes(id));
    assertions.push({ name: `${prefix}.visitedChunks`, ok: missing.length === 0, actual: actualIds, expected: expectedIds, tolerance: "contains" });
  }
  if (expected.maxDeaths !== undefined) {
    const actual = Number(telemetry.deaths ?? telemetry.counters?.deaths);
    assertions.push({ name: `${prefix}.maxDeaths`, ok: Number.isFinite(actual) && actual <= Number(expected.maxDeaths), actual, expected: `<= ${expected.maxDeaths}`, tolerance: 0 });
  }
  const position = expectedPositionSpec(expected);
  if (expected.finalPosition !== undefined) {
    const actual = telemetryFinalPosition(world, replay, telemetry, runtimeLabel);
    const distance = actual && position ? Math.hypot(actual.x - position.x, actual.y - position.y) : Infinity;
    assertions.push({
      name: `${prefix}.finalPosition`,
      ok: Boolean(position) && finite(distance) && distance <= position.tolerance,
      actual: actual ? { x: round(actual.x), y: round(actual.y), distance: round(distance) } : "missing",
      expected: position || "finite {x,y}",
      tolerance: position?.tolerance ?? 0
    });
  }
  if (expected.finalResources !== undefined) {
    for (const [key, expectedValue] of Object.entries(expected.finalResources || {})) {
      const actual = Number(telemetry.finalResources?.[key]);
      assertions.push({
        name: `${prefix}.finalResources.${key}`,
        ok: finite(actual) && Math.abs(actual - Number(expectedValue)) <= 0.000001,
        actual,
        expected: Number(expectedValue),
        tolerance: 0.000001
      });
    }
  }
  if (expected.targetState !== undefined) {
    for (const [key, expectedIdsValue] of Object.entries(expected.targetState || {})) {
      const actual = sorted(telemetry.targetState?.[key] || []);
      const expectedIds = sorted(expectedIdsValue);
      assertions.push({ name: `${prefix}.targetState.${key}`, ok: sameMembers(actual, expectedIds), actual, expected: expectedIds, tolerance: "exact" });
    }
  }
  return assertions;
}

function caseMechanismAssertions(replay, telemetry, runtimeLabel) {
  const evidence = CASE_MECHANISM_EVIDENCE[replay.spawn?.chunkId];
  if (!evidence) return [];
  const prefix = `${runtimeLabel}.mechanism`;
  const assertions = [];
  if (evidence.targetKey) {
    const targetValue = telemetry.targetState?.[evidence.targetKey];
    const targets = sorted(targetValue || []);
    assertions.push({
      name: `${prefix}.${evidence.targetKey}`,
      ok: Array.isArray(targetValue) && sameMembers(targets, evidence.targetIds),
      actual: Array.isArray(targetValue) ? targets : "missing",
      expected: evidence.targetIds,
      tolerance: "exact"
    });
  }
  if (evidence.mode) {
    const samples = (telemetry.trajectory || []).filter((entry) => entry.attachedMode === evidence.mode);
    assertions.push({
      name: `${prefix}.${evidence.mode}.samples`,
      ok: samples.length > 0,
      actual: samples.length,
      expected: "> 0",
      tolerance: "exact"
    });
    const wrongTargets = samples
      .map((entry) => entry.attachmentTargetId)
      .filter((id) => id && !evidence.targetIds.includes(id));
    assertions.push({
      name: `${prefix}.${evidence.mode}.targetSamples`,
      ok: samples.length > 0 && wrongTargets.length === 0
        && samples.some((entry) => evidence.targetIds.includes(entry.attachmentTargetId)),
      actual: sorted(samples.map((entry) => entry.attachmentTargetId).filter(Boolean)),
      expected: evidence.targetIds,
      tolerance: "exact"
    });
    if (evidence.requireLength) {
      const lengths = samples.map((entry) => Number(entry.attachmentLength)).filter(Number.isFinite);
      assertions.push({
        name: `${prefix}.${evidence.mode}.lengthSamples`,
        ok: lengths.length === samples.length && lengths.every((value) => value > 0),
        actual: lengths.length,
        expected: samples.length,
        tolerance: "finite positive"
      });
    }
  }
  for (const eventKey of [evidence.eventKey, evidence.secondaryEventKey].filter(Boolean)) {
    const value = telemetry.targetState?.[eventKey];
    assertions.push({
      name: `${prefix}.${eventKey}`,
      ok: Array.isArray(value) && value.length > 0,
      actual: Array.isArray(value) ? value.length : "missing",
      expected: "> 0",
      tolerance: "exact"
    });
  }
  return assertions;
}

export function evaluateWebReplayMechanism({ world, replay, telemetry }) {
  const assertions = [
    {
      name: "web.identity.contentHash",
      ok: telemetry.sourceContentHash === replay.contentHash && replay.contentHash === world.manifest.contentHash,
      actual: telemetry.sourceContentHash,
      expected: world.manifest.contentHash,
      tolerance: "exact"
    },
    ...actionCoverageAssertions(replay),
    ...caseMechanismAssertions(replay, telemetry, "web"),
    ...expectationAssertions(world, replay, telemetry, "web")
  ];
  return { ok: assertions.every((assertion) => assertion.ok), assertions };
}

export function compareWebGodotTelemetry({ world, replay, webTelemetry, godotTelemetry }) {
  const caseId = replay.spawn.chunkId;
  const tolerances = world.gameplayTuning?.approved?.tolerances || {};
  const tickTolerance = Number(tolerances.tick ?? 0);
  const metric = trajectoryMetrics(world, webTelemetry, godotTelemetry, tickTolerance);
  const toleranceKey = CASE_TOLERANCE[caseId] || "runPosition";
  const positionTolerance = Number(tolerances[toleranceKey]);
  const usesApex = ["jumpApexHeight", "glideHeight"].includes(toleranceKey);
  const measured = usesApex
    ? metric.apexHeightError
    : toleranceKey === "wallMovementPosition"
      ? metric.finalVerticalError
      : toleranceKey === "hardBarLength"
        ? (metric.attachmentLengthSamples > 0 ? metric.attachmentLengthError : Infinity)
        : toleranceKey === "ropeTrajectoryRms"
          ? metric.trajectoryRms
          : metric.finalHorizontalError;
  const assertions = [
    {
      name: "identity.contentHash",
      ok: webTelemetry.sourceContentHash === godotTelemetry.sourceContentHash && webTelemetry.sourceContentHash === replay.contentHash,
      actual: webTelemetry.sourceContentHash,
      expected: godotTelemetry.sourceContentHash,
      tolerance: "exact"
    },
    {
      name: "identity.gameplayTuningVersion",
      ok: webTelemetry.gameplayTuningVersion === godotTelemetry.gameplayTuningVersion,
      actual: webTelemetry.gameplayTuningVersion,
      expected: godotTelemetry.gameplayTuningVersion,
      tolerance: "exact"
    },
    ...actionCoverageAssertions(replay),
    ...caseMechanismAssertions(replay, webTelemetry, "web"),
    ...caseMechanismAssertions(replay, godotTelemetry, "godot"),
    ...expectationAssertions(world, replay, webTelemetry, "web"),
    ...expectationAssertions(world, replay, godotTelemetry, "godot"),
    {
      name: `trajectory.${toleranceKey}`,
      ok: metric.samplePairs > 0 && finite(positionTolerance) && measured <= positionTolerance,
      actual: finite(measured) ? measured : "unavailable",
      expected: 0,
      tolerance: positionTolerance
    },
    {
      name: "trajectory.tickOffset",
      ok: Number.isInteger(metric.tickOffset) && Math.abs(metric.tickOffset) <= tickTolerance,
      actual: metric.tickOffset,
      expected: 0,
      tolerance: tickTolerance
    },
    {
      name: "trajectory.webFixedTickSamples",
      ok: Number(webTelemetry.trajectorySampleEveryTicks) === 1
        && webTelemetry.trajectory.length === Number(webTelemetry.counters?.physicsTicks),
      actual: {
        sampleEveryTicks: webTelemetry.trajectorySampleEveryTicks,
        samples: webTelemetry.trajectory.length
      },
      expected: { sampleEveryTicks: 1, samples: Number(webTelemetry.counters?.physicsTicks) },
      tolerance: "exact"
    },
    {
      name: "trajectory.samples",
      ok: metric.completeInteriorCoverage
        && metric.samplePairs === metric.eligibleGodotSamples
        && metric.eligibleGodotSamples >= Math.max(0, metric.godotSamples - Math.abs(metric.tickOffset || 0)),
      actual: metric.samplePairs,
      expected: metric.eligibleGodotSamples,
      tolerance: tickTolerance
    },
    ...resourceAssertions(webTelemetry.finalResources, godotTelemetry.finalResources, tolerances.exactResources === true),
    ...targetAssertions(world, replay, webTelemetry, godotTelemetry, tolerances.exactTargetIds === true),
    {
      name: "state.abilities",
      ok: sameMembers(Object.keys(webTelemetry.finalState?.abilities || {}).filter((id) => webTelemetry.finalState.abilities[id]), Object.keys(godotTelemetry.finalState?.abilities || {}).filter((id) => godotTelemetry.finalState.abilities[id])),
      actual: sorted(Object.keys(webTelemetry.finalState?.abilities || {}).filter((id) => webTelemetry.finalState.abilities[id])),
      expected: sorted(Object.keys(godotTelemetry.finalState?.abilities || {}).filter((id) => godotTelemetry.finalState.abilities[id])),
      tolerance: "exact"
    },
    {
      name: "state.checkpointId",
      ok: String(webTelemetry.finalState?.checkpoint?.id || "") === String(godotTelemetry.finalState?.checkpoint?.id || ""),
      actual: webTelemetry.finalState?.checkpoint?.id || "",
      expected: godotTelemetry.finalState?.checkpoint?.id || "",
      tolerance: "exact"
    },
    {
      name: "replay.physicsTicks",
      ok: finite(Number(webTelemetry.counters.physicsTicks)) && finite(Number(godotTelemetry.counters?.physicsTicks))
        && Math.abs(Number(webTelemetry.counters.physicsTicks) - Number(godotTelemetry.counters?.physicsTicks)) <= tickTolerance,
      actual: webTelemetry.counters.physicsTicks,
      expected: godotTelemetry.counters?.physicsTicks,
      tolerance: Number(tolerances.tick ?? 0)
    }
  ];
  return {
    caseId,
    toleranceKey,
    positionTolerance,
    metrics: metric,
    assertions,
    ok: assertions.every((assertion) => assertion.ok)
  };
}
