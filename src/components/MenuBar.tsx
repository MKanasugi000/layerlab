import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  useEditorStore,
  undo,
  redo,
  useCanUndo,
  useCanRedo,
} from '../store/editorStore';
import { CANVAS_PRESETS } from '../utils/canvasPresets';
import { saveCurrent, saveCurrentAs, openProject, openPsdFile } from '../utils/projectIo';
import { pasteFromClipboard } from '../utils/clipboardPaste';
import { pickImageFiles, fileToImageLayer } from '../utils/imageImport';
import {
  addBlankLayer,
  deleteSelectedLayers,
  duplicateSelectedLayers,
  mergeSelectedLayers,
} from '../utils/layerActions';
import {
  fillSelection,
  cropToSelection,
  cropLayerToSelection,
  newLayerFromSelection,
  copyLayerSelectionToClipboard,
} from '../utils/selectionOps';
import { useT, useLocale, t, type Bi } from '../i18n/locale';
import type { AdjustmentMode } from '../imaging/colorAdjustments';

type Item =
  | { sep: true }
  | {
      label: Bi;
      shortcut?: string;
      onClick?: () => void;
      disabled?: boolean;
      checked?: boolean;
      children?: Item[];
    };

interface Menu {
  key: string;
  title: Bi;
  items: Item[];
}

const POT = [128, 256, 512, 1024, 2048, 4096];

function emitZoom(detail: 'in' | 'out' | '100' | 'fit') {
  window.dispatchEvent(new CustomEvent('layerlab:zoom', { detail }));
}

