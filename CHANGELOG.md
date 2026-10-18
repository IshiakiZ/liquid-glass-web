# Changelog

## 1.2.0 (2026-10-18)

Thick glass.

- **A new preset, `thick`.** `<html data-glass-preset="thick">` (or `LiquidGlass.setPreferences({ preset: 'thick' })`)
  makes every glass a solid slab with a round edge instead of a thin sheet. What passes under it bends and magnifies
  toward the rim, like looking through a glass rod; the rim brightens where the surface tilts away (Fresnel), a crisp
  stroke runs just inside the top edge, and a tight contact shadow sits under it. The showcase now opens with it;
  iOS 26 and iOS 27 are still in its Tune panel and are unchanged.
- **A new optics mode, `bevel`.** `data-glass-optics="bevel"` on any glass. `data-glass-bezel` is then the radius of
  the slab's round edge in px (40 under `thick`), and it is not capped by the element's size: a slab thinner than twice
  that radius is all edge. `data-glass-refraction` scales the bend (0.69 under `thick`).
- Under `thick` the frost and the bend are counted in screen pixels, so a 2x screen shows half the CSS-pixel blur and
  bend at the same settings, and the glass looks the same on every screen.
- Thin fills under `thick` (`--glass-opacity` .04, the text floor .22) so the bent backdrop shows; labels keep their
  halo. A page that needs more sets its own tokens.
- No colour split by default under `thick`: three displacements per glass made a lifted lens drag visibly less
  smooth. `--glass-dispersion` turns it on.
- The showcase's Tune panel has Thick and Bevel, and its Bezel slider reaches 64.

The look follows [liquid-glass.ybouane.com](https://liquid-glass.ybouane.com/), a WebGL renderer that paints a
snapshot of the page. Here it is the same live SVG refraction as before, so the glass follows scrolling and every
change on the page; no code from that project is used.

How the bend works: at depth d inside the edge the slab's surface stands √(d·(2R − d)) high, up to the edge radius R,
and is flat beyond. The backdrop moves up the surface's slope, refracted at the entry and the exit face (index 1.5),
plus a little toward the centre where the slab is full depth. That field is baked into the displacement map in the
grey-tile encoding the magnifier uses (full 8-bit precision for each axis under magnification), with the slope of
the outermost few pixels capped so the map's range stays useful. The result is smoothed by half a device pixel:
feDisplacementMap samples the nearest pixel, which under steady magnification draws faint contour lines. The rim
light comes from the same surface, drawn into the overlay image.

Where it lives in the bundle:

| File | Partial | Change |
|---|---|---|
| `liquid-glass.js` | `core-01-config.js` | `PRESETS.thick` |
| `liquid-glass.js` | `core-03-geometry.js` | `bevelField()` |
| `liquid-glass.js` | `core-04-maps.js` | `buildLensMaps` mode `bevel`; `buildOverlay` option `bevel` (rim light); `workerSource` carries `bevelField` |
| `liquid-glass.js` | `core-05-resources.js` | `acquireLensMap` passes `mode` |
| `liquid-glass.js` | `core-06-filters.js` | `pack()` shared by both encodings; `alt` can be a grey-tile pair (a lifted lens crossfading from a `bevel` map) |
| `liquid-glass.js` | `core-09-glass.js` | optics `bevel`; `derive()` (edge radius, screen pixels), `mapOpts()`, `overlayOpts()`, `requestMap()`, `restSpec()` (grey-tile map, smoothing) |
| `liquid-glass.css` | `01-tokens.css` | the preset's fills |
| `liquid-glass.css` | `02-base.css` | the preset's contact shadow and frost without the script |
| `index.html` | `<html>`, Tune panel | `data-glass-preset="thick"`; Thick and Bevel; Bezel up to 64 |
| `showcase/tuner.js` | Reset | returns to Thick, the page's preset |

## 1.1.0 (2026-10-03)

The pill resizes.

- **Segments sized by their labels.** `data-glass-segments="content"` on a `.glass-segmented` gives each segment
  its label's width plus an equal share of the room that is left, instead of equal widths. The resting pill takes
  the width of the checked segment.
- **The lifted lens takes the width of the item under it.** While you scrub a tab bar or a segmented control, the
  lens now covers exactly the item a release would pick, and its width eases there on the snappy spring instead of
  keeping the width it lifted with. With items of one width (the default layout of both controls) nothing changes.
- The grab point of a segmented control's pill is kept as a share of the pill's width, so a pill that narrows over
  a short segment stays under the pointer.
- The showcase's Controls stage has a content-sized segmented control to try it on.

How the resize works: a lens map is built for one size, and a box animated through sizes that have no map of their
own pinches what is under it. So the lens's box switches to the new item at once (the map for every item width is
built ahead, when the browser is idle) and only the width it shows is eased, drawn as a horizontal scale that
carries the map along with the glass. Magnification stays even while the width changes. Reduced motion keeps the
plain switch.

Where it lives in the bundle (the partial names are marked in the files):

| File | Partial | Change |
|---|---|---|
| `liquid-glass.js` | `comp-pill.js` | `Pill` option `fit`; `ease`, `refit()`, `widthScale()`, `warmSoon()`, `warm()`; `paint()` and `measure()` |
| `liquid-glass.js` | `comp-tabbar.js` | passes `fit: true` |
| `liquid-glass.js` | `comp-segmented.js` | passes `fit: true`; `data-glass-segments`; proportional grab point; watches content-sized segments |
| `liquid-glass.css` | `21-segmented.css` | `[data-glass-segments="content"] > label { flex: 1 1 auto }` |
| `index.html` | Controls stage | one more segmented control, one sentence in the lead |

`I.Pill`'s `fit` is off by default, so an extension that builds its own pill keeps the old behaviour.

## 1.0.0 (2026-09-24)

First public version, as published at https://batch-ly.com/glass/.
