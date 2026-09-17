import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Stage,
  Layer as KonvaLayer,
  Image as KonvaImage,
  Text,
  Rect,
  Ellipse,
  Line,
  Transformer,
  Group as KonvaGroup,
} from 'react-konva';
import Konva from 'konva';
import {
  useEditorStore,
  getActiveStore,
  createTextLayer,
  createShapeLayer,
  createImageLayer,
  type DocStore,
} from '../store/editorStore';
import type { SelMode } from '../store/editorStore';
import type { ImageLayer, TextLayer, ShapeLayer, Layer, Selection, ColorAdjustments } from '../types';
import { strokeSegment, stampBrush, brushSpacing, type BrushParams } from '../utils/brush';
import { t } from '../i18n/locale';
import { TextEditOverlay } from './TextEditOverlay';
import { CropOverlay } from './CropOverlay';
import { Ruler } from './Ruler';
import { ContextMenu, type CtxItem } from './ContextMenu';
import { getLayerBounds } from '../utils/alignment';
import { collectSnapTargets, snapBox, type SnapGuide } from '../utils/snapping';
import { pasteFromClipboard } from '../utils/clipboardPaste';
import { magicWandSelect, selectionMaskForImageLayer, type WandOptions } from '../utils/selectionOps';
import { deleteSelectedLayers, duplicateSelectedLayers } from '../utils/layerActions';
import {
  brushStrokeMode,
  constrainShapeEndpoint,
} from '../interactions/drawingConstraints';
import {
  clampPointToCanvas,
  shouldClearLayerSelection,
  shouldClearPixelSelection,
  shouldStartMarqueeOnCanvasEnter,
} from '../interactions/selectionPolicy';
import {
  constrainDragDelta,
  layerNodePosition,
  shouldPreserveMultiSelection,
  translatedLayerPositions,
  type LayerMoveStart,
} from '../interactions/layerMove';
import { DEFAULT_TEXT_FONT } from '../fonts/catalog';
import { isPaintTarget, isSafeBrushCanvas } from '../interactions/paintPolicy';
import { adjustmentPreviewPixelRatio } from '../interactions/adjustmentPreview';
import { createLayerLockChecker } from '../interactions/layerLockPolicy';
import {
  applyColorAdjustmentsToRgba,
  colorAdjustmentsForLayer,
  isDefaultColorAdjustments,
} from '../imaging/colorAdjustments';
import { toast } from '../store/toastStore';
import {
  clearPendingSyncEdit,
  flushPendingSyncEdits,
  registerPendingSyncEdit,
  trackPendingAsyncEdit,
} from '../interactions/pendingEdits';

const colorAdjustmentFilter = function (this: Konva.Node, imageData: ImageData) {
  const base = this.getAttr('colorAdjustments') as ColorAdjustments;
  const preview = this.getAttr('previewColorAdjustments') as ColorAdjustments | undefined;
  if (!isDefaultColorAdjustments(base)) {
    applyColorAdjustmentsToRgba(imageData.data, base);
  }
  if (preview) {
    applyColorAdjustmentsToRgba(
      imageData.data,
      preview,
      this.getAttr('colorAdjustmentMask') as Uint8ClampedArray | undefined,
    );
  }
};

function useImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | undefined>(undefined);
  useEffect(() => {
    const img = new window.Image();
    img.src = src;
    img.onload = () => setImage(img);
    img.onerror = () => setImage(undefined);
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);
  return image;
}

function ImageNode({
  layer,
  draggable,
  previewAdjustments,
  previewSelection,
  canvasSize,
  onSelect,
  onChange,
}: {
  layer: ImageLayer;
  draggable: boolean;
  previewAdjustments?: ColorAdjustments;
  previewSelection?: Selection | null;
  canvasSize: { width: number; height: number };
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<ImageLayer>) => void;
}) {
  const img = useImage(layer.src);
  const ref = useRef<Konva.Image>(null);

  // Photoshop系の色調補正を単一の非破壊フィルタとして適用する。
  const adjustments = colorAdjustmentsForLayer(layer);
  const adjustmentKey = JSON.stringify(adjustments);
  const previewKey = JSON.stringify(previewAdjustments ?? null);
  const selectionKey = JSON.stringify(previewSelection ?? null);
  const previewActive = previewAdjustments != null
    && !isDefaultColorAdjustments(previewAdjustments);
  const hasAdjust = !isDefaultColorAdjustments(adjustments) || previewActive;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !img) return;
    if (hasAdjust) {
      node.setAttr('colorAdjustments', adjustments);
      node.setAttr('previewColorAdjustments', previewAdjustments);
      let selectionMask: Uint8ClampedArray | undefined;
      if (previewAdjustments && previewSelection) {
        selectionMask = selectionMaskForImageLayer(
          previewSelection,
          layer,
          canvasSize.width,
          canvasSize.height,
        );
      }
      node.setAttr('colorAdjustmentMask', selectionMask);
      node.filters([colorAdjustmentFilter]);
      node.cache({
        x: 0,
        y: 0,
        width: layer.naturalWidth,
        height: layer.naturalHeight,
        pixelRatio: adjustmentPreviewPixelRatio(
          layer.naturalWidth,
          layer.naturalHeight,
          previewActive,
        ),
      });
    } else {
      node.filters([]);
      node.setAttr('previewColorAdjustments', undefined);
      node.setAttr('colorAdjustmentMask', undefined);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [
    img,
    hasAdjust,
    adjustmentKey,
    previewKey,
    selectionKey,
    canvasSize.width,
    canvasSize.height,
    layer.naturalWidth,
    layer.naturalHeight,
    previewActive,
  ]);

  if (!img) return null;
  return (
    <KonvaImage
      ref={ref}
      id={layer.id}
      image={img}
      x={layer.x}
      y={layer.y}
      width={layer.naturalWidth}
      height={layer.naturalHeight}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      globalCompositeOperation={layer.blendMode}
      shadowEnabled={layer.shadowEnabled ?? false}
      shadowColor={layer.shadowColor ?? '#000000'}
      shadowBlur={layer.shadowBlur ?? 0}
      shadowOffsetX={layer.shadowOffsetX ?? 0}
      shadowOffsetY={layer.shadowOffsetY ?? 0}
      shadowOpacity={layer.shadowOpacity ?? 0.6}
      stroke={layer.strokeEnabled ? layer.strokeColor : undefined}
      strokeWidth={layer.strokeEnabled ? layer.strokeWidth ?? 0 : 0}
      draggable={draggable}
      listening={!layer.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          scaleX: node.scaleX(),
          scaleY: node.scaleY(),
        });
      }}
    />
  );
}

function computeGradientPoints(layer: TextLayer) {
  const lines = layer.text.split('\n');
  const longestLine = Math.max(1, ...lines.map((l) => l.length));
  const isJa = /[぀-ヿ一-鿿]/.test(layer.text);
  const charWidth = isJa ? layer.fontSize * 1.0 : layer.fontSize * 0.55;
  const w = Math.max(20, longestLine * charWidth);
  const lineHeight = layer.lineHeight ?? 1.2;
  const h = Math.max(layer.fontSize, layer.fontSize * lines.length * lineHeight);
  const angle = layer.gradientAngle ?? 90;
  const rad = (angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const diag = Math.sqrt(w * w + h * h) / 2;
  const dx = Math.cos(rad) * diag;
  const dy = Math.sin(rad) * diag;
  return {
    start: { x: cx - dx, y: cy - dy },
    end: { x: cx + dx, y: cy + dy },
  };
}

function TextNode({
  layer,
  draggable,
  hidden,
  onSelect,
  onEdit,
  onChange,
}: {
  layer: TextLayer;
  draggable: boolean;
  hidden: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onEdit: () => void;
  onChange: (patch: Partial<TextLayer>) => void;
}) {
  const ref = useRef<Konva.Text>(null);
  if (hidden) return null;

  const gradientProps = (layer.gradientEnabled ?? false)
    ? (() => {
        const { start, end } = computeGradientPoints(layer);
        return {
          fillPriority: 'linear-gradient' as const,
          fillLinearGradientStartPoint: start,
          fillLinearGradientEndPoint: end,
          fillLinearGradientColorStops: [
            0,
            layer.gradientColor1 ?? '#ffaa00',
            1,
            layer.gradientColor2 ?? '#ff0066',
          ],
        };
      })()
    : {};

  return (
    <Text
      ref={ref}
      id={layer.id}
      text={layer.text}
      x={layer.x}
      y={layer.y}
      fontFamily={layer.fontFamily}
      fontSize={layer.fontSize}
      fontStyle={layer.fontStyle}
      fill={layer.fill}
      letterSpacing={layer.letterSpacing ?? 0}
      lineHeight={layer.lineHeight ?? 1.2}
      align={layer.align}
      width={layer.width}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      rotation={layer.rotation}
      opacity={layer.opacity}
      visible={layer.visible}
      globalCompositeOperation={layer.blendMode}
      stroke={layer.strokeEnabled ? layer.strokeColor : undefined}
      strokeWidth={layer.strokeEnabled ? layer.strokeWidth : 0}
      fillAfterStrokeEnabled
      shadowEnabled={layer.shadowEnabled ?? false}
      shadowColor={layer.shadowColor ?? '#000000'}
      shadowBlur={layer.shadowBlur ?? 0}
      shadowOffsetX={layer.shadowOffsetX ?? 0}
      shadowOffsetY={layer.shadowOffsetY ?? 0}
      shadowOpacity={layer.shadowOpacity ?? 0.6}
      {...gradientProps}
      draggable={draggable}
      listening={!layer.locked}
      onClick={onSelect}
      onTap={onSelect}
      onDblClick={onEdit}
      onDblTap={onEdit}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        const sx = node.scaleX();
        const sy = node.scaleY();
        // Konva Transformer はノードの scaleX/Y を直接書き換える。react-konva は
        // prop が前回レンダーと同値（1→1）だとノードへ再適用しないため、ここで
        // 命令的に 1 へ戻さないと変形後も scale がノードに残り、次の変形で fontSize
        // と二重に乗算されて「一気に巨大化」する（ShapeNode と同じ対処）。
        node.scaleX(1);
        node.scaleY(1);
        // テキストは常に縦横比維持で fontSize へ変換しグリフを歪ませない
        // （設計意図: テキストは scale→fontSize）。角=両軸/サイド=片軸の
        // いずれでも、変化量が大きい軸の倍率を採用して比率維持リサイズにする。
        const f = Math.abs(sy - 1) >= Math.abs(sx - 1) ? sy : sx;
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          fontSize: Math.max(1, Math.round(layer.fontSize * Math.abs(f))),
          scaleX: 1,
          scaleY: 1,
        });
      }}
    />
  );
}

