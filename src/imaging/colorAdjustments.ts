import type {
  ColorAdjustments,
  CurvePoint,
  ImageLayer,
  LevelsChannel,
  ToneBalance,
} from '../types';

const ZERO_BALANCE: ToneBalance = { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 };
const DEFAULT_LEVELS_CHANNEL: LevelsChannel = {
  inputBlack: 0,
  inputGamma: 1,
  inputWhite: 255,
  outputBlack: 0,
  outputWhite: 255,
};
const DEFAULT_CURVE: CurvePoint[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];

export const DEFAULT_COLOR_ADJUSTMENTS: ColorAdjustments = {
  brightness: 0,
  contrast: 0,
  legacyBrightnessContrast: false,
  inputBlack: 0,
  inputGamma: 1,
  inputWhite: 255,
  outputBlack: 0,
  outputWhite: 255,
  levelsRed: { ...DEFAULT_LEVELS_CHANNEL },
  levelsGreen: { ...DEFAULT_LEVELS_CHANNEL },
  levelsBlue: { ...DEFAULT_LEVELS_CHANNEL },
  curve: DEFAULT_CURVE.map((point) => ({ ...point })),
  curveRed: DEFAULT_CURVE.map((point) => ({ ...point })),
  curveGreen: DEFAULT_CURVE.map((point) => ({ ...point })),
  curveBlue: DEFAULT_CURVE.map((point) => ({ ...point })),
  exposure: 0,
  exposureOffset: 0,
  exposureGamma: 1,
  hue: 0,
  saturation: 0,
  lightness: 0,
  colorize: false,
  vibrance: 0,
  vibranceSaturation: 0,
  colorBalanceShadows: { ...ZERO_BALANCE },
  colorBalanceMidtones: { ...ZERO_BALANCE },
  colorBalanceHighlights: { ...ZERO_BALANCE },
  preserveLuminosity: true,
  blackAndWhite: false,
  blackWhiteReds: 40,
  blackWhiteYellows: 60,
  blackWhiteGreens: 40,
  blackWhiteCyans: 60,
  blackWhiteBlues: 20,
  blackWhiteMagentas: 80,
  invert: false,
};

export type AdjustmentMode =
  | 'brightnessContrast'
  | 'levels'
  | 'curves'
  | 'exposure'
  | 'vibrance'
  | 'hueSaturation'
  | 'colorBalance'
  | 'blackAndWhite';

export const ADJUSTMENT_MODE_LABELS: Record<
  AdjustmentMode,
  { ja: string; en: string }
> = {
  brightnessContrast: { ja: '明るさ・コントラスト', en: 'Brightness/Contrast' },
  levels: { ja: 'レベル補正', en: 'Levels' },
  curves: { ja: 'トーンカーブ', en: 'Curves' },
  exposure: { ja: '露光量', en: 'Exposure' },
  vibrance: { ja: '自然な彩度', en: 'Vibrance' },
  hueSaturation: { ja: '色相・彩度', en: 'Hue/Saturation' },
  colorBalance: { ja: 'カラーバランス', en: 'Color Balance' },
  blackAndWhite: { ja: '白黒', en: 'Black & White' },
};

const clamp = (value: number, min = 0, max = 255) =>
  Math.min(max, Math.max(min, value));

const balance = (value: Partial<ToneBalance> | undefined): ToneBalance => ({
  ...ZERO_BALANCE,
  ...value,
});

const levels = (value: Partial<LevelsChannel> | undefined): LevelsChannel => ({
  ...DEFAULT_LEVELS_CHANNEL,
  ...value,
});

export function normalizeColorAdjustments(
  value?: Partial<ColorAdjustments>,
): ColorAdjustments {
  return {
    ...DEFAULT_COLOR_ADJUSTMENTS,
    ...value,
    curve: normalizeCurve(value?.curve ?? DEFAULT_COLOR_ADJUSTMENTS.curve),
    curveRed: normalizeCurve(value?.curveRed ?? DEFAULT_COLOR_ADJUSTMENTS.curveRed),
    curveGreen: normalizeCurve(value?.curveGreen ?? DEFAULT_COLOR_ADJUSTMENTS.curveGreen),
    curveBlue: normalizeCurve(value?.curveBlue ?? DEFAULT_COLOR_ADJUSTMENTS.curveBlue),
    levelsRed: levels(value?.levelsRed),
    levelsGreen: levels(value?.levelsGreen),
    levelsBlue: levels(value?.levelsBlue),
    colorBalanceShadows: balance(value?.colorBalanceShadows),
    colorBalanceMidtones: balance(value?.colorBalanceMidtones),
    colorBalanceHighlights: balance(value?.colorBalanceHighlights),
  };
}

