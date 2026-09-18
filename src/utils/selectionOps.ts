import Konva from 'konva';
import { useEditorStore, getActiveStore, createImageLayer } from '../store/editorStore';
import type { Selection, ImageLayer, ColorAdjustments } from '../types';
import { toast } from '../store/toastStore';
import { t } from '../i18n/locale';
import { createColorSelectionMask } from '../imaging/colorSelection';
import {
  applyColorAdjustmentsToRgba,
  colorAdjustmentsForLayer,
} from '../imaging/colorAdjustments';

function getStage(): Konva.Stage | null {
  return Konva.stages[0] ?? null;
}

const MAX_RASTER_DIMENSION = 32_767;
// 現pipelineは複数のRGBA bufferを同時保持するため、4K²を安全上限とする。
const MAX_RASTER_PIXELS = 16_777_216;

/** Browser canvas allocationを始める前の共通OOM guard。 */
function isSafeRasterSize(width: number, height: number) {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_RASTER_DIMENSION
    && height <= MAX_RASTER_DIMENSION
    && width * height <= MAX_RASTER_PIXELS;
}

/** ガイド・選択境界・変形ハンドルを除いた可視合成を取得。書出しの正典。 */
export function renderCompositeCanvas(pixelRatio = 1): HTMLCanvasElement | null {
  const stage = getStage();
  if (!stage) return null;
  const { width, height } = useEditorStore.getState().canvas;
  const sc = stage.scaleX() || 1;
  const hidden: Array<{ node: Konva.Node; visible: boolean }> = [];
  const hide = (node: Konva.Node | null | undefined) => {
    if (!node) return;
    hidden.push({ node, visible: node.visible() });
    node.visible(false);
  };
  hide(stage.findOne('.ll-overlay'));
  hide(stage.findOne('.ll-transient-overlay'));
  stage.find('Transformer').forEach((node) => hide(node));
  try {
    return stage.toCanvas({
      x: 0,
      y: 0,
      width: width * sc,
      height: height * sc,
      pixelRatio: pixelRatio / sc,
    }) as HTMLCanvasElement;
  } finally {
    for (const item of hidden) item.node.visible(item.visible);
    stage.batchDraw();
  }
}

const compositeCanvas = () => renderCompositeCanvas(1);

/**
 * 指定した id 群のレイヤーだけを表示した状態でキャンバス(1:1解像度)を取得する。
 * ドキュメント背景(ll-bg)・オーバーレイ(ll-overlay)・変形ハンドル(Transformer)は
 * 除外するので、レイヤーの実ピクセルだけが透過付きで焼ける（レイヤー統合用）。
 * 各ノードの元の可視状態を控えて復元するため、非表示レイヤーを誤って表示化しない。
 */
export function rasterizeLayers(keepIds: string[]): HTMLCanvasElement | null {
  const stage = getStage();
  if (!stage) return null;
  const st = useEditorStore.getState();
  const { width, height } = st.canvas;
  const sc = stage.scaleX() || 1;
  const keep = new Set(keepIds);

  // 焼き込みたくないノードを一時的に隠す（背景・オーバーレイ・変形ハンドル）
  const hiddenNodes: { node: Konva.Node; prev: boolean }[] = [];
  const hide = (node: Konva.Node | null | undefined) => {
    if (!node) return;
    hiddenNodes.push({ node, prev: node.visible() });
    node.visible(false);
  };
  hide(stage.findOne('.ll-bg'));
  hide(stage.findOne('.ll-overlay'));
  hide(stage.findOne('.ll-transient-overlay'));
  stage.find('Transformer').forEach((n) => hide(n));

  // keep に含まれない(グループ以外の)レイヤーノードを隠す
  for (const lyr of st.layers) {
    if (lyr.type === 'group' || keep.has(lyr.id)) continue;
    hide(stage.findOne('#' + lyr.id));
  }

  try {
    return stage.toCanvas({
      x: 0,
      y: 0,
      width: width * sc,
      height: height * sc,
      pixelRatio: 1 / sc,
    }) as HTMLCanvasElement;
  } finally {
    // toCanvas can throw (e.g. an allocation or tainted-image failure). Never
    // leave the editor with unrelated layers hidden in that case.
    for (const { node, prev } of hiddenNodes) node.visible(prev);
    stage.batchDraw();
  }
}

