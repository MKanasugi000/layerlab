import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import { useT } from '../i18n/locale';
import type { ColorAdjustments, CurvePoint, ImageLayer, LevelsChannel, ToneBalance } from '../types';
import {
  ADJUSTMENT_MODE_LABELS,
  DEFAULT_COLOR_ADJUSTMENTS,
  applyColorAdjustmentsToRgba,
  colorAdjustmentsForLayer,
  curveLut,
  normalizeColorAdjustments,
  normalizeCurve,
  resetAdjustmentMode,
  type AdjustmentMode,
} from '../imaging/colorAdjustments';
import { commitImageAdjustment } from '../utils/selectionOps';

interface Props {
  layerId: string;
  mode: AdjustmentMode;
  onClose: () => void;
}

function formatValue(value: number, precision: number) {
  const rounded = value.toFixed(precision);
  return value > 0 ? `+${rounded}` : rounded;
}

function AdjustmentSlider({
  label,
  value,
  min,
  max,
  step = 1,
  precision = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="adjustment-control">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <input
        className="adjustment-number"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(precision))}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      <span className="adjustment-readout">{formatValue(value, precision)}</span>
    </label>
  );
}

function useHistogram(src: string, adjustments: ColorAdjustments) {
  const empty = () => Array(256).fill(0) as number[];
  const [values, setValues] = useState<Record<'rgb' | 'red' | 'green' | 'blue', number[]>>(() => ({
    rgb: empty(), red: empty(), green: empty(), blue: empty(),
  }));
  useEffect(() => {
    let alive = true;
    const image = new Image();
    image.onload = () => {
      const longest = Math.max(image.naturalWidth, image.naturalHeight);
      const scale = Math.min(1, 512 / Math.max(1, longest));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      applyColorAdjustmentsToRgba(pixels, adjustments);
      const bins = { rgb: empty(), red: empty(), green: empty(), blue: empty() };
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue;
        const luminance = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
        bins.rgb[luminance] += 1;
        bins.red[pixels[i]] += 1;
        bins.green[pixels[i + 1]] += 1;
        bins.blue[pixels[i + 2]] += 1;
      }
      if (alive) setValues(bins);
    };
    image.src = src;
    return () => {
      alive = false;
      image.onload = null;
    };
  }, [src, JSON.stringify(adjustments)]);
  return values;
}

function Histogram({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => `${index},${100 - Math.sqrt(value / max) * 96}`)
    .join(' ');
  return (
    <svg className="adjustment-histogram" viewBox="0 0 255 100" preserveAspectRatio="none" aria-label="Histogram">
      <polygon points={`0,100 ${points} 255,100`} />
    </svg>
  );
}

