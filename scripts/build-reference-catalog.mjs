import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ORI_AREAS, ORI_AREA_CONNECTIONS } from "./reference-catalog/ori-catalog.mjs";
import { referenceLibraryFingerprint } from "./reference-library-fingerprint.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(projectRoot, "levels", "reference");
const celesteCatalogPath = path.join(referenceRoot, "celeste", "catalog.json");
const oriCatalogPath = path.join(referenceRoot, "ori", "catalog.json");
const manifestPath = path.join(referenceRoot, "manifest.json");
const statusOverridesPath = path.join(referenceRoot, "status-overrides.json");
const whiteboxIndexPath = path.join(referenceRoot, "whitebox-index.json");
const playableIndexPath = path.join(referenceRoot, "playable-index.json");
const continuousRunAuditPath = path.join(referenceRoot, "continuous-run-audit.json");
const browserLoadAuditPath = path.join(referenceRoot, "browser-load-audit.json");
const browserAcceptanceAuditPath = path.join(referenceRoot, "browser-acceptance-audit.json");
const graphAuditPath = path.join(referenceRoot, "graph-audit.json");
const fidelityAuditPath = path.join(referenceRoot, "fidelity-audit.json");
const performanceAuditPath = path.join(referenceRoot, "performance-audit.json");
const shouldRefreshCeleste = process.argv.includes("--refresh-celeste");
const sourceFileArgument = process.argv.find((argument) => argument.startsWith("--source-file="));
const celesteSourceFile = sourceFileArgument ? path.resolve(sourceFileArgument.slice("--source-file=".length)) : null;

const BERRY_CAMP_COMMIT = "b5e393d9fc28ad85fe59c41031f96c24ffdc7b3a";
const BERRY_CAMP_SOURCE = `https://raw.githubusercontent.com/berrycamp/berrycamp.github.io/${BERRY_CAMP_COMMIT}/data/celeste.json`;

const SOURCES = Object.freeze({
  celesteCatalog: {
    id: "celeste-berry-camp-room-catalog",
    title: "Berry Camp public Celeste room catalog",
    url: `https://github.com/berrycamp/berrycamp.github.io/blob/${BERRY_CAMP_COMMIT}/data/celeste.json`,
    retrievedOn: "2026-08-09",
    confidence: "high-for-room-identity-medium-for-connections",
    usage: "Only room identity, checkpoint order, public map bounds and spawn/edge hints are retained. Images, tiles, entities and game assets are discarded."
  },
  celesteChangelog: {
    id: "celeste-official-changelog",
    title: "Official Celeste changelog",
    url: "https://www.celestegame.com/changelog.html",
    retrievedOn: "2026-08-09",
    confidence: "high",
    usage: "Version scope and behavior differences."
  },
  celesteWiki: {
    id: "celeste-community-wiki",
    title: "Celeste community wiki chapter and mechanic pages",
    url: "https://celestegame.fandom.com/wiki/Chapters",
    retrievedOn: "2026-08-09",
    confidence: "medium",
    usage: "Chapter structure and mechanic-introduction cross-check only."
  },
  celesteSummitB: {
    id: "celeste-summit-b-room-cross-check",
    title: "Celeste community wiki: Start (The Summit B-Side)",
    url: "https://celestegame.fandom.com/wiki/Start_(The_Summit_B-Side)",
    retrievedOn: "2026-08-09",
    confidence: "medium-high-for-7b-subchapter-count",
    usage: "Cross-check that each of the seven Summit B-Side subchapters contains four rooms."
  },
  oriLocations: {
    id: "ori-community-location-index",
    title: "Ori and the Blind Forest community location index",
    url: "https://oriandtheblindforest.fandom.com/wiki/Category:Locations_(Blind_Forest)",
    retrievedOn: "2026-08-09",
    confidence: "medium-high-for-named-areas",
    usage: "Named area coverage and major ability/location relationships."
  },
  oriWalkthrough: {
    id: "ori-de-complete-walkthrough",
    title: "Ori and the Blind Forest: Definitive Edition complete guide",
    url: "https://www.soloplayguide.com/games/ori-and-the-blind-forest-definitive-edition/complete-guide",
    retrievedOn: "2026-08-09",
    confidence: "medium-high-for-progression",
    usage: "Twenty-seven progression sections, major return trips and escape ordering."
  },
  oriDeAreas: {
    id: "ori-de-area-index",
    title: "Ori Definitive Edition location index",
    url: "https://oriandtheblindforest.fandom.com/wiki/Category:Definitive_Edition_Locations",
    retrievedOn: "2026-08-09",
    confidence: "medium-high",
    usage: "Black Root Burrows and Lost Grove scope."
  }
});

const CELESTE_MECHANICS = Object.freeze({
  prologue: ["basic-movement", "jump", "bridge-collapse", "scripted-dash-grant"],
  city: ["dash", "dash-refill", "spikes", "spring", "traffic-block", "falling-platform", "crumble-platform", "breakable-wall"],
  site: ["dash", "dash-refill", "dream-block", "moving-block", "badeline-chase", "seed-route", "hidden-route"],
  resort: ["dash", "dash-refill", "dust-hazard", "moving-dust", "key-door", "clutter-switch", "one-way-route", "vertical-shaft"],
  ridge: ["dash", "dash-refill", "wind", "snowball", "bubble-launcher", "moving-block", "cloud-platform", "breakable-wall"],
  temple: ["dash", "dash-refill", "darkness", "torch-switch", "key-door", "red-bubble", "seeker", "dash-switch", "carry-object"],
  reflection: ["dash", "dash-refill", "feather", "bumper", "kevin-block", "badeline-orb", "boss-pursuit", "falling-route"],
  summit: ["dash", "dash-refill", "wind", "dream-block", "dust-hazard", "bubble-launcher", "seeker", "feather", "checkpoint-flags"],
  epilogue: ["safe-exploration", "hidden-route", "future-challenge-rule"],
  core: ["double-dash", "dash-refill", "hot-cold-toggle", "lava-ice-hazard", "core-block", "conveyor", "dash-state-rule"],
  farewell: ["double-dash", "dash-refill", "jellyfish-glide", "puffer-launch", "wavedash-equivalent", "wall-bounce-equivalent", "moving-hazard", "electric-barrier", "endurance-room"]
});

const CELESTE_LOCAL_NAMES = Object.freeze({
  prologue: "山脚序章",
  city: "废城起步",
  site: "旧梦遗址",
  resort: "尘封旅舍",
  ridge: "风雪山脊",
  temple: "镜暗神殿",
  reflection: "深谷回声",
  summit: "千阶峰顶",
  epilogue: "山后余径",
  core: "冷热地核",
  farewell: "长别之路"
});