/** 選択範囲をキャンバス全面のアルファマスク(白=選択)へ焼く。 */
export function selectionToMaskCanvas(
  sel: Selection,
  w: number,
  h: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  if (sel.type === 'rect') {
    ctx.fillRect(sel.x, sel.y, sel.width, sel.height);
  } else if (sel.type === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(sel.x + sel.width / 2, sel.y + sel.height / 2, sel.width / 2, sel.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (sel.type === 'poly') {
    const p = sel.points;
    if (p.length >= 6) {
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
  } else if (sel.type === 'mask') {
    if ((sel as any)._raw instanceof Uint8ClampedArray) {
      const raw = (sel as any)._raw as Uint8ClampedArray;
      const imgData = ctx.createImageData(sel.width, sel.height);
      for (let i = 0; i < sel.width * sel.height; i++) {
        imgData.data[i * 4] = raw[i];
        imgData.data[i * 4 + 1] = raw[i];
        imgData.data[i * 4 + 2] = raw[i];
        imgData.data[i * 4 + 3] = raw[i];
      }
      ctx.putImageData(imgData, sel.x, sel.y);
    } else {
      // Fallback: use first contour as polygon
      const p = sel.contours[0] ?? [];
      if (p.length >= 6) {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  return c;
}

/** Canvas座標の選択を、変形前の画像レイヤーpixel座標へ写した8-bit mask。 */
export function selectionMaskForImageLayer(
  selection: Selection,
  layer: ImageLayer,
  canvasWidth: number,
  canvasHeight: number,
) {
  const documentMask = selectionToMaskCanvas(selection, canvasWidth, canvasHeight);
  const localMask = document.createElement('canvas');
  localMask.width = layer.naturalWidth;
  localMask.height = layer.naturalHeight;
  const context = localMask.getContext('2d', { willReadFrequently: true })!;
  try {
    const inverse = new DOMMatrix()
      .translate(layer.x, layer.y)
      .rotate(layer.rotation)
      .scale(layer.scaleX, layer.scaleY)
      .inverse();
    context.setTransform(inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f);
    context.drawImage(documentMask, 0, 0);
  } catch {
    return new Uint8ClampedArray(layer.naturalWidth * layer.naturalHeight);
  }
  const rgba = context.getImageData(0, 0, localMask.width, localMask.height).data;
  const mask = new Uint8ClampedArray(localMask.width * localMask.height);
  for (let i = 0; i < mask.length; i += 1) mask[i] = rgba[i * 4 + 3];
  return mask;
}

/** 元画像のローカルpixelだけを選択maskで残す/消す。transformやlayer styleは焼かない。 */
async function rasterLayerPixelSelection(
  layer: ImageLayer,
  selection: Selection | null,
  canvasWidth: number,
  canvasHeight: number,
  operation: 'keep' | 'remove',
) {
  if (
    !isSafeRasterSize(layer.naturalWidth, layer.naturalHeight)
    || (selection && !isSafeRasterSize(canvasWidth, canvasHeight))
  ) return null;
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () => resolve(null);
      source.src = layer.src;
    });
    if (!image) return null;
    const output = document.createElement('canvas');
    output.width = layer.naturalWidth;
    output.height = layer.naturalHeight;
    const context = output.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, output.width, output.height);
    const pixels = context.getImageData(0, 0, output.width, output.height);
    const mask = selection
      ? selectionMaskForImageLayer(selection, layer, canvasWidth, canvasHeight)
      : null;
    for (let pixel = 0; pixel < output.width * output.height; pixel += 1) {
      const selected = mask ? mask[pixel] / 255 : 1;
      const alphaFactor = operation === 'keep' ? selected : 1 - selected;
      pixels.data[pixel * 4 + 3] = Math.round(pixels.data[pixel * 4 + 3] * alphaFactor);
    }
    context.putImageData(pixels, 0, 0);
    return output.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Photoshop の標準 Copy/Cut 用pixelを作る。
 *
 * 表示合成（opacity / style / clip / blend）は Copy Merged の責務なので焼かない。
 * 同じlocal maskからclipboardとCut後srcを分配し、clipboard側だけdocument座標の
 * translate / rotate / scale / flipを適用する。これにより非表示・画面外pixelを
 * 失わず、CopyとCutの向き・解像度も一致する。
 */
async function prepareLocalLayerClipboard(
  layer: ImageLayer,
  selection: Selection | null,
  canvasWidth: number,
  canvasHeight: number,
) {
  const width = layer.naturalWidth;
  const height = layer.naturalHeight;
  // decode/Canvas/ImageDataを始める前に拒否し、巨大画像でrenderer自体がOOMするのを防ぐ。
  if (
    !isSafeRasterSize(width, height)
    || (selection && !isSafeRasterSize(canvasWidth, canvasHeight))
  ) return null;
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const source = new Image();
    source.onload = () => resolve(source);
    source.onerror = () => resolve(null);
    source.src = layer.src;
  });
  if (!image) return null;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return null;
  sourceContext.drawImage(image, 0, 0, width, height);
  const remaining = sourceContext.getImageData(0, 0, width, height);
  const selectedPixels = new ImageData(new Uint8ClampedArray(remaining.data), width, height);
  applyColorAdjustmentsToRgba(selectedPixels.data, colorAdjustmentsForLayer(layer));
  const mask = selection
    ? selectionMaskForImageLayer(selection, layer, canvasWidth, canvasHeight)
    : null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const selected = mask ? mask[pixel] / 255 : 1;
    const alphaIndex = pixel * 4 + 3;
    const originalAlpha = remaining.data[alphaIndex];
    selectedPixels.data[alphaIndex] = Math.round(selectedPixels.data[alphaIndex] * selected);
    remaining.data[alphaIndex] = Math.round(originalAlpha * (1 - selected));
    if (selected > 0 && originalAlpha > 0) {
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;

  sourceContext.putImageData(remaining, 0, 0);
  const transform = new DOMMatrix()
    .translate(layer.x, layer.y)
    .rotate(layer.rotation)
    .scale(layer.scaleX, layer.scaleY);
  const corners = [
    [minX, minY],
    [maxX + 1, minY],
    [maxX + 1, maxY + 1],
    [minX, maxY + 1],
  ].map(([x, y]) => ({
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  }));
  const docMinX = Math.floor(Math.min(...corners.map((point) => point.x)));
  const docMinY = Math.floor(Math.min(...corners.map((point) => point.y)));
  const docMaxX = Math.ceil(Math.max(...corners.map((point) => point.x)));
  const docMaxY = Math.ceil(Math.max(...corners.map((point) => point.y)));
  const outputWidth = docMaxX - docMinX;
  const outputHeight = docMaxY - docMinY;
  const finiteBounds = [docMinX, docMinY, docMaxX, docMaxY, outputWidth, outputHeight]
    .every(Number.isFinite);
  if (
    !finiteBounds
    || outputWidth <= 0
    || outputHeight <= 0
    || outputWidth > MAX_RASTER_DIMENSION
    || outputHeight > MAX_RASTER_DIMENSION
    || outputWidth * outputHeight > MAX_RASTER_PIXELS
  ) return null;

  const selectedCanvas = document.createElement('canvas');
  selectedCanvas.width = width;
  selectedCanvas.height = height;
  const selectedContext = selectedCanvas.getContext('2d');
  if (!selectedContext) return null;
  selectedContext.putImageData(selectedPixels, 0, 0);
  const copiedCanvas = document.createElement('canvas');
  copiedCanvas.width = outputWidth;
  copiedCanvas.height = outputHeight;
  const copiedContext = copiedCanvas.getContext('2d');
  if (!copiedContext) return null;
  copiedContext.setTransform(
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e - docMinX,
    transform.f - docMinY,
  );
  copiedContext.drawImage(selectedCanvas, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => copiedCanvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return {
    blob,
    copiedSrc: copiedCanvas.toDataURL('image/png'),
    remainingSrc: sourceCanvas.toDataURL('image/png'),
    documentBounds: { x: docMinX, y: docMinY, width: outputWidth, height: outputHeight },
  };
}

/** 選択範囲のバウンディングボックス(キャンバス座標)。 */
export function selectionBounds(
  sel: Selection,
  w: number,
  h: number,
): { x: number; y: number; width: number; height: number } {
  if (sel.type === 'rect' || sel.type === 'ellipse' || sel.type === 'mask') {
    return { x: sel.x, y: sel.y, width: sel.width, height: sel.height };
  }
  // poly
  const p = sel.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  return {
    x,
    y,
    width: Math.min(w, Math.ceil(maxX)) - x,
    height: Math.min(h, Math.ceil(maxY)) - y,
  };
}

// ===== Magic Wand =====

/** マジックワンドのオプション。 */
export interface WandOptions {
  tolerance: number;
  /** true=クリック点から連続した領域 (flood fill) / false=全ピクセルをグローバルに比較 */
  contiguous: boolean;
  /** true=境界を滑らかに (アンチエイリアス) */
  antiAlias: boolean;
  /** true=合成結果からサンプル / false=アクティブレイヤーのみ */
  sampleMerged: boolean;
}

/** 選択ブール演算モード。 */
export type WandSelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * アクティブレイヤーのみ表示した状態でキャンバスを取得。
 * 他レイヤーを一時非表示にして stage.toCanvas() を呼び、復元する。
 */
function activeLayerCanvas(): HTMLCanvasElement | null {
  const stage = getStage();
  if (!stage) return null;
  const st = useEditorStore.getState();
  const activeId = st.selectedId;
  if (!activeId) return compositeCanvas();

  const { width, height } = st.canvas;
  const sc = stage.scaleX() || 1;

  const hiddenNodes: { node: Konva.Node; prev: boolean }[] = [];
  const hide = (node: Konva.Node | null | undefined) => {
    if (!node) return;
    hiddenNodes.push({ node, prev: node.visible() });
    node.visible(false);
  };
  hide(stage.findOne('.ll-bg'));
  hide(stage.findOne('.ll-overlay'));
  hide(stage.findOne('.ll-transient-overlay'));
  stage.find('Transformer').forEach((n) => hide(n));

  // アクティブ以外のレイヤーノードを非表示
  for (const lyr of st.layers) {
    if (lyr.id === activeId || lyr.type === 'group') continue;
    const node = stage.findOne('#' + lyr.id);
    hide(node);
  }

  const c = stage.toCanvas({
    x: 0,
    y: 0,
    width: width * sc,
    height: height * sc,
    pixelRatio: 1 / sc,
  }) as HTMLCanvasElement;

  // 復元
  hiddenNodes.forEach(({ node, prev }) => node.visible(prev));
  stage.batchDraw();
  return c;
}

/**
 * Image > Adjustments の確定処理。変形前の元画像pixelへ一度だけ適用し、
 * 順序・反復・選択範囲を保持する。位置/回転/scale/opacity/画面外pixelは不変。
 */
export async function commitImageAdjustment(
  layerId: string,
  adjustments: ColorAdjustments,
  selection: Selection | null,
) {
  const initialState = useEditorStore.getState();
  const layer = initialState.layers.find((candidate) => candidate.id === layerId);
  if (!layer || layer.type !== 'image' || layer.locked || initialState.selectedId !== layerId) return false;
  if (
    !isSafeRasterSize(layer.naturalWidth, layer.naturalHeight)
    || (selection && !isSafeRasterSize(initialState.canvas.width, initialState.canvas.height))
  ) return false;

  const preview = { layerId, adjustments, selection };
  initialState.setAdjustmentPreview(preview);
  try {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const source = new Image();
      source.onload = () => resolve(source);
      source.onerror = () => resolve(null);
      source.src = layer.src;
    });
    const currentState = useEditorStore.getState();
    const currentLayer = currentState.layers.find((candidate) => candidate.id === layerId);
    if (!image || currentLayer !== layer || currentState.selectedId !== layerId) return false;

    const output = document.createElement('canvas');
    output.width = layer.naturalWidth;
    output.height = layer.naturalHeight;
    const context = output.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, output.width, output.height);
    const pixels = context.getImageData(0, 0, output.width, output.height);
    // Older .llab files may still carry a non-destructive base adjustment. Bake
    // that first, then the new command, so order and repeat behavior stay exact.
    applyColorAdjustmentsToRgba(pixels.data, colorAdjustmentsForLayer(layer));
    const mask = selection
      ? selectionMaskForImageLayer(selection, layer, currentState.canvas.width, currentState.canvas.height)
      : undefined;
    applyColorAdjustmentsToRgba(pixels.data, adjustments, mask);
    context.putImageData(pixels, 0, 0);

    currentState.updateLayer(layerId, {
      src: output.toDataURL('image/png'),
      brightness: undefined,
      contrast: undefined,
      gamma: undefined,
      adjustments: undefined,
    } as Partial<ImageLayer>);
    return true;
  } catch {
    return false;
  } finally {
    const latestState = useEditorStore.getState();
    if (latestState.adjustmentPreview === preview) latestState.setAdjustmentPreview(null);
  }
}

/** 既存の Selection をバイナリマスク(0/1 Uint8Array)に変換。 */
function selectionToBinaryMask(sel: Selection, w: number, h: number): Uint8Array {
  const mc = selectionToMaskCanvas(sel, w, h);
  const d = mc.getContext('2d')!.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  return mask;
}

/**
 * float マスク(0.0〜1.0)から mask 型 Selection を生成。
 * contours は binaryThreshold=0.01 で抽出する。
 * _raw (Uint8ClampedArray, length w*h) を非列挙プロパティとして付与する。
 */
function floatMaskToSelection(mask: Float32Array, w: number, h: number): Selection | null {
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = mask[i] > 0.01 ? 1 : 0;
  const contour = contourFromMask(bin, w, h);
  if (!bin.some((v) => v)) return null;

  // Build rawU8 (0..255) for runtime cache and for the dataURL
  const rawU8 = new Uint8ClampedArray(w * h);
  const imgData = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.min(1, Math.max(0, mask[i])) * 255);
    rawU8[i] = v;
    imgData.data[i * 4] = 255;
    imgData.data[i * 4 + 3] = v;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(imgData, 0, 0);

  const sel: Selection = {
    type: 'mask',
    x: 0,
    y: 0,
    width: w,
    height: h,
    data: c.toDataURL(),
    contours: contour.length >= 6 ? [contour] : [],
  };
  // _raw is a runtime-only cache: non-enumerable so it is excluded from JSON
  // serialization (.llab saving) and from zundo's JSON.stringify equality check.
  Object.defineProperty(sel, '_raw', {
    value: rawU8,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return sel;
}

/** マスク(1=選択)の外周をエッジ追跡し、最長の閉ループをポリラインで返す。 */
export function contourFromMask(mask: Uint8Array, w: number, h: number): number[] {
  const sel = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  // 境界エッジを有向セグメントとして収集（選択セルの外側に向けて時計回り）
  const edges = new Map<string, [number, number]>(); // "x,y" -> next point
  const key = (x: number, y: number) => `${x},${y}`;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!sel(x, y)) continue;
      if (!sel(x, y - 1)) edges.set(key(x, y), [x + 1, y]); // top: → 右
      if (!sel(x + 1, y)) edges.set(key(x + 1, y), [x + 1, y + 1]); // right: ↓
      if (!sel(x, y + 1)) edges.set(key(x + 1, y + 1), [x, y + 1]); // bottom: ← 左
      if (!sel(x - 1, y)) edges.set(key(x, y + 1), [x, y]); // left: ↑
    }
  }
  if (edges.size === 0) return [];
  // ループを辿る（複数あれば最長を採用）
  const visited = new Set<string>();
  let best: number[] = [];
  for (const [startKey, startNext] of edges) {
    if (visited.has(startKey)) continue;
    const loop: number[] = [];
    const [sx, sy] = startKey.split(',').map(Number);
    let cx = sx, cy = sy;
    let next: [number, number] | undefined = [sx, sy];
    let guard = 0;
    while (next && guard++ < edges.size + 5) {
      const k = key(cx, cy);
      if (visited.has(k)) break;
      visited.add(k);
      loop.push(cx, cy);
      next = edges.get(k);
      if (!next) break;
      [cx, cy] = next;
      if (cx === sx && cy === sy) break;
    }
    void startNext;
    if (loop.length > best.length) best = loop;
  }
  // 共線点を間引く
  return simplifyColinear(best);
}

