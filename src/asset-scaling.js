export const ASSET_SCALE_MODES = Object.freeze(["asset", "stretch", "nine-slice", "tile"]);
export const REGISTERED_ASSET_SCALE_MODES = Object.freeze(["stretch", "nine-slice", "tile"]);
export const ASSET_REGION_FILL_MODES = Object.freeze(["stretch", "tile"]);
export const MAX_ASSET_DRAW_PATCHES = 256;

const DEFAULT_PROFILE = Object.freeze({
  defaultMode: "stretch",
  allowedModes: Object.freeze(["stretch"]),
  nineSlice: null,
  tile: null
});

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function inset(value) {
  return Number.isFinite(value) && value >= 0;
}

function copyNineSlice(value) {
  if (!value || typeof value !== "object") return null;
  return {
    left: value.left,
    right: value.right,
    top: value.top,
    bottom: value.bottom,
    // Cocos Sliced Sprite and Godot NinePatchRect both default to one
    // nine-patch draw: fixed corners, single-axis stretched edges and a
    // two-axis stretched center. Keep the explicit tile values as a legacy
    // extension, but make interoperable nine-slice documents work without
    // Cablester-only region-mode fields.
    edgeMode: value.edgeMode ?? "stretch",
    centerMode: value.centerMode ?? "stretch"
  };
}

function copyTile(value) {
  if (!value || typeof value !== "object") return null;
  return { width: value.width, height: value.height };
}

export function assetScalingProfile(asset) {
  const scaling = asset?.scaling;
  if (!scaling || typeof scaling !== "object") return { ...DEFAULT_PROFILE, allowedModes: [...DEFAULT_PROFILE.allowedModes] };
  return {
    defaultMode: scaling.defaultMode,
    allowedModes: Array.isArray(scaling.allowedModes) ? [...scaling.allowedModes] : [],
    nineSlice: copyNineSlice(scaling.nineSlice),
    tile: copyTile(scaling.tile)
  };
}

export function validateAssetScaling(scaling, asset, path = "asset.scaling") {
  if (scaling === undefined) return [];
  if (!scaling || typeof scaling !== "object" || Array.isArray(scaling)) return [`${path} must be an object`];
  const errors = [];
  const allowedKeys = new Set(["defaultMode", "allowedModes", "nineSlice", "tile"]);
  for (const key of Object.keys(scaling)) {
    if (!allowedKeys.has(key)) errors.push(`${path}.${key} is not supported`);
  }
  if (!REGISTERED_ASSET_SCALE_MODES.includes(scaling.defaultMode)) {
    errors.push(`${path}.defaultMode must be stretch, nine-slice, or tile`);
  }
  if (!Array.isArray(scaling.allowedModes) || scaling.allowedModes.length === 0) {
    errors.push(`${path}.allowedModes must contain at least one scaling mode`);
  } else {
    const modes = new Set();
    for (const mode of scaling.allowedModes) {
      if (!REGISTERED_ASSET_SCALE_MODES.includes(mode)) errors.push(`${path}.allowedModes contains an unsupported mode: ${mode}`);
      if (modes.has(mode)) errors.push(`${path}.allowedModes contains a duplicate mode: ${mode}`);
      modes.add(mode);
    }
    if (!modes.has(scaling.defaultMode)) errors.push(`${path}.defaultMode must be included in allowedModes`);
  }

  const needsNineSlice = scaling.defaultMode === "nine-slice" || scaling.allowedModes?.includes("nine-slice");
  if (needsNineSlice) {
    const slice = scaling.nineSlice;
    if (!slice || typeof slice !== "object" || Array.isArray(slice)) {
      errors.push(`${path}.nineSlice is required when nine-slice is enabled`);
    } else {
      const sliceKeys = new Set(["left", "right", "top", "bottom", "edgeMode", "centerMode"]);
      for (const key of Object.keys(slice)) {
        if (!sliceKeys.has(key)) errors.push(`${path}.nineSlice.${key} is not supported`);
      }
      for (const key of ["left", "right", "top", "bottom"]) {
        if (!inset(slice[key])) errors.push(`${path}.nineSlice.${key} must be a non-negative number`);
      }
      for (const key of ["edgeMode", "centerMode"]) {
        if (slice[key] !== undefined && !ASSET_REGION_FILL_MODES.includes(slice[key])) {
          errors.push(`${path}.nineSlice.${key} must be stretch or tile`);
        }
      }
      if (positive(asset?.width) && inset(slice.left) && inset(slice.right) && slice.left + slice.right >= asset.width) {
        errors.push(`${path}.nineSlice left and right insets must leave a positive center width`);
      }
      if (positive(asset?.height) && inset(slice.top) && inset(slice.bottom) && slice.top + slice.bottom >= asset.height) {
        errors.push(`${path}.nineSlice top and bottom insets must leave a positive center height`);
      }
    }
  } else if (scaling.nineSlice !== null && scaling.nineSlice !== undefined) {
    errors.push(`${path}.nineSlice must be null unless nine-slice is enabled`);
  }

  const needsTile = scaling.defaultMode === "tile"
    || scaling.allowedModes?.includes("tile")
    || scaling.nineSlice?.edgeMode === "tile"
    || scaling.nineSlice?.centerMode === "tile";
  if (needsTile) {
    if (!scaling.tile || typeof scaling.tile !== "object" || Array.isArray(scaling.tile)) {
      errors.push(`${path}.tile is required when tiled drawing is enabled`);
    } else {
      for (const key of Object.keys(scaling.tile)) {
        if (!["width", "height"].includes(key)) errors.push(`${path}.tile.${key} is not supported`);
      }
      for (const key of ["width", "height"]) {
        if (!positive(scaling.tile[key])) errors.push(`${path}.tile.${key} must be a positive number`);
      }
    }
  } else if (scaling.tile !== null && scaling.tile !== undefined) {
    errors.push(`${path}.tile must be null unless tiled drawing is enabled`);
  }
  return [...new Set(errors)];
}

