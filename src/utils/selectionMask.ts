import type { Selection } from '../types';
import { contourFromMask } from './selectionOps';
import { blurSeparable } from './heightField';

export type SelMode = 'replace' | 'add' | 'subtract' | 'intersect';

// Helper: create an offscreen canvas (works in browser and Electron renderer)
function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Convert Selection (or null) to a single-channel Uint8ClampedArray mask.
 * Mask values: 0=not selected, 255=fully selected, intermediate=partial.
 * For mask-type Selection, uses _raw if available (runtime cache).
 */
export function selectionToMask(
  sel: Selection | null,
  w: number,
  h: number
): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h);
  if (!sel) return mask;

  if (sel.type === 'mask') {
    // Use _raw if present (runtime cache attached by store)
    if ((sel as any)._raw instanceof Uint8ClampedArray) {
      const raw = (sel as any)._raw as Uint8ClampedArray;
      // raw is bbox-cropped, expand to full canvas
      const { x, y, width, height } = sel;
      for (let row = 0; row < height; row++) {
        const srcStart = row * width;
        const dstStart = (y + row) * w + x;
        for (let col = 0; col < width; col++) {
          mask[dstStart + col] = raw[srcStart + col];
        }
      }
    } else if (sel.contours && sel.contours.length > 0) {
      // Fallback after save→load (_raw not serialized): paint contour polygons
      // to approximate a binary mask. Soft edges are lost but "disappeared" is prevented.
      const canvas = makeCanvas(w, h);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      for (const contour of sel.contours) {
        if (contour.length < 6) continue;
        ctx.beginPath();
        ctx.moveTo(contour[0], contour[1]);
        for (let i = 2; i < contour.length; i += 2) {
          ctx.lineTo(contour[i], contour[i + 1]);
        }
        ctx.closePath();
        ctx.fill();
      }
      const pixels = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < w * h; i++) {
        mask[i] = pixels[i * 4]; // red channel (white = 255)
      }
    }
    // If no _raw and no contours, return zeros
    return mask;
  }

  // rect / ellipse / poly: draw to offscreen canvas
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'white';

  if (sel.type === 'rect') {
    ctx.fillRect(sel.x, sel.y, sel.width, sel.height);
  } else if (sel.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(
      sel.x + sel.width / 2,
      sel.y + sel.height / 2,
      sel.width / 2,
      sel.height / 2,
      0, 0, Math.PI * 2
    );
    ctx.fill();
  } else if (sel.type === 'poly') {
    const pts = sel.points;
    if (pts && pts.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], pts[i + 1]);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  const pixels = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) {
    mask[i] = pixels[i * 4]; // red channel (white = 255)
  }
  return mask;
}

/**
 * Convert a Uint8ClampedArray mask back to a Selection (or null).
 * Attaches _raw to mask-type selections for runtime use.
 */
