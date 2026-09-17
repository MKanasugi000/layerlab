import { useState } from 'react';
import { workspaceStore } from '../store/editorStore';
import { CANVAS_PRESETS } from '../utils/canvasPresets';
import { ScrubNumber } from './ScrubNumber';
import { ColorButton } from './ColorButton';
import { ModalShell } from './ModalShell';
import { useT } from '../i18n/locale';
import { MAX_CANVAS_DIMENSION, validatePixelSize } from '../utils/canvasLimits';

const POT = [128, 256, 512, 1024, 2048, 4096];

/** プリセットのカテゴリ表示順とラベル（サムネ系を先頭に）。 */
const CATEGORIES: { key: 'banner' | 'social' | 'unity'; label: string }[] = [
  { key: 'banner', label: 'サムネ / バナー' },
  { key: 'social', label: 'SNS 投稿' },
  { key: 'unity', label: 'Unity テクスチャ' },
];

/**
 * 新規ドキュメント作成ダイアログ。
 * サムネ・SNS・テクスチャのプリセットをワンクリックで選べる。
 */
export function NewDocumentDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [w, setW] = useState(1280);
  const [h, setH] = useState(720);
  const [bg, setBg] = useState('#ffffff');
  const [link, setLink] = useState(false);
  const [presetId, setPresetId] = useState<string>('yt-thumb');

  const choosePreset = (id: string, pw: number, ph: number) => {
    setPresetId(id);
    setW(pw);
    setH(ph);
  };

  const ratio = w / h;
  const sizeValidation = validatePixelSize(w, h);
  const changeW = (v: number) => {
    const nv = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(v) || 1));
    setPresetId('');
    setW(nv);
    if (link) setH(Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(nv / ratio))));
  };
  const changeH = (v: number) => {
    const nv = Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(v) || 1));
    setPresetId('');
    setH(nv);
    if (link) setW(Math.min(MAX_CANVAS_DIMENSION, Math.max(1, Math.round(nv * ratio))));
  };

  const create = () => {
    if (!sizeValidation.ok) return;
    // 新しいタブとして開く（既存ドキュメントは破棄しない）
    workspaceStore.getState().newDoc({ width: sizeValidation.width, height: sizeValidation.height, background: bg });
    onClose();
  };

  return (
    <ModalShell
      title={t({ ja: '新規ドキュメント', en: 'New Document' })}
      className="newdoc-modal"
      onClose={onClose}
    >
        <div className="newdoc-presets">
          {CATEGORIES.map((cat) => (
            <div key={cat.key} className="newdoc-cat">
              <div className="newdoc-cat-label">
                {cat.key === 'banner'
                  ? t({ ja: 'サムネ / バナー', en: 'Thumbnail / Banner' })
                  : cat.key === 'social'
                  ? t({ ja: 'SNS 投稿', en: 'SNS Post' })
                  : t({ ja: 'Unity テクスチャ', en: 'Unity Texture' })}
              </div>
              <div className="newdoc-chip-row">
                {CANVAS_PRESETS.filter((p) => p.category === cat.key).map((p) => (
                  <button
                    key={p.id}
                    className={`newdoc-chip ${presetId === p.id ? 'active' : ''}`}
                    onClick={() => choosePreset(p.id, p.width, p.height)}
                    title={`${p.width} × ${p.height} px`}
                  >
                    <span className="newdoc-chip-name">{t({ ja: p.label, en: p.labelEn ?? p.label })}</span>
                    <span className="newdoc-chip-dim">
                      {p.width}×{p.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
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
                onClick={() => choosePreset('', n, link ? n : h)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-row bg-row">
          <label className="bg-color-label">
            {t({ ja: '背景色', en: 'Background' })}
            <ColorButton value={bg === 'transparent' ? '#ffffff' : bg} onChange={setBg} title={t({ ja: '背景色', en: 'Background' })} />
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
          {w} × {h} px {bg === 'transparent' ? t({ ja: '· 透過背景', en: '· Transparent BG' }) : ''}
        </div>
        {!sizeValidation.ok && (
          <div className="modal-row warn">
            {t({ ja: 'サイズが大きすぎます。各辺8192px・合計32MP以内にしてください。', en: 'Canvas is too large. Use at most 8192px per side and 32MP total.' })}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>{t({ ja: 'キャンセル', en: 'Cancel' })}</button>
          <button className="primary" onClick={create} disabled={!sizeValidation.ok}>
            {t({ ja: '作成', en: 'Create' })}
          </button>
        </div>
    </ModalShell>
  );
}
