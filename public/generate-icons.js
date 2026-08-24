/**
 * Command Center mark + icon generator.
 *
 * The mark is an abstract twisted circle: three open strands orbit the same
 * center, each strand's radius modulated by two sine terms (a slow 2θ twist
 * that braids the strands through each other, plus a faster 5θ wobble for the
 * organic feel). Everything brand-shaped in public/ is derived from here:
 *
 *   node public/generate-icons.js
 *
 * writes mark.svg (canonical, stroke="currentColor"), favicon.svg/png,
 * icons/icon-*.png (manifest sizes), and mark-128/256.png (sw notifications).
 * The inline React copy of the same paths lives in
 * src/shared/view/CommandCenterMark.tsx — regenerate and re-paste if the
 * strand math changes.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CENTER = 32;
const BASE_RADIUS = 21.5;
const TWIST_DEPTH = 3.4; // 2θ term: how far strands dive across each other
const WOBBLE_DEPTH = 1.4; // 5θ term: organic irregularity
const STRANDS = 3;
const SPAN_DEG = 318; // open strands: round caps + gaps keep it line-art, not a solid ring
const STEP_DEG = 3;

function strandPath(k) {
  const phase = (k * 2 * Math.PI) / STRANDS;
  const startDeg = k * (360 / STRANDS) + 22;
  const points = [];
  for (let deg = startDeg; deg <= startDeg + SPAN_DEG; deg += STEP_DEG) {
    const t = (deg * Math.PI) / 180;
    const r =
      BASE_RADIUS +
      TWIST_DEPTH * Math.sin(2 * t + phase) +
      WOBBLE_DEPTH * Math.sin(5 * t + phase * 1.7);
    points.push([
      (CENTER + r * Math.cos(t)).toFixed(2),
      (CENTER + r * Math.sin(t)).toFixed(2),
    ]);
  }
  return `M${points.map((p) => p.join(' ')).join(' L')}`;
}

const strandPaths = Array.from({ length: STRANDS }, (_, k) => strandPath(k));

function markSvg({ stroke, strokeWidth, background = null, size = 64, markScale = 1 }) {
  const bg = background
    ? `<rect width="64" height="64" rx="${(background.radius ?? 0).toFixed(2)}" fill="${background.fill}"/>`
    : '';
  const inset = (1 - markScale) / 2;
  const group =
    markScale === 1
      ? strandPaths.map((d) => `<path d="${d}"/>`).join('')
      : `<g transform="translate(${(64 * inset).toFixed(2)} ${(64 * inset).toFixed(2)}) scale(${markScale})">${strandPaths
          .map((d) => `<path d="${d}"/>`)
          .join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">${bg}<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round">${group}</g></svg>`;
}

// Steel Blue theme anchors (hex renders of the token values in src/index.css):
// light primary hsl(211 20% 45%) and a light ink for dark icon tiles.
const STEEL_PRIMARY = '#5C728A';
const ICON_BG = '#19202A';
const ICON_STROKE = '#A9BED3';

const publicDir = __dirname;
const iconsDir = path.join(publicDir, 'icons');

async function main() {
  // Canonical asset: theme-agnostic, inherits color from wherever it's inlined.
  fs.writeFileSync(
    path.join(publicDir, 'mark.svg'),
    markSvg({ stroke: 'currentColor', strokeWidth: 2.5 }),
  );

  // Favicon: transparent background, steel stroke readable on light and dark tabs.
  const faviconSvg = markSvg({ stroke: STEEL_PRIMARY, strokeWidth: 4 });
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg);
  await sharp(Buffer.from(markSvg({ stroke: STEEL_PRIMARY, strokeWidth: 4, size: 64 })), {
    density: 288,
  })
    .resize(64, 64)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));

  // Web-app icons: dark tile, mark inside the maskable safe area.
  const tileSvg = markSvg({
    stroke: ICON_STROKE,
    strokeWidth: 3,
    background: { fill: ICON_BG, radius: 14 },
    markScale: 0.72,
  });
  const manifestSizes = [72, 96, 128, 144, 152, 192, 384, 512];
  for (const size of manifestSizes) {
    await sharp(Buffer.from(tileSvg), { density: Math.max(72, (size / 64) * 72) })
      .resize(size, size)
      .png()
      .toFile(path.join(iconsDir, `icon-${size}x${size}.png`));
  }

  // Service-worker notification icon + badge, plus the electron window icon (512).
  for (const size of [128, 256, 512]) {
    await sharp(Buffer.from(tileSvg), { density: (size / 64) * 72 })
      .resize(size, size)
      .png()
      .toFile(path.join(publicDir, `mark-${size}.png`));
  }

  console.log('strand paths (paste into CommandCenterMark.tsx if changed):');
  strandPaths.forEach((d) => console.log(d));
  console.log('\nWrote mark.svg, favicon.svg/png, icons/icon-*.png, mark-128/256.png');
}

main();
