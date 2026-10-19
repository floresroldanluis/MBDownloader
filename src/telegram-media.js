'use strict';

function telegramMediaDetails(message) {
  const document = message?.document || message?.media?.document || null;
  const attributes = Array.isArray(document?.attributes) ? document.attributes : [];
  const named = attributes.find(attribute => typeof attribute?.fileName === 'string');
  const timed = attributes.find(attribute => Number.isFinite(Number(attribute?.duration)));

  return {
    name: named?.fileName || '',
    mimeType: typeof document?.mimeType === 'string' ? document.mimeType : '',
    duration: timed ? Number(timed.duration) : 0,
    hasThumbnail: Array.isArray(document?.thumbs) && document.thumbs.length > 0
  };
}

function telegramEmbeddedThumbnail(message) {
  const document = message?.document || message?.media?.document || null;
  const thumbnails = Array.isArray(document?.thumbs) ? document.thumbs : [];
  const thumbnail = thumbnails.find(item => Buffer.isBuffer(item?.bytes) && item.bytes.length > 0);
  if (!thumbnail) return null;
  return { bytes: thumbnail.bytes, stripped: thumbnail.className === 'PhotoStrippedSize' || thumbnail.constructor?.name === 'PhotoStrippedSize' };
}

module.exports = { telegramMediaDetails, telegramEmbeddedThumbnail };
