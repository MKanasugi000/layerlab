import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n/locale';
import { getActiveStore, useEditorStore, type DocStore } from '../store/editorStore';
import { FontPicker } from './FontPicker';
import { TextEffectsPanel } from './TextEffectsPanel';
import { ColorButton } from './ColorButton';
import { ScrubNumber } from './ScrubNumber';
import { BLEND_MODES } from '../types';
import type { Layer, TextLayer, ImageLayer, ShapeLayer, CanvasConfig, NormalGenParams, GrayMode } from '../types';
import {
  generateNormalMapImage,
  isSafeNormalMapSize,
  normalMapParamsKey,
  sameNormalMapGeneration,
} from '../utils/normalMap';
import { alignToCanvas, type AlignMode } from '../utils/alignment';
import {
  ADJUSTMENT_MODE_LABELS,
  DEFAULT_COLOR_ADJUSTMENTS,
  colorAdjustmentsForLayer,
  isDefaultColorAdjustments,
  type AdjustmentMode,
} from '../imaging/colorAdjustments';
import { createLayerLockChecker } from '../interactions/layerLockPolicy';
import {
  clearPendingSyncEdit,
  flushPendingSyncEdits,
  registerPendingSyncEdit,
  trackPendingAsyncEdit,
} from '../interactions/pendingEdits';
import { toast } from '../store/toastStore';

export function PropertyPanel({
  style,
  onAdjustment,
}: {
  style?: CSSProperties;
  onAdjustment?: (mode: AdjustmentMode) => void;
}) {
  const t = useT();
  const selectedId = useEditorStore((s) => s.selectedId);
  const layers = useEditorStore((s) => s.layers);
  const layer = layers.find((l) => l.id === selectedId);
  const canvas = useEditorStore((s) => s.canvas);
  const updateLayer = useEditorStore((s) => s.updateLayer);

  if (!layer) {
    return (
      <aside className="property-panel" style={style}>
        <header className="panel-header">
          <h2>{t({ ja: 'プロパティ', en: 'Properties' })}</h2>
        </header>
        <div className="empty">{t({ ja: 'レイヤー未選択', en: 'No layer selected' })}</div>
      </aside>
    );
  }

  const update = (patch: Partial<Layer>) => updateLayer(layer.id, patch);
  const effectivelyLocked = createLayerLockChecker(layers)(layer.id);

  return (
    <aside className="property-panel" style={style}>
      <header className="panel-header">
        <h2>{t({ ja: 'プロパティ', en: 'Properties' })}</h2>
        <span className="layer-type">
          {layer.type}
          {effectivelyLocked && ' 🔒'}
        </span>
      </header>
      <fieldset className="props props-fieldset" disabled={effectivelyLocked}>
        {effectivelyLocked && (
          <div className="modal-row info">
            {t({ ja: 'このレイヤー、または親グループはロックされています', en: 'This layer or a parent group is locked' })}
          </div>
        )}
        {layer.type === 'text' && (
          <TextPropsTop
            layer={layer}
            update={update as (p: Partial<TextLayer>) => void}
          />
        )}

        <label>
          {t({ ja: '名前', en: 'Name' })}
          <input
            type="text"
            value={layer.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </label>

        {layer.type !== 'group' ? (
          <>
            <label>
              {t({ ja: 'ブレンドモード', en: 'Blend Mode' })}
              <select
                value={layer.blendMode}
                onChange={(e) =>
                  update({
                    blendMode: e.target.value as typeof BLEND_MODES[number]['value'],
                  })
                }
              >
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {t({ ja: m.label, en: m.labelEn })}
                  </option>
                ))}
              </select>
            </label>

            <label>
              {t({ ja: '不透明度', en: 'Opacity' })} {Math.round(layer.opacity * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(layer.opacity * 100)}
                onChange={(e) => update({ opacity: parseInt(e.target.value) / 100 })}
              />
            </label>

            <div className="row">
              <label>
                X
                <ScrubNumber value={layer.x} onChange={(v) => update({ x: v })} />
              </label>
              <label>
                Y
                <ScrubNumber value={layer.y} onChange={(v) => update({ y: v })} />
              </label>
            </div>
          </>
        ) : (
          <div className="modal-row info">
            {t({
              ja: 'グループは整理・表示・ロック用です。グループ単位の変形、ブレンド、合成後の不透明度は未対応です。',
              en: 'Groups currently organize, show/hide, and lock layers. Group transforms, blending, and post-composite opacity are not supported.',
            })}
          </div>
        )}

        {layer.type !== 'group' && (
          <AlignButtons layer={layer} canvas={canvas} update={update} />
        )}


        {layer.type === 'image' && (
          <ImageSizeRow
            layer={layer}
            update={update as (p: Partial<ImageLayer>) => void}
          />
        )}

        {layer.type === 'shape' && (
          <ShapeSizeRow
            layer={layer}
            update={update as (p: Partial<ShapeLayer>) => void}
          />
        )}

        {layer.type !== 'group' && (
          <label>
            {t({ ja: '回転°', en: 'Rotation °' })}
            <ScrubNumber value={layer.rotation} onChange={(v) => update({ rotation: v })} />
          </label>
        )}

        {layer.type === 'text' && (
          <TextPropsBottom
            layer={layer}
            update={update as (p: Partial<TextLayer>) => void}
          />
        )}

        {layer.type === 'shape' && (
          <ShapeProps
            layer={layer}
            update={update as (p: Partial<ShapeLayer>) => void}
          />
        )}

        {layer.type === 'image' && layer.normalGen && (
          <NormalMapPanel
            key={layer.id}
            layer={layer}
          />
        )}

        {layer.type === 'image' && !layer.normalGen && (
          <ImageEffects
            layer={layer}
            update={update as (p: Partial<ImageLayer>) => void}
            onAdjustment={onAdjustment}
          />
        )}
      </fieldset>
    </aside>
  );
}

