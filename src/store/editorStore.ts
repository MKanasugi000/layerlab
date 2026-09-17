import { create } from 'zustand';
import { useStore } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { t } from '../i18n/locale';
import { DEFAULT_TEXT_FONT } from '../fonts/catalog';
import { validatePixelSize } from '../utils/canvasLimits';
import {
  editorHistoryEqual,
  historyStackMoved,
  HISTORY_MEMORY_BUDGET_BYTES,
  trimHistoryStatesToBudget,
} from '../interactions/historyPolicy';
import {
  createLayerLockChecker,
  layerBlocksContainLock,
} from '../interactions/layerLockPolicy';
import {
  validateProjectRasterBudget,
  validateProjectStorageBudget,
} from '../utils/projectRasterBudget';
import { toast } from './toastStore';
import {
  discardPendingSyncEdits,
  flushPendingSyncEdits,
} from '../interactions/pendingEdits';
import type {
  Layer,
  CanvasConfig,
  LayerId,
  ImageLayer,
  TextLayer,
  ShapeLayer,
  GroupLayer,
  ShapeKind,
  Tool,
  Viewport,
  Guide,
  Selection,
  MarqueeKind,
  ColorAdjustments,
} from '../types';
import {
  alignToBounds,
  getGroupBounds,
  distributeEdges,
  distributeSpacing,
  type AlignMode,
} from '../utils/alignment';
import {
  type SelMode,
  selectionToMask,
  maskToSelection,
  combineMasks,
  dilateMask,
  erodeMask,
  featherMask,
  smoothMask,
} from '../utils/selectionMask';
import {
  type DropTarget,
  computeMove,
  normalizeLayerOrder,
  collectDescendants,
  topLevelReps,
  cloneBlock,
  sanitizeClips,
} from '../utils/layerOrder';

export type { SelMode, DropTarget };

/** merged 配列を pre-order 正規化 + clip 健全化して返す（複製/グループ化の共通後処理）。 */
function sanitizeAndNormalize(layers: Layer[]): Layer[] {
  const out = normalizeLayerOrder(layers);
  sanitizeClips(out);
  return out;
}

function duplicateLayerBlocks(
  layers: Layer[],
  ids: LayerId[],
  offset: { x: number; y: number },
): { layers: Layer[]; selectIds: LayerId[] } | null {
  const source = layers.map((layer) => ({ ...layer }) as Layer);
  const reps = topLevelReps(source, ids);
  if (reps.length === 0) return null;

  const insertions = reps.map((repId) => {
    const blockIds = new Set<LayerId>([repId, ...collectDescendants(source, repId)]);
    const block = source.filter((layer) => blockIds.has(layer.id));
    const { clones, idMap } = cloneBlock(block);
    const cloneRootId = idMap.get(repId)!;
    for (const clone of clones) {
      if (clone.id === cloneRootId) clone.name = `${clone.name} copy`;
      if (clone.type !== 'group') {
        clone.x += offset.x;
        clone.y += offset.y;
      }
    }
    return {
      index: source.findIndex((layer) => layer.id === repId),
      clones,
      cloneRootId,
    };
  });

  const merged = [...source];
  for (const insertion of [...insertions].sort((a, b) => b.index - a.index)) {
    merged.splice(insertion.index, 0, ...insertion.clones);
  }
  return {
    layers: sanitizeAndNormalize(merged),
    selectIds: insertions.map(({ cloneRootId }) => cloneRootId),
  };
}