function CurveEditor({
  points,
  histogram,
  onChange,
}: {
  points: CurvePoint[];
  histogram: number[];
  onChange: (points: CurvePoint[]) => void;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const normalized = normalizeCurve(points);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState<number | null>(null);
  const selectedPoint = normalized[Math.min(selected, normalized.length - 1)];
  const maxHistogram = Math.max(1, ...histogram);
  const histogramPoints = histogram
    .map((value, index) => `${index},${255 - Math.sqrt(value / maxHistogram) * 245}`)
    .join(' ');
  const displayLut = curveLut(normalized);
  const curvePoints = [...displayLut].map((value, x) => `${x},${255 - value}`).join(' ');

  const eventPoint = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.round(Math.min(255, Math.max(0, (event.clientX - rect.left) / rect.width * 255))),
      y: Math.round(Math.min(255, Math.max(0, 255 - (event.clientY - rect.top) / rect.height * 255))),
    };
  };

  const updatePoint = (index: number, next: CurvePoint) => {
    const copy = normalized.map((point) => ({ ...point }));
    const previousX = index > 0 ? copy[index - 1].x + 1 : 0;
    const nextX = index < copy.length - 1 ? copy[index + 1].x - 1 : 255;
    copy[index] = {
      x: index === 0 || index === copy.length - 1
        ? copy[index].x
        : Math.min(nextX, Math.max(previousX, next.x)),
      y: Math.min(255, Math.max(0, next.y)),
    };
    onChange(copy);
  };

  const removeSelected = () => {
    if (selected <= 0 || selected >= normalized.length - 1) return;
    onChange(normalized.filter((_, index) => index !== selected));
    setSelected(Math.max(0, selected - 1));
  };

  const selectRelative = (delta: number) => {
    setSelected((current) => Math.max(0, Math.min(normalized.length - 1, current + delta)));
  };

  const addPoint = () => {
    if (normalized.length >= 16) return;
    const leftIndex = selected >= normalized.length - 1 ? normalized.length - 2 : selected;
    const left = normalized[Math.max(0, leftIndex)];
    const right = normalized[Math.max(1, leftIndex + 1)];
    if (!left || !right || right.x - left.x <= 1) return;
    const x = Math.round((left.x + right.x) / 2);
    const point = { x, y: displayLut[x] };
    const next = normalizeCurve([...normalized, point]);
    onChange(next);
    setSelected(next.findIndex((candidate) => candidate.x === x));
  };

  return (
    <div className="curve-editor">
      <svg
        ref={svgRef}
        className="curve-graph"
        viewBox="0 0 255 255"
        role="application"
        aria-label={t({ ja: 'トーンカーブ編集', en: 'Curves editor' })}
        aria-keyshortcuts="Insert PageUp PageDown Delete ArrowUp ArrowDown ArrowLeft ArrowRight"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            event.stopPropagation();
            removeSelected();
            return;
          }
          if (event.key === 'PageUp' || event.key === 'PageDown') {
            event.preventDefault();
            event.stopPropagation();
            selectRelative(event.key === 'PageDown' ? 1 : -1);
            return;
          }
          if (event.key === 'Insert') {
            event.preventDefault();
            event.stopPropagation();
            addPoint();
            return;
          }
          const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          const dy = event.key === 'ArrowDown' ? -1 : event.key === 'ArrowUp' ? 1 : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 10 : 1;
          updatePoint(selected, { x: selectedPoint.x + dx * step, y: selectedPoint.y + dy * step });
        }}
        onPointerDown={(event) => {
          if (normalized.length >= 16) return;
          const point = eventPoint(event);
          const next = normalizeCurve([...normalized, point]);
          const index = next.findIndex((candidate) => candidate.x === point.x);
          onChange(next);
          setSelected(index);
          setDragging(index);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragging == null) return;
          updatePoint(dragging, eventPoint(event));
        }}
        onPointerUp={(event) => {
          setDragging(null);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <defs>
          <pattern id="curve-grid" width="63.75" height="63.75" patternUnits="userSpaceOnUse">
            <path d="M 63.75 0 L 0 0 0 63.75" fill="none" stroke="#555" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="255" height="255" fill="#1b1b1b" />
        <rect width="255" height="255" fill="url(#curve-grid)" />
        <polygon points={`0,255 ${histogramPoints} 255,255`} className="curve-histogram" />
        <line x1="0" y1="255" x2="255" y2="0" className="curve-baseline" />
        <polyline points={curvePoints} className="curve-line" />
        {normalized.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            cx={point.x}
            cy={255 - point.y}
            r={index === selected ? 5.5 : 4}
            className={index === selected ? 'selected' : ''}
            onPointerDown={(event) => {
              event.stopPropagation();
              setSelected(index);
              setDragging(index);
              svgRef.current?.setPointerCapture(event.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="curve-point-fields">
        <button type="button" disabled={selected === 0} onClick={() => selectRelative(-1)} aria-label={t({ ja: '前のポイント', en: 'Previous point' })}>
          ◀
        </button>
        <span aria-live="polite">
          {t({ ja: `点 ${selected + 1}/${normalized.length}`, en: `Point ${selected + 1}/${normalized.length}` })}
        </span>
        <button type="button" disabled={selected >= normalized.length - 1} onClick={() => selectRelative(1)} aria-label={t({ ja: '次のポイント', en: 'Next point' })}>
          ▶
        </button>
        <button type="button" disabled={normalized.length >= 16} onClick={addPoint}>
          {t({ ja: '点を追加', en: 'Add Point' })}
        </button>
        <label>
          Input
          <input type="number" min={0} max={255} value={selectedPoint.x} disabled={selected === 0 || selected === normalized.length - 1} onChange={(event) => updatePoint(selected, { ...selectedPoint, x: Number(event.target.value) })} />
        </label>
        <label>
          Output
          <input type="number" min={0} max={255} value={selectedPoint.y} onChange={(event) => updatePoint(selected, { ...selectedPoint, y: Number(event.target.value) })} />
        </label>
        <button type="button" disabled={selected === 0 || selected === normalized.length - 1} onClick={removeSelected}>
          {t({ ja: '点を削除', en: 'Delete Point' })}
        </button>
      </div>
    </div>
  );
}

const balanceField = (
  value: ToneBalance,
  key: keyof ToneBalance,
  next: number,
): ToneBalance => ({ ...value, [key]: next });

export function AdjustmentsDialog({ layerId, mode, onClose }: Props) {
  const t = useT();
  const layer = useEditorStore((state) => state.layers.find((candidate) => candidate.id === layerId)) as ImageLayer | undefined;
  const selection = useEditorStore((state) => state.selection);
  const setAdjustmentPreview = useEditorStore((state) => state.setAdjustmentPreview);
  const [draft, setDraft] = useState<ColorAdjustments>(() => {
    const fresh = normalizeColorAdjustments(DEFAULT_COLOR_ADJUSTMENTS);
    return mode === 'blackAndWhite' ? { ...fresh, blackAndWhite: true } : fresh;
  });
  const [preview, setPreview] = useState(true);
  const [applying, setApplying] = useState(false);
  const [altDown, setAltDown] = useState(false);
  const [balanceTone, setBalanceTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const [channel, setChannel] = useState<'rgb' | 'red' | 'green' | 'blue'>('rgb');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const moveCleanupRef = useRef<(() => void) | null>(null);
  const baseAdjustments = layer
    ? colorAdjustmentsForLayer(layer)
    : normalizeColorAdjustments(DEFAULT_COLOR_ADJUSTMENTS);
  const histograms = useHistogram(layer?.src ?? '', baseAdjustments);
  const histogram = histograms[channel];

  useEffect(() => {
    if (!layer || !preview) {
      setAdjustmentPreview(null);
      return;
    }
    // Slider input remains immediate, while the CPU-bound canvas filter waits
    // until the hand pauses. This avoids multi-second recaches for every event.
    const timeout = window.setTimeout(() => {
      setAdjustmentPreview({ layerId, adjustments: draft, selection });
    }, 100);
    return () => window.clearTimeout(timeout);
  }, [draft, layerId, preview, selection, setAdjustmentPreview]);

  useEffect(() => () => setAdjustmentPreview(null), [setAdjustmentPreview]);

  const cancel = () => {
    setAdjustmentPreview(null);
    onClose();
  };
  const apply = async () => {
    if (!layer || applying) return;
    setApplying(true);
    let applied = false;
    try {
      applied = await commitImageAdjustment(layer.id, draft, selection);
    } catch {
      applied = false;
    } finally {
      setApplying(false);
    }
    if (applied) onClose();
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltDown(true);
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!applying) cancel();
      } else if (
        event.key === 'Enter'
        && !applying
        && !(event.target instanceof HTMLButtonElement)
        && !(event.target instanceof HTMLSelectElement)
        && !(event.target instanceof SVGElement)
      ) {
        event.preventDefault();
        apply();
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setAltDown(false);
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
    };
  });

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      modalRef.current?.querySelector<HTMLElement>('input:not([type="checkbox"]), select, button')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, []);

  const patch = (value: Partial<ColorAdjustments>) => setDraft((current) => ({ ...current, ...value }));
  const slider = (
    label: string,
    key: keyof ColorAdjustments,
    min: number,
    max: number,
    step = 1,
    precision = 0,
  ) => (
    <AdjustmentSlider
      label={label}
      value={draft[key] as number}
      min={min}
      max={max}
      step={step}
      precision={precision}
      onChange={(value) => patch({ [key]: value })}
    />
  );

  const balanceKey = balanceTone === 'shadows'
    ? 'colorBalanceShadows'
    : balanceTone === 'highlights'
      ? 'colorBalanceHighlights'
      : 'colorBalanceMidtones';
  const currentBalance = draft[balanceKey];
  const levelChannelKey = channel === 'red'
    ? 'levelsRed'
    : channel === 'green'
      ? 'levelsGreen'
      : 'levelsBlue';
  const currentLevels: LevelsChannel = channel === 'rgb'
    ? {
        inputBlack: draft.inputBlack,
        inputGamma: draft.inputGamma,
        inputWhite: draft.inputWhite,
        outputBlack: draft.outputBlack,
        outputWhite: draft.outputWhite,
      }
    : draft[levelChannelKey];
  const setLevel = (key: keyof LevelsChannel, value: number) => {
    if (channel === 'rgb') patch({ [key]: value });
    else patch({ [levelChannelKey]: { ...currentLevels, [key]: value } });
  };
  const levelSlider = (
    label: string,
    key: keyof LevelsChannel,
    min: number,
    max: number,
    step = 1,
    precision = 0,
  ) => (
    <AdjustmentSlider label={label} value={currentLevels[key]} min={min} max={max} step={step} precision={precision} onChange={(value) => setLevel(key, value)} />
  );
  const curveKey = channel === 'rgb'
    ? 'curve'
    : channel === 'red'
      ? 'curveRed'
      : channel === 'green'
        ? 'curveGreen'
        : 'curveBlue';

  if (!layer) return null;
  const title = t(ADJUSTMENT_MODE_LABELS[mode]);

  const startMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, select')) return;
    const modal = modalRef.current;
    if (!modal) return;
    event.preventDefault();
    const rect = modal.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    moveCleanupRef.current?.();
    const onMove = (moveEvent: PointerEvent) => {
      setPosition({
        left: Math.max(0, Math.min(window.innerWidth - rect.width, moveEvent.clientX - offsetX)),
        top: Math.max(30, Math.min(window.innerHeight - 80, moveEvent.clientY - offsetY)),
      });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      moveCleanupRef.current = null;
    };
    moveCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
  };

  useEffect(() => () => moveCleanupRef.current?.(), []);

  return (
    <div className="modal-overlay adjustment-modal-overlay" role="presentation">
      <div
        ref={modalRef}
        className="modal adjustment-modal"
        role="dialog"
        aria-modal="false"
        aria-label={title}
        style={position ? { left: position.left, top: position.top, right: 'auto' } : undefined}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
          if (focusable.length === 0) return;
          const current = focusable.indexOf(document.activeElement as HTMLElement);
          const next = event.shiftKey
            ? (current <= 0 ? focusable.length - 1 : current - 1)
            : (current >= focusable.length - 1 ? 0 : current + 1);
          event.preventDefault();
          event.stopPropagation();
          focusable[next].focus();
        }}
      >
        <div className="adjustment-titlebar" onPointerDown={startMove}>
          <h2>{title}</h2>
          <span>{layer.name}</span>
        </div>

        {(mode === 'levels' || mode === 'curves') && (
          <div className="adjustment-channel-row">
            <label>
              {t({ ja: 'チャンネル', en: 'Channel' })}
              <select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}>
                <option value="rgb">RGB</option>
                <option value="red">{t({ ja: 'レッド', en: 'Red' })}</option>
                <option value="green">{t({ ja: 'グリーン', en: 'Green' })}</option>
                <option value="blue">{t({ ja: 'ブルー', en: 'Blue' })}</option>
              </select>
            </label>
          </div>
        )}

        {mode === 'levels' && <Histogram values={histogram} />}

        <div className="adjustment-body">
          {mode === 'brightnessContrast' && (
            <>
              {slider(t({ ja: '明るさ', en: 'Brightness' }), 'brightness', -150, 150)}
              {slider(t({ ja: 'コントラスト', en: 'Contrast' }), 'contrast', -50, 100)}
              <label className="adjustment-check">
                <input type="checkbox" checked={draft.legacyBrightnessContrast} onChange={(event) => patch({ legacyBrightnessContrast: event.target.checked })} />
                {t({ ja: '従来方式を使用', en: 'Use Legacy' })}
              </label>
            </>
          )}
          {mode === 'levels' && (
            <>
              <div className="adjustment-subtitle">{t({ ja: '入力レベル', en: 'Input Levels' })}</div>
              {levelSlider(t({ ja: 'シャドウ', en: 'Shadows' }), 'inputBlack', 0, Math.max(0, currentLevels.inputWhite - 1))}
              {levelSlider(t({ ja: '中間調', en: 'Midtones' }), 'inputGamma', 0.1, 9.99, 0.01, 2)}
              {levelSlider(t({ ja: 'ハイライト', en: 'Highlights' }), 'inputWhite', Math.min(255, currentLevels.inputBlack + 1), 255)}
              <div className="adjustment-subtitle">{t({ ja: '出力レベル', en: 'Output Levels' })}</div>
              {levelSlider(t({ ja: '黒の出力', en: 'Black Output' }), 'outputBlack', 0, Math.max(0, currentLevels.outputWhite - 1))}
              {levelSlider(t({ ja: '白の出力', en: 'White Output' }), 'outputWhite', Math.min(255, currentLevels.outputBlack + 1), 255)}
              <div className="adjustment-hint">{t({ ja: 'Altを押しながら端点を調整すると、Photoshopと同じクリッピング確認の操作になります（表示対応は次段階）。', en: 'Hold Alt while adjusting endpoints for the Photoshop clipping-preview gesture (visualization follows).' })}</div>
            </>
          )}
          {mode === 'curves' && (
            <CurveEditor
              key={curveKey}
              points={draft[curveKey]}
              histogram={histogram}
              onChange={(curve) => patch({ [curveKey]: curve })}
            />
          )}
          {mode === 'exposure' && (
            <>
              {slider(t({ ja: '露光量', en: 'Exposure' }), 'exposure', -5, 5, 0.01, 2)}
              {slider(t({ ja: 'オフセット', en: 'Offset' }), 'exposureOffset', -0.5, 0.5, 0.001, 3)}
              {slider(t({ ja: 'ガンマ補正', en: 'Gamma Correction' }), 'exposureGamma', 0.01, 9.99, 0.01, 2)}
            </>
          )}
          {mode === 'vibrance' && (
            <>
              {slider(t({ ja: '自然な彩度', en: 'Vibrance' }), 'vibrance', -100, 100)}
              {slider(t({ ja: '彩度', en: 'Saturation' }), 'vibranceSaturation', -100, 100)}
            </>
          )}
          {mode === 'hueSaturation' && (
            <>
              {slider(t({ ja: '色相', en: 'Hue' }), 'hue', draft.colorize ? 0 : -180, draft.colorize ? 360 : 180)}
              {slider(t({ ja: '彩度', en: 'Saturation' }), 'saturation', -100, 100)}
              {slider(t({ ja: '明度', en: 'Lightness' }), 'lightness', -100, 100)}
              <label className="adjustment-check">
                <input
                  type="checkbox"
                  checked={draft.colorize}
                  onChange={(event) => patch({
                    colorize: event.target.checked,
                    hue: event.target.checked ? (draft.hue + 360) % 360 : ((draft.hue + 180) % 360) - 180,
                    saturation: event.target.checked && draft.saturation === 0 ? 25 : draft.saturation,
                  })}
                />
                {t({ ja: '色彩の統一', en: 'Colorize' })}
              </label>
            </>
          )}
          {mode === 'colorBalance' && (
            <>
              <div className="adjustment-tone-tabs" role="radiogroup" aria-label={t({ ja: '階調', en: 'Tone' })}>
                {(['shadows', 'midtones', 'highlights'] as const).map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    role="radio"
                    aria-checked={balanceTone === tone}
                    tabIndex={balanceTone === tone ? 0 : -1}
                    data-tone={tone}
                    className={balanceTone === tone ? 'active' : ''}
                    onClick={() => setBalanceTone(tone)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const tones = ['shadows', 'midtones', 'highlights'] as const;
                      const index = tones.indexOf(tone);
                      const next = event.key === 'Home'
                        ? tones[0]
                        : event.key === 'End'
                          ? tones[tones.length - 1]
                          : tones[(index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + tones.length) % tones.length];
                      setBalanceTone(next);
                      const toneGroup = event.currentTarget.parentElement;
                      requestAnimationFrame(() => {
                        toneGroup
                          ?.querySelector<HTMLButtonElement>(`[data-tone="${next}"]`)
                          ?.focus();
                      });
                    }}
                  >
                    {tone === 'shadows' ? t({ ja: 'シャドウ', en: 'Shadows' }) : tone === 'midtones' ? t({ ja: '中間調', en: 'Midtones' }) : t({ ja: 'ハイライト', en: 'Highlights' })}
                  </button>
                ))}
              </div>
              <AdjustmentSlider label={t({ ja: 'シアン  —  レッド', en: 'Cyan  —  Red' })} value={currentBalance.cyanRed} min={-100} max={100} onChange={(value) => patch({ [balanceKey]: balanceField(currentBalance, 'cyanRed', value) })} />
              <AdjustmentSlider label={t({ ja: 'マゼンタ  —  グリーン', en: 'Magenta  —  Green' })} value={currentBalance.magentaGreen} min={-100} max={100} onChange={(value) => patch({ [balanceKey]: balanceField(currentBalance, 'magentaGreen', value) })} />
              <AdjustmentSlider label={t({ ja: 'イエロー  —  ブルー', en: 'Yellow  —  Blue' })} value={currentBalance.yellowBlue} min={-100} max={100} onChange={(value) => patch({ [balanceKey]: balanceField(currentBalance, 'yellowBlue', value) })} />
              <label className="adjustment-check">
                <input type="checkbox" checked={draft.preserveLuminosity} onChange={(event) => patch({ preserveLuminosity: event.target.checked })} />
                {t({ ja: '輝度を保持', en: 'Preserve Luminosity' })}
              </label>
            </>
          )}
          {mode === 'blackAndWhite' && (
            <>
              {slider(t({ ja: 'レッド系', en: 'Reds' }), 'blackWhiteReds', -200, 300)}
              {slider(t({ ja: 'イエロー系', en: 'Yellows' }), 'blackWhiteYellows', -200, 300)}
              {slider(t({ ja: 'グリーン系', en: 'Greens' }), 'blackWhiteGreens', -200, 300)}
              {slider(t({ ja: 'シアン系', en: 'Cyans' }), 'blackWhiteCyans', -200, 300)}
              {slider(t({ ja: 'ブルー系', en: 'Blues' }), 'blackWhiteBlues', -200, 300)}
              {slider(t({ ja: 'マゼンタ系', en: 'Magentas' }), 'blackWhiteMagentas', -200, 300)}
            </>
          )}
        </div>

        <div className="adjustment-footer">
          <label className="adjustment-check preview-check">
            <input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} />
            {t({ ja: 'プレビュー', en: 'Preview' })}
          </label>
          <div className="modal-actions">
            <button type="button" disabled={applying} onClick={() => setDraft(resetAdjustmentMode(draft, mode))}>
              {t({ ja: 'リセット', en: 'Reset' })}
            </button>
            <button type="button" disabled={applying} onClick={altDown ? () => setDraft(resetAdjustmentMode(draft, mode)) : cancel}>
              {altDown ? t({ ja: 'リセット', en: 'Reset' }) : t({ ja: 'キャンセル', en: 'Cancel' })}
            </button>
            <button type="button" className="primary" disabled={applying} onClick={apply}>
              {applying ? t({ ja: '適用中…', en: 'Applying…' }) : 'OK'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
