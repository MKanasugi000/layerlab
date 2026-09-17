import { createImageLayer } from '../store/editorStore';
import type { ImageLayer } from '../types';
import { validatePixelSize } from './canvasLimits';
import {
  MAX_RASTER_FILE_BYTES,
  RASTER_HEADER_READ_BYTES,
  inspectRasterHeader,
} from './rasterHeader';

/** OS ファイルダイアログを開いて画像ファイルを複数選ぶ。 */
export async function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.onchange = () => resolve(inp.files ? Array.from(inp.files) : []);
    inp.click();
  });
}

/**
 * Blob → ImageLayer. File import and clipboard paste intentionally share this
 * exact preflight/decode path so neither ingress can bypass the memory limits.
 */
export async function blobToImageLayer(blob: Blob, name = 'Image'): Promise<ImageLayer> {
  if (blob.size > MAX_RASTER_FILE_BYTES) {
    throw new Error('Image files must be 64 MB or smaller');
  }
  const encodedHeader = await blob.slice(0, RASTER_HEADER_READ_BYTES).arrayBuffer();
  const header = inspectRasterHeader(encodedHeader);
  if (!header) throw new Error('Unsupported or corrupt image header');
  const headerSize = validatePixelSize(header.width, header.height);
  if (!headerSize.ok) {
    throw new Error(`Image dimensions are unsafe (${header.width} x ${header.height})`);
  }

  const objectUrl = URL.createObjectURL(blob);
  const img = new window.Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  const safeSize = validatePixelSize(img.naturalWidth, img.naturalHeight);
  if (!safeSize.ok) {
    throw new Error(`Image dimensions are unsafe (${img.naturalWidth} x ${img.naturalHeight})`);
  }
  if (safeSize.width !== headerSize.width || safeSize.height !== headerSize.height) {
    throw new Error(
      `Decoded image dimensions do not match its header (${safeSize.width} x ${safeSize.height} vs ${headerSize.width} x ${headerSize.height})`,
    );
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
  const layer = createImageLayer(dataUrl, safeSize.width, safeSize.height);
  layer.name = name;
  return layer;
}

/** File → ImageLayer（naturalサイズを読み取り、レイヤー名=ファイル名）。 */
export function fileToImageLayer(f: File): Promise<ImageLayer> {
  return blobToImageLayer(f, f.name);
}
