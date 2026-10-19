'use strict';

const { app, shell, safeStorage, utilityProcess } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync, fork } = require('node:child_process');
const https = require('node:https');
const { buildDownloadArgs, classifyDownloadFailure, usesTelegramEngine, parseGoogleDriveFileId, parseGoogleDriveMetadataHtml, parseGithubRepository } = require('./domain');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const OFFICIAL_UPDATE_URL = 'https://github.com/floresroldanluis/MBDownloader';
const THEME_SCHEDULE_VERSION = 1;

const defaultSettings = {
  theme: 'auto', destination: '', updateUrl: OFFICIAL_UPDATE_URL, browserCookies: 'none',
  concurrentDownloads: 2, closeToTray: false, history: [], themeScheduleVersion: THEME_SCHEDULE_VERSION
};

function requestJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'UniversalDownloader', Accept: 'application/vnd.github+json' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) return resolve(requestJson(res.headers.location, redirects + 1));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Respuesta JSON inválida.')); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Tiempo de espera agotado.')));
  });
}

function requestText(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 MBDownloader', ...options.headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(requestText(new URL(res.headers.location, url).href, options, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 5_000_000) req.destroy(new Error('La respuesta de Google Drive es demasiado grande.')); });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body, url }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Tiempo de espera agotado al consultar Google Drive.')));
  });
}

function requestBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 MBDownloader' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        return resolve(requestBuffer(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = []; let length = 0;
      res.on('data', chunk => { length += chunk.length; if (length > 2_000_000) res.destroy(new Error('La miniatura es demasiado grande.')); else chunks.push(chunk); });
      res.on('end', () => resolve({ contentType: res.headers['content-type'] || 'image/jpeg', data: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Tiempo de espera agotado al cargar la miniatura.')));
  });
}

function parseDriveConfirmation(html, fileId) {
  const form = String(html || '').match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/i);
  if (!form) return null;
  const params = new URLSearchParams();
  for (const match of form[0].matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi)) params.set(match[1], match[2].replace(/&amp;/g, '&'));
  if (!params.has('id')) params.set('id', fileId);
  return `${form[1]}?${params.toString()}`;
}

