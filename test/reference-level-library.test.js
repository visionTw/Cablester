import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ReferenceLevelLibrary,
  ReferenceRunState,
  validateReferencePlayableIndex
} from "../src/reference-level-library.js";
import { compileLevelDocument, validateLevelDocument } from "../src/level-objects.js";
import { validateLevel } from "../src/level-validator.js";
import { circleIntersectsRect } from "../src/math.js";

test("generated reference playable index is structurally valid and lists authored rooms", async () => {
  const index = JSON.parse(await readFile(new URL("../levels/reference/playable-index.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../levels/reference/manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(validateReferencePlayableIndex(index), []);
  assert.ok(index.collections.length >= 2);
  assert.equal(Object.keys(index.rooms).length, manifest.entries.length);
  assert.equal(new Set(Object.values(index.rooms).map((room) => room.dataFile)).size, manifest.entries.length);
  for (const collection of index.collections) {
    assert.ok(collection.roomIds.length > 0);
    for (const roomId of collection.roomIds) {
      assert.equal(index.rooms[roomId].id, roomId);
      assert.match(index.rooms[roomId].dataFile, /^levels\/reference\/.+\.json$/);
      assert.equal(index.rooms[roomId].status.whitebox, "authored");
      assert.equal(index.rooms[roomId].status.load, "loadable");
      assert.equal(index.rooms[roomId].status.automation, "passed");
    }
  }
});

test("reference library loads and compiles an indexed reference room on demand", async () => {
  const index = {
    schemaVersion: 1,
    collections: [{ id: "test.collection", game: "test", localName: "测试批次", roomIds: ["test.room"] }],
    rooms: {
      "test.room": { id: "test.room", dataFile: "test-room.json", connections: [] }
    }
  };
  const roomDocument = {
    schemaVersion: 1,
    metadata: { id: "test.room", name: "测试房间", category: "参考白盒", mode: "reference-room" },
    bounds: { x: 0, y: 0, w: 1280, h: 720 },
    startingAbilities: ["dash", "wallGrab"],
    objects: [
      { id: "ground", type: "platform", position: { x: 0, y: 640 }, properties: { w: 1280, h: 80 } },
      { id: "spawn", type: "spawn", position: { x: 100, y: 590 }, properties: {} },
      { id: "checkpoint", type: "checkpoint", position: { x: 60, y: 550 }, properties: { w: 90, h: 90, spawnOffsetX: 45, spawnOffsetY: 40 } },
      { id: "entry-main", type: "roomEntrance", position: { x: 20, y: 520 }, properties: { w: 80, h: 120, spawnOffsetX: 80, spawnOffsetY: 70, facing: "right", sourceRoomId: "" } },
      { id: "exit-main", type: "roomExit", position: { x: 1180, y: 520 }, properties: { w: 80, h: 120, targetRoomId: "test.next", targetEntranceId: "entry-main", direction: "right", exitKind: "main", requiredAbility: "", oneWay: false } }
    ]
  };
  const responses = new Map([
    ["index.json", index],
    ["test-room.json", roomDocument]
  ]);
  const library = new ReferenceLevelLibrary({
    indexUrl: "index.json",
    fetchImpl: async (url) => ({
      ok: responses.has(url),
      status: responses.has(url) ? 200 : 404,
      async json() { return structuredClone(responses.get(url)); }
    })
  });
  await library.loadIndex();
  const level = await library.loadRoom("test.room");
  assert.equal(level.id, "test.room");
  assert.equal(level.roomEntrances[0].id, "entry-main");
  assert.equal(level.roomExits[0].targetRoomId, "test.next");
  assert.equal(level.goal, undefined);
});

test("every authored reference room file compiles and its authored transitions resolve", async () => {
  const index = JSON.parse(await readFile(new URL("../levels/reference/playable-index.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../levels/reference/manifest.json", import.meta.url), "utf8"));
  const manifestIds = new Set(manifest.entries.map((entry) => entry.id));
  const documents = new Map();

  for (const [roomId, metadata] of Object.entries(index.rooms)) {
    const documentData = JSON.parse(await readFile(new URL(`../${metadata.dataFile}`, import.meta.url), "utf8"));
    documents.set(roomId, documentData);
    assert.equal(documentData.metadata.id, roomId);
    assert.deepEqual(validateLevelDocument(documentData), [], `${roomId} document must validate`);
    const level = compileLevelDocument(documentData);
    assert.deepEqual(validateLevel(level), [], `${roomId} runtime level must validate`);
    assert.ok(level.roomEntrances.length > 0, `${roomId} must define an entrance`);
    assert.ok(level.roomExits.length > 0, `${roomId} must define an exit`);
    for (const point of [{ id: "spawn", ...level.spawn }, ...level.roomEntrances.map((entrance) => ({ id: entrance.id, ...entrance.spawn }))]) {
      for (const exit of level.roomExits) {
        assert.equal(
          circleIntersectsRect(point.x, point.y, 18, exit),
          false,
          `${roomId}/${point.id} must not immediately overlap ${exit.id}`
        );
      }
    }
    for (const exit of level.roomExits) {
      assert.ok(manifestIds.has(exit.targetRoomId), `${roomId}/${exit.id} targets a tracked room`);
    }
  }

  for (const [roomId, documentData] of documents) {
    const level = compileLevelDocument(documentData);
    for (const exit of level.roomExits) {
      const targetDocument = documents.get(exit.targetRoomId);
      if (!targetDocument) continue;
      const targetLevel = compileLevelDocument(targetDocument);
      assert.ok(
        targetLevel.roomEntrances.some((entrance) => entrance.id === exit.targetEntranceId),
        `${roomId}/${exit.id} targets missing authored entrance ${exit.targetRoomId}/${exit.targetEntranceId}`
      );
    }
  }
});

test("hand-authored representative batches remain connected inside the complete authored graph", async () => {
  const index = JSON.parse(await readFile(new URL("../levels/reference/playable-index.json", import.meta.url), "utf8"));
  const documents = new Map();
  for (const [roomId, metadata] of Object.entries(index.rooms)) {
    documents.set(roomId, JSON.parse(await readFile(new URL(`../${metadata.dataFile}`, import.meta.url), "utf8")));
  }
  const reachable = (startId) => {
    const visited = new Set();
    const pending = [startId];
    while (pending.length > 0) {
      const roomId = pending.pop();
      if (visited.has(roomId) || !documents.has(roomId)) continue;
      visited.add(roomId);
      const level = compileLevelDocument(documents.get(roomId));
      for (const exit of level.roomExits) if (documents.has(exit.targetRoomId)) pending.push(exit.targetRoomId);
    }
    return visited;
  };
  for (const expectation of [
    {
      collectionId: "celeste.city.a",
      first: "celeste.city.a.1",
      rooms: ["celeste.city.a.1", "celeste.city.a.2", "celeste.city.a.3", "celeste.city.a.4", "celeste.city.a.3b", "celeste.city.a.5", "celeste.city.a.5z", "celeste.city.a.5a"]
    },
    {
      collectionId: "ori.sunken-glades",
      first: "ori.sunken-glades.revival-basin",
      rooms: ["ori.sunken-glades.revival-basin", "ori.sunken-glades.sein-cavern", "ori.sunken-glades.first-gate-hub", "ori.sunken-glades.lower-ponds", "ori.sunken-glades.spirit-well-junction", "ori.sunken-glades.western-return", "ori.sunken-glades.black-root-junction"]
    }
  ]) {
    const collection = index.collections.find((item) => item.id === expectation.collectionId);
    assert.ok(collection, `${expectation.collectionId} must exist`);
    const visited = reachable(expectation.first);
    for (const roomId of expectation.rooms) {
      assert.ok(collection.roomIds.includes(roomId), `${roomId} must remain in its collection`);
      assert.ok(visited.has(roomId), `${roomId} must remain reachable from ${expectation.first}`);
    }
  }
});

test("reference run state preserves world progress while allowing local room reset", () => {
  const state = new ReferenceRunState("ori.sunken-glades", "ori.sunken-glades.revival-basin", {
    abilities: ["wallGrab"]
  });
  state.enterRoom("ori.sunken-glades.sein-cavern", "entry-west");
  state.recordCheckpoint("ori.sunken-glades.sein-cavern", "cp-main");
  state.recordAbility("dash");
  state.recordFlag("sein-found");
  state.recordFlag("temporary-route");
  state.replaceFlags(["sein-found"]);
  state.recordPickup("light-01");
  state.saveRoomState("ori.sunken-glades.sein-cavern", { gateOpen: true });
  state.resetRoom("ori.sunken-glades.sein-cavern", "room-reset");
  const snapshot = state.snapshot();
  assert.deepEqual(snapshot.abilities, ["dash", "wallGrab"]);
  assert.deepEqual(snapshot.flags, ["sein-found"]);
  assert.deepEqual(snapshot.pickups, ["light-01"]);
  assert.equal(snapshot.checkpoints["ori.sunken-glades.sein-cavern"], "cp-main");
  assert.equal(snapshot.roomStates["ori.sunken-glades.sein-cavern"], undefined);
});