/** 旧 .llab の brightness/contrast/gamma を新しい補正スタックへ透過移行する。 */
export function colorAdjustmentsForLayer(layer: ImageLayer): ColorAdjustments {
  if (layer.adjustments) return normalizeColorAdjustments(layer.adjustments);
  return normalizeColorAdjustments({
    brightness: layer.brightness ?? 0,
    contrast: layer.contrast ?? 0,
    inputGamma: layer.gamma ?? 1,
  });
}

export function isDefaultColorAdjustments(value?: Partial<ColorAdjustments>): boolean {
  const a = normalizeColorAdjustments(value);
  const d = DEFAULT_COLOR_ADJUSTMENTS;
  return (
    a.brightness === d.brightness &&
    a.contrast === d.contrast &&
    a.legacyBrightnessContrast === d.legacyBrightnessContrast &&
    a.inputBlack === d.inputBlack &&
    a.inputGamma === d.inputGamma &&
    a.inputWhite === d.inputWhite &&
    a.outputBlack === d.outputBlack &&
    a.outputWhite === d.outputWhite &&
    sameLevels(a.levelsRed, d.levelsRed) &&
    sameLevels(a.levelsGreen, d.levelsGreen) &&
    sameLevels(a.levelsBlue, d.levelsBlue) &&
    a.exposure === d.exposure &&
    a.exposureOffset === d.exposureOffset &&
    a.exposureGamma === d.exposureGamma &&
    a.hue === d.hue &&
    a.saturation === d.saturation &&
    a.lightness === d.lightness &&
    a.colorize === d.colorize &&
    a.vibrance === d.vibrance &&
    a.vibranceSaturation === d.vibranceSaturation &&
    sameBalance(a.colorBalanceShadows, d.colorBalanceShadows) &&
    sameBalance(a.colorBalanceMidtones, d.colorBalanceMidtones) &&
    sameBalance(a.colorBalanceHighlights, d.colorBalanceHighlights) &&
    a.preserveLuminosity === d.preserveLuminosity &&
    a.blackAndWhite === d.blackAndWhite &&
    a.blackWhiteReds === d.blackWhiteReds &&
    a.blackWhiteYellows === d.blackWhiteYellows &&
    a.blackWhiteGreens === d.blackWhiteGreens &&
    a.blackWhiteCyans === d.blackWhiteCyans &&
    a.blackWhiteBlues === d.blackWhiteBlues &&
    a.blackWhiteMagentas === d.blackWhiteMagentas &&
    a.invert === d.invert &&
    sameCurve(a.curve, d.curve) &&
    sameCurve(a.curveRed, d.curveRed) &&
    sameCurve(a.curveGreen, d.curveGreen) &&
    sameCurve(a.curveBlue, d.curveBlue)
  );
}

function sameLevels(a: LevelsChannel, b: LevelsChannel) {
  return a.inputBlack === b.inputBlack
    && a.inputGamma === b.inputGamma
    && a.inputWhite === b.inputWhite
    && a.outputBlack === b.outputBlack
    && a.outputWhite === b.outputWhite;
}

function sameBalance(a: ToneBalance, b: ToneBalance) {
  return a.cyanRed === b.cyanRed && a.magentaGreen === b.magentaGreen && a.yellowBlue === b.yellowBlue;
}

function sameCurve(a: CurvePoint[], b: CurvePoint[]) {
  return a.length === b.length && a.every((point, i) => point.x === b[i].x && point.y === b[i].y);
}

export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  const byX = new Map<number, CurvePoint>();
  for (const point of points) {
    const x = Math.round(clamp(point.x));
    byX.set(x, { x, y: Math.round(clamp(point.y)) });
  }
  if (!byX.has(0)) byX.set(0, { x: 0, y: 0 });
  if (!byX.has(255)) byX.set(255, { x: 255, y: 255 });
  return [...byX.values()].sort((a, b) => a.x - b.x);
}

