import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useEditorStore } from '../store/editorStore';
import { type DropTarget, matchFilter } from '../utils/layerOrder';
import { ContextMenu, type CtxItem } from './ContextMenu';
import {
  addBlankLayer,
  deleteSelectedLayers,
  duplicateSelectedLayers,
  mergeSelectedLayers,
} from '../utils/layerActions';
import type { Layer, ShapeLayer } from '../types';
import { LayerThumb } from './LayerThumb';
import { ColorPickerDialog } from './ColorPickerDialog';
import { toast } from '../store/toastStore';
import { useT } from '../i18n/locale';

function iconForLayer(l: Layer): string {
  if (l.type === 'image') return '🖼';
  if (l.type === 'text') return 'T';
  if (l.type === 'shape') return '◆';
  return '📁';
}

/** ノーマル生成由来レイヤーなら、その生成元レイヤー id を返す（バッジ→ソースへジャンプ用）。 */
function normalGenSource(l: Layer): string | undefined {
  return l.type === 'image' ? l.normalGen?.sourceLayerId : undefined;
}

interface TreeNode {
  layer: Layer;
  depth: number;
}

function buildTree(layers: Layer[]): TreeNode[] {
  const ids = new Set(layers.map((l) => l.id));
  const byParent = new Map<string | null, Layer[]>();
  for (const l of layers) {
    const k = l.parentId && ids.has(l.parentId) ? l.parentId : null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(l);
  }
  const result: TreeNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    const children = byParent.get(parent) ?? [];
    for (const l of children) {
      result.push({ layer: l, depth });
      if (l.type === 'group' && !l.collapsed) {
        walk(l.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return result;
}

/** カラーラベルの選択肢（Photoshop 準拠 7 色＋なし）。値は HEX、null=解除。 */
const LABEL_COLORS: { key: string; color: string | null; ja: string; en: string }[] = [
  { key: 'none', color: null, ja: 'なし', en: 'None' },
  { key: 'red', color: '#d0574e', ja: '赤', en: 'Red' },
  { key: 'orange', color: '#d98a3d', ja: '橙', en: 'Orange' },
  { key: 'yellow', color: '#d4c24a', ja: '黄', en: 'Yellow' },
  { key: 'green', color: '#5fa85a', ja: '緑', en: 'Green' },
  { key: 'blue', color: '#4f86c6', ja: '青', en: 'Blue' },
  { key: 'violet', color: '#8a6fc0', ja: '紫', en: 'Violet' },
  { key: 'gray', color: '#7a7a7a', ja: '灰', en: 'Gray' },
];

type Zone = 'before' | 'after' | 'into';
interface DragState {
  ids: string[];
  overId: string | null;
  zone: Zone | null;
  copy: boolean;
}

export function LayerPanel() {
  const t = useT();
  const layers = useEditorStore((s) => s.layers);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const selectMany = useEditorStore((s) => s.selectMany);
  const updateLayer = useEditorStore((s) => s.updateLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const moveLayers = useEditorStore((s) => s.moveLayers);
  const soloLayer = useEditorStore((s) => s.soloLayer);
  const groupSelected = useEditorStore((s) => s.groupSelected);
  const ungroupSelected = useEditorStore((s) => s.ungroupSelected);
  const toggleGroupCollapsed = useEditorStore((s) => s.toggleGroupCollapsed);
  const toggleClipped = useEditorStore((s) => s.toggleClipped);
  const moveLayerEnd = useEditorStore((s) => s.moveLayerEnd);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: CtxItem[] } | null>(null);
  const [colorEdit, setColorEdit] = useState<{ id: string; field: 'fill' | 'strokeColor'; value: string } | null>(null);
  const [editingName, setEditingName] = useState<{ id: string; value: string } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [filter, setFilter] = useState('');

  const listRef = useRef<HTMLUListElement>(null);
  // ドラッグ中の押下情報。React state ではなく ref に持ち、document リスナから読む
  // （state 更新による再レンダーで stale closure にならないように）。
  const press = useRef<{
    id: string;
    startX: number;
    startY: number;
    started: boolean;
    ids: string[];
    blocked: Set<string>;
  } | null>(null);
  const dragRef = useRef<{ overId: string | null; zone: Zone | null; copy: boolean }>({
    overId: null,
    zone: null,
    copy: false,
  });
  const didDrag = useRef(false);
  const autoScroll = useRef<{ dir: number; raf: number | null }>({ dir: 0, raf: null });
  // 進行中ドラッグの後始末（リスナ除去＋状態クリア）。unmount / blur / mouseup取りこぼし で必ず呼ぶ。
  const dragCleanup = useRef<(() => void) | null>(null);
  function cancelDrag() {
    dragCleanup.current?.();
  }

  // Canvas 等で選択が変わったら、その行をパネル内に見えるようスクロール（大量レイヤー時の迷子防止）。
  useEffect(() => {
    if (!selectedId || press.current) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-layer-id="${CSS.escape(selectedId)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  useEffect(() => () => cancelDrag(), []);

  function stopAutoScroll() {
    autoScroll.current.dir = 0;
    if (autoScroll.current.raf != null) {
      cancelAnimationFrame(autoScroll.current.raf);
      autoScroll.current.raf = null;
    }
  }
  function updateAutoScroll(clientX: number, clientY: number) {
    const list = listRef.current;
    if (!list) return;
    const r = list.getBoundingClientRect();
    const EDGE = 28;
    let dir = 0;
    if (clientX >= r.left && clientX <= r.right) {
      if (clientY < r.top + EDGE) dir = -1;
      else if (clientY > r.bottom - EDGE) dir = 1;
    }
    autoScroll.current.dir = dir;
    if (dir !== 0 && autoScroll.current.raf == null) {
      const step = () => {
        const d = autoScroll.current.dir;
        if (d === 0 || !listRef.current) {
          autoScroll.current.raf = null;
          return;
        }
        listRef.current.scrollTop += d * 8;
        autoScroll.current.raf = requestAnimationFrame(step);
      };
      autoScroll.current.raf = requestAnimationFrame(step);
    }
  }

  // ポインタ位置直下の行を判定し、ゾーン（前/後/グループ内）を返す。移動対象や
  // その子孫の上（=自分自身への drop）は無効なので null。
  function hitTest(x: number, y: number): { refId: string; zone: Zone } | null {
    const p = press.current;
    if (!p) return null;
    const el = document.elementFromPoint(x, y)?.closest('.layer-item') as HTMLElement | null;
    if (!el) return null;
    const refId = el.dataset.layerId;
    if (!refId || p.blocked.has(refId)) return null;
    const isGroup = el.dataset.isGroup === '1';
    const rect = el.getBoundingClientRect();
    const rel = (y - rect.top) / rect.height;
    let zone: Zone;
    if (isGroup) {
      zone = rel < 0.25 ? 'before' : rel > 0.75 ? 'after' : 'into';
    } else {
      zone = rel < 0.5 ? 'before' : 'after';
    }
    return { refId, zone };
  }

  // 移動対象＋その全子孫の id 集合（drop 禁止範囲＝自己内包/循環防止、かつ「ドラッグ中」表示の対象）。
  function blockSet(ids: string[]): Set<string> {
    const blocked = new Set<string>(ids);
    const idset = new Set(layers.map((x) => x.id));
    const byParent = new Map<string | null, Layer[]>();
    for (const x of layers) {
      const k = x.parentId && idset.has(x.parentId) ? x.parentId : null;
      if (!byParent.has(k)) byParent.set(k, []);
      byParent.get(k)!.push(x);
    }
    const collect = (id: string) => {
      for (const c of byParent.get(id) ?? []) {
        if (blocked.has(c.id)) continue;
        blocked.add(c.id);
        if (c.type === 'group') collect(c.id);
      }
    };
    for (const id of ids) collect(id);
    return blocked;
  }

  const onRowMouseDown = (e: React.MouseEvent, l: Layer) => {
    didDrag.current = false; // 前回ドラッグの stale フラグを次操作の起点で確実に落とす（cross-row drop 対策）
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('button') || el.closest('input')) return; // 操作系ボタン/改名入力の上では開始しない
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // 修飾キーは選択操作に譲る
    if (filter.trim()) return; // 絞り込み中は隣接行が隠れて紛らわしいので並び替えを無効化（PS準拠）
    const dragIds = selectedIds.includes(l.id) && selectedIds.length > 1 ? [...selectedIds] : [l.id];
    const blocked = blockSet(dragIds);

    press.current = { id: l.id, startX: e.clientX, startY: e.clientY, started: false, ids: dragIds, blocked };
    dragRef.current = { overId: null, zone: null, copy: false };

    const cleanup = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('blur', onBlur);
      stopAutoScroll();
      press.current = null;
      dragCleanup.current = null;
      setDrag(null);
    };
    const move = (ev: MouseEvent) => {
      const p = press.current;
      if (!p) return;
      if (ev.buttons === 0) {
        // mouseup を取りこぼした（ウィンドウ外で離した等）。ドロップは実行せず破棄。
        if (p.started) didDrag.current = true;
        cleanup();
        return;
      }
      if (!p.started) {
        if (Math.hypot(ev.clientX - p.startX, ev.clientY - p.startY) < 4) return;
        p.started = true;
      }
      const hit = hitTest(ev.clientX, ev.clientY);
      dragRef.current = { overId: hit?.refId ?? null, zone: hit?.zone ?? null, copy: ev.altKey };
      setDrag({ ids: p.ids, overId: hit?.refId ?? null, zone: hit?.zone ?? null, copy: ev.altKey });
      updateAutoScroll(ev.clientX, ev.clientY);
    };
    const up = (ev: MouseEvent) => {
      const p = press.current;
      const started = !!p?.started;
      const ids = p?.ids ?? [];
      const d = dragRef.current;
      cleanup();
      if (started) {
        didDrag.current = true; // ドラッグ直後の click（共通祖先 ul 発火 or 同行）による選択上書きを抑止
        if (d.overId && d.zone) {
          const target: DropTarget =
            d.zone === 'into' ? { kind: 'into', groupId: d.overId } : { kind: d.zone, refId: d.overId };
          moveLayers(ids, target, { duplicate: ev.altKey });
        }
      }
    };
    const onBlur = () => {
      if (press.current?.started) didDrag.current = true;
      cleanup();
    };
    dragCleanup.current = cleanup;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('blur', onBlur);
  };

  // シェイプのサムネをダブルクリック→色を直接編集（rect/楕円=塗り、線/塗り無し=線色）
  const openColorEdit = (l: Layer) => {
    if (l.type !== 'shape') return;
    const useStroke = l.shape === 'line' || (!l.fillEnabled && l.strokeEnabled);
    setColorEdit({
      id: l.id,
      field: useStroke ? 'strokeColor' : 'fill',
      value: useStroke ? l.strokeColor : l.fill,
    });
  };

  const commitName = () => {
    if (!editingName) return;
    const name = editingName.value.trim();
    if (name) updateLayer(editingName.id, { name });
    setEditingName(null);
  };

  const openMenu = (e: React.MouseEvent, l: Layer) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(l.id)) selectLayer(l.id);

    const clipLabel = l.clipped
      ? t({ ja: 'クリッピング解除', en: 'Release clipping' })
      : t({ ja: '下のレイヤーにクリップ', en: 'Clip to layer below' });
    const visLabel = l.visible
      ? t({ ja: 'レイヤーを隠す', en: 'Hide layer' })
      : t({ ja: 'レイヤーを表示', en: 'Show layer' });
    const lockLabel = l.locked
      ? t({ ja: 'ロック解除', en: 'Unlock' })
      : t({ ja: 'ロック', en: 'Lock' });

    const items: CtxItem[] = [
      { label: t({ ja: '名前を変更', en: 'Rename' }), onClick: () => setEditingName({ id: l.id, value: l.name }) },
      { label: t({ ja: '複製', en: 'Duplicate' }), shortcut: 'Ctrl+J', onClick: () => duplicateSelectedLayers(l.id) },
      {
        label: t({ ja: 'カラーラベル', en: 'Color label' }),
        children: LABEL_COLORS.map((c) => ({
          label: (c.color ? '● ' : '○ ') + t({ ja: c.ja, en: c.en }),
          onClick: () => updateLayer(l.id, { colorLabel: c.color ?? undefined } as Partial<Layer>),
        })),
      },
      { sep: true },
      { label: t({ ja: '最前面へ', en: 'Bring to Front' }), onClick: () => moveLayerEnd(l.id, 'front') },
      { label: t({ ja: '前面へ', en: 'Bring Forward' }), shortcut: 'Ctrl+]', onClick: () => moveLayer(l.id, 'up') },
      { label: t({ ja: '背面へ', en: 'Send Backward' }), shortcut: 'Ctrl+[', onClick: () => moveLayer(l.id, 'down') },
      { label: t({ ja: '最背面へ', en: 'Send to Back' }), onClick: () => moveLayerEnd(l.id, 'back') },
      { sep: true },
      { label: t({ ja: 'グループ化', en: 'Group' }), shortcut: 'Ctrl+G', onClick: () => groupSelected() },
      { label: t({ ja: 'グループ解除', en: 'Ungroup' }), shortcut: 'Ctrl+Shift+G', onClick: () => ungroupSelected() },
    ];
    // 複数レイヤーを選んで右クリックした時だけ「レイヤーを統合」を出す。
    // 右クリック対象が現在の複数選択に含まれている場合のみ成立（含まれないと
    // 上の selectLayer で単一選択に戻るため、Photoshop と同じ挙動になる）。
    const isMultiSelection = selectedIds.includes(l.id) && selectedIds.length >= 2;
    if (isMultiSelection) {
      items.push({
        label: t({ ja: 'レイヤーを統合', en: 'Merge Layers' }),
        shortcut: 'Ctrl+E',
        onClick: () => mergeSelectedLayers(),
      });
    }
    if (l.type !== 'group') {
      items.push({
        label: clipLabel,
        shortcut: 'Ctrl+Alt+G',
        onClick: () => toggleClipped(l.id),
      });
    }
    items.push({ sep: true });
    items.push({
      label: visLabel,
      onClick: () => updateLayer(l.id, { visible: !l.visible }),
    });
    if (l.type !== 'group') {
      items.push({
        label: t({ ja: 'このレイヤーだけ表示', en: 'Show only this' }),
        onClick: () => soloLayer(l.id),
      });
    }
    items.push({
      label: lockLabel,
      onClick: () => updateLayer(l.id, { locked: !l.locked }),
    });
    items.push({ sep: true });
    items.push({
      label: t({ ja: 'レイヤーを削除', en: 'Delete layer' }),
      shortcut: 'Del',
      danger: true,
      onClick: () => deleteSelectedLayers(l.id),
    });
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const tree = buildTree(layers);
  const keep = matchFilter(layers, filter);
  const shownTree = keep ? tree.filter((n) => keep.has(n.layer.id)) : tree;
  const selSet = new Set(selectedIds);
  const selectedLayer = layers.find((layer) => layer.id === selectedId);
  // 「ドラッグ中」の淡色表示は子孫まで含める（グループを掴んだら子行も薄くなる＝一緒に動くと分かる）
  const dragIdSet = drag ? blockSet(drag.ids) : null;

  const dropClass = (id: string): string => {
    if (!drag || drag.overId !== id || !drag.zone) return '';
    return `drop-${drag.zone}${drag.copy ? ' drop-copy' : ''}`;
  };

  const focusLayerRow = (id: string) => {
    requestAnimationFrame(() => {
      listRef.current
        ?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)
        ?.focus();
    });
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLLIElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    const ids = shownTree.map((node) => node.layer.id);
    const index = ids.indexOf(id);
    if (index < 0) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      selectLayer(id);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopPropagation();
      deleteSelectedLayers(id);
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ids.length - 1
        : Math.max(0, Math.min(ids.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const nextId = ids[nextIndex];
    selectLayer(nextId);
    focusLayerRow(nextId);
  };

  return (
    <aside className={`layer-panel${drag ? ' dnd-active' : ''}`}>
      <header className="panel-header">
        <h2>{t({ ja: 'レイヤー', en: 'Layers' })}</h2>
        <span className="count">{layers.length}</span>
      </header>
      <div className="layer-filter">
        <input
          type="text"
          placeholder={t({ ja: 'レイヤーを検索…', en: 'Filter layers…' })}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button className="clear" onClick={() => setFilter('')} title={t({ ja: 'クリア', en: 'Clear' })}>
            ×
          </button>
        )}
      </div>
      <ul
        className="layer-list"
        ref={listRef}
        role="tree"
        aria-multiselectable="true"
        aria-label={t({ ja: 'レイヤー', en: 'Layers' })}
      >
        {shownTree.length === 0 && keep && (
          <li className="empty">{t({ ja: '一致するレイヤーなし', en: 'No matching layers' })}</li>
        )}
        {shownTree.length === 0 && !keep && (
          <li className="empty">
            {t({ ja: 'レイヤーなし', en: 'No layers' })}
            <br />
            <small>{t({ ja: '下の＋で新規レイヤー / 画像をD&D', en: 'Use + below / Drag & drop an image' })}</small>
          </li>
        )}
        {shownTree.map(({ layer: l, depth }) => (
          <li
            key={l.id}
            data-layer-id={l.id}
            data-is-group={l.type === 'group' ? '1' : '0'}
            role="treeitem"
            aria-selected={selSet.has(l.id)}
            aria-level={depth + 1}
            aria-expanded={l.type === 'group' ? !l.collapsed : undefined}
            tabIndex={l.id === selectedId || (!selectedId && shownTree[0]?.layer.id === l.id) ? 0 : -1}
            className={`layer-item ${l.id === selectedId ? 'selected' : ''} ${selSet.has(l.id) && l.id !== selectedId ? 'multi-selected' : ''} ${l.locked ? 'locked' : ''} ${l.type === 'group' ? 'is-group' : ''} ${l.clipped ? 'is-clipped' : ''} ${dragIdSet?.has(l.id) ? 'dragging' : ''} ${dropClass(l.id)}`}
            style={{
              paddingLeft: 6 + depth * 14 + (l.clipped ? 10 : 0),
              gridTemplateColumns: '16px 22px 32px 18px minmax(0, 1fr) 22px',
              minHeight: 38,
            }}
            onMouseDown={(e) => onRowMouseDown(e, l)}
            onClick={(e) => {
              if (didDrag.current) {
                didDrag.current = false; // ドラッグ直後の click は選択に使わない
                return;
              }
              if (e.shiftKey) {
                // 範囲選択: アンカー(現在の主選択)からクリックまで（Photoshop互換・表示中の行基準）
                const ids = shownTree.map((t) => t.layer.id);
                const anchor = selectedId ? ids.indexOf(selectedId) : -1;
                const target = ids.indexOf(l.id);
                if (anchor >= 0 && target >= 0) {
                  const [a, b] = anchor < target ? [anchor, target] : [target, anchor];
                  selectMany(ids.slice(a, b + 1));
                } else {
                  selectLayer(l.id);
                }
              } else if (e.ctrlKey || e.metaKey) {
                toggleSelect(l.id);
              } else {
                selectLayer(l.id);
              }
            }}
            onContextMenu={(e) => openMenu(e, l)}
            onKeyDown={(event) => onRowKeyDown(event, l.id)}
          >
            {l.colorLabel && (
              <span className="layer-color-strip" style={{ background: l.colorLabel }} aria-hidden />
            )}
            {l.type === 'group' ? (
              <button
                className="collapse-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleGroupCollapsed(l.id);
                }}
                title={l.collapsed ? t({ ja: '展開', en: 'Expand' }) : t({ ja: '折り畳み', en: 'Collapse' })}
              >
                {l.collapsed ? '▶' : '▼'}
              </button>
            ) : (
              <span className="collapse-spacer" />
            )}
            <button
              className="visibility"
              onClick={(e) => {
                e.stopPropagation();
                if (e.altKey && l.type !== 'group') {
                  soloLayer(l.id);
                  toast(t({ ja: 'このレイヤーだけ表示（Alt+クリックで戻す）', en: 'Solo (Alt+click to restore)' }));
                } else {
                  updateLayer(l.id, { visible: !l.visible });
                }
              }}
              title={
                l.type !== 'group'
                  ? t({ ja: '表示切替（Alt+クリックで単独表示）', en: 'Toggle visibility (Alt+click to solo)' })
                  : l.visible
                    ? t({ ja: '非表示', en: 'Hide' })
                    : t({ ja: '表示', en: 'Show' })
              }
            >
              {l.visible ? '◉' : '○'}
            </button>
            <span
              className="layer-thumb-wrap"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: l.type === 'shape' ? 'pointer' : 'default',
              }}
              title={l.type === 'shape' ? t({ ja: 'ダブルクリックで色を編集', en: 'Double-click to edit color' }) : undefined}
              onDoubleClick={(e) => {
                e.stopPropagation();
                openColorEdit(l);
              }}
            >
              <LayerThumb layer={l} />
            </span>
            <span className="layer-icon">{iconForLayer(l)}</span>
            {editingName?.id === l.id ? (
              <input
                className="layer-name-edit"
                value={editingName.value}
                autoFocus
                onChange={(e) => setEditingName({ id: l.id, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitName();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingName(null);
                  }
                }}
                onBlur={commitName}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onFocus={(e) => e.target.select()}
              />
            ) : (
              <span
                className="layer-name"
                title={t({ ja: 'ダブルクリックで名前を変更', en: 'Double-click to rename' })}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingName({ id: l.id, value: l.name });
                }}
              >
                {normalGenSource(l) && (
                  <button
                    className="normalgen-badge"
                    title={t({ ja: 'ノーマル生成元へジャンプ', en: 'Jump to normal source' })}
                    onClick={(e) => {
                      e.stopPropagation();
                      const src = normalGenSource(l);
                      if (src && layers.some((x) => x.id === src)) selectLayer(src);
                    }}
                  >
                    N
                  </button>
                )}
                {l.clipped && <span className="clip-indicator" title={t({ ja: 'クリッピングマスク', en: 'Clipping Mask' })}>↘ </span>}
                {l.name}
              </span>
            )}
            <button
              className="lock"
              onClick={(e) => {
                e.stopPropagation();
                updateLayer(l.id, { locked: !l.locked });
              }}
              title={l.locked ? t({ ja: 'ロック解除', en: 'Unlock' }) : t({ ja: 'ロック', en: 'Lock' })}
              aria-label={l.locked ? t({ ja: 'ロック解除', en: 'Unlock' }) : t({ ja: 'ロック', en: 'Lock' })}
            >
              {l.locked ? '🔒' : ''}
            </button>
          </li>
        ))}
      </ul>
      <div className="layer-footer-actions" role="toolbar" aria-label={t({ ja: 'レイヤー操作', en: 'Layer actions' })}>
        <button
          type="button"
          className={selectedLayer?.clipped ? 'active' : ''}
          disabled={!selectedLayer || selectedLayer.type === 'group'}
          onClick={() => selectedLayer && toggleClipped(selectedLayer.id)}
          title={t({ ja: '下のレイヤーにクリップ (Ctrl+Alt+G)', en: 'Clip to layer below (Ctrl+Alt+G)' })}
          aria-label={t({ ja: 'クリッピングマスク', en: 'Clipping mask' })}
        >
          ↘
        </button>
        <button
          type="button"
          disabled={!selectedId}
          onClick={groupSelected}
          title={t({ ja: 'グループ化 (Ctrl+G)', en: 'Group (Ctrl+G)' })}
          aria-label={t({ ja: 'グループ化', en: 'Group' })}
        >
          📁+
        </button>
        <span className="layer-footer-spacer" />
        <button
          type="button"
          onClick={() => addBlankLayer()}
          title={t({ ja: '新規レイヤー (Ctrl+Shift+N)', en: 'New Layer (Ctrl+Shift+N)' })}
          aria-label={t({ ja: '新規レイヤー', en: 'New layer' })}
        >
          ＋
        </button>
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => duplicateSelectedLayers()}
          title={t({ ja: '複製 (Ctrl+J)', en: 'Duplicate (Ctrl+J)' })}
          aria-label={t({ ja: '複製', en: 'Duplicate' })}
        >
          ⎘
        </button>
        <button
          type="button"
          disabled={!selectedId}
          onClick={() => deleteSelectedLayers()}
          title={t({ ja: '削除 (Del)', en: 'Delete (Del)' })}
          aria-label={t({ ja: '削除', en: 'Delete' })}
        >
          🗑
        </button>
      </div>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {colorEdit && (
        <ColorPickerDialog
          initial={colorEdit.value}
          title={t({ ja: 'シェイプの色', en: 'Shape color' })}
          onApply={(hex) => {
            const patch: Partial<ShapeLayer> =
              colorEdit.field === 'strokeColor'
                ? { strokeColor: hex, strokeEnabled: true }
                : { fill: hex, fillEnabled: true };
            updateLayer(colorEdit.id, patch as Partial<Layer>);
          }}
          onClose={() => setColorEdit(null)}
        />
      )}
    </aside>
  );
}
