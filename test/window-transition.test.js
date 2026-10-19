'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WINDOW_TRANSITION, smoothStep } = require('../src/window-transition');

test('la transición de entrada es suave y la salida termina antes de cerrar', () => {
  assert.equal(WINDOW_TRANSITION.openingMs, 520);
  assert.equal(WINDOW_TRANSITION.closingMs, 360);
  assert.ok(WINDOW_TRANSITION.openingMs > WINDOW_TRANSITION.closingMs);
});

test('la curva de opacidad conserva los extremos y avanza sin saltos', () => {
  assert.equal(smoothStep(-1), 0);
  assert.equal(smoothStep(0), 0);
  assert.equal(smoothStep(0.5), 0.5);
  assert.equal(smoothStep(1), 1);
  assert.equal(smoothStep(2), 1);
  assert.ok(smoothStep(0.25) < smoothStep(0.5));
  assert.ok(smoothStep(0.75) > smoothStep(0.5));
});
