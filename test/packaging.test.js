'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const packageConfig = require('../package.json');

test('empaqueta todas las dependencias locales del motor de Telegram', () => {
  assert.ok(packageConfig.build.asarUnpack.includes('src/telegram-*.js'));
  assert.ok(packageConfig.build.asarUnpack.includes('src/domain.js'));
  assert.ok(packageConfig.build.asarUnpack.includes('node_modules/**/*'));
});
