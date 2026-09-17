export const MAX_PSD_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_PSD_DIMENSION = 8192;
export const MAX_PSD_PIXELS = 32 * 1024 * 1024;
export const MAX_PSD_LAYERS = 1000;
export const MAX_PSD_LAYER_PIXELS = 64 * 1024 * 1024;
export const PSD_HEADER_BYTES = 26;

export interface PsdLayerBounds {
  top?: number;
  left?: number;
  bottom?: number;
  right?: number;
  children?: readonly PsdLayerBounds[];
}

export type PsdLayerBudgetResult =
  | { ok: true; layerCount: number; layerPixels: number }
  | {
      ok: false;
      code: 'too-many-layers' | 'invalid-layer-tree' | 'unsafe-layer-bounds' | 'too-many-layer-pixels';
      layerCount: number;
      layerPixels: number;
      width?: number;
      height?: number;
    };

export type PsdValidationResult =
  | { ok: true; version: 1 | 2; width: number; height: number }
  | {
      ok: false;
      code: 'file-too-large' | 'header-incomplete' | 'bad-signature' | 'bad-version' | 'unsafe-canvas';
      width?: number;
      height?: number;
    };

/** Validate only the fixed PSD/PSB header before allocating or decoding the file. */
export function validatePsdHeader(
  header: ArrayBuffer,
  fileSize: number,
): PsdValidationResult {
  if (fileSize > MAX_PSD_FILE_BYTES) return { ok: false, code: 'file-too-large' };
  if (header.byteLength < PSD_HEADER_BYTES || fileSize < PSD_HEADER_BYTES) {
    return { ok: false, code: 'header-incomplete' };
  }

  const bytes = new Uint8Array(header, 0, PSD_HEADER_BYTES);
  if (bytes[0] !== 0x38 || bytes[1] !== 0x42 || bytes[2] !== 0x50 || bytes[3] !== 0x53) {
    return { ok: false, code: 'bad-signature' };
  }

  const view = new DataView(header, 0, PSD_HEADER_BYTES);
  const version = view.getUint16(4, false);
  if (version !== 1 && version !== 2) return { ok: false, code: 'bad-version' };
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_PSD_DIMENSION ||
    height > MAX_PSD_DIMENSION ||
    width * height > MAX_PSD_PIXELS
  ) {
    return { ok: false, code: 'unsafe-canvas', width, height };
  }
  return { ok: true, version: version as 1 | 2, width, height };
}

/**
 * Bound the allocations ag-psd would make during its full image-data pass.
 * Groups count toward structural complexity, while only leaf layer bounds are
 * added to the raster budget because group nodes do not receive layer canvases.
 */
export function validatePsdLayerBudget(
  roots: readonly PsdLayerBounds[],
): PsdLayerBudgetResult {
  const stack = [...roots];
  const seen = new Set<PsdLayerBounds>();
  let layerCount = 0;
  let layerPixels = 0;

  while (stack.length > 0) {
    const layer = stack.pop()!;
    if (!layer || typeof layer !== 'object' || seen.has(layer)) {
      return { ok: false, code: 'invalid-layer-tree', layerCount, layerPixels };
    }
    seen.add(layer);
    layerCount += 1;
    if (layerCount > MAX_PSD_LAYERS) {
      return { ok: false, code: 'too-many-layers', layerCount, layerPixels };
    }

    if (Array.isArray(layer.children) && layer.children.length > 0) {
      for (const child of layer.children) stack.push(child);
      continue;
    }

    const bounds = [layer.left, layer.top, layer.right, layer.bottom];
    const present = bounds.filter((value) => value != null).length;
    if (present === 0) continue;
    if (present !== 4 || !bounds.every((value) => Number.isSafeInteger(value))) {
      return { ok: false, code: 'unsafe-layer-bounds', layerCount, layerPixels };
    }
    const width = (layer.right as number) - (layer.left as number);
    const height = (layer.bottom as number) - (layer.top as number);
    if (
      width < 0
      || height < 0
      || width > MAX_PSD_DIMENSION
      || height > MAX_PSD_DIMENSION
      || !Number.isSafeInteger(width * height)
      || width * height > MAX_PSD_PIXELS
    ) {
      return {
        ok: false,
        code: 'unsafe-layer-bounds',
        layerCount,
        layerPixels,
        width,
        height,
      };
    }
    layerPixels += width * height;
    if (!Number.isSafeInteger(layerPixels) || layerPixels > MAX_PSD_LAYER_PIXELS) {
      return {
        ok: false,
        code: 'too-many-layer-pixels',
        layerCount,
        layerPixels,
        width,
        height,
      };
    }
  }

  return { ok: true, layerCount, layerPixels };
}
