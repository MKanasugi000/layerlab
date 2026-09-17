import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ColorPickerDialog } from './ColorPickerDialog';
import { ToolIcon, type IconName } from './icons';
import type { Tool, ShapeKind, MarqueeKind } from '../types';
import { useT } from '../i18n/locale';

interface ToolDef {
  tool: Tool;
  label: { ja: string; en: string };
  icon: IconName;
}

const TOOLS_TOP: ToolDef[] = [
  { tool: 'move', label: { ja: '移動 (V)', en: 'Move (V)' }, icon: 'move' },
];

const TOOLS_MID: ToolDef[] = [
  { tool: 'lasso', label: { ja: 'なげなわ (L) — 多角形', en: 'Lasso (L) — Polygonal' }, icon: 'lasso' },
  { tool: 'wand', label: { ja: '自動選択 (W) — マジックワンド', en: 'Magic Wand (W) — Quick Selection' }, icon: 'wand' },
];

const TEXT_TOOL: ToolDef = {
  tool: 'text',
  label: { ja: 'テキスト (T)', en: 'Text (T)' },
  icon: 'text',
};

const TOOLS_BOTTOM: ToolDef[] = [
  { tool: 'crop', label: { ja: '切り抜き (C)', en: 'Crop (C)' }, icon: 'crop' },
  { tool: 'eyedropper', label: { ja: 'スポイト (I)', en: 'Eyedropper (I)' }, icon: 'eyedropper' },
  { tool: 'hand', label: { ja: 'ハンド (H)', en: 'Hand (H)' }, icon: 'hand' },
  { tool: 'zoom', label: { ja: 'ズーム (Z)', en: 'Zoom (Z)' }, icon: 'zoom' },
];

const MARQUEE_LABELS: Record<MarqueeKind, { ja: string; en: string }> = {
  rect: { ja: '長方形選択', en: 'Rectangular Marquee' },
  ellipse: { ja: '楕円形選択', en: 'Elliptical Marquee' },
};

const SHAPE_LABELS: Record<ShapeKind, { ja: string; en: string }> = {
  rect: { ja: '矩形', en: 'Rectangle' },
  ellipse: { ja: '楕円', en: 'Ellipse' },
  line: { ja: '直線', en: 'Line' },
};

const MARQUEE_KINDS: MarqueeKind[] = ['rect', 'ellipse'];
const SHAPE_KINDS: ShapeKind[] = ['rect', 'ellipse', 'line'];