function ShapeNode({
  layer,
  draggable,
  onSelect,
  onChange,
}: {
  layer: ShapeLayer;
  draggable: boolean;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onChange: (patch: Partial<ShapeLayer>) => void;
}) {
  const ref = useRef<Konva.Shape>(null);

  // 見た目・操作の共通プロパティ（位置/原点/ハンドラは図形ごとに付ける）。
  const sharedProps = {
    id: layer.id,
    rotation: layer.rotation,
    opacity: layer.opacity,
    visible: layer.visible,
    globalCompositeOperation: layer.blendMode,
    fill: layer.fillEnabled ? layer.fill : undefined,
    stroke: layer.strokeEnabled ? layer.strokeColor : undefined,
    strokeWidth: layer.strokeEnabled ? layer.strokeWidth : 0,
    shadowEnabled: layer.shadowEnabled,
    shadowColor: layer.shadowColor,
    shadowBlur: layer.shadowBlur,
    shadowOffsetX: layer.shadowOffsetX,
    shadowOffsetY: layer.shadowOffsetY,
    shadowOpacity: layer.shadowOpacity,
    draggable,
    listening: !layer.locked,
    onClick: onSelect,
    onTap: onSelect,
  };

  // 中心オリジンの図形（rect/ellipse）はノード位置＝図形中心。
  // store の x/y は左上基準なので ±(幅/2,高さ/2) で相互変換する。
  // これにより角度変更（数値入力・Transformer）が中心まわりの回転になり破綻しない。
  const centerDragEnd = (e: Konva.KonvaEventObject<DragEvent>) =>
    onChange({
      x: e.target.x() - layer.shapeWidth / 2,
      y: e.target.y() - layer.shapeHeight / 2,
    });
  const centerTransformEnd = () => {
    const node = ref.current;
    if (!node) return;
    const w = Math.max(1, layer.shapeWidth * node.scaleX());
    const h = Math.max(1, layer.shapeHeight * node.scaleY());
    onChange({
      x: node.x() - w / 2,
      y: node.y() - h / 2,
      rotation: node.rotation(),
      shapeWidth: w,
      shapeHeight: h,
      scaleX: 1,
      scaleY: 1,
    });
    node.scaleX(1);
    node.scaleY(1);
  };

  if (layer.shape === 'rect') {
    return (
      <Rect
        ref={ref as React.Ref<Konva.Rect>}
        {...sharedProps}
        x={layer.x + layer.shapeWidth / 2}
        y={layer.y + layer.shapeHeight / 2}
        offsetX={layer.shapeWidth / 2}
        offsetY={layer.shapeHeight / 2}
        width={layer.shapeWidth}
        height={layer.shapeHeight}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        cornerRadius={layer.cornerRadius}
        onDragEnd={centerDragEnd}
        onTransformEnd={centerTransformEnd}
      />
    );
  }
  if (layer.shape === 'ellipse') {
    return (
      <Ellipse
        ref={ref as React.Ref<Konva.Ellipse>}
        {...sharedProps}
        x={layer.x + layer.shapeWidth / 2}
        y={layer.y + layer.shapeHeight / 2}
        radiusX={layer.shapeWidth / 2}
        radiusY={layer.shapeHeight / 2}
        scaleX={layer.scaleX}
        scaleY={layer.scaleY}
        onDragEnd={centerDragEnd}
        onTransformEnd={centerTransformEnd}
      />
    );
  }
  // line: 始点オリジン（従来どおり）。
  return (
    <Line
      ref={ref as React.Ref<Konva.Line>}
      {...sharedProps}
      x={layer.x}
      y={layer.y}
      points={[0, 0, layer.shapeWidth, layer.shapeHeight]}
      scaleX={layer.scaleX}
      scaleY={layer.scaleY}
      stroke={layer.strokeColor}
      strokeWidth={layer.strokeWidth || 1}
      hitStrokeWidth={Math.max(8, layer.strokeWidth)}
      fill={undefined}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={() => {
        const node = ref.current;
        if (!node) return;
        onChange({
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          shapeWidth: Math.max(1, layer.shapeWidth * node.scaleX()),
          shapeHeight: Math.max(1, layer.shapeHeight * node.scaleY()),
          scaleX: 1,
          scaleY: 1,
        });
        node.scaleX(1);
        node.scaleY(1);
      }}
    />
  );
}

function keyMode(e?: { shiftKey?: boolean | null; altKey?: boolean | null } | null): SelMode | undefined {
  if (!e) return undefined;
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  return undefined;
}

