import type { Tool } from '../types';

interface ToolStore {
  getState: () => { tool: Tool; setTool: (tool: Tool) => void };
}

/** A temporary tool belongs to the document where the key was pressed. */
export function createTemporaryHandController() {
  let active: { store: ToolStore; previous: Tool } | null = null;
  const release = () => {
    const pending = active;
    active = null;
    // A deliberate tool choice made while Space was held takes precedence.
    if (pending?.store.getState().tool === 'hand') {
      pending.store.getState().setTool(pending.previous);
    }
  };
  return {
    begin(store: ToolStore) {
      if (active?.store === store) return;
      release();
      const state = store.getState();
      if (state.tool === 'hand') return;
      active = { store, previous: state.tool };
      state.setTool('hand');
    },
    release,
  };
}
