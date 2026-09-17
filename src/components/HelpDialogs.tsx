import { useT, type Bi } from '../i18n/locale';
import { ModalShell } from './ModalShell';

const SHORTCUTS: Array<[Bi, Array<[string, Bi]>]> = [
  [
    { ja: 'ツール', en: 'Tools' },
    [
      ['V', { ja: '移動', en: 'Move' }],
      ['M', { ja: '長方形選択', en: 'Rectangular Marquee' }],
      ['L', { ja: 'なげなわ', en: 'Lasso' }],
      ['W', { ja: '自動選択 (マジックワンド)', en: 'Magic Wand' }],
      ['B', { ja: 'ブラシ', en: 'Brush' }],
      ['E', { ja: '消しゴム', en: 'Eraser' }],
      ['T', { ja: '横書き文字', en: 'Horizontal Type' }],
      ['U / Shift+U', { ja: 'シェイプ / 種類切替', en: 'Shape / Cycle type' }],
      ['C', { ja: '切り抜き', en: 'Crop' }],
      ['I', { ja: 'スポイト', en: 'Eyedropper' }],
      ['H / Space', { ja: '手のひら / 一時手のひら', en: 'Hand / Temporary hand' }],
      ['Z', { ja: 'ズーム', en: 'Zoom' }],
      ['Alt（ブラシ中）', { ja: '一時スポイト', en: 'Temporary Eyedropper' }],
    ],
  ],
  [
    { ja: '表示・ナビゲーション', en: 'View & Navigation' },
    [
      ['Ctrl+0', { ja: '画面に合わせる', en: 'Fit to screen' }],
      ['Ctrl+1', { ja: '100%表示', en: '100%' }],
      ['Ctrl + / Ctrl -', { ja: 'ズームイン / アウト', en: 'Zoom in / out' }],
      ['Wheel', { ja: 'ポインタ中心ズーム', en: 'Zoom to pointer' }],
      ['Tab', { ja: 'パネルの表示切替', en: 'Toggle panels' }],
    ],
  ],
  [
    { ja: '編集', en: 'Edit' },
    [
      ['Ctrl+Z', { ja: '取り消し', en: 'Undo' }],
      ['Ctrl+Shift+Z / Ctrl+Y', { ja: 'やり直し', en: 'Redo' }],
      ['Ctrl+T', { ja: '変形コントロールを表示', en: 'Show Transform Controls' }],
      ['Ctrl+J', { ja: '選択あり: レイヤーへコピー / 選択なし: 複製', en: 'Selection: Copy to New Layer / No Selection: Duplicate Layer' }],
      ['Ctrl+Shift+J', { ja: '選択をレイヤーへカット', en: 'Cut Selection to New Layer' }],
      ['Shift / Alt+ドラッグ', { ja: '45°固定 / 複製して移動', en: 'Constrain to 45° / Drag a copy' }],
      ['Ctrl+C / Ctrl+X', { ja: '選択ピクセルをコピー / カット', en: 'Copy / Cut selected pixels' }],
      ['Ctrl+V', { ja: 'ペースト', en: 'Paste' }],
      ['Del / Backspace', { ja: '削除', en: 'Delete' }],
      ['Arrows / Shift+Arrows', { ja: '1px / 10px 移動', en: 'Nudge 1px / 10px' }],
    ],
  ],
  [
    { ja: 'レイヤー・選択', en: 'Layers & Selection' },
    [
      ['Ctrl+G / Ctrl+Shift+G', { ja: 'グループ化 / 解除', en: 'Group / Ungroup' }],
      ['Ctrl+Alt+G', { ja: 'クリッピングマスク', en: 'Clipping Mask' }],
      ['Ctrl+] / Ctrl+[', { ja: '前面へ / 背面へ', en: 'Bring Forward / Send Backward' }],
      ['Ctrl+Shift+] / Ctrl+Shift+[', { ja: '最前面へ / 最背面へ', en: 'Bring to Front / Send to Back' }],
      ['Ctrl+Alt+A', { ja: 'すべてのレイヤーを選択', en: 'Select All Layers' }],
      ['Ctrl+A / Ctrl+D', { ja: 'すべて選択 / 選択解除', en: 'Select All / Deselect' }],
      ['Ctrl+Shift+I', { ja: '選択範囲を反転', en: 'Invert Selection' }],
    ],
  ],
  [
    { ja: 'カラー', en: 'Color' },
    [
      ['Ctrl+L / Ctrl+M', { ja: 'レベル補正 / トーンカーブ', en: 'Levels / Curves' }],
      ['Ctrl+U / Ctrl+B', { ja: '色相・彩度 / カラーバランス', en: 'Hue/Saturation / Color Balance' }],
      ['Ctrl+I / Ctrl+Shift+U', { ja: '階調の反転 / 彩度を下げる', en: 'Invert / Desaturate' }],
      ['D', { ja: '描画色/背景色を初期化 (黒/白)', en: 'Reset foreground/background (black/white)' }],
      ['X', { ja: '描画色と背景色を入替', en: 'Swap foreground/background' }],
    ],
  ],
  [
    { ja: 'ファイル', en: 'File' },
    [
      ['Ctrl+S / Ctrl+Shift+S', { ja: '保存 / 名前を付けて保存', en: 'Save / Save As' }],
      ['Ctrl+O', { ja: '開く', en: 'Open' }],
      ['Ctrl+Shift+Alt+S', { ja: '画像を書き出し', en: 'Export Image' }],
    ],
  ],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <ModalShell
      title={t({ ja: 'キーボードショートカット', en: 'Keyboard Shortcuts' })}
      className="shortcuts-modal"
      onClose={onClose}
    >
        <div className="shortcuts-grid">
          {SHORTCUTS.map(([group, rows]) => (
            <div key={group.ja} className="shortcut-group">
              <h3>{t(group)}</h3>
              <table>
                <tbody>
                  {rows.map(([k, d]) => (
                    <tr key={k}>
                      <td className="sc-key">{k}</td>
                      <td className="sc-desc">{t(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t({ ja: '閉じる', en: 'Close' })}
          </button>
        </div>
    </ModalShell>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <ModalShell title="LayerLab" className="about-modal" onClose={onClose}>
        <p className="about-tag">{t({ ja: 'オフライン画像エディタ — Photoshop 互換の操作感', en: 'Offline image editor — Photoshop-like experience' })}</p>
        <ul className="about-list">
          <li>{t({ ja: 'レイヤー / ブレンドモード / レイヤー効果', en: 'Layers / Blend Modes / Layer Effects' })}</li>
          <li>{t({ ja: '文字 · シェイプ · 切り抜き · 整列 · ガイド', en: 'Text · Shape · Crop · Align · Guides' })}</li>
          <li>{t({ ja: '選択ツール (長方形 / 楕円 / なげなわ / 自動選択)', en: 'Selection tools (Rectangle / Ellipse / Lasso / Magic Wand)' })}</li>
          <li>{t({ ja: 'Unity テクスチャ: チャンネルパック · ノーマルマップ · タイル', en: 'Unity Textures: Channel Pack · Normal Map · Tile' })}</li>
        </ul>
        <p className="about-foot">Electron · React · Konva</p>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t({ ja: '閉じる', en: 'Close' })}
          </button>
        </div>
    </ModalShell>
  );
}
