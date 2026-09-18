import type { ImageLayer } from '../types';
import { validatePixelSize } from '../utils/canvasLimits';

/** Pixel-aligned bounds of the transformed image, excluding decorative effects. */
export function fittedImageBounds(
  layer: Pick<ImageLayer, 'x' | 'y' | 'naturalWidth' | 'naturalHeight' | 'scaleX' | 'scaleY' | 'rotation'>,
): { x: number; y: number; width: number; height: number } | null {
  const values = [layer.x, layer.y, layer.naturalWidth, layer.naturalHeight,
    layer.scaleX, layer.scaleY, layer.rotation];
  if (!values.every(Number.isFinite) || layer.naturalWidth <= 0
    || layer.naturalHeight <= 0 || layer.scaleX === 0 || layer.scaleY === 0) return null;
  const angle = layer.rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const w = layer.naturalWidth * layer.scaleX;
  const h = layer.naturalHeight * layer.scaleY;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({
    x: layer.x + x * cos - y * sin,
    y: layer.y + x * sin + y * cos,
  }));
  // Cardinal rotations can leave tiny floating-point remainders; do not add
  // a spurious pixel at 90/180/270 degrees.
  const snap = (n: number) => Math.abs(n - Math.round(n)) < 1e-8 ? Math.round(n) : n;
  const x = Math.floor(snap(Math.min(...corners.map((p) => p.x))));
  const y = Math.floor(snap(Math.min(...corners.map((p) => p.y))));
  const right = Math.ceil(snap(Math.max(...corners.map((p) => p.x))));
  const bottom = Math.ceil(snap(Math.max(...corners.map((p) => p.y))));
  const size = validatePixelSize(right - x, bottom - y);
  return size.ok ? { x, y, width: size.width, height: size.height } : null;
}
