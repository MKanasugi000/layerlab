import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import {
  clamp,
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  rgbToHsv,
  normalizeHex,
  type HSV,
} from '../utils/color';
import { useT } from '../i18n/locale';
import { ModalShell } from './ModalShell';

const DEFAULT_SWATCHES = [
  '#000000', '#404040', '#808080', '#bfbfbf', '#ffffff',
  '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be',
  '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d92',
  '#8b5a2b', '#c0392b', '#27ae60', '#2980b9', '#f1c40f',
];

interface Props {
  initial: string;
  title?: string;
  onApply: (hex: string) => void;
  onClose: () => void;
}

export function ColorPickerDialog({ initial, title, onApply, onClose }: Props) {
  const t = useT();
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(initial));
  const recentColors = useEditorStore((s) => s.recentColors);
  const pushRecentColor = useEditorStore((s) => s.pushRecentColor);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // ドラッグ中にダイアログが閉じても window リスナーを確実に解放
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const rgb = hsvToRgb(hsv);
  const hex = hsvToHex(hsv);
  const hueHex = hsvToHex({ h: hsv.h, s: 100, v: 100 });

  const dragSV = (clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = clamp((clientX - r.left) / r.width, 0, 1) * 100;
    const v = (1 - clamp((clientY - r.top) / r.height, 0, 1)) * 100;
    setHsv((h) => ({ ...h, s, v }));
  };
  const dragHue = (clientY: number) => {
    const el = hueRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = clamp((clientY - r.top) / r.height, 0, 1) * 360;
    setHsv((cur) => ({ ...cur, h }));
  };

  const startDrag = (
    e: React.PointerEvent,
    move: (x: number, y: number) => void,
  ) => {
    e.preventDefault();
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      dragCleanupRef.current = null;
    };
    const onUp = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    dragCleanupRef.current = cleanup;
  };

  const setRgb = (r: number, g: number, b: number) =>
    setHsv(rgbToHsv({ r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) }));

  const apply = () => {
    pushRecentColor(hex);
    onApply(hex);
    onClose();
  };

  const numField = (
    label: string,
    value: number,
    max: number,
    onChange: (v: number) => void,
  ) => (
    <label className="cp-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={Math.round(value)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );

  return (
    <ModalShell
      title={title ?? t({ ja: 'カラーピッカー', en: 'Color Picker' })}
      className="color-picker-modal"
      onClose={onClose}
      onEnter={apply}
    >
        <div className="cp-main">
          <div
            ref={svRef}
            className="cp-sv"
            style={{
              background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueHex})`,
            }}
            onPointerDown={(e) => startDrag(e, dragSV)}
          >
            <span
              className="cp-sv-knob"
              style={{
                left: `${hsv.s}%`,
                top: `${100 - hsv.v}%`,
                background: hex,
              }}
            />
          </div>
          <div
            ref={hueRef}
            className="cp-hue"
            onPointerDown={(e) => startDrag(e, (_, y) => dragHue(y))}
          >
            <span className="cp-hue-knob" style={{ top: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div className="cp-fields">
            <div className="cp-compare">
              <div className="cp-compare-new" style={{ background: hex }} title={t({ ja: '新しい色', en: 'New color' })} />
            </div>
            {numField('H', hsv.h, 360, (v) => setHsv((h) => ({ ...h, h: clamp(v, 0, 360) })))}
            {numField('S', hsv.s, 100, (v) => setHsv((h) => ({ ...h, s: clamp(v, 0, 100) })))}
            {numField('B', hsv.v, 100, (v) => setHsv((h) => ({ ...h, v: clamp(v, 0, 100) })))}
            <div className="cp-gap" />
            {numField('R', rgb.r, 255, (v) => setRgb(v, rgb.g, rgb.b))}
            {numField('G', rgb.g, 255, (v) => setRgb(rgb.r, v, rgb.b))}
            {numField('B', rgb.b, 255, (v) => setRgb(rgb.r, rgb.g, v))}
            <label className="cp-field cp-hex">
              <span>#</span>
              <input
                type="text"
                value={hex.replace('#', '')}
                spellCheck={false}
                maxLength={7}
                onChange={(e) => {
                  const n = normalizeHex(e.target.value);
                  if (n) setHsv(hexToHsv(n));
                }}
              />
            </label>
          </div>
        </div>

        {recentColors.length > 0 && (
          <div className="cp-swatch-block">
            <div className="cp-swatch-label">{t({ ja: '最近使った色', en: 'Recently used colors' })}</div>
            <div className="cp-swatches">
              {recentColors.map((c) => (
                <button
                  key={c}
                  className="cp-swatch"
                  style={{ background: c }}
                  title={c}
                  onClick={() => setHsv(hexToHsv(c))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="cp-swatch-block">
          <div className="cp-swatch-label">{t({ ja: 'スウォッチ', en: 'Swatches' })}</div>
          <div className="cp-swatches">
            {DEFAULT_SWATCHES.map((c) => (
              <button
                key={c}
                className="cp-swatch"
                style={{ background: c }}
                title={c}
                onClick={() => setHsv(hexToHsv(c))}
              />
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>{t({ ja: 'キャンセル', en: 'Cancel' })}</button>
          <button className="primary" onClick={apply}>
            OK
          </button>
        </div>
    </ModalShell>
  );
}
