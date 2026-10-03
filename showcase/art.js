/*
 * LGArt: seeded procedural art for the Liquid Glass for the Web showcase.
 *
 * Glass is only visible over dense, high-contrast detail, so every generator covers its whole
 * canvas with colour, crisp hairlines and small type. The output is a pure function of
 * (generator, seed, theme, CSS size, DPR). No network, no images, no fonts beyond the system stack.
 *
 *   LGArt.aurora(canvas, { seed, theme })             render once → { width, height, dpr, ms }
 *   LGArt.typeSpecimen | landscape | mosaic | poster  same signature
 *   LGArt.render(canvas, name, opts)                  the same, by name (LGArt.names lists them)
 *   LGArt.mount(canvas, 'aurora', { animate: true })  render, then keep it rendered → handle
 *   LGArt.toPNG(canvas)                               Promise<blob URL>; the caller revokes it
 *
 * Common options: seed (number or string, default 1), theme ('light' | 'dark'; default per generator),
 * dpr (default devicePixelRatio, capped at 2), width / height (CSS px; default the canvas's CSS box;
 * use them for detached or export canvases). Aurora also takes t (seconds along its drift) and
 * word (the outlined type; '' for none); mosaic takes columns.
 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const SANS = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
  const font = (weight, size, family = SANS) => `${weight} ${size}px ${family}`;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------------ randomness */

  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // FNV-1a, so string seeds ("hero", "footer") work as well as numbers.
  function hash32(value) {
    const s = String(value);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }

  // One independent stream per layer, so adding a star never reshuffles the mountains.
  function stream(seed, name) {
    const next = mulberry32(hash32(seed) ^ Math.imul(hash32(name), 0x9e3779b1));
    next.range = (a, b) => a + (b - a) * next();
    next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
    next.pick = (list) => list[Math.floor(next() * list.length)];
    next.gauss = () => (next() + next() + next() - 1.5) * 2; // cheap bell curve, roughly N(0, 1)
    return next;
  }

  /* ------------------------------------------------------------------ colour */

  const rgbOf = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (hex, a) => `rgba(${rgbOf(hex).join(',')},${a})`;
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (h1, h2, t) => {
    const a = rgbOf(h1), b = rgbOf(h2);
    return toHex(a.map((v, i) => lerp(v, b[i], t)));
  };
  const toLinear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const linearOf = (hex) => rgbOf(hex).map(toLinear);
  const luminance = (hex) => {
    const [r, g, b] = linearOf(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // Linear light → sRGB byte through a table: the aurora field encodes ~80k channels per frame.
  const ENCODE = new Uint8ClampedArray(4096);
  for (let i = 0; i < 4096; i++) {
    const l = i / 4095;
    ENCODE[i] = Math.round(255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055));
  }
  const encode = (l) => ENCODE[l <= 0 ? 0 : l >= 1 ? 4095 : (l * 4095 + 0.5) | 0];

  // OKLCH → sRGB hex (clipped). Equal L and C give ramps whose steps look evenly spaced.
  function oklch(L, C, hue) {
    const a = C * Math.cos((hue * Math.PI) / 180), b = C * Math.sin((hue * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return toHex([
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => encode(v)));
  }

  // Approximate colour of a visible wavelength (after Dan Bruton), with the dim ends of the eye's range.
  function wavelength(nm) {
    let r = 0, g = 0, b = 0;
    if (nm < 440) { r = (440 - nm) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
    else r = 1;
    const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
    return toHex([r, g, b].map((v) => 255 * (v * f) ** 0.8));
  }

  const SPECTRUM = ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2'];

  /* ------------------------------------------------------------------ canvas plumbing */

  const makeCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };

  function resetState(ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.shadowColor = 'transparent';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.setLineDash([]);
    track(ctx, 0);
  }

  // Size the bitmap to the CSS box × DPR and set a CSS-px transform. Returns null for an
  // unlaid-out canvas (display:none, detached without width/height) so callers can skip quietly.
  function surface(canvas, o) {
    const w = o.width || canvas.clientWidth;
    const h = o.height || canvas.clientHeight;
    if (!(w > 0 && h > 0)) return null;
    const dpr = Math.min(2, o.dpr || window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;
    resetState(ctx);
    const sx = W / w, sy = H / h;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    const seed = o.seed ?? 1;
    return { canvas, ctx, w, h, sx, sy, dpr: sx, dark: o.theme === 'dark', o, rng: (name) => stream(seed, name) };
  }

  // Canvas letter-spacing where the engine supports it; elsewhere type is simply set untracked.
  function track(ctx, px) {
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`;
  }

  // Axis-aligned rules as rects snapped to the device grid, so a 1px line is exactly one (or two) device rows.
  const snap = (env, v) => Math.round(v * env.dpr) / env.dpr;
  function hRule(ctx, env, x, y, len, t = 1) {
    ctx.fillRect(x, snap(env, y), len, Math.max(1, Math.round(t * env.dpr)) / env.dpr);
  }
  function vRule(ctx, env, x, y, len, t = 1) {
    ctx.fillRect(snap(env, x), y, Math.max(1, Math.round(t * env.dpr)) / env.dpr, len);
  }

  // Film grain: a 256² tile of signed noise at device resolution, alpha averaging `amount`.
  const grainTiles = new Map();
  function grain(ctx, amount) {
    let tile = grainTiles.get(amount);
    if (!tile) {
      tile = makeCanvas(256, 256);
      const g = tile.getContext('2d');
      const img = g.createImageData(256, 256);
      const d = img.data, r = stream('grain', amount);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = r() < 0.5 ? 0 : 255;
        d[i + 3] = r() * amount * 2 * 255;
      }
      g.putImageData(img, 0, 0);
      grainTiles.set(amount, tile);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ text */

  const COPY = `Light does not cross a pane of glass in a straight line. It slows, bends and gathers where the surface curves, so the rim of every rounded shape carries a thin, bright copy of the world just beyond it. ¶
The centre stays calm. Content passes through undistorted, softened only by a breath of blur, while the edge does the optical work: compressing, brightening, catching a highlight from a light that is not really there. ¶
Interfaces borrowed this behaviour for a reason. A control made of glass sits above the content instead of beside it. It lets colour through, keeps its own quiet specular line, and adapts its tone to whatever moves beneath it, darker over light and lighter over dark, so a label never loses its contrast. ¶
Touch it and the material answers. A pill lifts into a lens, magnifies what it covers by a fifth, splits white light into a faint fringe of colour and settles back on a spring with a little overshoot. Nothing snaps. Everything refracts. ¶
Hairlines stay crisp at one device pixel. Type stays sharp at eight. Corners follow the exact radius of the shape, and concentric shapes share a centre, so a button inside a bar looks cut from the same sheet. ¶
Bezel 24 px · index 1.5 · blur 6 px · saturation 160% · highlight 0.9 · dispersion 4.8% · spring 0.35 s, bounce 0.15 · tone threshold 0.179. ¶
Glass belongs to the navigation layer. Content is the hero, and the glass is the frame through which it is seen; the frame should never compete with the picture. ¶`;

  const WORDS = COPY.split(/\s+/).filter(Boolean);
  const widthCache = new Map();
  function measure(ctx, text) {
    const key = `${ctx.font}|${ctx.letterSpacing}|${text}`;
    let v = widthCache.get(key);
    if (v === undefined) {
      if (widthCache.size > 4000) widthCache.clear();
      v = ctx.measureText(text).width;
      widthCache.set(key, v);
    }
    return v;
  }

  // An endless stream of words (the copy loops) broken greedily into lines of a given width.
  function textFlow(r) {
    let i = r.int(0, WORDS.length - 1);
    return {
      line(ctx, width) {
        const words = [];
        let natural = 0;
        const space = measure(ctx, ' ');
        for (;;) {
          const word = WORDS[i % WORDS.length];
          if (word === '¶') {
            i++;
            if (words.length) return { words, natural, last: true };
            continue;
          }
          const ww = measure(ctx, word);
          const add = words.length ? space + ww : ww;
          if (words.length && natural + add > width) return { words, natural, last: false };
          words.push(word);
          natural += add;
          i++;
        }
      },
    };
  }

  // Draw one line, justified unless it ends a paragraph (or would stretch absurdly). `mark` optionally
  // paints a highlight behind words [from, to] and redraws them in its own colour.
  function setLine(ctx, line, x, y, width, lineH, mark) {
    const { words, natural, last } = line;
    const space = measure(ctx, ' ');
    const slack = width - natural;
    const gap = !last && words.length > 1 && slack < width * 0.3 ? space + slack / (words.length - 1) : space;
    let cx = x;
    const xs = words.map((word) => {
      const at = cx;
      cx += measure(ctx, word) + gap;
      return at;
    });
    words.forEach((word, k) => ctx.fillText(word, xs[k], y));
    if (!mark || mark.from >= words.length) return;
    const to = Math.min(mark.to, words.length - 1);
    const x0 = xs[mark.from] - 3, x1 = xs[to] + measure(ctx, words[to]) + 3;
    ctx.save();
    ctx.fillStyle = mark.bg;
    ctx.fillRect(x0, y - lineH * 0.74, x1 - x0, lineH * 0.98);
    ctx.fillStyle = mark.fg;
    for (let k = mark.from; k <= to; k++) ctx.fillText(words[k], xs[k], y);
    ctx.restore();
  }

  /* ================================================================== generators
   * Each scene has a default theme and a build(env) that returns painters:
   *   paint(ctx, t)  the base layer (the only layer that moves when animated)
   *   detail(ctx)    optional static top layer; mount() caches it while animating
   */
  const scenes = {};

  /* ------------------------------------------------------------------ aurora */

  const AURORA = {
    dark: {
      base: ['#0b1d51', '#3a0b3f'],
      blobs: ['#ff375f', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2'],
      ink: '#ffffff',
    },
    light: {
      base: ['#fbf7fd', '#edf2fd'],
      blobs: ['#ff2d55', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'],
      ink: '#1a1840',
    },
  };

  scenes.aurora = {
    theme: 'dark',
    animated: true,
    build(env) {
      const { w, h, dark } = env;
      const pal = dark ? AURORA.dark : AURORA.light;
      const r = env.rng('aurora');
      const span = Math.hypot(w, h);

      // Glows sit on a loose ellipse in hue order, so neighbours blend into neighbouring hues and never
      // into mud. Each is an elongated, rotated gaussian (a ribbon rather than a disc), which leaves
      // dark sky between them. Each drifts and turns on its own slow path when animated.
      const count = r.int(5, 7);
      const turn = r() * TAU, dir = r() < 0.5 ? 1 : -1;
      const blobs = [];
      for (let i = 0; i < count; i++) {
        const a = turn + (dir * i * TAU) / count + r.range(-0.3, 0.3);
        const k = r.range(0.45, 1.05);
        const major = span * r.range(0.13, 0.2);
        blobs.push({
          x: w * (0.5 + 0.42 * k * Math.cos(a)),
          y: h * (0.5 + 0.42 * k * Math.sin(a)),
          a: major, b: major / r.range(1.4, 2.6), rot: a + Math.PI / 2 + r.range(-0.6, 0.6),
          s: dark ? r.range(0.85, 1) : r.range(0.8, 0.95),
          c: linearOf(pal.blobs[i % pal.blobs.length]),
          dx: w * r.range(0.04, 0.08), dy: h * r.range(0.05, 0.1), dr: r.range(0.15, 0.35),
          fx: r.range(0.1, 0.22), fy: r.range(0.08, 0.18),
          px: r() * TAU, py: r() * TAU,
        });
      }

      // The colour field is smooth, so it is evaluated on a coarse grid (~20–50k samples whatever the
      // size or DPR) and upscaled, which keeps animated frames cheap.
      const cell = Math.max(3, Math.ceil(Math.max(w, h) / 220));
      const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
      const low = makeCanvas(cols, rows);
      const lctx = low.getContext('2d');
      const image = lctx.createImageData(cols, rows);
      const A = linearOf(pal.base[0]), B = linearOf(pal.base[1]);
      const CHROMA = 1.2;

      function field(t) {
        const live = blobs.map((b) => {
          const rot = b.rot + b.dr * Math.sin(t * b.fy + b.px);
          return {
            x: b.x + b.dx * Math.sin(t * b.fx + b.px),
            y: b.y + b.dy * Math.cos(t * b.fy + b.py),
            ca: Math.cos(rot) / b.a, sa: Math.sin(rot) / b.a, cb: Math.cos(rot) / b.b, sb: Math.sin(rot) / b.b,
            s: b.s, c: b.c,
          };
        });
        // A saturated core (slightly super-gaussian, so it reads as a shape) inside a wide, faint
        // halo (so it reads as light), on the blob's rotated, normalised distance.
        const glow = (b, x, y) => {
          const dx = x - b.x, dy = y - b.y;
          const u = dx * b.ca + dy * b.sa, v = dy * b.cb - dx * b.sb;
          const q = u * u + v * v;
          return b.s * Math.min(1, 0.9 * Math.exp(-(q ** 1.15)) + 0.12 * Math.exp(-q * 0.25));
        };
        const d = image.data;
        let i = 0;
        for (let row = 0; row < rows; row++) {
          const y = (row + 0.5) * cell;
          for (let col = 0; col < cols; col++, i += 4) {
            const x = (col + 0.5) * cell;
            const u = clamp((0.6 * x) / w + (0.4 * y) / h, 0, 1);
            let R = lerp(A[0], B[0], u), G = lerp(A[1], B[1], u), Bl = lerp(A[2], B[2], u);
            if (dark) {
              // Screen in linear light: glows add like light (red + green = gold), never towards grey.
              R = 1 - R; G = 1 - G; Bl = 1 - Bl;
              for (const b of live) {
                const g = glow(b, x, y);
                R *= 1 - g * b.c[0]; G *= 1 - g * b.c[1]; Bl *= 1 - g * b.c[2];
              }
              R = 1 - R; G = 1 - G; Bl = 1 - Bl;
            } else {
              // Multiply: behaves like pigment on paper, overlaps deepen instead of washing out.
              for (const b of live) {
                const g = glow(b, x, y);
                R *= 1 - g * (1 - b.c[0]); G *= 1 - g * (1 - b.c[1]); Bl *= 1 - g * (1 - b.c[2]);
              }
            }
            // A small chroma boost around luma keeps dim tails of warm glows amber rather than olive.
            const Y = 0.2126 * R + 0.7152 * G + 0.0722 * Bl;
            d[i] = encode(Y + (R - Y) * CHROMA);
            d[i + 1] = encode(Y + (G - Y) * CHROMA);
            d[i + 2] = encode(Y + (Bl - Y) * CHROMA);
            d[i + 3] = 255;
          }
        }
        lctx.putImageData(image, 0, 0);
      }

      const ink = (a) => rgba(pal.ink, a);
      const word = env.o.word ?? 'Liquid Glass';
      const hatch = { x: w * r.range(0.6, 0.85), y: h * r.range(0.1, 0.35) };
      const rings = { x: w * r.range(0.08, 0.32), y: h * r.range(1.02, 1.12) }; // centre below the frame: arcs only

      return {
        paint(ctx, t) {
          field(t);
          // Bilinear is exact enough for a smooth field and far cheaper than 'high' on software rasterisers.
          ctx.save();
          ctx.imageSmoothingQuality = 'low';
          ctx.drawImage(low, 0, 0, cols * cell, rows * cell);
          ctx.restore();
        },
        detail(ctx) {
          // Diagonal hairlines every 9px; a radial alpha ramp gives them a strong home and a faint reach.
          const hr = span * 0.62;
          const hg = ctx.createRadialGradient(hatch.x, hatch.y, 0, hatch.x, hatch.y, hr);
          hg.addColorStop(0, ink(dark ? 0.5 : 0.24));
          hg.addColorStop(0.45, ink(dark ? 0.26 : 0.11));
          hg.addColorStop(1, ink(dark ? 0.06 : 0.07));
          ctx.strokeStyle = hg;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let x = -h; x < w; x += 9) {
            ctx.moveTo(x, h);
            ctx.lineTo(x + h, 0);
          }
          ctx.stroke();

          // Concentric rings centred just below the frame: curved hairlines against the straight hatch.
          const rr = span * 0.5;
          const rg = ctx.createRadialGradient(rings.x, rings.y, 0, rings.x, rings.y, rr);
          rg.addColorStop(0, ink(dark ? 0.4 : 0.2));
          rg.addColorStop(1, ink(0));
          ctx.strokeStyle = rg;
          ctx.beginPath();
          for (let rad = 14; rad < rr; rad += 12) {
            ctx.moveTo(rings.x + rad, rings.y);
            ctx.arc(rings.x, rings.y, rad, 0, TAU);
          }
          ctx.stroke();

          // Registration crosses on a regular grid: small, crisp detail wherever glass may land.
          const pitch = w < 700 ? 64 : 96;
          const ox = (w / 2) % pitch, oy = (h / 2) % pitch;
          ctx.fillStyle = ink(dark ? 0.36 : 0.26);
          for (let y = oy; y < h; y += pitch) {
            for (let x = ox; x < w; x += pitch) {
              hRule(ctx, env, x - 4, y, 9);
              vRule(ctx, env, x, y - 4, 9);
            }
          }

          // Giant outlined type along the bottom, cropped by the edges.
          if (word) {
            const size = Math.round(clamp(w * 0.18, 64, h * 0.42));
            ctx.font = font(800, size);
            track(ctx, -size * 0.04);
            ctx.lineWidth = 1.25;
            ctx.lineJoin = 'round';
            ctx.strokeStyle = ink(dark ? 0.62 : 0.38);
            ctx.strokeText(word, w * 0.03, h - size * 0.12);
            track(ctx, 0);
          }

          if (dark) {
            const v = ctx.createRadialGradient(w / 2, h / 2, span * 0.3, w / 2, h / 2, span * 0.62);
            v.addColorStop(0, 'rgba(0,0,0,0)');
            v.addColorStop(1, 'rgba(0,0,0,0.24)');
            ctx.fillStyle = v;
            ctx.fillRect(0, 0, w, h);
          }
          grain(ctx, dark ? 0.03 : 0.02);
        },
      };
    },
  };

  /* ------------------------------------------------------------------ type specimen */

  const HEADS = ['Optics', 'Materials', 'Motion', 'Legibility', 'Depth', 'Tone', 'Highlights', 'Dispersion', 'Concentricity', 'Layering'];
  const DISPLAY = ['Refraction', 'Lensing', 'Caustics', 'Meniscus', 'Parallax', 'Prismatic'];
  const QUOTES = ['“Lensing, not blur.”', '“Content first. Glass on top.”', '“Nothing snaps. Everything refracts.”', '“The rim sees around the corner.”'];
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &?!@#%*()[]{}/+=';

  scenes.typeSpecimen = {
    theme: 'light',
    build(env) {
      return { paint: (ctx) => specimen(ctx, env) };
    },
  };

  function specimen(ctx, env) {
    const { w, h, dark } = env;
    const r = env.rng('specimen');
    const paper = dark ? '#0d0d10' : '#f7f6f2';
    const ink = dark ? '#f2f2f4' : '#161618';
    const soft = rgba(ink, 0.58);
    const rule = rgba(ink, 0.3);
    // Hue ramp at constant chroma; lightness lifts around yellow (h ≈ 100) so it stays clean, not olive.
    const ramp = Array.from({ length: 12 }, (_, i) => {
      const hue = 18 + i * 30;
      return oklch((dark ? 0.72 : 0.68) + 0.15 * Math.exp(-(((hue - 100) / 40) ** 2)), 0.17, hue);
    });
    const M = w < 600 ? 16 : Math.round(clamp(w * 0.025, 20, 40));
    const inner = w - 2 * M;
    const narrow = w < 600;
    const flow = textFlow(r);
    const headOffset = r.int(0, HEADS.length - 1);
    let serial = 0;

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'alphabetic';

    const caps = (text, x, y, align = 'left', colour = ink) => {
      ctx.font = font(600, 10);
      track(ctx, 1.2);
      ctx.fillStyle = colour;
      ctx.textAlign = align;
      ctx.fillText(text.toUpperCase(), x, y);
      ctx.textAlign = 'left';
      track(ctx, 0);
    };
    const capsWidth = (text) => {
      ctx.font = font(600, 10);
      track(ctx, 1.2);
      const width = measure(ctx, text.toUpperCase());
      track(ctx, 0);
      return width;
    };

    const blocks = {
      masthead(y) {
        ctx.fillStyle = ink;
        hRule(ctx, env, M, y, inner);
        const title = `Type specimen · No. ${String(hash32(env.o.seed ?? 1) % 90 + 10)}`, credit = 'Liquid Glass for the Web';
        caps(title, M, y + 17);
        if (!narrow) caps('System UI · weights 100 to 900', M + inner / 2, y + 17, 'center', soft);
        // On a narrow canvas the credit only goes in when it clears the title.
        if (capsWidth(title) + capsWidth(credit) + 24 <= inner) caps(credit, M + inner, y + 17, 'right');
        ctx.fillStyle = rule;
        hRule(ctx, env, M, y + 26, inner, 1 / env.dpr);
        return y + 26 + (narrow ? 14 : 22);
      },

      display(y) {
        const word = r.pick(DISPLAY);
        const size = Math.round(narrow ? clamp(w * 0.2, 48, 96) : clamp(w * 0.105, 64, 168));
        ctx.font = font(800, size);
        track(ctx, -size * 0.045);
        ctx.fillStyle = ink;
        ctx.fillText(word, M - size * 0.04, y + size * 0.8);
        const wordW = measure(ctx, word);
        track(ctx, 0);
        let yy = y + size * 0.98;

        // Beside the word, where there is room: an accent "Aa", its caption and a metrics table.
        const side = M + wordW + 40;
        if (!narrow && inner - (side - M) > 200) {
          const aa = Math.round(size * 0.62);
          ctx.font = font(300, aa);
          ctx.fillStyle = ramp[r.int(0, 11)];
          ctx.fillText('Aa', side, y + size * 0.78);
          ctx.font = font(500, 11, MONO);
          ctx.fillStyle = soft;
          ctx.fillText(`${word.length} glyphs · ${size}px · −4.5%`, side + 4, y + size * 0.95);

          // A ruled metrics table in whatever room is left at the right.
          const tw = 250, tx = M + inner - tw;
          ctx.font = font(300, aa);
          if (tx > side + measure(ctx, 'Aa') + 32) {
            const rows = [['Family', 'System UI'], ['Weights', '100 – 900'], ['Tracking', '−4.5% display'], ['Body', `13 / ${Math.round(13 * 1.42)} px`], ['Measure', '≈ 38 em'], ['Rules', '1 device px']];
            const rh = Math.min(20, (size * 0.95) / rows.length);
            rows.forEach(([k, v], i) => {
              const ry = y + 4 + i * rh;
              ctx.fillStyle = rule;
              hRule(ctx, env, tx, ry + rh, tw, 1 / env.dpr);
              ctx.font = font(500, 10, MONO);
              ctx.fillStyle = soft;
              ctx.fillText(k.toUpperCase(), tx, ry + rh - 6);
              ctx.font = font(500, 12);
              ctx.fillStyle = ink;
              ctx.textAlign = 'right';
              ctx.fillText(v, tx + tw, ry + rh - 6);
              ctx.textAlign = 'left';
            });
          }
        }

        // Weight ladder: one pair per weight, divided by hairlines, weight labelled underneath.
        yy += 14;
        const cells = 9, cw = inner / cells, ls = Math.round(clamp(cw * 0.42, 18, 46));
        ctx.fillStyle = rule;
        hRule(ctx, env, M, yy, inner, 1 / env.dpr);
        for (let i = 0; i < cells; i++) {
          const x = M + i * cw;
          ctx.fillStyle = rule;
          if (i) vRule(ctx, env, x, yy, ls + 30, 1 / env.dpr);
          ctx.fillStyle = ink;
          ctx.font = font((i + 1) * 100, ls);
          ctx.fillText('Ag', x + 8, yy + ls + 4);
          ctx.font = font(500, 9, MONO);
          ctx.fillStyle = soft;
          ctx.fillText(String((i + 1) * 100), x + 8, yy + ls + 22);
        }
        yy += ls + 30;
        ctx.fillStyle = rule;
        hRule(ctx, env, M, yy, inner, 1 / env.dpr);

        // Glyph set, wrapped.
        const gs = narrow ? 18 : 24;
        ctx.font = font(300, gs);
        ctx.fillStyle = ink;
        let x = M, line = 0;
        yy += gs + 12;
        for (const ch of GLYPHS) {
          const advance = measure(ctx, ch);
          if (x + advance > M + inner) {
            if (++line > 1) break;
            x = M;
            yy += gs * 1.25;
          }
          ctx.fillText(ch, x, yy);
          x += advance + (ch === ' ' ? gs * 0.6 : gs * 0.08);
        }
        return yy + 22;
      },

      ramp(y) {
        const gap = 1, sh = narrow ? 44 : 58;
        const perRow = narrow ? 6 : 12;
        const cw = (inner - gap * (perRow - 1)) / perRow;
        ramp.forEach((c, i) => {
          const x = M + (i % perRow) * (cw + gap), yy = y + Math.floor(i / perRow) * (sh + gap);
          ctx.fillStyle = c;
          ctx.fillRect(x, yy, cw, sh);
          ctx.fillStyle = luminance(c) > 0.36 ? 'rgba(0,0,0,.78)' : 'rgba(255,255,255,.92)';
          ctx.font = font(600, 9);
          ctx.fillText(String(i + 1).padStart(2, '0'), x + 6, yy + 13);
          ctx.font = font(500, 9, MONO);
          ctx.fillText(c.toUpperCase(), x + 6, yy + sh - 7);
        });
        return y + (narrow ? 2 : 1) * (sh + gap) + 22;
      },

      quote(y) {
        const size = Math.round(narrow ? 24 : clamp(w * 0.034, 26, 52));
        ctx.fillStyle = ink;
        hRule(ctx, env, M, y, inner);
        ctx.font = font(650, size);
        track(ctx, -size * 0.02);
        ctx.fillText(r.pick(QUOTES), M, y + size * 1.25);
        track(ctx, 0);
        caps('Notes on the material', M + inner, y + size * 1.25, 'right', soft);
        ctx.fillStyle = rule;
        hRule(ctx, env, M, y + size * 1.7, inner, 1 / env.dpr);
        return y + size * 1.7 + 22;
      },

      columns(y, size) {
        const lineH = Math.round(size * 1.42);
        const n = clamp(Math.floor(inner / 250), 1, 6);
        const gutter = 28;
        const cw = (inner - gutter * (n - 1)) / n;
        const bottom = Math.min(y + clamp(h * 0.5, 260, 480), h + lineH);
        ctx.fillStyle = rule;
        for (let c = 1; c < n; c++) vRule(ctx, env, M + c * (cw + gutter) - gutter / 2, y, bottom - y, 1 / env.dpr);

        for (let c = 0; c < n; c++) {
          const x = M + c * (cw + gutter);
          let yy = y + size;
          let sinceHead = c === 0 ? 99 : r.int(4, 14);
          while (yy < bottom) {
            if (sinceHead > 16 && yy + lineH * 3 < bottom) {
              // Section head: numbered small caps under a hairline.
              if (yy > y + size) yy += lineH * 0.5;
              ctx.fillStyle = rule;
              hRule(ctx, env, x, yy - size + 1, cw, 1 / env.dpr);
              caps(`${String(++serial).padStart(2, '0')}  ${HEADS[(headOffset + serial) % HEADS.length]}`, x, yy + 6, 'left', ink);
              yy += lineH * 1.45;
              sinceHead = 0;
              continue;
            }
            ctx.font = font(400, size);
            ctx.fillStyle = ink;
            const line = flow.line(ctx, cw);
            // Alternate inverted ink spans with colour-marker spans every few lines.
            let mark = null;
            const beat = (serial * 7 + sinceHead + c * 3) % 9;
            const from = r.int(0, line.words.length - 2);
            if ((beat === 2 || beat === 6) && line.words.length > 2 && line.words[from].length > 2) {
              const colour = ramp[r.int(0, 11)];
              mark = beat === 2
                ? { from, to: from + r.int(0, 2), bg: ink, fg: paper }
                : { from, to: from + r.int(0, 1), bg: colour, fg: luminance(colour) > 0.36 ? '#111' : '#fff' };
            }
            setLine(ctx, line, x, yy, cw, lineH, mark);
            yy += line.last ? lineH * 1.5 : lineH;
            sinceHead++;
          }
        }
        return bottom + 18;
      },
    };

    const sequence = [
      (y) => blocks.masthead(y), (y) => blocks.display(y), (y) => blocks.ramp(y), (y) => blocks.columns(y, 13),
      (y) => blocks.quote(y), (y) => blocks.columns(y, 15), (y) => blocks.ramp(y), (y) => blocks.columns(y, 14),
    ];
    let y = M;
    for (let k = 0; y < h; k++) y = sequence[k < sequence.length ? k : 3 + ((k - 3) % 5)](y);
    grain(ctx, 0.015);
  }

  /* ------------------------------------------------------------------ landscape */

  const SKIES = {
    light: {
      sky: [[0, '#2350c6'], [0.42, '#789de8'], [0.76, '#eebcc4'], [1, '#ffd197']],
      haze: '#f1bfae', deep: '#1f1745', water: '#16205e', lit: '#fff0e2', body: '#fffaf0', glow: '#ffcc88', glint: '#fff4d6',
    },
    dark: {
      sky: [[0, '#02040c'], [0.5, '#081535'], [0.84, '#1a2860'], [1, '#353c82']],
      haze: '#272e68', deep: '#020309', water: '#010208', lit: '#c9d4ff', body: '#f3efe0', glow: '#9fb0ff', glint: '#eef0ff',
    },
  };

  // 1-D midpoint displacement, normalised to [0, 1]. `n` must be 2^k + 1.
  function ridgeline(r, n, roughness) {
    const y = new Float32Array(n);
    y[0] = r();
    y[n - 1] = r();
    for (let step = n - 1, amp = 1; step > 1; step >>= 1, amp *= roughness) {
      const half = step >> 1;
      for (let i = half; i < n; i += step) y[i] = (y[i - half] + y[i + half]) / 2 + (r() - 0.5) * amp;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < n; i++) y[i] = (y[i] - lo) / (hi - lo || 1);
    return y;
  }

  scenes.landscape = {
    theme: 'light',
    build(env) {
      return { paint: (ctx) => landscape(ctx, env) };
    },
  };

  function landscape(ctx, env) {
    const { w, h, dark } = env;
    const P = dark ? SKIES.dark : SKIES.light;
    const r = env.rng('landscape');
    const horizon = Math.round(h * (h > w ? 0.56 : 0.62));
    const unit = Math.min(w, h);
    const bx = w * r.range(0.58, 0.74);
    const by = dark ? horizon * r.range(0.22, 0.4) : horizon - h * r.range(0.12, 0.19);
    landscapeUpper(ctx, env, { P, horizon, unit, bx, by, bodyR: clamp(unit * (dark ? 0.032 : 0.042), 10, 54) });

    // The lake mirrors the band of scene above the horizon. Downscaling that band to 1/3 × 1/9 blurs
    // it (more vertically, like wind-rippled water); a flip about the horizon line mirrors it.
    // (Redrawing the scene small avoids the readback but lands on a slow CPU raster path for small canvases.)
    const lake = h - horizon, src = Math.min(lake, horizon);
    const tmp = makeCanvas(Math.max(1, Math.round(w / 3)), Math.max(1, Math.round(src / 9)));
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(ctx.canvas, 0, Math.round((horizon - src) * env.sy), ctx.canvas.width, Math.round(src * env.sy), 0, 0, tmp.width, tmp.height);
    ctx.save();
    ctx.translate(0, 2 * horizon);
    ctx.scale(1, -1);
    ctx.imageSmoothingQuality = 'low'; // bilinear: the source is already a blur
    ctx.drawImage(tmp, 0, horizon - src, w, src);
    ctx.restore();
    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, rgba(P.water, 0.12));
    water.addColorStop(1, rgba(P.water, dark ? 0.75 : 0.6));
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, lake + 1);
    ctx.fillStyle = rgba(P.lit, 0.55);
    hRule(ctx, env, 0, horizon, w, 1 / env.dpr);

    // Ripples: broken 1px lines, denser and thinner towards the horizon, plus a glitter path under
    // the sun that widens towards the viewer. Batched into five paths by colour.
    const pr = env.rng('ripples');
    const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const rows = Math.round(lake / 3.2);
    for (let k = 0; k < rows; k++) {
      const t = (k + pr()) / rows;
      const y = snap(env, horizon + 2 + (lake - 2) * t ** 1.35);
      const th = Math.max(1, Math.round(lerp(0.7, 1.9, t) * env.dpr)) / env.dpr;
      for (let x = -pr() * 120; x < w;) {
        const len = pr.range(16, 170) * lerp(0.6, 1.7, t);
        const which = pr() < 0.6 ? (pr() < 0.72 ? 0 : 1) : 2;
        paths[which].rect(x, y, len, th);
        x += len + pr.range(6, 64) * lerp(0.5, 1.4, t);
      }
      const spread = w * lerp(0.012, 0.15, t);
      for (let g = Math.round(lerp(2, 10, t)); g > 0; g--) {
        const off = pr.gauss() * spread * 0.5, len = pr.range(3, 22) * lerp(0.5, 1.8, t);
        paths[Math.abs(off) < spread * 0.25 ? 3 : 4].rect(bx + off - len / 2, y, len, th);
      }
    }
    const fills = [rgba(P.lit, 0.1), rgba(P.lit, 0.26), 'rgba(0,0,12,.2)', rgba(P.glint, 0.95), rgba(P.glint, 0.5)];
    paths.forEach((p, i) => {
      ctx.fillStyle = fills[i];
      ctx.fill(p);
    });
    if (dark) shoreLights(ctx, env, horizon);
    grain(ctx, 0.02);
  }

  // Everything above the waterline: sky, stars or contrail, glow, sun or moon, cirrus, birds, ridges.
  function landscapeUpper(ctx, env, { P, horizon, unit, bx, by, bodyR }) {
    const { w, h, dark } = env;

    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    for (const [at, c] of P.sky) sky.addColorStop(at, c);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon + 1);

    if (dark) stars(ctx, env, horizon);

    // Wide horizon glow, then the sun's (or moon's) bloom, then the disc.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(bx, horizon);
    ctx.scale(1, 0.32);
    const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.7);
    hg.addColorStop(0, rgba(P.glow, dark ? 0.22 : 0.55));
    hg.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(-w * 1.5, -w, w * 3, w * 2);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const bloom = ctx.createRadialGradient(bx, by, bodyR * 0.8, bx, by, bodyR * 12);
    bloom.addColorStop(0, rgba(P.glow, dark ? 0.4 : 0.85));
    bloom.addColorStop(0.2, rgba(P.glow, dark ? 0.12 : 0.32));
    bloom.addColorStop(1, rgba(P.glow, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(bx - bodyR * 12, by - bodyR * 12, bodyR * 24, bodyR * 24);
    ctx.restore();
    if (!dark) {
      // An engraved sunburst: faint 1px rays that fade with distance, alternating long and short.
      const reach = Math.hypot(w, h) * 0.75;
      const g = ctx.createRadialGradient(bx, by, bodyR * 1.5, bx, by, reach);
      g.addColorStop(0, rgba(P.lit, 0.3));
      g.addColorStop(0.35, rgba(P.lit, 0.09));
      g.addColorStop(1, rgba(P.lit, 0));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, horizon);
      ctx.clip();
      ctx.strokeStyle = g;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * TAU, L = reach * (i % 2 ? 0.55 : 1), ca = Math.cos(a), sa = Math.sin(a);
        ctx.moveTo(bx + ca * bodyR * 1.5, by + sa * bodyR * 1.5);
        ctx.lineTo(bx + ca * L, by + sa * L);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = P.body;
    ctx.beginPath();
    ctx.arc(bx, by, bodyR, 0, TAU);
    ctx.fill();
    if (dark) {
      // Maria: a few soft grey patches clipped to the disc.
      const mr = env.rng('maria');
      ctx.save();
      ctx.clip();
      for (let n = 5; n > 0; n--) {
        const mx = bx + mr.gauss() * bodyR * 0.35, my = by + mr.gauss() * bodyR * 0.35, rad = bodyR * mr.range(0.18, 0.4);
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, rad);
        g.addColorStop(0, 'rgba(150,146,135,.4)');
        g.addColorStop(1, 'rgba(150,146,135,0)');
        ctx.fillStyle = g;
        ctx.fillRect(mx - rad, my - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    } else contrail(ctx, env, horizon);

    // Cirrus: bands of long hairline streaks, lit from below by the low sun (or silvered by the moon).
    const cr = env.rng('clouds');
    const bands = Math.round(clamp(horizon / 60, 5, 12));
    for (let band = 0; band < bands; band++) {
      // Bands are spread down the sky in order, then jittered, so no large patch is left empty.
      const cy = horizon * lerp(0.03, 0.66, (band + cr()) / bands);
      const cx = w * ((band * 0.618 + cr() * 0.25) % 1), L = w * cr.range(0.3, 0.6); // golden-ratio spread
      const near = 1 - clamp(Math.hypot(cx - bx, cy - by) / w, 0, 1);
      const spread = cr.range(4, 12);
      for (let n = cr.int(12, 24); n > 0; n--) {
        const len = L * cr.range(0.2, 0.85);
        const x0 = cx + cr.gauss() * L * 0.3 - len / 2;
        const y = snap(env, cy + cr.gauss() * spread);
        const a = (dark ? 0.08 : 0.16) + near * (dark ? 0.2 : 0.5) * cr();
        const g = ctx.createLinearGradient(x0, 0, x0 + len, 0);
        g.addColorStop(0, rgba(P.lit, 0));
        g.addColorStop(0.35, rgba(P.lit, a));
        g.addColorStop(0.7, rgba(P.lit, a));
        g.addColorStop(1, rgba(P.lit, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x0, y, len, Math.max(1, Math.round(cr.range(0.8, 2.6) * env.dpr)) / env.dpr);
      }
    }

    if (!dark) {
      // A small flock crossing the glow.
      const fr = env.rng('birds');
      ctx.strokeStyle = 'rgba(40,24,64,.72)';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const fx = bx - w * fr.range(0.08, 0.18), fy = by - h * fr.range(0.05, 0.12);
      for (let n = fr.int(5, 9); n > 0; n--) {
        const x = fx + fr.gauss() * 34, y = fy + fr.gauss() * 16, s = fr.range(2.5, 5.5);
        ctx.moveTo(x - s, y - s * 0.3);
        ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.62, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.62, x + s, y - s * 0.3);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // Four ridges, far to near. Atmospheric perspective: far ridges take the haze colour, and every
    // ridge fades into valley mist at its foot. Each crest carries a 1px rim of light.
    const n = 2 ** clamp(Math.ceil(Math.log2(w / 3)), 6, 10) + 1;
    const rr = env.rng('ridges');
    for (let i = 0; i < 4; i++) {
      const depth = i / 3;
      const hts = ridgeline(rr, n, lerp(0.6, 0.45, depth));
      const base = horizon - h * lerp(0.07, 0.008, depth);
      const rise = h * lerp(0.24, 0.06, depth) * (h > w ? 0.75 : 1);
      const colour = mix(P.haze, P.deep, lerp(0.28, 0.95, depth));
      const xAt = (k) => (k / (n - 1)) * (w + 4) - 2;
      const yAt = (k) => base - hts[k] ** (i ? 1.2 : 1.6) * rise;

      const g = ctx.createLinearGradient(0, base - rise, 0, horizon);
      g.addColorStop(0, colour);
      g.addColorStop(1, mix(colour, P.haze, lerp(0.55, 0.12, depth)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-2, horizon + 1);
      for (let k = 0; k < n; k++) ctx.lineTo(xAt(k), yAt(k));
      ctx.lineTo(w + 2, horizon + 1);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = rgba(P.lit, lerp(0.42, 0.16, depth));
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < n; k++) ctx[k ? 'lineTo' : 'moveTo'](xAt(k), yAt(k) + 0.5);
      ctx.stroke();

      // Echoes of the crest, fading down the slope, like the cut lines of a woodblock print.
      const gap = lerp(7, 4, depth);
      for (let e = 1; e <= 4; e++) {
        ctx.strokeStyle = rgba(P.lit, lerp(0.3, 0.1, depth) * (1 - e / 5));
        ctx.beginPath();
        for (let k = 0; k < n; k += 2) ctx[k ? 'lineTo' : 'moveTo'](xAt(k), Math.min(horizon, yAt(k) + e * gap * (1 + e * 0.35)));
        ctx.stroke();
      }

      if (i === 3) {
        // Conifers in clumps along the nearest crest.
        const tr = env.rng('trees');
        const p1 = tr() * TAU, p2 = tr() * TAU;
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let x = 0; x < w; x += tr.range(2.2, 6.5)) {
          if (Math.sin(x * 0.009 + p1) + 0.6 * Math.sin(x * 0.031 + p2) < 0.1) continue;
          const f = ((x + 2) / (w + 4)) * (n - 1), k = Math.min(n - 2, Math.floor(f));
          const y = lerp(yAt(k), yAt(k + 1), f - k);
          const th = tr.range(3, 10) * clamp(unit / 800, 0.7, 1.4), tw = th * 0.3;
          ctx.moveTo(x - tw, y + 2);
          ctx.lineTo(x, y - th);
          ctx.lineTo(x + tw, y + 2);
        }
        ctx.fill();
      }
    }
  }

  // A contrail: a crisp 1px core in a soft 4px glow, fading at both ends.
  function contrail(ctx, env, horizon) {
    const { w } = env;
    const r = env.rng('contrail');
    const x0 = w * r.range(-0.1, 0.3), y0 = horizon * r.range(0.05, 0.2);
    const x1 = x0 + w * r.range(0.45, 0.7), y1 = y0 + horizon * r.range(0.05, 0.16);
    for (const [width, a] of [[4, 0.14], [1, 0.75]]) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.3, `rgba(255,255,255,${a})`);
      g.addColorStop(0.92, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Warm cabin lights on the far shore, each with a broken vertical reflection.
  function shoreLights(ctx, env, horizon) {
    const { w, h } = env;
    const r = env.rng('lights');
    const lights = new Path2D(), trails = new Path2D();
    for (let cluster = r.int(3, 5); cluster > 0; cluster--) {
      const cx = w * r.range(0.05, 0.95);
      for (let n = r.int(2, 6); n > 0; n--) {
        const x = snap(env, cx + r.gauss() * 18), y = horizon - r.range(2, 9), s = r.range(1, 1.8);
        lights.rect(x, y, s, s);
        for (let yy = horizon + 2; yy < Math.min(h, horizon + r.range(30, 90)); yy += r.range(2.5, 5)) {
          trails.rect(x - 0.5 + r.gauss() * 0.8, snap(env, yy), s + r.range(0, 2), 1 / env.dpr);
        }
      }
    }
    ctx.fillStyle = 'rgba(255,190,110,.55)';
    ctx.fill(trails);
    ctx.fillStyle = '#ffd08a';
    ctx.fill(lights);
  }

  function stars(ctx, env, horizon) {
    const { w } = env;
    const r = env.rng('stars');
    // The Milky Way: a faint tilted band of glow with its own denser dust of stars.
    const angle = r.range(-0.5, -0.25), mx = w * r.range(0.3, 0.6), my = horizon * r.range(0.35, 0.55);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.scale(1, 0.16);
    const band = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.75);
    band.addColorStop(0, 'rgba(170,180,255,.3)');
    band.addColorStop(0.5, 'rgba(150,160,240,.12)');
    band.addColorStop(1, 'rgba(150,160,240,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-w * 1.5, -w, w * 3, w * 2);
    ctx.restore();

    const buckets = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const alphas = [0.3, 0.5, 0.75, 1];
    const count = Math.round((w * horizon) / 520);
    const bright = [];
    for (let i = 0; i < count; i++) {
      let x, y;
      if (i % 3 === 0) {
        const along = r.gauss() * w * 0.45, across = r.gauss() * horizon * 0.07;
        x = mx + along * Math.cos(angle) - across * Math.sin(angle);
        y = my + along * Math.sin(angle) + across * Math.cos(angle);
      } else {
        x = r() * w;
        y = r() ** 1.3 * horizon;
      }
      if (y < 0 || y > horizon - 4 || r() < (y / horizon) ** 3) continue;
      const big = r() < 0.06;
      const s = big ? r.range(1.2, 2.2) : r.range(0.5, 1.05);
      const b = big ? 3 : r.int(0, 2);
      if (big) {
        buckets[b].moveTo(x + s / 2, y);
        buckets[b].arc(x, y, s / 2, 0, TAU);
        if (bright.length < 10) bright.push([x, y, s]);
      } else buckets[b].rect(x, y, s, s);
    }
    buckets.forEach((p, i) => {
      ctx.fillStyle = `rgba(236,240,255,${alphas[i]})`;
      ctx.fill(p);
    });
    // Diffraction spikes on the brightest few.
    for (const [x, y, s] of bright) {
      const L = s * 5;
      ctx.fillStyle = 'rgba(220,228,255,.45)';
      ctx.fillRect(x - L, y - 0.25, L * 2, 0.5);
      ctx.fillRect(x - 0.25, y - L, 0.5, L * 2);
    }
  }

  /* ------------------------------------------------------------------ mosaic */

  // Covers as [background, foreground, accent].
  const COVERS_DARK = [
    ['#0b1d51', '#64d2ff', '#ff375f'], ['#ff375f', '#1c0a14', '#ffd60a'], ['#1c1c1e', '#30d158', '#f5f5f7'],
    ['#ffd60a', '#1d1d1f', '#ff375f'], ['#3a0b3f', '#bf5af2', '#ffd60a'], ['#ff9f0a', '#2a0e05', '#fff4e0'],
    ['#0a84ff', '#f5f5f7', '#0b1d51'], ['#003d36', '#ffcf70', '#ff6f59'], ['#5e5ce6', '#ffd6e7', '#1c1340'],
    ['#111114', '#ff9f0a', '#bf5af2'], ['#e8e1d3', '#1d2a6b', '#e4572e'], ['#30d158', '#062b16', '#f5f5f7'],
    ['#ff6482', '#fff4e0', '#5e5ce6'], ['#120c2c', '#ff375f', '#64d2ff'], ['#f5f5f7', '#111114', '#0a84ff'],
  ];
  const COVERS_LIGHT = [
    ['#f2efe8', '#1d1d1f', '#ff453a'], ['#ffe3d3', '#ff375f', '#0a84ff'], ['#dcebff', '#0a60d6', '#ff9f0a'],
    ['#fff3c4', '#1d1d1f', '#30b653'], ['#efe3ff', '#8e44d9', '#ffc400'], ['#d9f5e3', '#0f6b3a', '#ff6482'],
    ['#ffd60a', '#1d1d1f', '#ff375f'], ['#ff9f0a', '#fff4e0', '#1c1340'], ['#fde2ea', '#c2185b', '#1d2a6b'],
    ['#e8e1d3', '#1d2a6b', '#e4572e'], ['#0a84ff', '#f5f5f7', '#ffd60a'], ['#ffffff', '#0b1d51', '#ff9f0a'],
    ['#64d2ff', '#0b1d51', '#ffffff'], ['#ff6482', '#fff4e0', '#5e5ce6'],
  ];
  const SYLLABLES = ['lu', 'mi', 'na', 'ra', 'so', 'vel', 'ka', 'to', 'ri', 'an', 'el', 'or', 'sa', 'ne', 'io', 'va', 'den', 'mar'];
  const TITLES = ['Glass Hours', 'Soft Refraction', 'Halo', 'Afterimage', 'Night Optics', 'Prism Songs', 'Low Tide', 'Clear Weather', 'Parallax', 'Meridian', 'Salt & Light', 'Blue Hour', 'Caustic', 'Lumen'];
  const COVER_WORDS = ['glass', 'prism', 'lumen', 'halo', 'tide', 'flux', 'optic', 'neon', 'aura', 'lens'];

  const artist = (r) => {
    const s = Array.from({ length: r.int(2, 3) }, () => r.pick(SYLLABLES)).join('');
    return s[0].toUpperCase() + s.slice(1);
  };

  // Each cover draws into a clipped s×s tile at the origin; it returns true when it set its own type.
  // `serial` is the tile's running number (offset per seed), for choices that must not repeat nearby.
  const COVER_DESIGNS = {
    rings(c, s, p, r) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      const cx = s * r.pick([0, 0.5, 1]), cy = s * r.pick([0.5, 1]);
      const step = s * r.range(0.04, 0.07);
      let k = 0;
      for (let rad = s * 1.45; rad > step * 0.6; rad -= step) {
        c.fillStyle = k++ % 2 ? p[0] : p[1];
        c.beginPath();
        c.arc(cx, cy, rad, 0, TAU);
        c.fill();
      }
      c.strokeStyle = p[2];
      c.lineWidth = Math.max(2, step * 0.35);
      c.beginPath();
      c.arc(cx, cy, step * (r.int(3, 9) + 0.5), 0, TAU);
      c.stroke();
    },

    stripes(c, s, p, r) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      c.save();
      c.translate(s / 2, s / 2);
      c.rotate(r.pick([0, 0.25, -0.25, 0.5]) * Math.PI);
      const n = r.int(10, 18), pitch = (s * 1.5) / n;
      c.fillStyle = p[1];
      for (let i = 0; i < n; i++) c.fillRect(-s * 0.75 + i * pitch, -s, pitch * lerp(0.1, 0.72, i / (n - 1)), 2 * s);
      c.restore();
      c.fillStyle = p[2];
      c.beginPath();
      c.arc(s * r.range(0.3, 0.7), s * r.range(0.3, 0.7), s * r.range(0.12, 0.2), 0, TAU);
      c.fill();
    },

    numeral(c, s, p, r) {
      const g = c.createLinearGradient(0, 0, s, s);
      g.addColorStop(0, p[0]);
      g.addColorStop(1, mix(p[0], p[2], 0.55));
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
      const num = String(r.int(1, 99)).padStart(2, '0');
      const size = s * 0.78;
      c.fillStyle = p[1];
      c.font = font(800, size);
      track(c, -size * 0.07);
      c.fillText(num, -s * 0.04, s * 0.95);
      track(c, 0);
      const k = clamp(s / 220, 0.8, 1.3);
      c.font = font(600, 10 * k);
      c.fillText(`No. ${num}`, 10 * k, 18 * k);
      c.font = font(500, 8.5 * k, MONO);
      c.textAlign = 'right';
      c.fillText(artist(r).toUpperCase(), s - 10 * k, 18 * k);
      c.textAlign = 'left';
      c.fillRect(10 * k, 24 * k, s - 20 * k, 1);
      return true;
    },

    orb(c, s, p, r) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      const ox = s * r.range(0.38, 0.62), oy = s * r.range(0.36, 0.5), R = s * r.range(0.24, 0.32);
      const halo = c.createRadialGradient(ox, oy, R * 0.9, ox, oy, R * 2.2);
      halo.addColorStop(0, rgba(p[2], 0.45));
      halo.addColorStop(1, rgba(p[2], 0));
      c.fillStyle = halo;
      c.fillRect(0, 0, s, s);
      const g = c.createRadialGradient(ox - R * 0.35, oy - R * 0.4, R * 0.05, ox, oy, R);
      g.addColorStop(0, mix(p[2], '#ffffff', 0.6));
      g.addColorStop(0.55, p[2]);
      g.addColorStop(1, mix(p[2], p[0], 0.55));
      c.fillStyle = g;
      c.beginPath();
      c.arc(ox, oy, R, 0, TAU);
      c.fill();
      c.strokeStyle = rgba(p[1], 0.8);
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(ox, oy, R * 1.55, R * 0.32, -0.28, 0, TAU);
      c.stroke();
      c.beginPath();
      c.ellipse(ox, oy, R * 1.85, R * 0.4, -0.28, 0, TAU);
      c.stroke();
      const k = clamp(s / 220, 0.8, 1.3);
      c.fillStyle = p[1];
      c.font = font(700, 13 * k);
      c.fillText(r.pick(TITLES), 12 * k, s - 26 * k);
      c.font = font(500, 9.5 * k);
      c.fillStyle = rgba(p[1], 0.75);
      c.fillText(artist(r), 12 * k, s - 12 * k);
      return true;
    },

    sunset(c, s, p, r) {
      const sky = c.createLinearGradient(0, 0, 0, s);
      sky.addColorStop(0, p[0]);
      sky.addColorStop(1, mix(p[0], p[2], 0.45));
      c.fillStyle = sky;
      c.fillRect(0, 0, s, s);
      const cx = s * 0.5, cy = s * r.range(0.6, 0.7), R = s * r.range(0.26, 0.32);
      c.save();
      c.beginPath();
      c.arc(cx, cy, R, Math.PI, 0);
      c.closePath();
      c.clip();
      const disc = c.createLinearGradient(0, cy - R, 0, cy);
      disc.addColorStop(0, p[2]);
      disc.addColorStop(1, p[1]);
      c.fillStyle = disc;
      c.fillRect(cx - R, cy - R, 2 * R, R);
      // Slots cut from the disc (filled with the sky's own gradient), thickening towards the horizon.
      c.fillStyle = sky;
      for (let i = 0; i < 6; i++) c.fillRect(cx - R, cy - R * (0.5 - i * 0.085), 2 * R, 1 + i * s * 0.006);
      c.restore();
      c.fillStyle = p[1];
      c.fillRect(0, cy, s, s - cy);
      // Perspective floor grid.
      c.strokeStyle = rgba(p[2], 0.85);
      c.lineWidth = 1;
      c.beginPath();
      for (let i = -9; i <= 9; i++) {
        c.moveTo(cx + i * s * 0.02, cy);
        c.lineTo(cx + i * s * 0.26, s);
      }
      for (let k = 1; k <= 7; k++) {
        const y = cy + (s - cy) * (k / 7) ** 2;
        c.moveTo(0, y);
        c.lineTo(s, y);
      }
      c.stroke();
    },

    halftone(c, s, p, r) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      const pitch = s / r.int(13, 19);
      const fx = s * r.range(0.2, 0.8), fy = s * r.range(0.2, 0.8);
      const screen = (colour, offset, scale, invert) => {
        c.fillStyle = colour;
        c.beginPath();
        for (let y = pitch / 2 + offset; y < s + pitch; y += pitch) {
          for (let x = pitch / 2 + offset; x < s + pitch; x += pitch) {
            const d = clamp((Math.hypot(x - fx, y - fy) / s) * 1.35, 0, 1);
            const rad = pitch * scale * Math.max(0.06, invert ? d : 1 - d);
            c.moveTo(x + rad, y);
            c.arc(x, y, rad, 0, TAU);
          }
        }
        c.fill();
      };
      screen(p[1], 0, 0.54, false);
      screen(p[2], pitch / 2, 0.3, true);
    },

    bauhaus(c, s, p, r) {
      const n = r.pick([2, 3]), k = s / n;
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const x = i * k, y = j * k;
          const bi = r.int(0, 2), fi = (bi + r.int(1, 2)) % 3;
          c.fillStyle = p[bi];
          c.fillRect(x, y, k + 1, k + 1);
          c.save();
          c.beginPath();
          c.rect(x, y, k, k);
          c.clip();
          c.fillStyle = p[fi];
          c.beginPath();
          const corner = r.int(0, 3), ax = x + (corner & 1) * k, ay = y + (corner >> 1) * k;
          switch (r.int(0, 3)) {
            case 0: c.moveTo(ax, ay); c.arc(ax, ay, k, 0, TAU); break;
            case 1: c.arc(x + k / 2, y + k, k / 2, Math.PI, 0); break;
            case 2: c.arc(x + k / 2, y + k / 2, k * 0.36, 0, TAU); break;
            default: c.moveTo(x, y + k); c.lineTo(x + k / 2, y); c.lineTo(x + k, y + k);
          }
          c.fill();
          c.restore();
        }
      }
    },

    wordmark(c, s, p, r, serial) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      const word = COVER_WORDS[serial % COVER_WORDS.length], size = s * 0.3;
      c.font = font(800, size);
      track(c, -size * 0.05);
      c.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const y = s * 0.3 + i * size * 0.8;
        if (i === 1) {
          c.strokeStyle = p[1];
          c.strokeText(word, s * 0.06, y);
        } else {
          c.fillStyle = i === 2 ? p[2] : p[1];
          c.fillText(word, s * 0.06, y);
        }
      }
      track(c, 0);
      const k = clamp(s / 220, 0.8, 1.3);
      c.fillStyle = p[1];
      c.font = font(500, 8.5 * k, MONO);
      c.fillText(`SIDE A · ${r.int(2, 7)}:${String(r.int(0, 59)).padStart(2, '0')}`, s * 0.06, s - 10 * k);
      return true;
    },

    waves(c, s, p, r) {
      c.fillStyle = p[0];
      c.fillRect(0, 0, s, s);
      const n = r.int(9, 15), amp = s * r.range(0.025, 0.07), freq = (TAU * r.int(1, 3)) / s, ph = r() * TAU;
      for (let i = 0; i <= n; i++) {
        const y0 = (s * i) / n;
        c.beginPath();
        c.moveTo(0, s);
        for (let x = 0; x <= s + 4; x += 4) c.lineTo(x, y0 + Math.sin(x * freq + ph + i * 0.55) * amp);
        c.lineTo(s + 4, s);
        c.closePath();
        c.fillStyle = [p[1], p[0], p[2], p[0]][i % 4];
        c.fill();
      }
    },
  };

  scenes.mosaic = {
    theme: 'dark',
    build(env) {
      return { paint: (ctx) => mosaic(ctx, env) };
    },
  };

  function mosaic(ctx, env) {
    const { w, h, dark } = env;
    const cols = env.o.columns || (w >= 960 ? 6 : w >= 560 ? 4 : 3);
    const pitch = (w + 1) / cols; // 1px gaps
    const rowCount = Math.ceil((h + 1) / pitch);
    const palettes = dark ? COVERS_DARK : COVERS_LIGHT;
    const designs = Object.keys(COVER_DESIGNS);
    const r = env.rng('mosaic');
    const serial = r.int(0, 999);
    ctx.fillStyle = dark ? '#000' : '#fff';
    ctx.fillRect(0, 0, w, h);
    const picks = [];
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < cols; col++) {
        // Neither a palette nor a design repeats within the already-placed tiles two steps around this one.
        const at = (dr, dc) => (row + dr >= 0 && col + dc >= 0 && col + dc < cols ? picks[(row + dr) * cols + col + dc] : null);
        const near = [at(0, -1), at(0, -2), at(-1, -2), at(-1, -1), at(-1, 0), at(-1, 1), at(-1, 2)].filter(Boolean);
        let pi, di;
        do pi = r.int(0, palettes.length - 1); while (near.some((n) => n.pi === pi));
        do di = r.int(0, designs.length - 1); while (near.some((n) => n.di === di));
        picks.push({ pi, di });

        const x0 = snap(env, col * pitch), x1 = snap(env, (col + 1) * pitch - 1);
        const y0 = snap(env, row * pitch), y1 = snap(env, (row + 1) * pitch - 1);
        const s = x1 - x0, p = palettes[pi], tr = env.rng(`tile ${row} ${col}`);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, s, y1 - y0);
        ctx.clip();
        ctx.translate(x0, y0);
        if (!COVER_DESIGNS[designs[di]](ctx, s, p, tr, serial + picks.length)) {
          // A catalogue number keeps small type in every tile.
          const k = clamp(s / 220, 0.8, 1.3);
          ctx.font = font(600, 8.5 * k, MONO);
          const code = `LGW–${String(tr.int(1, 999)).padStart(3, '0')}`;
          const tw = measure(ctx, code);
          ctx.fillStyle = rgba(p[0], 0.9);
          ctx.fillRect(s - tw - 16 * k, s - 21 * k, tw + 10 * k, 15 * k);
          ctx.fillStyle = p[1];
          ctx.fillText(code, s - tw - 11 * k, s - 10.5 * k);
        }
        ctx.restore();
      }
    }
    grain(ctx, 0.02);
  }

  /* ------------------------------------------------------------------ poster */

  scenes.poster = {
    theme: 'light',
    build(env) {
      return { paint: (ctx) => poster(ctx, env) };
    },
  };

  function poster(ctx, env) {
    const { w, h, dark } = env;
    const paper = dark ? '#0e0e11' : '#f2efe7';
    const ink = dark ? '#f3f1ea' : '#141414';
    const r = env.rng('poster');
    const m = Math.round(clamp(Math.min(w, h) * 0.04, 14, 44));
    const wide = w >= h * 1.15;

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    posterGrid(ctx, env, m, ink);
    cropMarks(ctx, env, m, ink);

    // Header microtext.
    ctx.fillStyle = ink;
    ctx.font = font(600, 8);
    track(ctx, 1.1);
    const title = 'LIQUID GLASS FOR THE WEB / OPTICAL TEST SHEET';
    const sheet = `SHEET ${String(hash32(env.o.seed ?? 1) % 90 + 10)} · 1:1 · SRGB · 380–780 NM`;
    ctx.fillText(title, m, m + 8);
    if (measure(ctx, title) + measure(ctx, sheet) + 24 < w - 2 * m) {
      ctx.textAlign = 'right';
      ctx.fillText(sheet, w - m, m + 8);
      ctx.textAlign = 'left';
    }
    track(ctx, 0);
    hRule(ctx, env, m, m + 14, w - 2 * m, 1 / env.dpr);

    // Every block is optional: on small canvases the ones that do not fit are simply left out.
    const top = m + 30, bottom = h - m - 40;
    const fits = (box) => box.w >= 48 && box.h >= 24 && box.y + box.h <= bottom + 1;
    if (wide) {
      const split = Math.round(w * 0.58);
      const typeBottom = displayType(ctx, env, { x: m, y: top, w: split - m - 24, h: (bottom - top) * 0.52 }, ink, r);
      const lowY = typeBottom + 22;
      const htW = Math.round((split - m) * 0.44);
      const ht = { x: m, y: lowY, w: htW, h: bottom - lowY };
      const micro = { x: m + htW + 22, y: lowY, w: split - m - htW - 46, h: bottom - lowY };
      if (fits(ht)) halftone(ctx, env, ht, ink);
      if (fits(micro)) microColumns(ctx, env, micro, ink, r);
      const R = Math.min((w - m - split) / 2 - 58, (bottom - top) * 0.3);
      const cx = (split + w - m) / 2, cy = top + R + 62;
      if (R >= 24) wheel(ctx, env, cx, cy, R, ink, paper);
      const band = { x: split + 8, y: cy + R + 74, w: w - m - split - 8, h: 50 };
      if (R >= 24 && fits(band)) {
        spectrum(ctx, env, band, ink);
        const lens = { x: band.x, y: band.y + band.h + 30, w: band.w, h: bottom - band.y - band.h - 30 };
        if (fits(lens) && lens.h >= 70) rayDiagram(ctx, env, lens, ink);
      }
    } else {
      let y = displayType(ctx, env, { x: m, y: top, w: w - 2 * m, h: (bottom - top) * 0.22 }, ink, r) + 20;
      const R = Math.min((w - 2 * m) / 2 - 58, (bottom - top) * 0.15);
      if (R >= 24) {
        wheel(ctx, env, w / 2, y + R + 58, R, ink, paper);
        y += 2 * R + 132;
      }
      const band = { x: m, y, w: w - 2 * m, h: 46 };
      if (fits(band)) {
        spectrum(ctx, env, band, ink);
        y += 74;
      }
      const lens = { x: m, y, w: w - 2 * m, h: 120 };
      if (bottom - y > 440) {
        rayDiagram(ctx, env, lens, ink);
        y += lens.h + 26;
      }
      const ht = { x: m, y, w: w - 2 * m, h: Math.round((bottom - y) * 0.45) };
      if (fits(ht)) {
        halftone(ctx, env, ht, ink);
        y += ht.h + 18;
      }
      const micro = { x: m, y, w: w - 2 * m, h: bottom - y };
      if (fits(micro)) microColumns(ctx, env, micro, ink, r);
    }
    if (h > 120) colourBars(ctx, env, { x: m, y: h - m - 26, w: w - 2 * m, h: 14 }, ink);
    grain(ctx, 0.018);
  }

  function posterGrid(ctx, env, m, ink) {
    const { w, h } = env;
    const minor = new Path2D(), major = new Path2D();
    const hair = 1 / env.dpr;
    for (let x = m, i = 0; x <= w - m; x += 8, i++) (i % 8 ? minor : major).rect(snap(env, x), m, hair, h - 2 * m);
    for (let y = m, i = 0; y <= h - m; y += 8, i++) (i % 8 ? minor : major).rect(m, snap(env, y), w - 2 * m, hair);
    ctx.fillStyle = rgba(ink, env.dark ? 0.07 : 0.06);
    ctx.fill(minor);
    ctx.fillStyle = rgba(ink, env.dark ? 0.2 : 0.16);
    ctx.fill(major);
  }

  function cropMarks(ctx, env, m, ink) {
    const { w, h } = env;
    const L = Math.min(12, m - 4);
    ctx.fillStyle = ink;
    for (const [x, y] of [[m, m], [w - m, m], [m, h - m], [w - m, h - m]]) {
      const sx = x < w / 2 ? -1 : 1, sy = y < h / 2 ? -1 : 1;
      hRule(ctx, env, sx < 0 ? x - L - 3 : x + 3, y, L, 1 / env.dpr);
      vRule(ctx, env, x, sy < 0 ? y - L - 3 : y + 3, L, 1 / env.dpr);
    }
    // Registration target centred in the bottom margin.
    const cx = w / 2, cy = h - m / 2, R = Math.min(6, m / 3);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 / env.dpr;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.moveTo(cx - R * 1.8, cy);
    ctx.lineTo(cx + R * 1.8, cy);
    ctx.moveTo(cx, cy - R * 1.8);
    ctx.lineTo(cx, cy + R * 1.8);
    ctx.stroke();
  }

  // "Liquid" solid, "Glass" filled with a spectrum sweep; returns the bottom of the setting.
  function displayType(ctx, env, box, ink, r) {
    ctx.font = font(800, 100);
    track(ctx, -4.5);
    const widest = Math.max(measure(ctx, 'Liquid'), measure(ctx, 'Glass'));
    const size = Math.floor(Math.min((box.w / widest) * 100, box.h / 1.72));
    if (size < 12) {
      track(ctx, 0);
      return box.y;
    }
    ctx.font = font(800, size);
    track(ctx, -size * 0.045);
    const b1 = box.y + size * 0.76, b2 = b1 + size * 0.86;
    ctx.fillStyle = ink;
    ctx.fillText('Liquid', box.x - size * 0.04, b1);
    const gw = ctx.measureText('Glass').width;
    const g = ctx.createLinearGradient(box.x, 0, box.x + gw, 0);
    SPECTRUM.forEach((c, i) => g.addColorStop(i / (SPECTRUM.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillText('Glass', box.x - size * 0.04, b2);
    track(ctx, 0);
    ctx.fillStyle = ink;
    ctx.font = font(500, 8, MONO);
    const note = `${size}PX / 800 / −4.5% / SET IN SYSTEM UI / PROOF ${r.int(100, 999)}`;
    ctx.fillText(note, box.x, b2 + size * 0.2);
    return b2 + size * 0.2 + 4;
  }

  function wheel(ctx, env, cx, cy, R, ink, paper) {
    // HSV disc at V = 1: hue by angle (conic sweep), saturation by radius (a white radial wash).
    const cone = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    for (let i = 0; i <= 12; i++) cone.addColorStop(i / 12, `hsl(${i * 30},100%,50%)`);
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.fill();
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    wash.addColorStop(0, '#fff');
    wash.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wash;
    ctx.fill();

    // Saturation guides.
    ctx.strokeStyle = 'rgba(20,20,20,.28)';
    ctx.lineWidth = 1 / env.dpr;
    ctx.beginPath();
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.moveTo(cx + R * f, cy);
      ctx.arc(cx, cy, R * f, 0, TAU);
    }
    ctx.stroke();

    // Segmented hue ring, 36 steps with hairline gaps.
    const r0 = R + 8, r1 = R + 24, gap = 1.2 / r1;
    for (let i = 0; i < 36; i++) {
      const a0 = -Math.PI / 2 + (i * TAU) / 36 + gap / 2, a1 = a0 + TAU / 36 - gap;
      ctx.fillStyle = `hsl(${i * 10},${i % 2 ? 90 : 100}%,${i % 3 ? 52 : 46}%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.fill();
    }

    // Degree scale: ticks every 2°, long ticks every 10°, labels every 30°.
    ctx.strokeStyle = ink;
    ctx.beginPath();
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180 - Math.PI / 2, L = d % 10 ? 4 : 9;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(cx + ca * (R + 30), cy + sa * (R + 30));
      ctx.lineTo(cx + ca * (R + 30 + L), cy + sa * (R + 30 + L));
    }
    // Crosshair through the centre.
    ctx.moveTo(cx - R - 40, cy);
    ctx.lineTo(cx + R + 40, cy);
    ctx.moveTo(cx, cy - R - 40);
    ctx.lineTo(cx, cy + R + 40);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = font(500, 8, MONO);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = (d * Math.PI) / 180 - Math.PI / 2;
      ctx.fillText(`${d}°`, cx + Math.cos(a) * (R + 54), cy + Math.sin(a) * (R + 54));
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = paper;
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.font = font(600, 8);
    track(ctx, 1);
    ctx.fillText('HSV · V = 1.00 · S BY RADIUS', cx - R - 52, cy - R - 42);
    track(ctx, 0);
  }

  function spectrum(ctx, env, box, ink) {
    const barH = Math.round(box.h * 0.46);
    const y = box.y + 12;
    ctx.fillStyle = '#000';
    ctx.fillRect(box.x, y, box.w, barH);
    const g = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
    for (let nm = 380; nm <= 780; nm += 10) g.addColorStop((nm - 380) / 400, wavelength(nm));
    ctx.fillStyle = g;
    ctx.fillRect(box.x, y, box.w, barH);
    ctx.fillStyle = ink;
    ctx.font = font(600, 8);
    track(ctx, 1);
    ctx.fillText('VISIBLE SPECTRUM · WAVELENGTH IN NM', box.x, box.y + 6);
    track(ctx, 0);
    ctx.font = font(500, 8, MONO);
    ctx.textAlign = 'center';
    for (let nm = 380; nm <= 780; nm += 10) {
      const x = box.x + ((nm - 380) / 400) * box.w;
      const major = nm % 50 === 0;
      vRule(ctx, env, Math.min(x, box.x + box.w - 1), y + barH, major ? 7 : 3, 1 / env.dpr);
      if (major) ctx.fillText(String(nm), clamp(x, box.x + 8, box.x + box.w - 8), y + barH + 16);
    }
    ctx.textAlign = 'left';
  }

  // Thin-lens ray diagram: parallel rays converge through a biconvex lens, and each ray splits by
  // wavelength (red focuses beyond blue) — the dispersion the lifted glass imitates.
  function rayDiagram(ctx, env, box, ink) {
    const hair = 1 / env.dpr;
    const cy = box.y + 14 + (box.h - 14) / 2;
    const half = (box.h - 14) * 0.44;
    const lx = box.x + box.w * 0.3;
    const f = box.w * 0.4;
    ctx.fillStyle = ink;
    ctx.font = font(600, 8);
    track(ctx, 1);
    ctx.fillText('THIN LENS · N = 1.50 · CHROMATIC FOCUS', box.x, box.y + 6);
    track(ctx, 0);
    ctx.fillStyle = rgba(ink, 0.45);
    hRule(ctx, env, box.x, cy, box.w, hair);

    // Lens: two circular arcs with sagitta `bulge`.
    const bulge = Math.min(half * 0.2, 14), R = (half * half + bulge * bulge) / (2 * bulge), a = Math.asin(half / R);
    ctx.beginPath();
    ctx.arc(lx + bulge - R, cy, R, -a, a);
    ctx.arc(lx - bulge + R, cy, R, Math.PI - a, Math.PI + a);
    ctx.closePath();
    ctx.fillStyle = 'rgba(100,170,255,.16)';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = hair;
    ctx.stroke();

    // Incoming rays, then three refracted colours per ray, carried on past the focus to the edge.
    const rays = 9, end = box.x + box.w;
    ctx.strokeStyle = rgba(ink, 0.7);
    ctx.beginPath();
    for (let i = 0; i < rays; i++) {
      const y = cy - half * 0.86 + (i * half * 1.72) / (rays - 1);
      ctx.moveTo(box.x, y);
      ctx.lineTo(lx, y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    for (const [colour, k] of [['#ff3b30', 1.07], ['#34c759', 1], ['#007aff', 0.93]]) {
      ctx.strokeStyle = rgba(colour, 0.85);
      ctx.beginPath();
      for (let i = 0; i < rays; i++) {
        const y = cy - half * 0.86 + (i * half * 1.72) / (rays - 1);
        const fx = lx + f * k;
        ctx.moveTo(lx, y);
        ctx.lineTo(end, y + ((cy - y) * (end - lx)) / (fx - lx));
      }
      ctx.stroke();
    }
    ctx.fillStyle = ink;
    ctx.font = font(500, 8, MONO);
    for (const [label, k] of [['F·B', 0.93], ['F·R', 1.07]]) {
      const x = lx + f * k;
      vRule(ctx, env, x, cy + 4, 6, hair);
      ctx.textAlign = 'center';
      ctx.fillText(label, x, cy + 20);
    }
    ctx.textAlign = 'left';
  }

  // Three screens at the classic CMY angles (15°, 75°, 0°); overprinted with multiply on paper,
  // screened additively on black, so the rosettes appear either way.
  function halftone(ctx, env, box, ink) {
    const { dark } = env;
    const pitch = 6.5;
    const inks = dark ? ['#ff375f', '#30d158', '#0a84ff'] : ['#00a0e9', '#e5007e', '#ffd400'];
    const tones = [
      (u, v) => (1 - clamp(Math.hypot(u - 0.36, v - 0.42) / 0.46, 0, 1)) ** 0.7,
      (u, v) => (1 - clamp(Math.hypot(u - 0.68, v - 0.6) / 0.44, 0, 1)) ** 0.7,
      (u, v) => 0.2 + 0.7 * u * (1 - v),
    ];
    const angles = [15, 75, 0];
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, reach = Math.hypot(box.w, box.h) / 2 + pitch;
    tones.forEach((tone, s) => {
      const a = (angles[s] * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      ctx.fillStyle = inks[s];
      ctx.beginPath();
      for (let j = -reach; j <= reach; j += pitch) {
        for (let i = -reach; i <= reach; i += pitch) {
          const x = cx + i * ca - j * sa, y = cy + i * sa + j * ca;
          if (x < box.x - pitch || x > box.x + box.w + pitch || y < box.y - pitch || y > box.y + box.h + pitch) continue;
          const t = tone((x - box.x) / box.w, (y - box.y) / box.h);
          if (t < 0.04) continue;
          const rad = pitch * 0.58 * Math.sqrt(t);
          ctx.moveTo(x + rad, y);
          ctx.arc(x, y, rad, 0, TAU);
        }
      }
      ctx.fill();
    });
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 / env.dpr;
    ctx.strokeRect(snap(env, box.x) + 0.5 / env.dpr, snap(env, box.y) + 0.5 / env.dpr, box.w, box.h);
    ctx.fillStyle = ink;
    ctx.font = font(500, 8, MONO);
    ctx.fillText(dark ? 'RGB SCREEN · 15° 75° 0° · 150 LPI' : 'CMY SCREEN · 15° 75° 0° · 150 LPI', box.x, box.y + box.h + 12);
  }

  function microColumns(ctx, env, box, ink, r) {
    const n = box.w > 420 ? 3 : box.w > 260 ? 2 : 1;
    const gutter = 14, cw = (box.w - gutter * (n - 1)) / n;
    const flow = textFlow(r);
    for (let c = 0; c < n; c++) {
      const x = box.x + c * (cw + gutter);
      ctx.fillStyle = ink;
      ctx.font = font(700, 8);
      track(ctx, 0.9);
      ctx.fillText(`${String(c + 1).padStart(2, '0')} / ${r.pick(HEADS).toUpperCase()}`, x, box.y + 7);
      track(ctx, 0);
      hRule(ctx, env, x, box.y + 11, cw, 1 / env.dpr);
      ctx.font = font(400, 8);
      for (let y = box.y + 22; y < box.y + box.h; ) {
        const line = flow.line(ctx, cw);
        setLine(ctx, line, x, y, cw, 10);
        y += line.last ? 14 : 10;
      }
    }
  }

  function colourBars(ctx, env, box, ink) {
    const patches = [
      ['#00a0e9', 'C'], ['#e5007e', 'M'], ['#ffd400', 'Y'], ['#111111', 'K'],
      ['#ff3b30', 'R'], ['#34c759', 'G'], ['#007aff', 'B'],
      ...Array.from({ length: 11 }, (_, i) => [toHex([255 - i * 25.5, 255 - i * 25.5, 255 - i * 25.5]), `${i * 10}`]),
      ...Array.from({ length: 12 }, (_, i) => [oklch(0.7, 0.16, i * 30), `${i * 30}°`]),
    ];
    const pw = box.w / patches.length;
    ctx.font = font(500, 7.5, MONO);
    ctx.textAlign = 'center';
    patches.forEach(([c, label], i) => {
      const x = snap(env, box.x + i * pw), x1 = snap(env, box.x + (i + 1) * pw);
      ctx.fillStyle = c;
      ctx.fillRect(x, box.y, x1 - x, box.h);
      ctx.fillStyle = ink;
      if (pw >= 18) ctx.fillText(label, (x + x1) / 2, box.y + box.h + 10);
    });
    ctx.textAlign = 'left';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1 / env.dpr;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }

  /* ================================================================== public API */

  const FROZEN = new URLSearchParams(location.search).has('freeze');

  function resolve(name, opts) {
    const scene = scenes[name];
    if (!scene) throw new Error(`LGArt: unknown generator "${name}"`);
    return { scene, o: { ...opts, theme: opts.theme || scene.theme } };
  }

  // Render once. `t` (seconds) positions animated layers; static scenes ignore it.
  function render(name, canvas, opts = {}) {
    const { scene, o } = resolve(name, opts);
    const t0 = performance.now();
    const env = surface(canvas, o);
    if (!env) return { width: 0, height: 0, dpr: 0, ms: 0 };
    const painter = scene.build(env);
    painter.paint(env.ctx, o.t || 0);
    if (painter.detail) painter.detail(env.ctx);
    return { width: env.w, height: env.h, dpr: env.dpr, ms: performance.now() - t0 };
  }

  // Render now and keep the canvas rendered: debounced re-render when its CSS size or the DPR changes,
  // and (opt-in) a gentle drift of animated scenes at ≤ 30 fps while on screen. Drift never runs under
  // ?freeze or prefers-reduced-motion.
  function mount(canvas, name, opts = {}) {
    const { scene } = resolve(name, opts);
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let options = { ...opts };
    let live = null; // cached build while animating: { env, painter, overlay }
    let raf = 0, timer = 0, last = 0, clock = options.t || 0, onScreen = true, dead = false;
    let size = '';

    const sizeKey = () => `${canvas.clientWidth}x${canvas.clientHeight}@${Math.min(2, window.devicePixelRatio || 1)}`;
    const wantsMotion = () => !!options.animate && !!scene.animated && !FROZEN && !motion.matches && !dead;

    function draw() {
      size = sizeKey();
      live = null;
      handle.info = render(name, canvas, { ...options, t: clock });
      if (wantsMotion()) start();
      return handle.info;
    }

    function build() {
      const { o } = resolve(name, options);
      const env = surface(canvas, o);
      if (!env) return null;
      const painter = scene.build(env);
      let overlay = null;
      if (painter.detail) {
        overlay = makeCanvas(canvas.width, canvas.height);
        const octx = overlay.getContext('2d');
        octx.setTransform(env.sx, 0, 0, env.sy, 0, 0);
        painter.detail(octx);
      }
      return { env, painter, overlay };
    }

    function frame(now) {
      raf = 0;
      if (!wantsMotion() || !onScreen) return;
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 30 - 1) return;
      clock += last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      if (!live) live = build();
      if (!live) return;
      const { env, painter, overlay } = live;
      painter.paint(env.ctx, clock);
      if (overlay) {
        env.ctx.save();
        env.ctx.setTransform(1, 0, 0, 1, 0, 0);
        env.ctx.drawImage(overlay, 0, 0);
        env.ctx.restore();
      }
    }

    function start() {
      if (!raf && wantsMotion() && onScreen) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    }

    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (sizeKey() !== size) draw();
      }, 150);
    });
    resize.observe(canvas);

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    visibility.observe(canvas);

    const onMotion = () => (wantsMotion() ? start() : stop());
    motion.addEventListener('change', onMotion);

    const handle = {
      canvas,
      name,
      info: null,
      /** Re-render now (for example after the page theme changed without a resize). */
      render: draw,
      /** Merge new options (seed, theme, animate, …) and re-render. */
      set(next) {
        options = { ...options, ...next };
        stop();
        return draw();
      },
      start() {
        options.animate = true;
        start();
      },
      stop() {
        options.animate = false;
        stop();
      },
      get animating() {
        return raf !== 0;
      },
      destroy() {
        dead = true;
        stop();
        clearTimeout(timer);
        resize.disconnect();
        visibility.disconnect();
        motion.removeEventListener('change', onMotion);
        live = null;
      },
    };
    draw();
    return handle;
  }

  function toPNG(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('LGArt: toBlob failed'))), 'image/png');
    });
  }

  const LGArt = { names: Object.keys(scenes), render: (canvas, name, opts) => render(name, canvas, opts), mount, toPNG };
  for (const name of LGArt.names) LGArt[name] = (canvas, opts) => render(name, canvas, opts);
  globalThis.LGArt = LGArt;
})();
