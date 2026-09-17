const DEFAULT_PREVIEW_EDGE = 1024;

/**
 * Konva filters are CPU-bound. During a live adjustment, cap the temporary
 * cache resolution while keeping the committed image full-resolution.
 */
export function adjustmentPreviewPixelRatio(
  width: number,
  height: number,
  previewActive: boolean,
  maxEdge = DEFAULT_PREVIEW_EDGE,
): number {
  if (!previewActive || width <= 0 || height <= 0 || maxEdge <= 0) return 1;
  return Math.min(1, maxEdge / Math.max(width, height));
}