export function resolveAssetScaleMode(asset, visual = {}) {
  const profile = assetScalingProfile(asset);
  const requestedMode = ASSET_SCALE_MODES.includes(visual.scaleMode) ? visual.scaleMode : "asset";
  const candidate = requestedMode === "asset" ? profile.defaultMode : requestedMode;
  let fallbackReason = null;
  if (!profile.allowedModes.includes(candidate)) fallbackReason = "unsupported-scale-mode";
  else if (candidate === "nine-slice" && !profile.nineSlice) fallbackReason = "missing-nine-slice";
  else if (candidate === "tile" && !profile.tile) fallbackReason = "missing-tile-size";
  return {
    requestedMode,
    resolvedMode: fallbackReason ? "stretch" : candidate,
    fallbackReason,
    profile
  };
}

function fitInsetPair(first, second, available) {
  const total = first + second;
  if (!(total > available) || total <= 0) return [first, second];
  const scale = available / total;
  return [first * scale, second * scale];
}

function addStretchPatch(patches, sourceRect, destinationRect) {
  if (!(sourceRect.width > 0 && sourceRect.height > 0 && destinationRect.width > 0 && destinationRect.height > 0)) return;
  patches.push({
    sx: sourceRect.x,
    sy: sourceRect.y,
    sw: sourceRect.width,
    sh: sourceRect.height,
    dx: destinationRect.x,
    dy: destinationRect.y,
    dw: destinationRect.width,
    dh: destinationRect.height
  });
}

function addTiledRegion(patches, sourceRect, destinationRect, tileWidth, tileHeight) {
  if (!(sourceRect.width > 0 && sourceRect.height > 0 && destinationRect.width > 0 && destinationRect.height > 0)) return false;
  if (!(tileWidth > 0 && tileHeight > 0)) {
    addStretchPatch(patches, sourceRect, destinationRect);
    return true;
  }
  const columns = Math.ceil(destinationRect.width / tileWidth);
  const rows = Math.ceil(destinationRect.height / tileHeight);
  if (patches.length + columns * rows > MAX_ASSET_DRAW_PATCHES) {
    addStretchPatch(patches, sourceRect, destinationRect);
    return true;
  }
  for (let row = 0; row < rows; row += 1) {
    const dy = destinationRect.y + row * tileHeight;
    const dh = Math.min(tileHeight, destinationRect.y + destinationRect.height - dy);
    const sh = sourceRect.height * dh / tileHeight;
    for (let column = 0; column < columns; column += 1) {
      const dx = destinationRect.x + column * tileWidth;
      const dw = Math.min(tileWidth, destinationRect.x + destinationRect.width - dx);
      const sw = sourceRect.width * dw / tileWidth;
      patches.push({ sx: sourceRect.x, sy: sourceRect.y, sw, sh, dx, dy, dw, dh });
    }
  }
  return false;
}

function createStretchPlan(sourceWidth, sourceHeight, target) {
  return [{ sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: target.x, dy: target.y, dw: target.width, dh: target.height }];
}

