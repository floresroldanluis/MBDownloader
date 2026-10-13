'use strict';
const parentPort = process.parentPort || {
  postMessage: message => process.send?.(message),
  on: (_event, handler) => process.on('message', data => handler({ data }))
};
const path = require('node:path');
const fs = require('node:fs/promises');
const https = require('node:https');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { telegramErrorText } = require('./telegram-errors');
const { classifyDownloadFailure } = require('./domain');

let client = null;
let profile = null;
const pendingPrompts = new Map();
const active = new Map();
const send = message => parentPort.postMessage(message);

function networkAvailable() {
  return new Promise(resolve => {
    const request = https.get('https://www.google.com/generate_204', { timeout: 5000 }, response => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 500); });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}
async function freeDiskBytes(target) { try { const stats = await fs.statfs(target); return Number(stats.bavail) * Number(stats.bsize); } catch { return null; } }
function wait(record, milliseconds) { return new Promise(resolve => { record.wake = resolve; record.timer = setTimeout(resolve, milliseconds); }); }
async function waitForRecovery(record, kind, destination, freeAtFailure) {
  while (!record.cancelled) {
    let ready = record.manualResume;
    if (!ready && kind === 'network') ready = await networkAvailable();
    if (!ready && kind === 'disk') { const free = await freeDiskBytes(destination); ready = free != null && free >= Math.max(256 * 1024 * 1024, (freeAtFailure || 0) + 64 * 1024 * 1024); }
    if (ready) { record.manualResume = false; return true; }
    await wait(record, 15000);
  }
  return false;
}