function removeLayerBlocks(layers: Layer[], ids: LayerId[]): Layer[] {
  const source = layers.map((layer) => ({ ...layer }) as Layer);
  const removeSet = new Set(ids);
  const byId = new Map(source.map((layer) => [layer.id, layer] as const));
  for (const layer of source) {
    if (removeSet.has(layer.id) || !layer.parentId || !removeSet.has(layer.parentId)) continue;
    let parentId: LayerId | null = layer.parentId;
    const guard = new Set<LayerId>();
    while (parentId && removeSet.has(parentId) && !guard.has(parentId)) {
      guard.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    layer.parentId = parentId;
  }
  return sanitizeAndNormalize(source.filter((layer) => !removeSet.has(layer.id)));
}

function acceptsRasterBudget(layers: Layer[]): boolean {
  if (
    validateProjectRasterBudget(layers).ok
    && validateProjectStorageBudget(layers).ok
  ) return true;
  toast(t({
    ja: '画像レイヤーの総サイズまたは保存データ量が安全上限を超えるため、操作を中止しました',
    en: 'The operation was stopped because raster memory or embedded save data would exceed the safety limit',
  }), { kind: 'error' });
  return false;
}

interface EditorState {
  canvas: CanvasConfig;
  layers: Layer[];
  selectedId: LayerId | null;
  selectedIds: LayerId[];
  tool: Tool;
  shapeKind: ShapeKind;
  foregroundColor: string;
  backgroundColor: string;
  viewport: Viewport;
  currentFilePath: string | null;
  /** SHA-256 of the last bytes read/written, used to detect external edits. */
  currentFileRevision: string | null;
  dirty: boolean;
  /** Draft text/raster work which has not yet reached the serializable state. */
  pendingOperations: number;
  /** 色調補正ダイアログの履歴外ライブプレビュー。OK時だけ pixels へ確定する。 */
  adjustmentPreview: {
    layerId: LayerId;
    adjustments: ColorAdjustments;
    selection: Selection | null;
  } | null;

  setCanvas: (c: Partial<CanvasConfig>) => void;
  addLayer: (l: Layer) => boolean;
  addLayerViaCut: (sourceId: LayerId, remainingSrc: string, layer: ImageLayer) => void;
  removeLayer: (id: LayerId) => void;
  removeLayers: (ids: LayerId[]) => void;
  selectLayer: (id: LayerId | null) => void;
  toggleSelect: (id: LayerId) => void;
  selectMany: (ids: LayerId[]) => void;
  clearSelection: () => void;
  updateLayer: (id: LayerId, patch: Partial<Layer>) => void;
  updateLayerAndSelection: (
    id: LayerId,
    patch: Partial<Layer>,
    selection: Selection | null,
  ) => void;
  setAdjustmentPreview: (
    preview: {
      layerId: LayerId;
      adjustments: ColorAdjustments;
      selection: Selection | null;
    } | null,
  ) => void;
  /** 複数ドラッグの座標を1トランザクションで確定する（Undoも1回）。 */
  updateLayerPositions: (
    updates: ReadonlyArray<{ id: LayerId; x: number; y: number }>,
  ) => void;
  moveLayer: (id: LayerId, direction: 'up' | 'down') => void;
  moveLayerEnd: (id: LayerId, where: 'front' | 'back') => void;
  /** ドラッグ&ドロップ用: ids を target へ移動（opts.duplicate で複製）。1 set()=1 undo。 */
  moveLayers: (ids: LayerId[], target: DropTarget, opts?: { duplicate?: boolean }) => void;
  duplicateLayer: (id: LayerId) => void;
  duplicateLayers: (ids: LayerId[], offset?: { x: number; y: number }) => void;
  /** そのレイヤーだけ表示（他を一時非表示）⇄ 全表示 のトグル（Alt+クリック）。 */
  soloLayer: (id: LayerId) => void;
  mergeLayers: (removeIds: LayerId[], src: string, width: number, height: number, name: string) => void;
  nudgeLayer: (id: LayerId, dx: number, dy: number) => void;
  nudgeLayers: (ids: LayerId[], dx: number, dy: number) => void;
  clearLayers: () => void;
  setTool: (t: Tool) => void;
  autoSelect: boolean;
  setAutoSelect: (v: boolean) => void;
  applyCrop: (x: number, y: number, width: number, height: number) => void;
  fitCanvasToLayer: (id: LayerId) => void;
  setShapeKind: (k: ShapeKind) => void;
  selection: Selection | null;
  selectionMode: SelMode;
  setSelection: (sel: Selection | null) => void;
  invertSelection: () => void;
  setSelectionMode: (mode: SelMode) => void;
  commitSelection: (raw: Selection | null, modeOverride?: SelMode) => void;
  growSelection: (px: number) => void;
  shrinkSelection: (px: number) => void;
  featherSelection: (px: number) => void;
  smoothSelection: (px: number) => void;
  marqueeKind: MarqueeKind;
  setMarqueeKind: (k: MarqueeKind) => void;
  wandTolerance: number;
  setWandTolerance: (t: number) => void;
  wandContiguous: boolean;
  setWandContiguous: (v: boolean) => void;
  wandAntiAlias: boolean;
  setWandAntiAlias: (v: boolean) => void;
  wandSampleMerged: boolean;
  setWandSampleMerged: (v: boolean) => void;
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
  brushFlow: number;
  setBrushSize: (v: number) => void;
  setBrushHardness: (v: number) => void;
  setBrushOpacity: (v: number) => void;
  setBrushFlow: (v: number) => void;
  brushSpacing: number;
  setBrushSpacing: (v: number) => void;
  brushRoundness: number;
  setBrushRoundness: (v: number) => void;
  brushAngle: number;
  setBrushAngle: (v: number) => void;
  brushSmoothing: number;
  setBrushSmoothing: (v: number) => void;
  brushPressureSize: boolean;
  setBrushPressureSize: (v: boolean) => void;
  brushPressureOpacity: boolean;
  setBrushPressureOpacity: (v: boolean) => void;
  brushSizeJitter: number;
  setBrushSizeJitter: (v: number) => void;
  brushScatter: number;
  setBrushScatter: (v: number) => void;
  brushFlowJitter: number;
  setBrushFlowJitter: (v: number) => void;
  brushEraser: boolean;
  setBrushEraser: (v: boolean) => void;
  setForegroundColor: (c: string) => void;
  setBackgroundColor: (c: string) => void;
  swapColors: () => void;
  resetColors: () => void;
  recentColors: string[];
  pushRecentColor: (c: string) => void;
  setViewport: (v: Partial<Viewport>) => void;
  resetViewport: () => void;
  loadProject: (data: { canvas: CanvasConfig; layers: Layer[]; selectedId: LayerId | null; guides?: Guide[] }, filePath: string | null, revision?: string | null) => void;
  setCurrentFilePath: (p: string | null, revision?: string | null) => void;
  markSaved: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  toggleGroupCollapsed: (id: LayerId) => void;
  toggleClipped: (id: LayerId) => void;
  alignSelected: (mode: AlignMode) => void;
  distributeSelected: (mode: AlignMode) => void;
  spacingSelected: (axis: 'horizontal' | 'vertical') => void;
  guides: Guide[];
  addGuide: (axis: 'v' | 'h', pos: number) => void;
  updateGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
  clearGuides: () => void;
  showGuides: boolean;
  toggleShowGuides: () => void;
  panelsVisible: boolean;
  togglePanels: () => void;
  resetDocument: (canvas: CanvasConfig) => void;
}

/**
 * 1ドキュメント＝1ストア。タブごとに独立した状態と undo 履歴(zundo temporal)を持つ。
 * 既存コードは下の `useEditorStore` ファサード越しに「アクティブなタブのストア」へ
 * 透過アクセスするので、この工場本体のロジックは単一ドキュメント時代と同一。
 */
export function createDocumentStore(
  initialCanvas: CanvasConfig = { width: 1280, height: 720, background: '#ffffff' },
) {
  const initialSize = validatePixelSize(initialCanvas.width, initialCanvas.height);
  if (!initialSize.ok) {
    throw new RangeError(`Unsafe canvas dimensions: ${initialSize.reason}`);
  }
  const safeInitialCanvas = {
    ...initialCanvas,
    width: initialSize.width,
    height: initialSize.height,
  };
  const store = create<EditorState>()(
  temporal(
    immer((set, get) => ({
      canvas: safeInitialCanvas,
      layers: [],
      selectedId: null,
      selectedIds: [],
      tool: 'move',
      shapeKind: 'rect',
      foregroundColor: '#000000',
      backgroundColor: '#ffffff',
      viewport: { x: 0, y: 0, scale: 1, autoFit: true },
      currentFilePath: null,
      currentFileRevision: null,
      dirty: false,
      pendingOperations: 0,
      adjustmentPreview: null,
      guides: [],
      showGuides: true,

      setCanvas: (c) =>
        set((s) => {
          const size = validatePixelSize(
            c.width ?? s.canvas.width,
            c.height ?? s.canvas.height,
          );
          if (!size.ok) return;
          Object.assign(s.canvas, c);
          s.canvas.width = size.width;
          s.canvas.height = size.height;
          s.viewport.autoFit = true;
          s.dirty = true;
        }),

      addLayer: (l) => {
        let added = false;
        set((s) => {
          if (!acceptsRasterBudget([...(s.layers as Layer[]), l])) return;
          s.layers.unshift(l);
          s.selectedId = l.id;
          s.selectedIds = [l.id];
          s.dirty = true;
          added = true;
        });
        return added;
      },

      // Layer via Cut is a single edit: one Ctrl+Z restores the source pixels
      // and removes the new layer together.
      addLayerViaCut: (sourceId, remainingSrc, layer) =>
        set((s) => {
          const source = s.layers.find((candidate) => candidate.id === sourceId);
          if (
            !source ||
            source.type !== 'image' ||
            createLayerLockChecker(s.layers as Layer[])(sourceId)
          ) return;
          const projected = s.layers.map((candidate) => (
            candidate.id === sourceId
              ? { ...candidate, src: remainingSrc } as Layer
              : candidate as Layer
          ));
          if (!acceptsRasterBudget([...projected, layer])) return;
          source.src = remainingSrc;
          s.layers.unshift(layer);
          s.selectedId = layer.id;
          s.selectedIds = [layer.id];
          s.dirty = true;
        }),

      removeLayer: (id) =>
        set((s) => {
          if (layerBlocksContainLock(s.layers as Layer[], [id])) return;
          s.layers = removeLayerBlocks(s.layers as Layer[], [id]);
          if (s.selectedId === id) s.selectedId = null;
          s.selectedIds = s.selectedIds.filter((x) => x !== id);
          s.dirty = true;
        }),

      removeLayers: (ids) =>
        set((s) => {
          const removeSet = new Set(ids);
          if (![...removeSet].some((id) => s.layers.some((layer) => layer.id === id))) return;
          if (layerBlocksContainLock(s.layers as Layer[], [...removeSet])) return;
          s.layers = removeLayerBlocks(s.layers as Layer[], [...removeSet]);
          s.selectedIds = s.selectedIds.filter((id) => !removeSet.has(id));
          s.selectedId = s.selectedIds[s.selectedIds.length - 1] ?? null;
          s.dirty = true;
        }),

      selectLayer: (id) =>
        set((s) => {
          s.selectedId = id;
          s.selectedIds = id ? [id] : [];
        }),

      toggleSelect: (id) =>
        set((s) => {
          const idx = s.selectedIds.indexOf(id);
          if (idx >= 0) {
            s.selectedIds.splice(idx, 1);
          } else {
            s.selectedIds.push(id);
          }
          // selectedId tracks the most recent / primary selection
          s.selectedId = s.selectedIds[s.selectedIds.length - 1] ?? null;
        }),

      selectMany: (ids) =>
        set((s) => {
          s.selectedIds = [...ids];
          s.selectedId = ids[ids.length - 1] ?? null;
        }),

      clearSelection: () =>
        set((s) => {
          s.selectedIds = [];
          s.selectedId = null;
        }),

      updateLayer: (id, patch) =>
        set((s) => {
          const idx = s.layers.findIndex((x) => x.id === id);
          if (idx >= 0) {
            const cosmeticOnly = Object.keys(patch).every((key) =>
              key === 'locked' || key === 'visible' || key === 'collapsed',
            );
            if (createLayerLockChecker(s.layers as Layer[])(id) && !cosmeticOnly) return;
            if (
              ('naturalWidth' in patch || 'naturalHeight' in patch || 'src' in patch)
              && !acceptsRasterBudget(s.layers.map((candidate, candidateIndex) => (
                candidateIndex === idx ? { ...candidate, ...patch } as Layer : candidate as Layer
              )))
            ) return;
            Object.assign(s.layers[idx], patch);
            s.dirty = true;
          }
        }),

      updateLayerAndSelection: (id, patch, selection) =>
        set((s) => {
          const idx = s.layers.findIndex((x) => x.id === id);
          if (idx < 0) return;
          if (createLayerLockChecker(s.layers as Layer[])(id)) return;
          if (
            ('naturalWidth' in patch || 'naturalHeight' in patch || 'src' in patch)
            && !acceptsRasterBudget(s.layers.map((candidate, candidateIndex) => (
              candidateIndex === idx ? { ...candidate, ...patch } as Layer : candidate as Layer
            )))
          ) return;
          Object.assign(s.layers[idx], patch);
          s.selection = selection;
          s.dirty = true;
        }),

      setAdjustmentPreview: (preview) =>
        set((s) => {
          s.adjustmentPreview = preview;
        }),

      updateLayerPositions: (updates) =>
        set((s) => {
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          let changed = false;
          for (const update of updates) {
            const layer = s.layers.find((x) => x.id === update.id);
            if (!layer || isLocked(layer.id)) continue;
            layer.x = update.x;
            layer.y = update.y;
            changed = true;
          }
          if (changed) s.dirty = true;
        }),

      // ▲▼ / Ctrl+] [ による1段移動。同じ親を持つ sibling の中でブロック単位で入れ替える
      // （group を跨ぐときは group 全体をホップ）。配列直接 splice は parentId を無視して
      // パネル表示と描画順を乖離させるため、必ず computeMove 経由の正規化を通す。
      moveLayer: (id, direction) =>
        set((s) => {
          const idSet = new Set(s.layers.map((l) => l.id));
          const self = s.layers.find((l) => l.id === id);
          if (!self || createLayerLockChecker(s.layers as Layer[])(id)) return;
          const parent = self.parentId && idSet.has(self.parentId) ? self.parentId : null;
          const siblings = s.layers.filter(
            (l) => (l.parentId && idSet.has(l.parentId) ? l.parentId : null) === parent,
          );
          const pos = siblings.findIndex((l) => l.id === id);
          let res: ReturnType<typeof computeMove> = null;
          if (direction === 'up') {
            if (pos <= 0) return; // 既に最前面 sibling
            res = computeMove(s.layers, [id], { kind: 'before', refId: siblings[pos - 1].id });
          } else {
            if (pos < 0 || pos >= siblings.length - 1) return; // 既に最背面 sibling
            res = computeMove(s.layers, [id], { kind: 'after', refId: siblings[pos + 1].id });
          }
          if (!res) return;
          s.layers = res.layers;
          s.dirty = true;
        }),

      moveLayerEnd: (id, where) =>
        set((s) => {
          const idSet = new Set(s.layers.map((l) => l.id));
          const self = s.layers.find((l) => l.id === id);
          if (!self || createLayerLockChecker(s.layers as Layer[])(id)) return;
          const parent = self.parentId && idSet.has(self.parentId) ? self.parentId : null;
          const siblings = s.layers.filter(
            (l) => (l.parentId && idSet.has(l.parentId) ? l.parentId : null) === parent,
          );
          if (siblings.length <= 1) return;
          let res: ReturnType<typeof computeMove> = null;
          if (where === 'front') {
            if (siblings[0].id === id) return;
            res = computeMove(s.layers, [id], { kind: 'before', refId: siblings[0].id });
          } else {
            const last = siblings[siblings.length - 1];
            if (last.id === id) return;
            res = computeMove(s.layers, [id], { kind: 'after', refId: last.id });
          }
          if (!res) return;
          s.layers = res.layers;
          s.dirty = true;
        }),

      moveLayers: (ids, target, opts) =>
        set((s) => {
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          if (topLevelReps(s.layers as Layer[], ids).some(isLocked)) return;
          const res = computeMove(s.layers, ids, target, opts);
          if (!res) return;
          s.layers = res.layers;
          s.selectedIds = res.selectIds;
          s.selectedId = res.selectIds[res.selectIds.length - 1] ?? null;
          // グループ内へ落としたら結果が見えるよう自動展開
          if (target.kind === 'into') {
            const g = s.layers.find((l) => l.id === target.groupId);
            if (g && g.type === 'group') g.collapsed = false;
          }
          s.dirty = true;
        }),

      soloLayer: (id) =>
        set((s) => {
          const idSet = new Set(s.layers.map((l) => l.id));
          const byId = new Map(s.layers.map((l) => [l.id, l] as const));
          // 対象の祖先 group は表示を維持しないと本人が描画されない
          const ancestors = new Set<LayerId>();
          let pid = byId.get(id)?.parentId ?? null;
          const guard = new Set<LayerId>();
          while (pid && idSet.has(pid) && !guard.has(pid)) {
            ancestors.add(pid);
            guard.add(pid);
            pid = byId.get(pid)?.parentId ?? null;
          }
          const others = s.layers.filter((l) => l.type !== 'group' && l.id !== id);
          const target = byId.get(id);
          const isSoloed =
            !!target?.visible && others.length > 0 && others.every((l) => !l.visible);
          if (isSoloed) {
            s.layers.forEach((l) => {
              l.visible = true;
            });
          } else {
            s.layers.forEach((l) => {
              l.visible = l.id === id || ancestors.has(l.id);
            });
          }
          s.dirty = true;
        }),

      // レイヤー（group ならその子孫ごと）を複製し、原本の直前（＝前面）へ挿入する。
      // 旧実装は group を複製しても子が付いてこない「空グループ」になっていた。
      duplicateLayer: (id) =>
        set((s) => {
          if (layerBlocksContainLock(s.layers as Layer[], [id])) return;
          const result = duplicateLayerBlocks(s.layers as Layer[], [id], { x: 20, y: 20 });
          if (!result) return;
          if (!acceptsRasterBudget(result.layers)) return;
          s.layers = result.layers;
          s.selectedIds = result.selectIds;
          s.selectedId = result.selectIds[result.selectIds.length - 1] ?? null;
          s.dirty = true;
        }),

      duplicateLayers: (ids, offset = { x: 20, y: 20 }) =>
        set((s) => {
          if (layerBlocksContainLock(s.layers as Layer[], ids)) return;
          const result = duplicateLayerBlocks(s.layers as Layer[], ids, offset);
          if (!result) return;
          if (!acceptsRasterBudget(result.layers)) return;
          s.layers = result.layers;
          s.selectedIds = result.selectIds;
          s.selectedId = result.selectIds[result.selectIds.length - 1] ?? null;
          s.dirty = true;
        }),

      // 選択レイヤー群を焼き込んだ1枚の画像レイヤーで置き換える（レイヤー統合）。
      // ラスタライズ(Konva stage→PNG)は DOM 依存のため utils/layerActions 側で行い、
      // ここでは配列手術だけを1つの set() で完結させて undo を1手にまとめる。
      mergeLayers: (removeIds, src, width, height, name) =>
        set((s) => {
          const removeSet = new Set(removeIds);
          if (layerBlocksContainLock(s.layers as Layer[], [...removeSet])) return;
          const firstIdx = s.layers.findIndex((l) => removeSet.has(l.id));
          if (firstIdx < 0) return;
          const anchor = s.layers[firstIdx];
          const merged: ImageLayer = {
            id: crypto.randomUUID(),
            type: 'image',
            name: name || t({ ja: '統合レイヤー', en: 'Merged' }),
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'source-over',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            parentId: anchor.parentId ?? null,
            src,
            naturalWidth: width,
            naturalHeight: height,
          };
          // 最前面の統合対象があった位置に統合レイヤーを差し込む（重ね順を維持）
          const before = s.layers.slice(0, firstIdx).filter((l) => !removeSet.has(l.id));
          const after = s.layers.slice(firstIdx).filter((l) => !removeSet.has(l.id));
          const nextLayers = [...before, merged, ...after];
          if (!acceptsRasterBudget(nextLayers)) return;
          s.layers = nextLayers;
          s.selectedId = merged.id;
          s.selectedIds = [merged.id];
          s.dirty = true;
        }),

      nudgeLayer: (id, dx, dy) =>
        set((s) => {
          const layer = s.layers.find((candidate) => candidate.id === id);
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          if (layer && !isLocked(id)) {
            const moveIds = layer.type === 'group'
              ? collectDescendants(s.layers as Layer[], id)
              : new Set<LayerId>([id]);
            for (const moveId of moveIds) {
              const target = s.layers.find((candidate) => candidate.id === moveId);
              if (!target || isLocked(moveId) || target.type === 'group') continue;
              target.x += dx;
              target.y += dy;
            }
            s.dirty = true;
          }
        }),

      nudgeLayers: (ids, dx, dy) =>
        set((s) => {
          const reps = topLevelReps(s.layers as Layer[], ids);
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          const moveIds = new Set<LayerId>();
          for (const id of reps) {
            const layer = s.layers.find((candidate) => candidate.id === id);
            if (!layer || isLocked(id)) continue;
            if (layer.type === 'group') {
              for (const descendant of collectDescendants(s.layers as Layer[], id)) {
                moveIds.add(descendant);
              }
            } else {
              moveIds.add(id);
            }
          }
          let changed = false;
          for (const id of moveIds) {
            const layer = s.layers.find((candidate) => candidate.id === id);
            if (!layer || isLocked(id) || layer.type === 'group') continue;
            layer.x += dx;
            layer.y += dy;
            changed = true;
          }
          if (changed) s.dirty = true;
        }),

      clearLayers: () =>
        set((s) => {
          s.layers = [];
          s.selectedId = null;
          s.selectedIds = [];
          s.dirty = true;
        }),

      setTool: (t) =>
        set((s) => {
          s.tool = t;
        }),

      autoSelect: true,
      setAutoSelect: (v) =>
        set((s) => {
          s.autoSelect = v;
        }),

      applyCrop: (x, y, width, height) =>
        set((s) => {
          s.canvas.width = Math.round(width);
          s.canvas.height = Math.round(height);
          s.layers.forEach((layer) => {
            layer.x -= x;
            layer.y -= y;
          });
          s.viewport.autoFit = true;
          s.dirty = true;
        }),

      fitCanvasToLayer: (id) =>
        set((s) => {
          const layer = s.layers.find((x) => x.id === id);
          if (!layer || layer.type !== 'image') return;
          const w = Math.round(layer.naturalWidth * (layer.scaleX || 1));
          const h = Math.round(layer.naturalHeight * (layer.scaleY || 1));
          const size = validatePixelSize(w, h);
          if (!size.ok) return;
          // カンバスを画像の表示サイズに合わせ、その画像を原点に揃える
          const dx = layer.x;
          const dy = layer.y;
          s.canvas.width = size.width;
          s.canvas.height = size.height;
          layer.x = 0;
          layer.y = 0;
          // 他レイヤーも同じだけ平行移動して相対位置を保つ
          s.layers.forEach((other) => {
            if (other.id !== id) {
              other.x -= dx;
              other.y -= dy;
            }
          });
          s.viewport.autoFit = true;
          s.dirty = true;
        }),

      setShapeKind: (k) =>
        set((s) => {
          s.shapeKind = k;
        }),

      selection: null,
      selectionMode: 'replace',
      setSelection: (sel) =>
        set((s) => {
          s.selection = sel;
        }),

      invertSelection: () => {
        const { selection, canvas } = get();
        const cw = canvas.width, ch = canvas.height;
        const m = selectionToMask(selection, cw, ch);
        const inv = new Uint8ClampedArray(cw * ch);
        for (let i = 0; i < inv.length; i++) inv[i] = 255 - m[i];
        const allZero = !inv.some(v => v > 0);
        set((s) => {
          s.selection = allZero ? null : maskToSelection(inv, cw, ch);
        });
      },

      setSelectionMode: (mode) =>
        set((s) => {
          (s as any).selectionMode = mode;
        }),

      commitSelection: (raw, modeOverride) => {
        const state = get();
        const mode = modeOverride ?? (state.selectionMode as SelMode);
        const cw = state.canvas.width, ch = state.canvas.height;
        const base = selectionToMask(state.selection, cw, ch);
        const addM = selectionToMask(raw, cw, ch);
        const combined = mode === 'replace' ? addM : combineMasks(base, addM, mode);
        const allZero = !combined.some(v => v > 0);
        set((s) => {
          s.selection = allZero ? null : maskToSelection(combined, cw, ch);
        });
      },

      growSelection: (px) => {
        if (px <= 0) return;
        const state = get();
        if (!state.selection) return;
        const cw = state.canvas.width, ch = state.canvas.height;
        const m = selectionToMask(state.selection, cw, ch);
        const result = dilateMask(m, cw, ch, px);
        set((s) => {
          s.selection = maskToSelection(result, cw, ch);
        });
      },

      shrinkSelection: (px) => {
        if (px <= 0) return;
        const state = get();
        if (!state.selection) return;
        const cw = state.canvas.width, ch = state.canvas.height;
        const m = selectionToMask(state.selection, cw, ch);
        const result = erodeMask(m, cw, ch, px);
        set((s) => {
          s.selection = maskToSelection(result, cw, ch);
        });
      },

      featherSelection: (px) => {
        if (px <= 0) return;
        const state = get();
        if (!state.selection) return;
        const cw = state.canvas.width, ch = state.canvas.height;
        const m = selectionToMask(state.selection, cw, ch);
        const result = featherMask(m, cw, ch, px);
        set((s) => {
          s.selection = maskToSelection(result, cw, ch);
        });
      },

      smoothSelection: (px) => {
        if (px <= 0) return;
        const state = get();
        if (!state.selection) return;
        const cw = state.canvas.width, ch = state.canvas.height;
        const m = selectionToMask(state.selection, cw, ch);
        const result = smoothMask(m, cw, ch, px);
        set((s) => {
          s.selection = maskToSelection(result, cw, ch);
        });
      },

      marqueeKind: 'rect',
      setMarqueeKind: (k) =>
        set((s) => {
          s.marqueeKind = k;
        }),

      wandTolerance: 32,
      setWandTolerance: (t) =>
        set((s) => {
          s.wandTolerance = t;
        }),
      wandContiguous: true,
      setWandContiguous: (v) => set((s) => { s.wandContiguous = v; }),
      wandAntiAlias: true,
      setWandAntiAlias: (v) => set((s) => { s.wandAntiAlias = v; }),
      wandSampleMerged: true,
      setWandSampleMerged: (v) => set((s) => { s.wandSampleMerged = v; }),

      brushSize: 30,
      brushHardness: 80,
      brushOpacity: 100,
      brushFlow: 100,
      setBrushSize: (v) =>
        set((s) => {
          s.brushSize = Math.max(1, Math.min(2000, v));
        }),
      setBrushHardness: (v) =>
        set((s) => {
          s.brushHardness = Math.max(0, Math.min(100, v));
        }),
      setBrushOpacity: (v) =>
        set((s) => {
          s.brushOpacity = Math.max(1, Math.min(100, v));
        }),
      setBrushFlow: (v) =>
        set((s) => {
          s.brushFlow = Math.max(1, Math.min(100, v));
        }),
      brushSpacing: 15,
      setBrushSpacing: (v) =>
        set((s) => {
          s.brushSpacing = Math.max(1, Math.min(200, v));
        }),
      brushRoundness: 100,
      setBrushRoundness: (v) =>
        set((s) => {
          s.brushRoundness = Math.max(1, Math.min(100, v));
        }),
      brushAngle: 0,
      setBrushAngle: (v) =>
        set((s) => {
          s.brushAngle = Math.max(-180, Math.min(180, v));
        }),
      brushSmoothing: 0,
      setBrushSmoothing: (v) =>
        set((s) => {
          s.brushSmoothing = Math.max(0, Math.min(100, v));
        }),
      brushPressureSize: false,
      setBrushPressureSize: (v) =>
        set((s) => {
          s.brushPressureSize = v;
        }),
      brushPressureOpacity: false,
      setBrushPressureOpacity: (v) =>
        set((s) => {
          s.brushPressureOpacity = v;
        }),
      brushSizeJitter: 0,
      setBrushSizeJitter: (v) =>
        set((s) => {
          s.brushSizeJitter = Math.max(0, Math.min(100, v));
        }),
      brushScatter: 0,
      setBrushScatter: (v) =>
        set((s) => {
          s.brushScatter = Math.max(0, Math.min(100, v));
        }),
      brushFlowJitter: 0,
      setBrushFlowJitter: (v) =>
        set((s) => {
          s.brushFlowJitter = Math.max(0, Math.min(100, v));
        }),
      brushEraser: false,
      setBrushEraser: (v) =>
        set((s) => {
          s.brushEraser = v;
        }),

      setForegroundColor: (c) =>
        set((s) => {
          s.foregroundColor = c;
        }),

      setBackgroundColor: (c) =>
        set((s) => {
          s.backgroundColor = c;
        }),

      swapColors: () =>
        set((s) => {
          const fg = s.foregroundColor;
          s.foregroundColor = s.backgroundColor;
          s.backgroundColor = fg;
        }),

      resetColors: () =>
        set((s) => {
          s.foregroundColor = '#000000';
          s.backgroundColor = '#ffffff';
        }),

      recentColors: [],
      pushRecentColor: (c) =>
        set((s) => {
          const hex = c.toLowerCase();
          s.recentColors = [hex, ...s.recentColors.filter((x) => x !== hex)].slice(0, 16);
        }),

      setViewport: (v) =>
        set((s) => {
          Object.assign(s.viewport, v);
          if (v.x !== undefined || v.y !== undefined || v.scale !== undefined) {
            s.viewport.autoFit = false;
          }
        }),

      resetViewport: () =>
        set((s) => {
          s.viewport = { x: 0, y: 0, scale: 1, autoFit: true };
        }),

      loadProject: (data, filePath, revision = null) =>
        set((s) => {
          if (!acceptsRasterBudget(data.layers)) return;
          s.canvas = data.canvas;
          // 旧保存ファイル/PSDインポート産は子が group 直後に連続しない場合がある。
          // 入口で pre-order へ正規化して「パネル表示と描画順の乖離」を根絶する。
          s.layers = sanitizeAndNormalize(data.layers);
          s.selectedId = data.selectedId;
          s.selectedIds = data.selectedId ? [data.selectedId] : [];
          s.guides = (data as { guides?: Guide[] }).guides ?? [];
          s.currentFilePath = filePath;
          s.currentFileRevision = revision;
          s.dirty = false;
          s.pendingOperations = 0;
          s.adjustmentPreview = null;
          s.viewport.autoFit = true;
        }),

      setCurrentFilePath: (p, revision = null) =>
        set((s) => {
          s.currentFilePath = p;
          s.currentFileRevision = revision;
        }),

      markSaved: () =>
        set((s) => {
          s.dirty = false;
        }),

      // 選択中の全レイヤーを1つの新規グループへまとめる（旧実装は主選択1枚しか包まなかった）。
      // 代表（祖先も選択されている子は除外）だけを reparent し、子孫はブロックごと連れて行く。
      groupSelected: () =>
        set((s) => {
          const sel = s.selectedIds.length ? s.selectedIds : s.selectedId ? [s.selectedId] : [];
          const reps = topLevelReps(s.layers, sel);
          if (reps.length === 0) return;
          if (layerBlocksContainLock(s.layers as Layer[], reps)) return;
          const idSet = new Set(s.layers.map((l) => l.id));
          const byId = new Map(s.layers.map((l) => [l.id, l] as const));
          const idxOf = new Map(s.layers.map((l, i) => [l.id, i] as const));
          // 最前面（配列で最小 index）の代表の位置・親にグループを作る
          const frontRep = reps.slice().sort((a, b) => idxOf.get(a)! - idxOf.get(b)!)[0];
          const frontLayer = byId.get(frontRep)!;
          const parent =
            frontLayer.parentId && idSet.has(frontLayer.parentId) ? frontLayer.parentId : null;
          const group: GroupLayer = {
            id: crypto.randomUUID(),
            type: 'group',
            name: t({ ja: 'グループ', en: 'Group' }),
            visible: true,
            locked: false,
            opacity: 1,
            blendMode: 'source-over',
            x: 0,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            collapsed: false,
            parentId: parent,
          };
          const relocSet = new Set<LayerId>();
          for (const r of reps) {
            relocSet.add(r);
            for (const d of collectDescendants(s.layers, r)) relocSet.add(d);
          }
          const repSet = new Set(reps);
          const moving = s.layers
            .filter((l) => relocSet.has(l.id))
            .map((l) => ({ ...l }) as Layer);
          for (const l of moving) if (repSet.has(l.id)) l.parentId = group.id;
          const rest = s.layers.filter((l) => !relocSet.has(l.id)).map((l) => ({ ...l }) as Layer);
          // frontRep が居た位置（＝frontRep より後ろの最初の rest 要素）へグループを挿す
          const frontIdx = idxOf.get(frontRep)!;
          let at = rest.findIndex((l) => idxOf.get(l.id)! > frontIdx);
          if (at < 0) at = rest.length;
          const merged = [...rest.slice(0, at), group, ...moving, ...rest.slice(at)];
          s.layers = sanitizeAndNormalize(merged);
          s.selectedId = group.id;
          s.selectedIds = [group.id];
          s.dirty = true;
        }),

      ungroupSelected: () =>
        set((s) => {
          if (!s.selectedId) return;
          const target = s.layers.find((x) => x.id === s.selectedId);
          if (!target) return;
          if (layerBlocksContainLock(s.layers as Layer[], [target.id])) return;
          if (target.type === 'group') {
            const groupId = target.id;
            const parentOfGroup = target.parentId ?? null;
            s.layers.forEach((l) => {
              if (l.parentId === groupId) l.parentId = parentOfGroup;
            });
            s.layers = s.layers.filter((l) => l.id !== groupId);
            s.selectedId = null;
            s.selectedIds = [];
          } else if (target.parentId) {
            target.parentId = null;
          }
          // parentId を書き換えただけだと配列が非正準形になり、パネル表示と描画順が
          // 乖離する（子を1枚だけ解除した時など）。必ず pre-order へ戻す。
          s.layers = sanitizeAndNormalize(s.layers.map((l) => ({ ...l }) as Layer));
          s.dirty = true;
        }),

      toggleGroupCollapsed: (id) =>
        set((s) => {
          const g = s.layers.find((x) => x.id === id);
          if (g && g.type === 'group') {
            g.collapsed = !g.collapsed;
          }
        }),

      toggleClipped: (id) =>
        set((s) => {
          const idx = s.layers.findIndex((x) => x.id === id);
          if (idx < 0) return;
          const layer = s.layers[idx];
          if (layer.type === 'group') return;
          if (createLayerLockChecker(s.layers as Layer[])(id)) return;
          if (idx >= s.layers.length - 1) return;
          const below = s.layers[idx + 1];
          if (
            !below
            || below.type === 'group'
            || (below.parentId ?? null) !== (layer.parentId ?? null)
          ) return;
          layer.clipped = !layer.clipped;
          s.dirty = true;
        }),

      alignSelected: (mode) =>
        set((s) => {
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          const targets = s.layers.filter(
            (l) => s.selectedIds.includes(l.id) && !isLocked(l.id) && l.type !== 'group',
          );
          if (targets.length === 0) return;
          // Photoshop semantics:
          //   1 selected  -> align to canvas
          //   2+ selected -> align to the combined bounding box of the selection
          const bounds =
            targets.length === 1
              ? { x: 0, y: 0, width: s.canvas.width, height: s.canvas.height }
              : getGroupBounds(targets);
          for (const t of targets) {
            const idx = s.layers.findIndex((l) => l.id === t.id);
            if (idx < 0) continue;
            const { x, y } = alignToBounds(s.layers[idx], bounds, mode);
            s.layers[idx].x = x;
            s.layers[idx].y = y;
          }
          s.dirty = true;
        }),

      distributeSelected: (mode) =>
        set((s) => {
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          const targets = s.layers.filter(
            (l) => s.selectedIds.includes(l.id) && !isLocked(l.id) && l.type !== 'group',
          );
          if (targets.length < 3) return;
          const moves = distributeEdges(targets, mode);
          for (const [id, pos] of moves) {
            const idx = s.layers.findIndex((l) => l.id === id);
            if (idx >= 0) {
              s.layers[idx].x = pos.x;
              s.layers[idx].y = pos.y;
            }
          }
          s.dirty = true;
        }),

      spacingSelected: (axis) =>
        set((s) => {
          const isLocked = createLayerLockChecker(s.layers as Layer[]);
          const targets = s.layers.filter(
            (l) => s.selectedIds.includes(l.id) && !isLocked(l.id) && l.type !== 'group',
          );
          if (targets.length < 3) return;
          const moves = distributeSpacing(targets, axis);
          for (const [id, pos] of moves) {
            const idx = s.layers.findIndex((l) => l.id === id);
            if (idx >= 0) {
              s.layers[idx].x = pos.x;
              s.layers[idx].y = pos.y;
            }
          }
          s.dirty = true;
        }),

      addGuide: (axis, pos) =>
        set((s) => {
          s.guides.push({ id: crypto.randomUUID(), axis, pos: Math.round(pos) });
          s.dirty = true;
        }),

      updateGuide: (id, pos) =>
        set((s) => {
          const g = s.guides.find((x) => x.id === id);
          if (g) {
            g.pos = Math.round(pos);
            s.dirty = true;
          }
        }),

      removeGuide: (id) =>
        set((s) => {
          s.guides = s.guides.filter((x) => x.id !== id);
          s.dirty = true;
        }),

      clearGuides: () =>
        set((s) => {
          s.guides = [];
          s.dirty = true;
        }),

      toggleShowGuides: () =>
        set((s) => {
          s.showGuides = !s.showGuides;
        }),

      panelsVisible: true,
      togglePanels: () =>
        set((s) => {
          s.panelsVisible = !s.panelsVisible;
        }),

      resetDocument: (c) =>
        set((s) => {
          const size = validatePixelSize(c.width, c.height);
          if (!size.ok) return;
          s.canvas = { ...c, width: size.width, height: size.height };
          s.layers = [];
          s.selectedId = null;
          s.selectedIds = [];
          s.selection = null;
          s.adjustmentPreview = null;
          s.guides = [];
          s.currentFilePath = null;
          s.currentFileRevision = null;
          s.dirty = false;
          s.pendingOperations = 0;
          s.viewport.autoFit = true;
        }),
    })),
    {
      limit: 50,
      partialize: (state) => ({
        canvas: state.canvas,
        layers: state.layers,
        selection: state.selection,
      }),
      // Layer focus is workspace UI state, not a document edit.  Keeping it out
      // of history prevents ordinary row clicks from evicting real edits and
      // from stringifying every base64 image in a large PSD.  Pixel selections
      // remain undoable, but compare them alone when document references match.
      equality: editorHistoryEqual,
    },
  ),
  );

  // A noisy raster stroke can contain tens of megabytes as a PNG data URL.
  // Count retained payloads conservatively and evict old history before it can
  // grow without regard to renderer memory.  Trimming runs after zundo appends
  // the new state (onSave itself fires immediately before that append).
  let historyTrimScheduled = false;
  store.temporal.getState().setOnSave(() => {
    if (historyTrimScheduled) return;
    historyTrimScheduled = true;
    queueMicrotask(() => {
      historyTrimScheduled = false;
      const temporalState = store.temporal.getState();
      const hasBothDirections = temporalState.pastStates.length > 0
        && temporalState.futureStates.length > 0;
      const sideBudget = hasBothDirections
        ? Math.floor(HISTORY_MEMORY_BUDGET_BYTES / 2)
        : HISTORY_MEMORY_BUDGET_BYTES;
      const pastStates = trimHistoryStatesToBudget(temporalState.pastStates, sideBudget);
      const futureStates = trimHistoryStatesToBudget(temporalState.futureStates, sideBudget);
      if (
        pastStates.length !== temporalState.pastStates.length
        || futureStates.length !== temporalState.futureStates.length
      ) {
        store.temporal.setState({ pastStates, futureStates });
      }
    });
  });

  return store;
}

export type DocStore = ReturnType<typeof createDocumentStore>;

/** 開いているタブ1枚。`store` が独立ドキュメント状態(＋undo履歴)を持つ。 */
export interface DocEntry {
  id: string;
  store: DocStore;
  /** 既定タイトル（未保存の「無題-N」）。保存/読込で basename に更新される。 */
  title: string;
}

interface WorkspaceState {
  docs: DocEntry[];
  activeId: string;
  /** 空白の新規ドキュメントをタブとして追加し、アクティブにする。 */
  newDoc: (canvas?: CanvasConfig, title?: string) => string;
  /** 既存ストア（読み込み済み）をタブとして追加。唯一の未編集タブがあれば置換する。 */
  adoptDoc: (store: DocStore, title: string) => string;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  setTitle: (id: string, title: string) => void;
}

let untitledCount = 0;
function nextUntitled(): string {
  untitledCount += 1;
  return t({ ja: `無題-${untitledCount}`, en: `Untitled-${untitledCount}` });
}

function isPristine(store: DocStore): boolean {
  const st = store.getState();
  return st.layers.length === 0
    && !st.dirty
    && st.pendingOperations === 0
    && !st.currentFilePath;
}

export const workspaceStore = create<WorkspaceState>((set, get) => {
  const firstId = crypto.randomUUID();
  return {
    docs: [{ id: firstId, store: createDocumentStore(), title: nextUntitled() }],
    activeId: firstId,
    newDoc: (canvas, title) => {
      const current = get().docs.find((doc) => doc.id === get().activeId);
      if (current) flushPendingSyncEdits(current.store);
      const id = crypto.randomUUID();
      const store = createDocumentStore(canvas);
      set((s) => ({
        docs: [...s.docs, { id, store, title: title ?? nextUntitled() }],
        activeId: id,
      }));
      return id;
    },
    adoptDoc: (store, title) => {
      const current = get().docs.find((doc) => doc.id === get().activeId);
      if (current) flushPendingSyncEdits(current.store);
      const id = crypto.randomUUID();
      set((s) => {
        // 起動直後の未編集の空白タブ1枚だけなら、それを置換して無駄なタブを残さない
        if (s.docs.length === 1 && isPristine(s.docs[0].store)) {
          return { docs: [{ id, store, title }], activeId: id };
        }
        return { docs: [...s.docs, { id, store, title }], activeId: id };
      });
      return id;
    },
    closeDoc: (id) =>
      set((s) => {
        const idx = s.docs.findIndex((d) => d.id === id);
        if (idx < 0) return s;
        discardPendingSyncEdits(s.docs[idx].store);
        let docs = s.docs.filter((d) => d.id !== id);
        let activeId = s.activeId;
        if (docs.length === 0) {
          const nid = crypto.randomUUID();
          docs = [{ id: nid, store: createDocumentStore(), title: nextUntitled() }];
          activeId = nid;
        } else if (activeId === id) {
          activeId = docs[Math.min(idx, docs.length - 1)].id;
        }
        return { docs, activeId };
      }),
    setActive: (id) => {
      const state = get();
      if (id === state.activeId || !state.docs.some((doc) => doc.id === id)) return;
      const current = state.docs.find((doc) => doc.id === state.activeId);
      if (current) flushPendingSyncEdits(current.store);
      set({ activeId: id });
    },
    setTitle: (id, title) =>
      set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, title } : d)) })),
  };
});

