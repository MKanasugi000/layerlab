import { useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { useEditorStore } from '../store/editorStore';
import { useT } from '../i18n/locale';
import { renderCompositeCanvas } from '../utils/selectionOps';
import { ModalShell } from './ModalShell';

type ViewMode = 'tile3x3' | 'offset50' | 'side';

export function TilePreviewDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<ViewMode>('tile3x3');
  const [previewSize, setPreviewSize] = useState(180);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stage = Konva.stages[0];
    if (!stage) {
      if (!cancelled) setError(t({ ja: 'Konva Stage が見つかりません', en: 'Konva Stage not found' }));
      return undefined;
    }
    // The preview is at most 3×320 CSS pixels. Rendering an 8192×4096 PNG and
    // decoding it again consumed hundreds of MiB without improving the view.
    const previewScale = Math.min(1, 1024 / Math.max(canvas.width, canvas.height));
    const rendered = renderCompositeCanvas(previewScale);
    if (!rendered) {
      if (!cancelled) setError(t({ ja: 'キャンバスの描画に失敗しました', en: 'Canvas rendering failed' }));
      return undefined;
    }
    setSnapshot(rendered);
    return () => {
      cancelled = true;
      rendered.width = 1;
      rendered.height = 1;
    };
  }, [canvas.width, canvas.height, t]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !snapshot) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const tileW = previewSize;
    const tileH = (previewSize * canvas.height) / canvas.width;

    if (mode === 'tile3x3') {
      cv.width = tileW * 3;
      cv.height = tileH * 3;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          ctx.drawImage(snapshot, x * tileW, y * tileH, tileW, tileH);
        }
      }
      ctx.strokeStyle = 'rgba(91, 158, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(tileW, tileH, tileW, tileH);
    } else if (mode === 'offset50') {
      cv.width = tileW * 2;
      cv.height = tileH * 2;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const hx = tileW;
      const hy = tileH;
      ctx.drawImage(snapshot, hx, hy, tileW, tileH);
      ctx.drawImage(snapshot, -hx + tileW * 2, hy, tileW, tileH);
      ctx.drawImage(snapshot, hx, -hy + tileH * 2, tileW, tileH);
      ctx.drawImage(snapshot, -hx + tileW * 2, -hy + tileH * 2, tileW, tileH);
      ctx.strokeStyle = 'rgba(255, 90, 90, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, tileH);
      ctx.lineTo(tileW * 2, tileH);
      ctx.moveTo(tileW, 0);
      ctx.lineTo(tileW, tileH * 2);
      ctx.stroke();
    } else {
      cv.width = tileW * 2 + 8;
      cv.height = tileH;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(snapshot, 0, 0, tileW, tileH);
      ctx.drawImage(snapshot, tileW + 8, 0, tileW, tileH);
    }
  }, [snapshot, mode, previewSize, canvas.width, canvas.height]);

  return (
    <ModalShell
      title={t({ ja: 'タイル可能プレビュー', en: 'Tileable Preview' })}
      className="tile-preview-modal"
      onClose={onClose}
    >
        <div className="modal-row info">
          {t({ ja: `ソース: ${canvas.width} × ${canvas.height} px · シーム確認用`, en: `Source: ${canvas.width} × ${canvas.height} px · Seam check` })}
        </div>
        <div className="modal-row tile-mode-row">
          <button
            className={mode === 'tile3x3' ? 'active' : ''}
            onClick={() => setMode('tile3x3')}
          >
            {t({ ja: '3×3 タイル', en: '3×3 Tile' })}
          </button>
          <button
            className={mode === 'offset50' ? 'active' : ''}
            onClick={() => setMode('offset50')}
          >
            {t({ ja: '50% オフセット (シーム強調)', en: '50% Offset (Seam Emphasis)' })}
          </button>
          <button
            className={mode === 'side' ? 'active' : ''}
            onClick={() => setMode('side')}
          >
            {t({ ja: '水平2連', en: 'Horizontal 2-Up' })}
          </button>
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: `プレビューサイズ: ${previewSize} px`, en: `Preview Size: ${previewSize} px` })}
            <input
              type="range"
              min={80}
              max={320}
              step={20}
              value={previewSize}
              onChange={(e) => setPreviewSize(parseInt(e.target.value))}
            />
          </label>
        </div>
        {error && <div className="modal-row warn">{error}</div>}
        <div className="tile-preview-stage">
          {!snapshot && !error && <div className="tile-loading">{t({ ja: 'プレビュー生成中...', en: 'Generating preview...' })}</div>}
          <canvas ref={canvasRef} />
        </div>
        <div className="modal-row hint-row">
          {t({ ja: '赤線でシームが見えるなら境界ピクセルを修正、青枠が中心タイル。', en: 'If you see seams along the red lines, fix boundary pixels; the blue frame indicates the center tile.' })}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t({ ja: '閉じる', en: 'Close' })}
          </button>
        </div>
    </ModalShell>
  );
}