async function placeImages() {
  const files = await pickImageFiles();
  const add = useEditorStore.getState().addLayer;
  for (const f of files) {
    try {
      add(await fileToImageLayer(f));
    } catch (error) {
      alert(`${t({ ja: '画像読み込み失敗', en: 'Image import failed' })}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function doSave() {
  const r = await saveCurrent();
  if (!r.ok && r.error && r.error !== 'cancelled')
    alert(`${t({ ja: '保存失敗', en: 'Save failed' })}: ${r.error}`);
}
async function doSaveAs() {
  const r = await saveCurrentAs();
  if (!r.ok && r.error && r.error !== 'cancelled')
    alert(`${t({ ja: '保存失敗', en: 'Save failed' })}: ${r.error}`);
}
async function doOpen() {
  const r = await openProject();
  if (!r.ok && r.error && r.error !== 'cancelled')
    alert(`${t({ ja: '読み込み失敗', en: 'Open failed' })}: ${r.error}`);
}

async function importPsd() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.psd,.psb';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return;
    const r = await openPsdFile(f);
    if (!r.ok && r.error)
      alert(`${t({ ja: 'PSD読み込み失敗', en: 'PSD import failed' })}: ${r.error}`);
  };
  inp.click();
}

export interface MenuBarProps {
  onNew: () => void;
  onExport: () => void;
  onBatchExport: () => void;
  onChannelPack: () => void;
  onNormalMap: () => void;
  onPbrMaps: () => void;
  onLightingPreview: () => void;
  onTilePreview: () => void;
  onImageSize: () => void;
  onAdjustment: (mode: AdjustmentMode) => void;
  onInvertImage: () => void;
  onDesaturateImage: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
}

export function MenuBar(props: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [openFocus, setOpenFocus] = useState<'first' | 'last' | null>(null);
  const [activeTopIndex, setActiveTopIndex] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const menuButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const t = useT();
  const locale = useLocale((st) => st.locale);
  const setLocale = useLocale((st) => st.setLocale);

  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const s = useEditorStore();
  const selectedId = s.selectedId;
  const hasLayers = s.layers.length > 0;
  const hasSel = s.selection != null;
  const selLayer = s.layers.find((l) => l.id === selectedId);
  const selImageId = selLayer && selLayer.type === 'image' ? selLayer.id : null;
  const canAdjustImage = !!(selLayer && selLayer.type === 'image' && !selLayer.normalGen);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = (fn?: () => void) => {
    setOpen(null);
    setOpenFocus(null);
    fn?.();
  };

  const menus: Menu[] = [
    {
      key: 'file',
      title: { ja: 'ファイル', en: 'File' },
      items: [
        { label: { ja: '新規...', en: 'New...' }, shortcut: 'Ctrl+N', onClick: props.onNew },
        { label: { ja: '開く...', en: 'Open...' }, shortcut: 'Ctrl+O', onClick: doOpen },
        { label: { ja: 'PSDを読み込む...', en: 'Import PSD...' }, onClick: importPsd },
        { label: { ja: '画像を配置...', en: 'Place Image...' }, onClick: placeImages },
        { sep: true },
        { label: { ja: '保存', en: 'Save' }, shortcut: 'Ctrl+S', onClick: doSave },
        { label: { ja: '名前を付けて保存...', en: 'Save As...' }, shortcut: 'Ctrl+Shift+S', onClick: doSaveAs },
        { sep: true },
        { label: { ja: '書き出し...', en: 'Export...' }, shortcut: 'Ctrl+Shift+Alt+S', onClick: props.onExport },
        { label: { ja: '一括書き出し...', en: 'Batch Export...' }, onClick: props.onBatchExport },
      ],
    },
    {
      key: 'edit',
      title: { ja: '編集', en: 'Edit' },
      items: [
        { label: { ja: '取り消し', en: 'Undo' }, shortcut: 'Ctrl+Z', onClick: undo, disabled: !canUndo },
        { label: { ja: 'やり直し', en: 'Redo' }, shortcut: 'Ctrl+Shift+Z', onClick: redo, disabled: !canRedo },
        { sep: true },
        {
          label: { ja: 'カット', en: 'Cut' },
          shortcut: 'Ctrl+X',
          onClick: () => copyLayerSelectionToClipboard(true),
          disabled: !selImageId,
        },
        {
          label: { ja: 'コピー', en: 'Copy' },
          shortcut: 'Ctrl+C',
          onClick: () => copyLayerSelectionToClipboard(false),
          disabled: !selImageId,
        },
        {
          label: { ja: 'ペースト', en: 'Paste' },
          shortcut: 'Ctrl+V',
          onClick: () => pasteFromClipboard(),
        },
        {
          label: hasSel
            ? { ja: '選択範囲をコピーして新規レイヤー', en: 'New Layer via Copy' }
            : { ja: 'レイヤーを複製', en: 'Duplicate Layer' },
          shortcut: 'Ctrl+J',
          onClick: () => {
            if (hasSel) void newLayerFromSelection(false);
            else duplicateSelectedLayers();
          },
          disabled: !selectedId,
        },
        {
          label: { ja: '選択範囲をカットして新規レイヤー', en: 'New Layer via Cut' },
          shortcut: 'Ctrl+Shift+J',
          onClick: () => void newLayerFromSelection(true),
          disabled: !hasSel,
        },
        { sep: true },
        {
          label: { ja: '変形コントロールを表示', en: 'Show Transform Controls' },
          shortcut: 'Ctrl+T',
          onClick: () => s.setTool('move'),
          disabled: !selectedId,
        },
        {
          label: { ja: '塗りつぶし（前景色）', en: 'Fill (Foreground)' },
          shortcut: 'Shift+F5',
          onClick: () => fillSelection('fg'),
          disabled: !hasSel,
        },
      ],
    },
    {
      key: 'image',
      title: { ja: 'イメージ', en: 'Image' },
      items: [
        {
          label: { ja: '色調補正', en: 'Adjustments' },
          children: [
            { label: { ja: '明るさ・コントラスト...', en: 'Brightness/Contrast...' }, onClick: () => props.onAdjustment('brightnessContrast'), disabled: !canAdjustImage },
            { label: { ja: 'レベル補正...', en: 'Levels...' }, shortcut: 'Ctrl+L', onClick: () => props.onAdjustment('levels'), disabled: !canAdjustImage },
            { label: { ja: 'トーンカーブ...', en: 'Curves...' }, shortcut: 'Ctrl+M', onClick: () => props.onAdjustment('curves'), disabled: !canAdjustImage },
            { label: { ja: '露光量...', en: 'Exposure...' }, onClick: () => props.onAdjustment('exposure'), disabled: !canAdjustImage },
            { sep: true },
            { label: { ja: '自然な彩度...', en: 'Vibrance...' }, onClick: () => props.onAdjustment('vibrance'), disabled: !canAdjustImage },
            { label: { ja: '色相・彩度...', en: 'Hue/Saturation...' }, shortcut: 'Ctrl+U', onClick: () => props.onAdjustment('hueSaturation'), disabled: !canAdjustImage },
            { label: { ja: '彩度を下げる', en: 'Desaturate' }, shortcut: 'Ctrl+Shift+U', onClick: props.onDesaturateImage, disabled: !canAdjustImage },
            { label: { ja: 'カラーバランス...', en: 'Color Balance...' }, shortcut: 'Ctrl+B', onClick: () => props.onAdjustment('colorBalance'), disabled: !canAdjustImage },
            { label: { ja: '白黒...', en: 'Black & White...' }, shortcut: 'Ctrl+Shift+Alt+B', onClick: () => props.onAdjustment('blackAndWhite'), disabled: !canAdjustImage },
            { sep: true },
            { label: { ja: '階調の反転', en: 'Invert' }, shortcut: 'Ctrl+I', onClick: props.onInvertImage, disabled: !canAdjustImage },
          ],
        },
        { sep: true },
        { label: { ja: 'カンバスサイズ...', en: 'Canvas Size...' }, shortcut: 'Ctrl+Alt+C', onClick: props.onImageSize },
        {
          label: { ja: 'カンバスを画像に合わせる', en: 'Fit Canvas to Image' },
          onClick: () => selImageId && s.fitCanvasToLayer(selImageId),
          disabled: !selImageId,
        },
        {
          label: { ja: 'プリセット', en: 'Presets' },
          children: CANVAS_PRESETS.map((p) => ({
            label: {
              ja: `${p.label} (${p.width}×${p.height})`,
              en: `${p.labelEn ?? p.label} (${p.width}×${p.height})`,
            },
            onClick: () => s.setCanvas({ width: p.width, height: p.height }),
          })),
        },
        { sep: true },
        {
          label: { ja: '選択範囲でレイヤーを切り抜き', en: 'Crop Layer to Selection' },
          onClick: () => cropLayerToSelection(),
          disabled: !hasSel,
        },
        {
          label: { ja: '選択範囲でカンバスを切り抜き', en: 'Crop Canvas to Selection' },
          onClick: () => cropToSelection(),
          disabled: !hasSel,
        },
      ],
    },
    {
      key: 'texture',
      title: { ja: 'テクスチャ', en: 'Texture' },
      items: [
        { label: { ja: 'チャンネルパッカー...', en: 'Channel Packer...' }, onClick: props.onChannelPack },
        { label: { ja: 'ノーマルマップ生成（右で調整）', en: 'Generate Normal Map (adjust on right)' }, onClick: props.onNormalMap },
        { label: { ja: 'PBRマップ一括生成...', en: 'Generate PBR Maps...' }, onClick: props.onPbrMaps },
        { label: { ja: '3Dライティングプレビュー...', en: '3D Lighting Preview...' }, onClick: props.onLightingPreview },
        { label: { ja: 'タイルプレビュー...', en: 'Tile Preview...' }, onClick: props.onTilePreview },
        { sep: true },
        {
          label: { ja: 'Power of 2 スナップ', en: 'Power of 2 Snap' },
          children: POT.map((n) => ({
            label: { ja: `${n} × ${n}`, en: `${n} × ${n}` },
            onClick: () => s.setCanvas({ width: n, height: n }),
          })),
        },
      ],
    },
    {
      key: 'layer',
      title: { ja: 'レイヤー', en: 'Layer' },
      items: [
        {
          label: { ja: '新規レイヤー', en: 'New Layer' },
          shortcut: 'Ctrl+Shift+N',
          onClick: () => addBlankLayer(),
        },
        { sep: true },
        {
          label: { ja: 'グループ化', en: 'Group' },
          shortcut: 'Ctrl+G',
          onClick: s.groupSelected,
          disabled: !selectedId,
        },
        {
          label: { ja: 'グループ解除', en: 'Ungroup' },
          shortcut: 'Ctrl+Shift+G',
          onClick: s.ungroupSelected,
          disabled: !selectedId,
        },
        {
          label: { ja: 'レイヤーを統合', en: 'Merge Layers' },
          shortcut: 'Ctrl+E',
          onClick: () => mergeSelectedLayers(),
          disabled: s.selectedIds.length < 2
            && !s.layers.some((layer) => layer.type === 'group' && s.selectedIds.includes(layer.id)),
        },
        {
          label: { ja: 'クリッピングマスク作成/解除', en: 'Create/Release Clipping Mask' },
          shortcut: 'Ctrl+Alt+G',
          onClick: () => selectedId && s.toggleClipped(selectedId),
          disabled: !selectedId,
        },
        { sep: true },
        {
          label: { ja: '前面へ', en: 'Bring Forward' },
          shortcut: 'Ctrl+]',
          onClick: () => selectedId && s.moveLayer(selectedId, 'up'),
          disabled: !selectedId,
        },
        {
          label: { ja: '背面へ', en: 'Send Backward' },
          shortcut: 'Ctrl+[',
          onClick: () => selectedId && s.moveLayer(selectedId, 'down'),
          disabled: !selectedId,
        },
        {
          label: { ja: '最前面へ', en: 'Bring to Front' },
          shortcut: 'Ctrl+Shift+]',
          onClick: () => selectedId && s.moveLayerEnd(selectedId, 'front'),
          disabled: !selectedId,
        },
        {
          label: { ja: '最背面へ', en: 'Send to Back' },
          shortcut: 'Ctrl+Shift+[',
          onClick: () => selectedId && s.moveLayerEnd(selectedId, 'back'),
          disabled: !selectedId,
        },
        {
          label: { ja: '選択範囲をコピーして新規レイヤー', en: 'New Layer via Copy' },
          shortcut: 'Ctrl+J',
          onClick: () => void newLayerFromSelection(false),
          disabled: !hasSel,
        },
        {
          label: { ja: '選択範囲をカットして新規レイヤー', en: 'New Layer via Cut' },
          shortcut: 'Ctrl+Shift+J',
          onClick: () => void newLayerFromSelection(true),
          disabled: !hasSel,
        },
        { sep: true },
        {
          label: { ja: 'レイヤーを削除', en: 'Delete Layer' },
          shortcut: 'Del',
          onClick: () => deleteSelectedLayers(),
          disabled: !selectedId,
        },
      ],
    },
    {
      key: 'select',
      title: { ja: '選択範囲', en: 'Select' },
      items: [
        {
          label: { ja: 'すべてを選択', en: 'Select All' },
          shortcut: 'Ctrl+A',
          onClick: () =>
            s.setSelection({
              type: 'rect',
              x: 0,
              y: 0,
              width: s.canvas.width,
              height: s.canvas.height,
            }),
        },
        {
          label: { ja: '選択を解除', en: 'Deselect' },
          shortcut: 'Ctrl+D',
          onClick: () => s.setSelection(null),
          disabled: !hasSel,
        },
        {
          label: { ja: '選択範囲を反転', en: 'Invert Selection' },
          shortcut: 'Ctrl+Shift+I',
          onClick: () => s.invertSelection(),
          disabled: !hasSel,
        },
        { sep: true },
        {
          label: { ja: '選択範囲を変更', en: 'Modify Selection' },
          children: [
            { label: { ja: '拡張 (1px)', en: 'Expand (1px)' }, onClick: () => s.growSelection(1), disabled: !hasSel },
            { label: { ja: '縮小 (1px)', en: 'Contract (1px)' }, onClick: () => s.shrinkSelection(1), disabled: !hasSel },
            { label: { ja: 'ぼかし (2px)', en: 'Feather (2px)' }, onClick: () => s.featherSelection(2), disabled: !hasSel },
            { label: { ja: 'なめらか (2px)', en: 'Smooth (2px)' }, onClick: () => s.smoothSelection(2), disabled: !hasSel },
          ],
        },
        { sep: true },
        {
          label: { ja: 'すべてのレイヤー', en: 'All Layers' },
          shortcut: 'Ctrl+Alt+A',
          onClick: () =>
            s.selectMany(s.layers.filter((l) => l.type !== 'group').map((l) => l.id)),
          disabled: !hasLayers,
        },
      ],
    },
    {
      key: 'view',
      title: { ja: '表示', en: 'View' },
      items: [
        { label: { ja: 'ズームイン', en: 'Zoom In' }, shortcut: 'Ctrl++', onClick: () => emitZoom('in') },
        { label: { ja: 'ズームアウト', en: 'Zoom Out' }, shortcut: 'Ctrl+-', onClick: () => emitZoom('out') },
        { label: { ja: '100%', en: '100%' }, shortcut: 'Ctrl+1', onClick: () => emitZoom('100') },
        { label: { ja: '画面に合わせる', en: 'Fit to Screen' }, shortcut: 'Ctrl+0', onClick: () => emitZoom('fit') },
        { sep: true },
        {
          label: { ja: 'ガイドを表示', en: 'Show Guides' },
          shortcut: 'Ctrl+Shift+;',
          checked: s.showGuides,
          onClick: s.toggleShowGuides,
        },
        { label: { ja: 'ガイドを消去', en: 'Clear Guides' }, onClick: s.clearGuides, disabled: s.guides.length === 0 },
        { sep: true },
        {
          label: { ja: 'パネルを隠す', en: 'Hide Panels' },
          shortcut: 'Tab',
          checked: !s.panelsVisible,
          onClick: s.togglePanels,
        },
        { sep: true },
        {
          label: { ja: '言語 / Language', en: 'Language / 言語' },
          children: [
            { label: { ja: '日本語', en: '日本語 (Japanese)' }, checked: locale === 'ja', onClick: () => setLocale('ja') },
            { label: { ja: 'English', en: 'English' }, checked: locale === 'en', onClick: () => setLocale('en') },
          ],
        },
      ],
    },
    {
      key: 'help',
      title: { ja: 'ヘルプ', en: 'Help' },
      items: [
        { label: { ja: 'キーボードショートカット一覧', en: 'Keyboard Shortcuts' }, onClick: props.onShortcuts },
        { label: { ja: 'LayerLab について', en: 'About LayerLab' }, onClick: props.onAbout },
      ],
    },
  ];

  const focusTopMenu = (index: number) => {
    const next = (index + menus.length) % menus.length;
    setActiveTopIndex(next);
    menuButtonRefs.current[next]?.focus();
    return next;
  };

  const restoreTopFocus = (index: number) => {
    setOpen(null);
    setOpenFocus(null);
    requestAnimationFrame(() => focusTopMenu(index));
  };

  const moveOpenMenu = (index: number, delta: -1 | 1) => {
    const next = (index + delta + menus.length) % menus.length;
    setActiveTopIndex(next);
    setOpen(menus[next].key);
    setOpenFocus('first');
  };

  const handleTopMenuKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const menu = menus[index];
    switch (event.key) {
      case 'Enter':
      case ' ':
      case 'ArrowDown':
        event.preventDefault();
        setOpen(menu.key);
        setOpenFocus('first');
        return;
      case 'ArrowUp':
        event.preventDefault();
        setOpen(menu.key);
        setOpenFocus('last');
        return;
      case 'ArrowLeft':
        event.preventDefault();
        {
          const next = focusTopMenu(index - 1);
          if (open) {
            setOpen(menus[next].key);
            setOpenFocus(null);
          }
        }
        return;
      case 'ArrowRight':
        event.preventDefault();
        {
          const next = focusTopMenu(index + 1);
          if (open) {
            setOpen(menus[next].key);
            setOpenFocus(null);
          }
        }
        return;
      case 'Home':
        event.preventDefault();
        {
          const next = focusTopMenu(0);
          if (open) {
            setOpen(menus[next].key);
            setOpenFocus(null);
          }
        }
        return;
      case 'End':
        event.preventDefault();
        {
          const next = focusTopMenu(menus.length - 1);
          if (open) {
            setOpen(menus[next].key);
            setOpenFocus(null);
          }
        }
        return;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(null);
          setOpenFocus(null);
        }
        return;
      case 'Tab':
        // A menubar is one tab stop. Tab exits it; arrow keys move inside it.
        setOpen(null);
        setOpenFocus(null);
        return;
      default:
        return;
    }
  };

  return (
    <div
      className="menubar"
      ref={barRef}
      role="menubar"
      aria-label={t({ ja: 'アプリケーションメニュー', en: 'Application menu' })}
    >
      <div className="menubar-logo" role="presentation" aria-hidden="true">LayerLab</div>
      {menus.map((m, index) => (
        <div
          key={m.key}
          className={`menu-root ${open === m.key ? 'open' : ''}`}
          role="none"
          style={{ padding: 0 }}
          onMouseEnter={() => {
            if (!open) return;
            setActiveTopIndex(index);
            setOpenFocus(null);
            setOpen(m.key);
          }}
        >
          <button
            id={`menu-${m.key}-button`}
            ref={(element) => {
              menuButtonRefs.current[index] = element;
            }}
            type="button"
            className="menu-title"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m.key}
            aria-controls={open === m.key ? `menu-${m.key}-dropdown` : undefined}
            tabIndex={activeTopIndex === index ? 0 : -1}
            style={{
              all: 'unset',
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              padding: '0 11px',
              cursor: 'default',
            }}
            onFocus={() => setActiveTopIndex(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              setActiveTopIndex(index);
              setOpenFocus(null);
              setOpen(open === m.key ? null : m.key);
            }}
            onKeyDown={(event) => handleTopMenuKeyDown(event, index)}
          >
            {t(m.title)}
          </button>
          {open === m.key && (
            <MenuDropdown
              menuKey={m.key}
              items={m.items}
              initialFocus={openFocus}
              onRun={run}
              onDismiss={() => {
                setOpen(null);
                setOpenFocus(null);
              }}
              onRestoreFocus={() => restoreTopFocus(index)}
              onMoveTop={(delta) => moveOpenMenu(index, delta)}
              t={t}
            />
          )}
        </div>
      ))}
      <DocIndicator />
    </div>
  );
}

function DocIndicator() {
  const t = useT();
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const dirty = useEditorStore((s) => s.dirty);
  const pending = useEditorStore((s) => s.pendingOperations > 0);
  const name = currentFilePath
    ? currentFilePath.match(/[^\\/]+$/)?.[0] ?? currentFilePath
    : t({ ja: '無題.llab', en: 'Untitled.llab' });
  return (
    <div
      className="menubar-doc"
      role="presentation"
      aria-hidden="true"
      title={currentFilePath ?? t({ ja: '未保存', en: 'Unsaved' })}
    >
      {name}
      {(dirty || pending) && <span className="dirty-dot"> ●</span>}
    </div>
  );
}

function MenuDropdown({
  menuKey,
  items,
  initialFocus,
  onRun,
  onDismiss,
  onRestoreFocus,
  onMoveTop,
  t,
}: {
  menuKey: string;
  items: Item[];
  initialFocus: 'first' | 'last' | null;
  onRun: (fn?: () => void) => void;
  onDismiss: () => void;
  onRestoreFocus: () => void;
  onMoveTop: (delta: -1 | 1) => void;
  t: (s: Bi) => string;
}) {
  const [subOpen, setSubOpen] = useState<number | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const subItemRefs = useRef<Record<number, Array<HTMLButtonElement | null>>>({});

  const enabledIndices = (source: Item[]) =>
    source.flatMap((item, index) =>
      'sep' in item || item.disabled ? [] : [index],
    );

  const focusItem = (
    source: Item[],
    refs: Array<HTMLButtonElement | null>,
    current: number,
    direction: -1 | 1 | 'first' | 'last',
  ) => {
    const enabled = enabledIndices(source);
    if (enabled.length === 0) return;
    let target: number;
    if (direction === 'first') target = enabled[0];
    else if (direction === 'last') target = enabled[enabled.length - 1];
    else {
      const position = enabled.indexOf(current);
      const start = position < 0 ? (direction > 0 ? -1 : 0) : position;
      target = enabled[(start + direction + enabled.length) % enabled.length];
    }
    refs[target]?.focus();
  };

  const openSubmenu = (index: number, edge: 'first' | 'last' = 'first') => {
    setSubOpen(index);
    requestAnimationFrame(() => {
      const item = items[index];
      if ('sep' in item || !item.children) return;
      const refs = subItemRefs.current[index] ?? [];
      focusItem(item.children, refs, -1, edge);
    });
  };

  useEffect(() => {
    if (!initialFocus) return;
    const frame = requestAnimationFrame(() => {
      focusItem(items, itemRefs.current, -1, initialFocus);
    });
    return () => cancelAnimationFrame(frame);
    // The menu is remounted when its owner changes; only the requested edge
    // should trigger automatic focus, not every state-driven items rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocus]);

  const handleRootKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: Exclude<Item, { sep: true }>,
    index: number,
  ) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSubOpen(null);
        focusItem(items, itemRefs.current, index, 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setSubOpen(null);
        focusItem(items, itemRefs.current, index, -1);
        return;
      case 'Home':
        event.preventDefault();
        setSubOpen(null);
        focusItem(items, itemRefs.current, index, 'first');
        return;
      case 'End':
        event.preventDefault();
        setSubOpen(null);
        focusItem(items, itemRefs.current, index, 'last');
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (item.children) openSubmenu(index);
        else onRun(item.onClick);
        return;
      case 'ArrowRight':
        event.preventDefault();
        if (item.children) openSubmenu(index);
        else onMoveTop(1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        onMoveTop(-1);
        return;
      case 'Escape':
        event.preventDefault();
        onRestoreFocus();
        return;
      case 'Tab':
        onDismiss();
        return;
      default:
        return;
    }
  };

  const handleSubKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    parentIndex: number,
    child: Exclude<Item, { sep: true }>,
    childIndex: number,
    children: Item[],
  ) => {
    const refs = subItemRefs.current[parentIndex] ?? [];
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(children, refs, childIndex, 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(children, refs, childIndex, -1);
        return;
      case 'Home':
        event.preventDefault();
        focusItem(children, refs, childIndex, 'first');
        return;
      case 'End':
        event.preventDefault();
        focusItem(children, refs, childIndex, 'last');
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onRun(child.onClick);
        return;
      case 'ArrowLeft':
      case 'Escape':
        event.preventDefault();
        setSubOpen(null);
        itemRefs.current[parentIndex]?.focus();
        return;
      case 'ArrowRight':
        event.preventDefault();
        onMoveTop(1);
        return;
      case 'Tab':
        onDismiss();
        return;
      default:
        return;
    }
  };

  return (
    <div
      id={`menu-${menuKey}-dropdown`}
      className="menu-dropdown"
      role="menu"
      aria-labelledby={`menu-${menuKey}-button`}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="menu-sep" role="separator" />;
        if (it.children) {
          return (
            <div
              key={i}
              role="none"
              style={{ position: 'relative' }}
              onMouseEnter={() => setSubOpen(i)}
              onMouseLeave={() => setSubOpen(null)}
            >
              <button
                id={`menu-${menuKey}-item-${i}`}
                ref={(element) => {
                  itemRefs.current[i] = element;
                }}
                type="button"
                className="menu-item has-sub"
                role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={it.checked !== undefined ? it.checked : undefined}
                aria-haspopup="menu"
                aria-expanded={subOpen === i}
                aria-controls={subOpen === i ? `menu-${menuKey}-submenu-${i}` : undefined}
                aria-disabled={it.disabled || undefined}
                disabled={it.disabled}
                tabIndex={-1}
                onKeyDown={(event) => handleRootKeyDown(event, it, i)}
              >
                <span className="menu-check" aria-hidden="true">{it.checked ? '✔' : ''}</span>
                <span className="menu-label">{t(it.label)}</span>
                <span className="menu-arrow" aria-hidden="true">▸</span>
              </button>
              {subOpen === i && (
                <div
                  id={`menu-${menuKey}-submenu-${i}`}
                  className="menu-submenu"
                  role="menu"
                  aria-labelledby={`menu-${menuKey}-item-${i}`}
                >
                  {it.children.map((c, j) =>
                    'sep' in c ? (
                      <div key={j} className="menu-sep" role="separator" />
                    ) : (
                      <button
                        key={j}
                        ref={(element) => {
                          if (!subItemRefs.current[i]) subItemRefs.current[i] = [];
                          subItemRefs.current[i][j] = element;
                        }}
                        type="button"
                        className="menu-item"
                        role={c.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                        aria-checked={c.checked !== undefined ? c.checked : undefined}
                        aria-disabled={c.disabled || undefined}
                        disabled={c.disabled}
                        tabIndex={-1}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onRun(c.onClick);
                        }}
                        onKeyDown={(event) =>
                          handleSubKeyDown(event, i, c, j, it.children!)
                        }
                      >
                        <span className="menu-check" aria-hidden="true">{c.checked ? '✔' : ''}</span>
                        <span className="menu-label">{t(c.label)}</span>
                        {c.shortcut && <span className="menu-shortcut">{c.shortcut}</span>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          );
        }
        return (
          <button
            key={i}
            ref={(element) => {
              itemRefs.current[i] = element;
            }}
            type="button"
            className="menu-item"
            role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={it.checked !== undefined ? it.checked : undefined}
            aria-disabled={it.disabled || undefined}
            disabled={it.disabled}
            tabIndex={-1}
            onMouseDown={(event) => {
              event.preventDefault();
              onRun(it.onClick);
            }}
            onKeyDown={(event) => handleRootKeyDown(event, it, i)}
          >
            <span className="menu-check" aria-hidden="true">{it.checked ? '✔' : ''}</span>
            <span className="menu-label">{t(it.label)}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </button>
        );
      })}
    </div>
  );
}
