import { contextBridge, ipcRenderer } from 'electron';

type SaveResult = {
  success: boolean;
  path?: string;
  canonicalPath?: string;
  revision?: string | null;
  error?: string;
};
type OpenResult = {
  success: boolean;
  path?: string;
  json?: string;
  dataUrl?: string;
  psdBytes?: Uint8Array;
  kind?: 'project' | 'image' | 'psd';
  canonicalPath?: string;
  revision?: string;
  error?: string;
};

contextBridge.exposeInMainWorld('layerlab', {
  listFonts: (): Promise<string[]> => ipcRenderer.invoke('fonts:list'),
  saveImage: (
    defaultName: string,
    bytes: Uint8Array,
    format: 'png' | 'jpg',
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('image:save', defaultName, bytes, format),
  saveProject: (
    filePath: string,
    json: string,
    expectedRevision?: string | null,
  ): Promise<SaveResult> =>
    ipcRenderer.invoke('project:save', filePath, json, expectedRevision),
  chooseProjectSavePath: (defaultName: string): Promise<SaveResult> =>
    ipcRenderer.invoke('project:chooseSavePath', defaultName),
  openProject: (): Promise<OpenResult> => ipcRenderer.invoke('project:open'),
  chooseFolder: (): Promise<SaveResult> => ipcRenderer.invoke('folder:choose'),
  writeBytes: (filePath: string, bytes: Uint8Array): Promise<SaveResult> =>
    ipcRenderer.invoke('file:writeBytes', filePath, bytes),
});

declare global {
  interface Window {
    layerlab: {
      listFonts: () => Promise<string[]>;
      saveImage: (
        defaultName: string,
        bytes: Uint8Array,
        format: 'png' | 'jpg',
      ) => Promise<SaveResult>;
      saveProject: (
        filePath: string,
        json: string,
        expectedRevision?: string | null,
      ) => Promise<SaveResult>;
      chooseProjectSavePath: (defaultName: string) => Promise<SaveResult>;
      openProject: () => Promise<OpenResult>;
      chooseFolder: () => Promise<SaveResult>;
      writeBytes: (filePath: string, bytes: Uint8Array) => Promise<SaveResult>;
    };
  }
}
