'use strict';
const parentPort = process.parentPort || {
  postMessage: message => process.send?.(message),
  on: (_event, handler) => process.on('message', data => handler({ data }))
};
const path = require('node:path');
const fs = require('node:fs/promises');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');
const { telegramErrorText } = require('./telegram-errors');

let client = null;
let profile = null;
const pendingPrompts = new Map();
const active = new Map();
const send = message => parentPort.postMessage(message);

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
    const id = `${Date.now()}-tg-${Math.random().toString(16).slice(2)}`; const record = { cancelled: false }; active.set(id, record);
    const emit = payload => send({ type: 'event', channel: 'download:event', payload: { id, ...payload } });
    emit({ state: 'downloading', progress: 0, title: job.title || job.url, url: job.url, startedAt: Date.now() });
    (async () => { let target; try { const message = await resolveMessage(job.url); const name = message.file?.name || `telegram_${message.id}${message.file?.mimeType?.startsWith('video') ? '.mp4' : ''}`; target = path.join(job.destination, name); await client.downloadMedia(message, { outputFile: target, progressCallback: (received, total) => { if (record.cancelled) throw new Error('DOWNLOAD_CANCELLED'); emit({ state: 'downloading', progress: total ? Number(received) / Number(total) * 100 : 0 }); } }); if (record.cancelled) { await fs.rm(target, { force: true }); return; } emit({ state: 'completed', progress: 100, destination: job.destination, filePath: target, finishedAt: Date.now() }); } catch (error) { if (target && record.cancelled) await fs.rm(target, { force: true }); emit({ state: record.cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: Date.now() }); } finally { active.delete(id); } })();
    return { id };
  },
  cancel(id) { const item = active.get(id); if (!item) return false; item.cancelled = true; return true; }
};

parentPort.on('message', async event => {
  const message = event.data;
  if (message.type === 'prompt-response') { const resolve = pendingPrompts.get(message.requestId); if (resolve) { pendingPrompts.delete(message.requestId); resolve(message.value); } return; }
  if (message.type !== 'request') return;
  try { const result = await methods[message.method](...(message.args || [])); send({ type: 'response', id: message.id, result }); }
  catch (error) { send({ type: 'response', id: message.id, error: error.message || String(error) }); }
});
