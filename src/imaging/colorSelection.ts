export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorSelectionOptions {
  /** 0（完全一致）〜255（広い色域）。 */
  tolerance: number;
  /** クリック点からつながった範囲だけを選択する。 */
  contiguous: boolean;
  /** 色の近さに基づく半透明の境界を生成する。 */
  antiAlias: boolean;
}

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < SRGB_TO_LINEAR.length; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] =
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

interface OklabColor {
  l: number;
  a: number;
  b: number;
}

function toOklab(color: RgbaColor): OklabColor {
  const r = SRGB_TO_LINEAR[Math.round(color.r)];
  const g = SRGB_TO_LINEAR[Math.round(color.g)];
  const b = SRGB_TO_LINEAR[Math.round(color.b)];

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);

  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  };
}

function perceptualPixelDistance(
  data: Uint8ClampedArray,
  pixelIndex: number,
  reference: RgbaColor,
  referenceLab: OklabColor,
): number {
  const offset = pixelIndex * 4;
  const alpha = data[offset + 3];
  const alphaDelta = Math.abs(alpha - reference.a);
  if (alpha <= 4 && reference.a <= 4) return alphaDelta;

  const r = SRGB_TO_LINEAR[data[offset]];
  const g = SRGB_TO_LINEAR[data[offset + 1]];
  const b = SRGB_TO_LINEAR[data[offset + 2]];
  const lRoot = Math.cbrt(
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
  );
  const mRoot = Math.cbrt(
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
  );
  const sRoot = Math.cbrt(
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  );
  const lightness =
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const greenRed =
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const blueYellow =
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const dl = (lightness - referenceLab.l) * 1.12;
  const da = greenRed - referenceLab.a;
  const db = blueYellow - referenceLab.b;
  const visibleColorWeight = Math.min(alpha, reference.a) / 255;
  const colorDelta = Math.hypot(dl, da, db) * 255 * visibleColorWeight;
  return Math.hypot(colorDelta, alphaDelta * 0.75);
}

/**
 * 人の見た目に近い OKLab 色差を、ワンドの許容値と同じおおよそ 0〜255 に換算する。
 * 透明ピクセル同士は RGB の隠し値を無視し、アルファ差だけで比較する。
 */
export function perceptualColorDistance(
  first: RgbaColor,
  second: RgbaColor,
): number {
  const alphaDelta = Math.abs(first.a - second.a);
  if (first.a <= 4 && second.a <= 4) return alphaDelta;

  const firstLab = toOklab(first);
  const secondLab = toOklab(second);
  const dl = (firstLab.l - secondLab.l) * 1.12;
  const da = firstLab.a - secondLab.a;
  const db = firstLab.b - secondLab.b;

  // 透明に近い画素ほど、格納されている RGB 値の影響を弱める。
  const visibleColorWeight = Math.min(first.a, second.a) / 255;
  const colorDelta = Math.hypot(dl, da, db) * 255 * visibleColorWeight;
  return Math.hypot(colorDelta, alphaDelta * 0.75);
}

function pixelAt(
  data: Uint8ClampedArray,
  pixelIndex: number,
): RgbaColor {
  const offset = pixelIndex * 4;
  return {
    r: data[offset],
    g: data[offset + 1],
    b: data[offset + 2],
    a: data[offset + 3],
  };
}

/**
 * クリック点周辺の似た画素だけを平均し、JPEGノイズや単独の色むらに強い基準色を作る。
 * 中心色から離れた画素は除外するため、輪郭付近で被写体色が混ざりにくい。
 */
