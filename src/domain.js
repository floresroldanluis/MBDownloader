'use strict';

const path = require('node:path');

const VIDEO_FORMATS = {
  best: 'bv*+ba/b',
  '4320': 'bv*[height<=4320]+ba/b[height<=4320]',
  '2160': 'bv*[height<=2160]+ba/b[height<=2160]',
  '1440': 'bv*[height<=1440]+ba/b[height<=1440]',
  '1080': 'bv*[height<=1080]+ba/b[height<=1080]',
  '720': 'bv*[height<=720]+ba/b[height<=720]',
  '480': 'bv*[height<=480]+ba/b[height<=480]',
  '360': 'bv*[height<=360]+ba/b[height<=360]'
};

function isDownloadUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname);
  } catch { return false; }
}

function usesTelegramEngine(value, connected) {
  if (!connected) return false;
  try {
    const url = new URL(value);
    return ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me'].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

function safeFilenameTemplate() {
  return '%(title).180B [%(id)s].%(ext)s';
}

function buildDownloadArgs(job) {
  if (!isDownloadUrl(job.url)) throw new Error('El enlace no es una URL HTTP/HTTPS válida.');
  const output = path.join(job.destination, safeFilenameTemplate());
  const common = [
    '--newline', '--no-playlist', '--no-overwrites', '--windows-filenames',
    '--progress-template', 'download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
    '--print', 'after_move:filepath:%(filepath)s',
    '-o', output
  ];
  if (job.browserCookies && job.browserCookies !== 'none') common.push('--cookies-from-browser', job.browserCookies);
  if (job.mode === 'audio') {
    const codec = job.audioFormat || 'mp3';
    common.push('-x', '--audio-format', codec);
    if (codec === 'mp3') common.push('--audio-quality', job.audioQuality || '0');
  } else {
    common.push('-f', VIDEO_FORMATS[job.videoQuality] || VIDEO_FORMATS.best, '--merge-output-format', job.container || 'mp4');
  }
  common.push('--', job.url);
  return common;
}

function parseGithubRepository(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/i, '') };
  } catch { return null; }
}

module.exports = { buildDownloadArgs, isDownloadUrl, usesTelegramEngine, parseGithubRepository };
