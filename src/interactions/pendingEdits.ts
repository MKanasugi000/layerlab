/**
 * Small document-local transaction registry.
 *
 * React editors such as the in-place text box keep a draft outside Zustand,
 * while raster operations finish asynchronously.  Saving or switching tabs
 * must flush those operations before taking a project snapshot.
 */
export interface PendingEditStore {
  getState: () => { pendingOperations: number };
  setState: (partial: { pendingOperations: number }) => void;
}

interface PendingSyncEdit {
  flush: () => void;
  discard?: () => void;
}

const syncEdits = new WeakMap<object, Map<string, PendingSyncEdit>>();
const asyncEdits = new WeakMap<object, Set<Promise<unknown>>>();
const asyncFailures = new WeakMap<object, unknown[]>();

function setPendingCount(store: PendingEditStore, delta: number): void {
  const current = store.getState().pendingOperations;
  store.setState({ pendingOperations: Math.max(0, current + delta) });
}

export function registerPendingSyncEdit(
  store: PendingEditStore,
  key: string,
  edit: PendingSyncEdit,
): void {
  let edits = syncEdits.get(store as object);
  if (!edits) {
    edits = new Map();
    syncEdits.set(store as object, edits);
  }
  const isNew = !edits.has(key);
  edits.set(key, edit);
  if (isNew) setPendingCount(store, 1);
}

export function clearPendingSyncEdit(store: PendingEditStore, key: string): void {
  const edits = syncEdits.get(store as object);
  if (!edits?.delete(key)) return;
  if (edits.size === 0) syncEdits.delete(store as object);
  setPendingCount(store, -1);
}

export function flushPendingSyncEdits(store: PendingEditStore): void {
  const edits = syncEdits.get(store as object);
  if (!edits?.size) return;
  const queued = [...edits.values()];
  syncEdits.delete(store as object);
  setPendingCount(store, -queued.length);
  for (const edit of queued) edit.flush();
}

export function discardPendingSyncEdits(store: PendingEditStore): void {
  const edits = syncEdits.get(store as object);
  if (!edits?.size) return;
  const queued = [...edits.values()];
  syncEdits.delete(store as object);
  setPendingCount(store, -queued.length);
  for (const edit of queued) edit.discard?.();
}

export function trackPendingAsyncEdit<T>(
  store: PendingEditStore,
  task: Promise<T>,
): Promise<T> {
  let edits = asyncEdits.get(store as object);
  if (!edits) {
    edits = new Set();
    asyncEdits.set(store as object, edits);
  }
  setPendingCount(store, 1);
  const tracked = task.catch((error) => {
    const failures = asyncFailures.get(store as object) ?? [];
    failures.push(error);
    asyncFailures.set(store as object, failures);
    throw error;
  }).finally(() => {
    const current = asyncEdits.get(store as object);
    if (current?.delete(tracked)) setPendingCount(store, -1);
    if (current?.size === 0) asyncEdits.delete(store as object);
  });
  edits.add(tracked);
  return tracked;
}

/** Flush drafts and wait until operations queued by those drafts also settle. */
export async function flushPendingEdits(store: PendingEditStore): Promise<void> {
  flushPendingSyncEdits(store);
  for (;;) {
    const pending = [...(asyncEdits.get(store as object) ?? [])];
    if (pending.length === 0) break;
    await Promise.allSettled(pending);
  }
  const failures = asyncFailures.get(store as object);
  if (failures?.length) {
    asyncFailures.delete(store as object);
    const first = failures[0];
    throw new Error(
      first instanceof Error
        ? `Pending document operation failed: ${first.message}`
        : `Pending document operation failed: ${String(first)}`,
    );
  }
}

export function hasPendingEdits(store: PendingEditStore): boolean {
  return store.getState().pendingOperations > 0;
}
