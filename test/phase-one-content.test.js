import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LEVELS } from "../src/levels.js";
import {
  computeContentHash,
  resolveWorldPackage,
  serializeWorldPackage,
  validateWorldPackage
} from "../src/world-schema.js";

const SHOWCASE_PATH = new URL("../worlds/labs/cablester-composite-showcase.world.json", import.meta.url);
const LABS_PATH = new URL("../worlds/labs/cablester-3c-labs.world.json", import.meta.url);

async function readWorld(url) {
  const source = await readFile(url, "utf8");
  return { source, world: JSON.parse(source) };
}

function chunksOf(world) {
  return world.regions.flatMap((region) => region.chunks);
}

function objectsOf(world) {
  return chunksOf(world).flatMap((chunk) => chunk.objects);
}

function connectionsOf(world) {
  return chunksOf(world).flatMap((chunk) => chunk.connections);
}

function typeEntriesById(world) {
  return new Map(world.typeRegistry.entries.map((entry) => [entry.id, entry]));
}

function objectBounds(world, object) {
  const typeEntry = typeEntriesById(world).get(object.type) || {};
  const adapter = typeEntry.boundsAdapter || {};
  const pivot = typeEntry.pivot || {};
  const properties = object.properties || {};
  const position = object.transform.position;
  const scaleX = Math.abs(Number(object.transform.scale?.x ?? 1));
  const scaleY = Math.abs(Number(object.transform.scale?.y ?? 1));
  if (["slope", "segment", "line"].includes(adapter.kind)) {
    const dx = Number(properties.dx || 0) * scaleX;
    const dy = Number(properties.dy || 0) * scaleY;
    const thickness = Number(properties.thickness || 14);
    return {
      x: position.x + Math.min(0, dx) - thickness / 2,
      y: position.y + Math.min(0, dy) - thickness / 2,
      w: Math.abs(dx) + thickness,
      h: Math.abs(dy) + thickness
    };
  }
  if (["circle", "radius"].includes(adapter.kind)) {
    const radius = Number(properties[adapter.radiusProperty || "radius"] ?? adapter.radius ?? 22);
    return { x: position.x - radius, y: position.y - radius, w: radius * 2, h: radius * 2 };
  }
  if (adapter.kind === "point") {
    const radius = Number(adapter.radius ?? properties.size ?? 22);
    return { x: position.x - radius, y: position.y - radius, w: radius * 2, h: radius * 2 };
  }
  const w = Number(properties[adapter.widthProperty || "w"] ?? properties.w ?? properties.width ?? 32) * scaleX;
  const h = Number(properties[adapter.heightProperty || "h"] ?? properties.h ?? properties.height ?? 32) * scaleY;
  return {
    x: position.x - Number(pivot.x || 0) * w,
    y: position.y - Number(pivot.y || 0) * h,
    w,
    h
  };
}

function rectIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function rectContains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function solidObject(world, object) {
  const typeEntry = typeEntriesById(world).get(object.type) || {};
  return ["solid", "one-way-solid"].includes(typeEntry.collisionSemantics)
    || ["platform", "boundaryWall", "slope", "fragilePlatform", "gate"].includes(typeEntry.godotRuntimeHandler)
    || (object.type === "movingObject" && object.properties?.objectKind === "platform");
}

function harmfulObject(object) {
  return object.type === "hazard"
    || (object.type === "movingObject" && object.properties?.objectKind === "hazard")
    || (object.type === "liquidZone" && Number(object.properties?.contactDamage || 0) > 0);
}

function playerEnvelope(world, point, margin = 4) {
  const halfExtent = Number(world.gameplayTuning.approved.values.playerRadius) + margin;
  return { x: point.x - halfExtent, y: point.y - halfExtent, w: halfExtent * 2, h: halfExtent * 2 };
}

function offsetPoint(object) {
  return {
    x: object.transform.position.x + Number(object.properties?.spawnOffsetX || 0),
    y: object.transform.position.y + Number(object.properties?.spawnOffsetY || 0)
  };
}

function gateSatisfied(connection, abilities, flags) {
  return connection.requiredAbilities.every((id) => abilities.has(id))
    && connection.requiredFlags.every((id) => flags.has(id));
}

