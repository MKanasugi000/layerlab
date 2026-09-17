import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/editorStore';
import type { ImageLayer } from '../types';
import { createPreviewRenderer, type PreviewRenderer, type PreviewShape } from '../utils/lightingPreview';
import { useT } from '../i18n/locale';
import { ModalShell } from './ModalShell';

const fs: React.CSSProperties = {
  border: '1px solid var(--border,#3a3a3a)',
  borderRadius: 4,
  margin: '6px 0',
  padding: '6px 10px',
};
const lg: React.CSSProperties = { fontSize: 12, padding: '0 6px' };

export function LightingPreviewDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const layers = useEditorStore((s) => s.layers);
  const selectedId = useEditorStore((s) => s.selectedId);

  const imageLayers = layers.filter((l): l is ImageLayer => l.type === 'image');
  const find = (re: RegExp) => imageLayers.find((l) => re.test(l.name))?.id ?? '';
  const initialNormal =
    find(/_Normal/i) || (selectedId && imageLayers.some((l) => l.id === selectedId) ? selectedId : imageLayers[0]?.id ?? '');

  const [normalId, setNormalId] = useState(initialNormal);
  const [albedoId, setAlbedoId] = useState('');
  const [aoId, setAoId] = useState(() => find(/_AO/i));
  const [ambient, setAmbient] = useState(0.18);
  const [intensity, setIntensity] = useState(1.1);
  const [autoRotate, setAutoRotate] = useState(false);
  const [shape, setShape] = useState<PreviewShape>('sphere');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const urlOf = (id: string) => imageLayers.find((l) => l.id === id)?.src ?? null;

  // レンダラ生成（マウント時のみ）
  useEffect(() => {
    if (!canvasRef.current) return;
    try {
      const r = createPreviewRenderer(canvasRef.current);
      rendererRef.current = r;
      r.start();
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ソース変更を反映
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const u = urlOf(normalId);
    if (u) r.setNormal(u).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalId]);
  useEffect(() => {
    rendererRef.current?.setAlbedo(urlOf(albedoId)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albedoId]);
  useEffect(() => {
    rendererRef.current?.setAo(urlOf(aoId)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoId]);
  useEffect(() => {
    rendererRef.current?.setParams({ ambient, intensity, autoRotate, shape });
  }, [ambient, intensity, autoRotate, shape]);

  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0, yaw: 0, pitch: 0 });

  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (shape !== 'sphere') return;
    const d = dragRef.current;
    d.dragging = true;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };
  const onUp = () => {
    dragRef.current.dragging = false;
  };
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (d.dragging && shape === 'sphere') {
      d.yaw += (e.clientX - d.lastX) * 0.01;
      d.pitch += (e.clientY - d.lastY) * 0.01;
      d.pitch = Math.max(-1.4, Math.min(1.4, d.pitch));
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      rendererRef.current?.setRotation(d.yaw, d.pitch);
      return;
    }
    if (autoRotate) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1); // 上を +Y
    rendererRef.current?.setLightFromCursor(nx, ny);
  };

  const layerSelect = (
    value: string,
    onChange: (v: string) => void,
    withNone: boolean,
  ) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {withNone && <option value="">{t({ ja: 'なし', en: 'None' })}</option>}
      {imageLayers.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );

  return (
    <ModalShell
      title={t({ ja: '3Dライティングプレビュー（凹凸の確認）', en: '3D Lighting Preview (Bump Check)' })}
      onClose={onClose}
      style={{ width: 560, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto' }}
    >
        <div className="modal-row info">
          {t({ ja: '法線を球／平面に貼って光を当てた表示です。カーソルを動かすと光が動き、球はドラッグで回転します。凹凸が想定どおりか確認してください。', en: 'Normal maps applied to sphere/plane with directional light. Move cursor to move light; drag sphere to rotate. Verify bump detail.' })}
        </div>

        <div className="modal-row" style={{ justifyContent: 'center', display: 'flex' }}>
          {err ? (
            <div className="modal-row warn">{t({ ja: `WebGL初期化失敗: ${err}`, en: `WebGL init error: ${err}` })}</div>
          ) : (
            <canvas
              ref={canvasRef}
              width={360}
              height={360}
              onMouseMove={onMove}
              onMouseDown={onDown}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              style={{
                width: 360,
                height: 360,
                border: '1px solid var(--border,#3a3a3a)',
                borderRadius: 4,
                cursor: shape === 'sphere' ? 'grab' : autoRotate ? 'default' : 'crosshair',
                background: '#141416',
              }}
            />
          )}
        </div>

        {imageLayers.length === 0 && (
          <div className="modal-row warn">{t({ ja: '画像レイヤーが必要です。先にノーマルマップを生成してください。', en: 'An image layer is required. Please generate a normal map first.' })}</div>
        )}

        <fieldset style={fs}>
          <legend style={lg}>{t({ ja: 'ソース', en: 'Source' })}</legend>
          <div className="modal-row">
            <label>{t({ ja: 'ノーマルマップ', en: 'Normal Map' })}{layerSelect(normalId, setNormalId, false)}</label>
          </div>
          <div className="modal-row">
            <label>{t({ ja: 'アルベド（色・任意）', en: 'Albedo (Color, optional)' })}{layerSelect(albedoId, setAlbedoId, true)}</label>
          </div>
          <div className="modal-row">
            <label>{t({ ja: 'AO（任意・乗算）', en: 'AO (optional, multiply)' })}{layerSelect(aoId, setAoId, true)}</label>
          </div>
        </fieldset>

        <fieldset style={fs}>
          <legend style={lg}>{t({ ja: '表示・ライト', en: 'Display / Light' })}</legend>
          <div className="modal-row">
            <label>
              {t({ ja: '形状', en: 'Shape' })}
              <select value={shape} onChange={(e) => setShape(e.target.value as PreviewShape)}>
                <option value="sphere">{t({ ja: '球（質感確認向き）', en: 'Sphere (for material check)' })}</option>
                <option value="plane">{t({ ja: '平面（テクスチャ確認向き）', en: 'Plane (for texture check)' })}</option>
              </select>
            </label>
          </div>
          <div className="modal-row">
            <label className="invert-toggle">
              <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} />
              {t({ ja: '自動回転（光をぐるりと回す）', en: 'Auto rotate (light orbits)' })}
            </label>
          </div>
          <div className="modal-row">
            <label>
              {t({ ja: `環境光: ${ambient.toFixed(2)}`, en: `Ambient: ${ambient.toFixed(2)}` })}
              <input type="range" min={0} max={0.6} step={0.01} value={ambient} onChange={(e) => setAmbient(parseFloat(e.target.value))} />
            </label>
          </div>
          <div className="modal-row">
            <label>
              {t({ ja: `光の強さ: ${intensity.toFixed(1)}`, en: `Light intensity: ${intensity.toFixed(1)}` })}
              <input type="range" min={0} max={2.5} step={0.1} value={intensity} onChange={(e) => setIntensity(parseFloat(e.target.value))} />
            </label>
          </div>
        </fieldset>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            {t({ ja: '閉じる', en: 'Close' })}
          </button>
        </div>
    </ModalShell>
  );
}
