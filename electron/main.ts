import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fontList from 'font-list';
import { RASTER_HEADER_READ_BYTES, inspectRasterHeader } from '../src/utils/rasterHeader';
import { validatePixelSize } from '../src/utils/canvasLimits';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
const ICON_PATH = path.join(process.env.APP_ROOT, 'build', 'icon.ico');

// PSD/PSB is decoded and then expanded again in the renderer. Keep the input
// deliberately below the app's canvas ceiling so a malformed header cannot
// allocate an unbounded surface before the parser gets a chance to reject it.
const MAX_PSD_FILE_BYTES = 128 * 1024 * 1024;
const MAX_PSD_DIMENSION = 8192;
const MAX_PSD_PIXELS = 32 * 1024 * 1024;

async function assertSafePsdFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error('PSD/PSB path is not a file');
  if (stat.size < 26) throw new Error('PSD/PSB header is incomplete');
  if (stat.size > MAX_PSD_FILE_BYTES) {
    throw new Error('PSD/PSB is too large (maximum 128 MB)');
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(26);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== header.length || header.toString('ascii', 0, 4) !== '8BPS') {
      throw new Error('Invalid PSD/PSB header');
    }
    const version = header.readUInt16BE(4);
    const height = header.readUInt32BE(14);
    const width = header.readUInt32BE(18);
    if (version !== 1 && version !== 2) throw new Error('Unsupported PSD/PSB version');
    if (
      width < 1 ||
      height < 1 ||
      width > MAX_PSD_DIMENSION ||
      height > MAX_PSD_DIMENSION ||
      width * height > MAX_PSD_PIXELS
    ) {
      throw new Error(
        `PSD/PSB canvas ${width} x ${height} exceeds the safe limit (8192 px / 32 MP)`,
      );
    }
  } finally {
    await handle.close();
  }
}

async function assertSafeRasterFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
    throw new Error('Image must be a file no larger than 64 MB');
  }
  const handle = await fs.open(filePath, 'r');
  try {
    const length = Math.min(stat.size, RASTER_HEADER_READ_BYTES);
    const bytes = new Uint8Array(length);
    const { bytesRead } = await handle.read(bytes, 0, length, 0);
    const buffer = bytes.buffer.slice(0, bytesRead);
    const header = inspectRasterHeader(buffer);
    if (!header) throw new Error('Unsupported or corrupt image header');
    if (!validatePixelSize(header.width, header.height).ok) {
      throw new Error(`Image dimensions are unsafe (${header.width} x ${header.height})`);
    }
  } finally {
    await handle.close();
  }
}

type ExpectedProjectRevision = string | null | undefined;

function hasFsErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function atomicWriteProject(
  filePath: string,
  json: string,
  expectedRevision: ExpectedProjectRevision,
): Promise<void> {
  if (Buffer.byteLength(json, 'utf8') > 128 * 1024 * 1024) {
    throw new Error('LayerLab project exceeds the 128 MB safety limit');
  }
  const resolved = path.resolve(filePath);
  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(json, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    // Re-check only after the slow temp write and fsync. The earlier queue check
    // avoids wasted work; this late check closes that large TOCTOU window.
    await assertExpectedProjectRevision(resolved, expectedRevision);
    if (expectedRevision === null) {
      // For a path that did not exist when Save As was confirmed, hard-linking
      // is an atomic no-clobber publish. A file created in the meantime wins.
      try {
        await fs.link(tempPath, resolved);
      } catch (error) {
        if (hasFsErrorCode(error, 'EEXIST')) {
          throw new Error('save-conflict:file-created-on-disk');
        }
        throw error;
      }
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      return;
    }
    // Same-directory rename is atomic: the previous project remains intact
    // until the fully flushed temporary file is ready to replace it.
    await fs.rename(tempPath, resolved);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function revisionIfPresent(filePath: string): Promise<string | null> {
  try {
    return await hashFile(filePath);
  } catch (error) {
    if (hasFsErrorCode(error, 'ENOENT')) return null;
    throw error;
  }
}

async function assertExpectedProjectRevision(
  filePath: string,
  expectedRevision: ExpectedProjectRevision,
): Promise<void> {
  if (expectedRevision === undefined) return;
  if (expectedRevision === null) {
    try {
      await fs.lstat(filePath);
    } catch (error) {
      if (hasFsErrorCode(error, 'ENOENT')) return;
      throw error;
    }
    throw new Error('save-conflict:file-created-on-disk');
  }

  let actual: string;
  try {
    actual = await hashFile(filePath);
  } catch {
    throw new Error('save-conflict:file-missing-or-replaced');
  }
  if (actual !== expectedRevision) {
    throw new Error('save-conflict:file-changed-on-disk');
  }
}

const projectWriteQueues = new Map<string, Promise<void>>();

async function canonicalPath(filePath: string): Promise<string> {
  const absolute = path.resolve(filePath);
  let resolved: string;
  try {
    resolved = await fs.realpath(absolute);
  } catch (error) {
    if (!hasFsErrorCode(error, 'ENOENT')) throw error;
    // A new Save As target cannot be realpathed yet. Walk to the nearest
    // existing ancestor so junction/symlink aliases still share one identity,
    // while permission and symlink-loop errors remain visible to the caller.
    const missingSegments: string[] = [];
    let ancestor = absolute;
    for (;;) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      missingSegments.unshift(path.basename(ancestor));
      ancestor = parent;
      try {
        const canonicalAncestor = await fs.realpath(ancestor);
        resolved = path.join(canonicalAncestor, ...missingSegments);
        break;
      } catch (ancestorError) {
        if (!hasFsErrorCode(ancestorError, 'ENOENT')) throw ancestorError;
      }
    }
  }
  resolved = path.normalize(resolved);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

async function queueProjectWrite(
  filePath: string,
  json: string,
  expectedRevision?: string | null,
): Promise<string> {
  const key = await canonicalPath(filePath);
  const previous = projectWriteQueues.get(key) ?? Promise.resolve();
  let revision = '';
  const write = previous.catch(() => undefined).then(async () => {
    await assertExpectedProjectRevision(filePath, expectedRevision);
    await atomicWriteProject(filePath, json, expectedRevision);
    revision = createHash('sha256').update(json, 'utf8').digest('hex');
  });
  const settled = write.then(() => undefined, () => undefined);
  projectWriteQueues.set(key, settled);
  try {
    await write;
    return revision;
  } finally {
    if (projectWriteQueues.get(key) === settled) projectWriteQueues.delete(key);
  }
}

async function atomicWriteBytes(
  filePath: string,
  bytes: Uint8Array,
  mode: 'replace' | 'no-clobber',
): Promise<void> {
  const resolved = path.resolve(filePath);
  const tempPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    if (mode === 'no-clobber') {
      // A same-volume hard link is atomic and fails with EEXIST without ever
      // exposing a partial final file.  The completed temp is then removed.
      await fs.link(tempPath, resolved);
      await fs.rm(tempPath, { force: true });
    } else {
      await fs.rename(tempPath, resolved);
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

let win: BrowserWindow | null = null;
let approvedExportDirectory: string | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// アプリ内に自前の日本語メニューバー（MenuBar.tsx）を持つため、
// Electron 既定のネイティブメニュー（File/Edit/View/Window/Help）を全廃する。
// これを残すと窓上部にメニューが二重表示される。
Menu.setApplicationMenu(null);

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: __LLAB_TRIAL__ ? 'LayerLab（お試し版）' : 'LayerLab',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Rendererのbeforeunloadが未保存タブを検知した時だけ確認する。
  // preventDefault() は「終了防止を解除して続行」の意味になる点に注意。
  win.webContents.on('will-prevent-unload', (event) => {
    if (!win) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['終了 / Exit', 'キャンセル / Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: 'LayerLab',
      message: '未保存の変更があります / There are unsaved changes',
      detail: '保存せずにLayerLabを終了しますか？\nClose LayerLab without saving?',
    });
    if (choice === 0) event.preventDefault();
  });

  // DevTools shortcuts must never ship: Ctrl+Shift+I is Photoshop's Invert
  // Selection shortcut inside LayerLab.
  if (VITE_DEV_SERVER_URL) {
    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        win?.webContents.toggleDevTools();
      }
    });
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // Only execute the renderer bundled with this application build. Renderer
    // updates need a signed app release; a hash from the same remote host is not
    // an authenticity boundary.
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

ipcMain.handle('fonts:list', async () => {
  const fonts = await fontList.getFonts({ disableQuoting: true });
  return fonts;
});

ipcMain.handle(
  'image:save',
  async (
    _e,
    defaultName: string,
    bytes: Uint8Array,
    format: 'png' | 'jpg',
  ): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!win) return { success: false, error: 'no window' };
      const result = await dialog.showSaveDialog(win, {
        title: '画像を書き出し',
        defaultPath: defaultName,
        filters: [
          {
            name: format === 'png' ? 'PNG' : 'JPEG',
            extensions: [format === 'png' ? 'png' : 'jpg'],
          },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' };
      }
      await atomicWriteBytes(result.filePath, bytes, 'replace');
      return { success: true, path: result.filePath };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  'project:save',
  async (
    _e,
    filePath: string,
    json: string,
    expectedRevision?: string | null,
  ): Promise<{
    success: boolean;
    path?: string;
    canonicalPath?: string;
    revision?: string;
    error?: string;
  }> => {
    try {
      const revision = await queueProjectWrite(filePath, json, expectedRevision);
      return {
        success: true,
        path: filePath,
        canonicalPath: await canonicalPath(filePath),
        revision,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  'project:chooseSavePath',
  async (
    _e,
    defaultName: string,
  ): Promise<{
    success: boolean;
    path?: string;
    canonicalPath?: string;
    revision?: string | null;
    error?: string;
  }> => {
    try {
      if (!win) return { success: false, error: 'no window' };
      const result = await dialog.showSaveDialog(win, {
        title: 'プロジェクトを保存',
        defaultPath: defaultName,
        filters: [{ name: 'LayerLab Project', extensions: ['llab'] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: 'cancelled' };
      }
      return {
        success: true,
        path: result.filePath,
        canonicalPath: await canonicalPath(result.filePath),
        // Existing targets were explicitly confirmed by the native Save As
        // dialog. Capture that exact version so later external edits conflict;
        // null means the target must remain absent until atomic publication.
        revision: await revisionIfPresent(result.filePath),
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  'folder:choose',
  async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!win) return { success: false, error: 'no window' };
      approvedExportDirectory = null;
      const result = await dialog.showOpenDialog(win, {
        title: '保存先フォルダを選択',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' };
      }
      approvedExportDirectory = path.resolve(result.filePaths[0]);
      return { success: true, path: approvedExportDirectory };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  'file:writeBytes',
  async (
    _e,
    filePath: string,
    bytes: Uint8Array,
  ): Promise<{ success: boolean; path?: string; error?: string }> => {
    try {
      if (!approvedExportDirectory) return { success: false, error: 'folder-not-approved' };
      const target = path.resolve(filePath);
      if (path.dirname(target) !== approvedExportDirectory) {
        return { success: false, error: 'path-outside-approved-folder' };
      }
      if (bytes.byteLength > 256 * 1024 * 1024) {
        return { success: false, error: 'file-too-large' };
      }
      // Batch export never destroys an existing asset. Re-running the same job
      // reports a skip and leaves the previous file intact.
      await atomicWriteBytes(target, bytes, 'no-clobber');
      return { success: true, path: target };
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') {
        return { success: false, error: 'exists' };
      }
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

ipcMain.handle(
  'project:open',
  async (): Promise<{
    success: boolean;
    path?: string;
    json?: string;
    dataUrl?: string;
    psdBytes?: Uint8Array;
    kind?: 'project' | 'image' | 'psd';
    canonicalPath?: string;
    revision?: string;
    error?: string;
  }> => {
    try {
      if (!win) return { success: false, error: 'no window' };
      const imageExts = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];
      const psdExts = ['psd', 'psb'];
      const result = await dialog.showOpenDialog(win, {
        title: 'ファイルを開く',
        properties: ['openFile'],
        filters: [
          { name: 'LayerLab / 画像 / PSD', extensions: ['llab', ...imageExts, ...psdExts] },
          { name: 'LayerLab Project', extensions: ['llab'] },
          { name: 'Photoshop (PSD/PSB)', extensions: psdExts },
          { name: '画像', extensions: imageExts },
          { name: 'すべてのファイル', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'cancelled' };
      }
      const filePath = result.filePaths[0];
      const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
      if (ext === 'llab') {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > 128 * 1024 * 1024) {
          return { success: false, error: 'LayerLab project must be a file no larger than 128 MB' };
        }
        const bytes = await fs.readFile(filePath);
        const json = bytes.toString('utf8');
        const revision = createHash('sha256').update(bytes).digest('hex');
        return {
          success: true,
          path: filePath,
          canonicalPath: await canonicalPath(filePath),
          kind: 'project',
          json,
          revision,
        };
      }
      if (psdExts.includes(ext)) {
        await assertSafePsdFile(filePath);
        const buf = await fs.readFile(filePath);
        return {
          success: true,
          path: filePath,
          kind: 'psd',
          // Keep the payload binary. Base64 would add 33% immediately and then
          // duplicate it again as a JS string while decoding in the renderer.
          psdBytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        };
      }
      if (imageExts.includes(ext)) {
        await assertSafeRasterFile(filePath);
        const buf = await fs.readFile(filePath);
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'bmp'
                ? 'image/bmp'
                : ext === 'gif'
                  ? 'image/gif'
                  : 'image/jpeg';
        const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
        return { success: true, path: filePath, kind: 'image', dataUrl };
      }
      return {
        success: false,
        error: `対応していない形式です: .${ext}（.llab / png / jpg / webp / bmp / gif / psd / psb）`,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
);

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
