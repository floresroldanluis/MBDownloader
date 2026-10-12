'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { telegramErrorText } = require('../src/telegram-errors');

test('traduce código de inicio de sesión incorrecto', () => {
  assert.match(telegramErrorText(new Error('PHONE_CODE_INVALID')), /código de inicio de sesión es incorrecto/i);
});

test('traduce contraseña de dos pasos incorrecta', () => {
  assert.match(telegramErrorText({ errorMessage: 'PASSWORD_HASH_INVALID' }), /contraseña.*incorrecta/i);
});

test('explica una autorización cancelada', () => {
  assert.match(telegramErrorText('AUTH_USER_CANCEL'), /autorización fue cancelada/i);
});

test('traduce el tiempo de espera de Telegram', () => {
  assert.match(telegramErrorText('FLOOD_WAIT_42'), /42 segundos/i);
});
