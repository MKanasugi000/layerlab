import type { CSSProperties } from 'react';
import type { Layer, ImageLayer, TextLayer, ShapeLayer } from '../types';

const SIZE = 30;

const base: CSSProperties = {
  width: SIZE,
  height: SIZE,
  minWidth: SIZE,
  borderRadius: 3,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  border: '1px solid #444',
};

/** 市松模様 (checkerboard) — 透過が分かるよう画像の下敷きに使う */
const checkerBase: CSSProperties = {
  ...base,
  background:
    'repeating-conic-gradient(#666 0% 25%, #999 0% 50%) 0 0 / 8px 8px',
  position: 'relative',
};

// ---- per-type thumbs ----

function ImageThumb({ layer }: { layer: ImageLayer }) {
  return (
    <div style={checkerBase}>
      <img
        src={layer.src}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      />
    </div>
  );
}

function TextThumb({ layer }: { layer: TextLayer }) {
  const text = layer.text || '';
  const preview = text.length > 0 ? text.slice(0, 3) : 'T';
  const fontSize = preview.length === 1 ? 18 : preview.length === 2 ? 13 : 10;
  const isBold = layer.fontStyle?.includes('bold');
  const isItalic = layer.fontStyle?.includes('italic');
  return (
    <div
      style={{
        ...base,
        background: '#1e1e1e',
        fontFamily: layer.fontFamily || 'sans-serif',
        fontSize,
        color: layer.fill || '#ffffff',
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        lineHeight: 1,
        padding: 2,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {preview}
    </div>
  );
}

function ShapeThumb({ layer }: { layer: ShapeLayer }) {
  const fill = layer.fillEnabled ? layer.fill : 'none';
  const stroke = layer.strokeEnabled ? layer.strokeColor : 'none';
  const sw = layer.strokeEnabled ? Math.min(layer.strokeWidth, 2.5) : 0;
  const pad = 3 + sw / 2;
  const inner = SIZE - pad * 2;

  return (
    <div style={{ ...base, background: '#1e1e1e' }}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ display: 'block', flexShrink: 0 }}
      >
        {layer.shape === 'rect' && (
          <rect
            x={pad}
            y={pad}
            width={inner}
            height={inner}
            rx={Math.min(layer.cornerRadius / 4, 6)}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        )}
        {layer.shape === 'ellipse' && (
          <ellipse
            cx={SIZE / 2}
            cy={SIZE / 2}
            rx={inner / 2}
            ry={inner / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        )}
        {layer.shape === 'line' && (
          <line
            x1={4}
            y1={SIZE - 4}
            x2={SIZE - 4}
            y2={4}
            stroke={layer.strokeEnabled ? layer.strokeColor : layer.fill}
            strokeWidth={Math.max(sw, 1.5)}
          />
        )}
      </svg>
    </div>
  );
}

function GroupThumb() {
  return (
    <div style={{ ...base, background: '#2a2a2a', fontSize: 16, userSelect: 'none' }}>
      📁
    </div>
  );
}

// ---- public ----

export function LayerThumb({ layer }: { layer: Layer }) {
  if (layer.type === 'image') return <ImageThumb layer={layer} />;
  if (layer.type === 'text') return <TextThumb layer={layer} />;
  if (layer.type === 'shape') return <ShapeThumb layer={layer} />;
  return <GroupThumb />;
}
