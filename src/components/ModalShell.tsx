import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true',
  );
}

export interface ModalShellProps {
  title: ReactNode;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  overlayClassName?: string;
  style?: CSSProperties;
  closeOnBackdrop?: boolean;
  /** Preserve dialogs such as the color picker that already commit on Enter. */
  onEnter?: () => void;
}

/**
 * Shared modal frame for LayerLab's blocking dialogs.
 *
 * It owns keyboard containment so editor shortcuts never operate on the
 * document behind a dialog. Focus starts inside the dialog, cycles with Tab,
 * and returns to the control that opened it after close.
 */
export function ModalShell({
  title,
  children,
  onClose,
  className,
  overlayClassName,
  style,
  closeOnBackdrop = true,
  onEnter,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });

    return () => {
      const previous = previousFocusRef.current;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const handleBackdropMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Do not let global Photoshop-style editor shortcuts mutate the document
    // while a blocking dialog is open.
    event.stopPropagation();

    const target = event.target as HTMLElement;
    const ctrl = event.ctrlKey || event.metaKey;
    const editable =
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target.isContentEditable;
    const nativeEditShortcut =
      editable
      && ctrl
      && ['a', 'c', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase());
    // A modal must not leave Electron/browser navigation commands active.
    // Keep only normal editing commands in text controls.
    if ((ctrl && !nativeEditShortcut) || event.key === 'F5' || event.altKey) {
      event.preventDefault();
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'Enter' && onEnter && !event.shiftKey && !event.nativeEvent.isComposing) {
      // Buttons already invoke their own action on Enter; textarea needs a
      // literal newline. Other fields retain the desktop-dialog commit flow.
      if (!target.closest('button') && target.tagName !== 'TEXTAREA') {
        event.preventDefault();
        onEnter();
      }
      return;
    }

    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = focusableElements(dialog);
    if (focusables.length === 0) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === dialog)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={`modal-overlay${overlayClassName ? ` ${overlayClassName}` : ''}`}
      role="presentation"
      onMouseDown={handleBackdropMouseDown}
    >
      <div
        ref={dialogRef}
        className={`modal${className ? ` ${className}` : ''}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
