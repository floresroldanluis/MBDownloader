'use strict';

function telegramMediaDetails(message) {
  const document = message?.document || message?.media?.document || null;
  const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
  const named = attributes.find(attribute => typeof attribute?.fileName === 'string');
  const timed = attributes.find(attribute => Number.isFinite(Number(attribute?.duration)));

  return {
    name: named?.fileName || '',
    mimeType: typeof document?.mimeType === 'string' ? document.mimeType : '',
    duration: timed ? Number(timed.duration) : 0
  };
}

module.exports = { telegramMediaDetails };
