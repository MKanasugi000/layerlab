import type { ImageLayer, NormalGenParams } from '../types';
import {
  type GrayMode,
  type HeightSpec,
  DEFAULT_HEIGHT_SPEC,
  loadImage,
  computeHeight,
  floatToGrayUrl,
  heightToNormalUrl,
} from './heightField';

export type { GrayMode };

export interface NormalMapSpec extends HeightSpec {
  layer: ImageLayer;
  width: number;
  height: number;
  // ④ 強度
  strength: number; // XY 勾配強度
  zStrength: number; // Z 成分（大=平坦）
  flipY: boolean; // Y軸反転（DirectX形式）
}

export interface NormalMapResult {
  /** ノーマルマップ PNG dataURL */
  normalUrl: string;
  /** 中間ハイト（モノクロ）PNG dataURL */
  heightUrl: string;
  width: number;
  height: number;
}

export type NormalMapImageResult = Pick<NormalMapResult, 'normalUrl' | 'width' | 'height'>;

export interface NormalMapGenerationIdentity {
  generation: number;
  paramsKey: string;
  sourceSrc: string;
  targetSrc: string;
  canvasWidth: number;
  canvasHeight: number;
}

/** 既定値（ダイアログ初期値と共有）。 */
export const DEFAULT_NORMAL_SPEC = {
  ...DEFAULT_HEIGHT_SPEC,
  strength: 2.5,
  zStrength: 1,
  flipY: false,
};

export const MAX_NORMAL_DIMENSION = 4096;
export const MAX_NORMAL_PIXELS = 4096 * 4096;

export function isSafeNormalMapSize(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width >= 1
    && height >= 1
    && width <= MAX_NORMAL_DIMENSION
    && height <= MAX_NORMAL_DIMENSION
    && width * height <= MAX_NORMAL_PIXELS;
}

/** 非同期再生成のstale判定に使う、順序が固定されたパラメータfingerprint。 */
export function normalMapParamsKey(params: NormalGenParams): string {
  return JSON.stringify([
    params.sourceLayerId,
    params.grayMode,
    params.invert,
    params.autoLevel,
    params.blackPoint,
    params.whitePoint,
    params.gamma,
    params.preBlur,
    params.detailScale,
    params.strength,
    params.zStrength,
    params.flipY,
  ]);
}

/** Undo、別パラメータ、ソース差替え後の非同期結果をcommitしないための同一性判定。 */
export function sameNormalMapGeneration(
  expected: NormalMapGenerationIdentity,
  current: NormalMapGenerationIdentity,
): boolean {
  return expected.generation === current.generation
    && expected.paramsKey === current.paramsKey
    && expected.sourceSrc === current.sourceSrc
    && expected.targetSrc === current.targetSrc
    && expected.canvasWidth === current.canvasWidth
    && expected.canvasHeight === current.canvasHeight;
}

/** maxSize内へ縦横比を保って収める。上限なしの場合は入力寸法を保つ。 */
export function normalMapRenderSize(
  width: number,
  height: number,
  maxSize?: number,
): { width: number; height: number } {
  if (!maxSize || maxSize <= 0 || Math.max(width, height) <= maxSize) {
    return { width, height };
  }
  const scale = maxSize / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function prepareHeight(
  spec: NormalMapSpec,
  maxSize?: number,
): Promise<{ heightField: Float32Array; width: number; height: number }> {
  if (!maxSize && !isSafeNormalMapSize(spec.width, spec.height)) {
    throw new Error('Normal map output exceeds the safe 4096 px limit');
  }
  const img = await loadImage(spec.layer.src);
  const { width: w, height: h } = normalMapRenderSize(spec.width, spec.height, maxSize);

  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) throw new Error('Failed to get 2D context');
  sctx.drawImage(img, 0, 0, w, h);
  const srcData = sctx.getImageData(0, 0, w, h).data;
  return { heightField: computeHeight(srcData, w, h, spec), width: w, height: h };
}

async function render(spec: NormalMapSpec, maxSize?: number): Promise<NormalMapResult> {
  const { heightField: hf, width: w, height: h } = await prepareHeight(spec, maxSize);
  const heightUrl = floatToGrayUrl(hf, w, h);
  const normalUrl = heightToNormalUrl(hf, w, h, spec.strength, spec.zStrength, spec.flipY);
  return { normalUrl, heightUrl, width: w, height: h };
}

/** フル解像度生成（出力用）。 */
export function generateNormalMap(spec: NormalMapSpec): Promise<NormalMapResult> {
  return render(spec);
}

/** 縮小プレビュー生成（ライブプレビュー用・既定 最大340px）。 */
export function previewNormalMap(spec: NormalMapSpec, maxSize = 340): Promise<NormalMapResult> {
  return render(spec, maxSize);
}

/**
 * 調整中レイヤー向け。未使用の中間height PNGを生成せず、必要なら安全なプレビュー上限を適用する。
 */
export async function generateNormalMapImage(
  spec: NormalMapSpec,
  maxSize?: number,
): Promise<NormalMapImageResult> {
  const { heightField, width, height } = await prepareHeight(spec, maxSize);
  return {
    normalUrl: heightToNormalUrl(
      heightField,
      width,
      height,
      spec.strength,
      spec.zStrength,
      spec.flipY,
    ),
    width,
    height,
  };
}
