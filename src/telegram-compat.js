'use strict';

function applyTelegramCompatibility(Api) {
  if (!Api || typeof Api !== 'object') throw new TypeError('El esquema de Telegram no está disponible.');

  // teleproto 1.230 still uses this retired constructor in an instanceof check.
  // Defining a harmless sentinel keeps newer Telegram schemas from throwing.
  if (typeof Api.FileLocationToBeDeprecated !== 'function') {
    Api.FileLocationToBeDeprecated = class FileLocationToBeDeprecated {};
  }

  return Api;
}

module.exports = { applyTelegramCompatibility };
