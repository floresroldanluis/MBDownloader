'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldUseDarkTheme } = require('../src/renderer/theme-schedule');

function localTime(hours, minutes) {
  return new Date(2026, 9, 17, hours, minutes, 0, 0);
}

test('usa modo claro desde las 05:30 hasta antes de las 18:30', () => {
  assert.equal(shouldUseDarkTheme(localTime(5, 30)), false);
  assert.equal(shouldUseDarkTheme(localTime(12, 0)), false);
  assert.equal(shouldUseDarkTheme(localTime(18, 29)), false);
});

test('usa modo oscuro desde las 18:30 hasta antes de las 05:30', () => {
  assert.equal(shouldUseDarkTheme(localTime(18, 30)), true);
  assert.equal(shouldUseDarkTheme(localTime(23, 59)), true);
  assert.equal(shouldUseDarkTheme(localTime(5, 29)), true);
});
