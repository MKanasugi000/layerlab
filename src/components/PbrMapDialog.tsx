import { useEffect, useState } from 'react';
import { useEditorStore, createImageLayer } from '../store/editorStore';
import type { ImageLayer } from '../types';
import type { GrayMode } from '../utils/heightField';
import {
  generatePbrSet,
  previewPbrSet,
  DEFAULT_PBR_SPEC,
  isSafePbrOutputSize,
  type PbrSpec,
  type PbrResult,
} from '../utils/pbrMaps';
import { useT } from '../i18n/locale';
import { ModalShell } from './ModalShell';
import {
  estimatedRgbaDataUrlChars,
  validateProjectRasterBudget,
  validateProjectStorageBudget,
} from '../utils/projectRasterBudget';

const GRAY_MODES: { value: GrayMode; label: string }[] = [
  { value: 'luminance', label: '輝度（標準）' },
  { value: 'average', label: '平均 (R+G+B)/3' },
  { value: 'lightness', label: '明度 (max+min)/2' },
  { value: 'value', label: '明るさ (max)' },
  { value: 'red', label: 'R チャンネル' },
  { value: 'green', label: 'G チャンネル' },
  { value: 'blue', label: 'B チャンネル' },
];

const fs: React.CSSProperties = {
  border: '1px solid var(--border,#3a3a3a)',
  borderRadius: 4,
  margin: '6px 0',
  padding: '6px 10px',
};
const lg: React.CSSProperties = { fontSize: 12, padding: '0 6px' };

