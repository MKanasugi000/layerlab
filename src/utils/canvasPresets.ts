import type { SizePreset } from '../types';
import { getLocale } from '../i18n/locale';

export const CANVAS_PRESETS: SizePreset[] = [
  { id: 'yt-thumb', label: 'YouTube サムネ', labelEn: 'YouTube Thumbnail', category: 'banner', width: 1280, height: 720 },
  { id: 'x-banner', label: 'X ヘッダー', labelEn: 'X Header', category: 'banner', width: 1500, height: 500 },
  { id: 'x-post', label: 'X 投稿画像', labelEn: 'X Post Image', category: 'social', width: 1600, height: 900 },
  { id: 'insta-square', label: 'Instagram 正方形', labelEn: 'Instagram Square', category: 'social', width: 1080, height: 1080 },
  { id: 'insta-story', label: 'Instagram ストーリー', labelEn: 'Instagram Story', category: 'social', width: 1080, height: 1920 },
  { id: 'note-cover', label: 'note カバー', labelEn: 'note Cover', category: 'banner', width: 1280, height: 670 },
  { id: 'unity-256', label: 'Unity 256²', labelEn: 'Unity 256²', category: 'unity', width: 256, height: 256 },
  { id: 'unity-512', label: 'Unity 512²', labelEn: 'Unity 512²', category: 'unity', width: 512, height: 512 },
  { id: 'unity-1024', label: 'Unity 1024²', labelEn: 'Unity 1024²', category: 'unity', width: 1024, height: 1024 },
  { id: 'unity-2048', label: 'Unity 2048²', labelEn: 'Unity 2048²', category: 'unity', width: 2048, height: 2048 },
  { id: 'unity-4096', label: 'Unity 4096²', labelEn: 'Unity 4096²', category: 'unity', width: 4096, height: 4096 },
];

/** 現在の locale に応じたプリセット表示名。呼び出し側（描画中）が locale を購読していれば再描画で追従する。 */
export function presetLabel(p: SizePreset): string {
  return getLocale() === 'ja' ? p.label : p.labelEn ?? p.label;
}