function simplifyColinear(pts: number[]): number[] {
  if (pts.length < 6) return pts;
  const out: number[] = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const px = pts[((i - 1 + n) % n) * 2], py = pts[((i - 1 + n) % n) * 2 + 1];
    const cx = pts[i * 2], cy = pts[i * 2 + 1];
    const nx = pts[((i + 1) % n) * 2], ny = pts[((i + 1) % n) * 2 + 1];
    const cross = (cx - px) * (ny - py) - (cy - py) * (nx - px);
    if (cross !== 0) out.push(cx, cy); // 角だけ残す
  }
  return out.length >= 6 ? out : pts;
}

/**
 * クリック点から色の近い領域を選択し Selection を返す。
 * contiguous=true で flood fill、false でグローバル全ピクセル照合。
 * antiAlias=true で境界をソフトに（mask 型 Selection を返す）。
 * mode で既存選択とのブール演算（Shift=add, Alt=subtract, Shift+Alt=intersect）。
 *
 * 穴(holes)の扱い: 4連結 flood fill なので、オブジェクトに完全に囲まれた
 * 内側の穴はクリック点が外部なら選択されない（正しく動作する）。
 */
export function magicWandSelect(
  seedX: number,
  seedY: number,
  opts: WandOptions,
  currentSel: Selection | null = null,
  mode: WandSelectMode = 'replace',
): Selection | null {
  const { tolerance, contiguous, antiAlias, sampleMerged } = opts;
  const srcCanvas = sampleMerged ? compositeCanvas() : activeLayerCanvas();
  if (!srcCanvas) return null;

  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sx = Math.floor(seedX);
  const sy = Math.floor(seedY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const ctx = srcCanvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, w, h).data;
  const wandAlpha = createColorSelectionMask(data, w, h, sx, sy, {
    tolerance,
    contiguous,
    antiAlias,
  });
  const wand = new Uint8Array(w * h);
  for (let i = 0; i < wand.length; i++) {
    if (wandAlpha[i] >= 128) wand[i] = 1;
  }

  // ─── ブール演算（既存選択がある場合） ───
  // currentSel がない場合は常に replace として扱う
  const effectiveMode: WandSelectMode = currentSel ? mode : 'replace';
  let finalMask: Uint8Array = wand;
  if (effectiveMode !== 'replace' && currentSel) {
    const existing = selectionToBinaryMask(currentSel, w, h);
    const combined = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (effectiveMode === 'add')       combined[i] = existing[i] | wand[i];
      else if (effectiveMode === 'subtract') combined[i] = existing[i] & (wand[i] ? 0 : 1);
      else if (effectiveMode === 'intersect') combined[i] = existing[i] & wand[i];
    }
    finalMask = combined;
  }

  // ─── アンチエイリアス ───
  if (antiAlias) {
    const floatMask = new Float32Array(w * h);
    if (effectiveMode === 'replace') {
      for (let i = 0; i < w * h; i++) floatMask[i] = wandAlpha[i] / 255;
    } else {
      for (let i = 0; i < w * h; i++) {
        floatMask[i] = finalMask[i];
      }
    }
    return floatMaskToSelection(floatMask, w, h);
  }

  // ─── 通常（バイナリ）: contour → poly ───
  const contour = contourFromMask(finalMask, w, h);
  if (contour.length < 6) return null;
  return { type: 'poly', points: contour };
}

