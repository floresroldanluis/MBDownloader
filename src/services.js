'use strict';

const { app, shell, safeStorage, utilityProcess } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, spawnSync, fork } = require('node:child_process');
const https = require('node:https');
const { buildDownloadArgs, usesTelegramEngine, parseGithubRepository } = require('./domain');
const { TelegramClient } = require('teleproto');
const { StringSession } = require('teleproto/sessions');

const OFFICIAL_UPDATE_URL = 'https://github.com/floresroldanluis/MBDownloader';

const defaultSettings = {
  theme: 'auto', destination: '', updateUrl: OFFICIAL_UPDATE_URL, browserCookies: 'none',
  concurrentDownloads: 2, closeToTray: false, history: []
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

class SettingsStore {
  constructor() {
    this.ready = false;
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.settings = { ...defaultSettings, destination: app.getPath('downloads') };
    try { this.settings = { ...this.settings, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch {}
    this.settings.theme = 'auto';
    if (!this.settings.updateUrl || /github\.com\/usuario\/repositorio/i.test(this.settings.updateUrl)) {
      this.settings.updateUrl = OFFICIAL_UPDATE_URL;
    }
  }
  get() { return { ...this.settings }; }
  async save(next) {
    this.settings = { ...this.settings, ...next };
    this.settings.theme = 'auto';
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
    this.notify('download:event', { id, state: 'downloading', progress: 0, title: job.title || job.url, url: job.url, startedAt: Date.now() });
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
  cancel(id) { return this.call('cancel', id); }
}

class DownloadManager {
  constructor(engine, telegram, notify) { this.engine = engine; this.telegram = telegram; this.notify = notify; this.jobs = new Map(); }
  async metadata(url, browserCookies) {
    if (usesTelegramEngine(url, this.telegram.status().connected)) return this.telegram.metadata(url);
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
    await this.engine.ensureReady();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const args = ['--ffmpeg-location', this.engine.mediaBin, '--js-runtimes', `deno:${this.engine.deno}`, ...buildDownloadArgs(job)];
    const child = spawn(this.engine.ytdlp, args, { windowsHide: true });
    const record = { id, child, state: 'downloading', job };
    this.jobs.set(id, record);
    this.notify('download:event', { id, state: 'downloading', progress: 0, title: job.title || job.url, url: job.url, startedAt: Date.now() });
    const consume = chunk => {
      const line = chunk.toString();
      const match = line.match(/download:\s*([\d.]+)%\|([^|]*)\|([^\r\n]*)/);
      if (match) this.notify('download:event', { id, state: 'downloading', progress: Number(match[1]), speed: match[2].trim(), eta: match[3].trim() });
      const filepath = line.match(/filepath:([^\r\n]+)/);
      if (filepath) { record.filePath = filepath[1].trim(); this.notify('download:event', { id, filePath: record.filePath }); }
    };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.on('close', code => {
      const state = record.state === 'cancelled' ? 'cancelled' : code === 0 ? 'completed' : 'failed';
      record.state = state;
      this.notify('download:event', { id, state, progress: state === 'completed' ? 100 : undefined, destination: job.destination, filePath: record.filePath, finishedAt: Date.now() });
    });
    return { id };
  }
  cancel(id) { const record = this.jobs.get(id); if (!record) return this.telegram.cancel(id); record.state = 'cancelled'; record.child.kill(); return true; }
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