/** 非React文脈用: 現在アクティブなタブのストアを返す（必ず1枚は存在する）。 */
export function getActiveStore(): DocStore {
  const ws = workspaceStore.getState();
  return (ws.docs.find((d) => d.id === ws.activeId) ?? ws.docs[0]).store;
}

/** React文脈用: アクティブストアを購読付きで返す（タブ切替で自動再subscribe）。 */
function useActiveStore(): DocStore {
  const activeId = useStore(workspaceStore, (s) => s.activeId);
  const docs = useStore(workspaceStore, (s) => s.docs);
  return (docs.find((d) => d.id === activeId) ?? docs[0]).store;
}

/** zustand の UseBoundStore と同じ呼出形（無引数=全状態 / セレクタ=部分）を再現する。 */
interface EditorStoreHook {
  (): EditorState;
  <T>(selector: (s: EditorState) => T): T;
}

const editorStoreHook: EditorStoreHook = <T,>(selector?: (s: EditorState) => T) => {
  const store = useActiveStore();
  return useStore(store, (selector ?? ((s: EditorState) => s)) as (s: EditorState) => T);
};

/**
 * 既存の単一ストア API（hook＋getState/setState/subscribe/temporal）をそのまま保ったまま、
 * 中身を「アクティブなタブのストア」へ委譲するファサード。これにより全コンポーネントの
 * `useEditorStore((s)=>...)` / `useEditorStore()` / `useEditorStore.getState()` 等は
 * コード無改変で多文書対応になる。
 */