export function estimateSeedColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): RgbaColor {
  const centerIndex = seedY * width + seedX;
  const center = pixelAt(data, centerIndex);
  if (tolerance <= 0) return center;

  const radius = 2;
  const sampleGate = Math.max(8, Math.min(42, tolerance * 0.7 + 6));
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    const y = seedY + dy;
    if (y < 0 || y >= height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = seedX + dx;
      if (x < 0 || x >= width) continue;
      const color = pixelAt(data, y * width + x);
      if (perceptualColorDistance(center, color) > sampleGate) continue;

      const weight = 1 / (1 + dx * dx + dy * dy);
      totalWeight += weight;
      r += color.r * weight;
      g += color.g * weight;
      b += color.b * weight;
      a += color.a * weight;
    }
  }

  if (totalWeight === 0) return center;
  return {
    r: r / totalWeight,
    g: g / totalWeight,
    b: b / totalWeight,
    a: a / totalWeight,
  };
}

function smoothstep(start: number, end: number, value: number): number {
  if (start === end) return value < start ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}

/**
 * RGBA画像から知覚色差ベースの選択マスクを生成する。
 * 戻り値は 0=非選択、255=完全選択、中間値=半選択。
 */
export function createColorSelectionMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  options: ColorSelectionOptions,
): Uint8ClampedArray {
  const pixelCount = width * height;
  const empty = new Uint8ClampedArray(Math.max(0, pixelCount));
  if (
    width <= 0 ||
    height <= 0 ||
    data.length < pixelCount * 4 ||
    seedX < 0 ||
    seedY < 0 ||
    seedX >= width ||
    seedY >= height
  ) {
    return empty;
  }

  const tolerance = Math.max(0, Math.min(255, options.tolerance));
  const reference = estimateSeedColor(
    data,
    width,
    height,
    seedX,
    seedY,
    tolerance,
  );
  const referenceLab = toOklab(reference);
  const scoreCache = new Float32Array(pixelCount);
  scoreCache.fill(-1);

  const scoreAt = (pixelIndex: number): number => {
    const cached = scoreCache[pixelIndex];
    if (cached >= 0) return cached;
    const score = perceptualPixelDistance(
      data,
      pixelIndex,
      reference,
      referenceLab,
    );
    scoreCache[pixelIndex] = score;
    return score;
  };

  const selected = new Uint8Array(pixelCount);
  if (options.contiguous) {
    const queue = new Int32Array(pixelCount);
    const visited = new Uint8Array(pixelCount);
    let read = 0;
    let write = 0;
    const seedIndex = seedY * width + seedX;
    queue[write++] = seedIndex;
    visited[seedIndex] = 1;

    while (read < write) {
      const pixelIndex = queue[read++];
      if (scoreAt(pixelIndex) > tolerance) continue;
      selected[pixelIndex] = 1;

      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      const visit = (next: number) => {
        if (visited[next]) return;
        visited[next] = 1;
        queue[write++] = next;
      };
      if (x > 0) visit(pixelIndex - 1);
      if (x + 1 < width) visit(pixelIndex + 1);
      if (y > 0) visit(pixelIndex - width);
      if (y + 1 < height) visit(pixelIndex + width);
    }
  } else {
    for (let i = 0; i < pixelCount; i++) {
      if (scoreAt(i) <= tolerance) selected[i] = 1;
    }
  }

  const result = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    if (selected[i]) result[i] = 255;
  }
  if (!options.antiAlias) return result;

  // 色差が許容値を少しだけ超えた境界画素に限って半選択にする。
  // 単なる隣接数では広げないので、高コントラストの被写体を削りにくい。
  const edgeWidth = Math.max(2, Math.min(14, tolerance * 0.28 + 2));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      if (selected[pixelIndex]) continue;

      let touchesSelection = false;
      for (let dy = -1; dy <= 1 && !touchesSelection; dy++) {
        const nearY = y + dy;
        if (nearY < 0 || nearY >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nearX = x + dx;
          if (nearX < 0 || nearX >= width) continue;
          if (selected[nearY * width + nearX]) {
            touchesSelection = true;
            break;
          }
        }
      }
      if (!touchesSelection) continue;

      const score = scoreAt(pixelIndex);
      if (score > tolerance + edgeWidth) continue;
      const outside = smoothstep(tolerance, tolerance + edgeWidth, score);
      result[pixelIndex] = Math.round((1 - outside) * 255);
    }
  }

  return result;
}