export function LeftToolbar() {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const shapeKind = useEditorStore((s) => s.shapeKind);
  const setTool = useEditorStore((s) => s.setTool);
  const setShapeKind = useEditorStore((s) => s.setShapeKind);
  const marqueeKind = useEditorStore((s) => s.marqueeKind);
  const setMarqueeKind = useEditorStore((s) => s.setMarqueeKind);
  const brushEraser = useEditorStore((s) => s.brushEraser);
  const setBrushEraser = useEditorStore((s) => s.setBrushEraser);
  const foregroundColor = useEditorStore((s) => s.foregroundColor);
  const setForegroundColor = useEditorStore((s) => s.setForegroundColor);
  const backgroundColor = useEditorStore((s) => s.backgroundColor);
  const setBackgroundColor = useEditorStore((s) => s.setBackgroundColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const resetColors = useEditorStore((s) => s.resetColors);
  const resetViewport = useEditorStore((s) => s.resetViewport);
  const [picking, setPicking] = useState<null | 'fg' | 'bg'>(null);

  const toolButton = (tDef: ToolDef) => (
    <button
      key={tDef.tool}
      className={`tool-btn ${tool === tDef.tool ? 'active' : ''}`}
      onClick={() => setTool(tDef.tool)}
      title={t(tDef.label)}
      aria-label={t(tDef.label)}
      aria-pressed={tool === tDef.tool}
    >
      <span className="tool-icon">
        <ToolIcon name={tDef.icon} />
      </span>
    </button>
  );

  return (
    <aside className="left-toolbar" role="toolbar" aria-label={t({ ja: 'ツール', en: 'Tools' })}>
      {TOOLS_TOP.map(toolButton)}
      <div className="shape-group">
        <button
          className={`tool-btn ${tool === 'marquee' ? 'active' : ''}`}
          onClick={() => setTool('marquee')}
          title={t({
            ja: `選択 (M) — ${MARQUEE_LABELS[marqueeKind].ja}, Shift+Mで切替`,
            en: `Selection (M) — ${MARQUEE_LABELS[marqueeKind].en}, Shift+M to toggle`,
          })}
          aria-label={t({
            ja: `選択ツール ${MARQUEE_LABELS[marqueeKind].ja}`,
            en: `Selection Tool ${MARQUEE_LABELS[marqueeKind].en}`,
          })}
          aria-pressed={tool === 'marquee'}
        >
          <span className="tool-icon">
            <ToolIcon name={`marquee-${marqueeKind}`} />
          </span>
        </button>
        {tool === 'marquee' && (
          <div className="shape-submenu">
            {MARQUEE_KINDS.map((k) => (
              <button
                key={k}
                className={`shape-sub ${marqueeKind === k ? 'active' : ''}`}
                onClick={() => setMarqueeKind(k)}
                title={t(MARQUEE_LABELS[k])}
                aria-label={t(MARQUEE_LABELS[k])}
                aria-pressed={marqueeKind === k}
              >
                <ToolIcon name={`marquee-${k}`} size={18} />
              </button>
            ))}
          </div>
        )}
      </div>
      {TOOLS_MID.map(toolButton)}
      <button
        className={`tool-btn ${tool === 'brush' && !brushEraser ? 'active' : ''}`}
        onClick={() => {
          setBrushEraser(false);
          setTool('brush');
        }}
        title={t({ ja: 'ブラシ (B)', en: 'Brush (B)' })}
        aria-label={t({ ja: 'ブラシツール', en: 'Brush Tool' })}
        aria-pressed={tool === 'brush' && !brushEraser}
      >
        <span className="tool-icon"><ToolIcon name="brush" /></span>
      </button>
      <button
        className={`tool-btn ${tool === 'brush' && brushEraser ? 'active' : ''}`}
        onClick={() => {
          setBrushEraser(true);
          setTool('brush');
        }}
        title={t({ ja: '消しゴム (E)', en: 'Eraser (E)' })}
        aria-label={t({ ja: '消しゴムツール', en: 'Eraser Tool' })}
        aria-pressed={tool === 'brush' && brushEraser}
      >
        <span className="tool-icon"><ToolIcon name="eraser" /></span>
      </button>
      {toolButton(TEXT_TOOL)}
      <div className="shape-group">
        <button
          className={`tool-btn ${tool === 'shape' ? 'active' : ''}`}
          onClick={() => setTool('shape')}
          title={t({
            ja: `図形 (U) — ${SHAPE_LABELS[shapeKind].ja}, Shift+Uで切替`,
            en: `Shape (U) — ${SHAPE_LABELS[shapeKind].en}, Shift+U to toggle`,
          })}
          aria-label={t({
            ja: `シェイプツール ${SHAPE_LABELS[shapeKind].ja}`,
            en: `Shape Tool ${SHAPE_LABELS[shapeKind].en}`,
          })}
          aria-pressed={tool === 'shape'}
        >
          <span className="tool-icon">
            <ToolIcon name={`shape-${shapeKind}`} />
          </span>
        </button>
        {tool === 'shape' && (
          <div className="shape-submenu">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                className={`shape-sub ${shapeKind === k ? 'active' : ''}`}
                onClick={() => setShapeKind(k)}
                title={t(SHAPE_LABELS[k])}
                aria-label={t(SHAPE_LABELS[k])}
                aria-pressed={shapeKind === k}
              >
                <ToolIcon name={`shape-${k}`} size={18} />
              </button>
            ))}
          </div>
        )}
      </div>
      {TOOLS_BOTTOM.map(toolButton)}
      <div className="tool-divider" />
      <button
        className="tool-btn fit-btn"
        onClick={resetViewport}
        title={t({ ja: '画面に合わせる (Ctrl+0)', en: 'Fit to Screen (Ctrl+0)' })}
        aria-label={t({ ja: '画面に合わせる', en: 'Fit to Screen' })}
      >
        <span className="tool-icon">
          <ToolIcon name="fit" />
        </span>
      </button>
      <div className="tool-spacer" />
      <div className="color-swatch-wrap">
        <div className="fgbg">
          <button
            type="button"
            className="color-swatch fg"
            title={t({ ja: '前景色 — クリックで変更', en: 'Foreground Color — Click to change' })}
            aria-label={t({ ja: '前景色を変更', en: 'Change Foreground Color' })}
            onClick={() => setPicking('fg')}
          >
            <span className="swatch-display" style={{ background: foregroundColor }} />
          </button>
          <button
            type="button"
            className="color-swatch bg"
            title={t({ ja: '背景色 — クリックで変更', en: 'Background Color — Click to change' })}
            aria-label={t({ ja: '背景色を変更', en: 'Change Background Color' })}
            onClick={() => setPicking('bg')}
          >
            <span className="swatch-display" style={{ background: backgroundColor }} />
          </button>
        </div>
        <div className="swatch-btns">
          <button
            className="swatch-reset"
            onClick={swapColors}
            title={t({ ja: '前景/背景を入替 (X)', en: 'Swap Foreground/Background (X)' })}
            aria-label={t({ ja: '前景色と背景色を入れ替え', en: 'Swap foreground and background colors' })}
          >
            <ToolIcon name="swap" size={15} />
          </button>
          <button
            className="swatch-reset"
            onClick={resetColors}
            title={t({ ja: '既定色 (D) — 黒/白', en: 'Default Colors (D) — Black/White' })}
            aria-label={t({ ja: '既定色（黒/白）にリセット', en: 'Reset to default colors (black/white)' })}
          >
            <ToolIcon name="reset-colors" size={15} />
          </button>
        </div>
      </div>
      {picking === 'fg' && (
        <ColorPickerDialog
          initial={foregroundColor}
          title={t({ ja: '前景色', en: 'Foreground Color' })}
          onApply={setForegroundColor}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'bg' && (
        <ColorPickerDialog
          initial={backgroundColor}
          title={t({ ja: '背景色', en: 'Background Color' })}
          onApply={setBackgroundColor}
          onClose={() => setPicking(null)}
        />
      )}
    </aside>
  );
}
