'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { telegramMediaDetails, telegramEmbeddedThumbnail } = require('../src/telegram-media');

test('lee metadatos sin activar el descriptor defectuoso de Telegram', () => {
  const message = {
    document: { mimeType: 'video/mp4', attributes: [{ fileName: 'video.mp4' }, { duration: 125 }], thumbs: [{ type: 'm' }] },
    get file() { throw new TypeError("Right-hand side of 'instanceof' is not callable"); }
  };

  assert.deepEqual(telegramMediaDetails(message), { name: 'video.mp4', mimeType: 'video/mp4', duration: 125, hasThumbnail: true });
});

test('acepta medios sin metadatos opcionales', () => {
  assert.deepEqual(telegramMediaDetails({ media: {} }), { name: '', mimeType: '', duration: 0, hasThumbnail: false });
});

test('extrae la miniatura embebida sin descargar el video', () => {
  const bytes = Buffer.from([1, 2, 3]);
  const result = telegramEmbeddedThumbnail({ document: { thumbs: [{ className: 'PhotoStrippedSize', bytes }] } });
  assert.equal(result.bytes, bytes);
  assert.equal(result.stripped, true);
});
