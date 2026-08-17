import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalFileString,
  composeTransforms,
  computeContentHash,
  computeContentHashSync,
  normalizeCanonicalNumber,
  normalizeCanonicalValue,
  serializeWorldPackage,
  stableStringify,
  transformBounds,
  transformPoint
} from "../src/world-hash.js";
import { migrateToWorldPackage } from "../src/world-schema.js";
import { createBlankLevelDocument } from "../src/level-objects.js";

test("canonical values sort keys, preserve arrays, round to six decimals, and remove negative zero", () => {
  const input = {
    z: -0,
    a: [3, { z: 1.23456789, a: -0 }],
    middle: true
  };
  assert.equal(stableStringify(input), '{"a":[3,{"a":0,"z":1.234568}],"middle":true,"z":0}');
  assert.deepEqual(input, { z: -0, a: [3, { z: 1.23456789, a: -0 }], middle: true });
  assert.equal(normalizeCanonicalNumber(-0), 0);
  assert.equal(normalizeCanonicalNumber(0.00000049), 0);
  assert.equal(normalizeCanonicalNumber(0.00000051), 0.000001);
  assert.throws(() => normalizeCanonicalValue({ invalid: Number.NaN }), /finite/);
  assert.throws(() => normalizeCanonicalValue({ invalid: Number.POSITIVE_INFINITY }), /finite/);
  assert.throws(() => normalizeCanonicalValue({ invalid: undefined }), /undefined/);
});

test("canonical file JSON has two-space indentation and exactly one trailing newline", () => {
  const file = canonicalFileString({ z: 2, a: 1 });
  assert.equal(file, '{\n  "a": 1,\n  "z": 2\n}\n');
});

test("clockwise +Y-down transforms compose deterministically", () => {
  assert.deepEqual(transformPoint({
    position: { x: 10, y: 20 },
    rotationDegrees: 90,
    scale: { x: 2, y: 3 }
  }, { x: 4, y: 2 }), { x: 4, y: 28 });

  const composed = composeTransforms({
    position: { x: 100, y: 50 },
    rotationDegrees: 90,
    scale: { x: 2, y: 2 }
  }, {
    position: { x: 10, y: 5 },
    rotationDegrees: 15,
    scale: { x: 0.5, y: 3 }
  });
  assert.deepEqual(composed, {
    position: { x: 90, y: 70 },
    rotationDegrees: 105,
    scale: { x: 1, y: 6 }
  });
  assert.deepEqual(transformBounds({
    position: { x: 10, y: 20 },
    rotationDegrees: 90,
    scale: { x: 1, y: 1 }
  }, { x: 0, y: 0, w: 40, h: 10 }), { x: 0, y: 20, w: 10, h: 40 });
});

test("content hash is SHA-256 over stable JSON with a blank declared hash", async () => {
  const world = migrateToWorldPackage(createBlankLevelDocument("Hash Fixture"));
  const original = structuredClone(world);
  const expectedBytes = stableStringify({
    ...world,
    manifest: { ...world.manifest, contentHash: "" }
  });
  const expected = `sha256:${createHash("sha256").update(new TextEncoder().encode(expectedBytes)).digest("hex")}`;
  assert.equal(await computeContentHash(world), expected);
  assert.equal(computeContentHashSync(world), expected);
  world.manifest.contentHash = "sha256:" + "f".repeat(64);
  assert.equal(await computeContentHash(world), expected, "declared hash must not hash itself");
  assert.equal(computeContentHashSync(world), expected);
  assert.deepEqual(original.manifest.contentHash, "");
});

test("serialization normalizes, seals, and remains byte-for-byte deterministic", async () => {
  const world = migrateToWorldPackage(createBlankLevelDocument("Serialize Fixture"));
  world.regions[0].transform.position.x = -0;
  world.regions[0].chunks[0].objects[0].transform.position.x = 1.23456789;
  const first = await serializeWorldPackage(world);
  const second = await serializeWorldPackage(structuredClone(world));
  assert.equal(first, second);
  assert.equal(first.endsWith("\n"), true);
  assert.equal(first.endsWith("\n\n"), false);
  const parsed = JSON.parse(first);
  assert.equal(parsed.regions[0].transform.position.x, 0);
  assert.equal(parsed.regions[0].chunks[0].objects[0].transform.position.x, 1.234568);
  assert.equal(parsed.manifest.contentHash, await computeContentHash(parsed));
  assert.equal(world.manifest.contentHash, "", "serialization must not mutate its input");
});
