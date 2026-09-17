import { useRef } from 'react';
import { useT } from '../i18n/locale';

interface Props {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  /** 小数桁数（既定0=整数表示） */
  precision?: number;
  /** 1px ドラッグあたりの変化量（既定 step 相当） */
  sensitivity?: number;
  className?: string;
  title?: string;
}

/**
 * Photoshop風スクラブ数値入力。
 * - 横ドラッグで値変更（Shift=×10 / Alt=×0.1）
 * - クリックでフォーカスして直接入力
 * - 矢印キーはネイティブ動作
 */
export function ScrubNumber({
  value,
  onChange,
  step = 1,
  min,
  max,
  precision = 0,
  sensitivity,
  className,
  title,
}: Props) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ startX: number; startV: number; moved: boolean } | null>(null);

  const clampV = (v: number) => {
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    const p = Math.pow(10, precision);
    return Math.round(v * p) / p;
  };

  const unit = sensitivity ?? step;

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (e.button !== 0) return;
    // フォーカス即発火を抑止（ドラッグ中はキャレットを出さない）
    e.preventDefault();
    drag.current = { startX: e.clientX, startV: value, moved: false };

    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      if (!d.moved) {
        if (Math.abs(dx) < 3) return;
        d.moved = true;
        inputRef.current?.blur();
        document.body.style.cursor = 'ew-resize';
      }
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      onChange(clampV(d.startV + dx * unit * mult));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      if (drag.current && !drag.current.moved) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const display = Number.isFinite(value)
    ? precision > 0
      ? value
      : Math.round(value)
    : 0;

  return (
    <input
      ref={inputRef}
      type="number"
      className={`scrub-number ${className ?? ''}`}
      title={title ?? t({ ja: 'ドラッグで増減 / クリックで入力 (Shift=×10, Alt=×0.1)', en: 'Drag to adjust / Click to type (Shift=×10, Alt=×0.1)' })}
      value={display}
      step={step}
      onPointerDown={onPointerDown}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(clampV(Number.isNaN(v) ? min ?? 0 : v));
      }}
    />
  );
}