import { getActiveStore, workspaceStore } from '../store/editorStore';
import { t } from '../i18n/locale';
import { blobToImageLayer } from './imageImport';

const SUPPORTED_CLIPBOARD_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

export async function pasteFromClipboard(): Promise<{ ok: boolean; error?: string }> {
  if (!navigator.clipboard || !('read' in navigator.clipboard)) {
    return { ok: false, error: t({ ja: 'Clipboard API 未対応', en: 'Clipboard API not supported' }) };
  }
  // Clipboard reads and image decoding are asynchronous. Keep the initiating
  // document as the destination even if the user switches tabs meanwhile.
  const targetStore = getActiveStore();
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => SUPPORTED_CLIPBOARD_IMAGE_TYPES.has(type.toLowerCase()));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const layer = await blobToImageLayer(blob, `Clipboard ${new Date().toLocaleTimeString()}`);
      if (!workspaceStore.getState().docs.some((doc) => doc.store === targetStore)) {
        return { ok: false, error: t({ ja: '貼り付け先の文書は閉じられました', en: 'The paste destination was closed' }) };
      }
      const canvas = targetStore.getState().canvas;
      layer.x = Math.max(0, (canvas.width - layer.naturalWidth) / 2);
      layer.y = Math.max(0, (canvas.height - layer.naturalHeight) / 2);
      if (!targetStore.getState().addLayer(layer)) {
        return { ok: false, error: t({ ja: '画像レイヤーの総サイズが安全上限を超えます', en: 'Total raster layers would exceed the safety limit' }) };
      }
      return { ok: true };
    }
    return { ok: false, error: t({ ja: 'クリップボードに画像なし', en: 'No image in clipboard' }) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
