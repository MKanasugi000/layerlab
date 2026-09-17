import type { Layer, CanvasConfig, Guide } from '../types';
import { getLayerBounds } from './alignment';

export interface SnapGuide {
  orient: 'v' | 'h';
  pos: number;
  start: number;
  end: number;
}

export interface SnapTargets {
  v: number[];
  h: number[];
}

export function collectSnapTargets(
  layers: Layer[],
  selectedId: string | null,
  canvas: CanvasConfig,
  guides: Guide[] = [],
): SnapTargets {
  const v: number[] = [0, canvas.width / 2, canvas.width];
  const h: number[] = [0, canvas.height / 2, canvas.height];
  for (const l of layers) {
    if (l.id === selectedId || !l.visible || l.type === 'group') continue;
    const b = getLayerBounds(l);
    v.push(b.x, b.x + b.width / 2, b.x + b.width);
    h.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  for (const g of guides) {
    if (g.axis === 'v') v.push(g.pos);
    else h.push(g.pos);
  }
  return { v, h };
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuide[];
}

export function snapBox(
  box: BBox,
  targets: SnapTargets,
  threshold: number,
): SnapResult {
  const candidatesX: { layerVal: number; targetVal: number; offset: number }[] = [
    { layerVal: box.x, targetVal: 0, offset: 0 },
    { layerVal: box.x + box.width / 2, targetVal: 0, offset: -box.width / 2 },
    { layerVal: box.x + box.width, targetVal: 0, offset: -box.width },
  ];
  const candidatesY: { layerVal: number; targetVal: number; offset: number }[] = [
    { layerVal: box.y, targetVal: 0, offset: 0 },
    { layerVal: box.y + box.height / 2, targetVal: 0, offset: -box.height / 2 },
    { layerVal: box.y + box.height, targetVal: 0, offset: -box.height },
  ];

  let bestX: { dist: number; offset: number; line: number } | null = null;
  for (const c of candidatesX) {
    for (const t of targets.v) {
      const d = Math.abs(c.layerVal - t);
      if (d <= threshold && (!bestX || d < bestX.dist)) {
        bestX = { dist: d, offset: c.offset, line: t };
      }
    }
  }
  let bestY: { dist: number; offset: number; line: number } | null = null;
  for (const c of candidatesY) {
    for (const t of targets.h) {
      const d = Math.abs(c.layerVal - t);
      if (d <= threshold && (!bestY || d < bestY.dist)) {
        bestY = { dist: d, offset: c.offset, line: t };
      }
    }
  }

  const newX = bestX ? bestX.line + bestX.offset : box.x;
  const newY = bestY ? bestY.line + bestY.offset : box.y;
  const guides: SnapGuide[] = [];
  if (bestX) {
    guides.push({
      orient: 'v',
      pos: bestX.line,
      start: Math.min(newY, 0),
      end: Math.max(newY + box.height, 0),
    });
  }
  if (bestY) {
    guides.push({
      orient: 'h',
      pos: bestY.line,
      start: Math.min(newX, 0),
      end: Math.max(newX + box.width, 0),
    });
  }
  return { x: newX, y: newY, guides };
}
