import { t } from '../i18n/locale';
import {
  createImageLayer,
  createDocumentStore,
  getActiveStore,
  workspaceStore,
  type DocStore,
} from '../store/editorStore';
import type { CanvasConfig, Layer, LayerId, Guide } from '../types';
import { serializeProject, parseProject, LlabParseError } from './llabFile';
import { psdArrayBufferToProject } from './psdImport';
import { PSD_HEADER_BYTES, validatePsdHeader, type PsdValidationResult } from './psdLimits';
import { validatePixelSize } from './canvasLimits';
import { savedSnapshotStillCurrent } from '../interactions/savePolicy';
import { enqueueDocumentSave } from '../interactions/saveQueue';
import { flushPendingEdits } from '../interactions/pendingEdits';
import { toast } from '../store/toastStore';

const pendingPathOwners = new Map<string, DocStore>();
const documentPathIdentities = new WeakMap<DocStore, string>();

function pathKey(filePath: string): string {
  return filePath.replace(/\//g, '\\').toLocaleLowerCase('en-US');
}

function documentForPath(filePath: string): { id: string; store: DocStore } | undefined {
  const key = pathKey(filePath);
  return workspaceStore.getState().docs.find((doc) => {
    const identity = documentPathIdentities.get(doc.store);
    if (identity != null) return pathKey(identity) === key;
    const currentPath = doc.store.getState().currentFilePath;
    return currentPath != null && pathKey(currentPath) === key;
  });
}

function reservePath(store: DocStore, filePath: string): boolean {
  const key = pathKey(filePath);
  const open = documentForPath(filePath);
  const reserved = pendingPathOwners.get(key);
  if ((open && open.store !== store) || (reserved && reserved !== store)) return false;
  pendingPathOwners.set(key, store);
  return true;
}

function releasePath(store: DocStore, filePath: string): void {
  const key = pathKey(filePath);
  if (pendingPathOwners.get(key) === store) pendingPathOwners.delete(key);
}

function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}

function psdPreflightMessage(result: Exclude<PsdValidationResult, { ok: true }>): string {
  if (result.code === 'file-too-large') {
    return t({ ja: 'PSD/PSB は 128 MB 以下にしてください', en: 'PSD/PSB must be 128 MB or smaller' });
  }
  if (result.code === 'unsafe-canvas') {
    return t({
      ja: `PSD/PSB のキャンバス ${result.width}×${result.height}px は安全上限（8192px / 32MP）を超えています`,
      en: `PSD/PSB canvas ${result.width}×${result.height}px exceeds the safe limit (8192 px / 32 MP)`,
    });
  }
  return t({
    ja: 'PSD/PSB ヘッダーが壊れているか、対応していない形式です',
    en: 'The PSD/PSB header is corrupt or unsupported',
  });
}

/**
 * selection._raw is non-enumerable and is stripped by JSON serialization.
 * After loading a .llab file, decode selection.data (dataURL) to rebuild _raw
 * so that refine/invert operations work correctly without relying on contour fallback.
 */
async function rehydrateSelectionRaw(store: DocStore): Promise<void> {
  const sel = store.getState().selection;
  if (sel?.type !== 'mask' || (sel as any)._raw || !sel.data) return;
  try {
    const img = new window.Image();
    img.src = sel.data;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('selection data decode failed'));
    });
    const c = document.createElement('canvas');
    c.width = sel.width;
    c.height = sel.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, sel.width, sel.height).data;
    const raw = new Uint8ClampedArray(sel.width * sel.height);
    for (let i = 0; i < raw.length; i++) {
      // maskToSelection stores intensity in RGB channels (A=255)
      raw[i] = pixels[i * 4]; // red channel = intensity
    }
    // Only attach if the selection hasn't changed since we started
    const currentSel = store.getState().selection;
    if (currentSel && currentSel.type === 'mask' && !(currentSel as any)._raw) {
      Object.defineProperty(currentSel, '_raw', {
        value: raw,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Ignore — contour fallback in selectionToMask handles the degraded case
  }
}

/** 読み込んだプロジェクトを新規タブとして開く（独立ストア＋履歴クリア）。 */
function openLoadedDoc(
  data: { canvas: CanvasConfig; layers: Layer[]; selectedId: LayerId | null; guides?: Guide[] },
  filePath: string | null,
  title: string,
  revision: string | null = null,
  canonicalFilePath?: string,
): void {
  const store = createDocumentStore(data.canvas);
  store.getState().loadProject(data, filePath, revision);
  if (canonicalFilePath) documentPathIdentities.set(store, canonicalFilePath);
  store.temporal.getState().clear();
  workspaceStore.getState().adoptDoc(store, title);
  // Async: rebuild _raw from dataURL so refine ops work after load
  rehydrateSelectionRaw(store);
}

function defaultName(canvasW: number, canvasH: number): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
  return `layerlab-${canvasW}x${canvasH}-${ts}.llab`;
}