function prompt(kind, message) {
  const requestId = `${Date.now()}-${Math.random()}`;
  send({ type: 'prompt', requestId, kind, message });
  return new Promise(resolve => pendingPrompts.set(requestId, resolve));
}
function parseUrl(url) {
  const privateMatch = url.match(/^https?:\/\/t\.me\/c\/(\d+)\/(\d+)/i);
  if (privateMatch) return { privateId: privateMatch[1], messageId: Number(privateMatch[2]) };
  const publicMatch = url.match(/^https?:\/\/t\.me\/([^/]+)\/(\d+)/i);
  if (publicMatch) return { username: publicMatch[1], messageId: Number(publicMatch[2]) };
  throw new Error('El enlace de Telegram no tiene un formato válido.');
}
async function resolveMessage(url) {
  if (!client) throw new Error('Telegram no está conectado.');
  const parsed = parseUrl(url); let entity;
  if (parsed.username) entity = parsed.username;
  else {
    const dialogs = await client.getDialogs({ limit: 500 });
    const dialog = dialogs.find(item => String(item.id).replace(/^-100/, '') === parsed.privateId || String(item.entity?.id || '') === parsed.privateId);
    if (!dialog) throw new Error('La cuenta conectada no pertenece a ese canal privado.');
    entity = dialog.entity;
  }
  const messages = await client.getMessages(entity, { ids: [parsed.messageId] });
  const message = Array.isArray(messages) ? messages[0] : messages;
  if (!message?.media) throw new Error('El mensaje no contiene un archivo descargable.');
  return message;
}
const methods = {
  async connect(input) {
    const session = new StringSession(input.session || '');
    const next = new TelegramClient(session, Number(input.apiId), input.apiHash, { connectionRetries: 5, floodSleepThreshold: 60 });
    try {
      await next.start({ phoneNumber: async () => input.phone, phoneCode: async () => prompt('code', 'Introduce el código enviado por Telegram.'), password: async () => prompt('password', 'Introduce tu contraseña de verificación en dos pasos.'), onError: error => send({ type: 'event', channel: 'telegram:event', payload: { type: 'error', message: telegramErrorText(error) } }) });
      const me = await next.getMe(); client = next;
      profile = { name: [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Telegram', phone: me.phone ? `+${me.phone}` : input.phone };
      return { connected: true, profile, session: client.session.save() };
    } catch (error) { try { await next.disconnect(); } catch {} throw new Error(telegramErrorText(error)); }
  },
  status() { return { connected: Boolean(client), profile }; },
  async disconnect() { for (const item of active.values()) item.cancelled = true; if (client) { try { await client.logOut(); } catch {} try { await client.disconnect(); } catch {} } client = null; profile = null; return { connected: false }; },
  async metadata(url) { const message = await resolveMessage(url); return { id: `telegram-${message.id}`, title: message.file?.name || `telegram_${message.id}`, uploader: message.chat?.title || 'Telegram', duration_string: message.file?.duration ? `${message.file.duration}s` : '', thumbnail: null, telegram: true }; },
  start(job) {
    const id = `${Date.now()}-tg-${Math.random().toString(16).slice(2)}`; const record = { cancelled: false, state: 'downloading', attempt: 0, progress: 0, manualResume: false }; active.set(id, record);
    const emit = payload => send({ type: 'event', channel: 'download:event', payload: { id, ...payload } });
    emit({ state: 'downloading', progress: 0, title: job.title || job.url, url: job.url, startedAt: Date.now() });
    (async () => {
      let target, partial;
      try {
        while (!record.cancelled) {
          try {
            const message = await resolveMessage(job.url);
            const name = message.file?.name || `telegram_${message.id}${message.file?.mimeType?.startsWith('video') ? '.mp4' : ''}`;
            target = path.join(job.destination, name); partial = `${target}.part`;
            record.state = 'downloading';
            await client.downloadMedia(message, { outputFile: partial, progressCallback: (received, total) => {
              if (record.cancelled) throw new Error('DOWNLOAD_CANCELLED');
              record.progress = total ? Number(received) / Number(total) * 100 : 0;
              emit({ state: 'downloading', progress: record.progress, error: null });
            }});
            if (record.cancelled) break;
            await fs.rm(target, { force: true }); await fs.rename(partial, target);
            emit({ state: 'completed', progress: 100, destination: job.destination, filePath: target, error: null, finishedAt: Date.now() });
            return;
          } catch (error) {
            if (record.cancelled) break;
            const diagnosis = classifyDownloadFailure(error.message || error);
            if (!diagnosis.recoverable || record.attempt >= 8) { emit({ state: 'failed', error: diagnosis.message, diagnosis: String(error.message || error), finishedAt: Date.now() }); return; }
            record.state = 'paused';
            const freeAtFailure = diagnosis.kind === 'disk' ? await freeDiskBytes(job.destination) : null;
            emit({ state: 'paused', progress: record.progress, error: diagnosis.message, diagnosis: String(error.message || error), retryCount: record.attempt });
            if (!await waitForRecovery(record, diagnosis.kind, job.destination, freeAtFailure)) break;
            record.attempt += 1;
            emit({ state: 'downloading', progress: record.progress, speed: 'Reanudando…', eta: '', error: null, retryCount: record.attempt });
          }
        }
        if (partial) await fs.rm(partial, { force: true });
        emit({ state: 'cancelled', finishedAt: Date.now() });
      } finally { clearTimeout(record.timer); active.delete(id); }
    })();
    return { id };
  },
  resume(id) { const item = active.get(id); if (!item || item.state !== 'paused') return false; item.manualResume = true; clearTimeout(item.timer); item.wake?.(); return true; },
  cancel(id) { const item = active.get(id); if (!item) return false; item.cancelled = true; clearTimeout(item.timer); item.wake?.(); return true; }
};

parentPort.on('message', async event => {
  const message = event.data;
  if (message.type === 'prompt-response') { const resolve = pendingPrompts.get(message.requestId); if (resolve) { pendingPrompts.delete(message.requestId); resolve(message.value); } return; }
  if (message.type !== 'request') return;
  try { const result = await methods[message.method](...(message.args || [])); send({ type: 'response', id: message.id, result }); }
  catch (error) { send({ type: 'response', id: message.id, error: error.message || String(error) }); }
});
