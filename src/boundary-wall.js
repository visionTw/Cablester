import { clamp } from "./math.js";

export const BOUNDARY_WALL_SIDES = Object.freeze(["all", "left", "right", "top", "bottom"]);

const SIDE_DEFINITIONS = Object.freeze({
  left: Object.freeze({ axis: "x", tangent: "y", normal: Object.freeze({ x: -1, y: 0 }) }),
  right: Object.freeze({ axis: "x", tangent: "y", normal: Object.freeze({ x: 1, y: 0 }) }),
  top: Object.freeze({ axis: "y", tangent: "x", normal: Object.freeze({ x: 0, y: -1 }) }),
  bottom: Object.freeze({ axis: "y", tangent: "x", normal: Object.freeze({ x: 0, y: 1 }) })
});

function facePosition(wall, side) {
  if (side === "left") return wall.x;
  if (side === "right") return wall.x + wall.w;
  if (side === "top") return wall.y;
  return wall.y + wall.h;
}

function tangentRange(wall, side) {
  return side === "left" || side === "right"
    ? [wall.y, wall.y + wall.h]
    : [wall.x, wall.x + wall.w];
}

function signedDistanceFromFace(point, wall, side) {
  const definition = SIDE_DEFINITIONS[side];
  return (point[definition.axis] - facePosition(wall, side)) * definition.normal[definition.axis];
}

function resolveSolidWall(player, wall) {
  const closestX = clamp(player.x, wall.x, wall.x + wall.w);
  const closestY = clamp(player.y, wall.y, wall.y + wall.h);
  const dx = player.x - closestX;
  const dy = player.y - closestY;
  const distance = Math.hypot(dx, dy);
  if (distance >= player.radius) return null;

  let normal;
  let penetration;
  if (distance > 0.00001) {
    normal = { x: dx / distance, y: dy / distance };
    penetration = player.radius - distance;
  } else {
    const edges = [
      { distance: player.x - wall.x, normal: { x: -1, y: 0 } },
      { distance: wall.x + wall.w - player.x, normal: { x: 1, y: 0 } },
      { distance: player.y - wall.y, normal: { x: 0, y: -1 } },
      { distance: wall.y + wall.h - player.y, normal: { x: 0, y: 1 } }
    ].sort((left, right) => left.distance - right.distance);
    normal = edges[0].normal;
    penetration = player.radius + edges[0].distance;
  }

  const x = player.x + normal.x * penetration;
  const y = player.y + normal.y * penetration;
  const intoSurface = player.vx * normal.x + player.vy * normal.y;
  return {
    x,
    y,
    vx: intoSurface < 0 ? player.vx - normal.x * intoSurface : player.vx,
    vy: intoSurface < 0 ? player.vy - normal.y * intoSurface : player.vy,
    normal
  };
}

/**
 * Resolves a player circle against an invisible boundary rectangle. A one-sided
 * wall only catches a crossing that starts on its named face's allowed side;
 * this lets authors protect an outer edge without trapping a legal entrance on
 * the opposite side.
 */
export function resolvePlayerAgainstBoundaryWall(player, wall) {
  if (!player || !wall || !Number.isFinite(player.radius) || player.radius <= 0) return null;
  const side = wall.blockingSide || "all";
  if (side === "all") return resolveSolidWall(player, wall);
  const definition = SIDE_DEFINITIONS[side];
  if (!definition) return null;

  const previous = {
    x: Number.isFinite(player.previousX) ? player.previousX : player.x,
    y: Number.isFinite(player.previousY) ? player.previousY : player.y
  };
  const current = { x: player.x, y: player.y };
  const previousDistance = signedDistanceFromFace(previous, wall, side);
  const currentDistance = signedDistanceFromFace(current, wall, side);
  // Correct both a fresh crossing and a constraint that leaves the player on
  // the blocked side. The latter matters when a rope or hard bar projection
  // runs after an earlier collision pass and the next frame starts outside.
  const crossedFromAllowedSide = previousDistance >= player.radius - 0.00001 && currentDistance < player.radius;
  const strandedOnBlockedSide = previousDistance < player.radius
    && currentDistance < player.radius
    && currentDistance <= previousDistance + 0.00001;
  if ((!crossedFromAllowedSide && !strandedOnBlockedSide) || currentDistance >= player.radius) return null;

  const denominator = previousDistance - currentDistance;
  const crossingAmount = crossedFromAllowedSide && denominator > 0
    ? clamp((previousDistance - player.radius) / denominator, 0, 1)
    : 1;
  const previousTangent = previous[definition.tangent];
  const currentTangent = current[definition.tangent];
  const crossingTangent = previousTangent + (currentTangent - previousTangent) * crossingAmount;
  const [tangentMin, tangentMax] = tangentRange(wall, side);
  if (crossingTangent < tangentMin - player.radius || crossingTangent > tangentMax + player.radius) return null;

  const plane = facePosition(wall, side);
  const x = definition.axis === "x" ? plane + definition.normal.x * player.radius : player.x;
  const y = definition.axis === "y" ? plane + definition.normal.y * player.radius : player.y;
  const intoSurface = player.vx * definition.normal.x + player.vy * definition.normal.y;
  return {
    x,
    y,
    vx: intoSurface < 0 ? player.vx - definition.normal.x * intoSurface : player.vx,
    vy: intoSurface < 0 ? player.vy - definition.normal.y * intoSurface : player.vy,
    normal: { ...definition.normal }
  };
}

export function boundaryWallSegments(wall) {
  const grapple = Boolean(wall.grapple);
  const definitions = {
    left: { id: `${wall.id}:left`, ax: wall.x, ay: wall.y + wall.h, bx: wall.x, by: wall.y },
    right: { id: `${wall.id}:right`, ax: wall.x + wall.w, ay: wall.y, bx: wall.x + wall.w, by: wall.y + wall.h },
    top: { id: `${wall.id}:top`, ax: wall.x, ay: wall.y, bx: wall.x + wall.w, by: wall.y },
    bottom: { id: `${wall.id}:bottom`, ax: wall.x + wall.w, ay: wall.y + wall.h, bx: wall.x, by: wall.y + wall.h }
  };
  const sides = wall.blockingSide === "all" || !wall.blockingSide
    ? ["top", "right", "bottom", "left"]
    : [wall.blockingSide];
  return sides.filter((side) => definitions[side]).map((side) => ({
    ...definitions[side],
    kind: "boundaryWall",
    grapple
  }));
}
