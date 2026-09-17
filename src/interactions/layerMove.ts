import type { Layer } from '../types';

export interface Point {
  x: number;
  y: number;
}

export interface LayerMoveStart {
  layer: Point;
  node: Point;
}

export interface LayerPositionUpdate extends Point {
  id: string;
}

/** Photoshop-style Shift drag: snap movement to the nearest 45-degree axis. */
export function constrainDragDelta(
  dx: number,
  dy: number,
  constrain: boolean,
): Point {
  if (!constrain || (dx === 0 && dy === 0)) return { x: dx, y: dy };
  const step = Math.PI / 4;
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / step) * step;
  const distance = Math.hypot(dx, dy);
  const x = distance * Math.cos(snapped);
  const y = distance * Math.sin(snapped);
  return {
    x: Math.abs(x) < 1e-10 ? 0 : x,
    y: Math.abs(y) < 1e-10 ? 0 : y,
  };
}

/**
 * store は図形の左上を保持する一方、Konva の矩形・楕円ノードは中心座標を保持する。
 * 複数ドラッグのライブ表示では必ずこの変換を通し、図形だけ位置がずれるのを防ぐ。
 */
export function layerNodePosition(layer: Layer): Point {
  if (
    layer.type === 'shape' &&
    (layer.shape === 'rect' || layer.shape === 'ellipse')
  ) {
    return {
      x: layer.x + layer.shapeWidth / 2,
      y: layer.y + layer.shapeHeight / 2,
    };
  }
  return { x: layer.x, y: layer.y };
}

/** 選択済みの一員を掴んだときは、複数選択を単一選択へ縮めない。 */
export function shouldPreserveMultiSelection(
  selectedIds: readonly string[],
  id: string,
  modifiers: { shift: boolean; ctrl: boolean; meta: boolean },
): boolean {
  return (
    !modifiers.shift &&
    !modifiers.ctrl &&
    !modifiers.meta &&
    selectedIds.length > 1 &&
    selectedIds.includes(id)
  );
}

/** 複数レイヤーの確定位置を一括更新用の配列へ変換する。 */
export function translatedLayerPositions(
  starts: ReadonlyMap<string, LayerMoveStart>,
  dx: number,
  dy: number,
): LayerPositionUpdate[] {
  return [...starts.entries()].map(([id, start]) => ({
    id,
    x: start.layer.x + dx,
    y: start.layer.y + dy,
  }));
}
