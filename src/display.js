export const MAX_CANVAS_RENDER_SCALE = 3;

export function computeCanvasBackingSize(
  cssWidth,
  cssHeight,
  devicePixelRatio,
  logicalWidth,
  logicalHeight,
  maximumScale = MAX_CANVAS_RENDER_SCALE
) {
  const safeCssWidth = Math.max(1, Number(cssWidth) || logicalWidth);
  const safeCssHeight = Math.max(1, Number(cssHeight) || logicalHeight);
  const safePixelRatio = Math.max(1, Number(devicePixelRatio) || 1);
  const scale = Math.max(0.1, Math.min(
    maximumScale,
    safeCssWidth * safePixelRatio / logicalWidth,
    safeCssHeight * safePixelRatio / logicalHeight
  ));

  return {
    width: Math.max(1, Math.round(logicalWidth * scale)),
    height: Math.max(1, Math.round(logicalHeight * scale)),
    scale,
    devicePixelRatio: safePixelRatio
  };
}

export function syncCanvasBackingStore(canvas, context, logicalViewport) {
  const bounds = canvas.getBoundingClientRect();
  const metrics = computeCanvasBackingSize(
    bounds.width,
    bounds.height,
    window.devicePixelRatio,
    logicalViewport.width,
    logicalViewport.height
  );

  if (canvas.width !== metrics.width || canvas.height !== metrics.height) {
    canvas.width = metrics.width;
    canvas.height = metrics.height;
  }

  context.setTransform(metrics.scale, 0, 0, metrics.scale, 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  canvas.dataset.backingResolution = `${metrics.width}×${metrics.height}`;
  canvas.dataset.renderScale = metrics.scale.toFixed(3);
  canvas.dataset.devicePixelRatio = metrics.devicePixelRatio.toFixed(2);
  return metrics;
}
