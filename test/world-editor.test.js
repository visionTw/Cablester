import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WorldEditorSession,
  createChunkWebPlaytestDocument,
  createWorldDocumentDiff,
  nextStableId
} from "../src/world-editor.js";
import { applyTransformChain } from "../src/world-streaming.js";
import {
  ReadOnlyWorldRepositoryError,
  WorldRepositoryClient,
  assertWorldRepositoryPath,
  readWorldRepositoryCapability
} from "../src/world-repository-client.js";
import { validateWorldInStages } from "../src/world-validation-worker.js";
import { validateWorldPackage } from "../src/world-schema.js";
import { compileLevelDocument, validateLevelDocument } from "../src/level-objects.js";
import { validateLevel } from "../src/level-validator.js";

const root = new URL("..", import.meta.url);

async function forestWorld() {
  return JSON.parse(await readFile(new URL("worlds/formal/first-forest.world.json", root), "utf8"));
}

test("stable ID allocator, search, filter, duplicate, delete, undo and redo use canonical entities", async () => {
  const session = new WorldEditorSession(await forestWorld());
  assert.equal(nextStableId("seedgate-verge:spawn", new Set(["seedgate-verge-spawn"])), "seedgate-verge-spawn-2");
  assert.ok(session.search("seedgate-verge:spawn", { kind: "object" }).some((entity) => entity.id === "seedgate-verge:spawn"));
  assert.ok(session.search("platform", { kind: "object", type: "platform" }).length > 10);

  session.select("object", "seedgate-verge:spawn");
  const copyId = session.duplicateSelected();
  assert.ok(copyId.includes("copy"));
  assert.ok(session.search(copyId, { kind: "object" }).some((entity) => entity.id === copyId));
  assert.ok(session.changes().changes.length < 10, "stable-ID diff should not report every shifted array index");
  assert.equal(session.canUndo, true);

  session.deleteSelected();
  assert.equal(session.search(copyId, { kind: "object" }).length, 0);
  session.undo();
  assert.equal(session.search(copyId, { kind: "object" }).length, 1);
  session.undo();
  assert.equal(session.search(copyId, { kind: "object" }).length, 0);
  session.redo();
  assert.equal(session.search(copyId, { kind: "object" }).length, 1);
});

test("cross-chunk movement preserves world position and keeps one global stable object ID", async () => {
  const session = new WorldEditorSession(await forestWorld());
  const objectId = "seedgate-verge:spawn";
  const before = session.search(objectId, { kind: "object" })[0];
  const sourceRegion = session.world.regions.find((region) => region.id === before.regionId);
  const sourceChunk = sourceRegion.chunks.find((chunk) => chunk.id === before.chunkId);
  const worldPosition = applyTransformChain(before.value.transform.position, [sourceRegion.transform, sourceChunk.transform]);
  session.moveObject(objectId, "lantern-crossing");
  const after = session.search(objectId, { kind: "object" });
  assert.equal(after.length, 1);
  assert.equal(after[0].chunkId, "lantern-crossing");
  const targetRegion = session.world.regions.find((region) => region.id === after[0].regionId);
  const targetChunk = targetRegion.chunks.find((chunk) => chunk.id === after[0].chunkId);
  const movedWorldPosition = applyTransformChain(after[0].value.transform.position, [targetRegion.transform, targetChunk.transform]);
  assert.ok(Math.abs(movedWorldPosition.x - worldPosition.x) < 1e-9);
  assert.ok(Math.abs(movedWorldPosition.y - worldPosition.y) < 1e-9);
});

