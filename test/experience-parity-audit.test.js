import assert from "node:assert/strict";
import test from "node:test";

import { validateEvidenceSequences } from "../scripts/audit-experience-parity.mjs";

const player = { radius: 18 };
const trajectory = { position: { x: 10, y: 20 }, velocity: { x: 30, y: 40 }, grounded: false, gliding: false, distanceTravelled: 0 };
const collision = { radius: 18, shapeClass: "Circle", collisionObjects: [] };
const invariants = () => ({ trajectoryBefore: structuredClone(trajectory), trajectoryAfter: structuredClone(trajectory), collisionBefore: structuredClone(collision), collisionAfter: structuredClone(collision), trajectoryUnchanged: true, collisionUnchanged: true });
const signCollision = () => ({ memberships: {}, solidEntryCount: 0, blockingSurfaceIds: [] });
const roiRegions = {
	glide: [{ x: 500, y: 270, w: 280, h: 220 }],
	wind: [{ x: 480, y: 170, w: 320, h: 380 }],
	sign: [{ x: 480, y: 230, w: 320, h: 125 }],
};
const targetRoi = (cueId, hash) => ({ algorithm: "masked-rgba8-png-sha256-v1", canvas: { width: 1280, height: 720 }, regions: structuredClone(roiRegions[cueId]), sha256: `target-${hash}` });
const cue = (state, checkpoint, hash, reducedMotion = false, cueId = "sign") => ({
	checkpoint,
	frame: { sha256: hash, targetRoi: targetRoi(cueId, hash) },
	runtime: {
	  player,
	  cue: { state },
	  reducedMotion,
	  invariants: invariants(),
	  sign: { collision: signCollision(), overlapsPlayer: false, overlapsHud: false, insideViewportSafeArea: true, presentation: { offsetY: 0, scale: 1 } },
	},
});
const windVector = {
	up: { forceX: 0, forceY: -520, x: 0, y: -1, strength: 520, direction: "up" },
	right: { forceX: 520, forceY: 0, x: 1, y: 0, strength: 520, direction: "right" },
	down: { forceX: 0, forceY: 520, x: 0, y: 1, strength: 520, direction: "down" },
	left: { forceX: -520, forceY: 0, x: -1, y: 0, strength: 520, direction: "left" },
};
const wind = (lifecycle, checkpoint, hash, activeDirection = null) => ({
	checkpoint,
	frame: { sha256: hash, targetRoi: targetRoi("wind", hash) },
  runtime: {
    player,
    cues: ["up", "right", "down", "left"].map((direction) => ({
      id: `wind-${direction}`,
	  ...windVector[direction],
      lifecycle: direction === activeDirection ? "inside" : direction === "right" ? lifecycle : "idle",
    })),
	vectorProbe: { forceX: 300, forceY: -400, x: 0.6, y: -0.8, strength: 500, direction: "vector" },
	invariants: invariants(),
  },
});

function passingSequences() {
  return {
	glide: [
	  cue("ready", "before", "glide-before", false, "glide"), cue("opening", "activation", "glide-activation", false, "glide"), cue("opening", "mid-animation", "glide-mid", false, "glide"),
	  cue("gliding", "stable", "glide-stable", false, "glide"), cue("closing", "exit", "glide-exit", false, "glide"),
	],
	wind: [
	  wind("idle", "before", "wind-before"), wind("inside", "entry", "wind-entry", "right"), wind("inside", "mid-animation", "wind-mid", "right"),
	  wind("inside", "stable", "wind-stable", "right"), wind("exiting", "exit", "wind-exit"),
	  wind("idle", "direction-up", "wind-up", "up"), wind("idle", "direction-right", "wind-right", "right"),
	  wind("idle", "direction-down", "wind-down", "down"), wind("idle", "direction-left", "wind-left", "left"),
	],
	sign: [
	  cue("idle", "idle", "sign-idle"), cue("idle", "idle-mid-animation", "sign-idle-mid"), cue("nearby", "nearby", "sign-nearby"), cue("activated", "activated", "sign-activated"),
	  cue("activated", "activated-stable", "sign-stable"), cue("activated", "reduced-motion", "sign-reduced", true),
	  cue("completed", "completed", "sign-completed"), cue("disabled", "disabled", "sign-disabled"),
	],
  };
}

test("experience parity audit accepts complete lifecycle, direction, and collision evidence", () => {
  assert.deepEqual(validateEvidenceSequences(passingSequences()), []);
});

test("experience parity audit fails closed on lifecycle, direction, radius, and measured sign collision drift", () => {
  const sequences = passingSequences();
  sequences.glide[3].runtime.cue.state = "opening";
  sequences.wind[5].runtime.cues.find((entry) => entry.lifecycle === "inside").direction = "vector";
  sequences.sign[0].runtime.player = { radius: 22 };
	sequences.sign[1].runtime.sign.collision.solidEntryCount = 1;
	const codes = new Set(validateEvidenceSequences(sequences).map((entry) => entry.code));
	for (const expected of ["glide-lifecycle-mismatch", "wind-direction-mismatch", "wind-force-strength-drift", "collision-radius-drift", "sign-collision-semantic-drift"]) assert.ok(codes.has(expected));
});

test("experience parity audit rejects strength, arbitrary vector, invariant, target-static/background-changing frames, overlap, and reduced-motion false passes", () => {
	const sequences = passingSequences();
	sequences.wind[0].runtime.cues[0].strength = 1;
	sequences.wind[1].runtime.vectorProbe.x = 0.7;
	sequences.glide[0].runtime.invariants.trajectoryAfter.position.x = 11;
	sequences.glide[2].frame.targetRoi.sha256 = sequences.glide[1].frame.targetRoi.sha256;
	sequences.wind[2].frame.targetRoi.regions[0].x += 1;
	sequences.sign[1].runtime.sign.overlapsPlayer = true;
	sequences.sign[2].runtime.sign.overlapsHud = true;
	sequences.sign[3].runtime.sign.insideViewportSafeArea = false;
	sequences.sign[5].runtime.reducedMotion = false;
	const codes = new Set(validateEvidenceSequences(sequences).map((entry) => entry.code));
	for (const expected of ["wind-force-strength-drift", "wind-vector-probe-drift", "experience-runtime-invariant-drift", "experience-animation-frame-static", "experience-animation-roi-drift", "sign-prompt-player-overlap", "sign-prompt-hud-overlap", "sign-prompt-viewport-overflow", "sign-reduced-motion-missing"]) assert.ok(codes.has(expected));
});
