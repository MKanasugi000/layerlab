import type { ImageLayer } from '../types';
import {
  type HeightSpec,
  DEFAULT_HEIGHT_SPEC,
  loadImage,
  gray,
  computeHeight,
  blurSeparable,
  blurLargeRadius,
  floatToGrayUrl,
  heightToNormalUrl,
} from './heightField';
import { packChannels } from './channelPack';

export interface PbrSpec extends HeightSpec {
  layer: ImageLayer;
  width: number;
  height: number;
  // 生成するマップの選択
  makeNormal: boolean;
  makeHeight: boolean;
  makeAo: boolean;
  makeRough: boolean;
  makeMetallic: boolean;
  makeMaskMap: boolean;
  // Normal
  normalStrength: number;
  zStrength: number;
  flipY: boolean;
  // AO
  aoStrength: number;
  aoRadius: number; // 0..1（最小辺に対する割合）
  // Roughness
  roughBase: number; // 0..1
  roughDetail: number; // 0..1（細部でラフを変調する量）
  roughInvert: boolean;
  // Metallic
  metallicValue: number; // 0..1（ベタ値）
}

export interface PbrResult {
  normalUrl?: string;
  heightUrl?: string;
  aoUrl?: string;
  roughUrl?: string;
  metallicUrl?: string;
  maskUrl?: string;
  width: number;
  height: number;
}

export const DEFAULT_PBR_SPEC = {
  ...DEFAULT_HEIGHT_SPEC,
  makeNormal: true,
  makeHeight: false,
  makeAo: true,
  makeRough: true,
  makeMetallic: false,
  makeMaskMap: true,
  normalStrength: 2.5,
  zStrength: 1,
  flipY: false,
  aoStrength: 1,
  aoRadius: 0.04,
  roughBase: 0.5,
  roughDetail: 0.5,
  roughInvert: false,
  metallicValue: 0,
};

export const MAX_PBR_DIMENSION = 4096;
export const MAX_PBR_PIXELS = 4096 * 4096;

export function isSafePbrOutputSize(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= 1
    && height >= 1
    && width <= MAX_PBR_DIMENSION
    && height <= MAX_PBR_DIMENSION
    && width * height <= MAX_PBR_PIXELS;
}

/** ハイトの大域平均より低い（＝凹んだ）箇所を遮蔽として暗くする近似AO。 */
function aoUrl(hf: Float32Array, w: number, h: number, strength: number, radiusFrac: number): string {
  const radius = Math.max(2, Math.round(radiusFrac * Math.min(w, h)));
  const large = radius > 8
    ? blurLargeRadius(hf, w, h, radius)
    : blurSeparable(hf, w, h, radius);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const diff = large[i] - hf[i]; // 正 = 周囲より低い = 遮蔽
    let ao = 1 - strength * Math.max(0, diff) * 4;
    out[i] = ao < 0 ? 0 : ao > 1 ? 1 : ao;
  }
  return floatToGrayUrl(out, w, h);
}

/** 元画像の細部量（high-pass）でラフネスを変調する近似。 */
function roughUrl(
  srcData: Uint8ClampedArray,
  w: number,
  h: number,
  base: number,
  detail: number,
  invert: boolean,
): string {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = gray(srcData, i * 4, 'luminance') / 255;
  const sm = blurSeparable(g, w, h, 2);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const hp = Math.abs(g[i] - sm[i]); // 細部の量
    let v = base + detail * hp * 6;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    if (invert) v = 1 - v;
    out[i] = v;
  }
  return floatToGrayUrl(out, w, h);
}

/** ベタ値のメタリックマップ。 */
function metallicUrl(w: number, h: number, value: number): string {
  const v = value < 0 ? 0 : value > 1 ? 1 : value;
  const arr = new Float32Array(w * h);
  arr.fill(v);
  return floatToGrayUrl(arr, w, h);
}

const asLayer = (url: string): ImageLayer => ({ src: url }) as ImageLayer;

async function render(spec: PbrSpec, maxSize?: number): Promise<PbrResult> {
  const img = await loadImage(spec.layer.src);
  let w = spec.width;
  let h = spec.height;
  if (maxSize && Math.max(w, h) > maxSize) {
    const s = maxSize / Math.max(w, h);
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
  }
  if (!maxSize && !isSafePbrOutputSize(w, h)) {
    throw new Error('PBR output exceeds the safe 4096 px limit');
  }

  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Failed to get 2D context');
  ctx.drawImage(img, 0, 0, w, h);
  const srcData = ctx.getImageData(0, 0, w, h).data;

  const hf = computeHeight(srcData, w, h, spec);
  const res: PbrResult = { width: w, height: h };

  if (spec.makeNormal)
    res.normalUrl = heightToNormalUrl(hf, w, h, spec.normalStrength, spec.zStrength, spec.flipY);
  if (spec.makeHeight) res.heightUrl = floatToGrayUrl(hf, w, h);
  if (spec.makeAo) res.aoUrl = aoUrl(hf, w, h, spec.aoStrength, spec.aoRadius);
  if (spec.makeRough)
    res.roughUrl = roughUrl(srcData, w, h, spec.roughBase, spec.roughDetail, spec.roughInvert);
  if (spec.makeMetallic) res.metallicUrl = metallicUrl(w, h, spec.metallicValue);

  // Unity HDRP Mask Map: R=Metallic, G=Occlusion(AO), B=DetailMask(0), A=Smoothness(=1-Roughness)
  if (spec.makeMaskMap) {
    res.maskUrl = await packChannels({
      width: w,
      height: h,
      r: { layer: res.metallicUrl ? asLayer(res.metallicUrl) : null, source: 'L', invert: false },
      g: { layer: res.aoUrl ? asLayer(res.aoUrl) : null, source: 'L', invert: false },
      b: { layer: null, source: 'L', invert: false },
      a: { layer: res.roughUrl ? asLayer(res.roughUrl) : null, source: 'L', invert: true },
    });
  }
  return res;
}

/** フル解像度で選択された全マップを生成（Mask Map含む）。 */
export function generatePbrSet(spec: PbrSpec): Promise<PbrResult> {
  return render(spec);
}

/** 縮小プレビュー（既定 最大240px）。 */
export function previewPbrSet(spec: PbrSpec, maxSize = 240): Promise<PbrResult> {
  return render(spec, maxSize);
}