test("canvas moves Region, Chunk and Object in world space through transformed parents and supports undo", async () => {
  const world = await forestWorld();
  const region = world.regions.find((candidate) => candidate.id === "duskseed-reach");
  const chunk = region.chunks.find((candidate) => candidate.id === "seedgate-verge");
  region.transform.rotationDegrees = 17;
  region.transform.scale = { x: 1.35, y: 0.8 };
  chunk.transform.rotationDegrees = -11;
  chunk.transform.scale = { x: 0.9, y: 1.2 };
  const session = new WorldEditorSession(world);
  const delta = { x: 73.5, y: -41.25 };
  const worldPosition = (kind, id) => {
    const record = session.search(id, { kind })[0];
    if (kind === "region") return record.value.transform.position;
    const targetRegion = session.world.regions.find((candidate) => candidate.id === record.regionId);
    if (kind === "chunk") return applyTransformChain(record.value.transform.position, [targetRegion.transform]);
    const targetChunk = targetRegion.chunks.find((candidate) => candidate.id === record.chunkId);
    return applyTransformChain(record.value.transform.position, [targetRegion.transform, targetChunk.transform]);
  };

  for (const [kind, id] of [
    ["region", "duskseed-reach"],
    ["chunk", "seedgate-verge"],
    ["object", "seedgate-verge:spawn"]
  ]) {
    const before = worldPosition(kind, id);
    assert.equal(session.moveEntityByWorldDelta(kind, id, delta), true);
    const after = worldPosition(kind, id);
    assert.ok(Math.abs(after.x - before.x - delta.x) < 1e-8, `${kind} x delta`);
    assert.ok(Math.abs(after.y - before.y - delta.y) < 1e-8, `${kind} y delta`);
    assert.equal(session.world.manifest.contentHash, "");
    assert.equal(session.undo(), true);
    const restored = worldPosition(kind, id);
    assert.ok(Math.abs(restored.x - before.x) < 1e-8, `${kind} undo x`);
    assert.ok(Math.abs(restored.y - before.y) < 1e-8, `${kind} undo y`);
  }
});

test("ChunkGraph builder stores one unique canonical edge on the from chunk with stable entrance IDs", async () => {
  const session = new WorldEditorSession(await forestWorld());
  const fromChunkId = "seedgate-verge";
  const toChunkId = "afterglow-gate";
  const fromEntranceId = "seedgate-verge:entrance-lantern-crossing";
  const toEntranceId = "afterglow-gate:entrance-heartwood-ring";
  const id = session.addConnection(fromChunkId, toChunkId, {
    fromEntranceId,
    toEntranceId,
    direction: "right",
    oneWay: true
  });
  const source = session.world.regions.flatMap((region) => region.chunks).find((chunk) => chunk.id === fromChunkId);
  const edge = source.connections.find((connection) => connection.id === id);
  assert.deepEqual(edge, {
    id,
    from: { chunkId: fromChunkId, entranceId: fromEntranceId },
    to: { chunkId: toChunkId, entranceId: toEntranceId },
    direction: "right",
    requiredAbilities: [],
    requiredFlags: [],
    oneWay: true
  });
  assert.equal(session.world.regions.flatMap((region) => region.chunks).flatMap((chunk) => chunk.connections).filter((connection) => connection.id === id).length, 1);
  assert.throws(() => session.addConnection(fromChunkId, toChunkId, { fromEntranceId, toEntranceId }), /已存在/);
  assert.equal(session.undo(), true);
  assert.equal(session.world.regions.flatMap((region) => region.chunks).flatMap((chunk) => chunk.connections).some((connection) => connection.id === id), false);
});

test("world editor diff and deterministic export track the last repository baseline", async () => {
  const session = new WorldEditorSession(await forestWorld());
  assert.deepEqual(session.changes().changes, []);
  session.select("chunk", "seedgate-verge");
  session.updateSelected("streaming.prefetchDistance", 1440);
  const changes = session.changes();
  assert.ok(changes.changes.some((change) => change.path.endsWith("streaming.prefetchDistance")));
  const first = await session.serialize();
  const second = await session.serialize();
  assert.equal(first, second);
  assert.ok(first.endsWith("\n"));
  session.markSaved(first);
  assert.equal(session.dirty, false);
  assert.deepEqual(session.changes().changes, []);
});