function safeLocalFilename(value, fallback) {
  const cleaned = String(value || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').trim();
  return cleaned || fallback;
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const fail = error => { file.close(); fs.rm(destination, { force: true }, () => reject(error)); };
    https.get(url, { headers: { 'User-Agent': 'UniversalDownloader' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        file.close(); fs.rmSync(destination, { force: true });
        return resolve(downloadFile(res.headers.location, destination, redirects + 1));
      }
      if (res.statusCode !== 200) return fail(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', fail);
  });
}

function networkAvailable() {
  return new Promise(resolve => {
    const request = https.get('https://www.google.com/generate_204', { timeout: 5000 }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

async function freeDiskBytes(target) {
  try { const stats = await fsp.statfs(target); return Number(stats.bavail) * Number(stats.bsize); }
  catch { return null; }
}

class SettingsStore {
  constructor() {
    this.ready = false;
    this.file = path.join(app.getPath('userData'), 'settings.json');
    let storedSettings = {};
    try { storedSettings = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.settings = { ...defaultSettings, destination: app.getPath('downloads'), ...storedSettings };
    if (storedSettings.themeScheduleVersion !== THEME_SCHEDULE_VERSION) {
      this.settings.theme = 'auto';
      this.settings.themeScheduleVersion = THEME_SCHEDULE_VERSION;
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file, JSON.stringify(this.settings, null, 2));
      } catch {}
    }
    if (!['auto', 'light', 'dark'].includes(this.settings.theme)) this.settings.theme = 'auto';
    if (!this.settings.updateUrl || /github\.com\/usuario\/repositorio/i.test(this.settings.updateUrl)) {
      this.settings.updateUrl = OFFICIAL_UPDATE_URL;
    }
  }
  get() { return { ...this.settings }; }
  async save(next) {
    this.settings = { ...this.settings, ...next };
    if (!['auto', 'light', 'dark'].includes(this.settings.theme)) this.settings.theme = 'auto';
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(this.file, JSON.stringify(this.settings, null, 2));
    return this.get();
  }
}

class EngineManager {
  constructor() {
    this.binDir = path.join(app.getPath('userData'), 'bin');
    this.userYtDlp = path.join(this.binDir, 'yt-dlp.exe');
    this.userFfmpeg = path.join(this.binDir, 'ffmpeg.exe');
    this.userFfprobe = path.join(this.binDir, 'ffprobe.exe');
    this.userDeno = path.join(this.binDir, 'deno.exe');
    this.bundledBin = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'vendor', 'bin');
    this.bundledYtDlp = path.join(this.bundledBin, 'yt-dlp.exe');
    this.bundledFfmpeg = path.join(this.bundledBin, 'ffmpeg.exe');
    this.bundledDeno = path.join(this.bundledBin, 'deno.exe');
  }
  get ytdlp() { return fs.existsSync(this.userYtDlp) ? this.userYtDlp : this.bundledYtDlp; }
  get ffmpeg() { return fs.existsSync(this.userFfmpeg) ? this.userFfmpeg : fs.existsSync(this.bundledFfmpeg) ? this.bundledFfmpeg : 'ffmpeg'; }
  get deno() { return fs.existsSync(this.userDeno) ? this.userDeno : this.bundledDeno; }
  get mediaBin() { return fs.existsSync(this.userFfmpeg) && fs.existsSync(this.userFfprobe) ? this.binDir : this.bundledBin; }
  commandVersion(command, args = ['--version']) {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : null;
  }
  status() {
    const encoders = spawnSync(this.ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true });
    const amdAmf = encoders.status === 0 && /\b(?:h264|hevc|av1)_amf\b/i.test(`${encoders.stdout}\n${encoders.stderr}`);
    return {
      ytdlp: fs.existsSync(this.ytdlp) ? this.commandVersion(this.ytdlp) : null,
      ffmpeg: this.commandVersion(this.ffmpeg, ['-version'])?.replace(/^ffmpeg version\s+/i, '') || null,
      deno: fs.existsSync(this.deno) ? this.commandVersion(this.deno) : null,
      amdAmf,
      portable: fs.existsSync(this.ytdlp) && fs.existsSync(this.ffmpeg) && fs.existsSync(this.deno)
    };
  }
  async updateYtDlp() {
    await fsp.mkdir(this.binDir, { recursive: true });
    const temp = `${this.userYtDlp}.download`;
    await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', temp);
    await fsp.rm(this.userYtDlp, { force: true });
    await fsp.rename(temp, this.userYtDlp);
    return this.status();
  }
  findFile(root, name) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) { const nested = this.findFile(target, name); if (nested) return nested; }
      else if (entry.name.toLowerCase() === name.toLowerCase()) return target;
    }
    return null;
  }
  async extractZip(archive, destination) {
    await fsp.mkdir(destination, { recursive: true });
    const result = spawnSync('tar.exe', ['-xf', archive, '-C', destination], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || `No se pudo extraer ${path.basename(archive)}.`);
  }
  async updateAll() {
    await fsp.mkdir(this.binDir, { recursive: true });
    const work = path.join(this.binDir, 'engine-update');
    await fsp.rm(work, { recursive: true, force: true });
    await fsp.mkdir(work, { recursive: true });
    try {
      await this.updateYtDlp();
      const denoZip = path.join(work, 'deno.zip');
      const denoDir = path.join(work, 'deno');
      await downloadFile('https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip', denoZip);
      await this.extractZip(denoZip, denoDir);
      const deno = this.findFile(denoDir, 'deno.exe');
      if (!deno) throw new Error('El paquete actualizado de Deno no contiene el motor esperado.');
      await fsp.copyFile(deno, this.userDeno);

      const ffmpegZip = path.join(work, 'ffmpeg.zip');
      const ffmpegDir = path.join(work, 'ffmpeg');
      await downloadFile('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', ffmpegZip);
      await this.extractZip(ffmpegZip, ffmpegDir);
      const ffmpeg = this.findFile(ffmpegDir, 'ffmpeg.exe');
      const ffprobe = this.findFile(ffmpegDir, 'ffprobe.exe');
      if (!ffmpeg || !ffprobe) throw new Error('El paquete actualizado de FFmpeg no contiene los motores esperados.');
      await fsp.copyFile(ffmpeg, this.userFfmpeg);
      await fsp.copyFile(ffprobe, this.userFfprobe);
      return this.status();
    } finally { await fsp.rm(work, { recursive: true, force: true }); }
  }
  async ensureReady() {
    if (this.ready) return true;
    if (!fs.existsSync(this.ytdlp)) await this.updateYtDlp();
    const ffmpegReady = path.isAbsolute(this.ffmpeg) ? fs.existsSync(this.ffmpeg) : Boolean(this.commandVersion(this.ffmpeg, ['-version']));
    if (!ffmpegReady) throw new Error('FFmpeg no está instalado. Usa “Reparar motores” en Configuración.');
    if (!fs.existsSync(this.deno)) throw new Error('Deno no está instalado. Usa “Actualizar motores” en Configuración.');
    this.ready = true;
    return true;
  }
  repairFfmpeg() {
    const child = spawn('winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements'], { detached: true, windowsHide: false, stdio: 'ignore' });
    child.unref();
    return { launched: true };
  }
}

