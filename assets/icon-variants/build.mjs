/**
 * Command Center icon variations — ten takes on the twisted hoop.
 *
 * The seed, in Willem's words: take a hula hoop, grab it by both sides and
 * twist so the top and bottom lines cross; you get something like an infinity
 * symbol where one lobe is heavier than the other.
 *
 *   node assets/icon-variants/build.mjs
 *
 * writes 01-*.svg .. 10-*.svg (512 square, transparent, single currentColor
 * ink, clean paths only) and sheet.png (all ten at 180px and 60px on a light
 * and a dark tile), then verifies every file parses and carries no color other
 * than currentColor. Nothing here is wired into the app; public/ is untouched
 * and public/generate-icons.js still owns the shipping mark.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 512;
const MARGIN = 44;

const f = (n) => Number(n.toFixed(2)).toString();

// ---------------------------------------------------------------- geometry

// The twisted hoop as a Gerono lemniscate with two smooth deformations:
// `a` stretches one lobe and shrinks the other along x, `b` gives the heavy
// lobe more height. Both are smooth in x, so the crossing keeps one tangent
// per branch and the curve never kinks.
function twistPoint(t, { a, b, amp }) {
  const x = Math.sin(t);
  const y = amp * Math.sin(2 * t);
  return [x + a * x * x, y * (1 + b * -x)];
}

function twistArc(t0, t1, steps, opts) {
  const pts = [];
  for (let i = 0; i <= steps; i++) pts.push(twistPoint(t0 + ((t1 - t0) * i) / steps, opts));
  return pts;
}

function twistLoop(steps, opts) {
  const pts = [];
  for (let i = 0; i < steps; i++) pts.push(twistPoint((i / steps) * Math.PI * 2, opts));
  return pts;
}

function rotate(pts, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

// Maps a normalized figure into the 512 box, leaving room for the stroke.
function fitter(points, pad) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const avail = SIZE - 2 * MARGIN - 2 * pad;
  const scale = avail / Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const map = (p) => [SIZE / 2 + (p[0] - cx) * scale, SIZE / 2 + (p[1] - cy) * scale];
  map.scale = scale;
  return map;
}

// Catmull-Rom through the samples, emitted as cubic beziers.
function closedPath(pts) {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    d +=
      ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

function openPath(pts) {
  const n = pts.length;
  const at = (i) => pts[Math.max(0, Math.min(n - 1, i))];
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    d +=
      ` C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}` +
      ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}` +
      ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// A tapered ribbon: the centerline offset by a per-sample half width. Both
// lobes are emitted with the same winding so a nonzero fill unions them at the
// crossing instead of punching a hole there.
function ribbon(pts, widths) {
  const n = pts.length;
  const left = [];
  const right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    left.push([pts[i][0] - ty * widths[i], pts[i][1] + tx * widths[i]]);
    right.push([pts[i][0] + ty * widths[i], pts[i][1] - tx * widths[i]]);
  }
  const loop = left.concat(right.reverse());
  return closedPath(signedArea(loop) < 0 ? loop.slice().reverse() : loop);
}

function ellipseArc(t0, t1, steps, { rx, ry, deg, cx, cy }) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const th = ((t0 + ((t1 - t0) * i) / steps) * Math.PI) / 180;
    const x = rx * Math.cos(th);
    const y = ry * Math.sin(th);
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

function circleArc(t0, t1, steps, { r, cx, cy }) {
  return ellipseArc(t0, t1, steps, { rx: r, ry: r, deg: 0, cx, cy });
}

// ---------------------------------------------------------------- variants

const stroked = (width, body) =>
  `<g fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;

function variantTwist({ a, b, amp, width, deg = 0 }) {
  const raw = rotate(twistLoop(48, { a, b, amp }), deg);
  const map = fitter(raw, width / 2);
  return stroked(width, `<path d="${closedPath(raw.map(map))}"/>`);
}

// 01 — the seed, read straight: heavy left lobe, one even bold stroke, closed.
function v01() {
  return variantTwist({ a: -0.2, b: 0.22, amp: 0.5, width: 38 });
}

// 02 — the twist as a ribbon whose weight follows the lobes.
function v02() {
  const opts = { a: -0.2, b: 0.22, amp: 0.5 };
  const map = fitter(twistLoop(48, opts), 0.16);
  const halfWidth = (t) => {
    const x = Math.sin(t);
    return (24 - x * 12) * 1;
  };
  const lobe = (t0, t1) => {
    const ts = [];
    for (let i = 0; i <= 44; i++) ts.push(t0 + ((t1 - t0) * i) / 44);
    const pts = ts.map((t) => map(twistPoint(t, opts)));
    return ribbon(pts, ts.map(halfWidth));
  };
  return `<path fill="currentColor" fill-rule="nonzero" d="${lobe(0, Math.PI)} ${lobe(Math.PI, Math.PI * 2)}"/>`;
}

// 03 — the same hoop with its ends opened at the small lobe.
function v03() {
  const opts = { a: -0.2, b: 0.22, amp: 0.5 };
  const gap = 0.24;
  const raw = twistArc(Math.PI / 2 + gap, Math.PI * 2 + Math.PI / 2 - gap, 60, opts);
  const map = fitter(raw, 19);
  return stroked(38, `<path d="${openPath(raw.map(map))}"/>`);
}

// 04 — the balance pushed hard: a small lobe against a large one, thin ink,
// tipped a few degrees so the twist reads as a hoop turned in space.
function v04() {
  return variantTwist({ a: -0.34, b: 0.34, amp: 0.46, width: 24, deg: -14 });
}

// 05 — one continuous stroke with a single gap at the outer edge of the big
// lobe: the hoop is a line with a beginning and an end, not a closed loop.
function v05() {
  const opts = { a: -0.22, b: 0.26, amp: 0.52 };
  const gap = 0.17;
  const raw = twistArc((3 * Math.PI) / 2 + gap, Math.PI * 2 + (3 * Math.PI) / 2 - gap, 60, opts);
  const map = fitter(raw, 16);
  return stroked(32, `<path d="${openPath(raw.map(map))}"/>`);
}

// 06 — the big lobe alone, with the small lobe reduced to two stubs aimed at
// the middle: the crossing is implied and the eye closes it.
function v06() {
  const opts = { a: -0.2, b: 0.22, amp: 0.5 };
  const cut = 0.14;
  const big = twistArc(Math.PI + cut, Math.PI * 2 - cut, 44, opts);
  const stubA = twistArc(cut, 0.62, 10, opts);
  const stubB = twistArc(Math.PI - 0.62, Math.PI - cut, 10, opts);
  const map = fitter([...big, ...stubA, ...stubB], 18);
  const d = [big, stubA, stubB].map((p) => `<path d="${openPath(p.map(map))}"/>`).join('');
  return stroked(36, d);
}

// 07 — the two lobes pulled apart into overlapping arcs, each opening turned
// toward the other, the strokes crossing where the twist used to be.
function v07() {
  const big = circleArc(200, 520, 40, { r: 132, cx: 184, cy: 256 });
  const small = circleArc(22, 338, 40, { r: 92, cx: 368, cy: 256 });
  return stroked(
    34,
    `<path d="${openPath(big)}"/><path d="${openPath(small)}"/>`,
  );
}

// 08 — the hoop carrying a core: the heavy lobe becomes an orbit around a
// solid point, the small lobe the tail of the twist.
function v08() {
  const opts = { a: -0.2, b: 0.24, amp: 0.54 };
  const raw = twistLoop(48, opts);
  const map = fitter(raw, 15);
  const core = map([-0.62, 0]);
  return `${stroked(30, `<path d="${closedPath(raw.map(map))}"/>`)}<circle cx="${f(core[0])}" cy="${f(core[1])}" r="46" fill="currentColor"/>`;
}

// 09 — an orbit with a core: a solid center, a tipped ring around it and one
// body riding the ring.
function v09() {
  const orbit = { rx: 204, ry: 108, deg: -22, cx: 256, cy: 256 };
  const ring = ellipseArc(0, 360, 48, orbit);
  const body = ellipseArc(40, 40, 1, orbit)[0];
  return `${stroked(28, `<path d="${closedPath(ring.slice(0, -1))}"/>`)}<circle cx="256" cy="256" r="48" fill="currentColor"/><circle cx="${f(body[0])}" cy="${f(body[1])}" r="27" fill="currentColor"/>`;
}

// 10 — a ring with a single bar: the hoop closed and steadied, one line held
// across the middle.
function v10() {
  return stroked(
    34,
    '<circle cx="256" cy="256" r="176"/><path d="M148 256 L364 256"/>',
  );
}

const VARIANTS = [
  { file: '01-twist', build: v01, note: 'The seed read straight: the hoop twisted once, heavy lobe left, one even bold stroke, closed.' },
  { file: '02-twist-weight', build: v02, note: 'The same twist as a ribbon whose weight swells through the big lobe and thins through the small one, so the heavier lobe is heavier ink as well as bigger shape.' },
  { file: '03-twist-open', build: v03, note: 'The seed with its ends opened at the small lobe, two round caps facing each other, so the hoop reads as grabbed rather than sealed.' },
  { file: '04-twist-lean', build: v04, note: 'Lobe balance pushed hard, thin ink and a nine degree tip, so the mark reads as a hoop turned in space rather than a flat figure eight.' },
  { file: '05-stroke-gap', build: v05, note: 'One continuous stroke with a single gap at the outer edge of the big lobe: a line with a beginning and an end that happens to cross itself.' },
  { file: '06-half-hoop', build: v06, note: 'The big lobe alone, the small one reduced to two stubs aimed at the middle: the crossing is implied and the eye closes it.' },
  { file: '07-two-arcs', build: v07, note: 'The two lobes pulled apart into overlapping arcs, each opening turned toward the other, the strokes crossing where the twist used to be.' },
  { file: '08-hoop-core', build: v08, note: 'The twist carrying a core: the heavy lobe becomes an orbit around a solid point and the small lobe reads as the tail of the twist.' },
  { file: '09-orbit-core', build: v09, note: 'An orbit with a core: a solid center, a tipped ring around it and one body riding the ring, the most literal command center of the set.' },
  { file: '10-ring-bar', build: v10, note: 'The hoop closed and steadied, one bar held across the middle: no crossing left, the calmest and the most legible small.' },
];

function svgFor(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" fill="none">${inner}</svg>\n`;
}

// ------------------------------------------------------------- contact sheet

const LIGHT_BG = '#F7F5F1';
const LIGHT_INK = '#5C728A';
const DARK_BG = '#141414';
const DARK_INK = '#8FA3B8';

const COLS = [
  { size: 180, width: 224, dark: false, label: '180 light' },
  { size: 60, width: 104, dark: false, label: '60 light' },
  { size: 180, width: 224, dark: true, label: '180 dark' },
  { size: 60, width: 104, dark: true, label: '60 dark' },
];

function sheetSvg(inners) {
  const padX = 32;
  const labelW = 196;
  const headerH = 76;
  const rowH = 220;
  const bodyTop = headerH;
  const width = padX * 2 + labelW + COLS.reduce((s, c) => s + c.width, 0);
  const height = bodyTop + rowH * VARIANTS.length + 28;

  const xs = [];
  let x = padX + labelW;
  for (const col of COLS) {
    xs.push(x);
    x += col.width;
  }
  const lightW = COLS[0].width + COLS[1].width;
  const darkW = COLS[2].width + COLS[3].width;

  const parts = [
    `<rect width="${width}" height="${height}" fill="#FFFFFF"/>`,
    `<rect x="${xs[0]}" y="${bodyTop}" width="${lightW}" height="${height - bodyTop}" fill="${LIGHT_BG}"/>`,
    `<rect x="${xs[2]}" y="${bodyTop}" width="${darkW}" height="${height - bodyTop}" fill="${DARK_BG}"/>`,
    `<text x="${padX}" y="46" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#111111">Command Center icon variations — the twisted hoop</text>`,
  ];

  COLS.forEach((col, i) => {
    parts.push(
      `<text x="${xs[i] + col.width / 2}" y="66" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#555555">${col.label}</text>`,
    );
  });

  VARIANTS.forEach((variant, r) => {
    const top = bodyTop + rowH * r;
    const mid = top + rowH / 2;
    parts.push(
      `<text x="${padX}" y="${mid + 6}" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="#111111">${variant.file}</text>`,
    );
    COLS.forEach((col, i) => {
      const ink = col.dark ? DARK_INK : LIGHT_INK;
      const scale = col.size / SIZE;
      const ox = xs[i] + (col.width - col.size) / 2;
      const oy = mid - col.size / 2;
      const art = inners[r].split('currentColor').join(ink);
      parts.push(`<g transform="translate(${ox} ${oy}) scale(${scale.toFixed(5)})">${art}</g>`);
    });
    if (r < VARIANTS.length - 1) {
      parts.push(
        `<rect x="${padX}" y="${top + rowH - 1}" width="${width - padX * 2}" height="1" fill="#E2E0DB"/>`,
      );
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`;
}

// -------------------------------------------------------------------- main

async function main() {
  const inners = VARIANTS.map((v) => v.build());

  VARIANTS.forEach((variant, i) => {
    fs.writeFileSync(path.join(__dirname, `${variant.file}.svg`), svgFor(inners[i]));
  });

  const sheet = sheetSvg(inners);
  await sharp(Buffer.from(sheet)).png().toFile(path.join(__dirname, 'sheet.png'));

  // Verify: every file parses as SVG, and carries no ink but currentColor.
  const problems = [];
  for (const variant of VARIANTS) {
    const file = path.join(__dirname, `${variant.file}.svg`);
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(fill|stroke)="([^"]*)"/g)) {
      if (match[2] !== 'currentColor' && match[2] !== 'none') {
        problems.push(`${variant.file}: ${match[1]}="${match[2]}"`);
      }
    }
    if (/<image|filter=|url\(|Gradient/.test(text)) problems.push(`${variant.file}: raster, filter or gradient`);
    try {
      const meta = await sharp(Buffer.from(text.split('currentColor').join(LIGHT_INK))).metadata();
      if (meta.width !== 512 || meta.height !== 512) problems.push(`${variant.file}: ${meta.width}x${meta.height}`);
    } catch (error) {
      problems.push(`${variant.file}: does not parse (${error.message})`);
    }
  }

  const sheetMeta = await sharp(path.join(__dirname, 'sheet.png')).metadata();
  console.log(`wrote ${VARIANTS.length} svgs + sheet.png ${sheetMeta.width}x${sheetMeta.height}`);
  if (problems.length) {
    console.error('FAIL:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('verify: all svgs parse at 512x512, ink is currentColor only');
}

main();