test("adding and retyping objects uses registry defaults and clears the stale content hash", async () => {
  const session = new WorldEditorSession(await forestWorld());
  const objectId = session.addObject("seedgate-verge", "platform");
  const platform = session.search(objectId, { kind: "object" })[0].value;
  assert.deepEqual(platform.properties, { h: 80, w: 240 });
  assert.equal(session.world.manifest.contentHash, "");
  session.changeObjectType(objectId, "hazard");
  const hazard = session.search(objectId, { kind: "object" })[0].value;
  assert.equal(hazard.type, "hazard");
  assert.ok(Number.isFinite(hazard.properties.w));
  assert.ok(Number.isFinite(hazard.properties.h));
  assert.deepEqual(validateWorldPackage(session.world), []);
});

test("ordinary chunks get an in-memory Web contract goal proxy without mutating canonical", async () => {
  const world = await forestWorld();
  const before = JSON.stringify(world);
  const prepared = createChunkWebPlaytestDocument(world, "duskseed-reach", "seedgate-verge");
  assert.equal(prepared.derivedGoal, true);
  assert.ok(prepared.goalId.startsWith("web-preview-derived-"));
  assert.deepEqual(prepared.suppressedRoomExitIds, ["seedgate-verge:exit-lantern-crossing"]);
  assert.equal(prepared.document.objects.filter((object) => object.type === "goal").length, 1);
  assert.equal(prepared.document.objects.filter((object) => object.type === "roomExit").length, 0);
  assert.equal(prepared.document.metadata.webPreview.mode, "single-chunk-contract");
  assert.deepEqual(validateLevelDocument(prepared.document), []);
  assert.deepEqual(validateLevel(compileLevelDocument(prepared.document)), []);
  assert.equal(JSON.stringify(world), before);
});

test("a chunk with a formal goal keeps its canonical goal for Web playtest", async () => {
  const world = await forestWorld();
  const prepared = createChunkWebPlaytestDocument(world, "duskseed-reach", "afterglow-gate");
  assert.equal(prepared.derivedGoal, false);
  assert.equal(prepared.goalId, "afterglow-gate:forest-exit");
  assert.equal(prepared.document.objects.filter((object) => object.type === "goal").length, 1);
  assert.equal(prepared.document.objects.filter((object) => object.type === "roomExit").length, 2);
});

test("document diff identifies added, removed and changed canonical paths", () => {
  const diff = createWorldDocumentDiff(
    { a: 1, nested: { remove: true, keep: "x" } },
    { a: 2, nested: { keep: "x", added: false } }
  );
  assert.deepEqual(diff.changes.map((change) => [change.kind, change.path]), [
    ["changed", "a"],
    ["added", "nested.added"],
    ["removed", "nested.remove"]
  ]);
});

test("repository client allows only worlds/formal and worlds/labs and clearly rejects online saves", async () => {
  assert.equal(assertWorldRepositoryPath("/worlds/formal/first-forest.world.json"), "worlds/formal/first-forest.world.json");
  assert.equal(assertWorldRepositoryPath("worlds/labs/3c.world.json"), "worlds/labs/3c.world.json");
  for (const path of ["../worlds/formal/x.world.json", "worlds/registries/x.world.json", "worlds/formal/x.json", "godot/x.world.json"]) {
    assert.throws(() => assertWorldRepositoryPath(path), /worlds\/formal/);
  }
  const client = new WorldRepositoryClient({
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => "", headers: new Headers() }),
    serialize: async () => "{}\n"
  });
  await assert.rejects(
    () => client.save("worlds/labs/test.world.json", {}),
    (error) => error instanceof ReadOnlyWorldRepositoryError && /只读/.test(error.message)
  );

  const legacyCapability = new WorldRepositoryClient({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        mode: "read-only",
        worlds: [
          "worlds/formal/first-forest.world.json",
          { path: "worlds/labs/cablester-3c-labs.world.json", title: "3C" },
          "../project.godot"
        ]
      })
    })
  });
  assert.deepEqual((await legacyCapability.list()).map((entry) => entry.path), [
    "worlds/formal/first-forest.world.json",
    "worlds/labs/cablester-3c-labs.world.json"
  ]);
});

