import type { KeyboardEvent, MouseEvent } from 'react';
import { workspaceStore, type DocEntry } from '../store/editorStore';
import { useT } from '../i18n/locale';

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function Tab({ entry, active }: { entry: DocEntry; active: boolean }) {
  const t = useT();
  // 各タブは自分のドキュメントストアを購読（dirty 印・ファイル名表示）
  const dirty = entry.store((s) => s.dirty);
  const pending = entry.store((s) => s.pendingOperations > 0);
  const filePath = entry.store((s) => s.currentFilePath);
  const title = filePath ? basename(filePath) : entry.title;

  const onSelect = () => workspaceStore.getState().setActive(entry.id);
  const onClose = (e: MouseEvent) => {
    e.stopPropagation();
    if ((dirty || pending) && !confirm(t({ ja: `「${title}」は未保存の変更があります。閉じますか？`, en: `"${title}" has unsaved changes. Close?` }))) return;
    workspaceStore.getState().closeDoc(entry.id);
  };
  const focusTab = (id: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`.tab[data-doc-id="${CSS.escape(id)}"]`)?.focus();
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const state = workspaceStore.getState();
    const index = state.docs.findIndex((doc) => doc.id === entry.id);
    if (index < 0 || state.docs.length === 0) return;
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? state.docs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + state.docs.length) % state.docs.length;
    const next = state.docs[nextIndex];
    state.setActive(next.id);
    focusTab(next.id);
  };

  return (
    <div
      className={`tab ${active ? 'active' : ''}`}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-doc-id={entry.id}
      title={filePath ?? title}
      onMouseDown={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="tab-title">{title}</span>
      {(dirty || pending) && <span className="tab-dirty" aria-label={t({ ja: '未保存', en: 'Unsaved' })} />}
      <button
        type="button"
        className="tab-close"
        onClick={onClose}
        aria-label={t({ ja: `「${title}」を閉じる`, en: `Close "${title}"` })}
        title={t({ ja: '閉じる', en: 'Close' })}
      >
        ×
      </button>
    </div>
  );
}

/** ドキュメントタブ列（Photoshop 風の複数ドキュメント切替）。 */
export function TabBar({ onNew }: { onNew: () => void }) {
  const t = useT();
  const docs = workspaceStore((s) => s.docs);
  const activeId = workspaceStore((s) => s.activeId);
  return (
    <div className="tab-bar" role="tablist" aria-label={t({ ja: 'ドキュメントタブ', en: 'Document tabs' })}>
      {docs.map((d) => (
        <Tab key={d.id} entry={d} active={d.id === activeId} />
      ))}
      <button
        type="button"
        className="tab-new"
        title={t({ ja: '新規ドキュメント (Ctrl+N)', en: 'New document (Ctrl+N)' })}
        aria-label={t({ ja: '新規ドキュメント', en: 'New document' })}
        onClick={onNew}
      >
        ＋
      </button>
    </div>
  );
}
