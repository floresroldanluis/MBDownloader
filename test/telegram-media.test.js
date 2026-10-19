'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { telegramMediaDetails } = require('../src/telegram-media');

test('lee metadatos sin activar el descriptor defectuoso de Telegram', () => {
  const message = {
    document: { mimeType: 'video/mp4', attributes: [{ fileName: 'video.mp4' }, { duration: 125 }] },
    get file() { throw new TypeError("Right-hand side of 'instanceof' is not callable"); }
  };

  assert.deepEqual(telegramMediaDetails(message), { name: 'video.mp4', mimeType: 'video/mp4', duration: 125 });
});

test('acepta medios sin metadatos opcionales', () => {
  assert.deepEqual(telegramMediaDetails({ media: {} }), { name: '', mimeType: '', duration: 0 });
});
