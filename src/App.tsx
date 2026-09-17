import { useState, useRef, type DragEvent, type MouseEvent as ReactMouseEvent, type SyntheticEvent } from 'react';
import Konva from 'konva';
import { Canvas } from './components/Canvas';
import { LayerPanel } from './components/LayerPanel';
import { LeftToolbar } from './components/LeftToolbar';
import { PropertyPanel } from './components/PropertyPanel';
import { MenuBar } from './components/MenuBar';
import { OptionsBar } from './components/OptionsBar';
import { TabBar } from './components/TabBar';
import { StatusBar } from './components/StatusBar';
import { Toasts } from './components/Toasts';
import { ImageSizeDialog } from './components/ImageSizeDialog';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { ShortcutsDialog, AboutDialog } from './components/HelpDialogs';
import { ChannelPackerDialog } from './components/ChannelPackerDialog';
import { PbrMapDialog } from './components/PbrMapDialog';
import { LightingPreviewDialog } from './components/LightingPreviewDialog';
import { TilePreviewDialog } from './components/TilePreviewDialog';
import { AdjustmentsDialog } from './components/AdjustmentsDialog';
import { ModalShell } from './components/ModalShell';
import { useEditorStore, createImageLayer } from './store/editorStore';
import { fileToImageLayer } from './utils/imageImport';
import { openPsdFile } from './utils/projectIo';
import {
  generateNormalMapImage,
  isSafeNormalMapSize,
  DEFAULT_NORMAL_SPEC,
} from './utils/normalMap';
import { toast } from './store/toastStore';
import type { ImageLayer, NormalGenParams } from './types';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useT } from './i18n/locale';
import {
  DEFAULT_COLOR_ADJUSTMENTS,
  normalizeColorAdjustments,
  type AdjustmentMode,
} from './imaging/colorAdjustments';
import { commitImageAdjustment, renderCompositeCanvas } from './utils/selectionOps';
import { IS_TRIAL, TRIAL_MAX_DIM, trialScale } from './utils/trial';
import { validateExportSize } from './utils/canvasLimits';
import { createLayerLockChecker } from './interactions/layerLockPolicy';
import {
  estimatedRgbaDataUrlChars,
  validateProjectRasterBudget,
  validateProjectStorageBudget,
} from './utils/projectRasterBudget';

