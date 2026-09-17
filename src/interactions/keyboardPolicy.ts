export type LayerOrderCommand = 'up' | 'down' | 'front' | 'back';

interface LayerOrderShortcutInput {
  code: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Resolve Photoshop's layer-order shortcuts from the physical bracket keys.
 * `event.key` becomes `{` / `}` while Shift is held on common layouts, so it
 * cannot reliably distinguish Bring to Front / Send to Back.
 */
export function getLayerOrderCommand({
  code,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
}: LayerOrderShortcutInput): LayerOrderCommand | null {
  if (!(ctrlKey || metaKey) || altKey) return null;
  if (code === 'BracketRight') return shiftKey ? 'front' : 'up';
  if (code === 'BracketLeft') return shiftKey ? 'back' : 'down';
  return null;
}

/** Canvas-wide hotkeys must never steal keyboard activation/navigation from UI. */
export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest([
    'button',
    'a[href]',
    'summary',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="treeitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="slider"]',
  ].join(',')) !== null;
}

export function isNativeEditingShortcut(input: {
  editable: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  key: string;
}): boolean {
  return input.editable
    && (input.ctrlKey || input.metaKey) === true
    && !input.altKey
    && ['a', 'c', 'v', 'x', 'y', 'z'].includes(input.key.toLowerCase());
}
