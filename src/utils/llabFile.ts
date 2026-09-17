import { BLEND_MODES, type CanvasConfig, type Layer, type Guide } from '../types';
import { validatePixelSize } from './canvasLimits';
import { breakParentCycles } from './layerOrder';
import { MAX_RASTER_FILE_BYTES, inspectRasterDataUrl } from './rasterHeader';
import {
  MAX_PROJECT_RASTER_PIXELS,
  MAX_PROJECT_JSON_BYTES,
  validateProjectRasterBudget,
  validateProjectStorageBudget,
  utf8ByteLength,
} from './projectRasterBudget';

export const LLAB_VERSION = 1;
export const LLAB_MAGIC = 'layerlab-project';

export interface LlabFileV1 {
  magic: typeof LLAB_MAGIC;
  version: 1;
  createdAt: string;
  app: { name: 'LayerLab'; appVersion: string };
  canvas: CanvasConfig;
  layers: Layer[];
  selectedId: string | null;
  guides?: Guide[];
}

export interface LoadedProject {
  canvas: CanvasConfig;
  layers: Layer[];
  selectedId: string | null;
  guides: Guide[];
}

export function serializeProject(
  canvas: CanvasConfig,
  layers: Layer[],
  selectedId: string | null,
  guides: Guide[] = [],
  appVersion = '0.1.0',
): string {
  const rasterBudget = validateProjectRasterBudget(layers);
  if (!rasterBudget.ok) {
    throw new LlabParseError(
      `Project raster memory exceeds the safe limit (${Math.round(MAX_PROJECT_RASTER_PIXELS / 1024 / 1024)} MP)`,
    );
  }
  if (!validateProjectStorageBudget(layers).ok) {
    throw new LlabParseError('Project embedded image data exceeds the safe save limit');
  }
  const file: LlabFileV1 = {
    magic: LLAB_MAGIC,
    version: LLAB_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: 'LayerLab', appVersion },
    canvas,
    layers,
    selectedId,
    guides,
  };
  const json = JSON.stringify(file, null, 2);
  if (utf8ByteLength(json) > MAX_PROJECT_JSON_BYTES) {
    throw new LlabParseError('LayerLab project exceeds the 120 MB renderer save limit');
  }
  return json;
}

export class LlabParseError extends Error {}

const MAX_PROJECT_LAYERS = 5000;
const MAX_LAYER_SOURCE_CHARS = Math.ceil(MAX_RASTER_FILE_BYTES / 3) * 4 + 64;
const blendModes = new Set(BLEND_MODES.map((mode) => mode.value));

