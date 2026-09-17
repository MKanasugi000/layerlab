import type { ImageLayer, GrayMode } from '../types';

export type { GrayMode };

/** ハイトフィールド抽出の共通パラメータ（Normal / PBR で共有）。 */
export interface HeightSpec {
  grayMode: GrayMode;
  invert: boolean;
  autoLevel: boolean;
  blackPoint: number; // 0..1
  whitePoint: number; // 0..1
  gamma: number; // 0.1..3（1=無補正）
  preBlur: number; // ガウシアン半径（ノイズ/絵柄細部の除去）
  detailScale: number; // 0..1（0=大きな凹凸だけ, 1=細部も残す）
}

export const DEFAULT_HEIGHT_SPEC: HeightSpec = {
  grayMode: 'luminance',
  invert: false,
  autoLevel: false,
  blackPoint: 0,
  whitePoint: 1,
  gamma: 1,
  preBlur: 1,
  detailScale: 0.6,
};

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/** レイヤー画像を w×h に描いて RGBA バイト列を返す。 */
export async function rasterize(
  layer: ImageLayer,
  w: number,
  h: number,
): Promise<Uint8ClampedArray> {
  const img = await loadImage(layer.src);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to get 2D context');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** RGBA から指定方式でグレースケール値(0..255)を取る。 */
export function gray(data: Uint8ClampedArray, idx: number, mode: GrayMode): number {
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  switch (mode) {
    case 'average':
      return (r + g + b) / 3;
    case 'lightness':
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    case 'value':
      return Math.max(r, g, b);
    case 'red':
      return r;
    case 'green':
      return g;
    case 'blue':
      return b;
    case 'luminance':
    default:
      return 0.299 * r + 0.587 * g + 0.114 * b;
  }
}

/** レベル/ガンマ/反転で「どの明度帯をどれだけ凹凸として強調するか」を整える。 */
function applyLevels(h: Float32Array, spec: HeightSpec): Float32Array {
  let lo = spec.blackPoint;
  let hi = spec.whitePoint;
  if (spec.autoLevel) {
    let mn = 1;
    let mx = 0;
    for (let i = 0; i < h.length; i++) {
      const v = h[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx > mn) {
      lo = mn;
      hi = mx;
    }
  }
  const span = Math.max(1e-6, hi - lo);
  const invG = 1 / Math.max(0.01, spec.gamma);
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    let v = (h[i] - lo) / span;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    v = Math.pow(v, invG);
    if (spec.invert) v = 1 - v;
    out[i] = v;
  }
  return out;
}

function gaussianKernel(radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius));
  const sigma = Math.max(0.5, radius / 2);
  const size = r * 2 + 1;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - r;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

/** 分離可能ガウシアン（横→縦, O(w*h*r)）。clamp境界。 */
export function blurSeparable(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src;
  const k = gaussianKernel(radius);
  const r = (k.length - 1) / 2;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += src[row + xx] * k[i + r];
      }
      tmp[row + x] = s;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

function boxBlurHorizontal(
  src: Float32Array,
  out: Float32Array,
  w: number,
  h: number,
  radius: number,
): void {
  const windowSize = radius * 2 + 1;
  const invWindowSize = 1 / windowSize;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = src[row] * (radius + 1);
    const right = Math.min(radius, w - 1);
    for (let x = 1; x <= right; x++) sum += src[row + x];
    if (radius > right) sum += src[row + w - 1] * (radius - right);

    out[row] = sum * invWindowSize;
    for (let x = 0; x < w - 1; x++) {
      const removeX = Math.max(0, x - radius);
      const addX = Math.min(w - 1, x + radius + 1);
      sum += src[row + addX] - src[row + removeX];
      out[row + x + 1] = sum * invWindowSize;
    }
  }
}

function boxBlurVertical(
  src: Float32Array,
  out: Float32Array,
  w: number,
  h: number,
  radius: number,
): void {
  const windowSize = radius * 2 + 1;
  const invWindowSize = 1 / windowSize;
  const sums = new Float64Array(w);
  const bottom = Math.min(radius, h - 1);
  for (let x = 0; x < w; x++) sums[x] = src[x] * (radius + 1);
  for (let y = 1; y <= bottom; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) sums[x] += src[row + x];
  }
  if (radius > bottom) {
    const repeats = radius - bottom;
    const lastRow = (h - 1) * w;
    for (let x = 0; x < w; x++) sums[x] += src[lastRow + x] * repeats;
  }

  for (let x = 0; x < w; x++) out[x] = sums[x] * invWindowSize;
  for (let y = 0; y < h - 1; y++) {
    const removeRow = Math.max(0, y - radius) * w;
    const addRow = Math.min(h - 1, y + radius + 1) * w;
    const outRow = (y + 1) * w;
    for (let x = 0; x < w; x++) {
      sums[x] += src[addRow + x] - src[removeRow + x];
      out[outRow + x] = sums[x] * invWindowSize;
    }
  }
}

