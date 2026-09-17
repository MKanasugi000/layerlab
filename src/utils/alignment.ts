import type { Layer, ImageLayer, ShapeLayer, TextLayer, CanvasConfig } from '../types';

export interface LayerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getLayerBounds(layer: Layer): LayerBounds {
  if (layer.type === 'group') {
    return { x: layer.x, y: layer.y, width: 0, height: 0 };
  }
  if (layer.type === 'image') {
    const img = layer as ImageLayer;
    return {
      x: layer.x,
      y: layer.y,
      width: img.naturalWidth * Math.abs(layer.scaleX),
      height: img.naturalHeight * Math.abs(layer.scaleY),
    };
  }
  if (layer.type === 'shape') {
    const sh = layer as ShapeLayer;
    return {
      x: layer.x,
      y: layer.y,
      width: sh.shapeWidth * Math.abs(layer.scaleX),
      height: sh.shapeHeight * Math.abs(layer.scaleY),
    };
  }
  const tx = layer as TextLayer;
  const charW = tx.fontSize * 0.55;
  const lines = tx.text.split('\n');
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const estW = (tx.width ?? longest * charW) * Math.abs(layer.scaleX);
  const estH = tx.fontSize * tx.lineHeight * lines.length * Math.abs(layer.scaleY);
  return { x: layer.x, y: layer.y, width: estW, height: estH };
}

export type AlignMode =
  | 'left'
  | 'centerH'
  | 'right'
  | 'top'
  | 'centerV'
  | 'bottom';

export function alignToCanvas(
  layer: Layer,
  canvas: CanvasConfig,
  mode: AlignMode,
): { x: number; y: number } {
  return alignToBounds(layer, { x: 0, y: 0, width: canvas.width, height: canvas.height }, mode);
}

/** Align a single layer to any reference rectangle (canvas / selection / group). */
export function alignToBounds(
  layer: Layer,
  bounds: LayerBounds,
  mode: AlignMode,
): { x: number; y: number } {
  const b = getLayerBounds(layer);
  switch (mode) {
    case 'left':
      return { x: bounds.x, y: layer.y };
    case 'centerH':
      return { x: bounds.x + (bounds.width - b.width) / 2, y: layer.y };
    case 'right':
      return { x: bounds.x + bounds.width - b.width, y: layer.y };
    case 'top':
      return { x: layer.x, y: bounds.y };
    case 'centerV':
      return { x: layer.x, y: bounds.y + (bounds.height - b.height) / 2 };
    case 'bottom':
      return { x: layer.x, y: bounds.y + bounds.height - b.height };
  }
}

/** Combined bounding box of multiple layers (Photoshop "Selection" reference). */
export function getGroupBounds(layers: Layer[]): LayerBounds {
  if (layers.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    const b = getLayerBounds(l);
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Distribute the selected anchor edges evenly between the two outermost layers.
 *  Endpoints (smallest / largest edge) stay fixed. Needs 3+ layers.
 *  Returns a map of id -> new {x, y}; layers not in the map are unchanged.
 */
export function distributeEdges(
  layers: Layer[],
  mode: AlignMode,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (layers.length < 3) return result;
  const horizontal = mode === 'left' || mode === 'centerH' || mode === 'right';

  const edgeOf = (l: Layer): number => {
    const b = getLayerBounds(l);
    switch (mode) {
      case 'left':    return b.x;
      case 'right':   return b.x + b.width;
      case 'centerH': return b.x + b.width / 2;
      case 'top':     return b.y;
      case 'bottom':  return b.y + b.height;
      case 'centerV': return b.y + b.height / 2;
    }
  };

  const sorted = [...layers].sort((a, b) => edgeOf(a) - edgeOf(b));
  const first = edgeOf(sorted[0]);
  const last = edgeOf(sorted[sorted.length - 1]);
  const span = last - first;
  if (span === 0) return result;
  const step = span / (sorted.length - 1);

  for (let i = 1; i < sorted.length - 1; i++) {
    const layer = sorted[i];
    const target = first + step * i;
    const cur = edgeOf(layer);
    const delta = target - cur;
    if (Math.abs(delta) < 0.001) continue;
    result.set(layer.id, {
      x: horizontal ? layer.x + delta : layer.x,
      y: horizontal ? layer.y : layer.y + delta,
    });
  }
  return result;
}

/** Distribute spacing: make the gaps between adjacent layers equal (size-aware).
 *  Endpoints stay fixed. Needs 3+ layers.
 */
export function distributeSpacing(
  layers: Layer[],
  axis: 'horizontal' | 'vertical',
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (layers.length < 3) return result;
  const horizontal = axis === 'horizontal';

  const loHi = (l: Layer): [number, number] => {
    const b = getLayerBounds(l);
    return horizontal ? [b.x, b.x + b.width] : [b.y, b.y + b.height];
  };

  const sorted = [...layers].sort((a, b) => loHi(a)[0] - loHi(b)[0]);
  const firstHi = loHi(sorted[0])[1];
  const lastLo = loHi(sorted[sorted.length - 1])[0];
  const middle = sorted.slice(1, -1);
  const middleSize = middle.reduce((sum, l) => {
    const [lo, hi] = loHi(l);
    return sum + (hi - lo);
  }, 0);
  const freeSpace = lastLo - firstHi;
  const gap = (freeSpace - middleSize) / (middle.length + 1);

  let cursor = firstHi + gap;
  for (const layer of middle) {
    const [lo, hi] = loHi(layer);
    const delta = cursor - lo;
    if (Math.abs(delta) >= 0.001) {
      result.set(layer.id, {
        x: horizontal ? layer.x + delta : layer.x,
        y: horizontal ? layer.y : layer.y + delta,
      });
    }
    cursor += (hi - lo) + gap;
  }
  return result;
}