class TelegramService {
  constructor(notify, requestSecret) {
    this.notify = notify;
    this.requestSecret = requestSecret;
    this.secretFile = path.join(app.getPath('userData'), 'telegram-session.bin');
    this.client = null;
    this.profile = null;
    this.active = new Map();
  }
  loadSecret() {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(this.secretFile)));
    } catch { return null; }
  }
  async saveSecret(value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows no permite cifrar la sesión de Telegram en este equipo.');
    await fsp.mkdir(path.dirname(this.secretFile), { recursive: true });
    await fsp.writeFile(this.secretFile, safeStorage.encryptString(JSON.stringify(value)));
  }
  status() { return { connected: Boolean(this.client && this.profile), profile: this.profile }; }
  normalizePhone(countryCode, phone) {
    const code = String(countryCode || '+51').replace(/[^+\d]/g, '');
    const local = String(phone || '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
    if (!/^9\d{8}$/.test(local)) throw new Error('Para Perú introduce 9 dígitos, comenzando por 9.');
    return `${code}${local}`;
  }
  async connect(input = {}) {
    const saved = this.loadSecret() || {};
    const apiId = Number(input.apiId || saved.apiId);
    const apiHash = String(input.apiHash || saved.apiHash || '').trim();
    if (!Number.isInteger(apiId) || !apiHash) throw new Error('Introduce tu API ID y API Hash de my.telegram.org.');
    const phone = input.phone ? this.normalizePhone(input.countryCode, input.phone) : saved.phone;
    const session = new StringSession(saved.session || '');
    const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5, floodSleepThreshold: 60 });
    try {
      await client.start({
        phoneNumber: async () => phone,
        phoneCode: async () => this.requestSecret('code', 'Introduce el código que Telegram envió a tus dispositivos.'),
        password: async () => this.requestSecret('password', 'Introduce tu contraseña de verificación en dos pasos.'),
        onError: error => this.notify('telegram:event', { type: 'error', message: error.message })
      });
      const me = await client.getMe();
      this.client = client;
      this.profile = { name: [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Telegram', phone: me.phone ? `+${me.phone}` : phone };
      await this.saveSecret({ apiId, apiHash, phone, session: client.session.save() });
      this.notify('telegram:event', { type: 'connected', profile: this.profile });
      return this.status();
    } catch (error) {
      try { await client.disconnect(); } catch {}
      throw new Error(`No se pudo conectar con Telegram: ${error.message || error}`);
    }
  }
  async restore() { if (!fs.existsSync(this.secretFile)) return this.status(); try { return await this.connect(); } catch { return this.status(); } }
  async disconnect() {
    for (const record of this.active.values()) record.cancelled = true;
    try { if (this.client) await this.client.logOut(); } catch {}
    try { if (this.client) await this.client.disconnect(); } catch {}
    this.client = null; this.profile = null;
    await fsp.rm(this.secretFile, { force: true });
    this.notify('telegram:event', { type: 'disconnected' });
    return this.status();
  }
  parseUrl(url) {
    const privateMatch = url.match(/^https?:\/\/t\.me\/c\/(\d+)\/(\d+)/i);
    if (privateMatch) return { privateId: privateMatch[1], messageId: Number(privateMatch[2]) };
    const publicMatch = url.match(/^https?:\/\/t\.me\/([^/]+)\/(\d+)/i);
    if (publicMatch) return { username: publicMatch[1], messageId: Number(publicMatch[2]) };
    throw new Error('El enlace de Telegram no tiene un formato de mensaje válido.');
  }
  async resolveMessage(url) {
    if (!this.client) throw new Error('Conecta Telegram desde Configuración para descargar este enlace.');
    const parsed = this.parseUrl(url);
    let entity;
    if (parsed.username) entity = parsed.username;
    else {
      const dialogs = await this.client.getDialogs({ limit: 500 });
      const expected = parsed.privateId;
      const dialog = dialogs.find(item => String(item.id).replace(/^-100/, '') === expected || String(item.entity?.id || '') === expected);
      if (!dialog) throw new Error('Tu cuenta conectada no tiene acceso a ese canal privado de Telegram.');
      entity = dialog.entity;
    }
    const messages = await this.client.getMessages(entity, { ids: [parsed.messageId] });
    const message = Array.isArray(messages) ? messages[0] : messages;
    if (!message || !message.media) throw new Error('El mensaje no contiene un archivo multimedia descargable.');
    return message;
  }
  async metadata(url) {
    const message = await this.resolveMessage(url);
    const name = message.file?.name || `telegram_${message.id}`;
    return { id: `telegram-${message.id}`, title: name, uploader: message.chat?.title || 'Telegram', duration_string: message.file?.duration ? `${message.file.duration}s` : '', thumbnail: null, telegram: true };
  }
  start(job) {
    const id = `${Date.now()}-tg-${Math.random().toString(16).slice(2)}`;
    const record = { id, cancelled: false }; this.active.set(id, record);
    this.notify('download:event', { id, state: 'downloading', progress: 0, title: job.title || job.url, thumbnail: job.thumbnail || null, url: job.url, startedAt: Date.now() });
    (async () => {
      try {
        const message = await this.resolveMessage(job.url);
        const name = message.file?.name || `telegram_${message.id}${message.file?.mimeType?.startsWith('video') ? '.mp4' : ''}`;
        const target = path.join(job.destination, name);
        await this.client.downloadMedia(message, { outputFile: target, progressCallback: (received, total) => {
          if (record.cancelled) throw new Error('DOWNLOAD_CANCELLED');
          const progress = total ? Number(received) / Number(total) * 100 : 0;
          this.notify('download:event', { id, state: 'downloading', progress });
        }});
        if (record.cancelled) { await fsp.rm(target, { force: true }); return; }
        this.notify('download:event', { id, state: 'completed', progress: 100, destination: job.destination, filePath: target, finishedAt: Date.now() });
      } catch (error) {
        this.notify('download:event', { id, state: record.cancelled ? 'cancelled' : 'failed', error: error.message, finishedAt: Date.now() });
      } finally { this.active.delete(id); }
    })();
    return { id };
  }
  cancel(id) { const record = this.active.get(id); if (!record) return false; record.cancelled = true; return true; }
}

