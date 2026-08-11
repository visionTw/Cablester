export const GAME_ASSET_RELATIVE_PATTERN_SOURCE = String.raw`game\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|jpe?g|png|webp)`;
export const MEDIA_ASSET_PATH_PATTERN_SOURCE = `^/media/(${GAME_ASSET_RELATIVE_PATTERN_SOURCE})$`;

const REGISTRY_ASSET_PATH_PATTERN = new RegExp(`^\\./assets/(${GAME_ASSET_RELATIVE_PATTERN_SOURCE})$`);
const ABSOLUTE_ASSET_PATH_PATTERN = new RegExp(`^/assets/(${GAME_ASSET_RELATIVE_PATTERN_SOURCE})$`);
const MEDIA_ASSET_PATH_PATTERN = new RegExp(MEDIA_ASSET_PATH_PATTERN_SOURCE);

export function isCanonicalAssetPath(path) {
  return typeof path === "string" && REGISTRY_ASSET_PATH_PATTERN.test(path);
}

export function assetDeliveryUrl(path) {
  if (typeof path !== "string") return null;
  const relativeMatch = path.match(REGISTRY_ASSET_PATH_PATTERN);
  if (relativeMatch) return `./media/${relativeMatch[1]}`;
  const absoluteMatch = path.match(ABSOLUTE_ASSET_PATH_PATTERN);
  if (absoluteMatch) return `/media/${absoluteMatch[1]}`;
  return null;
}

export function mediaAssetRelativePath(pathname) {
  if (typeof pathname !== "string") return null;
  return pathname.match(MEDIA_ASSET_PATH_PATTERN)?.[1] || null;
}
