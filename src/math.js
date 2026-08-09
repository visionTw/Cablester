export const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

export function moveToward(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function length(x, y) {
  return Math.hypot(x, y);
}

export function normalize(x, y, fallbackX = 0, fallbackY = 0) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.000001) return { x: fallbackX, y: fallbackY };
  return { x: x / magnitude, y: y / magnitude };
}

export function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

export function rotate(x, y, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: x * cosine - y * sine,
    y: x * sine + y * cosine
  };
}

export function inverseRotate(x, y, angle) {
  return rotate(x, y, -angle);
}

export function easeInOutCubic(value) {
  const t = clamp(value, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const segmentX = bx - ax;
  const segmentY = by - ay;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (segmentLengthSquared < 0.000001) return { x: ax, y: ay, t: 0 };
  const t = clamp(((px - ax) * segmentX + (py - ay) * segmentY) / segmentLengthSquared, 0, 1);
  return {
    x: ax + segmentX * t,
    y: ay + segmentY * t,
    t
  };
}

export function closestPointsBetweenSegments(ax, ay, bx, by, cx, cy, dx, dy) {
  const firstX = bx - ax;
  const firstY = by - ay;
  const secondX = dx - cx;
  const secondY = dy - cy;
  const offsetX = ax - cx;
  const offsetY = ay - cy;
  const firstLengthSquared = dot(firstX, firstY, firstX, firstY);
  const crossLengths = dot(firstX, firstY, secondX, secondY);
  const secondLengthSquared = dot(secondX, secondY, secondX, secondY);
  const firstOffset = dot(firstX, firstY, offsetX, offsetY);
  const secondOffset = dot(secondX, secondY, offsetX, offsetY);
  const denominator = firstLengthSquared * secondLengthSquared - crossLengths * crossLengths;
  const epsilon = 0.000001;

  let firstNumerator;
  let firstDenominator = denominator;
  let secondNumerator;
  let secondDenominator = denominator;

  if (denominator < epsilon) {
    firstNumerator = 0;
    firstDenominator = 1;
    secondNumerator = secondOffset;
    secondDenominator = secondLengthSquared;
  } else {
    firstNumerator = crossLengths * secondOffset - secondLengthSquared * firstOffset;
    secondNumerator = firstLengthSquared * secondOffset - crossLengths * firstOffset;
    if (firstNumerator < 0) {
      firstNumerator = 0;
      secondNumerator = secondOffset;
      secondDenominator = secondLengthSquared;
    } else if (firstNumerator > firstDenominator) {
      firstNumerator = firstDenominator;
      secondNumerator = secondOffset + crossLengths;
      secondDenominator = secondLengthSquared;
    }
  }

  if (secondNumerator < 0) {
    secondNumerator = 0;
    if (-firstOffset < 0) {
      firstNumerator = 0;
    } else if (-firstOffset > firstLengthSquared) {
      firstNumerator = firstDenominator;
    } else {
      firstNumerator = -firstOffset;
      firstDenominator = firstLengthSquared;
    }
  } else if (secondNumerator > secondDenominator) {
    secondNumerator = secondDenominator;
    const adjusted = -firstOffset + crossLengths;
    if (adjusted < 0) {
      firstNumerator = 0;
    } else if (adjusted > firstLengthSquared) {
      firstNumerator = firstDenominator;
    } else {
      firstNumerator = adjusted;
      firstDenominator = firstLengthSquared;
    }
  }

  const firstT = Math.abs(firstNumerator) < epsilon ? 0 : firstNumerator / firstDenominator;
  const secondT = Math.abs(secondNumerator) < epsilon ? 0 : secondNumerator / secondDenominator;
  const firstPoint = { x: ax + firstT * firstX, y: ay + firstT * firstY };
  const secondPoint = { x: cx + secondT * secondX, y: cy + secondT * secondY };
  return {
    first: firstPoint,
    second: secondPoint,
    firstT,
    secondT,
    distance: length(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y)
  };
}

export function segmentIntersection(ax, ay, bx, by, cx, cy, dx, dy) {
  const firstX = bx - ax;
  const firstY = by - ay;
  const secondX = dx - cx;
  const secondY = dy - cy;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) < 0.000001) return null;

  const offsetX = cx - ax;
  const offsetY = cy - ay;
  const firstT = (offsetX * secondY - offsetY * secondX) / denominator;
  const secondT = (offsetX * firstY - offsetY * firstX) / denominator;
  if (firstT < 0 || firstT > 1 || secondT < 0 || secondT > 1) return null;
  return {
    x: ax + firstX * firstT,
    y: ay + firstY * firstT,
    firstT,
    secondT
  };
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function circleIntersectsRect(x, y, radius, rect) {
  const closestX = clamp(x, rect.x, rect.x + rect.w);
  const closestY = clamp(y, rect.y, rect.y + rect.h);
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}
