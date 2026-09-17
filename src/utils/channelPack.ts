import type { ImageLayer } from '../types';

export type ChannelSource = 'R' | 'G' | 'B' | 'A' | 'L';

export interface ChannelSpec {
  layer: ImageLayer | null;
  source: ChannelSource;
  invert: boolean;
}

export interface ChannelPackSpec {
  r: ChannelSpec;
  g: ChannelSpec;
  b: ChannelSpec;
  a: ChannelSpec;
  width: number;
  height: number;
}

export const MAX_CHANNEL_PACK_DIMENSION = 4096;
export const MAX_CHANNEL_PACK_PIXELS = 16 * 1024 * 1024;

export function isSafeChannelPackSize(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_CHANNEL_PACK_DIMENSION
    && height <= MAX_CHANNEL_PACK_DIMENSION
    && width * height <= MAX_CHANNEL_PACK_PIXELS;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

async function writeChannel(
  spec: ChannelSpec,
  width: number,
  height: number,
  fallback: number,
  output: Uint8ClampedArray,
  outputOffset: number,
): Promise<void> {
  if (!spec.layer) {
    if (fallback !== 0) {
      for (let i = outputOffset; i < output.length; i += 4) output[i] = fallback;
    }
    return;
  }
  if (!isSafeChannelPackSize(spec.layer.naturalWidth, spec.layer.naturalHeight)) {
    throw new Error('Channel source exceeds the 4096 px / 16 MP safety limit');
  }
  const img = await loadImage(spec.layer.src);
  const cv = document.createElement('canvas');
  cv.width = width;
  const tileRows = Math.min(256, height);
  cv.height = tileRows;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  try {
    for (let y = 0; y < height; y += tileRows) {
      const rows = Math.min(tileRows, height - y);
      ctx.clearRect(0, 0, width, tileRows);
      const sourceY = (y / height) * img.naturalHeight;
      const sourceRows = (rows / height) * img.naturalHeight;
      ctx.drawImage(
        img,
        0,
        sourceY,
        img.naturalWidth,
        sourceRows,
        0,
        0,
        width,
        rows,
      );
      const data = ctx.getImageData(0, 0, width, rows).data;
      let destination = y * width * 4 + outputOffset;
      for (let i = 0; i < data.length; i += 4, destination += 4) {
        let value = 0;
        switch (spec.source) {
          case 'R': value = data[i]; break;
          case 'G': value = data[i + 1]; break;
          case 'B': value = data[i + 2]; break;
          case 'A': value = data[i + 3]; break;
          case 'L':
            value = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            break;
        }
        output[destination] = spec.invert ? 255 - value : value;
      }
    }
  } finally {
    // Explicitly release the scratch backing store before the next channel.
    cv.width = 1;
    cv.height = 1;
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
}

export async function packChannels(spec: ChannelPackSpec): Promise<string> {
  const { width, height } = spec;
  if (!isSafeChannelPackSize(width, height)) {
    throw new Error('Channel packing is limited to 4096 x 4096 px / 16 MP');
  }
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  const out = ctx.createImageData(width, height);
  // Sequential tiled reads keep only one source scratch buffer alive. Four
  // full-canvas Promise.all buffers previously exceeded 1 GiB at 8192x4096.
  await writeChannel(spec.r, width, height, 0, out.data, 0);
  await writeChannel(spec.g, width, height, 0, out.data, 1);
  await writeChannel(spec.b, width, height, 0, out.data, 2);
  await writeChannel(spec.a, width, height, 255, out.data, 3);
  ctx.putImageData(out, 0, 0);
  return cv.toDataURL('image/png');
}

export const SOURCE_LABELS: Record<ChannelSource, string> = {
  R: 'Red',
  G: 'Green',
  B: 'Blue',
  A: 'Alpha',
  L: 'Luminance',
};