function markdownEscape(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

function unique(values) {
  return [...new Set(values)];
}

function stableRoomId(chapterId, sideId, roomId) {
  return `celeste.${chapterId}.${sideId}.${String(roomId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function oriPartitionId(areaId, partitionId) {
  return `ori.${areaId}.${partitionId}`;
}

function roomMapType(roomId, room) {
  const width = room.referenceLayout.size.w;
  const height = room.referenceLayout.size.h;
  if (roomId === "j-16") return "endurance-room";
  if (width >= 960 || height >= 552) return "large-scrolling-room";
  if (width > 320 || height > 184) return "medium-scrolling-room";
  return "compact-room";
}

function rectAdjacencyDirection(left, right) {
  const tolerance = 8;
  const minOverlap = 16;
  const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  if (Math.abs(left.right - right.left) <= tolerance && verticalOverlap >= minOverlap) return "right";
  if (Math.abs(left.left - right.right) <= tolerance && verticalOverlap >= minOverlap) return "left";
  if (Math.abs(left.bottom - right.top) <= tolerance && horizontalOverlap >= minOverlap) return "down";
  if (Math.abs(left.top - right.bottom) <= tolerance && horizontalOverlap >= minOverlap) return "up";
  return null;
}

function oppositeDirection(direction) {
  return { left: "right", right: "left", up: "down", down: "up" }[direction] || "unknown";
}

function sanitizeCelesteCatalog(source) {
  const chapters = source.chapters.map((chapter) => ({
    id: chapter.id,
    referenceName: chapter.name,
    localName: CELESTE_LOCAL_NAMES[chapter.id] || `白盒章节 ${chapter.id}`,
    ...(Number.isFinite(chapter.chapterNo) ? { chapterNo: chapter.chapterNo } : {}),
    sides: chapter.sides.map((side) => {
      const checkpointByRoom = new Map();
      const orderedRoomIds = [];
      const checkpoints = side.checkpoints.map((checkpoint, checkpointIndex) => {
        for (const roomId of checkpoint.roomOrder || []) {
          checkpointByRoom.set(roomId, checkpointIndex);
          if (!orderedRoomIds.includes(roomId)) orderedRoomIds.push(roomId);
        }
        return {
          id: `${checkpoint.abbreviation || "CP"}-${checkpointIndex + 1}`,
          referenceName: checkpoint.name,
          abbreviation: checkpoint.abbreviation || "CP",
          roomOrder: [...(checkpoint.roomOrder || [])]
        };
      });
      for (const roomId of Object.keys(side.rooms)) {
        if (!orderedRoomIds.includes(roomId)) orderedRoomIds.push(roomId);
      }
      const rooms = orderedRoomIds.map((roomId, sideOrder) => {
        const room = side.rooms[roomId];
        const checkpointIndex = checkpointByRoom.get(roomId) ?? Math.max(0, Math.min(checkpoints.length - 1, room.checkpointNo || 0));
        const checkpoint = checkpoints[checkpointIndex] || { id: "CP-1", referenceName: "Unassigned", abbreviation: "CP" };
        const canvas = room.canvas;
        const spawns = (room.entities?.spawn || [room.defaultSpawn]).filter(Boolean).map((spawn) => ({
          x: spawn.x,
          y: spawn.y
        }));
        return {
          id: roomId,
          referenceLabel: room.name || "",
          checkpointId: checkpoint.id,
          checkpointName: checkpoint.referenceName,
          sideOrder,
          checkpointOrder: (checkpoint.roomOrder || []).indexOf(roomId),
          referenceLayout: {
            position: { x: canvas.position.x, y: canvas.position.y },
            size: { w: canvas.size.width, h: canvas.size.height },
            bounds: {
              top: canvas.boundingBox.top,
              left: canvas.boundingBox.left,
              bottom: canvas.boundingBox.bottom,
              right: canvas.boundingBox.right
            },
            spawns
          }
        };
      });

      const roomById = new Map(rooms.map((room) => [room.id, room]));
      for (let index = 0; index < rooms.length; index += 1) {
        const room = rooms[index];
        room.routePrevious = rooms[index - 1]?.id || null;
        room.routeNext = rooms[index + 1]?.id || null;
        room.mapAdjacency = [];
      }
      for (let leftIndex = 0; leftIndex < rooms.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < rooms.length; rightIndex += 1) {
          const left = rooms[leftIndex];
          const right = rooms[rightIndex];
          const direction = rectAdjacencyDirection(left.referenceLayout.bounds, right.referenceLayout.bounds);
          if (!direction) continue;
          left.mapAdjacency.push({ roomId: right.id, direction });
          right.mapAdjacency.push({ roomId: left.id, direction: oppositeDirection(direction) });
        }
      }

      return {
        id: side.id,
        referenceName: side.name,
        roomCount: rooms.length,
        declaredRoomCount: side.roomCount,
        countDiscrepancy: side.roomCount === rooms.length ? null : {
          declared: side.roomCount,
          enumerated: rooms.length,
          note: "The pinned public catalog declares one more room than it enumerates. This must remain visible until independently resolved."
        },
        checkpoints,
        rooms
      };
    })
  }));
  return {
    schemaVersion: 1,
    game: "celeste",
    targetVersion: "PC 1.4.0.0 room-layout baseline; official 1.4.1.0 changelog tracked for behavior review",
    source: SOURCES.celesteCatalog,
    excludedFields: ["images", "tiles", "background art", "foreground art", "entity payloads", "audio", "text assets"],
    countDiscrepancies: chapters.flatMap((chapter) => chapter.sides
      .filter((side) => side.countDiscrepancy)
      .map((side) => ({ chapterId: chapter.id, sideId: side.id, ...side.countDiscrepancy }))),
    chapters
  };
}

async function loadCelesteCatalog() {
  if (shouldRefreshCeleste) {
    let source;
    if (celesteSourceFile) {
      source = JSON.parse(await readFile(celesteSourceFile, "utf8"));
    } else {
      const response = await fetch(BERRY_CAMP_SOURCE);
      if (!response.ok) throw new Error(`Unable to fetch Berry Camp snapshot: ${response.status} ${response.statusText}`);
      source = await response.json();
    }
    if (!Array.isArray(source.chapters) || source.chapters.length !== 11) {
      throw new Error("Unexpected Berry Camp catalog shape; refusing to overwrite the pinned local catalog");
    }
    const catalog = sanitizeCelesteCatalog(source);
    await mkdir(path.dirname(celesteCatalogPath), { recursive: true });
    await writeFile(celesteCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    return catalog;
  }
  try {
    return JSON.parse(await readFile(celesteCatalogPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Local Celeste catalog is missing. Run `npm run reference:catalog -- --refresh-celeste` once.");
    }
    throw error;
  }
}

function buildOriCatalog() {
  return {
    schemaVersion: 1,
    game: "ori-blind-forest-definitive-edition",
    targetVersion: "Ori and the Blind Forest: Definitive Edition",
    partitionPolicy: "Original local whitebox partitions derived from public maps and walkthrough progression; they are not claimed to be official rooms or exact coordinates.",
    sources: [SOURCES.oriLocations, SOURCES.oriWalkthrough, SOURCES.oriDeAreas],
    areas: ORI_AREAS,
    areaConnections: ORI_AREA_CONNECTIONS.map(([from, to, requirement]) => ({ from, to, requirement }))
  };
}

function initialStatus() {
  return {
    whitebox: "not-started",
    load: "not-loaded",
    playable: "not-playable",
    validation: "not-validated",
    automation: "not-run",
    browser: "not-run",
    continuousRun: "not-run"
  };
}

function buildCelesteEntries(catalog) {
  const entries = [];
  for (const chapter of catalog.chapters) {
    for (const side of chapter.sides) {
      for (const room of side.rooms) {
        const connections = [];
        if (room.routePrevious) connections.push({
          target: stableRoomId(chapter.id, side.id, room.routePrevious),
          direction: "route-previous",
          evidence: "public-checkpoint-order",
          confidence: "medium"
        });
        if (room.routeNext) connections.push({
          target: stableRoomId(chapter.id, side.id, room.routeNext),
          direction: "route-next",
          evidence: "public-checkpoint-order",
          confidence: "medium"
        });
        for (const adjacent of room.mapAdjacency) connections.push({
          target: stableRoomId(chapter.id, side.id, adjacent.roomId),
          direction: adjacent.direction,
          evidence: "public-map-adjacency-inference",
          confidence: "low"
        });
        const deduplicatedConnections = [...new Map(connections.map((connection) => [
          `${connection.target}:${connection.direction}`,
          connection
        ])).values()];
        const checkpointRooms = side.checkpoints.find((checkpoint) => checkpoint.id === room.checkpointId)?.roomOrder || [];
        const checkpointPosition = Math.max(0, checkpointRooms.indexOf(room.id));
        entries.push({
          id: stableRoomId(chapter.id, side.id, room.id),
          game: "celeste",
          sourceVersion: catalog.targetVersion,
          hierarchy: {
            chapterId: chapter.id,
            chapterReferenceName: chapter.referenceName,
            chapterLocalName: chapter.localName,
            sideId: side.id,
            checkpointId: room.checkpointId,
            checkpointReferenceName: room.checkpointName,
            referenceRoomId: room.id
          },
          localName: `${chapter.localName} · ${side.id.toUpperCase()} · ${room.checkpointId}-${String(checkpointPosition + 1).padStart(2, "0")}`,
          referenceLabel: room.referenceLabel,
          mapType: roomMapType(room.id, room),
          requiredAbilities: chapter.id === "prologue" ? ["jump", "wallGrab"] : ["wallGrab", "dash"],
          mechanisms: [...(CELESTE_MECHANICS[chapter.id] || ["dash"])],
          specialMechanisms: chapter.id === "farewell" || chapter.id === "core"
            ? [...(CELESTE_MECHANICS[chapter.id] || [])]
            : [],
          connections: deduplicatedConnections,
          possibleHiddenOrOptionalRoute: deduplicatedConnections.length > 2 || /z|b|sec|secret|alt/i.test(room.id),
          referenceLayout: room.referenceLayout,
          sourceRefs: [SOURCES.celesteCatalog.id, SOURCES.celesteWiki.id],
          sourceConfidence: "high-room-identity-medium-order-low-inferred-edges",
          dataFile: null,
          status: initialStatus(),
          unknownDifferences: [
            "Exact whitebox geometry and object placement have not been authored or browser-verified.",
            "Connections are provisional until the room is checked against public maps, guide/video evidence and legal gameplay observation."
          ]
        });
      }
    }
  }
  return entries;
}

function buildOriEntries(catalog) {
  const entries = [];
  const entryByShortId = new Map();
  for (const area of catalog.areas) {
    for (let index = 0; index < area.partitions.length; index += 1) {
      const item = area.partitions[index];
      const shortId = `${area.id}.${item.id}`;
      const entry = {
        id: oriPartitionId(area.id, item.id),
        game: "ori-blind-forest-definitive-edition",
        sourceVersion: catalog.targetVersion,
        hierarchy: {
          worldId: "nibel-whitebox",
          areaId: area.id,
          areaReferenceName: area.referenceName,
          areaLocalName: area.localName,
          partitionId: item.id,
          partitionOrder: index
        },
        localName: `${area.localName} · ${item.localName}`,
        referenceLabel: area.referenceName,
        mapType: item.mapType || area.mapType,
        requiredAbilities: [...area.requiredAbilities],
        mechanisms: [...area.mechanics],
        specialMechanisms: area.mechanics.filter((mechanic) => /escape|state|gravity|darkness|reconfiguring|pursuit|rising/.test(mechanic)),
        connections: [],
        possibleHiddenOrOptionalRoute: /optional|secret|hidden|revisit|return/.test(`${item.id} ${item.notes}`),
        sourceRefs: [SOURCES.oriLocations.id, SOURCES.oriWalkthrough.id, ...(area.id === "black-root-burrows" || area.id === "lost-grove" ? [SOURCES.oriDeAreas.id] : [])],
        sourceConfidence: "medium-area-identity-low-to-medium-local-partition-boundaries",
        dataFile: null,
        status: initialStatus(),
        unknownDifferences: [
          "This is an original local whitebox partition, not an official room boundary.",
          "Exact geometry, gates, pickups and state transitions require public-map and gameplay cross-checking."
        ],
        notes: item.notes
      };
      if (area.partitions[index - 1]) entry.connections.push({
        target: oriPartitionId(area.id, area.partitions[index - 1].id),
        direction: "area-previous",
        evidence: "local-partition-sequence",
        confidence: "medium"
      });
      if (area.partitions[index + 1]) entry.connections.push({
        target: oriPartitionId(area.id, area.partitions[index + 1].id),
        direction: "area-next",
        evidence: "local-partition-sequence",
        confidence: "medium"
      });
      entries.push(entry);
      entryByShortId.set(shortId, entry);
    }
  }
  for (const connection of catalog.areaConnections) {
    const from = entryByShortId.get(connection.from);
    const to = entryByShortId.get(connection.to);
    if (!from || !to) throw new Error(`Unknown Ori area connection: ${connection.from} -> ${connection.to}`);
    from.connections.push({
      target: to.id,
      direction: "world-connection",
      requirement: connection.requirement,
      evidence: "public-progression-and-local-partition-map",
      confidence: "medium"
    });
    if (connection.requirement !== "story") to.connections.push({
      target: from.id,
      direction: "world-return",
      requirement: connection.requirement,
      evidence: "definitive-edition-return-route-policy",
      confidence: "low-to-medium"
    });
  }
  return entries;
}

function computeTotals(celesteCatalog, oriCatalog, entries) {
  const celesteEntries = entries.filter((entry) => entry.game === "celeste");
  const oriEntries = entries.filter((entry) => entry.game !== "celeste");
  return {
    allRequiredEntries: entries.length,
    celeste: {
      chapters: celesteCatalog.chapters.length,
      sideSets: celesteCatalog.chapters.reduce((sum, chapter) => sum + chapter.sides.length, 0),
      rooms: celesteEntries.length,
      verified: celesteEntries.filter((entry) => entry.status.validation === "validated").length
    },
    ori: {
      worlds: 1,
      areas: oriCatalog.areas.length,
      partitions: oriEntries.length,
      verified: oriEntries.filter((entry) => entry.status.validation === "validated").length
    }
  };
}

function buildManifest(celesteCatalog, oriCatalog) {
  const entries = [...buildCelesteEntries(celesteCatalog), ...buildOriEntries(oriCatalog)];
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate reference manifest id: ${entry.id}`);
    ids.add(entry.id);
  }
  return {
    schemaVersion: 1,
    generatedFromLocalCatalogs: true,
    targetScope: {
      celeste: "Prologue, Chapters 1-8 A/B/C sides, Epilogue and Farewell, including public-catalog hidden and golden-room entries; PICO-8 is tracked separately.",
      ori: "Ori and the Blind Forest: Definitive Edition named areas, main progression, major optional routes, return routes, escapes and DE areas."
    },
    sourceCountDiscrepancies: celesteCatalog.countDiscrepancies,
    sources: Object.values(SOURCES),
    totals: computeTotals(celesteCatalog, oriCatalog, entries),
    optionalOutOfScope: [
      { id: "celeste.pico8", status: "listed-not-in-main-scope", reason: "Extra content; must not block main replication completion." },
      { id: "celeste.golden-repeat-rules", status: "future-rule-support", reason: "Repeated golden-strawberry challenges do not create duplicate room layouts." }
    ],
    entries
  };
}