function failLayer(index: number, message: string): never {
  throw new LlabParseError(`Invalid layer ${index + 1}: ${message}`);
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validateFinitePayload(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value == null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 1_000_000;
  if (typeof value === 'string') return value.length <= 10_000;
  if (Array.isArray(value)) {
    return value.length <= 256 && value.every((item) => validateFinitePayload(item, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 128 && entries.every(([, item]) => validateFinitePayload(item, depth + 1));
  }
  return false;
}

function validateLayer(
  raw: unknown,
  index: number,
  ids: Set<string>,
): asserts raw is Layer {
  if (!raw || typeof raw !== 'object') failLayer(index, 'entry is not an object');
  const layer = raw as Record<string, unknown>;
  if (typeof layer.id !== 'string' || layer.id.length < 1 || layer.id.length > 256) failLayer(index, 'invalid id');
  if (ids.has(layer.id)) failLayer(index, `duplicate id "${layer.id}"`);
  ids.add(layer.id);
  if (!['image', 'text', 'shape', 'group'].includes(String(layer.type))) failLayer(index, `unknown type "${String(layer.type)}"`);
  if (typeof layer.name !== 'string' || layer.name.length > 10_000) failLayer(index, 'invalid name');
  if (typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') failLayer(index, 'invalid visibility/lock');
  if (!finiteIn(layer.opacity, 0, 1)) failLayer(index, 'opacity must be 0..1');
  if (typeof layer.blendMode !== 'string' || !blendModes.has(layer.blendMode as never)) failLayer(index, 'invalid blend mode');
  for (const key of ['x', 'y', 'rotation'] as const) {
    if (!finiteIn(layer[key], -1_000_000, 1_000_000)) failLayer(index, `${key} is not finite/safe`);
  }
  for (const key of ['scaleX', 'scaleY'] as const) {
    if (!finiteIn(layer[key], -10_000, 10_000)) failLayer(index, `${key} is not finite/safe`);
  }
  if (layer.parentId != null && typeof layer.parentId !== 'string') failLayer(index, 'invalid parentId');
  if (layer.clipped != null && typeof layer.clipped !== 'boolean') failLayer(index, 'invalid clipped flag');

  if (layer.type === 'image') {
    if (
      typeof layer.src !== 'string'
      || layer.src.length > MAX_LAYER_SOURCE_CHARS
      || !/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(layer.src)
    ) failLayer(index, 'invalid or oversized embedded image');
    if (!Number.isInteger(layer.naturalWidth) || !Number.isInteger(layer.naturalHeight)) failLayer(index, 'invalid image dimensions');
    const size = validatePixelSize(layer.naturalWidth as number, layer.naturalHeight as number);
    if (!size.ok) failLayer(index, `unsafe image dimensions (${layer.naturalWidth} x ${layer.naturalHeight})`);
    const embedded = inspectRasterDataUrl(layer.src as string);
    if (!embedded.ok) {
      failLayer(index, `invalid embedded image (${embedded.reason})`);
    }
    if (embedded.header.width !== size.width || embedded.header.height !== size.height) {
      failLayer(
        index,
        `embedded image header mismatch (declared ${size.width} x ${size.height}; encoded ${embedded.header.width} x ${embedded.header.height})`,
      );
    }
    for (const key of ['shadowBlur', 'strokeWidth'] as const) {
      if (layer[key] != null && !finiteIn(layer[key], 0, 2048)) failLayer(index, `invalid ${key}`);
    }
    if (layer.adjustments != null && !validateFinitePayload(layer.adjustments)) failLayer(index, 'invalid adjustments');
    if (layer.normalGen != null) {
      if (!validateFinitePayload(layer.normalGen)) failLayer(index, 'invalid normal-map settings');
      const normal = layer.normalGen as Record<string, unknown>;
      if (typeof normal.sourceLayerId !== 'string' || !finiteIn(normal.preBlur, 0, 64)) {
        failLayer(index, 'unsafe normal-map settings');
      }
    }
  } else if (layer.type === 'text') {
    if (typeof layer.text !== 'string' || layer.text.length > 100_000) failLayer(index, 'invalid text');
    if (typeof layer.fontFamily !== 'string' || layer.fontFamily.length > 512) failLayer(index, 'invalid font family');
    if (!finiteIn(layer.fontSize, 0.1, 10_000)) failLayer(index, 'invalid font size');
    if (!['normal', 'bold', 'italic', 'bold italic'].includes(String(layer.fontStyle))) failLayer(index, 'invalid font style');
    if (!['left', 'center', 'right'].includes(String(layer.align))) failLayer(index, 'invalid alignment');
    if (typeof layer.fill !== 'string' || layer.fill.length > 256) failLayer(index, 'invalid fill');
    if (layer.width != null && !finiteIn(layer.width, 0, 32_768)) failLayer(index, 'invalid text width');
    if (!finiteIn(layer.letterSpacing, -10_000, 10_000) || !finiteIn(layer.lineHeight, 0.01, 100)) failLayer(index, 'invalid text spacing');
    if (!finiteIn(layer.strokeWidth, 0, 2048) || !finiteIn(layer.shadowBlur, 0, 2048)) failLayer(index, 'invalid text effect size');
  } else if (layer.type === 'shape') {
    if (!['rect', 'ellipse', 'line'].includes(String(layer.shape))) failLayer(index, 'invalid shape');
    if (!Number.isFinite(layer.shapeWidth) || !Number.isFinite(layer.shapeHeight)) failLayer(index, 'invalid shape dimensions');
    const width = Math.max(1, Math.round(Math.abs(layer.shapeWidth as number)));
    const height = Math.max(1, Math.round(Math.abs(layer.shapeHeight as number)));
    if (!validatePixelSize(width, height).ok) failLayer(index, `unsafe shape dimensions (${width} x ${height})`);
    if (!finiteIn(layer.strokeWidth, 0, 2048) || !finiteIn(layer.shadowBlur, 0, 2048) || !finiteIn(layer.cornerRadius, 0, 32_768)) {
      failLayer(index, 'invalid shape effect size');
    }
  } else if (typeof layer.collapsed !== 'boolean') {
    failLayer(index, 'invalid group state');
  }
}

export function parseProject(text: string): LoadedProject {
  if (text.length > MAX_PROJECT_JSON_BYTES) {
    throw new LlabParseError('LayerLab project exceeds the 120 MB renderer load limit');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new LlabParseError(`JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!obj || typeof obj !== 'object') {
    throw new LlabParseError('Project file is not an object');
  }
  const o = obj as Record<string, unknown>;
  if (o.magic !== LLAB_MAGIC) {
    throw new LlabParseError(`Not a LayerLab project file (magic=${String(o.magic)})`);
  }
  if (o.version !== 1) {
    throw new LlabParseError(`Unsupported version: ${String(o.version)}. This build only reads v1.`);
  }
  const canvas = o.canvas as CanvasConfig | undefined;
  const layers = o.layers as Layer[] | undefined;
  if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') {
    throw new LlabParseError('canvas.width / canvas.height missing');
  }
  const canvasSize = validatePixelSize(canvas.width, canvas.height);
  if (!canvasSize.ok) {
    throw new LlabParseError(`Unsafe canvas dimensions (${canvas.width} x ${canvas.height}): ${canvasSize.reason}`);
  }
  if (!Array.isArray(layers)) {
    throw new LlabParseError('layers is not an array');
  }
  if (layers.length > MAX_PROJECT_LAYERS) throw new LlabParseError(`Too many layers (${layers.length}; maximum ${MAX_PROJECT_LAYERS})`);
  const ids = new Set<string>();
  layers.forEach((layer, index) => validateLayer(layer, index, ids));
  const rasterBudget = validateProjectRasterBudget(layers);
  if (!rasterBudget.ok) {
    throw new LlabParseError(
      `Project raster memory exceeds the safe limit (${Math.round(MAX_PROJECT_RASTER_PIXELS / 1024 / 1024)} MP)`,
    );
  }
  if (!validateProjectStorageBudget(layers).ok) {
    throw new LlabParseError('Project embedded image data exceeds the safe load limit');
  }
  const guidesRaw = Array.isArray(o.guides) ? (o.guides as unknown[]) : [];
  const guides: Guide[] = [];
  for (const g of guidesRaw) {
    if (!g || typeof g !== 'object') continue;
    const obj = g as Record<string, unknown>;
    if (
      typeof obj.id === 'string' &&
      (obj.axis === 'v' || obj.axis === 'h') &&
      typeof obj.pos === 'number'
    ) {
      guides.push({ id: obj.id, axis: obj.axis, pos: obj.pos });
    }
  }
  return {
    canvas: {
      width: canvasSize.width,
      height: canvasSize.height,
      background: typeof canvas.background === 'string' ? canvas.background : '#ffffff',
    },
    // 壊れた/手編集された .llab の parentId 循環を読込境界で除去する。
    // 元配列の先頭にある循環ノードだけを root へ昇格し、正常データの順序は変えない。
    layers: breakParentCycles(layers),
    selectedId: typeof o.selectedId === 'string' && ids.has(o.selectedId) ? o.selectedId : null,
    guides,
  };
}
