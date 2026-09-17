import { create } from 'zustand';

/**
 * 一時通知（トースト）ストア。
 * editorStore（zundo/temporal でアンドゥ追跡）とは別の素の Zustand にして、
 * 通知が履歴に混ざらないようにする。
 * 根拠: フィードバック / 変化盲の補償 / ピークエンドの法則（UX心理リサーチ P0）。
 */

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
  push: (
    text: string,
    opts?: { kind?: ToastKind; action?: ToastAction; duration?: number },
  ) => void;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (text, opts = {}) => {
    counter += 1;
    const id = `toast-${counter}`;
    const kind = opts.kind ?? 'info';
    // 同時表示は最大4件（直近3 + 新規）に抑える。
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action: opts.action }] }));
    const duration = opts.duration ?? (opts.action ? 5000 : 2600);
    setTimeout(() => get().dismiss(id), duration);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 非Reactコンテキスト（store/util）からも呼べるトースト発火ショートカット。 */
export function toast(
  text: string,
  opts?: { kind?: ToastKind; action?: ToastAction; duration?: number },
) {
  useToastStore.getState().push(text, opts);
}
