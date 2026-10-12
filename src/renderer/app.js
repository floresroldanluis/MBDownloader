'use strict';

const $ = id => document.getElementById(id);
const state = { settings: null, mode: 'video', metadata: null, update: null, jobs: new Map(), analysisId: 0 };
let toastTimer;

function setMessage(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function showToast(text, error = false) {
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.toggle('toast-error', error);
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}
function effectiveDark(theme) {
  const hour = new Date().getHours();
  return hour < 7 || hour >= 19;
}
function applyTheme(theme) { document.body.classList.toggle('theme-dark', effectiveDark(theme)); }
function refreshAutomaticTheme() { applyTheme('auto'); }
function errorText(error) { return (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': Error:\s*/i, ''); }

async function init() {
  state.settings = await window.desktop.getSettings();
  applyTheme(state.settings.theme);
  window.setInterval(refreshAutomaticTheme, 60_000);
  window.addEventListener('focus', refreshAutomaticTheme);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAutomaticTheme(); });
  (state.settings.history || []).forEach(job => state.jobs.set(job.id, job));
  bindEvents(); renderSettings(); renderJobs(); refreshEngines(); refreshTelegram(); checkUpdate(true);
  window.desktop.onDownload(updateJob);
  window.desktop.onTelegram(async event => {
    if (event.type === 'error' || event.type === 'connecting') {
      $('telegramStatus').textContent = event.message;
      return;
    }
    await refreshTelegram();
  });
  window.desktop.onTelegramPrompt(showTelegramPrompt);
}

function bindEvents() {
  $('settingsButton').onclick = () => { renderSettings(); $('settingsDialog').showModal(); refreshEngines(); };
  $('aboutButton').onclick = () => $('aboutDialog').showModal();
  $('linktreeLink').onclick = () => window.desktop.openExternal('https://linktr.ee/floresroldanluis');
  $('themeButton').onclick = async () => { state.settings = await window.desktop.saveSettings({ theme: 'auto' }); refreshAutomaticTheme(); };
  $('analyzeButton').onclick = pasteAndAnalyze;
  $('clearUrlButton').onclick = clearUrl;
  $('pasteDownloadButton').onclick = pasteAndDownload;
  $('batchButton').onclick = () => $('batchDialog').showModal();
  $('startBatch').onclick = startBatch;
  $('url').addEventListener('keydown', e => { if (e.key === 'Enter') analyze(); });
  $('url').addEventListener('input', refreshClearUrlButton);
  document.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
  $('quality').onchange = refreshSummary; $('container').onchange = refreshSummary;
  $('downloadButton').onclick = startDownload;
  $('openFolder').onclick = () => window.desktop.openPath(state.settings.destination);
  $('quickChooseFolder').onclick = chooseQuickFolder;
  $('clearHistory').onclick = async () => { state.jobs.clear(); await persistHistory(); renderJobs(); };
  $('chooseFolder').onclick = async () => { const value = await window.desktop.chooseDestination(); if (value) $('destination').value = value; };
  $('saveSettings').onclick = async event => { event.preventDefault(); state.settings = await window.desktop.saveSettings({ theme: $('theme').value, destination: $('destination').value, updateUrl: $('updateUrl').value.trim(), browserCookies: $('cookies').value }); applyTheme(state.settings.theme); $('settingsDialog').close(); };
  $('updateEngines').onclick = updateEngines; $('repairEngines').onclick = repairEngines;
  $('checkUpdate').onclick = checkUpdate; $('installUpdate').onclick = installUpdate;
  $('connectTelegram').onclick = connectTelegram;
  $('disconnectTelegram').onclick = disconnectTelegram;
  const dropZone = $('dropZone');
  ['dragenter','dragover'].forEach(name => dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave','drop'].forEach(name => dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', e => { const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'); if (text) { $('url').value = text.trim().split(/\s/)[0]; refreshClearUrlButton(); analyze(); } });
}

function refreshClearUrlButton() { $('clearUrlButton').classList.toggle('hidden', !$('url').value); }
function clearUrl() {
  state.analysisId += 1;
  state.metadata = null;
  $('url').value = '';
  $('thumbnail').removeAttribute('src');
  $('mediaTitle').textContent = '';
  $('mediaMeta').textContent = '';
  $('mediaPreview').classList.add('hidden');
  $('analyzeButton').disabled = false;
  $('downloadButton').disabled = true;
  refreshClearUrlButton();
  setMessage('Analiza un enlace para comenzar.');
  $('url').focus();
}

async function chooseQuickFolder() { const value = await window.desktop.chooseDestination(); if (!value) return; state.settings = await window.desktop.saveSettings({ destination: value }); $('savePath').textContent = value; $('destination').value = value; }
function scrollToActivity() { requestAnimationFrame(() => document.querySelector('.downloads-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
async function pasteAndDownload() { try { $('url').value = await navigator.clipboard.readText(); refreshClearUrlButton(); await analyze(); if (state.metadata) await startDownload(); } catch (error) { setMessage(errorText(error), true); } }
async function startBatch() {
  const urls = $('batchUrls').value.split(/\r?\n/).map(value => value.trim()).filter(value => /^https?:\/\//i.test(value));
  if (!urls.length) return;
  $('startBatch').disabled = true;
  let added = 0;
  for (const url of urls) {
    try { await window.desktop.startDownload({ url, destination: state.settings.destination, browserCookies: state.settings.browserCookies, mode: state.mode, videoQuality: state.mode === 'video' ? $('quality').value : undefined, container: state.mode === 'video' ? $('container').value : undefined, audioFormat: state.mode === 'audio' ? $('quality').value : undefined, audioQuality: state.mode === 'audio' ? $('container').value : undefined }); added += 1; }
    catch (error) { setMessage(`${url}: ${errorText(error)}`, true); }
  }
  $('startBatch').disabled = false; $('batchDialog').close(); $('batchUrls').value = '';
  if (added) scrollToActivity();
}

async function refreshTelegram() {
  try {
    const status = await window.desktop.telegramStatus();
    $('telegramStatus').textContent = status.connected ? `Conectado como ${status.profile.name} · ${status.profile.phone}` : 'No conectado';
    $('telegramFields').classList.toggle('hidden', status.connected);
    $('connectTelegram').classList.toggle('hidden', status.connected);
    $('disconnectTelegram').classList.toggle('hidden', !status.connected);
  } catch (error) {
    $('telegramStatus').textContent = `No se pudo consultar Telegram: ${errorText(error)}`;
  }
}
async function connectTelegram() {
  const credentials = { apiId: $('telegramApiId').value.trim(), apiHash: $('telegramApiHash').value.trim(), countryCode: '+51', phone: $('telegramPhone').value.trim() };
  $('telegramStatus').textContent = 'Conectando con Telegram…'; $('connectTelegram').disabled = true;
  try { await window.desktop.connectTelegram(credentials); await refreshTelegram(); $('telegramApiHash').value = ''; }
  catch (error) { $('telegramInlinePrompt').classList.add('hidden'); $('telegramStatus').textContent = `No se pudo conectar: ${errorText(error)}`; }
  finally { $('connectTelegram').disabled = false; }
}
async function disconnectTelegram() { $('telegramStatus').textContent = 'Desconectando…'; await window.desktop.disconnectTelegram(); await refreshTelegram(); }
function showTelegramPrompt(prompt) {
  $('telegramInlineTitle').textContent = prompt.kind === 'password' ? 'Verificación en dos pasos' : 'Código de Telegram';
  $('telegramInlineLabel').textContent = prompt.kind === 'password' ? 'Contraseña' : 'Código';
  $('telegramInlineValue').type = prompt.kind === 'password' ? 'password' : 'text';
  $('telegramInlineValue').value = ''; $('telegramInlineMessage').textContent = prompt.message;
  $('telegramInlinePrompt').classList.remove('hidden'); $('telegramInlineValue').focus();
  $('telegramInlineSubmit').onclick = () => { const value = $('telegramInlineValue').value.trim(); if (!value) return; window.desktop.answerTelegramPrompt({ requestId: prompt.requestId, value }); $('telegramInlinePrompt').classList.add('hidden'); };
}

function setMode(mode) {
  state.mode = mode;
  $('mediaOptions').classList.toggle('video-mode', mode === 'video');
  document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  if (mode === 'audio') {
    $('qualityLabel').textContent = 'Formato de audio';
    $('quality').innerHTML = '<option value="mp3">MP3</option><option value="m4a">M4A</option><option value="flac">FLAC</option><option value="opus">Opus</option>';
    $('containerLabel').textContent = 'Calidad de Audio';
    $('container').innerHTML = '<option value="0">Mejor calidad disponible</option><option value="512K">512 kbps</option><option value="448K">448 kbps</option><option value="384K">384 kbps</option><option value="320K">320 kbps</option><option value="256K">256 kbps</option><option value="192K">192 kbps</option><option value="128K">128 kbps</option><option value="96K">96 kbps</option><option value="80K">80 kbps</option>';
  } else {
    $('qualityLabel').textContent = 'Calidad de video';
    $('quality').innerHTML = '<option value="best">Mejor calidad disponible</option><option value="4320">Hasta 8K (4320p)</option><option value="2160">Hasta 4K (2160p)</option><option value="1440">Hasta 2K (1440p)</option><option value="1080">Hasta 1080p</option><option value="720">Hasta 720p</option><option value="480">Hasta 480p</option><option value="360">Hasta 360p</option>';
    $('containerLabel').textContent = 'Formato de Video';
    $('container').innerHTML = '<option value="mp4">MP4</option><option value="mkv">MKV</option><option value="webm">WebM</option>';
  }
  refreshSummary();
}
function refreshSummary() { $('formatSummary').textContent = state.mode === 'audio' ? `${$('quality').value.toUpperCase()} · Audio` : `${$('quality').selectedOptions[0].textContent} · ${$('container').value.toUpperCase()}`; }

async function analyze() {
  const url = $('url').value.trim(); if (!url) return setMessage('Pega un enlace primero.', true);
  const analysisId = ++state.analysisId;
  $('analyzeButton').disabled = true; setMessage('Analizando el enlace y consultando formatos…');
  try {
    const metadata = await window.desktop.metadata(url, state.settings.browserCookies);
    if (analysisId !== state.analysisId) return;
    state.metadata = metadata;
    $('mediaTitle').textContent = state.metadata.title || 'Contenido multimedia';
    $('mediaMeta').textContent = [state.metadata.uploader, state.metadata.duration_string].filter(Boolean).join(' · ');
    if (state.metadata.thumbnail) $('thumbnail').src = state.metadata.thumbnail;
    $('mediaPreview').classList.remove('hidden'); $('downloadButton').disabled = false; setMessage('Listo para descargar.');
  } catch (error) { if (analysisId === state.analysisId) { state.metadata = null; $('downloadButton').disabled = true; setMessage(errorText(error), true); } }
  finally { $('analyzeButton').disabled = false; }
}

async function pasteAndAnalyze() {
  try {
    const clipboardText = (await navigator.clipboard.readText()).trim();
    if (!clipboardText) return setMessage('El portapapeles no contiene ningún enlace.', true);
    $('url').value = clipboardText;
    refreshClearUrlButton();
    await analyze();
  } catch (error) {
    setMessage(`No se pudo leer el portapapeles: ${errorText(error)}`, true);
  }
}

async function startDownload() {
  const job = { url: $('url').value.trim(), title: state.metadata?.title, destination: state.settings.destination, browserCookies: state.settings.browserCookies, mode: state.mode };
  if (state.mode === 'audio') { job.audioFormat = $('quality').value; job.audioQuality = $('container').value; }
  else { job.videoQuality = $('quality').value; job.container = $('container').value; }
  $('downloadButton').disabled = true;
  try { await window.desktop.startDownload(job); setMessage('Descarga añadida a la cola.'); scrollToActivity(); }
  catch (error) { setMessage(errorText(error), true); }
  finally { $('downloadButton').disabled = false; }
}

async function updateJob(event) {
  const existing = state.jobs.get(event.id) || {}; state.jobs.set(event.id, { ...existing, ...event });
  if (event.state && event.state !== 'downloading') await persistHistory();
  renderJobs();
}

async function persistHistory() { const history = [...state.jobs.values()].filter(job => job.state !== 'downloading').slice(-50); state.settings = await window.desktop.saveSettings({ history }); }
async function removeDownloadedFile(job) {
  try {
    const result = await window.desktop.trashItem(job.filePath);
    state.jobs.delete(job.id);
    await persistHistory();
    renderJobs();
    showToast(result?.existed === false ? 'No existe el archivo. Se quitó de la actividad.' : 'Archivo enviado a la Papelera.');
  } catch (error) {
    showToast(`No se pudo eliminar el archivo: ${errorText(error)}`, true);
  }
}
function renderJobs() {
  $('downloadList').innerHTML = '';
  if (!state.jobs.size) { $('downloadList').innerHTML = '<div class="empty">La cola está vacía. Tu primera descarga aparecerá aquí.</div>'; return; }
  [...state.jobs.values()].reverse().forEach(job => {
    const row = document.createElement('div'); row.className = `job ${job.state === 'completed' ? 'success' : ''}`;
    const safeTitle = document.createElement('div'); safeTitle.className = 'job-title'; safeTitle.textContent = job.title || 'Descarga';
    const top = document.createElement('div'); top.className = 'job-top'; top.append(safeTitle);
    const status = document.createElement('small'); status.textContent = job.error || ({ downloading:'Descargando',completed:'Completado',failed:'Error',cancelled:'Cancelado' })[job.state] || job.state; top.append(status);
    const progress = document.createElement('div'); progress.className = 'progress'; const bar = document.createElement('i'); bar.style.width = `${job.progress || 0}%`; progress.append(bar);
    const actions = document.createElement('div'); actions.className = 'job-actions'; const detail = document.createElement('small'); detail.textContent = job.speed ? `${job.speed} · ${job.eta || ''}` : `${Math.round(job.progress || 0)}%`; actions.append(detail);
    const buttons = document.createElement('div'); buttons.className = 'job-buttons';
    if (job.state === 'downloading') { const cancel = document.createElement('button'); cancel.className = 'text-button'; cancel.textContent = 'Cancelar'; cancel.onclick = () => window.desktop.cancelDownload(job.id); buttons.append(cancel); }
    if (job.filePath) { const show = document.createElement('button'); show.className = 'text-button'; show.textContent = 'Mostrar'; show.onclick = () => window.desktop.showItem(job.filePath); buttons.append(show); const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = 'Eliminar'; remove.onclick = () => removeDownloadedFile(job); buttons.append(remove); }
    actions.append(buttons);
    row.append(top, progress, actions); $('downloadList').append(row);
  });
}

function renderSettings() { $('theme').value = state.settings.theme; $('destination').value = state.settings.destination; $('savePath').textContent = state.settings.destination; $('updateUrl').value = state.settings.updateUrl || ''; $('cookies').value = state.settings.browserCookies || 'none'; }
async function refreshEngines() { const s = await window.desktop.engineStatus(); $('engineStatus').innerHTML = `Estado: <b>${s.ytdlp && s.ffmpeg && s.deno ? 'Listo para descargar' : 'Requiere reparación'}</b><br>yt-dlp: <b>${s.ytdlp || 'no instalado'}</b><br>FFmpeg: <b>${s.ffmpeg || 'no detectado'}</b><br>Deno: <b>${s.deno || 'no detectado'}</b><br>AMD AMF: <b>${s.amdAmf ? 'Disponible (H.264/H.265/AV1 según GPU)' : 'No detectado; alternativa CPU disponible'}</b><br>Modo autónomo: <b>${s.portable ? 'Sí, motores incluidos' : 'No'}</b>`; }
async function updateEngines() { $('engineStatus').textContent = 'Actualizando yt-dlp, FFmpeg y Deno. La primera actualización puede tardar varios minutos…'; $('updateEngines').disabled = true; try { await window.desktop.updateEngines(); await refreshEngines(); } catch (e) { $('engineStatus').textContent = errorText(e); } finally { $('updateEngines').disabled = false; } }
async function repairEngines() { await window.desktop.repairEngines(); $('engineStatus').textContent = 'Se abrió el instalador de FFmpeg. Al terminar, reinicia la aplicación.'; }
async function checkUpdate(silent = false) { $('updateStatus').textContent = 'Consultando GitHub Releases…'; $('installUpdate').disabled = true; try { state.update = await window.desktop.checkUpdate($('updateUrl').value.trim()); if (state.update.available) { $('updateStatus').textContent = `Nueva versión ${state.update.version} disponible (instalada: ${state.update.currentVersion}).`; $('installUpdate').disabled = !state.update.assetUrl; } else { $('updateStatus').textContent = `Ya tienes la versión más reciente (${state.update.currentVersion}).`; state.update = null; } } catch (e) { state.update = null; $('updateStatus').textContent = silent ? 'No hay una versión publicada en GitHub Releases todavía.' : errorText(e); $('installUpdate').disabled = true; } }
async function installUpdate() { if (!state.update) return; $('updateStatus').textContent = 'Preparando actualización…'; try { await window.desktop.installUpdate(state.update); } catch (e) { $('updateStatus').textContent = errorText(e); } }

init().catch(error => setMessage(errorText(error), true));
