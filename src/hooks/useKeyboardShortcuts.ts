import { useEffect, useRef } from 'react';
import { useEditorStore, getActiveStore, undo, redo, workspaceStore } from '../store/editorStore';
import { createTemporaryHandController } from '../interactions/temporaryHand';
import { saveCurrent, saveCurrentAs, openProject } from '../utils/projectIo';
import { pasteFromClipboard } from '../utils/clipboardPaste';
import {
  addBlankLayer,
  deleteSelectedLayers,
  duplicateSelectedLayers,
  mergeSelectedLayers,
} from '../utils/layerActions';
import {
  newLayerFromSelection,
  fillSelection,
  clearLayerSelection,
  copyLayerSelectionToClipboard,
} from '../utils/selectionOps';
import type { Tool } from '../types';
import { t } from '../i18n/locale';
import type { AdjustmentMode } from '../imaging/colorAdjustments';
import {
  getLayerOrderCommand,
  isInteractiveKeyboardTarget,
  isNativeEditingShortcut,
} from '../interactions/keyboardPolicy';

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

const TOOL_HOTKEYS: Record<string, Tool> = {
  v: 'move',
  m: 'marquee',
  l: 'lasso',
  w: 'wand',
  t: 'text',
  u: 'shape',
  c: 'crop',
  i: 'eyedropper',
  h: 'hand',
  z: 'zoom',
};

const SHAPE_CYCLE: Array<'rect' | 'ellipse' | 'line'> = ['rect', 'ellipse', 'line'];

