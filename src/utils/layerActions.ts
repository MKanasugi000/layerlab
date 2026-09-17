import { useEditorStore, undo, createImageLayer } from '../store/editorStore';
import { toast } from '../store/toastStore';
import { t } from '../i18n/locale';
import { rasterizeLayers } from './selectionOps';
import { layerBlocksContainLock } from '../interactions/layerLockPolicy';

function commandContainsLockedLayer(
  layers: ReturnType<typeof useEditorStore.getState>['layers'],
  ids: readonly string[],
): boolean {
  return layerBlocksContainLock(layers, ids);
}

function lockedCommandToast(): void {
  toast(t({
    ja: 'ロックされたレイヤーまたはグループは変更できません',
    en: 'Locked layers or groups cannot be modified',
  }), { kind: 'info' });
}

/**
 * 空の透明ラスターレイヤー（キャンバス等寸）を新規追加する。
 * Photoshop の「新規レイヤー」に相当。ブラシ／塗りつぶしの下地として使える
 * （原点・未変形・キャンバス等寸なのでブラシの加筆対象条件も満たす）。
 */
export function addBlankLayer() {
  const st = useEditorStore.getState();
  const { width, height } = st.canvas;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const layer = createImageLayer(c.toDataURL('image/png'), width, height);
  // 「レイヤー 1, 2, 3…」と連番で命名（Photoshop風）
  const base = t({ ja: 'レイヤー', en: 'Layer' });
  const n = st.layers.filter((l) => l.name === base || l.name.startsWith(base + ' ')).length + 1;
  layer.name = `${base} ${n}`;
  st.addLayer(layer);
}

/**
 * レイヤーを削除し、「元に戻す」付きトーストを出す。
 * 破壊操作を確認ダイアログでなく Undo で救う寛容な設計。
 * 根拠: Norman のエラー予防 / User Control and Freedom / ピークエンドの法則。
 */
export function deleteLayer(id: string) {
  const st = useEditorStore.getState();
  const layer = st.layers.find((l) => l.id === id);
  if (!layer) return;
  if (commandContainsLockedLayer(st.layers, [id])) {
    lockedCommandToast();
    return;
  }
  const name = layer.name || t({ ja: 'レイヤー', en: 'Layer' });
  st.removeLayer(id);
  toast(t({ ja: `「${name}」を削除しました`, en: `Deleted "${name}"` }), {
    action: { label: t({ ja: '元に戻す', en: 'Undo' }), run: () => undo() },
  });
}

/**
 * A command invoked on a member of the current multi-selection applies to the
 * whole selection, matching Photoshop's Layers panel and canvas commands.
 */
export function selectedLayerIdsForCommand(preferredId?: string): string[] {
  const st = useEditorStore.getState();
  if (preferredId && !st.selectedIds.includes(preferredId)) return [preferredId];
  if (st.selectedIds.length > 0) return [...st.selectedIds];
  return preferredId ? [preferredId] : st.selectedId ? [st.selectedId] : [];
}

export function duplicateSelectedLayers(preferredId?: string) {
  const st = useEditorStore.getState();
  const ids = selectedLayerIdsForCommand(preferredId);
  if (ids.length === 0) return;
  if (commandContainsLockedLayer(st.layers, ids)) {
    lockedCommandToast();
    return;
  }
  st.duplicateLayers(ids);
}

export function deleteSelectedLayers(preferredId?: string) {
  const st = useEditorStore.getState();
  const ids = selectedLayerIdsForCommand(preferredId);
  if (ids.length === 0) return;
  const layers = ids
    .map((id) => st.layers.find((layer) => layer.id === id))
    .filter((layer) => layer != null);
  if (layers.length === 0) return;
  if (commandContainsLockedLayer(st.layers, ids)) {
    lockedCommandToast();
    return;
  }
  st.removeLayers(ids);
  const message = layers.length === 1
    ? t({ ja: `「${layers[0].name || 'レイヤー'}」を削除しました`, en: `Deleted "${layers[0].name || 'Layer'}"` })
    : t({ ja: `${layers.length}個のレイヤーを削除しました`, en: `Deleted ${layers.length} layers` });
  toast(message, {
    action: { label: t({ ja: '元に戻す', en: 'Undo' }), run: () => undo() },
  });
}

/**
 * 選択中の複数レイヤーを1枚のラスターレイヤーに統合する（Photoshop「レイヤーを結合」相当）。
 * 焼き込んだ見た目(不透明度/描画モード/効果)を保った1枚に置き換え、統合前へ戻せるよう
 * Undo付きトーストを出す。選択にグループが含まれる場合はその子孫レイヤーも統合対象に含める。
 */
export function mergeSelectedLayers() {
  const st = useEditorStore.getState();
  const selIds = st.selectedIds;
  if (selIds.length < 2) {
    toast(t({ ja: '2枚以上のレイヤーを選択してください', en: 'Select 2 or more layers to merge' }), {
      kind: 'info',
    });
    return;
  }

  // 統合対象 = 選択レイヤー ＋ （選択されたグループの子孫）
  const removeSet = new Set(selIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const l of st.layers) {
      if (!removeSet.has(l.id) && l.parentId && removeSet.has(l.parentId)) {
        removeSet.add(l.id);
        changed = true;
      }
    }
  }
  if (commandContainsLockedLayer(st.layers, [...removeSet])) {
    lockedCommandToast();
    return;
  }

  // 実際に描画されるのはグループ以外（グループは箱なのでピクセルを持たない）
  const renderIds = [...removeSet].filter((id) => {
    const l = st.layers.find((x) => x.id === id);
    return l != null && l.type !== 'group';
  });
  if (renderIds.length === 0) {
    toast(t({ ja: '統合できるレイヤーがありません', en: 'No layers to merge' }), { kind: 'info' });
    return;
  }

  const canvas = rasterizeLayers(renderIds);
  if (!canvas) {
    toast(t({ ja: 'レイヤーの統合に失敗しました', en: 'Failed to merge layers' }), { kind: 'error' });
    return;
  }
  const { width, height } = st.canvas;
  const src = canvas.toDataURL('image/png');

  // 統合レイヤー名 = 最前面(配列先頭寄り)の選択レイヤー名（Photoshop準拠）
  const frontIdx = Math.min(
    ...selIds.map((id) => st.layers.findIndex((l) => l.id === id)).filter((i) => i >= 0),
  );
  const name = st.layers[frontIdx]?.name ?? t({ ja: '統合レイヤー', en: 'Merged' });

  st.mergeLayers([...removeSet], src, width, height, name);
  toast(t({ ja: 'レイヤーを統合しました', en: 'Merged layers' }), {
    action: { label: t({ ja: '元に戻す', en: 'Undo' }), run: () => undo() },
  });
}