function snapshot(store: DocStore) {
  const s = store.getState();
  return {
    store,
    canvas: s.canvas,
    layers: s.layers,
    selectedId: s.selectedId,
    guides: s.guides,
    path: s.currentFilePath,
    revision: s.currentFileRevision,
  };
}

function snapshotIsCurrent(s: ReturnType<typeof snapshot>): boolean {
  const current = s.store.getState();
  return savedSnapshotStillCurrent(s, {
    canvas: current.canvas,
    layers: current.layers,
    guides: current.guides,
    path: current.currentFilePath,
  });
}

function finishSave(
  s: ReturnType<typeof snapshot>,
  isLatest: boolean,
  newPath: string,
  revision: string | null,
  canonicalPath?: string,
): boolean {
  const unchanged = snapshotIsCurrent(s);
  // Even a stale queued write becomes the disk revision that the next queued
  // write must compare against.  Only the newest unchanged request is clean.
  s.store.getState().setCurrentFilePath(newPath, revision);
  if (canonicalPath) documentPathIdentities.set(s.store, canonicalPath);
  if (unchanged && isLatest) s.store.getState().markSaved();
  return unchanged && isLatest;
}

function notifySaved(path: string | undefined, clean: boolean): void {
  if (!clean) {
    toast(t({
      ja: '保存開始後の変更は未保存のままです。もう一度保存してください。',
      en: 'Changes made after saving began are still unsaved. Save again.',
    }), { kind: 'info' });
    return;
  }
  toast(path
    ? t({ ja: `「${basename(path)}」に保存しました`, en: `Saved to “${basename(path)}”` })
    : t({ ja: '保存しました', en: 'Saved' }), { kind: 'success' });
}

function saveErrorMessage(error?: string): string | undefined {
  if (error?.startsWith('save-conflict:')) {
    return t({
      ja: '保存先がLayerLab以外で変更されています。内容を守るため上書きを中止しました。名前を付けて保存してください。',
      en: 'The file changed outside LayerLab. Save was stopped to protect it; use Save As.',
    });
  }
  return error;
}

async function performSave(
  store: DocStore,
  forceSaveAs: boolean,
  isLatest: () => boolean,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  await flushPendingEdits(store);
  const s = snapshot(store);
  const json = serializeProject(s.canvas, s.layers, s.selectedId, s.guides);
  let targetPath = s.path;
  let expectedRevision = s.revision;
  let reservationPath = targetPath;
  let reserved = false;

  if (forceSaveAs || !targetPath) {
    const chosen = await window.layerlab.chooseProjectSavePath(
      defaultName(s.canvas.width, s.canvas.height),
    );
    if (!chosen.success || !chosen.path) return { ok: false, error: chosen.error };
    targetPath = chosen.path;
    // The main process snapshots an existing target after the native overwrite
    // confirmation; null means this path was absent and must stay absent.
    expectedRevision = chosen.revision ?? null;
    reservationPath = chosen.canonicalPath ?? targetPath;
    if (!reservePath(store, reservationPath)) {
      return {
        ok: false,
        error: t({
          ja: 'そのファイルは別のLayerLabタブで開かれています。別名を選んでください。',
          en: 'That file is already owned by another LayerLab tab. Choose another name.',
        }),
      };
    }
    reserved = true;
  }

  try {
    const r = await window.layerlab.saveProject(targetPath, json, expectedRevision);
    if (!r.success) return { ok: false, error: saveErrorMessage(r.error) };
    const clean = finishSave(
      s,
      isLatest(),
      targetPath,
      r.revision ?? null,
      r.canonicalPath,
    );
    notifySaved(forceSaveAs || !s.path ? targetPath : undefined, clean);
    return { ok: true, path: targetPath };
  } finally {
    if (reserved && reservationPath) releasePath(store, reservationPath);
  }
}