interface ShortcutHandlers {
  onExport?: () => void;
  onNew?: () => void;
  onAdjustment?: (mode: AdjustmentMode) => void;
  onInvertImage?: () => void;
  onDesaturateImage?: () => void;
  onCanvasSize?: () => void;
  adjustmentOpen?: boolean;
  blockingDialogOpen?: boolean;
  onCloseDialog?: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}) {
  // keep a live ref so the once-bound listener always calls the latest handler
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const temporaryHand = createTemporaryHandController();
    const onKeyDown = (e: KeyboardEvent) => {
      let editable = isEditable(e.target);
      const startedEditable = editable;
      const ctrl = e.ctrlKey || e.metaKey;
      const state = useEditorStore.getState();
      const selectedId = state.selectedId;
      const key = e.key.toLowerCase();

      // 色調補正セッション中はダイアログ自身だけがキーを処理する。
      // 未確定previewの裏でレイヤー削除・ツール変更・Export等を起こさない。
      if (handlersRef.current.adjustmentOpen) {
        // Also suppress browser/Electron defaults such as Ctrl+L/Ctrl+W while
        // preserving ordinary text editing shortcuts inside numeric fields.
        const nativeEditShortcut = editable && ctrl && ['a', 'c', 'v', 'x', 'z', 'y'].includes(key);
        if ((!nativeEditShortcut && ctrl)
          || (!editable && (e.key === 'Delete' || e.key === 'Backspace'))) {
          e.preventDefault();
        }
        return;
      }

      // A dialog owns the keyboard while it is open.  In particular, never let
      // Delete/Backspace, tool letters, Space, Tab or arrows mutate the canvas
      // behind a modal.  Component-local handlers still receive the event.
      if (
        handlersRef.current.blockingDialogOpen
        || document.querySelector('.modal-overlay') !== null
      ) {
        const nativeEditShortcut = editable && ctrl && ['a', 'c', 'v', 'x', 'z', 'y'].includes(key);
        if ((ctrl && !nativeEditShortcut) || e.key === 'F5' || e.altKey) {
          e.preventDefault();
        }
        if (e.key === 'Escape' && handlersRef.current.blockingDialogOpen) {
          e.preventDefault();
          handlersRef.current.onCloseDialog?.();
        }
        return;
      }

      // Preserve unmodified activation/navigation keys on toolbar, menu and
      // panel controls. Ctrl/Meta application commands (Save, Undo, Close,
      // document Tab switching, etc.) must still work after clicking a button.
      const interactiveTarget = isInteractiveKeyboardTarget(e.target);
      // Reload would recreate the in-memory multi-document workspace. Shift+F5
      // remains Fill only when focus is on the canvas, never a browser reload.
      if (e.key === 'F5') {
        e.preventDefault();
        if (!e.shiftKey || startedEditable || interactiveTarget) return;
      }
      if (interactiveTarget && !ctrl) return;
      if (isNativeEditingShortcut({
        editable,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        key,
      })) return;
      // Existing shortcut predicates use !editable. After preserving OS text
      // editing commands above, let application Ctrl/Meta commands through.
      if (editable && ctrl) editable = false;

      // Ctrl+Shift+Alt+S → 画像書き出し (PNG/JPG) — Photoshop「Web用に保存」風。
      // Ctrl+Shift+S (alt なし) の .llab「名前を付けて保存」と alt の有無で区別する。
      // e.code === 'KeyS' も見るのは、Ctrl+Alt=AltGr で e.key が化ける配列対策。
      if (ctrl && e.shiftKey && e.altKey && (key === 's' || e.code === 'KeyS') && !editable) {
        e.preventDefault();
        handlersRef.current.onExport?.();
        return;
      }

      if (ctrl && key === 's' && !editable) {
        e.preventDefault();
        if (e.shiftKey) {
          saveCurrentAs().then((r) => {
            if (!r.ok && r.error && r.error !== 'cancelled') alert(`${t({ ja: '保存失敗', en: 'Save failed' })}: ${r.error}`);
          });
        } else {
          saveCurrent().then((r) => {
            if (!r.ok && r.error && r.error !== 'cancelled') alert(`${t({ ja: '保存失敗', en: 'Save failed' })}: ${r.error}`);
          });
        }
        return;
      }
      if (ctrl && key === 'o' && !editable) {
        e.preventDefault();
        openProject().then((r) => {
          if (!r.ok && r.error && r.error !== 'cancelled') alert(`${t({ ja: '読み込み失敗', en: 'Open failed' })}: ${r.error}`);
        });
        return;
      }
      if (ctrl && key === 'v' && !editable) {
        e.preventDefault();
        pasteFromClipboard().then((r) => {
          if (!r.ok && r.error) console.warn('[paste]', r.error);
        });
        return;
      }
      if (ctrl && key === 'c' && !e.shiftKey && !e.altKey && !editable) {
        if (selectedId) {
          e.preventDefault();
          copyLayerSelectionToClipboard(false);
        }
        return;
      }
      if (ctrl && e.shiftKey && e.altKey && key === 'b' && !editable) {
        e.preventDefault();
        handlersRef.current.onAdjustment?.('blackAndWhite');
        return;
      }
      if (ctrl && e.shiftKey && !e.altKey && key === 'u' && !editable) {
        e.preventDefault();
        handlersRef.current.onDesaturateImage?.();
        return;
      }
      if (ctrl && e.altKey && !e.shiftKey && key === 'c' && !editable) {
        e.preventDefault();
        handlersRef.current.onCanvasSize?.();
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey && !editable) {
        const adjustmentShortcut: Partial<Record<string, AdjustmentMode>> = {
          l: 'levels',
          m: 'curves',
          u: 'hueSaturation',
          b: 'colorBalance',
        };
        const adjustment = adjustmentShortcut[key];
        if (adjustment) {
          e.preventDefault();
          handlersRef.current.onAdjustment?.(adjustment);
          return;
        }
        if (key === 'i') {
          e.preventDefault();
          handlersRef.current.onInvertImage?.();
          return;
        }
      }
      if (ctrl && key === 'g' && !editable) {
        e.preventDefault();
        if (e.altKey) {
          if (selectedId) state.toggleClipped(selectedId);
        } else if (e.shiftKey) {
          state.ungroupSelected();
        } else {
          state.groupSelected();
        }
        return;
      }
      if (ctrl && e.shiftKey && e.code === 'Semicolon' && !editable) {
        e.preventDefault();
        state.toggleShowGuides();
        return;
      }
      if (ctrl && !e.shiftKey && key === 'z' && !editable) {
        e.preventDefault();
        undo();
        return;
      }
      if (
        ((ctrl && e.shiftKey && key === 'z') ||
          (ctrl && key === 'y')) &&
        !editable
      ) {
        e.preventDefault();
        redo();
        return;
      }
      if (ctrl && key === 'j' && !e.shiftKey && !editable) {
        e.preventDefault();
        if (state.selection) void newLayerFromSelection(false);
        else duplicateSelectedLayers();
        return;
      }
      // Ctrl+E = 選択中の複数レイヤーを統合（Photoshop「レイヤーを結合」）
      if (ctrl && key === 'e' && !e.shiftKey && !e.altKey && !editable) {
        e.preventDefault();
        if (state.selectedIds.length > 0) mergeSelectedLayers();
        return;
      }
      if (ctrl && key === 't' && !editable) {
        e.preventDefault();
        // 自由変形: 移動ツールに切替え変形ハンドルを表示（選択必須）
        if (state.selectedIds.length > 0) state.setTool('move');
        return;
      }
      if (ctrl && key === 'a' && !editable) {
        e.preventDefault();
        if (e.altKey) {
          state.selectMany(state.layers.map((layer) => layer.id));
          return;
        }
        const c = state.canvas;
        state.commitSelection({ type: 'rect', x: 0, y: 0, width: c.width, height: c.height }, 'replace');
        return;
      }
      if (ctrl && e.shiftKey && key === 'i' && !editable) {
        e.preventDefault();
        if (state.selection) state.invertSelection();
        return;
      }
      if (ctrl && e.shiftKey && key === 'j' && !editable) {
        e.preventDefault();
        if (state.selection) void newLayerFromSelection(true);
        return;
      }
      // Ctrl+X = Photoshop/OS標準のカット。旧「レイヤー切抜き」割当は廃止。
      if (ctrl && key === 'x' && !e.shiftKey && !e.altKey && !editable) {
        if (selectedId) {
          e.preventDefault();
          copyLayerSelectionToClipboard(true);
        }
        return;
      }
      if (e.shiftKey && !ctrl && e.key === 'F5' && !editable) {
        e.preventDefault();
        if (state.selection) fillSelection('fg');
        return;
      }
      if (ctrl && key === 'd' && !editable) {
        e.preventDefault();
        // 選択範囲があればまず解除、無ければレイヤー選択解除（Photoshop互換）
        if (state.selection) state.setSelection(null);
        else state.selectLayer(null);
        return;
      }
      if (ctrl && key === '0' && !editable) {
        e.preventDefault();
        state.resetViewport();
        return;
      }
      const layerOrderCommand = getLayerOrderCommand(e);
      if (layerOrderCommand && !editable) {
        e.preventDefault();
        if (selectedId) {
          if (layerOrderCommand === 'front' || layerOrderCommand === 'back') {
            state.moveLayerEnd(selectedId, layerOrderCommand);
          } else {
            state.moveLayer(selectedId, layerOrderCommand);
          }
        }
        return;
      }
      // Ctrl+Shift+N = 新規（空の透明）レイヤーを追加（Photoshop互換）
      if (ctrl && e.shiftKey && key === 'n' && !editable) {
        e.preventDefault();
        addBlankLayer();
        return;
      }
      if (ctrl && key === 'n' && !e.shiftKey && !editable) {
        e.preventDefault();
        handlersRef.current.onNew?.();
        return;
      }
      // Ctrl+Tab = 次のドキュメントタブへ切替
      if (ctrl && e.key === 'Tab' && !editable) {
        e.preventDefault();
        const ws = workspaceStore.getState();
        if (ws.docs.length > 1) {
          const idx = ws.docs.findIndex((d) => d.id === ws.activeId);
          const next = ws.docs[(idx + 1) % ws.docs.length];
          ws.setActive(next.id);
        }
        return;
      }
      // Ctrl+W = アクティブなドキュメントタブを閉じる（未保存なら確認）
      if (ctrl && key === 'w' && !editable) {
        e.preventDefault();
        const ws = workspaceStore.getState();
        const active = ws.docs.find((d) => d.id === ws.activeId);
        if (active && (
          active.store.getState().dirty
          || active.store.getState().pendingOperations > 0
        )) {
          const name = active.store.getState().currentFilePath ?? active.title;
          if (
            !confirm(
              t({
                ja: `「${name}」は未保存の変更があります。閉じますか？`,
                en: `"${name}" has unsaved changes. Close it?`,
              }),
            )
          )
            return;
        }
        ws.closeDoc(ws.activeId);
        return;
      }

      // Never fall through to Electron/Chromium defaults such as Reload,
      // Print or Location after all supported application commands were tried.
      if (ctrl) {
        e.preventDefault();
        return;
      }

      if (startedEditable || interactiveTarget) return;

      if (e.key === 'Tab') {
        e.preventDefault();
        state.togglePanels();
        return;
      }

      // Space = 一時ハンド（押下中だけパン）
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) temporaryHand.begin(getActiveStore());
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        // Photoshop同様、Escは進行中のツール操作を終了する。選択解除はCtrl+D。
        if (state.tool !== 'move') state.setTool('move');
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selection) {
          e.preventDefault();
          clearLayerSelection();
        } else if (selectedId) {
          e.preventDefault();
          deleteSelectedLayers();
        }
        return;
      }

      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        if (!selectedId) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        state.nudgeLayers(state.selectedIds, dx, dy);
        return;
      }

      if (key === 'u' && e.shiftKey && !ctrl && !e.altKey) {
        e.preventDefault();
        if (state.tool !== 'shape') {
          state.setTool('shape');
        } else {
          const idx = SHAPE_CYCLE.indexOf(state.shapeKind);
          state.setShapeKind(SHAPE_CYCLE[(idx + 1) % SHAPE_CYCLE.length]);
        }
        return;
      }

      if (key === 'm' && e.shiftKey && !ctrl && !e.altKey) {
        e.preventDefault();
        if (state.tool !== 'marquee') state.setTool('marquee');
        else state.setMarqueeKind(state.marqueeKind === 'rect' ? 'ellipse' : 'rect');
        return;
      }

      if ((key === 'b' || key === 'e') && !ctrl && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        state.setBrushEraser(key === 'e');
        state.setTool('brush');
        return;
      }

      if (TOOL_HOTKEYS[key] && !ctrl && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        state.setTool(TOOL_HOTKEYS[key]);
        return;
      }

      if (key === 'd' && !ctrl && !e.altKey) {
        e.preventDefault();
        state.resetColors();
        return;
      }

      if (key === 'x' && !ctrl && !e.altKey) {
        e.preventDefault();
        state.swapColors();
        return;
      }

      // ブラシサイズ/硬さショートカット（Photoshop互換）
      // e.code を使うことで Shift+[ → { 等のキー変換に対応
      if (e.code === 'BracketLeft' && !ctrl && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) {
          state.setBrushHardness(state.brushHardness - 10);
        } else {
          state.setBrushSize(state.brushSize - 10);
        }
        return;
      }
      if (e.code === 'BracketRight' && !ctrl && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) {
          state.setBrushHardness(state.brushHardness + 10);
        } else {
          state.setBrushSize(state.brushSize + 10);
        }
        return;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Space を離したら一時ハンドを解除して元ツールへ
      if (e.code === 'Space') temporaryHand.release();
    };

    const unsubscribeWorkspace = workspaceStore.subscribe((next, previous) => {
      if (next.activeId !== previous.activeId) temporaryHand.release();
    });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', temporaryHand.release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', temporaryHand.release);
      unsubscribeWorkspace();
      temporaryHand.release();
    };
  }, []);
}
