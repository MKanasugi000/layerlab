import type { Layer, LayerId } from '../types';

/** Build a cycle-safe lock checker so group locks protect all descendants. */
export function createLayerLockChecker(layers: readonly Layer[]): (id: LayerId) => boolean {
  const byId = new Map(layers.map((layer) => [layer.id, layer] as const));
  return (id: LayerId): boolean => {
    let current: LayerId | null = id;
    const visited = new Set<LayerId>();
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      const layer = byId.get(current);
      if (!layer) return false;
      if (layer.locked) return true;
      current = layer.parentId ?? null;
    }
    return false;
  };
}

export function isLayerEffectivelyLocked(layers: readonly Layer[], id: LayerId): boolean {
  return createLayerLockChecker(layers)(id);
}

/** A structural edit of a group also edits the parent relationship of every descendant. */
export function layerBlocksContainLock(
  layers: readonly Layer[],
  ids: readonly LayerId[],
): boolean {
  const isLocked = createLayerLockChecker(layers);
  const byParent = new Map<LayerId, Layer[]>();
  for (const layer of layers) {
    if (!layer.parentId) continue;
    const children = byParent.get(layer.parentId) ?? [];
    children.push(layer);
    byParent.set(layer.parentId, children);
  }
  const pending = [...ids];
  const visited = new Set<LayerId>();
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (isLocked(id)) return true;
    const layer = layers.find((candidate) => candidate.id === id);
    if (layer?.type === 'group') {
      for (const child of byParent.get(id) ?? []) pending.push(child.id);
    }
  }
  return false;
}
