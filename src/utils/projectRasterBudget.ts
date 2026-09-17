import type { Layer } from '../types';

// Eight full 4096² raster layers. This bounds decoded image memory while still
// accommodating a typical source + Unity PBR map set in one document.
export const MAX_PROJECT_RASTER_PIXELS = 128 * 1024 * 1024;
// Leave headroom below main-process IPC/write limit (128 MiB) for JSON keys,
// non-ASCII names, guides and structured effect settings.
export const MAX_PROJECT_EMBEDDED_CHARS = 104 * 1024 * 1024;
export const MAX_PROJECT_JSON_BYTES = 120 * 1024 * 1024;

export type ProjectRasterBudgetResult =
  | { ok: true; pixels: number }
  | { ok: false; pixels: number; reason: 'invalid-dimensions' | 'too-many-pixels' };

type RasterBudgetLayer = Pick<Layer, 'type'> & {
  naturalWidth?: unknown;
  naturalHeight?: unknown;
};

export function validateProjectRasterBudget(
  layers: readonly RasterBudgetLayer[],
): ProjectRasterBudgetResult {
  let pixels = 0;
  for (const candidate of layers) {
    if (candidate.type !== 'image') continue;
    const layer = candidate;
    if (
      !Number.isSafeInteger(layer.naturalWidth)
      || !Number.isSafeInteger(layer.naturalHeight)
      || (layer.naturalWidth as number) < 1
      || (layer.naturalHeight as number) < 1
    ) {
      return { ok: false, pixels, reason: 'invalid-dimensions' };
    }
    const layerPixels = (layer.naturalWidth as number) * (layer.naturalHeight as number);
    if (!Number.isSafeInteger(layerPixels)) {
      return { ok: false, pixels, reason: 'invalid-dimensions' };
    }
    pixels += layerPixels;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_PROJECT_RASTER_PIXELS) {
      return { ok: false, pixels, reason: 'too-many-pixels' };
    }
  }
  return { ok: true, pixels };
}

export type ProjectStorageBudgetResult =
  | { ok: true; estimatedBytes: number }
  | { ok: false; estimatedBytes: number };

/** Allocation-free estimate used before creating a giant JSON/IPC string. */
export function validateProjectStorageBudget(
  layers: readonly RasterBudgetLayer[],
  additionalBytes = 0,
): ProjectStorageBudgetResult {
  const safeAdditionalBytes = Number.isSafeInteger(additionalBytes) && additionalBytes >= 0
    ? additionalBytes
    : MAX_PROJECT_EMBEDDED_CHARS + 1;
  let estimatedBytes = 1024 + safeAdditionalBytes; // document envelope
  if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > MAX_PROJECT_EMBEDDED_CHARS) {
    return { ok: false, estimatedBytes };
  }
  for (const candidate of layers) {
    const layer = candidate as RasterBudgetLayer & Record<string, unknown>;
    estimatedBytes += 2048; // conservative keys/numeric/effect metadata per layer
    if (layer.type === 'image' && typeof layer.src === 'string') {
      // Image data URLs are ASCII, so characters equal UTF-8 bytes.
      estimatedBytes += layer.src.length;
    }
    for (const key of ['name', 'text', 'fontFamily'] as const) {
      if (typeof layer[key] === 'string') estimatedBytes += layer[key].length * 3;
    }
    if (!Number.isSafeInteger(estimatedBytes) || estimatedBytes > MAX_PROJECT_EMBEDDED_CHARS) {
      return { ok: false, estimatedBytes };
    }
  }
  return { ok: true, estimatedBytes };
}

/** Conservative upper bound for a PNG data URL produced from RGBA pixels. */
export function estimatedRgbaDataUrlChars(width: number, height: number): number {
  const rawBytes = width * height * 4 + height;
  return Math.ceil(rawBytes / 3) * 4 + 1024;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > MAX_PROJECT_JSON_BYTES) return bytes;
  }
  return bytes;
}
