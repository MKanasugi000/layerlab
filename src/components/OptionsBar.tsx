import { useState, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { SelMode } from '../store/editorStore';
import { useT } from '../i18n/locale';
import { FontPicker } from './FontPicker';
import { ColorButton } from './ColorButton';
import { ScrubNumber } from './ScrubNumber';
import { BrushPickerPopup, CurrentBrushThumbnail } from './BrushPickerPopup';
import type { AlignMode } from '../utils/alignment';
import type { TextLayer, ShapeLayer, ShapeKind } from '../types';

const TOOL_LABELS: Record<string, { ja: string; en: string }> = {
  move: { ja: '移動ツール', en: 'Move Tool' },
  marquee: { ja: '長方形選択ツール', en: 'Rectangular Marquee Tool' },
  lasso: { ja: 'なげなわツール', en: 'Lasso Tool' },
  wand: { ja: '自動選択ツール', en: 'Magic Wand Tool' },
  brush: { ja: 'ブラシツール', en: 'Brush Tool' },
  text: { ja: '横書き文字ツール', en: 'Horizontal Type Tool' },
  shape: { ja: 'シェイプツール', en: 'Shape Tool' },
  crop: { ja: '切り抜きツール', en: 'Crop Tool' },
  eyedropper: { ja: 'スポイトツール', en: 'Eyedropper Tool' },
  hand: { ja: '手のひらツール', en: 'Hand Tool' },
  zoom: { ja: 'ズームツール', en: 'Zoom Tool' },
};

const ALIGN_BTNS: Array<{ mode: AlignMode; label: string; ja: string; en: string }> = [
  { mode: 'left',   label: '⇤', ja: '左揃え',   en: 'Left' },
  { mode: 'centerH', label: '⇔', ja: '水平中央', en: 'Center Horizontally' },
  { mode: 'right',  label: '⇥', ja: '右揃え',   en: 'Right' },
  { mode: 'top',    label: '⇡', ja: '上揃え',   en: 'Top' },
  { mode: 'centerV', label: '⇕', ja: '垂直中央', en: 'Center Vertically' },
  { mode: 'bottom', label: '⇣', ja: '下揃え',   en: 'Bottom' },
];

const DIST_BTNS: Array<{ mode: AlignMode | 'sh' | 'sv'; label: string; ja: string; en: string }> = [
  { mode: 'left',    label: '↤', ja: '左端を分布',         en: 'Distribute Left Edges' },
  { mode: 'centerH', label: '↔', ja: '水平中央を分布',     en: 'Distribute Horizontal Centers' },
  { mode: 'right',   label: '↦', ja: '右端を分布',         en: 'Distribute Right Edges' },
  { mode: 'top',     label: '↥', ja: '上端を分布',         en: 'Distribute Top Edges' },
  { mode: 'centerV', label: '↕', ja: '垂直中央を分布',     en: 'Distribute Vertical Centers' },
  { mode: 'bottom',  label: '↧', ja: '下端を分布',         en: 'Distribute Bottom Edges' },
  { mode: 'sh',      label: '⇿', ja: '水平方向の間隔を均等',    en: 'Evenly Spaced Horizontally' },
  { mode: 'sv',      label: '⇳', ja: '垂直方向の間隔を均等',    en: 'Evenly Spaced Vertically' },
];

const SHAPE_KINDS: Array<{ kind: ShapeKind; icon: string; ja: string; en: string }> = [
  { kind: 'rect',    icon: '▭', ja: '長方形', en: 'Rectangle' },
  { kind: 'ellipse', icon: '○', ja: '楕円', en: 'Ellipse' },
  { kind: 'line',    icon: '╱', ja: '直線', en: 'Line' },
];

const SEL_MODES: Array<{ mode: SelMode; labelJa: string; labelEn: string; ja: string; en: string }> = [
  { mode: 'replace',   labelJa: '替', labelEn: 'R', ja: '置換', en: 'Replace' },
  { mode: 'add',       labelJa: '加', labelEn: 'A', ja: '追加', en: 'Add' },
  { mode: 'subtract',  labelJa: '減', labelEn: 'S', ja: '減算', en: 'Subtract' },
  { mode: 'intersect', labelJa: '交', labelEn: 'I', ja: '交差', en: 'Intersect' },
];

export function OptionsBar() {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const brushEraser = useEditorStore((s) => s.brushEraser);
  const toolLabel = tool === 'brush' && brushEraser
    ? { ja: '消しゴムツール', en: 'Eraser Tool' }
    : TOOL_LABELS[tool] ?? { ja: tool, en: tool };
  return (
    <div className="options-bar">
      <span className="ob-tool-name">
        {t(toolLabel)}
      </span>
      <span className="ob-divider" />
      {tool === 'move' && <MoveOptions />}
      {tool === 'marquee' && <MarqueeOptions />}
      {tool === 'lasso' && (
        <>
          <SelectionModeButtons />
          <span className="ob-divider" />
          <span className="ob-hint">{t({ ja: 'クリックで点を追加 · ダブルクリック / Enter で確定 · Esc で取消', en: 'Click to add points · Double-click / Enter to confirm · Esc to cancel' })}</span>
          <SelectionRefineButtons />
        </>
      )}
      {tool === 'wand' && <WandOptions />}
      {tool === 'brush' && <BrushOptions />}
      {tool === 'text' && <TextOptions />}
      {tool === 'shape' && <ShapeOptions />}
      {(tool === 'zoom' || tool === 'hand') && <NavOptions />}
      {tool === 'crop' && <span className="ob-hint">{t({ ja: 'ドラッグで切り抜き範囲 · Enter確定 · Esc取消', en: 'Drag to define crop area · Enter to confirm · Esc to cancel' })}</span>}
      {tool === 'eyedropper' && <span className="ob-hint">{t({ ja: 'クリックで描画色を取得', en: 'Click to pick foreground color' })}</span>}
    </div>
  );
}

function MoveOptions() {
  const t = useT();
  const autoSelect = useEditorStore((s) => s.autoSelect);
  const setAutoSelect = useEditorStore((s) => s.setAutoSelect);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const alignSelected = useEditorStore((s) => s.alignSelected);
  const distributeSelected = useEditorStore((s) => s.distributeSelected);
  const spacingSelected = useEditorStore((s) => s.spacingSelected);

  const count = selectedIds.length;
  const canAlign = count >= 1;
  const canDist = count >= 3;

  return (
    <>
      <label className="ob-check">
        <input
          type="checkbox"
          checked={autoSelect}
          onChange={(e) => setAutoSelect(e.target.checked)}
        />
        {t({ ja: '自動選択', en: 'Auto Select' })}
      </label>
      <span className="ob-divider" />
      <span className="ob-group-label">{t({ ja: '整列', en: 'Align' })}</span>
      <div className="ob-btns">
        {ALIGN_BTNS.map(({ mode, label, ja, en }) => (
          <button
            key={mode}
            className="ob-icon-btn"
            disabled={!canAlign}
            title={t({ ja, en })}
            onClick={() => alignSelected(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="ob-divider" />
      <span className="ob-group-label">{t({ ja: '分布 (3+)', en: 'Distribute (3+)' })}</span>
      <div className="ob-btns">
        {DIST_BTNS.map(({ mode, label, ja, en }) => (
          <button
            key={mode}
            className="ob-icon-btn"
            disabled={!canDist}
            title={t({ ja, en })}
            onClick={() => {
              if (mode === 'sh') {
                spacingSelected('horizontal');
              } else if (mode === 'sv') {
                spacingSelected('vertical');
              } else {
                distributeSelected(mode);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="ob-spacer" />
      <span className="ob-hint">
        {t({ ja: 'Shift=45°固定 · Alt=複製して移動', en: 'Shift=45° constraint · Alt=drag a copy' })}
      </span>
      <span className="ob-count">{t({ ja: `${count} 選択`, en: `${count} selected` })}</span>
    </>
  );
}

function MarqueeOptions() {
  const t = useT();
  const marqueeKind = useEditorStore((s) => s.marqueeKind);
  const setMarqueeKind = useEditorStore((s) => s.setMarqueeKind);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  const canvas = useEditorStore((s) => s.canvas);
  return (
    <>
      <SelectionModeButtons />
      <span className="ob-divider" />
      <span className="ob-group-label">{t({ ja: '種類', en: 'Type' })}</span>
      <div className="ob-btns">
        <button
          className={`ob-icon-btn ${marqueeKind === 'rect' ? 'active' : ''}`}
          title={t({ ja: '長方形選択', en: 'Rectangular Marquee' })}
          onClick={() => setMarqueeKind('rect')}
        >
          ⬚
        </button>
        <button
          className={`ob-icon-btn ${marqueeKind === 'ellipse' ? 'active' : ''}`}
          title={t({ ja: '楕円形選択', en: 'Elliptical Marquee' })}
          onClick={() => setMarqueeKind('ellipse')}
        >
          ⬭
        </button>
      </div>
      <span className="ob-divider" />
      <button
        className="ob-text-btn"
        onClick={() =>
          setSelection({ type: 'rect', x: 0, y: 0, width: canvas.width, height: canvas.height })
        }
      >
        {t({ ja: 'すべて選択', en: 'Select All' })}
      </button>
      <button className="ob-text-btn" disabled={!selection} onClick={() => setSelection(null)}>
        {t({ ja: '選択を解除', en: 'Deselect' })}
      </button>
      <span className="ob-hint">{t({ ja: 'ドラッグで選択 · Shiftで正方形/正円', en: 'Drag to select · Shift for square/circle' })}</span>
      <SelectionRefineButtons />
    </>
  );
}

function SelectionModeButtons() {
  const t = useT();
  const selectionMode = useEditorStore((s) => s.selectionMode);
  const setSelectionMode = useEditorStore((s) => s.setSelectionMode);
  return (
    <div className="ob-btns">
      {SEL_MODES.map(({ mode, labelJa, labelEn, ja, en }) => (
        <button
          key={mode}
          className={`ob-icon-btn ${selectionMode === mode ? 'active' : ''}`}
          title={t({ ja, en })}
          onClick={() => setSelectionMode(mode)}
        >
          {t({ ja: labelJa, en: labelEn })}
        </button>
      ))}
    </div>
  );
}

function SelectionRefineButtons() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const growSelection = useEditorStore((s) => s.growSelection);
  const shrinkSelection = useEditorStore((s) => s.shrinkSelection);
  const featherSelection = useEditorStore((s) => s.featherSelection);
  const smoothSelection = useEditorStore((s) => s.smoothSelection);
  const [refinePx, setRefinePx] = useState(1);

  if (!selection) return null;

  return (
    <>
      <span className="ob-divider" />
      <span className="ob-group-label">{t({ ja: '調整', en: 'Refine' })}</span>
      <ScrubNumber className="ob-num" value={refinePx} min={1} max={100} onChange={setRefinePx} />
      <div className="ob-btns">
        <button className="ob-text-btn" onClick={() => growSelection(refinePx)} title={t({ ja: '拡張', en: 'Expand' })}>
          {t({ ja: '拡', en: 'Expand' })}
        </button>
        <button className="ob-text-btn" onClick={() => shrinkSelection(refinePx)} title={t({ ja: '縮小', en: 'Contract' })}>
          {t({ ja: '縮', en: 'Contract' })}
        </button>
        <button className="ob-text-btn" onClick={() => featherSelection(refinePx)} title={t({ ja: 'ぼかし', en: 'Blur' })}>
          {t({ ja: 'ぼ', en: 'Blur' })}
        </button>
        <button className="ob-text-btn" onClick={() => smoothSelection(refinePx)} title={t({ ja: 'なめらか', en: 'Smooth' })}>
          {t({ ja: '滑', en: 'Smooth' })}
        </button>
      </div>
    </>
  );
}

function WandOptions() {
  const t = useT();
  const tol = useEditorStore((s) => s.wandTolerance);
  const setTol = useEditorStore((s) => s.setWandTolerance);
  const contiguous = useEditorStore((s) => s.wandContiguous);
  const setContiguous = useEditorStore((s) => s.setWandContiguous);
  const antiAlias = useEditorStore((s) => s.wandAntiAlias);
  const setAntiAlias = useEditorStore((s) => s.setWandAntiAlias);
  const sampleMerged = useEditorStore((s) => s.wandSampleMerged);
  const setSampleMerged = useEditorStore((s) => s.setWandSampleMerged);
  const selection = useEditorStore((s) => s.selection);
  const setSelection = useEditorStore((s) => s.setSelection);
  return (
    <>
      <SelectionModeButtons />
      <span className="ob-divider" />
      <label className="ob-inline">
        {t({ ja: '許容値', en: 'Tolerance' })}
        <ScrubNumber
          className="ob-num"
          value={tol}
          min={0}
          max={255}
          title={t({ ja: '見た目の色差に対する許容値 (0-255)', en: 'Perceptual color tolerance (0-255)' })}
          onChange={(v) => setTol(Math.max(0, Math.min(255, v)))}
        />
      </label>
      <span className="ob-divider" />
      <label className="ob-check" title={t({ ja: 'ON=クリック点から連続した領域 / OFF=全体から近い色を一括選択', en: 'ON=Select contiguous region from click point / OFF=Select all similar colors' })}>
        <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
        {t({ ja: '隣接', en: 'Contiguous' })}
      </label>
      <label className="ob-check" title={t({ ja: '選択の縁を滑らかにする', en: 'Smooth the selection edges' })}>
        <input type="checkbox" checked={antiAlias} onChange={(e) => setAntiAlias(e.target.checked)} />
        AA
      </label>
      <label className="ob-check" title={t({ ja: 'ON=合成結果からサンプル / OFF=アクティブレイヤーのみ', en: 'ON=Sample merged / OFF=Active layer only' })}>
        <input type="checkbox" checked={sampleMerged} onChange={(e) => setSampleMerged(e.target.checked)} />
        {t({ ja: '全レイヤー', en: 'All Layers' })}
      </label>
      <span className="ob-divider" />
      <button className="ob-text-btn" disabled={!selection} onClick={() => setSelection(null)}>
        {t({ ja: '選択を解除', en: 'Deselect' })}
      </button>
      <span className="ob-hint">{t({ ja: '高精度色判定 · クリック=置換 · Shift=加算 · Alt=減算', en: 'Perceptual color matching · Click=Replace · Shift=Add · Alt=Subtract' })}</span>
      <SelectionRefineButtons />
    </>
  );
}

function BrushOptions() {
  const t = useT();
  const [showPicker, setShowPicker] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const size    = useEditorStore((s) => s.brushSize);
  const opacity = useEditorStore((s) => s.brushOpacity);
  const eraser  = useEditorStore((s) => s.brushEraser);
  const setSize    = useEditorStore((s) => s.setBrushSize);
  const setOpacity = useEditorStore((s) => s.setBrushOpacity);
  const fg    = useEditorStore((s) => s.foregroundColor);
  const setFg = useEditorStore((s) => s.setForegroundColor);

  return (
    <>
      <button
        ref={btnRef}
        className={`ob-brush-btn${showPicker ? ' active' : ''}`}
        title={t({ ja: 'ブラシピッカーを開く', en: 'Open Brush Picker' })}
        onClick={() => setShowPicker((v) => !v)}
      >
        <CurrentBrushThumbnail color={fg} w={46} h={24} />
        <span className="ob-brush-btn-label">
          {eraser ? t({ ja: '消しゴム ▾', en: 'Eraser ▾' }) : t({ ja: 'ブラシ ▾', en: 'Brush ▾' })}
        </span>
      </button>

      {showPicker && (
        <BrushPickerPopup
          onClose={() => setShowPicker(false)}
          anchorRef={btnRef}
        />
      )}

      <span className="ob-divider" />
      <label className="ob-inline" title={t({ ja: 'ブラシの直径(px) [ / ]', en: 'Brush diameter (px) [ / ]' })}>
        {t({ ja: 'サイズ', en: 'Size' })}
        <ScrubNumber className="ob-num" value={size} min={1} max={2000} onChange={setSize} />
      </label>
      <label className="ob-inline" title={t({ ja: 'ストローク全体の不透明度', en: 'Overall stroke opacity' })}>
        {t({ ja: '不透明度', en: 'Opacity' })}
        <ScrubNumber className="ob-num" value={opacity} min={1} max={100} onChange={setOpacity} />
      </label>
      <span className="ob-divider" />
      <span className="ob-inline">
        {t({ ja: '色', en: 'Color' })}
        <ColorButton value={fg} onChange={setFg} title={t({ ja: '描画色（前景色）', en: 'Foreground color' })} />
      </span>
      <span className="ob-hint">{t({ ja: 'ドラッグで描画 · Alt=一時スポイト · Shift=直線 · [ ] サイズ · Shift+[ ] 硬さ', en: 'Drag to paint · Alt=temporary Eyedropper · Shift=straight line · [ ] size · Shift+[ ] hardness' })}</span>
    </>
  );
}

function TextOptions() {
  const t = useT();
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.selectedId && l.type === 'text'),
  ) as TextLayer | undefined;
  const updateLayer = useEditorStore((s) => s.updateLayer);
  if (!layer) {
    return <span className="ob-hint">{t({ ja: 'キャンバスをクリックで文字を追加 · 既存文字をダブルクリックで編集', en: 'Click on canvas to add text · Double-click existing text to edit' })}</span>;
  }
  const up = (p: Partial<TextLayer>) => updateLayer(layer.id, p);
  return (
    <>
      <div className="ob-font">
        <FontPicker value={layer.fontFamily} onChange={(f) => up({ fontFamily: f })} />
      </div>
      <ScrubNumber className="ob-num" value={layer.fontSize} min={1} title={t({ ja: 'フォントサイズ', en: 'Font Size' })} onChange={(v) => up({ fontSize: Math.max(1, v) })} />
      <select
        className="ob-sel"
        value={layer.fontStyle}
        title={t({ ja: 'スタイル', en: 'Style' })}
        onChange={(e) => up({ fontStyle: e.target.value as TextLayer['fontStyle'] })}
      >
        <option value="normal">{t({ ja: '通常', en: 'Normal' })}</option>
        <option value="bold">{t({ ja: '太字', en: 'Bold' })}</option>
        <option value="italic">{t({ ja: '斜体', en: 'Italic' })}</option>
        <option value="bold italic">{t({ ja: '太字+斜体', en: 'Bold Italic' })}</option>
      </select>
      <div className="ob-btns">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button
            key={a}
            className={`ob-icon-btn ${layer.align === a ? 'active' : ''}`}
            title={t({
              ja: a === 'left' ? '左揃え' : a === 'center' ? '中央揃え' : '右揃え',
              en: a === 'left' ? 'Left' : a === 'center' ? 'Center' : 'Right',
            })}
            onClick={() => up({ align: a })}
          >
            {a === 'left' ? '⬅' : a === 'center' ? '⬌' : '➡'}
          </button>
        ))}
      </div>
      <ColorButton value={layer.fill} onChange={(c) => up({ fill: c })} title={t({ ja: '文字色', en: 'Text Color' })} />
    </>
  );
}

function ShapeOptions() {
  const t = useT();
  const shapeKind = useEditorStore((s) => s.shapeKind);
  const setShapeKind = useEditorStore((s) => s.setShapeKind);
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.selectedId && l.type === 'shape'),
  ) as ShapeLayer | undefined;
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const up = (p: Partial<ShapeLayer>) => layer && updateLayer(layer.id, p);

  return (
    <>
      <span className="ob-group-label">{t({ ja: '種類', en: 'Type' })}</span>
      <div className="ob-btns">
        {SHAPE_KINDS.map(({ kind, icon, ja, en }) => (
          <button
            key={kind}
            className={`ob-icon-btn ${shapeKind === kind ? 'active' : ''}`}
            title={t({ ja, en })}
            onClick={() => setShapeKind(kind)}
          >
            {icon}
          </button>
        ))}
      </div>
      {layer && (
        <>
          <span className="ob-divider" />
          <span className="ob-inline">
            {t({ ja: '塗', en: 'Fill' })}
            <ColorButton
              value={layer.fill}
              onChange={(c) => up({ fill: c, fillEnabled: true })}
              title={t({ ja: '塗りの色', en: 'Fill color' })}
            />
          </span>
          <span className="ob-inline">
            {t({ ja: '線', en: 'Stroke' })}
            <ColorButton
              value={layer.strokeColor}
              onChange={(c) => up({ strokeColor: c, strokeEnabled: true })}
              title={t({ ja: '線の色', en: 'Stroke color' })}
            />
          </span>
          <ScrubNumber className="ob-num" value={layer.strokeWidth} min={0} step={0.5} precision={1} title={t({ ja: '線の太さ', en: 'Stroke width' })} onChange={(v) => up({ strokeWidth: v })} />
          {layer.shape === 'rect' && (
            <label className="ob-inline" title={t({ ja: '角丸', en: 'Corner Radius' })}>
              {t({ ja: '角丸', en: 'Corner' })}
              <ScrubNumber className="ob-num" value={layer.cornerRadius} min={0} onChange={(v) => up({ cornerRadius: v })} />
            </label>
          )}
        </>
      )}
      <span className="ob-hint">
        {t(
          shapeKind === 'line'
            ? { ja: 'Shift+ドラッグで45°刻みの直線', en: 'Shift+drag for 45° lines' }
            : { ja: 'Shift+ドラッグで正方形・正円', en: 'Shift+drag for square/circle' },
        )}
      </span>
    </>
  );
}

function NavOptions() {
  const t = useT();
  const scale = useEditorStore((s) => s.viewport.scale);
  const z = (d: 'in' | 'out' | '100' | 'fit') =>
    window.dispatchEvent(new CustomEvent('layerlab:zoom', { detail: d }));
  return (
    <>
      <div className="ob-btns">
        <button className="ob-text-btn" onClick={() => z('out')} title={t({ ja: 'ズームアウト (Ctrl -)', en: 'Zoom Out (Ctrl -)' })}>－</button>
        <button className="ob-text-btn" onClick={() => z('in')} title={t({ ja: 'ズームイン (Ctrl +)', en: 'Zoom In (Ctrl +)' })}>＋</button>
        <button className="ob-text-btn" onClick={() => z('100')} title={t({ ja: '100% (Ctrl 1)', en: '100% (Ctrl 1)' })}>100%</button>
        <button className="ob-text-btn" onClick={() => z('fit')} title={t({ ja: '画面に合わせる (Ctrl 0)', en: 'Fit Screen (Ctrl 0)' })}>
          {t({ ja: '画面合わせ', en: 'Fit Screen' })}
        </button>
      </div>
      <span className="ob-spacer" />
      <span className="ob-count">{Math.round(scale * 100)}%</span>
    </>
  );
}
