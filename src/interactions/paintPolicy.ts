import type { ImageLayer, Layer } from '../types';

export const MAX_BRUSH_DIMENSION = 4096;
export const MAX_BRUSH_PIXELS = 16 * 1024 * 1024;

export function isSafeBrushCanvas(width: number, height: number): boolean {
  return Number.isInteger(width)
    && Number.isInteger(height)
    && width > 0
    && height > 0
    && width <= MAX_BRUSH_DIMENSION
    && height <= MAX_BRUSH_DIMENSION
    && width * height <= MAX_BRUSH_PIXELS;
}

/** Whether a layer can safely receive a destructive raster brush stroke. */
export function isPaintTarget(
  layer: Layer | undefined,
  width: number,
  height: number,
): layer is ImageLayer {
  return !!layer
    && layer.type === 'image'
    && !layer.locked
    && !layer.normalGen
    && layer.rotation === 0
    && layer.scaleX === 1
    && layer.scaleY === 1
    && Math.round(layer.x) === 0
    && Math.round(layer.y) === 0
    && layer.naturalWidth === width
    && layer.naturalHeight === height;
}
