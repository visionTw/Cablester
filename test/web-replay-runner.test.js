import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  FixedReplayInput,
  compareWebGodotTelemetry,
  evaluateWebReplayMechanism,
  runWebFixedInputReplay,
  validateFixedInputReplay
} from "../src/web-replay-runner.js";
import { applyTransformChain } from "../src/world-streaming.js";

async function json(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

const worldPromise = json("../worlds/labs/cablester-3c-labs.world.json");

function addMovementRopeCycle(replay) {
  for (const frame of replay.frames) {
    frame.actions.rope = frame.tick < 31;
  }
  return replay;
}

test("fixed replay input treats every sparse frame as a complete held state", () => {
  const input = new FixedReplayInput();
  input.applyFrame({ actions: { move_right: true, jump: true }, aim: { x: 42, y: 17 } });
  assert.equal(input.down("KeyD"), true);
  assert.equal(input.pressed("KeyD"), true);
  assert.equal(input.pressed("Space"), true);
  assert.deepEqual(input.aimWorld, { x: 42, y: 17 });
  assert.deepEqual(input.mouse, { x: 0, y: 0, left: false });
  input.finishSimulationStep();
  assert.equal(input.pressed("KeyD"), false);

  input.applyFrame({ actions: { jump: true } });
  assert.equal(input.down("KeyD"), false);
  assert.equal(input.released("KeyD"), true);
  assert.equal(input.down("Space"), true);
  assert.equal(input.pressed("Space"), false);
});

test("replay validation rejects identity drift and unknown actions", async () => {
  const world = await worldPromise;
  const replay = await json("../worlds/replays/labs/movement-lab-01.replay.json");
  replay.expectations.visitedChunks = ["movement-lab-01"];
  const invalid = structuredClone(replay);
  invalid.contentHash = "sha256:stale";
  invalid.frames[0].actions.teleport = true;
  const errors = validateFixedInputReplay(invalid, world);
  assert.ok(errors.some((error) => error.includes("contentHash")));
  assert.ok(errors.some((error) => error.includes("unknown action teleport")));
});

test("Web runner executes the real Game update path at fixed 1/120", async () => {
  const world = await worldPromise;
  const replay = await json("../worlds/replays/labs/movement-lab-01.replay.json");
  const telemetry = runWebFixedInputReplay({ world, replay });
  assert.equal(telemetry.runtime, "web");
  assert.equal(telemetry.fixedPhysicsHz, 120);
  assert.equal(telemetry.counters.physicsTicks, 601);
  assert.equal(telemetry.trajectory.length, 601);
  assert.equal(telemetry.trajectory[0].tick, 0);
  assert.equal(telemetry.trajectory.at(-1).tick, 600);
  assert.ok(Number.isFinite(telemetry.finalPosition.x));
  assert.ok(Number.isFinite(telemetry.finalResources.energy));
  assert.deepEqual(telemetry.visitedChunks, ["movement-lab-01"]);
});

test("comparer applies canonical trajectory, exact resource, state, and tick assertions", async () => {
  const world = await worldPromise;
  const replay = addMovementRopeCycle(await json("../worlds/replays/labs/movement-lab-01.replay.json"));
  replay.expectations.visitedChunks = ["movement-lab-01"];
  const web = runWebFixedInputReplay({ world, replay });
  const godot = structuredClone(web);
  delete godot.runtime;
  const comparison = compareWebGodotTelemetry({ world, replay, webTelemetry: web, godotTelemetry: godot });
  assert.equal(comparison.toleranceKey, "ropeTrajectoryRms");
  assert.equal(comparison.positionTolerance, world.gameplayTuning.approved.tolerances.ropeTrajectoryRms);
  assert.equal(comparison.ok, true, JSON.stringify(comparison.assertions.filter((entry) => !entry.ok), null, 2));
  assert.ok(comparison.assertions.some((entry) => entry.name === "resource.energy"));
  assert.ok(comparison.assertions.some((entry) => entry.name === "state.abilities"));
  assert.ok(comparison.assertions.some((entry) => entry.name === "replay.physicsTicks"));
});

test("comparer applies one global canonical tick offset to dense 120 Hz Web samples", async () => {
  const world = await worldPromise;
  const replay = await json("../worlds/replays/labs/movement-lab-01.replay.json");
  const web = runWebFixedInputReplay({ world, replay });
  const godot = structuredClone(web);
  godot.trajectory = web.trajectory
    .filter((entry) => entry.tick % 6 === 0 && entry.tick > 0)
    .map((entry) => ({ ...structuredClone(web.trajectory[entry.tick - 1]), tick: entry.tick }));
  const comparison = compareWebGodotTelemetry({ world, replay, webTelemetry: web, godotTelemetry: godot });
  assert.equal(comparison.metrics.tickOffset, -1);
  assert.equal(comparison.metrics.tickOffsetConvention, "webTick = godotTick + tickOffset");
  assert.equal(comparison.metrics.samplePairs, godot.trajectory.length);
  assert.equal(comparison.assertions.find((entry) => entry.name === "trajectory.tickOffset").ok, true);
  assert.equal(comparison.assertions.find((entry) => entry.name === "trajectory.samples").ok, true);
});

test("hard-bar case cannot pass if its action cycle is removed", async () => {
  const world = await worldPromise;
  const replay = await json("../worlds/replays/labs/hard-bar-lab.replay.json");
  for (const frame of replay.frames) frame.actions.hard_bar = false;
  const web = runWebFixedInputReplay({ world, replay });
  const comparison = compareWebGodotTelemetry({
    world,
    replay,
    webTelemetry: web,
    godotTelemetry: structuredClone(web)
  });
  assert.equal(comparison.ok, false);
  const coverage = comparison.assertions.find((entry) => entry.name === "replay.action.hard_bar.pressed");
  assert.deepEqual(coverage, {
    name: "replay.action.hard_bar.pressed",
    ok: false,
    actual: 0,
    expected: "> 0",
    tolerance: "exact"
  });
});

test("expectations are asserted on both runtimes and Godot positions use the full inverse transform chain", async () => {
  const world = structuredClone(await worldPromise);
  const replay = addMovementRopeCycle(await json("../worlds/replays/labs/movement-lab-01.replay.json"));
  const web = runWebFixedInputReplay({ world, replay });
  const chunk = world.regions[0].chunks.find((entry) => entry.id === "movement-lab-01");
  world.regions[0].transform = { position: { x: 700, y: -240 }, rotationDegrees: 17, scale: { x: 1.1, y: 0.9 } };
  chunk.transform = { position: { x: 130, y: 80 }, rotationDegrees: -8, scale: { x: 0.85, y: 1.2 } };
  web.finalState.flags["test-flag"] = true;
  web.targetState.goals = ["test-goal"];
  web.targetState.exits = ["test-exit"];
  replay.expectations = {
    maxDurationSeconds: 5,
    goalId: "test-goal",
    exitId: "test-exit",
    checkpointId: web.finalState.checkpoint.id,
    flags: ["test-flag"],
    abilities: Object.keys(web.finalState.abilities),
    visitedChunks: ["movement-lab-01"],
    maxDeaths: web.deaths,
    finalPosition: { ...web.finalPosition, tolerance: 0.00001 },
    finalResources: structuredClone(web.finalResources),
    targetState: { goals: ["test-goal"], exits: ["test-exit"] }
  };
  const transforms = [world.regions[0].transform, chunk.transform];
  const godot = structuredClone(web);
  godot.trajectory = godot.trajectory.map((entry) => ({
    ...entry,
    position: applyTransformChain(entry.position, transforms),
    velocity: (() => {
      const origin = applyTransformChain({ x: 0, y: 0 }, transforms);
      const endpoint = applyTransformChain(entry.velocity, transforms);
      return { x: endpoint.x - origin.x, y: endpoint.y - origin.y };
    })()
  }));
  godot.finalPosition = applyTransformChain(godot.finalPosition, transforms);
  const comparison = compareWebGodotTelemetry({ world, replay, webTelemetry: web, godotTelemetry: godot });
  assert.equal(comparison.ok, true, JSON.stringify(comparison.assertions.filter((entry) => !entry.ok), null, 2));
  for (const runtime of ["web", "godot"]) {
    for (const suffix of [
      "goalId", "exitId", "checkpointId", "flags", "abilities", "visitedChunks",
      "maxDeaths", "finalPosition", "finalResources.health", "targetState.goals"
    ]) {
      assert.ok(comparison.assertions.some((entry) => entry.name === `${runtime}.expectations.${suffix}`), `${runtime}.${suffix}`);
    }
  }
  const drifted = structuredClone(godot);
  drifted.finalResources.health -= 1;
  const failed = compareWebGodotTelemetry({ world, replay, webTelemetry: web, godotTelemetry: drifted });
  assert.equal(failed.ok, false);
  assert.equal(failed.assertions.find((entry) => entry.name === "godot.expectations.finalResources.health").ok, false);
});

test("all ten generated lab replays trigger their nominal Web mechanism", async () => {
  const world = await worldPromise;
  for (const chunk of world.regions.flatMap((region) => region.chunks)) {
    const replay = await json(`../worlds/replays/labs/${chunk.id}.replay.json`);
    const telemetry = runWebFixedInputReplay({ world, replay });
    const result = evaluateWebReplayMechanism({ world, replay, telemetry });
    assert.equal(result.ok, true, `${chunk.id}: ${JSON.stringify(result.assertions.filter((entry) => !entry.ok), null, 2)}`);
  }
});
