import { useState } from 'react';
import { useT } from '../i18n/locale';
import { ColorButton } from './ColorButton';
import { ScrubNumber } from './ScrubNumber';
import type { TextLayer } from '../types';

export function TextEffectsPanel({
  layer,
  update,
}: {
  layer: TextLayer;
  update: (patch: Partial<TextLayer>) => void;
}) {
  const t = useT();

  return (
    <div className="text-effects">
      <h3 className="effects-heading">{t({ ja: 'レイヤー効果', en: 'Layer Effects' })}</h3>
      <EffectSection
        title={t({ ja: 'ストローク (縁取り)', en: 'Stroke (Outline)' })}
        enabled={layer.strokeEnabled}
        onToggle={(v) => update({ strokeEnabled: v })}
      >
        <div className="row">
          <label>
            {t({ ja: '色', en: 'Color' })}
            <ColorButton value={layer.strokeColor} onChange={(c) => update({ strokeColor: c })} />
          </label>
          <label>
            {t({ ja: '太さ', en: 'Width' })}
            <ScrubNumber value={layer.strokeWidth} min={0} max={50} step={0.5} precision={1} onChange={(v) => update({ strokeWidth: v })} />
          </label>
        </div>
      </EffectSection>

      <EffectSection
        title={t({ ja: 'カラーオーバーレイ (ベタ塗り)', en: 'Color Overlay (Solid)' })}
        enabled={layer.colorOverlayEnabled ?? false}
        onToggle={(v) => update({ colorOverlayEnabled: v })}
      >
        <label>
          {t({ ja: '色', en: 'Color' })}
          <ColorButton
            value={layer.colorOverlayColor ?? '#ff3366'}
            onChange={(c) => update({ colorOverlayColor: c })}
          />
        </label>
        <label>
          {t({ ja: '不透明度', en: 'Opacity' })} {Math.round((layer.colorOverlayOpacity ?? 1) * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((layer.colorOverlayOpacity ?? 1) * 100)}
            onChange={(e) =>
              update({ colorOverlayOpacity: parseInt(e.target.value) / 100 })
            }
          />
        </label>
      </EffectSection>

      <EffectSection
        title={t({ ja: 'ドロップシャドウ', en: 'Drop Shadow' })}
        enabled={layer.shadowEnabled}
        onToggle={(v) => update({ shadowEnabled: v })}
      >
        <label>
          {t({ ja: '色', en: 'Color' })}
          <ColorButton value={layer.shadowColor} onChange={(c) => update({ shadowColor: c })} />
        </label>
        <label>
          {t({ ja: '不透明度', en: 'Opacity' })} {Math.round(layer.shadowOpacity * 100)}%
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.shadowOpacity * 100)}
            onChange={(e) =>
              update({ shadowOpacity: parseInt(e.target.value) / 100 })
            }
          />
        </label>
        <label>
          {t({ ja: 'ぼかし', en: 'Blur' })} {layer.shadowBlur}px
          <input
            type="range"
            min={0}
            max={80}
            value={layer.shadowBlur}
            onChange={(e) => update({ shadowBlur: parseInt(e.target.value) })}
          />
        </label>
        <div className="row">
          <label>
            {t({ ja: 'X方向', en: 'X Offset' })}
            <ScrubNumber value={layer.shadowOffsetX} onChange={(v) => update({ shadowOffsetX: v })} />
          </label>
          <label>
            {t({ ja: 'Y方向', en: 'Y Offset' })}
            <ScrubNumber value={layer.shadowOffsetY} onChange={(v) => update({ shadowOffsetY: v })} />
          </label>
        </div>
      </EffectSection>

      <EffectSection
        title={t({ ja: 'グラデーション', en: 'Gradient' })}
        enabled={layer.gradientEnabled}
        onToggle={(v) => update({ gradientEnabled: v })}
      >
        <div className="gradient-preview">
          <div
            style={{
              background: `linear-gradient(${layer.gradientAngle}deg, ${layer.gradientColor1}, ${layer.gradientColor2})`,
            }}
          />
        </div>
        <div className="row">
          <label>
            {t({ ja: '色1', en: 'Color 1' })}
            <ColorButton value={layer.gradientColor1} onChange={(c) => update({ gradientColor1: c })} />
          </label>
          <label>
            {t({ ja: '色2', en: 'Color 2' })}
            <ColorButton value={layer.gradientColor2} onChange={(c) => update({ gradientColor2: c })} />
          </label>
        </div>
        <label>
          {t({ ja: '角度', en: 'Angle' })} {layer.gradientAngle}°
          <input
            type="range"
            min={0}
            max={360}
            value={layer.gradientAngle}
            onChange={(e) =>
              update({ gradientAngle: parseInt(e.target.value) })
            }
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="angle-preset"
            onClick={() => update({ gradientAngle: 0 })}
          >
            {t({ ja: '横 →', en: 'Horizontal →' })}
          </button>
          <button
            type="button"
            className="angle-preset"
            onClick={() => update({ gradientAngle: 90 })}
          >
            {t({ ja: '縦 ↓', en: 'Vertical ↓' })}
          </button>
          <button
            type="button"
            className="angle-preset"
            onClick={() => update({ gradientAngle: 45 })}
          >
            {t({ ja: '斜 ↘', en: 'Diagonal ↘' })}
          </button>
        </div>
      </EffectSection>
    </div>
  );
}

function EffectSection({
  title,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(enabled);

  return (
    <div className={`effect-section ${enabled ? 'enabled' : ''}`}>
      <header
        className="effect-header"
        onClick={() => setExpanded(!expanded)}
      >
        <label className="effect-toggle" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              onToggle(e.target.checked);
              if (e.target.checked) setExpanded(true);
            }}
          />
        </label>
        <span className="effect-title">{title}</span>
        <span className="effect-chevron">{expanded ? '▾' : '▸'}</span>
      </header>
      {expanded && enabled && <div className="effect-body">{children}</div>}
    </div>
  );
}