class IsolatedTelegramService {
  constructor(notify, requestSecret) { this.notify = notify; this.requestSecret = requestSecret; this.secretFile = path.join(app.getPath('userData'), 'telegram-session.bin'); this.worker = null; this.pending = new Map(); this.profile = null; }
  loadSecret() { try { return safeStorage.isEncryptionAvailable() ? JSON.parse(safeStorage.decryptString(fs.readFileSync(this.secretFile))) : null; } catch { return null; } }
  async saveSecret(value) { await fsp.writeFile(this.secretFile, safeStorage.encryptString(JSON.stringify(value))); }
  ensureWorker() {
    if (this.worker) return;
    const nodeBinary = app.isPackaged ? path.join(process.resourcesPath, 'bin', 'node.exe') : path.join(__dirname, '..', 'vendor', 'bin', 'node.exe');
    const workerScript = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'telegram-worker.js') : path.join(__dirname, 'telegram-worker.js');
    this.worker = fork(workerScript, [], { execPath: nodeBinary, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
    this.worker.on('message', message => this.onMessage(message));
    this.worker.stdout?.on('data', () => {});
    this.worker.stderr?.on('data', chunk => {
      const detail = chunk.toString().trim();
      if (detail && !/experimentalwarning|localstorage/i.test(detail)) this.notify('telegram:event', { type: 'error', message: `Telegram: ${detail}` });
    });
    this.worker.on('error', error => this.failWorker(`No se pudo iniciar el motor de Telegram: ${error.message}`));
    this.worker.on('exit', code => this.failWorker(`El motor de Telegram se detuvo (${code}). La aplicación continúa abierta.`));
  }
  failWorker(message) { this.worker = null; for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); } this.pending.clear(); this.notify('telegram:event', { type: 'error', message }); }
  async onMessage(message) {
    if (message.type === 'response') { const item = this.pending.get(message.id); if (!item) return; clearTimeout(item.timer); this.pending.delete(message.id); message.error ? item.reject(new Error(message.error)) : item.resolve(message.result); }
    if (message.type === 'event') this.notify(message.channel, message.payload);
    if (message.type === 'prompt') { try { const value = await this.requestSecret(message.kind, message.message); this.worker?.send({ type: 'prompt-response', requestId: message.requestId, value }); } catch {} }
  }
  call(method, ...args) { this.ensureWorker(); const id = `${Date.now()}-${Math.random()}`; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Telegram no respondió a tiempo. Revisa Internet e intenta nuevamente.')); }, method === 'connect' ? 240000 : 60000); this.pending.set(id, { resolve, reject, timer }); this.worker.send({ type: 'request', id, method, args }, error => { if (!error) return; clearTimeout(timer); this.pending.delete(id); reject(new Error(`No se pudo enviar la operación a Telegram: ${error.message}`)); }); }); }
  status() { return { connected: Boolean(this.profile), profile: this.profile }; }
  normalizePhone(countryCode, phone) { const code = String(countryCode || '+51').replace(/[^+\d]/g, ''); const local = String(phone || '').replace(/\D/g, ''); if (!/^9\d{8}$/.test(local)) throw new Error('Introduce 9 dígitos, comenzando por 9.'); return `${code}${local}`; }
  async connect(input = {}) { const saved = this.loadSecret() || {}; const apiId = Number(input.apiId || saved.apiId); const apiHash = String(input.apiHash || saved.apiHash || '').trim(); if (!apiId || !apiHash) throw new Error('Introduce API ID y API Hash.'); const phone = input.phone ? this.normalizePhone(input.countryCode, input.phone) : saved.phone; this.notify('telegram:event', { type: 'connecting', message: 'Contactando a Telegram…' }); const result = await this.call('connect', { apiId, apiHash, phone, session: saved.session || '' }); this.profile = result.profile; await this.saveSecret({ apiId, apiHash, phone, session: result.session }); this.notify('telegram:event', { type: 'connected', profile: this.profile }); return this.status(); }
  async restore() { if (!fs.existsSync(this.secretFile)) return this.status(); try { return await this.connect(); } catch { return this.status(); } }
  async disconnect() { try { await this.call('disconnect'); } finally { this.profile = null; await fsp.rm(this.secretFile, { force: true }); } return this.status(); }
  metadata(url) { return this.call('metadata', url); }
  start(job) { return this.call('start', job); }
  resume(id) { return this.call('resume', id); }
  cancel(id) { return this.call('cancel', id); }
}