// ===== 選択範囲を使った操作 =====

/** 選択範囲を前景/背景色で塗りつぶした新規ラスターレイヤーを追加。 */
export function fillSelection(which: 'fg' | 'bg') {
  const st = useEditorStore.getState();
  const sel = st.selection;
  if (!sel) return;
  const { width: cw, height: ch } = st.canvas;
  const color = which === 'fg' ? st.foregroundColor : st.backgroundColor;
  const b = selectionBounds(sel, cw, ch);
  if (b.width <= 0 || b.height <= 0) return;
  const mask = selectionToMaskCanvas(sel, cw, ch);
  const out = document.createElement('canvas');
  out.width = b.width;
  out.height = b.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(mask, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, b.width, b.height);
  const layer = createImageLayer(out.toDataURL('image/png'), b.width, b.height);
  layer.name = t({ ja: '塗りつぶし', en: 'Fill' });
  layer.x = b.x;
  layer.y = b.y;
  st.addLayer(layer);
}

/** Active-layer pixels → a new layer (Ctrl+J copy / Ctrl+Shift+J cut). */
export async function newLayerFromSelection(cut = false) {
  const store = getActiveStore();
  const initial = store.getState();
  const selection = initial.selection;
  const source = initial.layers.find((candidate) => candidate.id === initial.selectedId);
  if (!selection || !source || source.type !== 'image' || (cut && source.locked)) return false;
  let prepared: Awaited<ReturnType<typeof prepareLocalLayerClipboard>>;
  try {
    prepared = await prepareLocalLayerClipboard(
      source,
      selection,
      initial.canvas.width,
      initial.canvas.height,
    );
  } catch {
    prepared = null;
  }
  if (!prepared) return false;
  const current = store.getState();
  if (
    current.layers.find((candidate) => candidate.id === source.id) !== source
    || current.selection !== selection
  ) return false;
  const bounds = prepared.documentBounds;
  const layer = createImageLayer(prepared.copiedSrc, bounds.width, bounds.height);
  layer.name = cut
    ? t({ ja: '選択範囲のカット', en: 'Selection Cut' })
    : t({ ja: '選択範囲のコピー', en: 'Selection Copy' });
  layer.x = bounds.x;
  layer.y = bounds.y;
  if (cut) current.addLayerViaCut(source.id, prepared.remainingSrc, layer);
  else current.addLayer(layer);
  return true;
}

