import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';

const RULER_SIZE = 22;
const TICK_COLOR = '#666';
const LABEL_COLOR = '#aaa';
const BG = '#202020';

function pickStep(scale: number): number {
  const screenStep = 100 * scale;
  const targets = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
  for (const t of targets) {
    if (t * scale >= 50) return t;
  }
  if (screenStep < 50) return 2000;
  return 100;
}

export function Ruler({
  orientation,
  wrapSize,
}: {
  orientation: 'h' | 'v';
  wrapSize: { w: number; h: number };
}) {
  const canvas = useEditorStore((s) => s.canvas);
  const viewport = useEditorStore((s) => s.viewport);
  const addGuide = useEditorStore((s) => s.addGuide);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<{
    axis: 'v' | 'h';
    pos: number;
  } | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    const W = orientation === 'h' ? wrapSize.w : RULER_SIZE;
    const H = orientation === 'h' ? RULER_SIZE : wrapSize.h;
    el.width = W * dpr;
    el.height = H * dpr;
    el.style.width = `${W}px`;
    el.style.height = `${H}px`;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = TICK_COLOR;
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '9px system-ui, sans-serif';

    const step = pickStep(viewport.scale);
    const minorStep = step / 5;

    if (orientation === 'h') {
      const startCanvasX = -viewport.x / viewport.scale;
      const endCanvasX = (W - viewport.x) / viewport.scale;
      const first = Math.ceil(startCanvasX / minorStep) * minorStep;
      for (let cx = first; cx <= endCanvasX; cx += minorStep) {
        const sx = cx * viewport.scale + viewport.x;
        const isMajor = Math.abs(cx / step - Math.round(cx / step)) < 0.001;
        ctx.beginPath();
        ctx.moveTo(sx + 0.5, H);
        ctx.lineTo(sx + 0.5, isMajor ? H - 12 : H - 5);
        ctx.stroke();
        if (isMajor) {
          ctx.fillText(String(Math.round(cx)), sx + 2, H - 13);
        }
      }
    } else {
      const startCanvasY = -viewport.y / viewport.scale;
      const endCanvasY = (H - viewport.y) / viewport.scale;
      const first = Math.ceil(startCanvasY / minorStep) * minorStep;
      for (let cy = first; cy <= endCanvasY; cy += minorStep) {
        const sy = cy * viewport.scale + viewport.y;
        const isMajor = Math.abs(cy / step - Math.round(cy / step)) < 0.001;
        ctx.beginPath();
        ctx.moveTo(W, sy + 0.5);
        ctx.lineTo(isMajor ? W - 12 : W - 5, sy + 0.5);
        ctx.stroke();
        if (isMajor) {
          ctx.save();
          ctx.translate(W - 14, sy - 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(String(Math.round(cy)), 0, 0);
          ctx.restore();
        }
      }
    }
  }, [orientation, wrapSize, viewport.x, viewport.y, viewport.scale, canvas.width, canvas.height]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    if (orientation === 'h') {
      const screenX = e.clientX - rect.left;
      const canvasX = (screenX - viewport.x) / viewport.scale;
      setDragging({ axis: 'v', pos: canvasX });
    } else {
      const screenY = e.clientY - rect.top;
      const canvasY = (screenY - viewport.y) / viewport.scale;
      setDragging({ axis: 'h', pos: canvasY });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return;
    if (orientation === 'h') {
      const rect = e.currentTarget.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const canvasX = (screenX - viewport.x) / viewport.scale;
      setDragging({ axis: 'v', pos: canvasX });
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      const screenY = e.clientY - rect.top;
      const canvasY = (screenY - viewport.y) / viewport.scale;
      setDragging({ axis: 'h', pos: canvasY });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!dragging) return;
    const within =
      dragging.axis === 'v'
        ? dragging.pos >= 0 && dragging.pos <= canvas.width
        : dragging.pos >= 0 && dragging.pos <= canvas.height;
    if (within) {
      addGuide(dragging.axis, dragging.pos);
    }
    setDragging(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className={`ruler ruler-${orientation}`}
      style={
        orientation === 'h'
          ? { position: 'absolute', top: 0, left: RULER_SIZE, cursor: 'ns-resize' }
          : { position: 'absolute', top: RULER_SIZE, left: 0, cursor: 'ew-resize' }
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}

export const RULER_OFFSET = RULER_SIZE;