export const useEditorStore = editorStoreHook as EditorStoreHook & {
  getState: DocStore['getState'];
  setState: DocStore['setState'];
  subscribe: DocStore['subscribe'];
  temporal: DocStore['temporal'];
};
useEditorStore.getState = () => getActiveStore().getState();
useEditorStore.setState = ((partial: unknown, replace?: boolean) =>
  (getActiveStore().setState as (p: unknown, r?: boolean) => void)(partial, replace)) as DocStore['setState'];
useEditorStore.subscribe = ((listener: unknown) =>
  (getActiveStore().subscribe as (l: unknown) => () => void)(listener)) as DocStore['subscribe'];
Object.defineProperty(useEditorStore, 'temporal', {
  get() {
    return getActiveStore().temporal;
  },
});

export function useCanUndo() {
  const store = useActiveStore();
  return useStore(store.temporal, (s) => s.pastStates.length > 0);
}

export function useCanRedo() {
  const store = useActiveStore();
  return useStore(store.temporal, (s) => s.futureStates.length > 0);
}

export function undo() {
  const store = getActiveStore();
  const before = store.temporal.getState().pastStates.length;
  store.temporal.getState().undo();
  const after = store.temporal.getState().pastStates.length;
  if (historyStackMoved(before, after)) store.setState({ dirty: true });
  reconcileLayerSelection(store);
}