/** Photoshop同様、アクティブ画像レイヤーの選択ピクセルをPNGとしてコピーする。 */
export async function copyLayerSelectionToClipboard(cut = false) {
  const st = useEditorStore.getState();
  const capturedSelection = st.selection;
  const layer = st.layers.find((candidate) => candidate.id === st.selectedId);
  if (!layer || layer.type !== 'image') {
    toast(t({ ja: '画像レイヤーを選択してください', en: 'Select an image layer first' }), { kind: 'info' });
    return false;
  }
  if (cut && layer.locked) {
    toast(t({ ja: 'ロックされたレイヤーはカットできません', en: 'A locked layer cannot be cut' }), { kind: 'info' });
    return false;
  }
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    toast(t({ ja: 'クリップボードへの画像コピーに対応していません', en: 'Image clipboard writing is unavailable' }), { kind: 'error' });
    return false;
  }
  const { width: cw, height: ch } = st.canvas;
  // Photoshop同様、選択範囲が無い場合は画面外を含むアクティブレイヤー全体を対象にする。
  let prepared: Awaited<ReturnType<typeof prepareLocalLayerClipboard>>;
  try {
    prepared = await prepareLocalLayerClipboard(layer, capturedSelection, cw, ch);
  } catch {
    prepared = null;
  }
  if (!prepared) {
    toast(t({ ja: `${cut ? 'カット' : 'コピー'}できるピクセルがありません`, en: `There are no pixels to ${cut ? 'cut' : 'copy'}` }), { kind: 'info' });
    return false;
  }
  if (cut) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': prepared.blob })]);
      // Clipboard write is asynchronous. Modify only the exact captured layer.
      const currentLayer = useEditorStore.getState().layers.find((candidate) => candidate.id === layer.id);
      if (
        currentLayer !== layer
        || useEditorStore.getState().selectedId !== layer.id
        || useEditorStore.getState().selection !== capturedSelection
      ) {
        toast(t({ ja: 'コピー中にレイヤーまたは選択範囲が変更されたため、カットを中止しました', en: 'The layer or selection changed while copying; cut was cancelled' }), { kind: 'info' });
        return false;
      }
      st.updateLayer(layer.id, { src: prepared.remainingSrc } as Partial<ImageLayer>);
      toast(t({ ja: '選択範囲をカットしました', en: 'Cut selection' }), { kind: 'success' });
      return true;
    } catch (error) {
      toast(t({ ja: `コピーに失敗しました: ${String(error)}`, en: `Copy failed: ${String(error)}` }), { kind: 'error' });
      return false;
    }
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': prepared.blob })]);
    toast(t({ ja: '選択範囲をコピーしました', en: 'Copied selection' }), { kind: 'success' });
    return true;
  } catch (error) {
    toast(t({ ja: `コピーに失敗しました: ${String(error)}`, en: `Copy failed: ${String(error)}` }), { kind: 'error' });
    return false;
  }
}

