import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useEditorStore } from '../store/editorStore';
import { strokeSegment } from '../utils/brush';
import type { BrushParams } from '../utils/brush';
import { ScrubNumber } from './ScrubNumber';
import { useT } from '../i18n/locale';

// Fixed preview color for thumbnails — always readable on dark (#111 / #2a2a2a) BG
// regardless of the current foreground color (which may be black).
const THUMB_PREVIEW_COLOR = '#d0d0d0';

// ---- Preset types & data ----
interface PresetParams {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
  roundness: number;
  angle: number;
  sizeJitter: number;
  scatter: number;
  flowJitter: number;
}

interface BrushPreset {
  id: string;
  name: { ja: string; en: string };
  params: PresetParams;
}

const PRESETS: BrushPreset[] = [
  { id: 'thin-pen',    name: { ja: '細ペン',       en: 'Thin Pen' },       params: { size: 1,  hardness: 100, opacity: 100, flow: 100, spacing: 5,   roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'pencil',      name: { ja: '鉛筆',         en: 'Pencil' },         params: { size: 3,  hardness: 88,  opacity: 100, flow: 80,  spacing: 10,  roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'pen',         name: { ja: 'ペン(硬)',     en: 'Pen (Hard)' },     params: { size: 6,  hardness: 95,  opacity: 100, flow: 100, spacing: 5,   roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'gpen',        name: { ja: 'Gペン',        en: 'G-Pen' },          params: { size: 9,  hardness: 82,  opacity: 100, flow: 90,  spacing: 8,   roundness: 100, angle: 0,  sizeJitter: 18, scatter: 0,  flowJitter: 0  } },
  { id: 'round',       name: { ja: '丸ブラシ',     en: 'Round Brush' },    params: { size: 14, hardness: 28,  opacity: 90,  flow: 80,  spacing: 12,  roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'airbrush',    name: { ja: 'エアブラシ',   en: 'Airbrush' },       params: { size: 28, hardness: 0,   opacity: 60,  flow: 30,  spacing: 20,  roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'marker',      name: { ja: 'マーカー',     en: 'Marker' },         params: { size: 14, hardness: 80,  opacity: 85,  flow: 100, spacing: 4,   roundness: 65,  angle: 15, sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'watercolor',  name: { ja: '水彩',         en: 'Watercolor' },     params: { size: 18, hardness: 10,  opacity: 70,  flow: 40,  spacing: 15,  roundness: 100, angle: 0,  sizeJitter: 12, scatter: 8,  flowJitter: 20 } },
  { id: 'calligraphy', name: { ja: 'カリグラフィ', en: 'Calligraphy' },    params: { size: 16, hardness: 90,  opacity: 100, flow: 100, spacing: 6,   roundness: 28,  angle: 45, sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'dots',        name: { ja: 'ドット',       en: 'Dots' },           params: { size: 7,  hardness: 95,  opacity: 100, flow: 100, spacing: 150, roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
  { id: 'texture',     name: { ja: 'テクスチャ',   en: 'Texture' },        params: { size: 18, hardness: 50,  opacity: 70,  flow: 60,  spacing: 25,  roundness: 100, angle: 0,  sizeJitter: 40, scatter: 30, flowJitter: 15 } },
  { id: 'soft-erase',  name: { ja: 'ソフト消し',   en: 'Soft Eraser' },    params: { size: 24, hardness: 0,   opacity: 55,  flow: 60,  spacing: 15,  roundness: 100, angle: 0,  sizeJitter: 0,  scatter: 0,  flowJitter: 0  } },
];

// ---- Thumbnail drawing ----
const THUMB_W = 76;
const THUMB_H = 38;

function drawThumbnail(
  ctx: CanvasRenderingContext2D,
  params: PresetParams,
  color: string,
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const maxR = h * 0.42;
  const scale = params.size / 2 > maxR ? maxR / (params.size / 2) : 1;
  const p: BrushParams = { ...params, size: params.size * scale, color };

  const pad = Math.max(4, p.size / 2 + 1);
  const pts: [number, number][] = [
    [pad,      h * 0.72],
    [w * 0.25, h * 0.25],
    [w * 0.5,  h * 0.55],
    [w * 0.75, h * 0.75],
    [w - pad,  h * 0.28],
  ];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    carry = strokeSegment(ctx, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], p, carry);
  }
}

// Preset thumbnail (only redraws when params/color change)
function ThumbnailCanvas({
  params,
  color,
  w = THUMB_W,
  h = THUMB_H,
}: {
  params: PresetParams;
  color: string;
  w?: number;
  h?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) drawThumbnail(ctx, params, color, w, h);
  }, [params, color, w, h]);
  return <canvas ref={ref} width={w} height={h} style={{ display: 'block', width: w, height: h }} />;
}

// Current brush thumbnail (tracks store state)
export function CurrentBrushThumbnail({
  color: _color,
  w = 44,
  h = 24,
}: {
  color: string;
  w?: number;
  h?: number;
}) {
  const size       = useEditorStore((s) => s.brushSize);
  const hardness   = useEditorStore((s) => s.brushHardness);
  const opacity    = useEditorStore((s) => s.brushOpacity);
  const flow       = useEditorStore((s) => s.brushFlow);
  const spacing    = useEditorStore((s) => s.brushSpacing);
  const roundness  = useEditorStore((s) => s.brushRoundness);
  const angle      = useEditorStore((s) => s.brushAngle);
  const sizeJitter = useEditorStore((s) => s.brushSizeJitter);
  const scatter    = useEditorStore((s) => s.brushScatter);
  const flowJitter = useEditorStore((s) => s.brushFlowJitter);

  const params = useMemo<PresetParams>(
    () => ({ size, hardness, opacity, flow, spacing, roundness, angle, sizeJitter, scatter, flowJitter }),
    [size, hardness, opacity, flow, spacing, roundness, angle, sizeJitter, scatter, flowJitter],
  );
  return <ThumbnailCanvas params={params} color={THUMB_PREVIEW_COLOR} w={w} h={h} />;
}

// ---- Popup ----
interface BrushPickerPopupProps {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement>;
}

export function BrushPickerPopup({ onClose, anchorRef }: BrushPickerPopupProps) {
  const t = useT();
  const popupRef = useRef<HTMLDivElement>(null);
  const [showDetails, setShowDetails] = useState(false);

  const size           = useEditorStore((s) => s.brushSize);
  const hardness       = useEditorStore((s) => s.brushHardness);
  const opacity        = useEditorStore((s) => s.brushOpacity);
  const flow           = useEditorStore((s) => s.brushFlow);
  const spacing        = useEditorStore((s) => s.brushSpacing);
  const roundness      = useEditorStore((s) => s.brushRoundness);
  const angle          = useEditorStore((s) => s.brushAngle);
  const smoothing      = useEditorStore((s) => s.brushSmoothing);
  const pressureSize   = useEditorStore((s) => s.brushPressureSize);
  const pressureOpacity = useEditorStore((s) => s.brushPressureOpacity);
  const sizeJitter     = useEditorStore((s) => s.brushSizeJitter);
  const scatter        = useEditorStore((s) => s.brushScatter);
  const flowJitter     = useEditorStore((s) => s.brushFlowJitter);
  const eraser         = useEditorStore((s) => s.brushEraser);
  const fg             = useEditorStore((s) => s.foregroundColor);

  const setSize            = useEditorStore((s) => s.setBrushSize);
  const setHardness        = useEditorStore((s) => s.setBrushHardness);
  const setOpacity         = useEditorStore((s) => s.setBrushOpacity);
  const setFlow            = useEditorStore((s) => s.setBrushFlow);
  const setSpacing         = useEditorStore((s) => s.setBrushSpacing);
  const setRoundness       = useEditorStore((s) => s.setBrushRoundness);
  const setAngle           = useEditorStore((s) => s.setBrushAngle);
  const setSmoothing       = useEditorStore((s) => s.setBrushSmoothing);
  const setPressureSize    = useEditorStore((s) => s.setBrushPressureSize);
  const setPressureOpacity = useEditorStore((s) => s.setBrushPressureOpacity);
  const setSizeJitter      = useEditorStore((s) => s.setBrushSizeJitter);
  const setScatter         = useEditorStore((s) => s.setBrushScatter);
  const setFlowJitter      = useEditorStore((s) => s.setBrushFlowJitter);
  const setEraser          = useEditorStore((s) => s.setBrushEraser);

  // Position below anchor button
  useLayoutEffect(() => {
    const popup = popupRef.current;
    const anchor = anchorRef.current;
    if (!popup || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pw = popup.offsetWidth;
    let left = rect.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.left = `${Math.max(4, left)}px`;
  });

  // Outside click / Esc
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, anchorRef]);

  const applyPreset = (p: BrushPreset) => {
    setSize(p.params.size);
    setHardness(p.params.hardness);
    setOpacity(p.params.opacity);
    setFlow(p.params.flow);
    setSpacing(p.params.spacing);
    setRoundness(p.params.roundness);
    setAngle(p.params.angle);
    setSizeJitter(p.params.sizeJitter);
    setScatter(p.params.scatter);
    setFlowJitter(p.params.flowJitter);
  };

  const activeId = useMemo(
    () =>
      PRESETS.find(
        (p) =>
          p.params.size === size &&
          p.params.hardness === hardness &&
          p.params.opacity === opacity &&
          p.params.flow === flow &&
          p.params.spacing === spacing &&
          p.params.roundness === roundness &&
          p.params.angle === angle &&
          p.params.sizeJitter === sizeJitter &&
          p.params.scatter === scatter &&
          p.params.flowJitter === flowJitter,
      )?.id ?? null,
    [size, hardness, opacity, flow, spacing, roundness, angle, sizeJitter, scatter, flowJitter],
  );

  const MAX_CIRC = 72;
  const circD = Math.min(size, MAX_CIRC);

  const densityClick = (
    e: React.MouseEvent<HTMLDivElement>,
    setter: (v: number) => void,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setter(Math.max(1, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100))));
  };

  return (
    <div ref={popupRef} className="bpp-popup">
      {/* ── Presets ── */}
      <div className="bpp-section-label">{t({ ja: 'ブラシプリセット', en: 'Brush Presets' })}</div>
      <div className="bpp-preset-grid">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={`bpp-preset-card${activeId === preset.id ? ' active' : ''}`}
            title={t(preset.name)}
            onClick={() => applyPreset(preset)}
          >
            <div className="bpp-preset-thumb">
              <ThumbnailCanvas params={preset.params} color={THUMB_PREVIEW_COLOR} />
            </div>
            <div className="bpp-preset-name">{t(preset.name)}</div>
          </button>
        ))}
      </div>

      <div className="bpp-sep" />

      {/* ── Size ── */}
      <div className="bpp-section-label">{t({ ja: '太さ', en: 'Size' })}</div>
      <div className="bpp-size-row">
        <div className="bpp-circle-wrap">
          <div
            className="bpp-circle"
            style={{ width: circD, height: circD, background: THUMB_PREVIEW_COLOR, opacity: opacity / 100 }}
          />
          {size > MAX_CIRC && <span className="bpp-overflow-label">{size}px</span>}
        </div>
        <div className="bpp-slider-col">
          <input
            type="range"
            className="bpp-range"
            min={1}
            max={500}
            value={Math.min(size, 500)}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <div className="bpp-row-inline">
            <ScrubNumber className="ob-num" value={size} min={1} max={2000} onChange={setSize} />
            <span className="bpp-unit">px</span>
          </div>
        </div>
      </div>

      <div className="bpp-sep" />

      {/* ── Hardness ── */}
      <div className="bpp-row-labeled">
        <span className="bpp-row-label">{t({ ja: '硬さ', en: 'Hardness' })}</span>
        <input
          type="range"
          className="bpp-range"
          min={0}
          max={100}
          value={hardness}
          onChange={(e) => setHardness(Number(e.target.value))}
        />
        <ScrubNumber className="ob-num" value={hardness} min={0} max={100} onChange={setHardness} />
        <span className="bpp-unit">%</span>
      </div>

      <div className="bpp-sep" />

      {/* ── Density bars ── */}
      <div className="bpp-section-label">{t({ ja: '濃さ', en: 'Density' })}</div>
      <div className="bpp-row-labeled">
        <span className="bpp-row-label">{t({ ja: '不透明', en: 'Opacity' })}</span>
        <div className="bpp-density-bar" onClick={(e) => densityClick(e, setOpacity)}>
          <div className="bpp-density-checker" />
          <div className="bpp-density-fill" style={{ background: `linear-gradient(to right, transparent, ${fg})` }} />
          <div className="bpp-density-thumb" style={{ left: `${opacity}%` }} />
        </div>
        <ScrubNumber className="ob-num" value={opacity} min={1} max={100} onChange={setOpacity} />
        <span className="bpp-unit">%</span>
      </div>
      <div className="bpp-row-labeled">
        <span className="bpp-row-label">{t({ ja: '流量', en: 'Flow' })}</span>
        <div className="bpp-density-bar" onClick={(e) => densityClick(e, setFlow)}>
          <div className="bpp-density-checker" />
          <div className="bpp-density-fill" style={{ background: `linear-gradient(to right, transparent, ${fg})` }} />
          <div className="bpp-density-thumb" style={{ left: `${flow}%` }} />
        </div>
        <ScrubNumber className="ob-num" value={flow} min={1} max={100} onChange={setFlow} />
        <span className="bpp-unit">%</span>
      </div>

      <div className="bpp-sep" />

      {/* ── Shape ── */}
      <div className="bpp-section-label">{t({ ja: '形状', en: 'Shape' })}</div>
      <div className="bpp-shape-row">
        <svg className="bpp-ellipse-svg" viewBox="0 0 60 60" width="60" height="60">
          <ellipse
            cx={30}
            cy={30}
            rx={24}
            ry={Math.max(1, Math.round(24 * roundness / 100))}
            fill={THUMB_PREVIEW_COLOR}
            opacity={0.85}
            transform={`rotate(${angle}, 30, 30)`}
          />
        </svg>
        <div className="bpp-shape-controls">
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: '真円率', en: 'Roundness' })}</span>
            <input
              type="range"
              className="bpp-range"
              min={1}
              max={100}
              value={roundness}
              onChange={(e) => setRoundness(Number(e.target.value))}
            />
            <ScrubNumber className="ob-num" value={roundness} min={1} max={100} onChange={setRoundness} />
          </div>
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: '角度', en: 'Angle' })}</span>
            <input
              type="range"
              className="bpp-range"
              min={-180}
              max={180}
              value={angle}
              onChange={(e) => setAngle(Number(e.target.value))}
            />
            <ScrubNumber className="ob-num" value={angle} min={-180} max={180} onChange={setAngle} />
          </div>
        </div>
      </div>

      <div className="bpp-sep" />

      {/* ── Details (collapsible) ── */}
      <button className="bpp-details-toggle" onClick={() => setShowDetails((v) => !v)}>
        {t({ ja: '詳細設定', en: 'Advanced Settings' })} {showDetails ? '▲' : '▼'}
      </button>

      {showDetails && (
        <div className="bpp-details">
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: '間隔%', en: 'Spacing %' })}</span>
            <input type="range" className="bpp-range" min={1} max={200} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
            <ScrubNumber className="ob-num" value={spacing} min={1} max={200} onChange={setSpacing} />
          </div>
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: '滑らか', en: 'Smoothing' })}</span>
            <input type="range" className="bpp-range" min={0} max={100} value={smoothing} onChange={(e) => setSmoothing(Number(e.target.value))} />
            <ScrubNumber className="ob-num" value={smoothing} min={0} max={100} onChange={setSmoothing} />
          </div>
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: 'Sz揺れ', en: 'Size Jitter' })}</span>
            <input type="range" className="bpp-range" min={0} max={100} value={sizeJitter} onChange={(e) => setSizeJitter(Number(e.target.value))} />
            <ScrubNumber className="ob-num" value={sizeJitter} min={0} max={100} onChange={setSizeJitter} />
          </div>
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: '散布', en: 'Scatter' })}</span>
            <input type="range" className="bpp-range" min={0} max={100} value={scatter} onChange={(e) => setScatter(Number(e.target.value))} />
            <ScrubNumber className="ob-num" value={scatter} min={0} max={100} onChange={setScatter} />
          </div>
          <div className="bpp-row-labeled">
            <span className="bpp-row-label">{t({ ja: 'Fl揺れ', en: 'Flow Jitter' })}</span>
            <input type="range" className="bpp-range" min={0} max={100} value={flowJitter} onChange={(e) => setFlowJitter(Number(e.target.value))} />
            <ScrubNumber className="ob-num" value={flowJitter} min={0} max={100} onChange={setFlowJitter} />
          </div>
          <div className="bpp-checks">
            <label className="ob-check">
              <input type="checkbox" checked={pressureSize} onChange={(e) => setPressureSize(e.target.checked)} />
              {t({ ja: '筆圧Size', en: 'Pressure Size' })}
            </label>
            <label className="ob-check">
              <input type="checkbox" checked={pressureOpacity} onChange={(e) => setPressureOpacity(e.target.checked)} />
              {t({ ja: '筆圧Flow', en: 'Pressure Flow' })}
            </label>
            <label className="ob-check">
              <input type="checkbox" checked={eraser} onChange={(e) => setEraser(e.target.checked)} />
              {t({ ja: '消しゴム', en: 'Eraser' })}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}