async function loadOptionalOverrides(filePath, label) {
  try {
    const overrides = JSON.parse(await readFile(filePath, "utf8"));
    if (overrides.schemaVersion !== 1 || !overrides.entries || typeof overrides.entries !== "object") {
      throw new Error(`${label} must use schemaVersion 1 and define an entries object`);
    }
    return overrides;
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: 1, entries: {} };
    throw error;
  }
}

async function loadStatusOverrides() {
  const [generated, manual] = await Promise.all([
    loadOptionalOverrides(whiteboxIndexPath, "Generated whitebox index"),
    loadOptionalOverrides(statusOverridesPath, "Reference status overrides")
  ]);
  return {
    schemaVersion: 1,
    entries: { ...generated.entries, ...manual.entries }
  };
}

function applyStatusOverrides(manifest, overrides) {
  const entryById = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  for (const [entryId, override] of Object.entries(overrides.entries)) {
    const entry = entryById.get(entryId);
    if (!entry) throw new Error(`Status override references unknown manifest entry: ${entryId}`);
    const { status, ...fields } = override;
    Object.assign(entry, fields);
    if (status) entry.status = { ...entry.status, ...status };
    if (entry.status.whitebox !== "not-started" && !entry.dataFile) {
      throw new Error(`${entryId} has authored status but no local dataFile`);
    }
  }
  manifest.totals.celeste.verified = manifest.entries.filter((entry) => entry.game === "celeste" && entry.status.validation === "validated").length;
  manifest.totals.ori.verified = manifest.entries.filter((entry) => entry.game !== "celeste" && entry.status.validation === "validated").length;
  return manifest;
}