export function App() {
  const t = useT();
  const [exportOpen, setExportOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [channelPackOpen, setChannelPackOpen] = useState(false);
  const [pbrOpen, setPbrOpen] = useState(false);
  const [lightingOpen, setLightingOpen] = useState(false);
  const [tilePreviewOpen, setTilePreviewOpen] = useState(false);
  const [imageSizeOpen, setImageSizeOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [adjustmentDialog, setAdjustmentDialog] = useState<{
    layerId: string;
    mode: AdjustmentMode;
  } | null>(null);
  const [immediateAdjustment, setImmediateAdjustment] = useState(false);
  const [dragHover, setDragHover] = useState(false);
  const [fitPrompt, setFitPrompt] = useState<{
    layerId: string;
    imgW: number;
    imgH: number;
    canvasW: number;
    canvasH: number;
  } | null>(null);
  const addLayer = useEditorStore((s) => s.addLayer);
  const fitCanvasToLayer = useEditorStore((s) => s.fitCanvasToLayer);
  const panelsVisible = useEditorStore((s) => s.panelsVisible);
  const rightDockRef = useRef<HTMLDivElement>(null);
  const immediateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [propHeight, setPropHeight] = useState<number | null>(null);
  const [dockWidth, setDockWidth] = useState(280);
  const openAdjustment = (mode: AdjustmentMode) => {
    const state = useEditorStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === state.selectedId);
    if (!layer || layer.type !== 'image' || layer.normalGen || createLayerLockChecker(state.layers)(layer.id)) {
      toast(t({ ja: '通常の画像レイヤーを1つ選択してください', en: 'Select one regular image layer' }), { kind: 'error' });
      return;
    }
    setAdjustmentDialog({ layerId: layer.id, mode });
  };

  const applyImmediateAdjustment = async (kind: 'invert' | 'desaturate') => {
    const state = useEditorStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === state.selectedId);
    if (!layer || layer.type !== 'image' || layer.normalGen || createLayerLockChecker(state.layers)(layer.id)) {
      toast(t({ ja: '通常の画像レイヤーを1つ選択してください', en: 'Select one regular image layer' }), { kind: 'error' });
      return;
    }
    const adjustments = normalizeColorAdjustments(DEFAULT_COLOR_ADJUSTMENTS);
    if (kind === 'invert') adjustments.invert = true;
    else adjustments.saturation = -100;
    setImmediateAdjustment(true);
    try {
      const applied = await commitImageAdjustment(layer.id, adjustments, state.selection);
      if (!applied) toast(t({ ja: '補正を適用できませんでした', en: 'Could not apply the adjustment' }), { kind: 'error' });
    } finally {
      setImmediateAdjustment(false);
    }
  };

  const enqueueImmediateAdjustment = (kind: 'invert' | 'desaturate') => {
    immediateQueueRef.current = immediateQueueRef.current
      .then(() => applyImmediateAdjustment(kind))
      .catch((error) => {
        console.error('[adjustment]', error);
      });
  };
  const invertImage = () => enqueueImmediateAdjustment('invert');
  const desaturateImage = () => enqueueImmediateAdjustment('desaturate');

  const adjustmentSessionOpen = adjustmentDialog != null || immediateAdjustment;
  const blockingDialogOpen = exportOpen
    || batchOpen
    || channelPackOpen
    || pbrOpen
    || lightingOpen
    || tilePreviewOpen
    || imageSizeOpen
    || newDocOpen
    || shortcutsOpen
    || aboutOpen
    || fitPrompt != null;

  const closeBlockingDialog = () => {
    // Match visual stacking order so Escape always closes the frontmost dialog.
    if (fitPrompt) setFitPrompt(null);
    else if (tilePreviewOpen) setTilePreviewOpen(false);
    else if (lightingOpen) setLightingOpen(false);
    else if (pbrOpen) setPbrOpen(false);
    else if (channelPackOpen) setChannelPackOpen(false);
    else if (aboutOpen) setAboutOpen(false);
    else if (shortcutsOpen) setShortcutsOpen(false);
    else if (newDocOpen) setNewDocOpen(false);
    else if (imageSizeOpen) setImageSizeOpen(false);
    else if (batchOpen) setBatchOpen(false);
    else if (exportOpen) setExportOpen(false);
  };

  useKeyboardShortcuts({
    onExport: () => setExportOpen(true),
    onNew: () => setNewDocOpen(true),
    onAdjustment: openAdjustment,
    onInvertImage: invertImage,
    onDesaturateImage: desaturateImage,
    onCanvasSize: () => setImageSizeOpen(true),
    adjustmentOpen: adjustmentSessionOpen,
    blockingDialogOpen,
    onCloseDialog: closeBlockingDialog,
  });

  const guardAdjustmentSession = (event: SyntheticEvent) => {
    if (!adjustmentSessionOpen) return;
    const target = event.target as HTMLElement;
    if (target.closest('.adjustment-modal') || target.closest('.canvas-wrap')) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    if (adjustmentSessionOpen) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    setDragHover(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.relatedTarget && (e.currentTarget as Node).contains(e.relatedTarget as Node)) return;
    setDragHover(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragHover(false);
    if (adjustmentSessionOpen) {
      toast(t({ ja: '色調補正を確定またはキャンセルしてからファイルを追加してください', en: 'Apply or cancel the adjustment before adding files' }), { kind: 'info' });
      return;
    }
    const dropped = Array.from(e.dataTransfer.files);
    // PSD/PSB は新規ドキュメントとして開く（画像レイヤー追加とは別フロー）
    const psd = dropped.find((f) => /\.(psd|psb)$/i.test(f.name));
    if (psd) {
      const r = await openPsdFile(psd);
      if (!r.ok && r.error) alert(t({ ja: `PSD読み込み失敗: ${r.error}`, en: `PSD load failed: ${r.error}` }));
      return;
    }
    const files = dropped.filter((f) => f.type.startsWith('image/'));
    let firstLayer: import('./types').ImageLayer | null = null;
    for (const f of files) {
      try {
        const layer = await fileToImageLayer(f);
        if (addLayer(layer) && !firstLayer) firstLayer = layer;
      } catch (error) {
        toast(t({
          ja: `${f.name} を読み込めません: ${error instanceof Error ? error.message : String(error)}`,
          en: `Could not load ${f.name}: ${error instanceof Error ? error.message : String(error)}`,
        }), { kind: 'error' });
      }
    }
    // ドロップ画像がカンバスと寸法不一致なら「カンバスを合わせる」を提案
    if (firstLayer) {
      const { width: cw, height: ch } = useEditorStore.getState().canvas;
      if (firstLayer.naturalWidth !== cw || firstLayer.naturalHeight !== ch) {
        setFitPrompt({
          layerId: firstLayer.id,
          imgW: firstLayer.naturalWidth,
          imgH: firstLayer.naturalHeight,
          canvasW: cw,
          canvasH: ch,
        });
      }
    }
  };

  // 右ドックのプロパティ／レイヤーの高さ配分をドラッグで調整する。
  const startPanelResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const dock = rightDockRef.current;
    if (!dock) return;
    const propEl = dock.querySelector('.property-panel') as HTMLElement | null;
    if (!propEl) return;
    const startY = e.clientY;
    const startH = propEl.getBoundingClientRect().height;
    const dockH = dock.getBoundingClientRect().height;
    const onMove = (ev: MouseEvent) => {
      const h = Math.max(80, Math.min(dockH - 120, startH + (ev.clientY - startY)));
      setPropHeight(h);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // 右ドック全体の幅をドラッグで左右に拡縮する（ドックは右端なので、左へドラッグ＝幅を広げる）。
  const startDockResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = dockWidth;
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(200, Math.min(620, startW + (startX - ev.clientX)));
      setDockWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // ノーマルマップを「非破壊レイヤー」として生成し、右パネルで調整できるようにする（ダイアログを出さない）。
  const handleNormalMap = async () => {
    const st = useEditorStore.getState();
    const isLocked = createLayerLockChecker(st.layers);
    const imageLayers = st.layers.filter(
      (l): l is ImageLayer => l.type === 'image' && !l.normalGen && !isLocked(l.id),
    );
    const sel = st.layers.find((l) => l.id === st.selectedId);
    const source =
      sel && sel.type === 'image' && !sel.normalGen && !isLocked(sel.id) ? sel : imageLayers[0];
    if (!source) {
      toast(t({ ja: '画像レイヤーが必要です。先にテクスチャを配置してください', en: 'An image layer is required. Please place a texture first.' }), { kind: 'error' });
      return;
    }
    if (!isSafeNormalMapSize(st.canvas.width, st.canvas.height)) {
      toast(t({
        ja: '安全のためノーマルマップ生成は4096×4096px以下に制限されています',
        en: 'For safety, normal map generation is limited to 4096×4096 px',
      }), { kind: 'error' });
      return;
    }
    if (!validateProjectRasterBudget([
      ...st.layers,
      {
        type: 'image' as const,
        naturalWidth: st.canvas.width,
        naturalHeight: st.canvas.height,
      },
    ]).ok || !validateProjectStorageBudget(
      st.layers,
      estimatedRgbaDataUrlChars(st.canvas.width, st.canvas.height),
    ).ok) {
      toast(t({
        ja: 'ノーマルマップを追加すると画像レイヤーの安全上限（128MP）を超えます',
        en: 'Adding the normal map would exceed the 128 MP raster safety limit',
      }), { kind: 'error' });
      return;
    }
    const ng: NormalGenParams = { sourceLayerId: source.id, ...DEFAULT_NORMAL_SPEC };
    try {
      const r = await generateNormalMapImage({
        layer: source,
        width: st.canvas.width,
        height: st.canvas.height,
        ...DEFAULT_NORMAL_SPEC,
      });
      const newLayer = createImageLayer(r.normalUrl, st.canvas.width, st.canvas.height);
      newLayer.name = `${source.name}_Normal`;
      newLayer.normalGen = ng;
      if (!st.addLayer(newLayer)) return;
      toast(t({ ja: 'ノーマルマップを作成しました。右のプロパティで調整してください', en: 'Normal map created. Adjust in the right property panel.' }), { kind: 'success' });
    } catch (error) {
      toast(t({
        ja: `ノーマルマップ生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        en: `Normal map generation failed: ${error instanceof Error ? error.message : String(error)}`,
      }), { kind: 'error' });
    }
  };

  return (
    <div
      className={`app ${dragHover ? 'drag-hover' : ''} ${panelsVisible ? '' : 'panels-hidden'}`}
      onPointerDownCapture={guardAdjustmentSession}
      onMouseDownCapture={guardAdjustmentSession}
      onClickCapture={guardAdjustmentSession}
      onContextMenuCapture={guardAdjustmentSession}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <MenuBar
        onNew={() => setNewDocOpen(true)}
        onExport={() => setExportOpen(true)}
        onBatchExport={() => setBatchOpen(true)}
        onChannelPack={() => setChannelPackOpen(true)}
        onNormalMap={handleNormalMap}
        onPbrMaps={() => setPbrOpen(true)}
        onLightingPreview={() => setLightingOpen(true)}
        onTilePreview={() => setTilePreviewOpen(true)}
        onImageSize={() => setImageSizeOpen(true)}
        onAdjustment={openAdjustment}
        onInvertImage={invertImage}
        onDesaturateImage={desaturateImage}
        onShortcuts={() => setShortcutsOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />
      <OptionsBar />
      <TabBar onNew={() => setNewDocOpen(true)} />
      <div
        className="workspace"
        style={panelsVisible ? { gridTemplateColumns: `48px 1fr ${dockWidth}px` } : undefined}
      >
        <LeftToolbar />
        <Canvas adjustmentSessionOpen={adjustmentSessionOpen} />
        {panelsVisible && (
          <div className="right-dock" ref={rightDockRef}>
            <div
              className="dock-splitter-v"
              onMouseDown={startDockResize}
              title={t({ ja: 'ドラッグで右パネルの幅を調整', en: 'Drag to adjust right panel width' })}
              role="separator"
              aria-orientation="vertical"
            />
            <PropertyPanel
              style={propHeight != null ? { flex: `0 0 ${propHeight}px` } : undefined}
              onAdjustment={openAdjustment}
            />
            <div
              className="panel-splitter"
              onMouseDown={startPanelResize}
              title={t({ ja: 'ドラッグでプロパティとレイヤーの高さを調整', en: 'Drag to adjust height between properties and layers' })}
              role="separator"
              aria-orientation="horizontal"
            />
            <LayerPanel />
          </div>
        )}
      </div>
      <StatusBar />
      <Toasts />
      {dragHover && (
        <div className="drop-overlay">
          <div className="drop-message">
            <div className="drop-icon">📥</div>
            <div>{t({ ja: '画像をドロップで追加（PSD はドキュメントとして開く）', en: 'Drop image to add (PSD opens as document)' })}</div>
          </div>
        </div>
      )}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}
      {batchOpen && <BatchExportModal onClose={() => setBatchOpen(false)} />}
      {imageSizeOpen && <ImageSizeDialog onClose={() => setImageSizeOpen(false)} />}
      {newDocOpen && <NewDocumentDialog onClose={() => setNewDocOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {adjustmentDialog && (
        <AdjustmentsDialog
          key={`${adjustmentDialog.layerId}-${adjustmentDialog.mode}`}
          layerId={adjustmentDialog.layerId}
          mode={adjustmentDialog.mode}
          onClose={() => setAdjustmentDialog(null)}
        />
      )}
      {channelPackOpen && (
        <ChannelPackerDialog onClose={() => setChannelPackOpen(false)} />
      )}
      {pbrOpen && <PbrMapDialog onClose={() => setPbrOpen(false)} />}
      {lightingOpen && <LightingPreviewDialog onClose={() => setLightingOpen(false)} />}
      {tilePreviewOpen && (
        <TilePreviewDialog onClose={() => setTilePreviewOpen(false)} />
      )}
      {fitPrompt && (
        <ModalShell
          title={t({ ja: 'カンバスサイズを合わせる', en: 'Match canvas to image size' })}
          onClose={() => setFitPrompt(null)}
        >
            <div className="modal-row info">
              {t({ ja: 'ドロップした画像 ', en: 'The dropped image ' })}<b>{fitPrompt.imgW} × {fitPrompt.imgH}</b>{t({ ja: ' px は カンバス ', en: ' px does not match the canvas ' })}<b>{fitPrompt.canvasW} × {fitPrompt.canvasH}</b>{t({ ja: ' px と 一致していません。', en: ' px. ' })}</div>
            <div className="modal-row">
              {t({ ja: 'カンバスを画像サイズ（', en: 'Match canvas to image size (' })} {fitPrompt.imgW} × {fitPrompt.imgH} {t({ ja: '）に 合わせますか？', en: ')?' })}
            </div>
            <div className="modal-actions">
              <button onClick={() => setFitPrompt(null)}>
                {t({ ja: 'そのまま追加', en: 'Add as is' })}
              </button>
              <button
                className="primary"
                onClick={() => {
                  fitCanvasToLayer(fitPrompt.layerId);
                  setFitPrompt(null);
                }}
              >
                {t({ ja: 'カンバスを画像に合わせる', en: 'Match canvas to image' })}
              </button>
            </div>
        </ModalShell>
      )}
    </div>
  );
}

const UNITY_SUFFIXES = [
  { id: '', label: 'なし (素の名前のみ)' },
  { id: '_Albedo', label: '_Albedo (BaseColor)' },
  { id: '_Normal', label: '_Normal (Normal Map)' },
  { id: '_Mask', label: '_Mask (HDRP/URP Mask Map)' },
  { id: '_Height', label: '_Height (Heightmap)' },
  { id: '_Detail', label: '_Detail (Detail Map)' },
  { id: '_Roughness', label: '_Roughness' },
  { id: '_Metallic', label: '_Metallic' },
  { id: '_AO', label: '_AO (Ambient Occlusion)' },
  { id: '_Emission', label: '_Emission' },
  { id: '_ORM', label: '_ORM (glTF)' },
] as const;

function BatchExportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const scaleOptions = [0.25, 0.5, 1, 2, 3];
  const [scales, setScales] = useState<number[]>([1, 2]);
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [quality, setQuality] = useState(0.92);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [prefix, setPrefix] = useState('thumb');
  const [unitySuffix, setUnitySuffix] = useState('');

  const toggleScale = (s: number) => {
    setScales((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].sort((a, b) => a - b),
    );
  };

  const handleRun = async () => {
    if (scales.length === 0) {
      setLog([t({ ja: '倍率を1つ以上選択してください', en: 'Select at least one scale' })]);
      return;
    }
    setRunning(true);
    setLog([]);
    const stage = Konva.stages[0];
    if (!stage) {
      setLog([t({ ja: '❌ Konva Stage が見つかりません', en: '❌ Konva Stage not found' })]);
      setRunning(false);
      return;
    }

    const folder = await window.layerlab.chooseFolder();
    if (!folder.success || !folder.path) {
      setLog([folder.error === 'cancelled' ? t({ ja: 'キャンセル', en: 'Cancelled' }) : t({ ja: `❌ ${folder.error}`, en: `❌ ${folder.error}` })]);
      setRunning(false);
      return;
    }

    const ext = format === 'png' ? 'png' : 'jpg';
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const sep = folder.path.includes('\\') ? '\\' : '/';
    const lines: string[] = [];

    for (const s of scales) {
      const requestedW = Math.round(canvas.width * s);
      const requestedH = Math.round(canvas.height * s);
      const outputScale = s * trialScale(requestedW, requestedH);
      const targetW = Math.round(canvas.width * outputScale);
      const targetH = Math.round(canvas.height * outputScale);
      const safeSize = validateExportSize(targetW, targetH);
      if (!safeSize.ok) {
        lines.push(t({
          ja: `❌ ${targetW}×${targetH}: 安全な書き出し上限を超えています`,
          en: `❌ ${targetW}×${targetH}: exceeds the safe export limit`,
        }));
        setLog([...lines]);
        continue;
      }
      const rendered = renderCompositeCanvas(outputScale);
      if (!rendered) {
        lines.push(t({ ja: `❌ ${targetW}×${targetH}: 描画に失敗`, en: `❌ ${targetW}×${targetH}: render failed` }));
        continue;
      }
      const dataUrl = rendered.toDataURL(mime, format === 'jpg' ? quality : undefined);
      const blob = await (await fetch(dataUrl)).blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const scaleSuffix = s === 1 ? '' : `@${s}x`;
      const filename = `${prefix}${unitySuffix}-${targetW}x${targetH}${scaleSuffix}.${ext}`;
      const filePath = `${folder.path}${sep}${filename}`;
      const r = await window.layerlab.writeBytes(filePath, bytes);
      if (r.success) {
        lines.push(t({ ja: `✅ ${filename}`, en: `✅ ${filename}` }));
      } else if (r.error === 'exists') {
        lines.push(t({ ja: `⏭ ${filename}: 既存ファイルを保護してスキップ`, en: `⏭ ${filename}: skipped to protect the existing file` }));
      } else {
        lines.push(t({ ja: `❌ ${filename}: ${r.error}`, en: `❌ ${filename}: ${r.error}` }));
      }
      setLog([...lines]);
    }

    setRunning(false);
  };

  return (
    <ModalShell
      title={t({ ja: '一括書き出し', en: 'Batch Export' })}
      onClose={onClose}
      closeOnBackdrop={!running}
    >
        <div className="modal-row">
          <label>
            {t({ ja: 'ファイル名プレフィックス', en: 'Filename prefix' })}
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
            />
          </label>
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: 'Unityサフィックス', en: 'Unity suffix' })}
            <select
              value={unitySuffix}
              onChange={(e) => setUnitySuffix(e.target.value)}
            >
              {UNITY_SUFFIXES.map((u) => (
                <option key={u.id} value={u.id}>
                  {t({ ja: u.label, en: u.id === '' ? 'None (plain name only)' : u.label })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: '形式', en: 'Format' })}
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'png' | 'jpg')}
            >
              <option value="png">{t({ ja: 'PNG (透過対応・無劣化)', en: 'PNG (supports transparency, lossless)' })}</option>
              <option value="jpg">{t({ ja: 'JPG (高圧縮・透過なし)', en: 'JPG (high compression, no transparency)' })}</option>
            </select>
          </label>
        </div>
        {format === 'jpg' && (
          <div className="modal-row">
            <label>
              {t({ ja: `品質: ${Math.round(quality * 100)}%`, en: `Quality: ${Math.round(quality * 100)}%` })}
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(quality * 100)}
                onChange={(e) => setQuality(parseInt(e.target.value) / 100)}
              />
            </label>
          </div>
        )}
        <div className="modal-row">
          <div className="batch-scale-row">
            <span>{t({ ja: '倍率:', en: 'Scale:' })}</span>
            {scaleOptions.map((s) => (
              <label key={s} className="batch-scale-chip">
                <input
                  type="checkbox"
                  checked={scales.includes(s)}
                  onChange={() => toggleScale(s)}
                />
                {t({ ja: `${s}x (${Math.round(canvas.width * s)}×${Math.round(canvas.height * s)})`, en: `${s}x (${Math.round(canvas.width * s)}×${Math.round(canvas.height * s)})` })}
              </label>
            ))}
          </div>
        </div>
        <div className="modal-row info">
          {t({ ja: `現キャンバス: ${canvas.width} × ${canvas.height} px · ${scales.length} 件出力`, en: `Current canvas: ${canvas.width} × ${canvas.height} px · ${scales.length} output(s)` })}
          <br />{t({ ja: '既存の同名ファイルは上書きせずスキップします', en: 'Existing files with the same name are skipped, not overwritten' })}
          {IS_TRIAL && <><br />{t({ ja: `お試し版: 長辺 ${TRIAL_MAX_DIM}px まで`, en: `Trial: longest edge capped at ${TRIAL_MAX_DIM}px` })}</>}
        </div>
        {log.length > 0 && (
          <div className="modal-row batch-log">
            {log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button onClick={onClose} disabled={running}>
            {running ? t({ ja: '実行中...', en: 'Running...' }) : t({ ja: '閉じる', en: 'Close' })}
          </button>
          <button
            className="primary"
            onClick={handleRun}
            disabled={running || scales.length === 0}
          >
            {running ? t({ ja: '書出中...', en: 'Exporting...' }) : t({ ja: `${scales.length}件 書き出す`, en: `Export ${scales.length} file(s)` })}
          </button>
        </div>
    </ModalShell>
  );
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const canvas = useEditorStore((s) => s.canvas);
  const [format, setFormat] = useState<'png' | 'jpg'>('png');
  const [quality, setQuality] = useState(0.92);
  const [unitySuffix, setUnitySuffix] = useState('');
  const [baseName, setBaseName] = useState('layerlab');
  const [exporting, setExporting] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setResultMsg(null);
    const stage = Konva.stages[0];
    if (!stage) {
      setResultMsg(t({ ja: 'エラー: Konva Stage が見つかりません', en: 'Error: Konva Stage not found' }));
      setExporting(false);
      return;
    }

    const outputScale = trialScale(canvas.width, canvas.height);
    const outputWidth = Math.round(canvas.width * outputScale);
    const outputHeight = Math.round(canvas.height * outputScale);
    const safeSize = validateExportSize(outputWidth, outputHeight);
    if (!safeSize.ok) {
      setResultMsg(t({
        ja: `エラー: ${outputWidth}×${outputHeight}px は安全な書き出し上限を超えています`,
        en: `Error: ${outputWidth}×${outputHeight}px exceeds the safe export limit`,
      }));
      setExporting(false);
      return;
    }
    const rendered = renderCompositeCanvas(outputScale);
    if (!rendered) {
      setResultMsg(t({ ja: 'エラー: キャンバスの描画に失敗しました', en: 'Error: Canvas rendering failed' }));
      setExporting(false);
      return;
    }
    const dataUrl = rendered.toDataURL(
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'jpg' ? quality : undefined,
    );

    const blob = await (await fetch(dataUrl)).blob();
    const buffer = await blob.arrayBuffer();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = (baseName || 'layerlab').replace(/[\\/:*?"<>|]/g, '');
    const filename = `${safeName}${unitySuffix}-${ts}.${format === 'jpg' ? 'jpg' : 'png'}`;
    const result = await window.layerlab.saveImage(
      filename,
      new Uint8Array(buffer),
      format,
    );
    if (result.success) {
      setResultMsg(t({ ja: `✅ 保存完了: ${result.path}`, en: `✅ Saved: ${result.path}` }));
      setTimeout(onClose, 1500);
    } else if (result.error === 'cancelled') {
      setResultMsg(t({ ja: 'キャンセル', en: 'Cancelled' }));
    } else {
      setResultMsg(t({ ja: `❌ 失敗: ${result.error}`, en: `❌ Failed: ${result.error}` }));
    }
    setExporting(false);
  };

  return (
    <ModalShell
      title={t({ ja: '書き出し', en: 'Export' })}
      onClose={onClose}
      closeOnBackdrop={!exporting}
    >
        <div className="modal-row">
          <label>
            {t({ ja: 'ベースファイル名', en: 'Base filename' })}
            <input
              type="text"
              value={baseName}
              onChange={(e) => setBaseName(e.target.value)}
            />
          </label>
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: 'Unityサフィックス', en: 'Unity suffix' })}
            <select
              value={unitySuffix}
              onChange={(e) => setUnitySuffix(e.target.value)}
            >
              {UNITY_SUFFIXES.map((u) => (
                <option key={u.id} value={u.id}>
                  {t({ ja: u.label, en: u.id === '' ? 'None (plain name only)' : u.label })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-row">
          <label>
            {t({ ja: '形式', en: 'Format' })}
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'png' | 'jpg')}
            >
              <option value="png">{t({ ja: 'PNG (透過対応・無劣化)', en: 'PNG (supports transparency, lossless)' })}</option>
              <option value="jpg">{t({ ja: 'JPG (高圧縮・透過なし)', en: 'JPG (high compression, no transparency)' })}</option>
            </select>
          </label>
        </div>
        {format === 'jpg' && (
          <div className="modal-row">
            <label>
              {t({ ja: `品質: ${Math.round(quality * 100)}%`, en: `Quality: ${Math.round(quality * 100)}%` })}
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(quality * 100)}
                onChange={(e) => setQuality(parseInt(e.target.value) / 100)}
              />
            </label>
          </div>
        )}
        <div className="modal-row info">
          {t({ ja: `サイズ: ${Math.round(canvas.width * trialScale(canvas.width, canvas.height))} × ${Math.round(canvas.height * trialScale(canvas.width, canvas.height))} px`, en: `Size: ${Math.round(canvas.width * trialScale(canvas.width, canvas.height))} × ${Math.round(canvas.height * trialScale(canvas.width, canvas.height))} px` })}
          {IS_TRIAL && <> · {t({ ja: 'お試し版上限', en: 'Trial limit' })}</>}
        </div>
        {resultMsg && <div className="modal-row result">{resultMsg}</div>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={exporting}>
            {t({ ja: 'キャンセル', en: 'Cancel' })}
          </button>
          <button className="primary" onClick={handleExport} disabled={exporting}>
            {exporting ? t({ ja: '書き出し中...', en: 'Exporting...' }) : t({ ja: '書き出す', en: 'Export' })}
          </button>
        </div>
    </ModalShell>
  );
}