function simulateStaticProgression(world, startChunkId) {
  const chunks = new Map(chunksOf(world).map((chunk) => [chunk.id, chunk]));
  const reachable = new Set([startChunkId]);
  const abilities = new Set(chunks.get(startChunkId)?.gameplay?.startingAbilities || []);
  const flags = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const chunkId of [...reachable]) {
      const chunk = chunks.get(chunkId);
      for (const object of chunk.objects) {
        if (object.type === "abilityPickup" && object.properties.abilityId && !abilities.has(object.properties.abilityId)) {
          abilities.add(object.properties.abilityId);
          changed = true;
        }
        if (object.type === "stateTrigger" && object.properties.setFlag && !flags.has(object.properties.setFlag)) {
          flags.add(object.properties.setFlag);
          changed = true;
        }
      }
    }
    for (const connection of connectionsOf(world)) {
      if (!gateSatisfied(connection, abilities, flags)) continue;
      const from = connection.from.chunkId;
      const to = connection.to.chunkId;
      if (reachable.has(from) && !reachable.has(to)) {
        reachable.add(to);
        changed = true;
      }
      if (!connection.oneWay && reachable.has(to) && !reachable.has(from)) {
        reachable.add(from);
        changed = true;
      }
    }
  }
  return { reachable, abilities, flags };
}

test("phase-one canonical worlds are sealed, deterministic, and fully resolvable", async () => {
  for (const path of [SHOWCASE_PATH, LABS_PATH]) {
    const { source, world } = await readWorld(path);
    assert.equal(world.schemaVersion, 3);
    assert.equal(world.manifest.contentHash, await computeContentHash(world));
    assert.equal(await serializeWorldPackage(world), source);
    assert.deepEqual(validateWorldPackage(world), []);
    const resolved = resolveWorldPackage(world);
    assert.deepEqual(resolved.errors, []);
    assert.deepEqual(resolved.warnings, []);
  }
});

test("public composite showcase is one canonical 12-chunk region with complete gated topology", async () => {
  const { world } = await readWorld(SHOWCASE_PATH);
  assert.equal(world.godotCompatibility.requiredBuildId, "4.7.1.stable.official.a13da4feb");
  assert.equal(world.manifest.namespace, "labs");
  assert.equal(world.regions.length, 1);

  const [region] = world.regions;
  const chunks = chunksOf(world);
  const chunkIds = new Set(chunks.map((chunk) => chunk.id));
  const mainRoute = region.routes.find((route) => route.id === "main-route");
  assert.equal(chunks.length, 12);
  assert.equal(mainRoute.chunks.length, 8);
  assert.equal(chunks.length - mainRoute.chunks.length, 4);
  assert.equal(region.landmarks.length, 3);
  assert.ok(chunks.find((chunk) => chunk.id === "seedgate-verge").tags.includes("start"));
  assert.ok(chunks.find((chunk) => chunk.id === "afterglow-gate").tags.includes("exit"));

  const connections = connectionsOf(world);
  assert.equal(connections.length, 15);
  assert.equal(new Set(connections.map((connection) => connection.id)).size, connections.length);
  for (const chunk of chunks) {
    assert.ok(chunk.objects.some((object) => object.type === "checkpoint"), `${chunk.id} lacks a checkpoint`);
    assert.ok(chunk.objects.some((object) => object.type === "boundaryWall" && object.tags.includes("fall-recovery")), `${chunk.id} lacks a fall recovery floor`);
    assert.equal(chunk.streaming.prefetchDistance >= 900, true, `${chunk.id} prefetch is below the approved movement budget`);
    for (const connection of chunk.connections) {
      assert.equal(connection.from.chunkId, chunk.id, `${connection.id} is stored outside its from chunk`);
      assert.ok(chunkIds.has(connection.to.chunkId));
      for (const endpoint of [connection.from, connection.to]) {
        const endpointChunk = chunks.find((candidate) => candidate.id === endpoint.chunkId);
        const entrance = endpointChunk.objects.find((object) => object.id === endpoint.entranceId);
        assert.equal(entrance?.type, "roomEntrance", `${connection.id} endpoint ${endpoint.entranceId} is unresolved`);
        assert.ok(entrance.properties.w >= 52 && entrance.properties.h >= 52, `${endpoint.entranceId} lacks player clearance`);
      }
    }
  }

  const progression = simulateStaticProgression(world, "seedgate-verge");
  assert.deepEqual([...progression.reachable].sort(), [...chunkIds].sort());
  assert.deepEqual([...progression.abilities].sort(), ["bash", "dash", "doubleJump", "glide", "hardBar", "rope", "wallGrab"]);
  assert.deepEqual([...progression.flags].sort(), world.stateDefinitions.flags.map((entry) => entry.id).sort());
  for (const route of region.routes.filter((candidate) => candidate.kind === "loop")) {
    const pairs = route.chunks.map((chunkId, index) => index === 0 ? null : [route.chunks[index - 1], chunkId]).slice(1);
    pairs.push([route.chunks.at(-1), route.chunks[0]]);
    for (const [from, to] of pairs) {
      assert.ok(connections.some((connection) => (
        connection.from.chunkId === from && connection.to.chunkId === to
      ) || (
        !connection.oneWay && connection.from.chunkId === to && connection.to.chunkId === from
      )), `${route.id} lacks the ${from} ↔ ${to} edge needed to close its loop`);
    }
  }
  const finalChunk = chunks.find((chunk) => chunk.id === "afterglow-gate");
  assert.ok(finalChunk.objects.some((object) => object.type === "goal"));
});

