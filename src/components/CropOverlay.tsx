import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useT } from '../i18n/locale';

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r' | 'move';

interface AspectPreset {
  id: string;
  label: string;
  ratio: number | null;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1-1', label: '1:1', ratio: 1 },
  { id: '16-9', label: '16:9', ratio: 16 / 9 },
  { id: '4-3', label: '4:3', ratio: 4 / 3 },
  { id: '3-2', label: '3:2', ratio: 3 / 2 },
  { id: '9-16', label: '9:16 縦', ratio: 9 / 16 },
];

export function CropOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const viewport = useEditorStore((s) => s.viewport);
  const applyCrop = useEditorStore((s) => s.applyCrop);

  const [rect, setRect] = useState({
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
  });
  const [aspectId, setAspectId] = useState('free');

  const aspect = ASPECT_PRESETS.find((p) => p.id === aspectId)?.ratio ?? null;

  const dragRef = useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    startRect: typeof rect;
  } | null>(null);

  const handleMouseDown = (handle: Handle, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...rect },
    };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / viewport.scale;
      const dy = (e.clientY - d.startY) / viewport.scale;
      let { x, y, width, height } = d.startRect;

      const minSize = 10;
      switch (d.handle) {
        case 'tl':
          x += dx; y += dy; width -= dx; height -= dy; break;
        case 'tr':
          y += dy; width += dx; height -= dy; break;
        case 'bl':
          x += dx; width -= dx; height += dy; break;
        case 'br':
          width += dx; height += dy; break;
        case 't':
          y += dy; height -= dy; break;
        case 'b':
          height += dy; break;
        case 'l':
          x += dx; width -= dx; break;
        case 'r':
          width += dx; break;
        case 'move':
          x += dx; y += dy; break;
      }

      if (aspect && d.handle !== 'move') {
        if (['tl', 'tr', 'bl', 'br'].includes(d.handle)) {
          height = width / aspect;
          if (d.handle === 'tl' || d.handle === 'tr') {
            y = d.startRect.y + d.startRect.height - height;
          }
        } else if (['t', 'b'].includes(d.handle)) {
          width = height * aspect;
          x = d.startRect.x + (d.startRect.width - width) / 2;
        } else if (['l', 'r'].includes(d.handle)) {
          height = width / aspect;
          y = d.startRect.y + (d.startRect.height - height) / 2;
        }
      }

      if (width < minSize) width = minSize;
      if (height < minSize) height = minSize;

      setRect({ x, y, width, height });
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [viewport.scale, aspect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyCrop(rect.x, rect.y, rect.width, rect.height);
        onClose();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rect, applyCrop, onClose]);

  const scale = viewport.scale;
  const sx = rect.x * scale;
  const sy = rect.y * scale;
  const sw = rect.width * scale;
  const sh = rect.height * scale;

  return (
    <>
      <div className="crop-overlay-frame">
        <div
          className="crop-dim crop-dim-top"
          style={{ left: 0, top: 0, width: '100%', height: sy }}
        />
        <div
          className="crop-dim crop-dim-bottom"
          style={{ left: 0, top: sy + sh, width: '100%', bottom: 0 }}
        />
        <div
          className="crop-dim crop-dim-left"
          style={{ left: 0, top: sy, width: sx, height: sh }}
        />
        <div
          className="crop-dim crop-dim-right"
          style={{ left: sx + sw, top: sy, right: 0, height: sh }}
        />
        <div
          className="crop-rect"
          style={{ left: sx, top: sy, width: sw, height: sh }}
          onMouseDown={(e) => handleMouseDown('move', e)}
        >
          <div className="crop-grid">
            <div className="crop-grid-h" style={{ top: '33.33%' }} />
            <div className="crop-grid-h" style={{ top: '66.66%' }} />
            <div className="crop-grid-v" style={{ left: '33.33%' }} />
            <div className="crop-grid-v" style={{ left: '66.66%' }} />
          </div>
          <div className="crop-handle crop-handle-tl" onMouseDown={(e) => handleMouseDown('tl', e)} />
          <div className="crop-handle crop-handle-tr" onMouseDown={(e) => handleMouseDown('tr', e)} />
          <div className="crop-handle crop-handle-bl" onMouseDown={(e) => handleMouseDown('bl', e)} />
          <div className="crop-handle crop-handle-br" onMouseDown={(e) => handleMouseDown('br', e)} />
          <div className="crop-handle crop-handle-t" onMouseDown={(e) => handleMouseDown('t', e)} />
          <div className="crop-handle crop-handle-b" onMouseDown={(e) => handleMouseDown('b', e)} />
          <div className="crop-handle crop-handle-l" onMouseDown={(e) => handleMouseDown('l', e)} />
          <div className="crop-handle crop-handle-r" onMouseDown={(e) => handleMouseDown('r', e)} />
        </div>
      </div>
      <div className="crop-options-bar">
        <span className="crop-label">{t({ ja: '切り抜き:', en: 'Crop:' })}</span>
        <select value={aspectId} onChange={(e) => setAspectId(e.target.value)}>
          {ASPECT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {t({ ja: p.label, en: p.id === 'free' ? 'Free' : p.id === '9-16' ? '9:16 Portrait' : p.label })}
            </option>
          ))}
        </select>
        <span className="crop-dims">
          {Math.round(rect.width)} × {Math.round(rect.height)} px
        </span>
        <div className="crop-actions">
          <button
            className="crop-btn"
            onClick={onClose}
            title={t({ ja: 'キャンセル (Esc)', en: 'Cancel (Esc)' })}
          >
            {t({ ja: '✕ 取消', en: '✕ Cancel' })}
          </button>
          <button
            className="crop-btn primary"
            onClick={() => {
              applyCrop(rect.x, rect.y, rect.width, rect.height);
              onClose();
            }}
            title={t({ ja: '確定 (Enter)', en: 'Confirm (Enter)' })}
          >
            {t({ ja: '✓ 確定', en: '✓ Confirm' })}
          </button>
        </div>
      </div>
    </>
  );
}