class DownloadManager {
  constructor(engine, telegram, notify) { this.engine = engine; this.telegram = telegram; this.notify = notify; this.jobs = new Map(); }
  async metadata(url, browserCookies) {
    if (usesTelegramEngine(url, this.telegram.status().connected)) return this.telegram.metadata(url);
    const driveId = parseGoogleDriveFileId(url);
    if (driveId) {
      const page = await requestText(`https://drive.google.com/file/d/${encodeURIComponent(driveId)}/view`);
      if (page.statusCode !== 200) throw new Error(`Google Drive no permitió consultar el archivo (HTTP ${page.statusCode}).`);
      const metadata = parseGoogleDriveMetadataHtml(page.body, driveId);
      if (metadata.thumbnail) {
        try {
          const image = await requestBuffer(metadata.thumbnail);
          metadata.thumbnail = `data:${image.contentType};base64,${image.data.toString('base64')}`;
        } catch { metadata.thumbnail = null; }
      }
      return metadata;
    }
    await this.engine.ensureReady();
    const args = ['--js-runtimes', `deno:${this.engine.deno}`, '--dump-single-json', '--no-playlist'];
    if (browserCookies && browserCookies !== 'none') args.push('--cookies-from-browser', browserCookies);
    args.push('--', url);
    return new Promise((resolve, reject) => {
      const child = spawn(this.engine.ytdlp, args, { windowsHide: true });
      let out = '', err = '';
      child.stdout.on('data', d => out += d);
      child.stderr.on('data', d => err += d);
      child.on('close', code => { try {
        if (code !== 0) return reject(new Error(err.trim() || 'No se pudo analizar el enlace.'));
        const data = JSON.parse(out);
        if (!data) {
          const privateTelegram = /https?:\/\/t\.me\/c\//i.test(url);
          return reject(new Error(privateTelegram ? 'Este enlace pertenece a un canal privado de Telegram. Necesita una sesión autorizada; prueba con un enlace público t.me/canal/mensaje.' : 'El sitio no entregó información descargable para este enlace.'));
        }
        resolve(data);
      } catch { reject(new Error('Respuesta inesperada del motor.')); } });
    });
  }
  async start(job) {
    if (usesTelegramEngine(job.url, this.telegram.status().connected)) return this.telegram.start(job);
    const driveId = parseGoogleDriveFileId(job.url);
    if (driveId) return this.startGoogleDrive(job, driveId);
    await this.engine.ensureReady();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record = { id, child: null, state: 'downloading', job, attempt: 0, progress: 0, cancelled: false, retryTimer: null };
    this.jobs.set(id, record);
    this.notify('download:event', { id, state: 'downloading', progress: 0, title: job.title || job.url, thumbnail: job.thumbnail || null, url: job.url, startedAt: Date.now() });
    this.launch(record);
    return { id };
  }
  startGoogleDrive(job, driveId) {
    const id = `${Date.now()}-drive-${Math.random().toString(16).slice(2)}`;
    const record = { id, child: null, request: null, state: 'downloading', job, driveId, attempt: 0, progress: 0, cancelled: false, retryTimer: null };
    this.jobs.set(id, record);
    this.notify('download:event', { id, state: 'downloading', progress: 0, title: job.title || `Archivo de Google Drive ${driveId}`, thumbnail: job.thumbnail || null, url: job.url, startedAt: Date.now() });
    this.launchGoogleDrive(record);
    return { id };
  }
  launch(record) {
    if (record.cancelled) return;
    const args = ['--ffmpeg-location', this.engine.mediaBin, '--js-runtimes', `deno:${this.engine.deno}`, ...buildDownloadArgs(record.job)];
    const child = spawn(this.engine.ytdlp, args, { windowsHide: true });
    record.child = child; record.state = 'downloading'; record.stderr = '';
    const consume = chunk => {
      const line = chunk.toString();
      const match = line.match(/download:\s*([\d.]+)%\|([^|]*)\|([^\r\n]*)/);
      if (match) { record.progress = Number(match[1]); this.notify('download:event', { id: record.id, state: 'downloading', progress: record.progress, speed: match[2].trim(), eta: match[3].trim(), error: null }); }
      const filepath = line.match(/filepath:([^\r\n]+)/);
      if (filepath) { record.filePath = filepath[1].trim(); this.notify('download:event', { id: record.id, filePath: record.filePath }); }
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', chunk => { record.stderr = `${record.stderr}${chunk}`.slice(-12000); consume(chunk); });
    child.on('error', error => { record.stderr += `\n${error.message}`; });
    child.on('close', code => this.handleClose(record, code));
  }
  async launchGoogleDrive(record) {
    if (record.cancelled) return;
    record.state = 'downloading'; record.stderr = '';
    record.child = { kill: () => record.request?.destroy(new Error('DOWNLOAD_CANCELLED')) };
    const open = (url, headers = {}, redirects = 0) => new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 MBDownloader', ...headers } }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
          response.resume();
          return resolve(open(new URL(response.headers.location, url).href, headers, redirects + 1));
        }
        resolve(response);
      });
      record.request = request;
      request.on('error', reject);
      request.setTimeout(30000, () => request.destroy(new Error('Tiempo de espera agotado al descargar desde Google Drive.')));
    });
    const readResponse = response => new Promise((resolve, reject) => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1_000_000) response.destroy(new Error('Google Drive no entregó el archivo esperado.')); });
      response.on('end', () => resolve(body)); response.on('error', reject);
    });
    try {
      const fallback = `GoogleDrive-${record.driveId}`;
      if (!record.target) {
        record.target = path.join(record.job.destination, safeLocalFilename(record.job.title, fallback));
        record.partial = `${record.target}.part`;
      }
      const existing = fs.existsSync(record.partial) ? fs.statSync(record.partial).size : 0;
      const initialUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(record.driveId)}&export=download&authuser=0`;
      let response = await open(initialUrl, existing ? { Range: `bytes=${existing}-` } : {});
      if (/text\/html/i.test(response.headers['content-type'] || '')) {
        const confirmation = parseDriveConfirmation(await readResponse(response), record.driveId);
        if (!confirmation) throw new Error('Google Drive no entregó la autorización de descarga. Verifica que el archivo sea público.');
        response = await open(confirmation, existing ? { Range: `bytes=${existing}-` } : {});
      }
      if (![200, 206].includes(response.statusCode)) { response.resume(); throw new Error(`HTTP Error ${response.statusCode}: Google Drive rechazó la descarga.`); }
      if (/text\/html/i.test(response.headers['content-type'] || '')) {
        const detail = await readResponse(response);
        const quotaExceeded = /too many users have viewed or downloaded|downloadQuotaExceeded|download quota exceeded|demasiados usuarios han visto o descargado/i.test(detail);
        throw new Error(quotaExceeded ? 'Google Drive agotó temporalmente la cuota de descarga de este archivo.' : 'Google Drive devolvió una página de confirmación inesperada. Intenta nuevamente.');
      }
      let offset = fs.existsSync(record.partial) ? fs.statSync(record.partial).size : 0;
      if (response.statusCode === 200 && offset) { offset = 0; await fsp.rm(record.partial, { force: true }); }
      const contentLength = Number(response.headers['content-length']) || 0;
      const contentRangeTotal = Number(String(response.headers['content-range'] || '').match(/\/(\d+)$/)?.[1]) || 0;
      const total = contentRangeTotal || (contentLength ? offset + contentLength : 0);
      let received = offset; let lastUpdate = 0;
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(record.partial, { flags: offset ? 'a' : 'w' });
        response.on('data', chunk => {
          received += chunk.length; const now = Date.now();
          if (now - lastUpdate >= 250) { lastUpdate = now; record.progress = total ? received / total * 100 : record.progress; this.notify('download:event', { id: record.id, state: 'downloading', progress: record.progress, speed: total ? `${(received / 1048576).toFixed(1)} MB de ${(total / 1048576).toFixed(1)} MB` : `${(received / 1048576).toFixed(1)} MB`, eta: '', error: null }); }
        });
        response.on('error', reject); file.on('error', error => { response.destroy(); reject(error); }); file.on('finish', resolve); response.pipe(file);
      });
      await fsp.rm(record.target, { force: true }); await fsp.rename(record.partial, record.target);
      record.filePath = record.target; this.notify('download:event', { id: record.id, filePath: record.target });
      record.child = null; record.request = null; await this.handleClose(record, 0);
    } catch (error) {
      record.child = null; record.request = null; record.stderr = error.message || String(error);
      await this.handleClose(record, 1);
    }
  }
  async handleClose(record, code) {
    record.child = null;
    if (record.cancelled || record.state === 'cancelled') {
      record.state = 'cancelled';
      this.notify('download:event', { id: record.id, state: 'cancelled', error: null, diagnosis: null, speed: null, eta: null, finishedAt: Date.now() });
      return;
    }
    if (code === 0) {
      record.state = 'completed';
      this.notify('download:event', { id: record.id, state: 'completed', progress: 100, destination: record.job.destination, filePath: record.filePath, error: null, finishedAt: Date.now() });
      return;
    }
    const diagnosis = classifyDownloadFailure(record.stderr);
    if (!diagnosis.recoverable || record.attempt >= 8) {
      record.state = 'failed';
      const suffix = record.attempt >= 8 ? ' Se agotaron los intentos automáticos; puedes iniciar la descarga nuevamente para continuar el archivo parcial.' : '';
      this.notify('download:event', { id: record.id, state: 'failed', error: `${diagnosis.message}${suffix}`, diagnosis: record.stderr.trim().slice(-1500), finishedAt: Date.now() });
      return;
    }
    record.state = 'paused';
    record.failureKind = diagnosis.kind;
    record.freeAtFailure = diagnosis.kind === 'disk' ? await freeDiskBytes(record.job.destination) : null;
    this.notify('download:event', { id: record.id, state: 'paused', progress: record.progress, error: diagnosis.message, diagnosis: record.stderr.trim().slice(-1500), retryCount: record.attempt });
    this.scheduleRecovery(record);
  }
  scheduleRecovery(record, delay = 10000) {
    clearTimeout(record.retryTimer);
    record.retryTimer = setTimeout(() => this.tryResume(record), delay);
  }
  async tryResume(record, manual = false) {
    if (record.cancelled || record.state !== 'paused') return false;
    let recovered = true;
    let waitingMessage = '';
    if (record.failureKind === 'network') {
      recovered = await networkAvailable();
      waitingMessage = 'Sin conexión. Se comprobará nuevamente en unos segundos.';
    } else if (record.failureKind === 'disk') {
      const free = await freeDiskBytes(record.job.destination);
      const minimum = 256 * 1024 * 1024;
      const required = record.freeAtFailure == null ? minimum : Math.max(minimum, record.freeAtFailure + 64 * 1024 * 1024);
      recovered = free != null && free >= required;
      waitingMessage = 'Esperando que liberes espacio en la unidad de destino.';
    }
    if (record.cancelled || record.state !== 'paused') return false;
    if (!recovered) {
      this.notify('download:event', { id: record.id, state: 'paused', progress: record.progress, error: waitingMessage });
      this.scheduleRecovery(record, manual ? 5000 : 15000);
      return false;
    }
    record.attempt += 1;
    this.notify('download:event', { id: record.id, state: 'downloading', progress: record.progress, error: null, diagnosis: null, retryCount: record.attempt, speed: 'Reanudando…', eta: '' });
    if (record.driveId) this.launchGoogleDrive(record); else this.launch(record);
    return true;
  }
  resume(id) { const record = this.jobs.get(id); if (!record) return this.telegram.resume(id); clearTimeout(record.retryTimer); this.tryResume(record, true); return true; }
  cancel(id) {
    const record = this.jobs.get(id);
    if (!record) return this.telegram.cancel(id);
    record.cancelled = true; record.state = 'cancelled'; clearTimeout(record.retryTimer);
    this.notify('download:event', { id, state: 'cancelled', error: null, diagnosis: null, speed: null, eta: null, finishedAt: Date.now() });
    if (record.child) record.child.kill();
    return true;
  }
}

class UpdateService {
  async check(channel) {
    const repo = parseGithubRepository(channel);
    if (!repo) throw new Error('Introduce una URL válida de repositorio en github.com.');
    const release = await requestJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`);
    const asset = release.assets?.find(item => /\.exe$/i.test(item.name));
    const currentVersion = app.getVersion();
    const clean = value => String(value || '').replace(/^v/i, '').split('-')[0].split('.').map(part => Number.parseInt(part, 10) || 0);
    const compare = (left, right) => {
      const a = clean(left); const b = clean(right);
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
      }
      return 0;
    };
    return { version: release.tag_name, currentVersion, available: compare(release.tag_name, currentVersion) > 0, notes: release.body || '', pageUrl: release.html_url, assetUrl: asset?.browser_download_url || null, assetName: asset?.name || null };
  }
  async install(info) {
    if (!info.assetUrl) { await shell.openExternal(info.pageUrl); return { opened: true }; }
    const destination = path.join(app.getPath('temp'), info.assetName || 'UniversalDownloaderUpdate.exe');
    await downloadFile(info.assetUrl, destination);
    spawn(destination, [], { detached: true, stdio: 'ignore' }).unref();
    return { launched: true };
  }
}

module.exports = { SettingsStore, EngineManager, TelegramService: IsolatedTelegramService, DownloadManager, UpdateService };
