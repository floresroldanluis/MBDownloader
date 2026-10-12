'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDownloadArgs, isDownloadUrl, usesTelegramEngine, parseGithubRepository } = require('../src/domain');

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
test('extrae propietario y repositorio de GitHub', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/acme/downloader/releases/latest'), { owner:'acme', repo:'downloader' });
  assert.equal(parseGithubRepository('https://example.com/acme/downloader'), null);
});

test('Telegram conectado solo intercepta enlaces de Telegram', () => {
  assert.equal(usesTelegramEngine('https://t.me/c/123/456', true), true);
  assert.equal(usesTelegramEngine('https://www.youtube.com/watch?v=abc', true), false);
  assert.equal(usesTelegramEngine('https://www.instagram.com/reel/abc', true), false);
  assert.equal(usesTelegramEngine('https://tiktok.com/@user/video/123', true), false);
});
