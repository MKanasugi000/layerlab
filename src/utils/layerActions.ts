import { useEditorStore, undo, createImageLayer, getActiveStore } from '../store/editorStore';
import { toast } from '../store/toastStore';
import { t } from '../i18n/locale';
import { rasterizeLayers } from './selectionOps';
import { layerBlocksContainLock } from '../interactions/layerLockPolicy';
import { planSafeMerge, type MergeRejection } from '../interactions/mergePolicy';

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
  // Keep the command attached to the document where it was invoked.
  const owner = getActiveStore();
  const st = owner.getState();
  const plan = planSafeMerge(st.layers, st.selectedIds);
  if (!plan.ok) {
    mergeRejectedToast(plan.reason);
    return;
  }
  if (commandContainsLockedLayer(st.layers, plan.removeIds)) {
    lockedCommandToast();
    return;
  }

  let src: string;
  try {
    const canvas = rasterizeLayers(plan.renderIds);
    if (!canvas) throw new Error('No rendered canvas');
    src = canvas.toDataURL('image/png');
  } catch {
    // rasterizeLayers also restores Konva visibility in its finally block.
    toast(t({ ja: 'レイヤーの統合に失敗しました', en: 'Failed to merge layers' }), { kind: 'error' });
    return;
  }
  const { width, height } = st.canvas;

  // 統合レイヤー名 = 最前面(配列先頭寄り)の選択レイヤー名（Photoshop準拠）
  const frontIdx = Math.min(
    ...plan.rootIds.map((id) => st.layers.findIndex((l) => l.id === id)).filter((i) => i >= 0),
  );
  const name = st.layers[frontIdx]?.name ?? t({ ja: '統合レイヤー', en: 'Merged' });

  if (!st.mergeLayers(plan.removeIds, src, width, height, name)) {
    toast(t({ ja: 'レイヤーの統合に失敗しました', en: 'Failed to merge layers' }), { kind: 'error' });
    return;
  }
  toast(t({ ja: 'レイヤーを統合しました', en: 'Merged layers' }), {
    action: { label: t({ ja: '元に戻す', en: 'Undo' }), run: () => undo() },
  });
}

function mergeRejectedToast(reason: MergeRejection): void {
  const messages: Record<MergeRejection, { ja: string; en: string }> = {
    'not-enough-layers': {
      ja: '統合するには、同じ階層の表示中レイヤーを2枚以上選択してください',
      en: 'Select at least two visible sibling layers to merge',
    },
    'mixed-parents': {
      ja: '同じグループ内のレイヤーだけを統合してください',
      en: 'Merge only layers in the same group',
    },
    'non-contiguous': {
      ja: '連続した兄弟レイヤーを選択してください',
      en: 'Select one contiguous block of sibling layers',
    },
    hidden: {
      ja: '非表示の選択レイヤーまたはグループ内容を表示してから統合してください',
      en: 'Show every selected layer and group member before merging',
    },
    'ancestor-state': {
      ja: '半透明または非表示の親グループ内では統合できません。グループ全体を選択するか、親を表示して不透明度を100%にしてください',
      en: 'Cannot merge inside a translucent or hidden group. Select the whole group, or make its parent visible and fully opaque',
    },
    'blend-mode': {
      ja: '描画モードが「通常」のレイヤーだけを統合できます',
      en: 'Only Normal (source-over) layers can be merged',
    },
    clipping: {
      ja: 'クリッピング関係を保つため、クリップしたレイヤーとベースを両方選択するかクリッピングを解除してください',
      en: 'To preserve clipping, select both the clipped layer and its base, or release clipping first',
    },
    'invalid-tree': {
      ja: 'グループ構造を確認してから統合してください',
      en: 'Check the group structure before merging',
    },
  };
  toast(t(messages[reason]), { kind: 'info' });
}
