import { compileLevelDocument, migrateLevelDocument, validateLevelDocument } from "./level-objects.js";
import { validateLevel } from "./level-validator.js";

function clone(value) {
  return structuredClone(value);
}

export function validateReferencePlayableIndex(index) {
  const errors = [];
  if (!index || typeof index !== "object") return ["Reference playable index must be an object"];
  if (index.schemaVersion !== 1) errors.push(`Unsupported reference playable index version: ${index.schemaVersion}`);
  if (!Array.isArray(index.collections)) errors.push("Reference playable index must define collections[]");
  if (!index.rooms || typeof index.rooms !== "object" || Array.isArray(index.rooms)) {
    errors.push("Reference playable index must define a rooms object");
  }
  const roomIds = new Set(Object.keys(index.rooms || {}));
  for (const [roomId, room] of Object.entries(index.rooms || {})) {
    if (room.id !== roomId) errors.push(`Reference room key ${roomId} does not match room.id ${room.id}`);
    if (!room.dataFile) errors.push(`Reference room ${roomId} must define a local dataFile`);
  }
  const collectionIds = new Set();
  for (const collection of index.collections || []) {
    if (!collection.id) errors.push("Every reference collection must define an id");
    if (collectionIds.has(collection.id)) errors.push(`Duplicate reference collection id: ${collection.id}`);
    collectionIds.add(collection.id);
    if (!Array.isArray(collection.roomIds) || collection.roomIds.length === 0) {
      errors.push(`Reference collection ${collection.id || "unknown"} must contain at least one authored room`);
    }
    for (const roomId of collection.roomIds || []) {
      if (!roomIds.has(roomId)) errors.push(`Reference collection ${collection.id} references missing room ${roomId}`);
    }
  }
  return errors;
}

export class ReferenceLevelLibrary {
  constructor({ indexUrl = "./levels/reference/playable-index.json", fetchImpl = null } = {}) {
    const resolvedFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof resolvedFetch !== "function") throw new Error("ReferenceLevelLibrary requires a fetch implementation");
    this.indexUrl = indexUrl;
    this.fetchImpl = resolvedFetch;
    this.index = null;
    this.documentCache = new Map();
  }

  async fetchJson(url) {
    const response = await this.fetchImpl(url);
    if (!response.ok) throw new Error(`Unable to load reference level data from ${url}: ${response.status}`);
    return response.json();
  }

  async loadIndex() {
    const index = await this.fetchJson(this.indexUrl);
    const errors = validateReferencePlayableIndex(index);
    if (errors.length) throw new Error(errors.join("\n"));
    this.index = index;
    return clone(index);
  }

  ensureIndex() {
    if (!this.index) throw new Error("Reference playable index has not been loaded");
    return this.index;
  }

  collections() {
    return clone(this.ensureIndex().collections);
  }

  roomMetadata(roomId) {
    const room = this.ensureIndex().rooms[roomId];
    return room ? clone(room) : null;
  }

  resolveDataUrl(dataFile) {
    if (typeof document !== "undefined") return new URL(`./${dataFile}`, document.baseURI).href;
    return dataFile;
  }

  async loadRoomDocument(roomId) {
    const room = this.ensureIndex().rooms[roomId];
    if (!room) throw new Error(`Reference room is not authored or indexed: ${roomId}`);
    if (!this.documentCache.has(roomId)) {
      const documentData = migrateLevelDocument(await this.fetchJson(this.resolveDataUrl(room.dataFile)));
      const errors = validateLevelDocument(documentData);
      if (errors.length) throw new Error(`${roomId} document validation failed:\n${errors.join("\n")}`);
      if (documentData.metadata.id !== roomId) {
        throw new Error(`Reference room file id ${documentData.metadata.id} does not match index id ${roomId}`);
      }
      if (documentData.metadata.mode !== "reference-room") {
        throw new Error(`Reference room ${roomId} must use metadata.mode=reference-room`);
      }
      this.documentCache.set(roomId, clone(documentData));
    }
    return clone(this.documentCache.get(roomId));
  }

  async loadRoom(roomId) {
    const documentData = await this.loadRoomDocument(roomId);
    const level = compileLevelDocument(documentData);
    const errors = validateLevel(level);
    if (errors.length) throw new Error(`${roomId} runtime validation failed:\n${errors.join("\n")}`);
    return level;
  }

  clearRoomCache(roomId = null) {
    if (roomId) this.documentCache.delete(roomId);
    else this.documentCache.clear();
  }
}

export class ReferenceRunState {
  constructor(collectionId, initialRoomId, { abilities = [], flags = [], pickups = [] } = {}) {
    this.collectionId = collectionId;
    this.currentRoomId = initialRoomId;
    this.currentEntranceId = null;
    this.abilities = new Set(abilities);
    this.flags = new Set(flags);
    this.pickups = new Set(pickups);
    this.visitedRooms = new Set(initialRoomId ? [initialRoomId] : []);
    this.checkpoints = new Map();
    this.roomStates = new Map();
  }

  enterRoom(roomId, entranceId = null) {
    this.currentRoomId = roomId;
    this.currentEntranceId = entranceId;
    this.visitedRooms.add(roomId);
  }

  recordCheckpoint(roomId, checkpointId) {
    this.checkpoints.set(roomId, checkpointId);
  }

  recordAbility(abilityId) {
    this.abilities.add(abilityId);
  }

  recordFlag(flagId) {
    this.flags.add(flagId);
  }

  replaceFlags(flagIds) {
    this.flags = new Set(flagIds);
  }

  recordPickup(pickupId) {
    this.pickups.add(pickupId);
  }

  saveRoomState(roomId, state) {
    this.roomStates.set(roomId, clone(state));
  }

  resetRoom(roomId, policy = "room-reset") {
    if (policy === "room-reset") this.roomStates.delete(roomId);
    if (policy === "chapter-reset") {
      this.roomStates.clear();
      this.checkpoints.clear();
    }
  }

  snapshot() {
    return {
      collectionId: this.collectionId,
      currentRoomId: this.currentRoomId,
      currentEntranceId: this.currentEntranceId,
      abilities: [...this.abilities].sort(),
      flags: [...this.flags].sort(),
      pickups: [...this.pickups].sort(),
      visitedRooms: [...this.visitedRooms].sort(),
      checkpoints: Object.fromEntries(this.checkpoints),
      roomStates: Object.fromEntries([...this.roomStates].map(([roomId, state]) => [roomId, clone(state)]))
    };
  }
}
