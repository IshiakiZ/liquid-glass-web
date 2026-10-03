/*
 * Screenshot fixtures for the showcase (spec §8.4). Loaded before the library and does nothing
 * unless the URL asks for it:
 *   ?freeze        deterministic stills: frames come from a timer (virtual-time captures never run
 *                  requestAnimationFrame), CSS transitions and animations stop at a fixed frame
 *   ?theme=light|dark   force the page colour scheme
 * The library reads ?freeze, ?glass-tier, ?preset, ?tone and ?reduce itself (data-glass-url-overrides).
 */
(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const html = document.documentElement;

  const theme = params.get('theme');
  if (theme === 'light' || theme === 'dark') html.dataset.theme = theme;

  if (!params.has('freeze')) return;
  html.classList.add('sc-frozen');
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
  window.cancelAnimationFrame = (id) => clearTimeout(id);
  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { transition: none !important; }';
  document.head.append(style);
})();