test("public composite showcase portals, spawns, and checkpoints keep a conservative player envelope clear", async () => {
  const { world } = await readWorld(SHOWCASE_PATH);
  let entranceCount = 0;
  let exitCount = 0;
  let spawnCount = 0;
  let checkpointCount = 0;

  for (const chunk of chunksOf(world)) {
    const solidObjects = chunk.objects.filter((object) => solidObject(world, object));
    const harmfulObjects = chunk.objects.filter(harmfulObject);
    const sideWalls = chunk.objects.filter((object) => object.type === "boundaryWall" && object.tags.includes("side-boundary"));
    const recoveryFloor = chunk.objects.find((object) => object.type === "boundaryWall" && object.tags.includes("fall-recovery"));
    assert.equal(sideWalls.length, 2, `${chunk.id} must seal both horizontal bounds`);
    assert.ok(recoveryFloor, `${chunk.id} lacks its recovery floor`);
    const [leftWall, rightWall] = sideWalls.map((object) => objectBounds(world, object)).sort((a, b) => a.x - b.x);
    assert.equal(leftWall.x, chunk.bounds.x, `${chunk.id} left boundary is not flush with chunk bounds`);
    assert.equal(rightWall.x + rightWall.w, chunk.bounds.x + chunk.bounds.w, `${chunk.id} right boundary is not flush with chunk bounds`);
    for (const wall of [leftWall, rightWall]) {
      assert.ok(wall.y <= chunk.bounds.y && wall.y + wall.h >= recoveryFloor.transform.position.y, `${chunk.id} side boundary leaves an escape gap`);
    }

    const assertSafeEnvelope = (object, point, kind) => {
      const envelope = playerEnvelope(world, point);
      const solidHits = solidObjects.filter((candidate) => rectIntersects(envelope, objectBounds(world, candidate)));
      const harmfulHits = harmfulObjects.filter((candidate) => rectIntersects(envelope, objectBounds(world, candidate)));
      assert.deepEqual(solidHits.map((candidate) => candidate.id), [], `${chunk.id} ${kind} ${object.id} overlaps solid geometry`);
      assert.deepEqual(harmfulHits.map((candidate) => candidate.id), [], `${chunk.id} ${kind} ${object.id} overlaps harmful geometry`);
      assert.ok(envelope.x >= chunk.bounds.x && envelope.y >= chunk.bounds.y
        && envelope.x + envelope.w <= chunk.bounds.x + chunk.bounds.w
        && envelope.y + envelope.h <= chunk.bounds.y + chunk.bounds.h, `${chunk.id} ${kind} ${object.id} falls outside chunk bounds`);
    };

    for (const entrance of chunk.objects.filter((object) => object.type === "roomEntrance")) {
      entranceCount += 1;
      assertSafeEnvelope(entrance, offsetPoint(entrance), "arrival spawn");
      const matchingExit = chunk.objects.find((object) => object.type === "roomExit"
        && object.transform.position.x === entrance.transform.position.x
        && object.transform.position.y === entrance.transform.position.y);
      assert.ok(matchingExit, `${entrance.id} has no colocated roomExit`);
    }
    for (const exit of chunk.objects.filter((object) => object.type === "roomExit")) {
      exitCount += 1;
      const exitBounds = objectBounds(world, exit);
      assert.ok(exitBounds.x >= chunk.bounds.x && exitBounds.y >= chunk.bounds.y
        && exitBounds.x + exitBounds.w <= chunk.bounds.x + chunk.bounds.w
        && exitBounds.y + exitBounds.h <= chunk.bounds.y + chunk.bounds.h, `${exit.id} is outside chunk bounds`);
      assert.deepEqual(solidObjects.filter((object) => rectContains(objectBounds(world, object), exitBounds)).map((object) => object.id), [], `${exit.id} is contained by solid geometry`);
      assert.deepEqual(harmfulObjects.filter((object) => rectIntersects(objectBounds(world, object), exitBounds)).map((object) => object.id), [], `${exit.id} overlaps harmful geometry`);
      if (exit.properties.direction === "left") assert.ok(exitBounds.x >= leftWall.x + leftWall.w, `${exit.id} is not inside the left boundary`);
      if (exit.properties.direction === "right") assert.ok(exitBounds.x + exitBounds.w <= rightWall.x, `${exit.id} is not inside the right boundary`);
    }
    for (const spawn of chunk.objects.filter((object) => object.type === "spawn")) {
      spawnCount += 1;
      assertSafeEnvelope(spawn, spawn.transform.position, "default spawn");
    }
    for (const checkpoint of chunk.objects.filter((object) => object.type === "checkpoint")) {
      checkpointCount += 1;
      assertSafeEnvelope(checkpoint, offsetPoint(checkpoint), "checkpoint respawn");
    }
  }

  assert.deepEqual({ entranceCount, exitCount, spawnCount, checkpointCount }, {
    entranceCount: 30,
    exitCount: 30,
    spawnCount: 12,
    checkpointCount: 13
  });
});

