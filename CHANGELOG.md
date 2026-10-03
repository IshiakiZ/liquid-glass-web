# Changelog

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