/** 既存のtruncated Gaussianと実効分散を合わせる3-box半径。 */
export function largeRadiusBoxRadii(gaussianRadius: number): [number, number, number] {
  if (gaussianRadius <= 0) return [0, 0, 0];
  const kernel = gaussianKernel(gaussianRadius);
  const center = (kernel.length - 1) / 2;
  let variance = 0;
  for (let i = 0; i < kernel.length; i++) {
    const x = i - center;
    variance += kernel[i] * x * x;
  }

  const passCount = 3;
  const idealWidth = Math.sqrt((12 * variance) / passCount + 1);
  let lowerWidth = Math.floor(idealWidth);
  if (lowerWidth % 2 === 0) lowerWidth -= 1;
  lowerWidth = Math.max(1, lowerWidth);
  const upperWidth = lowerWidth + 2;
  const lowerPasses = Math.max(0, Math.min(passCount, Math.round(
    (12 * variance
      - passCount * lowerWidth * lowerWidth
      - 4 * passCount * lowerWidth
      - 3 * passCount)
      / (-4 * lowerWidth - 4),
  )));
  return Array.from(
    { length: passCount },
    (_, pass) => ((pass < lowerPasses ? lowerWidth : upperWidth) - 1) / 2,
  ) as [number, number, number];
}

/**
 * 大半径 Gaussian の3-box近似。各passはrolling sumなので O(w*h) で、
 * detail分離のような低周波抽出では見た目を保ちながら半径依存の停止を避ける。
 */
export function blurLargeRadius(
  src: Float32Array,
  w: number,
  h: number,
  gaussianRadius: number,
): Float32Array {
  if (gaussianRadius <= 0 || w <= 0 || h <= 0 || src.length === 0) return src;
  const boxRadii = largeRadiusBoxRadii(gaussianRadius);
  const horizontal = new Float32Array(w * h);
  const vertical = new Float32Array(w * h);
  let current = src;
  for (const boxRadius of boxRadii) {
    boxBlurHorizontal(current, horizontal, w, h, boxRadius);
    boxBlurVertical(horizontal, vertical, w, h, boxRadius);
    current = vertical;
  }
  return vertical;
}

/** detail分離: 大域成分(large)はそのまま、細部成分を detailScale 倍で混ぜる。
 * detailScale=0 で絵柄の細部（＝不要な立体感）を消し、大きな凹凸だけ残す。 */
function applyDetailScale(base: Float32Array, w: number, h: number, detailScale: number): Float32Array {
  if (detailScale >= 0.999) return base;
  const largeRadius = Math.max(3, Math.round(Math.min(w, h) / 48));
  const large = largeRadius <= 8
    ? blurSeparable(base, w, h, largeRadius)
    : blurLargeRadius(base, w, h, largeRadius);
  const out = new Float32Array(base.length);
  const d = detailScale < 0 ? 0 : detailScale;
  for (let i = 0; i < base.length; i++) {
    out[i] = large[i] + (base[i] - large[i]) * d;
  }
  return out;
}

/** RGBA 画素から最終ハイトフィールド(0..1)を得る（②③⑤）。 */
export function computeHeight(srcData: Uint8ClampedArray, w: number, h: number, spec: HeightSpec): Float32Array {
  let hf: Float32Array = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = gray(srcData, i * 4, spec.grayMode) / 255;
  hf = applyLevels(hf, spec);
  if (spec.preBlur > 0) hf = blurSeparable(hf, w, h, spec.preBlur);
  hf = applyDetailScale(hf, w, h, spec.detailScale);
  return hf;
}

/** Float32 (0..1) → グレースケール PNG dataURL。 */
export function floatToGrayUrl(hf: Float32Array, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round((hf[i] < 0 ? 0 : hf[i] > 1 ? 1 : hf[i]) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Sobel勾配 → tangent-space ノーマルマップ PNG dataURL（④）。 */
export function heightToNormalUrl(
  hf: Float32Array,
  w: number,
  h: number,
  strength: number,
  zStrength: number,
  flipY: boolean,
): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D context');
  const img = ctx.createImageData(w, h);
  const S = (x: number, y: number): number => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    return hf[yy * w + xx];
  };
  const nz = Math.max(0.05, zStrength);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = S(x - 1, y - 1);
      const t = S(x, y - 1);
      const tr = S(x + 1, y - 1);
      const l = S(x - 1, y);
      const r = S(x + 1, y);
      const bl = S(x - 1, y + 1);
      const b = S(x, y + 1);
      const br = S(x + 1, y + 1);
      const dx = tr + 2 * r + br - (tl + 2 * l + bl);
      const dy = bl + 2 * b + br - (tl + 2 * t + tr);
      let nx = -dx * strength;
      let ny = -dy * strength;
      if (flipY) ny = -ny;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const nzn = nz / len;
      const idx = (y * w + x) * 4;
      img.data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round((nzn * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