const GRAY_MODES: { value: GrayMode; label: string; labelEn: string }[] = [
  { value: 'luminance', label: '輝度（標準）', labelEn: 'Luminance (Standard)' },
  { value: 'average', label: '平均 (R+G+B)/3', labelEn: 'Average (R+G+B)/3' },
  { value: 'lightness', label: '明度 (max+min)/2', labelEn: 'Lightness (max+min)/2' },
  { value: 'value', label: '明るさ (max)', labelEn: 'Brightness (max)' },
  { value: 'red', label: 'R チャンネル', labelEn: 'R Channel' },
  { value: 'green', label: 'G チャンネル', labelEn: 'G Channel' },
  { value: 'blue', label: 'B チャンネル', labelEn: 'B Channel' },
];

const NORMAL_MAP_DEBOUNCE_MS = 220;

/** ノーマルマップ生成由来レイヤーの非破壊調整。数値変更でキャンバス上の実物を再生成する。 */
function NormalMapPanel({
  layer,
}: {
  layer: ImageLayer;
}) {
  const t = useT();
  const layers = useEditorStore((s) => s.layers);
  const canvas = useEditorStore((s) => s.canvas);
  const persistedNG = layer.normalGen as NormalGenParams;
  const persistedParamsKey = normalMapParamsKey(persistedNG);
  const [ng, setDraftNG] = useState<NormalGenParams>(persistedNG);
  const sources = layers.filter(
    (l): l is ImageLayer => l.type === 'image' && l.id !== layer.id && !l.normalGen,
  );
  const source = layers.find((l) => l.id === ng.sourceLayerId) as ImageLayer | undefined;
  const debounceTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const generationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef(ng);
  const targetStoreRef = useRef<DocStore>(getActiveStore());
  const mountedRef = useRef(true);
  const outputSizeSafe = isSafeNormalMapSize(canvas.width, canvas.height);

  useEffect(() => {
    const targetStore = getActiveStore();
    targetStoreRef.current = targetStore;
    mountedRef.current = true;
    draftRef.current = persistedNG;
    setDraftNG(persistedNG);
    return () => {
      mountedRef.current = false;
      // Selection/tab changes should commit a slider draft, not silently drop
      // the local value.  The async generation remains bound to targetStore.
      flushPendingSyncEdits(targetStore);
    };
  }, [layer.id, persistedParamsKey]);

  // 🔑 パラメータを実際に変えたときだけデバウンス再生成する。
  // （レイヤー選択/切替=マウント時には再生成しない＝フル解像度生成によるフリーズを回避）
  const setNG = (patch: Partial<NormalGenParams>) => {
    if (!outputSizeSafe) return;
    const targetStore = targetStoreRef.current;
    const pendingKey = `normal-map:${layer.id}`;
    const currentLayer = targetStore.getState().layers.find(
      (candidate) => candidate.id === layer.id,
    );
    const currentPersistedParams = currentLayer?.type === 'image' && currentLayer.normalGen
      ? currentLayer.normalGen
      : persistedNG;
    const expectedPersistedParamsKey = normalMapParamsKey(currentPersistedParams);
    const next = { ...draftRef.current, ...patch };
    const nextParamsKey = normalMapParamsKey(next);
    draftRef.current = next;
    setDraftNG(next);
    const generation = ++generationRef.current;
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);

    const restorePersistedDraft = () => {
      if (generationRef.current !== generation) return;
      const latestTarget = targetStore.getState().layers.find(
        (candidate) => candidate.id === layer.id,
      );
      if (latestTarget?.type !== 'image' || !latestTarget.normalGen) return;
      draftRef.current = latestTarget.normalGen;
      if (mountedRef.current) setDraftNG(latestTarget.normalGen);
    };

    const generateAndCommit = async () => {
      debounceTimerRef.current = null;
      const { sourceLayerId, ...heightParams } = next;
      const state = targetStore.getState();
      const src = state.layers.find((candidate) => candidate.id === sourceLayerId);
      const target = state.layers.find((candidate) => candidate.id === layer.id);
      if (
        !src
        || src.type !== 'image'
        || !target
        || target.type !== 'image'
        || !target.normalGen
        || normalMapParamsKey(target.normalGen) !== expectedPersistedParamsKey
      ) {
        restorePersistedDraft();
        return;
      }

      const canvasWidth = state.canvas.width;
      const canvasHeight = state.canvas.height;
      const sourceSrc = src.src;
      const targetSrc = target.src;
      const expectedGeneration = {
        generation,
        paramsKey: expectedPersistedParamsKey,
        sourceSrc,
        targetSrc,
        canvasWidth,
        canvasHeight,
      };
      const renderSpec = {
        layer: src,
        width: canvasWidth,
        height: canvasHeight,
        ...heightParams,
      };

      const isCurrent = () => {
        if (generationRef.current !== generation) return false;
        if (normalMapParamsKey(draftRef.current) !== nextParamsKey) return false;
        const latest = targetStore.getState();
        const latestTarget = latest.layers.find((candidate) => candidate.id === layer.id);
        const latestSource = latest.layers.find((candidate) => candidate.id === sourceLayerId);
        if (
          latestTarget?.type !== 'image'
          || !latestTarget.normalGen
          || latestSource?.type !== 'image'
        ) return false;
        return sameNormalMapGeneration(expectedGeneration, {
          generation: generationRef.current,
          paramsKey: normalMapParamsKey(latestTarget.normalGen),
          sourceSrc: latestSource.src,
          targetSrc: latestTarget.src,
          canvasWidth: latest.canvas.width,
          canvasHeight: latest.canvas.height,
        });
      };

      if (!isCurrent()) {
        restorePersistedDraft();
        return;
      }
      try {
        const result = await generateNormalMapImage(renderSpec);
        if (!isCurrent()) {
          restorePersistedDraft();
          return;
        }
        targetStore.getState().updateLayer(layer.id, {
          normalGen: next,
          src: result.normalUrl,
          naturalWidth: canvasWidth,
          naturalHeight: canvasHeight,
        });
        const committed = targetStore.getState().layers.find(
          (candidate) => candidate.id === layer.id,
        );
        if (
          committed?.type !== 'image'
          || !committed.normalGen
          || normalMapParamsKey(committed.normalGen) !== nextParamsKey
          || committed.src !== result.normalUrl
        ) restorePersistedDraft();
      } catch (error) {
        // Source decode/generation failures leave the last valid image intact.
        restorePersistedDraft();
        throw error;
      }
    };

    const startGeneration = () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      clearPendingSyncEdit(targetStore, pendingKey);
      const queued = generationQueueRef.current
        .catch(() => undefined)
        .then(generateAndCommit);
      generationQueueRef.current = queued.then(() => undefined, () => undefined);
      const task = trackPendingAsyncEdit(targetStore, queued);
      void task.catch((error) => {
        toast(t({
          ja: `ノーマルマップ調整に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
          en: `Normal map adjustment failed: ${error instanceof Error ? error.message : String(error)}`,
        }), { kind: 'error' });
      });
    };

    debounceTimerRef.current = window.setTimeout(startGeneration, NORMAL_MAP_DEBOUNCE_MS);
    registerPendingSyncEdit(targetStore, pendingKey, {
      flush: startGeneration,
      discard: () => {
        if (debounceTimerRef.current !== null) {
          window.clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        restorePersistedDraft();
      },
    });
  };

  return (
    <>
      <hr />
      <h3 className="effects-heading">{t({ ja: 'ノーマルマップ調整', en: 'Normal Map Adjustments' })}</h3>
      <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
        {outputSizeSafe
          ? t({ ja: '変更は操作停止後にフル解像度で反映します', en: 'Changes update at full resolution after you pause' })
          : t({ ja: '安全のため調整は4096×4096px以下で使用できます', en: 'For safety, adjustments are available up to 4096×4096 px' })}
      </div>
      <label>
        {t({ ja: 'ソース（元テクスチャ）', en: 'Source (original texture)' })}
        <select value={ng.sourceLayerId} onChange={(e) => setNG({ sourceLayerId: e.target.value })}>
          {!source && <option value={ng.sourceLayerId}>{t({ ja: '（元レイヤーが見つかりません）', en: '(Source layer not found)' })}</option>}
          {sources.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t({ ja: 'モノクロ化方式', en: 'Grayscale method' })}
        <select value={ng.grayMode} onChange={(e) => setNG({ grayMode: e.target.value as GrayMode })}>
          {GRAY_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {t({ ja: m.label, en: m.labelEn })}
            </option>
          ))}
        </select>
      </label>
      <label className="row-inline">
        <input type="checkbox" checked={ng.invert} onChange={(e) => setNG({ invert: e.target.checked })} />
        {t({ ja: '明暗を反転（凹凸の向き）', en: 'Invert brightness (bump direction)' })}
      </label>
      <label className="row-inline">
        <input type="checkbox" checked={ng.autoLevel} onChange={(e) => setNG({ autoLevel: e.target.checked })} />
        {t({ ja: '自動レベル', en: 'Auto level' })}
      </label>
      <label>
        {t({ ja: '強度', en: 'Strength' })} {ng.strength.toFixed(1)}
        <input type="range" min={0.1} max={10} step={0.1} value={ng.strength} onChange={(e) => setNG({ strength: parseFloat(e.target.value) })} />
      </label>
      <label>
        {t({ ja: '平坦さ Z', en: 'Flatness Z' })} {ng.zStrength.toFixed(1)}
        <input type="range" min={0.3} max={5} step={0.1} value={ng.zStrength} onChange={(e) => setNG({ zStrength: parseFloat(e.target.value) })} />
      </label>
      <label>
        {t({ ja: '事前ぼかし（不要な凹凸を消す）', en: 'Pre-blur (remove unwanted bumps)' })} {ng.preBlur}
        <input type="range" min={0} max={8} step={1} value={ng.preBlur} onChange={(e) => setNG({ preBlur: parseInt(e.target.value) })} />
      </label>
      <label>
        {t({ ja: '細部の残し方', en: 'Detail preservation' })} {Math.round(ng.detailScale * 100)}%
        <input type="range" min={0} max={1} step={0.05} value={ng.detailScale} onChange={(e) => setNG({ detailScale: parseFloat(e.target.value) })} />
      </label>
      <label>
        {t({ ja: 'ガンマ', en: 'Gamma' })} {ng.gamma.toFixed(2)}
        <input type="range" min={0.2} max={3} step={0.05} value={ng.gamma} onChange={(e) => setNG({ gamma: parseFloat(e.target.value) })} />
      </label>
      <label className="row-inline">
        <input type="checkbox" checked={ng.flipY} onChange={(e) => setNG({ flipY: e.target.checked })} />
        {t({ ja: 'Y軸反転（DirectX形式）', en: 'Flip Y (DirectX style)' })}
      </label>
    </>
  );
}

function ImageEffects({
  layer,
  update,
  onAdjustment,
}: {
  layer: ImageLayer;
  update: (patch: Partial<ImageLayer>) => void;
  onAdjustment?: (mode: AdjustmentMode) => void;
}) {
  const t = useT();
  const adjustments = colorAdjustmentsForLayer(layer);
  const hasAdjust = !isDefaultColorAdjustments(adjustments);
  const adjustmentModes = Object.keys(ADJUSTMENT_MODE_LABELS) as AdjustmentMode[];
  return (
    <>
      <hr />
      <div className="effects-heading-row">
        <h3 className="effects-heading">{t({ ja: '色調補正', en: 'Color Adjustments' })}</h3>
        {hasAdjust && (
          <button
            type="button"
            className="adjust-reset"
            onClick={() => update({
              adjustments: { ...DEFAULT_COLOR_ADJUSTMENTS },
              brightness: 0,
              contrast: 0,
              gamma: 1,
            })}
          >
            {t({ ja: 'リセット', en: 'Reset' })}
          </button>
        )}
      </div>
      <div className="adjustment-launch-grid">
        {adjustmentModes.map((mode) => (
          <button key={mode} type="button" onClick={() => onAdjustment?.(mode)}>
            {t(ADJUSTMENT_MODE_LABELS[mode])}
          </button>
        ))}
      </div>
      {hasAdjust && (
        <div className="adjustment-active-note">
          {t({
            ja: '現在の補正値をプレビュー中です。次の補正を確定するとピクセルへ適用され、Ctrl+Zで戻せます。',
            en: 'Current values are previewed. Applying the next adjustment bakes them into pixels; Ctrl+Z restores the previous state.',
          })}
        </div>
      )}
      <hr />
      <h3 className="effects-heading">{t({ ja: '枠線', en: 'Stroke' })}</h3>
      <label className="row-inline">
        <input
          type="checkbox"
          checked={layer.strokeEnabled ?? false}
          onChange={(e) => update({ strokeEnabled: e.target.checked })}
        />
        {t({ ja: 'ストローク', en: 'Stroke' })}
      </label>
      {layer.strokeEnabled && (
        <div className="row">
          <label>
            {t({ ja: '色', en: 'Color' })}
            <ColorButton
              value={layer.strokeColor ?? '#000000'}
              onChange={(c) => update({ strokeColor: c })}
            />
          </label>
          <label>
            {t({ ja: '太さ', en: 'Thickness' })}
            <ScrubNumber value={layer.strokeWidth ?? 4} min={0} step={0.5} precision={1} onChange={(v) => update({ strokeWidth: v })} />
          </label>
        </div>
      )}
      <hr />
      <h3 className="effects-heading">{t({ ja: '影', en: 'Shadow' })}</h3>
      <label className="row-inline">
        <input
          type="checkbox"
          checked={layer.shadowEnabled ?? false}
          onChange={(e) => update({ shadowEnabled: e.target.checked })}
        />
        {t({ ja: 'ドロップシャドウ', en: 'Drop Shadow' })}
      </label>
      {layer.shadowEnabled && (
        <>
          <label>
            {t({ ja: '影色', en: 'Shadow Color' })}
            <ColorButton
              value={layer.shadowColor ?? '#000000'}
              onChange={(c) => update({ shadowColor: c })}
            />
          </label>
          <label>
            {t({ ja: '不透明度', en: 'Opacity' })} {Math.round((layer.shadowOpacity ?? 0.6) * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((layer.shadowOpacity ?? 0.6) * 100)}
              onChange={(e) =>
                update({ shadowOpacity: parseInt(e.target.value) / 100 })
              }
            />
          </label>
          <label>
            {t({ ja: 'ぼかし', en: 'Blur' })} {layer.shadowBlur ?? 10}px
            <input
              type="range"
              min={0}
              max={80}
              value={layer.shadowBlur ?? 10}
              onChange={(e) => update({ shadowBlur: parseInt(e.target.value) })}
            />
          </label>
          <div className="row">
            <label>
              {t({ ja: 'X方向', en: 'X Offset' })}
              <ScrubNumber value={layer.shadowOffsetX ?? 4} onChange={(v) => update({ shadowOffsetX: v })} />
            </label>
            <label>
              {t({ ja: 'Y方向', en: 'Y Offset' })}
              <ScrubNumber value={layer.shadowOffsetY ?? 4} onChange={(v) => update({ shadowOffsetY: v })} />
            </label>
          </div>
        </>
      )}
    </>
  );
}

function AlignButtons({
  layer,
  canvas,
  update,
}: {
  layer: Layer;
  canvas: CanvasConfig;
  update: (patch: Partial<Layer>) => void;
}) {
  const t = useT();
  const apply = (mode: AlignMode) => {
    const { x, y } = alignToCanvas(layer, canvas, mode);
    update({ x, y });
  };
  const btn = (mode: AlignMode, label: string, title: string) => (
    <button
      type="button"
      className="align-btn"
      onClick={() => apply(mode)}
      title={title}
    >
      {label}
    </button>
  );
  return (
    <div className="align-panel">
      <div className="align-label">{t({ ja: '整列 (キャンバス基準)', en: 'Align (canvas reference)' })}</div>
      <div className="align-row">
        {btn('left', '⇤', t({ ja: '左揃え', en: 'Align left' }))}
        {btn('centerH', '⇔', t({ ja: '水平中央', en: 'Center horizontally' }))}
        {btn('right', '⇥', t({ ja: '右揃え', en: 'Align right' }))}
        {btn('top', '⇡', t({ ja: '上揃え', en: 'Align top' }))}
        {btn('centerV', '⇕', t({ ja: '垂直中央', en: 'Center vertically' }))}
        {btn('bottom', '⇣', t({ ja: '下揃え', en: 'Align bottom' }))}
      </div>
    </div>
  );
}

function ImageSizeRow({
  layer,
  update,
}: {
  layer: ImageLayer;
  update: (patch: Partial<ImageLayer>) => void;
}) {
  const t = useT();
  const w = Math.round(layer.naturalWidth * layer.scaleX);
  const h = Math.round(layer.naturalHeight * layer.scaleY);
  return (
    <div className="row">
      <label>
        {t({ ja: '幅 px', en: 'Width px' })}
        <ScrubNumber value={w} min={1} onChange={(v) => update({ scaleX: Math.max(1, v) / layer.naturalWidth })} />
      </label>
      <label>
        {t({ ja: '高さ px', en: 'Height px' })}
        <ScrubNumber value={h} min={1} onChange={(v) => update({ scaleY: Math.max(1, v) / layer.naturalHeight })} />
      </label>
    </div>
  );
}

function ShapeSizeRow({
  layer,
  update,
}: {
  layer: ShapeLayer;
  update: (patch: Partial<ShapeLayer>) => void;
}) {
  const t = useT();
  return (
    <div className="row">
      <label>
        {t({ ja: '幅 px', en: 'Width px' })}
        <ScrubNumber value={layer.shapeWidth} min={1} onChange={(v) => update({ shapeWidth: Math.max(1, v) })} />
      </label>
      <label>
        {t({ ja: '高さ px', en: 'Height px' })}
        <ScrubNumber value={layer.shapeHeight} min={1} onChange={(v) => update({ shapeHeight: Math.max(1, v) })} />
      </label>
    </div>
  );
}

function TextPropsTop({
  layer,
  update,
}: {
  layer: TextLayer;
  update: (patch: Partial<TextLayer>) => void;
}) {
  const t = useT();
  return (
    <div className="text-props-top">
      <label>
        {t({ ja: 'フォント', en: 'Font' })}
        <FontPicker value={layer.fontFamily} onChange={(f) => update({ fontFamily: f })} />
      </label>
      <div className="row">
        <label>
          {t({ ja: 'サイズ', en: 'Size' })}
          <ScrubNumber value={layer.fontSize} min={1} onChange={(v) => update({ fontSize: Math.max(1, v) })} />
        </label>
        <label>
          {t({ ja: '色', en: 'Color' })}
          <ColorButton value={layer.fill} onChange={(c) => update({ fill: c })} />
        </label>
      </div>
      <div className="row">
        <label>
          {t({ ja: 'スタイル', en: 'Style' })}
          <select
            value={layer.fontStyle}
            onChange={(e) =>
              update({ fontStyle: e.target.value as TextLayer['fontStyle'] })
            }
          >
            <option value="normal">{t({ ja: '通常', en: 'Normal' })}</option>
            <option value="bold">{t({ ja: '太字', en: 'Bold' })}</option>
            <option value="italic">{t({ ja: '斜体', en: 'Italic' })}</option>
            <option value="bold italic">{t({ ja: '太字+斜体', en: 'Bold Italic' })}</option>
          </select>
        </label>
        <label>
          {t({ ja: '揃え', en: 'Align' })}
          <select
            value={layer.align}
            onChange={(e) =>
              update({ align: e.target.value as TextLayer['align'] })
            }
          >
            <option value="left">{t({ ja: '左', en: 'Left' })}</option>
            <option value="center">{t({ ja: '中央', en: 'Center' })}</option>
            <option value="right">{t({ ja: '右', en: 'Right' })}</option>
          </select>
        </label>
      </div>
      <label>
        {t({ ja: 'テキスト', en: 'Text' })}
        <textarea
          value={layer.text}
          rows={2}
          onChange={(e) => update({ text: e.target.value })}
        />
      </label>
      <hr />
    </div>
  );
}

function TextPropsBottom({
  layer,
  update,
}: {
  layer: TextLayer;
  update: (patch: Partial<TextLayer>) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="row">
        <label>
          {t({ ja: '字間', en: 'Letter Spacing' })}
          <ScrubNumber value={layer.letterSpacing ?? 0} step={0.5} precision={1} onChange={(v) => update({ letterSpacing: v })} />
        </label>
        <label>
          {t({ ja: '行間', en: 'Line Height' })}
          <ScrubNumber value={layer.lineHeight ?? 1.2} step={0.1} min={0.5} precision={2} onChange={(v) => update({ lineHeight: v })} />
        </label>
      </div>
      <hr />
      <TextEffectsPanel layer={layer} update={update} />
    </>
  );
}

function ShapeProps({
  layer,
  update,
}: {
  layer: ShapeLayer;
  update: (patch: Partial<ShapeLayer>) => void;
}) {
  const t = useT();
  return (
    <>
      <hr />
      <h3 className="effects-heading">{t({ ja: '図形プロパティ', en: 'Shape Properties' })}</h3>
      <label className="row-inline">
        <input
          type="checkbox"
          checked={layer.fillEnabled}
          onChange={(e) => update({ fillEnabled: e.target.checked })}
        />
        {t({ ja: '塗り', en: 'Fill' })}
      </label>
      {layer.fillEnabled && (
        <label>
          {t({ ja: '塗り色', en: 'Fill Color' })}
          <ColorButton value={layer.fill} onChange={(c) => update({ fill: c })} />
        </label>
      )}
      <label className="row-inline">
        <input
          type="checkbox"
          checked={layer.strokeEnabled}
          onChange={(e) => update({ strokeEnabled: e.target.checked })}
        />
        {t({ ja: '線', en: 'Stroke' })}
      </label>
      {layer.strokeEnabled && (
        <div className="row">
          <label>
            {t({ ja: '線色', en: 'Stroke Color' })}
            <ColorButton value={layer.strokeColor} onChange={(c) => update({ strokeColor: c })} />
          </label>
          <label>
            {t({ ja: '太さ', en: 'Thickness' })}
            <ScrubNumber value={layer.strokeWidth} min={0} step={0.5} precision={1} onChange={(v) => update({ strokeWidth: v })} />
          </label>
        </div>
      )}
      {layer.shape === 'rect' && (
        <label>
          {t({ ja: '角丸', en: 'Corner Radius' })} {layer.cornerRadius}px
          <input
            type="range"
            min={0}
            max={200}
            value={layer.cornerRadius}
            onChange={(e) => update({ cornerRadius: parseInt(e.target.value) })}
          />
        </label>
      )}
      <hr />
      <h3 className="effects-heading">{t({ ja: '影', en: 'Shadow' })}</h3>
      <label className="row-inline">
        <input
          type="checkbox"
          checked={layer.shadowEnabled}
          onChange={(e) => update({ shadowEnabled: e.target.checked })}
        />
        {t({ ja: 'ドロップシャドウ', en: 'Drop Shadow' })}
      </label>
      {layer.shadowEnabled && (
        <>
          <label>
            {t({ ja: '影色', en: 'Shadow Color' })}
            <ColorButton value={layer.shadowColor} onChange={(c) => update({ shadowColor: c })} />
          </label>
          <label>
            {t({ ja: '不透明度', en: 'Opacity' })} {Math.round(layer.shadowOpacity * 100)}%
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(layer.shadowOpacity * 100)}
              onChange={(e) =>
                update({ shadowOpacity: parseInt(e.target.value) / 100 })
              }
            />
          </label>
          <label>
            {t({ ja: 'ぼかし', en: 'Blur' })} {layer.shadowBlur}px
            <input
              type="range"
              min={0}
              max={80}
              value={layer.shadowBlur}
              onChange={(e) => update({ shadowBlur: parseInt(e.target.value) })}
            />
          </label>
          <div className="row">
            <label>
              {t({ ja: 'X方向', en: 'X Offset' })}
              <ScrubNumber value={layer.shadowOffsetX} onChange={(v) => update({ shadowOffsetX: v })} />
            </label>
            <label>
              {t({ ja: 'Y方向', en: 'Y Offset' })}
              <ScrubNumber value={layer.shadowOffsetY} onChange={(v) => update({ shadowOffsetY: v })} />
            </label>
          </div>
        </>
      )}
    </>
  );
}
