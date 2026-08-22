import test from "node:test";
import assert from "node:assert/strict";
import {
  createGlideCueState,
  createSignCueState,
  createWindCueState,
  glideWingPose,
  resolveWindCue,
  signCuePresentation,
  updateGlideCueState,
  updateSignCueState,
  updateWindCueState
} from "../src/experience-cues.js";

test("wind cue maps four canonical directions and preserves arbitrary vectors", () => {
  assert.equal(resolveWindCue(0, -520).direction, "up");
  assert.equal(resolveWindCue(0, 520).direction, "down");
  assert.equal(resolveWindCue(-520, 0).direction, "left");
  assert.equal(resolveWindCue(520, 0).direction, "right");
  const diagonal = resolveWindCue(300, -400);
  assert.equal(diagonal.direction, "vector");
  assert.equal(diagonal.strength, 500);
  assert.equal(resolveWindCue(0, 0).direction, "calm");
});

test("wind lifecycle exposes entry, stable inside, exit, and idle", () => {
  const cue = createWindCueState();
  updateWindCueState(cue, true, 1 / 120);
  assert.equal(cue.state, "inside");
  updateWindCueState(cue, false, 1 / 120);
  assert.equal(cue.state, "exiting");
  updateWindCueState(cue, false, 1);
  assert.equal(cue.state, "idle");
});

test("glide cue is driven by unlocked and real gliding state, not input", () => {
  const cue = createGlideCueState();
  updateGlideCueState(cue, { unlocked: false, gliding: true, grounded: false }, 1 / 60);
  assert.equal(cue.state, "locked");
  assert.equal(cue.blend, 0);
  updateGlideCueState(cue, { unlocked: true, gliding: false, grounded: false }, 1 / 60);
  assert.equal(cue.state, "ready");
  updateGlideCueState(cue, { unlocked: true, gliding: true, grounded: false, facing: -1, gravity: { x: 1, y: 0 } }, 1 / 60);
  assert.equal(cue.state, "opening");
  assert.ok(cue.blend > 0);
  for (let index = 0; index < 36; index += 1) updateGlideCueState(cue, { unlocked: true, gliding: true, grounded: false, facing: -1, gravity: { x: 1, y: 0 } }, 1 / 60);
  assert.equal(cue.state, "gliding");
  const pose = glideWingPose(cue, 1);
  assert.deepEqual(pose.tangent, { x: 0, y: -1 });
  assert.equal(pose.facing, -1);
  updateGlideCueState(cue, { unlocked: true, gliding: false, grounded: false }, 1 / 60);
  assert.equal(cue.state, "closing");
  updateGlideCueState(cue, { unlocked: true, gliding: false, grounded: true }, 1 / 60);
  assert.equal(cue.state, "ready");
  assert.equal(cue.blend, 0);
});

test("sign cue follows distance, one-shot completion, progress, and disabled state", () => {
  const properties = { nearbyRadius: 140, activationRadius: 48, oneShot: true, completionFlag: "tutorial-seen" };
  const cue = createSignCueState();
  updateSignCueState(cue, properties, { distance: 200, flags: new Set() }, 1 / 60);
  assert.equal(cue.state, "idle");
  updateSignCueState(cue, properties, { distance: 100, flags: new Set() }, 1 / 60);
  assert.equal(cue.state, "nearby");
  updateSignCueState(cue, properties, { distance: 30, flags: new Set() }, 1 / 60);
  assert.equal(cue.state, "activated");
  updateSignCueState(cue, properties, { distance: 70, flags: new Set() }, 1 / 60);
  assert.equal(cue.state, "completed");

  const progressCue = createSignCueState();
  updateSignCueState(progressCue, properties, { distance: 500, flags: new Set(["tutorial-seen"]) }, 1 / 60);
  assert.equal(progressCue.state, "completed");
  const disabledCue = createSignCueState();
  updateSignCueState(disabledCue, { ...properties, disabled: true }, { distance: 1, flags: new Set() }, 1 / 60);
  assert.equal(disabledCue.state, "disabled");
});

test("reduced motion preserves sign meaning without position or scale animation", () => {
  const cue = createSignCueState();
  cue.state = "activated";
  cue.elapsed = 0.31;
  const presentation = signCuePresentation(cue, { reducedMotion: true });
  assert.equal(presentation.offsetY, 0);
  assert.equal(presentation.scale, 1);
  assert.equal(presentation.interactive, true);
});

