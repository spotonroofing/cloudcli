# Icon variations — the twisted hoop

Ten marks for Willem to pick from, all on one seed: take a hula hoop, grab it by
both sides and twist so the top and bottom lines cross, and you get something
like an infinity symbol with one lobe heavier than the other.

Every file is 512 by 512 on a transparent background, one monochrome ink drawn
as `currentColor` so it takes the surface's own color on light and dark, clean
paths only — no raster, no filters, no gradients. Nothing here is wired into the
app: `public/` still ships the command bracket, and `public/generate-icons.js`
still owns the favicon, the manifest and the PNG sizes. When Willem picks one,
that mark moves into the generator and `design/tokens.md` gets the brand entry.

Regenerate every file in this folder with:

```
node assets/icon-variants/build.mjs
```

The generator writes the ten SVGs and `sheet.png`, then checks that each file
parses at 512 by 512 and carries no ink but `currentColor`.

## The ten

Close to the twisted hoop:

1. `01-twist.svg` — The seed read straight: the hoop twisted once, heavy lobe left, one even bold stroke, closed.
2. `02-twist-weight.svg` — The same twist as a ribbon whose weight swells through the big lobe and thins through the small one, so the heavier lobe is heavier ink as well as bigger shape.
3. `03-twist-open.svg` — The seed with its ends opened at the small lobe, two round caps facing each other, so the hoop reads as grabbed rather than sealed.
4. `04-twist-lean.svg` — Lobe balance pushed hard, thin ink and a fourteen degree tip, so the mark reads as a hoop turned in space rather than a flat figure eight.

Abstract derivatives:

5. `05-stroke-gap.svg` — One continuous stroke with a single gap at the outer edge of the big lobe: a line with a beginning and an end that happens to cross itself.
6. `06-half-hoop.svg` — The big lobe alone, the small one reduced to two stubs aimed at the middle: the crossing is implied and the eye closes it.
7. `07-two-arcs.svg` — The two lobes pulled apart into overlapping arcs, each opening turned toward the other, the strokes crossing where the twist used to be.

On the nose for a command center:

8. `08-hoop-core.svg` — The twist carrying a core: the heavy lobe becomes an orbit around a solid point and the small lobe reads as the tail of the twist.
9. `09-orbit-core.svg` — An orbit with a core: a solid center, a tipped ring around it and one body riding the ring, the most literal command center of the set.
10. `10-ring-bar.svg` — The hoop closed and steadied, one bar held across the middle: no crossing left, the calmest and the most legible small.

## The contact sheet

`sheet.png` renders all ten at 180px and at 60px, on a light tile
(`#F7F5F1` with the light theme's steel ink) and a dark tile (`#141414` with the
dark theme's ink), so the phone reading is visible at a glance. 60px is roughly
the favicon and the app icon in a phone home screen row.

What happens to the crossing at 60px:

- Holds: `01`, `03`, `05`, `08`. The X is still two distinct lines.
- `02` holds but flattens: the taper stops reading, so it looks close to `01` at that size.
- Lost: `04` — the thin stroke and the tight crossing angle pinch into a solid knot.
- Lost: `07` — the two arcs merge into one blob through the overlap and the two crossing points disappear.
- No crossing to lose, by design: `06` (it is implied at every size, and at 60px the stubs read as a separate mark from the loop), `09` (the orbiting body merges into the ring), `10` (the calmest of the ten at this size).
