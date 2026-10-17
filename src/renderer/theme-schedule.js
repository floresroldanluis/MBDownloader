'use strict';

(function exposeThemeSchedule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MBThemeSchedule = api;
})(typeof globalThis === 'undefined' ? null : globalThis, () => {
  function shouldUseDarkTheme(date = new Date()) {
    const minutes = (date.getHours() * 60) + date.getMinutes();
    return minutes < 330 || minutes >= 1110;
  }

  return { shouldUseDarkTheme };
});
