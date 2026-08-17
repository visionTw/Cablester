/**
 * Canonical JSON and hashing primitives for World Package v3.
 *
 * This module deliberately has no imports from the rest of the game so it can
 * run unchanged in browsers, Node.js, Web Workers, and the editor test harness.
 */

export const CANONICAL_NUMBER_DECIMALS = 6;
export const CONTENT_HASH_PREFIX = "sha256:";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeCanonicalNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError("Canonical numbers must be finite");
  if (Object.is(value, -0)) return 0;
  if (Number.isInteger(value)) return value;
  const normalized = Math.abs(value) < 1e21
    ? Number(value.toFixed(CANONICAL_NUMBER_DECIMALS))
    : value;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/**
 * Produces JSON-safe data, normalizes every number, and recursively orders
 * object keys. Array order is content-authoritative and is never changed.
 */
export function normalizeCanonicalValue(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return normalizeCanonicalNumber(value);
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeCanonicalValue(item, `${path}[${index}]`));
  }
  if (!isRecord(value)) {
    throw new TypeError(`${path} must contain only JSON-compatible values`);
  }

  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${path}.${key} is forbidden`);
    if (value[key] === undefined) throw new TypeError(`${path}.${key} must not be undefined`);
    result[key] = normalizeCanonicalValue(value[key], `${path}.${key}`);
  }
  return result;
}

export function stableStringify(value) {
  return JSON.stringify(normalizeCanonicalValue(value));
}

export function canonicalFileString(value) {
  return `${JSON.stringify(normalizeCanonicalValue(value), null, 2)}\n`;
}

export function normalizeTransform(transform = {}) {
  const position = transform?.position || {};
  const scale = transform?.scale || {};
  return normalizeCanonicalValue({
    position: {
      x: position.x ?? 0,
      y: position.y ?? 0
    },
    rotationDegrees: transform?.rotationDegrees ?? transform?.rotation ?? 0,
    scale: {
      x: scale.x ?? 1,
      y: scale.y ?? 1
    }
  });
}

export const IDENTITY_TRANSFORM = Object.freeze(normalizeTransform());

/** Clockwise-positive rotation in the canonical +Y-down coordinate system. */
export function transformPoint(transform, point) {
  const normalized = normalizeTransform(transform);
  const radians = normalized.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const scaledX = point.x * normalized.scale.x;
  const scaledY = point.y * normalized.scale.y;
  return {
    x: normalizeCanonicalNumber(normalized.position.x + scaledX * cosine - scaledY * sine),
    y: normalizeCanonicalNumber(normalized.position.y + scaledX * sine + scaledY * cosine)
  };
}

/**
 * Composes canonical TRS components in parent -> child order. Canonical
 * transforms intentionally do not encode shear; scale multiplies componentwise
 * and rotation adds, matching the Web and Godot import contracts.
 */
export function composeTransforms(parent, child) {
  const outer = normalizeTransform(parent);
  const inner = normalizeTransform(child);
  return normalizeTransform({
    position: transformPoint(outer, inner.position),
    rotationDegrees: outer.rotationDegrees + inner.rotationDegrees,
    scale: {
      x: outer.scale.x * inner.scale.x,
      y: outer.scale.y * inner.scale.y
    }
  });
}

export function transformBounds(transform, bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)
    || !Number.isFinite(bounds.w) || !Number.isFinite(bounds.h)) {
    throw new TypeError("Bounds must contain finite x, y, w, and h values");
  }
  const points = [
    transformPoint(transform, { x: bounds.x, y: bounds.y }),
    transformPoint(transform, { x: bounds.x + bounds.w, y: bounds.y }),
    transformPoint(transform, { x: bounds.x, y: bounds.y + bounds.h }),
    transformPoint(transform, { x: bounds.x + bounds.w, y: bounds.y + bounds.h })
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return normalizeCanonicalValue({
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY
  });
}

function hashInput(world) {
  const normalized = normalizeCanonicalValue(world);
  normalized.manifest = {
    ...(normalized.manifest || {}),
    contentHash: ""
  };
  return stableStringify(normalized);
}

const SHA256_INITIAL_STATE = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);
const SHA256_ROUND_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotateRight(value, count) {
  return (value >>> count) | (value << (32 - count));
}

/**
 * Pure synchronous SHA-256 for the validator/Worker path. The public async API
 * still prefers Web Crypto; this implementation exists because the frozen
 * validator API itself is synchronous in both browsers and Node.
 */
function sha256HexSync(bytes) {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const highLength = Math.floor(bitLength / 0x100000000);
  const lowLength = bitLength >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, highLength, false);
  view.setUint32(paddedLength - 4, lowLength, false);

  const state = Uint32Array.from(SHA256_INITIAL_STATE);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15];
      const previous2 = schedule[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_ROUND_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function computeContentHashSync(world) {
  const bytes = new TextEncoder().encode(hashInput(world));
  return `${CONTENT_HASH_PREFIX}${sha256HexSync(bytes)}`;
}

async function sha256Hex(bytes) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  // Kept behind the browser-native branch so this module remains directly
  // importable in browsers and Workers without a Node polyfill.
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

export async function computeContentHash(world) {
  const bytes = new TextEncoder().encode(hashInput(world));
  return `${CONTENT_HASH_PREFIX}${await sha256Hex(bytes)}`;
}

/**
 * Normalizes the package, seals it with its own hash, then emits deterministic
 * two-space JSON with exactly one trailing newline.
 */
export async function serializeWorldPackage(world) {
  const { normalizeWorldPackage } = await import("./world-schema.js");
  const normalized = normalizeWorldPackage(world);
  normalized.manifest.contentHash = await computeContentHash(normalized);
  return canonicalFileString(normalized);
}
