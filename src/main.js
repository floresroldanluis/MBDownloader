'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SettingsStore, EngineManager, TelegramService, DownloadManager, UpdateService } = require('./services');

let win, settings, engines, telegram, downloads, updates;
const telegramPrompts = new Map();

function animateOpacity(window, from, to, duration, complete) {
  const startedAt = Date.now();
  window.setOpacity(from);
  const timer = setInterval(() => {
    if (window.isDestroyed()) return clearInterval(timer);
    const progress = Math.min(1, (Date.now() - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  let closing = false;
  win.once('ready-to-show', () => { win.center(); win.show(); animateOpacity(win, 0, 1, 260); });
  win.on('close', event => {
    if (closing || win.isDestroyed()) return;
    event.preventDefault();
    closing = true;
    animateOpacity(win, win.getOpacity(), 0, 220, () => win.destroy());
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
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
ipcMain.handle('telegram:status', () => telegram.status());
ipcMain.handle('telegram:connect', (_, input) => telegram.connect(input));
ipcMain.handle('telegram:disconnect', () => telegram.disconnect());
ipcMain.on('telegram:prompt-response', (_, payload) => { const resolve = telegramPrompts.get(payload.requestId); if (resolve) { telegramPrompts.delete(payload.requestId); resolve(payload.value); } });
ipcMain.handle('update:check', (_, url) => updates.check(url));
ipcMain.handle('update:install', (_, info) => updates.install(info));
ipcMain.handle('path:open', (_, target) => shell.openPath(target));
ipcMain.handle('path:show', (_, target) => shell.showItemInFolder(target));
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
