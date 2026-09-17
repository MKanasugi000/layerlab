import type { Tool } from '../types';
import type { Bi } from '../i18n/locale';

interface HintContext {
  tool: Tool;
  brushEraser?: boolean;
}

/** Compact, context-sensitive reminders for Photoshop muscle memory. */
export function photoshopToolHint({ tool, brushEraser = false }: HintContext): Bi {
  switch (tool) {
    case 'move':
      return {
        ja: 'Alt+ドラッグ=複製 · Shift=方向固定 · 矢印=1px / Shift=10px',
        en: 'Alt+drag=Copy · Shift=Constrain · Arrows=1px / Shift=10px',
      };
    case 'marquee':
    case 'lasso':
    case 'wand':
      return {
        ja: 'Shift=追加 · Alt=削除 · Shift+Alt=交差 · Ctrl+D=解除',
        en: 'Shift=Add · Alt=Subtract · Shift+Alt=Intersect · Ctrl+D=Deselect',
      };
    case 'brush':
      return brushEraser
        ? {
            ja: '[ / ]=サイズ · Shift+[ / ]=硬さ · Shift+クリック=直線',
            en: '[ / ]=Size · Shift+[ / ]=Hardness · Shift+click=Line',
          }
        : {
            ja: 'Alt+クリック=スポイト · [ / ]=サイズ · Shift+クリック=直線',
            en: 'Alt+click=Eyedropper · [ / ]=Size · Shift+click=Line',
          };
    case 'text':
      return {
        ja: 'クリック=新規文字 · 文字をダブルクリック=編集 · Enter=確定',
        en: 'Click=New type · Double-click type=Edit · Enter=Commit',
      };
    case 'shape':
      return {
        ja: 'ドラッグ=作成 · Shift=正方形/正円/45° · Shift+U=種類切替',
        en: 'Drag=Draw · Shift=Square/Circle/45° · Shift+U=Cycle',
      };
    case 'crop':
      return {
        ja: 'ドラッグ=範囲 · Enter=確定 · Esc=取消',
        en: 'Drag=Area · Enter=Apply · Esc=Cancel',
      };
    case 'eyedropper':
      return {
        ja: 'クリック=前景色 · Alt+クリック=背景色',
        en: 'Click=Foreground · Alt+click=Background',
      };
    case 'hand':
      return {
        ja: 'ドラッグ=パン · Space長押し=一時手のひら',
        en: 'Drag=Pan · Hold Space=Temporary Hand',
      };
    case 'zoom':
      return {
        ja: 'クリック=拡大 · Alt+クリック=縮小 · Ctrl+0=全体表示',
        en: 'Click=Zoom in · Alt+click=Zoom out · Ctrl+0=Fit',
      };
  }
}