export function saveCurrent(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const store = getActiveStore();
  return enqueueDocumentSave(store, (isLatest) => performSave(store, false, isLatest))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

export function saveCurrentAs(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const store = getActiveStore();
  return enqueueDocumentSave(store, (isLatest) => performSave(store, true, isLatest))
    .catch((error) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }));
}

export async function openProject(): Promise<{ ok: boolean; path?: string; error?: string }> {
  const r = await window.layerlab.openProject();
  if (!r.success || !r.path) {
    return { ok: false, error: r.error };
  }

  if (r.kind === 'project') {
    const existing = documentForPath(r.canonicalPath ?? r.path);
    if (existing) {
      workspaceStore.getState().setActive(existing.id);
      toast(t({
        ja: `「${basename(r.path)}」はすでに開いています`,
        en: `“${basename(r.path)}” is already open`,
      }), { kind: 'info' });
      return { ok: true, path: r.path };
    }
  }

  // 画像ファイル: 画像サイズの新規ドキュメントとして開く（Photoshop の File > Open 相当）
  if (r.kind === 'image' && r.dataUrl) {
    try {
      const dataUrl = r.dataUrl;
      const img = new window.Image();
      img.src = dataUrl;
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error(t({ ja: '画像の読み込みに失敗しました', en: 'Failed to load image' })));
      });
      const imageSize = validatePixelSize(img.naturalWidth, img.naturalHeight);
      if (!imageSize.ok) {
        throw new Error(t({
          ja: `画像 ${img.naturalWidth}×${img.naturalHeight}px は安全上限を超えています`,
          en: `Image ${img.naturalWidth}×${img.naturalHeight}px exceeds the safe limit`,
        }));
      }
      const layer = createImageLayer(dataUrl, img.naturalWidth, img.naturalHeight);
      layer.name = basename(r.path);
      openLoadedDoc(
        {
          canvas: {
            width: img.naturalWidth,
            height: img.naturalHeight,
            background: 'transparent',
          },
          layers: [layer],
          selectedId: layer.id,
          guides: [],
        },
        null,
        basename(r.path),
      );
      toast(t({ ja: `「${basename(r.path)}」を開きました`, en: `Opened “${basename(r.path)}”` }), { kind: 'success' });
      return { ok: true, path: r.path };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // PSD / PSB（main で事前検査したバイナリを renderer 側で ag-psd 解析）
  if (r.kind === 'psd' && r.psdBytes) {
    try {
      const buf = Uint8Array.from(r.psdBytes).buffer;
      applyPsdProject(buf, basename(r.path));
      return { ok: true, path: r.path };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // .llab プロジェクト
  if (!r.json) {
    return { ok: false, error: r.error ?? t({ ja: '対応していないファイルです', en: 'Unsupported file' }) };
  }
  try {
    const parsed = parseProject(r.json);
    openLoadedDoc(
      parsed,
      r.path,
      basename(r.path),
      r.revision ?? null,
      r.canonicalPath,
    );
    toast(t({ ja: `「${basename(r.path)}」を開きました`, en: `Opened “${basename(r.path)}”` }), { kind: 'success' });
    return { ok: true, path: r.path };
  } catch (e) {
    const msg = e instanceof LlabParseError ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** PSD の ArrayBuffer を新規ドキュメントとして読み込む（.llab とは別管理＝保存は .llab へ）。 */
function applyPsdProject(buf: ArrayBuffer, name: string): void {
  const proj = psdArrayBufferToProject(buf, name);
  openLoadedDoc(
    {
      canvas: proj.canvas,
      layers: proj.layers,
      selectedId: proj.selectedId,
      guides: [],
    },
    null,
    name,
  );
  toast(t({ ja: `「${name}」を読み込みました（${proj.layers.length}レイヤー）`, en: `Loaded “${name}” (${proj.layers.length} layers)` }), {
    kind: 'success',
  });
}

/** ドラッグ&ドロップやメニューから渡された PSD の File を読み込む。 */
export async function openPsdFile(
  file: File,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const header = await file.slice(0, PSD_HEADER_BYTES).arrayBuffer();
    const preflight = validatePsdHeader(header, file.size);
    if (!preflight.ok) throw new Error(psdPreflightMessage(preflight));
    const buf = await file.arrayBuffer();
    applyPsdProject(buf, file.name);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
