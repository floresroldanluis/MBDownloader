'use strict';

const WINDOW_TRANSITION = Object.freeze({
  openingMs: 520,
  closingMs: 360
});

function smoothStep(progress) {
  const value = Math.max(0, Math.min(1, progress));
  return value * value * (3 - (2 * value));
}

module.exports = { WINDOW_TRANSITION, smoothStep };
