'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { SettingsStore, EngineManager, TelegramService, DownloadManager, UpdateService } = require('./services');

let win, settings, engines, telegram, downloads, updates;
const telegramPrompts = new Map();

function animateOpacity(window, from, to, duration, complete) {
  const startedAt = Date.now();
  window.setOpacity(from);
  const timer = setInterval(() => {
    if (window.isDestroyed()) return clearInterval(timer);
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = progress * progress * (3 - 2 * progress);
    window.setOpacity(from + (to - from) * eased);
    if (progress === 1) { clearInterval(timer); complete?.(); }
  }, 16);
}

function requestTelegramSecret(kind, message) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  win.webContents.send('telegram:prompt', { requestId, kind, message });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { telegramPrompts.delete(requestId); reject(new Error('La verificación de Telegram expiró.')); }, 180000);
    telegramPrompts.set(requestId, value => { clearTimeout(timer); resolve(value); });
  });
}

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1040, workArea.width - 40);
  const height = Math.min(980, workArea.height - 24);
  win = new BrowserWindow({
    width, height, minWidth: Math.min(780, width), minHeight: Math.min(640, height),
    show: false, opacity: 0, title: 'MB Downloader', backgroundColor: '#080b18',
    icon: path.join(__dirname, 'renderer', 'assets', 'mb-logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  let closing = false;
  win.once('ready-to-show', () => {
    win.center();
    win.show();
    win.webContents.send('app:animation', 'opening');
    animateOpacity(win, 0, 1, 460);
  });
  win.on('close', event => {
    if (closing || win.isDestroyed()) return;
    event.preventDefault();
    closing = true;
    win.webContents.send('app:animation', 'closing');
    animateOpacity(win, win.getOpacity(), 0, 340, () => win.destroy());
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('context-menu', (_, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const can = params.editFlags || {};
    const template = params.isEditable ? [
      { label: 'Deshacer', role: 'undo', enabled: Boolean(can.canUndo) },
      { label: 'Rehacer', role: 'redo', enabled: Boolean(can.canRedo) },
      { type: 'separator' },
      { label: 'Cortar', role: 'cut', enabled: Boolean(can.canCut) },
      { label: 'Copiar', role: 'copy', enabled: Boolean(can.canCopy) },
      { label: 'Pegar', role: 'paste', enabled: Boolean(can.canPaste) },
      { label: 'Eliminar', role: 'delete', enabled: Boolean(can.canDelete) },
      { type: 'separator' },
      { label: 'Seleccionar todo', role: 'selectAll', enabled: Boolean(can.canSelectAll) }
    ] : [{ label: 'Copiar', role: 'copy', enabled: Boolean(params.selectionText) }];
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.luis.mbdownloader');
  Menu.setApplicationMenu(null);
  settings = new SettingsStore(); engines = new EngineManager(); updates = new UpdateService();
  const notify = (channel, payload) => win?.webContents.send(channel, payload);
  telegram = new TelegramService(notify, requestTelegramSecret);
  downloads = new DownloadManager(engines, telegram, notify);
  createWindow();
  win.webContents.once('did-finish-load', () => telegram.restore());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', error => { console.error('Error no controlado:', error); win?.webContents.send('telegram:event', { type: 'error', message: `Telegram encontró un error: ${error.message}` }); });
process.on('unhandledRejection', error => { console.error('Promesa no controlada:', error); win?.webContents.send('telegram:event', { type: 'error', message: `Operación incompleta: ${error?.message || error}` }); });

ipcMain.handle('settings:get', () => settings.get());
ipcMain.handle('settings:save', (_, next) => settings.save(next));
ipcMain.handle('dialog:destination', async () => (await dialog.showOpenDialog(win, { properties: ['openDirectory'] })).filePaths[0] || null);
ipcMain.handle('engine:status', () => engines.status());
ipcMain.handle('engine:update', () => engines.updateAll());
ipcMain.handle('engine:repair', () => engines.repairFfmpeg());
ipcMain.handle('media:metadata', (_, url, cookies) => downloads.metadata(url, cookies));
ipcMain.handle('download:start', (_, job) => downloads.start(job));
ipcMain.handle('download:cancel', (_, id) => downloads.cancel(id));
ipcMain.handle('download:resume', (_, id) => downloads.resume(id));
ipcMain.handle('telegram:status', () => telegram.status());
ipcMain.handle('telegram:connect', (_, input) => telegram.connect(input));
ipcMain.handle('telegram:disconnect', () => telegram.disconnect());
ipcMain.on('telegram:prompt-response', (_, payload) => { const resolve = telegramPrompts.get(payload.requestId); if (resolve) { telegramPrompts.delete(payload.requestId); resolve(payload.value); } });
ipcMain.handle('update:check', (_, url) => updates.check(url));
ipcMain.handle('update:install', (_, info) => updates.install(info));
ipcMain.handle('path:open', (_, target) => shell.openPath(target));
ipcMain.handle('path:show', async (_, input) => {
  const rawTarget = typeof input === 'string' ? input : input?.filePath;
  const target = String(rawTarget || '').replace(/^['"]|['"]$/g, '').replace(/[\r\n]/g, '').trim();
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return { found: false };
  }
  const normalized = path.normalize(target);
  if (process.platform === 'win32') spawn('explorer.exe', [`/select,${normalized}`], { detached: true, stdio: 'ignore' }).unref();
  else shell.showItemInFolder(normalized);
  return { found: true, path: normalized };
});
ipcMain.handle('path:trash', async (_, target) => {
  if (!target || !fs.existsSync(target)) return { existed: false, trashed: false };
  try {
    await shell.trashItem(target);
    return { existed: true, trashed: true };
  } catch (error) {
    // The file may have been removed after the existence check.
    if (!fs.existsSync(target)) return { existed: false, trashed: false };
    throw error;
  }
});
ipcMain.handle('link:open', async (_, target) => {
  const url = new URL(target);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Enlace externo no permitido.');
  await shell.openExternal(url.toString());
  return true;
});
ipcMain.handle('system:dark', () => nativeTheme.shouldUseDarkColors);