export function PbrMapDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const layers = useEditorStore((s) => s.layers);
  const canvas = useEditorStore((s) => s.canvas);
  const selectedId = useEditorStore((s) => s.selectedId);
  const addLayer = useEditorStore((s) => s.addLayer);

  const imageLayers = layers.filter((l): l is ImageLayer => l.type === 'image');
  const initialId =
    selectedId && imageLayers.some((l) => l.id === selectedId)
      ? selectedId
      : imageLayers[0]?.id ?? '';

  const [sourceId, setSourceId] = useState(initialId);
  // 共通ハイト抽出
  const [grayMode, setGrayMode] = useState<GrayMode>(DEFAULT_PBR_SPEC.grayMode);
  const [invert, setInvert] = useState(DEFAULT_PBR_SPEC.invert);
  const [preBlur, setPreBlur] = useState(DEFAULT_PBR_SPEC.preBlur);
  const [detailScale, setDetailScale] = useState(DEFAULT_PBR_SPEC.detailScale);
  // マップ選択
  const [makeNormal, setMakeNormal] = useState(DEFAULT_PBR_SPEC.makeNormal);
  const [makeHeight, setMakeHeight] = useState(DEFAULT_PBR_SPEC.makeHeight);
  const [makeAo, setMakeAo] = useState(DEFAULT_PBR_SPEC.makeAo);
  const [makeRough, setMakeRough] = useState(DEFAULT_PBR_SPEC.makeRough);
  const [makeMetallic, setMakeMetallic] = useState(DEFAULT_PBR_SPEC.makeMetallic);
  const [makeMaskMap, setMakeMaskMap] = useState(DEFAULT_PBR_SPEC.makeMaskMap);
  // パラメータ
  const [normalStrength, setNormalStrength] = useState(DEFAULT_PBR_SPEC.normalStrength);
  const [flipY, setFlipY] = useState(DEFAULT_PBR_SPEC.flipY);
  const [aoStrength, setAoStrength] = useState(DEFAULT_PBR_SPEC.aoStrength);
  const [aoRadius, setAoRadius] = useState(DEFAULT_PBR_SPEC.aoRadius);
  const [roughBase, setRoughBase] = useState(DEFAULT_PBR_SPEC.roughBase);
  const [roughDetail, setRoughDetail] = useState(DEFAULT_PBR_SPEC.roughDetail);
  const [roughInvert, setRoughInvert] = useState(DEFAULT_PBR_SPEC.roughInvert);
  const [metallicValue, setMetallicValue] = useState(DEFAULT_PBR_SPEC.metallicValue);

  const [preview, setPreview] = useState<PbrResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const sourceLayer = imageLayers.find((l) => l.id === sourceId);
  const outputSizeSafe = isSafePbrOutputSize(canvas.width, canvas.height);

  const buildSpec = (): PbrSpec | null =>
    sourceLayer
      ? {
          layer: sourceLayer,
          width: canvas.width,
          height: canvas.height,
          grayMode,
          invert,
          autoLevel: false,
          blackPoint: 0,
          whitePoint: 1,
          gamma: 1,
          preBlur,
          detailScale,
          makeNormal,
          makeHeight,
          makeAo,
          makeRough,
          makeMetallic,
          makeMaskMap,
          normalStrength,
          zStrength: 1,
          flipY,
          aoStrength,
          aoRadius,
          roughBase,
          roughDetail,
          roughInvert,
          metallicValue,
        }
      : null;

  useEffect(() => {
    const spec = buildSpec();
    if (!spec) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const r = await previewPbrSet(spec, 200);
        if (!cancelled) setPreview(r);
      } catch {
        /* プレビュー失敗は無視 */
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceId,
    grayMode,
    invert,
    preBlur,
    detailScale,
    makeNormal,
    makeHeight,
    makeAo,
    makeRough,
    makeMetallic,
    makeMaskMap,
    normalStrength,
    flipY,
    aoStrength,
    aoRadius,
    roughBase,
    roughDetail,
    roughInvert,
    metallicValue,
    canvas.width,
    canvas.height,
  ]);

  const handleGenerate = async () => {
    const spec = buildSpec();
    if (!spec || !sourceLayer || !outputSizeSafe) return;
    const outputCount = [
      makeNormal,
      makeHeight,
      makeAo,
      makeRough,
      makeMetallic,
      makeMaskMap,
    ].filter(Boolean).length;
    const projected = validateProjectRasterBudget([
      ...layers,
      ...Array.from({ length: outputCount }, () => ({
        type: 'image' as const,
        naturalWidth: canvas.width,
        naturalHeight: canvas.height,
      })),
    ]);
    const projectedStorage = validateProjectStorageBudget(
      layers,
      estimatedRgbaDataUrlChars(canvas.width, canvas.height) * outputCount,
    );
    if (!projected.ok || !projectedStorage.ok) {
      setMsg(t({
        ja: '生成後の画像レイヤー総サイズが安全上限（128MP）を超えます。不要な画像レイヤーを削除または統合してください。',
        en: 'Generated maps would exceed the 128 MP raster safety limit. Remove or merge unused image layers first.',
      }));
      return;
    }
    setRunning(true);
    setMsg(null);
    try {
      const r = await generatePbrSet(spec);
      const add = (url: string | undefined, suffix: string) => {
        if (!url) return 0;
        const layer = createImageLayer(url, canvas.width, canvas.height);
        layer.name = `${sourceLayer.name}${suffix}`;
        return addLayer(layer) ? 1 : 0;
      };
      let n = 0;
      // Mask Map を最前面にしたいので最後に追加（addLayerは先頭=最前面想定なら順序調整）
      n += add(r.heightUrl, '_Height');
      n += add(r.metallicUrl, '_Metallic');
      n += add(r.roughUrl, '_Roughness');
      n += add(r.aoUrl, '_AO');
      n += add(r.normalUrl, '_Normal');
      n += add(r.maskUrl, '_MaskMap');
      setMsg(
        t({
          ja: `OK ${n}枚のマップをレイヤーとして追加しました`,
          en: `Added ${n} map layer(s) as layers`,
        })
      );
      setTimeout(onClose, 900);
    } catch (e) {
      setMsg(
        t({
          ja: `失敗: ${(e as Error).message}`,
          en: `Error: ${(e as Error).message}`,
        })
      );
    }
    setRunning(false);
  };

  const thumb: React.CSSProperties = {
    width: 84,
    height: 84,
    border: '1px solid var(--border,#3a3a3a)',
    borderRadius: 4,
    background: 'repeating-conic-gradient(#2b2b2b 0% 25%, #232323 0% 50%) 50% / 12px 12px',
    objectFit: 'contain',
    imageRendering: 'pixelated',
  };
  const thumbs: { url: string | undefined; label: string }[] = [
    { url: preview?.normalUrl, label: 'Normal' },
    { url: preview?.aoUrl, label: 'AO' },
    { url: preview?.roughUrl, label: 'Rough' },
    { url: preview?.heightUrl, label: 'Height' },
    { url: preview?.metallicUrl, label: 'Metal' },
    { url: preview?.maskUrl, label: 'Mask' },
  ].filter((t) => t.url);

  const grayModeEn: Record<string, string> = {
    '輝度（標準）': 'Luminance (Standard)',
    '平均 (R+G+B)/3': 'Average (R+G+B)/3',
    '明度 (max+min)/2': 'Lightness (max+min)/2',
    '明るさ (max)': 'Brightness (max)',
    'R チャンネル': 'R Channel',
    'G チャンネル': 'G Channel',
    'B チャンネル': 'B Channel',
  };

  return (
    <ModalShell
      title={t({
        ja: 'PBRマップ一括生成（1枚 → Normal/AO/Rough/…/Mask Map）',
        en: 'Batch PBR Map Generation (1 image → Normal/AO/Rough/…/Mask Map)',
      })}
      onClose={onClose}
      style={{ width: 600, maxWidth: '94vw', maxHeight: '92vh', overflowY: 'auto' }}
    >
        <div className="modal-row info">
          {t({
            ja: `出力: ${canvas.width} × ${canvas.height} px · Mask MapはUnity HDRP形式（R=Metal, G=AO, B=0, A=Smooth）`,
            en: `Output: ${canvas.width} × ${canvas.height} px · Mask Map is Unity HDRP format (R=Metal, G=AO, B=0, A=Smooth)`,
          })}
          {!outputSizeSafe && (
            <><br />{t({ ja: '安全のためPBR生成は4096×4096px以下に制限されています', en: 'For safety, PBR generation is limited to 4096×4096 px' })}</>
          )}
        </div>

        {/* プレビュー */}
        <div
          className="modal-row"
          style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}
        >
          {thumbs.length === 0 ? (
            <div style={{ opacity: 0.6, fontSize: 12 }}>
              {previewing
                ? t({ ja: 'プレビュー生成中…', en: 'Generating preview…' })
                : t({ ja: '生成するマップを選んでください', en: 'Please select maps to generate' })}
            </div>
          ) : (
            thumbs.map((t) => (
              <div key={t.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 3 }}>
                  {t.label}
                  {previewing ? '…' : ''}
                </div>
                <img src={t.url} style={thumb} alt={t.label} />
              </div>
            ))
          )}
        </div>

        {imageLayers.length === 0 && (
          <div className="modal-row warn">
            {t({
              ja: '画像レイヤーが必要です。先にテクスチャ画像を配置してください。',
              en: 'An image layer is required. Please place a texture image first.',
            })}
          </div>
        )}

        {/* ① ソース + 共通ハイト抽出 */}
        <fieldset style={fs}>
          <legend style={lg}>
            {t({ ja: '① テクスチャ＋高さの取り出し方', en: '① Texture & Height Extraction' })}
          </legend>
          <div className="modal-row">
            <label>
              {t({ ja: 'ソースレイヤー', en: 'Source Layer' })}
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                disabled={imageLayers.length === 0}
              >
                {imageLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-row">
            <label>
              {t({ ja: 'モノクロ化方式', en: 'Grayscale method' })}
              <select value={grayMode} onChange={(e) => setGrayMode(e.target.value as GrayMode)}>
                {GRAY_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {t({ ja: m.label, en: grayModeEn[m.label] ?? m.label })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="modal-row">
            <label className="invert-toggle">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              {t({
                ja: '明暗を反転（明るい部分を凹みに）',
                en: 'Invert light/dark (bright areas become recessed)',
              })}
            </label>
          </div>
          <div className="modal-row">
            <label>
              {t({
                ja: '事前ぼかし（不要な凹凸を消す）: ',
                en: 'Pre-blur (remove unwanted bumps): ',
              })}
              {preBlur}
              <input
                type="range"
                min={0}
                max={8}
                step={1}
                value={preBlur}
                onChange={(e) => setPreBlur(parseInt(e.target.value))}
              />
            </label>
          </div>
          <div className="modal-row">
            <label>
              {t({ ja: '細部の残し方: ', en: 'Detail retention: ' })}
              {Math.round(detailScale * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={detailScale}
                onChange={(e) => setDetailScale(parseFloat(e.target.value))}
              />
            </label>
          </div>
        </fieldset>

        {/* ② 生成マップ選択 */}
        <fieldset style={fs}>
          <legend style={lg}>
            {t({ ja: '② 生成するマップ', en: '② Maps to Generate' })}
          </legend>
          <div className="modal-row" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeNormal} onChange={(e) => setMakeNormal(e.target.checked)} />
              Normal
            </label>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeAo} onChange={(e) => setMakeAo(e.target.checked)} />
              AO
            </label>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeRough} onChange={(e) => setMakeRough(e.target.checked)} />
              Roughness
            </label>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeHeight} onChange={(e) => setMakeHeight(e.target.checked)} />
              Height
            </label>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeMetallic} onChange={(e) => setMakeMetallic(e.target.checked)} />
              Metallic
            </label>
            <label className="invert-toggle">
              <input type="checkbox" checked={makeMaskMap} onChange={(e) => setMakeMaskMap(e.target.checked)} />
              Unity Mask Map
            </label>
          </div>
        </fieldset>

        {/* ③ パラメータ */}
        {makeNormal && (
          <fieldset style={fs}>
            <legend style={lg}>Normal</legend>
            <div className="modal-row">
              <label>
                {t({ ja: '凹凸の強さ: ', en: 'Bump strength: ' })}
                {normalStrength.toFixed(1)}
                <input
                  type="range"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={normalStrength}
                  onChange={(e) => setNormalStrength(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <div className="modal-row">
              <label className="invert-toggle">
                <input type="checkbox" checked={flipY} onChange={(e) => setFlipY(e.target.checked)} />
                {t({
                  ja: 'Y軸反転（DirectX形式 / 既定OpenGL=Unity向け）',
                  en: 'Flip Y (DirectX format / default OpenGL=Unity)',
                })}
              </label>
            </div>
          </fieldset>
        )}
        {makeAo && (
          <fieldset style={fs}>
            <legend style={lg}>
              {t({ ja: 'AO（アンビエントオクルージョン）', en: 'AO (Ambient Occlusion)' })}
            </legend>
            <div className="modal-row">
              <label>
                {t({ ja: '強さ: ', en: 'Strength: ' })}
                {aoStrength.toFixed(1)}
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.1}
                  value={aoStrength}
                  onChange={(e) => setAoStrength(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <div className="modal-row">
              <label>
                {t({ ja: '範囲: ', en: 'Radius: ' })}
                {Math.round(aoRadius * 100)}%
                <input
                  type="range"
                  min={0.005}
                  max={0.15}
                  step={0.005}
                  value={aoRadius}
                  onChange={(e) => setAoRadius(parseFloat(e.target.value))}
                />
              </label>
            </div>
          </fieldset>
        )}
        {makeRough && (
          <fieldset style={fs}>
            <legend style={lg}>
              {t({ ja: 'Roughness（粗さ・近似）', en: 'Roughness (approximation)' })}
            </legend>
            <div className="modal-row">
              <label>
                {t({ ja: 'ベース粗さ: ', en: 'Base roughness: ' })}
                {Math.round(roughBase * 100)}%
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={roughBase}
                  onChange={(e) => setRoughBase(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <div className="modal-row">
              <label>
                {t({ ja: '細部での変調: ', en: 'Detail modulation: ' })}
                {Math.round(roughDetail * 100)}%
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={roughDetail}
                  onChange={(e) => setRoughDetail(parseFloat(e.target.value))}
                />
              </label>
            </div>
            <div className="modal-row">
              <label className="invert-toggle">
                <input type="checkbox" checked={roughInvert} onChange={(e) => setRoughInvert(e.target.checked)} />
                {t({ ja: '反転（粗⇔ツルツル）', en: 'Invert (rough⇔smooth)' })}
              </label>
            </div>
          </fieldset>
        )}
        {makeMetallic && (
          <fieldset style={fs}>
            <legend style={lg}>
              {t({ ja: 'Metallic（ベタ値）', en: 'Metallic (solid value)' })}
            </legend>
            <div className="modal-row">
              <label>
                {t({ ja: '金属度: ', en: 'Metallic: ' })}
                {Math.round(metallicValue * 100)}%
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={metallicValue}
                  onChange={(e) => setMetallicValue(parseFloat(e.target.value))}
                />
              </label>
            </div>
          </fieldset>
        )}

        {msg && <div className="modal-row result">{msg}</div>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>
            {t({ ja: 'キャンセル', en: 'Cancel' })}
          </button>
          <button className="primary" onClick={handleGenerate} disabled={running || !sourceLayer || !outputSizeSafe}>
            {running
              ? t({ ja: '生成中...', en: 'Generating...' })
              : t({ ja: 'マップ生成', en: 'Generate Maps' })}
          </button>
        </div>
    </ModalShell>
  );
}
