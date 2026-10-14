'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDownloadArgs, classifyDownloadFailure, isDownloadUrl, usesTelegramEngine, parseGoogleDriveFileId, parseGoogleDriveMetadataHtml, parseGithubRepository } = require('../src/domain');

test('acepta solamente enlaces web válidos', () => {
  assert.equal(isDownloadUrl('https://example.com/video'), true);
  assert.equal(isDownloadUrl('file:///secret'), false);
  assert.equal(isDownloadUrl('no-es-url'), false);
});
test('construye descarga de video sin ejecutar la URL como opción', () => {
  const args = buildDownloadArgs({ url:'https://example.com/watch?v=1', destination:'C:\\Downloads', mode:'video', videoQuality:'1080', container:'mp4' });
  assert.ok(args.includes('--merge-output-format')); assert.equal(args.at(-2), '--'); assert.equal(args.at(-1), 'https://example.com/watch?v=1');
});
test('construye extracción de audio', () => {
  const args = buildDownloadArgs({ url:'https://example.com/a', destination:'C:\\Downloads', mode:'audio', audioFormat:'flac' });
  assert.ok(args.includes('-x')); assert.ok(args.includes('flac'));
});
test('activa archivos parciales para reanudar descargas', () => {
  const args = buildDownloadArgs({ url:'https://example.com/video', destination:'C:\\Downloads', mode:'video' });
  assert.ok(args.includes('--continue')); assert.ok(args.includes('--part'));
});
test('diagnostica fallos recuperables de red y disco', () => {
  assert.deepEqual(classifyDownloadFailure('ERROR: [WinError 10054] connection reset').kind, 'network');
  assert.deepEqual(classifyDownloadFailure('ENOSPC: no space left on device').kind, 'disk');
  assert.equal(classifyDownloadFailure('Requested format is not available').recoverable, false);
});
test('extrae propietario y repositorio de GitHub', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/acme/downloader/releases/latest'), { owner:'acme', repo:'downloader' });
  assert.equal(parseGithubRepository('https://example.com/acme/downloader'), null);
});

test('reconoce enlaces de archivo de Google Drive', () => {
  const id = '1Ng_53m2P2jHmRaeomN_sOd4wI9v70Yol';
  assert.equal(parseGoogleDriveFileId(`https://drive.google.com/file/d/${id}/view`), id);
  assert.equal(parseGoogleDriveFileId(`https://drive.usercontent.google.com/download?id=${id}&export=download`), id);
  assert.equal(parseGoogleDriveFileId('https://docs.google.com/document/d/example'), null);
});

test('extrae la vista previa pública de Google Drive sin yt-dlp', () => {
  const html = '<meta property="og:title" content="Mi video &amp; prueba.mkv"><script>itemJson: [null,"Mi video","https://drive.google.com/thumb\\u003ds1600-rw-v1",null,null,null,null,null,null,null,null,"video/x-matroska",null,null,0,null,"url",null,"download",null,5,0,null,null,null,[null,null,"2459419556"]]</script>';
  const result = parseGoogleDriveMetadataHtml(html, 'abc');
  assert.equal(result.title, 'Mi video & prueba.mkv');
  assert.equal(result.thumbnail, 'https://drive.google.com/thumb=s1600-rw-v1');
  assert.equal(result.filesize, 2459419556);
});

test('Telegram conectado solo intercepta enlaces de Telegram', () => {
  assert.equal(usesTelegramEngine('https://t.me/c/123/456', true), true);
  assert.equal(usesTelegramEngine('https://www.youtube.com/watch?v=abc', true), false);
  assert.equal(usesTelegramEngine('https://www.instagram.com/reel/abc', true), false);
  assert.equal(usesTelegramEngine('https://tiktok.com/@user/video/123', true), false);
});