test("public composite showcase uses only registered project assets and declared persistent state", async () => {
  const { world } = await readWorld(SHOWCASE_PATH);
  const assetIds = new Set(world.assetRegistry.entries.map((entry) => entry.id));
  const declaredFlags = new Set(world.stateDefinitions.flags.map((entry) => entry.id));
  const usedLandmarks = new Set();
  for (const region of world.regions) {
    for (const landmark of region.landmarks) {
      assert.ok(assetIds.has(landmark.assetId));
      usedLandmarks.add(landmark.assetId);
    }
    for (const chunk of region.chunks) {
      assert.deepEqual(chunk.statePolicy, {
        deathReset: "checkpoint",
        checkpointReset: "chunk",
        offscreen: "sleep-local",
        worldPersistence: ["abilities", "flags", "checkpoint"]
      });
      for (const layer of chunk.scene.layers) {
        for (const asset of layer.assets || []) assert.ok(assetIds.has(asset.assetId), `unregistered scene asset ${asset.assetId}`);
      }
      for (const object of chunk.objects) {
        const id = object.properties.visual?.assetId;
        if (id) assert.ok(assetIds.has(id), `unregistered object asset ${id}`);
        for (const key of [object.properties.requiredFlag, object.properties.setFlag, object.properties.clearFlag, object.properties.clearedByFlag].filter(Boolean)) {
          assert.ok(declaredFlags.has(key), `undeclared state flag ${key}`);
        }
        assert.equal(object.tags.includes("temporary"), false);
        assert.equal(object.tags.includes("reference-copy"), false);
        if (object.tags.includes("persistent-state") && ["stateTrigger", "abilityPickup"].includes(object.type)) {
          assert.equal(object.properties.resetPolicy, "persistent", `${object.id} must survive room and death resets`);
        }
      }
    }
  }
  assert.deepEqual([...usedLandmarks].sort(), [
    "landmark:duskseed-gate",
    "landmark:heartwood-core",
    "landmark:twin-root-bells"
  ]);
});

test("canonical 3C labs preserve the six focused and four combined Web cases", async () => {
  const { world } = await readWorld(LABS_PATH);
  const chunks = chunksOf(world);
  assert.equal(world.manifest.namespace, "labs");
  assert.equal(chunks.length, 10);
  assert.equal(chunks.filter((chunk) => chunk.tags.includes("focused")).length, 6);
  assert.equal(chunks.filter((chunk) => chunk.tags.includes("combined")).length, 4);
  assert.deepEqual(chunks.map((chunk) => chunk.id), LEVELS.map((level) => level.id));
  assert.equal(objectsOf(world).length, 405);
  for (const chunk of chunks) {
    assert.equal(chunk.gameplay.parityStatus, "implemented");
    assert.equal(chunk.gameplay.humanConfirmation, "needed");
    assert.ok(chunk.objects.some((object) => object.type === "spawn"));
    assert.ok(chunk.objects.some((object) => object.type === "goal"));
  }
});
