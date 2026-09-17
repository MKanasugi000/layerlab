export interface SaveSnapshotRefs {
  canvas: unknown;
  layers: unknown;
  guides: unknown;
  path: string | null;
}

/** A completed write can mark clean only if no persisted branch changed in flight. */
export function savedSnapshotStillCurrent(
  snapshot: SaveSnapshotRefs,
  current: SaveSnapshotRefs,
): boolean {
  return current.canvas === snapshot.canvas
    && current.layers === snapshot.layers
    && current.guides === snapshot.guides
    && current.path === snapshot.path;
}
