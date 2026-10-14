'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: value => ipcRenderer.invoke('settings:save', value),
  chooseDestination: () => ipcRenderer.invoke('dialog:destination'),
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  updateEngines: () => ipcRenderer.invoke('engine:update'),
  repairEngines: () => ipcRenderer.invoke('engine:repair'),
  metadata: (url, cookies) => ipcRenderer.invoke('media:metadata', url, cookies),
  startDownload: job => ipcRenderer.invoke('download:start', job),
  cancelDownload: id => ipcRenderer.invoke('download:cancel', id),
  resumeDownload: id => ipcRenderer.invoke('download:resume', id),
  telegramStatus: () => ipcRenderer.invoke('telegram:status'),
  connectTelegram: input => ipcRenderer.invoke('telegram:connect', input),
  disconnectTelegram: () => ipcRenderer.invoke('telegram:disconnect'),
  answerTelegramPrompt: payload => ipcRenderer.send('telegram:prompt-response', payload),
  checkUpdate: url => ipcRenderer.invoke('update:check', url),
  installUpdate: info => ipcRenderer.invoke('update:install', info),
  openPath: target => ipcRenderer.invoke('path:open', target),
  openExternal: target => ipcRenderer.invoke('link:open', target),
  showItem: input => ipcRenderer.invoke('path:show', input),
  trashItem: target => ipcRenderer.invoke('path:trash', target),
  systemDark: () => ipcRenderer.invoke('system:dark'),
  onAppAnimation: callback => ipcRenderer.on('app:animation', (_, phase) => callback(phase)),
  onDownload: callback => ipcRenderer.on('download:event', (_, payload) => callback(payload)),
  onTelegram: callback => ipcRenderer.on('telegram:event', (_, payload) => callback(payload)),
  onTelegramPrompt: callback => ipcRenderer.on('telegram:prompt', (_, payload) => callback(payload))
});
