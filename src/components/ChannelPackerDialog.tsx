import { useState } from 'react';
import { useEditorStore, createImageLayer } from '../store/editorStore';
import type { ImageLayer } from '../types';
import {
  packChannels,
  isSafeChannelPackSize,
  SOURCE_LABELS,
  type ChannelSource,
  type ChannelSpec,
} from '../utils/channelPack';
import { useT } from '../i18n/locale';
import { ModalShell } from './ModalShell';
import {
  estimatedRgbaDataUrlChars,
  validateProjectRasterBudget,
  validateProjectStorageBudget,
} from '../utils/projectRasterBudget';

const SOURCES: ChannelSource[] = ['R', 'G', 'B', 'A', 'L'];

function defaultSlot(): ChannelSpec {
  return { layer: null, source: 'L', invert: false };
}

const PRESETS: Array<{
  id: string;
  label: string;
  hints: [string, string, string, string];
}> = [
  {
    id: 'unity-mask',
    label: 'Unity HDRP/URP Mask Map',
    hints: ['Metallic', 'Occlusion', 'Detail', 'Smoothness'],
  },
  {
    id: 'urp-simple',
    label: 'URP Simple Mask (M/AO/-/S)',
    hints: ['Metallic', 'Occlusion', '(unused)', 'Smoothness'],
  },
  {
    id: 'orm',
    label: 'glTF ORM (Occlusion/Roughness/Metallic)',
    hints: ['Occlusion', 'Roughness', 'Metallic', '(unused)'],
  },
];

export function ChannelPackerDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const layers = useEditorStore((s) => s.layers);
  const canvas = useEditorStore((s) => s.canvas);
  const addLayer = useEditorStore((s) => s.addLayer);

  const imageLayers = layers.filter((l): l is ImageLayer => l.type === 'image');

  const [presetId, setPresetId] = useState<string>('unity-mask');
  const [r, setR] = useState<ChannelSpec>(defaultSlot());
  const [g, setG] = useState<ChannelSpec>(defaultSlot());
  const [b, setB] = useState<ChannelSpec>(defaultSlot());
  const [a, setA] = useState<ChannelSpec>(defaultSlot());
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const outputSizeSafe = isSafeChannelPackSize(canvas.width, canvas.height);
  const projectBudgetSafe = validateProjectRasterBudget([
    ...layers,
    {
      type: 'image' as const,
      naturalWidth: canvas.width,
      naturalHeight: canvas.height,
    },
  ]).ok && validateProjectStorageBudget(
    layers,
    estimatedRgbaDataUrlChars(canvas.width, canvas.height),
  ).ok;

  const handleGenerate = async () => {
    if (!outputSizeSafe || !projectBudgetSafe) return;
    setRunning(true);
    setMsg(null);
    try {
      const dataUrl = await packChannels({
        r,
        g,
        b,
        a,
        width: canvas.width,
        height: canvas.height,
      });
      const layer = createImageLayer(dataUrl, canvas.width, canvas.height);
      layer.name = `Packed_${preset.id}_${canvas.width}x${canvas.height}`;
      if (!addLayer(layer)) {
        setMsg(t({ ja: '安全上限のためレイヤーを追加できませんでした', en: 'The layer could not be added because of the safety limit' }));
        setRunning(false);
        return;
      }
      setMsg(t({ ja: 'OK 新規レイヤーとして追加しました', en: 'OK Added as new layer' }));
      setTimeout(onClose, 800);
    } catch (e) {
      setMsg(t({ ja: `失敗: ${(e as Error).message}`, en: `Error: ${(e as Error).message}` }));
    }
    setRunning(false);
  };

  return (
    <ModalShell
      title={t({ ja: 'チャネルパッカー', en: 'Channel Packer' })}
      className="channel-packer-modal"
      onClose={onClose}
    >
        <div className="modal-row info">
          {t({
            ja: `出力: ${canvas.width} × ${canvas.height} px PNG · ソースレイヤー ${imageLayers.length} 枚`,
            en: `Output: ${canvas.width} × ${canvas.height} px PNG · ${imageLayers.length} source layer(s)`,
          })}
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: 'プリセット', en: 'Preset' })}
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {imageLayers.length === 0 && (
          <div className="modal-row warn">
            {t({ ja: '画像レイヤーが必要です。先に画像を配置してください。', en: 'Image layer required. Please place an image first.' })}
          </div>
        )}
        {!outputSizeSafe && (
          <div className="modal-row warn">
            {t({ ja: '安全のためチャネルパックは4096×4096px / 16MP以下で使用できます。', en: 'For safety, channel packing is available up to 4096×4096 px / 16 MP.' })}
          </div>
        )}
        {!projectBudgetSafe && (
          <div className="modal-row warn">
            {t({ ja: '出力を追加すると画像レイヤー総量の安全上限（128MP）を超えます。', en: 'Adding the output would exceed the 128 MP raster-layer safety limit.' })}
          </div>
        )}
        <ChannelSlot
          label="R"
          hint={preset.hints[0]}
          spec={r}
          setSpec={setR}
          layers={imageLayers}
        />
        <ChannelSlot
          label="G"
          hint={preset.hints[1]}
          spec={g}
          setSpec={setG}
          layers={imageLayers}
        />
        <ChannelSlot
          label="B"
          hint={preset.hints[2]}
          spec={b}
          setSpec={setB}
          layers={imageLayers}
        />
        <ChannelSlot
          label="A"
          hint={preset.hints[3]}
          spec={a}
          setSpec={setA}
          layers={imageLayers}
        />
        {msg && <div className="modal-row result">{msg}</div>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>
            {t({ ja: 'キャンセル', en: 'Cancel' })}
          </button>
          <button
            className="primary"
            onClick={handleGenerate}
            disabled={running || imageLayers.length === 0 || !outputSizeSafe || !projectBudgetSafe}
          >
            {running ? t({ ja: '生成中...', en: 'Generating...' }) : t({ ja: 'マップ生成', en: 'Generate Map' })}
          </button>
        </div>
    </ModalShell>
  );
}

function ChannelSlot({
  label,
  hint,
  spec,
  setSpec,
  layers,
}: {
  label: string;
  hint: string;
  spec: ChannelSpec;
  setSpec: (s: ChannelSpec) => void;
  layers: ImageLayer[];
}) {
  const t = useT();
  return (
    <div className="modal-row channel-slot">
      <div className="channel-label">
        <span className={`channel-chip channel-${label.toLowerCase()}`}>{label}</span>
        <span className="channel-hint">{hint}</span>
      </div>
      <select
        value={spec.layer?.id ?? ''}
        onChange={(e) => {
          const layer = layers.find((l) => l.id === e.target.value) ?? null;
          setSpec({ ...spec, layer });
        }}
      >
        <option value="">{t({ ja: '(なし - 既定値で埋める)', en: '(None - fill with default)' })}</option>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <select
        value={spec.source}
        onChange={(e) =>
          setSpec({ ...spec, source: e.target.value as ChannelSource })
        }
        disabled={!spec.layer}
      >
        {SOURCES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_LABELS[s]}
          </option>
        ))}
      </select>
      <label className="invert-toggle">
        <input
          type="checkbox"
          checked={spec.invert}
          onChange={(e) => setSpec({ ...spec, invert: e.target.checked })}
          disabled={!spec.layer}
        />
        {t({ ja: '反転', en: 'Invert' })}
      </label>
    </div>
  );
}