export function maskToSelection(
  mask: Uint8ClampedArray,
  w: number,
  h: number
): Selection | null {
  // Check if all zeros
  let hasAny = false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 0) { hasAny = true; break; }
  }
  if (!hasAny) return null;

  // Check if all 255 (full rect)
  let allFull = true;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < 255) { allFull = false; break; }
  }
  if (allFull) return { type: 'rect', x: 0, y: 0, width: w, height: h };

  // Compute bounding box
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bx = minX, by = minY;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  // Crop mask to bbox
  const cropRaw = new Uint8ClampedArray(bw * bh);
  for (let row = 0; row < bh; row++) {
    const srcStart = (by + row) * w + bx;
    const dstStart = row * bw;
    for (let col = 0; col < bw; col++) {
      cropRaw[dstStart + col] = mask[srcStart + col];
    }
  }

  // Create RGBA ImageData (white = selected) for dataURL
  const canvas = makeCanvas(bw, bh);
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(bw, bh);
  for (let i = 0; i < bw * bh; i++) {
    imgData.data[i * 4] = cropRaw[i];
    imgData.data[i * 4 + 1] = cropRaw[i];
    imgData.data[i * 4 + 2] = cropRaw[i];
    imgData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  const dataURL = canvas.toDataURL('image/png');

  // Convert to binary (0/1) for contour detection
  const binaryMask = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) binaryMask[i] = mask[i] >= 128 ? 1 : 0;
  const contour = contourFromMask(binaryMask, w, h);
  const contours: number[][] = contour.length >= 6 ? [contour] : [];

  const sel: Selection = {
    type: 'mask',
    x: bx,
    y: by,
    width: bw,
    height: bh,
    data: dataURL,
    contours,
  };
  // _raw is a runtime-only cache: non-enumerable so it is excluded from
  // JSON serialization (.llab saving) and from zundo's JSON.stringify equality.
  Object.defineProperty(sel, '_raw', {
    value: cropRaw,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return sel;
}

/**
 * Combine two equal-length masks with the given mode.
 */
export function combineMasks(
  base: Uint8ClampedArray,
  add: Uint8ClampedArray,
  mode: SelMode
): Uint8ClampedArray {
  const len = base.length;
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i++) {
    const b = base[i];
    const a = add[i];
    switch (mode) {
      case 'replace':   out[i] = a; break;
      case 'add':       out[i] = Math.max(b, a); break;
      case 'subtract':  out[i] = Math.max(0, b - a); break;
      case 'intersect': out[i] = Math.min(b, a); break;
    }
  }
  return out;
}

function separableDilate(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Uint8ClampedArray {
  r = Math.max(1, Math.min(100, r));
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);

  // Horizontal pass (running max, zero allocation)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.min(w - 1, Math.max(0, x + dx));
        const v = mask[y * w + nx];
        if (v > max) max = v;
      }
      tmp[y * w + x] = max;
    }
  }

  // Vertical pass (running max, zero allocation)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.min(h - 1, Math.max(0, y + dy));
        const v = tmp[ny * w + x];
        if (v > max) max = v;
      }
      out[y * w + x] = max;
    }
  }
  return out;
}

function separableErode(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
): Uint8ClampedArray {
  r = Math.max(1, Math.min(100, r));
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);

  // Horizontal pass (running min, zero allocation)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let min = 255;
      for (let dx = -r; dx <= r; dx++) {
        const nx = Math.min(w - 1, Math.max(0, x + dx));
        const v = mask[y * w + nx];
        if (v < min) min = v;
      }
      tmp[y * w + x] = min;
    }
  }

  // Vertical pass (running min, zero allocation)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let min = 255;
      for (let dy = -r; dy <= r; dy++) {
        const ny = Math.min(h - 1, Math.max(0, y + dy));
        const v = tmp[ny * w + x];
        if (v < min) min = v;
      }
      out[y * w + x] = min;
    }
  }
  return out;
}

export function dilateMask(
  mask: Uint8ClampedArray, w: number, h: number, r: number
): Uint8ClampedArray {
  return separableDilate(mask, w, h, r);
}

export function erodeMask(
  mask: Uint8ClampedArray, w: number, h: number, r: number
): Uint8ClampedArray {
  return separableErode(mask, w, h, r);
}

export function featherMask(
  mask: Uint8ClampedArray, w: number, h: number, r: number
): Uint8ClampedArray {
  r = Math.max(1, Math.min(200, r));
  // Convert to Float32 for blurSeparable
  const floatMask = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) floatMask[i] = mask[i] / 255;
  const blurred = blurSeparable(floatMask, w, h, r);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(Math.max(0, Math.min(1, blurred[i])) * 255);
  }
  return out;
}

export function smoothMask(
  mask: Uint8ClampedArray, w: number, h: number, r: number
): Uint8ClampedArray {
  const feathered = featherMask(mask, w, h, r);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) {
    out[i] = feathered[i] >= 128 ? 255 : 0;
  }
  return out;
}
