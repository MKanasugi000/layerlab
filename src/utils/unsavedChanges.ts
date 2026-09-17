interface DirtyDocumentLike {
  store: {
    getState: () => { dirty: boolean; pendingOperations?: number };
  };
}

export function hasUnsavedDocuments(documents: readonly DirtyDocumentLike[]): boolean {
  return documents.some((document) => {
    const state = document.store.getState();
    return state.dirty || (state.pendingOperations ?? 0) > 0;
  });
}
