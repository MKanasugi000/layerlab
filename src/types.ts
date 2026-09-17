export type LayerId = string;

/** モノクロ化（ハイト抽出）方式。 */
export type GrayMode =
  | 'luminance'
  | 'average'
  | 'lightness'
  | 'value'
  | 'red'
  | 'green'
  | 'blue';

/** ノーマルマップの非破壊調整パラメータ（右パネルで編集→実物を再生成）。 */
export interface NormalGenParams {
  sourceLayerId: string;
  grayMode: GrayMode;
  invert: boolean;
  autoLevel: boolean;
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  preBlur: number;
  detailScale: number;
  strength: number;
  zStrength: number;
  flipY: boolean;
}

export type Tool =
  | 'move'
  | 'marquee'
  | 'lasso'
  | 'wand'
  | 'brush'
  | 'text'
  | 'shape'
  | 'crop'
  | 'eyedropper'
  | 'hand'
  | 'zoom';

export type ShapeKind = 'rect' | 'ellipse' | 'line';

export type MarqueeKind = 'rect' | 'ellipse';

/** ピクセル選択範囲（キャンバス座標系）。 */
export type Selection =
  | { type: 'rect'; x: number; y: number; width: number; height: number }
  | { type: 'ellipse'; x: number; y: number; width: number; height: number }
  | { type: 'poly'; points: number[] }
  | {
      type: 'mask';
      x: number;
      y: number;
      width: number;
      height: number;
      /** マスク画像(白=選択)のdataURL */
      data: string;
      /** marching ants 用の輪郭ポリライン群（キャンバス座標、flat配列） */
      contours: number[][];
    };

export interface Viewport {
  x: number;
  y: number;
  scale: number;
  autoFit: boolean;
}

export const BLEND_MODES = [
  { value: 'source-over', label: '通常 (Normal)', labelEn: 'Normal' },
  { value: 'multiply', label: '乗算 (Multiply)', labelEn: 'Multiply' },
  { value: 'screen', label: 'スクリーン (Screen)', labelEn: 'Screen' },
  { value: 'overlay', label: 'オーバーレイ (Overlay)', labelEn: 'Overlay' },
  { value: 'darken', label: '比較(暗) (Darken)', labelEn: 'Darken' },
  { value: 'lighten', label: '比較(明) (Lighten)', labelEn: 'Lighten' },
  { value: 'color-dodge', label: '覆い焼きカラー (Color Dodge)', labelEn: 'Color Dodge' },
  { value: 'color-burn', label: '焼き込みカラー (Color Burn)', labelEn: 'Color Burn' },
  { value: 'hard-light', label: 'ハードライト (Hard Light)', labelEn: 'Hard Light' },
  { value: 'soft-light', label: 'ソフトライト (Soft Light)', labelEn: 'Soft Light' },
  { value: 'difference', label: '差の絶対値 (Difference)', labelEn: 'Difference' },
  { value: 'exclusion', label: '除外 (Exclusion)', labelEn: 'Exclusion' },
  { value: 'hue', label: '色相 (Hue)', labelEn: 'Hue' },
  { value: 'saturation', label: '彩度 (Saturation)', labelEn: 'Saturation' },
  { value: 'color', label: 'カラー (Color)', labelEn: 'Color' },
  { value: 'luminosity', label: '輝度 (Luminosity)', labelEn: 'Luminosity' },
] as const;

export type BlendMode = (typeof BLEND_MODES)[number]['value'];

export interface BaseLayer {
  id: LayerId;
  type: 'image' | 'text' | 'shape' | 'group';
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  parentId?: string | null;
  clipped?: boolean;
  /** 行のカラーラベル（HEX）。albedo/normal/mask 等テクスチャ系統の色分け用。任意・保存互換。 */
  colorLabel?: string;
}

export interface Guide {
  id: string;
  axis: 'v' | 'h';
  pos: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  strokeEnabled?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  /** 色調補正（任意・未設定は無補正）。 */
  brightness?: number; // -100..100（0=無変化）
  contrast?: number; // -100..100（0=無変化）
  gamma?: number; // 0.1..3.0（1=無変化）
  /** Photoshop の Image > Adjustments 相当。非破壊で保存される。 */
  adjustments?: ColorAdjustments;
  /** ノーマルマップ生成由来のレイヤー（右パネルで非破壊調整）。 */
  normalGen?: NormalGenParams;
}

export interface ToneBalance {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface LevelsChannel {
  inputBlack: number;
  inputGamma: number;
  inputWhite: number;
  outputBlack: number;
  outputWhite: number;
}

/** 画像レイヤーへ固定順序で適用する非破壊の色調補正スタック。 */
export interface ColorAdjustments {
  brightness: number;
  contrast: number;
  legacyBrightnessContrast: boolean;
  inputBlack: number;
  inputGamma: number;
  inputWhite: number;
  outputBlack: number;
  outputWhite: number;
  levelsRed: LevelsChannel;
  levelsGreen: LevelsChannel;
  levelsBlue: LevelsChannel;
  curve: CurvePoint[];
  curveRed: CurvePoint[];
  curveGreen: CurvePoint[];
  curveBlue: CurvePoint[];
  exposure: number;
  exposureOffset: number;
  exposureGamma: number;
  hue: number;
  saturation: number;
  lightness: number;
  colorize: boolean;
  vibrance: number;
  vibranceSaturation: number;
  colorBalanceShadows: ToneBalance;
  colorBalanceMidtones: ToneBalance;
  colorBalanceHighlights: ToneBalance;
  preserveLuminosity: boolean;
  blackAndWhite: boolean;
  blackWhiteReds: number;
  blackWhiteYellows: number;
  blackWhiteGreens: number;
  blackWhiteCyans: number;
  blackWhiteBlues: number;
  blackWhiteMagentas: number;
  invert: boolean;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'bold italic';
  fill: string;
  align: 'left' | 'center' | 'right';
  width?: number;
  letterSpacing: number;
  lineHeight: number;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowOpacity: number;
  gradientEnabled: boolean;
  gradientColor1: string;
  gradientColor2: string;
  gradientAngle: number;
  /** 光彩(外側) Outer Glow — 文字の周囲に均等ににじむ発光。任意（旧データ互換で optional）。 */
  glowEnabled?: boolean;
  glowColor?: string;
  glowBlur?: number;
  glowOpacity?: number;
  /** カラーオーバーレイ — 文字面をベタ塗りで上書き（fill/グラデより優先）。任意。 */
  colorOverlayEnabled?: boolean;
  colorOverlayColor?: string;
  colorOverlayOpacity?: number;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: ShapeKind;
  shapeWidth: number;
  shapeHeight: number;
  fill: string;
  fillEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokeEnabled: boolean;
  cornerRadius: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowOpacity: number;
}

export interface GroupLayer extends BaseLayer {
  type: 'group';
  collapsed: boolean;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;

export interface CanvasConfig {
  width: number;
  height: number;
  background: string;
}

export interface SizePreset {
  id: string;
  label: string;
  /** 英語ラベル（i18n）。未指定時は label にフォールバック。 */
  labelEn?: string;
  category: 'banner' | 'social' | 'unity' | 'custom';
  width: number;
  height: number;
}
