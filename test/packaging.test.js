'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const packageConfig = require('../package.json');

test('empaqueta todas las dependencias locales del motor de Telegram', () => {
  assert.ok(packageConfig.build.asarUnpack.includes('src/telegram-*.js'));
  assert.ok(packageConfig.build.asarUnpack.includes('src/domain.js'));
  assert.ok(packageConfig.build.asarUnpack.includes('node_modules/**/*'));
  assert.equal(typeof packageConfig.dependencies.teleproto, 'string');
});

test('incluye un icono versionado para renovar accesos directos de Windows', () => {
  const icon = packageConfig.build.extraResources.find(resource => resource.from === 'build/icon.ico');
  assert.equal(icon?.to, `mb-downloader-${packageConfig.version}.ico`);
});
