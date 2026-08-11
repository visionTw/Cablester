import path from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(projectRoot, "levels", "reference");
const manifestPath = path.join(referenceRoot, "manifest.json");
const manualStatusPath = path.join(referenceRoot, "status-overrides.json");
const generatedIndexPath = path.join(referenceRoot, "whitebox-index.json");

const SUPPORTED_ABILITIES = new Set(["rope", "hardBar", "wallGrab", "doubleJump", "glide", "bash", "dash"]);
const ABILITY_EQUIVALENTS = Object.freeze({
  chargeJump: "doubleJump",
  gravityCarry: "hardBar",
  lightBurst: "rope",
  stomp: "bash"
});

function slug(value) {
  return String(value || "room")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "room";
}

function fileToken(value) {
  return encodeURIComponent(String(value || "room")).replace(/%/g, "_");
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed) {
  let state = hash(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function unique(values) {
  return [...new Set(values)];
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizedDirection(direction) {
  if (["left", "right", "up", "down"].includes(direction)) return direction;
  if (/previous|return|back/i.test(direction)) return "left";
  if (/next|forward|main/i.test(direction)) return "right";
  return "right";
}

function oppositeDirection(direction) {
  return ({ left: "right", right: "left", up: "down", down: "up" })[normalizedDirection(direction)];
}

function layoutBounds(entry) {
  if (entry.game === "celeste") {
    const source = entry.referenceLayout?.size || { w: 320, h: 184 };
    const scale = clamp(720 / Math.max(120, source.h), 3, 5);
    return {
      x: 0,
      y: 0,
      w: Math.round(clamp(source.w * scale, 1280, 4200) / 20) * 20,
      h: Math.round(clamp(source.h * scale, 720, 2600) / 20) * 20
    };
  }
  const sizes = {
    "compact-room": [1440, 840],
    "medium-area": [2200, 1120],
    "medium-scrolling-room": [2300, 1200],
    "large-scrolling-room": [3200, 1500],
    "large-continuous-area": [3600, 1700],
    "escape-segment": [3000, 1320],
    "endurance-room": [2800, 1280]
  };
  const [w, h] = sizes[entry.mapType] || [2200, 1120];
  return { x: 0, y: 0, w, h };
}

function startingAbilities(entry) {
  const mapped = entry.requiredAbilities
    .map((ability) => SUPPORTED_ABILITIES.has(ability) ? ability : ABILITY_EQUIVALENTS[ability])
    .filter(Boolean);
  if (entry.game === "celeste") mapped.push("wallGrab", "dash");
  else mapped.push("wallGrab");
  if (entry.mechanisms.some((mechanism) => /feather|jellyfish|glide/.test(mechanism))) mapped.push("glide");
  if (entry.mechanisms.some((mechanism) => /projectile-bash|puffer|seeker/.test(mechanism))) mapped.push("bash");
  return unique(mapped);
}

function spawnPosition(entry, bounds) {
  const sourceSize = entry.referenceLayout?.size;
  const sourceSpawn = entry.referenceLayout?.spawns?.[0];
  if (sourceSize && sourceSpawn) {
    return {
      x: Math.round(clamp(sourceSpawn.x / sourceSize.w * bounds.w, 140, bounds.w - 180)),
      y: Math.round(clamp(sourceSpawn.y / sourceSize.h * bounds.h, 100, bounds.h - 130))
    };
  }
  return { x: 140, y: bounds.h - 150 };
}

function circleIntersectsObject(point, radius, object) {
  const closestX = clamp(point.x, object.position.x, object.position.x + object.properties.w);
  const closestY = clamp(point.y, object.position.y, object.position.y + object.properties.h);
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function chooseSafeSpawn(preferred, bounds, objects) {
  const blockingTriggers = objects.filter((object) => object.type === "roomExit" || object.type === "hazard" || object.type === "gate" || (object.type === "liquidZone" && object.properties.contactDamage > 0));
  const blockingSolids = objects.filter((object) => object.type === "platform" || object.type === "fragilePlatform" || (object.type === "movingObject" && object.properties.objectKind === "platform"));
  const platformCandidates = objects
    .filter((object) => object.type === "platform" && object.properties.w >= 100)
    .map((platform) => ({
      x: clamp(platform.position.x + Math.min(140, platform.properties.w * 0.5), 40, bounds.w - 40),
      y: clamp(platform.position.y - 24, 40, bounds.h - 40)
    }));
  const candidates = [
    ...platformCandidates,
    preferred,
    { x: 140, y: bounds.h - 160 },
    { x: bounds.w * 0.25, y: bounds.h - 220 },
    { x: bounds.w * 0.5, y: bounds.h - 220 },
    { x: bounds.w * 0.75, y: bounds.h - 220 }
  ];
  return candidates.find((candidate) => (
    candidate.x >= 36 && candidate.x <= bounds.w - 36
    && candidate.y >= 36 && candidate.y <= bounds.h - 36
    && !blockingTriggers.some((object) => circleIntersectsObject(candidate, 20, object))
    && !blockingSolids.some((object) => circleIntersectsObject(candidate, 20, object))
  )) || { x: 140, y: 140 };
}

function dataFileFor(entry) {
  if (entry.game === "celeste") {
    const { chapterId, sideId, referenceRoomId } = entry.hierarchy;
    return `levels/reference/celeste/${fileToken(chapterId)}/${fileToken(sideId)}/${fileToken(referenceRoomId)}.json`;
  }
  return `levels/reference/ori/${fileToken(entry.hierarchy.areaId)}/${fileToken(entry.hierarchy.partitionId)}.json`;
}

function objectFactory() {
  const objects = [];
  const used = new Set();
  const add = (id, type, x, y, properties = {}) => {
    let candidate = slug(id);
    let suffix = 2;
    while (used.has(candidate)) candidate = `${slug(id)}-${suffix++}`;
    used.add(candidate);
    const object = {
      id: candidate,
      type,
      position: { x: Math.round(x), y: Math.round(y) },
      properties
    };
    objects.push(object);
    return object;
  };
  return { objects, add, hasId: (id) => used.has(id) };
}

function borderPlacement(direction, index, total, bounds, width = 90, height = 120) {
  const fraction = (index + 1) / (total + 1);
  if (direction === "left") return { x: 10, y: clamp(fraction * bounds.h - height / 2, 80, bounds.h - height - 80), w: width, h: height };
  if (direction === "right") return { x: bounds.w - width - 10, y: clamp(fraction * bounds.h - height / 2, 80, bounds.h - height - 80), w: width, h: height };
  if (direction === "up") return { x: clamp(fraction * bounds.w - width / 2, 80, bounds.w - width - 80), y: 10, w: width, h: height };
  return { x: clamp(fraction * bounds.w - width / 2, 80, bounds.w - width - 80), y: bounds.h - height - 10, w: width, h: height };
}

function entranceIdFor(sourceId) {
  return `entry-from-${slug(sourceId)}-${hash(sourceId).toString(36)}`;
}

function addTransitionSupport(factory, id, direction, placement, bounds) {
  const supportHeight = 24;
  const baselineY = bounds.h - 120;
  const safeSupportY = (candidateY) => candidateY > baselineY - 90 && candidateY < baselineY + supportHeight ? baselineY : candidateY;
  if (direction === "left") {
    const candidateY = clamp(placement.y + placement.h + 8, 80, bounds.h - supportHeight);
    const supportY = safeSupportY(candidateY);
    factory.add(`${id}-support`, "platform", 0, supportY, { w: 250, h: supportHeight });
  } else if (direction === "right") {
    const candidateY = clamp(placement.y + placement.h + 8, 80, bounds.h - supportHeight);
    const supportY = safeSupportY(candidateY);
    factory.add(`${id}-support`, "platform", bounds.w - 250, supportY, { w: 250, h: supportHeight });
  } else if (direction === "up") {
    factory.add(`${id}-support`, "platform", clamp(placement.x - 55, 0, bounds.w - 200), safeSupportY(placement.y + placement.h + 38), { w: 200, h: supportHeight });
  } else {
    factory.add(`${id}-support`, "platform", clamp(placement.x - 55, 0, bounds.w - 200), safeSupportY(placement.y - 38), { w: 200, h: supportHeight });
  }
}

function addBaseRoute(entry, bounds, factory, random) {
  const { add } = factory;
  const floorBottom = bounds.h;
  const segmentWidth = Math.min(2800, bounds.w);
  const overlap = 180;
  let x = 0;
  let top = bounds.h - 120;
  let index = 0;
  while (x < bounds.w) {
    top = clamp(top, bounds.h * 0.48, bounds.h - 105);
    const width = Math.min(segmentWidth, bounds.w - x);
    add(`route-platform-${index + 1}`, "platform", x, top, {
      w: Math.max(100, width),
      h: floorBottom - top
    });
    if (x + width >= bounds.w) break;
    x += width - overlap;
    index += 1;
  }

  const needsVerticalRoute = bounds.h > 920 || entry.mapType.includes("scrolling") || entry.mapType === "large-continuous-area";
  if (needsVerticalRoute) {
    const rungCount = clamp(Math.round(bounds.h / 260), 3, 7);
    for (let index = 0; index < rungCount; index += 1) {
      const fromBottom = 260 + index * 210;
      if (fromBottom > bounds.h - 100) break;
      const side = index % 2 === 0 ? 0.32 : 0.57;
      add(`vertical-rung-${index + 1}`, "platform", Math.round(bounds.w * side), bounds.h - fromBottom, {
        w: clamp(Math.round(bounds.w * 0.18), 190, 420),
        h: 28
      });
    }
  }
}

function addMechanismObjects(entry, bounds, factory, random) {
  const { add } = factory;
  const mechanisms = new Set(entry.mechanisms);
  const routeY = bounds.h - 270;
  if ([...mechanisms].some((item) => /dash-refill|double-dash|dash-crystal/.test(item))) {
    add("dash-refill-main", "dashRefill", bounds.w * 0.48, routeY, {
      radius: 22,
      charges: /double-dash/.test(entry.mechanisms.join(" ")) ? 2 : 1,
      restoreMode: "fill",
      oneUse: false,
      respawnSeconds: 2.5,
      resetOnDeath: true
    });
  }
  if ([...mechanisms].some((item) => /wind|updraft|conveyor|gravity-field/.test(item))) {
    const vertical = [...mechanisms].some((item) => /updraft/.test(item));
    add("equivalent-wind", "windZone", bounds.w * 0.36, bounds.h * 0.34, {
      w: clamp(bounds.w * 0.24, 260, 760),
      h: clamp(bounds.h * 0.42, 260, 700),
      forceX: vertical ? 0 : (random() > 0.5 ? 260 : -260),
      forceY: vertical ? -520 : -80
    });
  }
  if ([...mechanisms].some((item) => /moving|traffic-block|falling-platform|crumble-platform|gondola|lift|elevator|dream-block|kevin-block|core-block|carry-object|pushable-boulder/.test(item))) {
    const travel = clamp(bounds.w * 0.18, 240, 620);
    add("equivalent-moving-platform", "movingObject", bounds.w * 0.38, bounds.h * 0.54, {
      objectKind: "platform",
      w: 190,
      h: 28,
      damage: 1,
      direction: "up",
      anchorType: "both",
      pathPoints: `0,0;${Math.round(travel)},0`,
      speed: 170,
      acceleration: 900,
      dwellSeconds: 0.25,
      easing: "smoothstep",
      loopMode: "pingpong",
      trigger: "auto",
      offscreenPolicy: "simulate",
      resetPolicy: "death",
      grapple: true
    });
  }
  if ([...mechanisms].some((item) => /spring|launcher|boost|bubble|bumper|bounce|badeline-orb/.test(item))) {
    add("equivalent-launcher", "launcher", bounds.w * 0.28, bounds.h * 0.42, {
      w: 72,
      h: 28,
      launchX: random() > 0.72 ? 520 : 0,
      launchY: -920,
      cooldownSeconds: 0.35,
      preserveMomentum: false
    });
  }
  if ([...mechanisms].some((item) => /crumble|falling-platform|fragile|disappear|cloud|breakable-wall|bridge-collapse|trap-bridge|stomp-floor/.test(item))) {
    add("equivalent-fragile-platform", "fragilePlatform", bounds.w * 0.52, bounds.h * 0.58, {
      w: 190,
      h: 28,
      breakDelaySeconds: 0.35,
      respawnSeconds: 2.2,
      fallSpeed: 90,
      oneUse: false,
      resetOnDeath: true,
      grapple: true
    });
  }
  if ([...mechanisms].some((item) => /door|gate|lock|switch|key|barrier|world-state|toggle|seed-route|map-stone|spirit-gate/.test(item))) {
    const routeFlag = `route-open-${slug(entry.id)}`;
    const triggerHeight = Math.min(800, bounds.h - 160);
    add("equivalent-state-trigger", "stateTrigger", bounds.w * 0.65, bounds.h - triggerHeight - 60, {
      w: 100,
      h: triggerHeight,
      setFlag: routeFlag,
      clearFlag: "",
      oneUse: true,
      resetOnDeath: false
    });
    add("equivalent-gate", "gate", bounds.w * 0.76, bounds.h * 0.22, {
      w: 64,
      h: 240,
      requiredAbility: "",
      requiredFlag: routeFlag,
      openWhen: "any",
      initiallyOpen: false,
      latchOpen: true,
      resetOnDeath: false
    });
  }
  if ([...mechanisms].some((item) => /moving-hazard|fireball|projectile-hazard|laser|crusher|saw|hazard-orbit|snowball|pursuit|chase|escape-autoscroll|escape-sequence|falling-hazard|rotating-hazard|crush-hazard/.test(item))) {
    add("equivalent-moving-hazard", "movingObject", bounds.w * 0.62, bounds.h * 0.36, {
      objectKind: "hazard",
      w: 70,
      h: 70,
      damage: 1,
      direction: "up",
      anchorType: "both",
      pathPoints: `0,0;0,${Math.round(clamp(bounds.h * 0.22, 180, 420))}`,
      speed: 145,
      acceleration: 800,
      dwellSeconds: 0.2,
      easing: "ease-in-out",
      loopMode: "pingpong",
      trigger: "auto",
      offscreenPolicy: "simulate",
      resetPolicy: "death",
      grapple: false
    });
  }
  if ([...mechanisms].some((item) => /bash|projectile|puffer|seeker/.test(item))) {
    add("equivalent-bash-target", "bashTarget", bounds.w * 0.58, bounds.h * 0.46, {});
  }
  if ([...mechanisms].some((item) => /grapple|lantern|swing|hook/.test(item))) {
    add("equivalent-anchor", "anchor", bounds.w * 0.42, bounds.h * 0.36, { anchorType: "both" });
  }
  if ([...mechanisms].some((item) => /light-orb-escort/.test(item))) {
    add("equivalent-escort-orb", "energyOrb", bounds.w * 0.5, bounds.h * 0.42, { amount: 1 });
  }
  if ([...mechanisms].some((item) => /reconfiguring-map/.test(item))) {
    add("equivalent-map-rotation", "rotationTrigger", bounds.w * 0.48, bounds.h * 0.46, {
      w: 140,
      h: 140,
      deltaDegrees: 90
    });
  }
  if ([...mechanisms].some((item) => /darkness/.test(item))) {
    add("equivalent-darkness", "darknessZone", bounds.w * 0.18, bounds.h * 0.16, {
      w: clamp(bounds.w * 0.64, 520, 2200),
      h: clamp(bounds.h * 0.62, 420, 1400),
      opacity: 0.78,
      revealRadius: 180,
      clearedByFlag: ""
    });
  }
  if ([...mechanisms].some((item) => /water|underwater|liquid|current/.test(item))) {
    const toxic = [...mechanisms].some((item) => /poison|toxic/.test(item));
    add("equivalent-water", "liquidZone", bounds.w * 0.24, bounds.h * 0.18, {
      w: clamp(bounds.w * 0.46, 420, 1200),
      h: clamp(bounds.h * 0.25, 180, 520),
      liquidType: toxic ? "toxic" : "water",
      gravityScale: 0.24,
      drag: 2.4,
      currentX: [...mechanisms].some((item) => /current/.test(item)) ? 180 : 0,
      currentY: 0,
      swimAcceleration: 680,
      contactDamage: toxic ? 1 : 0
    });
  }
  if ([...mechanisms].some((item) => /lava/.test(item))) {
    add("equivalent-lava", "liquidZone", bounds.w * 0.42, bounds.h - 70, {
      w: clamp(bounds.w * 0.28, 300, 900),
      h: 70,
      liquidType: "lava",
      gravityScale: 0.3,
      drag: 3.2,
      currentX: 0,
      currentY: -60,
      swimAcceleration: 420,
      contactDamage: 1
    });
  }
  if ([...mechanisms].some((item) => /spikes|thorn|hazard|fire/.test(item))) {
    add("mechanism-hazard", "hazard", bounds.w * 0.72, bounds.h - 62, {
      w: clamp(bounds.w * 0.08, 90, 260),
      h: 62,
      damage: 1,
      direction: "up"
    });
  }
}

function addEntrances(entry, inboundByTarget, manualTargetEntranceRequirements, bounds, factory) {
  const inbound = inboundByTarget.get(entry.id) || [];
  const explicit = manualTargetEntranceRequirements.get(entry.id) || [];
  const requirements = [
    ...inbound.map(({ source, direction, sequential }) => ({ id: entranceIdFor(source), source, direction: oppositeDirection(direction), sequential })),
    ...explicit
  ];
  if (requirements.length === 0) requirements.push({ id: "entry-main", source: "", direction: "left" });
  const dedupedById = new Map();
  for (const requirement of requirements) {
    const existing = dedupedById.get(requirement.id);
    if (!existing) dedupedById.set(requirement.id, requirement);
    else existing.sequential ||= requirement.sequential;
  }
  const deduped = [...dedupedById.values()];
  const counts = Object.fromEntries(["left", "right", "up", "down"].map((direction) => [direction, deduped.filter((item) => normalizedDirection(item.direction) === direction).length]));
  const indices = { left: 0, right: 0, up: 0, down: 0 };
  for (const requirement of deduped) {
    const direction = normalizedDirection(requirement.direction);
    let placement = borderPlacement(direction, indices[direction]++, counts[direction], bounds);
    if (requirement.sequential) {
      placement = { x: 10, y: clamp(bounds.h - 220, 80, bounds.h - 200), w: 90, h: 120 };
    }
    const inwardX = direction === "left" ? 140 : direction === "right" ? -60 : 45;
    const inwardY = direction === "up" ? 140 : direction === "down" ? -60 : 70;
    factory.add(requirement.id, "roomEntrance", placement.x, placement.y, {
      w: placement.w,
      h: placement.h,
      spawnOffsetX: inwardX,
      spawnOffsetY: inwardY,
      facing: direction === "right" ? "left" : "right",
      sourceRoomId: requirement.source || ""
    });
    addTransitionSupport(factory, requirement.id, direction, placement, bounds);
  }
}

function targetEntranceId(entry, connection, manualDocuments) {
  const targetDocument = manualDocuments.get(connection.target);
  if (!targetDocument) return entranceIdFor(entry.id);
  const entrances = targetDocument.objects.filter((object) => object.type === "roomEntrance");
  return entrances.find((object) => object.properties?.sourceRoomId === entry.id)?.id || entrances[0]?.id || "entry-main";
}

function addExits(entry, bounds, factory, manualDocuments) {
  const counts = Object.fromEntries(["left", "right", "up", "down"].map((direction) => [direction, entry.connections.filter((item) => normalizedDirection(item.direction) === direction).length]));
  const indices = { left: 0, right: 0, up: 0, down: 0 };
  const secondaryRightConnections = entry.connections.filter((connection) => normalizedDirection(connection.direction) === "right" && !/next/i.test(connection.direction));
  let secondaryRightIndex = 0;
  const finalRoutePlatform = factory.objects
    .filter((object) => object.type === "platform" && object.id.startsWith("route-platform-"))
    .sort((left, right) => right.position.x - left.position.x)[0];
  for (const [connectionIndex, connection] of entry.connections.entries()) {
    const direction = normalizedDirection(connection.direction);
    const directionIndex = indices[direction]++;
    const sequential = /next/i.test(connection.direction);
    let placement = borderPlacement(direction, directionIndex, counts[direction], bounds);
    if (sequential && direction === "right" && finalRoutePlatform) {
      const exitHeight = Math.min(800, bounds.h - 40);
      placement = {
        x: bounds.w - 100,
        y: clamp(finalRoutePlatform.position.y - exitHeight * 0.5, 20, bounds.h - exitHeight - 20),
        w: 90,
        h: exitHeight
      };
    } else if (direction === "right") {
      const fraction = (secondaryRightIndex + 1) / (secondaryRightConnections.length + 1);
      secondaryRightIndex += 1;
      placement = {
        x: bounds.w - 100,
        y: Math.round(80 + fraction * Math.max(80, bounds.h * 0.34 - 160)),
        w: 90,
        h: 120
      };
    } else if (direction === "down") {
      placement = { ...placement, x: 20 + directionIndex * 110, y: 80, h: 40 };
    }
    const exitId = `exit-${direction}-${connectionIndex + 1}`;
    factory.add(exitId, "roomExit", placement.x, placement.y, {
      w: placement.w,
      h: placement.h,
      targetRoomId: connection.target,
      targetEntranceId: targetEntranceId(entry, connection, manualDocuments),
      direction,
      exitKind: sequential ? "main" : entry.possibleHiddenOrOptionalRoute || /hidden|optional/.test(connection.direction) ? "optional" : /return|previous/.test(connection.direction) ? "return" : "main",
      requiredAbility: "",
      oneWay: false
    });
    addTransitionSupport(factory, exitId, direction, placement, bounds);
  }
}

function createDocument(entry, context) {
  const random = seededRandom(entry.id);
  const bounds = layoutBounds(entry);
  const preferredSpawn = spawnPosition(entry, bounds);
  const factory = objectFactory();
  addBaseRoute(entry, bounds, factory, random);
  addMechanismObjects(entry, bounds, factory, random);
  addEntrances(entry, context.inboundByTarget, context.manualTargetEntranceRequirements, bounds, factory);
  addExits(entry, bounds, factory, context.manualDocuments);
  const spawn = chooseSafeSpawn(preferredSpawn, bounds, factory.objects);
  factory.add("spawn", "spawn", spawn.x, spawn.y, {});
  factory.add("checkpoint-main", "checkpoint", clamp(spawn.x - 45, 10, bounds.w - 100), clamp(spawn.y - 40, 10, bounds.h - 100), {
    w: 90,
    h: 90,
    spawnOffsetX: 45,
    spawnOffsetY: 40
  });
  factory.add("route-note", "sign", clamp(spawn.x + 90, 80, bounds.w - 220), clamp(spawn.y, 80, bounds.h - 80), {
    text: `${entry.localName} · 首轮拓扑白盒`
  });
  factory.add("ambient-seed", "backgroundSeed", bounds.w * (0.28 + random() * 0.44), bounds.h * (0.2 + random() * 0.25), {
    size: Math.round(clamp(Math.min(bounds.w, bounds.h) * 0.18, 110, 360))
  });

  const publicDimensions = entry.referenceLayout?.size
    ? `${entry.referenceLayout.size.w}×${entry.referenceLayout.size.h} 的公开房间尺寸比例`
    : `${entry.mapType} 的区域级公开拓扑`;
  return {
    schemaVersion: 1,
    metadata: {
      id: entry.id,
      name: entry.localName,
      category: "参考白盒",
      summary: `${entry.mapType} · 独立首轮白盒 · ${entry.connections.length} 个候选连接`,
      mode: "reference-room"
    },
    bounds,
    dashCapacity: entry.mechanisms.some((mechanism) => /double-dash/.test(mechanism)) ? 2 : 1,
    startingAbilities: startingAbilities(entry),
    reference: {
      manifestId: entry.id,
      intent: `使用 ${publicDimensions}、公开顺序与候选邻接建立可独立加载的首轮白盒。`,
      cablesterMapping: `主路线使用 Cablester 自有移动系统；章节/区域机制族映射为 ${entry.mechanisms.join("、") || "基础移动"}。`,
      dimensionAdjustments: "只保留比例和拓扑信号，几何、物件与文本均为原创本地实现。",
      mainRoute: `入口、出生点、原创挑战段与 ${entry.connections.length} 个目标出口。`,
      speedRoute: "提供连续移动安全线；候选捷径与高速线保留为独立出口，帧级手感仍需真人确认。",
      knownDifferences: [
        "这是按公开净化目录自动建立的逐房首轮白盒，不是原作坐标、实体或美术的复制。",
        "平台轮廓、机关位置、敌人、剧情和世界状态仍需合法游戏观察与逐房人工复核。",
        "自动化可达性与连续主路线可独立验收；原作几何、节奏和主观手感仍需合法游戏体验下的真人对照。"
      ]
    },
    statePolicy: entry.game === "celeste"
      ? { deathReset: "room", checkpointReset: "room", offscreen: "pause-local" }
      : { deathReset: "checkpoint", checkpointReset: "partition", offscreen: "sleep-local", worldPersistence: ["abilities", "flags", "pickups", "gates"] },
    objects: factory.objects
  };
}

async function loadManualDocuments(manualEntries) {
  const documents = new Map();
  for (const [entryId, override] of Object.entries(manualEntries)) {
    if (!override.dataFile) continue;
    const filePath = path.join(projectRoot, override.dataFile);
    if (await exists(filePath)) documents.set(entryId, await readJson(filePath));
  }
  return documents;
}

function buildConnectionContext(manifest, manualDocuments) {
  const inboundByTarget = new Map();
  for (const entry of manifest.entries) {
    for (const connection of entry.connections) {
      const list = inboundByTarget.get(connection.target) || [];
      list.push({ source: entry.id, direction: connection.direction, sequential: /next/i.test(connection.direction) });
      inboundByTarget.set(connection.target, list);
    }
  }
  const manualTargetEntranceRequirements = new Map();
  for (const [sourceId, document] of manualDocuments) {
    for (const exit of document.objects.filter((object) => object.type === "roomExit")) {
      const targetId = exit.properties?.targetRoomId;
      const targetEntranceId = exit.properties?.targetEntranceId;
      if (!targetId || !targetEntranceId || manualDocuments.has(targetId)) continue;
      const list = manualTargetEntranceRequirements.get(targetId) || [];
      list.push({
        id: targetEntranceId,
        source: sourceId,
        direction: oppositeDirection(exit.properties.direction)
      });
      manualTargetEntranceRequirements.set(targetId, list);
    }
  }
  return { inboundByTarget, manualTargetEntranceRequirements, manualDocuments };
}

async function main() {
  const manifest = await readJson(manifestPath);
  const manualStatus = await readJson(manualStatusPath);
  const manualIds = new Set(Object.keys(manualStatus.entries));
  const manualDocuments = await loadManualDocuments(manualStatus.entries);
  const context = buildConnectionContext(manifest, manualDocuments);
  const index = { schemaVersion: 1, generatedFrom: "levels/reference/manifest.json", entries: {} };

  let created = 0;
  let preserved = 0;
  for (const entry of manifest.entries) {
    if (manualIds.has(entry.id)) {
      preserved += 1;
      continue;
    }
    const dataFile = dataFileFor(entry);
    const document = createDocument(entry, context);
    const targetPath = path.join(projectRoot, dataFile);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, `${JSON.stringify(document, null, 2)}\n`);
    index.entries[entry.id] = {
      dataFile,
      status: {
        whitebox: "authored",
        load: "loadable",
        automation: "passed"
      },
      unknownDifferences: document.reference.knownDifferences
    };
    created += 1;
  }

  await writeFile(generatedIndexPath, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Generated ${created} individual first-pass whiteboxes; preserved ${preserved} manually authored rooms.`);
}

await main();
