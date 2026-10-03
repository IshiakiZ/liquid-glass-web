/*! Liquid Glass for the Web v1.0.0 | MIT License | An independent, Apple-inspired implementation. Not affiliated with Apple. */
(function (addons) {
'use strict';
// Already loaded (e.g. classic script + ES module, or the core and then the all-in-one): only
// the groups the first copy lacks are added.
if (globalThis.LiquidGlass?.version) { for (const [name, fn] of addons) globalThis.LiquidGlass.extend?.(name, fn); return; }
const VERSION = '1.0.0';
// ── core-00-base.js ─────────────────────────────────────────────────────────
// Namespaces. `I` is the internal API shared with component partials (see INTERNAL-API.md);
// `LG` becomes globalThis.LiquidGlass. Nothing in the core touches the DOM at load time, so the
// bundle can be evaluated in Node (tests) or during SSR without side effects.
const I = {};
const LG = { version: VERSION };

const HAS_DOM = typeof window !== 'undefined' && typeof document !== 'undefined';
const SVG_NS = 'http://www.w3.org/2000/svg';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
const roundTo = (v, step) => Math.round(v / step) * step;
/** Compact number formatting for CSS values and SVG attributes (no exponent, no trailing zeros). */
const fmt = (v, digits = 3) => String(+(+v).toFixed(digits));
const toNumber = (v, fallback) => {
  if (v == null || v === '') return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** FNV-1a, base36. Used for short, stable cache keys and rule names. */
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

let idCounter = 0;
const uniqueId = (prefix) => `${prefix}${(++idCounter).toString(36)}`;

function emit(el, name, detail) {
  el.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
}

function setVar(el, name, value) {
  if (value == null) el.style.removeProperty(name);
  else el.style.setProperty(name, String(value));
}

function setAttr(el, name, value) {
  if (value == null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

/** Debug-mode warnings, deduplicated per element and code (§6.2.9). */
const warnedCodes = new WeakMap();
function debugWarn(el, code, message) {
  if (!config.debug) return;
  let seen = warnedCodes.get(el);
  if (!seen) warnedCodes.set(el, (seen = new Set()));
  if (seen.has(code)) return;
  seen.add(code);
  console.warn(`[liquid-glass] ${message}`, el);
}

/** An injected part: a `tag` element with `className`, aria-hidden, appended to `parent`. */
function part(parent, className, tag = 'span') {
  const e = document.createElement(tag);
  e.className = className;
  e.setAttribute('aria-hidden', 'true');
  parent.append(e);
  return e;
}

/**
 * A copy of `el` for display only (a lens's magnified items, a ghost of a removed element). It is
 * never focused, submitted, labelled or grouped: ids, names and form links are stripped (a named
 * radio copy would join the real group and uncheck it) and it is inert. SVG ids stay, because an
 * icon may reference its own gradients or masks.
 */
function inertClone(el) {
  const copy = el.cloneNode(true);
  for (const n of [copy, ...copy.querySelectorAll('*')]) {
    if (!(n instanceof SVGElement)) n.removeAttribute('id');
    for (const a of ['name', 'form', 'for', 'tabindex', 'required', 'autofocus']) n.removeAttribute(a);
  }
  copy.inert = true;
  return copy;
}

Object.assign(I, { clamp, lerp, invLerp, roundTo, fmt, toNumber, hash: hashString, uniqueId, emit, setVar, setAttr, part, inertClone, debugWarn, SVG_NS });
// ── core-01-config.js ───────────────────────────────────────────────────────
// Presets (§4.4), init options, live defaults and user preferences.

// Optics and highlight calibration. Fill opacities live in CSS (tokens), everything the JS
// computes lives here. Every number is our calibration, not a value published by Apple.
const PRESETS = {
  ios26: {
    blur: 4, blurClear: 1,          // Tier A frost σ (px)
    blurB: 12, blurBClear: 3,       // Tier B frost σB (px)
    saturation: 1.6, brightness: 1.05,
    refraction: 1, optics: 'rim', bezel: 'auto', profile: 3, dispersion: 0, zoom: 1,
    kReach: 0.70,                   // rim reach D = kReach · b
    lightAngle: -45, highlight: 1,  // bearing in degrees (0 = up, clockwise); −45 = top-left
    line: 0.85, lineW: 0.75, soft: 0.22, softW: 6, back: 0.5, floor: 0.12, edgeDark: 0, sheen: 0.06,
    toneLight: [1.6, 0.90, 0.08], toneDark: [1.5, 0.82, 0], toneClear: [1.2, 1, 0],
  },
};
PRESETS.ios27 = {
  ...PRESETS.ios26,
  blur: 7, blurClear: 1.5, blurB: 16, blurBClear: 4,
  saturation: 1.5, brightness: 1.04,
  kReach: 0.60,
  line: 1.0, soft: 0.32, floor: 0.15, edgeDark: 0.10,
};

const DEFAULT_CONFIG = {
  selector: null,              // null = '.glass' plus every component selector
  preset: null,                // falls back to html[data-glass-preset], then 'ios26'
  refraction: 'auto',          // 'auto' | 'off' | 'force'
  allowRefraction: null,
  minChromium: 120,
  encoding: 'ag',              // 'ag' (alpha-x / grey-y, default) | 'rg'
  maxRefractive: null,         // null = 8 (4 on coarse pointers)
  maxRefractiveAreaRatio: 0.35,
  worker: false,
  observe: true,
  bleed: true,                 // Tier B overscan + clip-path so the blur sees past the edge
  urlOverrides: false,
  debug: false,
};
const config = { ...DEFAULT_CONFIG };

// Runtime state that is not an init option.
const state = {
  initialized: false,
  freeze: false,               // ?freeze: springs jump to their end state
  forceTier: null,             // ?glass-tier=a|b|c
  tinted: 0,                   // setPreferences({ tinted }) ∈ [−1, 1]
  sheenTinted: 0,              // the `tinted` the Tier B rim sheen follows (settleSheen)
  dispersion: null,            // setPreferences({ dispersion }) ∈ [0, 1], null = not set (auto)
  presetName: 'ios26',
};

// ── "Clear ↔ Tinted" (§4.4) ────────────────────────────────────────────────
// t > 0 (more tinted): frost σ × (1 + t/2); the fill moves toward α .85 in CSS.
// t < 0 (clearer): everything layered over the view ramps linearly to nothing, reached exactly at
// t = −1 (pure clear): frost σ 0, saturation and brightness 1, an identity tone matrix, fill α 0
// (CSS), no Tier B rim sheen and no clear-variant dim. Rim lensing, the edge highlights, the depth
// shadow and the labels' legibility halos stay. Tinted glass keeps its tint.
const IDENTITY_TONE = [1, 1, 0];
/** 1 at t ≥ 0 … 0 at t = −1: how much of the frost, tone and fill a clearer preference keeps. */
const clearKeep = (t = state.tinted) => 1 - clamp(-t, 0, 1);
/** The frost blur gain of a more tinted preference. */
const tintedBlurGain = (t = state.tinted) => 1 + 0.5 * Math.max(0, t);
/**
 * Frost and tone under the preference t, from the values at t = 0 (after tintedBlurGain):
 * { sigma, sigmaB, sat, bright, tone: [s, gain, offset] } → the same keys, ramped toward pure
 * clear for t < 0 and unchanged for t ≥ 0. Pure, so the unit tests check the ramp.
 */
function clearLook(v, t = state.tinted) {
  const keep = clearKeep(t);
  if (keep === 1) return v;
  return {
    sigma: v.sigma * keep, sigmaB: v.sigmaB * keep,
    sat: 1 + (v.sat - 1) * keep, bright: 1 + (v.bright - 1) * keep,
    tone: v.tone.map((x, i) => lerp(IDENTITY_TONE[i], x, keep)),
  };
}
/** Tier B rim sheen under the preference, in steps of .01 (the overlay bitmap is rebuilt per step). */
const sheenFor = (sheen, t = state.tinted) => +fmt(roundTo(sheen * clearKeep(t), 0.01), 2);
// The sheen is drawn into the overlay bitmaps, so it follows a burst of `tinted` changes (a slider
// drag) at its first step and once it pauses for SHEEN_SETTLE_MS: two overlay builds per drag,
// not one per .01 of sheen. A single call applies at once.
const SHEEN_SETTLE_MS = 200;
const sheenState = { last: -Infinity, timer: 0 };
function settleSheen() {
  const now = performance.now();
  clearTimeout(sheenState.timer);
  sheenState.timer = 0;
  if (!state.initialized || now - sheenState.last > SHEEN_SETTLE_MS) state.sheenTinted = state.tinted;
  else {
    sheenState.timer = setTimeout(() => {
      sheenState.timer = 0;
      if (state.sheenTinted !== state.tinted) { state.sheenTinted = state.tinted; scheduleLook(); }
    }, SHEEN_SETTLE_MS);
  }
  sheenState.last = now;
}

// ── Dispersion (chromatic aberration) ─────────────────────────────────────
// Resting glass splits the colour channels at the rim: R is displaced by (1 − k), B by (1 + k)
// times the rim displacement, so R and B sample 2k·D apart at the edge and exactly 0 apart on the
// flat centre. The rim compresses what it shows about 1 + 3·kReach ≈ 3× at the edge, so the fringe
// on screen is ~2k·D / 3 wide: with k = DISPERSION_REST · dispersion, dispersion 1 gives ~1.5–2.1
// CSS px (3–4.2 device px at 2×) of R/B fringe on 44–62 px controls (ios26); 0.3 is subtle. Lifted
// lenses and the magnifier keep their own look (k = DISPERSION_LENS · their dispersion) unless the
// page-wide value is stronger.
const DISPERSION_REST = 0.3;
const DISPERSION_LENS = 0.06;

// LG.defaults: the active preset merged with user overrides. Writes schedule a refresh, and a
// delete restores the preset value, so a tuning panel can bind to it directly.
const presetValues = {};
const userDefaults = {};
function loadPreset(name) {
  state.presetName = PRESETS[name] ? name : 'ios26';
  for (const k of Object.keys(presetValues)) delete presetValues[k];
  Object.assign(presetValues, PRESETS[state.presetName], userDefaults);
}
loadPreset('ios26');
LG.defaults = new Proxy(presetValues, {
  set(target, key, value) {
    userDefaults[key] = value;
    target[key] = value;
    scheduleRefreshAll();
    return true;
  },
  deleteProperty(target, key) {
    delete userDefaults[key];
    if (key in PRESETS[state.presetName]) target[key] = PRESETS[state.presetName][key];
    else delete target[key];
    scheduleRefreshAll();
    return true;
  },
});
const D = presetValues; // internal short alias (read-only use)

const root = () => document.documentElement;
const rootAttr = (name) => root().getAttribute(name);

function activePresetName() {
  const p = (HAS_DOM && rootAttr('data-glass-preset')) || config.preset || 'ios26';
  return PRESETS[p] ? p : 'ios26';
}

/** Reads ?glass-tier, ?preset, ?tone, ?reduce, ?freeze (only when URL overrides are enabled). */
function applyUrlOverrides() {
  const q = new URLSearchParams(location.search);
  const tier = q.get('glass-tier');
  if (tier && /^[abc]$/.test(tier)) state.forceTier = tier;
  const preset = q.get('preset');
  if (preset && PRESETS[preset]) root().setAttribute('data-glass-preset', preset);
  const tone = q.get('tone');
  if (tone === 'light' || tone === 'dark') root().setAttribute('data-glass-tone', tone);
  for (const r of (q.get('reduce') || '').split(',')) {
    if (r === 'transparency') root().setAttribute('data-glass-transparency', 'reduced');
    if (r === 'contrast') root().setAttribute('data-glass-contrast', 'more');
    if (r === 'motion') root().setAttribute('data-glass-motion', 'reduced');
  }
  if (q.has('freeze')) state.freeze = true;
}

/**
 * LG.setPreferences — writes the html[data-glass-*] overrides so CSS and JS agree.
 * `tinted` (−1 … 1) and `dispersion` (0 … 1, or null / 'auto' to remove it) only change derived
 * numbers, so they apply in one light pass (no layout reads, no bitmap builds): cheap enough to
 * call on every input event of a slider.
 */
function setPreferences(p = {}) {
  if (!HAS_DOM) return;
  const html = root();
  if ('transparency' in p) setAttr(html, 'data-glass-transparency', p.transparency === 'reduced' ? 'reduced' : null);
  if ('contrast' in p) setAttr(html, 'data-glass-contrast', p.contrast === 'more' ? 'more' : null);
  if ('motion' in p) setAttr(html, 'data-glass-motion', p.motion === 'reduced' ? 'reduced' : null);
  if ('preset' in p) setAttr(html, 'data-glass-preset', PRESETS[p.preset] ? p.preset : null);
  if ('tinted' in p) {
    state.tinted = clamp(+p.tinted || 0, -1, 1);
    settleSheen();
    // CSS: α' = α·(1 + t⁻) + (0.85 − α)·t⁺ (§4.4)
    setVar(html, '--_lg-tn', state.tinted < 0 ? fmt(state.tinted) : null);
    setVar(html, '--_lg-tp', state.tinted > 0 ? fmt(state.tinted) : null);
  }
  if ('dispersion' in p) {
    // Page-wide, as an inherited --glass-dispersion on <html>: exactly what `:root { --glass-dispersion }`
    // in a stylesheet does, so per-element attributes and properties still win.
    const v = p.dispersion;
    state.dispersion = v == null || v === 'auto' ? null : clamp(toNumber(v, 0), 0, 1);
    setVar(html, '--glass-dispersion', state.dispersion == null ? null : fmt(state.dispersion));
  }
  // The MutationObserver on <html> picks attribute changes up (with init({ observe: false })
  // there is none); `tinted` and `dispersion` have no attribute.
  if (!obs.mo && ['transparency', 'contrast', 'motion', 'preset'].some((k) => k in p)) onRootChange();
  if ('tinted' in p || 'dispersion' in p) scheduleLook('dispersion' in p, 'tinted' in p);
}

I.presets = PRESETS;
I.defaults = D;
Object.assign(I, { clearKeep, clearLook, sheenFor, DISPERSION_REST, DISPERSION_LENS });
// ── core-02-detect.js ───────────────────────────────────────────────────────
// Engine and feature detection (§2.3) and the effective accessibility state.

function detect(cfg) {
  const S = (p, v) => { try { return CSS.supports(p, v); } catch { return false; } };
  const mq = (q) => { try { return matchMedia(q); } catch { return { matches: false, media: 'not all', addEventListener() {} }; } };
  const ua = navigator.userAgent;
  const hasBackdrop = S('backdrop-filter', 'blur(1px)') || S('-webkit-backdrop-filter', 'blur(1px)');

  // UA-CH brands exist only in Chromium (secure contexts, ≥ 90); WebKit and Gecko expose no
  // navigator.userAgentData, so a Chromium brand is decisive (DevTools touch emulation on a Mac
  // would otherwise look like an iPad).
  const brands = navigator.userAgentData?.brands;
  const chromiumBrand = Array.isArray(brands) ? brands.find((b) => b.brand === 'Chromium') : null;

  // Negative signals: cheap, and they cannot be spoofed by UA strings.
  const isIOSDevice = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = !chromiumBrand && (S('-webkit-backdrop-filter', 'blur(1px)') // only WebKit accepts the prefixed form
    || /^Apple/.test(navigator.vendor || '') || isIOSDevice); // every iOS browser is WebKit
  const gecko = S('background-image', '-moz-element(#a)') || 'MozAppearance' in document.documentElement.style;

  // Positive Blink signal: the brand, else a UA regex.
  const uaMatch = ua.match(/\b(?:Chrome|Chromium|HeadlessChrome)\/(\d+)/);
  const blink = !webkit && !gecko && (!!chromiumBrand || (!!uaMatch && !/\b(CriOS|FxiOS|EdgiOS)\b/.test(ua)));
  const blinkMajor = chromiumBrand ? +chromiumBrand.version : uaMatch ? +uaMatch[1] : 0;

  const engine = blink ? 'blink' : webkit ? 'webkit' : gecko ? 'gecko' : 'unknown';
  const safariVersion = webkit ? parseFloat((ua.match(/Version\/(\d+(?:\.\d+)?)/) || [])[1] || '0') : 0;

  // CSS.supports('backdrop-filter', 'url(#a)') is true everywhere, so it is necessary but not
  // sufficient: Safari and Firefox accept url() and then paint nothing (WebKit 245510).
  let liveRefraction = hasBackdrop && S('backdrop-filter', 'url(#a)') && blink && blinkMajor >= cfg.minChromium;
  if (typeof cfg.allowRefraction === 'function') liveRefraction = !!cfg.allowRefraction({ engine, blinkMajor, safariVersion, liveRefraction });
  if (cfg.refraction === 'off') liveRefraction = false;
  if (cfg.refraction === 'force') liveRefraction = hasBackdrop; // testing only: blank glass in Safari/Firefox today

  return {
    engine, blinkMajor, safariVersion, hasBackdrop, liveRefraction,
    dpr: window.devicePixelRatio || 1,
    p3: mq('(color-gamut: p3)').matches,
    coarse: mq('(pointer: coarse)').matches,
    reducedTransparencyMQ: mq('(prefers-reduced-transparency: reduce)'), // Chromium 118+ only
    reducedTransparencySupported: mq('(prefers-reduced-transparency)').media !== 'not all',
    reducedMotionMQ: mq('(prefers-reduced-motion: reduce)'),
    contrastMoreMQ: mq('(prefers-contrast: more)'),
    forcedColorsMQ: mq('(forced-colors: active)'),
    darkSchemeMQ: mq('(prefers-color-scheme: dark)'),
  };
}

let caps = null; // result of detect(), set by init()

// Effective accessibility state: media query OR the html[data-glass-*] override.
const isReducedTransparency = () => !!caps && (caps.reducedTransparencyMQ.matches || rootAttr('data-glass-transparency') === 'reduced');
const isContrastMore = () => !!caps && (caps.contrastMoreMQ.matches || rootAttr('data-glass-contrast') === 'more');
const isForcedColors = () => !!caps && caps.forcedColorsMQ.matches;
const isReducedMotion = () => HAS_DOM && !!caps && (caps.reducedMotionMQ.matches || rootAttr('data-glass-motion') === 'reduced');

// LG.capabilities: live view, stable object identity (safe to destructure from the ESM wrapper).
const capabilities = {};
for (const [key, get] of Object.entries({
  engine: () => caps?.engine ?? 'unknown',
  blinkMajor: () => caps?.blinkMajor ?? 0,
  safariVersion: () => caps?.safariVersion ?? 0,
  hasBackdrop: () => caps?.hasBackdrop ?? false,
  liveRefraction: () => caps?.liveRefraction ?? false,
  dpr: () => caps?.dpr ?? 1,
  p3: () => caps?.p3 ?? false,
  coarse: () => caps?.coarse ?? false,
  reducedTransparency: isReducedTransparency,
  reducedTransparencySupported: () => caps?.reducedTransparencySupported ?? false,
  reducedMotion: isReducedMotion,
  contrastMore: isContrastMore,
  forcedColors: isForcedColors,
})) Object.defineProperty(capabilities, key, { get, enumerable: true });

function reflectCapabilities() {
  const html = root();
  html.setAttribute('data-lg-engine', caps.engine);
  html.setAttribute('data-lg-refraction', caps.liveRefraction ? 'on' : 'off');
}

I.caps = capabilities;
I.reducedMotion = isReducedMotion;
Object.defineProperty(I, 'prefs', {
  enumerable: true,
  get: () => ({
    transparency: isReducedTransparency() ? 'reduced' : 'auto',
    contrast: isContrastMore() ? 'more' : 'auto',
    motion: isReducedMotion() ? 'reduced' : 'auto',
    tinted: state.tinted,
    dispersion: state.dispersion,
    preset: state.presetName,
    freeze: state.freeze,
    tier: state.forceTier,
  }),
});
// ── core-03-geometry.js ─────────────────────────────────────────────────────
// Geometry (§3.1, §3.2): border-radius resolution, bezel width and the seam-free direction field.
// Everything here is pure and runs in Node.

/** Splits a computed value on top-level whitespace, keeping calc(...) together. */
function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(s).trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** px, %, 0 and the simple calc(A% ± Bpx) / calc(Bpx ± A%) forms. NaN when not understood. */
function parseLength(token, ref) {
  let m;
  if (token === '0') return 0;
  if ((m = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/i.exec(token))) return +m[1];
  if ((m = /^(-?\d*\.?\d+)%$/.exec(token))) return (+m[1] / 100) * ref;
  if ((m = /^calc\(\s*(-?\d*\.?\d+)%\s*([+-])\s*(\d*\.?\d+)px\s*\)$/i.exec(token))) return (+m[1] / 100) * ref + (m[2] === '-' ? -1 : 1) * +m[3];
  if ((m = /^calc\(\s*(-?\d*\.?\d+)px\s*([+-])\s*(\d*\.?\d+)%\s*\)$/i.exec(token))) return +m[1] + ((m[2] === '-' ? -1 : 1) * +m[3] / 100) * ref;
  return NaN;
}

/**
 * Resolves the four computed border-radius longhands (TL, TR, BR, BL; each "rx" or "rx ry")
 * for a w × h border box: % against width (rx) / height (ry), then the CSS corner-overlap
 * scale. Unparseable values fall back to a capsule and set `approximate`.
 * @returns {{ corners: number[][], approximate: boolean }}
 */
function resolveRadii(values, w, h) {
  let approximate = false;
  const corners = values.map((v) => {
    const [a, b = a] = splitTopLevel(v || '0');
    let rx = parseLength(a, w), ry = parseLength(b, h);
    if (!Number.isFinite(rx)) { rx = 9999; approximate = true; }
    if (!Number.isFinite(ry)) { ry = 9999; approximate = true; }
    rx = Math.max(0, rx); ry = Math.max(0, ry);
    return rx > 0 && ry > 0 ? [rx, ry] : [0, 0]; // a zero on either axis squares the corner
  });
  const fit = (L, S) => (S > 0 ? L / S : Infinity);
  const f = Math.min(1,
    fit(w, corners[0][0] + corners[1][0]), fit(w, corners[3][0] + corners[2][0]),
    fit(h, corners[0][1] + corners[3][1]), fit(h, corners[1][1] + corners[2][1]));
  return { corners: corners.map(([rx, ry]) => [rx * f, ry * f]), approximate };
}

const RADIUS_PROPS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius'];

/** Corners of an element from its computed style. `w`, `h` = untransformed border box. */
function cornersFromCSS(el, w, h, cs = getComputedStyle(el)) {
  return resolveRadii(RADIUS_PROPS.map((k) => cs[k]), w, h);
}

/** Bezel width b = clamp(6, 0.25·min(w,h), 24), or an explicit px value; capped at min(w,h)/2. */
function bezelWidth(w, h, bezel) {
  const m = Math.min(w, h);
  const b = typeof bezel === 'number' && bezel > 0 ? bezel : clamp(0.25 * m, 6, 24);
  return Math.max(0.5, Math.min(b, m / 2));
}

/**
 * CSS clip-path that cuts an overscanned layer back to the element's shape: the layer reaches `o`
 * past the element at the top and bottom, `left` and `right` past its sides.
 */
function clipPathFor(o, corners, left = o, right = o) {
  const p = (v) => `${fmt(v, 2)}px`;
  const box = left === o && right === o ? p(o) : `${p(o)} ${p(right)} ${p(o)} ${p(left)}`;
  return `inset(${box} round ${corners.map((c) => p(c[0])).join(' ')} / ${corners.map((c) => p(c[1])).join(' ')})`;
}

/**
 * Seam-free field (verbatim from the optics research, liquid-glass-maps.mjs).
 * core = the box inset by b with per-corner radius max(min(rx,ry) − b, 0). t is the exterior
 * distance to that convex core, whose gradient gives the direction; tEdge is the length along
 * that direction from the core to the real CSS edge (a ray/ellipse intersection in corners).
 * (px, py) are relative to the box centre; corners = [[rx,ry] × 4] (TL, TR, BR, BL).
 * Returns x = 1 − t/tEdge (0 on the CSS edge, 1 on the plateau), the outward unit normal
 * (ox, oy) and beyond = t − tEdge (> 0 outside the shape; inside, −beyond is the depth).
 */
function glassField(px, py, hw, hh, corners, b) {
  const q = px < 0 ? (py < 0 ? 0 : 3) : (py < 0 ? 1 : 2);
  const rx = Math.min(corners[q][0], hw), ry = Math.min(corners[q][1], hh);
  const ax = Math.abs(px), ay = Math.abs(py), sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
  const rc = Math.max(Math.min(rx, ry) - b, 0), acx = hw - b - rc, acy = hh - b - rc;
  const qx = ax - acx, qy = ay - acy, ex = hw - rx, ey = hh - ry, ell = rx > 0 && ry > 0;
  let t, gx, gy, tEdge;
  if (qx > 0 && qy > 0) { // corner sector: radial from the core arc centre
    const L = Math.hypot(qx, qy); t = L - rc; gx = qx / L; gy = qy / L;
    const dx = acx - ex, dy = acy - ey; // ray (acx,acy) + s·(gx,gy) against the CSS corner ellipse
    let S = Infinity;
    if (ell) {
      const A = (gx / rx) ** 2 + (gy / ry) ** 2, B = 2 * (dx * gx / rx ** 2 + dy * gy / ry ** 2), C = (dx / rx) ** 2 + (dy / ry) ** 2 - 1;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) { const s = (-B + Math.sqrt(disc)) / (2 * A); if (acx + s * gx >= ex - 1e-9 && acy + s * gy >= ey - 1e-9) S = s; }
    }
    if (S === Infinity) S = Math.min(gx > 1e-12 ? (hw - acx) / gx : Infinity, gy > 1e-12 ? (hh - acy) / gy : Infinity);
    tEdge = S - rc;
  } else if (qx > qy) { // left/right band: ray along ±x
    t = qx - rc; gx = 1; gy = 0;
    tEdge = (ell && ay > ey ? ex + rx * Math.sqrt(Math.max(0, 1 - ((ay - ey) / ry) ** 2)) : hw) - (hw - b);
  } else { // top/bottom band: ray along ±y
    t = qy - rc; gx = 0; gy = 1;
    tEdge = (ell && ax > ex ? ey + ry * Math.sqrt(Math.max(0, 1 - ((ax - ex) / rx) ** 2)) : hh) - (hh - b);
  }
  tEdge = Math.max(tEdge, 1e-3);
  return { x: 1 - t / tEdge, ox: sx * gx, oy: sy * gy, beyond: t - tEdge };
}

Object.assign(I, { resolveRadii, cornersFromCSS, bezelWidth, clipPathFor, glassField, parseLength });
// ── core-04-maps.js ─────────────────────────────────────────────────────────
// Map and overlay builders (§3.3–§3.7). Pure: they return RGBA bytes and metadata, so they run
// in Node (tests), on the main thread, or stringified into the optional Blob Worker. They may
// only reference each other, glassField and A_RANGE (see workerSource).

// Alpha-x / grey-y encoding (§3.5). Chromium colour-manages displacement maps on P3 screens,
// which skews a plain R/G map; alpha is never colour-managed and grey survives the sRGB→P3
// conversion unchanged. Values stay inside [64, 192], so decode with scale = 4·Dmax.
const A_RANGE = 0.25;
function encodeAG(v) {
  return Math.round(255 * (0.5 + A_RANGE * (v < -1 ? -1 : v > 1 ? 1 : v)));
}

/**
 * Displacement map for a w × h shape plus a neutral `margin` on every side.
 * Sample offset at depth x across the bezel: ±o · D · M(x), M(x) = (1 − x)^p.
 *   mode 'rim'  (+): samples outward, compressing content from beyond the edge (needs overscan);
 *   mode 'lens' (−): samples inward, magnifying (physical plano-convex slab).
 * zoom > 1 adds a magnifier about the centre that fades in as M falls (§3.4): no fold for any z.
 * The map does not depend on overscan, blur or refraction strength: the filter places it at
 * (o − margin) and multiplies `scale`, so those change without a rebuild.
 * @returns {{ data: Uint8ClampedArray, W, H, Wc, Hc, margin, Dmax, scale, symmetric }}
 */
function buildDisplacementMap(geom, opts) {
  const { w, h, corners } = geom;
  const { D, p = 3, mode = 'rim', zoom = 1, margin = 2, mapScale = 1, encoding = 'ag' } = opts;
  const hw = w / 2, hh = h / 2, Wc = w + 2 * margin, Hc = h + 2 * margin;
  const W = Math.max(1, Math.round(Wc * mapScale)), H = Math.max(1, Math.round(Hc * mapScale));
  const sx = Wc / W, sy = Hc / H, sign = mode === 'lens' ? -1 : 1, zk = zoom > 1 ? 1 - 1 / zoom : 0;
  const b = Math.max(0.5, Math.min(opts.b, hw, hh));
  // Equal corners make the field mirror-symmetric about both axes (pixel centres are exactly
  // symmetric), so one quadrant is computed and reflected: ~2.5× faster.
  const c0 = corners[0];
  const symmetric = corners.every((c) => c[0] === c0[0] && c[1] === c0[1]);
  const iEnd = symmetric ? Math.ceil(W / 2) : W, jEnd = symmetric ? Math.ceil(H / 2) : H;
  const off = new Float32Array(W * H * 2);
  // Without zoom, pixels deeper than the bezel have no offset. The two bands of the cross that
  // avoids the corner squares (side R ≥ every radius) are certainly that deep.
  const R = Math.max(b, ...corners.flat()), deepX = hw - b, deepY = hh - b, bandX = hw - R, bandY = hh - R;
  let Dmax = 1e-3;
  for (let j = 0; j < jEnd; j++) {
    const py = (j + 0.5) * sy - margin - hh, ay = Math.abs(py);
    for (let i = 0; i < iEnd; i++) {
      const px = (i + 0.5) * sx - margin - hw, ax = Math.abs(px);
      if (!zk && ((ax < deepX && ay < bandY) || (ax < bandX && ay < deepY))) continue;
      const f = glassField(px, py, hw, hh, corners, b);
      if (f.beyond > 1) continue; // outside the shape: neutral
      const x = f.x < 0 ? 0 : f.x > 1 ? 1 : f.x, m = x < 1 ? (1 - x) ** p : 0;
      let dx = sign * D * m * f.ox, dy = sign * D * m * f.oy;
      if (zk) { dx -= px * zk * (1 - m); dy -= py * zk * (1 - m); }
      Dmax = Math.max(Dmax, Math.abs(dx), Math.abs(dy));
      let q = (j * W + i) * 2;
      off[q] = dx; off[q + 1] = dy;
      if (symmetric) {
        const i2 = W - 1 - i, j2 = H - 1 - j;
        q = (j * W + i2) * 2; off[q] = -dx; off[q + 1] = dy;
        q = (j2 * W + i) * 2; off[q] = dx; off[q + 1] = -dy;
        q = (j2 * W + i2) * 2; off[q] = -dx; off[q + 1] = -dy;
      }
    }
  }
  const data = new Uint8ClampedArray(W * H * 4), inv = 1 / Dmax;
  if (encoding === 'rg') { // debugging only: correct on sRGB-managed outputs
    for (let k = 0, q = 0; k < data.length; k += 4, q += 2) {
      data[k] = 128 + Math.round(127 * off[q] * inv);
      data[k + 1] = 128 + Math.round(127 * off[q + 1] * inv);
      data[k + 2] = 128; data[k + 3] = 255;
    }
    return { data, W, H, Wc, Hc, margin, Dmax, scale: (Dmax * 255) / 127, symmetric };
  }
  for (let k = 0, q = 0; k < data.length; k += 4, q += 2) {
    data[k] = data[k + 1] = data[k + 2] = encodeAG(off[q + 1] * inv); // y → grey
    data[k + 3] = encodeAG(off[q] * inv); // x → alpha
  }
  return { data, W, H, Wc, Hc, margin, Dmax, scale: 4 * Dmax, symmetric };
}

/**
 * Lens maps for lifted glass and magnifiers (§3.4, §3.6): the rim + zoom field of
 * buildDisplacementMap with `k` = the dispersion split baked in, so that the split ramps from 0
 * on the plateau to k at the CSS edge and a magnified centre stays free of colour fringes:
 *   G = offset,  R = offset · (1 − k·(1 − x)),  B = 2G − R (derived in the filter).
 * Encoding 'g2': every component is an opaque grey tile, 128 ± 127·v/Dmax. Grey is never colour-
 * managed and opaque pixels lose nothing to premultiplication, so y keeps full precision where
 * the 'ag' encoding would store it at alpha 64 (which shows as wavy lines under magnification).
 * `images` holds one [x | y] pair per channel map: [G] or, when k > 0, [G, R]. A filter crops each
 * tile out of its pair with preserveAspectRatio slice (xMin / xMax), so the map is sized to whole
 * pixels (per-axis margins ≥ `margin`) and a tile is exactly the map box. One Dmax covers R, G, B.
 * @returns {{ images: { data, W, H }[], data, W, H, tiles, tileW, Wc, Hc, margin, marginX, marginY, Dmax, scale, symmetric }}
 */
function buildLensMaps(geom, opts) {
  const { w, h, corners } = geom;
  const { D, p = 3, zoom = 1, k = 0, margin = 2, mapScale = 1 } = opts;
  const hw = w / 2, hh = h / 2;
  const tileW = Math.ceil((w + 2 * margin) * mapScale), H = Math.ceil((h + 2 * margin) * mapScale);
  const Wc = tileW / mapScale, Hc = H / mapScale, marginX = (Wc - w) / 2, marginY = (Hc - h) / 2, zk = zoom > 1 ? 1 - 1 / zoom : 0;
  const b = Math.max(0.5, Math.min(opts.b, hw, hh));
  const c0 = corners[0];
  const symmetric = corners.every((c) => c[0] === c0[0] && c[1] === c0[1]);
  const iEnd = symmetric ? Math.ceil(tileW / 2) : tileW, jEnd = symmetric ? Math.ceil(H / 2) : H;
  const off = new Float32Array(tileW * H * 3); // dx, dy, ramp (1 − x)
  let Dmax = 1e-3;
  for (let j = 0; j < jEnd; j++) {
    const py = (j + 0.5) / mapScale - marginY - hh;
    for (let i = 0; i < iEnd; i++) {
      const px = (i + 0.5) / mapScale - marginX - hw;
      const f = glassField(px, py, hw, hh, corners, b);
      if (f.beyond > 1) continue;
      const x = f.x < 0 ? 0 : f.x > 1 ? 1 : f.x, m = x < 1 ? (1 - x) ** p : 0, ramp = 1 - x;
      const dx = D * m * f.ox - px * zk * (1 - m), dy = D * m * f.oy - py * zk * (1 - m);
      Dmax = Math.max(Dmax, (Math.abs(dx) > Math.abs(dy) ? Math.abs(dx) : Math.abs(dy)) * (1 + k * ramp));
      const set = (ii, jj, sgx, sgy) => { const q = (jj * tileW + ii) * 3; off[q] = sgx * dx; off[q + 1] = sgy * dy; off[q + 2] = ramp; };
      set(i, j, 1, 1);
      if (symmetric) { set(tileW - 1 - i, j, -1, 1); set(i, H - 1 - j, 1, -1); set(tileW - 1 - i, H - 1 - j, -1, -1); }
    }
  }
  const pairs = k > 0 ? 2 : 1, W = tileW * 2, inv = 127 / Dmax;
  const images = Array.from({ length: pairs }, () => ({ data: new Uint8ClampedArray(W * H * 4), W, H }));
  const put = (img, i, j, t, v) => {
    const o = (j * W + t * tileW + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 128 + Math.round(v * inv);
    img.data[o + 3] = 255;
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < tileW; i++) {
      const q = (j * tileW + i) * 3, dx = off[q], dy = off[q + 1];
      put(images[0], i, j, 0, dx); put(images[0], i, j, 1, dy);
      if (pairs === 2) { const r = 1 - k * off[q + 2]; put(images[1], i, j, 0, dx * r); put(images[1], i, j, 1, dy * r); }
    }
  }
  return { images, data: images[0].data, W, H, tiles: pairs * 2, tileW, Wc, Hc, margin, marginX, marginY, Dmax, scale: (Dmax * 255) / 127, symmetric, encoding: 'g2' };
}

/**
 * Surface overlay (§3.7): crisp specular line + soft falloff, lit from `light` (unit vector
 * toward the light), a weaker back lobe, a faint floor, the iOS 27 darkened edge and the Tier B
 * rim sheen: white over black in one straight-alpha RGBA image, composited with plain `over`.
 * With `slice`, the image is a 9-slice: every term is constant along a straight edge, so only the
 * corners and one middle row/column are built and `border-image` stretches the rest. Then
 * meta.slice = [top, right, bottom, left] (CSS px, 0 = that axis is not sliced), and the image
 * stays small and at full resolution for any element size (V4).
 */
function buildOverlay(geom, opts) {
  const { w, h, corners } = geom;
  const { mapScale = 1, light, line, lineW, soft, softW, back, floor, edgeDark = 0, sheen = 0, intensity = 1, slice = false } = opts;
  const hw = w / 2, hh = h / 2, b = Math.max(0.5, Math.min(opts.b, hw, hh)), lx = light[0], ly = light[1];
  // Below half an 8-bit step every term is invisible: the soft falloff ends at softW·ln(510·soft),
  // the line well before, the sheen at b, the dark edge within ~2 px. Deeper pixels stay clear.
  const reach = Math.max(softW * Math.log(Math.max(1, 510 * soft * intensity)), 4 * lineW, sheen ? b : 0, 3);
  let T = 0, R = 0, B = 0, L = 0;
  if (slice) {
    const span = (r) => Math.ceil(Math.max(r, reach)) + 1;
    const l = span(Math.max(corners[0][0], corners[3][0])), r = span(Math.max(corners[1][0], corners[2][0]));
    const t = span(Math.max(corners[0][1], corners[1][1])), bt = span(Math.max(corners[3][1], corners[2][1]));
    if (l + r + 2 <= w) { L = l; R = r; }
    if (t + bt + 2 <= h) { T = t; B = bt; }
  }
  const bw = L ? L + 1 + R : w, bh = T ? T + 1 + B : h; // bitmap size, CSS px
  const W = Math.max(1, Math.round(bw * mapScale)), H = Math.max(1, Math.round(bh * mapScale));
  const sx = bw / W, sy = bh / H;
  // Bitmap → shape coordinates (relative to the centre): the 1 px middle samples the straight edge.
  const toX = (x) => (!L || x < L ? x : x < L + 1 ? hw : w - (bw - x)) - hw;
  const toY = (y) => (!T || y < T ? y : y < T + 1 ? hh : h - (bh - y)) - hh;
  const data = new Uint8ClampedArray(W * H * 4);
  const Rmax = Math.max(reach, ...corners.flat()), deepX = hw - reach, deepY = hh - reach, bandX = hw - Rmax, bandY = hh - Rmax;
  for (let j = 0; j < H; j++) {
    const py = toY((j + 0.5) * sy), ay = Math.abs(py);
    for (let i = 0; i < W; i++) {
      const px = toX((i + 0.5) * sx), ax = Math.abs(px);
      if ((ax < deepX && ay < bandY) || (ax < bandX && ay < deepY)) continue;
      const f = glassField(px, py, hw, hh, corners, b);
      const cov = Math.min(1, 0.5 - f.beyond * mapScale); // anti-aliased coverage in device px
      if (cov <= 0) continue;
      const d = f.beyond < 0 ? -f.beyond : 0; // depth from the CSS edge
      const facing = f.ox * lx + f.oy * ly;
      const lobe = Math.max(floor, facing > 0 ? facing ** 1.5 : back * (-facing) ** 1.5);
      let I = intensity * lobe * (line * Math.exp(-((d / lineW) ** 2)) + soft * Math.exp(-d / softW));
      if (sheen) { const s = 1 - Math.min(1, d / b); I += sheen * s * s; }
      if (I > 1) I = 1;
      const E = edgeDark * Math.exp(-((d / 0.6) ** 2));
      const a = I + E * (1 - I); // white (I) over black (E)
      if (a <= 0) continue;
      const k = (j * W + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round((255 * I) / a);
      data[k + 3] = Math.round(255 * a * cov);
    }
  }
  return { data, W, H, scale: mapScale, slice: slice ? [T, R, B, L] : null };
}

/** Grey rim mask for the optional vibrant rim (quality 'high'): 255·(1 − x)² inside the bezel. */
function buildRimMask(geom, opts) {
  const { w, h, corners } = geom;
  const { mapScale = 1 } = opts;
  const hw = w / 2, hh = h / 2;
  const W = Math.max(1, Math.round(w * mapScale)), H = Math.max(1, Math.round(h * mapScale));
  const sx = w / W, sy = h / H, b = Math.max(0.5, Math.min(opts.b, hw, hh));
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0, k = 0; j < H; j++) {
    const py = (j + 0.5) * sy - hh;
    for (let i = 0; i < W; i++, k += 4) {
      const f = glassField((i + 0.5) * sx - hw, py, hw, hh, corners, b);
      const x = f.x < 0 ? 0 : f.x;
      data[k] = data[k + 1] = data[k + 2] = f.beyond <= 0 && x < 1 ? Math.round(255 * (1 - x) ** 2) : 0;
      data[k + 3] = 255;
    }
  }
  return { data, W, H };
}

/** feColorMatrix values: saturation s (Rec.709 luma, like CSS saturate()), gain k, offset o. */
function toneMatrix(s = 1.4, k = 1, o = 0) {
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const row = (a, b, c) => `${fmt(a * k, 4)} ${fmt(b * k, 4)} ${fmt(c * k, 4)} 0 ${fmt(o, 4)}`;
  return [
    row(lr + (1 - lr) * s, lg - lg * s, lb - lb * s),
    row(lr - lr * s, lg + (1 - lg) * s, lb - lb * s),
    row(lr - lr * s, lg - lg * s, lb + (1 - lb) * s),
    '0 0 0 1 0',
  ].join('  ');
}

/** Map resolution: min(dpr, 2) for small areas, 1× for large ones. Never below 1× (§3.8). */
const mapScaleFor = (areaCssPx, dpr) => (areaCssPx <= 160000 ? Math.min(dpr, 2) : 1);

/** Source of the optional Blob Worker (init({ worker: true })). */
function workerSource() {
  return `'use strict';\nconst A_RANGE = ${A_RANGE};\n${[glassField, encodeAG, buildDisplacementMap, buildLensMaps, buildOverlay, buildRimMask].map(String).join('\n')}
const BUILDERS = { map: buildDisplacementMap, lens: buildLensMaps, overlay: buildOverlay, rim: buildRimMask };
onmessage = async ({ data: { id, kind, geom, opts } }) => {
  try {
    const t0 = performance.now();
    const r = BUILDERS[kind](geom, opts);
    const ms = performance.now() - t0;
    const blobs = [];
    for (const part of r.images || [r]) {
      const canvas = new OffscreenCanvas(part.W, part.H);
      canvas.getContext('2d', { colorSpace: 'srgb' }).putImageData(new ImageData(part.data, part.W, part.H, { colorSpace: 'srgb' }), 0, 0);
      blobs.push(await canvas.convertToBlob({ type: 'image/png' }));
    }
    r.data = r.images = null;
    postMessage({ id, blobs, meta: r, ms });
  } catch (e) { postMessage({ id, error: String(e) }); }
};`;
}

Object.assign(I, { buildDisplacementMap, buildLensMaps, buildOverlay, buildRimMask, toneMatrix, encodeAG, mapScaleFor, A_RANGE });
// ── core-05-resources.js ────────────────────────────────────────────────────
// Bitmap resources: idle scheduling, PNG/blob-URL encoding, the optional worker and the LRU
// caches (§3.8, §3.11). Every blob URL is owned by exactly one cache entry and revoked when
// that entry is evicted or the library is destroyed.

const buildLog = []; // the 32 most recent builds, for LG.stats()
let buildCount = 0;   // every build since load
function logBuild(kind, w, h, pixels, ms) {
  buildCount++;
  buildLog.push({ kind, w: +fmt(w, 1), h: +fmt(h, 1), pixels, ms: +ms.toFixed(2) });
  if (buildLog.length > 32) buildLog.shift();
}

// ── Idle queue ─────────────────────────────────────────────────────────────
// Map building is synchronous CPU work (≈12–33 ns/px), so it runs in idle slices; urgent jobs
// (an element the user is touching right now) run immediately.
const idleQueue = [];
let idleHandle = null;
function runWhenIdle(job, urgent = false) {
  return new Promise((resolve, reject) => {
    const run = () => { try { resolve(job()); } catch (e) { reject(e); } };
    if (urgent) { run(); return; }
    idleQueue.push(run);
    requestIdle();
  });
}
function requestIdle() {
  if (idleHandle || !idleQueue.length) return;
  idleHandle = typeof requestIdleCallback === 'function'
    ? { idle: requestIdleCallback(pumpIdle, { timeout: 120 }) }
    : { timeout: setTimeout(pumpIdle, 0) };
}
function pumpIdle(deadline) {
  idleHandle = null;
  const t0 = performance.now();
  const hasTime = () => (deadline && !deadline.didTimeout ? deadline.timeRemaining() > 4 : performance.now() - t0 < 8);
  do idleQueue.shift()(); while (idleQueue.length && hasTime());
  requestIdle();
}
function cancelIdle() {
  if (idleHandle?.idle) cancelIdleCallback(idleHandle.idle);
  if (idleHandle?.timeout) clearTimeout(idleHandle.timeout);
  idleHandle = null;
  idleQueue.length = 0;
}

// ── Encoding ───────────────────────────────────────────────────────────────
let encodeCanvas = null;
/** RGBA bytes → PNG Blob. The canvas is sRGB so the bytes reach the PNG unchanged, and CPU-backed
 * (willReadFrequently), so toBlob does not wait on a GPU readback behind the frame being drawn. */
function encodePNG({ data, W, H }) {
  const c = encodeCanvas || (encodeCanvas = document.createElement('canvas'));
  c.width = W; c.height = H;
  c.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }).putImageData(new ImageData(data, W, H, { colorSpace: 'srgb' }), 0, 0);
  // toBlob copies the bitmap synchronously, so the canvas can be reused right away.
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

/** Resolves once the image is decoded, so swapping it into CSS or an feImage does not flash.
 * Hidden documents may defer decoding indefinitely, so give up waiting after 300 ms. */
function decodeURL(url) {
  const img = new Image();
  img.src = url;
  return Promise.race([img.decode().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
}

// ── Optional worker (init({ worker: true })) ──────────────────────────────
let worker = null; // null = not started, false = unavailable
let workerURL = null;
const workerJobs = new Map();
let workerSeq = 0;
const WORKER_TIMEOUT_MS = 2000;
function getWorker() {
  if (worker !== null) return worker;
  try {
    workerURL = URL.createObjectURL(new Blob([workerSource()], { type: 'text/javascript' }));
    worker = new Worker(workerURL);
    worker.onmessage = ({ data }) => {
      const job = workerJobs.get(data.id);
      workerJobs.delete(data.id);
      if (job) data.error ? job.reject(new Error(data.error)) : job.resolve(data);
    };
    worker.onerror = (e) => { e.preventDefault?.(); stopWorker(); };
  } catch {
    worker = false; // e.g. a CSP without blob: in worker-src
  }
  return worker;
}
function stopWorker() {
  if (worker) worker.terminate();
  worker = false;
  if (workerURL) URL.revokeObjectURL(workerURL);
  workerURL = null;
  for (const job of workerJobs.values()) job.reject(new Error('worker stopped'));
  workerJobs.clear();
}

const BUILDERS = { map: buildDisplacementMap, lens: buildLensMaps, overlay: buildOverlay, rim: buildRimMask };

/**
 * Builds a bitmap (kind 'map' | 'lens' | 'overlay' | 'rim'), encodes it, creates a blob URL and decodes it.
 * A builder that returns several `images` (lens maps) gets one URL each, in `urls`.
 * @returns {Promise<{ url: string, urls: string[], meta: object }>} meta = the builder result without pixels.
 */
async function buildImage(kind, geom, opts, urgent = false) {
  const plainGeom = { w: geom.w, h: geom.h, corners: geom.corners };
  if (config.worker && !urgent && getWorker()) {
    try {
      const id = ++workerSeq;
      const res = await new Promise((resolve, reject) => {
        workerJobs.set(id, { resolve, reject });
        worker.postMessage({ id, kind, geom: plainGeom, opts });
        // A worker that never answers (blocked, or a host that does not run workers) falls
        // back to the main thread for good; a real build takes milliseconds.
        setTimeout(() => { if (workerJobs.has(id)) stopWorker(); }, WORKER_TIMEOUT_MS);
      });
      logBuild(kind, geom.w, geom.h, res.meta.W * res.meta.H, res.ms);
      const urls = res.blobs.map((b) => URL.createObjectURL(b));
      await Promise.all(urls.map(decodeURL));
      return { url: urls[0], urls, meta: res.meta };
    } catch { /* fall through to the main thread */ }
  }
  const result = await runWhenIdle(() => {
    const t0 = performance.now();
    const r = BUILDERS[kind](plainGeom, opts);
    logBuild(kind, geom.w, geom.h, r.W * r.H, performance.now() - t0);
    return r;
  }, urgent);
  // toBlob copies the canvas synchronously, so the encodes can overlap on the one canvas.
  const urls = (await Promise.all((result.images || [result]).map(encodePNG))).map((b) => URL.createObjectURL(b));
  await Promise.all(urls.map(decodeURL));
  result.data = result.images = null;
  return { url: urls[0], urls, meta: result };
}

// ── LRU caches ─────────────────────────────────────────────────────────────
class ResourceCache {
  constructor(limit) {
    this.limit = limit;
    this.entries = new Map(); // insertion order = least recently used first
    this.pending = new Map();
    this.epoch = 0;
  }
  get size() { return this.entries.size; }
  peek(key) { return this.entries.get(key) || null; }
  /** A referenced entry if `key` is already built (touches the LRU order), else null. Synchronous. */
  acquireNow(key) {
    const hit = this.entries.get(key);
    if (!hit) return null;
    this.entries.delete(key);
    this.entries.set(key, hit);
    hit.refs++;
    return hit;
  }
  /** A referenced entry for `key`, built once by `make()` → { url, meta }. Resolves null after clear(). */
  acquire(key, make) {
    const hit = this.acquireNow(key);
    if (hit) return Promise.resolve(hit);
    const epoch = this.epoch;
    let job = this.pending.get(key);
    if (!job) {
      // Every waiter's reference is counted when the entry is created, so a release() that runs
      // between creation and a waiter's continuation can never evict it (and revoke its URL).
      job = { waiters: 0 };
      job.promise = make().then((made) => {
        const urls = made.urls || [made.url];
        if (epoch !== this.epoch) { for (const u of urls) URL.revokeObjectURL(u); return null; }
        this.pending.delete(key);
        const entry = { key, url: made.url, urls, meta: made.meta, refs: job.waiters };
        this.entries.set(key, entry);
        return entry;
      }, (e) => { this.pending.delete(key); throw e; });
      this.pending.set(key, job);
    }
    job.waiters++;
    return job.promise.then((entry) => (entry && epoch === this.epoch ? entry : null));
  }
  release(entry) {
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    this.trim();
  }
  /** Evicts unreferenced entries, oldest first, down to the limit; revokes their URLs. */
  trim() {
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.limit) break;
      if (e.refs > 0) continue;
      this.entries.delete(key);
      for (const u of e.urls) URL.revokeObjectURL(u);
    }
  }
  clear() {
    this.epoch++;
    for (const e of this.entries.values()) for (const u of e.urls) URL.revokeObjectURL(u);
    this.entries.clear();
    this.pending.clear();
  }
}

const mapCache = new ResourceCache(48);
const overlayCache = new ResourceCache(48);

/** Normalised map options and their cache key. `k` (the baked dispersion split) is for lens maps. */
function mapOptions(opts) {
  return { D: +fmt(opts.D, 3), p: opts.p ?? 3, mode: opts.mode || 'rim', zoom: +fmt(opts.zoom ?? 1, 3), margin: opts.margin ?? 2, mapScale: opts.mapScale ?? 1, encoding: opts.encoding || config.encoding, b: +fmt(opts.b, 2), k: +fmt(opts.k ?? 0, 4) };
}
const mapKey = (geom, o) => `m|${geomKey(geom)}|${o.b}|${o.D}|${o.p}|${o.mode}|${o.zoom}|${o.margin}|${o.mapScale}|${o.encoding}|${o.k}`;
const overlayKey = (geom, opts) => `o|${geomKey(geom)}|${JSON.stringify(opts)}`;
const rimKey = (geom, opts) => `r|${geomKey(geom)}|${JSON.stringify(opts)}`;
const geomKey = (g) => `${fmt(roundTo(g.w, 0.5))}x${fmt(roundTo(g.h, 0.5))}|${g.corners.map((c) => `${fmt(roundTo(c[0], 0.5))},${fmt(roundTo(c[1], 0.5))}`).join(';')}`;

/**
 * Displacement map for geom = { w, h, corners } and opts = { b, D, p, mode, zoom, margin,
 * mapScale, encoding }. Resolves a referenced cache entry { key, url, meta } — release it with
 * releaseMap(entry). meta = { W, H, Wc, Hc, margin, Dmax, scale }.
 */
function acquireMap(geom, opts, urgent = false) {
  const o = mapOptions(opts);
  return mapCache.acquire(mapKey(geom, o), () => buildImage('map', geom, o, urgent));
}

/**
 * Lens maps (see buildLensMaps) for geom and opts = { b, D, p, zoom, k, margin, mapScale }.
 * Same cache as acquireMap; the entry's `urls` holds the G pair and, with k > 0, the R pair.
 */
function acquireLensMap(geom, opts, urgent = false) {
  const o = { ...mapOptions(opts), mode: 'rim', encoding: 'g2' };
  return mapCache.acquire(mapKey(geom, o), () => buildImage('lens', geom, o, urgent));
}

/** Surface overlay (see buildOverlay for opts). Resolves a referenced entry; releaseOverlay(entry). */
function acquireOverlay(geom, opts, urgent = false) {
  return overlayCache.acquire(overlayKey(geom, opts), () => buildImage('overlay', geom, opts, urgent));
}

/** Rim mask (quality 'high' vibrant rim, bezel debug view); shares the overlay cache. */
function acquireRimMask(geom, opts, urgent = false) {
  return overlayCache.acquire(rimKey(geom, opts), () => buildImage('rim', geom, opts, urgent));
}

Object.assign(I, {
  encodePNG, decodeURL, buildImage, acquireMap, acquireLensMap, acquireOverlay, acquireRimMask,
  releaseMap: (e) => mapCache.release(e), releaseOverlay: (e) => overlayCache.release(e), releaseRimMask: (e) => overlayCache.release(e),
  whenIdle: runWhenIdle, ResourceCache,
});
// ── core-06-filters.js ──────────────────────────────────────────────────────
// SVG filter factory (§3.9, Tier A). Filters live in one light-DOM <svg id="lg-defs">, are shared
// by key and refcounted (LRU of 64 unreferenced), and can be forked into private copies whose
// cheap attributes (scale, stdDeviation, tone, mix) are animated per frame.

let defsSvg = null;
let liveFilters = 0;

/** The shared <svg> container. Must not be display:none, or Chromium ignores the filters. */
function defsRoot() {
  if (!defsSvg) {
    defsSvg = document.createElementNS(SVG_NS, 'svg');
    defsSvg.id = 'lg-defs';
    defsSvg.setAttribute('aria-hidden', 'true');
    defsSvg.setAttribute('focusable', 'false');
    defsSvg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none');
  }
  if (!defsSvg.isConnected) document.body.append(defsSvg);
  return defsSvg;
}

function svgNode(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

function writeAttr(node, name, value) {
  const v = typeof value === 'number' ? fmt(value, 3) : String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

function placeImage(node, img) {
  writeAttr(node, 'href', img.href);
  writeAttr(node, 'x', img.x); writeAttr(node, 'y', img.y);
  writeAttr(node, 'width', img.width); writeAttr(node, 'height', img.height);
}

/**
 * One <filter>. `spec`:
 *   width, height      filter region in CSS px (the overscanned ::before box)
 *   blur               frost σ
 *   map                { href, x, y, width, height, scale } displacement map and its placement
 *   enc                'ag' | 'rg' | 'g2' (map encoding). 'g2' = grey lens maps from buildLensMaps:
 *                      map.href is the G [x | y] pair, map.href2 the R pair when map.tiles is 4;
 *                      x/y/width/height place one tile (the map box).
 *   dispersion, split  'ag'/'rg': channel split k; `split` displaces R, G and B at the scales
 *                      S·(1 − k), S, S·(1 + k) (animatable k). 'g2' with 4 tiles: the fraction 0–1
 *                      of the baked, rim-ramped split that is shown (R = G + f·(R₀ − G),
 *                      B = G − f·(R₀ − G)).
 *   alt, mix           optional second map { href, x, y, width, height, scale } ('ag'), blended as
 *                      mix·map + (1 − mix)·alt (lift crossfades)
 *   smooth             optional σ applied after displacement: feDisplacementMap samples the nearest
 *                      pixel, so a magnified or compressed backdrop shows stair-steps without it
 *   sharp              optional { href, x, y, width, height, blur }: a second, less blurred
 *                      displacement blended in through the rim mask ((1 − x)², full at the edge), so
 *                      the rim keeps fine detail while the centre stays frosted (Apple's rim is
 *                      sharper than the centre). With a split (either encoding), only this rim pass
 *                      is split per channel, over a single main pass: four displacements instead
 *                      of six, and the plateau (rim mask 0) is pixel-identical to no split. (Split
 *                      at three scales everywhere, the 8-bit map's neutral grey 128/255 ≠ ½ would
 *                      leave a hundredth-of-a-pixel split on the plateau.)
 *   tone               [saturation, gain, offset] for toneMatrix()
 *   vivid              optional rim mask { href, x, y, width, height, amount = 1 } (quality 'high';
 *                      `amount` scales the vivid rim, so it can fade with the "Clear" preference)
 *   flatten            flatten a transparent backdrop onto black first
 * Structural fields (enc, map.tiles, split, whether alt / smooth / vivid / sharp are present, flatten)
 * are fixed at creation (see structureOf); everything else can change through set().
 */
const SELECTORS = { ag: ['A', 'R'], rg: ['R', 'G'], g2: ['R', 'G'] };
const SPEC_DEFAULTS = { mix: 1, dispersion: 0, split: false, alt: null, smooth: null, vivid: null, flatten: false, enc: 'ag' };
const structureOf = (s) => [s.enc || 'ag', s.enc === 'g2' ? s.map?.tiles || 2 : 0, s.split && s.enc !== 'g2' ? 1 : 0, s.alt ? 1 : 0, s.smooth != null ? 1 : 0, s.vivid ? 1 : 0, s.flatten ? 1 : 0, sharpOn(s) ? 1 : 0].join('');
const sharpOn = (s) => !!s.sharp;

class GlassFilter {
  constructor(spec) {
    this.id = uniqueId('lg-f-');
    this.url = `url(#${this.id})`;
    this.spec = { ...SPEC_DEFAULTS, ...spec };
    this.structure = structureOf(this.spec);
    this.el = this.build();
    defsRoot().append(this.el);
    liveFilters++;
  }

  build() {
    const s = this.spec, n = (this.nodes = {});
    const displace = (in2, enc, result, input = 'frost') => {
      const [x, y] = SELECTORS[enc] || SELECTORS.ag;
      return svgNode('feDisplacementMap', { in: input, in2, xChannelSelector: x, yChannelSelector: y, result });
    };
    const f = (n.filter = svgNode('filter', { id: this.id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse' }));
    // Must be the hyphenated attribute: the camelCase name silently fails, and the default
    // linearRGB would decode grey 128 as 0.216 and shift everything by −0.28·scale.
    f.setAttribute('color-interpolation-filters', 'sRGB');
    let src = 'SourceGraphic';
    if (s.flatten) {
      f.append(svgNode('feFlood', { 'flood-color': '#000', result: 'black' }), svgNode('feComposite', { in: 'SourceGraphic', in2: 'black', operator: 'over', result: 'flat' }));
      src = 'flat';
    }
    n.blur = svgNode('feGaussianBlur', { in: src, edgeMode: 'duplicate', result: 'frost' });
    f.append(n.blur);
    const pick = (i) => Array.from({ length: 4 }, (_, row) => Array.from({ length: 5 }, (_, col) => (row === 3 ? +(col === 3) : +(row === i && col === i))).join(' ')).join('  ');
    const recombine = (dR, dG, dB, out = 'refr') => f.append(
      svgNode('feColorMatrix', { in: dR, type: 'matrix', values: pick(0), result: `${out}R` }),
      svgNode('feColorMatrix', { in: dG, type: 'matrix', values: pick(1), result: `${out}G` }),
      svgNode('feColorMatrix', { in: dB, type: 'matrix', values: pick(2), result: `${out}B` }),
      svgNode('feComposite', { in: `${out}R`, in2: `${out}G`, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: `${out}RG` }),
      svgNode('feComposite', { in: `${out}RG`, in2: `${out}B`, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: out }));
    // Displacement maps per channel: [R, G, B] results and whether they differ (a split).
    let maps;
    if (s.enc === 'g2') {
      // Grey tiles → an opaque (x → R, y → G) map inside the filter, where no colour management
      // applies: route each grey to its channel and add (alpha 1 + 1 clamps to 1).
      // Each feImage covers exactly the map box; `slice` scales its [x | y] pair to the box height
      // and xMin / xMax pick the tile, so no primitive rasterizes the other tile.
      const tiles = s.map.tiles || 2;
      n.tiles = Array.from({ length: tiles }, (_, t) => svgNode('feImage', { preserveAspectRatio: `${t % 2 ? 'xMax' : 'xMin'}YMin slice`, result: `t${t}` }));
      f.append(...n.tiles);
      const ROUTE_X = '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1', ROUTE_Y = '0 0 0 0 0  1 0 0 0 0  0 0 0 0 0  0 0 0 0 1';
      const pack = (tx, ty, result) => f.append(
        svgNode('feColorMatrix', { in: tx, type: 'matrix', values: ROUTE_X, result: `${result}x` }),
        svgNode('feColorMatrix', { in: ty, type: 'matrix', values: ROUTE_Y, result: `${result}y` }),
        svgNode('feComposite', { in: `${result}x`, in2: `${result}y`, operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result }));
      pack('t0', 't1', 'mG');
      if (tiles === 4) {
        pack('t2', 't3', 'mR0');
        // Weights sum to 1, so alpha stays 1: R = (1 − f)·G + f·R₀ and B = (1 + f)·G − f·R₀. Where
        // R₀ = G (the plateau) all three maps are the same pixels: the split there is exactly 0.
        n.mixR = svgNode('feComposite', { in: 'mG', in2: 'mR0', operator: 'arithmetic', k1: 0, k4: 0, result: 'mR' });
        n.mixB = svgNode('feComposite', { in: 'mG', in2: 'mR0', operator: 'arithmetic', k1: 0, k4: 0, result: 'mB' });
        f.append(n.mixR, n.mixB);
        maps = ['mR', 'mG', 'mB'];
      } else maps = ['mG'];
    } else {
      // One map; a split uses it at three scales (see write()).
      n.map = svgNode('feImage', { preserveAspectRatio: 'none', result: 'map' });
      f.append(n.map);
      maps = s.split ? ['map', 'map', 'map'] : ['map'];
    }
    // The frost displaced per channel and recombined (exact on opaque backdrops), or in one pass.
    // With a sharp rim, the split is in the rim pass (masked to the rim), over one main pass.
    const pass = (input, list, out) => {
      if (list.length === 1) {
        const d = [displace(list[0], s.enc, out, input)];
        f.append(d[0]);
        return d;
      }
      const d = list.map((m, i) => displace(m, s.enc, `${out}${'rgb'[i]}`, input));
      f.append(...d);
      recombine(...d.map((x) => x.getAttribute('result')), out);
      return d;
    };
    const sharp = sharpOn(s);
    n.disp = pass('frost', sharp ? [maps[1] ?? maps[0]] : maps, 'refr');
    if (sharp) {
      n.sharpBlur = svgNode('feGaussianBlur', { in: src, edgeMode: 'duplicate', result: 'frostS' });
      f.append(n.sharpBlur);
      n.sharpDisp = pass('frostS', maps, 'refrS');
      n.sharpMask = svgNode('feImage', { preserveAspectRatio: 'none', result: 'rmS' });
      f.append(n.sharpMask,
        svgNode('feColorMatrix', { in: 'rmS', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0', result: 'rimW' }),
        svgNode('feComposite', { in: 'refrS', in2: 'rimW', operator: 'in', result: 'sharpRim' }),
        svgNode('feComposite', { in: 'sharpRim', in2: 'refr', operator: 'over', result: 'refrSharp' }));
      n.sharpOut = true;
    }
    let out = n.sharpOut ? 'refrSharp' : 'refr';
    if (s.alt) {
      n.altMap = svgNode('feImage', { preserveAspectRatio: 'none', result: 'amap' });
      n.altDisp = displace('amap', 'ag', 'arefr');
      n.mix = svgNode('feComposite', { in: out, in2: 'arefr', operator: 'arithmetic', k1: 0, k4: 0, result: 'mixed' });
      f.append(n.altMap, n.altDisp, n.mix);
      out = 'mixed';
    }
    if (s.smooth != null) {
      n.smooth = svgNode('feGaussianBlur', { in: out, result: 'smooth' });
      f.append(n.smooth);
      out = 'smooth';
    }
    n.tone = svgNode('feColorMatrix', { in: out, type: 'matrix', result: 'tone' });
    f.append(n.tone);
    if (s.vivid) {
      // Apple's vibrant colour matrix (reverse-engineered), masked to the bezel by the rim mask.
      n.rim = svgNode('feImage', { preserveAspectRatio: 'none', result: 'rm' });
      n.rimA = svgNode('feColorMatrix', { in: 'rm', type: 'matrix', result: 'rimA' });
      f.append(n.rim, n.rimA,
        svgNode('feColorMatrix', { in: 'tone', type: 'matrix', values: '2.6705 -1.1088 -0.1117 0 0.05  -0.3295 1.8914 -0.1119 0 0.05  -0.3297 -1.1084 2.8881 0 0.05  0 0 0 1 0', result: 'vivid' }),
        svgNode('feComposite', { in: 'vivid', in2: 'rimA', operator: 'in', result: 'vividRim' }),
        svgNode('feComposite', { in: 'vividRim', in2: 'tone', operator: 'over' }));
    }
    this.write();
    return f;
  }

  /** Replaces every parameter with `spec`'s (same structure); only changed attributes are written. */
  reset(spec) {
    this.spec = { ...SPEC_DEFAULTS, ...spec };
    this.write();
  }

  /** Updates non-structural parameters; only attributes whose value changed are written. */
  set(partial) {
    const s = this.spec;
    for (const k of Object.keys(partial)) {
      const v = partial[k];
      s[k] = v && typeof v === 'object' && !Array.isArray(v) && s[k] ? { ...s[k], ...v } : v;
    }
    this.write();
  }

  write() {
    const s = this.spec, n = this.nodes;
    writeAttr(n.filter, 'width', s.width);
    writeAttr(n.filter, 'height', s.height);
    writeAttr(n.blur, 'stdDeviation', Math.max(0, s.blur));
    const S = s.map.scale;
    // 'ag' / 'rg' split: one map at the scales S·(1 − k), S, S·(1 + k). 'g2': the maps differ, one scale.
    const k = s.split && !n.tiles ? s.dispersion : 0;
    const scales = (nodes) => nodes.forEach((d, i) => writeAttr(d, 'scale', nodes.length === 3 ? S * (1 + (i - 1) * k) : S));
    scales(n.disp);
    if (n.sharpDisp) scales(n.sharpDisp);
    if (n.tiles) {
      const m = s.map;
      n.tiles.forEach((node, t) => placeImage(node, { ...m, href: t < 2 ? m.href : m.href2 }));
      if (n.mixR) {
        const fr = clamp(s.dispersion, 0, 1);
        writeAttr(n.mixR, 'k2', 1 - fr); writeAttr(n.mixR, 'k3', fr);
        writeAttr(n.mixB, 'k2', 1 + fr); writeAttr(n.mixB, 'k3', -fr);
      }
    } else placeImage(n.map, s.map);
    if (n.altMap && s.alt) {
      placeImage(n.altMap, s.alt);
      writeAttr(n.altDisp, 'scale', s.alt.scale);
      writeAttr(n.mix, 'k2', clamp(s.mix, 0, 1));
      writeAttr(n.mix, 'k3', 1 - clamp(s.mix, 0, 1));
    }
    if (n.sharpBlur && s.sharp) {
      writeAttr(n.sharpBlur, 'stdDeviation', Math.max(0, s.sharp.blur));
      placeImage(n.sharpMask, s.sharp);
    }
    if (n.smooth) writeAttr(n.smooth, 'stdDeviation', Math.max(0, s.smooth || 0));
    writeAttr(n.tone, 'values', toneMatrix(...s.tone));
    if (n.rim && s.vivid) {
      placeImage(n.rim, s.vivid);
      writeAttr(n.rimA, 'values', `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${fmt(0.5 * clamp(s.vivid.amount ?? 1, 0, 1), 4)} 0 0 0 0`);
    }
  }

  destroy() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    liveFilters--;
  }
}

// ── Shared filters ─────────────────────────────────────────────────────────
const filterCache = new Map(); // key → { key, filter, refs }
const r3 = (v) => fmt(v, 3);
const imgKey = (m) => (m ? `${m.href}${m.href2 ? `+${m.href2}` : ''}@${r3(m.x)},${r3(m.y)},${r3(m.width)},${r3(m.height)}*${r3(m.scale ?? 0)}` : '-');
function filterKey(s) {
  return [r3(s.width), r3(s.height), r3(s.blur), imgKey(s.map), structureOf(s), r3(s.dispersion || 0),
    imgKey(s.alt), r3(s.mix ?? 1), r3(s.smooth ?? -1), (s.tone || []).map(r3).join(','), imgKey(s.vivid), r3(s.vivid?.amount ?? 1), imgKey(s.sharp), r3(s.sharp?.blur ?? -1)].join('|');
}

/** A shared filter for `spec` (refcounted). Returns { filter, key }; hand it back to releaseFilter. */
function acquireFilter(spec) {
  const key = filterKey(spec);
  let e = filterCache.get(key);
  if (e) {
    filterCache.delete(key);
    filterCache.set(key, e);
  } else {
    e = { key, filter: new GlassFilter(spec), refs: 0 };
    filterCache.set(key, e);
  }
  e.refs++;
  return e;
}
/**
 * Moves a shared filter that only its caller holds (refs 1) to `spec` in place, when the graph is
 * the same and no filter for `spec` exists yet: a preference step or a new map then rewrites a few
 * attributes instead of adding a <filter> to the page. Returns false when it cannot.
 */
function retargetFilter(e, spec) {
  if (!e || e.refs !== 1 || !e.filter.el || e.filter.structure !== structureOf(spec)) return false;
  const key = filterKey(spec);
  if (filterCache.has(key)) return false;
  filterCache.delete(e.key);
  e.key = key;
  e.filter.reset(spec);
  filterCache.set(key, e);
  return true;
}
function releaseFilter(e) {
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  for (const [k, entry] of filterCache) {
    if (filterCache.size <= 64) break;
    if (entry.refs > 0) continue;
    filterCache.delete(k);
    entry.filter.destroy();
  }
}
function clearFilters() {
  for (const e of filterCache.values()) e.filter.destroy();
  filterCache.clear();
}

Object.assign(I, { GlassFilter, createFilter: (spec) => new GlassFilter(spec), acquireFilter, releaseFilter, defsRoot, filterStructure: structureOf });
// ── core-07-rules.js ────────────────────────────────────────────────────────
// Literal frost rules (§3.10). WebKit mishandles var() inside backdrop-filter, so outside Blink
// (inlineFrost) non-default frost values are written as literal rules in a constructed
// stylesheet, keyed by a hash that the element carries in data-lg-bk. The rules live in the liquid-glass layer (so author CSS
// still wins) and outside print. Chromium ignores -webkit-backdrop-filter, so there the
// unprefixed var(--_lg-bf, …) keeps Tier A's url() working; WebKit treats the prefixed name as
// an alias of the same property, so its later, literal declaration wins there.

let ruleSheet = null;
let ruleStyleEl = null;
// key → { refs, pinned, unusedSince }. Instances hold references; keys handed out through the
// internal API (I.frostRule) are pinned for the page's lifetime.
const frostKeys = new Map();
const FROST_SPARE = 32; // unreferenced rules kept around, so toggling between values reuses them
let frostSweepTimer = 0;

function frostSheet() {
  if (ruleSheet) return ruleSheet;
  try {
    ruleSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ruleSheet];
  } catch {
    ruleStyleEl = document.createElement('style');
    ruleStyleEl.id = 'lg-rules';
    document.head.append(ruleStyleEl);
    ruleSheet = ruleStyleEl.sheet;
  }
  return ruleSheet;
}

/**
 * The literal backdrop-filter for a frost triple, snapped so that a tuning slider or an animated
 * token does not mint a rule per step. Without blur the blur() term is left out, and a frost that
 * changes nothing (pure clear) is `none`: no backdrop pass at all.
 */
function frostLiteral(blur, saturation, brightness) {
  const b = fmt(roundTo(Math.max(0, blur), 0.25), 2), s = fmt(roundTo(saturation, 0.01), 2), br = fmt(roundTo(brightness, 0.01), 2);
  if (+b) return `blur(${b}px) saturate(${s}) brightness(${br})`;
  return +s === 1 && +br === 1 ? 'none' : `saturate(${s}) brightness(${br})`;
}

/**
 * Blink applies var() inside backdrop-filter correctly, so there the frost literal goes straight
 * into the element's --_lg-bf (Glass#syncFrost): inserting a rule restyles the whole page, which a
 * preference slider would pay on every step. The rules are for WebKit (and Gecko).
 */
const inlineFrost = () => caps?.engine === 'blink';

/** Ensures a rule for this frost triple exists and returns its key (for data-lg-bk). */
function ensureFrostRule(blur, saturation, brightness) {
  return ensureLiteralRule(frostLiteral(blur, saturation, brightness));
}
function ensureLiteralRule(lit) {
  const key = `k${hashString(lit)}`;
  let e = frostKeys.get(key);
  if (!e) {
    frostKeys.set(key, (e = { refs: 0, pinned: false, unusedSince: 0 }));
    frostSheet().insertRule(`@layer liquid-glass { @media not print { :where(.glass)[data-lg-bk="${key}"]::before { backdrop-filter: var(--_lg-bf, ${lit}); -webkit-backdrop-filter: ${lit}; } } }`, ruleSheet.cssRules.length);
  }
  return [key, e];
}

/** A referenced frost key for an instance and a frostLiteral(); hand it back with releaseFrost(key). */
function acquireFrostLiteral(lit) {
  const [key, e] = ensureLiteralRule(lit);
  e.refs++;
  return key;
}

function releaseFrost(key) {
  const e = key && frostKeys.get(key);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs || e.pinned) return;
  e.unusedSince = performance.now();
  if (!frostSweepTimer) frostSweepTimer = setTimeout(sweepFrostRules, 2000);
}

/** Deletes the oldest unreferenced rules beyond FROST_SPARE. */
function sweepFrostRules() {
  frostSweepTimer = 0;
  if (!ruleSheet) return;
  const unused = [...frostKeys].filter(([, e]) => !e.refs && !e.pinned).sort((a, b) => a[1].unusedSince - b[1].unusedSince);
  for (const [key] of unused.slice(0, Math.max(0, unused.length - FROST_SPARE))) {
    frostKeys.delete(key);
    const rules = ruleSheet.cssRules;
    for (let i = rules.length - 1; i >= 0; i--) if (rules[i].cssText.includes(`"${key}"`)) { ruleSheet.deleteRule(i); break; }
  }
}

function removeFrostSheet() {
  clearTimeout(frostSweepTimer);
  frostSweepTimer = 0;
  if (ruleStyleEl) ruleStyleEl.remove();
  else if (ruleSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== ruleSheet);
  ruleSheet = ruleStyleEl = null;
  frostKeys.clear();
}

I.frostLiteral = frostLiteral;
/** Internal API: a permanent literal frost rule for glass rendered outside the core. */
I.frostRule = (blur, saturation, brightness) => {
  const [key, e] = ensureFrostRule(blur, saturation, brightness);
  e.pinned = true;
  return key;
};
// ── core-08-motion.js ───────────────────────────────────────────────────────
// Motion (§5.1, §5.3, §5.11): Apple-derived springs, solved in closed form on one shared rAF loop
// that sleeps when nothing is animating; a linear tween, a velocity tracker and velocity stretch.

// response (s), damping ratio ζ → mass-1 spring: k = (2π/response)², c = 4π·ζ/response.
const SPRING_DEFS = {
  lift: [0.27, 0.625],   // _UILiquidLensView lift (RE): press-in, lens lift, drag follow
  unlift: [0.5, 0.7],    // _UILiquidLensView unlift (RE) = SwiftUI bouncy: release, settle
  snappy: [0.35, 0.85],  // Spring(.35, bounce .15) (ours): pill snap, segmented slide
  smooth: [0.5, 1],      // SwiftUI smooth: sheets, blur/refraction ramps, tone
  critical: [0.25, 1],   // _UILiquidLensView large variant (RE); reduced-motion replacement
};
const SPRINGS = {};
for (const [name, [response, damping]] of Object.entries(SPRING_DEFS)) {
  SPRINGS[name] = { response, damping, k: (2 * Math.PI / response) ** 2, c: (4 * Math.PI * damping) / response };
}

// ── Shared frame loop ──────────────────────────────────────────────────────
const loop = { raf: 0, last: 0, springs: new Set(), frames: new Set() };
function wake() {
  if (!loop.raf && HAS_DOM) loop.raf = requestAnimationFrame(tick);
}
function tick(now) {
  loop.raf = 0;
  // The closed-form step is exact for any dt, so slow frames only skip ahead; the cap keeps a
  // tab that was hidden for a while from resolving every animation in one frame.
  const dt = loop.last ? Math.min((now - loop.last) / 1000, 0.25) : 1 / 60;
  loop.last = now;
  try {
    // A callback that throws (e.g. a component writing to a node it forgot to unsubscribe) is
    // dropped on its own, so it cannot stall every other animation and pending promise.
    for (const fn of [...loop.frames]) {
      try { fn(dt, now); } catch (e) { loop.frames.delete(fn); console.error('[liquid-glass] frame callback failed and was removed', e); }
    }
    for (const s of [...loop.springs]) {
      try { s.step(dt); } catch (e) { s.fail(e); }
    }
  } finally {
    if (loop.springs.size || loop.frames.size) wake();
    else loop.last = 0;
  }
}
/** Calls fn(dt, now) every frame until the returned function is called. */
function onFrame(fn) {
  loop.frames.add(fn);
  wake();
  return () => loop.frames.delete(fn);
}
function stopLoop() {
  if (loop.raf) cancelAnimationFrame(loop.raf);
  loop.raf = 0; loop.last = 0;
  for (const s of [...loop.springs]) s.stop();
  loop.frames.clear();
}

// ── Spring ─────────────────────────────────────────────────────────────────
/**
 * Advances x'' = −k(x − T) − c·x' by t seconds in closed form (mass 1). Exact for any frame
 * length, so the overshoot and settle times of §5.1 hold at 30, 60 or 120 Hz; a 1/240 s Euler
 * substep, by comparison, loses about 1 % of the lift spring's 8 % overshoot.
 */
function springStep(x0, v0, T, k, c, t) {
  const w0 = Math.sqrt(k), zeta = c / (2 * w0), d = x0 - T;
  if (Math.abs(zeta - 1) < 1e-6) { // critically damped
    const e = Math.exp(-w0 * t), a = v0 + w0 * d;
    return [T + e * (d + a * t), e * (v0 - w0 * a * t)];
  }
  if (zeta < 1) { // underdamped
    const s = zeta * w0, wd = w0 * Math.sqrt(1 - zeta * zeta), e = Math.exp(-s * t);
    const cs = Math.cos(wd * t), sn = Math.sin(wd * t), B = (v0 + s * d) / wd;
    return [T + e * (d * cs + B * sn), e * (v0 * cs - (s * B + d * wd) * sn)];
  }
  const q = w0 * Math.sqrt(zeta * zeta - 1), r1 = -zeta * w0 + q, r2 = -zeta * w0 - q; // overdamped
  const C2 = (v0 - r1 * d) / (r2 - r1), C1 = d - C2, e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t);
  return [T + C1 * e1 + C2 * e2, r1 * C1 * e1 + r2 * C2 * e2];
}

/**
 * A persistent 1-D spring. to() retargets while keeping the current velocity (continuous drags);
 * the returned promise resolves the next time the spring comes to rest. Under reduced motion,
 * underdamped springs become `critical`; under ?freeze, every move jumps to its target.
 */
class Spring {
  constructor({ value = 0, velocity = 0, preset = 'smooth', k, c, onUpdate, onRest } = {}) {
    this.value = value;
    this.velocity = velocity;
    this.target = value;
    this.preset = preset;
    this.k = k; this.c = c;
    this.onUpdate = onUpdate;
    this.onRest = onRest;
    this.span = 1;
    this.waiters = [];
  }
  get active() { return loop.springs.has(this); }
  params() {
    let { k, c } = this;
    if (k == null || c == null) ({ k, c } = SPRINGS[this.preset] || SPRINGS.smooth);
    if (isReducedMotion() && c < 2 * Math.sqrt(k)) return SPRINGS.critical;
    return { k, c };
  }
  to(target, { preset, k, c, velocity } = {}) {
    if (preset) { this.preset = preset; this.k = this.c = undefined; }
    if (k != null && c != null) { this.k = k; this.c = c; }
    if (velocity != null) this.velocity = velocity;
    this.target = target;
    if (state.freeze || (!this.active && this.value === target && this.velocity === 0)) {
      this.jump(target);
      return Promise.resolve();
    }
    // The rest threshold scales with the motion: the distance to travel, or for an impulse
    // (value already at the target, non-zero velocity) the swing that velocity produces, v/ω₀.
    this.span = Math.max(Math.abs(target - this.value), Math.abs(this.velocity) / Math.sqrt(this.params().k), 1e-6);
    loop.springs.add(this);
    wake();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  step(dt) {
    const { k, c } = this.params(), T = this.target;
    const [x, v] = springStep(this.value, this.velocity, T, k, c, dt);
    this.value = x; this.velocity = v;
    const rest = Math.abs(x - T) < 0.001 * this.span && Math.abs(v) < 0.01 * this.span;
    if (rest) { this.value = T; this.velocity = 0; }
    this.onUpdate?.(this.value, this.velocity);
    if (rest) this.settle();
  }
  jump(value) {
    this.value = this.target = value;
    this.velocity = 0;
    this.onUpdate?.(value, 0);
    this.settle();
  }
  stop() { this.settle(); }
  /** An onUpdate that threw: stop at the current value, resolve waiters, report once. */
  fail(e) {
    loop.springs.delete(this);
    console.error('[liquid-glass] spring update failed; the spring was stopped', e);
    try { this.settle(); } catch { /* onRest threw as well */ }
  }
  settle() {
    loop.springs.delete(this);
    const waiters = this.waiters;
    this.waiters = [];
    for (const r of waiters) r();
    this.onRest?.(this.value);
  }
}

/** LG.spring — one-shot spring with retarget/stop and a `done` promise. */
function spring({ from = 0, to = 1, preset, k, c, v0 = 0, onUpdate } = {}) {
  const s = new Spring({ value: from, velocity: v0, preset, k, c, onUpdate });
  const done = s.to(to);
  return { retarget: (t) => { s.to(t); }, stop: () => s.stop(), done };
}

/** Linear (or eased) tween on the shared loop, for fixed-duration crossfades. */
function tween(from, to, ms, onUpdate, { delay = 0, ease = (t) => t } = {}) {
  let elapsed = -delay, stopped = false, off = null, resolve;
  const done = new Promise((r) => (resolve = r));
  const finish = () => { if (off) off(); stopped = true; resolve(); };
  if (state.freeze || ms <= 0) { onUpdate(to); resolve(); return { stop() {}, done }; }
  onUpdate(from);
  off = onFrame((dt) => {
    if (stopped) return;
    elapsed += dt * 1000;
    if (elapsed < 0) return;
    const t = Math.min(1, elapsed / ms);
    onUpdate(lerp(from, to, ease(t)));
    if (t >= 1) finish();
  });
  return { stop: finish, done };
}

// ── Velocity and stretch ───────────────────────────────────────────────────
/**
 * Pointer velocity in px/s. get() is exponentially smoothed (τ = 50 ms), which suits continuous
 * effects such as stretch; release() is the average over the last `window` seconds, which is
 * accurate for short flicks and suits release decisions and momentum. Both decay once events stop.
 */
class VelocityTracker {
  constructor(tau = 0.05) { this.tau = tau; this.reset(); }
  reset() { this.vx = this.vy = 0; this.x = this.y = 0; this.t = 0; this.history = []; }
  push(x, y, t = performance.now()) {
    const dt = (t - this.t) / 1000;
    if (this.t && dt > 0) {
      const a = 1 - Math.exp(-dt / this.tau);
      this.vx += a * ((x - this.x) / dt - this.vx);
      this.vy += a * ((y - this.y) / dt - this.vy);
    }
    this.x = x; this.y = y; this.t = t;
    const h = this.history;
    h.push({ x, y, t });
    while (h.length > 2 && t - h[0].t > 200) h.shift();
  }
  idleFactor(t) {
    const idle = this.t ? Math.max(0, (t - this.t) / 1000 - 0.02) : 0;
    return Math.exp(-idle / this.tau);
  }
  /** Smoothed estimate; decays once no event has arrived for more than a frame. */
  get(t = performance.now()) {
    const f = this.idleFactor(t);
    return { vx: this.vx * f, vy: this.vy * f };
  }
  /** Average velocity over the last `window` seconds of events (default 80 ms), for releases. */
  release(t = performance.now(), window = 0.08) {
    const h = this.history, last = h[h.length - 1];
    if (!last) return { vx: 0, vy: 0 };
    let first = last;
    for (let i = h.length - 2; i >= 0 && last.t - h[i].t <= window * 1000; i--) first = h[i];
    if (first === last && h.length > 1) first = h[h.length - 2]; // one sample in the window: use the last segment
    const dt = (last.t - first.t) / 1000, f = this.idleFactor(t);
    return dt > 0 ? { vx: ((last.x - first.x) / dt) * f, vy: ((last.y - first.y) / dt) * f } : { vx: 0, vy: 0 };
  }
}

/** Stretch amount for a speed in px/s: e = 0.15·tanh(|v| / 2500). */
const stretchAmount = (speed) => 0.15 * Math.tanh(speed / 2500);

/** rotate(θ) scale(1+e, 1/(1+e)) rotate(−θ) as a symmetric 2×2 matrix. */
function stretchMatrix(e, theta) {
  const a = 1 + e, b = 1 / (1 + e), c = Math.cos(theta), s = Math.sin(theta);
  const m11 = c * c * a + s * s * b, m22 = s * s * a + c * c * b, m12 = c * s * (a - b);
  return { sx: m11, sy: m22, skew: m12, transform: `matrix(${fmt(m11, 4)}, ${fmt(m12, 4)}, ${fmt(m12, 4)}, ${fmt(m22, 4)}, 0, 0)` };
}

/**
 * Velocity stretch (§5.3): feed velocities with update(vx, vy); `e` rides the lift spring so it
 * relaxes when motion stops. axis 'x' | 'y' pins θ (horizontal controls use 'x').
 * onUpdate({ sx, sy, skew, transform }, e, θ).
 */
class Stretch {
  constructor({ axis = 'free', onUpdate } = {}) {
    this.axis = axis;
    this.theta = axis === 'y' ? Math.PI / 2 : 0;
    this.onUpdate = onUpdate;
    this.spring = new Spring({ preset: 'lift', onUpdate: (e) => this.onUpdate?.(stretchMatrix(e, this.theta), e, this.theta) });
  }
  update(vx, vy) {
    if (isReducedMotion()) return;
    const speed = this.axis === 'x' ? Math.abs(vx) : this.axis === 'y' ? Math.abs(vy) : Math.hypot(vx, vy);
    if (this.axis === 'free' && speed > 30) this.theta = Math.atan2(vy, vx);
    this.spring.to(stretchAmount(speed));
  }
  release() { return this.spring.to(0); }
  stop() { this.spring.jump(0); }
}

/**
 * Velocity stretch on a glass handle's 'stretch' transform channel (axis 'x' or 'y'). Pass the
 * current pointer velocity every move; call with vx = null to relax. For a free-direction
 * stretch, use `new I.Stretch({ axis: 'free' })` and apply its matrix to an element you own.
 */
function stretchHandle(h, vx, vy = 0, { axis = 'x' } = {}) {
  if (!h.stretcher) h.stretcher = new Stretch({ axis, onUpdate: (m) => h.setChannel('stretch', { sx: m.sx, sy: m.sy }) });
  const st = h.stretcher;
  st.axis = axis;
  st.theta = axis === 'y' ? Math.PI / 2 : 0;
  if (vx == null) return st.release().then(() => h.clearChannel('stretch'));
  st.update(vx, vy);
  return Promise.resolve();
}

LG.spring = spring;
Object.assign(I, { Spring, springStep, SPRINGS, spring, tween, onFrame, VelocityTracker, Stretch, stretch: stretchHandle, stretchAmount, stretchMatrix });
// ── core-09-glass.js ────────────────────────────────────────────────────────
// The glass instance (= the public GlassHandle): option resolution, geometry, the render
// pipeline for Tiers A/B/C, filter forks for animation, and composable transform channels.

const instances = new Set();
const registry = new WeakMap(); // Element → Glass

const ENUMS = {
  variant: ['regular', 'clear', 'identity'],
  tone: ['auto', 'light', 'dark', 'adaptive'],
  shape: ['auto', 'capsule', 'circle', 'rect', 'concentric'],
  optics: ['rim', 'lens'],
  light: ['static', 'pointer'],
  tier: ['auto', 'a', 'b', 'c'],
  quality: ['balanced', 'high'],
  dim: ['auto', 'none', 'local', 'full'],
};
const pickEnum = (key, v, fallback) => (ENUMS[key].includes(v) ? v : fallback);

/** '-45deg' | '0.5turn' | '1rad' | number → degrees. */
function parseAngle(v, fallback) {
  if (typeof v === 'number') return v;
  const m = /^(-?\d*\.?\d+)(deg|rad|turn|grad)?$/.exec(String(v ?? '').trim());
  if (!m) return fallback;
  const n = +m[1];
  return m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'turn' ? n * 360 : m[2] === 'grad' ? n * 0.9 : n;
}

/** Tone implied by the element's color-scheme (large glass never adapts; §1.2 V6). */
function schemeTone(cs) {
  const scheme = cs.colorScheme || '';
  const dark = /\bdark\b/.test(scheme), light = /\blight\b/.test(scheme);
  if (dark && light) return caps.darkSchemeMQ.matches ? 'dark' : 'light';
  return dark ? 'dark' : 'light';
}

// Style reads shared by every instance refreshed in the same task (refreshAll, init): the root's
// computed opacity token and the clip and position state of common ancestors.
let passMemo = null;
function memo() {
  if (!passMemo) {
    passMemo = { clips: new Map(), positions: new Map(), overflows: new Map(), rootOpacity: null };
    queueMicrotask(() => { passMemo = null; });
  }
  return passMemo;
}
const rootOpacity = () => {
  const m = memo();
  if (m.rootOpacity == null) m.rootOpacity = getComputedStyle(root()).getPropertyValue('--glass-opacity').trim();
  return m.rootOpacity;
};

/**
 * True when an ancestor clips with rounded corners (overflow ≠ visible or contain: paint, plus a
 * border-radius). Chromium then clips a backdrop-filtered layer to its clip-path's bounding box
 * instead of its rounded shape, so overscanned glass would show a rectangle; such glass uses a
 * gradient mask instead (maskFor).
 */
function roundedClipAncestor(el) {
  const clips = memo().clips;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    let v = clips.get(a);
    if (v === undefined) {
      const cs = getComputedStyle(a);
      const clipping = cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /paint|strict|content/.test(cs.contain);
      v = clipping && RADIUS_PROPS.some((k) => parseFloat(cs[k]) > 0);
      clips.set(a, v);
    }
    if (v) return true;
  }
  return false;
}

/**
 * Room (px) between the element's border box and the left and right edges of the page, or null
 * when its layers cannot widen the page: a fixed layer, or an ancestor that clips or scrolls. The
 * overscanned backdrop layer counts as page content, so glass at the edge of the page would add a
 * horizontal scrollbar; its overscan is trimmed on that side instead (beyond the page edge there
 * is nothing to sample).
 */
function pageRoom(el) {
  const m = memo();
  for (let a = el; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    let p = m.positions.get(a);
    if (p === undefined) m.positions.set(a, (p = getComputedStyle(a).position));
    if (p === 'fixed') return null;
    if (a === el) continue;
    let clipsX = m.overflows.get(a);
    if (clipsX === undefined) m.overflows.set(a, (clipsX = getComputedStyle(a).overflowX !== 'visible'));
    if (clipsX) return null;
  }
  const r = el.getBoundingClientRect();
  return { left: r.left + scrollX, right: root().clientWidth - (r.right + scrollX) };
}

/**
 * The shape of an overscanned layer as mask layers: four corner ellipses and five bands, each
 * overlapping its neighbours by 1 px so no seam can open between them. Used instead of the
 * clip-path under rounded-clip ancestors (see roundedClipAncestor).
 */
function maskFor(o, w, h, corners, ox = o) {
  const p = (v) => `${fmt(v, 2)}px`, layers = [];
  const [tl, tr, br, bl] = corners;
  const rect = (x, y, rw, rh) => { if (rw > 0 && rh > 0) layers.push(`linear-gradient(#000 0 0) ${p(ox + x)} ${p(o + y)} / ${p(rw)} ${p(rh)} no-repeat`); };
  const corner = ([rx, ry], x, y, at) => {
    if (!(rx > 0 && ry > 0)) return;
    const aa = (50 / Math.min(rx, ry)); // ±½ px along the ray, in %
    layers.push(`radial-gradient(${p(rx)} ${p(ry)} at ${at}, #000 ${fmt(100 - aa, 2)}%, #0000 ${fmt(100 + aa, 2)}%) ${p(ox + x)} ${p(o + y)} / ${p(rx)} ${p(ry)} no-repeat`);
  };
  corner(tl, 0, 0, '100% 100%');
  corner(tr, w - tr[0], 0, '0 100%');
  corner(br, w - br[0], h - br[1], '0 0');
  corner(bl, 0, h - bl[1], '100% 0');
  const yT = Math.max(tl[1], tr[1]), yB = Math.max(bl[1], br[1]), xL = Math.max(tl[0], bl[0]), xR = Math.max(tr[0], br[0]);
  rect(tl[0] - 1, 0, w - tl[0] - tr[0] + 2, yT + 1);
  rect(bl[0] - 1, h - yB - 1, w - bl[0] - br[0] + 2, yB + 1);
  rect(0, tl[1] - 1, xL + 1, h - tl[1] - bl[1] + 2);
  rect(w - xR - 1, tr[1] - 1, xR + 1, h - tr[1] - br[1] + 2);
  rect(xL, yT, w - xL - xR, h - yT - yB);
  return layers.join(', ');
}

// Inline custom properties / attributes the instance may write; all removed on destroy.
const OWNED_ATTRS = ['data-lg-ready', 'data-lg-tier', 'data-lg-tone', 'data-lg-lifted', 'data-lg-bk', 'data-lg-tinted', 'data-lg-latent', 'data-lg-mat',
  'data-lg-pressed', 'data-lg-text', 'data-lg-dim', 'data-lg-custom', 'data-lg-instant'];

class Glass {
  constructor(el, explicit) {
    this.el = el;
    this.explicit = { ...explicit };
    this.defaults = {};     // component defaults (setDefaults): below attributes and CSS
    this.o = null;          // resolved options
    this.geom = null;       // { w, h, corners, bw }
    this.d = null;          // derived numbers for the current geometry / tier / tone
    this.tier = null;       // 'a' | 'b' | 'c' | 'none'
    this.tierReason = '';
    this.tone = 'light';
    this.toneSet = false;   // glass:tone has not fired yet
    this.adaptive = false;
    this.visible = false;   // within the IntersectionObserver margin around the viewport
    this.onScreen = false;  // in the viewport itself
    this.interacting = 0;
    this.holds = 0;         // I.hold(): keeps the current tier while > 0
    this.lifted = false;
    this.lightAngle = null; // pointer-following light (quantised), null = static
    this.channels = new Map();
    this.vars = new Set();
    this.ctl = new AbortController();
    this.res = { map: null, overlay: null, filter: null, rim: null };
    this.want = { map: null, overlay: null, rim: null };
    this.bk = null;         // referenced frost rule key (data-lg-bk)
    this.frost = null;      // the frost literal (Blink writes it into --_lg-bf instead of a rule)
    this.lookStale = false; // a preference changed while it was far from the viewport (rederive)
    this.frostClear = false; // Tier B lifted lens: frost switched to the clear σ
    this.custom = null;     // component-drawn Tier A backdrop: { filter, over } (I.setBackdrop)
    this.liftOpts = null;   // lift options once lift/prepareLift has been used
    this.lens = null;       // Tier A lens map for lifting: { key, entry, k, sigma, smooth }
    this.lensWarm = [];     // extra lens maps kept built (prepareLift with an array)
    this.fork = null;       // private GlassFilter while animating
    this.anim = { mat: 1, energize: 0, lift: 0, users: 0 };
    this.readyFired = false;
    this.addedClass = false;
    this.dead = false;
    this.resizeTimer = 0;
    this.resizing = false;  // a resize burst holds a fork (updated in place) until it settles
    this.roundClip = false;
    this.radiusSig = null;
    this.dimOn = true;      // clear glass with data-glass-dim="auto": the sampler turns it off over dark backdrops
  }

  // ── Public handle surface ────────────────────────────────────────────────
  update(opts = {}) {
    Object.assign(this.explicit, opts);
    this.refresh();
  }
  /** Component defaults: they rank below attributes and --glass-* properties (INTERNAL-API §4.1). */
  setDefaults(opts = {}) {
    Object.assign(this.defaults, opts);
    for (const k of Object.keys(opts)) if (opts[k] === undefined) delete this.defaults[k];
    this.refresh();
  }
  refresh() {
    if (this.dead) return;
    this.read();
    this.apply();
    scheduleTierEvaluation(true);
  }
  /** Read phase of a refresh: options, geometry and the rounded-clip state (no layout-affecting writes). */
  read({ size } = {}) {
    this.readOptions();
    this.measure(size);
    this.roundClip = roundedClipAncestor(this.el);
    this.room = pageRoom(this.el);
    this.floating = isFloating(this.el);
    const cs = getComputedStyle(this.el);
    this.toneHints = { scheme: schemeTone(cs), ancestor: this.sampledTone ? null : initialTone(this) };
  }
  /** Write phase of a refresh. */
  apply() {
    if (this.dead) return;
    this.updateTone();
    applyStaticTier(this);
    this.reconcile();
    syncInteraction(this);
  }
  materialize(o) { return materialize(this, o); }
  dematerialize(o) { return dematerialize(this, o); }
  lift(o) { return lift(this, o); }
  unlift() { return unlift(this); }
  destroy() { destroyGlass(this); }
  /** The tier this element would have with an unlimited budget ('a' | 'b' | 'c' | 'none'). */
  get staticTier() { return this.o && caps ? staticTier(this).tier : null; }
  /** Whether the budget lets it render dispersion now (a slot, or dispersion it asked for; §9.1). */
  get dispersing() { return tiers.dispersing.has(this); }
  /** The composed transform of every channel: { sx, sy, tx, ty }. */
  get transform() {
    let sx = 1, sy = 1, tx = 0, ty = 0;
    for (const c of this.channels.values()) { sx *= c.sx; sy *= c.sy; tx += c.tx; ty += c.ty; }
    return { sx, sy, tx, ty };
  }

  // ── Options ──────────────────────────────────────────────────────────────
  /** explicit JS option > data-glass-* attribute > --glass-* property > component default > preset. */
  readOptions(cs = getComputedStyle(this.el)) {
    const el = this.el, x = this.explicit, dflt = this.defaults;
    const attr = (n) => el.getAttribute(n);
    const cssVar = (n) => cs.getPropertyValue(n).trim() || null;
    const pick = (key, attrName, varName) => x[key] ?? (attrName && attr(attrName)) ?? (varName && cssVar(varName)) ?? dflt[key];
    const o = {};
    o.variant = pickEnum('variant', pick('variant', 'data-glass'), 'regular');
    o.interactive = x.interactive ?? (el.hasAttribute('data-glass-interactive') ? attr('data-glass-interactive') !== 'false' : !!dflt.interactive);
    o.tone = pickEnum('tone', x.tone ?? attr('data-glass-tone') ?? rootAttr('data-glass-tone') ?? dflt.tone, 'auto');
    o.shape = pickEnum('shape', pick('shape', 'data-glass-shape'), 'auto');
    const refraction = pick('refraction', 'data-glass-refraction', '--glass-refraction');
    o.refractionOff = refraction === 'off';
    o.refraction = o.refractionOff ? 0 : clamp(toNumber(refraction, D.refraction), 0, 2);
    o.optics = pickEnum('optics', pick('optics', 'data-glass-optics'), D.optics);
    const bezel = pick('bezel', 'data-glass-bezel', '--glass-bezel') ?? D.bezel;
    o.bezel = bezel === 'auto' ? 'auto' : toNumber(bezel, 'auto');
    o.profile = clamp(toNumber(pick('profile', 'data-glass-profile'), D.profile), 1, 8);
    // Dispersion without the explicit JS option: what the page (--glass-dispersion, which
    // setPreferences writes on <html>) or the element's attribute asks for. A component that
    // passes its own dispersion (the magnifier) reads the page-wide value here.
    o.pageDispersion = clamp(toNumber(attr('data-glass-dispersion') ?? cssVar('--glass-dispersion') ?? dflt.dispersion, D.dispersion), 0, 1);
    o.dispersion = x.dispersion != null ? clamp(toNumber(x.dispersion, D.dispersion), 0, 1) : o.pageDispersion;
    // A component's own, automatic split (the magnifier's): capped like a lifted lens's (§9.1).
    o.autoDispersion = clamp(toNumber(x.autoDispersion ?? dflt.autoDispersion, 0), 0, 1);
    o.blur = toNumber(pick('blur', 'data-glass-blur', '--glass-blur'), null);
    o.saturation = toNumber(pick('saturation', null, '--glass-saturation'), null);
    o.brightness = toNumber(pick('brightness', null, '--glass-brightness'), null);
    o.opacity = toNumber(x.opacity ?? dflt.opacity, null);
    o.highlight = Math.max(0, toNumber(pick('highlight', null, '--glass-highlight'), D.highlight));
    o.light = pickEnum('light', pick('light', 'data-glass-light'), 'static');
    o.lightAngle = parseAngle(pick('lightAngle', null, '--glass-light-angle'), D.lightAngle);
    o.edgeDark = clamp(toNumber(pick('edgeDark', null, '--glass-edge-dark'), D.edgeDark), 0, 1);
    // A component's default tier (a sheet's frost) yields to the page-wide ?glass-tier override.
    o.tier = pickEnum('tier', x.tier ?? attr('data-glass-tier') ?? (state.forceTier ? null : dflt.tier), 'auto');
    o.priority = toNumber(pick('priority', 'data-glass-priority'), 0);
    o.zoom = Math.max(1, toNumber(pick('zoom', 'data-glass-zoom'), D.zoom));
    o.quality = pickEnum('quality', pick('quality', 'data-glass-quality'), 'balanced');
    o.dim = pickEnum('dim', pick('dim', 'data-glass-dim'), o.variant === 'clear' ? 'auto' : 'none');
    const tint = x.tint !== undefined ? x.tint : attr('data-glass-tint') ?? dflt.tint;
    o.tint = tint && tint !== 'none' ? tint : null;
    o.tinted = !!o.tint || el.classList.contains('glass-prominent');
    o.latent = !!(x.latent ?? dflt.latent);
    o.customBackdrop = !!(x.customBackdrop ?? dflt.customBackdrop);
    o.scaleVars = !!(x.scaleVars ?? dflt.scaleVars);
    o.flatten = el.hasAttribute('data-glass-backdrop-transparent');
    const press = cssVar('--glass-press-scale');
    o.pressScale = press && press !== 'auto' ? toNumber(press, null) : null;
    o.inset = toNumber(pick('inset', 'data-glass-inset'), 8);
    o.minRadius = toNumber(pick('minRadius', 'data-glass-min-radius'), 0);
    // Author-set fill opacity (any level) switches the text-legibility floor (§6.1.5) off.
    o.authorOpacity = o.opacity != null || !!cssVar('--glass-fill-opacity') || (cssVar('--glass-opacity') ?? '') !== rootOpacity();
    this.o = o;

    // Reflect what CSS needs to see. Explicit JS options become attributes, like markup would;
    // only values that passed validation are written.
    if (x.variant && x.variant === o.variant && attr('data-glass') !== o.variant) el.setAttribute('data-glass', o.variant);
    if (x.shape && x.shape === o.shape && attr('data-glass-shape') !== o.shape) el.setAttribute('data-glass-shape', o.shape);
    setAttr(el, 'data-lg-tinted', o.tinted ? (!o.tint || o.tint === 'accent' ? 'accent' : 'custom') : null);
    setAttr(el, 'data-lg-latent', o.latent);
    setAttr(el, 'data-lg-custom', o.customBackdrop);
    this.setVar('--glass-tint', o.tint ? (o.tint === 'accent' ? 'var(--glass-accent)' : o.tint) : null);
    this.setVar('--glass-fill-opacity', o.opacity != null ? fmt(o.opacity) : null);
    this.setVar('--glass-fill-opacity-dark', o.opacity != null ? fmt(o.opacity) : null);
    this.cs = cs;
    return o;
  }

  setVar(name, value) {
    if (this.dead) return;
    if (value == null) { if (this.vars.delete(name)) this.el.style.removeProperty(name); return; }
    this.vars.add(name);
    const v = String(value);
    if (this.el.style.getPropertyValue(name) !== v) this.el.style.setProperty(name, v);
  }

  // ── Geometry ─────────────────────────────────────────────────────────────
  /** Untransformed border box, resolved radii and border width. `size` comes from ResizeObserver. */
  measure(size) {
    const el = this.el, cs = this.cs || getComputedStyle(el);
    const w = size ? size.w : el.offsetWidth, h = size ? size.h : el.offsetHeight;
    this.setVar('--_lg-concentric', this.o.shape === 'concentric' ? `${fmt(this.concentricRadius(), 2)}px` : null);
    const { corners, approximate } = cornersFromCSS(el, w, h, cs);
    if (approximate) debugWarn(el, 'calc-radius', 'border-radius uses a calc() form that cannot be resolved; treating it as a capsule.');
    this.geom = { w, h, corners, bw: parseFloat(cs.borderTopWidth) || 0 };
    // The baseline for style-change detection is what this geometry was built from (CORE-14).
    this.radiusSig = radiusSignature(cs);
    this.cs = null;
  }

  /** Concentric shape: the nearest glass ancestor's radius − inset, never below the minimum radius. */
  concentricHost() {
    let parent = this.el.parentElement;
    while (parent && !registry.has(parent)) parent = parent.parentElement;
    return parent || this.el.parentElement;
  }
  concentricRadius() {
    const host = this.concentricHost();
    if (!host) return this.o.minRadius;
    const g = registry.get(host)?.geom;
    const r = g ? g.corners[0][0] : cornersFromCSS(host, host.offsetWidth, host.offsetHeight).corners[0][0];
    return Math.max(r - this.o.inset, this.o.minRadius);
  }

  get area() { return this.geom ? this.geom.w * this.geom.h : 0; }

  // ── Tone ─────────────────────────────────────────────────────────────────
  /** `instant`: the element has just got a size, so there is no visible tone to crossfade from. */
  updateTone({ instant = false } = {}) {
    const o = this.o, h = this.geom?.h || 0;
    // Small glass adapts; glass with no size yet (a closed dialog, a hidden popover) is not known
    // to be small, so it does not take an ancestor's tone it may never be shown on.
    this.adaptive = o.variant !== 'clear' && (o.tone === 'adaptive' || (o.tone === 'auto' && h > 0 && h <= 64));
    this.dimAuto = o.variant === 'clear' && o.dim === 'auto';
    let tone;
    if (o.tone === 'light' || o.tone === 'dark') tone = o.tone;
    else if (o.variant === 'clear') tone = 'dark'; // clear glass sits over media: white labels, no adaptivity
    else if (this.adaptive) tone = this.sampledTone || this.toneHints.ancestor || this.toneHints.scheme;
    else tone = this.toneHints.scheme;
    this.setTone(tone, { instant });
    // Text-bearing glass that does not adapt gets a legible fill (§6.1.5, V11).
    setAttr(this.el, 'data-lg-text', !this.adaptive && o.variant === 'regular' && !o.tinted && !o.latent && !o.authorOpacity && hasText(this.el));
    setAttr(this.el, 'data-lg-dim', this.dimAuto && !this.dimOn ? 'off' : null);
  }
  /** `instant` skips the 250 ms label/fill crossfade (first tone of an element entering view). */
  setTone(tone, { instant = false } = {}) {
    const changed = tone !== this.tone || !this.toneSet; // the first tone is news even when it is 'light'
    if (!changed && this.el.getAttribute('data-lg-tone') === tone) return;
    this.tone = tone;
    this.toneSet = true;
    if (instant) {
      this.el.setAttribute('data-lg-instant', '');
      requestAnimationFrame(() => { if (!this.dead) this.el.removeAttribute('data-lg-instant'); });
    }
    this.el.setAttribute('data-lg-tone', tone);
    if (this.d) this.reconcile(); // overlay intensity and the tone matrix depend on it
    if (changed) emit(this.el, 'glass:tone', { tone });
  }

  // ── Derived numbers ──────────────────────────────────────────────────────
  derive() {
    const { w, h } = this.geom, o = this.o, tier = this.tier;
    const clear = o.variant === 'clear';
    const blurGain = tintedBlurGain(); // "Tinted" preference: more frost (§4.4)
    const sigma0 = (o.blur ?? (clear ? D.blurClear : D.blur)) * blurGain;
    let sigmaB0 = (o.blur ?? (clear ? D.blurBClear : D.blurB)) * blurGain;
    if (w > 400 && h > 400) sigmaB0 = Math.min(sigmaB0, 20);
    // Tinted glass keeps its colour: no brightness lift and a neutral tone gain, so the backdrop
    // that shows through the 90 % tint cannot wash it out (V8).
    const tone0 = o.tinted ? [D.toneLight[0], 1, 0] : clear ? D.toneClear : this.tone === 'dark' ? D.toneDark : D.toneLight;
    // "Clear" preference: frost, saturation, brightness and tone ramp to a pass-through (§4.4).
    const { sigma, sigmaB, sat, bright, tone } = clearLook({
      sigma: sigma0, sigmaB: sigmaB0, tone: tone0,
      sat: o.saturation ?? (o.tinted ? 1.8 : clear ? 1.2 : D.saturation),
      bright: o.brightness ?? (o.tinted || clear ? 1 : D.brightness),
    });
    const b = bezelWidth(w, h, o.bezel);
    const rim = o.optics !== 'lens';
    const reach = rim ? D.kReach * b : 0.2 * b; // D before the strength multiplier
    const strength = o.refraction;
    // Overscan must hold the farthest outward sample (B, dispersed, reaches (1 + k)·D; sized for
    // the strongest k so a dispersion slider does not resize the layer) plus the blur kernel (§3.1).
    const k = tiers.dispersing.has(this) ? DISPERSION_REST * o.dispersion : 0;
    const lo = this.liftOpts, lensReach = lo ? lo.reach * b * (1 + lensDispersion(this, lo.dispersion, o.dispersion).build) : 0;
    const outward = Math.max(rim ? reach * (1 + (o.dispersion > 0 ? DISPERSION_REST : 0)) : 0, lensReach) * strength;
    let over = 0;
    if (tier === 'a') over = o.customBackdrop ? Math.ceil(this.custom?.over ?? 0) : Math.ceil(outward + 2 * sigma0 + 1);
    else if (tier === 'b' && config.bleed) over = Math.min(Math.ceil(2 * sigmaB0), 32);
    // Trimmed at the page edge (pageRoom); a component-drawn backdrop (a lens) moves, so it keeps its own.
    const room = o.customBackdrop ? null : this.room;
    const trim = (v) => (room ? clamp(Math.floor(v), 0, over) : over);
    const overL = trim(room?.left), overR = trim(room?.right);
    const dpr = caps.dpr;
    return {
      w, h, b, reach, strength, sigma, sigma0, sigmaB, over, overL, overR, Wc: w + 2 * over, Hc: h + 2 * over,
      sat, bright, tone, k,
      mapScale: mapScaleFor((w + 4) * (h + 4), dpr),
      overlayScale: Math.min(Math.ceil(dpr), 2), // integer, so 9-slice edges land on whole image pixels
    };
  }

  mapOpts() {
    const d = this.d, o = this.o;
    return { b: d.b, D: d.reach, p: o.profile, mode: o.optics === 'lens' ? 'lens' : 'rim', zoom: o.zoom, mapScale: d.mapScale };
  }

  overlayOpts() {
    const d = this.d, o = this.o, rad = ((this.lightAngle ?? o.lightAngle) * Math.PI) / 180;
    return {
      b: +fmt(d.b, 2), mapScale: d.overlayScale, light: [+fmt(Math.sin(rad), 4), +fmt(-Math.cos(rad), 4)],
      line: D.line, lineW: D.lineW, soft: D.soft, softW: D.softW, back: D.back, floor: D.floor,
      edgeDark: o.edgeDark, sheen: this.tier === 'b' ? sheenFor(D.sheen, state.sheenTinted) : 0, // fades with the "Clear" preference
      intensity: +fmt(o.highlight * (this.tone === 'dark' ? 0.8 : 1), 3), slice: true,
    };
  }

  // ── Render pipeline ──────────────────────────────────────────────────────
  /**
   * Brings CSS variables, the frost rule, the overlay and (Tier A) the map + filter in line with
   * the current state. With `stretch`, bitmaps are not rebuilt: the old map and overlay are
   * stretched to the new size until the debounced full reconcile (§3.11).
   */
  reconcile({ stretch = false } = {}) {
    if (this.dead || !this.geom || !this.tier) return;
    const g = this.geom;
    if (g.w < 1 || g.h < 1) return;
    this.lookStale = false;
    const d = (this.d = this.derive());
    const layered = this.tier === 'a' || this.tier === 'b';
    const custom = this.o.customBackdrop && this.tier === 'a';
    this.setVar('--_lg-o', d.over ? `${d.over}px` : null);
    this.setVar('--_lg-ol', d.overL !== d.over ? `${d.overL}px` : null);
    this.setVar('--_lg-or', d.overR !== d.over ? `${d.overR}px` : null);
    this.setVar('--_lg-r', d.over ? '0' : null);
    const masked = !!d.over && this.roundClip;
    this.setVar('--_lg-clip', d.over && !masked ? clipPathFor(d.over, g.corners, d.overL, d.overR) : null);
    this.setVar('--_lg-mask', masked ? maskFor(d.over, g.w, g.h, g.corners, d.overL) : null);
    this.setVar('--_lg-bw', g.bw ? `${fmt(g.bw, 2)}px` : null);
    const m = Math.min(g.w, g.h); // depth grows with size (V5)
    this.setVar('--_lg-sy', `${fmt(clamp(m * 0.12, 3, 16), 1)}px`);
    this.setVar('--_lg-sb', `${fmt(clamp(m * 0.45, 12, 48), 1)}px`);
    // Tier A shows its own frost (σ) until the refraction filter is ready; Tier B uses σB.
    this.syncFrost(layered && !custom);

    if (this.tier === 'none') { this.dropOverlay(); this.checkReady(); }
    else this.requestOverlay(stretch);

    if (this.tier === 'a' && !custom) {
      if (!this.o.latent) this.requestMap(stretch);
      if (this.liftOpts && !stretch) prepareLens(this);
    } else this.dropRefraction();
    if (custom) this.setVar('--_lg-bf', this.custom?.filter || 'none');
    // The rim mask: the vivid rim, the sharper rim of buttons, and a colour split confined to the rim
    // (only while the budget lets it disperse: glass waiting off screen builds none).
    const rimMask = this.o.quality === 'high' || this.wantsSharpRim() || (this.o.dispersion > 0 && !this.o.latent && tiers.dispersing.has(this));
    if ((this.tier === 'a' && !custom && rimMask) || debugModes().includes('bezel')) this.requestRim(stretch);
    else this.dropRim();
    if (!custom) this.syncFilter();
    syncDebugVars(this);
  }

  /**
   * Glass far from the viewport when a preference changes: only its numbers (handle.d) follow, so
   * preference listeners see current values; its frost, overlay and filter follow when it comes
   * near the viewport (onIntersect) or starts to animate. A slider drag then rewrites the glass
   * the user can see, not every glass on the page.
   */
  rederive() {
    if (this.dead || !this.geom || !this.tier || this.geom.w < 1 || this.geom.h < 1) return;
    this.d = this.derive();
    this.lookStale = true;
  }

  /**
   * The frost for the current state (Tier B, and Tier A until its filter is in). In Blink it is
   * written straight into --_lg-bf: a preference step then restyles the glass it changes, where a
   * new stylesheet rule would restyle the whole page. WebKit mishandles var() inside
   * backdrop-filter, so elsewhere data-lg-bk points at a literal rule (§3.10). Once a Tier A filter
   * is in, it replaces the frost, which is then left as it is (no rule minted per step of a drag).
   */
  syncFrost(on = (this.tier === 'a' || this.tier === 'b') && !(this.o.customBackdrop && this.tier === 'a')) {
    const d = this.d;
    let lit = null;
    if (on && d) {
      // Tier B has no lens, so a lifted part turns clear by switching to the clear frost (VIS-9).
      const clearLift = this.tier === 'b' && this.frostClear;
      const waitingForFilter = this.wasB && !this.res.filter && !this.fork; // see setTier
      const sigma = this.tier === 'a' ? (waitingForFilter ? d.sigmaB : d.sigma) : clearLift ? Math.min(d.sigmaB, D.blurBClear) : d.sigmaB;
      lit = frostLiteral(sigma, d.sat, d.bright);
    }
    this.frost = lit;
    const filtered = this.tier === 'a' && !!(this.res.filter || this.fork); // --_lg-bf holds the filter
    if (inlineFrost()) {
      if (this.bk) { releaseFrost(this.bk); this.bk = null; setAttr(this.el, 'data-lg-bk', null); }
      if (!filtered && !(this.o.customBackdrop && this.tier === 'a')) this.setVar('--_lg-bf', this.restBf());
      return;
    }
    if (filtered && this.bk) return;
    const key = lit ? acquireFrostLiteral(lit) : null;
    const prev = this.bk;
    this.bk = key;
    setAttr(this.el, 'data-lg-bk', key);
    releaseFrost(prev);
  }

  /**
   * What --_lg-bf holds without a filter: the frost in Blink (syncFrost), else nothing. Latent
   * Tier A glass at rest shows no layers (and its lift runs a filter fork), so it holds none.
   */
  restBf() {
    return inlineFrost() && !(this.tier === 'a' && this.o.latent && !this.lifted) ? this.frost : null;
  }

  requestOverlay(stretch) {
    const opts = this.overlayOpts(), key = overlayKey(this.geom, opts);
    if (this.want.overlay === key || (stretch && this.res.overlay)) return;
    this.want.overlay = key;
    acquireOverlay(this.geom, opts).then((entry) => {
      if (!entry) return;
      if (this.dead || this.want.overlay !== entry.key) { overlayCache.release(entry); return; }
      const prev = this.res.overlay;
      this.res.overlay = entry;
      const sl = entry.meta.slice || [0, 0, 0, 0], k = entry.meta.scale || 1;
      this.setVar('--_lg-overlay', `url("${entry.url}")`);
      this.setVar('--_lg-ov-slice', sl.map((v) => fmt(v * k, 2)).join(' '));
      this.setVar('--_lg-ov-width', sl.map((v) => `${fmt(v, 2)}px`).join(' '));
      this.el.setAttribute('data-lg-ready', '');
      overlayCache.release(prev);
      this.checkReady();
    }, (e) => debugWarn(this.el, 'overlay-build', `overlay build failed: ${e.message}`));
  }

  requestMap(stretch) {
    const opts = mapOptions(this.mapOpts()), key = mapKey(this.geom, opts);
    if (this.want.map === key || (stretch && this.res.map)) return;
    this.want.map = key;
    acquireMap(this.geom, opts, this.interacting > 0).then((entry) => {
      if (!entry) return;
      if (this.dead || this.want.map !== entry.key || this.tier !== 'a') { mapCache.release(entry); return; }
      const prev = this.res.map;
      this.res.map = entry;
      this.syncFilter();
      syncDebugVars(this);
      mapCache.release(prev);
      settleResize(this);
      this.checkReady();
    }, (e) => { endResize(this); debugWarn(this.el, 'map-build', `map build failed: ${e.message}`); });
  }

  requestRim(stretch) {
    const opts = { b: +fmt(this.d.b, 2), mapScale: this.d.mapScale }, key = rimKey(this.geom, opts); // a smooth ramp: map resolution suffices
    if (this.want.rim === key || (stretch && this.res.rim)) return;
    this.want.rim = key;
    acquireRimMask(this.geom, opts).then((entry) => {
      if (!entry) return;
      if (this.dead || this.want.rim !== entry.key) { overlayCache.release(entry); return; }
      const prev = this.res.rim;
      this.res.rim = entry;
      this.syncFilter();
      syncDebugVars(this);
      overlayCache.release(prev);
      settleResize(this);
    }, () => endResize(this));
  }

  dropRim() {
    overlayCache.release(this.res.rim);
    this.res.rim = null;
    this.want.rim = null;
  }

  dropOverlay() {
    overlayCache.release(this.res.overlay);
    this.res.overlay = null;
    this.want.overlay = null;
    this.setVar('--_lg-overlay', null);
    this.setVar('--_lg-ov-slice', null);
    this.setVar('--_lg-ov-width', null);
  }

  dropRefraction() {
    if (this.fork) { this.fork.destroy(); this.fork = null; }
    releaseFilter(this.res.filter);
    mapCache.release(this.res.map);
    releaseLens(this);
    this.res.filter = this.res.map = null;
    this.want.map = null;
    if (!(this.o.customBackdrop && this.tier === 'a')) this.setVar('--_lg-bf', this.restBf());
  }

  /** Places a map entry in the filter region, stretched if the element has resized since. */
  placeMap(entry, strength) {
    const d = this.d, m = entry.meta, mx = m.marginX ?? m.margin, my = m.marginY ?? m.margin;
    const sx = d.w / (m.Wc - 2 * mx), sy = d.h / (m.Hc - 2 * my);
    const placed = { href: entry.url, x: d.overL - mx * sx, y: d.over - my * sy, width: m.Wc * sx, height: m.Hc * sy, scale: m.scale * strength };
    if (m.tiles) { placed.tiles = m.tiles; placed.href2 = entry.urls?.[1]; }
    return placed;
  }

  /**
   * Frosted buttons keep a sharper rim (VIS-11): see GlassFilter `sharp`. It costs a second blur
   * and displacement of the whole layer, so it is limited to button-sized glass (≤ 64 px tall,
   * ≤ 16 000 px²), where the bezel is most of the surface. Clear glass is sharp already. Decided
   * on the frost before the "Clear" preference, so dragging it never changes the filter's graph.
   */
  wantsSharpRim() {
    const { w, h } = this.geom;
    return this.o.variant !== 'clear' && this.d?.sigma0 >= 2 && !this.o.latent && Math.min(w, h) <= 64 && w * h <= 16000;
  }

  /**
   * The rim pass { ...rim box, blur }, or null. Button-sized glass: σ/3 (wantsSharpRim). Dispersing
   * glass needs one for the split anyway, and it eases from σ to σ/3 over the first half of the
   * dispersion range: a fringe shows on detail, hardly on frost. From σ at dispersion 0+ it is
   * continuous with no rim pass at all.
   */
  sharpRim(split) {
    const d = this.d, rim = this.res.rim;
    if (!rim) return null;
    const box = { href: rim.url, x: d.overL, y: d.over, width: d.w, height: d.h };
    if (this.wantsSharpRim()) return { ...box, blur: d.sigma / 3 };
    if (!split) return null;
    const w = Math.min(1, d.k / (0.5 * DISPERSION_REST));
    return { ...box, blur: d.sigma * (1 - (2 / 3) * w) };
  }

  /** Resting filter spec, or null when there is nothing to refract with (yet). */
  restSpec() {
    const d = this.d, map = this.res.map;
    if (!d || !map || this.tier !== 'a' || this.o.latent || this.o.customBackdrop) return null;
    const rim = this.res.rim;
    const box = rim && { href: rim.url, x: d.overL, y: d.over, width: d.w, height: d.h };
    // R/B split at the edge: 2k·D·strength (CSS px). Below half a device pixel it is invisible, and
    // the filter stays single-pass. The split is drawn by the rim pass (`sharp`), masked to the rim,
    // so the plateau is pixel-identical to no dispersion; it waits for the rim mask.
    const split = !!box && d.k > 0 && 2 * d.k * d.reach * d.strength * caps.dpr >= 0.5;
    return {
      width: d.Wc, height: d.Hc, blur: d.sigma, enc: config.encoding, map: this.placeMap(map, d.strength),
      dispersion: split ? d.k : 0, split, tone: d.tone, flatten: this.o.flatten,
      // The vivid rim is part of the material: it fades with the "Clear" preference, like the tone.
      vivid: this.o.quality === 'high' && box ? { ...box, amount: clearKeep() } : null, sharp: box ? this.sharpRim(split) : null,
    };
  }

  /** Points --_lg-bf at the right filter: the fork while animating, else a shared filter. */
  syncFilter() {
    if (this.dead) return;
    if (this.anim.users) { this.writeFork(); return; }
    const spec = this.restSpec();
    if (!spec) {
      const had = !!this.res.filter;
      if (had) { releaseFilter(this.res.filter); this.res.filter = null; }
      if (!this.o.customBackdrop || this.tier !== 'a') {
        if (had && this.tier === 'a') this.syncFrost(); // the frost was left as it was under the filter
        this.setVar('--_lg-bf', this.restBf()); // never leave it on a destroyed fork
      }
      return;
    }
    if (this.res.filter?.key === filterKey(spec)) {
      this.setVar('--_lg-bf', this.res.filter.filter.url); // may still point at a released fork
      return;
    }
    // Same graph, and nobody else holds this filter: it follows in place (a preference step
    // rewrites attributes instead of minting a <filter> per value).
    if (retargetFilter(this.res.filter, spec)) {
      this.setVar('--_lg-bf', this.res.filter.filter.url);
      this.checkReady();
      return;
    }
    const next = acquireFilter(spec);
    this.setVar('--_lg-bf', next.filter.url);
    releaseFilter(this.res.filter);
    this.res.filter = next;
    if (this.wasB) { this.wasB = false; this.syncFrost(); }
    this.checkReady();
  }

  checkReady() {
    if (this.readyFired) return;
    const refracting = this.tier === 'a' && !this.o.latent && !this.o.customBackdrop;
    if (this.tier !== 'none' && (!this.res.overlay || (refracting && !this.res.filter && !this.fork))) return;
    this.readyFired = true;
    emit(this.el, 'glass:ready', { tier: this.tier });
  }

  // ── Forks (§3.9): private filter copies whose cheap attributes animate ───
  beginAnimation() {
    if (this.lookStale) this.reconcile();
    this.anim.users++;
    this.writeFork();
  }
  endAnimation() {
    this.anim.users = Math.max(0, this.anim.users - 1);
    if (this.anim.users) return;
    const fork = this.fork;
    this.fork = null;
    this.syncFilter(); // back to the shared filter (or none)
    if (fork) fork.destroy();
    this.syncMatMode();
  }

  /**
   * Spec of the animated copy: rest filter × materialize, + energize, + lift lens crossfade. At
   * materialize 0 it is an exact pass-through of the backdrop (no blur, no displacement, identity
   * tone), so the layer can stay opaque while the glass forms instead of crossfading (V14).
   */
  forkSpec() {
    const d = this.d;
    if (!d || this.tier !== 'a' || this.o.customBackdrop) return null;
    const a = this.anim, rest = this.restSpec(), mat = clamp(a.mat, 0, 1);
    const lensOn = !!this.lens?.entry && (a.lift > 0 || this.fork?.spec.enc === 'g2');
    if (!rest && !lensOn) return null;
    const f = clamp(a.lift, 0, 1);
    const toned = [d.tone[0], d.tone[1], d.tone[2] + 0.04 * a.energize];
    const tone = toned.map((v, i) => lerp(IDENTITY_TONE[i], v, mat));
    if (!lensOn) {
      return { ...rest, blur: d.sigma * mat, map: { ...rest.map, scale: rest.map.scale * mat }, tone, alt: null, mix: 1, smooth: null,
        sharp: rest.sharp && { ...rest.sharp, blur: rest.sharp.blur * mat } };
    }
    const lens = this.lens, map = this.placeMap(lens.entry, d.strength);
    map.scale *= f * mat;
    // The share of the baked, rim-ramped split: the lens's own k, or the page-wide one when stronger.
    const share = tiers.dispersing.has(this) && lens.k > 0 ? Math.min(1, lensDispersion(this, this.liftOpts.dispersion, this.o.dispersion).k / lens.k) : 0;
    if (!share && map.tiles === 4) { map.tiles = 2; map.href2 = null; } // no split: one displacement, not three
    return {
      width: d.Wc, height: d.Hc, enc: 'g2', flatten: this.o.flatten, vivid: null,
      blur: lerp(d.sigma, lens.sigma * clearKeep(), f) * mat, map,
      dispersion: share * f,
      smooth: lens.smooth * f, tone,
      alt: rest ? { ...rest.map, scale: rest.map.scale * mat } : null, mix: rest ? f : 1,
    };
  }

  /** Updates the fork from the animation state; only while an animation holds it. */
  writeFork() {
    if (!this.anim.users || this.dead) return;
    const spec = this.forkSpec();
    if (!spec) return;
    if (this.fork && this.fork.structure === structureOf(spec)) { this.fork.set(spec); return; }
    const prev = this.fork;
    this.fork = new GlassFilter(spec);
    this.setVar('--_lg-bf', this.fork.url);
    if (prev) prev.destroy();
    this.syncMatMode();
    this.checkReady();
  }

  /** While materializing, a Tier A fork carries the effect, so the layer stays opaque ('fork'). */
  syncMatMode() {
    if (!this.el.hasAttribute('data-lg-mat')) return;
    const fork = !!this.fork && !this.o.latent && !!this.restSpec();
    const v = fork ? 'fork' : '';
    if (this.el.getAttribute('data-lg-mat') !== v) this.el.setAttribute('data-lg-mat', v);
  }

  // ── Transform channels ───────────────────────────────────────────────────
  /** Named transform contributions (press, materialize, lift, stretch, …), composed into the
   * host's individual `scale` and `translate` properties so they never fight each other or the
   * author's `transform`. */
  setChannel(name, { sx = 1, sy = 1, tx = 0, ty = 0 } = {}) {
    if (this.dead) return;
    this.channels.set(name, { sx, sy, tx, ty });
    this.writeTransform();
  }
  clearChannel(name) {
    if (!this.dead && this.channels.delete(name)) this.writeTransform();
  }
  writeTransform() {
    if (this.dead) return;
    const { sx, sy, tx, ty } = this.transform, s = this.el.style;
    s.scale = sx === 1 && sy === 1 ? '' : `${fmt(sx, 4)} ${fmt(sy, 4)}`;
    s.translate = tx === 0 && ty === 0 ? '' : `${fmt(tx, 2)}px ${fmt(ty, 2)}px`;
    if (this.o?.scaleVars) {
      this.setVar('--_lg-scale-x', sx === 1 ? null : fmt(sx, 4));
      this.setVar('--_lg-scale-y', sy === 1 ? null : fmt(sy, 4));
    }
  }
}

/** Whether `el` carries text of its own: nested glass and aria-hidden parts do not count. */
function hasText(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1
      ? (n.classList.contains('glass') || n.getAttribute('aria-hidden') === 'true' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP)
      : /\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  return !!walker.nextNode();
}

const radiusSignature = (cs) => `${RADIUS_PROPS.map((k) => cs[k]).join('|')}|${cs.borderTopWidth}`;

function registerGlass(el, opts) {
  if (!(el instanceof Element)) throw new TypeError('LiquidGlass.register: expected an Element');
  let inst = registry.get(el);
  if (inst) {
    if (opts && Object.keys(opts).length) inst.update(opts);
    return inst;
  }
  ensureInit();
  inst = new Glass(el, opts);
  registry.set(el, inst);
  instances.add(inst);
  if (!el.classList.contains('glass')) { el.classList.add('glass'); inst.addedClass = true; }
  inst.read();
  inst.visible = isNearViewport(el);
  inst.onScreen = isNearViewport(el, 0);
  inst.updateTone();
  applyStaticTier(inst);
  // A Tier A candidate renders after the budget pass (a microtask away), not twice.
  if (inst.tierReason !== 'pending') inst.reconcile();
  observeGlass(inst);
  syncInteraction(inst);
  debugChecks(inst);
  scheduleTierEvaluation(true);
  return inst;
}

function destroyGlass(inst) {
  if (inst.dead) return;
  const el = inst.el;
  releaseHost(inst);
  inst.dead = true;
  instances.delete(inst);
  registry.delete(el);
  unobserveGlass(inst);
  inst.ctl.abort();
  stopInteraction(inst);
  clearTimeout(inst.resizeTimer);
  tiers.dispersing.delete(inst);
  inst.anim.users = 0;
  if (inst.fork) inst.fork.destroy();
  inst.fork = null;
  releaseFilter(inst.res.filter);
  mapCache.release(inst.res.map);
  overlayCache.release(inst.res.overlay);
  overlayCache.release(inst.res.rim);
  releaseLens(inst);
  releaseFrost(inst.bk);
  inst.bk = null;
  for (const sp of [inst.liftSpring, inst.mat?.amount, inst.mat?.scale, inst.mat?.y, inst.stretcher?.spring]) sp?.stop();
  inst.mat?.content?.stop();
  syncPointerLight(inst);
  inst.channels.clear(); // late promise continuations (stretch release, unlift) find nothing to write
  for (const name of inst.vars) el.style.removeProperty(name);
  for (const a of OWNED_ATTRS) el.removeAttribute(a);
  el.style.scale = ''; el.style.translate = '';
  el.style.removeProperty('transform-origin');
  el.style.removeProperty('will-change');
  if (inst.addedClass) el.classList.remove('glass');
  scheduleTierEvaluation();
}

/** One layout read at registration so the first budget pass does not wait for IntersectionObserver. */
function isNearViewport(el, margin = VIEW_MARGIN) {
  const r = el.getBoundingClientRect(), mx = margin * innerWidth, my = margin * innerHeight;
  return r.bottom >= -my && r.right >= -mx && r.top <= innerHeight + my && r.left <= innerWidth + mx && (r.width > 0 || r.height > 0);
}

/**
 * Border box without the element's own core-owned `scale` / `translate` (press, lift, stretch,
 * materialize…), in viewport px; author transforms are kept. Use it for placement and origins.
 */
function layoutRect(el) {
  const inst = registry.get(el);
  if (!inst || !inst.channels.size) return el.getBoundingClientRect();
  const s = el.style, scale = s.scale, translate = s.translate;
  s.scale = ''; s.translate = '';
  const r = el.getBoundingClientRect();
  s.scale = scale; s.translate = translate;
  return r;
}

Object.assign(I, {
  register: (el, opts) => registerGlass(el, opts),
  get: (el) => registry.get(el) || null,
  setChannel: (h, name, t) => h.setChannel(name, t),
  clearChannel: (h, name) => h.clearChannel(name),
  beginAnimation: (h) => h.beginAnimation(),
  endAnimation: (h) => h.endAnimation(),
  setDefaults: (h, opts) => h.setDefaults(opts),
  /** customBackdrop glass: the component's Tier A filter ({ filter: 'url(#…)', over: px }) or null. */
  setBackdrop: (h, spec) => {
    h.custom = spec ? { filter: spec.filter || null, over: Math.max(0, +spec.over || 0) } : null;
    h.reconcile();
  },
  layoutRect,
  instances: () => [...instances],
});
// ── core-10-tier.js ─────────────────────────────────────────────────────────
// Tier assignment and the refraction budget (§2.4).

const tiers = {
  timer: 0,
  microtask: false,
  dispersing: new Set(), // instances that render dispersion (see evaluateTiers)
  claims: new Set(),     // I.budget.claim(): Tier A glass drawn outside any handle
};
const MAX_DISPERSING = 2; // lenses dispersing only by their own, automatic split at the same time
const LARGE_AREA = 240000; // ≈ 600×400: large glass is frosted (Apple makes it more opaque too)

/** Everything except the budget. Returns { tier, reason, forced }. */
function staticTier(inst) {
  const o = inst.o, forced = o.tier !== 'auto' ? o.tier : state.forceTier;
  if (isForcedColors()) return { tier: 'c', reason: 'forced-colors' };
  if (!caps.hasBackdrop) return { tier: 'c', reason: 'no-backdrop-filter' };
  if (isReducedTransparency()) return { tier: 'c', reason: 'reduced-transparency' };
  if (isContrastMore()) return { tier: 'c', reason: 'increased-contrast' };
  if (o.variant === 'identity') return { tier: 'none', reason: 'identity' };
  if (forced === 'b' || forced === 'c') return { tier: forced, reason: o.tier !== 'auto' ? 'attribute' : 'override' };
  if (!caps.liveRefraction) return { tier: 'b', reason: 'no-live-refraction' };
  if (o.refractionOff || o.refraction === 0) return { tier: 'b', reason: 'refraction-off' };
  if (forced !== 'a' && inst.area > LARGE_AREA) return { tier: 'b', reason: 'large-surface' };
  return { tier: 'a', reason: 'ok', forced: forced === 'a' };
}

function setTier(inst, tier, reason) {
  inst.tierReason = reason;
  if (inst.tier === tier) {
    if (!inst.d) inst.reconcile(); // first render was deferred until admission
    return;
  }
  const first = inst.tier === null;
  // Promoted from a rendered Tier B: keep showing that frost until the refraction filter is ready,
  // so the swap happens once (frost → refraction) rather than frost → thinner frost → refraction.
  inst.wasB = tier === 'a' && inst.tier === 'b' && !!inst.d;
  inst.tier = tier;
  inst.el.setAttribute('data-lg-tier', tier);
  if (first) return; // registerGlass renders
  inst.reconcile();
  emit(inst.el, 'glass:tier', { tier, reason });
}

/** Applies the non-budget rules right away; Tier A candidates keep their tier until admission. */
function applyStaticTier(inst) {
  const st = staticTier(inst);
  if (st.tier !== 'a') setTier(inst, st.tier, st.reason);
  else if (inst.tier === null || inst.tier !== 'a') setTier(inst, 'b', 'pending');
}

/** Budget pass: debounced (250 ms) unless `soon`, which runs it in a microtask. */
function scheduleTierEvaluation(soon = false) {
  if (!state.initialized) return;
  if (soon) {
    if (tiers.microtask) return;
    tiers.microtask = true;
    queueMicrotask(() => { tiers.microtask = false; evaluateTiers(); });
    return;
  }
  clearTimeout(tiers.timer);
  tiers.timer = setTimeout(evaluateTiers, 250);
}

/**
 * Admission rules:
 * - forced (data-glass-tier="a") glass is always admitted and counts;
 * - lifted glass is always admitted and does not count (lenses are small and short-lived, so a
 *   lift never demotes anything else);
 * - glass that is being pressed or is held (I.hold) keeps its tier: no pop mid-interaction;
 * - everything else near the viewport is ranked: on screen first, then by priority, then
 *   incumbency (already Tier A), then area.
 */
function evaluateTiers() {
  clearTimeout(tiers.timer);
  if (!state.initialized) return;
  const max = config.maxRefractive ?? (caps.coarse ? 4 : 8);
  // A zero-size viewport (hidden frame) has no meaningful area budget; the count still applies.
  const viewport = innerWidth * innerHeight;
  const maxArea = viewport ? config.maxRefractiveAreaRatio * viewport : Infinity;
  const always = [], lifted = [], ranked = [];
  for (const inst of instances) {
    const st = staticTier(inst);
    if (st.tier !== 'a') { setTier(inst, st.tier, st.reason); continue; }
    if (inst.o.latent && !inst.lifted) { setTier(inst, 'a', 'latent'); continue; } // costs nothing at rest
    if (inst.lifted) lifted.push(inst);
    else if (st.forced) always.push(inst);
    else if (inst.interacting || inst.holds) {
      if (inst.tier === 'a') always.push(inst);
      else if (inst.tier === null) setTier(inst, 'b', 'pending');
      else setTier(inst, inst.tier, inst.interacting ? 'interacting' : 'held');
    } else if (inst.visible) ranked.push(inst);
    else if (inst.tier !== 'a') setTier(inst, 'b', 'offscreen'); // off-screen A keeps its tier, uncounted
  }
  for (const c of tiers.claims) if (c.visible) ranked.push(c);
  const priority = (x) => (x instanceof Glass ? x.o.priority : x.priority);
  // Glass on screen comes first: glass in the margin around it is promoted ahead of time only
  // with the slots left over, so it never keeps refraction from glass the user is looking at.
  ranked.sort((a, b) => +b.onScreen - +a.onScreen || priority(b) - priority(a) || +(b.tier === 'a') - +(a.tier === 'a') || a.area - b.area);
  let count = 0, area = 0;
  for (const inst of lifted) setTier(inst, 'a', 'lifted');
  for (const inst of always) {
    setTier(inst, 'a', inst.o.tier === 'a' || state.forceTier === 'a' ? 'forced' : inst.interacting ? 'interacting' : 'held');
    count++; area += inst.area;
  }
  for (const x of ranked) {
    const admit = count < max && area + x.area <= maxArea;
    if (admit) { count++; area += x.area; }
    if (x instanceof Glass) setTier(x, admit ? 'a' : 'b', admit ? 'ok' : 'budget');
    else x.set(admit);
  }
  for (const c of tiers.claims) if (!c.visible) c.set(false);
  assignDispersion([...lifted, ...always, ...ranked]);
}

/** Dispersion someone asked for: the element, --glass-dispersion (the page) or setPreferences. */
const asksDispersion = (inst) => inst.o.dispersion > 0;
/**
 * A lens's own, automatic dispersion: a lifted part's (lift({ dispersion }), 0.8 by default) or a
 * component's that renders one (the magnifier's `autoDispersion` option).
 */
const autoDispersion = (inst) => (inst.lifted && inst.liftOpts?.dispersion > 0) || inst.o.autoDispersion > 0;
const autoDispersing = () => [...tiers.dispersing].filter((i) => !asksDispersion(i)).length;

/**
 * Tier A glass disperses when its dispersion was asked for (no cap beyond the refraction budget:
 * each adds a rim pass split per channel, whose cost grows with the glass's area). A lens's
 * automatic dispersion takes one of MAX_DISPERSING slots, lifted lenses first, then by rank.
 * `order`: the budget pass's ranking.
 */
function assignDispersion(order) {
  // An automatic slot is handed back when its lens leaves the margin around the viewport (Tier A
  // glass keeps its tier off screen), so lenses the user can see get the slots.
  const drop = (inst) => inst.dead || inst.tier !== 'a' || (asksDispersion(inst) ? false : !autoDispersion(inst) || (!inst.visible && !inst.lifted));
  for (const inst of [...tiers.dispersing]) if (drop(inst)) setDispersing(inst, false);
  let auto = autoDispersing();
  for (const inst of order) {
    if (!(inst instanceof Glass) || inst.tier !== 'a' || tiers.dispersing.has(inst)) continue;
    const asks = asksDispersion(inst);
    if (!asks && !(autoDispersion(inst) && auto < MAX_DISPERSING)) continue;
    if (!asks) auto++;
    setDispersing(inst, true);
    inst.reconcile();
  }
}

/**
 * A lens's dispersion (a lifted part, the magnifier): its own look, k = DISPERSION_LENS · own, or
 * the page-wide setting (k = DISPERSION_REST · dispersion) where that is stronger. The own look is
 * part of the frosted material, so it fades with the "Clear" preference like the frost (clearKeep):
 * at pure clear only the page-wide chromatic aberration splits a lens. `build` is the split to bake
 * into its lens maps: the own look at full strength, or while the page-wide setting is on the
 * strongest it can ask for, so dragging either preference only changes the filter's share
 * (k / build), never the maps.
 */
function lensDispersion(inst, own, page = inst?.o?.pageDispersion ?? 0, t = state.tinted) {
  const kOwn = DISPERSION_LENS * (own || 0), kPage = DISPERSION_REST * page;
  return { k: Math.max(kOwn * clearKeep(t), kPage), build: page > 0 ? Math.max(kOwn, DISPERSION_REST) : kOwn };
}

/**
 * Grants or takes back one of the dispersion slots. Glass that draws its own backdrop learns of
 * it from `glass:dispersion` { dispersing } (its d.k is current by the time listeners run).
 */
function setDispersing(inst, on) {
  if (on === tiers.dispersing.has(inst)) return;
  if (on) tiers.dispersing.add(inst); else tiers.dispersing.delete(inst);
  if (inst.dead) return;
  if (inst.d) inst.d.k = on ? DISPERSION_REST * inst.o.dispersion : 0;
  emit(inst.el, 'glass:dispersion', { dispersing: on });
}

/**
 * A Tier A budget slot for glass drawn outside any handle (the .glass-container union). `el` is
 * watched for visibility; onChange(admitted) runs when admission changes.
 */
class BudgetClaim {
  constructor(el, { area = 0, priority = 0, onChange } = {}) {
    this.el = el; this.area = area; this.priority = priority; this.onChange = onChange;
    this.tier = null; this.admitted = false;
    this.visible = HAS_DOM && el.isConnected ? isNearViewport(el) : false;
    this.onScreen = HAS_DOM && el.isConnected ? isNearViewport(el, 0) : false;
    tiers.claims.add(this);
    watchVisibility(el);
    scheduleTierEvaluation(true);
  }
  set(admitted) {
    this.tier = admitted ? 'a' : 'b';
    if (admitted === this.admitted) return;
    this.admitted = admitted;
    try { this.onChange?.(admitted); } catch (e) { console.error('[liquid-glass] budget claim onChange failed', e); }
  }
  update({ area, priority } = {}) {
    if (area != null) this.area = area;
    if (priority != null) this.priority = priority;
    scheduleTierEvaluation(true);
  }
  release() {
    if (!tiers.claims.delete(this)) return;
    if (!registry.has(this.el)) unwatchVisibility(this.el);
    scheduleTierEvaluation(true);
  }
}

/** Tier-A element count for stats(). */
const tierACount = () => [...instances].filter((i) => i.tier === 'a' && (i.res.filter || i.fork || (i.o.customBackdrop && i.custom))).length
  + [...tiers.claims].filter((c) => c.admitted).length;

I.evaluateTiers = () => scheduleTierEvaluation(true);
/** (handle, own dispersion, page-wide dispersion?, tinted?) → { k, build }: see lensDispersion. */
I.lensDispersion = (h, own, page, t) => lensDispersion(h, own, page, t);
I.budget = { claim: (el, opts) => new BudgetClaim(el, opts) };
/** Keeps `h` at its current tier (no promotion or demotion) until release() is called. */
I.hold = (h) => {
  h.holds++;
  let held = true;
  return () => { if (held && !h.dead) { held = false; h.holds = Math.max(0, h.holds - 1); scheduleTierEvaluation(); } };
};
// ── core-11-tone.js ─────────────────────────────────────────────────────────
// Adaptive tone (§6.1.6). Small glass (≤ 64 px tall, or data-glass-tone="adaptive") flips between
// light and dark with the backdrop behind it. Thresholds sit around the WCAG crossover
// Y = √(1.05·0.05) − 0.05 ≈ 0.179, where black and white text contrast equally. The same samples
// drive the clear variant's automatic dim (V9) and the busy-backdrop shadow (V5).

const TONE_DARK_BELOW = 0.16;
const TONE_LIGHT_ABOVE = 0.24;
const TONE_NEUTRAL_Y = Math.sqrt(1.05 * 0.05) - 0.05;
const TONE_DWELL_MS = 150;
const SAMPLE_INTERVAL_MS = 100; // ≤ 10 Hz
const DIM_ON_ABOVE = 0.40, DIM_OFF_BELOW = 0.30; // clear glass: the 35 % dim only over bright content
const SNAPSHOT_SIZE = 256; // long side of a media snapshot, in px

// all: sample every eligible element; scroll: only floating ones (fixed/sticky) and waiting ones;
// entered: these. waiting: in-flow glass due a sample while it was near, not yet on, the screen.
const toneState = { timer: 0, last: 0, followUp: 0, all: false, scroll: false, entered: new Set(), waiting: new WeakSet() };
const imageSnapshots = new WeakMap(); // <img> → { src, snap } (images do not change under the same src)
let snapCanvas = null;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** WCAG relative luminance of 8-bit sRGB. */
const luminance = (r, g, b) => 0.2126 * srgbToLinear(r / 255) + 0.7152 * srgbToLinear(g / 255) + 0.0722 * srgbToLinear(b / 255);

/** Next tone given the current one and a luminance sample (hysteresis). null Y keeps the tone. */
function nextTone(current, Y) {
  if (Y == null) return current;
  if (current === 'light' && Y < TONE_DARK_BELOW) return 'dark';
  if (current === 'dark' && Y > TONE_LIGHT_ABOVE) return 'light';
  return current;
}

// ── Colours ────────────────────────────────────────────────────────────────
function parseColor(str) {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/.exec(str || '');
  if (!m) return null;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
  return [+m[1], +m[2], +m[3], a];
}

const colorCache = new Map();
let colorCtx = null;
/** Any CSS colour → [r, g, b, a] (8-bit sRGB), through a 1 px canvas for non-rgb() syntaxes. */
function toRGBA(str) {
  const direct = parseColor(str);
  if (direct) return direct;
  let c = colorCache.get(str);
  if (c) return c;
  if (!colorCtx) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    colorCtx = cv.getContext('2d', { willReadFrequently: true });
  }
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#0000';
  colorCtx.fillStyle = str;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  c = [d[0], d[1], d[2], d[3] / 255];
  if (colorCache.size > 256) colorCache.clear();
  colorCache.set(str, c);
  return c;
}

/** Splits a CSS value on top-level commas (or whitespace with `ws`). */
function splitTop(s, ws = false) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (ch === ',' || (ws && /\s/.test(ch)))) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Computed values serialize every colour as a function (rgb(), color(), oklch()…) or a hex.
const COLOR_TOKEN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(|^#/i;

/**
 * The colour of one background layer as [r, g, b, a], or null when it cannot be known (url(),
 * image-set(), element()…). With a point `pt` = { x, y, w, h } (element-local px), a linear
 * gradient is evaluated there; otherwise, and for radial, conic and repeating gradients, the
 * mean of the stops is used.
 */
function layerColor(layer, pt) {
  const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/i.exec(layer);
  if (!m) return null;
  const args = splitTop(m[3]);
  let angle = 180, first = 0;
  if (args.length && !COLOR_TOKEN.test(splitTop(args[0], true)[0])) { // direction, shape or position
    first = 1;
    const a = args[0], w = pt?.w || 1, h = pt?.h || 1;
    if (m[2] === 'linear' && /^to\s/.test(a)) {
      const parts = a.slice(3).trim().split(/\s+/), sx = parts.includes('right') ? 1 : parts.includes('left') ? -1 : 0, sy = parts.includes('bottom') ? 1 : parts.includes('top') ? -1 : 0;
      // A corner direction is perpendicular to the diagonal joining the two other corners.
      angle = (Math.atan2(sx * (sy ? h : 1), -sy * (sx ? w : 1)) * 180) / Math.PI;
    } else if (m[2] === 'linear') angle = parseAngle(a, 180);
  }
  const stops = [];
  for (const arg of args.slice(first)) {
    const [color, ...pos] = splitTop(arg, true);
    if (!COLOR_TOKEN.test(color)) continue; // a bare colour hint
    const c = toRGBA(color);
    if (!pos.length) stops.push({ c, at: null });
    for (const p of pos) stops.push({ c, at: p });
  }
  if (!stops.length) return null;
  if (!pt || m[1] || m[2] !== 'linear' || stops.length === 1) { // mean of the stops
    const sum = stops.reduce((s, { c }) => s.map((v, i) => v + (i < 3 ? c[i] * c[3] : c[3])), [0, 0, 0, 0]);
    return sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3], sum[3] / stops.length] : [0, 0, 0, 0];
  }
  const { x: px, y: py, w, h } = pt, rad = (angle * Math.PI) / 180, dx = Math.sin(rad), dy = -Math.cos(rad);
  const L = Math.abs(w * dx) + Math.abs(h * dy) || 1;
  const t = ((px - w / 2) * dx + (py - h / 2) * dy) / L + 0.5;
  // Stop positions: %, px (of the gradient line) or missing (spread evenly); monotonic (CSS rules).
  const at = stops.map((s) => (s.at == null ? null : /%$/.test(s.at) ? parseFloat(s.at) / 100 : parseFloat(s.at) / L));
  if (at[0] == null || !Number.isFinite(at[0])) at[0] = 0;
  if (at[at.length - 1] == null || !Number.isFinite(at[at.length - 1])) at[at.length - 1] = 1;
  for (let i = 1; i < at.length; i++) if (at[i] != null) at[i] = Math.max(at[i], at[i - 1] ?? 0);
  for (let i = 1; i < at.length; i++) {
    if (at[i] != null) continue;
    let j = i; while (at[j] == null) j++;
    for (let k = i; k < j; k++) at[k] = at[i - 1] + ((at[j] - at[i - 1]) * (k - i + 1)) / (j - i + 1);
  }
  if (t <= at[0]) return stops[0].c;
  for (let i = 1; i < stops.length; i++) {
    if (t <= at[i]) {
      const u = at[i] > at[i - 1] ? (t - at[i - 1]) / (at[i] - at[i - 1]) : 1, a = stops[i - 1].c, b = stops[i].c;
      const alpha = lerp(a[3], b[3], u);
      return alpha ? [0, 1, 2].map((k) => lerp(a[k] * a[3], b[k] * b[3], u) / alpha).concat(alpha) : [0, 0, 0, 0];
    }
  }
  return stops[stops.length - 1].c;
}

/**
 * An element's own background, composited top layer first: [r, g, b, a], or null when it is
 * unknowable (an image). With `box` (the element's rect) and a viewport point (x, y), linear
 * gradients are evaluated at that point; without, they are averaged.
 */
function backgroundAt(cs, x, y, box) {
  const layers = [];
  if (cs.backgroundImage && cs.backgroundImage !== 'none') {
    const pt = box ? { x: x - box.left, y: y - box.top, w: box.width, h: box.height } : null;
    for (const layer of splitTop(cs.backgroundImage)) {
      if (layer === 'none') continue;
      const c = layerColor(layer, pt);
      if (!c) return null; // an image we cannot read: do not guess through it
      layers.push(c);
    }
  }
  layers.push(toRGBA(cs.backgroundColor));
  let acc = [0, 0, 0], accA = 0;
  for (const c of layers) {
    const k = (1 - accA) * c[3];
    acc = acc.map((v, i) => v + k * c[i]);
    accA += k;
  }
  return accA ? [acc[0] / accA, acc[1] / accA, acc[2] / accA, accA] : [0, 0, 0, 0];
}

function hintLuminance(v) {
  if (v === 'light') return 0.85;
  if (v === 'dark') return 0.03;
  const n = parseFloat(v);
  return Number.isFinite(n) ? clamp(n, 0, 1) : null;
}

// ── Media ──────────────────────────────────────────────────────────────────
/** A small readable copy of an img/canvas/video (one GPU readback), or null (tainted, not ready). */
function snapshot(el) {
  const iw = el.videoWidth || el.naturalWidth || el.width, ih = el.videoHeight || el.naturalHeight || el.height;
  if (!iw || !ih || (el.readyState != null && el.readyState < 2)) return null;
  const k = Math.min(1, SNAPSHOT_SIZE / Math.max(iw, ih)), W = Math.max(1, Math.round(iw * k)), H = Math.max(1, Math.round(ih * k));
  try {
    const c = snapCanvas || (snapCanvas = document.createElement('canvas'));
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high'; // an area average: plain bilinear skips most source pixels
    g.drawImage(el, 0, 0, W, H);
    return { W, H, data: g.getImageData(0, 0, W, H).data }; // throws on tainted sources
  } catch {
    return null;
  }
}

/** Average luminance of an ~8 px patch of a same-origin/CORS-clean img, canvas or video at a point. */
function mediaLuminance(el, x, y, pass) {
  let snap;
  if (el instanceof HTMLImageElement) {
    const cached = imageSnapshots.get(el);
    if (cached?.src === el.currentSrc) snap = cached.snap;
    else { snap = snapshot(el); imageSnapshots.set(el, { src: el.currentSrc, snap }); }
  } else if (pass.media.has(el)) snap = pass.media.get(el);
  else { snap = snapshot(el); pass.media.set(el, snap); }
  if (!snap) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const fx = snap.W / r.width, fy = snap.H / r.height;
  const i0 = Math.floor((x - r.left - 4) * fx), i1 = Math.ceil((x - r.left + 4) * fx);
  const j0 = Math.floor((y - r.top - 4) * fy), j1 = Math.ceil((y - r.top + 4) * fy);
  let sum = 0, n = 0;
  for (let j = Math.max(0, j0); j < Math.min(snap.H, Math.max(j1, j0 + 1)); j++) {
    for (let i = Math.max(0, i0); i < Math.min(snap.W, Math.max(i1, i0 + 1)); i++) {
      const k = (j * snap.W + i) * 4;
      sum += luminance(snap.data[k], snap.data[k + 1], snap.data[k + 2]); n++;
    }
  }
  return n ? sum / n : null;
}

// ── Backdrop sampling ──────────────────────────────────────────────────────
/**
 * The fill a glass element paints over its backdrop, [r, g, b, a] (its ::before, which carries
 * the tone, the fill opacity and, for latent glass at rest, visibility 0).
 */
function glassFill(el) {
  const cs = getComputedStyle(el, '::before'), c = toRGBA(cs.backgroundColor);
  return [c[0], c[1], c[2], cs.display === 'none' ? 0 : c[3] * (+cs.opacity || 0)];
}

/**
 * What lies behind glass `self` at a viewport point: { Y, text } (Y = luminance, or null if
 * unknown; text = the backdrop is busy: text right behind the glass, media or a repeating
 * pattern), composited front to back. Other glass is foreground and skipped, except glass that
 * contains `self` (a button in a panel): its fill and content are what `self` sits on.
 */
function backdropAt(x, y, pass, self) {
  let acc = [0, 0, 0], accA = 0, text = false, front = true;
  const over = (c) => { // composites c = [r, g, b, a] under what is already in front
    const k = (1 - accA) * c[3];
    acc = acc.map((v, i) => v + k * c[i]);
    accA += k;
  };
  // An opaque layer of known luminance (a hint, a media sample) ends the walk.
  const onto = (Y) => {
    if (Y == null) return null;
    const v = 255 * (Y <= 0.0031308 ? 12.92 * Y : 1.055 * Y ** (1 / 2.4) - 0.055);
    over([v, v, v, 1]);
    return luminance(...acc);
  };
  for (const e of document.elementsFromPoint(x, y)) {
    if (self.contains(e) || e.closest('#lg-defs')) continue;
    const g = e.closest('.glass');
    if (g && !g.contains(self)) continue; // glass is foreground, not backdrop
    if (g === e) { // glass that self sits in: its fill
      over(glassFill(e));
      if (accA > 0.95) break;
      continue;
    }
    if (front) { front = false; text = hasOwnText(e); }
    const hint = e.closest('[data-glass-backdrop]');
    // A hint above that glass describes what lies behind it: it applies once the walk leaves it.
    if (hint && !(g && hint.contains(g))) return { Y: onto(hintLuminance(hint.getAttribute('data-glass-backdrop'))), text };
    if (e instanceof HTMLCanvasElement || e instanceof HTMLImageElement || e instanceof HTMLVideoElement) {
      const Y = mediaLuminance(e, x, y, pass);
      if (Y != null) return { Y: onto(Y), text: true };
      continue;
    }
    const cs = getComputedStyle(e);
    if (/repeating-/.test(cs.backgroundImage)) text = true; // a pattern is as busy as text
    const c = backgroundAt(cs, x, y, cs.backgroundImage !== 'none' ? e.getBoundingClientRect() : null);
    if (!c) return { Y: null, text };
    if (!c[3]) continue;
    over(c);
    if (accA > 0.95) break;
  }
  if (accA < 0.5) return { Y: null, text };
  return { Y: luminance(acc[0] / accA, acc[1] / accA, acc[2] / accA), text };
}

const hasOwnText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.data));

/**
 * Tone estimate from the element's ancestors alone (hints, background colours and gradients,
 * averaged), without hit-testing or layout reads: in-flow glass almost always sits on an
 * ancestor, so this is known before the element is on screen. null = unknown.
 */
function initialTone(inst) {
  let acc = [0, 0, 0], accA = 0;
  for (let a = inst.el.parentElement; a; a = a.parentElement) {
    const hint = a.getAttribute('data-glass-backdrop');
    if (hint != null) { const Y = hintLuminance(hint); return Y == null ? null : Y < TONE_NEUTRAL_Y ? 'dark' : 'light'; }
    const c = registry.has(a) ? glassFill(a) : backgroundAt(getComputedStyle(a), 0, 0, null);
    if (!c) return null;
    if (!c[3]) continue;
    const k = (1 - accA) * c[3];
    acc = acc.map((v, i) => v + k * c[i]);
    accA += k;
    if (accA > 0.95) break;
  }
  if (accA < 0.5) return null;
  return luminance(acc[0] / accA, acc[1] / accA, acc[2] / accA) < TONE_NEUTRAL_Y ? 'dark' : 'light';
}

/** Samples the backdrop at five points of the element; false when none is on screen yet. */
function sampleInstance(inst, now, pass) {
  const r = inst.el.getBoundingClientRect(), inset = Math.min(8, r.width / 4, r.height / 4);
  const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + inset, r.top + inset], [r.right - inset, r.top + inset], [r.left + inset, r.bottom - inset], [r.right - inset, r.bottom - inset]]
    .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
  if (!r.width || !points.length) return false;
  let sum = 0, n = 0, lo = 1, hi = 0, text = false;
  for (const [x, y] of points) {
    const s = backdropAt(x, y, pass, inst.el);
    text ||= s.text;
    if (s.Y != null) { sum += s.Y; n++; lo = Math.min(lo, s.Y); hi = Math.max(hi, s.Y); }
  }
  const Y = n ? sum / n : null;
  // Busy (V5): an uneven backdrop or text right behind the glass deepens the shadow.
  const busy = Math.max(n > 1 ? clamp((hi - lo) / 0.3, 0, 1) : 0, text ? 0.6 : 0);
  inst.setVar('--_lg-so', fmt(0.14 + 0.08 * busy, 2));
  if (inst.dimAuto && Y != null) {
    const on = inst.dimOn ? Y > DIM_OFF_BELOW : Y > DIM_ON_ABOVE;
    if (on !== inst.dimOn) { inst.dimOn = on; setAttr(inst.el, 'data-lg-dim', on ? null : 'off'); }
  }
  if (!inst.adaptive) return true;
  if (!inst.sampledTone) { // first sample: no hysteresis, no dwell, no crossfade
    if (Y == null) return true;
    inst.sampledTone = Y < TONE_NEUTRAL_Y ? 'dark' : 'light';
    inst.setTone(inst.sampledTone, { instant: true });
    return true;
  }
  const current = inst.sampledTone;
  const want = nextTone(current, Y);
  if (want === current) { inst.pendingTone = null; return true; }
  // Dwell: the flip must still hold on a sample at least 150 ms later.
  if (inst.pendingTone?.tone !== want) { inst.pendingTone = { tone: want, since: now }; return true; }
  if (now - inst.pendingTone.since < TONE_DWELL_MS) return true;
  inst.pendingTone = null;
  inst.sampledTone = want;
  inst.setTone(want);
  return true;
}

function runToneSampling() {
  toneState.timer = 0;
  const { all, scroll, entered } = toneState;
  toneState.all = toneState.scroll = false;
  toneState.entered = new Set();
  if (!state.initialized || document.hidden) return;
  const now = performance.now(), pass = { media: new Map() };
  toneState.last = now;
  const pending = new Set(), waiting = toneState.waiting;
  for (const inst of instances) {
    if (!(inst.adaptive || inst.dimAuto) || !inst.visible || inst.dead) { waiting.delete(inst); continue; }
    // In-flow glass scrolls with its backdrop, so scrolling only re-samples floating glass, and
    // glass that entered the margin around the viewport until it is on screen.
    if (!all && !entered.has(inst) && !(scroll && (inst.floating || waiting.has(inst)))) continue;
    if (sampleInstance(inst, now, pass)) waiting.delete(inst); else waiting.add(inst);
    if (inst.pendingTone) pending.add(inst);
  }
  clearTimeout(toneState.followUp);
  if (pending.size) toneState.followUp = setTimeout(() => { for (const i of pending) toneState.entered.add(i); requestToneSample(null); }, TONE_DWELL_MS + 10);
}

/**
 * Throttled to ≤ 10 Hz. scope: 'all' (default: layout changed), 'scroll' (floating glass only),
 * a Glass (just entered the viewport), or null (the queued elements only).
 */
function requestToneSample(scope = 'all') {
  if (!state.initialized) return;
  if (scope === 'all') toneState.all = true;
  else if (scope === 'scroll') toneState.scroll = true;
  else if (scope) toneState.entered.add(scope);
  if (toneState.timer) return;
  const wait = Math.max(0, SAMPLE_INTERVAL_MS - (performance.now() - toneState.last));
  toneState.timer = setTimeout(runToneSampling, wait);
}

function stopToneSampling() {
  clearTimeout(toneState.timer);
  clearTimeout(toneState.followUp);
  toneState.timer = toneState.followUp = 0;
  toneState.all = toneState.scroll = false;
  toneState.entered = new Set();
  toneState.waiting = new WeakSet();
}

/** Glass that stays put while the page scrolls (it or an ancestor is fixed or sticky). */
function isFloating(el) {
  const positions = memo().positions;
  for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
    let p = positions.get(a);
    if (p === undefined) positions.set(a, (p = getComputedStyle(a).position));
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

Object.assign(I, { luminance, nextTone, requestToneSample: () => requestToneSample('all'), TONE_DARK_BELOW, TONE_LIGHT_ABOVE, TONE_NEUTRAL_Y, backgroundAt });
// ── core-12-interact.js ─────────────────────────────────────────────────────
// Press interaction (§5.2) for data-glass-interactive: scale, gel follow, touch glow, neighbour
// spill, keyboard press and (Tier A) energize; plus the optional pointer-following light.
// Pointer handlers only store targets on springs; the shared rAF loop does the writing.

const PRESS_KEYS = new Set([' ', 'Enter']);

/**
 * The press scale for a size: 1 + clamp(5 px / minSide, 0.02, 0.12) (44 → 1.114, 250 → 1.02),
 * capped so the long side grows by at most 10 px (a 560 × 52 bar → 1.018, not 1.096).
 */
const pressScaleFor = (w, h) => 1 + Math.min(clamp(5 / Math.max(1, Math.min(w, h)), 0.02, 0.12), 10 / Math.max(1, w, h));

// pointerdown events already claimed by an interactive glass: the innermost one presses, never
// its interactive ancestors (a button inside an interactive bar).
const claimedPresses = new WeakSet();

/** Glow springs for any instance (pressed elements and spill neighbours). */
function glowOf(inst) {
  if (!inst.glow) {
    inst.glow = {
      amount: new Spring({ preset: 'lift', onUpdate: (v) => inst.setVar('--_lg-glow', fmt(clamp(v, 0, 1))) }),
      radius: new Spring({ preset: 'lift', onUpdate: (v) => inst.setVar('--_lg-gr', `${fmt(Math.max(0, v), 1)}px`) }),
    };
  }
  return inst.glow;
}
function placeGlow(inst, x, y) {
  inst.glowAt = [x, y];
  inst.setVar('--_lg-gx', `${fmt(x, 1)}px`);
  inst.setVar('--_lg-gy', `${fmt(y, 1)}px`);
}

function syncInteraction(inst) {
  if (inst.o.interactive && !inst.press?.ctl) startInteraction(inst);
  else if (!inst.o.interactive && inst.press?.ctl) stopInteraction(inst);
  syncPointerLight(inst);
}

/** Press springs for an instance, created on first use (listeners are separate). */
function pressState(inst) {
  if (inst.press) return inst.press;
  const p = (inst.press = { ctl: null, track: null, down: false, pointerId: null, rect: null, w: 0, h: 0, keyRelease: null, neighbours: [], forked: false });
  const write = () => inst.setChannel('press', { sx: p.scale.value, sy: p.scale.value, tx: p.gx.value, ty: p.gy.value });
  p.scale = new Spring({ value: 1, preset: 'lift', onUpdate: write });
  p.gx = new Spring({ preset: 'lift', onUpdate: write });
  p.gy = new Spring({ preset: 'lift', onUpdate: write });
  p.energize = new Spring({ preset: 'lift', onUpdate: (v) => { inst.anim.energize = v; inst.writeFork(); } });
  return p;
}

function startInteraction(inst) {
  const el = inst.el, p = pressState(inst);
  p.ctl = new AbortController();
  const signal = p.ctl.signal;
  el.addEventListener('pointerdown', (e) => {
    if (claimedPresses.has(e)) return;
    claimedPresses.add(e);
    if (e.button !== 0 || !e.isPrimary || p.down || isDisabled(el)) return;
    // No pointer capture: Chromium retargets `click` to the capture target, which would swallow
    // the clicks of buttons and links inside the glass. The press follows the pointer at window level.
    p.pointerId = e.pointerId;
    trackPointer(inst, p);
    pressStart(inst, e.clientX, e.clientY);
  }, { signal });
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || e.repeat || !PRESS_KEYS.has(e.key) || p.down || isDisabled(el)) return;
    const r = el.getBoundingClientRect();
    p.pointerId = null;
    pressStart(inst, r.left + r.width / 2, r.top + r.height / 2);
    // A 120 ms press, but never fewer than 3 rendered frames: a busy page still shows it.
    const t0 = performance.now();
    let frames = 0;
    p.keyRelease = onFrame(() => { if (++frames >= 3 && performance.now() - t0 >= 120) pressEnd(inst); });
  }, { signal });
}

/** Follows one pointer (move, up, cancel) at window level until the press ends. */
function trackPointer(inst, p) {
  p.track?.abort();
  const ctl = (p.track = new AbortController()), opts = { signal: ctl.signal, capture: true };
  addEventListener('pointermove', (e) => { if (p.down && e.pointerId === p.pointerId) pressMove(inst, e.clientX, e.clientY); }, { ...opts, passive: true });
  const end = (e) => { if (e.pointerId === p.pointerId) pressEnd(inst); };
  addEventListener('pointerup', end, opts);
  addEventListener('pointercancel', end, opts);
  addEventListener('blur', () => pressEnd(inst), opts);
}

function stopInteraction(inst) {
  const p = inst.press;
  if (p) {
    p.ctl?.abort();
    p.track?.abort();
    p.keyRelease?.();
    if (p.down) inst.interacting = Math.max(0, inst.interacting - 1);
    for (const s of [p.scale, p.gx, p.gy, p.energize]) s.stop();
    for (const n of p.neighbours) if (!n.dead) glowOf(n).amount.to(0);
    if (p.forked) { p.forked = false; inst.anim.energize = 0; inst.endAnimation(); }
    inst.press = null;
  }
  if (inst.glow) { inst.glow.amount.jump(0); inst.glow.radius.stop(); }
  inst.clearChannel('press');
  inst.el.removeAttribute('data-lg-pressed');
  inst.el.style.removeProperty('will-change');
}

const isDisabled = (el) => el.matches(':disabled, [aria-disabled="true"]');

function pressStart(inst, cx, cy) {
  const el = inst.el, p = pressState(inst), reduced = isReducedMotion();
  p.down = true;
  p.keyRelease?.();
  p.keyRelease = null;
  p.rect = el.getBoundingClientRect(); // the only layout read of a press
  p.w = el.offsetWidth; p.h = el.offsetHeight;
  inst.interacting++;
  el.setAttribute('data-lg-pressed', '');
  if (!reduced) el.style.willChange = 'transform';
  const g = glowOf(inst), [lx, ly] = localPoint(p, cx, cy);
  placeGlow(inst, lx, ly);
  if (reduced) {
    tween(g.amount.value, 1, 150, (v) => g.amount.jump(v));
    g.radius.jump(0.9 * Math.hypot(p.w, p.h));
  } else {
    p.scale.to(inst.o.pressScale ?? pressScaleFor(p.w, p.h), { preset: 'lift' });
    pressMove(inst, cx, cy);
    g.radius.jump(0);
    g.radius.to(0.9 * Math.hypot(p.w, p.h), { preset: 'lift' });
    g.amount.to(1, { preset: 'lift' });
  }
  // Energize (Tier A): the press owns one fork until energize has settled back to 0, however
  // many presses overlap that settle. A press never changes the tier (evaluateTiers).
  if (inst.tier === 'a' && !inst.o.latent && !inst.o.customBackdrop) {
    if (!p.forked) { p.forked = true; inst.beginAnimation(); }
    p.energize.to(1, { preset: 'lift' });
  }
  p.neighbours = spillNeighbours(inst, cx, cy);
}

function pressMove(inst, cx, cy) {
  const p = inst.press, [lx, ly] = localPoint(p, cx, cy);
  placeGlow(inst, lx, ly);
  if (isReducedMotion()) return;
  // Gel follow (ours): lean toward the finger by 6 % of the offset, at most 4 px.
  p.gx.to(clamp((lx - p.w / 2) * 0.06, -4, 4), { preset: 'lift' });
  p.gy.to(clamp((ly - p.h / 2) * 0.06, -4, 4), { preset: 'lift' });
}

function pressEnd(inst) {
  const p = inst.press, el = inst.el;
  if (!p?.down) return;
  p.down = false;
  p.track?.abort();
  p.track = null;
  p.keyRelease?.();
  p.keyRelease = null;
  inst.interacting = Math.max(0, inst.interacting - 1);
  el.removeAttribute('data-lg-pressed');
  const g = glowOf(inst);
  if (isReducedMotion()) tween(g.amount.value, 0, 150, (v) => g.amount.jump(v));
  else {
    g.amount.to(0, { preset: 'unlift' });
    g.radius.to(g.radius.target * 1.1, { preset: 'unlift' });
  }
  for (const n of p.neighbours) if (!n.dead) glowOf(n).amount.to(0, { preset: 'unlift' });
  p.neighbours = [];
  const settle = [p.scale.to(1, { preset: 'unlift' }), p.gx.to(0, { preset: 'unlift' }), p.gy.to(0, { preset: 'unlift' })];
  if (p.forked) {
    settle.push(p.energize.to(0, { preset: 'unlift' }).then(() => {
      if (p.down || !p.forked || inst.press !== p) return; // pressed again: that press keeps the fork
      p.forked = false;
      inst.endAnimation();
    }));
  }
  Promise.all(settle).then(() => {
    if (p.down || inst.press !== p) return;
    inst.clearChannel('press');
    el.style.removeProperty('will-change');
  });
}

/** Viewport point → untransformed local px, using the rect read at pointerdown. */
function localPoint(p, cx, cy) {
  const r = p.rect;
  return [(cx - r.left) * (p.w / (r.width || 1)), (cy - r.top) * (p.h / (r.height || 1))];
}

/** Other glass in the same group, bar, container or toolbar gets a faint glow at its nearest edge. */
function spillNeighbours(inst, cx, cy) {
  const group = inst.el.parentElement?.closest('.glass-group, .glass-container, .glass-tabbar, .glass-toolbar');
  if (!group || isReducedMotion()) return [];
  const out = [];
  for (const el of group.querySelectorAll('.glass')) {
    const n = registry.get(el);
    if (!n || n === inst || el.contains(inst.el) || inst.el.contains(el)) continue;
    const r = el.getBoundingClientRect(), sx = el.offsetWidth / (r.width || 1), sy = el.offsetHeight / (r.height || 1);
    placeGlow(n, (clamp(cx, r.left, r.right) - r.left) * sx, (clamp(cy, r.top, r.bottom) - r.top) * sy);
    const g = glowOf(n);
    g.radius.jump(0.6 * Math.hypot(el.offsetWidth, el.offsetHeight));
    g.amount.to(0.25, { preset: 'lift' });
    out.push(n);
  }
  return out;
}

// ── Pointer-following light (data-glass-light="pointer") ──────────────────
const pointerLight = { set: new Set(), off: null, x: 0, y: 0, timer: 0 };
const LIGHT_STEPS = 16;

function syncPointerLight(inst) {
  const on = inst.o.light === 'pointer' && !inst.dead;
  if (on) pointerLight.set.add(inst);
  else if (pointerLight.set.delete(inst) && inst.lightAngle != null) { inst.lightAngle = null; inst.reconcile(); }
  if (on && inst.lightAngle != null && isReducedMotion()) { inst.lightAngle = null; inst.reconcile(); } // §5.11: static light
  if (pointerLight.set.size && !pointerLight.off) {
    const move = (e) => {
      pointerLight.x = e.clientX; pointerLight.y = e.clientY;
      if (!pointerLight.timer) pointerLight.timer = setTimeout(updatePointerLight, 100);
    };
    document.addEventListener('pointermove', move, { passive: true });
    pointerLight.off = () => document.removeEventListener('pointermove', move);
  } else if (!pointerLight.set.size && pointerLight.off) {
    pointerLight.off();
    pointerLight.off = null;
  }
}

function updatePointerLight() {
  pointerLight.timer = 0;
  if (isReducedMotion()) {
    for (const inst of pointerLight.set) if (inst.lightAngle != null) { inst.lightAngle = null; inst.reconcile(); }
    return;
  }
  for (const inst of pointerLight.set) {
    if (!inst.visible) continue;
    const r = inst.el.getBoundingClientRect();
    // Bearing from the element centre toward the pointer (0 = up, clockwise), quantised so each
    // of the 16 overlays is built once and cached.
    const deg = (Math.atan2(pointerLight.x - (r.left + r.width / 2), -(pointerLight.y - (r.top + r.height / 2))) * 180) / Math.PI;
    const q = roundTo(deg, 360 / LIGHT_STEPS);
    if (q !== inst.lightAngle) { inst.lightAngle = q; inst.reconcile(); }
  }
}

function stopPointerLight() {
  pointerLight.off?.();
  pointerLight.off = null;
  clearTimeout(pointerLight.timer);
  pointerLight.timer = 0;
  pointerLight.set.clear();
}

/** Programmatic press, e.g. for components whose visual part is not the event target. */
I.press = {
  start: (h, x, y) => { if (!h.press?.down) pressStart(h, x, y); },
  move: (h, x, y) => { if (h.press?.down) pressMove(h, x, y); },
  end: (h) => pressEnd(h),
  scaleFor: pressScaleFor,
};
I.glow = (h, { x, y, amount = 1, radius, preset = 'lift' } = {}) => {
  if (x != null && y != null) placeGlow(h, x, y);
  const g = glowOf(h);
  if (radius != null) g.radius.jump(radius);
  return g.amount.to(amount, { preset });
};
/** The touch glow of `h` for glass that draws it itself (latent members of a union):
 * { amount 0–1, x, y (local px, null = centre), radius px, peak (white α at amount 1) }. */
I.glowState = (h) => ({
  amount: clamp(h.glow?.amount.value ?? 0, 0, 1),
  x: h.glowAt?.[0] ?? null, y: h.glowAt?.[1] ?? null,
  radius: Math.max(0, h.glow?.radius.value ?? 0),
  peak: h.tone === 'dark' ? 0.22 : 0.30,
});
// ── core-13-lift.js ─────────────────────────────────────────────────────────
// Generic lifted-lens state (§5.4–§5.7, I2) for any glass element: it grows, turns clear and, in
// Tier A, crossfades into a magnifying lens map (zoom field + rim) with dispersion; Tier B
// shows frost. Used by the tab pill, switch thumb, slider knob and segmented pill.
//
// A `latent` element (register(el, { latent: true })) shows no glass at rest; its layers fade
// in with the lift, so a flat pill or white knob can become a lens.

const LIFT_DEFAULTS = { zoom: 1.18, dispersion: 0.8, grow: 1, reach: 0.8, blur: null };
const LENS_BLUR = 0.6;           // lens σ once lifted (CSS px): the lens turns clear
const LENS_SMOOTH_DEVICE_PX = 0.6; // σ after displacement, in device px (VIS-4)

/** grow: number (uniform scale) | { px } (px added per side) | { x, y } (per-axis scale). */
function growScale(inst, grow) {
  const { w, h } = inst.geom;
  if (typeof grow === 'number') return [grow, grow];
  if (grow && grow.px != null) return [(w + 2 * grow.px) / w, (h + 2 * grow.px) / h];
  return [grow?.x ?? 1, grow?.y ?? 1];
}

/**
 * Lens map options for lift options `lo`: rim + zoom with the dispersion split baked in (the
 * lens's own, or the strongest page-wide one while that is on: lensDispersion). The split at the
 * rim is k·D px; below half a pixel it is invisible, so the map is built without it.
 */
function lensMapOptions(inst, lo) {
  const d = inst.d, D = lo.reach * d.b, k = lensDispersion(inst, lo.dispersion, inst.o.dispersion).build;
  return { ...mapOptions({ b: d.b, D, p: inst.o.profile, zoom: lo.zoom, mapScale: d.mapScale, k: k * D * d.strength >= 0.5 ? k : 0 }), mode: 'rim', encoding: 'g2' };
}

/** Lens parameters derived from the lift options; the map is built ahead of use. */
function prepareLens(inst, opts) {
  if (opts) inst.liftOpts = { ...LIFT_DEFAULTS, ...inst.liftOpts, ...opts };
  if (!inst.liftOpts) inst.liftOpts = { ...LIFT_DEFAULTS };
  if (inst.tier !== 'a' || !inst.d || inst.o.customBackdrop) return; // Tier B lifts need no map
  const lo = inst.liftOpts, mo = lensMapOptions(inst, lo), key = mapKey(inst.geom, mo);
  // The filter runs in the element's own px, which the lift then scales by its growth: σ grows
  // with it (the documented `blur`), the smoothing must not (it is meant in device px).
  const [gx, gy] = growScale(inst, lo.grow);
  const sigma = lo.blur ?? LENS_BLUR, smooth = LENS_SMOOTH_DEVICE_PX / (caps.dpr * Math.sqrt(gx * gy));
  const lens = inst.lens;
  if (lens?.key === key) { // same map: blur and smoothing can still change
    lens.sigma = sigma; lens.smooth = smooth;
    inst.writeFork();
    return;
  }
  // k: the split baked into the map on show (the old one until the new map is in), kNext: the new one's.
  inst.lens = { key, entry: lens?.entry ?? null, sigma, smooth, k: lens?.entry ? lens.k : 0, kNext: mo.k || 0 };
  const adopt = (entry) => {
    if (!entry) return;
    if (inst.dead || inst.lens?.key !== entry.key) { mapCache.release(entry); return; }
    const old = inst.lens.entry;
    inst.lens.entry = entry;
    inst.lens.k = inst.lens.kNext;
    if (old && old !== entry) mapCache.release(old);
    inst.writeFork();
  };
  // A warm map (prepareLift with several option sets) is swapped in synchronously, so a lift
  // that changes zoom never shows a stale map for a frame.
  const hit = mapCache.acquireNow(key);
  if (hit) adopt(hit);
  else acquireLensMap(inst.geom, mo, inst.interacting > 0 || inst.lifted).then(adopt);
}

/** Keeps the lens maps for extra option sets built and cached (released on the next call). */
function warmLenses(inst, list) {
  for (const e of inst.lensWarm) mapCache.release(e);
  inst.lensWarm = [];
  if (inst.tier !== 'a' || !inst.d || inst.o.customBackdrop) return;
  for (const opts of list) {
    const lo = { ...LIFT_DEFAULTS, ...inst.liftOpts, ...opts };
    acquireLensMap(inst.geom, lensMapOptions(inst, lo)).then((entry) => {
      if (!entry) return;
      if (inst.dead) mapCache.release(entry); else inst.lensWarm.push(entry);
    });
  }
}

function releaseLens(inst) {
  if (inst.lens?.entry) mapCache.release(inst.lens.entry);
  inst.lens = null;
  for (const e of inst.lensWarm) mapCache.release(e);
  inst.lensWarm = [];
}

/** A lifted part keeps the glass it sits in (a tab bar under its pill) at its current tier. */
function holdHost(inst) {
  if (inst.heldHost) return;
  let a = inst.el.parentElement;
  while (a && !registry.has(a)) a = a.parentElement;
  if (a) inst.heldHost = I.hold(registry.get(a));
}
function releaseHost(inst) {
  inst.heldHost?.();
  inst.heldHost = null;
}

function applyLift(inst, p) {
  const [gx, gy] = inst.liftGrow;
  inst.anim.lift = p;
  inst.setChannel('lift', { sx: 1 + (gx - 1) * p, sy: 1 + (gy - 1) * p });
  inst.setVar('--_lg-lift', fmt(clamp(p, 0, 1)));
  inst.writeFork();
  const clear = p > 0.5; // Tier B has no lens: the part turns clear by switching frost (VIS-9)
  if (clear !== inst.frostClear) { inst.frostClear = clear; if (inst.tier === 'b') inst.syncFrost(); }
}

/**
 * Lifts the element into its lens state. opts: { zoom = 1.18, dispersion = 0.8 (0–1),
 * grow = 1, reach = 0.8 (rim D as a fraction of the bezel), blur (lens σ) }. Resolves when the
 * lift spring settles. Under reduced motion only the state flag changes (§5.11).
 */
function lift(inst, opts = {}) {
  if (inst.dead || !inst.geom) return Promise.resolve();
  inst.liftOpts = { ...LIFT_DEFAULTS, ...inst.liftOpts, ...opts };
  const wasLifted = inst.lifted;
  if (!wasLifted || inst.liftSpring?.target === 0) emit(inst.el, 'glass:lift');
  inst.lifted = true;
  inst.el.setAttribute('data-lg-lifted', '');
  holdHost(inst);
  if (isReducedMotion()) return Promise.resolve();
  if (asksDispersion(inst) || (inst.liftOpts.dispersion > 0 && autoDispersing() < MAX_DISPERSING)) setDispersing(inst, true);
  // Lifted glass is always admitted; a latent part already in Tier A only changes its reason.
  if (staticTier(inst).tier === 'a') {
    if (inst.tier !== 'a') evaluateTiers();
    else inst.tierReason = 'lifted';
  }
  inst.liftGrow = growScale(inst, inst.liftOpts.grow);
  inst.reconcile(); // overscan grows for the lens reach; prepares the lens map
  if (!inst.liftSpring) inst.liftSpring = new Spring({ preset: 'lift', onUpdate: (p) => applyLift(inst, p) });
  if (!inst.liftAnimating) { inst.liftAnimating = true; inst.beginAnimation(); }
  return inst.liftSpring.to(1, { preset: 'lift' });
}

/** Settles the lens back to rest on the unlift spring; resolves when it has. */
async function unlift(inst) {
  if (!inst.lifted || inst.dead) return;
  emit(inst.el, 'glass:unlift');
  const s = inst.liftSpring;
  // Also when the spring is still at 0 but already moving toward 1 (lift and unlift in one frame).
  if (s && (s.value !== 0 || s.active || s.target !== 0)) {
    await s.to(0, { preset: 'unlift' });
    if (s.target !== 0 || inst.dead) return; // lifted again meanwhile
  }
  inst.lifted = false;
  if (inst.o.latent && inst.tierReason === 'lifted') inst.tierReason = 'latent';
  inst.el.removeAttribute('data-lg-lifted');
  inst.anim.lift = 0;
  inst.clearChannel('lift');
  inst.setVar('--_lg-lift', null);
  if (inst.frostClear) { inst.frostClear = false; if (inst.tier === 'b') inst.syncFrost(); }
  if (!asksDispersion(inst) && !autoDispersion(inst)) setDispersing(inst, false);
  if (inst.liftAnimating) { inst.liftAnimating = false; inst.endAnimation(); }
  releaseHost(inst);
  scheduleTierEvaluation();
}

Object.assign(I, {
  lift: (h, o) => lift(h, o),
  unlift: (h) => unlift(h),
  /** opts, or [opts, …warm]: extra option sets keep their lens maps built for instant switching. */
  prepareLift: (h, o) => {
    const [first, ...warm] = Array.isArray(o) ? o : [o];
    prepareLens(h, first);
    h.reconcile();
    if (Array.isArray(o)) warmLenses(h, warm);
  },
});
// ── core-14-materialize.js ──────────────────────────────────────────────────
// Materialize / dematerialize (§5.8, §5.9). Glass appears by ramping light bending, blur,
// highlight and shadow together with a small scale-up, never by fading the host's opacity
// (which would make it a Backdrop Root and blank the glass). Content children fade in 60 ms
// later over 150 ms; direct text nodes of the host cannot fade (wrap them).

/**
 * Points transform-origin at the centre of `src` (Element | DOMRect), in the host's local px.
 * Both boxes are measured without their own core transforms (layoutRect). A host that is not
 * rendered yet (a popover opening in beforetoggle) is measured on the first frame instead, before
 * that frame paints.
 */
function setOriginFrom(inst, src) {
  const el = inst.el;
  if (inst.originFrame) { inst.originFrame(); inst.originFrame = null; }
  if (!src) { el.style.removeProperty('transform-origin'); return; }
  const place = () => {
    const s = src instanceof Element ? layoutRect(src) : src;
    const r = layoutRect(el), kx = el.offsetWidth / (r.width || 1), ky = el.offsetHeight / (r.height || 1);
    el.style.transformOrigin = `${fmt((s.left + s.width / 2 - r.left) * kx, 1)}px ${fmt((s.top + s.height / 2 - r.top) * ky, 1)}px`;
  };
  if (el.offsetWidth || el.offsetHeight) { place(); return; }
  const off = (inst.originFrame = onFrame(() => {
    off();
    inst.originFrame = null;
    if (!inst.dead && (el.offsetWidth || el.offsetHeight)) place();
  }));
}

function matState(inst) {
  if (inst.mat) return inst.mat;
  const m = (inst.mat = { token: 0, content: null });
  const writeScale = () => inst.setChannel('mat', { sx: m.scale.value, sy: m.scale.value, ty: m.y.value });
  m.amount = new Spring({ value: 1, preset: 'smooth', onUpdate: (v) => {
    inst.anim.mat = v;
    inst.setVar('--_lg-mat', fmt(clamp(v, 0, 1)));
    inst.writeFork();
  } });
  m.scale = new Spring({ value: 1, preset: 'unlift', onUpdate: writeScale });
  m.y = new Spring({ value: 0, preset: 'unlift', onUpdate: writeScale });
  return m;
}

function fadeContent(inst, from, to, ms, delay = 0) {
  const m = inst.mat;
  m.content?.stop();
  m.content = tween(from, to, ms, (v) => inst.setVar('--_lg-content', fmt(v)), { delay });
  return m.content.done;
}

/**
 * opts: { from?: Element | DOMRect (scale origin), scale = 0.9 (menus 0.6), y = 0 (px start
 * offset, sheets 24), spring?: preset for the scale (default 'unlift', 'smooth' above 100k px²) }.
 */
async function materialize(inst, { from, scale = 0.9, y = 0, spring: preset } = {}) {
  if (inst.dead) return;
  if (inst.lookStale) inst.reconcile(); // a preference changed while it was hidden (applyLook)
  const el = inst.el, m = matState(inst), token = ++m.token;
  el.setAttribute('data-lg-mat', '');
  setOriginFrom(inst, from);
  m.amount.jump(0);
  inst.setVar('--_lg-content', '0');
  if (isReducedMotion()) {
    m.scale.jump(1); m.y.jump(0);
    await Promise.all([tween(0, 1, 150, (v) => m.amount.jump(v)).done, fadeContent(inst, 0, 1, 150)]);
  } else {
    const scalePreset = preset || (inst.area > 100000 ? 'smooth' : 'unlift');
    m.scale.jump(scale); m.y.jump(y);
    inst.beginAnimation();
    inst.syncMatMode();
    await Promise.all([
      m.amount.to(1, { preset: 'smooth' }),
      m.scale.to(1, { preset: scalePreset }),
      m.y.to(0, { preset: scalePreset }),
      fadeContent(inst, 0, 1, 150, 60),
    ]);
    inst.endAnimation();
  }
  if (token !== m.token || inst.dead) return;
  el.removeAttribute('data-lg-mat');
  inst.clearChannel('mat');
  inst.setVar('--_lg-mat', null);
  inst.setVar('--_lg-content', null);
  el.style.removeProperty('transform-origin');
  emit(el, 'glass:materialized');
}

/**
 * Runs the same channels in reverse. The element then stays invisible (layers and content)
 * until materialize() is called again; callers usually hide or close it afterwards.
 * opts: { to?: Element | DOMRect, scale = 0.9, y = 0, spring? }.
 */
async function dematerialize(inst, { to, scale = 0.9, y = 0, spring: preset } = {}) {
  if (inst.dead) return;
  const el = inst.el, m = matState(inst), token = ++m.token;
  el.setAttribute('data-lg-mat', '');
  setOriginFrom(inst, to);
  const content = +(inst.el.style.getPropertyValue('--_lg-content') || 1);
  if (isReducedMotion()) {
    await Promise.all([tween(m.amount.value, 0, 150, (v) => m.amount.jump(v)).done, fadeContent(inst, content, 0, 150)]);
  } else {
    const scalePreset = preset || (inst.area > 100000 ? 'smooth' : 'unlift');
    inst.beginAnimation();
    inst.syncMatMode();
    await Promise.all([
      m.amount.to(0, { preset: 'smooth' }),
      m.scale.to(scale, { preset: scalePreset }),
      m.y.to(y, { preset: scalePreset }),
      fadeContent(inst, content, 0, 120),
    ]);
    inst.endAnimation();
  }
  if (token !== m.token || inst.dead) return;
  emit(el, 'glass:dematerialized');
}

Object.assign(I, {
  materialize: (h, o) => materialize(h, o),
  dematerialize: (h, o) => dematerialize(h, o),
  /** Re-aims a running materialize at `src` (Element | DOMRect); see setOriginFrom. */
  setMaterializeOrigin: (h, src) => setOriginFrom(h, src),
});
// ── core-15-lifecycle.js ────────────────────────────────────────────────────
// Lifecycle (§4.5, §3.11): one MutationObserver, ResizeObserver and IntersectionObserver for all
// instances, component definitions, and the global listeners (media queries, DPR, scroll).

// ── Components ─────────────────────────────────────────────────────────────
const components = [];                      // { name, selector, setup, attributes? }
const componentState = new WeakMap();       // Element → Map<name, { api, ctl }>
const componentEls = new Set();             // elements with at least one live component
const optedOut = new WeakSet();             // LG.destroy(el): not auto-upgraded again

/**
 * Registers a component. `setup(el, ctx)` runs for every connected element matching `selector`
 * (now and later) and returns { destroy(), refresh?(), attributeChanged?(name, oldValue) }.
 * ctx = { name, handle (the element's glass handle, or null), signal (aborted on teardown) }.
 * An invalid selector is reported and the component skipped; it never breaks the others.
 */
function defineComponent(name, def) {
  if (!def || typeof def.setup !== 'function' || !def.selector) throw new TypeError(`defineComponent(${name}): selector and setup() are required`);
  if (HAS_DOM) {
    try { document.createDocumentFragment().querySelector(def.selector); } catch {
      console.error(`[liquid-glass] defineComponent(${name}): invalid selector ${JSON.stringify(def.selector)}; component skipped`);
      return;
    }
  }
  const i = components.findIndex((c) => c.name === name);
  const entry = { name, ...def };
  if (i >= 0) components[i] = entry; else components.push(entry);
  if (!state.initialized) return;
  observeMutations(); // its attributes join the observer's filter
  for (const el of document.querySelectorAll(def.selector)) upgrade(el);
}

function setupComponent(def, el) {
  let map = componentState.get(el);
  if (!map) componentState.set(el, (map = new Map()));
  const ctl = new AbortController();
  const slot = { api: null, ctl };
  map.set(def.name, slot);
  componentEls.add(el);
  try {
    slot.api = def.setup(el, { name: def.name, handle: registry.get(el) || null, signal: ctl.signal }) || null;
  } catch (e) {
    console.error(`[liquid-glass] ${def.name} setup failed`, e);
  }
}

function teardownComponent(name, el) {
  const map = componentState.get(el), slot = map?.get(name);
  if (!slot) return;
  map.delete(name);
  if (!map.size) componentEls.delete(el);
  slot.ctl.abort();
  try { slot.api?.destroy?.(); } catch (e) { console.error(`[liquid-glass] ${name} destroy failed`, e); }
}

function teardownAllComponents(el) {
  const map = componentState.get(el);
  if (map) for (const name of [...map.keys()]) teardownComponent(name, el);
}

/** Calls `api[method](...args)` if present, reporting (not propagating) its errors. */
function callComponent(name, api, method, ...args) {
  try { api?.[method]?.(...args); } catch (e) { console.error(`[liquid-glass] ${name} ${method} failed`, e); }
}

const inScope = (el) => !config.selector || el.matches(config.selector);

/** Registers / tears down glass and components so they match the element's current state. */
function upgrade(el) {
  if (!el.isConnected || optedOut.has(el)) return;
  const inst = registry.get(el);
  const isGlass = el.matches('.glass') && inScope(el);
  if (isGlass && !inst) registerGlass(el).auto = true;
  else if (inst && inst.auto && !isGlass) destroyGlass(inst);
  const map = componentState.get(el);
  for (const def of components) {
    const match = el.matches(def.selector) && inScope(el);
    const has = !!map?.has(def.name);
    if (match && !has) setupComponent(def, el);
    else if (!match && has) teardownComponent(def.name, el);
  }
}

function upgradeTree(root) {
  if (root.nodeType !== 1) return;
  upgrade(root);
  const sel = ['.glass', ...components.map((c) => c.selector)].join(',');
  for (const el of root.querySelectorAll(sel)) upgrade(el);
}

/**
 * Removed nodes are torn down a microtask later, and only if they did not come back (moves).
 * Only elements inside the removed subtrees count: glass registered before it was inserted must
 * survive unrelated removals. Components go first, so their destroy() still sees a live handle.
 */
function sweepDisconnected(roots) {
  const removed = (el) => !el.isConnected && roots.some((r) => r === el || r.contains(el));
  for (const el of [...componentEls]) if (removed(el)) teardownAllComponents(el);
  for (const inst of [...instances]) if (removed(inst.el)) destroyGlass(inst);
}

// ── Observers ──────────────────────────────────────────────────────────────
const obs = { mo: null, ro: null, io: null, screen: null, ctl: null, styleTimer: 0, styleDirty: new Set(), removed: [], dprMQ: null, refreshQueued: false, look: 0 };
const CORE_ATTRS = ['class', 'style', 'open', 'popover', 'data-glass', 'data-glass-tint', 'data-glass-interactive', 'data-glass-tone',
  'data-glass-shape', 'data-glass-refraction', 'data-glass-optics', 'data-glass-bezel', 'data-glass-profile', 'data-glass-dispersion',
  'data-glass-blur', 'data-glass-tier', 'data-glass-priority', 'data-glass-backdrop', 'data-glass-dim', 'data-glass-light',
  'data-glass-zoom', 'data-glass-quality', 'data-glass-inset', 'data-glass-min-radius', 'data-glass-backdrop-transparent',
  'data-glass-preset', 'data-glass-transparency', 'data-glass-contrast', 'data-glass-motion', 'data-lg-debug'];
const GLASS_ATTRS = new Set(CORE_ATTRS.filter((a) => a !== 'style' && a !== 'open' && a !== 'popover'));
const VIEW_MARGIN = 0.25; // IntersectionObserver margin, as a fraction of the viewport
const resizeWatchers = new Map(); // I.observeResize: element → Set<callback>

/** Starts (or re-targets) the MutationObserver: core attributes plus every component's list. */
function observeMutations() {
  if (!obs.mo) return;
  const attributeFilter = [...new Set([...CORE_ATTRS, ...components.flatMap((c) => c.attributes || [])])];
  obs.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter });
}

function onMutations(records) {
  const html = root();
  let rootChanged = false;
  const touched = new Set(), added = new Set();
  for (const r of records) {
    try {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n.nodeType === 1) added.add(n);
        for (const n of r.removedNodes) if (n.nodeType === 1) obs.removed.push(n);
        continue;
      }
      const t = r.target, name = r.attributeName;
      if (t === html && (name.startsWith('data-glass') || name === 'data-lg-debug')) { rootChanged = true; continue; }
      if (name === 'style' && registry.has(t)) obs.styleDirty.add(t);
      if (name === 'data-glass-backdrop') requestToneSample();
      const slots = componentState.get(t);
      if (slots) for (const [cname, slot] of slots) {
        const def = components.find((c) => c.name === cname);
        if (def?.attributes?.includes(name)) callComponent(cname, slot.api, 'attributeChanged', name, r.oldValue);
      }
      if (name === 'class') upgrade(t);
      const inst = registry.get(t);
      if (inst && !inst.dead && GLASS_ATTRS.has(name) && name !== 'data-glass-backdrop') touched.add(inst);
    } catch (e) {
      console.error('[liquid-glass] mutation handling failed', e);
    }
  }
  // Two phases, so n refreshed elements cost one layout rather than n (PERF-1).
  const glass = [...touched].filter((i) => !i.dead);
  for (const inst of glass) inst.read();
  for (const inst of glass) inst.apply();
  if (glass.length) scheduleTierEvaluation(true);
  for (const n of added) upgradeTree(n);
  if (obs.removed.length && !obs.sweepQueued) {
    obs.sweepQueued = true;
    queueMicrotask(() => {
      obs.sweepQueued = false;
      const roots = obs.removed;
      obs.removed = [];
      sweepDisconnected(roots);
    });
  }
  if (obs.styleDirty.size) {
    clearTimeout(obs.styleTimer);
    obs.styleTimer = setTimeout(checkStyleChanges, 150);
  }
  if (rootChanged) onRootChange();
}

/** Inline style changes (including our own per-frame writes) are coalesced, then only a real
 * border-radius or border change triggers a geometry refresh. */
function checkStyleChanges() {
  for (const el of obs.styleDirty) {
    const inst = registry.get(el);
    if (!inst || inst.dead || !inst.geom) continue;
    if (radiusSignature(getComputedStyle(el)) !== inst.radiusSig) { inst.measure({ w: el.offsetWidth, h: el.offsetHeight }); inst.reconcile(); }
  }
  obs.styleDirty.clear();
}

function onRootChange() {
  const preset = activePresetName();
  if (preset !== state.presetName) loadPreset(preset);
  const refraction = config.refraction === 'auto' ? rootAttr('data-glass-refraction') || 'auto' : config.refraction;
  if (caps) {
    caps.liveRefraction = detect({ ...config, refraction }).liveRefraction;
    reflectCapabilities();
  }
  scheduleRefreshAll();
}

function onResize(entries) {
  for (const e of entries) resizeGlass(e.target);
  // Component watchers run after the core has re-measured, so handle.geom and handle.d are current.
  for (const e of entries) {
    const watchers = resizeWatchers.get(e.target);
    if (watchers) for (const cb of [...watchers]) callComponent('observeResize', { cb }, 'cb', e);
  }
  requestToneSample();
}

function resizeGlass(el) {
  const inst = registry.get(el);
  if (!inst || inst.dead || !inst.geom) return;
  // offsetWidth/Height: the untransformed border box, in the same units as the first measure.
  const w = el.offsetWidth, h = el.offsetHeight;
  if (w === inst.geom.w && h === inst.geom.h) return;
  const grew = inst.area === 0;
  inst.measure({ w, h });
  if (grew) { inst.updateTone({ instant: true }); applyStaticTier(inst); scheduleTierEvaluation(true); inst.reconcile(); return; }
  // A resize burst (e.g. a width transition) animates one private filter in place instead of
  // minting a shared filter per frame; it rejoins once the rebuilt map is in (CORE-15).
  if (inst.tier === 'a' && !inst.resizing) { inst.resizing = true; inst.beginAnimation(); }
  inst.resizeSettled = false;
  inst.reconcile({ stretch: true }); // stretch the old map now, rebuild when resizing settles
  for (const c of instances) if (c.o.shape === 'concentric' && c !== inst && c.concentricHost() === inst.el) { c.measure(); c.reconcile(); }
  // "Settled" is relative to the frame rate: on a slow device, frames of a running transition
  // can be further apart than 120 ms, and each false settle would rebuild at an interim size.
  const now = performance.now(), gap = inst.resizedAt ? now - inst.resizedAt : 0;
  inst.resizedAt = now;
  clearTimeout(inst.resizeTimer);
  inst.resizeTimer = setTimeout(() => {
    inst.resizedAt = 0;
    inst.updateTone();
    inst.reconcile();
    inst.resizeSettled = true;
    settleResize(inst);
    scheduleTierEvaluation();
  }, clamp(2.5 * gap, 120, 400));
}

/** Ends a resize burst's fork once the size has settled and its rebuilt map and rim are in. */
function settleResize(inst) {
  if (!inst.resizing || !inst.resizeSettled) return;
  const pending = (kind) => inst.want[kind] && inst.res[kind]?.key !== inst.want[kind];
  if (inst.tier === 'a' && (pending('map') || pending('rim'))) return;
  endResize(inst);
}
function endResize(inst) {
  if (!inst.resizing) return;
  inst.resizing = inst.resizeSettled = false;
  inst.endAnimation();
}

function onIntersect(entries) {
  let changed = false;
  for (const e of entries) {
    const inst = registry.get(e.target);
    if (inst && inst.visible !== e.isIntersecting) {
      inst.visible = e.isIntersecting;
      if (inst.visible) {
        if (inst.lookStale) inst.reconcile(); // a preference changed while it was away (applyLook)
        requestToneSample(inst);
      }
      changed = true;
    }
    for (const c of tiers.claims) if (c.el === e.target && c.visible !== e.isIntersecting) { c.visible = e.isIntersecting; changed = true; }
  }
  // Incumbents keep their slots (evaluateTiers), so an immediate pass only promotes glass that is
  // coming into view, ahead of it becoming visible.
  if (changed) scheduleTierEvaluation(true);
}

/** On-screen changes (no margin): the budget ranks glass on screen ahead of glass near it. */
function onScreenChange(entries) {
  let changed = false;
  for (const e of entries) {
    const inst = registry.get(e.target);
    if (inst && inst.onScreen !== e.isIntersecting) { inst.onScreen = e.isIntersecting; changed = true; }
    for (const c of tiers.claims) if (c.el === e.target && c.onScreen !== e.isIntersecting) { c.onScreen = e.isIntersecting; changed = true; }
  }
  if (changed) scheduleTierEvaluation(true);
}

function watchVisibility(el) {
  obs.io?.observe(el);
  obs.screen?.observe(el);
}
function unwatchVisibility(el) {
  obs.io?.unobserve(el);
  obs.screen?.unobserve(el);
}

function observeGlass(inst) {
  obs.ro?.observe(inst.el, { box: 'border-box' });
  watchVisibility(inst.el);
}
function unobserveGlass(inst) {
  if (!resizeWatchers.has(inst.el)) obs.ro?.unobserve(inst.el);
  if (![...tiers.claims].some((c) => c.el === inst.el)) unwatchVisibility(inst.el);
}

/** I.observeResize: cb(ResizeObserverEntry) on the shared observer; returns an unobserve function. */
function observeResize(el, cb) {
  let set = resizeWatchers.get(el);
  if (!set) resizeWatchers.set(el, (set = new Set()));
  set.add(cb);
  obs.ro?.observe(el, { box: 'border-box' });
  return () => {
    if (!set.delete(cb) || set.size) return;
    resizeWatchers.delete(el);
    if (!registry.has(el)) obs.ro?.unobserve(el);
  };
}

function watchDPR() {
  obs.dprMQ?.removeEventListener('change', onDPRChange);
  obs.dprMQ = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  obs.dprMQ.addEventListener('change', onDPRChange);
}
function onDPRChange() {
  caps.dpr = window.devicePixelRatio || 1;
  watchDPR();
  scheduleRefreshAll(); // map resolution follows the DPR
}

function startObservers() {
  const ctl = (obs.ctl = new AbortController()), signal = ctl.signal;
  obs.ro = new ResizeObserver(onResize);
  obs.io = new IntersectionObserver(onIntersect, { rootMargin: `${VIEW_MARGIN * 100}%` });
  obs.screen = new IntersectionObserver(onScreenChange);
  for (const el of resizeWatchers.keys()) obs.ro.observe(el, { box: 'border-box' });
  for (const c of tiers.claims) watchVisibility(c.el);
  if (config.observe) {
    obs.mo = new MutationObserver(onMutations);
    observeMutations();
  }
  for (const mq of [caps.reducedTransparencyMQ, caps.contrastMoreMQ, caps.forcedColorsMQ, caps.darkSchemeMQ, caps.reducedMotionMQ]) {
    mq.addEventListener?.('change', scheduleRefreshAll, { signal });
  }
  watchDPR();
  addEventListener('scroll', () => requestToneSample('scroll'), { capture: true, passive: true, signal });
  addEventListener('resize', () => { requestToneSample(); scheduleTierEvaluation(); }, { passive: true, signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestToneSample(); }, { signal });
  document.addEventListener('transitionend', (e) => {
    const inst = /radius/.test(e.propertyName) ? registry.get(e.target) : null;
    if (inst) { inst.measure({ w: inst.el.offsetWidth, h: inst.el.offsetHeight }); inst.reconcile(); }
  }, { capture: true, signal });
  document.fonts?.ready.then(() => { if (state.initialized) requestToneSample(); });
}

function stopObservers() {
  obs.mo?.disconnect();
  obs.ro?.disconnect();
  obs.io?.disconnect();
  obs.screen?.disconnect();
  obs.ctl?.abort();
  obs.dprMQ?.removeEventListener('change', onDPRChange);
  clearTimeout(obs.styleTimer);
  obs.styleDirty.clear();
  obs.removed = [];
  resizeWatchers.clear();
  obs.mo = obs.ro = obs.io = obs.screen = obs.ctl = obs.dprMQ = null;
}

/** Re-reads options, sizes and tiers for every instance and component (batched per task). */
function scheduleRefreshAll() {
  if (!state.initialized || obs.refreshQueued) return;
  obs.refreshQueued = true;
  queueMicrotask(refreshAll);
}
function refreshAll() {
  obs.refreshQueued = false;
  if (!state.initialized) return;
  // Read everything, then write everything: one style/layout pass instead of one per instance.
  // Sizes come from the last measure; ResizeObserver reports any real change.
  const list = [...instances];
  for (const inst of list) if (!inst.dead) inst.read({ size: inst.geom ? { w: inst.geom.w, h: inst.geom.h } : undefined });
  for (const inst of list) inst.apply();
  for (const el of [...componentEls]) {
    for (const [name, slot] of componentState.get(el) || []) callComponent(name, slot.api, 'refresh');
  }
  evaluateTiers();
  requestToneSample();
}

/**
 * The "Clear ↔ Tinted" and dispersion preferences (setPreferences) change derived numbers only:
 * every handle near the viewport re-derives its frost, overlay (the Tier B sheen, settled after a
 * drag) and filter (updated in place where it is its own), with no layout reads and no map builds;
 * glass farther away only re-derives handle.d and catches up when it comes near (Glass#rederive).
 * `options` (a dispersion change) also re-reads each handle's options (the inherited
 * --glass-dispersion, one style read) and re-assigns dispersion. One pass per task, so a slider
 * applies at most once per input event (Chromium delivers those once per frame).
 */
const prefListeners = new Set();
function scheduleLook(options = false, fill = false) {
  if (!state.initialized) return;
  const queued = obs.look;
  obs.look = (obs.look || 0) | 1 | (options ? 2 : 0) | (fill ? 4 : 0);
  if (!queued) queueMicrotask(applyLook);
}
function applyLook() {
  const options = (obs.look & 2) !== 0, fill = (obs.look & 4) !== 0;
  obs.look = 0;
  if (!state.initialized) return;
  const list = [...instances].filter((i) => !i.dead);
  if (options) {
    for (const inst of list) inst.readOptions();
    evaluateTiers(); // dispersion slots
  }
  for (const inst of list) {
    if (inst.visible || inst.lifted || inst.interacting || inst.anim.users) inst.reconcile();
    else inst.rederive();
  }
  for (const fn of [...prefListeners]) {
    try { fn(); } catch (e) { console.error('[liquid-glass] preference listener failed', e); }
  }
  // Glass inside glass samples its container's fill, which "Clear ↔ Tinted" changed; nothing else
  // it samples did (other glass is foreground to the sampler).
  if (fill) for (const inst of list) if (inst.visible && (inst.adaptive || inst.dimAuto) && inst.el.parentElement?.closest('.glass')) requestToneSample(inst);
}

I.defineComponent = defineComponent;
/**
 * fn() runs after a "Clear ↔ Tinted" or dispersion preference has been applied to every handle
 * (handle.d is current). For components that draw their own backdrop: update filters in place,
 * without building bitmaps. Returns an unsubscribe function.
 */
I.onPreferences = (fn) => { prefListeners.add(fn); return () => prefListeners.delete(fn); };
I.components = () => components.map((c) => c.name);
I.observeResize = observeResize;
// ── core-16-debug.js ────────────────────────────────────────────────────────
// Debug-mode checks (§6.2.9, §6.1.2), each printed once per element, and the data the
// html[data-lg-debug="tiers maps bezel"] overlays need.

const BACKDROP_ROOT_REASON = (cs) => {
  if (+cs.opacity < 1) return `opacity: ${cs.opacity}`;
  if (cs.filter !== 'none') return `filter: ${cs.filter}`;
  if ((cs.maskImage || cs.webkitMaskImage || 'none') !== 'none') return 'mask';
  if (cs.clipPath !== 'none') return `clip-path: ${cs.clipPath}`;
  if (cs.mixBlendMode !== 'normal') return `mix-blend-mode: ${cs.mixBlendMode}`;
  if ((cs.backdropFilter || 'none') !== 'none') return `backdrop-filter: ${cs.backdropFilter}`;
  return null;
};

function debugChecks(inst) {
  if (!config.debug) return;
  const el = inst.el, cs = getComputedStyle(el);
  const own = BACKDROP_ROOT_REASON(cs);
  if (own) debugWarn(el, 'host-root', `the glass host has ${own}; that makes it a Backdrop Root and blanks the glass (rule R1). Animate --_lg-mat or use materialize() instead.`);
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const why = BACKDROP_ROOT_REASON(getComputedStyle(a));
    if (why) { debugWarn(el, 'ancestor-root', `an ancestor has ${why}, which blanks every glass element inside it (rule R2).`); break; }
  }
  const bg = parseColor(cs.backgroundColor);
  if (cs.backgroundImage !== 'none' || (bg && bg[3] > 0)) debugWarn(el, 'host-background', 'the glass host has a background; use --glass-tint instead (rule R5).');
  const g = inst.geom;
  if (g && Math.abs(g.w - g.h) > 1 && RADIUS_PROPS.some((k) => /%/.test(cs[k]))) debugWarn(el, 'percent-radius', 'a % border-radius on a non-square element is an ellipse, not a capsule; use 9999px for a capsule.');
  // Chromium computes the default `round` as superellipse(1).
  if (cs.cornerShape && !/^(round|superellipse\(1\))(\s+\1)*$/.test(cs.cornerShape)) debugWarn(el, 'corner-shape', `corner-shape: ${cs.cornerShape} is not modelled yet (v1 treats it as round).`);
  // Icon-only controls: the host itself and the items or links inside it (glass groups, bars).
  const unlabeled = (c) => !c.textContent.trim() && !c.getAttribute('aria-label') && !c.getAttribute('aria-labelledby') && !c.title;
  if (el.matches('button, a[href], [role="button"]') && unlabeled(el)) debugWarn(el, 'aria-label', 'icon-only glass controls need an aria-label (§6.1.2).');
  for (const c of el.querySelectorAll('.glass-item, button, a[href], [role="button"]')) {
    if (!registry.has(c) && !c.closest('[aria-hidden="true"], [inert]') && unlabeled(c)) debugWarn(c, 'aria-label', 'icon-only controls inside glass need an aria-label (§6.1.2).');
  }
}

/** Map and bezel images for the debug overlays, exposed as custom properties on the host. */
const debugModes = () => (HAS_DOM ? (rootAttr('data-lg-debug') || '').split(/\s+/) : []);
function syncDebugVars(inst) {
  const modes = debugModes();
  const map = modes.includes('maps') && inst.tier === 'a' ? inst.res.map : null;
  inst.setVar('--_lg-dbg-map', map ? `url("${map.url}")` : null);
  inst.setVar('--_lg-dbg-mm', map ? `${map.meta.margin}px` : null);
  inst.setVar('--_lg-dbg-bezel', modes.includes('bezel') && inst.res.rim ? `url("${inst.res.rim.url}")` : null);
}
// ── core-17-api.js ──────────────────────────────────────────────────────────
// Public API (§4.5) and auto-init (§4.1).

const INIT_KEYS = Object.keys(DEFAULT_CONFIG);

/** Starts the library (idempotent; calling again applies new options). Resolves with capabilities. */
function init(options = {}) {
  if (!HAS_DOM) return Promise.resolve(capabilities);
  const prev = { debug: config.debug, selector: config.selector, observe: config.observe };
  for (const k of INIT_KEYS) if (k in options) config[k] = options[k];
  if (options.debug === undefined && rootAttr('data-glass-debug') != null) config.debug = true;
  if (config.urlOverrides || root().hasAttribute('data-glass-url-overrides')) applyUrlOverrides();
  const refraction = config.refraction === 'auto' ? rootAttr('data-glass-refraction') || 'auto' : config.refraction;
  caps = detect({ ...config, refraction });
  reflectCapabilities();
  loadPreset(activePresetName());
  if (state.initialized) {
    // Re-init (e.g. after auto-init already ran): apply what only acts at registration time.
    if (config.observe !== prev.observe) {
      if (config.observe) { obs.mo = new MutationObserver(onMutations); observeMutations(); } else { obs.mo?.disconnect(); obs.mo = null; }
    }
    if (config.selector !== prev.selector) {
      for (const inst of [...instances]) if (inst.auto) upgrade(inst.el);
      for (const el of [...componentEls]) upgrade(el);
      upgradeTree(document.documentElement);
    }
    refreshAll();
    if (config.debug && !prev.debug) for (const inst of instances) debugChecks(inst);
  } else {
    state.initialized = true;
    startObservers();
    upgradeTree(document.documentElement);
    evaluateTiers();
    requestToneSample();
  }
  return new Promise((resolve) => queueMicrotask(() => resolve(capabilities)));
}

/** register() before init() (e.g. autoInit: false) initialises with the global config first. */
function ensureInit() {
  if (!state.initialized && HAS_DOM) init(window.LiquidGlassConfig || {});
}

/** Registers glass (and sets up the components it matches, also after LG.destroy(el)). */
function register(el, opts) {
  optedOut.delete(el);
  const h = registerGlass(el, opts);
  if (state.initialized && el.isConnected) upgrade(el);
  return h;
}

/** Updates options of registered glass; unregistered elements are left alone (use register). */
function update(el, opts) {
  const h = registry.get(el);
  if (h) h.update(opts);
  else debugWarn(el, 'update-unregistered', 'LiquidGlass.update() was called on an element that is not registered; use register().');
}

function refresh(el) {
  if (el) registry.get(el)?.refresh();
  else refreshAll();
}

function destroy(el) {
  if (el) {
    optedOut.add(el);
    teardownAllComponents(el); // components first: their destroy() may still use the handle
    registry.get(el)?.destroy();
    return;
  }
  if (!state.initialized) return;
  for (const e of [...componentEls]) teardownAllComponents(e);
  for (const inst of [...instances]) destroyGlass(inst);
  tiers.claims.clear();
  state.initialized = false;
  stopObservers();
  stopToneSampling();
  stopPointerLight();
  stopLoop();
  cancelIdle();
  stopWorker();
  worker = null; // a later init() may start it again
  mapCache.clear();
  overlayCache.clear();
  clearFilters();
  defsSvg?.remove();
  defsSvg = null;
  removeFrostSheet();
  clearTimeout(tiers.timer);
  tiers.dispersing.clear();
  const html = root();
  html.removeAttribute('data-lg-engine');
  html.removeAttribute('data-lg-refraction');
  html.style.removeProperty('--_lg-tp');
  html.style.removeProperty('--_lg-tn');
  if (state.dispersion != null) html.style.removeProperty('--glass-dispersion');
  state.tinted = state.sheenTinted = 0;
  state.dispersion = null;
  clearTimeout(sheenState.timer);
  sheenState.timer = 0;
}

function stats() {
  return {
    maps: mapCache.size,
    overlays: overlayCache.size,
    filters: liveFilters,
    tierA: tierACount(),
    instances: instances.size,
    buildCount,                            // every bitmap build since load
    lastBuildMs: buildLog.map((b) => b.ms), // the last 32 of them
    builds: buildLog.map((b) => ({ ...b })),
  };
}

// ── Add-ons ────────────────────────────────────────────────────────────────
const addonNames = new Set();
/**
 * LG.extend(name, fn): runs an add-on (component partials) once per name as fn(I, LG), before or
 * after init(): components it defines upgrade matching elements straight away. The all-in-one
 * bundle runs its own groups through here, so an add-on it already contains is a no-op.
 */
function extend(name, fn) {
  if (typeof fn !== 'function' || addonNames.has(name)) return false;
  addonNames.add(name);
  try { fn(I, LG); } catch (e) { console.error(`[liquid-glass] add-on ${name} failed`, e); }
  return true;
}
/** [name, fn] pairs: the bundle's own groups, then add-on files that loaded before the core. */
function runAddons(list) {
  for (const [name, fn] of list) extend(name, fn);
}

function startAutoInit() {
  if (!HAS_DOM) return;
  const cfg = window.LiquidGlassConfig || {};
  if (cfg.autoInit === false) return;
  const go = () => { if (!state.initialized) init(cfg); };
  // Deferred so every component partial in the bundle has registered first.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
  else queueMicrotask(go);
}

Object.assign(LG, {
  init,
  register,
  attach: register,
  get: (el) => registry.get(el) || null,
  update,
  refresh,
  destroy,
  capabilities,
  setPreferences,
  stats,
  extend,
  events: Object.freeze({
    ready: 'glass:ready', tier: 'glass:tier', tone: 'glass:tone', lift: 'glass:lift', unlift: 'glass:unlift',
    materialized: 'glass:materialized', dematerialized: 'glass:dematerialized',
  }),
  // Internal namespace for tests and diagnostics. Not a public API; may change without notice.
  __test: I,
});
/** Names of the add-ons (component groups) that have run. */
Object.defineProperty(LG, 'addons', { get: () => [...addonNames], enumerable: true });

Object.assign(I, { LG, config, state });
runAddons(addons);
globalThis.LiquidGlass = LG;
runAddons(globalThis.LiquidGlassAddons?.splice(0) ?? []); // add-on files loaded before the core
startAutoInit();
})([
["container", function (I, LG) {
'use strict';
// ── comp-container.js ───────────────────────────────────────────────────────
try { (function () {
// .glass-container: droplet merge (spec §4.7.11, §5.10). Experimental.
//
// Tier A: the container draws one union glass for its members on its own pseudo-elements:
// ::before is the backdrop (refraction, fill and touch glow, clipped to the union) and ::after the
// surface (highlights, plus the shadow baked outside the shape). The shape is the polynomial
// smooth minimum of the members' rounded rects, so members within `spacing` of each other fuse
// like droplets. The union holds one slot of the refraction budget (I.budget.claim) in place of
// its members, which turn latent: their own layers hide, their content, focus ring and hit area
// stay. While members move the union is rebuilt at 1× with one build in flight; once they rest it
// is rebuilt at full resolution.
// Every tier: when a DOM change moves members, they morph with FLIP. A member that appears flows
// out of its partner (same data-glass-id) or nearest neighbour; one that disappears leaves a ghost
// that flows into its partner or nearest neighbour and dissolves.

const MERGE = {
  spacing: 16,       // default data-glass-spacing (px): shapes this close fuse
  settleFrames: 3,   // quiet frames before the full-resolution rebuild
  shadowY: 1, shadowBlur: 3, shadowAlpha: 0.08, // the core's second, contact shadow
};
const UNION_VARS = ['x', 'y', 'w', 'h', 'bf', 'clip', 'sprite', 'size', 'overlay-x', 'glow'].map((v) => `--_lgc-union-${v}`);
// While the union is possible, members rank below it for the budget: they only need slots of their
// own when it is not admitted.
const MEMBER_PRIORITY = -1;
const GUTTER = 2; // transparent device px between the sprite's cells, so filtering never bleeds
const LIBRARY_STYLES = ['scale', 'translate', 'will-change', 'transform-origin'];

// ── Geometry (pure) ────────────────────────────────────────────────────────
/** Signed distance to a rounded rect { cx, cy, hw, hh, r } and its gradient (the outward normal). */
function roundRect(px, py, s) {
  const dx = px - s.cx, dy = py - s.cy, sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  const qx = Math.abs(dx) - s.hw + s.r, qy = Math.abs(dy) - s.hh + s.r;
  if (qx > 0 && qy > 0) { const L = Math.hypot(qx, qy); return [L - s.r, (sx * qx) / L, (sy * qy) / L]; }
  return qx > qy ? [qx - s.r, sx, 0] : [qy - s.r, 0, sy];
}

/**
 * Smooth union of the shapes: d = mix(b, a, h) − k·h·(1 − h), h = clamp(½ + ½(b − a)/k, 0, 1),
 * which equals min(a, b) − h'²k/4 (§4.7.11); its gradient is mix(∇b, ∇a, h) exactly. A shape
 * with presence p < 1 is eroded by (1 − p)·max half-size, so it shrinks to nothing at 0.
 */
function unionField(px, py, shapes, k) {
  let d = Infinity, gx = 0, gy = 0;
  for (const s of shapes) {
    const [e, ex, ey] = roundRect(px, py, s);
    const di = e + (1 - s.presence) * Math.max(s.hw, s.hh);
    if (d === Infinity) { d = di; gx = ex; gy = ey; continue; }
    const h = k > 0 ? I.clamp(0.5 + (0.5 * (di - d)) / k, 0, 1) : di < d ? 0 : 1;
    d = di + (d - di) * h - k * h * (1 - h);
    gx = ex + (gx - ex) * h; gy = ey + (gy - ey) * h;
  }
  return [d, gx, gy];
}

/** Complementary error function (Abramowitz–Stegun 7.1.26, |error| < 1.5e−7). */
function erfc(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}

/**
 * The union, sampled at pixel centres over `box` (container px) at `scale` px per CSS px:
 *   path    its outline, traced from the distance field, for the backdrop layer's clip-path (a
 *           CSS mask would do, but a pending mask image paints nothing: the union would blink on
 *           every rebuild);
 *   sprite  one image, so a rebuild costs one PNG encode and decode; cells GUTTER device px
 *           apart: the rim displacement map, alpha-x / grey-y like the core's maps (§3.5), then
 *           the overlay: highlights (§3.7; Tier A, so no sheen) over the members' box-shadows
 *           baked outside the shape, each a Gaussian of σ = blur / 2 across the edge of the shape
 *           shifted down by y, its distance d − y·n_y to first order; with `o.rim`, then the rim
 *           mask, grey 255·(1 − x)² across the bezel (the core's, for the sharper rim and for a
 *           colour split confined to the rim).
 * @returns {{ path: string, sprite: { data, W, H }, cell: number, scale: number }}
 *   cell = the cell width in device px; scale = the feDisplacementMap scale.
 */
function buildUnion(shapes, o) {
  const { box, k, b, D, p } = o, px2 = o.scale;
  const W = Math.max(1, Math.round(box.w * px2)), H = Math.max(1, Math.round(box.h * px2)), cells = o.rim ? 3 : 2, SW = cells * W + (cells - 1) * GUTTER;
  const sx = box.w / W, sy = box.h / H, [lx, ly] = o.light, root2 = Math.SQRT2;
  const data = new Uint8ClampedArray(SW * H * 4), off = new Float32Array(W * H * 2), field = new Float32Array(W * H);
  const OVERLAY = (W + GUTTER) * 4, RIM = 2 * OVERLAY;
  let Dmax = 1e-3;
  for (let j = 0, n = 0; j < H; j++) {
    const py = box.y + (j + 0.5) * sy;
    for (let i = 0; i < W; i++, n++) {
      const [d, gx, gy] = unionField(box.x + (i + 0.5) * sx, py, shapes, k);
      const g = Math.hypot(gx, gy) || 1, nx = gx / g, ny = gy / g;
      const cov = I.clamp(0.5 - d * px2, 0, 1), q = (j * SW + i) * 4 + OVERLAY;
      field[n] = d;
      let hl = 0, a = 0; // highlight (premultiplied white) and alpha
      if (d <= 1) {
        const depth = d < 0 ? -d : 0, x = Math.min(1, depth / b), m = x < 1 ? (1 - x) ** p : 0;
        off[n * 2] = D * m * nx; off[n * 2 + 1] = D * m * ny;
        Dmax = Math.max(Dmax, D * m);
        if (o.rim) {
          const r = q - OVERLAY + RIM;
          data[r] = data[r + 1] = data[r + 2] = Math.round(255 * (1 - x) ** 2);
          data[r + 3] = 255;
        }
        if (cov > 0) {
          const facing = nx * lx + ny * ly;
          const lobe = Math.max(o.floor, facing > 0 ? facing ** 1.5 : o.back * (-facing) ** 1.5);
          const L = Math.min(1, o.intensity * lobe * (o.line * Math.exp(-((depth / o.lineW) ** 2)) + o.soft * Math.exp(-depth / o.softW)));
          const E = o.edgeDark * Math.exp(-((depth / 0.6) ** 2));
          hl = L * cov;
          a = (L + E * (1 - L)) * cov;
        }
      }
      if (cov < 1) { // box-shadow is drawn outside the shape only
        let clear = 1;
        for (const s of o.shadows) clear *= 1 - s.alpha * 0.5 * erfc((d - s.y * ny) / (s.sigma * root2));
        a += (1 - clear) * (1 - cov) * (1 - a);
      }
      if (a > 0) {
        data[q] = data[q + 1] = data[q + 2] = Math.round((255 * hl) / a);
        data[q + 3] = Math.round(255 * a);
      }
    }
  }
  for (let j = 0, n = 0, inv = 1 / Dmax; j < H; j++) {
    for (let i = 0, q = j * SW * 4; i < W; i++, n += 2, q += 4) {
      data[q] = data[q + 1] = data[q + 2] = I.encodeAG(off[n + 1] * inv); // y → grey
      data[q + 3] = I.encodeAG(off[n] * inv); // x → alpha
    }
  }
  return { path: contourPath(field, W, H, sx, sy), sprite: { data, W: SW, H }, cell: W, scale: 4 * Dmax };
}

// Marching squares: for each case (inside corners TL 8, TR 4, BR 2, BL 1) the cell edges (0 top,
// 1 right, 2 bottom, 3 left) its segments join. Saddles (5, 10) are resolved by the centre value.
const MARCH = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[3, 0]],
  [[3, 0]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];

/**
 * The zero contour of a distance field sampled at pixel centres, as an SVG path in the same
 * units (px of size sx × sy), closed loops, even-odd safe. Vertices sit where the field crosses
 * zero along the grid, and straight runs are thinned to within 0.1 px.
 */
function contourPath(field, W, H, sx, sy) {
  const at = (i, j) => field[j * W + i];
  // Each grid edge between two samples has a key; a crossing point lies on it.
  const key = (i, j, e) => (e === 0 ? 2 * (j * W + i) : e === 2 ? 2 * ((j + 1) * W + i) : e === 3 ? 2 * (j * W + i) + 1 : 2 * (j * W + i + 1) + 1);
  const point = (i, j, e) => {
    const [a, bi, bj] = e === 0 ? [at(i, j), i + 1, j] : e === 2 ? [at(i, j + 1), i + 1, j + 1] : e === 3 ? [at(i, j), i, j + 1] : [at(i + 1, j), i + 1, j + 1];
    const [ai, aj] = e === 0 || e === 3 ? [i, j] : e === 2 ? [i, j + 1] : [i + 1, j];
    const t = a / (a - at(bi, bj));
    return [(ai + (bi - ai) * t + 0.5) * sx, (aj + (bj - aj) * t + 0.5) * sy];
  };
  const links = new Map(), points = new Map();
  const link = (a, b) => { links.set(a, [...(links.get(a) || []), b]); links.set(b, [...(links.get(b) || []), a]); };
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const c = (at(i, j) < 0 ? 8 : 0) | (at(i + 1, j) < 0 ? 4 : 0) | (at(i + 1, j + 1) < 0 ? 2 : 0) | (at(i, j + 1) < 0 ? 1 : 0);
      if (c === 0 || c === 15) continue;
      let segs = MARCH[c];
      if (!segs) {
        const inside = at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1) < 0;
        segs = (c === 5) === inside ? [[3, 0], [2, 1]] : [[0, 1], [3, 2]];
      }
      for (const [e1, e2] of segs) {
        const k1 = key(i, j, e1), k2 = key(i, j, e2);
        if (!points.has(k1)) points.set(k1, point(i, j, e1));
        if (!points.has(k2)) points.set(k2, point(i, j, e2));
        link(k1, k2);
      }
    }
  }
  const f = (v) => I.fmt(v, 2), parts = [];
  for (const start of links.keys()) {
    if (!links.has(start)) continue;
    const loop = [];
    let prev = null, cur = start;
    while (cur != null && links.has(cur)) {
      loop.push(points.get(cur));
      const next = links.get(cur).find((n) => n !== prev && links.has(n)) ?? null;
      links.delete(cur);
      prev = cur; cur = next;
    }
    if (loop.length < 3) continue;
    const kept = thin(loop, 0.1);
    parts.push(`M${kept.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`);
  }
  return parts.join('');
}

/** Thins a polyline: a vertex goes when every vertex since the last kept one lies within `tol` of the chord past it. */
function thin(pts, tol) {
  const out = [pts[0]];
  for (let a = 0, n = 2; n < pts.length; n++) {
    const [ax, ay] = pts[a], dx = pts[n][0] - ax, dy = pts[n][1] - ay, L = Math.hypot(dx, dy) || 1;
    for (let m = a + 1; m < n; m++) {
      if (Math.abs((pts[m][0] - ax) * dy - (pts[m][1] - ay) * dx) / L > tol) { out.push(pts[n - 1]); a = n - 1; break; }
    }
  }
  out.push(pts.at(-1));
  return out;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
const sameId = (a, b) => !!a.dataset.glassId && a.dataset.glassId === b.dataset.glassId;
/** The entry of `list` ([element, rect][]) whose rect centre is closest to `rect`'s. */
function nearest(list, rect) {
  const [x, y] = centre(rect);
  let best = null, bd = Infinity;
  for (const entry of list) {
    const [cx, cy] = centre(entry[1]), d = Math.hypot(cx - x, cy - y);
    if (d < bd) { bd = d; best = entry; }
  }
  return best;
}
/** One call per microtask however often it is requested (several springs, one write). */
function coalesce(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; fn(); });
  };
}

class Container {
  constructor(el, signal) {
    this.el = el;
    this.members = new Map();   // member element → { h, flip, latent, deferred, unobserve }
    this.ghosts = new Map();    // ghost element → { h, flip, union }
    this.layout = new Map();    // visible member → { x, y, w, h, display } (container px, untransformed)
    this.claim = null;          // the union's budget slot, held while a union is possible
    this.unionOn = false;
    this.union = null;          // what is drawn: { key, full, box, url, filter }
    this.animating = false;     // CSS transitions / animations may be moving members
    this.mo = new MutationObserver((records) => this.onMutations(records));
    this.mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'data-glass-spacing'] });
    this.onResize = coalesce(() => { if (!this.dead) { this.layout = this.measureLayout(); this.requestUnion(); } });
    this.unobserve = I.observeResize(el, this.onResize);
    // Budget passes and refreshes fire glass:tier for several members at once: one sync for all.
    this.requestSync = coalesce(() => this.sync());
    const on = (type, fn) => el.addEventListener(type, fn, { signal });
    on('glass:tier', this.requestSync);
    on('glass:tone', (e) => { if (!e.target.hasAttribute('data-lgc-ghost')) this.requestUnion(true); }); // a ghost keeps its original's tone
    for (const type of ['transitionrun', 'animationstart']) on(type, (e) => { if (e.target !== el) { this.animating = true; this.requestUnion(); } });
    // "Clear ↔ Tinted" and dispersion preferences: the union's filter follows in place (restyle).
    this.offPrefs = I.onPreferences(() => this.restyle());
    // The core registers the members during the same upgrade pass, after this setup.
    queueMicrotask(() => {
      if (this.dead) return;
      this.collect();
      this.layout = this.measureLayout();
      this.sync();
    });
  }

  // ── Members ──────────────────────────────────────────────────────────────
  /** Glass descendants that belong to this container (not to a nested container or glass). */
  collect() {
    const found = new Set();
    for (const el of this.el.querySelectorAll('.glass')) {
      if (el.hasAttribute('data-lgc-ghost') || el.parentElement.closest('.glass, .glass-container') !== this.el) continue;
      const h = I.get(el);
      if (!h) continue; // the core registers it shortly; a later mutation picks it up
      found.add(el);
      if (!this.members.has(el)) this.members.set(el, { h, flip: null, latent: false, deferred: false, unobserve: I.observeResize(el, this.onResize) });
    }
    for (const [el, m] of this.members) if (!found.has(el)) this.release(el, m);
  }

  release(el, m) {
    this.members.delete(el);
    m.unobserve();
    this.stopFlip(m);
    m.h.clearChannel('flip');
    this.setLatent(m, false);
    this.defer(m, false);
  }

  /** Union members: regular, untinted glass that could render Tier A. */
  eligible(m) {
    const o = m.h.o;
    return !!o && o.variant === 'regular' && !o.tinted && m.h.staticTier === 'a';
  }

  // ── Tier and budget ──────────────────────────────────────────────────────
  sync() {
    if (this.dead) return;
    const own = this.el.getAttribute('data-glass-tier'), members = [...this.members.values()], joinable = members.filter((m) => this.eligible(m));
    // The union is placed in the container's padding box, so the container must stay positioned.
    const possible = own !== 'b' && own !== 'c' && !this.failed && joinable.length > 0 && getComputedStyle(this.el).position !== 'static';
    for (const m of members) this.defer(m, possible && joinable.includes(m));
    if (possible) {
      // One slot for the members' area, ranked just above them.
      const area = joinable.reduce((sum, m) => sum + (m.h.geom ? m.h.geom.w * m.h.geom.h : 0), 0);
      const priority = Math.max(...joinable.map((m) => m.h.o.priority)) + 1;
      if (!this.claim) this.claim = I.budget.claim(this.el, { area, priority, onChange: this.requestSync });
      else if (area !== this.claim.area || priority !== this.claim.priority) this.claim.update({ area, priority });
    } else if (this.claim) {
      this.claim.release();
      this.claim = null;
    }
    const on = possible && this.claim.admitted;
    if (on !== this.unionOn) {
      this.unionOn = on;
      if (!on) this.dropUnion();
    }
    if (on) {
      // A member that stops qualifying (tinted, capped) renders itself again.
      for (const m of members) if (m.latent && !this.eligible(m)) this.setLatent(m, false);
      this.requestUnion(true);
    }
  }

  /** While the union is possible, a member ranks below it (MEMBER_PRIORITY, an author's priority wins). */
  defer(m, on) {
    if (m.deferred === on) return;
    m.deferred = on;
    m.h.setDefaults({ priority: on ? MEMBER_PRIORITY : undefined });
  }

  setLatent(m, on) {
    if (m.latent === on) return;
    m.latent = on;
    m.h.update({ latent: on });
  }

  // ── Union glass (Tier A) ─────────────────────────────────────────────────
  requestUnion(force = false) {
    if (!this.unionOn || this.dead) return;
    this.dirty = true;
    if (force) this.stale = true;
    if (!this.frameOff) { this.quiet = 0; this.frameOff = I.onFrame(() => this.frame()); }
  }

  frame() {
    if (!this.unionOn) { this.stopLoop(); return; }
    if (this.animating) {
      this.animating = this.el.getAnimations({ subtree: true }).some((a) => a.playState === 'running');
      if (this.animating) this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.quiet = 0; this.update(false); return; }
    this.quiet++;
    if (this.quiet === MERGE.settleFrames) this.update(true);
    else if (this.quiet > MERGE.settleFrames && !this.building) this.stopLoop();
  }

  stopLoop() {
    this.frameOff?.();
    this.frameOff = null;
  }

  /** The drawn shapes: members and ghosts as they look now, in container px. */
  shapes() {
    // Viewport px → the container's own px (an ancestor may scale it, e.g. a materializing sheet).
    const el = this.el, c = el.getBoundingClientRect(), k = el.offsetWidth / (c.width || el.offsetWidth || 1);
    const ox = c.left + el.clientLeft / k, oy = c.top + el.clientTop / k;
    const out = [];
    const add = (e, m) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || !m.h.d) return;
      const g = m.h.geom, hw = (r.width * k) / 2, hh = (r.height * k) / 2;
      const s = Math.min((2 * hw) / (e.offsetWidth || 2 * hw), (2 * hh) / (e.offsetHeight || 2 * hh)); // its own scale (press, FLIP)
      out.push({ el: e, m, cx: (r.left - ox) * k + hw, cy: (r.top - oy) * k + hh, hw, hh, r: Math.min(g ? g.corners[0][0] * s : hh, hw, hh), presence: m.flip ? I.clamp(m.flip.presence.value, 0, 1) : 1 });
    };
    for (const [e, m] of this.members) if (this.eligible(m)) add(e, m);
    for (const [e, m] of this.ghosts) if (m.union) add(e, m);
    return out;
  }

  update(full) {
    const shapes = this.shapes();
    this.writeGlow(shapes);
    if (!shapes.length) { this.hideUnion(); return; }
    const r = (v) => Math.round(v * 4) / 4;
    // The members' depth-shadow strength: the core raises it over busy backdrops (V5).
    const so = Math.max(...shapes.map((s) => I.toNumber(s.el.style.getPropertyValue('--_lg-so'), 0.14)));
    // Dispersion on or off changes the overscan (restyle() handles every other preference change).
    const key = JSON.stringify([shapes.map((s) => [r(s.cx), r(s.cy), r(s.hw), r(s.hh), r(s.r), +s.presence.toFixed(2)]), this.spacing(), shapes[0].m.h.tone, so, this.dispersionOf(shapes[0].m.h) > 0]);
    if (!this.stale && key === this.union?.key && (!full || this.union.full)) return;
    if (this.building) { this.dirty = true; return; } // rebuilt when the current build lands
    this.stale = false;
    this.build(shapes, key, full, so).catch(() => { this.failed = true; this.sync(); }); // no canvas encoder: independent glass
  }

  spacing() {
    return Math.max(0, I.toNumber(this.el.getAttribute('data-glass-spacing'), MERGE.spacing));
  }

  async build(shapes, key, full, so) {
    this.building = true;
    let url = null;
    try {
      const lead = shapes[0].m.h, d = lead.d, D0 = I.defaults, minSide = Math.min(...shapes.map((s) => 2 * Math.min(s.hw, s.hh)));
      const b = Math.min(...shapes.map((s) => s.m.h.d?.b ?? d.b)), reach = D0.kReach * b * d.strength;
      // Frost before the "Clear" preference (d.sigma0) sizes the overscan and picks the sharp rim, so
      // dragging the preference restyles the filter in place; B, dispersed, reaches (1 + k)·D.
      const sigma0 = d.sigma0 ?? d.sigma, k = this.dispersionOf(lead);
      const over = Math.ceil(reach * (1 + (k > 0 ? I.DISPERSION_REST : 0)) + 2 * sigma0 + 1);
      // The core's depth shadow for the smallest member (§1.2 V5), then its contact shadow.
      const sy = I.clamp(minSide * 0.12, 3, 16), sb = I.clamp(minSide * 0.45, 12, 48);
      const strength = I.toNumber(getComputedStyle(this.el).getPropertyValue('--glass-shadow-strength'), 1);
      const shadows = [{ y: sy, sigma: sb / 2, alpha: so * strength }, { y: MERGE.shadowY, sigma: MERGE.shadowBlur / 2, alpha: MERGE.shadowAlpha * strength }];
      const margin = Math.ceil(Math.max(over, sy + sb)); // the shadow is below 1/255 two σ out
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of shapes) { x0 = Math.min(x0, s.cx - s.hw); y0 = Math.min(y0, s.cy - s.hh); x1 = Math.max(x1, s.cx + s.hw); y1 = Math.max(y1, s.cy + s.hh); }
      const box = { x: Math.floor(x0) - margin, y: Math.floor(y0) - margin, w: Math.ceil(x1) - Math.floor(x0) + 2 * margin, h: Math.ceil(y1) - Math.floor(y0) + 2 * margin };
      const rad = (lead.o.lightAngle * Math.PI) / 180, dark = lead.tone === 'dark';
      // Button-sized glass keeps a sharper rim in the core (VIS-11), and so does a union of buttons.
      const rim = sigma0 >= 2 && shapes.every(({ m: { h: { geom: g } } }) => g && Math.min(g.w, g.h) <= 64 && g.w * g.h <= 16000);
      const params = {
        // Midway across a gap g the blend subtracts k/4 from g/2: shapes touch once g ≤ k/2 = spacing.
        box, k: 2 * this.spacing(), b, D: reach, p: lead.o.profile, shadows, rim: rim || k > 0,
        scale: full ? I.mapScaleFor(box.w * box.h, I.caps.dpr) : 1,
        light: [Math.sin(rad), -Math.cos(rad)], line: D0.line, lineW: D0.lineW, soft: D0.soft, softW: D0.softW,
        back: D0.back, floor: D0.floor, edgeDark: lead.o.edgeDark, intensity: lead.o.highlight * (dark ? 0.8 : 1),
      };
      const plain = shapes.map(({ cx, cy, hw, hh, r, presence }) => ({ cx, cy, hw, hh, r, presence }));
      const result = full ? await I.whenIdle(() => buildUnion(plain, params)) : buildUnion(plain, params);
      url = URL.createObjectURL(await I.encodePNG(result.sprite));
      await I.decodeURL(url);
      if (this.dead || !this.unionOn) return;
      const old = this.union?.url;
      this.showUnion({ key, full, box, url, path: result.path, px: params.scale, cell: result.cell, spriteW: result.sprite.W, scale: result.scale, lead, dark, rim });
      url = old;
    } finally {
      if (url) URL.revokeObjectURL(url);
      this.building = false;
    }
  }

  /** The union's dispersion: its lead member's (the page-wide --glass-dispersion, usually). */
  dispersionOf(h) {
    return I.DISPERSION_REST * (h?.o?.dispersion || 0);
  }

  /**
   * The union's filter: its map and rim-mask cells in the sprite (`base`), with the lead member's
   * current frost, tone and dispersion. The split is built from half a device pixel between R and B
   * and drawn by the rim pass over the mask cell, as in the core (the core's sharpRim()).
   */
  unionSpec(base) {
    const d = base.lead.d, k = this.dispersionOf(base.lead);
    const split = k > 0 && !!base.mask && ((k * base.map.scale) / 2) * I.caps.dpr >= 0.5;
    const blur = base.sharp ? d.sigma / 3 : split ? d.sigma * (1 - (2 / 3) * Math.min(1, k / (0.5 * I.DISPERSION_REST))) : null;
    return { ...base.spec, blur: d.sigma, tone: d.tone, dispersion: split ? k : 0, split, sharp: blur == null ? null : { ...base.mask, blur } };
  }

  /** Swaps in `spec`: updated in place when its graph is unchanged, else a new filter. */
  applyFilter(spec) {
    let filter = this.union?.filter;
    const old = filter?.structure === I.filterStructure(spec) ? null : filter;
    if (old || !filter) filter = I.createFilter(spec);
    else filter.set(spec);
    return { filter, old };
  }

  /** Preferences changed ("Clear ↔ Tinted", dispersion): restyle the union's filter, no rebuild. */
  restyle() {
    const u = this.union;
    if (this.dead || !u?.filter || !u.base.lead?.d || u.base.lead.dead) return;
    if ((this.dispersionOf(u.base.lead) > 0) !== u.dispersed) { this.requestUnion(true); return; } // overscan changes
    const { filter, old } = this.applyFilter(this.unionSpec(u.base));
    u.filter = filter;
    I.setVar(this.el, '--_lgc-union-bf', filter.url);
    old?.destroy();
  }

  showUnion({ key, full, box, url, path, px, cell, spriteW, scale, lead, dark, rim }) {
    const el = this.el, css = (v) => `${I.fmt(v, 3)}px`, set = (name, v) => I.setVar(el, `--_lgc-union-${name}`, v);
    // The sprite is placed so that the cell in use covers the layer; the other cells fall outside.
    const place = (n) => ({ href: url, x: (-n * (cell + GUTTER)) / px, y: 0, width: spriteW / px, height: box.h });
    const mask = this.dispersionOf(lead) > 0 || rim ? place(2) : null; // the sprite has the mask cell
    const base = { lead, map: { ...place(0), scale }, mask, sharp: rim, spec: { width: box.w, height: box.h, enc: 'ag', map: { ...place(0), scale } } };
    const { filter, old } = this.applyFilter(this.unionSpec(base));
    this.union = { key, full, box, url, filter, base, dispersed: this.dispersionOf(lead) > 0 };
    set('x', css(box.x));
    set('y', css(box.y));
    set('w', css(box.w));
    set('h', css(box.h));
    set('bf', filter.url);
    set('clip', `path(evenodd, '${path}')`);
    set('sprite', `url("${url}")`);
    set('size', `${css(spriteW / px)} ${css(box.h)}`);
    set('overlay-x', css(-(cell + GUTTER) / px));
    I.setAttr(el, 'data-lgc-merge-tone', dark ? 'dark' : null);
    el.setAttribute('data-lgc-merge', 'union');
    old?.destroy(); // the layer points at its successor now
    // Members hide their own layers only once the union is on screen.
    for (const m of this.members.values()) if (this.eligible(m)) this.setLatent(m, true);
    this.writeGlow(this.lastShapes || []);
  }

  hideUnion() {
    this.el.removeAttribute('data-lgc-merge');
    if (this.union) this.union.key = null;
  }

  dropUnion() {
    this.stopLoop();
    for (const m of this.members.values()) this.setLatent(m, false);
    this.union?.filter.destroy();
    if (this.union) URL.revokeObjectURL(this.union.url);
    this.union = null;
    for (const v of UNION_VARS) I.setVar(this.el, v, null);
    for (const a of ['data-lgc-merge', 'data-lgc-merge-tone']) this.el.removeAttribute(a);
  }

  /** Members' touch glows, which their latent layers cannot show, drawn on the union (inside its outline). */
  writeGlow(shapes) {
    this.lastShapes = shapes;
    const box = this.union?.box, layers = [];
    if (box) {
      for (const s of shapes) {
        const g = I.glowState(s.m.h), w = s.el.offsetWidth || 1, h = s.el.offsetHeight || 1;
        if (g.amount < 0.005) continue;
        const kx = (2 * s.hw) / w, ky = (2 * s.hh) / h, r = g.radius * Math.max(kx, ky); // glow px are the member's own
        const x = s.cx - s.hw + (g.x ?? w / 2) * kx - box.x, y = s.cy - s.hh + (g.y ?? h / 2) * ky - box.y;
        if (r > 0.5) layers.push(`radial-gradient(circle ${I.fmt(r, 1)}px at ${I.fmt(x, 1)}px ${I.fmt(y, 1)}px, rgb(255 255 255 / ${I.fmt(g.amount * g.peak)}), rgb(255 255 255 / 0))`);
      }
    }
    I.setVar(this.el, '--_lgc-union-glow', layers.length ? layers.join(', ') : null);
  }

  // ── Layout changes: FLIP ─────────────────────────────────────────────────
  onMutations(records) {
    let structural = false, moving = false;
    for (const r of records) {
      if (r.type === 'childList') {
        const nodes = [...r.addedNodes, ...r.removedNodes].filter((n) => n.nodeType === 1);
        if (nodes.some((n) => !n.hasAttribute('data-lgc-ghost'))) structural = true;
        continue;
      }
      if (r.attributeName === 'data-glass-spacing') { this.requestUnion(true); continue; }
      if (r.attributeName === 'style') { if (r.target !== this.el) moving = true; continue; }
      if (!r.target.hasAttribute('data-lgc-ghost')) structural = true; // hidden, class
    }
    if (structural) this.flip(records);
    else if (moving) this.requestUnion();
  }

  /** Visible members' layout boxes, relative to the container's padding box, ignoring transforms. */
  measureLayout() {
    const out = new Map();
    for (const el of this.members.keys()) {
      if (!el.getClientRects().length) continue;
      let x = 0, y = 0, e = el;
      for (; e && e !== this.el; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
      if (e !== this.el) { // the author made the container static: measure what is drawn instead
        const r = el.getBoundingClientRect(), c = this.el.getBoundingClientRect();
        x = r.left - c.left - this.el.clientLeft; y = r.top - c.top - this.el.clientTop;
      }
      out.set(el, { x, y, w: el.offsetWidth, h: el.offsetHeight, display: getComputedStyle(el).display });
    }
    return out;
  }

  /** Where a member is drawn now: its layout box with its FLIP in flight applied. */
  visual(el, box) {
    const f = this.members.get(el)?.flip;
    if (!f) return { ...box };
    const w = box.w * f.sx.value, h = box.h * f.sy.value;
    return { x: box.x + box.w / 2 + f.tx.value - w / 2, y: box.y + box.h / 2 + f.ty.value - h / 2, w, h, display: box.display };
  }

  flip(records) {
    const prev = this.layout;
    const before = new Map([...prev].map(([el, box]) => [el, this.visual(el, box)]));
    this.collect();
    const next = this.measureLayout();
    this.layout = next;
    const stayed = [...next].filter(([el]) => before.has(el)).map(([el]) => [el, before.get(el)]);
    const gone = [...before].filter(([el]) => !next.has(el));
    for (const [el, to] of next) {
      if (before.has(el)) { this.morph(el, before.get(el), to, false); continue; }
      const src = gone.find(([g]) => sameId(g, el)) || nearest(stayed, to);
      this.morph(el, src ? src[1] : null, to, true);
    }
    const removed = new Set(records.flatMap((r) => (r.type === 'childList' ? [...r.removedNodes] : [])));
    for (const [el, from] of gone) {
      const to = [...next].find(([n]) => sameId(n, el)) || nearest([...next], from);
      if (el.isConnected || removed.has(el)) this.ghost(el, from, to ? to[1] : null);
    }
    this.sync(); // members joined or left
  }

  /** FLIP from `from` (a drawn box) to the layout box `to`; `appear` also fades the member in. */
  morph(el, from, to, appear) {
    const m = this.members.get(el);
    if (!m) return;
    if (appear) I.materialize(m.h, { scale: 1 });
    if (!from || I.reducedMotion()) return;
    const [fx, fy] = centre(from), [tx, ty] = centre(to);
    const start = { tx: fx - tx, ty: fy - ty, sx: from.w / to.w, sy: from.h / to.h, presence: appear ? 0 : 1 };
    if (!appear && Math.abs(start.tx) < 0.5 && Math.abs(start.ty) < 0.5 && Math.abs(start.sx - 1) < 0.01 && Math.abs(start.sy - 1) < 0.01) return;
    this.runFlip(m, start, { tx: 0, ty: 0, sx: 1, sy: 1, presence: 1 }, () => { m.h.clearChannel('flip'); m.flip = null; });
  }

  /** A stand-in for a member that left: it flows into `to` and dissolves, then is removed. */
  ghost(el, from, to) {
    const g = I.inertClone(el); // a ghost radio must not join the real group or the form
    for (const a of [...g.attributes]) if (a.name.startsWith('data-lg-') || a.name === 'hidden' || a.name === 'data-glass-id') g.removeAttribute(a.name);
    for (const prop of [...g.style]) if (prop.startsWith('--_lg-') || LIBRARY_STYLES.includes(prop)) g.style.removeProperty(prop);
    g.setAttribute('data-lgc-ghost', '');
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { position: 'absolute', left: `${from.x}px`, top: `${from.y}px`, width: `${from.w}px`, height: `${from.h}px`, margin: '0', boxSizing: 'border-box', pointerEvents: 'none' });
    g.style.setProperty('display', from.display || 'block', 'important');
    this.el.append(g);
    // The ghost keeps its original's tone: a new adaptive element would sample the backdrop.
    const union = this.unionOn, reduced = I.reducedMotion(), tone = el.getAttribute('data-lg-tone') || undefined;
    // Under reduced motion the union reshapes at once and only the content crossfades.
    const m = { h: I.register(g, union ? { latent: true, tone } : { tier: 'b', tone }), flip: null, union: union && !reduced };
    this.ghosts.set(g, m);
    const done = () => {
      this.ghosts.delete(g);
      m.h.destroy();
      g.remove();
      this.requestUnion();
    };
    if (reduced) { I.dematerialize(m.h, { scale: 1 }).then(done); return; }
    I.dematerialize(m.h, { scale: 0.9 });
    const [fx, fy] = centre(from), [tx, ty] = to ? centre(to) : [fx, fy]; // nowhere to go: evaporate in place
    const end = to ? { tx: tx - fx, ty: ty - fy, sx: to.w / from.w, sy: to.h / from.h } : { tx: 0, ty: 0, sx: 1, sy: 1 };
    this.runFlip(m, { tx: 0, ty: 0, sx: 1, sy: 1, presence: 1 }, { ...end, presence: 0 }, done);
  }

  /** Springs a member's 'flip' transform channel (and its union presence) from `start` to `end`. */
  runFlip(m, start, end, onDone) {
    this.stopFlip(m);
    const write = coalesce(() => {
      if (m.flip !== f) return;
      I.setChannel(m.h, 'flip', { sx: f.sx.value, sy: f.sy.value, tx: f.tx.value, ty: f.ty.value });
      if (this.unionOn) this.requestUnion();
    });
    const f = {};
    for (const k of ['tx', 'ty', 'sx', 'sy']) f[k] = new I.Spring({ value: start[k], preset: 'unlift', onUpdate: write });
    f.presence = new I.Spring({ value: start.presence, preset: 'smooth', onUpdate: write });
    m.flip = f;
    write();
    Promise.all(Object.keys(f).map((k) => f[k].to(end[k]))).then(() => { if (m.flip === f) onDone(); });
  }

  stopFlip(m) {
    if (!m.flip) return;
    const f = m.flip;
    m.flip = null;
    for (const s of Object.values(f)) s.stop();
  }

  destroy() {
    this.dead = true;
    this.offPrefs();
    this.mo.disconnect();
    this.unobserve();
    this.claim?.release();
    for (const [el, m] of this.ghosts) { this.stopFlip(m); m.h.destroy(); el.remove(); }
    this.ghosts.clear();
    this.dropUnion();
    for (const [el, m] of [...this.members]) this.release(el, m);
  }
}

I.defineComponent('container', {
  selector: '.glass-container',
  setup(el, { signal }) {
    const c = new Container(el, signal);
    return { destroy: () => c.destroy(), refresh: () => { c.collect(); c.sync(); } };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-container.js failed', e); }
}],
["lens", function (I, LG) {
'use strict';
// ── comp-lens-gl.js ─────────────────────────────────────────────────────────
try { (function () {
// Tier W: WebGL2 lens renderer (spec §2.2, §3.2–§3.6, §4.7.10).
//
// Draws the optics of one glass lens over a known source (canvas, image, video or ImageBitmap) into
// the lens's own <canvas>: seam-free rim field, rim compression or physical lens mapping, zoom,
// per-wavelength dispersion and an optional light frost. Highlights, fill and shadow belong to the
// CSS overlay. Self-contained on purpose: it shares no code with the core, so it only exposes
// I.LensGL.
//
// Coordinates: CSS px, +x right, +y down. A lens rect is given in the source element's CSS px,
// measured from its (untransformed) border-box top-left corner. All colour work is on premultiplied
// sRGB values, like the Tier-A SVG filter with color-interpolation-filters="sRGB".

const MAX_DPR = 2;
const DISPERSION_SCALE = 0.06;     // k = 0.06 · dispersion (§3.6)
const MAX_ANISOTROPY = 8;          // rim compression tops out near 3×, so 8× is plenty
const MAX_BLUR_RADIUS = 128;       // texels; the blur shader loops over at most 64 tap pairs

// Spectral taps for dispersion. Instead of three hard R/G/B copies (which show as ghost edges on
// sharp text), each channel integrates several wavelengths: tap i samples at offset·(1 + k·t[i])
// (k ramped across the bezel) and contributes w[i] to R, G, B. Weights are normalised per channel
// so white stays white, and t is scaled so the R and B centroids sit exactly at ∓1: at the rim the
// channels land at 1 ∓ k, like Tier A's per-channel displacement scales.
const SPECTRUM = (() => {
  const n = 7, t = [], bump = (u) => Math.exp(-((u / 0.45) ** 2));
  for (let i = 0; i < n; i++) t.push(-1 + (2 * i) / (n - 1));
  const channels = [-0.7, 0, 0.7].map((c) => {
    const w = t.map((ti) => bump(ti - c)), sum = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / sum);
  });
  const redCentroid = channels[0].reduce((a, w, i) => a + w * t[i], 0);
  return {
    n,
    t: Float32Array.from(t, (ti) => ti / -redCentroid),
    w: Float32Array.from(t.flatMap((_, i) => channels.map((ch) => ch[i]))),
  };
})();

const VERTEX_SHADER = `#version 300 es
// Full-screen triangle generated from gl_VertexID; no vertex buffers needed.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const LENS_SHADER = `#version 300 es
precision highp float;
precision highp int;
#define TAPS ${SPECTRUM.n}

uniform sampler2D uTex;
uniform vec2  uBuf;          // drawing-buffer size, device px
uniform vec2  uDpr;          // device px per CSS px (per axis, after rounding the buffer)
uniform vec2  uHalf;         // lens half size
uniform vec4  uRx, uRy;      // corner radii TL, TR, BR, BL
uniform float uBezel;        // b
uniform float uReach;        // signed D: > 0 samples outward (rim), < 0 inward (lens)
uniform float uProfile;      // p in M(x) = (1 - x)^p
uniform float uZoomK;        // 1 - 1/zoom
uniform vec2  uCentre;       // lens centre in source-element CSS px
uniform vec4  uUv;           // texture uv = (P - uUv.xy) * uUv.zw
uniform float uK;            // dispersion split factor (0 = off)
uniform float uTapT[TAPS];
uniform vec3  uTapW[TAPS];
uniform mat3  uTone;
uniform float uToneOffset;
out vec4 outColor;

// Seam-free glass field (twin of glassField in the map builder, spec §3.2). The core is the box
// inset by b with corner radius max(min(rx, ry) - b, 0); t is the distance outside the core, o its
// gradient (the outward normal) and tEdge the length along o from the core to the real CSS edge
// (a ray/ellipse intersection in the corners). x = 1 - t/tEdge is 0 on the CSS edge and 1 on the
// plateau; beyond > 0 outside the shape.
void glassField(vec2 p, out float x, out vec2 o, out float beyond) {
  int q = p.x < 0.0 ? (p.y < 0.0 ? 0 : 3) : (p.y < 0.0 ? 1 : 2);
  float rx = min(uRx[q], uHalf.x), ry = min(uRy[q], uHalf.y), b = uBezel;
  vec2 a = abs(p), sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  float rc = max(min(rx, ry) - b, 0.0);
  vec2 ac = uHalf - b - rc;            // centre of the core's corner arc
  vec2 qv = a - ac;
  vec2 e = uHalf - vec2(rx, ry);       // centre of the CSS corner ellipse
  bool ell = rx > 0.0 && ry > 0.0;
  float t, tEdge;
  vec2 g;
  if (qv.x > 0.0 && qv.y > 0.0) {
    float L = length(qv);
    t = L - rc;
    g = qv / L;
    float S = 1e9;
    if (ell) {
      vec2 r2 = vec2(rx, ry), d = ac - e;
      float A = dot(g / r2, g / r2);
      float B = 2.0 * (d.x * g.x / (rx * rx) + d.y * g.y / (ry * ry));
      float C = dot(d / r2, d / r2) - 1.0;
      float disc = B * B - 4.0 * A * C;
      if (disc >= 0.0) {
        float s = (-B + sqrt(disc)) / (2.0 * A);
        vec2 P = ac + s * g;
        if (P.x >= e.x - 1e-4 && P.y >= e.y - 1e-4) S = s;
      }
    }
    if (S > 1e8) S = min(g.x > 1e-6 ? (uHalf.x - ac.x) / g.x : 1e9, g.y > 1e-6 ? (uHalf.y - ac.y) / g.y : 1e9);
    tEdge = S - rc;
  } else if (qv.x > qv.y) {
    t = qv.x - rc;
    g = vec2(1.0, 0.0);
    float v = (a.y - e.y) / ry;
    tEdge = (ell && a.y > e.y ? e.x + rx * sqrt(max(0.0, 1.0 - v * v)) : uHalf.x) - (uHalf.x - b);
  } else {
    t = qv.y - rc;
    g = vec2(0.0, 1.0);
    float v = (a.x - e.x) / rx;
    tEdge = (ell && a.x > e.x ? e.y + ry * sqrt(max(0.0, 1.0 - v * v)) : uHalf.y) - (uHalf.y - b);
  }
  tEdge = max(tEdge, 1e-3);
  x = 1.0 - t / tEdge;
  o = sg * g;
  beyond = t - tEdge;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uBuf.y - gl_FragCoord.y) / uDpr - uHalf;   // y down, lens-centred
  float x, beyond;
  vec2 o;
  glassField(p, x, o, beyond);

  // §3.3: M(x) = (1 - x)^p along the normal (compression, never a fold). §3.4: magnify about the
  // centre on the plateau and hand over to the pure rim offset across the bezel.
  float m = x < 1.0 ? pow(1.0 - max(x, 0.0), uProfile) : 0.0;
  vec2 off = uReach * m * o - p * uZoomK * (1.0 - m);
  vec2 uv = (uCentre + p + off - uUv.xy) * uUv.zw;
  // Dispersion lives in the rim band: the split ramps from 0 on the plateau to k at the CSS edge,
  // so the magnified centre stays sharp while the bezel shows a colour fringe.
  vec2 split = off * clamp(1.0 - x, 0.0, 1.0) * uK;

  // Take the gradients before any branch so every tap can use textureGrad inside divergent control
  // flow; mipmaps + anisotropy then keep the compressed rim free of aliasing.
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  float cov = clamp(0.5 - beyond * max(uDpr.x, uDpr.y), 0.0, 1.0);
  vec4 c = vec4(0.0);
  if (cov > 0.0) {
    if (length(split * uDpr) < 0.1) {             // split below 0.1 device px: one tap is identical
      c = textureGrad(uTex, uv, gx, gy);
    } else {
      vec2 splitUv = split * uUv.zw;
      for (int i = 0; i < TAPS; i++) {
        vec4 s = textureGrad(uTex, uv + splitUv * uTapT[i], gx, gy);
        vec3 w = uTapW[i];
        c += vec4(s.rgb * w, s.a * (w.r + w.g + w.b) / 3.0);
      }
    }
    // Tone on premultiplied colour: the linear part commutes with alpha, the offset scales by it.
    c.rgb = clamp(uTone * c.rgb + uToneOffset * c.a, 0.0, c.a);
  }
  outColor = c * cov;
}`;

// One pass of a separable Gaussian. Fragment (i, j) of the target reads input texel centre
// (i, j) + uOffset; pairs of taps share one bilinear fetch placed at their weighted centre.
const BLUR_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2  uTexSize;
uniform vec2  uOffset;
uniform vec2  uDir;
uniform float uSigma;
uniform int   uRadius;
out vec4 outColor;

void main() {
  vec2 c = gl_FragCoord.xy + uOffset;
  float k = -0.5 / (uSigma * uSigma);
  vec4 acc = textureLod(uTex, c / uTexSize, 0.0);
  float sum = 1.0;
  for (int i = 1; i < ${MAX_BLUR_RADIUS}; i += 2) {
    if (i > uRadius) break;
    float wa = exp(k * float(i * i)), wb = exp(k * float((i + 1) * (i + 1))), w = wa + wb;
    vec2 d = uDir * ((float(i) * wa + float(i + 1) * wb) / w);
    acc += (textureLod(uTex, (c + d) / uTexSize, 0.0) + textureLod(uTex, (c - d) / uTexSize, 0.0)) * w;
    sum += 2.0 * w;
  }
  outColor = acc / sum;
}`;

const CONTEXT_ATTRIBUTES = {
  alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
  preserveDrawingBuffer: false,
};

function compileProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);                    // flagged; freed with the program
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const logs = [gl.getProgramInfoLog(program), ...gl.getAttachedShaders(program).map((sh) => gl.getShaderInfoLog(sh))];
    gl.deleteProgram(program);
    throw new Error(`LensGL: shader build failed: ${logs.filter(Boolean).join('\n')}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function createTexture(gl, mipmapped, anisotropy) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);   // sampling beyond the source clamps
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmapped && anisotropy > 1) gl.texParameterf(gl.TEXTURE_2D, 0x84fe /* TEXTURE_MAX_ANISOTROPY_EXT */, anisotropy);
  return { tex, w: 0, h: 0 };
}

// Resize a texture's level 0 (contents undefined) only when its size changes.
function allocTexture(gl, t, w, h) {
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  if (t.w === w && t.h === h) return;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  t.w = w;
  t.h = h;
}

// radii: a number, or four corners (TL, TR, BR, BL) each a number or [rx, ry]. Omitted = capsule.
// Applies the CSS overlapping-curves scale so any input yields a valid rounded rect.
function resolveRadii(radii, w, h) {
  const src = radii == null ? 9999 : radii;
  const corners = (Array.isArray(src) ? src : [src, src, src, src])
    .map((c) => (Array.isArray(c) ? [+c[0] || 0, +(c[1] ?? c[0]) || 0] : [+c || 0, +c || 0]))
    .map(([rx, ry]) => [Math.max(0, rx), Math.max(0, ry)]);
  const fit = (length, sum) => (sum > 0 ? length / sum : Infinity);
  const f = Math.min(1, fit(w, corners[0][0] + corners[1][0]), fit(w, corners[3][0] + corners[2][0]),
    fit(h, corners[0][1] + corners[3][1]), fit(h, corners[1][1] + corners[2][1]));
  return corners.map(([rx, ry]) => [rx * f, ry * f]);
}

// Linear part of toneMatrix(s, gain, offset) as a column-major mat3: Rec.709-luma saturation, then
// gain. The offset is a separate uniform because it must scale with alpha.
function toneMatrix(s, gain) {
  const L = [0.2126, 0.7152, 0.0722];
  return Float32Array.from({ length: 9 }, (_, i) => {
    const col = Math.floor(i / 3), row = i % 3;
    return gain * (L[col] * (1 - s) + (row === col ? s : 0));
  });
}

// Where the source's pixels land inside its layout box, honouring object-fit / object-position.
function fitContent(iw, ih, cw, ch, fit, position) {
  let w = cw, h = ch;
  if (fit !== 'fill') {
    const contain = Math.min(cw / iw, ch / ih);
    const scale = fit === 'contain' ? contain : fit === 'cover' ? Math.max(cw / iw, ch / ih)
      : fit === 'none' ? 1 : Math.min(1, contain);                        // scale-down
    w = iw * scale;
    h = ih * scale;
  }
  const [px = '50%', py = '50%'] = (position || '').split(' ');
  const place = (v, free) => (v.endsWith('%') ? (parseFloat(v) / 100) * free : parseFloat(v) || 0);
  return { x: place(px, cw - w), y: place(py, ch - h), w, h };
}

I.LensGL = class LensGL {
  static #supported;

  /** True when a WebGL2 context can be created. Cached after the first call. */
  static supported() {
    if (LensGL.#supported === undefined) {
      let ok = false;
      try {
        const gl = typeof WebGL2RenderingContext !== 'undefined' && document.createElement('canvas').getContext('webgl2');
        ok = !!gl;
        if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();   // free the probe context now
      } catch { /* no WebGL2 */ }
      LensGL.#supported = ok;
    }
    return LensGL.#supported;
  }

  #gl;
  #life = new AbortController();     // canvas listeners
  #sourceLife = null;                // source listeners
  #resizeObserver = null;
  #lens; #blur; #vao; #fbo;
  #srcTex; #tmpTex; #blurTex;
  #anisotropy = 0;
  #source = null;
  #cssSize = null;                   // explicit [w, h] from setSource()
  #box = null;                       // source content rect in element CSS px
  #intrinsic = [0, 0];               // source pixel size
  #sourceVersion = 0;
  #sourceDirty = false;
  #blurKey = '';
  #last = null;                      // params of the last render(), replayed on source updates
  #stale = false;
  #raf = 0;
  #frameRequest = 0;
  #cancelFrame = null;

  /** 'ok' after a successful render, 'empty' (no drawable source yet), 'tainted' or 'lost'. */
  status = 'empty';

  constructor(canvas) {
    this.canvas = canvas;
    const signal = this.#life.signal;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();                            // ask the browser to restore the context
      this.status = 'lost';
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }, { signal });
    canvas.addEventListener('webglcontextrestored', () => {
      this.#initGL();
      this.markSourceDirty();
    }, { signal });
    this.#gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (!this.#gl) throw new Error('LensGL: WebGL2 is unavailable');
    this.#initGL();
  }

  #initGL() {
    const gl = this.#gl;
    this.#lens = compileProgram(gl, LENS_SHADER);
    this.#blur = compileProgram(gl, BLUR_SHADER);
    this.#vao = gl.createVertexArray();
    this.#fbo = gl.createFramebuffer();
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    this.#anisotropy = ext ? Math.min(MAX_ANISOTROPY, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
    this.#srcTex = createTexture(gl, true, this.#anisotropy);
    this.#tmpTex = createTexture(gl, false, 0);
    this.#blurTex = createTexture(gl, true, this.#anisotropy);
    this.#blurKey = '';
    this.#sourceDirty = true;
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);   // filter and blur premultiplied values
    gl.bindVertexArray(this.#vao);

    gl.useProgram(this.#lens.program);
    const u = this.#lens.uniforms;
    gl.uniform1i(u.uTex, 0);
    gl.uniform1fv(u.uTapT, SPECTRUM.t);
    gl.uniform3fv(u.uTapW, SPECTRUM.w);
    gl.useProgram(this.#blur.program);
    gl.uniform1i(this.#blur.uniforms.uTex, 0);
  }

  /**
   * Use `el` as the lens backdrop: an HTMLCanvasElement, HTMLImageElement, HTMLVideoElement or
   * ImageBitmap. Images upload once loaded; videos re-upload on every presented frame.
   * `cssSize` ([w, h]) is the CSS size the source is shown at; it defaults to the element's layout
   * box, or 1 CSS px per pixel for sources without one (ImageBitmap).
   * Returns false when the source cannot be read (cross-origin without CORS).
   */
  setSource(el, cssSize = null) {
    this.#sourceLife?.abort();
    this.#resizeObserver?.disconnect();
    this.#cancelFrame?.();
    this.#cancelFrame = null;
    this.#source = el;
    this.#cssSize = cssSize;
    if (this.#gl && !this.#gl.isContextLost()) this.status = 'empty';
    this.#sourceLife = new AbortController();
    const signal = this.#sourceLife.signal;
    const refresh = () => { this.#measure(); this.markSourceDirty(); };

    if (typeof HTMLImageElement !== 'undefined' && el instanceof HTMLImageElement) {
      el.addEventListener('load', refresh, { signal });
    } else if (typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement) {
      for (const type of ['loadeddata', 'resize']) el.addEventListener(type, refresh, { signal });
      this.#watchVideo(el);
    }
    if (!cssSize && typeof Element !== 'undefined' && el instanceof Element && typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => this.resize());
      this.#resizeObserver.observe(el);
    }
    this.#measure();
    this.#sourceDirty = true;
    this.#blurKey = '';
    // Upload now when possible so a tainted source is reported synchronously.
    if (this.#ready() && this.#gl && !this.#gl.isContextLost()) this.#upload();
    this.#invalidate();
    return this.status !== 'tainted';
  }

  /** The source's pixels changed (e.g. an animated canvas): re-upload before the next draw. */
  markSourceDirty() {
    this.#sourceDirty = true;
    this.#invalidate();
  }

  /** The source's layout box may have changed: re-measure it and redraw if it did. */
  resize() {
    if (this.#measure()) this.#invalidate();
  }

  /**
   * Draw the lens. Params (CSS px unless noted):
   *   srcX, srcY, w, h  lens rect in the source element's CSS px (from its border-box corner)
   *   radii             number | [TL, TR, BR, BL] of number or [rx, ry]; default capsule
   *   bezel             b; default clamp(6, 0.25·min(w, h), 24)
   *   reach             D; default 0.7·b ('rim') or 0.2·b ('lens')
   *   profile           p in M(x) = (1 - x)^p; default 3
   *   optics            'rim' (samples outward, compresses) | 'lens' (samples inward, magnifies)
   *   zoom              ≥ 1, magnification of the plateau; default 1
   *   dispersion        0..1; channel split k = 0.06·dispersion; default 0
   *   k                 the channel split itself (overrides dispersion; ≥ 0), e.g. from I.lensDispersion
   *   blur              frost sigma; default 0
   *   tone              optional [saturation, gain, offset] as in toneMatrix()
   *   dpr               default devicePixelRatio, capped at 2
   * Sizes the canvas drawing buffer; its CSS size is the caller's. Returns true when drawn.
   */
  render(params) {
    this.#last = params;
    this.#stale = false;
    const gl = this.#gl;
    if (!gl || gl.isContextLost()) {
      this.status = 'lost';
      return false;
    }
    const w = +params.w, h = +params.h;
    if (!(w > 0 && h > 0)) return false;

    const dpr = Math.min(MAX_DPR, Math.max(0.5, +params.dpr || globalThis.devicePixelRatio || 1));
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== bw) this.canvas.width = bw;
    if (this.canvas.height !== bh) this.canvas.height = bh;

    if (this.#sourceDirty && this.#ready()) this.#upload();
    if (this.status === 'tainted' || !this.#srcTex.w || !this.#box) {
      if (this.status !== 'tainted') this.status = 'empty';
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, bw, bh);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return false;
    }

    const hw = w / 2, hh = h / 2;
    const corners = resolveRadii(params.radii, w, h);
    const b = Math.max(0.5, Math.min(params.bezel ?? Math.min(24, Math.max(6, 0.25 * Math.min(w, h))), hw, hh));
    const lensOptics = params.optics === 'lens';
    const reach = Math.max(0, params.reach ?? (lensOptics ? 0.2 : 0.7) * b);
    const zoom = Math.max(1, +params.zoom || 1);
    const k = params.k != null ? Math.max(0, +params.k || 0) : DISPERSION_SCALE * Math.min(1, Math.max(0, +params.dispersion || 0));
    const blur = Math.max(0, +params.blur || 0);
    const [sat = 1, gain = 1, lift = 0] = params.tone || [];
    const srcX = +params.srcX || 0, srcY = +params.srcY || 0;

    // Texture to sample and its uv mapping (element CSS px → uv).
    const box = this.#box;
    let tex = this.#srcTex, uv = [box.x, box.y, 1 / box.w, 1 / box.h];
    if (blur >= 0.25) {
      // Every sample lies within reach·(1 + k) of the lens rect (the zoom term only pulls inward).
      const margin = (lensOptics ? 0 : reach * (1 + k)) + 2;
      uv = this.#frost(blur, srcX - margin, srcY - margin, srcX + w + margin, srcY + h + margin);
      tex = this.#blurTex;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, bw, bh);
    gl.useProgram(this.#lens.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.tex);
    const u = this.#lens.uniforms;
    gl.uniform2f(u.uBuf, bw, bh);
    gl.uniform2f(u.uDpr, bw / w, bh / h);
    gl.uniform2f(u.uHalf, hw, hh);
    gl.uniform4f(u.uRx, corners[0][0], corners[1][0], corners[2][0], corners[3][0]);
    gl.uniform4f(u.uRy, corners[0][1], corners[1][1], corners[2][1], corners[3][1]);
    gl.uniform1f(u.uBezel, b);
    gl.uniform1f(u.uReach, lensOptics ? -reach : reach);
    gl.uniform1f(u.uProfile, Math.max(1, +params.profile || 3));
    gl.uniform1f(u.uZoomK, 1 - 1 / zoom);
    gl.uniform2f(u.uCentre, srcX + hw, srcY + hh);
    gl.uniform4fv(u.uUv, uv);
    gl.uniform1f(u.uK, k);
    gl.uniformMatrix3fv(u.uTone, false, toneMatrix(sat, gain));
    gl.uniform1f(u.uToneOffset, lift);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.status = 'ok';
    return true;
  }

  /** Release every GL resource, listener and callback. The instance is unusable afterwards. */
  dispose() {
    this.#life.abort();
    this.#sourceLife?.abort();
    this.#resizeObserver?.disconnect();
    this.#cancelFrame?.();
    cancelAnimationFrame(this.#raf);
    const gl = this.#gl;
    if (gl && !gl.isContextLost()) {
      gl.deleteProgram(this.#lens.program);
      gl.deleteProgram(this.#blur.program);
      gl.deleteVertexArray(this.#vao);
      gl.deleteFramebuffer(this.#fbo);
      for (const t of [this.#srcTex, this.#tmpTex, this.#blurTex]) gl.deleteTexture(t.tex);
      gl.getExtension('WEBGL_lose_context')?.loseContext();   // browsers cap live contexts (~16)
    }
    this.#gl = this.#source = this.#last = this.#cancelFrame = null;
    this.status = 'lost';
  }

  // Redraw with the last params on the next frame (coalesced; skipped if render() ran meanwhile).
  #invalidate() {
    this.#stale = true;
    if (this.#raf || !this.#last || !this.#gl) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      if (this.#stale && this.#last) this.render(this.#last);
    });
  }

  #watchVideo(video) {
    if ('requestVideoFrameCallback' in video) {
      const onFrame = () => {
        this.#frameRequest = video.requestVideoFrameCallback(onFrame);
        this.#sourceDirty = true;
        if (this.#last) this.render(this.#last);   // already inside the frame; draw now, not next frame
      };
      this.#frameRequest = video.requestVideoFrameCallback(onFrame);
      this.#cancelFrame = () => video.cancelVideoFrameCallback(this.#frameRequest);
    } else {
      let shown = -1;
      const poll = () => {
        this.#frameRequest = requestAnimationFrame(poll);
        if (video.readyState >= 2 && video.currentTime !== shown) {
          shown = video.currentTime;
          this.markSourceDirty();
        }
      };
      this.#frameRequest = requestAnimationFrame(poll);
      this.#cancelFrame = () => cancelAnimationFrame(this.#frameRequest);
    }
  }

  #pixelSize() {
    const s = this.#source;
    if (!s) return [0, 0];
    if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
    if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) return [s.naturalWidth, s.naturalHeight];
    return [s.width | 0, s.height | 0];            // canvas, OffscreenCanvas, ImageBitmap
  }

  #ready() {
    const s = this.#source, [w, h] = this.#pixelSize();
    if (!w || !h) return false;
    if (typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement) return s.readyState >= 2;
    if (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) return s.complete;
    return true;
  }

  // Layout read: the source's content rect in element CSS px (unrendered sources map 1 px : 1 px).
  // Returns true when it changed.
  #measure() {
    const old = this.#box;
    this.#box = this.#contentBox();
    const b = this.#box;
    return !old || !b || old.x !== b.x || old.y !== b.y || old.w !== b.w || old.h !== b.h;
  }

  #contentBox() {
    const s = this.#source, [iw, ih] = this.#pixelSize();
    this.#intrinsic = [iw, ih];
    if (!iw || !ih) return null;
    if (this.#cssSize) return { x: 0, y: 0, w: +this.#cssSize[0] || iw, h: +this.#cssSize[1] || ih };
    if (typeof Element === 'undefined' || !(s instanceof Element) || !s.clientWidth || !s.clientHeight) {
      return { x: 0, y: 0, w: iw, h: ih };
    }
    const cs = getComputedStyle(s), px = (v) => parseFloat(v) || 0;
    const pl = px(cs.paddingLeft), pt = px(cs.paddingTop);
    const cw = s.clientWidth - pl - px(cs.paddingRight), ch = s.clientHeight - pt - px(cs.paddingBottom);
    const box = fitContent(iw, ih, cw, ch, cs.objectFit, cs.objectPosition);
    box.x += px(cs.borderLeftWidth) + pl;
    box.y += px(cs.borderTopWidth) + pt;
    return box;
  }

  #upload() {
    const gl = this.#gl, t = this.#srcTex, [w, h] = this.#pixelSize();
    if (w !== this.#intrinsic[0] || h !== this.#intrinsic[1]) this.#measure();   // e.g. canvas.width changed
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    try {
      if (t.w === w && t.h === h) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.#source);
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.#source);
        t.w = w;
        t.h = h;
      }
    } catch (err) {
      if (err.name !== 'SecurityError') throw err;
      this.status = 'tainted';
      this.#sourceDirty = false;
      return;
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    this.#sourceDirty = false;
    this.#sourceVersion++;
  }

  // Light frost, applied before displacement as in Tier A (so rim compression sharpens it).
  // Blurs only the source region the lens can sample (x0..x1, y0..y1 in element CSS px) with a
  // separable Gaussian, and returns the uv mapping of the blurred texture.
  #frost(sigma, x0, y0, x1, y1) {
    const gl = this.#gl, box = this.#box, src = this.#srcTex;
    const sx = src.w / box.w, sy = src.h / box.h;                     // texels per CSS px
    const sgx = Math.min(sigma * sx, MAX_BLUR_RADIUS / 3), sgy = Math.min(sigma * sy, MAX_BLUR_RADIUS / 3);
    const rx = Math.ceil(3 * sgx), ry = Math.ceil(3 * sgy);
    const clampRange = (a, b, n) => {
      const lo = Math.min(n - 1, Math.max(0, Math.floor(a)));
      return [lo, Math.max(lo + 1, Math.min(n, Math.ceil(b)))];
    };
    const [tx0, tx1] = clampRange((x0 - box.x) * sx, (x1 - box.x) * sx, src.w);
    const [ty0, ty1] = clampRange((y0 - box.y) * sy, (y1 - box.y) * sy, src.h);
    const rw = tx1 - tx0, rh = ty1 - ty0;
    const key = `${this.#sourceVersion}|${tx0},${ty0},${tx1},${ty1}|${sgx},${sgy}`;

    if (key !== this.#blurKey) {
      this.#blurKey = key;
      // The horizontal pass also covers the rows the vertical pass reaches beyond the region.
      const my0 = Math.max(0, ty0 - ry), my1 = Math.min(src.h, ty1 + ry);
      gl.useProgram(this.#blur.program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
      gl.activeTexture(gl.TEXTURE0);
      const u = this.#blur.uniforms;
      const pass = (input, output, w, h, offset, dir, sig, radius) => {
        allocTexture(gl, output, w, h);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output.tex, 0);
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, input.tex);
        gl.uniform2f(u.uTexSize, input.w, input.h);
        gl.uniform2f(u.uOffset, offset[0], offset[1]);
        gl.uniform2f(u.uDir, dir[0], dir[1]);
        gl.uniform1f(u.uSigma, Math.max(sig, 1e-3));
        gl.uniform1i(u.uRadius, radius);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      pass(src, this.#tmpTex, rw, my1 - my0, [tx0, my0], [1, 0], sgx, rx);
      pass(this.#tmpTex, this.#blurTex, rw, rh, [0, ty0 - my0], [0, 1], sgy, ry);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindTexture(gl.TEXTURE_2D, this.#blurTex.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    return [box.x + tx0 / sx, box.y + ty0 / sy, sx / rw, sy / rh];
  }
};
})(); } catch (e) { console.error('[liquid-glass] comp-lens-gl.js failed', e); }
// ── comp-lens.js ────────────────────────────────────────────────────────────
try { (function () {
// <glass-lens>: a draggable magnifier (spec §4.7.10; optics §3.4, §3.6; stretch §5.3).
//
// The host is registered glass that draws its own Tier A backdrop (customBackdrop): the core
// renders its shadow, highlight overlay, focus ring, frost and accessibility tiers, and ranks it in
// the refraction budget like any glass. The lens supplies the optics:
//   'a'  the core's backdrop layer runs the lens's filter: a zoom field inside a refracting rim,
//        from the core's lens maps. The colour split ramps from 0 on the plateau to k at the rim,
//        so the magnified centre stays sharp: k = 0.06 · dispersion (fading out toward pure clear
//        with the frost, and taking one of the core's automatic dispersion slots), or the page-wide
//        dispersion (--glass-dispersion, setPreferences) where that is stronger (I.lensDispersion).
//   'w'  I.LensGL in a canvas over the canvas, video or CORS-clean image named by source=, when
//        Tier A is unavailable, and always for a video. The canvas paints between the core's
//        ::before and ::after, which share its z-index of −1.
//   'b'  the core's frosted glass;  'c'  an empty loupe ring (it cannot magnify);  'none'  identity.
// The lens moves on its own transform channel, so nothing is rebuilt while it moves.

const LENS = {
  size: 140, zoom: 1.5, dispersion: 0.8,
  // The zoom samples the backdrop nearest-neighbour: a light pre-blur (px) evens out its pixel
  // doubling, the smoothing after the displacement (device px) its stair-steps and the rim's
  // compression. More of either frosts the magnified text.
  sigma: 0.25,
  smooth: 0.6,
  fill: 0.04,   // white fill of clear, lifted glass
  glow: 0.5,    // touch glow while held: half a control's, so the magnified content stays clear
  step: 10, stepLarge: 40,
};
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// Core tier reasons of a lens the budget pass has not placed yet: it shows frost meanwhile.
const UNPLACED = new Set(['pending', 'offscreen']);
const ATTRIBUTES = ['size', 'zoom', 'dispersion', 'source', 'live', 'tabindex'];
const lenses = new WeakMap(); // <glass-lens> → Lens

/**
 * toneClear with the lens's white fill folded in: c·(1 − f) + f. Toward the clear end of the
 * "Clear ↔ Tinted" preference both fade out, to an identity matrix at pure clear.
 */
function lensTone() {
  const keep = I.clearKeep(), [s, gain, offset] = I.defaults.toneClear.map((v, i) => I.lerp([1, 1, 0][i], v, keep)), f = LENS.fill * keep;
  return [s, gain * (1 - f), offset * (1 - f) + f];
}
/** The pre-blur (it evens out the zoom's pixel doubling), gone at pure clear. */
const lensSigma = () => LENS.sigma * I.clearKeep();

/** The canvas, image or video named by a source= selector, or null. */
function resolveSource(selector) {
  if (!selector) return null;
  let el = null;
  try { el = document.querySelector(selector); } catch { return null; } // not a valid selector
  return el instanceof HTMLCanvasElement || el instanceof HTMLImageElement || el instanceof HTMLVideoElement ? el : null;
}

/** iOS-style rubber band: resistance grows with the overshoot and never exceeds `dim`. */
function rubber(v, lo, hi, dim) {
  const band = (d) => (1 - 1 / ((d * 0.55) / dim + 1)) * dim;
  return v < lo ? lo - band(lo - v) : v > hi ? hi + band(v - hi) : v;
}

const snapToDevice = (v) => Math.round(v * I.caps.dpr) / I.caps.dpr;

class Lens {
  constructor(el, { handle, signal }) {
    this.el = el;
    this.ownsHandle = !handle;
    this.read();
    this.h = I.register(el, { customBackdrop: true });
    this.tier = null;          // rendered: 'a' | 'w' | 'b' | 'c' | 'none'
    this.maps = null;          // Tier A: the core's lens maps (a cache entry)
    this.mapKey = null;        // what they were, or are being, built for
    this.filter = null;        // Tier A: the lens filter
    this.backdrop = null;      // what the core's backdrop layer was handed (I.setBackdrop)
    this.videoDefault = false; // tier 'b' set as a default while W renders a video
    this.drag = null;
    this.ownAttrs = new Set(); // attributes this lens added to the host
    this.restTransform = el.style.transform;
    this.baseTransform = '';
    const moved = () => this.queueWrite();
    this.pos = { x: new I.Spring({ preset: 'lift', onUpdate: moved }), y: new I.Spring({ preset: 'lift', onUpdate: moved }) };
    this.grab = new I.Spring({ value: 1, preset: 'lift', onUpdate: moved });
    this.stretch = new I.Stretch({ axis: 'free', onUpdate: (m, e) => this.writeStretch(m, e) });
    this.unobserve = I.observeResize(el, () => this.onResize());

    const on = (target, type, fn, opts) => target.addEventListener(type, fn, { signal, ...opts });
    on(el, 'pointerdown', (e) => this.onPointerDown(e));
    on(el, 'pointermove', (e) => this.onPointerMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(el, type, (e) => this.onPointerUp(e));
    on(el, 'keydown', (e) => this.onKeyDown(e));
    // Tier changes and dispersion slots (granted by a later budget pass, too) change the filter.
    for (const type of ['glass:tier', 'glass:dispersion']) on(el, type, (e) => { if (e.target === el) this.queueUpdate(); });
    // "Clear ↔ Tinted" and the page-wide dispersion: the filter (or the WebGL render) follows in
    // place. Nothing moved, so nothing is measured (a layout read per slider step otherwise).
    this.offPrefs = I.onPreferences(() => { if (!this.dead) this.render({ measure: false }); });
    on(window, 'scroll', () => this.onScroll(), { capture: true, passive: true });

    this.syncAria();
    this.render();
  }

  // ── State ────────────────────────────────────────────────────────────────
  /** Reads the lens's own attributes. */
  read() {
    const el = this.el, attr = (n) => el.getAttribute(n);
    const size = I.toNumber(attr('size'), 0);
    I.setVar(el, '--glass-lens-size', size > 0 ? `${size}px` : null);
    this.zoom = I.clamp(I.toNumber(attr('zoom'), LENS.zoom), 1, 4);
    this.dispersion = I.clamp(I.toNumber(attr('dispersion'), LENS.dispersion), 0, 1);
    this.live = el.hasAttribute('live');
    const source = resolveSource(attr('source'));
    if (source !== this.source) this.failedSource = null;
    this.source = source;
  }

  /** Re-reads the attributes and the environment, then renders the matching tier. */
  update() {
    this.read();
    this.render();
  }

  queueUpdate() {
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => { this.updateQueued = false; if (!this.dead) this.update(); });
  }

  /** `measure: false` reuses the lens's last position over its source (Tier W). */
  render({ measure = true } = {}) {
    this.syncDispersion();
    let tier = this.pickTier();
    if (tier === 'w' && !this.syncW({ measure })) tier = this.pickTier(); // the source is now excluded
    if (tier !== 'w') this.dropW();
    // A video is always rendered by WebGL: meanwhile the lens takes no refraction slot.
    this.setVideoDefault(tier === 'w' && this.source instanceof HTMLVideoElement);
    // The maps are kept while the lens could refract, so an admission to Tier A applies at once.
    if (this.h.staticTier === 'a' && !this.failed) this.requestMaps(); else this.dropMaps();
    if (tier === 'a' && !this.maps) tier = 'b'; // frosted until the maps are in
    this.tier = tier;
    I.setAttr(this.el, 'data-lgc-tier', tier);
    this.writeBackdrop();
  }

  pickTier() {
    const h = this.h, t = h.tier;
    if (t === 'c' || t === 'none') return t;
    const src = this.source, webgl = !!src && src !== this.failedSource && I.LensGL.supported();
    if (webgl && src instanceof HTMLVideoElement) return 'w';
    if (t === 'a' && !this.failed) return 'a';
    return webgl && !UNPLACED.has(h.tierReason) ? 'w' : 'b';
  }

  /**
   * The lens's split: its own (k = 0.06 · dispersion, fading toward pure clear) or the page-wide
   * one where stronger. The maps bake `kBuild` (constant while either preference is dragged, so
   * neither rebuilds them) and the filter shows the share k / kBuild. A split below half a pixel at
   * the rim is invisible, and the maps are built without it. The lens's own split is automatic: it
   * takes one of the core's capped slots (`autoDispersion`), like a lifted lens's; page-wide
   * dispersion (handle.o.dispersion) is asked for and uncapped.
   */
  syncDispersion() {
    const d = this.h.d;
    if (!d) return;
    const reach = I.defaults.kReach * d.b;
    const { k, build } = I.lensDispersion(this.h, this.dispersion, this.h.o.pageDispersion);
    const visible = build * reach >= 0.5;
    this.k = visible ? k : 0;
    this.kBuild = visible ? build : 0;
    const own = I.DISPERSION_LENS * this.dispersion * reach >= 0.5 ? this.dispersion : 0;
    if (own !== this.h.o.autoDispersion) this.h.update({ autoDispersion: own });
  }

  setVideoDefault(on) {
    if (on === this.videoDefault) return;
    this.videoDefault = on;
    this.h.setDefaults({ tier: on ? 'b' : undefined });
  }

  // ── Tier A: the lens filter on the core's backdrop layer ──────────────────
  requestMaps() {
    const g = this.h.geom, d = this.h.d;
    if (!g || !d || g.w < 1 || g.h < 1) return;
    const geom = { w: g.w, h: g.h, corners: g.corners };
    const opts = { b: d.b, D: I.defaults.kReach * d.b, p: this.h.o.profile, zoom: this.zoom, k: this.kBuild || 0, mapScale: I.mapScaleFor((g.w + 4) * (g.h + 4), I.caps.dpr) };
    const key = JSON.stringify([geom, opts]);
    if (key === this.mapKey) return;
    this.mapKey = key;
    // Built at once for a lens on screen (admission follows within a microtask), else when idle.
    I.acquireLensMap(geom, opts, this.h.tier === 'a' || this.h.visible).then((entry) => {
      if (this.dead || this.mapKey !== key) { I.releaseMap(entry); return; }
      I.releaseMap(this.maps);
      this.maps = entry; // null once the library is destroyed
      this.render();
    }, () => {
      if (this.mapKey !== key) return;
      this.failed = true; // no canvas encoder: frost, or W over a source
      this.render();
    });
  }

  dropMaps() {
    this.mapKey = null;
    I.releaseMap(this.maps);
    this.maps = null;
  }

  /**
   * What the core's backdrop layer runs in Tier A: the lens filter, frost while the maps are being
   * built, or nothing under a WebGL canvas. Written only when it changes.
   */
  writeBackdrop() {
    const h = this.h, d = h.d, old = this.filter;
    let next = null;
    if (this.tier === 'a') next = this.lensFilter();
    else if (this.tier === 'b' && h.tier === 'a' && d) next = { filter: I.frostLiteral(d.sigmaB, d.sat, d.bright), over: 0 };
    if (next?.filter !== this.backdrop?.filter || next?.over !== this.backdrop?.over) {
      this.backdrop = next;
      I.setBackdrop(h, next);
    }
    if (this.tier !== 'a') this.filter = null;
    if (old && old !== this.filter) old.destroy(); // only once the layer no longer points at it
  }

  /** The lens filter for the current maps, stretched to the current size until they are rebuilt (§3.11). */
  lensFilter() {
    const g = this.h.geom, d = this.h.d, e = this.maps, m = e.meta;
    const split = m.tiles === 4 && this.h.dispersing && this.k > 0; // the core counts the lens as dispersing
    // Overscan holds the farthest outward sample (the rim, dispersed) plus the blur kernel (§3.1).
    const over = Math.ceil(I.defaults.kReach * d.b * (1 + (split ? this.kBuild : 0)) + 2 * LENS.sigma + 1);
    const sx = g.w / (m.Wc - 2 * m.marginX), sy = g.h / (m.Hc - 2 * m.marginY);
    const spec = {
      width: g.w + 2 * over, height: g.h + 2 * over, blur: lensSigma(), enc: 'g2', tone: lensTone(),
      map: { href: e.url, href2: split ? e.urls[1] : null, tiles: split ? 4 : 2, x: over - m.marginX * sx, y: over - m.marginY * sy, width: m.Wc * sx, height: m.Hc * sy, scale: m.scale },
      dispersion: split ? Math.min(1, this.k / this.kBuild) : 0, smooth: LENS.smooth / I.caps.dpr,
    };
    if (this.filter?.structure === I.filterStructure(spec)) this.filter.set(spec);
    else this.filter = I.createFilter(spec);
    return { filter: this.filter.url, over };
  }

  // ── Tier W: WebGL over a known source ────────────────────────────────────
  /** Renders the source through I.LensGL; false when it cannot (no WebGL2, tainted source). */
  syncW({ measure = true } = {}) {
    const src = this.source;
    if (!this.gl) {
      const canvas = document.createElement('canvas');
      canvas.className = 'glass-lens-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      try { this.gl = new I.LensGL(canvas); } catch { this.failedSource = src; return false; }
      this.canvas = canvas;
      this.el.prepend(canvas);
    }
    if (this.glSource !== src) {
      this.glSource = src;
      if (!this.gl.setSource(src)) { this.failedSource = src; return false; }
    }
    if (measure || !this.rel) this.measureW();
    this.renderW();
    if (this.live && !this.liveOff) this.liveOff = I.onFrame(() => { this.gl.markSourceDirty(); this.renderW(); });
    else if (!this.live && this.liveOff) { this.liveOff(); this.liveOff = null; }
    return true;
  }

  /** The lens centre in the source's CSS px, less our translate (stretch and press are centred). */
  measureW() {
    const r = this.el.getBoundingClientRect(), s = this.source.getBoundingClientRect();
    this.rel = { x: r.left + r.width / 2 - this.pos.x.value - s.left, y: r.top + r.height / 2 - this.pos.y.value - s.top };
  }

  renderW() {
    const g = this.h.geom, d = this.h.d;
    if (!this.gl || !this.rel || !g || !d) return;
    const cx = this.rel.x + this.pos.x.value, cy = this.rel.y + this.pos.y.value;
    this.gl.render({
      srcX: cx - g.w / 2, srcY: cy - g.h / 2, w: g.w, h: g.h, radii: g.corners, bezel: d.b, reach: I.defaults.kReach * d.b,
      profile: this.h.o.profile, zoom: this.zoom, k: this.k ?? I.DISPERSION_LENS * this.dispersion, blur: lensSigma(), tone: lensTone(), dpr: I.caps.dpr,
    });
    if (this.gl.status === 'tainted') { this.failedSource = this.source; this.queueUpdate(); }
  }

  /** One render on the next frame (layout changes, scrolling). */
  scheduleW() {
    if (this.frameOff) return;
    this.frameOff = I.onFrame(() => {
      this.frameOff();
      this.frameOff = null;
      if (this.tier !== 'w') return;
      if (this.remeasure) { this.remeasure = false; this.measureW(); }
      this.renderW();
    });
  }

  dropW() {
    this.liveOff?.();
    this.frameOff?.();
    this.liveOff = this.frameOff = null;
    this.gl?.dispose();
    this.canvas?.remove();
    this.gl = this.canvas = this.glSource = null;
  }

  // ── Position and stretch ─────────────────────────────────────────────────
  /** Moves to an offset (px) from the laid-out position, clamped to the containing block. */
  moveTo(x, y, { animate = true } = {}) {
    const b = this.bounds();
    x = snapToDevice(I.clamp(x, b.x0, b.x1));
    y = snapToDevice(I.clamp(y, b.y0, b.y1));
    this.captureBaseTransform();
    if (animate) { this.pos.x.to(x, { preset: 'snappy' }); this.pos.y.to(y, { preset: 'snappy' }); }
    else { this.pos.x.jump(x); this.pos.y.jump(y); }
  }

  /** Allowed translate range: the lens stays inside its offsetParent's padding box (or the viewport). */
  bounds() {
    const el = this.el, r = el.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    const left = r.left + (r.width - w) / 2 - this.pos.x.value, top = r.top + (r.height - h) / 2 - this.pos.y.value;
    const op = el.offsetParent, html = document.documentElement;
    let box = { l: 0, t: 0, r: html.clientWidth, b: html.clientHeight };
    if (op && op !== document.body && op !== html) {
      const o = op.getBoundingClientRect(), l = o.left + op.clientLeft, t = o.top + op.clientTop;
      box = { l, t, r: l + op.clientWidth, b: t + op.clientHeight };
    }
    const range = (lo, hi) => (lo <= hi ? [lo, hi] : [hi, lo]); // a lens larger than its box may cover it
    const [x0, x1] = range(box.l - left, box.r - left - w), [y0, y1] = range(box.t - top, box.b - top - h);
    return { x0, x1, y0, y1, w, h };
  }

  /** Coalesces the springs' updates into one write per frame. */
  queueWrite() {
    if (this.writeQueued) return;
    this.writeQueued = true;
    queueMicrotask(() => {
      this.writeQueued = false;
      if (this.dead) return;
      const g = this.grab.value;
      I.setChannel(this.h, 'lens', { sx: g, sy: g, tx: this.pos.x.value, ty: this.pos.y.value });
      this.stretch.update(this.pos.x.velocity, this.pos.y.velocity);
      if (this.tier === 'w') this.renderW();
    });
  }

  /** The author's own transform (e.g. a centring translate) is kept, applied after the stretch. */
  captureBaseTransform() {
    if (this.el.style.transform !== this.restTransform) return; // mid-stretch: keep the captured base
    const t = getComputedStyle(this.el).transform;
    this.baseTransform = t === 'none' ? '' : t;
  }

  writeStretch(m, e) {
    this.el.style.transform = e > 1e-4 ? `${this.baseTransform} ${m.transform}`.trim() : this.restTransform;
  }

  // ── Input ────────────────────────────────────────────────────────────────
  onPointerDown(e) {
    if (e.button !== 0 || !e.isPrimary || this.drag) return;
    const el = this.el;
    try { el.setPointerCapture(e.pointerId); } catch { /* detached mid-event */ }
    this.captureBaseTransform();
    const b = this.bounds(), r = el.getBoundingClientRect();
    this.drag = { id: e.pointerId, px: e.clientX, py: e.clientY, x: this.pos.x.target, y: this.pos.y.target, bounds: b, release: I.hold(this.h) };
    el.setAttribute('data-lgc-dragging', '');
    // Grab: the press scale of a control this size, and a touch glow at the finger (§5.2).
    if (!I.reducedMotion()) {
      el.style.willChange = 'transform';
      this.grab.to(I.press.scaleFor(b.w, b.h), { preset: 'lift' });
    }
    I.glow(this.h, { x: (e.clientX - r.left) * (b.w / r.width), y: (e.clientY - r.top) * (b.h / r.height), amount: LENS.glow, radius: 0.75 * Math.hypot(b.w, b.h) });
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const b = d.bounds;
    const x = rubber(d.x + e.clientX - d.px, b.x0, b.x1, b.w), y = rubber(d.y + e.clientY - d.py, b.y0, b.y1, b.h);
    if (I.reducedMotion()) { this.pos.x.jump(x); this.pos.y.jump(y); } // direct manipulation, no follow lag
    else { this.pos.x.to(x, { preset: 'lift' }); this.pos.y.to(y, { preset: 'lift' }); }
  }

  onPointerUp(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    d.release();
    this.el.removeAttribute('data-lgc-dragging');
    I.glow(this.h, { amount: 0, preset: 'unlift' });
    this.grab.to(1, { preset: 'unlift' }).then(() => { if (!this.drag && !this.dead) this.el.style.removeProperty('will-change'); });
    const b = d.bounds;
    this.pos.x.to(snapToDevice(I.clamp(this.pos.x.target, b.x0, b.x1)), { preset: 'unlift' });
    this.pos.y.to(snapToDevice(I.clamp(this.pos.y.target, b.y0, b.y1)), { preset: 'unlift' });
  }

  onKeyDown(e) {
    const dir = ARROWS[e.key];
    if (!dir || e.target !== this.el || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const step = e.shiftKey ? LENS.stepLarge : LENS.step;
    this.moveTo(this.pos.x.target + dir[0] * step, this.pos.y.target + dir[1] * step);
  }

  onResize() {
    if (this.dead) return;
    if (this.tier === 'w') { this.measureW(); this.renderW(); }
    if (!this.mapKey) { this.render(); return; } // first size (it was hidden)
    this.writeBackdrop(); // the old maps, stretched to the new size
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.render(), 120);
  }

  onScroll() {
    if (this.tier !== 'w') return;
    this.remeasure = true; // the lens and its source may scroll independently
    this.scheduleW();
  }

  // ── Accessibility (§6.1.9): decorative unless keyboard-operable ──────────
  syncAria() {
    const el = this.el, focusable = el.hasAttribute('tabindex');
    const authored = (n) => el.hasAttribute(n) && !this.ownAttrs.has(n);
    this.ownAttr('aria-hidden', focusable ? null : 'true');
    this.ownAttr('role', focusable && !authored('role') ? 'group' : null);
    this.ownAttr('aria-label', focusable && !authored('aria-label') && !authored('aria-labelledby') ? 'Magnifier' : null);
  }

  /** Sets (or removes) an attribute this lens manages; never touches one the author wrote. */
  ownAttr(name, value) {
    if (value == null) {
      if (this.ownAttrs.delete(name)) this.el.removeAttribute(name);
    } else if (this.ownAttrs.has(name) || !this.el.hasAttribute(name)) {
      this.ownAttrs.add(name);
      this.el.setAttribute(name, value);
    }
  }

  attributeChanged(name) {
    if (name === 'tabindex') this.syncAria();
    else this.queueUpdate();
  }

  /** Re-reads everything, including the source's pixels (for a canvas redrawn without `live`). */
  refresh() {
    if (this.gl) { this.gl.markSourceDirty(); this.remeasure = true; }
    this.update();
    if (this.tier === 'w') this.scheduleW();
  }

  destroy() {
    this.dead = true;
    this.offPrefs();
    lenses.delete(this.el);
    this.unobserve();
    clearTimeout(this.resizeTimer);
    this.drag?.release();
    this.drag = null;
    for (const spring of [this.pos.x, this.pos.y, this.grab]) spring.stop();
    this.stretch.stop();
    this.dropW();
    this.dropMaps();
    const el = this.el;
    el.style.transform = this.restTransform;
    el.style.removeProperty('will-change');
    I.clearChannel(this.h, 'lens');
    for (const name of this.ownAttrs) el.removeAttribute(name);
    for (const name of ['data-lgc-tier', 'data-lgc-dragging']) el.removeAttribute(name);
    I.setVar(el, '--glass-lens-size', null);
    if (this.ownsHandle) this.h.destroy();
    else {
      I.setBackdrop(this.h, null);
      this.h.setDefaults({ tier: undefined });
      this.h.update({ customBackdrop: undefined, autoDispersion: undefined });
    }
    this.filter?.destroy(); // after the core's layer stopped pointing at it
  }
}

/** Defines the <glass-lens> element: reflected attributes plus a small positioning API. */
function defineLensElement() {
  if (typeof customElements === 'undefined' || customElements.get('glass-lens')) return;
  class GlassLensElement extends HTMLElement {
    /** The rendered tier: 'a' (live refraction), 'w' (WebGL over the source), 'b' (frost), 'c', 'none'. */
    get tier() { return this.getAttribute('data-lgc-tier'); }
    /** Current offset (px) from the laid-out position. */
    get x() { return lenses.get(this)?.pos.x.target ?? 0; }
    get y() { return lenses.get(this)?.pos.y.target ?? 0; }
    /** Moves to an offset from the laid-out position, clamped to the containing block. */
    moveTo(x, y, options) { lenses.get(this)?.moveTo(x, y, options); }
    moveBy(dx, dy, options) { this.moveTo(this.x + dx, this.y + dy, options); }
    /** Re-reads the attributes, layout and source pixels (e.g. after redrawing a canvas source). */
    refresh() { lenses.get(this)?.refresh(); }
  }
  const reflect = (name, fallback) => Object.defineProperty(GlassLensElement.prototype, name, {
    get() { return typeof fallback === 'number' ? I.toNumber(this.getAttribute(name), fallback) : this.getAttribute(name); },
    set(v) { if (v == null) this.removeAttribute(name); else this.setAttribute(name, String(v)); },
  });
  reflect('size', LENS.size);
  reflect('zoom', LENS.zoom);
  reflect('dispersion', LENS.dispersion);
  reflect('source', null);
  Object.defineProperty(GlassLensElement.prototype, 'live', {
    get() { return this.hasAttribute('live'); },
    set(v) { this.toggleAttribute('live', !!v); },
  });
  customElements.define('glass-lens', GlassLensElement);
}

I.defineComponent('lens', {
  selector: 'glass-lens',
  attributes: ATTRIBUTES,
  setup(el, ctx) {
    defineLensElement();
    const lens = new Lens(el, ctx);
    lenses.set(el, lens);
    return { destroy: () => lens.destroy(), refresh: () => lens.update(), attributeChanged: (name) => lens.attributeChanged(name) };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-lens.js failed', e); }
}],
["menu", function (I, LG) {
'use strict';
// ── comp-menu.js ────────────────────────────────────────────────────────────
try { (function () {
// Menu / popover (§4.7.8, §5.9, I7). A [popover].glass-menu springs out of its invoker: it
// materializes from scale .6 about the invoker's centre on the unlift spring and shrinks back into
// it on close. Placement uses CSS anchor positioning where supported (the anchor is named here on
// beforetoggle) and is computed here otherwise. With role="menu" it also gets roving focus
// (arrows, Home/End, typeahead), closes on Tab or when an item is activated, and hands focus back
// to the invoker. Light dismiss and Esc stay native.
//
// Timing: beforetoggle fires while the popover is still hidden, so the materialize starts there,
// from the invoker (the core measures the popover on its first frame). JS placement and initial
// focus follow in the first animation frame, which runs before the popover's first paint; a JS
// placement then re-aims the scale origin.

const ITEM = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const GAP = 6;       // invoker → menu (matches the CSS margin)
const EDGE = 8;      // minimum distance from the viewport edge
const EXIT_MS = 450; // the CSS keeps a closing popover rendered for 400 ms
const TYPEAHEAD_MS = 500;

const supportsAnchors = () => CSS.supports('position-area: block-end') && CSS.supports('anchor-name: --a');

I.defineComponent('menu', {
  selector: '.glass-menu[popover]',
  setup(el, { handle, signal }) {
    const h = handle || I.register(el);
    const ownHandle = !handle;
    const isMenu = () => el.getAttribute('role') === 'menu';

    let invoker = null;
    let anchor = null;      // { el, name, added }: the anchor-name this menu is positioned against
    let placed = null;      // author inline styles replaced by JS placement
    let frame = 0, exitTimer = 0, openPending = false, focusWasInside = false;
    let lastPress = null;   // { el, t }: Safari does not focus buttons on click
    const tabindexes = new Map(); // item → author tabindex attribute (null = none)
    let typed = '', typedAt = 0;

    const items = () => [...el.querySelectorAll(ITEM)].filter((i) => !i.disabled && !i.closest('[hidden]') && i.closest('[popover]') === el);

    function findInvoker(e) {
      if (e.source instanceof Element) return e.source;
      if (!el.id) return null;
      const sel = `[popovertarget="${CSS.escape(el.id)}"], [commandfor="${CSS.escape(el.id)}"]`;
      const recent = lastPress && performance.now() - lastPress.t < 1500 ? lastPress.el : null;
      return document.activeElement?.closest?.(sel) || recent?.closest?.(sel) || document.querySelector(sel);
    }

    // ── Placement ──────────────────────────────────────────────────────────
    function nameAnchor(inv) {
      const current = getComputedStyle(inv).anchorName;
      let name, added = false;
      if (current && current !== 'none') name = current.split(',')[0].trim();
      else { name = `--${I.uniqueId('lg-menu-')}`; inv.style.setProperty('anchor-name', name); added = true; }
      el.style.setProperty('position-anchor', name);
      anchor = { el: inv, name, added };
    }
    function releaseAnchor() {
      if (!anchor) return;
      if (anchor.added && anchor.el.style.getPropertyValue('anchor-name') === anchor.name) anchor.el.style.removeProperty('anchor-name');
      el.style.removeProperty('position-anchor');
      anchor = null;
    }

    /** JS placement (no anchor positioning, or no invoker): the same rules as the CSS. */
    function place() {
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const w = el.offsetWidth, hh = el.offsetHeight;
      let left = (vw - w) / 2, top = (vh - hh) / 2;
      if (invoker?.isConnected) {
        // Untransformed, like anchor positioning's box: a glass invoker may still be mid-press.
        const r = I.layoutRect(invoker), rtl = getComputedStyle(el).direction === 'rtl';
        const start = rtl ? r.right - w : r.left, end = rtl ? r.left : r.right - w;
        left = start >= EDGE && start + w <= vw - EDGE ? start : end;
        if (el.getAttribute('data-glass-placement') === 'cover') top = r.top + hh <= vh - EDGE ? r.top : r.bottom - hh;
        else top = r.bottom + GAP + hh <= vh - EDGE ? r.bottom + GAP : r.top - GAP - hh;
      }
      placed ||= { inset: el.style.inset, margin: el.style.margin, left: el.style.left, top: el.style.top };
      Object.assign(el.style, {
        inset: 'auto', margin: '0',
        left: `${I.fmt(I.clamp(left, EDGE, Math.max(EDGE, vw - EDGE - w)), 1)}px`,
        top: `${I.fmt(I.clamp(top, EDGE, Math.max(EDGE, vh - EDGE - hh)), 1)}px`,
      });
    }
    function unplace() {
      if (placed) Object.assign(el.style, placed);
      placed = null;
    }
    const replace = () => { if (placed && el.matches(':popover-open')) place(); };

    // ── Focus ──────────────────────────────────────────────────────────────
    function rove(item) {
      for (const i of items()) {
        if (!tabindexes.has(i)) tabindexes.set(i, i.getAttribute('tabindex'));
        i.setAttribute('tabindex', i === item ? '0' : '-1');
      }
      item.focus({ preventScroll: true });
    }
    function restoreTabindexes() {
      for (const [i, v] of tabindexes) I.setAttr(i, 'tabindex', v);
      tabindexes.clear();
    }

    function typeahead(ch, list, current) {
      const now = performance.now();
      typed = now - typedAt > TYPEAHEAD_MS ? ch : typed + ch;
      typedAt = now;
      const start = typed.length === 1 ? list.indexOf(current) + 1 : Math.max(0, list.indexOf(current));
      for (let k = 0; k < list.length; k++) {
        const item = list[(start + k) % list.length];
        if (item.textContent.trim().toLowerCase().startsWith(typed)) return rove(item);
      }
    }

    // ── Open / close ───────────────────────────────────────────────────────
    function opening(e) {
      clearTimeout(exitTimer);
      releaseAnchor();
      unplace();
      invoker = findInvoker(e);
      if (invoker && supportsAnchors()) nameAnchor(invoker);
      I.materialize(h, { from: invoker || undefined, scale: 0.6, spring: 'unlift' });
      openPending = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(opened);
    }

    /** First frame of an open popover (or its toggle event, whichever comes first). */
    function opened() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (!openPending || !el.matches(':popover-open')) return;
      openPending = false;
      if (!anchor) {
        place();
        if (invoker?.isConnected) I.setMaterializeOrigin(h, invoker);
        addEventListener('scroll', replace, { capture: true, passive: true, signal });
        addEventListener('resize', replace, { passive: true, signal });
      }
      if (isMenu() && !el.contains(document.activeElement)) {
        const list = items();
        if (list.length) rove(list.find((i) => i.hasAttribute('autofocus')) || list[0]);
      }
    }

    function closing() {
      cancelAnimationFrame(frame);
      frame = 0;
      openPending = false;
      focusWasInside = el.contains(document.activeElement);
      I.dematerialize(h, { to: invoker?.isConnected ? invoker : undefined, scale: 0.6, spring: 'snappy' });
      removeEventListener('scroll', replace, { capture: true });
      removeEventListener('resize', replace);
      // Keep the anchor and placement until the exit transition has finished.
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => { releaseAnchor(); unplace(); }, EXIT_MS);
    }

    function closed() {
      // The UA returns focus to the invoker; make sure it never falls to <body>.
      const lost = !document.activeElement || document.activeElement === document.body;
      if (focusWasInside && lost && invoker?.isConnected) invoker.focus({ preventScroll: true });
      focusWasInside = false;
    }

    // ── Events ─────────────────────────────────────────────────────────────
    document.addEventListener('pointerdown', (e) => { lastPress = { el: e.target, t: performance.now() }; }, { capture: true, passive: true, signal });
    el.addEventListener('beforetoggle', (e) => (e.newState === 'open' ? opening(e) : closing()), { signal });
    el.addEventListener('toggle', (e) => (e.newState === 'open' ? opened() : closed()), { signal });

    el.addEventListener('keydown', (e) => {
      if (!isMenu() || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const list = items(), n = list.length;
      if (!n) return;
      const current = e.target.closest(ITEM), i = list.indexOf(current);
      switch (e.key) {
        case 'ArrowDown': rove(list[(i + 1) % n]); break;
        case 'ArrowUp': rove(list[i <= 0 ? n - 1 : i - 1]); break;
        case 'Home': case 'PageUp': rove(list[0]); break;
        case 'End': case 'PageDown': rove(list[n - 1]); break;
        case 'Tab':
          // Close and let the Tab itself move on from the invoker, as in the ARIA menu pattern.
          invoker?.focus({ preventScroll: true });
          el.hidePopover();
          return;
        case 'Enter': case ' ':
          if (!current || current.matches('button, input, summary') || (e.key === 'Enter' && current.matches('a[href]'))) return;
          current.click();
          break;
        default:
          if (e.key.length !== 1 || e.key === ' ') return;
          typeahead(e.key.toLowerCase(), list, current);
      }
      e.preventDefault();
    }, { signal });

    // Hovering an item focuses it (as in native menus), so arrows continue from there.
    el.addEventListener('pointermove', (e) => {
      if (!isMenu() || e.pointerType !== 'mouse') return;
      const item = e.target.closest(ITEM);
      if (item && item !== document.activeElement && items().includes(item)) rove(item);
    }, { signal });

    // An aria-disabled item is inert, like a disabled button: its click reaches no handler.
    el.addEventListener('click', (e) => {
      if (e.target.closest(ITEM)?.getAttribute('aria-disabled') !== 'true') return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true, signal });
    // Activating an item closes the menu (unless the page prevented the click).
    el.addEventListener('click', (e) => {
      if (!e.target.closest(ITEM) || e.defaultPrevented || !el.matches(':popover-open')) return;
      el.hidePopover();
    }, { signal });

    return {
      destroy() {
        cancelAnimationFrame(frame);
        clearTimeout(exitTimer);
        releaseAnchor();
        unplace();
        restoreTabindexes();
        el.style.removeProperty('transform-origin');
        if (ownHandle) h.destroy();
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-menu.js failed', e); }
}],
["scroll-edge", function (I, LG) {
'use strict';
// ── comp-scroll-edge.js ─────────────────────────────────────────────────────
try { (function () {
// Scroll edge effect (§4.7.9, I9). The CSS draws the band; this partial adds the third soft blur
// layer, sizes the band to its bar (bar extent + 20 px, the RE pocket overlap) and mirrors the
// bar's tone into data-lgc-tone so the band dims under dark-tone bars (an author's data-tone
// applies while there is no bar).
//
// The bar is the element whose id is in data-glass-bar, otherwise the first bar-like sibling
// (or sibling's descendant) pinned to the same edge. A bar that mounts later is found when its
// glass announces itself (glass:tone, glass:ready).

const OVERLAP = 20;
const BAR_SELECTOR = '.glass-bar, .glass-toolbar, .glass-tabbar, .glass-search, .glass';

function findBar(el, edge) {
  const id = el.getAttribute('data-glass-bar');
  if (id) return document.getElementById(id);
  const candidates = [];
  for (const sib of el.parentElement?.children || []) {
    if (sib === el) continue;
    if (sib.matches(BAR_SELECTOR)) candidates.push(sib);
    else candidates.push(...sib.querySelectorAll(BAR_SELECTOR));
  }
  const band = el.getBoundingClientRect();
  const nearEdge = (r) => (edge === 'bottom' ? band.bottom - r.bottom : r.top - band.top);
  let best = null, bestGap = Infinity;
  for (const c of candidates) {
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const gap = nearEdge(r);
    if (gap >= -1 && gap < bestGap && gap < 200) { best = c; bestGap = gap; }
  }
  return best;
}

/** The first opaque background behind the band (its container, else the page), or null. */
function backgroundColour(el) {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) continue;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 4 || parts[3] >= 0.99) return c;
  }
  return null;
}

I.defineComponent('scroll-edge', {
  selector: '.glass-scroll-edge',
  setup(el, { signal }) {
    const edge = () => (el.getAttribute('data-edge') === 'bottom' ? 'bottom' : 'top');
    const layer = I.part(el, 'glass-scroll-edge-layer');
    const addedHidden = !el.hasAttribute('aria-hidden');
    if (addedHidden) el.setAttribute('aria-hidden', 'true');

    let bar = null, toneSource = null, unobserve = null;

    function measure() {
      if (!bar?.isConnected) return;
      const b = bar.getBoundingClientRect(), band = el.getBoundingClientRect();
      const extent = edge() === 'bottom' ? band.bottom - b.top : b.bottom - band.top;
      I.setVar(el, '--_lgc-edge-size', extent > 0 ? `${I.fmt(extent + OVERLAP, 1)}px` : null);
    }

    function syncTone() {
      I.setAttr(el, 'data-lgc-tone', toneSource?.getAttribute('data-lg-tone'));
    }

    function attach() {
      unobserve?.();
      bar = findBar(el, edge());
      // A toolbar is layout only: its tone lives on the glass inside it.
      toneSource = bar && (bar.matches('.glass') ? bar : bar.querySelector('.glass'));
      unobserve = bar && I.observeResize(bar, measure);
      measure();
      syncTone();
    }

    function refresh() {
      I.setVar(el, '--_lgc-edge-page', backgroundColour(el));
      attach();
    }

    // Tone changes on the bar (or the glass inside a toolbar) bubble up as glass:tone. The bar
    // usually follows the band in the DOM, so it registers after this setup; glass that registers
    // where the bar would be found may be the bar arriving (glass:ready: it has a size by then).
    const scope = () => {
      const id = el.getAttribute('data-glass-bar');
      return id ? document.getElementById(id) : el.parentElement;
    };
    const onGlass = (e) => {
      if (bar?.isConnected) { if (bar.contains(e.target)) syncTone(); }
      else if (scope()?.contains(e.target)) attach();
    };
    document.addEventListener('glass:tone', onGlass, { signal });
    document.addEventListener('glass:ready', onGlass, { signal });
    addEventListener('resize', measure, { passive: true, signal });

    refresh();

    return {
      refresh,
      destroy() {
        unobserve?.();
        layer.remove();
        if (addedHidden) el.removeAttribute('aria-hidden');
        el.removeAttribute('data-lgc-tone');
        I.setVar(el, '--_lgc-edge-size', null);
        I.setVar(el, '--_lgc-edge-page', null);
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-scroll-edge.js failed', e); }
}],
["search", function (I, LG) {
'use strict';
// ── comp-search.js ──────────────────────────────────────────────────────────
try { (function () {
// Search field (§4.7.6, §5.9). <search class="glass glass-search"> holds a magnifier and a native
// input. Focus activates it: the field animates its width to the new layout (FLIP on width; the
// core stretches the old map until the size settles, §3.11) and a separate circular glass Cancel
// button materializes at its trailing edge. Cancel or Esc clears the query and blurs the field;
// focus leaving an empty field deactivates it too.
//
// Width FLIP: min-width and max-width are pinned to the animated value, which works in block,
// flex and grid layouts alike; margin-inline-end (the room for Cancel) animates with it so the
// field's outer size, and so its neighbours, change smoothly.

const MAGNIFIER = '<path d="M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 0 1 0-13zM15.3 15.3 20 20" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>';
const XMARK = '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';

function svg(markup, cls) {
  const s = document.createElementNS(I.SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = markup;
  return s;
}

I.defineComponent('search', {
  selector: '.glass-search',
  setup(el, { handle, signal }) {
    const input = el.querySelector('input');
    if (!input) return { destroy() {} };
    const h = handle || I.register(el);
    const ownHandle = !handle;
    h.setDefaults({ refraction: 0.7, bezel: 10 });

    let icon = el.querySelector('.glass-search-icon');
    const addedIcon = !icon;
    if (addedIcon) el.prepend((icon = svg(MAGNIFIER, 'glass-search-icon')));

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'glass glass-button glass-icon glass-search-cancel';
    cancel.setAttribute('aria-label', el.getAttribute('data-glass-cancel-label') || 'Cancel');
    cancel.setAttribute('data-glass-interactive', '');
    cancel.hidden = true;
    cancel.append(svg(XMARK));
    el.append(cancel);
    const cancelHandle = I.register(cancel);

    let active = false;
    let suppressFocus = false; // a programmatic refocus that must not reactivate the field
    let flip = null;           // running width FLIP: { spring, saved }

    // ── Width FLIP ─────────────────────────────────────────────────────────
    const box = () => ({ w: el.offsetWidth, m: parseFloat(getComputedStyle(el).marginInlineEnd) || 0 });
    function pin(w, m) {
      const s = el.style;
      s.minWidth = s.maxWidth = `${I.fmt(w, 2)}px`;
      s.marginInlineEnd = `${I.fmt(m, 2)}px`;
    }
    function unpin() {
      if (!flip) return;
      const f = flip;
      flip = null;
      f.spring.onUpdate = null;
      f.spring.stop();
      Object.assign(el.style, f.saved);
    }

    /** Applies a state change and animates the field from its current box to the new one. */
    function morph(change, preset) {
      const from = box();
      const s = el.style;
      const saved = flip ? flip.saved : { minWidth: s.minWidth, maxWidth: s.maxWidth, marginInlineEnd: s.marginInlineEnd };
      unpin();
      change();
      const to = box();
      if (Math.abs(from.w - to.w) < 0.5 && Math.abs(from.m - to.m) < 0.5) return;
      const f = (flip = { saved, spring: null });
      pin(from.w, from.m);
      f.spring = new I.Spring({
        value: 0,
        preset,
        onUpdate: (p) => pin(I.lerp(from.w, to.w, p), I.lerp(from.m, to.m, p)),
        onRest: () => { if (flip === f) unpin(); },
      });
      f.spring.to(1);
    }

    /** A zero-size rect at the field's trailing edge, where Cancel grows from and returns to. */
    function trailingEdge() {
      const r = el.getBoundingClientRect(), rtl = getComputedStyle(el).direction === 'rtl';
      return new DOMRect(rtl ? r.left : r.right, r.top + r.height / 2, 0, 0);
    }

    // ── States ─────────────────────────────────────────────────────────────
    function activate() {
      if (active) return;
      active = true;
      morph(() => {
        el.setAttribute('data-lgc-active', '');
        cancel.hidden = false;
      }, 'unlift');
      I.materialize(cancelHandle, { from: trailingEdge(), scale: 0.6 });
    }

    function deactivate() {
      if (!active) return;
      active = false;
      const edge = trailingEdge();
      morph(() => el.removeAttribute('data-lgc-active'), 'snappy');
      // Cancel is absolutely positioned, so it can finish dematerializing after the field moved.
      I.dematerialize(cancelHandle, { to: edge, scale: 0.6 }).then(() => { if (!active) cancel.hidden = true; });
    }

    function clearAndBlur() {
      if (input.value) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      // A keyboard user's focus must not fall to <body> when Cancel disappears under it.
      const refocus = document.activeElement === cancel;
      deactivate();
      if (refocus) { suppressFocus = true; input.focus({ preventScroll: true }); suppressFocus = false; }
      else input.blur();
    }

    // ── Events ─────────────────────────────────────────────────────────────
    input.addEventListener('focus', () => { if (!suppressFocus) activate(); }, { signal });
    input.addEventListener('input', () => { if (input.value && !active) activate(); }, { signal });
    el.addEventListener('focusout', (e) => {
      if (el.contains(e.relatedTarget) || input.value) return;
      deactivate();
    }, { signal });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (!active && !input.value)) return;
      e.preventDefault(); // also keeps an enclosing dialog open
      clearAndBlur();
    }, { signal });
    // Presses on the capsule (icon, padding) focus the input instead of blurring it; presses on
    // Cancel keep focus in the input so the field does not collapse before the click lands.
    el.addEventListener('mousedown', (e) => {
      if (e.target === input || e.button !== 0) return;
      e.preventDefault();
      if (!cancel.contains(e.target)) input.focus();
    }, { signal });
    cancel.addEventListener('click', clearAndBlur, { signal });

    // A framework restoring (or clearing) the query sets .value without events: follow it,
    // chaining onto any accessor already on the element (React's value tracker).
    const own = Object.getOwnPropertyDescriptor(input, 'value');
    const base = own || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: base.enumerable,
      get() { return base.get.call(this); },
      set(v) {
        base.set.call(this, v);
        if (input.value) activate();
        else if (document.activeElement !== input) deactivate();
      },
    });
    const hook = Object.getOwnPropertyDescriptor(input, 'value');

    if (document.activeElement === input || input.value) {
      active = true;
      el.setAttribute('data-lgc-active', '');
      cancel.hidden = false;
    }

    return {
      destroy() {
        if (Object.getOwnPropertyDescriptor(input, 'value')?.set === hook.set) { // not replaced since
          if (own) Object.defineProperty(input, 'value', own);
          else delete input.value;
        }
        unpin();
        el.removeAttribute('data-lgc-active');
        cancelHandle.destroy();
        cancel.remove();
        if (addedIcon) icon.remove();
        if (ownHandle) h.destroy();
        else h.setDefaults({ refraction: undefined, bezel: undefined });
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-search.js failed', e); }
}],
["sheet", function (I, LG) {
'use strict';
// ── comp-sheet.js ───────────────────────────────────────────────────────────
try { (function () {
// Sheet (§4.7.7, §5.8, §5.9). <dialog class="glass glass-sheet" data-glass-detents="medium large">.
//
// Opening: showModal()/show() set the `open` attribute, which the core's observer reports before
// the first paint; the sheet then materializes from its invoker (scale .96, rising 24 px; more in
// the bottom layout). Closing animates first: the cancel event (Esc, closedby light dismiss,
// requestClose()) and form[method=dialog] submissions are intercepted, animated, then closed.
// Calling dialog.close() directly closes at once.
//
// Bottom layout (CSS decides; see 25-sheet.css): the grabber drags the sheet between its detents,
// rubber-bands past the largest, slides down 1:1 below the smallest and dismisses on a flick or a
// long enough pull. data-glass-detent reflects the current detent (glass:detent { detent } fires
// on change); setting it animates there. Heights come from CSS (measured per detent), so authors
// can restyle them. Under reduced motion the bottom sheet crossfades out instead of sliding.

const DETENTS = ['medium', 'large'];
const PROJECTION = 0.2;  // s of velocity projection when choosing where to settle (§5.6)
const DISMISS = 0.35;    // dismiss when the projected pull passes 35 % of the smallest detent
const RUBBER = 60;       // px: asymptote of the rubber band past the largest detent
const TAP_SLOP = 4;      // px: a grabber press that moves less is a tap (cycles the detent)

const rubber = (x) => (x * RUBBER) / (x + RUBBER);
const TABBABLE = 'button:not([disabled]), [href], input:not([disabled], [type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

I.defineComponent('sheet', {
  selector: 'dialog.glass-sheet',
  attributes: ['open', 'data-glass-detent'],
  setup(el, { handle, signal }) {
    const h = handle || I.register(el);
    const ownHandle = !handle;
    h.setDefaults({ tier: 'b' }); // a large surface: frosted, like Apple's (§2.4)

    // ── Parts ──────────────────────────────────────────────────────────────
    // The injected grabber is a button, so the detents can also be changed without a pointer.
    let grabber = el.querySelector(':scope > .glass-sheet-grabber');
    const addedGrabber = !grabber;
    if (addedGrabber) {
      grabber = document.createElement('button');
      grabber.type = 'button';
      grabber.className = 'glass-sheet-grabber';
      grabber.setAttribute('aria-label', el.getAttribute('data-glass-grabber-label') || 'Resize sheet');
      el.prepend(grabber);
    }
    let body = el.querySelector(':scope > .glass-sheet-body');
    const wrapped = body ? null : [...el.childNodes].filter((n) => n !== grabber);
    if (wrapped) {
      body = document.createElement('div');
      body.className = 'glass-sheet-body';
      body.append(...wrapped);
      el.append(body);
    }

    // ── State ──────────────────────────────────────────────────────────────
    let detent = null;          // current detent (name)
    let written = null;         // the data-glass-detent value this component last wrote
    let shown = el.open;        // opened() has run for the current open state
    let closing = false;
    let drag = null;            // { id, y0, raw0, sizes, vt, raw, moved, off }
    let settle = null;          // { h, ty } springs while settling
    let ty = 0;                 // current slide-down offset (px)
    let invokerHint = null;     // { el, t }: the command source or the element focus came from
    let lastPress = null;       // { el, t }: Safari does not focus buttons on click

    const bottom = () => getComputedStyle(el).getPropertyValue('--_lgc-sheet-mode').trim() === 'bottom';
    const detents = () => {
      const want = (el.getAttribute('data-glass-detents') || '').split(/\s+/);
      const list = DETENTS.filter((d) => want.includes(d));
      return list.length ? list : ['large'];
    };

    function setDetent(d) {
      const changed = d !== detent;
      detent = d;
      written = d;
      el.setAttribute('data-glass-detent', d);
      syncGrabber();
      if (changed) I.emit(el, 'glass:detent', { detent: d });
    }

    /** The injected grabber is exposed only while it can change something. */
    function syncGrabber() {
      if (!addedGrabber) return;
      const list = detents(), useful = list.length > 1;
      I.setAttr(grabber, 'aria-hidden', useful ? null : 'true');
      I.setAttr(grabber, 'tabindex', useful ? null : '-1');
      I.setAttr(grabber, 'aria-expanded', useful ? String(detent === list[list.length - 1]) : null);
    }

    function cycleDetent() {
      const list = detents();
      toDetent(list[(list.indexOf(detent) + 1) % list.length]);
    }

    /** CSS height of each allowed detent, smallest first. */
    function measure() {
      const s = el.style, saved = s.height;
      s.height = '';
      const sizes = detents().map((d) => { el.setAttribute('data-glass-detent', d); return { d, h: el.offsetHeight }; });
      I.setAttr(el, 'data-glass-detent', detent);
      s.height = saved;
      return sizes;
    }

    /** Height, slide and the derived fill (medium → large) and backdrop dim. */
    function write(height, slide, sizes) {
      ty = slide;
      el.style.height = `${I.fmt(height, 2)}px`;
      I.setChannel(h, 'sheet', { ty: slide });
      const min = sizes[0].h, max = sizes[sizes.length - 1].h;
      const t = max > min ? I.clamp((height - min) / (max - min), 0, 1) : sizes[0].d === 'large' ? 1 : 0;
      I.setVar(el, '--_lgc-sheet-t', I.fmt(t));
      I.setVar(el, '--_lgc-sheet-dim', I.fmt(1 - I.clamp(slide / (min + 8), 0, 1)));
    }

    /** Back to the CSS layout of the current detent. */
    function release() {
      stopSettle();
      ty = 0;
      el.style.removeProperty('height');
      I.clearChannel(h, 'sheet');
      I.setVar(el, '--_lgc-sheet-t', null);
      I.setVar(el, '--_lgc-sheet-dim', null);
    }

    function stopSettle() {
      if (!settle) return;
      const s = settle;
      settle = null;
      s.h.stop();
      s.ty.stop();
    }

    /** Springs height and slide to a target, keeping the gesture's velocity (px/s, + = down). */
    function settleTo(target, sizes, vy = 0, preset = 'snappy') {
      stopSettle();
      let height = el.offsetHeight, slide = ty;
      const s = (settle = {});
      const step = () => { if (settle === s) write(height, slide, sizes); };
      s.h = new I.Spring({ value: height, preset, onUpdate: (v) => { height = v; step(); } });
      s.ty = new I.Spring({ value: slide, preset, onUpdate: (v) => { slide = v; step(); } });
      return Promise.all([
        s.h.to(target.h, { velocity: -vy }),
        s.ty.to(target.ty, { velocity: vy }),
      ]).then(() => settle === s);
    }

    async function toDetent(d, vy = 0) {
      if (!el.open || !bottom()) { setDetent(d); release(); return; }
      const sizes = measure(), target = sizes.find((x) => x.d === d) || sizes[0];
      if (await settleTo({ h: target.h, ty: 0 }, sizes, vy)) {
        setDetent(target.d);
        release();
      }
    }

    // ── Open / close ───────────────────────────────────────────────────────
    function invoker() {
      const now = performance.now(), hint = invokerHint;
      invokerHint = null;
      if (hint && now - hint.t < 1500 && hint.el?.isConnected) return hint.el;
      const pressed = lastPress && now - lastPress.t < 1500 ? lastPress.el : null;
      return pressed?.closest?.('button, [role="button"], a[href], .glass') || null;
    }

    function opened() {
      shown = true;
      closing = false;
      release();
      // Chromium's dialog focusing steps pick a focusable scroller (the body), or the grabber, over
      // the first control.
      if (document.activeElement === body || document.activeElement === grabber) body.querySelector(TABBABLE)?.focus({ preventScroll: true });
      const want = el.getAttribute('data-glass-detent');
      setDetent(want && want !== written && detents().includes(want) ? want : detents()[0]);
      const from = invoker(), rise = bottom() ? Math.min(160, 0.35 * el.offsetHeight) : 24;
      I.materialize(h, { from: from || undefined, scale: 0.96, y: rise, spring: 'smooth' });
    }

    function closed() {
      shown = false;
      closing = false;
      endDrag();
      release();
    }

    /** The animated close shared by Esc, form[method=dialog] and the flick. The bottom sheet
     * slides out (crossfades under reduced motion); the panel dematerializes. */
    async function close(returnValue, vy = 0) {
      if (closing || !el.open) return;
      closing = true;
      endDrag();
      if (bottom() && !I.reducedMotion()) {
        const sizes = measure();
        await settleTo({ h: el.offsetHeight, ty: el.offsetHeight + 16 }, sizes, vy, 'smooth');
      } else {
        await I.dematerialize(h, { scale: 0.96, y: 24, spring: 'smooth' });
      }
      if (closing && el.open) el.close(returnValue);
    }

    // ── Drag (bottom layout) ───────────────────────────────────────────────
    function endDrag() {
      if (!drag) return;
      drag.off();
      try { grabber.releasePointerCapture(drag.id); } catch { /* already released */ }
      drag = null;
    }

    grabber.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || closing || !bottom()) return;
      e.preventDefault();
      try { grabber.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      stopSettle();
      const sizes = measure(), height = el.offsetHeight;
      const d = (drag = { id: e.pointerId, y0: e.clientY, raw0: height - ty, raw: height - ty, sizes, vt: new I.VelocityTracker(), moved: false });
      d.vt.push(0, e.clientY, e.timeStamp);
      // Pointer events only store the target; the frame loop writes it.
      d.off = I.onFrame(() => {
        const min = sizes[0].h, max = sizes[sizes.length - 1].h, raw = d.raw;
        if (raw > max) write(max + rubber(raw - max), 0, sizes);
        else if (raw < min) write(min, min - raw, sizes);
        else write(raw, 0, sizes);
      });
    }, { signal });

    grabber.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.vt.push(0, e.clientY, e.timeStamp);
      drag.raw = drag.raw0 - (e.clientY - drag.y0);
      if (Math.abs(e.clientY - drag.y0) > TAP_SLOP) drag.moved = true;
    }, { signal });

    grabber.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { raw, sizes, moved } = drag, { vy } = drag.vt.release(e.timeStamp);
      endDrag();
      if (!moved) { cycleDetent(); return; } // a tap on the grabber
      const min = sizes[0].h, projected = raw - vy * PROJECTION;
      if (projected < min * (1 - DISMISS)) { close(undefined, vy); return; }
      const target = sizes.reduce((a, b) => (Math.abs(b.h - projected) < Math.abs(a.h - projected) ? b : a));
      toDetent(target.d, vy);
    }, { signal });
    // A cancelled gesture (a system gesture, an alert) never commits: back to the current detent.
    const cancelDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      endDrag();
      toDetent(detent);
    };
    grabber.addEventListener('pointercancel', cancelDrag, { signal });
    grabber.addEventListener('lostpointercapture', cancelDrag, { signal });
    // Keyboard and assistive technology activate the grabber button (detail 0); a pointer tap was
    // handled on pointerup.
    grabber.addEventListener('click', (e) => { if (e.detail === 0 && el.open && !closing) cycleDetent(); }, { signal });

    // ── Events ─────────────────────────────────────────────────────────────
    el.addEventListener('cancel', (e) => { e.preventDefault(); close(); }, { signal });
    el.addEventListener('submit', (e) => {
      // A form inside a dialog nested in the sheet closes that dialog, not the sheet.
      if (e.target.closest('dialog') !== el) return;
      const method = e.submitter?.getAttribute('formmethod') || e.target.getAttribute('method');
      if (method?.toLowerCase() !== 'dialog' || e.defaultPrevented) return;
      e.preventDefault();
      close(e.submitter?.value ?? '');
    }, { signal });
    // closedby="any" where the platform lacks it: a click on the backdrop closes.
    if (!('closedBy' in HTMLDialogElement.prototype)) {
      el.addEventListener('click', (e) => {
        if (e.target !== el || el.getAttribute('closedby') !== 'any') return;
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      }, { signal });
    }
    // Where the sheet was opened from: an invoker command, or the element focus left for it.
    el.addEventListener('command', (e) => { if (e.source) invokerHint = { el: e.source, t: performance.now() }; }, { signal });
    el.addEventListener('focusin', (e) => {
      if (e.relatedTarget && !el.contains(e.relatedTarget)) invokerHint ||= { el: e.relatedTarget, t: performance.now() };
    }, { signal });
    document.addEventListener('pointerdown', (e) => { lastPress = { el: e.target, t: performance.now() }; }, { capture: true, passive: true, signal });

    if (el.open) setDetent(detents()[0]);
    else syncGrabber();

    return {
      attributeChanged(name, oldValue) {
        if (name === 'data-glass-detent') {
          // Set by the author or assistive UI: animate there. Set before showModal() (the same
          // mutation batch, delivered first), it is the detent opened() starts at instead.
          const d = el.getAttribute('data-glass-detent');
          if (d !== detent && shown && !drag && detents().includes(d)) toDetent(d);
        } else if (el.open && oldValue === null) opened();
        else if (!el.open && oldValue !== null) closed();
      },
      destroy() {
        endDrag();
        release();
        if (written && el.getAttribute('data-glass-detent') === written) el.removeAttribute('data-glass-detent');
        if (wrapped) { el.append(...body.childNodes); body.remove(); }
        if (addedGrabber) grabber.remove();
        if (ownHandle) h.destroy();
        else h.setDefaults({ tier: undefined });
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-sheet.js failed', e); }
}],
["slider", function (I, LG) {
'use strict';
// ── comp-slider.js ──────────────────────────────────────────────────────────
try { (function () {
// Slider (§4.7.4, §5.6). The author's range input stays the real control for the keyboard, forms
// and assistive technology; pointer input is handled on the wrapper instead, so the knob can lift
// into a clear glass lens, follow the finger, carry flick momentum and rubber-band past the ends.
//
// The input's value is mirrored into --glass-value (0–1) on the wrapper, which is all CSS needs to
// place the knob and the fill, with --_lgc-sl-travel (px) and --_lgc-sl-over (px past an end).

// 37 × 24 → 58 × 38.33. The lift scales the lens by ~1.6, and its blur with it: σ .3 keeps it clear.
const LENS = { zoom: 1.12, dispersion: 0.8, grow: { x: 58 / 37, y: 38.33 / 24 }, blur: 0.3 };
const DRAG_SLOP = 3;      // px before a press becomes a drag
const KNOB_SLOP = 6;      // px around the knob that grab it; presses elsewhere jump to the pointer
const TOUCH_HOLD_MS = 150; // a touch lifts the lens after this hold or a drag: a scroll may start here
const PROJECTION = 0.2;   // s: a flick carries the knob v·0.2 further (§5.6)
const STRETCH_MAX = 8;    // px the track stretches past an end…
const SQUEEZE_MAX = 2;    // …while it thins by up to this much
const MAX_TICKS = 20;     // intervals: finer steps get no tick marks
const MIN_TICK_GAP = 8;   // px between ticks below which they are hidden
const CATCH_UP = { k: (2 * Math.PI / 0.12) ** 2, c: (4 * Math.PI) / 0.12 }; // critically damped, 0.12 s

/** Past an end the track follows the pull with growing resistance, up to STRETCH_MAX. */
const band = (d) => STRETCH_MAX * (1 - 1 / (1 + (0.55 * d) / STRETCH_MAX));

I.defineComponent('slider', {
  selector: '.glass-slider',
  setup(el, { signal }) {
    const input = el.querySelector('input[type="range"]');
    if (!input) return { destroy() {} };

    const track = I.part(el, 'glass-slider-track');
    const ticks = I.part(track, 'glass-slider-ticks');
    const fill = I.part(track, 'glass-slider-fill');
    const fillTicks = I.part(fill, 'glass-slider-ticks');
    const rail = I.part(el, 'glass-slider-rail');
    input.after(track, rail);
    const knob = I.part(rail, 'glass glass-slider-knob');
    knob.setAttribute('data-glass-dim', 'none');
    I.part(knob, 'glass-slider-face');

    // The lifted lens is clear glass; light like the white knob it replaces (Tier C draws it solid).
    // Its composed scale (--_lg-scale-x/y) lets the Tier B magnifier cancel growth and stretch.
    const lens = I.register(knob, { latent: true, variant: 'clear', tone: 'light', scaleVars: true });
    I.prepareLift(lens, LENS);

    const NATIVE_VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    let min = 0, max = 100, step = 1, intervals = 0; // intervals > 0: stepped, with tick marks
    let travel = 0, knobW = 0, trackH = 6, dir = 1;
    let rect = null;   // the wrapper's padding box on screen: { left, right, k } (k: on-screen scale)
    let g = null;      // the pointer gesture in progress
    let glide = null;  // { from, sign }: the knob settling after a release, until its change event
    let emitting = false, dead = false;

    const pos = new I.Spring({ preset: 'smooth', onUpdate: (t) => {
      if (dead) return;
      el.style.setProperty('--glass-value', I.fmt(I.clamp(t, 0, 1), 5));
      // Momentum carries the value along; a knob still catching up with it never takes it back.
      if (glide?.sign && (valueAt(t) - input.valueAsNumber) * glide.sign > 0) commit(valueAt(t));
    } });
    const over = new I.Spring({ preset: 'unlift', onUpdate: (o) => { if (!dead) stretchTrack(o); } });

    // ── Value model ──────────────────────────────────────────────────────
    function readBounds() {
      min = I.toNumber(input.min, 0);
      max = Math.max(min, I.toNumber(input.max, 100));
      const attr = input.getAttribute('step'), parsed = I.toNumber(attr, 1);
      step = attr === 'any' ? 0 : parsed > 0 ? parsed : 1;
      const n = step ? (max - min) / step : 0;
      intervals = attr != null && step && n >= 1 && n <= MAX_TICKS && Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : 0;
    }
    const tOf = (v) => (max > min ? I.clamp((v - min) / (max - min), 0, 1) : 0);
    const valueAt = (t) => min + I.clamp(t, 0, 1) * (max - min);
    /** The nearest valid value's position (the browser rounds the same way when it is set). */
    function snap(t) {
      if (!step || max <= min) return I.clamp(t, 0, 1);
      const last = Math.floor((max - min) / step + 1e-9);
      return tOf(min + I.clamp(Math.round((valueAt(t) - min) / step), 0, last) * step);
    }

    /** Sets the value natively (bypassing framework value trackers) and reports `input` on change. */
    function commit(v) {
      const before = input.value;
      NATIVE_VALUE.set.call(input, String(v));
      if (input.value !== before) emit('input');
    }
    function emit(type) {
      emitting = true;
      try { input.dispatchEvent(new Event(type, { bubbles: true, composed: type === 'input' })); } finally { emitting = false; }
    }

    /** Shows the input's current value at rest (not while a gesture or momentum drives it). */
    function sync() {
      if (g || glide) return;
      pos.jump(tOf(input.valueAsNumber));
    }
    /** A value from outside (a script, a framework, a form reset) wins over a running glide. */
    function external() {
      glide = null;
      sync();
    }

    // Frameworks and scripts change the value without events (.value, valueAsNumber, stepUp()):
    // chain onto those members so the knob follows, keeping anything already defined on the
    // element itself (React's value tracker). Writing the value it already has changes nothing.
    const hooks = ['value', 'valueAsNumber', 'stepUp', 'stepDown'].map((name) => {
      const own = Object.getOwnPropertyDescriptor(input, name);
      const base = own || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, name);
      const changes = (run) => { const before = NATIVE_VALUE.get.call(input); run(); if (NATIVE_VALUE.get.call(input) !== before) external(); };
      const hook = base.set
        ? { get() { return base.get.call(this); }, set(v) { changes(() => base.set.call(this, v)); } }
        : { value(...args) { changes(() => base.value.apply(this, args)); }, writable: true };
      Object.defineProperty(input, name, { configurable: true, enumerable: base.enumerable, ...hook });
      const mine = Object.getOwnPropertyDescriptor(input, name);
      return () => {
        const now = Object.getOwnPropertyDescriptor(input, name);
        if (now?.set !== mine.set || now?.value !== mine.value) return; // replaced by someone else since
        if (own) Object.defineProperty(input, name, own);
        else delete input[name];
      };
    });

    // ── Geometry, ticks and the rubber band ──────────────────────────────
    function renderTicks() {
      const html = intervals ? Array.from({ length: intervals + 1 }, (_, k) => `<span style="--k:${I.fmt(k / intervals, 5)}"></span>`).join('') : '';
      if (ticks.innerHTML !== html) ticks.innerHTML = fillTicks.innerHTML = html;
    }
    function layout(width) {
      knobW = knob.offsetWidth;
      trackH = track.offsetHeight || trackH;
      travel = Math.max(0, width - knobW);
      el.style.setProperty('--_lgc-sl-travel', `${I.fmt(travel, 2)}px`);
      const hidden = !intervals || travel / intervals < MIN_TICK_GAP;
      ticks.hidden = fillTicks.hidden = hidden;
    }
    const unobserve = I.observeResize(track, (entry) => layout(entry.contentRect.width));

    /** px past an end (signed along the value axis) → the rail follows, the track stretches and thins. */
    function stretchTrack(o) {
      el.style.setProperty('--_lgc-sl-over', `${I.fmt(o, 2)}px`);
      const copy = magnifier?.firstChild;
      for (const t of copy ? [track, copy] : [track]) {
        if (Math.abs(o) < 0.01) { t.style.removeProperty('transform'); continue; }
        const w = travel + knobW, h = trackH, a = Math.abs(o);
        t.style.transformOrigin = (o > 0) === (dir > 0) ? 'left center' : 'right center';
        t.style.transform = `scale(${I.fmt((w + a) / w, 4)}, ${I.fmt((h - (SQUEEZE_MAX * a) / STRETCH_MAX) / h, 4)})`;
      }
    }

    // Tier B cannot refract, so the lens magnifies what the slider owns: a copy of the track,
    // scaled about the knob's centre (clone-magnify, §4.7.2). CSS aligns it from the same
    // variables and shows it only in Tier B.
    let magnifier = null;
    function cloneTrack() {
      if (!magnifier) {
        const view = I.part(knob, 'glass-slider-lens');
        knob.prepend(view); // under the face, which fades out as the lens lifts
        view.inert = true;
        magnifier = I.part(view, 'glass-slider-magnifier');
      }
      const copy = track.cloneNode(true);
      copy.removeAttribute('aria-hidden');
      magnifier.replaceChildren(copy);
    }
    /** Lifts the knob into the lens once per gesture; an opaque Tier C lens would hide the track. */
    function lift() {
      if (!g || g.lifted) return;
      clearTimeout(g.liftTimer);
      g.lifted = true;
      if (lens.tier !== 'a' && lens.tier !== 'b') return;
      if (lens.tier === 'b') cloneTrack();
      I.lift(lens, LENS);
    }

    // ── Pointer ──────────────────────────────────────────────────────────
    /** Client x → px along the value axis, in the slider's own (untransformed, unzoomed) px. */
    const along = (x) => (dir > 0 ? x - rect.left : rect.right - x) / rect.k - knobW / 2;

    function jumpTo(p) {
      const t = snap(p / travel);
      pos.to(t, { ...CATCH_UP });
      commit(valueAt(t));
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || g || input.disabled) return;
      e.preventDefault(); // no text selection, and keep focus on the input
      input.focus({ preventScroll: true });
      // The track spans the wrapper's padding box; unlike the track, the wrapper never stretches.
      // An ancestor's transform or zoom scales it on screen by k.
      const r = el.getBoundingClientRect(), k = r.width / (el.offsetWidth || 1) || 1, left = r.left + el.clientLeft * k;
      rect = { left, right: left + el.clientWidth * k, k };
      dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      layout(track.offsetWidth);
      if (pos.active) pos.jump(pos.value); // catch it mid-flight
      const p = along(e.clientX), knobAt = pos.value * travel;
      const onKnob = Math.abs(p - knobAt) <= knobW / 2 + KNOB_SLOP;
      g = {
        id: e.pointerId, x0: e.clientX, from: glide ? glide.from : input.value, onKnob, dragging: false,
        offset: onKnob ? p - knobAt : 0, velocity: new I.VelocityTracker(),
        // A touch on the track may still become a vertical scroll: jump only once it drags or taps.
        deferred: !onKnob && e.pointerType !== 'mouse',
      };
      g.velocity.push(p, 0, e.timeStamp);
      glide = null;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      if (g.deferred) return;
      if (!onKnob) jumpTo(p);
      if (e.pointerType === 'touch') g.liftTimer = setTimeout(lift, TOUCH_HOLD_MS);
      else lift();
    }, { signal });

    el.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const p = along(e.clientX);
      g.velocity.push(p, 0, e.timeStamp);
      if (!g.dragging && Math.abs(e.clientX - g.x0) < DRAG_SLOP) return;
      g.dragging = true;
      lift();
      const x = p - g.offset, past = x < 0 ? x : x > travel ? x - travel : 0;
      over.jump(I.reducedMotion() ? 0 : Math.sign(past) * band(Math.abs(past)));
      const t = I.clamp(x / travel, 0, 1);
      if (g.deferred) { // a touch on the track that turned into a drag: glide over, then follow
        g.deferred = false;
        pos.to(t, { ...CATCH_UP });
      }
      if (intervals) {
        const ts = snap(t); // stepped: glide from tick to tick
        if (ts !== pos.target) pos.to(ts, { preset: 'snappy' });
        commit(valueAt(ts));
      } else {
        if (pos.active) pos.to(t, { ...CATCH_UP }); // still catching up with a jump
        else pos.jump(t);
        commit(valueAt(t));
      }
      I.stretch(lens, g.velocity.get(e.timeStamp).vx);
    }, { signal });

    function release(e, cancelled) {
      if (!g || e.pointerId !== g.id) return;
      const { dragging, deferred, from } = g, v = g.velocity.release(e.timeStamp).vx;
      clearTimeout(g.liftTimer);
      g = null;
      if (deferred) {
        if (cancelled) return;
        jumpTo(along(e.clientX)); // a tap on the track
      }
      I.unlift(lens);
      I.stretch(lens, null);
      over.to(0, { preset: 'unlift' });
      const fling = dragging && !cancelled && !I.reducedMotion() ? (v * PROJECTION) / (travel || 1) : 0;
      const target = snap(pos.target + fling);
      glide = { from, sign: Math.sign(valueAt(target) - input.valueAsNumber) };
      // A tap keeps its catch-up glide; a drag settles (and flings) on the smooth spring.
      pos.to(target, dragging ? { preset: 'smooth' } : {}).then(() => {
        if (glide && !pos.active) endGlide();
      });
    }
    el.addEventListener('pointerup', (e) => release(e, false), { signal });
    el.addEventListener('pointercancel', (e) => release(e, true), { signal });
    el.addEventListener('lostpointercapture', (e) => release(e, true), { signal });

    /** Momentum is over: settle on a valid value and report the gesture's change. */
    function endGlide() {
      const { from } = glide;
      glide = null;
      commit(valueAt(pos.value));
      pos.jump(tOf(input.valueAsNumber));
      if (input.value !== from) emit('change');
    }

    // Keyboard, assistive technology and scripts that dispatch events: glide to the new value.
    input.addEventListener('input', () => {
      if (emitting || g) return;
      glide = null; // the keyboard takes over mid-momentum; its own change event reports the value
      pos.to(tOf(input.valueAsNumber), { preset: 'snappy' });
    }, { signal });

    const mo = new MutationObserver(() => { readBounds(); renderTicks(); layout(track.clientWidth); external(); });
    mo.observe(input, { attributes: true, attributeFilter: ['min', 'max', 'step', 'value'] });
    // A form reset restores the value after its event, without events of its own.
    let resetTimer = 0;
    input.form?.addEventListener('reset', () => { resetTimer = setTimeout(external); }, { signal });

    readBounds();
    renderTicks();
    layout(track.clientWidth);
    sync();

    return {
      refresh() {
        readBounds();
        renderTicks();
        layout(track.clientWidth);
        sync();
      },
      destroy() {
        dead = true;
        clearTimeout(g?.liftTimer);
        clearTimeout(resetTimer);
        // Torn down mid-glide: the value stays where it is, and the gesture's change is still owed.
        if (glide) {
          const { from } = glide;
          glide = null;
          if (input.value !== from) emit('change');
        }
        unobserve();
        mo.disconnect();
        for (const unhook of hooks) unhook();
        pos.stop();
        over.stop();
        lens.destroy();
        track.remove();
        rail.remove();
        for (const name of ['--glass-value', '--_lgc-sl-travel', '--_lgc-sl-over']) el.style.removeProperty(name);
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-slider.js failed', e); }
}],
["switch", function (I, LG) {
'use strict';
// ── comp-switch.js ──────────────────────────────────────────────────────────
try { (function () {
// Switch (§4.7.3, §5.5). The author's checkbox (role=switch) stays the real control: CSS stretches
// it transparently over the label, so hit-testing, Space, forms and assistive technology stay
// native. Injected after it: a track and a white thumb that lifts into a clear glass lens while it
// is pressed or dragged, with the track colour showing through, refracted.
//
// The resting look comes from CSS (`input:checked + .glass-switch-track`), so `checked = …` set by
// a script or a framework is always reflected. While the thumb moves, its progress (0 = off,
// 1 = on, beyond either end while rubber-banding) is written to --_lgc-sw-x on the track, and
// removed again once it rests where CSS puts it.

// 37 × 24 → 58 × 38.33. The lift scales the lens by ~1.6, and its blur with it: σ .3 keeps it clear.
const LENS = { zoom: 1.12, dispersion: 0.8, grow: { x: 58 / 37, y: 38.33 / 24 }, blur: 0.3 };
// A tap's pulse swells the thumb without magnifying (§5.5): by 1.25 from rest, or keeping the
// growth of a lens that is already up (a mouse press lifts at once; changing it would jump).
const PULSE = { zoom: 1, grow: 1.25 };
const TAP = { zoom: 1 };
const HIT_SLOP = 8;       // px around the track in which a press grabs the thumb (the rest is label)
const DRAG_SLOP = 3;      // px of travel before a press becomes a drag
const TOUCH_HOLD_MS = 150; // a touch lifts the lens after this hold or a drag: a scroll may start here
const FLICK = 300;        // px/s: a faster release decides by direction, a slower one by position
const RUBBER = 0.12;      // thumb travel per px of pull past either end…
const RUBBER_MAX = 6;     // …saturating at this many px
const PULSE_MS = 180;     // a tap keeps the lens up at least this long while the thumb travels
const SWALLOW_MS = 600;   // how long the native click that follows a handled gesture is awaited

/** Past an end the thumb follows 12 % of the pull at first, easing towards RUBBER_MAX. */
const band = (d) => RUBBER_MAX * (1 - 1 / (1 + (RUBBER * d) / RUBBER_MAX));

I.defineComponent('switch', {
  selector: '.glass-switch',
  setup(el, { signal }) {
    const input = el.querySelector('input[type="checkbox"]');
    if (!input) return { destroy() {} };
    const addedRole = !input.hasAttribute('role');
    if (addedRole) input.setAttribute('role', 'switch');

    const track = I.part(el, 'glass-switch-track');
    input.after(track);
    const rail = I.part(track, 'glass-switch-rail');
    const thumb = I.part(rail, 'glass glass-switch-thumb');
    thumb.setAttribute('data-glass-dim', 'none');
    I.part(thumb, 'glass-switch-face');

    // The lifted lens is clear glass; light like the white thumb it replaces (Tier C draws it solid).
    const lens = I.register(thumb, { latent: true, variant: 'clear', tone: 'light' });
    I.prepareLift(lens, [LENS, TAP]); // PULSE shares TAP's map (growth is a transform)

    let travel = 1, dir = 1;  // px between the off and on positions; −1 in right-to-left layouts
    let k = 1;                // on-screen scale of the switch (an ancestor's transform or zoom)
    let g = null;             // the pointer gesture in progress
    let swallow = false, swallowTimer = 0, pulseTimer = 0, ownClick = false;

    const pos = new I.Spring({ preset: 'unlift', onUpdate: (x) => track.style.setProperty('--_lgc-sw-x', I.fmt(x, 4)) });

    function measure(trackRect) {
      travel = Math.max(1, track.clientWidth - thumb.offsetWidth - 2 * rail.offsetTop);
      dir = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      k = trackRect.width / (track.offsetWidth || 1) || 1;
    }

    /** Lifts the thumb into the lens once per gesture; an opaque Tier C lens would hide the track. */
    function lift() {
      if (!g || g.lifted) return;
      clearTimeout(g.liftTimer);
      g.lifted = true;
      if (lens.tier === 'a' || lens.tier === 'b') I.lift(lens, LENS);
    }

    /** Moves the thumb to a progress value; once it rests there, CSS takes over again. */
    function settleAt(x, preset) {
      pos.to(x, { preset }).then(() => {
        if (!g && !pos.active) track.style.removeProperty('--_lgc-sw-x');
      });
    }

    // The native click that follows a gesture we already resolved must not toggle the input again,
    // nor reach framework listeners (React reads checkbox changes from click events).
    function swallowNextClick() {
      swallow = true;
      clearTimeout(swallowTimer);
      swallowTimer = setTimeout(endSwallow, SWALLOW_MS);
    }
    function endSwallow() {
      swallow = false;
      clearTimeout(swallowTimer);
    }
    el.addEventListener('click', (e) => {
      if (!swallow || ownClick) return;
      endSwallow();
      e.preventDefault();
      e.stopImmediatePropagation();
    }, { capture: true, signal });

    /** Commits a state through a real click, so the input fires its own input and change events. */
    function setChecked(on) {
      if (on === input.checked) return;
      ownClick = true;
      try { input.click(); } finally { ownClick = false; }
    }

    input.addEventListener('pointerdown', (e) => {
      // A new press ends any wait for a click: after a touch drag none comes.
      endSwallow();
      if (e.button !== 0 || !e.isPrimary || g || input.disabled) return;
      const r = track.getBoundingClientRect();
      const nearTrack = e.clientX >= r.left - HIT_SLOP && e.clientX <= r.right + HIT_SLOP && e.clientY >= r.top - HIT_SLOP && e.clientY <= r.bottom + HIT_SLOP;
      if (!nearTrack) return; // a press on the label text is a plain native click
      clearTimeout(pulseTimer);
      measure(r);
      g = { id: e.pointerId, x0: e.clientX, t0: e.timeStamp, from: 0, dragging: false, lifted: false, liftTimer: 0, velocity: new I.VelocityTracker() };
      g.velocity.push(0, 0, e.timeStamp);
      if (!pos.active) pos.jump(input.checked ? 1 : 0); // otherwise grab it mid-flight
      g.from = pos.value;
      try { input.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      if (e.pointerType === 'touch') g.liftTimer = setTimeout(lift, TOUCH_HOLD_MS);
      else lift();
    }, { signal });

    input.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = ((e.clientX - g.x0) * dir) / k;
      g.velocity.push(dx, 0, e.timeStamp);
      if (!g.dragging && Math.abs(dx) < DRAG_SLOP) return;
      g.dragging = true;
      lift();
      const px = g.from * travel + dx;
      const x = px < 0 ? -band(-px) : px > travel ? travel + band(px - travel) : px;
      pos.jump(x / travel); // the thumb stays under the finger; the lens stretch carries the motion
      I.stretch(lens, g.velocity.get(e.timeStamp).vx);
    }, { signal });

    function release(e, cancelled) {
      if (!g || e.pointerId !== g.id) return;
      const { dragging, t0, lifted } = g, vx = g.velocity.release(e.timeStamp).vx;
      clearTimeout(g.liftTimer);
      g = null;
      let on = input.checked;
      if (!cancelled) {
        if (!dragging) on = !on;
        else if (Math.abs(vx) > FLICK) on = vx > 0;
        else on = pos.target > 0.5;
        swallowNextClick();
      }
      setChecked(on);
      settleAt(input.checked ? 1 : 0, 'unlift');
      I.stretch(lens, null);
      const hold = dragging || cancelled ? 0 : lifted ? PULSE_MS - (e.timeStamp - t0) : PULSE_MS;
      if (hold > 0 && (lens.tier === 'a' || lens.tier === 'b')) {
        I.lift(lens, lifted ? TAP : PULSE); // warm map: swapped in synchronously
        pulseTimer = setTimeout(() => I.unlift(lens), hold);
      } else I.unlift(lens);
    }
    input.addEventListener('pointerup', (e) => release(e, false), { signal });
    input.addEventListener('pointercancel', (e) => release(e, true), { signal });
    input.addEventListener('lostpointercapture', (e) => release(e, true), { signal });
    input.addEventListener('keydown', endSwallow, { signal });

    // Space, a label click or a script's click(): slide across without the lens (§5.5).
    input.addEventListener('change', () => {
      if (g || ownClick) return;
      if (!pos.active) pos.jump(input.checked ? 0 : 1);
      settleAt(input.checked ? 1 : 0, 'unlift');
    }, { signal });

    return {
      destroy() {
        clearTimeout(g?.liftTimer);
        clearTimeout(pulseTimer);
        endSwallow();
        pos.stop();
        lens.destroy();
        track.remove();
        if (addedRole) input.removeAttribute('role');
      },
    };
  },
});
})(); } catch (e) { console.error('[liquid-glass] comp-switch.js failed', e); }
}],
["tabbar-segmented", function (I, LG) {
'use strict';
// ── comp-pill.js ────────────────────────────────────────────────────────────
try { (function () {
// The sliding selection pill shared by the tab bar (§4.7.2, §5.4) and the segmented control
// (§4.7.5, §5.7). It injects two aria-hidden parts into the host that always move together:
//
//   .glass-<name>-pill   the flat resting capsule, painted under the items (z 0)
//   .glass-<name>-lens   latent glass above the items (z 2): invisible at rest, it lifts into a
//                        magnifying lens (I.lift) while the user holds or drags
//
// Slides run on the snappy spring with velocity stretch (§5.3) and an arrival squash; scrubbing
// follows the pointer on the lift spring. Tier A magnifies the items through the lens filter.
// Tier B has no live refraction, so the lens magnifies the host's own items by cloning them into
// itself (clone-magnify, §4.7.2). Exposed as I.Pill for the component partials.

const { clamp, fmt } = I;

const RUBBER_PX = 8;         // asymptotic overdrag past the first or last slot
const CLICK_GUARD_MS = 400;  // how long a scrub waits for the browser's own click to swallow it

const rubber = (d) => RUBBER_PX * (1 - Math.exp(-d / (3 * RUBBER_PX)));

/** Peak displacement of a unit-velocity impulse on an underdamped spring { k, c } (mass 1). */
function impulsePeak({ k, c }) {
  const w0 = Math.sqrt(k), z = c / (2 * w0), wd = w0 * Math.sqrt(1 - z * z), t = Math.atan2(wd, z * w0) / wd;
  return (Math.exp(-z * w0 * t) * Math.sin(wd * t)) / wd;
}
const SQUASH_PEAK = impulsePeak(I.SPRINGS.unlift); // the arrival squash is an impulse on `unlift`

class Pill {
  /**
   * host        the bar or control; it contains the items and receives the parts.
   * name        part prefix: 'tab' → .glass-tab-pill, .glass-tab-lens, .glass-tab-clip.
   * items()     the slot elements in DOM order.
   * lift        I.lift options for the lens.
   * preview     class for the item under the lifted lens (optional).
   * selectable  (i) → whether a scrub may end on slot i.
   * signal      aborts the host listeners the pill installs.
   * The lens takes the host's tone (data-lg-tone) and follows it.
   */
  constructor(host, { name, items, lift, preview = null, selectable = () => true, signal }) {
    this.host = host;
    this.name = name;
    this.items = items;
    this.liftOpts = lift;
    this.previewClass = preview;
    this.selectable = selectable;
    this.slots = [];        // { el, x, y, w, h } in host padding-box px, untransformed
    this.scale = 1;         // host's on-screen scale (press, materialize)
    this.origin = [0, 0];   // client position of the host's padding box
    this.index = -1;        // the committed slot the pill rests on
    this.preview = -1;      // the slot under the lifted lens
    this.lifted = false;
    this.shown = false;
    this.fade = 1;          // resting-pill opacity (reduced-motion crossfade, minimize)
    this.m = { sx: 1, sy: 1 };
    this.box = { y: null, h: null, w: null };
    this.slide = null;      // { to, travel, peak, squashed } while a slide runs
    this.clone = null;      // Tier B clone-magnify layer
    this.frames = 0;
    this.offFrame = null;
    this.dirty = false;
    this.guard = 0;
    this.dead = false;

    this.fill = I.part(host, `glass-${name}-pill`);
    this.lensEl = I.part(host, `glass glass-${name}-lens`);
    this.lens = I.register(this.lensEl, { latent: true, tone: host.getAttribute('data-lg-tone') || 'auto' });
    I.prepareLift(this.lens, lift);

    const paint = () => this.schedulePaint();
    this.x = new I.Spring({ preset: 'snappy', onUpdate: (x, v) => this.moved(x, v), onRest: () => this.rested() });
    this.w = new I.Spring({ preset: 'snappy', onUpdate: paint });
    this.squash = new I.Spring({ preset: 'unlift', onUpdate: paint });
    this.stretch = new I.Stretch({ axis: 'x', onUpdate: (m) => { this.m = m; paint(); } });

    this.lensEl.addEventListener('glass:tier', () => this.syncClone(), { signal });
    host.addEventListener('glass:tone', (e) => { if (e.target === host) this.setTone(e.detail.tone); }, { signal });
    // After a scrub the pointer was captured, so the browser's own click would land on the host
    // or re-click the pressed item. The component commits with .click() instead. After a touch
    // scrub no click comes at all, so the next press ends the wait.
    host.addEventListener('click', (e) => {
      if (!this.guard || !e.isTrusted || e.detail === 0) return; // detail 0: keyboard, AT
      this.endGuard();
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true, signal });
    host.addEventListener('pointerdown', () => this.endGuard(), { capture: true, signal });
  }

  // ── Geometry ─────────────────────────────────────────────────────────────
  /** Reads the host and item boxes (a layout read: call on setup, resize and pointerdown). */
  measure() {
    const host = this.host, r = host.getBoundingClientRect();
    const k = (this.scale = r.width / (host.offsetWidth || 1) || 1);
    const ox = r.left + host.clientLeft * k, oy = r.top + host.clientTop * k;
    this.origin = [ox, oy];
    this.slots = this.items().map((el) => {
      const b = el.getBoundingClientRect();
      return { el, x: (b.left - ox) / k, y: (b.top - oy) / k, w: b.width / k, h: b.height / k };
    });
  }

  /** Client x → host px. */
  local(clientX) {
    return (clientX - this.origin[0]) / this.scale;
  }

  /** The selectable slot whose centre is nearest to cx. */
  nearest(cx) {
    let best = -1, dist = Infinity;
    this.slots.forEach((s, i) => {
      const d = Math.abs(s.x + s.w / 2 - cx);
      if (d < dist && this.selectable(i)) { dist = d; best = i; }
    });
    return best;
  }

  // ── Resting moves ────────────────────────────────────────────────────────
  /** Moves the pill to slot i: a slide with squash, a jump, or (reduced motion) a crossfade. */
  place(i, { animate = true } = {}) {
    this.index = i;
    const s = this.slots[i];
    if (!s) { this.show(false); return; }
    if (this.lifted) return; // the scrub's release decides where the pill goes
    this.setBox(s);
    if (this.shown && s.x === this.x.target && s.w === this.w.target) return;
    if (!animate || !this.shown) {
      this.x.jump(s.x);
      this.w.jump(s.w);
      this.show(true);
    } else if (I.reducedMotion()) this.crossfade(s);
    else this.slideTo(s, 'snappy');
  }

  /** Re-measures and puts the pill back on its slot without animation (resize, refresh). */
  relayout() {
    this.measure();
    if (!this.lifted) this.place(this.index, { animate: false });
  }

  slideTo(s, preset) {
    this.setBox(s);
    this.slide = { to: s.x, travel: Math.abs(s.x - this.x.value), peak: 0, squashed: false };
    this.x.to(s.x, { preset });
    this.w.to(s.w, { preset });
  }

  /** Reduced motion (§5.11): the pill jumps while a ghost of it fades out, over 120 ms. */
  crossfade(s) {
    const ghost = this.fill.cloneNode(false);
    this.fill.before(ghost);
    this.ghost?.stop();
    this.ghost = I.tween(this.fade, 0, 120, (v) => { ghost.style.opacity = fmt(v); });
    this.ghost.done.then(() => ghost.remove());
    this.x.jump(s.x);
    this.w.jump(s.w);
    this.fadeTween?.stop();
    this.fadeTween = I.tween(0, 1, 120, (v) => this.setFade(v));
  }

  show(on) {
    this.shown = on;
    this.fill.style.visibility = on ? '' : 'hidden';
  }

  setFade(v) {
    this.fade = v;
    this.schedulePaint();
  }

  /** Vertical box of both parts (layout writes, only when a slot's row changes). */
  setBox(s) {
    if (s.y === this.box.y && s.h === this.box.h) return;
    this.box.y = s.y;
    this.box.h = s.h;
    for (const el of [this.fill, this.lensEl]) {
      el.style.top = `${fmt(s.y, 2)}px`;
      el.style.height = `${fmt(s.h, 2)}px`;
    }
  }

  moved(x, v) {
    const s = this.slide;
    if (s && !s.squashed) {
      s.peak = Math.max(s.peak, Math.abs(v));
      if (Math.abs(x - s.to) <= Math.max(0.75, 0.12 * s.travel)) {
        s.squashed = true;
        // e_arrive = 0.5 · e(v) (§5.4), as an impulse whose swing peaks at e: a jelly compression.
        const e = 0.5 * I.stretchAmount(s.peak);
        if (e > 0.003 && !I.reducedMotion()) this.squash.to(0, { preset: 'unlift', velocity: e / SQUASH_PEAK });
      }
    }
    this.stretch.update(v, 0);
    if (this.lifted) this.setPreview(this.nearest(x + this.w.value / 2));
    this.schedulePaint();
  }

  rested() {
    this.slide = null;
    this.stretch.release();
  }

  // ── Lens ─────────────────────────────────────────────────────────────────
  /** Lifts the lens; with cx, the pill also heads for that centre (host px). */
  lift(cx = null) {
    if (this.lifted || this.dead) return;
    this.lifted = true;
    this.slide = null;
    // Tier C is opaque: a lifted lens would hide the items, so the flat pill scrubs alone.
    if (this.lens.tier === 'a' || this.lens.tier === 'b') {
      this.track(I.lift(this.lens, this.liftOpts));
      this.syncClone();
    }
    this.setPreview(this.nearest(this.x.value + this.w.value / 2));
    if (cx != null) this.scrub(cx);
  }

  /** Pill centre → cx (host px) on the lift spring, rubber-banded past the first and last slot. */
  scrub(cx) {
    const first = this.slots[0], last = this.slots[this.slots.length - 1];
    if (!this.lifted || !first) return;
    const w = this.w.value, lo = first.x, hi = last.x + last.w - w;
    let x = cx - w / 2;
    if (x < lo) x = lo - rubber(lo - x);
    else if (x > hi) x = hi + rubber(x - hi);
    this.x.to(x, { preset: 'lift' });
  }

  /** Ends a scrub on the slot nearest the pointer; returns its index (the caller commits it). */
  release() {
    const i = this.nearest(this.x.target + this.w.target / 2);
    this.drop(i);
    return i;
  }

  /** Ends a scrub back on the committed slot. */
  cancel() {
    this.drop(this.index);
  }

  drop(i) {
    if (!this.lifted) return;
    this.lifted = false;
    this.setPreview(i); // keeps the tint on the landing item while the lens settles
    const s = this.slots[i];
    if (s) this.slideTo(s, 'snappy');
    this.endGuard();
    this.guard = setTimeout(() => { this.guard = 0; }, CLICK_GUARD_MS);
    const settled = () => {
      if (this.lifted || this.dead) return;
      this.setPreview(-1);
      this.syncClone();
    };
    if (this.lens.lifted) this.track(I.unlift(this.lens).then(settled));
    else settled();
  }

  endGuard() {
    clearTimeout(this.guard);
    this.guard = 0;
  }

  setPreview(i) {
    if (i === this.preview) return;
    const cls = this.previewClass;
    if (cls) {
      this.slots[this.preview]?.el.classList.remove(cls);
      this.slots[i]?.el.classList.add(cls);
      this.clone?.items.forEach((c, j) => c.classList.toggle(cls, j === i));
    }
    this.preview = i;
  }

  setTone(tone) {
    if (tone && tone !== this.lens.o.tone && !this.dead) this.lens.update({ tone });
  }

  /** Repaints every frame while a lift or unlift runs: the core's lift spring drives the lens
   * scale and --_lg-lift, which the resting pill and the clone layer follow. */
  track(promise) {
    if (!this.frames++) this.offFrame = I.onFrame(() => this.schedulePaint());
    promise.finally(() => {
      if (--this.frames === 0) { this.offFrame?.(); this.offFrame = null; }
      this.schedulePaint();
    });
  }

  // ── Tier B clone-magnify ─────────────────────────────────────────────────
  syncClone() {
    const want = this.lens.lifted && this.lens.tier === 'b' && !this.dead;
    if (want && !this.clone) this.buildClone();
    else if (!want && this.clone) {
      this.clone.clip.remove();
      this.clone = null;
    }
  }

  buildClone() {
    const clip = I.part(this.lensEl, `glass-${this.name}-clip`), layer = document.createElement('span');
    clip.inert = true;
    const items = this.slots.map((s, i) => {
      const c = I.inertClone(s.el); // never picked up as glass either
      for (const n of [c, ...c.querySelectorAll('.glass')]) n.classList.remove('glass');
      Object.assign(c.style, { position: 'absolute', left: `${s.x}px`, top: `${s.y}px`, width: `${s.w}px`, height: `${s.h}px`, margin: '0', translate: '', opacity: '' });
      if (this.previewClass) c.classList.toggle(this.previewClass, i === this.preview);
      return c;
    });
    layer.append(...items);
    clip.append(layer);
    this.clone = { clip, layer, items };
    this.schedulePaint();
  }

  /**
   * Maps the clones onto the real items magnified by z about the lens centre. A clone at host
   * position q must appear at c + z·(q − c), where c is the lens's on-screen centre; inside the
   * lens (scaled by S about its centre C) that is L = C + (z/S)·(q − c).
   */
  paintClone(lift) {
    const z = 1 + (this.liftOpts.zoom - 1) * lift;
    const { sx, sy, tx, ty } = this.lens.transform;
    const Cx = this.w.value / 2, Cy = this.box.h / 2;
    const cx = tx + Cx, cy = this.box.y + ty + Cy;
    const kx = z / sx, ky = z / sy;
    this.clone.layer.style.transform = `matrix(${fmt(kx, 4)}, 0, 0, ${fmt(ky, 4)}, ${fmt(Cx - kx * cx, 2)}, ${fmt(Cy - ky * cy, 2)})`;
  }

  // ── Paint ────────────────────────────────────────────────────────────────
  /** Coalesces writes into one per frame: a microtask runs after the core's rAF tick, so it
   * sees the lift spring's latest values. */
  schedulePaint() {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      this.dirty = false;
      if (!this.dead) this.paint();
    });
  }

  paint() {
    const x = this.x.value, w = this.w.value, q = this.squash.value;
    // Velocity stretch elongates along x; the arrival squash compresses along x and bulges in y.
    const sx = this.m.sx / (1 + q), sy = this.m.sy * (1 + q);
    const lift = clamp(parseFloat(this.lensEl.style.getPropertyValue('--_lg-lift')) || 0, 0, 1);
    const f = this.fill.style, opacity = this.fade * (1 - lift);
    f.translate = `${fmt(x, 2)}px 0`;
    f.scale = sx === 1 && sy === 1 ? '' : `${fmt(sx, 4)} ${fmt(sy, 4)}`;
    f.opacity = opacity === 1 ? '' : fmt(opacity);
    if (w !== this.box.w) {
      this.box.w = w;
      f.width = this.lensEl.style.width = `${fmt(w, 2)}px`;
    }
    I.setChannel(this.lens, 'pill', { tx: x, sx, sy });
    if (this.clone) this.paintClone(lift);
  }

  destroy() {
    this.dead = true;
    this.endGuard();
    this.offFrame?.();
    this.offFrame = null;
    this.setPreview(-1);
    for (const s of [this.x, this.w, this.squash]) s.stop();
    this.stretch.stop();
    this.fadeTween?.stop();
    this.ghost?.stop();
    this.lens.destroy();
    this.fill.remove();
    this.lensEl.remove();
  }
}

I.Pill = Pill;
})(); } catch (e) { console.error('[liquid-glass] comp-pill.js failed', e); }
// ── comp-tabbar.js ──────────────────────────────────────────────────────────
try { (function () {
// Floating tab bar (§4.7.2, §5.4). The selection pill slides to a tapped tab. Holding a tab
// (≥ 180 ms) or dragging sideways (> 6 px) lifts the pill into a lens that scrubs across the tabs,
// tints the tab under it, and commits with .click() on release. aria-current marks the selected
// tab and arrow keys move focus between tabs. With data-glass-minimize="scroll" the bar collapses
// to the active tab while the page scrolls down, and expands on scroll-up, at the top, on tap or
// on focus.

const HOLD_MS = 180;
const DRAG_PX = 6;
const TAP_CLICK_MS = 500;   // how long after a press on the minimized bar its click may follow
const PAN_PX = 10;          // vertical travel that leaves the gesture to page scrolling
const MINIMIZE_AFTER = 64;  // scroll offset past which scrolling down minimizes
const SCROLL_INTENT = 12;   // px of scrolling in one direction before the bar reacts
const TOP_PX = 8;           // at or above this offset the bar always expands
const SCRUBBING = 'data-lgc-scrubbing'; // state on the bar: attributes, as a class change on glass refreshes it
const MINIMIZED = 'data-lgc-minimized';
const PREVIEW = 'glass-tab-preview';

const { clamp, fmt } = I;

const isCurrent = (el) => {
  const v = el.getAttribute('aria-current');
  return v != null && v !== 'false';
};
const isDisabled = (el) => el.getAttribute('aria-disabled') === 'true';

class TabBar {
  constructor(bar, handle, signal) {
    this.bar = bar;
    this.handle = handle || I.register(bar); // the bar is the glass
    this.ownHandle = !handle;
    this.items = [];
    this.gesture = null;   // { id, x0, y0, x, timer, lifted, ctl }
    this.tapExpands = false; // a press on the minimized bar: its click expands instead of navigating
    this.tapTimer = 0;
    this.tapCtl = null;
    this.expandedMark = null; // the tab that carries aria-expanded="false" while minimized
    this.minimized = false;
    this.fold = null;      // minimize animation (null when fully expanded)
    this.scroll = null;    // AbortController of the minimize-on-scroll listener
    this.scrollTops = new WeakMap();
    this.intent = 0;
    this.unobserve = [];
    this.relayoutQueued = false;
    this.dead = false;

    this.collect();
    this.pill = new I.Pill(bar, {
      name: 'tab', items: () => this.items, preview: PREVIEW, signal,
      // Clearer than the core's lens (σ .6), so 11 px labels stay crisp under magnification.
      lift: { zoom: 1.18, dispersion: 0.8, grow: { px: 8 }, blur: 0.4 },
      selectable: (i) => !isDisabled(this.items[i]),
    });
    this.pill.measure();
    this.pill.place(this.current(), { animate: false });

    const on = (type, fn, o) => bar.addEventListener(type, fn, { signal, ...o });
    on('pointerdown', (e) => this.down(e));
    on('click', (e) => this.clicked(e));
    // An aria-disabled tab is inert, like a disabled control: no navigation, no author handlers.
    on('click', (e) => {
      const item = this.items.find((el) => el.contains(e.target));
      if (item && isDisabled(item)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, { capture: true });
    on('keydown', (e) => this.key(e));
    on('dragstart', (e) => e.preventDefault()); // links would start a native drag instead of a scrub
    on('contextmenu', (e) => { if (this.gesture?.lifted) e.preventDefault(); });
    on('focusin', () => { if (!this.tapExpands) this.minimize(false); });
    this.mo = new MutationObserver((records) => this.mutated(records));
    this.mo.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current'] });
    this.watchScroll();
  }

  /** The tabs: direct <a> and <button> children. Their sizes (and the bar's) place the pill. */
  collect() {
    this.items = [...this.bar.children].filter((el) => el.matches('a, button'));
    if (!this.items.length) I.debugWarn(this.bar, 'tabbar-items', 'a .glass-tabbar needs its tabs as direct <a> or <button> children; this one has none, so it gets no pill.');
    for (const off of this.unobserve) off();
    this.unobserve = [this.bar, ...this.items].map((el) => I.observeResize(el, () => this.resized()));
  }

  /** One relayout per batch of resize entries. */
  resized() {
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    queueMicrotask(() => {
      this.relayoutQueued = false;
      if (!this.fold && !this.dead) this.pill.relayout();
    });
  }

  current() {
    return this.items.findIndex(isCurrent);
  }

  /** Moves aria-current (keeping the author's token, e.g. "page") and the pill to `item`. */
  select(item) {
    const prev = this.items.find(isCurrent);
    if (prev !== item) {
      const token = prev?.getAttribute('aria-current') || 'page';
      prev?.removeAttribute('aria-current');
      item.setAttribute('aria-current', token);
    }
    this.pill.place(this.items.indexOf(item));
  }

  mutated(records) {
    let items = false, selection = false;
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.target === this.bar && [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && n.matches('a, button'))) items = true;
      } else if (this.items.includes(r.target)) selection = true;
    }
    if (items) { this.collect(); this.pill.relayout(); }
    if (selection && !this.fold) this.pill.place(this.current());
    // Minimized, the circle shows the current tab (CSS); it carries the collapsed state.
    if (selection && this.minimized && !this.fold?.spring.active) this.markCollapsed(this.items[this.current()] || null);
  }

  // ── Pointer: tap, hold-to-lift, scrub ────────────────────────────────────
  down(e) {
    if (e.button !== 0 || !e.isPrimary || this.gesture) return;
    if (this.minimized) this.pressMinimized();
    if (this.minimized || this.fold || !this.items.length) return;
    this.pill.measure();
    const g = (this.gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, lifted: false, ctl: new AbortController() });
    g.timer = setTimeout(() => this.lift(), HOLD_MS);
    // Until the lift captures the pointer, it may leave the bar: follow it on the window.
    const opts = { capture: true, signal: g.ctl.signal };
    addEventListener('pointermove', (ev) => this.move(ev), opts);
    addEventListener('pointerup', (ev) => this.up(ev, true), opts);
    addEventListener('pointercancel', (ev) => this.up(ev, false), opts);
  }

  move(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX;
    if (g.lifted) { this.pill.scrub(this.pill.local(e.clientX)); return; }
    const dx = Math.abs(e.clientX - g.x0), dy = Math.abs(e.clientY - g.y0);
    if (dx > DRAG_PX && dx > dy) this.lift();
    else if (dy > PAN_PX) this.end(false);
  }

  lift() {
    const g = this.gesture;
    if (!g || g.lifted) return;
    clearTimeout(g.timer);
    g.lifted = true;
    try { this.bar.setPointerCapture(g.id); } catch { /* the pointer is already gone */ }
    this.bar.setAttribute(SCRUBBING, '');
    this.pill.lift(this.pill.local(g.x));
  }

  up(e, commit) {
    if (this.gesture && e.pointerId === this.gesture.id) this.end(commit);
  }

  /** A tap is left to the browser (the link's own click); a scrub commits here. */
  end(commit) {
    const g = this.gesture;
    this.gesture = null;
    clearTimeout(g.timer);
    g.ctl.abort();
    if (!g.lifted) return;
    this.bar.removeAttribute(SCRUBBING);
    if (!commit) { this.pill.cancel(); return; }
    const i = this.pill.release();
    if (i >= 0 && i !== this.current()) this.items[i].click();
    this.pill.place(this.current());
  }

  /**
   * A press on the minimized bar: the click that follows expands it instead of navigating, and
   * the focus the press brings (after touchend on touch screens) must not expand it first. A
   * press that ends elsewhere brings no click, so the flag lapses soon after the release.
   */
  pressMinimized() {
    this.tapExpands = true;
    clearTimeout(this.tapTimer);
    this.tapCtl?.abort();
    const ctl = (this.tapCtl = new AbortController());
    const released = () => {
      ctl.abort();
      this.tapTimer = setTimeout(() => { this.tapExpands = false; }, TAP_CLICK_MS);
    };
    addEventListener('pointerup', released, { capture: true, signal: ctl.signal });
    addEventListener('pointercancel', released, { capture: true, signal: ctl.signal });
  }

  clicked(e) {
    if (this.minimized || this.tapExpands) { // the collapsed bar is one button: expand
      this.tapExpands = false;
      e.preventDefault();
      this.minimize(false);
      return;
    }
    const item = this.items.find((el) => el.contains(e.target));
    if (item) this.select(item);
  }

  // ── Keyboard: arrows move focus between tabs; Enter/Space activate natively ─
  key(e) {
    const i = this.items.indexOf(e.target), n = this.items.length;
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = getComputedStyle(this.bar).direction === 'rtl' ? -1 : 1;
    const to = { ArrowRight: i + step, ArrowLeft: i - step, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    this.items[(to + n) % n].focus();
  }

  // ── Minimize on scroll ───────────────────────────────────────────────────
  watchScroll() {
    const want = this.bar.getAttribute('data-glass-minimize') === 'scroll';
    if (want === !!this.scroll) return;
    if (want) {
      this.scroll = new AbortController();
      document.addEventListener('scroll', (e) => this.scrolled(e), { capture: true, passive: true, signal: this.scroll.signal });
    } else {
      this.scroll.abort();
      this.scroll = null;
      this.minimize(false);
    }
  }

  /** The page, or an inner scroller the bar floats over, drives the minimized state. */
  scrolled(e) {
    if (this.gesture) return;
    const page = e.target === document, el = page ? document.scrollingElement : e.target;
    if (!(el instanceof Element)) return;
    if (!page) {
      const s = el.getBoundingClientRect(), b = this.bar.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      if (cx < s.left || cx > s.right || cy < s.top || cy > s.bottom) return;
    }
    const y = el.scrollTop, dy = y - (this.scrollTops.get(el) ?? y);
    this.scrollTops.set(el, y);
    if (y <= TOP_PX) { this.intent = 0; this.minimize(false); return; }
    this.intent = Math.sign(dy) === Math.sign(this.intent) ? this.intent + dy : dy;
    if (this.intent > SCROLL_INTENT && y > MINIMIZE_AFTER) this.minimize(true);
    else if (this.intent < -SCROLL_INTENT) this.minimize(false);
  }

  /**
   * Collapses the bar to the active tab's circle (on = true) or expands it. The bar keeps its
   * expanded layout while an inline width animates (glass must not be scaled out of shape), and
   * the active tab and its icon are offset every frame so they glide to the circle's centre;
   * the other tabs, the label and the pill fade. The minimized state applies at the end.
   */
  minimize(on) {
    if (on === this.minimized) return;
    const k = this.current();
    if (on && (k < 0 || this.gesture)) return;
    this.minimized = on;
    const f = this.fold ?? (this.fold = this.foldState());
    if (!f) { this.minimized = false; return; }
    if (!on && !f.spring.active && f.spring.value === 1) { // expanding from rest: back to the full layout
      this.bar.removeAttribute(MINIMIZED);
      this.markCollapsed(null);
      const now = this.current();
      Object.assign(f, this.measureFold(now >= 0 ? now : f.k, f));
      this.paintFold(1);
    }
    if (I.reducedMotion()) f.spring.jump(on ? 1 : 0);
    else f.spring.to(on ? 1 : 0, { preset: 'snappy' });
  }

  foldState() {
    const k = this.current();
    if (k < 0) return null;
    const s = this.bar.style;
    const f = { saved: { width: s.width, flex: s.flex }, ...this.measureFold(k) };
    f.spring = new I.Spring({ preset: 'snappy', onUpdate: (p) => this.paintFold(p), onRest: (p) => this.foldRested(p) });
    I.beginAnimation(this.handle); // one filter fork while the width changes
    return f;
  }

  /**
   * Geometry of the full-width layout; an inline fold width is lifted for the reading. Positions
   * run along the inline axis from the bar's inline-start edge (the edge that stays put as the
   * width shrinks), so right-to-left bars fold the same way, mirrored.
   */
  measureFold(k, prev) {
    const bar = this.bar, s = bar.style;
    if (prev) Object.assign(s, prev.saved);
    const W = bar.offsetWidth, H = bar.offsetHeight, br = bar.getBoundingClientRect(), scale = br.width / (W || 1) || 1;
    const sign = getComputedStyle(bar).direction === 'rtl' ? -1 : 1;
    const px = (v) => (sign > 0 ? v - br.left : br.right - v) / scale;
    const start = (r) => (sign > 0 ? r.left : r.right), end = (r) => (sign > 0 ? r.right : r.left);
    const item = this.items[k], ir = item.getBoundingClientRect();
    const lo = px(start(this.items[0].getBoundingClientRect())), hi = px(end(this.items[this.items.length - 1].getBoundingClientRect()));
    const icon = item.querySelector(':scope > svg, :scope > img'), label = item.querySelector(':scope > span');
    const ic = icon?.getBoundingClientRect();
    return {
      k, item, icon, label, W, H, lo, hi, sign,
      fx: (px(ir.left + ir.width / 2) - lo) / (hi - lo || 1), // the tab centre as a fraction of the content box
      dy: ic ? (ir.top + ir.height / 2 - (ic.top + ic.height / 2)) / scale : 0,
      others: this.items.filter((el) => el !== item),
    };
  }

  paintFold(p) {
    const f = this.fold, q = clamp(p, 0, 1), s = this.bar.style;
    const W = I.lerp(f.W, f.H, q), end = f.W - f.hi;
    s.width = `${fmt(W, 2)}px`;
    s.flex = 'none';
    const layout = f.lo + f.fx * (W - f.lo - end);            // where the full layout puts the tab
    const wanted = I.lerp(f.lo + f.fx * (f.hi - f.lo), f.H / 2, q); // where it should appear
    f.item.style.translate = `${fmt(f.sign * (wanted - layout), 2)}px 0`;
    if (f.icon) f.icon.style.translate = `0 ${fmt(f.dy * q, 2)}px`;
    if (f.label) f.label.style.opacity = fmt(1 - clamp(2 * q, 0, 1));
    const fade = 1 - clamp(2.5 * q, 0, 1);
    for (const el of f.others) el.style.opacity = fmt(fade);
    this.pill.setFade(fade);
  }

  foldRested(p) {
    const f = this.fold;
    if (!f || (p !== 0 && p !== 1)) return;
    for (const el of [f.item, f.icon, f.label, ...f.others]) if (el) el.style.translate = el.style.opacity = '';
    if (p === 1) {
      this.bar.setAttribute(MINIMIZED, '');
      this.markCollapsed(this.items[this.current()] || null);
      return;
    }
    this.markCollapsed(null);
    Object.assign(this.bar.style, f.saved);
    this.fold = null;
    I.endAnimation(this.handle);
    this.pill.setFade(1);
    // aria-current may have moved while the bar was folded (a router): the pill goes there.
    this.pill.measure();
    this.pill.place(this.current(), { animate: false });
  }

  /** The minimized bar is its current tab: that link is exposed as collapsed (activating it expands). */
  markCollapsed(item) {
    if (this.expandedMark === item) return;
    this.expandedMark?.removeAttribute('aria-expanded');
    item?.setAttribute('aria-expanded', 'false');
    this.expandedMark = item;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  refresh() {
    this.collect();
    if (!this.fold) this.pill.relayout();
  }

  attributeChanged(name) {
    if (name === 'data-glass-minimize') this.watchScroll();
  }

  destroy() {
    this.dead = true;
    if (this.gesture) { clearTimeout(this.gesture.timer); this.gesture.ctl.abort(); }
    clearTimeout(this.tapTimer);
    this.tapCtl?.abort();
    this.scroll?.abort();
    this.mo.disconnect();
    for (const off of this.unobserve) off();
    const f = this.fold;
    if (f) {
      this.fold = null; // so stopping the spring does not run foldRested
      f.spring.stop();
      for (const el of [f.item, f.icon, f.label, ...f.others]) if (el) el.style.translate = el.style.opacity = '';
      Object.assign(this.bar.style, f.saved);
      I.endAnimation(this.handle);
    }
    this.markCollapsed(null);
    this.bar.removeAttribute(SCRUBBING);
    this.bar.removeAttribute(MINIMIZED);
    this.pill.destroy();
    if (this.ownHandle) this.handle.destroy();
  }
}

I.defineComponent('tabbar', {
  selector: '.glass-tabbar',
  attributes: ['data-glass-minimize'],
  setup: (bar, { handle, signal }) => new TabBar(bar, handle, signal),
});
})(); } catch (e) { console.error('[liquid-glass] comp-tabbar.js failed', e); }
// ── comp-segmented.js ───────────────────────────────────────────────────────
try { (function () {
// Segmented control (§4.7.5, §5.7): a native radio group whose pill slides to the checked
// segment with an arrival squash. Pressing the checked segment lifts it into a lens (scale 1.1,
// zoom 1.1, dispersion .5); dragging scrubs across the segments and the choice commits on
// release through the radio's own click, so `input` and `change` fire natively. Arrow keys,
// forms and assistive technology keep the radios' native behaviour.

const RADIO = ':scope > input[type="radio"]';

let checkedProperty = null; // HTMLInputElement.prototype's `checked` descriptor (read on first setup)

class Segmented {
  constructor(el, handle, signal) {
    this.el = el;
    this.handle = handle || I.register(el); // the track is the glass
    this.ownHandle = !handle;
    this.segments = [];
    this.inputs = [];
    this.named = new Set(); // inputs that got a generated group name
    this.watched = new Map(); // input → its own `checked` descriptor before ours (or undefined)
    this.gesture = null;   // { id, grab, ctl }
    this.resetTimer = 0;
    checkedProperty ??= Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');

    if (!el.matches('fieldset') && !el.hasAttribute('role')) {
      el.setAttribute('role', 'radiogroup');
      this.addedRole = true;
    }
    this.collect();
    this.pill = new I.Pill(el, {
      name: 'segmented', items: () => this.segments, signal,
      lift: { zoom: 1.1, dispersion: 0.5, grow: 1.1, blur: 0.4 }, // clear enough for crisp labels
      selectable: (i) => !this.inputs[i].matches(':disabled'),
    });
    this.pill.measure();
    this.pill.place(this.checked(), { animate: false });
    this.unobserve = I.observeResize(el, () => this.pill.relayout());

    const on = (type, fn, o) => el.addEventListener(type, fn, { signal, ...o });
    on('pointerdown', (e) => this.down(e));
    on('change', () => this.sync());
    on('dragstart', (e) => e.preventDefault());
    // A form reset restores checkedness after its event, without events of its own.
    el.closest('form')?.addEventListener('reset', () => { this.resetTimer = setTimeout(() => this.sync()); }, { signal });
    this.mo = new MutationObserver((records) => {
      if (records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && n.matches('label')))) {
        this.collect();
        this.pill.relayout();
        this.sync();
      }
    });
    this.mo.observe(el, { childList: true });
  }

  /** Segments are direct <label> children that hold a radio. */
  collect() {
    this.unwatch();
    this.segments = [...this.el.querySelectorAll(':scope > label')].filter((l) => l.querySelector(RADIO));
    this.inputs = this.segments.map((l) => l.querySelector(RADIO));
    if (!this.segments.length) I.debugWarn(this.el, 'segmented-items', 'a .glass-segmented needs <label> children that each hold an <input type="radio">; this one has none.');
    // Radios only form a group (native arrow keys, one checked) when they share a name.
    const name = this.inputs.find((i) => i.name)?.name || I.uniqueId('lg-seg-');
    for (const input of this.inputs) {
      if (!input.name) { input.name = name; this.named.add(input); }
      this.watch(input);
    }
  }

  /**
   * Follows programmatic `input.checked = …` (frameworks set it on controlled inputs), which
   * fires no event: an own accessor forwards to the previous one and then re-syncs the pill.
   * A framework's own accessor (React's value tracker) stays in the chain and is restored.
   */
  watch(input) {
    const own = Object.getOwnPropertyDescriptor(input, 'checked'), inner = own ?? checkedProperty, self = this;
    this.watched.set(input, own);
    Object.defineProperty(input, 'checked', {
      configurable: true,
      enumerable: true,
      get() { return inner.get.call(this); },
      set(v) { inner.set.call(this, v); self.sync(); },
    });
  }

  unwatch() {
    for (const [input, own] of this.watched) {
      if (own) Object.defineProperty(input, 'checked', own);
      else delete input.checked;
    }
    this.watched.clear();
  }

  checked() {
    return this.inputs.findIndex((i) => i.checked);
  }

  sync() {
    this.pill.place(this.checked());
  }

  // ── Pointer: press the checked segment to lift it, drag to scrub ─────────
  down(e) {
    if (e.button !== 0 || !e.isPrimary || this.gesture) return;
    const i = this.segments.findIndex((l) => l.contains(e.target));
    if (i < 0 || i !== this.checked() || this.inputs[i].matches(':disabled')) return; // other segments: a native tap
    this.pill.measure();
    const s = this.pill.slots[i], g = (this.gesture = { id: e.pointerId, ctl: new AbortController() });
    g.grab = this.pill.local(e.clientX) - (s.x + s.w / 2); // keep the grab point under the pointer
    try { this.el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    const opts = { capture: true, signal: g.ctl.signal };
    addEventListener('pointermove', (ev) => this.move(ev), opts);
    addEventListener('pointerup', (ev) => this.up(ev, true), opts);
    addEventListener('pointercancel', (ev) => this.up(ev, false), opts);
    this.pill.lift();
  }

  move(e) {
    const g = this.gesture;
    if (g && e.pointerId === g.id) this.pill.scrub(this.pill.local(e.clientX) - g.grab);
  }

  up(e, commit) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    g.ctl.abort();
    if (!commit) { this.pill.cancel(); return; }
    const i = this.pill.release(), input = this.inputs[i];
    if (input && !input.checked) {
      const focused = this.el.contains(document.activeElement);
      input.click(); // checks it and fires input + change, as a tap would
      if (focused) input.focus({ preventScroll: true });
    }
    this.sync(); // back to the checked segment if a click handler cancelled the change
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  refresh() {
    this.collect();
    this.pill.relayout();
  }

  destroy() {
    this.gesture?.ctl.abort();
    clearTimeout(this.resetTimer);
    this.mo.disconnect();
    this.unobserve();
    this.unwatch();
    for (const input of this.named) input.removeAttribute('name');
    if (this.addedRole) this.el.removeAttribute('role');
    this.pill.destroy();
    if (this.ownHandle) this.handle.destroy();
  }
}

I.defineComponent('segmented', {
  selector: '.glass-segmented',
  setup: (el, { handle, signal }) => new Segmented(el, handle, signal),
});
})(); } catch (e) { console.error('[liquid-glass] comp-segmented.js failed', e); }
}]
]);
