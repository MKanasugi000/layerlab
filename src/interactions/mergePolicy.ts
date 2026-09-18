import type { Layer, LayerId } from '../types';

export type MergeRejection =
  | 'not-enough-layers'
  | 'mixed-parents'
  | 'non-contiguous'
  | 'hidden'
  | 'ancestor-state'
  | 'blend-mode'
  | 'clipping'
  | 'invalid-tree';

export type MergePlan =
  | {
    ok: true;
    /** Selected roots after descendants of a selected group have been removed. */
    rootIds: LayerId[];
    /** Every selected root and all of its descendants. */
    removeIds: LayerId[];
    /** Non-group layers that Konva must rasterize. */
    renderIds: LayerId[];
  }
  | { ok: false; reason: MergeRejection };

/**
 * Produces only merges whose rasterized pixels can replace the removed block
 * without changing an outside layer's clipping relationship or applying an
 * ancestor opacity a second time.  This deliberately rejects blend modes:
 * their result depends on pixels outside the merged block.
 */
export function planSafeMerge(layers: readonly Layer[], selectedIds: readonly LayerId[]): MergePlan {
  const byId = new Map(layers.map((layer) => [layer.id, layer] as const));
  const requested = new Set(selectedIds.filter((id) => byId.has(id)));
  if (requested.size === 0) return { ok: false, reason: 'not-enough-layers' };

  const hasRequestedAncestor = (id: LayerId): boolean => {
    const visited = new Set<LayerId>();
    let parentId = byId.get(id)?.parentId ?? null;
    while (parentId) {
      if (visited.has(parentId)) return false;
      visited.add(parentId);
      if (requested.has(parentId)) return true;
      const parent = byId.get(parentId);
      if (!parent) return false;
      parentId = parent.parentId ?? null;
    }
    return false;
  };

  const rootIds = layers
    .filter((layer) => requested.has(layer.id) && !hasRequestedAncestor(layer.id))
    .map((layer) => layer.id);
  if (rootIds.length === 0) return { ok: false, reason: 'not-enough-layers' };

  const rootParent = byId.get(rootIds[0])?.parentId ?? null;
  if (!rootIds.every((id) => (byId.get(id)?.parentId ?? null) === rootParent)) {
    return { ok: false, reason: 'mixed-parents' };
  }

  // A merged image is inserted at the first selected root, so the roots must
  // occupy one direct-sibling block.  Pre-order descendants do not affect this.
  const siblings = layers.filter((layer) => (layer.parentId ?? null) === rootParent);
  const selectedSiblingIndexes = rootIds.map((id) => siblings.findIndex((layer) => layer.id === id));
  const firstSiblingIndex = Math.min(...selectedSiblingIndexes);
  const lastSiblingIndex = Math.max(...selectedSiblingIndexes);
  if (lastSiblingIndex - firstSiblingIndex + 1 !== rootIds.length) {
    return { ok: false, reason: 'non-contiguous' };
  }

  const remove = new Set(rootIds);
  for (const layer of layers) {
    const ancestors = new Set<LayerId>();
    let parentId = layer.parentId ?? null;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      if (remove.has(parentId)) {
        remove.add(layer.id);
        break;
      }
      const parent = byId.get(parentId);
      if (!parent) return { ok: false, reason: 'invalid-tree' };
      parentId = parent.parentId ?? null;
    }
  }

  // Hidden members are not baked by the stage.  Removing one would destroy
  // pixels that were intentionally absent from the raster result.
  for (const id of remove) {
    if (!byId.get(id)?.visible) return { ok: false, reason: 'hidden' };
  }

  // The new image remains under only the roots' common parent.  Any surviving
  // ancestor opacity/visibility would be applied after the stage already baked
  // it, so that structure is only safe when it is visually neutral.
  const ancestorVisited = new Set<LayerId>();
  let ancestorId = rootParent;
  while (ancestorId) {
    if (ancestorVisited.has(ancestorId)) return { ok: false, reason: 'invalid-tree' };
    ancestorVisited.add(ancestorId);
    const ancestor = byId.get(ancestorId);
    if (!ancestor) return { ok: false, reason: 'invalid-tree' };
    if (!ancestor.visible || ancestor.opacity !== 1) return { ok: false, reason: 'ancestor-state' };
    ancestorId = ancestor.parentId ?? null;
  }

  const renderIds = layers
    .filter((layer) => remove.has(layer.id) && layer.type !== 'group')
    .map((layer) => layer.id);
  if (renderIds.length < 2) return { ok: false, reason: 'not-enough-layers' };
  if (renderIds.some((id) => byId.get(id)?.blendMode !== 'source-over')) {
    return { ok: false, reason: 'blend-mode' };
  }

  // A clipped layer and its immediate base are inseparable.  If just one is
  // removed, the replacement would alter clipping for a layer outside merge.
  for (let index = 0; index < layers.length; index += 1) {
    const clipped = layers[index];
    if (!clipped.clipped) continue;
    const base = layers[index + 1];
    if (!base || (base.parentId ?? null) !== (clipped.parentId ?? null)) {
      return { ok: false, reason: 'clipping' };
    }
    if (remove.has(clipped.id) !== remove.has(base.id)) return { ok: false, reason: 'clipping' };
  }

  return { ok: true, rootIds, removeIds: layers.filter((layer) => remove.has(layer.id)).map((layer) => layer.id), renderIds };
}
