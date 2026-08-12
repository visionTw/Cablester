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
    if (!Array.isArray(room.connections)) {
      errors.push(`Reference room ${roomId} must define connections[]`);
    } else {
      for (const [connectionIndex, connection] of room.connections.entries()) {
        const target = connection?.target;
        if (typeof target !== "string" || !target.trim()) {
          errors.push(`Reference room ${roomId} connection ${connectionIndex} must define a target room id`);
        } else if (!roomIds.has(target)) {
          errors.push(`Reference room ${roomId} connection ${connectionIndex} targets missing room ${target}`);
        }
      }
    }
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
  constructor({
    indexUrl = "./levels/reference/playable-index.json",
    fetchImpl = null,
    maxCachedDocuments = 24,
    preloadConcurrency = 4
  } = {}) {
    const resolvedFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof resolvedFetch !== "function") throw new Error("ReferenceLevelLibrary requires a fetch implementation");
    this.indexUrl = indexUrl;
    this.fetchImpl = resolvedFetch;
    this.index = null;
    this.documentCache = new Map();
    this.documentPromises = new Map();
    this.documentLastUsed = new Map();
    this.residentRoomIds = new Set();
    this.cacheClock = 0;
    this.cacheGeneration = 0;
    this.maxCachedDocuments = Math.max(4, Math.floor(maxCachedDocuments));
    this.preloadConcurrency = Math.max(1, Math.min(12, Math.floor(preloadConcurrency)));
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
    if (this.documentCache.has(roomId)) {
      this.documentLastUsed.set(roomId, ++this.cacheClock);
      return clone(this.documentCache.get(roomId));
    }
    if (!this.documentPromises.has(roomId)) {
      const cacheGeneration = this.cacheGeneration;
      const promise = (async () => {
        const documentData = migrateLevelDocument(await this.fetchJson(this.resolveDataUrl(room.dataFile)));
        const errors = validateLevelDocument(documentData);
        if (errors.length) throw new Error(`${roomId} document validation failed:\n${errors.join("\n")}`);
        if (documentData.metadata.id !== roomId) {
          throw new Error(`Reference room file id ${documentData.metadata.id} does not match index id ${roomId}`);
        }
        if (documentData.metadata.mode !== "reference-room") {
          throw new Error(`Reference room ${roomId} must use metadata.mode=reference-room`);
        }
        if (cacheGeneration === this.cacheGeneration) {
          this.documentCache.set(roomId, clone(documentData));
          this.documentLastUsed.set(roomId, ++this.cacheClock);
          this.pruneDocumentCache();
        }
        return documentData;
      })().finally(() => this.documentPromises.delete(roomId));
      this.documentPromises.set(roomId, promise);
    }
    const loadedDocument = await this.documentPromises.get(roomId);
    if (this.documentCache.has(roomId)) {
      this.documentLastUsed.set(roomId, ++this.cacheClock);
      return clone(this.documentCache.get(roomId));
    }
    return clone(loadedDocument);
  }

  async loadRoom(roomId) {
    const documentData = await this.loadRoomDocument(roomId);
    const level = compileLevelDocument(documentData);
    const errors = validateLevel(level);
    if (errors.length) throw new Error(`${roomId} runtime validation failed:\n${errors.join("\n")}`);
    return level;
  }

  adjacentRoomIds(roomId) {
    const index = this.ensureIndex();
    if (!index.rooms[roomId]) return [];
    const adjacent = new Set((index.rooms[roomId].connections || []).map((connection) => connection.target));
    for (const [candidateId, room] of Object.entries(index.rooms)) {
      if ((room.connections || []).some((connection) => connection.target === roomId)) adjacent.add(candidateId);
    }
    adjacent.delete(roomId);
    return [...adjacent].filter((candidateId) => Boolean(index.rooms[candidateId])).sort();
  }

  setResidentRoomIds(roomIds = []) {
    this.residentRoomIds = new Set(roomIds.filter((roomId) => typeof roomId === "string" && this.index?.rooms?.[roomId]));
    this.pruneDocumentCache();
    return new Set(this.residentRoomIds);
  }

  pruneDocumentCache() {
    if (this.documentCache.size <= this.maxCachedDocuments) return;
    const candidates = [...this.documentCache.keys()]
      .filter((roomId) => !this.residentRoomIds.has(roomId))
      .sort((left, right) => (this.documentLastUsed.get(left) || 0) - (this.documentLastUsed.get(right) || 0));
    while (this.documentCache.size > this.maxCachedDocuments && candidates.length) {
      const roomId = candidates.shift();
      this.documentCache.delete(roomId);
      this.documentLastUsed.delete(roomId);
    }
  }

  async preloadRooms(roomIds = [], { retain = false } = {}) {
    const ids = [...new Set(roomIds)].filter((roomId) => Boolean(this.index?.rooms?.[roomId]));
    if (retain) this.setResidentRoomIds(ids);
    const levels = new Map();
    const errors = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const roomId = ids[cursor++];
        try {
          levels.set(roomId, await this.loadRoom(roomId));
        } catch (error) {
          errors.push({ roomId, error: error instanceof Error ? error : new Error(String(error)) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.preloadConcurrency, ids.length) }, () => worker()));
    return { roomIds: ids, levels, errors };
  }

  async preloadRoomNeighborhood(roomId) {
    const roomIds = [roomId, ...this.adjacentRoomIds(roomId)];
    return this.preloadRooms(roomIds, { retain: true });
  }

  clearRoomCache(roomId = null) {
    this.cacheGeneration += 1;
    if (roomId) {
      this.documentCache.delete(roomId);
      this.documentLastUsed.delete(roomId);
      this.residentRoomIds.delete(roomId);
    } else {
      this.documentCache.clear();
      this.documentLastUsed.clear();
      this.residentRoomIds.clear();
    }
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
