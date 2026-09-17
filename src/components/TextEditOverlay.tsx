import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextLayer } from '../types';

// ズームを引いた大きいキャンバスだと文字が極小になり打てない問題の下限。
// 編集中だけ適用（位置は左上アンカーのままなのでキャンバス上の位置はズレない）。
const MIN_EDIT_FONT_PX = 14;

export function TextEditOverlay({
  layer,
  scale,
  selectAll,
  onCommit,
  onCancel,
  onDraftChange,
}: {
  layer: TextLayer;
  scale: number;
  selectAll: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onDraftChange?: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);
  const [draft, setDraft] = useState(layer.text);

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(draft);
  };

  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  // 枠を内容にぴったりフィットさせる（長い行・複数行でも全文が見えるように）。
  const autoSize = () => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.width = '0px';
    ta.style.height = '0px';
    ta.style.width = `${ta.scrollWidth + 2}px`;
    ta.style.height = `${ta.scrollHeight}px`;
  };

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    if (selectAll) ta.select();
  }, [selectAll]);

  const fontWeight = layer.fontStyle.includes('bold') ? 'bold' : 'normal';
  const fontStyleCss = layer.fontStyle.includes('italic') ? 'italic' : 'normal';
  const rawFontSize = layer.fontSize * layer.scaleY * scale;
  const visualFontSize = Math.max(MIN_EDIT_FONT_PX, rawFontSize);

  // 文字内容・フォントサイズが変わるたびに枠を再フィット（描画前=ちらつき無し）。
  useLayoutEffect(() => {
    autoSize();
  }, [draft, visualFontSize, layer.fontFamily, layer.fontStyle, layer.align]);

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraftChange?.(e.target.value);
        autoSize();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'F5') e.preventDefault();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
        // Ctrl/Cmd+S continues to the window-level save shortcut, whose
        // document transaction flushes this registered draft first.
        // Let every application Ctrl/Cmd command reach the global policy: it
        // either performs a LayerLab action (Save/Close/Open) or suppresses the
        // Chromium default (Reload/Print/Location). Native edit commands are
        // explicitly preserved by that policy. AltGr remains ordinary input.
        if (!(e.ctrlKey || e.metaKey) || e.getModifierState('AltGraph')) {
          e.stopPropagation();
        }
      }}
      className="text-edit-overlay"
      style={{
        position: 'absolute',
        left: layer.x * scale,
        top: layer.y * scale,
        fontFamily: `"${layer.fontFamily}", sans-serif`,
        fontSize: visualFontSize,
        color: layer.fill,
        fontStyle: fontStyleCss,
        fontWeight,
        textAlign: layer.align,
        transformOrigin: 'top left',
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        opacity: layer.opacity,
      }}
    />
  );
}
