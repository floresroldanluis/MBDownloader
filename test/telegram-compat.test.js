'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyTelegramCompatibility } = require('../src/telegram-compat');

test('evita instanceof contra una clase retirada del esquema de Telegram', () => {
  const Api = {};
  applyTelegramCompatibility(Api);

  assert.equal(typeof Api.FileLocationToBeDeprecated, 'function');
  assert.doesNotThrow(() => ({} instanceof Api.FileLocationToBeDeprecated));
});

test('conserva el constructor cuando el esquema de Telegram lo proporciona', () => {
  class ExistingFileLocation {}
  const Api = { FileLocationToBeDeprecated: ExistingFileLocation };

  applyTelegramCompatibility(Api);
  assert.equal(Api.FileLocationToBeDeprecated, ExistingFileLocation);
});
