/*
 * The showcase's tuning panel and diagnostics readout.
 *
 * The panel writes LiquidGlass.defaults (whole page) or LiquidGlass.update(el, …) (one picked
 * element) as a control moves, and keeps the CSS that reproduces those settings up to date for
 * "Copy CSS". Page-wide switches that live on <html> (preset, tone, refraction, transparency,
 * debug overlays) are read back from <html>, so the other switches on the page stay in step.
 * Chromatic aberration (dispersion) for the whole page is the same setting as the Accessibility
 * section's slider: LiquidGlass.setPreferences({ dispersion }), i.e. --glass-dispersion on <html>.
 * The diagnostics read LiquidGlass.capabilities, LiquidGlass.stats() and each element's tier.
 */
(() => {
  'use strict';

  const LG = window.LiquidGlass;
  if (!LG) return;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const html = document.documentElement;
  const tuner = $('#tuner');
  const num = (v, digits = 2) => String(+(+v).toFixed(digits));

  // Slider settings: how each value reads, and the custom property that sets it from CSS (keys
  // without one are JS-only for the whole page, and attributes on a single element).
  const SLIDERS = {
    refraction: { show: (v) => `${(+v).toFixed(2)}×`, css: '--glass-refraction' },
    bezel: { show: (v) => (v <= 3 ? 'auto' : `${v} px`), css: '--glass-bezel' },
    profile: { show: (v) => (+v).toFixed(1), attr: 'data-glass-profile' },
    dispersion: { show: (v) => (+v).toFixed(2), css: '--glass-dispersion' },
    blur: { show: (v) => `${v} px`, attr: 'data-glass-blur' },
    saturation: { show: (v) => `${(+v).toFixed(2)}×`, css: '--glass-saturation' },
    opacity: { show: (v) => `${Math.round(v * 100)}%`, css: '--glass-opacity' },
    highlight: { show: (v) => `${(+v).toFixed(2)}×`, css: '--glass-highlight' },
    edgeDark: { show: (v) => `${Math.round(v * 100)}%`, css: '--glass-edge-dark' },
  };
  // Names for glass in the picker and the diagnostics table, most specific first.
  const KINDS = [
    ['glass-bar', 'Bar'], ['glass-tabbar', 'Tab bar'], ['glass-tab-lens', 'Tab lens'], ['glass-group', 'Group'],
    ['glass-segmented-lens', 'Segment lens'], ['glass-segmented', 'Segmented'], ['glass-search-cancel', 'Cancel'],
    ['glass-search', 'Search'], ['glass-sheet', 'Sheet'], ['glass-menu', 'Menu'], ['glass-switch-thumb', 'Switch thumb'],
    ['glass-slider-knob', 'Slider knob'], ['glass-icon', 'Icon button'], ['glass-prominent', 'Prominent button'],
    ['glass-button', 'Button'],
  ];
  const sliders = $$('input[data-key]', tuner);
  const dial = $('#tuAngle'), dialOut = $('#tuAngleOut');

  let scope = 'page';
  let picked = null;
  let picking = false;
  // What the visitor changed, per scope: key → value. Only these reach the CSS output.
  const changes = { page: new Map(), element: new Map() };
  let syncing = false;

  /* ── Reading the current values ─────────────────────────────────────── */

  const rootOpacity = () => parseFloat(getComputedStyle(html).getPropertyValue('--glass-opacity')) || 0.14;
  /** The page-wide dispersion: setPreferences writes it as --glass-dispersion on <html>. */
  const pageDispersion = () => {
    const v = parseFloat(getComputedStyle(html).getPropertyValue('--glass-dispersion'));
    return Number.isFinite(v) ? v : LG.defaults.dispersion;
  };

  function currentValues() {
    const D = LG.defaults;
    const h = scope === 'element' && picked ? LG.get(picked) : null;
    const o = h?.o || {};
    const pick = (key, fallback) => o[key] ?? fallback;
    const bezel = pick('bezel', D.bezel);
    return {
      refraction: pick('refraction', D.refraction),
      bezel: bezel === 'auto' ? 3 : bezel,
      profile: pick('profile', D.profile),
      dispersion: h ? pick('dispersion', D.dispersion) : pageDispersion(),
      blur: pick('blur', D.blur),
      saturation: pick('saturation', D.saturation),
      opacity: h ? (o.opacity ?? (parseFloat(getComputedStyle(picked).getPropertyValue('--glass-fill-opacity')) || rootOpacity())) : rootOpacity(),
      highlight: pick('highlight', D.highlight),
      edgeDark: pick('edgeDark', D.edgeDark),
      lightAngle: pick('lightAngle', D.lightAngle),
      optics: pick('optics', D.optics),
      tone: h ? o.tone : html.getAttribute('data-glass-tone') || 'auto',
      tier: h ? o.tier : html.getAttribute('data-glass-transparency') === 'reduced' ? 'c' : html.getAttribute('data-glass-refraction') === 'off' ? 'b' : 'auto',
      preset: html.getAttribute('data-glass-preset') || 'ios26',
    };
  }

  function setRadio(name, value) {
    const input = $(`input[name="${name}"][value="${value}"]`, tuner);
    if (input && !input.checked) {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /** Moves every control to the current values without applying anything. */
  function syncControls() {
    syncing = true;
    const v = currentValues();
    for (const input of sliders) {
      const key = input.dataset.key;
      if (String(+input.value) !== String(v[key])) {
        input.value = v[key];
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      showValue(input);
    }
    setAngle(v.lightAngle);
    setRadio('tuOptics', v.optics);
    setRadio('tuTone', v.tone);
    setRadio('tuTier', v.tier);
    setRadio('tuPreset', v.preset);
    for (const input of $$('input[data-debug]', tuner)) {
      input.checked = (html.getAttribute('data-lg-debug') || '').split(/\s+/).includes(input.dataset.debug);
    }
    $('#tuTintLabel').textContent = scope === 'element' ? 'Tint' : 'Accent';
    for (const input of $$('input[name="tuPreset"]', tuner)) input.disabled = scope === 'element';
    syncing = false;
  }

  const showValue = (input) => { input.closest('.sc-tune-row').querySelector('output').textContent = SLIDERS[input.dataset.key].show(+input.value); };

  /* ── Writing ────────────────────────────────────────────────────────── */

  function apply(key, value) {
    changes[scope].set(key, value);
    if (scope === 'element') {
      if (!picked) return;
      const option = key === 'bezel' && value <= 3 ? 'auto' : key === 'accent' ? null : value;
      LG.update(picked, key === 'accent' ? { tint: value } : { [key]: option });
    } else if (key === 'dispersion') {
      if (!value) changes.page.delete('dispersion'); // off is the default: nothing to export
      window.Showcase.setDispersion(value, tuner);
    } else if (key === 'bezel') LG.defaults.bezel = value <= 3 ? 'auto' : value;
    else if (key === 'blur') {
      LG.defaults.blur = value;          // Tier A frost
      LG.defaults.blurB = value * 3;     // Tier B frost keeps the preset's 1 : 3 ratio
    } else if (key === 'opacity') {
      html.style.setProperty('--glass-opacity', num(value));
      html.style.setProperty('--glass-opacity-dark', num(Math.min(1, value + 0.16)));
    } else if (key === 'accent') html.style.setProperty('--glass-accent', value);
    else if (key === 'tone') {
      if (value === 'auto') html.removeAttribute('data-glass-tone');
      else html.setAttribute('data-glass-tone', value);
    } else if (key === 'tier') {
      if (value === 'c') LG.setPreferences({ transparency: 'reduced' });
      else if (html.getAttribute('data-glass-transparency') === 'reduced') LG.setPreferences({ transparency: 'auto' });
      if (value === 'b') html.setAttribute('data-glass-refraction', 'off');
      else html.removeAttribute('data-glass-refraction');
    } else if (key === 'preset') {
      LG.setPreferences({ preset: value });
      queueMicrotask(syncControls); // untouched sliders move to the new preset's values
    } else LG.defaults[key] = value;
    writeCss();
  }

  // Map-changing settings (bezel, profile…) rebuild every glass on the page, so a dragged slider
  // applies at most every 90 ms, plus once when it stops.
  const pending = new Map();
  function applySoon(key, value) {
    const p = pending.get(key) || { timer: 0, last: 0 };
    pending.set(key, p);
    clearTimeout(p.timer);
    const run = () => { p.last = performance.now(); apply(key, value); };
    if (performance.now() - p.last > 90) run();
    else p.timer = setTimeout(run, 90);
  }

  function reset() {
    if (scope === 'element' && picked) {
      const undo = {};
      for (const key of changes.element.keys()) undo[key === 'accent' ? 'tint' : key] = undefined;
      LG.update(picked, undo);
      changes.element.clear();
    } else {
      for (const key of Object.keys(LG.defaults)) delete LG.defaults[key];
      for (const prop of ['--glass-opacity', '--glass-opacity-dark', '--glass-accent']) html.style.removeProperty(prop);
      html.removeAttribute('data-glass-tone');
      html.removeAttribute('data-glass-refraction');
      LG.setPreferences({ preset: 'ios26', transparency: 'auto' });
      window.Showcase.setDispersion(null, tuner);
      changes.page.clear();
      setRadio('tuTint', '#0a84ff');
    }
    queueMicrotask(() => { syncControls(); writeCss(); });
  }

  /* ── CSS output ─────────────────────────────────────────────────────── */

  function cssFor(map, element) {
    const vars = [], js = [], attrs = [];
    for (const [key, value] of map) {
      const s = SLIDERS[key];
      if (key === 'bezel') vars.push(`--glass-bezel: ${value <= 3 ? 'auto' : `${value}px`};`);
      else if (key === 'opacity') {
        // One element's fill holds in both tones, as LiquidGlass.update(el, { opacity }) does.
        if (element) vars.push(`--glass-fill-opacity: ${num(value)};`, `--glass-fill-opacity-dark: ${num(value)};`);
        else vars.push(`--glass-opacity: ${num(value)};`, `--glass-opacity-dark: ${num(Math.min(1, value + 0.16))};`);
      } else if (key === 'lightAngle') vars.push(`--glass-light-angle: ${Math.round(value)}deg;`);
      else if (key === 'accent' && element) attrs.push(`data-glass-tint="${value}"`);
      else if (key === 'accent') vars.push(`--glass-accent: ${value};`);
      else if (s?.css) vars.push(`${s.css}: ${num(value)};`);
      else if (element) attrs.push(`${s?.attr || `data-glass-${key}`}="${value}"`);
      else if (key === 'blur') js.push(`blur: ${num(value, 1)}, blurB: ${num(value * 3, 1)}`);
      else if (key === 'tone') attrs.push(value === 'auto' ? '' : `<html data-glass-tone="${value}">`);
      else if (key === 'tier') attrs.push(value === 'b' ? '<html data-glass-refraction="off">' : value === 'c' ? '<html data-glass-transparency="reduced">' : '');
      else if (key === 'preset') attrs.push(value === 'ios26' ? '' : `<html data-glass-preset="${value}">`);
      else js.push(`${key}: ${typeof value === 'string' ? `'${value}'` : num(value)}`);
    }
    return { vars, js, attrs: attrs.filter(Boolean) };
  }

  function cssText() {
    const element = scope === 'element' && picked;
    const { vars, js, attrs } = cssFor(changes[scope], element);
    if (!vars.length && !js.length && !attrs.length) return '/* Nothing changed yet: the defaults need no CSS. */';
    const out = ['/* Liquid Glass for the Web: tuned settings */'];
    // An element's rule needs a selector that matches it alone.
    const id = element && (picked.id || 'tuned-glass');
    if (element && !picked.id && vars.length) attrs.unshift(`id="${id}"`);
    if (vars.length) out.push(`${element ? `#${id}` : ':root'} {`, ...vars.map((v) => `  ${v}`), '}');
    if (attrs.length) out.push(`/* ${element ? 'On the element' : 'Markup'}: ${attrs.join(' ')} */`);
    if (js.length) out.push(`/* Script: Object.assign(LiquidGlass.defaults, { ${js.join(', ')} }); */`);
    return out.join('\n');
  }
  const writeCss = () => { $('#tuCss').textContent = cssText(); };

  /* ── Light-angle dial ───────────────────────────────────────────────── */

  const COMPASS = ['top', 'top right', 'right', 'bottom right', 'bottom', 'bottom left', 'left', 'top left'];
  function setAngle(deg) {
    const a = ((Math.round(deg) + 540) % 360) - 180;
    dial.style.setProperty('--angle', `${a}deg`);
    dial.setAttribute('aria-valuenow', a);
    dial.setAttribute('aria-valuetext', `${a}°, ${COMPASS[Math.round(((a + 360) % 360) / 45) % 8]}`);
    dialOut.textContent = `${a}°`;
    return a;
  }
  function startDial() {
    let dragging = false;
    const fromPointer = (e) => {
      const r = dial.getBoundingClientRect();
      const deg = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
      applySoon('lightAngle', setAngle(deg));
    };
    dial.addEventListener('pointerdown', (e) => { dragging = true; dial.setPointerCapture(e.pointerId); fromPointer(e); });
    dial.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
    dial.addEventListener('pointerup', () => { dragging = false; });
    dial.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 45, PageDown: -45 }[e.key];
      if (!step) return;
      e.preventDefault();
      applySoon('lightAngle', setAngle(+dial.getAttribute('aria-valuenow') + step));
    });
  }

  /* ── Picking one element ────────────────────────────────────────────── */

  function label(el) {
    const kind = KINDS.find(([cls]) => el.classList.contains(cls))?.[1] || (el.localName === 'glass-lens' ? 'Lens' : 'Glass');
    const named = el.getAttribute('aria-label') || document.getElementById(el.getAttribute('aria-labelledby'))?.textContent;
    const name = (named || el.textContent).trim().replace(/\s+/g, ' ').slice(0, 28);
    return name ? `${kind} · ${name}` : kind;
  }

  const showPicked = (on) => picked?.toggleAttribute('data-sc-picked', on);

  // Clicks outside the panel pick glass (or, on a phone, a miss cancels) and do nothing else.
  function startPicking() {
    const status = $('#tuPicked');
    // The modal sheet (phones) makes the page inert, so it steps aside until the pick is made.
    const modal = tuner.matches(':modal');
    picking = true;
    if (modal) tuner.close();
    status.textContent = 'Click any glass on the page. Esc cancels.';
    html.classList.add('sc-picking');
    const outside = (e) => !tuner.contains(e.target);
    const stop = (el) => {
      html.classList.remove('sc-picking');
      document.removeEventListener('pointerdown', swallow, true);
      document.removeEventListener('click', choose, true);
      document.removeEventListener('keydown', cancel, true);
      picking = false;
      if (el) {
        showPicked(false);
        picked = el;
        changes.element.clear();
        syncControls();
        writeCss();
      }
      showPicked(true);
      status.textContent = picked ? label(picked) : 'Nothing picked yet.';
      if (modal) tuner.showModal();
    };
    const target = (e) => {
      const el = e.target.closest?.('.glass, glass-lens');
      return el && LG.get(el) ? el : null;
    };
    const swallow = (e) => { if (outside(e)) { e.preventDefault(); e.stopPropagation(); } };
    const choose = (e) => {
      if (!outside(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const el = target(e);
      if (el || modal) stop(el);
    };
    const cancel = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      stop(null);
    };
    document.addEventListener('pointerdown', swallow, true);
    document.addEventListener('click', choose, true);
    document.addEventListener('keydown', cancel, true);
  }

  /* ── Panel ──────────────────────────────────────────────────────────── */

  function startTuner() {
    for (const input of sliders) {
      input.addEventListener('input', () => {
        showValue(input);
        if (syncing) return;
        // Chromatic aberration is a preference (no rebuilds): it applies on every step.
        if (input.dataset.key === 'dispersion' && scope === 'page') apply('dispersion', +input.value);
        else applySoon(input.dataset.key, +input.value);
      });
    }
    // The Accessibility section's slider moved: the page-wide value (and "Copy CSS") follow.
    window.Showcase.onDispersion = (v, from) => {
      if (from === tuner) return;
      if (v) changes.page.set('dispersion', v); else changes.page.delete('dispersion');
      if (scope === 'page' && tuner.open) syncControls();
      writeCss();
    };
    const radios = { tuOptics: 'optics', tuTone: 'tone', tuTier: 'tier', tuPreset: 'preset' };
    for (const [name, key] of Object.entries(radios)) {
      for (const r of $$(`input[name="${name}"]`, tuner)) r.addEventListener('change', () => { if (!syncing && r.checked) apply(key, r.value); });
    }
    for (const r of $$('input[name="tuTint"]', tuner)) r.addEventListener('change', () => { if (r.checked) apply('accent', r.value); });
    $('#tuTintCustom').addEventListener('input', (e) => {
      for (const r of $$('input[name="tuTint"]', tuner)) r.checked = false;
      applySoon('accent', e.target.value);
    });
    for (const r of $$('input[name="tuScope"]', tuner)) {
      r.addEventListener('change', () => {
        scope = r.value;
        $('#tuPickRow').hidden = scope !== 'element';
        showPicked(scope === 'element');
        syncControls();
        writeCss();
      });
    }
    $('#tuPick').addEventListener('click', startPicking);
    for (const input of $$('input[data-debug]', tuner)) {
      input.addEventListener('change', () => window.Showcase.setDebug(input.dataset.debug, input.checked));
    }
    $('#tuAnimate').addEventListener('change', (e) => window.Showcase.setArtAnimation(e.target.checked));
    $('#tuReset').addEventListener('click', reset);
    $('#tuCopy').addEventListener('click', (e) => window.Showcase.copyText(cssText(), e.currentTarget));
    startDial();

    // Bottom sheet (modal) on phones, a floating panel beside the page elsewhere.
    const phone = matchMedia('(max-width: 599.98px)');
    window.Showcase.openTuner = () => {
      if (tuner.open) { tuner.requestClose ? tuner.requestClose() : tuner.close(); return; }
      syncControls();
      writeCss();
      if (phone.matches) tuner.showModal();
      else tuner.show();
      showPicked(scope === 'element');
    };
    tuner.addEventListener('close', () => { if (!picking) showPicked(false); });
    // Glass on the panel takes the panel's tone: its own sampling would look through the panel.
    const matchPanelTone = () => {
      for (const g of $$('.glass-segmented, .glass-button', tuner)) g.setAttribute('data-glass-tone', tuner.dataset.lgTone || 'auto');
    };
    new MutationObserver(matchPanelTone).observe(tuner, { attributes: true, attributeFilter: ['data-lg-tone'] });
    matchPanelTone();
    new MutationObserver(() => { if (tuner.open && !syncing) syncControls(); })
      .observe(html, { attributes: true, attributeFilter: ['data-glass-preset', 'data-glass-tone', 'data-glass-refraction', 'data-glass-transparency', 'data-lg-debug'] });
  }

  /* ── Diagnostics ────────────────────────────────────────────────────── */

  const BUDGET = () => (LG.capabilities.coarse ? 4 : 8);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
  const ms = (v) => (v == null ? '–' : `${Math.round(v)} ms`);
  const onOff = (v) => (v ? 'On' : 'Off');

  function rowsOf(list, rows) {
    list.replaceChildren(...rows.map(([k, v]) => {
      const div = document.createElement('div');
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      div.append(dt, dd);
      return div;
    }));
  }

  function engineName(caps) {
    if (caps.engine === 'blink') return `Chromium ${caps.blinkMajor || ''}`.trim();
    if (caps.engine === 'webkit') return caps.safariVersion ? `WebKit · Safari ${caps.safariVersion}` : 'WebKit';
    if (caps.engine === 'gecko') return 'Gecko · Firefox';
    return 'Unknown';
  }

  function renderDiagnostics() {
    const caps = LG.capabilities, s = LG.stats(), perf = window.Showcase?.perf || {};
    const mode = html.dataset.scEngine;
    rowsOf($('#diagEnv'), [
      ['Engine', engineName(caps)],
      ['Rendering', mode === 'a' ? 'Live refraction' : mode === 'c' ? 'Solid (accessibility)' : 'Frosted'],
      ['Pixel ratio', `${num(caps.dpr)}×`],
      ['Colour', caps.p3 ? 'Display P3' : 'sRGB'],
      ['Pointer', caps.coarse ? 'Touch' : 'Mouse or trackpad'],
      ['Preset', html.getAttribute('data-glass-preset') || 'ios26'],
      ['Reduce Motion', onOff(caps.reducedMotion || html.getAttribute('data-glass-motion') === 'reduced')],
      ['Reduce Transparency', caps.reducedTransparencySupported || html.hasAttribute('data-glass-transparency') ? onOff(caps.reducedTransparency || html.getAttribute('data-glass-transparency') === 'reduced') : 'Not reported'],
      ['Increase Contrast', onOff(caps.contrastMore || html.getAttribute('data-glass-contrast') === 'more')],
    ]);
    const builds = s.lastBuildMs || [];
    const long = perf.longTasks || [];
    // The budget also holds glass just outside the viewport, so this counts what is on screen.
    const onScreen = (el) => { const r = el.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const refracting = $$('[data-lg-tier="a"]').filter((el) => ['ok', 'forced', 'interacting', 'held', 'lifted'].includes(LG.get(el)?.tierReason) && onScreen(el)).length;
    rowsOf($('#diagCost'), [
      ['Refracting on screen', `${refracting} · budget ${BUDGET()}`],
      ['Glass elements', String(s.instances)],
      ['Cached maps · overlays', `${s.maps} · ${s.overlays}`],
      ['SVG filters', String(s.filters)],
      ['Recent map builds', builds.length ? `${builds.length} · median ${num(median(builds), 1)} ms · max ${num(Math.max(...builds), 1)} ms` : 'none yet'],
      ['First glass ready', ms(perf.firstReady)],
      ['Page art', perf.art?.length ? `${perf.art.length} canvases · ${Math.round(perf.art.reduce((a, b) => a + b.ms, 0))} ms` : '–'],
      ['Long tasks', long.length ? `${long.length} · longest ${Math.round(Math.max(...long))} ms` : 'none'],
    ]);

    const inView = $('#diagInView').checked;
    const rows = $$('[data-lg-tier]').filter((el) => !inView || onScreen(el)).map((el) => {
      const section = el.closest('dialog')?.id || el.closest('section')?.id || (el.closest('.sc-nav, #navmenu') ? 'nav' : el.closest('footer') ? 'footer' : '');
      const tr = document.createElement('tr');
      const cells = [label(el), section, null, LG.get(el)?.tierReason || ''];
      for (const [i, text] of cells.entries()) {
        const td = document.createElement('td');
        if (i === 2) {
          const tier = el.getAttribute('data-lens-tier') || el.dataset.lgTier;
          const span = document.createElement('span');
          span.className = `sc-tier sc-tier-${tier === 'w' ? 'a' : tier}`;
          span.textContent = tier.toUpperCase();
          td.append(span);
        } else td.textContent = text;
        tr.append(td);
      }
      return tr;
    });
    $('#diagRows').replaceChildren(...rows);
  }

  function startDiagnostics() {
    const panel = $('#diag');
    let timer = 0;
    const tick = () => { renderDiagnostics(); timer = setTimeout(tick, 1000); };
    new IntersectionObserver(([e]) => {
      clearTimeout(timer);
      if (e.isIntersecting) tick();
    }).observe(panel);
    $('#diagInView').addEventListener('change', renderDiagnostics);
    if (new URLSearchParams(location.search).has('freeze')) setTimeout(renderDiagnostics, 1500);
  }

  function start() {
    startTuner();
    startDiagnostics();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
