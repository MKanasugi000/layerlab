import type { ShapeKind } from '../types';

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface InteractionModifiers {
  shift: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export type BrushStrokeMode = 'freehand' | 'straight';

const DEFAULT_LINE_ANGLE_STEP_DEGREES = 45;

/**
 * 始点から見たポインターの角度を一定刻みに丸める。
 * 距離は維持するため、水平・垂直・斜め方向を追加しても描画感が変わらない。
 */
export function snapPointToAngle(
  start: CanvasPoint,
  current: CanvasPoint,
  stepDegrees = DEFAULT_LINE_ANGLE_STEP_DEGREES,
): CanvasPoint {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || !Number.isFinite(stepDegrees) || stepDegrees <= 0) {
    return { ...current };
  }

  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const snappedAngle = Math.round(angle / step) * step;
  return {
    x: start.x + Math.cos(snappedAngle) * distance,
    y: start.y + Math.sin(snappedAngle) * distance,
  };
}

/**
 * 図形ドラッグにツール別のShift制約を適用する。
 * 新しい図形や修飾キーはここへ追加し、Canvasのイベント処理を肥大化させない。
 */
export function constrainShapeEndpoint(
  kind: ShapeKind,
  start: CanvasPoint,
  current: CanvasPoint,
  modifiers: InteractionModifiers,
): CanvasPoint {
  if (!modifiers.shift) return { ...current };

  if (kind === 'line') {
    return snapPointToAngle(start, current);
  }

  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx || 1) * size,
    y: start.y + Math.sign(dy || 1) * size,
  };
}

/**
 * ブラシ中のShiftは、ストローク始点から現在位置までを一本の直線として扱う。
 */
export function brushStrokeMode(modifiers: InteractionModifiers): BrushStrokeMode {
  return modifiers.shift ? 'straight' : 'freehand';
}