function createTilePlan(sourceWidth, sourceHeight, target, profile, tileScale) {
  const patches = [];
  const tileWidth = profile.tile.width * tileScale;
  const tileHeight = profile.tile.height * tileScale;
  const degraded = addTiledRegion(
    patches,
    { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
    target,
    tileWidth,
    tileHeight
  );
  return { patches, degraded, guides: null };
}

function createNineSlicePlan(sourceWidth, sourceHeight, target, profile, tileScale) {
  const slice = profile.nineSlice;
  // A nine-slice that stretches every non-corner region does not need tile
  // metadata. In that valid registry shape, keep the fixed borders at source
  // pixel scale (modulated by tileScale) instead of dereferencing null.
  const nominalScale = profile.tile
    ? Math.min(profile.tile.width / sourceWidth, profile.tile.height / sourceHeight) * tileScale
    : tileScale;
  let [destinationLeft, destinationRight] = fitInsetPair(slice.left * nominalScale, slice.right * nominalScale, target.width);
  let [destinationTop, destinationBottom] = fitInsetPair(slice.top * nominalScale, slice.bottom * nominalScale, target.height);
  const sourceColumns = [slice.left, sourceWidth - slice.left - slice.right, slice.right];
  const sourceRows = [slice.top, sourceHeight - slice.top - slice.bottom, slice.bottom];
  const destinationColumns = [destinationLeft, target.width - destinationLeft - destinationRight, destinationRight];
  const destinationRows = [destinationTop, target.height - destinationTop - destinationBottom, destinationBottom];
  const sourceXs = [0, slice.left, sourceWidth - slice.right];
  const sourceYs = [0, slice.top, sourceHeight - slice.bottom];
  const destinationXs = [target.x, target.x + destinationLeft, target.x + target.width - destinationRight];
  const destinationYs = [target.y, target.y + destinationTop, target.y + target.height - destinationBottom];
  const patches = [];
  let degraded = false;
  const edgeMode = slice.edgeMode ?? "stretch";
  const centerMode = slice.centerMode ?? "stretch";
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const sourceRect = { x: sourceXs[column], y: sourceYs[row], width: sourceColumns[column], height: sourceRows[row] };
      const destinationRect = { x: destinationXs[column], y: destinationYs[row], width: destinationColumns[column], height: destinationRows[row] };
      const corner = row !== 1 && column !== 1;
      const fillMode = corner ? "stretch" : row === 1 && column === 1 ? centerMode : edgeMode;
      if (fillMode === "stretch") {
        addStretchPatch(patches, sourceRect, destinationRect);
      } else {
        const tileWidth = column === 1 ? sourceRect.width * nominalScale : destinationRect.width;
        const tileHeight = row === 1 ? sourceRect.height * nominalScale : destinationRect.height;
        degraded = addTiledRegion(patches, sourceRect, destinationRect, tileWidth, tileHeight) || degraded;
      }
    }
  }
  return {
    patches,
    degraded,
    guides: {
      vertical: [target.x + destinationLeft, target.x + target.width - destinationRight],
      horizontal: [target.y + destinationTop, target.y + target.height - destinationBottom]
    }
  };
}

export function createAssetDrawPlan(asset, visual, sourceDimensions, target) {
  const sourceWidth = Number(sourceDimensions?.width);
  const sourceHeight = Number(sourceDimensions?.height);
  const normalizedTarget = {
    x: Number(target?.x),
    y: Number(target?.y),
    width: Number(target?.width),
    height: Number(target?.height)
  };
  if (!(positive(sourceWidth) && positive(sourceHeight)
    && Number.isFinite(normalizedTarget.x) && Number.isFinite(normalizedTarget.y)
    && positive(normalizedTarget.width) && positive(normalizedTarget.height))) return null;
  const resolution = resolveAssetScaleMode(asset, visual);
  const tileScale = positive(visual?.tileScale) ? visual.tileScale : 1;
  let planned;
  if (resolution.resolvedMode === "nine-slice") {
    planned = createNineSlicePlan(sourceWidth, sourceHeight, normalizedTarget, resolution.profile, tileScale);
  } else if (resolution.resolvedMode === "tile") {
    planned = createTilePlan(sourceWidth, sourceHeight, normalizedTarget, resolution.profile, tileScale);
  } else {
    planned = { patches: createStretchPlan(sourceWidth, sourceHeight, normalizedTarget), degraded: false, guides: null };
  }
  if (planned.patches.length > MAX_ASSET_DRAW_PATCHES) {
    planned = {
      patches: createStretchPlan(sourceWidth, sourceHeight, normalizedTarget),
      degraded: true,
      guides: planned.guides
    };
  }
  return { ...resolution, ...planned, target: normalizedTarget };
}

export function drawScaledAssetImage(ctx, source, asset, visual, target, { maximumPatches = MAX_ASSET_DRAW_PATCHES } = {}) {
  const sourceDimensions = {
    width: Number(source?.naturalWidth || source?.width || asset?.width),
    height: Number(source?.naturalHeight || source?.height || asset?.height)
  };
  let plan = createAssetDrawPlan(asset, visual, sourceDimensions, target);
  if (!plan || !plan.patches.length || typeof ctx?.drawImage !== "function") return { drawn: false, plan };
  let qualityDegraded = false;
  if (plan.patches.length > maximumPatches) {
    plan = createAssetDrawPlan(asset, { ...visual, scaleMode: "stretch" }, sourceDimensions, target);
    qualityDegraded = true;
  }
  for (const patch of plan.patches) {
    ctx.drawImage(source, patch.sx, patch.sy, patch.sw, patch.sh, patch.dx, patch.dy, patch.dw, patch.dh);
  }
  return { drawn: true, drawCalls: plan.patches.length, qualityDegraded, plan };
}