export function redo() {
  const store = getActiveStore();
  const before = store.temporal.getState().futureStates.length;
  store.temporal.getState().redo();
  const after = store.temporal.getState().futureStates.length;
  if (historyStackMoved(before, after)) store.setState({ dirty: true });
  reconcileLayerSelection(store);
}

function reconcileLayerSelection(store: DocStore) {
  const state = store.getState();
  const ids = new Set(state.layers.map((layer) => layer.id));
  const selectedIds = state.selectedIds.filter((id) => ids.has(id));
  const selectedId = state.selectedId && ids.has(state.selectedId)
    ? state.selectedId
    : selectedIds.at(-1) ?? null;
  if (
    selectedId !== state.selectedId
    || selectedIds.length !== state.selectedIds.length
  ) {
    store.setState({ selectedId, selectedIds });
  }
}

export function clearHistory() {
  getActiveStore().temporal.getState().clear();
}

export function newId(): LayerId {
  return crypto.randomUUID();
}

export function createImageLayer(
  src: string,
  naturalWidth: number,
  naturalHeight: number,
): ImageLayer {
  return {
    id: newId(),
    type: 'image',
    name: 'Image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    src,
    naturalWidth,
    naturalHeight,
  };
}

export function createShapeLayer(
  shape: ShapeKind,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string = '#000000',
): ShapeLayer {
  return {
    id: newId(),
    type: 'shape',
    name:
      shape === 'rect'
        ? t({ ja: '矩形', en: 'Rectangle' })
        : shape === 'ellipse'
          ? t({ ja: '楕円', en: 'Ellipse' })
          : t({ ja: '直線', en: 'Line' }),
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shape,
    shapeWidth: width,
    shapeHeight: height,
    fill,
    fillEnabled: shape !== 'line',
    strokeColor: '#000000',
    strokeWidth: shape === 'line' ? 4 : 0,
    strokeEnabled: shape === 'line',
    cornerRadius: 0,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 10,
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    shadowOpacity: 0.6,
  };
}

export function createTextLayer(
  text = t({ ja: 'テキスト', en: 'Text' }),
  fontFamily = DEFAULT_TEXT_FONT,
  fontSize = 64,
  x = 100,
  y = 100,
  fill = '#000000',
): TextLayer {
  return {
    id: newId(),
    type: 'text',
    name: text.slice(0, 20),
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    text,
    fontFamily,
    fontSize,
    fontStyle: 'normal',
    fill,
    align: 'left',
    letterSpacing: 0,
    lineHeight: 1.2,
    strokeEnabled: false,
    strokeColor: '#ffffff',
    strokeWidth: 4,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowBlur: 10,
    shadowOffsetX: 4,
    shadowOffsetY: 4,
    shadowOpacity: 0.6,
    gradientEnabled: false,
    gradientColor1: '#ffaa00',
    gradientColor2: '#ff0066',
    gradientAngle: 90,
  };
}