function entryCollectionId(entry) {
  return entry.game === "celeste"
    ? `celeste.${entry.hierarchy.chapterId}.${entry.hierarchy.sideId}`
    : `ori.${entry.hierarchy.areaId}`;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function fingerprintMatches(audit, currentFingerprint) {
  return Boolean(
    audit?.contentFingerprint?.algorithm === currentFingerprint.algorithm
    && audit?.contentFingerprint?.value === currentFingerprint.value
  );
}

async function applyEvidenceAudits(manifest) {
  const authoredEntries = manifest.entries.filter((entry) => entry.dataFile);
  for (const entry of authoredEntries) {
    entry.status.playable = "not-playable";
    entry.status.browser = "not-run";
    entry.status.continuousRun = "not-run";
    entry.status.validation = "not-validated";
    entry.humanConfirmation = "needed";
  }
  const collectionCount = new Set(authoredEntries.map(entryCollectionId)).size;
  const expectedTransitions = authoredEntries.length - collectionCount;
  const currentFingerprint = await referenceLibraryFingerprint(projectRoot, {
    dataFiles: authoredEntries.map((entry) => entry.dataFile)
  });
  const [continuousAudit, loadAudit, acceptanceAudit, graphAudit, fidelityAudit, performanceAudit] = await Promise.all([
    readOptionalJson(continuousRunAuditPath),
    readOptionalJson(browserLoadAuditPath),
    readOptionalJson(browserAcceptanceAuditPath),
    readOptionalJson(graphAuditPath),
    readOptionalJson(fidelityAuditPath),
    readOptionalJson(performanceAuditPath)
  ]);

  const continuousFingerprintMatches = fingerprintMatches(continuousAudit, currentFingerprint);
  const scopeMatches = Boolean(
    continuousAudit?.scope?.collections === collectionCount
    && continuousAudit?.scope?.rooms === authoredEntries.length
    && continuousAudit?.scope?.sequentialTransitions === expectedTransitions
  );
  const resultMatches = Boolean(
    continuousAudit?.result?.passedCollections === collectionCount
    && continuousAudit?.result?.visitedRooms === authoredEntries.length
    && continuousAudit?.result?.transitionsCompleted === expectedTransitions
    && continuousAudit?.result?.failedCollections === 0
    && continuousAudit?.result?.freshConsoleErrorsOrWarnings === 0
  );
  const policyAllowsUpgrade = Boolean(
    continuousAudit?.statusPolicy?.continuousRunStatusUpgraded === true
    && continuousAudit?.statusPolicy?.browserStatusUpgraded === false
    && continuousAudit?.statusPolicy?.validationStatusUpgraded === false
  );
  const continuousPass = continuousFingerprintMatches && scopeMatches && resultMatches && policyAllowsUpgrade;
  const loadPass = fingerprintMatches(loadAudit, currentFingerprint)
    && loadAudit?.scope?.rooms === authoredEntries.length
    && loadAudit?.result?.passed === authoredEntries.length
    && loadAudit?.result?.failed === 0
    && loadAudit?.result?.freshConsoleErrorsOrWarnings === 0;
  const acceptancePass = fingerprintMatches(acceptanceAudit, currentFingerprint)
    && acceptanceAudit?.scope?.rooms === authoredEntries.length
    && acceptanceAudit?.result?.passedRooms === authoredEntries.length
    && acceptanceAudit?.result?.failedRooms === 0
    && acceptanceAudit?.result?.entranceChecks > 0
    && acceptanceAudit?.result?.checkpointResetChecks >= authoredEntries.length
    && acceptanceAudit?.result?.connectionChecks > 0
    && acceptanceAudit?.result?.menuReentries === authoredEntries.length
    && acceptanceAudit?.result?.renderedRooms === authoredEntries.length
    && acceptanceAudit?.result?.finalCachedDocuments === 0
    && acceptanceAudit?.result?.freshConsoleErrorsOrWarnings === 0;
  const graphPass = fingerprintMatches(graphAudit, currentFingerprint)
    && graphAudit?.totals?.rooms === authoredEntries.length
    && graphAudit?.totals?.collections === collectionCount
    && graphAudit?.totals?.missingManifestConnections === 0
    && graphAudit?.totals?.invalidExitTargets === 0
    && graphAudit?.totals?.weaklyConnectedCollections === collectionCount
    && graphAudit?.totals?.strongFromFirstCollections === collectionCount;
  const fidelityPass = fingerprintMatches(fidelityAudit, currentFingerprint)
    && fidelityAudit?.totals?.entries === authoredEntries.length
    && fidelityAudit?.totals?.mappedMechanismUses === fidelityAudit?.totals?.mechanismUses
    && fidelityAudit?.unmappedMechanisms?.length === 0
    && fidelityAudit?.missingMappedObjects?.length === 0;
  const performancePass = fingerprintMatches(performanceAudit, currentFingerprint)
    && performanceAudit?.samples?.length >= 4
    && performanceAudit.samples.every((sample) => sample.averageFps >= 60)
    && performanceAudit?.freshConsoleErrorsOrWarnings === 0;
  const automationPass = authoredEntries.every((entry) => entry.status.automation === "passed" && entry.status.load === "loadable");
  const validationPass = automationPass && loadPass && acceptancePass && continuousPass && graphPass && fidelityPass && performancePass;

  manifest.auditEvidence = {
    contentFingerprint: currentFingerprint,
    browserLoad: { artifact: "levels/reference/browser-load-audit.json", fresh: fingerprintMatches(loadAudit, currentFingerprint), passed: loadPass },
    browserAcceptance: { artifact: "levels/reference/browser-acceptance-audit.json", fresh: fingerprintMatches(acceptanceAudit, currentFingerprint), passed: acceptancePass },
    continuousRun: {
      artifact: "levels/reference/continuous-run-audit.json",
      ranAt: continuousAudit?.ranAt || null,
      fresh: continuousFingerprintMatches,
      passed: continuousPass
    },
    graph: { artifact: "levels/reference/graph-audit.json", fresh: fingerprintMatches(graphAudit, currentFingerprint), passed: graphPass },
    fidelity: { artifact: "levels/reference/fidelity-audit.json", fresh: fingerprintMatches(fidelityAudit, currentFingerprint), passed: fidelityPass },
    performance: { artifact: "levels/reference/performance-audit.json", fresh: fingerprintMatches(performanceAudit, currentFingerprint), passed: performancePass },
    validationStatusUpgraded: validationPass
  };
  for (const entry of authoredEntries) {
    if (continuousPass) entry.status.continuousRun = "passed";
    if (acceptancePass && continuousPass) {
      entry.status.playable = "playable";
      entry.status.browser = "passed";
    }
    if (validationPass) entry.status.validation = "validated";
  }
  manifest.totals.celeste.verified = manifest.entries.filter((entry) => entry.game === "celeste" && entry.status.validation === "validated").length;
  manifest.totals.ori.verified = manifest.entries.filter((entry) => entry.game !== "celeste" && entry.status.validation === "validated").length;
  return manifest;
}

function buildPlayableIndex(manifest) {
  const authoredEntries = manifest.entries.filter((entry) => entry.dataFile);
  const collectionById = new Map();
  for (const entry of authoredEntries) {
    const hierarchy = entry.hierarchy;
    const collectionId = entry.game === "celeste"
      ? `celeste.${hierarchy.chapterId}.${hierarchy.sideId}`
      : `ori.${hierarchy.areaId}`;
    if (!collectionById.has(collectionId)) {
      collectionById.set(collectionId, {
        id: collectionId,
        game: entry.game,
        localName: entry.game === "celeste"
          ? `${hierarchy.chapterLocalName} · ${hierarchy.sideId.toUpperCase()}`
          : hierarchy.areaLocalName,
        roomIds: []
      });
    }
    collectionById.get(collectionId).roomIds.push(entry.id);
  }
  return {
    schemaVersion: 1,
    manifestPath: "levels/reference/manifest.json",
    collections: [...collectionById.values()],
    rooms: Object.fromEntries(authoredEntries.map((entry) => [entry.id, {
      id: entry.id,
      game: entry.game,
      localName: entry.localName,
      mapType: entry.mapType,
      hierarchy: entry.hierarchy,
      dataFile: entry.dataFile,
      connections: entry.connections,
      status: entry.status
    }]))
  };
}

function sourceList(sources) {
  return sources.map((source) => `- [${source.title}](${source.url}) — ${source.confidence}; ${source.usage}`).join("\n");
}

function buildScopeDocument(manifest) {
  return `# 参考关卡白盒复刻范围\n\n` +
`## 目标与边界\n\n` +
`本地关卡库只复现区域/房间结构、连接顺序、空间拓扑、挑战节奏和机制组合。所有可游玩内容使用 Cablester 自己的 Canvas 几何、占位表现和原创本地名称。不得复制、导入或提取原作美术、贴图、音频、字体、剧情文本、角色素材、瓦片、实体 payload 或安装目录文件。\n\n` +
`参考研究仅使用合法游戏体验、公开地图、攻略和公开视频。公开来源中的房间坐标只作为拓扑研究依据，不作为可发布资产，也不声称是精确官方坐标。不能确认的连接、尺寸或机制必须保留为低置信度和待核对差异。\n\n` +
`## 目标版本与总量\n\n` +
`| 游戏 | 目标版本 | 层级 | 必需总量 | 当前已验证 |\n|---|---|---:|---:|---:|\n` +
`| Celeste | PC 1.4.0.0 房间布局基线；同时跟踪官方 1.4.1.0 行为变更 | ${manifest.totals.celeste.chapters} 章节 / ${manifest.totals.celeste.sideSets} 个 Side 集合 | ${manifest.totals.celeste.rooms} 房间 | ${manifest.totals.celeste.verified} |\n` +
`| Ori 1 | Ori and the Blind Forest: Definitive Edition | 1 世界 / ${manifest.totals.ori.areas} 区域 | ${manifest.totals.ori.partitions} 个原创白盒分区 | ${manifest.totals.ori.verified} |\n\n` +
`Celeste 的 ${manifest.totals.celeste.rooms} 个可枚举唯一房间包含公开目录列出的主要隐藏房、收集路线房和 Farewell 金草莓附加房；不为不改变布局的金草莓重复挑战复制地图。PICO-8 只列入额外清单，不计入主范围完成率。\n\n` +
`来源计数存在一处公开差异：Berry Camp Side 声明值合计 805，但固定 JSON 快照只枚举 804 个唯一房间。差异全部来自 Summit B-Side（声明 29、枚举 28）；其 7 个分段各枚举 4 房，社区章节资料也描述每个分段恰有 4 房，所以清单采用 28 和总计 ${manifest.totals.celeste.rooms}。该差异在后续合法游戏体验核对前保持公开，不虚构第 29 房。\n\n` +
`Ori 没有稳定的官方“房间”边界，因此使用 ${manifest.totals.ori.areas} 个公开命名区域和 ${manifest.totals.ori.partitions} 个原创本地分区。分区是加载、重置和验证单位，不被描述成原作官方房间。连续世界连接、回访能力门和状态变化仍按世界级图保存。\n\n` +
`## 来源和可信度\n\n${sourceList(manifest.sources)}\n\n` +
`可信度规则：\n\n` +
`- high：官方版本信息或固定公开目录中的稳定 ID/计数；\n` +
`- medium：多个公开地图、攻略或视频可以相互印证的拓扑/顺序；\n` +
`- low：由地图邻接、房间排列或单一资料推定，必须在白盒制作前再次核对；\n` +
`- 任何近似都必须保留在 manifest 的 \`unknownDifferences[]\`，不能在验证前升级为“精确复刻”。\n\n` +
`## 不在范围内的动作\n\n` +
`- 不发布、不部署、不推送远端；\n` +
`- 不迁移 Godot；\n` +
`- 不解包原作安装目录；\n` +
`- 不保存 Berry Camp 的图片、瓦片或实体数据；\n` +
`- 不用原作故事文本、字体、音乐、音效或角色资产。\n`;
}

function buildManifestDocument(manifest, celesteCatalog, oriCatalog) {
  const sideRows = [];
  for (const chapter of celesteCatalog.chapters) {
    for (const side of chapter.sides) {
      const verified = manifest.entries.filter((entry) => entry.game === "celeste" && entry.hierarchy.chapterId === chapter.id && entry.hierarchy.sideId === side.id && entry.status.validation === "validated").length;
      sideRows.push(`| ${markdownEscape(chapter.referenceName)} | ${side.id.toUpperCase()} | ${side.checkpoints.length} | ${side.roomCount} | ${verified} |`);
    }
  }
  const celesteRows = manifest.entries.filter((entry) => entry.game === "celeste").map((entry) => {
    const h = entry.hierarchy;
    const status = `${entry.status.whitebox} / ${entry.status.load} / ${entry.status.playable} / ${entry.status.validation}`;
    const dataFile = entry.dataFile ? `[JSON](../${entry.dataFile})` : "—";
    return `| \`${entry.id}\` | ${markdownEscape(h.chapterReferenceName)} / ${h.sideId.toUpperCase()} / ${markdownEscape(h.checkpointReferenceName)} / \`${h.referenceRoomId}\` | ${markdownEscape(entry.localName)} | ${entry.mapType} | ${entry.mechanisms.join(", ")} | ${entry.connections.length} | ${status} | ${dataFile} | ${markdownEscape(entry.unknownDifferences.join(" "))} |`;
  });
  const oriRows = manifest.entries.filter((entry) => entry.game !== "celeste").map((entry) => {
    const h = entry.hierarchy;
    const status = `${entry.status.whitebox} / ${entry.status.load} / ${entry.status.playable} / ${entry.status.validation}`;
    const dataFile = entry.dataFile ? `[JSON](../${entry.dataFile})` : "—";
    return `| \`${entry.id}\` | ${markdownEscape(h.areaReferenceName)} / \`${h.partitionId}\` | ${markdownEscape(entry.localName)} | ${entry.mapType} | ${entry.mechanisms.join(", ")} | ${entry.connections.length} | ${status} | ${dataFile} | ${markdownEscape(entry.unknownDifferences.join(" "))} |`;
  });
  return `# 参考关卡完整清单\n\n` +
`机器可读权威清单位于 [\`levels/reference/manifest.json\`](../levels/reference/manifest.json)。本文件由本地净化目录生成，方便人工审阅；任何状态修改必须先更新机器清单或后续状态工具，再重新生成本文档。\n\n` +
`## 总量\n\n` +
`| 范围 | 章节/区域 | Side | 房间/分区 | 已验证 |\n|---|---:|---:|---:|---:|\n` +
`| Celeste 主范围 | ${manifest.totals.celeste.chapters} | ${manifest.totals.celeste.sideSets} | ${manifest.totals.celeste.rooms} | ${manifest.totals.celeste.verified} |\n` +
`| Ori DE 主范围 | ${manifest.totals.ori.areas} | — | ${manifest.totals.ori.partitions} | ${manifest.totals.ori.verified} |\n` +
`| 合计 | — | — | ${manifest.totals.allRequiredEntries} | ${manifest.totals.celeste.verified + manifest.totals.ori.verified} |\n\n` +
`状态顺序固定为：白盒 / 加载 / 可游玩 / 验证。每项还单独记录自动验证、浏览器试玩和章节/区域连续通关；只有 \`validation=validated\` 才计入完成数。\n\n` +
`来源目录的 Side 声明值合计为 805，但实际唯一 ID 枚举为 ${manifest.totals.celeste.rooms}。唯一差异是 Summit B-Side 声明 29、枚举 28；主清单采用可审计的唯一 ID 数量。\n\n` +
`## Celeste 章节与 Side 计数\n\n| 章节 | Side | 检查点组 | 房间 | 已验证 |\n|---|---:|---:|---:|---:|\n${sideRows.join("\n")}\n\n` +
`## Ori 区域与分区计数\n\n| 公开命名区域 | 本地原创区域名 | 地图类型 | 分区 | 已验证 |\n|---|---|---|---:|---:|\n` +
`${oriCatalog.areas.map((area) => {
  const verified = manifest.entries.filter((entry) => entry.game !== "celeste" && entry.hierarchy.areaId === area.id && entry.status.validation === "validated").length;
  return `| ${markdownEscape(area.referenceName)} | ${area.localName} | ${area.mapType} | ${area.partitions.length} | ${verified} |`;
}).join("\n")}\n\n` +
`## Celeste 全房间清单（${manifest.totals.celeste.rooms}）\n\n` +
`连接数包含公开检查点顺序和地图邻接推定；在逐房间核对前只代表“候选连接”。\n\n` +
`| 稳定本地 ID | 参考层级 | 原创本地名称 | 类型 | 机制（章节级初始标注） | 候选连接 | 状态 | 数据文件 | 尚未确认差异 |\n|---|---|---|---|---|---:|---|---|---|\n${celesteRows.join("\n")}\n\n` +
`## Ori 全分区清单（${manifest.totals.ori.partitions}）\n\n` +
`| 稳定本地 ID | 参考区域 / 分区 | 原创本地名称 | 类型 | 机制（区域级初始标注） | 候选连接 | 状态 | 数据文件 | 尚未确认差异 |\n|---|---|---|---|---|---:|---|---|---|\n${oriRows.join("\n")}\n\n` +
`## 额外内容\n\n- \`celeste.pico8\`：已列入额外清单，不影响主范围完成率。\n- 金草莓等不改变布局的重复挑战：保留未来规则挂点，不复制独立地图。\n`;
}

function buildMechanicsDocument(manifest, celesteCatalog, oriCatalog) {
  const celesteRows = celesteCatalog.chapters.map((chapter) => {
    const sideText = chapter.sides.map((side) => side.id.toUpperCase()).join("/");
    const requiredSystems = (CELESTE_MECHANICS[chapter.id] || []).join(", ");
    const mapping = chapter.id === "farewell"
      ? "八向冲刺 + dashRefill；滑翔等价水母；猛击/发射器等价河豚与弹射；保留耐力长房节奏"
      : chapter.id === "core"
        ? "可配置多次冲刺恢复；冷热状态、传送带和定时危险物数据化"
        : "八向冲刺、墙抓/墙跳；大跨度只在不绕过主路线时使用绳/杆/猛击";
    return `| ${markdownEscape(chapter.referenceName)} | ${sideText} | ${requiredSystems} | ${mapping} | 房间级矩阵待逐批核对 |`;
  });
  const oriRows = oriCatalog.areas.map((area) => `| ${markdownEscape(area.referenceName)} | ${area.requiredAbilities.join(", ")} | ${area.mechanics.join(", ")} | ${area.mechanics.some((mechanic) => /escape/.test(mechanic)) ? "是" : "否"} | 区域级初始标注，分区制作前再核对 |`);
  const mechanismSet = unique(manifest.entries.flatMap((entry) => entry.mechanisms)).sort();
  return `# 参考关卡机制矩阵\n\n` +
`本矩阵先记录章节/区域级需求，防止在缺少证据时提前堆功能。房间或分区进入制作批次时，必须把使用机制细化到对应 manifest 条目，并补齐运行时、视觉、工坊、属性编辑、JSON 编译/反编译、validator、固定时间步测试、重置、屏幕外策略和实际关卡验证。\n\n` +
`## Celeste\n\n| 章节 | Side | 参考机制族 | Cablester 等价映射 | 当前可信度 |\n|---|---|---|---|---|\n${celesteRows.join("\n")}\n\n` +
`## Ori 1 Definitive Edition\n\n| 区域 | 主要能力/门 | 参考机制族 | 含逃亡段 | 当前可信度 |\n|---|---|---|---:|---|\n${oriRows.join("\n")}\n\n` +
`## 已识别机制全集（${mechanismSet.length}）\n\n${mechanismSet.map((mechanism) => `- \`${mechanism}\``).join("\n")}\n\n` +
`## 首批通用机制优先级\n\n` +
`1. \`dashRefill\`：支持恢复一次或多次冲刺、一次性/重生、连续接触去抖、死亡/房间重置和可用状态反馈。\n` +
`2. 数据驱动移动物件：路径点、速度、加速度、停留、缓动、循环/往返、触发方式、重置和屏幕外策略。\n` +
`3. 稳定移动平台携带与高速连续碰撞；移动墙、移动危险物、移动锚点/猛击支点复用同一轨迹核心。\n` +
`4. 只有代表性章节/区域清点确认后，才按需加入碎裂平台、弹簧/发射器、门/能力门、风场移动版、追逐和世界状态变化。\n\n` +
`## 当前实现状态（2026-08-09）\n\n` +
`- \`dashRefill\` 已接入运行时、工坊属性、JSON 编译/反编译、validator、视觉、HUD 多次冲刺计数、接触去抖、补满/增量、一次性/重生和死亡重置；\n` +
`- \`movingObject\` 已支持平台、危险物、锚点和猛击支点，使用统一多节点轨迹核心，包含速度、加速度、停留、三种缓动、循环/往返/单次、自动/接触/开关触发、死亡/房间/保持重置和三种屏幕外策略；\n` +
`- 移动平台已实现站立携带、动态抓取表面和高速扫掠碰撞；移动危险物使用同一位置状态并参与伤害扫掠；\n` +
`- 发射器、碎裂平台、能力/状态门和世界状态触发区已接入运行时、工坊、编译/反编译、validator、视觉与死亡重置；世界标记可跨参考房间保存；\n` +
`- 水、危险液体和熔岩使用统一 \`liquidZone\`：支持重力倍率、阻力、水流、游动输入、接触伤害、工坊属性和 JSON 往返；\n` +
`- \`darknessZone\` 支持区域强度、玩家照明半径和世界标记解除，并已进入运行时、工坊、JSON、validator 与视觉；\n` +
`- 固定步测试覆盖确定性、触发、屏幕外策略、往返、接触去抖、重生、一次性、门闩保持、世界标记、死亡重置和高速平台接触。\n`;
}