export function curveLut(points: CurvePoint[]): Uint8Array {
  const sorted = normalizeCurve(points);
  const lut = new Uint8Array(256);
  const secants = sorted.slice(0, -1).map((point, index) => {
    const next = sorted[index + 1];
    return (next.y - point.y) / Math.max(1, next.x - point.x);
  });
  const tangents = sorted.map((_, index) => {
    if (index === 0) return secants[0] ?? 0;
    if (index === sorted.length - 1) return secants[secants.length - 1] ?? 0;
    const left = secants[index - 1];
    const right = secants[index];
    if (left === 0 || right === 0 || Math.sign(left) !== Math.sign(right)) return 0;
    return (left + right) / 2;
  });
  let segment = 0;
  for (let x = 0; x < 256; x += 1) {
    while (segment < sorted.length - 2 && x > sorted[segment + 1].x) segment += 1;
    const left = sorted[segment];
    const right = sorted[Math.min(sorted.length - 1, segment + 1)];
    const span = Math.max(1, right.x - left.x);
    const amount = clamp((x - left.x) / span, 0, 1);
    const t2 = amount * amount;
    const t3 = t2 * amount;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + amount;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const value = h00 * left.y
      + h10 * span * tangents[segment]
      + h01 * right.y
      + h11 * span * tangents[Math.min(tangents.length - 1, segment + 1)];
    lut[x] = Math.round(clamp(value));
  }
  return lut;
}

function rgbToHsl(r255: number, g255: number, b255: number) {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta > 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = ((h * 60) + 360) % 360;
  }
  return { h, s: Number.isFinite(s) ? s : 0, l };
}

