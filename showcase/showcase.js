/*
 * Showcase page behaviour. Every piece of glass on the page is plain markup that liquid-glass.js
 * enhances by itself; this file only adds the page's own demos: the procedural art, the live
 * content under glass, the draggable samples, the phone mock, the loupe, the accessibility
 * switches and the ?scroll fixture. tuner.js reads window.Showcase for load timings.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = (n) => String(n).padStart(2, '0');

  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  const FROZEN = params.has('freeze');
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const motionMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const LG = window.LiquidGlass;

  const pageDark = () => (html.dataset.theme ? html.dataset.theme === 'dark' : darkMQ.matches);
  const reducedMotion = () => motionMQ.matches || html.getAttribute('data-glass-motion') === 'reduced';

  // Load timings, read by the diagnostics panel. Listeners go in before the library initialises
  // (this deferred script runs before DOMContentLoaded).
  const perf = { firstReady: null, lastReady: null, longTasks: [], art: [] };
  window.Showcase = { perf };
  document.addEventListener('glass:ready', () => {
    const t = performance.now();
    perf.firstReady ??= t;
    perf.lastReady = t;
  }, true);
  try {
    new PerformanceObserver((list) => perf.longTasks.push(...list.getEntries().map((e) => e.duration)))
      .observe({ type: 'longtask', buffered: true });
  } catch { /* long tasks are not reported in this browser */ }

  /* ── Procedural art ─────────────────────────────────────────────────── */

  // Each canvas[data-art] mounts as it nears the viewport, one per idle slice, so loading never
  // stacks several renders into one long task. data-theme pins a theme (its stage then pins
  // color-scheme in the markup); otherwise the art follows the page's colour scheme. The glass
  // samples each canvas for its tone, so the stages carry no data-glass-backdrop hints; before it
  // can, the stage's placeholder colours (data-resolved, showcase.css) give it a first tone.
  const art = new Map();
  const artTheme = (canvas) => canvas.dataset.theme || (pageDark() ? 'dark' : 'light');
  let animateArt = false;

  function applyArtScheme(canvas) {
    canvas.dataset.resolved = artTheme(canvas);
    return canvas.dataset.resolved;
  }

  function mountArt(canvas) {
    if (art.has(canvas)) return;
    const opts = { seed: canvas.dataset.seed || 1, theme: applyArtScheme(canvas), animate: animateArt };
    if ('word' in canvas.dataset) opts.word = canvas.dataset.word;
    if (canvas.dataset.columns) opts.columns = +canvas.dataset.columns;
    const handle = LGArt.mount(canvas, canvas.dataset.art, opts);
    art.set(canvas, handle);
    if (handle.info) perf.art.push({ name: canvas.dataset.art, ms: handle.info.ms });
    syncLensSources(canvas);
  }

  // A lens reads a canvas source's pixels when it cannot refract the live page (WebGL, outside
  // Chromium), so it is pointed at the canvas once there is something painted on it, and asked to
  // re-read it after every repaint.
  function syncLensSources(canvas) {
    if (!canvas.id) return;
    for (const lens of $$(`glass-lens[data-source="#${canvas.id}"]`)) {
      if (lens.getAttribute('source')) lens.refresh?.();
      else lens.setAttribute('source', lens.dataset.source);
    }
  }

  const idle = window.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 250 })
    : (fn) => setTimeout(fn, 16);
  const artQueue = [];
  let pumping = false;
  function pumpArt() {
    if (pumping || !artQueue.length) return;
    pumping = true;
    idle(() => {
      pumping = false;
      mountArt(artQueue.shift());
      pumpArt();
    });
  }
  const artIO = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      artIO.unobserve(e.target);
      artQueue.push(e.target);
    }
    pumpArt();
  }, { rootMargin: '100% 0px' });

  function startArt() {
    const canvases = $$('canvas[data-art]');
    canvases.forEach(applyArtScheme);
    const first = [$('.sc-hero-art'), $('.sc-cover')];
    first.forEach(mountArt);
    for (const c of canvases) {
      if (first.includes(c)) continue;
      if (FROZEN) mountArt(c); // stills: virtual time delivers no observer callbacks
      else artIO.observe(c);
    }
  }

  function onSchemeChange() {
    for (const c of $$('canvas[data-art]')) {
      const theme = applyArtScheme(c);
      if (!art.has(c)) continue;
      art.get(c).set({ theme });
      syncLensSources(c);
    }
    LG?.refresh(); // large glass takes its tone from color-scheme
  }

  window.Showcase.setArtAnimation = (on) => {
    animateArt = on;
    for (const h of art.values()) (on ? h.start() : h.stop());
  };

  // Hero parallax: the art scrolls at 0.6× the page, so the glass over it keeps lensing new detail.
  function startParallax() {
    const hero = $('.sc-hero'), canvas = $('.sc-hero-art');
    let queued = false;
    const update = () => {
      queued = false;
      const y = scrollY;
      if (y > hero.offsetHeight) return;
      canvas.style.transform = reducedMotion() ? '' : `translate3d(0, ${(y * 0.4).toFixed(1)}px, 0)`;
    };
    addEventListener('scroll', () => {
      if (!queued) { queued = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  /* ── Navigation ─────────────────────────────────────────────────────── */

  // Marks the nav link of the section in the middle of the viewport.
  function startNavHighlight() {
    const links = new Map($$('.sc-navlinks a').map((a) => [a.hash.slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const link = links.get(e.target.id);
        if (e.isIntersecting) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }, { rootMargin: '-45% 0px -54% 0px' });
    for (const id of links.keys()) io.observe(document.getElementById(id));
  }

  /* ── Engine badge ───────────────────────────────────────────────────── */

  // What the page actually renders: 'a' live refraction, 'b' frosted, 'c' solid (accessibility).
  function engineMode() {
    const bar = LG?.get($('#nav'));
    if (!bar) return 'b';
    const tier = bar.staticTier ?? bar.tier;
    return tier === 'a' || tier === 'c' ? tier : 'b';
  }
  function engineText(mode) {
    if (mode === 'a') return 'Live refraction · Chromium';
    if (mode === 'c') return 'Solid glass · accessibility setting';
    const caps = LG?.capabilities;
    if (caps?.liveRefraction) return 'Frosted glass · refraction off';
    return `Frosted glass${{ blink: ' · older Chromium', webkit: ' · WebKit', gecko: ' · Firefox' }[caps?.engine] || ''}`;
  }
  function updateEngine() {
    const mode = engineMode();
    if (html.dataset.scEngine === mode) return;
    html.dataset.scEngine = mode;
    for (const el of $$('.sc-engine-text')) el.textContent = engineText(mode);
    const note = mode === 'b' && LG?.capabilities.liveRefraction ? 'b-off' : mode;
    for (const el of $$('.sc-engine-note')) el.hidden = el.dataset.mode !== note;
    const loupe = $('#loupeToggle');
    loupe.disabled = mode !== 'a';
    if (mode !== 'a') setLoupe(false);
  }

  // The hero's glass forms as the page opens: refraction, frost, highlights and shadow ramp in
  // together with the scale (the library's materialize), rather than fading in.
  function introHero() {
    if (FROZEN || !LG) return;
    for (const el of $$('.sc-cluster .glass')) LG.get(el)?.materialize({ scale: 0.9 });
  }

  /* ── Player card ────────────────────────────────────────────────────── */

  const time = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
  function startPlayer() {
    const card = $('.sc-player'), range = $('.sc-player-scrub input'), toggle = $('.sc-playpause');
    const elapsed = $('#tElapsed'), left = $('#tLeft');
    let holding = false, onScreen = true;
    const show = () => {
      const v = +range.value, max = +range.max;
      elapsed.textContent = time(v);
      left.textContent = `−${time(max - v)}`;
      range.setAttribute('aria-valuetext', `${time(v)} of ${time(max)}`);
    };
    range.addEventListener('input', show);
    range.parentElement.addEventListener('pointerdown', () => { holding = true; });
    addEventListener('pointerup', () => { holding = false; });
    toggle.addEventListener('click', () => {
      const playing = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(playing));
      toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      toggle.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    });
    new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(card);
    // "Playback": the knob glides forward once a second while the card is on screen.
    if (!FROZEN) setInterval(() => {
      if (!onScreen || holding || reducedMotion() || toggle.getAttribute('aria-pressed') !== 'true' || document.hidden) return;
      range.value = (+range.value + 1) % (+range.max + 1);
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }, 1000);
    show();
  }

  function startToggles() {
    for (const b of $$('button[aria-pressed][aria-label="Love"]')) {
      b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')));
    }
  }

  /* ── Over anything: live content under glass ────────────────────────── */

  function startClock() {
    const tile = $('.sc-tile-clock'), clock = $('#clock'), hm = $('.sc-clock-hm'), sec = $('.sc-clock-s');
    const date = $('#clockDate'), sweep = $('.sc-clock-sweep'), pill = $('.sc-live-pill');
    const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    let timer = 0, onScreen = false;

    const render = () => {
      const now = FROZEN ? new Date(2026, 8, 23, 9, 41, 7) : new Date();
      hm.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      sec.textContent = `:${pad(now.getSeconds())}`;
      clock.dateTime = `${hm.textContent}${sec.textContent}`;
      date.textContent = fmtDate.format(now);
      return now;
    };
    const loop = () => {
      const now = render();
      if (onScreen && !FROZEN) timer = setTimeout(loop, 1000 - now.getMilliseconds() + 5);
    };
    // The glass pill sits over the seconds, so they tick over beneath it.
    const placePill = () => {
      const t = tile.getBoundingClientRect(), s = sec.getBoundingClientRect();
      const h = s.height * 0.92, w = s.width + h * 0.35;
      Object.assign(pill.style, {
        left: `${s.left - t.left + (s.width - w) / 2}px`, top: `${s.top - t.top + (s.height - h) / 2}px`,
        width: `${w}px`, height: `${h}px`,
      });
    };
    new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      clearTimeout(timer);
      if (onScreen) {
        const now = render();
        sweep.style.animationDelay = `-${now.getSeconds() + now.getMilliseconds() / 1000}s`;
        loop();
      }
    }).observe(tile);
    new ResizeObserver(placePill).observe(tile);
    render();
    placePill();
    document.fonts?.ready.then(placePill);
  }

  // The typing tile types a few phrases by itself until the visitor takes over. The lens follows the
  // caret, so every new letter lands under the glass; a drag parks it until the next letter.
  function startTyping() {
    const area = $('#typeHere'), tile = $('.sc-tile-type'), lens = $('#typeLens');
    const mirror = document.createElement('div'), caret = document.createElement('span');
    mirror.className = 'sc-type-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    caret.textContent = '\u200b';
    area.after(mirror);
    const follow = (animate = !reducedMotion()) => {
      mirror.textContent = area.value.slice(0, area.selectionEnd);
      mirror.append(caret);
      const cs = getComputedStyle(area), size = lens.offsetWidth;
      const x = caret.offsetLeft - 0.3 * parseFloat(cs.fontSize);
      const y = caret.offsetTop - area.scrollTop + parseFloat(cs.lineHeight) / 2;
      lens.moveTo(x - size / 2, y - size / 2, { animate });
    };
    const type = (text) => { area.value = text; follow(); };
    const phrases = [
      'Every letter bends as it lands under the glass.',
      'Nothing here is a screenshot.',
      'Click here and type anything.',
    ];
    let userOwns = false, onScreen = false, timer = 0, phrase = 0, pos = 0, deleting = false;

    const step = () => {
      if (userOwns || !onScreen || reducedMotion()) return;
      const target = phrases[phrase];
      if (!deleting) {
        pos++;
        type(target.slice(0, pos));
        if (pos === target.length) { deleting = true; timer = setTimeout(step, 2600); return; }
        timer = setTimeout(step, 55 + Math.random() * 70);
      } else {
        pos = Math.max(0, pos - 3);
        type(target.slice(0, pos));
        if (pos === 0) { deleting = false; phrase = (phrase + 1) % phrases.length; timer = setTimeout(step, 500); return; }
        timer = setTimeout(step, 24);
      }
    };
    const takeOver = () => {
      if (userOwns) return;
      userOwns = true;
      clearTimeout(timer);
      type('');
      area.placeholder = 'Type anything…';
    };
    area.addEventListener('focus', takeOver);
    area.addEventListener('input', () => follow());
    new ResizeObserver(() => follow(false)).observe(tile);
    document.fonts?.ready.then(() => follow(false));
    if (FROZEN) return;
    new IntersectionObserver(([e]) => {
      onScreen = e.isIntersecting;
      clearTimeout(timer);
      if (onScreen && !userOwns) {
        pos = 0;
        deleting = false;
        timer = setTimeout(step, 600);
      }
    }, { threshold: 0.4 }).observe(tile);
  }

  /* ── Optics: draggable glass and toggles ────────────────────────────── */

  // Drag with a pointer, or the arrow keys when focused (Shift for bigger steps). The core owns the
  // `translate` and `scale` properties of glass (press, lift), so the drag writes `transform`.
  function draggable(el, stage) {
    let x = 0, y = 0, grab = null;
    const limits = () => ({
      x0: -el.offsetLeft, x1: stage.clientWidth - el.offsetLeft - el.offsetWidth,
      y0: -el.offsetTop, y1: stage.clientHeight - el.offsetTop - el.offsetHeight,
    });
    const moveTo = (nx, ny) => {
      const l = limits();
      x = clamp(nx, l.x0, l.x1);
      y = clamp(ny, l.y0, l.y1);
      el.style.transform = `translate(${x}px, ${y}px)`;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      grab = { id: e.pointerId, dx: e.clientX - x, dy: e.clientY - y };
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (grab?.id === e.pointerId) moveTo(e.clientX - grab.dx, e.clientY - grab.dy);
    });
    const end = (e) => {
      if (grab?.id !== e.pointerId) return;
      grab = null;
      el.classList.remove('is-dragging');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    el.addEventListener('keydown', (e) => {
      const d = ARROWS[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 40 : 10;
      moveTo(x + d[0] * step, y + d[1] * step);
    });
    new ResizeObserver(() => moveTo(x, y)).observe(stage);
  }

  // Debug overlays are one attribute on <html>; tuner.js shows the same switches.
  function setDebug(mode, on) {
    const modes = new Set((html.getAttribute('data-lg-debug') || '').split(/\s+/).filter(Boolean));
    if (on) modes.add(mode); else modes.delete(mode);
    if (modes.size) html.setAttribute('data-lg-debug', [...modes].join(' '));
    else html.removeAttribute('data-lg-debug');
  }
  window.Showcase.setDebug = setDebug;
  const debugOn = (mode) => (html.getAttribute('data-lg-debug') || '').split(/\s+/).includes(mode);

  function startOptics() {
    const stage = $('#opticsStage'), glass = $$('.sc-drag', stage);
    for (const el of glass) draggable(el, stage);
    $('#optRefraction').addEventListener('change', (e) => {
      for (const el of glass) {
        if (e.target.checked) el.removeAttribute('data-glass-refraction');
        else el.setAttribute('data-glass-refraction', 'off');
      }
    });
    for (const radio of $$('input[name="optOptics"]')) {
      radio.addEventListener('change', () => { for (const el of glass) el.dataset.glassOptics = radio.value; });
    }
    $('#optMap').addEventListener('change', (e) => setDebug('maps', e.target.checked));
    $('#optBezel').addEventListener('change', (e) => setDebug('bezel', e.target.checked));
  }

  /* ── Phone mock ─────────────────────────────────────────────────────── */

  function startPhone() {
    const phone = $('.sc-phone'), tabs = $('#phoneTabs');
    const sheet = $('#phoneSheet'), feed = $('#feed'), canvas = $('.sc-feed-art');
    // The tab bar minimizes as its content scrolls. The library also counts scrolling the page, so
    // here the behaviour is only switched on while the visitor is inside the phone, where the feed
    // is the only thing that scrolls.
    const minimize = (on) => (on ? tabs.setAttribute('data-glass-minimize', 'scroll') : tabs.removeAttribute('data-glass-minimize'));
    phone.addEventListener('pointerenter', () => minimize(true));
    phone.addEventListener('pointerleave', () => minimize(false));
    phone.addEventListener('focusin', () => minimize(true));
    phone.addEventListener('focusout', (e) => { if (!phone.contains(e.relatedTarget)) minimize(false); });

    // On a touch screen the feed scrolls only once the phone has been tapped (showcase.css), so a
    // swipe across the mock scrolls the page. It lets go on a tap elsewhere, or out of view.
    const activate = (on) => phone.toggleAttribute('data-active', on);
    phone.addEventListener('click', () => activate(true));
    phone.addEventListener('focusin', () => activate(true));
    addEventListener('pointerdown', (e) => { if (!phone.contains(e.target)) activate(false); });
    new IntersectionObserver(([e]) => { if (!e.isIntersecting) activate(false); }).observe(phone);

    $('#phoneQueue').addEventListener('click', () => {
      if (!sheet.open) sheet.show();
      else if (sheet.requestClose) sheet.requestClose();
      else sheet.close();
    });
    // A tab switches the feed: new title, new covers, back to the top.
    $('#phoneTabs').addEventListener('click', (e) => {
      const tab = e.target.closest('button[data-title]');
      if (!tab) return;
      $('#feedTitle').textContent = tab.dataset.title;
      art.get(canvas)?.set({ seed: tab.dataset.seed });
      feed.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    $('#feedKicker').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
      .format(FROZEN ? new Date(2026, 8, 23) : new Date());
  }

  /* ── Loupe ──────────────────────────────────────────────────────────── */

  // A page-wide lens that follows the pointer. Live refraction only: frosted glass over the whole
  // page would just blur it.
  let loupe = null;
  const followPointer = (e) => loupe.moveTo(e.clientX - 66, e.clientY - 66, { animate: !reducedMotion() });
  const loupeKeys = (e) => { if (e.key === 'Escape') setLoupe(false); };
  function setLoupe(on) {
    $('#loupeToggle').checked = on;
    if (on === !!loupe) return;
    if (on) {
      loupe = document.createElement('glass-lens');
      loupe.className = 'sc-loupe';
      loupe.setAttribute('size', '132');
      loupe.setAttribute('zoom', '1.5');
      loupe.setAttribute('dispersion', '0.6');
      loupe.setAttribute('aria-hidden', 'true');
      document.body.append(loupe);
      addEventListener('pointermove', followPointer, { passive: true });
      addEventListener('keydown', loupeKeys);
    } else {
      removeEventListener('pointermove', followPointer);
      removeEventListener('keydown', loupeKeys);
      loupe.remove();
      loupe = null;
    }
  }

  /* ── Droplets ───────────────────────────────────────────────────────── */

  // Drag a button toward its neighbours; it springs back to its slot on release.
  function startDroplets() {
    for (const b of $$('#drops .glass')) {
      let drag = null, back = null;
      b.addEventListener('pointerdown', (e) => {
        back?.stop();
        const m = new DOMMatrix(getComputedStyle(b).transform);
        drag = { id: e.pointerId, x: e.clientX - m.e, y: e.clientY - m.f };
        b.setPointerCapture(e.pointerId);
      });
      b.addEventListener('pointermove', (e) => {
        if (drag?.id === e.pointerId) b.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
      });
      const end = (e) => {
        if (drag?.id !== e.pointerId) return;
        drag = null;
        const m = new DOMMatrix(getComputedStyle(b).transform), x0 = m.e, y0 = m.f;
        back = LG.spring({ from: 1, to: 0, preset: 'unlift', onUpdate: (t) => { b.style.transform = t ? `translate(${x0 * t}px, ${y0 * t}px)` : ''; } });
      };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
    }
    const toggle = $('#dropToggle');
    toggle.addEventListener('click', () => {
      const collapse = toggle.getAttribute('aria-expanded') === 'true';
      for (const b of $$('#dropBar .sc-extra')) b.hidden = collapse;
      toggle.setAttribute('aria-expanded', String(!collapse));
      toggle.textContent = collapse ? 'Expand toolbar' : 'Collapse toolbar';
    });
  }

  /* ── Accessibility overrides ────────────────────────────────────────── */

  const PREF_ATTR = { transparency: 'data-glass-transparency', contrast: 'data-glass-contrast', motion: 'data-glass-motion' };
  function startPrefs() {
    const switches = $$('input[data-pref]');
    for (const input of switches) {
      input.addEventListener('change', () => LG.setPreferences({ [input.dataset.pref]: input.checked ? input.dataset.on : 'auto' }));
    }
    const tinted = $('#prefTinted');
    const showTinted = () => {
      const v = +tinted.value;
      tinted.setAttribute('aria-valuetext', v ? `${v < 0 ? 'Clear' : 'Tinted'} ${Math.round(Math.abs(v) * 100)}%` : 'Default');
    };
    tinted.addEventListener('input', () => {
      LG.setPreferences({ tinted: +tinted.value });
      showTinted();
    });
    showTinted();

    // Chromatic aberration: page-wide dispersion, shared with the tuner's slider (both call this).
    const dispersion = $('#prefDispersion');
    const showDispersion = () => {
      const v = +dispersion.value;
      dispersion.setAttribute('aria-valuetext', v ? `${Math.round(v * 100)}%` : 'Off');
    };
    let echoing = false; // an input event we dispatched ourselves, so the slider's knob follows
    window.Showcase.setDispersion = (v, from) => {
      LG.setPreferences({ dispersion: v }); // null: back to the page's own (none)
      if (from !== dispersion && +dispersion.value !== +v) {
        dispersion.value = +v;
        echoing = true;
        dispersion.dispatchEvent(new Event('input', { bubbles: true }));
        echoing = false;
      }
      showDispersion();
      window.Showcase.onDispersion?.(v, from);
    };
    dispersion.addEventListener('input', () => { if (!echoing) window.Showcase.setDispersion(+dispersion.value, dispersion); });
    showDispersion();

    const caps = LG.capabilities;
    const onOff = (v) => (v ? 'on' : 'off');
    $('#systemPrefs').textContent = `Detected from your system: Reduce Motion ${onOff(caps.reducedMotion)}, Increase Contrast ${onOff(caps.contrastMore)}, Reduce Transparency ${
      caps.reducedTransparencySupported ? onOff(caps.reducedTransparency) : 'not reported by this browser'}.`;

    // The switches mirror <html>, which the tuner and ?reduce= can change too.
    const sync = () => {
      for (const input of switches) input.checked = html.getAttribute(PREF_ATTR[input.dataset.pref]) === input.dataset.on;
      $('#optMap').checked = debugOn('maps');
      $('#optBezel').checked = debugOn('bezel');
      updateEngine();
    };
    new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: [...Object.values(PREF_ATTR), 'data-lg-debug', 'data-glass-refraction'] });
    sync();
  }

  /* ── Copy buttons ───────────────────────────────────────────────────── */

  async function copyText(text, button) {
    const label = button.querySelector('span'), icon = button.querySelector('use');
    const was = [label.textContent, icon.getAttribute('href')];
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = 'Copied';
      icon.setAttribute('href', '#i-check');
    } catch {
      label.textContent = 'Select and copy';
    }
    setTimeout(() => { label.textContent = was[0]; icon.setAttribute('href', was[1]); }, 1600);
  }
  window.Showcase.copyText = copyText;

  /* ── Start ──────────────────────────────────────────────────────────── */

  // ?scroll=N (px) or ?scroll=<section id>: the screenshot fixture.
  function applyScrollParam() {
    const s = params.get('scroll');
    if (!s) return;
    const top = /^\d+$/.test(s) ? +s : (document.getElementById(s)?.getBoundingClientRect().top ?? 0) + scrollY;
    scrollTo({ top, behavior: 'instant' });
  }

  function start() {
    perf.domReady = performance.now();
    startArt();
    introHero();
    startParallax();
    startNavHighlight();
    startPlayer();
    startToggles();
    startClock();
    startTyping();
    startOptics();
    startPhone();
    startDroplets();
    $('#loupeToggle').addEventListener('change', (e) => setLoupe(e.target.checked));
    for (const b of $$('.sc-tune-open')) b.addEventListener('click', () => window.Showcase.openTuner?.(b));
    for (const b of $$('[data-copy]')) b.addEventListener('click', () => copyText(document.getElementById(b.dataset.copy).textContent, b));
    darkMQ.addEventListener('change', onSchemeChange);
    if (LG) {
      startPrefs();
      document.addEventListener('glass:tier', (e) => { if (e.target.id === 'nav') updateEngine(); });
    }
    applyScrollParam();
  }

  // After the library's own DOMContentLoaded handler (it was registered first), so the glass is
  // registered and the capabilities are known.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
