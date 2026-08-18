import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serializeWorldPackage, validateWorldPackage } from "../src/world-schema.js";

const SHOWCASE_WORLD_URL = new URL("../worlds/labs/cablester-composite-showcase.world.json", import.meta.url);

test("public composite showcase is sealed, deterministic, large, and covers every registered type", async () => {
  const committed = await readFile(SHOWCASE_WORLD_URL, "utf8");
  const world = JSON.parse(committed);
  assert.equal(await serializeWorldPackage(world), committed);
  assert.equal(world.manifest.namespace, "labs");
  assert.equal(world.manifest.worldId, "cablester-composite-showcase");
  assert.equal(world.regions.flatMap((region) => region.chunks).length, 12);
  assert.deepEqual(validateWorldPackage(world), []);

  const registered = new Set(world.typeRegistry.entries.map((entry) => entry.id));
  const represented = new Set(world.regions
    .flatMap((region) => region.chunks)
    .flatMap((chunk) => chunk.objects)
    .map((object) => object.type));
  assert.deepEqual([...registered].filter((type) => !represented.has(type)), []);
  assert.ok([...represented].every((type) => registered.has(type)));
  assert.equal([...represented].length, registered.size);
});