function hueToRgb(p: number, q: number, t0: number) {
  let t = t0;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(hDegrees: number, s: number, l: number) {
  const h = (((hDegrees % 360) + 360) % 360) / 360;
  if (s <= 0) {
    const gray = l * 255;
    return [gray, gray, gray] as const;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255,
  ] as const;
}

function applySaturation(s: number, amount: number) {
  const normalized = amount / 100;
  return clamp(
    normalized >= 0 ? s + (1 - s) * normalized : s * (1 + normalized),
    0,
    1,
  );
}

function applyBrightnessContrast(value: number, a: ColorAdjustments) {
  let v = value;
  if (a.legacyBrightnessContrast) {
    v += a.brightness * 255 / 150;
  } else if (a.brightness >= 0) {
    v += (255 - v) * (a.brightness / 150);
  } else {
    v *= 1 + a.brightness / 150;
  }
  // The negative side must compress contrast gradually.  Using the positive
  // formula there made -50 collapse every channel to middle gray.
  const contrastFactor = a.contrast < 0
    ? 1 + a.contrast / 100
    : 1 + a.contrast / 50;
  return (v - 127.5) * Math.max(0, contrastFactor) + 127.5;
}

function srgbToLinear(value: number) {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  return value <= 0.0031308
    ? value * 12.92
    : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

function toneWeights(luminance: number) {
  const x = clamp(luminance / 255, 0, 1);
  return {
    shadows: Math.pow(1 - x, 2),
    midtones: 1 - Math.abs(2 * x - 1),
    highlights: Math.pow(x, 2),
  };
}

function balanceDelta(
  shadow: number,
  midtone: number,
  highlight: number,
  weights: ReturnType<typeof toneWeights>,
) {
  return (shadow * weights.shadows + midtone * weights.midtones + highlight * weights.highlights) * 1.275;
}

const BW_DEFAULTS = [40, 60, 40, 60, 20, 80];

function blackWhiteValue(r: number, g: number, b: number, a: ColorAdjustments) {
  const hsl = rgbToHsl(r, g, b);
  const weights = [
    a.blackWhiteReds,
    a.blackWhiteYellows,
    a.blackWhiteGreens,
    a.blackWhiteCyans,
    a.blackWhiteBlues,
    a.blackWhiteMagentas,
  ];
  const sector = hsl.h / 60;
  const i = Math.floor(sector) % 6;
  const next = (i + 1) % 6;
  const mix = sector - Math.floor(sector);
  const userWeight = weights[i] + (weights[next] - weights[i]) * mix;
  const baseWeight = BW_DEFAULTS[i] + (BW_DEFAULTS[next] - BW_DEFAULTS[i]) * mix;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance * (userWeight / Math.max(1, baseWeight));
}

/** Konva filter とテストの双方から使う、RGBA 配列のインプレース補正。 */
export function applyColorAdjustmentsToRgba(
  data: Uint8ClampedArray,
  raw: Partial<ColorAdjustments>,
  mask?: Uint8ClampedArray,
) {
  const a = normalizeColorAdjustments(raw);
  const lut = curveLut(a.curve);
  const redLut = curveLut(a.curveRed);
  const greenLut = curveLut(a.curveGreen);
  const blueLut = curveLut(a.curveBlue);
  const exposureFactor = Math.pow(2, a.exposure);
  const levelsSpan = Math.max(1, a.inputWhite - a.inputBlack);
  const outputSpan = a.outputWhite - a.outputBlack;
  const curveActive = !sameCurve(a.curve, DEFAULT_COLOR_ADJUSTMENTS.curve);
  const redCurveActive = !sameCurve(a.curveRed, DEFAULT_COLOR_ADJUSTMENTS.curveRed);
  const greenCurveActive = !sameCurve(a.curveGreen, DEFAULT_COLOR_ADJUSTMENTS.curveGreen);
  const blueCurveActive = !sameCurve(a.curveBlue, DEFAULT_COLOR_ADJUSTMENTS.curveBlue);
  const colorActive = a.hue !== 0 || a.saturation !== 0 || a.lightness !== 0 || a.colorize || a.vibrance !== 0 || a.vibranceSaturation !== 0;
  const balanceActive = !sameBalance(a.colorBalanceShadows, ZERO_BALANCE)
    || !sameBalance(a.colorBalanceMidtones, ZERO_BALANCE)
    || !sameBalance(a.colorBalanceHighlights, ZERO_BALANCE);

  for (let i = 0; i < data.length; i += 4) {
    const maskAmount = mask ? (mask[i / 4] ?? 0) / 255 : 1;
    if (maskAmount <= 0) continue;
    const originalR = data[i];
    const originalG = data[i + 1];
    const originalB = data[i + 2];
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // Exposure is evaluated in linear-light RGB.  Applying 2^EV directly to
    // 8-bit sRGB made a mid-gray (128) clip to white at +1 EV.
    const expose = (value: number) => {
      const linear = srgbToLinear(value / 255);
      const adjusted = Math.pow(
        Math.max(0, linear * exposureFactor + a.exposureOffset),
        1 / Math.max(0.01, a.exposureGamma),
      );
      return linearToSrgb(adjusted) * 255;
    };
    r = expose(r);
    g = expose(g);
    b = expose(b);

    r = applyBrightnessContrast(r, a);
    g = applyBrightnessContrast(g, a);
    b = applyBrightnessContrast(b, a);

    const level = (value: number) => {
      const input = clamp((value - a.inputBlack) / levelsSpan, 0, 1);
      return a.outputBlack + Math.pow(input, 1 / Math.max(0.01, a.inputGamma)) * outputSpan;
    };
    r = level(r);
    g = level(g);
    b = level(b);

    const channelLevel = (value: number, channel: LevelsChannel) => {
      const span = Math.max(1, channel.inputWhite - channel.inputBlack);
      const input = clamp((value - channel.inputBlack) / span, 0, 1);
      return channel.outputBlack
        + Math.pow(input, 1 / Math.max(0.01, channel.inputGamma))
        * (channel.outputWhite - channel.outputBlack);
    };
    r = channelLevel(r, a.levelsRed);
    g = channelLevel(g, a.levelsGreen);
    b = channelLevel(b, a.levelsBlue);

    if (curveActive) {
      r = lut[Math.round(clamp(r))];
      g = lut[Math.round(clamp(g))];
      b = lut[Math.round(clamp(b))];
    }
    if (redCurveActive) r = redLut[Math.round(clamp(r))];
    if (greenCurveActive) g = greenLut[Math.round(clamp(g))];
    if (blueCurveActive) b = blueLut[Math.round(clamp(b))];

    if (colorActive) {
      const hsl = rgbToHsl(r, g, b);
      const hue = a.colorize ? a.hue : hsl.h + a.hue;
      const baseSaturation = a.colorize ? Math.max(0, a.saturation / 100) : hsl.s;
      let saturation = a.colorize ? baseSaturation : applySaturation(baseSaturation, a.saturation);
      saturation = applySaturation(saturation, a.vibranceSaturation);
      const vibrance = a.vibrance / 100;
      // Vibrance は低彩度色を優先し、肌色域（およそ15–55°）を穏やかに保護する。
      const skinDistance = Math.min(
        Math.abs(((hsl.h - 35 + 540) % 360) - 180),
        180,
      );
      const skinProtection = vibrance > 0
        ? Math.max(0, 1 - skinDistance / 25) * 0.65
        : 0;
      const effectiveVibrance = vibrance * (1 - skinProtection);
      saturation = clamp(
        effectiveVibrance >= 0
          ? saturation + (1 - saturation) * effectiveVibrance * (1 - saturation)
          : saturation * (1 + effectiveVibrance),
        0,
        1,
      );
      const lightness = clamp(
        a.lightness >= 0
          ? hsl.l + (1 - hsl.l) * a.lightness / 100
          : hsl.l * (1 + a.lightness / 100),
        0,
        1,
      );
      [r, g, b] = hslToRgb(hue, saturation, lightness);
    }

    if (balanceActive) {
      const oldLuminance = 0.299 * r + 0.587 * g + 0.114 * b;
      const weights = toneWeights(oldLuminance);
      r += balanceDelta(a.colorBalanceShadows.cyanRed, a.colorBalanceMidtones.cyanRed, a.colorBalanceHighlights.cyanRed, weights);
      g += balanceDelta(a.colorBalanceShadows.magentaGreen, a.colorBalanceMidtones.magentaGreen, a.colorBalanceHighlights.magentaGreen, weights);
      b += balanceDelta(a.colorBalanceShadows.yellowBlue, a.colorBalanceMidtones.yellowBlue, a.colorBalanceHighlights.yellowBlue, weights);
      if (a.preserveLuminosity) {
        const newLuminance = 0.299 * r + 0.587 * g + 0.114 * b;
        const delta = oldLuminance - newLuminance;
        r += delta;
        g += delta;
        b += delta;
      }
    }

    if (a.blackAndWhite) {
      const gray = blackWhiteValue(r, g, b, a);
      r = gray;
      g = gray;
      b = gray;
    }

    if (a.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = Math.round(clamp(originalR + (r - originalR) * maskAmount));
    data[i + 1] = Math.round(clamp(originalG + (g - originalG) * maskAmount));
    data[i + 2] = Math.round(clamp(originalB + (b - originalB) * maskAmount));
  }
}

export function resetAdjustmentMode(
  value: ColorAdjustments,
  mode: AdjustmentMode,
): ColorAdjustments {
  const next = normalizeColorAdjustments(value);
  const d = DEFAULT_COLOR_ADJUSTMENTS;
  switch (mode) {
    case 'brightnessContrast':
      return { ...next, brightness: d.brightness, contrast: d.contrast, legacyBrightnessContrast: d.legacyBrightnessContrast };
    case 'levels':
      return {
        ...next,
        inputBlack: d.inputBlack,
        inputGamma: d.inputGamma,
        inputWhite: d.inputWhite,
        outputBlack: d.outputBlack,
        outputWhite: d.outputWhite,
        levelsRed: { ...d.levelsRed },
        levelsGreen: { ...d.levelsGreen },
        levelsBlue: { ...d.levelsBlue },
      };
    case 'curves':
      return {
        ...next,
        curve: d.curve.map((point) => ({ ...point })),
        curveRed: d.curveRed.map((point) => ({ ...point })),
        curveGreen: d.curveGreen.map((point) => ({ ...point })),
        curveBlue: d.curveBlue.map((point) => ({ ...point })),
      };
    case 'exposure':
      return { ...next, exposure: d.exposure, exposureOffset: d.exposureOffset, exposureGamma: d.exposureGamma };
    case 'vibrance':
      return { ...next, vibrance: d.vibrance, vibranceSaturation: d.vibranceSaturation };
    case 'hueSaturation':
      return { ...next, hue: d.hue, saturation: d.saturation, lightness: d.lightness, colorize: d.colorize };
    case 'colorBalance':
      return {
        ...next,
        colorBalanceShadows: { ...d.colorBalanceShadows },
        colorBalanceMidtones: { ...d.colorBalanceMidtones },
        colorBalanceHighlights: { ...d.colorBalanceHighlights },
        preserveLuminosity: d.preserveLuminosity,
      };
    case 'blackAndWhite':
      return {
        ...next,
        blackAndWhite: true,
        blackWhiteReds: d.blackWhiteReds,
        blackWhiteYellows: d.blackWhiteYellows,
        blackWhiteGreens: d.blackWhiteGreens,
        blackWhiteCyans: d.blackWhiteCyans,
        blackWhiteBlues: d.blackWhiteBlues,
        blackWhiteMagentas: d.blackWhiteMagentas,
      };
  }
}