/** 選択範囲のバウンディングボックスでキャンバスを切り抜く（全レイヤー・カンバスもリサイズ）。 */
export function cropToSelection() {
  const st = useEditorStore.getState();
  const sel = st.selection;
  if (!sel) return;
  const b = selectionBounds(sel, st.canvas.width, st.canvas.height);
  if (b.width <= 0 || b.height <= 0) return;
  st.applyCrop(b.x, b.y, b.width, b.height);
  st.setSelection(null);
}

/**
 * 選択範囲でアクティブ画像レイヤーを切り抜く（選択の内側を残し、外側を消去）。
 * 他レイヤーとカンバスサイズは一切変えない。undo 可（updateLayer 経由）。
 * アクティブが画像レイヤーでない場合はトーストで案内し何もしない。
 */
export function cropLayerToSelection() {
  const st = useEditorStore.getState();
  const sel = st.selection;
  if (!sel) return;
  const activeId = st.selectedId;
  const layer = activeId ? st.layers.find((l) => l.id === activeId) : null;
  if (!activeId || !layer || layer.type !== 'image') {
    toast(
      t({ ja: '画像レイヤーを選択してください', en: 'Select an image layer first' }),
      { kind: 'info' },
    );
    return;
  }
  if (layer.locked) {
    toast(t({ ja: 'ロックされたレイヤーは編集できません', en: 'Locked layers cannot be edited' }), { kind: 'info' });
    return;
  }

  const { width: cw, height: ch } = st.canvas;
  const b = selectionBounds(sel, cw, ch);
  if (b.width <= 0 || b.height <= 0) return;

  void rasterLayerPixelSelection(layer, sel, cw, ch, 'keep').then((src) => {
    const current = useEditorStore.getState();
    if (
      !src
      || current.layers.find((candidate) => candidate.id === activeId) !== layer
      || current.selectedId !== activeId
      || current.selection !== sel
    ) return;
    current.updateLayerAndSelection(activeId, { src } as Partial<ImageLayer>, null);
    toast(t({ ja: '選択範囲でレイヤーを切り抜きました', en: 'Cropped layer to selection' }), {
      kind: 'success',
    });
  });
}

