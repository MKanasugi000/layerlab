import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { IS_TRIAL } from './utils/trial';
import { t } from './i18n/locale';
import { workspaceStore } from './store/editorStore';
import { hasUnsavedDocuments } from './utils/unsavedChanges';
import './fonts/loadBundledFonts';
import './index.css';

// お試し版は窓タイトルにも明示（index.html の <title> を上書き）。
if (IS_TRIAL) document.title = t({ ja: 'LayerLab（お試し版）', en: 'LayerLab (Trial)' });

// BrowserWindow close, Alt+F4, reload and OS shutdown must not silently discard
// any dirty tab. Electron's main process turns this cancellation into a native
// confirmation dialog; a normal browser shows its standard leave-page prompt.
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedDocuments(workspaceStore.getState().docs)) return;
  event.preventDefault();
  event.returnValue = '';
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
