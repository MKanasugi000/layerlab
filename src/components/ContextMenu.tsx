import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

export type CtxItem =
  | { sep: true }
  | {
      label: string;
      onClick?: () => void;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
      children?: Array<{ label: string; onClick: () => void }>;
    };

interface Props {
  x: number;
  y: number;
  items: CtxItem[];
  onClose: () => void;
}

/** カーソル位置に出るフローティング右クリックメニュー。 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // pointerdown を使う: scrub入力等が pointerdown を preventDefault しても
    // propagation は止まらないため確実に外側クリックを検知できる
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>(':scope > .ctx-item:not(:disabled)')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const current = e.target as HTMLElement;
    const menu = current.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const menuItems = Array.from(
      menu.querySelectorAll<HTMLElement>(':scope > .ctx-item:not(:disabled)'),
    );
    const index = menuItems.indexOf(current);
    const focusAt = (next: number) => {
      if (menuItems.length === 0) return;
      menuItems[(next + menuItems.length) % menuItems.length]?.focus();
    };
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusAt(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusAt(index - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusAt(menuItems.length - 1);
    } else if (
      (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')
      && current.classList.contains('has-sub')
    ) {
      e.preventDefault();
      current.querySelector<HTMLElement>('.ctx-submenu .ctx-item:not(:disabled)')?.focus();
    } else if (e.key === 'ArrowLeft' && menu.classList.contains('ctx-submenu')) {
      e.preventDefault();
      menu.closest<HTMLElement>('.ctx-item.has-sub')?.focus();
    }
  };

  // ざっくり画面内に収める
  const estW = 220;
  const estH = items.length * 30 + 8;
  const left = Math.min(x, window.innerWidth - estW - 6);
  const top = Math.min(y, window.innerHeight - estH - 6);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: Math.max(4, left), top: Math.max(4, top) }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : it.children ? (
          <div
            key={i}
            className="ctx-item has-sub"
            role="menuitem"
            aria-haspopup="menu"
            aria-disabled={it.disabled || undefined}
            tabIndex={it.disabled ? -1 : 0}
          >
            <span className="ctx-label">{it.label}</span>
            <span className="ctx-arrow">▸</span>
            <div className="ctx-submenu" role="menu">
              {it.children.map((c, j) => (
                <button
                  key={j}
                  className="ctx-item"
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => {
                    onClose();
                    c.onClick();
                  }}
                >
                  <span className="ctx-label">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            key={i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onClose();
              it.onClick?.();
            }}
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