function buildValidationDocument(manifest, { loadAudit, acceptanceAudit, continuousAudit, performanceAudit }) {
  const authoredCount = manifest.entries.filter((entry) => entry.dataFile).length;
  const automationPassedCount = manifest.entries.filter((entry) => entry.status.automation === "passed").length;
  const browserPassedCount = manifest.entries.filter((entry) => entry.status.browser === "passed").length;
  const continuousRunPassedCount = manifest.entries.filter((entry) => entry.status.continuousRun === "passed").length;
  const loadResult = loadAudit?.result || {};
  const acceptanceResult = acceptanceAudit?.result || {};
  const continuousResult = continuousAudit?.result || {};
  const performanceRows = (performanceAudit?.samples || []).map((sample) =>
    `| \`${sample.roomId}\` | ${sample.viewport} | ${sample.averageFps} | ${sample.averageFrameMs} | ${sample.p95FrameMs} | ${sample.worstFrameMs} | ${sample.activeObjects}/${sample.drawnObjects}/${sample.collisionCandidates} |`
  ).join("\n");
  return `# 参考关卡验证与性能记录\n\n` +
`## 状态模型\n\n` +
`每个必需条目必须独立记录：\n\n` +
`- \`whitebox\`：\`not-started\` / \`authored\`;\n` +
`- \`load\`：\`not-loaded\` / \`loadable\`;\n` +
`- \`playable\`：\`not-playable\` / \`playable\`;\n` +
`- \`validation\`：\`not-validated\` / \`validated\`;\n` +
`- \`automation\`、\`browser\`、\`continuousRun\`：\`not-run\` / \`passed\` / \`failed\` / \`human-confirmation-needed\`.\n\n` +
`当前：${manifest.totals.allRequiredEntries} 个必需条目中 ${manifest.totals.celeste.verified + manifest.totals.ori.verified} 个已验证。清单完成不等于白盒、可加载或可游玩。\n\n` +
`## 改造前基线（2026-08-09）\n\n` +
`测试设备：MacBook Pro (Mac15,6)，Apple M3 Pro 11 核，18 GB 内存，macOS 14.4，arm64。\n\n` +
`| 项目 | 结果 |\n|---|---|\n` +
`| \`npm test\` | 52/52 通过，0 失败，Node test 总耗时约 75 ms |\n` +
`| \`npm run check\` | 原有 10/10 关通过结构校验 |\n` +
`| 浏览器启动 | 1280×720 视口、DPR 2；关卡菜单和 \`combined-horizontal\` 可加载 |\n` +
`| Canvas 绘制缓冲 | 调试层报告 2278×1281，约 1.78× CSS 比例 |\n` +
`| 浏览器控制台 | 启动、选关和 1 秒静置后 0 error / 0 warning |\n` +
`| FPS / 帧耗时 | 待加入只读帧统计调试计数后复测；在任何裁剪或空间索引优化前记录 |\n` +
`| 活动物件 / 绘制物件 / 碰撞候选 | 当前运行时未统计；必须在性能优化前加入调试计数 |\n\n` +
`现有运行时在更新、碰撞和绘制路径中直接遍历整关集合，不能作为 Ori 连续世界或 ${manifest.totals.celeste.rooms} 房间库的最终架构。\n\n` +
`## 首批架构里程碑（2026-08-09）\n\n` +
`| 项目 | 结果 |\n|---|---|\n` +
`| \`npm test\` | 80/80 通过；${automationPassedCount}/${authoredCount} 个本地文件已通过自动解析、编译、结构和出口目标检查 |\n` +
`| \`npm run check\` | 原有 10 关与 ${authoredCount} 个已制作参考房间全部通过结构校验 |\n` +
`| 浏览器按需加载 | ${browserPassedCount}/${authoredCount} 可从菜单独立加载；修复 fetch 上下文问题后新鲜运行 0 error / 0 warning |\n` +
`| 1600×1000 | Ori 复苏洼地：约 121.6 FPS，平均 8.23 ms，P95 9.60 ms，最差 10.20 ms；active/drawn/collision 10/10/10 |\n` +
`| 800×900 | Celeste ST-1-01：约 122.3 FPS，平均 8.18 ms，P95 9.90 ms，最差 10.40 ms；active/drawn/collision 12/12/14 |\n\n` +
`机制接入后在 1280×720 的 Celeste ST-1-03 实测约 120.7 FPS、平均 8.29 ms、P95 10.20 ms、最差 10.30 ms，active/drawn/collision 13/13/7；截图捕获时的短暂最差帧不计入稳定窗口。\n\n` +
`完整首轮白盒库接入后，菜单只渲染每页 24 个参考卡片，并按 27 个 Celeste Side 集合与 17 个 Ori 区域筛选；浏览器抽样加载 Farewell ST-1-01、Ori 熔火山心终局逃亡和含四类新机关的 Celeste CR-2-01，新鲜控制台均为 0 error / 0 warning。CR-2-01 首测暴露了靠边出生后立即触发出口的问题，随后加入安全出生内缩、入口内缩和切房冷却并复测通过。该抽样不等于其余自动白盒已完成逐房浏览器验收，因此它们的 \`browser\` 状态保持 \`not-run\`。\n\n` +
`随后通过真实页面的“浏览器加载审计”依次对 ${loadResult.passed ?? 0}/${authoredCount} 房间执行本地 JSON 获取、文档校验/编译、默认出生与全部 ${loadResult.entrancesInitialized ?? 0} 个入口出生的 Game 运行时初始化，以及至少一帧绘制；当前指纹内容上的全量复测耗时 ${loadResult.elapsedSeconds ?? "未记录"} 秒，失败 ${loadResult.failed ?? "未记录"}，本轮控制台 error/warning ${loadResult.freshConsoleErrorsOrWarnings ?? "未记录"}。机器记录位于 [\`levels/reference/browser-load-audit.json\`](../levels/reference/browser-load-audit.json)。这仍不是路线通关、死亡重置、手感或高保真验收，所以不会单独据此升级逐房 \`browser\` 状态。\n\n` +
`同一最终指纹又在真实页面执行“逐房综合验收”：${acceptanceResult.passedRooms ?? 0}/${authoredCount} 房逐一核对 ${acceptanceResult.entranceChecks ?? 0} 个入口合法出生、${acceptanceResult.checkpointResetChecks ?? 0} 次检查点死亡重置与血蓝/冲刺/速度恢复、机关固定步状态、${acceptanceResult.connectionChecks ?? 0} 个实际出口对象到目标入口的初始化、${acceptanceResult.renderedRooms ?? 0} 次渲染及返回菜单后清缓存重进；峰值活动物件 ${acceptanceResult.peakActiveObjects ?? "未记录"}，结束缓存 ${acceptanceResult.finalCachedDocuments ?? "未记录"}，耗时 ${acceptanceResult.elapsedSeconds ?? "未记录"} 秒，失败 ${acceptanceResult.failedRooms ?? "未记录"}，控制台 error/warning ${acceptanceResult.freshConsoleErrorsOrWarnings ?? "未记录"}。记录位于 [\`levels/reference/browser-acceptance-audit.json\`](../levels/reference/browser-acceptance-audit.json)。它与连续物理输入审计共同为逐房 \`playable/browser\` 状态提供证据；主观手感仍保持 \`humanConfirmation=needed\`。\n\n` +
`连接图审计覆盖 908 房、44 个集合和 3678 条 manifest 候选连接：3678/3678 已有 JSON 出口，目标/入口无效项为 0；44/44 集合弱连通，且从各集合首房在候选有向图中正反向都可覆盖全集合。完整记录位于 [\`docs/REFERENCE_GRAPH_AUDIT.md\`](REFERENCE_GRAPH_AUDIT.md) 和 [\`levels/reference/graph-audit.json\`](../levels/reference/graph-audit.json)。这同样不等于实际输入通关。\n\n` +
`菜单为每个 Side/区域提供“从首房连续开始”，切房时保留能力、世界标记、检查点和访问记录。最终浏览器自动连续审计使用真实 Game 固定步、碰撞、死亡/房间重置和异步出口加载，不传送也不直接修改角色状态；进度敏感输入逐一走完 ${continuousResult.passedCollections ?? 0}/${continuousAudit?.scope?.collections ?? 0} 个集合、${continuousResult.visitedRooms ?? 0} 房和 ${continuousResult.transitionsCompleted ?? 0} 次连续切房，${continuousResult.deathsOrResets ?? 0} 次死亡重置、失败 ${continuousResult.failedCollections ?? "未记录"}、耗时 ${continuousResult.elapsedSeconds ?? "未记录"} 秒，本轮控制台 error/warning ${continuousResult.freshConsoleErrorsOrWarnings ?? "未记录"}。因此与内容指纹匹配的 ${continuousRunPassedCount}/${authoredCount} 条目升级为 \`continuousRun=passed\`。机器记录位于 [\`levels/reference/continuous-run-audit.json\`](../levels/reference/continuous-run-audit.json)；任何运行时、样式或房间 JSON 改动都会使指纹失配并自动撤销该状态。这证明每个集合的一条顺序主路线；所有支路出口由逐房综合验收和连接图覆盖，但人工手感或原作坐标/美术保真不由自动化替代。\n\n` +
`保真度差异审计位于 [\`docs/REFERENCE_FIDELITY_AUDIT.md\`](REFERENCE_FIDELITY_AUDIT.md) 和 [\`levels/reference/fidelity-audit.json\`](../levels/reference/fidelity-audit.json)：每条条目-机制使用都必须有明确等价系统，并另行报告当前 JSON 是否实际存在对应对象或能力。当前工程 \`validated\` 为 ${manifest.totals.celeste.verified + manifest.totals.ori.verified}/${authoredCount}；这表示全部指纹化工程证据闭环，不等于原作位置、节奏、视觉或手感已经由真人确认。\n\n` +
`CR-2-01 在 1280×720 调试层短窗口约 122.2 FPS、平均 8.18 ms、P95 10.20 ms、最差 16.80 ms，active/drawn/collision 27/27/22。\n\n` +
`Ori 月影洞“西侧深降”液体白盒在同一 1280×720 浏览器短窗口约 122.1 FPS、平均 8.19 ms、P95 9.30 ms、最差 17.00 ms，active/drawn/collision 26/26/34；液体区域可见并且控制台无新增错误。\n\n` +
`Celeste 镜暗神殿 ST-1-01 黑暗白盒在 1280×720 约 120.9 FPS、平均 8.27 ms、P95 10.10 ms、最差 18.40 ms，active/drawn/collision 32/32/42；照明半径可见且控制台无新增错误。\n\n` +
`当前指纹性能复验使用浏览器真实 \`requestAnimationFrame\` 滚动帧样本；机器记录位于 [\`levels/reference/performance-audit.json\`](../levels/reference/performance-audit.json)。\n\n` +
`| 房间 | 视口 | 平均 FPS | 平均 ms | P95 ms | 最差 ms | active/drawn/collision |\n|---|---:|---:|---:|---:|---:|---:|\n${performanceRows || "| 未记录 | - | - | - | - | - | - |"}\n\n` +
`这些数字是静置或短输入白盒的开发机观测值，不代表连续移动、大型区域或完整章节最终性能；后续机制与地图批次仍须重复测量。\n\n` +
`## 自动验证门槛\n\n` +
`持续运行 \`npm test\` 和 \`npm run check\`。新增覆盖必须包括：manifest/文件存在性、文档解析/编译、全局 ID 唯一、入口出口引用、双向连接、边界、能力/物件注册、移动路径、固定时间步确定性、高速平台、平台携带、dashRefill 去抖/消耗/重生/死亡重置、机关保存恢复、房间死亡重置和旧十关回归。测试不得假设项目永远只有十关。\n\n` +
`## 浏览器逐房间验收记录规则\n\n` +
`每个房间/分区必须记录入口、出口、合法出生可完成、死亡快速重试、检查点、机关重置、资源软锁、移动碰撞、相机提示、控制台和返回菜单重进。每章/区域还需至少一次连续入口到出口试玩。不能自动化的手感问题标为 \`human-confirmation-needed\`，不能伪装成通过。\n\n` +
`## 视口与性能门槛\n\n` +
`- 逻辑坐标保持 1280×720；\n` +
`- 分别验证 1600×1000 和 800×900；\n` +
`- 代表性大型 Ori 区域目标接近稳定 60 FPS；\n` +
`- 记录平均 FPS、P95/最差帧、活动/绘制/碰撞候选计数；\n` +
`- 连续死亡、切房和切章后活动对象及内存不得持续增长；\n` +
`- 完成前必须给出设备、方法、平均值和最差值，不能只写“感觉流畅”。\n`;
}

