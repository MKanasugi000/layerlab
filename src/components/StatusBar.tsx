import { useT } from '../i18n/locale';
import { useEditorStore } from '../store/editorStore';
import { getLayerBounds } from '../utils/alignment';
import { photoshopToolHint } from '../interactions/photoshopHints';

const TOOL_NAMES: Record<string, { ja: string; en: string }> = {
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

export function StatusBar() {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const scale = useEditorStore((s) => s.viewport.scale);
  const tool = useEditorStore((s) => s.tool);
  const brushEraser = useEditorStore((s) => s.brushEraser);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const layer = useEditorStore((s) =>
    s.layers.find((l) => l.id === s.selectedId),
  );

  const single = selectedIds.length <= 1 && layer ? getLayerBounds(layer) : null;
  const toolHint = photoshopToolHint({ tool, brushEraser });

  return (
    <footer className="statusbar">
      <button
        className="sb-zoom"
        title={t({ ja: 'クリックで100%表示', en: 'Click to show 100%' })}
        onClick={() => window.dispatchEvent(new CustomEvent('layerlab:zoom', { detail: '100' }))}
      >
        {Math.round(scale * 100)}%
      </button>
      <span className="sb-sep" />
      <span className="sb-doc">
        {canvas.width} × {canvas.height} px
      </span>
      <span className="sb-sep" />
      <span className="sb-tool">
        {tool === 'brush' && brushEraser
          ? t({ ja: '消しゴムツール', en: 'Eraser Tool' })
          : t(TOOL_NAMES[tool] ?? { ja: `${tool}ツール`, en: `${tool} Tool` })}
      </span>
      <span className="sb-hint">{t(toolHint)}</span>
      <span className="sb-spacer" />
      {single && selectedId && (
        <span className="sb-sel">
          {layer?.name} · {Math.round(single.width)} × {Math.round(single.height)} px
        </span>
      )}
      {selectedIds.length > 1 && (
        <span className="sb-sel">
          {t({ ja: `${selectedIds.length} レイヤー選択中`, en: `${selectedIds.length} layers selected` })}
        </span>
      )}
    </footer>
  );
}
