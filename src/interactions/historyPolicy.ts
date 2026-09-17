interface EditorHistorySnapshot {
  canvas: unknown;
  layers: unknown;
  selection: unknown;
}

/**
 * Avoid serializing large base64 layer payloads when only UI focus or pixel
 * selection changed. Layer focus itself is excluded by partialize().
 */
export function editorHistoryEqual(
  previous: EditorHistorySnapshot,
  next: EditorHistorySnapshot,
): boolean {
  // Immer preserves references for unchanged branches. Once canvas/layers
  // differ this is a real document edit; serializing embedded data URLs here
  // would duplicate entire PSDs on every history comparison.
  return previous.canvas === next.canvas
    && previous.layers === next.layers
    && previous.selection === next.selection;
}

export function historyStackMoved(beforeLength: number, afterLength: number): boolean {
  return afterLength < beforeLength;
}

export const HISTORY_MEMORY_BUDGET_BYTES = 384 * 1024 * 1024;

/** Conservative estimate: count every retained string as UTF-16 and buffers by byteLength. */
export function estimateHistorySnapshotBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): number => {
    if (candidate == null) return 0;
    if (typeof candidate === 'string') return candidate.length * 2;
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return 8;
    if (typeof candidate !== 'object') return 0;
    if (ArrayBuffer.isView(candidate)) return candidate.byteLength;
    if (candidate instanceof ArrayBuffer) return candidate.byteLength;
    if (seen.has(candidate)) return 0;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      return candidate.reduce((total, item) => total + visit(item), 0);
    }
    let total = 0;
    for (const [key, item] of Object.entries(candidate as Record<string, unknown>)) {
      total += key.length * 2 + visit(item);
    }
    return total;
  };
  return visit(value);
}

/** Keep the newest undo states that fit in the supplied memory budget. */
export function trimHistoryStatesToBudget<T>(
  states: readonly T[],
  budgetBytes: number,
): T[] {
  const kept: T[] = [];
  let used = 0;
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const bytes = estimateHistorySnapshotBytes(states[index]);
    if (bytes > budgetBytes - used) break;
    kept.unshift(states[index]);
    used += bytes;
  }
  return kept;
}
