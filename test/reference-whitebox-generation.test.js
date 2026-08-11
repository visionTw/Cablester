import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function circleIntersectsRect(point, radius, object) {
  const closestX = Math.max(object.position.x, Math.min(point.x, object.position.x + object.properties.w));
  const closestY = Math.max(object.position.y, Math.min(point.y, object.position.y + object.properties.h));
  return Math.hypot(point.x - closestX, point.y - closestY) <= radius;
}

test("every catalog-generated whitebox keeps explicit first-pass provenance and supported transitions", async () => {
  const generated = JSON.parse(await readFile(new URL("../levels/reference/whitebox-index.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../levels/reference/manifest.json", import.meta.url), "utf8"));
  const manifestById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const sequentialSourcesByTarget = new Map();
  for (const source of manifest.entries) {
    for (const connection of source.connections.filter((item) => /next/i.test(item.direction))) {
      const sources = sequentialSourcesByTarget.get(connection.target) || [];
      sources.push(source.id);
      sequentialSourcesByTarget.set(connection.target, sources);
    }
  }
  assert.equal(Object.keys(generated.entries).length, 893);
  for (const [roomId, metadata] of Object.entries(generated.entries)) {
    const document = JSON.parse(await readFile(new URL(`../${metadata.dataFile}`, import.meta.url), "utf8"));
    assert.equal(document.metadata.id, roomId);
    assert.match(document.reference.intent, /首轮白盒/);
    assert.ok(document.reference.knownDifferences.some((difference) => difference.includes("不是原作坐标")));
    const objectIds = new Set(document.objects.map((object) => object.id));
    const spawn = document.objects.find((object) => object.type === "spawn");
    const blockingSolids = document.objects.filter((object) => object.type === "platform" || object.type === "fragilePlatform" || (object.type === "movingObject" && object.properties.objectKind === "platform"));
    assert.ok(blockingSolids.every((solid) => !circleIntersectsRect(spawn.position, 20, solid)), `${roomId} spawn must not overlap blocking geometry`);
    const transitions = document.objects.filter((object) => object.type === "roomEntrance" || object.type === "roomExit");
    assert.ok(transitions.length >= 2, `${roomId} must expose transitions`);
    for (const transition of transitions) {
      assert.ok(objectIds.has(`${transition.id}-support`), `${roomId}/${transition.id} must have a local support platform`);
    }
    for (const sourceRoomId of sequentialSourcesByTarget.get(roomId) || []) {
      const entrance = document.objects.find((object) => object.type === "roomEntrance" && object.properties.sourceRoomId === sourceRoomId);
      assert.equal(entrance.position.x, 10, `${roomId} sequential entrance from ${sourceRoomId} must begin at the safe baseline`);
      assert.equal(entrance.position.y, document.bounds.h - 220, `${roomId} sequential entrance from ${sourceRoomId} must spawn above the safe baseline`);
    }
    const finalRoutePlatform = document.objects
      .filter((object) => object.type === "platform" && object.id.startsWith("route-platform-"))
      .sort((left, right) => right.position.x - left.position.x)[0];
    const routePlatforms = document.objects
      .filter((object) => object.type === "platform" && object.id.startsWith("route-platform-"))
      .sort((left, right) => left.position.x - right.position.x);
    assert.equal(routePlatforms[0].position.x, 0, `${roomId} safe baseline must start at the left bound`);
    for (let index = 1; index < routePlatforms.length; index += 1) {
      const previous = routePlatforms[index - 1];
      const current = routePlatforms[index];
      assert.ok(current.position.x <= previous.position.x + previous.properties.w, `${roomId} safe baseline must not contain an unverified fatal gap`);
      assert.ok(current.position.y >= previous.position.y, `${roomId} safe baseline must not contain an unverified upward wall`);
    }
    const baselineY = routePlatforms[0].position.y;
    assert.equal(spawn.position.y, baselineY - 24, `${roomId} default spawn must begin on the verified safe baseline`);
    for (const support of document.objects.filter((object) => object.type === "platform" && object.id.endsWith("-support"))) {
      const supportBottom = support.position.y + support.properties.h;
      assert.ok(support.position.y >= baselineY || supportBottom <= baselineY - 40, `${roomId}/${support.id} must not pinch the safe baseline below player diameter`);
    }
    for (const connection of manifestById.get(roomId).connections.filter((item) => /next/i.test(item.direction))) {
      const sequentialExit = document.objects.find((object) => object.type === "roomExit" && object.properties.targetRoomId === connection.target);
      assert.equal(sequentialExit.properties.exitKind, "main", `${roomId} sequential exit must be a main exit`);
      assert.equal(sequentialExit.position.x, document.bounds.w - 100, `${roomId} sequential exit must terminate the rightward route`);
      assert.ok(finalRoutePlatform.position.y - 20 >= sequentialExit.position.y, `${roomId} sequential exit must begin above the final route surface`);
      assert.ok(finalRoutePlatform.position.y - 20 <= sequentialExit.position.y + sequentialExit.properties.h, `${roomId} sequential exit must overlap a standing player`);
    }
  }
});