async function main() {
  const celesteCatalog = await loadCelesteCatalog();
  const oriCatalog = buildOriCatalog();
  const overrides = await loadStatusOverrides();
  let manifest = applyStatusOverrides(buildManifest(celesteCatalog, oriCatalog), overrides);
  manifest = await applyEvidenceAudits(manifest);
  const playableIndex = buildPlayableIndex(manifest);
  const [loadAudit, acceptanceAudit, continuousAudit, performanceAudit] = await Promise.all([
    readOptionalJson(browserLoadAuditPath),
    readOptionalJson(browserAcceptanceAuditPath),
    readOptionalJson(continuousRunAuditPath),
    readOptionalJson(performanceAuditPath)
  ]);

  await mkdir(path.dirname(oriCatalogPath), { recursive: true });
  await writeFile(oriCatalogPath, `${JSON.stringify(oriCatalog, null, 2)}\n`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(playableIndexPath, `${JSON.stringify(playableIndex, null, 2)}\n`);
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_REPLICATION_SCOPE.md"), buildScopeDocument(manifest));
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_LEVEL_MANIFEST.md"), buildManifestDocument(manifest, celesteCatalog, oriCatalog));
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_MECHANICS_MATRIX.md"), buildMechanicsDocument(manifest, celesteCatalog, oriCatalog));
  await writeFile(path.join(projectRoot, "docs", "REFERENCE_VALIDATION.md"), buildValidationDocument(manifest, {
    loadAudit,
    acceptanceAudit,
    continuousAudit,
    performanceAudit
  }));

  console.log(`Reference catalog generated: ${manifest.totals.celeste.rooms} Celeste rooms, ${manifest.totals.ori.areas} Ori areas / ${manifest.totals.ori.partitions} partitions.`);
}

await main();
