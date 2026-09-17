export const MAX_CANVAS_DIMENSION = 8192;
export const MAX_CANVAS_PIXELS = 32 * 1024 * 1024;
export const MAX_EXPORT_PIXELS = 32 * 1024 * 1024;

export type SizeValidation =
  | { ok: true; width: number; height: number; pixels: number }
  | { ok: false; reason: 'finite' | 'positive' | 'dimension' | 'pixels' };

export function validatePixelSize(
  width: number,
  height: number,
  options: { maxDimension?: number; maxPixels?: number } = {},
): SizeValidation {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return { ok: false, reason: 'finite' };
  }
  const w = Math.round(width);
  const h = Math.round(height);
  if (w < 1 || h < 1) return { ok: false, reason: 'positive' };
  const maxDimension = options.maxDimension ?? MAX_CANVAS_DIMENSION;
  if (w > maxDimension || h > maxDimension) {
    return { ok: false, reason: 'dimension' };
  }
  const pixels = w * h;
  if (!Number.isSafeInteger(pixels) || pixels > (options.maxPixels ?? MAX_CANVAS_PIXELS)) {
    return { ok: false, reason: 'pixels' };
  }
  return { ok: true, width: w, height: h, pixels };
}

export function validateExportSize(width: number, height: number): SizeValidation {
  return validatePixelSize(width, height, {
    maxDimension: MAX_CANVAS_DIMENSION,
    maxPixels: MAX_EXPORT_PIXELS,
  });
}