test("repository capability is captured from the URL fragment, removed from browser history and sent only in memory", async () => {
  let replacedUrl = null;
  let replacedState = null;
  const repositoryCapability = readWorldRepositoryCapability({
    locationLike: {
      hash: "#view=world&cablester-repository-capability=secret-token",
      pathname: "/",
      search: "?local=1"
    },
    historyLike: {
      state: { kept: true },
      replaceState(state, _title, url) { replacedState = state; replacedUrl = url; }
    }
  });
  assert.equal(repositoryCapability, "secret-token");
  assert.equal(replacedUrl, "/?local=1#view=world");
  assert.equal(replacedState.cablesterRepositoryCapability, "secret-token");
  assert.equal(readWorldRepositoryCapability({
    locationLike: { hash: "", pathname: "/", search: "?local=1" },
    historyLike: { state: replacedState }
  }), "secret-token", "history state keeps the capability across a same-page reload without exposing it to HTTP");

  let requestHeaders = null;
  const client = new WorldRepositoryClient({
    repositoryCapability,
    fetchImpl: async (_url, options) => {
      requestHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ mode: "read-write", writable: true, worlds: [] })
      };
    }
  });
  assert.equal((await client.inspect()).writable, true);
  assert.equal(requestHeaders["x-cablester-repository-capability"], "secret-token");
});

test("staged validator checks real formal and labs packages without false positive bounds or persistence warnings", async () => {
  for (const path of ["worlds/formal/first-forest.world.json", "worlds/labs/cablester-3c-labs.world.json"]) {
    const world = JSON.parse(await readFile(new URL(path, root), "utf8"));
    const progress = [];
    const result = await validateWorldInStages(world, { onProgress: (event) => progress.push(event) });
    assert.equal(result.summary.errors, 0, path);
    assert.equal(result.summary.warnings, 0, path);
    assert.ok(progress.length >= 4);
    assert.equal(progress.at(-1).stage, "complete");
    assert.equal(progress.at(-1).progress, 1);
  }
});

test("staged validator catches physical portal, recovery, progression and persistence regressions", async () => {
  const world = await forestWorld();
  const chunks = world.regions.flatMap((region) => region.chunks);
  const wind = chunks.find((chunk) => chunk.id === "wind-terraces");
  const exit = wind.objects.find((object) => object.id === "wind-terraces:exit-bellroot-court");
  const cliff = wind.objects.find((object) => object.id === "wind-terraces:east-cliff");
  cliff.transform.position = structuredClone(exit.transform.position);
  cliff.properties.w = exit.properties.w;
  cliff.properties.h = exit.properties.h;
  const entrance = wind.objects.find((object) => object.type === "roomEntrance");
  entrance.properties.spawnOffsetX = cliff.transform.position.x - entrance.transform.position.x + 10;
  entrance.properties.spawnOffsetY = cliff.transform.position.y - entrance.transform.position.y + 10;
  wind.objects = wind.objects.filter((object) => !(object.type === "abilityPickup" && object.properties.abilityId === "glide"));
  const persistentTrigger = chunks.flatMap((chunk) => chunk.objects).find((object) => object.type === "stateTrigger" && object.tags.includes("persistent-state"));
  delete persistentTrigger.properties.resetPolicy;

  const result = await validateWorldInStages(world, { coreValidate: () => [] });
  const codes = new Set(result.issues.map((item) => item.code));
  assert.ok(codes.has("connection.exit-contained-by-solid"));
  assert.ok(codes.has("recovery.solid-overlap"));
  assert.ok(codes.has("gate.ability-unobtainable"));
  assert.ok(codes.has("state.persistent-reset-policy"));
});

test("staged validator is cancellable between chunks", async () => {
  const world = await forestWorld();
  const controller = new AbortController();
  await assert.rejects(
    () => validateWorldInStages(world, {
      signal: controller.signal,
      yieldEvery: 1,
      onProgress(progress) {
        if (progress.stage === "chunks") controller.abort();
      }
    }),
    (error) => error.name === "AbortError" && error.code === "VALIDATION_CANCELLED"
  );
});