export function Canvas({ adjustmentSessionOpen = false }: { adjustmentSessionOpen?: boolean }) {
  const canvas = useEditorStore((s) => s.canvas);
  const layers = useEditorStore((s) => s.layers);
  const adjustmentPreview = useEditorStore((s) => s.adjustmentPreview);
  const selectedId = useEditorStore((s) => s.selectedId);
  const tool = useEditorStore((s) => s.tool);
  const shapeKind = useEditorStore((s) => s.shapeKind);
  const foregroundColor = useEditorStore((s) => s.foregroundColor);
  const viewport = useEditorStore((s) => s.viewport);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectMany = useEditorStore((s) => s.selectMany);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const clearLayerSelection = useEditorStore((s) => s.clearSelection);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const updateLayerPositions = useEditorStore((s) => s.updateLayerPositions);
  const duplicateLayers = useEditorStore((s) => s.duplicateLayers);
  const addLayer = useEditorStore((s) => s.addLayer);
  const setTool = useEditorStore((s) => s.setTool);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setForegroundColor = useEditorStore((s) => s.setForegroundColor);
  const setBackgroundColor = useEditorStore((s) => s.setBackgroundColor);
  const marqueeKind = useEditorStore((s) => s.marqueeKind);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const commitSelection = useEditorStore((s) => s.commitSelection);
  const wandContiguous = useEditorStore((s) => s.wandContiguous);
  const wandAntiAlias = useEditorStore((s) => s.wandAntiAlias);
  const wandSampleMerged = useEditorStore((s) => s.wandSampleMerged);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushHardness = useEditorStore((s) => s.brushHardness);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const brushFlow = useEditorStore((s) => s.brushFlow);
  const brushSpacingPct = useEditorStore((s) => s.brushSpacing);
  const brushRoundness = useEditorStore((s) => s.brushRoundness);
  const brushAngle = useEditorStore((s) => s.brushAngle);
  const brushSmoothing = useEditorStore((s) => s.brushSmoothing);
  const brushPressureSize = useEditorStore((s) => s.brushPressureSize);
  const brushPressureOpacity = useEditorStore((s) => s.brushPressureOpacity);
  const brushSizeJitter = useEditorStore((s) => s.brushSizeJitter);
  const brushScatter = useEditorStore((s) => s.brushScatter);
  const brushFlowJitter = useEditorStore((s) => s.brushFlowJitter);
  const brushEraser = useEditorStore((s) => s.brushEraser);

  const userGuides = useEditorStore((s) => s.guides);
  const showGuides = useEditorStore((s) => s.showGuides);
  const updateGuide = useEditorStore((s) => s.updateGuide);
  const removeGuide = useEditorStore((s) => s.removeGuide);

  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastMouseEvtRef = useRef<MouseEvent | null>(null);
  // 複数選択を一緒にドラッグするための開始位置記録
  const layerDragRef = useRef<{
    anchorId: string;
    anchorStart: { x: number; y: number };
    starts: Map<string, LayerMoveStart>;
    batch: boolean;
    duplicate: boolean;
    customCommit: boolean;
  } | null>(null);
  // Konva may invoke a node's onDragEnd before or after the Stage handler.
  // Keep the dragged members suppressed through the next frame so the anchor's
  // individual x/y commit cannot overwrite the atomic multi-layer commit.
  const layerDragEndSuppressRef = useRef<Set<string>>(new Set());
  const [wrapSize, setWrapSize] = useState({ w: 0, h: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingFromCreate, setEditingFromCreate] = useState(false);
  const editingStoreRef = useRef<DocStore | null>(null);
  const [shapeDraft, setShapeDraft] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    shiftKey: boolean;
  } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [marquee, setMarquee] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    additive: boolean;
  } | null>(null);
  // 変形修飾キー: Alt=中心基準スケール, Shift=15°回転スナップ（Photoshop互換）
  const [altDown, setAltDown] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  // ピクセル選択: marquee ドラフト / lasso 多角形 / marching ants アニメ
  const [selDraft, setSelDraft] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    shift: boolean;
  } | null>(null);
  const [lassoPts, setLassoPts] = useState<number[]>([]);
  const [lassoCursor, setLassoCursor] = useState<{ x: number; y: number } | null>(null);
  const [antsOffset, setAntsOffset] = useState(0);
  // ラスターブラシ: キャンバス大の2バッファ（確定レイヤ用＝未使用時null / 現ストローク用）。
  // painting 中だけ strokeBuf を Konva.Image でオーバーレイ表示し、mouseup で対象 ImageLayer へ焼き込む。
  const strokeBufRef = useRef<HTMLCanvasElement | null>(null);
  const brushTargetRef = useRef<{ id: string; store: DocStore } | null>(null);
  const brushCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const brushCommitPendingRef = useRef(false);
  const paintingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const smoothedPtRef = useRef<{ x: number; y: number } | null>(null);
  const brushStrokeOriginRef = useRef<{ x: number; y: number } | null>(null);
  const brushStrokeBoundsRef = useRef<{
    x: number;
    y: number;
    right: number;
    bottom: number;
  } | null>(null);
  const lastStrokeEndRef = useRef<{ x: number; y: number } | null>(null);
  const pressureRef = useRef(1.0);
  const accumRef = useRef(0);
  const [painting, setPainting] = useState(false);
  const [cursorCanvas, setCursorCanvas] = useState<{ x: number; y: number } | null>(null);
  const [cursorVisible, setCursorVisible] = useState(false);
  const isEffectivelyLocked = createLayerLockChecker(layers);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      setWrapSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!viewport.autoFit || wrapSize.w === 0 || wrapSize.h === 0) return;
    const padding = 48;
    const w = wrapSize.w - padding * 2;
    const h = wrapSize.h - padding * 2;
    const s = Math.min(w / canvas.width, h / canvas.height, 1);
    const newScale = s > 0 ? s : 1;
    const newX = (wrapSize.w - canvas.width * newScale) / 2;
    const newY = (wrapSize.h - canvas.height * newScale) / 2;
    useEditorStore.setState((state) => {
      state.viewport.x = newX;
      state.viewport.y = newY;
      state.viewport.scale = newScale;
    });
  }, [canvas.width, canvas.height, wrapSize, viewport.autoFit]);

  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (!adjustmentSessionOpen && tool === 'move' && editingId === null && selectedIds.length > 0) {
      // 選択中の(グループ以外・非ロック)レイヤー全ノードに接続 → 複数同時変形
      const nodes = selectedIds
        .map((id) => layers.find((l) => l.id === id))
        .filter(
          (l): l is Layer => !!l && l.type !== 'group' && !isEffectivelyLocked(l.id),
        )
        .map((l) => stage.findOne(`#${l.id}`))
        .filter((n): n is Konva.Node => !!n);
      tr.nodes(nodes);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, selectedIds, layers, tool, editingId, adjustmentSessionOpen]);

  useEffect(() => {
    if (adjustmentSessionOpen) setCtxMenu(null);
  }, [adjustmentSessionOpen]);

  // Alt/Shift の押下状態を追跡（Transformer の中心スケール／回転スナップに使用）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(true);
      else if (e.key === 'Shift') setShiftDown(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltDown(false);
      else if (e.key === 'Shift') setShiftDown(false);
    };
    const clear = () => {
      setAltDown(false);
      setShiftDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);

  // ビューのズーム: Ctrl+1=100%, Ctrl+'+'=拡大, Ctrl+'-'=縮小（ビュー中心基準）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      let mode: '100' | 'in' | 'out' | null = null;
      if (e.key === '1') mode = '100';
      else if (e.key === '=' || e.key === '+') mode = 'in';
      else if (e.key === '-' || e.key === '_') mode = 'out';
      if (!mode) return;
      e.preventDefault();
      const el = wrapRef.current;
      if (!el) return;
      const vp = useEditorStore.getState().viewport;
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      let next =
        mode === '100' ? 1 : mode === 'in' ? vp.scale * 1.25 : vp.scale / 1.25;
      next = Math.max(0.05, Math.min(20, next));
      const pointTo = { x: (cx - vp.x) / vp.scale, y: (cy - vp.y) / vp.scale };
      setViewport({
        scale: next,
        x: cx - pointTo.x * next,
        y: cy - pointTo.y * next,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setViewport]);

  // メニュー / オプションバー / ステータスバーからのズーム要求（CustomEvent）
  useEffect(() => {
    const onZoom = (e: Event) => {
      const detail = (e as CustomEvent).detail as 'in' | 'out' | '100' | 'fit';
      if (detail === 'fit') {
        useEditorStore.getState().resetViewport();
        return;
      }
      const el = wrapRef.current;
      if (!el) return;
      const vp = useEditorStore.getState().viewport;
      const cx = el.clientWidth / 2;
      const cy = el.clientHeight / 2;
      let next =
        detail === '100' ? 1 : detail === 'in' ? vp.scale * 1.25 : vp.scale / 1.25;
      next = Math.max(0.05, Math.min(20, next));
      const pointTo = { x: (cx - vp.x) / vp.scale, y: (cy - vp.y) / vp.scale };
      setViewport({ scale: next, x: cx - pointTo.x * next, y: cy - pointTo.y * next });
    };
    window.addEventListener('layerlab:zoom', onZoom);
    return () => window.removeEventListener('layerlab:zoom', onZoom);
  }, [setViewport]);

  // marching ants: 選択/ドラフト中だけ dash オフセットを回す
  useEffect(() => {
    const active = selection || selDraft || lassoPts.length > 0;
    if (!active) return;
    const id = window.setInterval(() => {
      setAntsOffset((o) => (o + 1) % 8);
    }, 90);
    return () => window.clearInterval(id);
  }, [selection, selDraft, lassoPts.length]);

  const cursorByTool: Record<typeof tool, string> = {
    move: 'default',
    marquee: 'crosshair',
    lasso: 'crosshair',
    wand: 'crosshair',
    brush: 'none',
    text: 'text',
    shape: 'crosshair',
    crop: 'crosshair',
    eyedropper: 'crosshair',
    hand: 'grab',
    zoom: 'zoom-in',
  };

  const zoomAt = (
    anchorX: number,
    anchorY: number,
    currentScale: number,
    currentX: number,
    currentY: number,
    direction: -1 | 1,
    factor = 1.1,
  ) => {
    const mousePointTo = {
      x: (anchorX - currentX) / currentScale,
      y: (anchorY - currentY) / currentScale,
    };
    const newScale = direction > 0 ? currentScale * factor : currentScale / factor;
    const clamped = Math.max(0.05, Math.min(20, newScale));
    setViewport({
      scale: clamped,
      x: anchorX - mousePointTo.x * clamped,
      y: anchorY - mousePointTo.y * clamped,
    });
  };

  const handleStageWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    // オフセットは Stage ではなく親フレームの CSS translate(viewport.x/y) に入っているため、
    // handleWrapWheel と同じ「wrap基準のアンカー＋viewport.x/y」で計算しないとズームがドリフトする。
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const anchorX = e.evt.clientX - rect.left;
    const anchorY = e.evt.clientY - rect.top;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const factor = e.evt.ctrlKey ? 1.25 : 1.1;
    zoomAt(anchorX, anchorY, viewport.scale, viewport.x, viewport.y, direction, factor);
  };

  const handleWrapWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (stageRef.current && (e.target as HTMLElement).closest('.konvajs-content')) {
      return;
    }
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    const direction = e.deltaY > 0 ? -1 : 1;
    const factor = e.ctrlKey ? 1.25 : 1.1;
    zoomAt(anchorX, anchorY, viewport.scale, viewport.x, viewport.y, direction, factor);
  };

  const getCanvasPoint = (stage: Konva.Stage) => {
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const t = stage.getAbsoluteTransform().copy().invert();
    return t.point(pointer);
  };

  const finalizeLasso = (mode?: SelMode) => {
    setLassoPts((pts) => {
      if (pts.length >= 6) commitSelection({ type: 'poly', points: [...pts] }, mode);
      return [];
    });
    setLassoCursor(null);
  };

  // 筆圧追跡: ネイティブ PointerEvent から pressure を取得して ref に保持。
  // 仕様: pressure は 0-1、非対応デバイスは 1.0 にフォールバック。
  // ペンタブレット(pointerType === 'pen')のみ実 pressure を使い、
  // マウス/タッチ等は常に 1.0 にして、筆圧トグルON時に size/flow が半減しないようにする。
  useEffect(() => {
    const container = stageRef.current?.container();
    if (!container) return;
    const onPM = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && e.pressure > 0) {
        pressureRef.current = e.pressure;
      } else {
        pressureRef.current = 1.0;
      }
    };
    container.addEventListener('pointermove', onPM);
    container.addEventListener('pointerdown', onPM);
    return () => {
      container.removeEventListener('pointermove', onPM);
      container.removeEventListener('pointerdown', onPM);
    };
  });

  const brushParams = (pressure: number = 1.0): BrushParams => {
    const p = pressure > 0 ? pressure : 1.0;
    return {
      size: brushPressureSize ? Math.max(1, brushSize * p) : brushSize,
      hardness: brushHardness,
      opacity: brushOpacity,
      flow: brushPressureOpacity ? Math.max(1, brushFlow * p) : brushFlow,
      color: foregroundColor,
      spacing: brushSpacingPct,
      roundness: brushRoundness,
      angle: brushAngle,
      sizeJitter: brushSizeJitter,
      scatter: brushScatter,
      flowJitter: brushFlowJitter,
    };
  };

  const includeBrushSegment = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    params: BrushParams,
    replace = false,
  ) => {
    const spread = params.size * (0.5 + params.scatter / 200) + 2;
    const next = {
      x: Math.max(0, Math.floor(Math.min(from.x, to.x) - spread)),
      y: Math.max(0, Math.floor(Math.min(from.y, to.y) - spread)),
      right: Math.min(canvas.width, Math.ceil(Math.max(from.x, to.x) + spread)),
      bottom: Math.min(canvas.height, Math.ceil(Math.max(from.y, to.y) + spread)),
    };
    const current = replace ? null : brushStrokeBoundsRef.current;
    brushStrokeBoundsRef.current = current
      ? {
          x: Math.min(current.x, next.x),
          y: Math.min(current.y, next.y),
          right: Math.max(current.right, next.right),
          bottom: Math.max(current.bottom, next.bottom),
        }
      : next;
  };

  // 現ストローク用バッファをキャンバス寸法で用意し、クリアして返す。
  const ensureStrokeBuf = (w: number, h: number): HTMLCanvasElement => {
    let c = strokeBufRef.current;
    if (!c) {
      c = document.createElement('canvas');
      strokeBufRef.current = c;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.getContext('2d')!.clearRect(0, 0, w, h);
    return c;
  };

  const beginBrushStroke = (pt: { x: number; y: number }, shiftKey = false) => {
    const w = canvas.width;
    const h = canvas.height;
    if (!isSafeBrushCanvas(w, h)) {
      toast(t({
        ja: 'メモリ保護のためブラシは4096×4096px以下のカンバスで使用できます',
        en: 'For memory safety, the brush is available on canvases up to 4096×4096 px',
      }), { kind: 'error' });
      return;
    }
    if (brushCommitPendingRef.current) {
      toast(t({
        ja: '前のストロークを確定しています。少し待ってから描いてください',
        en: 'The previous stroke is being committed. Please wait a moment.',
      }), { kind: 'info' });
      return;
    }
    const buf = ensureStrokeBuf(w, h);
    const ctx2d = buf.getContext('2d')!;
    const targetStore = getActiveStore();
    const st = targetStore.getState();
    const sel = st.layers.find((l) => l.id === st.selectedId);
    const paintLayer = sel && createLayerLockChecker(st.layers)(sel.id)
      ? ({ ...sel, locked: true } as Layer)
      : sel;
    if (isPaintTarget(paintLayer, w, h)) {
      brushTargetRef.current = { id: paintLayer.id, store: targetStore };
      // The visible stroke exists before PNG encoding finishes.  Mark dirty
      // now so Alt+F4/Ctrl+W can never silently discard the queued pixels.
      targetStore.setState({ dirty: true });
    } else {
      // 透明なキャンバス大の新規ペイントレイヤーを作って前面へ
      const blank = document.createElement('canvas');
      blank.width = w;
      blank.height = h;
      const layer = createImageLayer(blank.toDataURL('image/png'), w, h);
      layer.name = brushEraser ? t({ ja: '消しゴム', en: 'Eraser' }) : t({ ja: 'ペイント', en: 'Paint' });
      if (!st.addLayer(layer)) return;
      brushTargetRef.current = { id: layer.id, store: targetStore };
    }
    paintingRef.current = true;
    setPainting(true);
    registerPendingSyncEdit(targetStore, 'brush-active', {
      flush: () => commitBrushStroke(),
      discard: () => {
        paintingRef.current = false;
        setPainting(false);
        brushTargetRef.current = null;
        brushStrokeBoundsRef.current = null;
      },
    });
    const straightOrigin =
      shiftKey && lastStrokeEndRef.current ? lastStrokeEndRef.current : pt;
    brushStrokeOriginRef.current = straightOrigin;
    smoothedPtRef.current = pt;
    lastPtRef.current = pt;
    accumRef.current = brushSpacing(brushSize, brushSpacingPct);
    const p = pressureRef.current;
    const params = brushParams(p);
    // Shift+クリック: 前回ストローク終点から現在点まで直線を引く
    if (shiftKey && lastStrokeEndRef.current) {
      const from = lastStrokeEndRef.current;
      includeBrushSegment(from, pt, params, true);
      strokeSegment(ctx2d, from.x, from.y, pt.x, pt.y, params, 0);
    } else {
      includeBrushSegment(pt, pt, params, true);
      stampBrush(ctx2d, pt.x, pt.y, params);
    }
    stageRef.current?.batchDraw();
  };

  const commitBrushStroke = () => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    setPainting(false);
    // 次回 Shift+クリック用にストローク終点を保存
    lastStrokeEndRef.current = lastPtRef.current;
    brushStrokeOriginRef.current = null;
    lastPtRef.current = null;
    const target = brushTargetRef.current;
    const buf = strokeBufRef.current;
    brushTargetRef.current = null;
    if (!target || !buf) return;
    clearPendingSyncEdit(target.store, 'brush-active');
    const w = buf.width;
    const h = buf.height;
    const bounds = brushStrokeBoundsRef.current;
    brushStrokeBoundsRef.current = null;
    if (!bounds || bounds.right <= bounds.x || bounds.bottom <= bounds.y) return;
    const opacity = Math.max(0, Math.min(1, brushOpacity / 100));
    const isEraser = brushEraser;
    // The live stroke buffer is cleared for the next stroke, so snapshot it
    // synchronously before entering the async image-decode queue.
    const stroke = document.createElement('canvas');
    stroke.width = bounds.right - bounds.x;
    stroke.height = bounds.bottom - bounds.y;
    stroke.getContext('2d')!.drawImage(
      buf,
      bounds.x,
      bounds.y,
      stroke.width,
      stroke.height,
      0,
      0,
      stroke.width,
      stroke.height,
    );

    const applyQueuedStroke = async () => {
      // Re-read the latest src after earlier queued strokes. If another edit
      // lands while decoding, retry instead of overwriting it with stale pixels.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const layer = target.store.getState().layers.find((candidate) => candidate.id === target.id);
        const stateBeforeDecode = target.store.getState();
        if (!layer || createLayerLockChecker(stateBeforeDecode.layers)(layer.id)) return;
        if (!isPaintTarget(layer, w, h)) return;
        const baseSrc = layer.src;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const octx = out.getContext('2d')!;
        if (baseSrc) {
          await new Promise<void>((resolve, reject) => {
            const image = new window.Image();
            image.onload = () => {
              octx.drawImage(image, 0, 0, w, h);
              resolve();
            };
            image.onerror = () => reject(new Error('Could not decode the paint target image'));
            image.src = baseSrc;
          });
        }
        const latest = target.store.getState().layers.find((candidate) => candidate.id === target.id);
        if (!latest || latest.type !== 'image' || latest.src !== baseSrc) continue;
        if (isEraser) octx.globalCompositeOperation = 'destination-out';
        octx.globalAlpha = opacity;
        octx.drawImage(stroke, bounds.x, bounds.y);
        octx.globalAlpha = 1;
        octx.globalCompositeOperation = 'source-over';
        target.store.getState().updateLayer(target.id, { src: out.toDataURL('image/png') });
        return;
      }
    };

    brushCommitPendingRef.current = true;
    const nextCommit = brushCommitQueueRef.current.then(applyQueuedStroke);
    brushCommitQueueRef.current = trackPendingAsyncEdit(target.store, nextCommit)
      .catch((error) => {
        console.error('[brush commit]', error);
        toast(t({
          ja: `ストロークを確定できませんでした: ${error instanceof Error ? error.message : String(error)}`,
          en: `Could not commit the stroke: ${error instanceof Error ? error.message : String(error)}`,
        }), { kind: 'error' });
      })
      .finally(() => {
        brushCommitPendingRef.current = false;
      });
  };

  // ブラシ中にツールを離れたら描きかけストロークを確定
  useEffect(() => {
    if (tool !== 'brush' && paintingRef.current) commitBrushStroke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // ツールを離れたら作りかけの選択ドラフトを破棄
  useEffect(() => {
    if (tool !== 'lasso') {
      setLassoPts([]);
      setLassoCursor(null);
    }
    if (tool !== 'marquee') setSelDraft(null);
  }, [tool]);

  // lasso 中の Enter で確定
  useEffect(() => {
    if (adjustmentSessionOpen || tool !== 'lasso' || lassoPts.length < 6) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finalizeLasso();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, lassoPts, adjustmentSessionOpen]);

  const sampleCanvasColor = (
    stage: Konva.Stage,
    pt: { x: number; y: number },
    toBackground = false,
  ) => {
    const pixel = stage.toCanvas({
      x: pt.x,
      y: pt.y,
      width: 1,
      height: 1,
      pixelRatio: 1,
    });
    const data = pixel.getContext('2d')?.getImageData(0, 0, 1, 1).data;
    if (!data) return;
    const hex =
      '#' +
      [data[0], data[1], data[2]]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
    if (toBackground) setBackgroundColor(hex);
    else setForegroundColor(hex);
  };

  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    // An adjustment dialog is a transaction.  Keep canvas navigation and
    // sampling available, but never let the preview mutate the document.
    if (adjustmentSessionOpen && tool !== 'hand' && tool !== 'zoom' && tool !== 'eyedropper') return;
    const onEmpty = e.target === stage;
    const targetId = e.target.id?.();
    const targetLayer = targetId ? layers.find((l) => l.id === targetId) : null;

    if (tool === 'move') {
      // Drag on empty canvas = marquee (rubber-band) range selection.
      // Mousedown on a layer falls through to Konva's own drag (move).
      if (onEmpty) {
        const pt = getCanvasPoint(stage);
        if (pt) setMarquee({ start: pt, current: pt, additive: e.evt.shiftKey });
      }
      return;
    }

    if (tool === 'text') {
      // クリック先が既存テキスト → そのテキストを編集
      if (targetLayer?.type === 'text') {
        selectLayer(targetLayer.id);
        setTool('move');
        editingStoreRef.current = getActiveStore();
        setEditingId(targetLayer.id);
        setEditingFromCreate(false);
        return;
      }
      // それ以外（空カンバス／画像・図形などの上）→ クリック位置に新規テキスト。
      // onEmpty で門前払いしない：画像を敷くと onEmpty=false になり、
      // 従来はテキストを一切追加できなかった（shape ツールと同じ修正）。
      const pt = getCanvasPoint(stage);
      if (pt) {
        const newLayer = createTextLayer(
          t({ ja: 'テキスト', en: 'Text' }),
          DEFAULT_TEXT_FONT,
          64,
          pt.x,
          pt.y,
          foregroundColor,
        );
        addLayer(newLayer);
        setTool('move');
        editingStoreRef.current = getActiveStore();
        setEditingId(newLayer.id);
        setEditingFromCreate(true);
      }
      return;
    }

    if (tool === 'shape') {
      // Shape tool draws regardless of what's underneath (Photoshop behavior).
      // Do NOT gate on onEmpty — that blocked drawing a box over an existing
      // layer (e.g. a □ frame over the product image on a thumbnail).
      const pt = getCanvasPoint(stage);
      if (pt) {
        setShapeDraft({ start: pt, current: pt, shiftKey: e.evt.shiftKey });
      }
      return;
    }

    if (tool === 'marquee') {
      const pt = getCanvasPoint(stage);
      if (pt) setSelDraft({ start: pt, current: pt, shift: e.evt.shiftKey });
      return;
    }

    if (tool === 'wand') {
      const pt = getCanvasPoint(stage);
      if (!pt) return;
      const st = useEditorStore.getState();
      const opts: WandOptions = {
        tolerance: st.wandTolerance,
        contiguous: wandContiguous,
        antiAlias: wandAntiAlias,
        sampleMerged: wandSampleMerged,
      };
      // Get just the wand hit without combining — commitSelection handles mode
      const wandHit = magicWandSelect(pt.x, pt.y, opts, null, 'replace');
      commitSelection(wandHit, keyMode(e.evt));
      return;
    }

    if (tool === 'brush') {
      const pt = getCanvasPoint(stage);
      if (pt && e.evt.altKey) sampleCanvasColor(stage, pt);
      else if (pt) beginBrushStroke(pt, e.evt.shiftKey);
      return;
    }

    if (tool === 'lasso') {
      const pt = getCanvasPoint(stage);
      if (!pt) return;
      // 始点近くをクリック(3点以上)で閉じる
      if (lassoPts.length >= 6) {
        const dx = pt.x - lassoPts[0];
        const dy = pt.y - lassoPts[1];
        if (Math.hypot(dx, dy) < 8 / viewport.scale) {
          finalizeLasso(keyMode(e.evt));
          return;
        }
      }
      setLassoPts((p) => [...p, pt.x, pt.y]);
      return;
    }

    if (tool === 'eyedropper') {
      const pt = getCanvasPoint(stage);
      if (!pt) return;
      // Alt+クリックで背景色を取得（Photoshop互換）
      sampleCanvasColor(stage, pt, e.evt.altKey);
      return;
    }

    if (tool === 'zoom') {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const oldScale = stage.scaleX();
      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };
      const isOut = e.evt.altKey;
      const factor = 2;
      const newScale = isOut ? oldScale / factor : oldScale * factor;
      const clamped = Math.max(0.05, Math.min(20, newScale));
      setViewport({
        scale: clamped,
        x: pointer.x - mousePointTo.x * clamped,
        y: pointer.y - mousePointTo.y * clamped,
      });
      return;
    }
  };

  const selectCanvasLayer = (
    id: string,
    e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    if (!moveActive) return;
    const evt = e?.evt;
    const additive = evt instanceof MouseEvent && evt.shiftKey;
    const subtractive = evt instanceof MouseEvent && (evt.ctrlKey || evt.metaKey);
    if (additive) {
      if (!selectedIds.includes(id)) selectMany([...selectedIds, id]);
    } else if (subtractive) {
      toggleSelect(id);
    } else if (
      !shouldPreserveMultiSelection(selectedIds, id, {
        shift: additive,
        ctrl: evt instanceof MouseEvent && evt.ctrlKey,
        meta: evt instanceof MouseEvent && evt.metaKey,
      })
    ) {
      selectLayer(id);
    }
  };

  const handleStageDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (!node || node === stageRef.current) return;
    const id = (node as Konva.Node).id?.();
    if (!id) return;
    const dragIds = selectedIds.includes(id) ? selectedIds : [id];
    const starts = new Map<string, LayerMoveStart>();
    for (const sid of dragIds) {
      const layer = layers.find((candidate) => candidate.id === sid);
      if (!layer || isEffectivelyLocked(layer.id) || layer.type === 'group') continue;
      starts.set(sid, {
        layer: { x: layer.x, y: layer.y },
        node: layerNodePosition(layer),
      });
    }
    if (!starts.has(id)) return;
    const batch = starts.size > 1;
    const duplicate = e.evt.altKey;
    layerDragRef.current = {
      anchorId: id,
      anchorStart: { x: node.x(), y: node.y() },
      starts,
      batch,
      duplicate,
      customCommit: batch || duplicate,
    };
    layerDragEndSuppressRef.current = batch || duplicate
      ? new Set(starts.keys())
      : new Set();
  };

  const handleStageDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    if (!node || node === stageRef.current) return;
    const id = (node as Konva.Node).id?.();
    if (!id) return;
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;

    // 複数選択ドラッグ: アンカーの移動量を他レイヤーにも反映（スナップは無効）
    const drag = layerDragRef.current;
    if (
      drag &&
      id === drag.anchorId &&
      (drag.batch || drag.duplicate || e.evt.shiftKey)
    ) {
      const rawDx = node.x() - drag.anchorStart.x;
      const rawDy = node.y() - drag.anchorStart.y;
      const delta = constrainDragDelta(rawDx, rawDy, e.evt.shiftKey);
      const dx = delta.x;
      const dy = delta.y;
      if (e.evt.shiftKey) {
        drag.customCommit = true;
        layerDragEndSuppressRef.current = new Set(drag.starts.keys());
        node.position({ x: drag.anchorStart.x + dx, y: drag.anchorStart.y + dy });
      }
      const stage = stageRef.current;
      for (const [sid, start] of drag.starts) {
        if (sid === drag.anchorId) continue;
        const sn = stage?.findOne(`#${sid}`);
        if (!sn) continue;
        sn.position({ x: start.node.x + dx, y: start.node.y + dy });
      }
      stage?.find('.ll-clip-group').forEach((group) => {
        const baseId = group.getAttr('clipBaseId') as string | undefined;
        if (!baseId || !drag.starts.has(baseId)) return;
        const clipStartX = Number(group.getAttr('clipStartX'));
        const clipStartY = Number(group.getAttr('clipStartY'));
        const clipGroup = group as Konva.Group;
        clipGroup.clipX(clipStartX + dx);
        clipGroup.clipY(clipStartY + dy);
      });
      setSnapGuides([]);
      return;
    }

    // Ctrl 押下中はスナップを一時無効（Photoshop互換）
    if (e.evt.ctrlKey || e.evt.metaKey) {
      setSnapGuides([]);
      return;
    }

    const bounds = getLayerBounds(layer);

    let curX = node.x();
    let curY = node.y();
    const isCenteredShape =
      layer.type === 'shape' &&
      ((layer as ShapeLayer).shape === 'rect' || (layer as ShapeLayer).shape === 'ellipse');
    if (isCenteredShape) {
      const sh = layer as ShapeLayer;
      curX -= sh.shapeWidth / 2;
      curY -= sh.shapeHeight / 2;
    }

    const targets = collectSnapTargets(layers, id, canvas, userGuides);
    const threshold = 6 / viewport.scale;
    const result = snapBox(
      { x: curX, y: curY, width: bounds.width, height: bounds.height },
      targets,
      threshold,
    );

    if (result.guides.length > 0) {
      let newX = result.x;
      let newY = result.y;
      if (isCenteredShape) {
        const sh = layer as ShapeLayer;
        newX += sh.shapeWidth / 2;
        newY += sh.shapeHeight / 2;
      }
      node.position({ x: newX, y: newY });
    }
    setSnapGuides(result.guides);
  };

  const handleStageDragEnd = () => {
    const drag = layerDragRef.current;
    if (drag && drag.customCommit) {
      const anchorNode = stageRef.current?.findOne(`#${drag.anchorId}`);
      if (anchorNode) {
        const dx = anchorNode.x() - drag.anchorStart.x;
        const dy = anchorNode.y() - drag.anchorStart.y;
        if (drag.duplicate) {
          for (const [id, start] of drag.starts) {
            stageRef.current?.findOne(`#${id}`)?.position(start.node);
          }
          duplicateLayers([...drag.starts.keys()], { x: dx, y: dy });
        } else {
          updateLayerPositions(translatedLayerPositions(drag.starts, dx, dy));
        }
      }
      requestAnimationFrame(() => layerDragEndSuppressRef.current.clear());
    } else {
      layerDragEndSuppressRef.current.clear();
    }
    layerDragRef.current = null;
    setSnapGuides([]);
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;
    const pt = getCanvasPoint(stage);
    // ブラシカーソルアウトライン追跡
    if (tool === 'brush' && pt) {
      setCursorCanvas(pt);
    }
    if (paintingRef.current && tool === 'brush') {
      const buf = strokeBufRef.current;
      const last = lastPtRef.current;
      if (pt && buf && last) {
        const mode = brushStrokeMode({ shift: e.evt.shiftKey });
        if (mode === 'straight') {
          const origin = brushStrokeOriginRef.current ?? last;
          const ctx = buf.getContext('2d')!;
          ctx.clearRect(0, 0, buf.width, buf.height);
          const params = brushParams(pressureRef.current);
          includeBrushSegment(origin, pt, params, true);
          accumRef.current = strokeSegment(
            ctx,
            origin.x,
            origin.y,
            pt.x,
            pt.y,
            params,
            0,
          );
          smoothedPtRef.current = pt;
          lastPtRef.current = pt;
          stageRef.current?.batchDraw();
          return;
        }
        // スムージング: 指数移動平均で手ぶれ補正
        const alpha = brushSmoothing > 0 ? 1 - brushSmoothing / 100 : 1;
        const prev = smoothedPtRef.current ?? pt;
        const smoothed = {
          x: alpha * pt.x + (1 - alpha) * prev.x,
          y: alpha * pt.y + (1 - alpha) * prev.y,
        };
        smoothedPtRef.current = smoothed;
        const p = pressureRef.current;
        const params = brushParams(p);
        includeBrushSegment(last, smoothed, params);
        accumRef.current = strokeSegment(
          buf.getContext('2d')!,
          last.x,
          last.y,
          smoothed.x,
          smoothed.y,
          params,
          accumRef.current,
        );
        lastPtRef.current = smoothed;
        stageRef.current?.batchDraw();
      }
      return;
    }
    if (marquee) {
      if (pt) setMarquee({ ...marquee, current: pt });
      return;
    }
    if (selDraft) {
      if (pt) setSelDraft({ ...selDraft, current: pt, shift: e.evt.shiftKey });
      return;
    }
    if (tool === 'lasso' && lassoPts.length > 0) {
      if (pt) setLassoCursor(pt);
      return;
    }
    if (!shapeDraft) return;
    if (!pt) return;
    setShapeDraft({ ...shapeDraft, current: pt, shiftKey: e.evt.shiftKey });
  };

  const handleStageMouseUp = (fromLeave = false) => {
    if (paintingRef.current) {
      commitBrushStroke();
      return;
    }
    if (selDraft) {
      const { start, current, shift } = selDraft;
      setSelDraft(null);
      let cx = current.x;
      let cy = current.y;
      if (shift) {
        const sz = Math.max(Math.abs(cx - start.x), Math.abs(cy - start.y));
        cx = start.x + Math.sign(cx - start.x || 1) * sz;
        cy = start.y + Math.sign(cy - start.y || 1) * sz;
      }
      const x0 = Math.min(start.x, cx);
      const y0 = Math.min(start.y, cy);
      const w = Math.abs(cx - start.x);
      const h = Math.abs(cy - start.y);
      if (w < 3 || h < 3) {
        commitSelection(null, 'replace'); // ほぼクリック = 選択解除
        return;
      }
      commitSelection(
        {
          type: marqueeKind === 'ellipse' ? 'ellipse' : 'rect',
          x: x0,
          y: y0,
          width: w,
          height: h,
        },
        fromLeave ? undefined : keyMode(lastMouseEvtRef.current)
      );
      return;
    }
    if (marquee) {
      const { start, current, additive } = marquee;
      setMarquee(null);
      const x0 = Math.min(start.x, current.x);
      const y0 = Math.min(start.y, current.y);
      const x1 = Math.max(start.x, current.x);
      const y1 = Math.max(start.y, current.y);
      const moved = Math.hypot(current.x - start.x, current.y - start.y);
      if (moved < 4) {
        // tiny drag = plain click on empty canvas
        if (!additive) selectLayer(null);
        return;
      }
      const hits = layers
        .filter((l) => l.type !== 'group' && l.visible && !isEffectivelyLocked(l.id))
        .filter((l) => {
          const b = getLayerBounds(l);
          // intersect test: a layer touching the marquee counts as selected
          return b.x < x1 && b.x + b.width > x0 && b.y < y1 && b.y + b.height > y0;
        })
        .map((l) => l.id);
      const finalIds = additive
        ? Array.from(new Set([...selectedIds, ...hits]))
        : hits;
      selectMany(finalIds);
      return;
    }
    if (!shapeDraft) return;
    const { start, current, shiftKey } = shapeDraft;
    const constrained = constrainShapeEndpoint(shapeKind, start, current, {
      shift: shiftKey,
    });
    const dx = constrained.x - start.x;
    const dy = constrained.y - start.y;
    const w = Math.abs(dx);
    const h = Math.abs(dy);
    if (shapeKind === 'line') {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        setShapeDraft(null);
        return;
      }
      const layer = createShapeLayer('line', start.x, start.y, dx, dy, foregroundColor);
      layer.strokeColor = foregroundColor;
      addLayer(layer);
    } else {
      if (w < 3 || h < 3) {
        setShapeDraft(null);
        return;
      }
      const x = dx < 0 ? start.x + dx : start.x;
      const y = dy < 0 ? start.y + dy : start.y;
      const layer = createShapeLayer(shapeKind, x, y, w, h, foregroundColor);
      addLayer(layer);
    }
    setShapeDraft(null);
    setTool('move');
  };

  const handleContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault();
    if (adjustmentSessionOpen) {
      setCtxMenu(null);
      return;
    }
    const stage = e.target.getStage();
    if (!stage) return;
    const pt = getCanvasPoint(stage);
    const st = useEditorStore.getState();
    const get = () => useEditorStore.getState();

    // クリック点を含む(グループ以外・表示中)レイヤー = layers 配列順(先頭=最前面)
    const candidates = pt
      ? st.layers.filter((l) => {
          if (l.type === 'group' || !l.visible) return false;
          const b = getLayerBounds(l);
          return pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
        })
      : [];

    // クリックしたレイヤーが未選択なら最前面を選択
    let targetId = st.selectedId;
    if (candidates.length > 0 && !st.selectedIds.includes(candidates[0].id)) {
      st.selectLayer(candidates[0].id);
      targetId = candidates[0].id;
    }

    const items: CtxItem[] = [];
    if (candidates.length > 0 || targetId) {
      const tid = targetId!;
      items.push({ label: t({ ja: '複製', en: 'Duplicate' }), shortcut: 'Ctrl+J', onClick: () => duplicateSelectedLayers(tid) });
      if (candidates.length > 1) {
        items.push({
          label: t({ ja: 'ここにあるレイヤー', en: 'Layers here' }),
          children: candidates.map((c) => ({
            label: `${c.name}`,
            onClick: () => get().selectLayer(c.id),
          })),
        });
      }
      items.push({ sep: true });
      items.push({ label: t({ ja: '最前面へ', en: 'Bring to Front' }), onClick: () => get().moveLayerEnd(tid, 'front') });
      items.push({ label: t({ ja: '前面へ', en: 'Bring Forward' }), shortcut: 'Ctrl+]', onClick: () => get().moveLayer(tid, 'up') });
      items.push({ label: t({ ja: '背面へ', en: 'Send Backward' }), shortcut: 'Ctrl+[', onClick: () => get().moveLayer(tid, 'down') });
      items.push({ label: t({ ja: '最背面へ', en: 'Send to Back' }), onClick: () => get().moveLayerEnd(tid, 'back') });
      items.push({ sep: true });
      items.push({ label: t({ ja: 'グループ化', en: 'Group' }), shortcut: 'Ctrl+G', onClick: () => get().groupSelected() });
      items.push({
        label: t({ ja: 'クリッピングマスク作成/解除', en: 'Create/Release Clipping Mask' }),
        shortcut: 'Ctrl+Alt+G',
        onClick: () => get().toggleClipped(tid),
      });
      items.push({ sep: true });
      items.push({
        label: t({ ja: 'レイヤーを削除', en: 'Delete Layer' }),
        shortcut: 'Del',
        danger: true,
        onClick: () => deleteSelectedLayers(tid),
      });
    } else {
      items.push({ label: t({ ja: 'ペースト', en: 'Paste' }), shortcut: 'Ctrl+V', onClick: () => pasteFromClipboard() });
      items.push({ sep: true });
      items.push({
        label: t({ ja: 'すべてのレイヤーを選択', en: 'Select All Layers' }),
        onClick: () => {
          const s = get();
          s.selectMany(s.layers.filter((l) => l.type !== 'group').map((l) => l.id));
        },
      });
    }
    setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, items });
  };

  const layerById = new Map(layers.map((l) => [l.id, l]));
  const ancestorHidden = (l: Layer): boolean => {
    let pid = l.parentId ?? null;
    const visited = new Set<string>();
    while (pid && !visited.has(pid)) {
      visited.add(pid);
      const parent = layerById.get(pid);
      if (!parent) break;
      if (!parent.visible) return true;
      pid = parent.parentId ?? null;
    }
    return false;
  };
  const effectiveOpacity = (l: Layer): number => {
    let op = l.opacity;
    let pid = l.parentId ?? null;
    const visited = new Set<string>();
    while (pid && !visited.has(pid)) {
      visited.add(pid);
      const parent = layerById.get(pid);
      if (!parent) break;
      op *= parent.opacity;
      pid = parent.parentId ?? null;
    }
    return op;
  };
  const renderOrder = [...layers]
    .reverse()
    .filter((l) => l.type !== 'group' && !ancestorHidden(l));
  const moveActive = tool === 'move' && !adjustmentSessionOpen;
  const handActive = tool === 'hand';
  const editingLayer =
    editingId && layers.find((l) => l.id === editingId && l.type === 'text');
  const selectedForInfo =
    selectedIds.length <= 1 && selectedId
      ? layers.find((l) => l.id === selectedId)
      : null;
  const selInfoBounds = selectedForInfo ? getLayerBounds(selectedForInfo) : null;

  const handleWorkspaceMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (adjustmentSessionOpen) return;
    const target = e.target instanceof Element ? e.target : null;
    const pointerContext = {
      button: e.button,
      target: e.target,
      currentTarget: e.currentTarget,
      tool,
      shiftKey: e.shiftKey,
      insideCanvas: target?.closest('.canvas-frame') !== null,
    };

    if (shouldClearPixelSelection(pointerContext)) {
      if (selection) setSelection(null);
      setSelDraft(null);
      setLassoPts([]);
      setLassoCursor(null);
      setCtxMenu(null);
    }

    if (shouldClearLayerSelection(pointerContext)) {
      clearLayerSelection();
      if (editingStoreRef.current) flushPendingSyncEdits(editingStoreRef.current);
      setEditingId(null);
      setCtxMenu(null);
    }
  };

  const handleStageMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (adjustmentSessionOpen) return;
    if (tool === 'brush') setCursorVisible(true);
    if (
      !shouldStartMarqueeOnCanvasEnter({
        tool,
        hasDraft: selDraft !== null,
        buttons: e.evt.buttons,
        shiftKey: e.evt.shiftKey,
      })
    ) {
      return;
    }

    const stage = e.target.getStage();
    if (!stage) return;
    const rawPoint = getCanvasPoint(stage);
    if (!rawPoint) return;
    const start = clampPointToCanvas(rawPoint, canvas.width, canvas.height);
    setSelDraft({ start, current: start, shift: true });
  };

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      style={{ cursor: cursorByTool[tool] }}
      onWheel={handleWrapWheel}
      onMouseDown={handleWorkspaceMouseDown}
    >
      <Ruler orientation="h" wrapSize={wrapSize} />
      <Ruler orientation="v" wrapSize={wrapSize} />
      {/* ③ 市松模様背景: canvas-frame の CSS background として描画。
           KonvaのStageはtransparent canvas なので透過部分にのみ見え、
           stage.toDataURL() による書き出しには一切含まれない。 */}
      <div
        className="canvas-frame"
        style={{
          width: canvas.width * viewport.scale,
          height: canvas.height * viewport.scale,
          transform: `translate(${viewport.x}px, ${viewport.y}px)`,
          left: 0,
          top: 0,
          backgroundColor: '#3a3a3a',
          backgroundImage:
            'linear-gradient(45deg,#2b2b2b 25%,transparent 25%,transparent 75%,#2b2b2b 75%),' +
            'linear-gradient(45deg,#2b2b2b 25%,transparent 25%,transparent 75%,#2b2b2b 75%)',
          backgroundSize: '16px 16px',
          backgroundPosition: '0 0, 8px 8px',
        }}
      >
        <Stage
          ref={stageRef}
          width={canvas.width * viewport.scale}
          height={canvas.height * viewport.scale}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          draggable={handActive}
          onDragStart={handleStageDragStart}
          onDragMove={handleStageDragMove}
          onDragEnd={(e) => {
            if (handActive) {
              setViewport({ x: viewport.x + e.target.x(), y: viewport.y + e.target.y() });
              e.target.position({ x: 0, y: 0 });
            }
            handleStageDragEnd();
          }}
          onWheel={handleStageWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={(e) => { lastMouseEvtRef.current = e.evt; handleStageMouseUp(); }}
          onMouseLeave={() => { setCursorVisible(false); setCursorCanvas(null); handleStageMouseUp(true); }}
          onMouseEnter={handleStageMouseEnter}
          onContextMenu={handleContextMenu}
          onDblClick={() => {
            if (!adjustmentSessionOpen && tool === 'lasso') finalizeLasso();
          }}
        >
          <KonvaLayer>
            <Rect
              name="ll-bg"
              x={0}
              y={0}
              width={canvas.width}
              height={canvas.height}
              fill={
                canvas.background === 'transparent' ? undefined : canvas.background
              }
              listening={false}
            />
            {(() => {
              const renderNode = (rawLayer: Layer) => {
                const layer = {
                  ...rawLayer,
                  opacity: effectiveOpacity(rawLayer),
                  locked: isEffectivelyLocked(rawLayer.id),
                } as Layer;
                const applyChange = (patch: Partial<Layer>) => {
                  const activeLayerDrag = layerDragRef.current;
                  if (
                    ((activeLayerDrag?.customCommit && activeLayerDrag.starts.has(layer.id)) ||
                      layerDragEndSuppressRef.current.has(layer.id)) &&
                    ('x' in patch || 'y' in patch)
                  ) {
                    return;
                  }
                  updateLayer(layer.id, patch);
                };
                if (layer.type === 'image') {
                  return (
                    <ImageNode
                      key={layer.id}
                      layer={layer}
                      draggable={moveActive && !layer.locked}
                      previewAdjustments={adjustmentPreview?.layerId === layer.id ? adjustmentPreview.adjustments : undefined}
                      previewSelection={adjustmentPreview?.layerId === layer.id ? adjustmentPreview.selection : undefined}
                      canvasSize={canvas}
                      onSelect={(e) => {
                        if (!adjustmentSessionOpen) selectCanvasLayer(layer.id, e);
                      }}
                      onChange={(patch) => applyChange(patch)}
                    />
                  );
                }
                if (layer.type === 'text') {
                  return (
                    <TextNode
                      key={layer.id}
                      layer={layer}
                      hidden={layer.id === editingId}
                      draggable={moveActive && !layer.locked}
                      onSelect={(e) => {
                        if (!adjustmentSessionOpen) selectCanvasLayer(layer.id, e);
                      }}
                      onEdit={() => {
                        if (adjustmentSessionOpen) return;
                        selectLayer(layer.id);
                        setTool('move');
                        editingStoreRef.current = getActiveStore();
                        setEditingId(layer.id);
                        setEditingFromCreate(false);
                      }}
                      onChange={(patch) => applyChange(patch)}
                    />
                  );
                }
                if (layer.type === 'shape') {
                  return (
                    <ShapeNode
                      key={layer.id}
                      layer={layer}
                      draggable={moveActive && !layer.locked}
                      onSelect={(e) => {
                        if (!adjustmentSessionOpen) selectCanvasLayer(layer.id, e);
                      }}
                      onChange={(patch) => applyChange(patch)}
                    />
                  );
                }
                return null;
              };

              type ClipGroup = { base: Layer; clipped: Layer[] };
              const groups: ClipGroup[] = [];
              let cur: ClipGroup | null = null;
              for (const l of renderOrder) {
                if (l.clipped && cur) {
                  cur.clipped.push(l);
                } else {
                  if (cur) groups.push(cur);
                  cur = { base: l, clipped: [] };
                }
              }
              if (cur) groups.push(cur);

              return groups.map((g) => {
                if (g.clipped.length === 0) return renderNode(g.base);
                const b = getLayerBounds(g.base);
                return (
                  <KonvaGroup
                    key={`clip-${g.base.id}`}
                    name="ll-clip-group"
                    clipBaseId={g.base.id}
                    clipStartX={b.x}
                    clipStartY={b.y}
                    clipX={b.x}
                    clipY={b.y}
                    clipWidth={b.width}
                    clipHeight={b.height}
                  >
                    {renderNode(g.base)}
                    {g.clipped.map(renderNode)}
                  </KonvaGroup>
                );
              });
            })()}
            <KonvaGroup name="ll-transient-overlay">
              {painting && strokeBufRef.current && (
                <KonvaImage
                  image={strokeBufRef.current}
                  x={0}
                  y={0}
                  width={canvas.width}
                  height={canvas.height}
                  opacity={Math.max(0, Math.min(1, brushOpacity / 100))}
                  listening={false}
                />
              )}
              {/* ブラシカーソルアウトライン（Photoshop風） */}
              {tool === 'brush' && cursorVisible && cursorCanvas && (
                <>
                  <Ellipse
                    x={cursorCanvas.x}
                    y={cursorCanvas.y}
                    radiusX={Math.max(0.5, brushSize / 2)}
                    radiusY={Math.max(0.5, (brushSize / 2) * (brushRoundness / 100))}
                    rotation={brushAngle}
                    stroke="black"
                    strokeWidth={1.5 / viewport.scale}
                    listening={false}
                  />
                  <Ellipse
                    x={cursorCanvas.x}
                    y={cursorCanvas.y}
                    radiusX={Math.max(0.5, brushSize / 2)}
                    radiusY={Math.max(0.5, (brushSize / 2) * (brushRoundness / 100))}
                    rotation={brushAngle}
                    stroke="white"
                    strokeWidth={1 / viewport.scale}
                    listening={false}
                  />
                </>
              )}
              {shapeDraft && (() => {
              const { start, current, shiftKey } = shapeDraft;
              const constrained = constrainShapeEndpoint(shapeKind, start, current, {
                shift: shiftKey,
              });
              const dx = constrained.x - start.x;
              const dy = constrained.y - start.y;
              const w = Math.abs(dx);
              const h = Math.abs(dy);
              const x = dx < 0 ? start.x + dx : start.x;
              const y = dy < 0 ? start.y + dy : start.y;
              if (shapeKind === 'rect') {
                return (
                  <Rect
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={foregroundColor}
                    opacity={0.6}
                    stroke="#4caf50"
                    strokeWidth={1 / viewport.scale}
                    dash={[6 / viewport.scale, 4 / viewport.scale]}
                    listening={false}
                  />
                );
              }
              if (shapeKind === 'ellipse') {
                return (
                  <Ellipse
                    x={x + w / 2}
                    y={y + h / 2}
                    radiusX={w / 2}
                    radiusY={h / 2}
                    fill={foregroundColor}
                    opacity={0.6}
                    stroke="#4caf50"
                    strokeWidth={1 / viewport.scale}
                    dash={[6 / viewport.scale, 4 / viewport.scale]}
                    listening={false}
                  />
                );
              }
              return (
                <Line
                  x={start.x}
                  y={start.y}
                  points={[0, 0, dx, dy]}
                  stroke={foregroundColor}
                  strokeWidth={4 / viewport.scale}
                  opacity={0.7}
                  listening={false}
                />
              );
              })()}
            </KonvaGroup>
            <KonvaGroup name="ll-overlay">
            {marquee && (() => {
              const x = Math.min(marquee.start.x, marquee.current.x);
              const y = Math.min(marquee.start.y, marquee.current.y);
              const w = Math.abs(marquee.current.x - marquee.start.x);
              const h = Math.abs(marquee.current.y - marquee.start.y);
              return (
                <Rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="#2196f3"
                  opacity={0.12}
                  stroke="#2196f3"
                  strokeWidth={1 / viewport.scale}
                  dash={[4 / viewport.scale, 3 / viewport.scale]}
                  listening={false}
                />
              );
            })()}
            {(() => {
              const sc = viewport.scale;
              const dash = [4 / sc, 4 / sc];
              const sw = 1 / sc;
              const off = (antsOffset % 8) / sc;
              const nodes: React.ReactNode[] = [];
              const rectAnts = (id: string, x: number, y: number, w: number, h: number) => {
                nodes.push(<Rect key={`${id}w`} x={x} y={y} width={w} height={h} stroke="#ffffff" strokeWidth={sw} dash={dash} dashOffset={off} listening={false} />);
                nodes.push(<Rect key={`${id}b`} x={x} y={y} width={w} height={h} stroke="#000000" strokeWidth={sw} dash={dash} dashOffset={off + 4 / sc} listening={false} />);
              };
              const ellipseAnts = (id: string, x: number, y: number, w: number, h: number) => {
                nodes.push(<Ellipse key={`${id}w`} x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} stroke="#ffffff" strokeWidth={sw} dash={dash} dashOffset={off} listening={false} />);
                nodes.push(<Ellipse key={`${id}b`} x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} stroke="#000000" strokeWidth={sw} dash={dash} dashOffset={off + 4 / sc} listening={false} />);
              };
              const lineAnts = (id: string, pts: number[], closed: boolean) => {
                nodes.push(<Line key={`${id}w`} points={pts} closed={closed} stroke="#ffffff" strokeWidth={sw} dash={dash} dashOffset={off} listening={false} />);
                nodes.push(<Line key={`${id}b`} points={pts} closed={closed} stroke="#000000" strokeWidth={sw} dash={dash} dashOffset={off + 4 / sc} listening={false} />);
              };

              if (selection) {
                const s = selection;
                if (s.type === 'rect') rectAnts('sel', s.x, s.y, s.width, s.height);
                else if (s.type === 'ellipse') ellipseAnts('sel', s.x, s.y, s.width, s.height);
                else if (s.type === 'poly') lineAnts('sel', s.points, true);
                else if (s.type === 'mask') s.contours.forEach((c, i) => lineAnts(`sel${i}`, c, true));
              }

              if (selDraft) {
                const st = selDraft.start;
                let cx = selDraft.current.x;
                let cy = selDraft.current.y;
                if (selDraft.shift) {
                  const sz = Math.max(Math.abs(cx - st.x), Math.abs(cy - st.y));
                  cx = st.x + Math.sign(cx - st.x || 1) * sz;
                  cy = st.y + Math.sign(cy - st.y || 1) * sz;
                }
                const x = Math.min(st.x, cx);
                const y = Math.min(st.y, cy);
                const w = Math.abs(cx - st.x);
                const h = Math.abs(cy - st.y);
                if (marqueeKind === 'ellipse') ellipseAnts('draft', x, y, w, h);
                else rectAnts('draft', x, y, w, h);
              }

              if (lassoPts.length > 0) {
                const live = lassoCursor
                  ? [...lassoPts, lassoCursor.x, lassoCursor.y]
                  : [...lassoPts];
                lineAnts('lasso', live, false);
              }

              return nodes;
            })()}
            {snapGuides.map((g, i) =>
              g.orient === 'v' ? (
                <Line
                  key={`snap-gv-${i}`}
                  points={[g.pos, 0, g.pos, canvas.height]}
                  stroke="#ff00ff"
                  strokeWidth={1 / viewport.scale}
                  listening={false}
                />
              ) : (
                <Line
                  key={`snap-gh-${i}`}
                  points={[0, g.pos, canvas.width, g.pos]}
                  stroke="#ff00ff"
                  strokeWidth={1 / viewport.scale}
                  listening={false}
                />
              ),
            )}
            {showGuides &&
              userGuides.map((g) =>
                g.axis === 'v' ? (
                  <Line
                    key={`ug-${g.id}`}
                    points={[g.pos, 0, g.pos, canvas.height]}
                    stroke="#00bcd4"
                    strokeWidth={1 / viewport.scale}
                    listening={moveActive}
                    draggable={moveActive}
                    hitStrokeWidth={Math.max(8 / viewport.scale, 4)}
                    onDragMove={(e) => {
                      const node = e.target;
                      node.y(0);
                      updateGuide(g.id, node.x());
                    }}
                    onDragEnd={(e) => {
                      const node = e.target;
                      const newPos = node.x();
                      if (newPos < -10 || newPos > canvas.width + 10) {
                        removeGuide(g.id);
                      } else {
                        updateGuide(g.id, newPos);
                      }
                      node.y(0);
                    }}
                  />
                ) : (
                  <Line
                    key={`ug-${g.id}`}
                    points={[0, g.pos, canvas.width, g.pos]}
                    stroke="#00bcd4"
                    strokeWidth={1 / viewport.scale}
                    listening={moveActive}
                    draggable={moveActive}
                    hitStrokeWidth={Math.max(8 / viewport.scale, 4)}
                    onDragMove={(e) => {
                      const node = e.target;
                      node.x(0);
                      updateGuide(g.id, node.y());
                    }}
                    onDragEnd={(e) => {
                      const node = e.target;
                      const newPos = node.y();
                      if (newPos < -10 || newPos > canvas.height + 10) {
                        removeGuide(g.id);
                      } else {
                        updateGuide(g.id, newPos);
                      }
                      node.x(0);
                    }}
                  />
                ),
              )}
            </KonvaGroup>
            <Transformer
              ref={trRef}
              visible={!adjustmentSessionOpen}
              listening={!adjustmentSessionOpen}
              rotateEnabled
              // 角ハンドルは常に縦横比を維持。辺ハンドルでは片方向だけを調整できる。
              keepRatio
              centeredScaling={altDown}
              rotationSnaps={
                shiftDown
                  ? [
                      0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180,
                      195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345,
                    ]
                  : []
              }
              rotationSnapTolerance={8}
              enabledAnchors={[
                'top-left',
                'top-right',
                'bottom-left',
                'bottom-right',
                'middle-left',
                'middle-right',
                'top-center',
                'bottom-center',
              ]}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
              }}
            />
          </KonvaLayer>
        </Stage>
        {editingLayer && editingLayer.type === 'text' && (
          <TextEditOverlay
            layer={editingLayer}
            scale={viewport.scale}
            selectAll={editingFromCreate}
            onDraftChange={(text) => {
              const targetStore = editingStoreRef.current ?? getActiveStore();
              const key = `text:${editingLayer.id}`;
              registerPendingSyncEdit(targetStore, key, {
                flush: () => {
                  const target = targetStore.getState().layers.find((layer) => layer.id === editingLayer.id);
                  if (target?.type === 'text') {
                    targetStore.getState().updateLayer(editingLayer.id, {
                      text,
                      name: text.trim().slice(0, 20) || t({ ja: 'テキスト', en: 'Text' }),
                    });
                  }
                  setEditingId(null);
                  setEditingFromCreate(false);
                  editingStoreRef.current = null;
                },
                discard: () => {
                  setEditingId(null);
                  setEditingFromCreate(false);
                  editingStoreRef.current = null;
                },
              });
            }}
            onCommit={(text) => {
              const targetStore = editingStoreRef.current ?? getActiveStore();
              clearPendingSyncEdit(targetStore, `text:${editingLayer.id}`);
              targetStore.getState().updateLayer(editingLayer.id, {
                text,
                name: text.trim().slice(0, 20) || t({ ja: 'テキスト', en: 'Text' }),
              });
              setEditingId(null);
              setEditingFromCreate(false);
              editingStoreRef.current = null;
            }}
            onCancel={() => {
              const targetStore = editingStoreRef.current ?? getActiveStore();
              clearPendingSyncEdit(targetStore, `text:${editingLayer.id}`);
              if (editingFromCreate) targetStore.getState().removeLayer(editingLayer.id);
              setEditingId(null);
              setEditingFromCreate(false);
              editingStoreRef.current = null;
            }}
          />
        )}
        {tool === 'crop' && !adjustmentSessionOpen && (
          <CropOverlay onClose={() => setTool('move')} />
        )}
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <div className="canvas-info">
        {canvas.width} × {canvas.height}px · {Math.round(viewport.scale * 100)}%
        {selInfoBounds &&
          t({
            ja: ` · 選択 ${Math.round(selInfoBounds.width)}×${Math.round(selInfoBounds.height)}`,
            en: ` · Selection ${Math.round(selInfoBounds.width)}×${Math.round(selInfoBounds.height)}`,
          })}
        {selectedIds.length > 1 &&
          t({ ja: ` · ${selectedIds.length}個選択`, en: ` · ${selectedIds.length} selected` })}
        {tool === 'shape' &&
          t({
            ja: ` · 図形: ${shapeKind === 'rect' ? '矩形' : shapeKind === 'ellipse' ? '楕円' : '直線'}`,
            en: ` · Shape: ${shapeKind === 'rect' ? 'Rectangle' : shapeKind === 'ellipse' ? 'Ellipse' : 'Line'}`,
          })}
      </div>
    </div>
  );
}
