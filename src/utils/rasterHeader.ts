import { validatePixelSize } from './canvasLimits';

export const RASTER_HEADER_READ_BYTES = 1024 * 1024;
export const MAX_RASTER_FILE_BYTES = 64 * 1024 * 1024;

export interface RasterHeader {
  format: 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp';
  width: number;
  height: number;
}

export type RasterDataUrlInspection =
  | { ok: true; header: RasterHeader; decodedBytes: number }
  | {
      ok: false;
      reason:
        | 'unsupported-data-url'
        | 'invalid-base64'
        | 'file-too-large'
        | 'unsupported-header'
        | 'mime-mismatch'
        | 'unsafe-dimensions';
      header?: RasterHeader;
      decodedBytes?: number;
    };

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

function jpegSize(bytes: Uint8Array): RasterHeader | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    const sof =
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (sof && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return { format: 'jpeg', width, height };
    }
    offset += length;
  }
  return null;
}

/** Read dimensions from encoded bytes without asking the browser to decode them. */
export function inspectRasterHeader(buffer: ArrayBuffer): RasterHeader | null {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length >= 24
    && bytes[0] === 0x89
    && ascii(bytes, 1, 3) === 'PNG'
    && ascii(bytes, 12, 4) === 'IHDR'
  ) {
    return { format: 'png', width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) {
    return { format: 'gif', width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM') {
    return {
      format: 'bmp',
      width: Math.abs(view.getInt32(18, true)),
      height: Math.abs(view.getInt32(22, true)),
    };
  }
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === 'VP8X') {
      const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return {
        format: 'webp',
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return {
        format: 'webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    return null;
  }
  return jpegSize(bytes);
}

export function validateRasterHeader(buffer: ArrayBuffer): RasterHeader | null {
  const header = inspectRasterHeader(buffer);
  if (!header) return null;
  const size = validatePixelSize(header.width, header.height);
  return size.ok ? { ...header, width: size.width, height: size.height } : null;
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

/**
 * Decode only enough of a previously validated base64 payload to inspect its
 * raster header. This avoids materializing a second copy of a potentially
 * 64 MB embedded image while a .llab project is being parsed.
 */
function decodeBase64Prefix(source: string, start: number, decodedBytes: number): ArrayBuffer {
  const targetBytes = Math.min(decodedBytes, RASTER_HEADER_READ_BYTES);
  const encodedChars = Math.min(source.length - start, Math.ceil(targetBytes / 3) * 4);
  const output = new Uint8Array(targetBytes);
  let out = 0;

  for (let i = 0; i < encodedChars && out < targetBytes; i += 4) {
    const a = base64Value(source.charCodeAt(start + i));
    const b = base64Value(source.charCodeAt(start + i + 1));
    const cCode = source.charCodeAt(start + i + 2);
    const dCode = source.charCodeAt(start + i + 3);
    const c = cCode === 0x3d ? 0 : base64Value(cCode);
    const d = dCode === 0x3d ? 0 : base64Value(dCode);
    output[out++] = (a << 2) | (b >>> 4);
    if (out < targetBytes && cCode !== 0x3d) output[out++] = ((b & 0x0f) << 4) | (c >>> 2);
    if (out < targetBytes && dCode !== 0x3d) output[out++] = ((c & 0x03) << 6) | d;
  }
  return output.buffer;
}

/**
 * Validate an embedded raster data URL without fully decoding it. The entire
 * base64 alphabet/padding and encoded byte count are checked, but only the
 * first header window is allocated and decoded.
 */
export function inspectRasterDataUrl(
  source: string,
  maxBytes = MAX_RASTER_FILE_BYTES,
): RasterDataUrlInspection {
  const match = /^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.exec(source.slice(0, 64));
  if (!match) return { ok: false, reason: 'unsupported-data-url' };

  const payloadStart = match[0].length;
  const payloadLength = source.length - payloadStart;
  if (payloadLength < 4 || payloadLength % 4 !== 0) {
    return { ok: false, reason: 'invalid-base64' };
  }

  let padding = 0;
  if (source.charCodeAt(source.length - 1) === 0x3d) padding += 1;
  if (source.charCodeAt(source.length - 2) === 0x3d) padding += 1;
  const decodedBytes = (payloadLength / 4) * 3 - padding;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes < 1) {
    return { ok: false, reason: 'invalid-base64' };
  }
  // Reject oversized payloads before the O(n) alphabet scan.
  if (decodedBytes > maxBytes) {
    return { ok: false, reason: 'file-too-large', decodedBytes };
  }

  const contentEnd = source.length - padding;
  for (let i = payloadStart; i < contentEnd; i++) {
    if (base64Value(source.charCodeAt(i)) < 0) {
      return { ok: false, reason: 'invalid-base64' };
    }
  }
  for (let i = contentEnd; i < source.length; i++) {
    if (source.charCodeAt(i) !== 0x3d) return { ok: false, reason: 'invalid-base64' };
  }

  const header = inspectRasterHeader(decodeBase64Prefix(source, payloadStart, decodedBytes));
  if (!header) return { ok: false, reason: 'unsupported-header', decodedBytes };
  if (header.format !== match[1].toLowerCase()) {
    return { ok: false, reason: 'mime-mismatch', header, decodedBytes };
  }
  if (!validatePixelSize(header.width, header.height).ok) {
    return { ok: false, reason: 'unsafe-dimensions', header, decodedBytes };
  }
  return { ok: true, header, decodedBytes };
}