/**
 * 選択範囲でアクティブ画像レイヤーの内側だけを消去する（透明化）。
 * Delete/Backspace 用。選択範囲がない場合のレイヤー削除とは別の操作。
 */
export function clearLayerSelection() {
  const st = useEditorStore.getState();
  const sel = st.selection;
  if (!sel) return false;
  const activeId = st.selectedId;
  const layer = activeId ? st.layers.find((l) => l.id === activeId) : null;
  if (!activeId || !layer || layer.type !== 'image') {
    toast(
      t({ ja: '画像レイヤーを選択してください', en: 'Select an image layer first' }),
      { kind: 'info' },
    );
    return true;
  }
  if (layer.locked) {
    toast(t({ ja: 'ロックされたレイヤーは編集できません', en: 'Locked layers cannot be edited' }), {
      kind: 'info',
    });
    return true;
  }

  const { width: cw, height: ch } = st.canvas;
  const b = selectionBounds(sel, cw, ch);
  if (b.width <= 0 || b.height <= 0) return true;

  void rasterLayerPixelSelection(layer, sel, cw, ch, 'remove').then((src) => {
    const current = useEditorStore.getState();
    if (
      !src
      || current.layers.find((candidate) => candidate.id === activeId) !== layer
      || current.selectedId !== activeId
      || current.selection !== sel
    ) return;
    current.updateLayer(activeId, { src } as Partial<ImageLayer>);
    toast(t({ ja: '選択範囲を削除しました', en: 'Deleted the selection' }), {
      kind: 'success',
    });
  });
  return true;
}

/** 選択範囲を反転(マスク化→反転→輪郭再抽出)。 */
export function invertSelection() {
  const st = useEditorStore.getState();
  const sel = st.selection;
  if (!sel) return;
  const { width: w, height: h } = st.canvas;
  const mc = selectionToMaskCanvas(sel, w, h);
  const ctx = mc.getContext('2d')!;
  const d = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // 反転: 元が非選択(alpha低)を選択にする
    mask[i] = d[i * 4 + 3] < 128 ? 1 : 0;
  }
  const contour = contourFromMask(mask, w, h);
  if (contour.length < 6) {
    st.setSelection(null);
    return;
  }
  st.setSelection({ type: 'poly', points: contour });
}
