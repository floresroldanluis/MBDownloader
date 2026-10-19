'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveDownloadedFile } = require('../src/downloaded-file');

test('encuentra el archivo final cuando cambió la extensión', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-show-'));
  const actual = path.join(directory, 'Mi video.mp4');
  fs.writeFileSync(actual, 'video');
  try {
    assert.equal(resolveDownloadedFile({ filePath: path.join(directory, 'Mi video.webm'), destination: directory, title: 'Mi video' }), actual);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('encuentra por título un nombre final generado por yt-dlp', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-show-'));
  const actual = path.join(directory, 'Dragon Ball episodio [12345].mp4');
  fs.writeFileSync(actual, 'video');
  try {
    assert.equal(resolveDownloadedFile({ filePath: path.join(directory, 'ruta-temporal.webm'), destination: directory, title: 'Dragon Ball episodio' }), actual);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('prioriza la carpeta de descargas actual frente a una ruta antigua del historial', () => {
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-downloads-'));
  const oldDestination = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-old-'));
  const actual = path.join(downloads, 'Video descargado [abc123].mp4');
  fs.writeFileSync(actual, 'video');
  try {
    assert.equal(resolveDownloadedFile({
      filePath: path.join(oldDestination, 'nombre-temporal.webm'),
      destination: downloads,
      fallbackDestination: oldDestination,
      title: 'Video descargado'
    }), actual);
  } finally {
    fs.rmSync(downloads, { recursive: true, force: true });
    fs.rmSync(oldDestination, { recursive: true, force: true });
  }
});
