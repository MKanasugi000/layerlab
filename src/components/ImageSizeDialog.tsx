import { useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { CANVAS_PRESETS } from '../utils/canvasPresets';
import { ScrubNumber } from './ScrubNumber';
import { ColorButton } from './ColorButton';
import { ModalShell } from './ModalShell';
import { useT } from '../i18n/locale';
import { MAX_CANVAS_DIMENSION, validatePixelSize } from '../utils/canvasLimits';

const POT = [128, 256, 512, 1024, 2048, 4096];

export function ImageSizeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const setCanvas = useEditorStore((s) => s.setCanvas);
  const [w, setW] = useState(canvas.width);
  const [h, setH] = useState(canvas.height);
  const [bg, setBg] = useState(canvas.background);
  const [link, setLink] = useState(false);
  const ratio = canvas.width / canvas.height;
  const sizeValidation = validatePixelSize(w, h);

  const changeW = (v: number) => {
    const nv = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(v) || 1));
    setW(nv);
    if (link) setH(Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(nv / ratio))));
  };
  const changeH = (v: number) => {
    const nv = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(v) || 1));
    setH(nv);
    if (link) setW(Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(nv * ratio))));
  };

  const apply = () => {
    if (!sizeValidation.ok) return;
    setCanvas({ width: sizeValidation.width, height: sizeValidation.height, background: bg });
    onClose();
  };

  return (
    <ModalShell title={t({ ja: 'カンバスサイズ', en: 'Canvas Size' })} onClose={onClose}>
        <div className="modal-row">
          <label>
            {t({ ja: 'プリセット', en: 'Preset' })}
            <select
              value=""
              onChange={(e) => {
                const p = CANVAS_PRESETS.find((x) => x.id === e.target.value);
                if (p) {
                  setW(p.width);
                  setH(p.height);
                }
              }}
            >
              <option value="">{t({ ja: '選択...', en: 'Select...' })}</option>
              <optgroup label={t({ ja: 'バナー / ソーシャル', en: 'Banner / Social' })}>
                {CANVAS_PRESETS.filter(
                  (p) => p.category === 'banner' || p.category === 'social',
                ).map((p) => (
                  <option key={p.id} value={p.id}>
                    {t({ ja: p.label, en: p.labelEn ?? p.label })} ({p.width}×{p.height})
                  </option>
                ))}
              </optgroup>
              <optgroup label={t({ ja: 'Unity テクスチャ', en: 'Unity Texture' })}>
                {CANVAS_PRESETS.filter((p) => p.category === 'unity').map((p) => (
                  <option key={p.id} value={p.id}>
                    {t({ ja: p.label, en: p.labelEn ?? p.label })}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>

        <div className="modal-row size-row">
          <label>
            {t({ ja: '幅 px', en: 'Width px' })}
            <ScrubNumber value={w} min={1} max={MAX_CANVAS_DIMENSION} onChange={(v) => changeW(v)} />
          </label>
          <button
            className={`link-aspect ${link ? 'on' : ''}`}
            onClick={() => setLink(!link)}
            title={t({ ja: '縦横比を固定', en: 'Lock Aspect Ratio' })}
          >
            {link ? '🔗' : '⛓️‍💥'}
          </button>
          <label>
            {t({ ja: '高さ px', en: 'Height px' })}
            <ScrubNumber value={h} min={1} max={MAX_CANVAS_DIMENSION} onChange={(v) => changeH(v)} />
          </label>
        </div>

        <div className="modal-row">
          <span className="pot-label">Power of 2:</span>
          <div className="pot-row">
            {POT.map((n) => (
              <button
                key={n}
                className="pot-chip"
                onClick={() => {
                  setW(n);
                  if (link) setH(n);
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-row bg-row">
          <label className="bg-color-label">
            {t({ ja: '背景色', en: 'Background Color' })}
            <ColorButton
              value={bg === 'transparent' ? '#ffffff' : bg}
              onChange={setBg}
              title={t({ ja: '背景色', en: 'Background Color' })}
            />
          </label>
          <button
            className={`bg-trans ${bg === 'transparent' ? 'on' : ''}`}
            onClick={() => setBg(bg === 'transparent' ? '#ffffff' : 'transparent')}
          >
            {bg === 'transparent'
              ? t({ ja: '透過 ✓', en: 'Transparent ✓' })
              : t({ ja: '透過にする', en: 'Make Transparent' })}
          </button>
        </div>

        <div className="modal-row info">
          {w} × {h} px {bg === 'transparent' ? `· ${t({ ja: '透過背景', en: 'Transparent Background' })}` : ''}
        </div>
        {!sizeValidation.ok && (
          <div className="modal-row warn">
            {t({ ja: 'サイズが大きすぎます。各辺8192px・合計32MP以内にしてください。', en: 'Canvas is too large. Use at most 8192px per side and 32MP total.' })}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{t({ ja: 'キャンセル', en: 'Cancel' })}</button>
          <button className="primary" onClick={apply} disabled={!sizeValidation.ok}>
            {t({ ja: '適用', en: 'Apply' })}
          </button>
        </div>
    </ModalShell>
  );
}
