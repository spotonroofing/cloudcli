/**
 * Command Center mark + icon generator.
 *
 * The mark is the command bracket: a caret held between two square brackets,
 * the console frame around the prompt. Three round-capped line paths, one
 * stroke family. Everything brand-shaped in public/ is derived from here:
 *
 *   node public/generate-icons.js
 *
 * writes mark.svg (canonical, stroke="currentColor"), favicon.svg/png,
 * icons/icon-*.png (manifest sizes), and mark-128/256/512.png (sw
 * notifications + electron window icon). The inline React copy of the same
 * paths lives in src/shared/view/CommandCenterMark.tsx — keep the two in sync
 * if the geometry changes. The other two candidates from the ui11 redesign
 * live in candidate-marks/ at the repo root.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MARK_PATHS = [
  'M25 13 L15 13 L15 51 L25 51',
  'M39 13 L49 13 L49 51 L39 51',
  'M26.5 22.5 L38 32 L26.5 41.5',
];

function markSvg({ stroke, strokeWidth, background = null, size = 64, markScale = 1 }) {
  const bg = background
    ? `<rect width="64" height="64" rx="${(background.radius ?? 0).toFixed(2)}" fill="${background.fill}"/>`
    : '';
  const inset = (1 - markScale) / 2;
  const group =
    markScale === 1
      ? MARK_PATHS.map((d) => `<path d="${d}"/>`).join('')
      : `<g transform="translate(${(64 * inset).toFixed(2)} ${(64 * inset).toFixed(2)}) scale(${markScale})">${MARK_PATHS.map(
          (d) => `<path d="${d}"/>`,
        ).join('')}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" fill="none">${bg}<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${group}</g></svg>`;
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
    markSvg({ stroke: 'currentColor', strokeWidth: 4 }),
  );

  // Favicon: transparent background, steel stroke readable on light and dark tabs.
  const faviconSvg = markSvg({ stroke: STEEL_PRIMARY, strokeWidth: 5.5 });
  fs.writeFileSync(path.join(publicDir, 'favicon.svg'), faviconSvg);
  await sharp(Buffer.from(markSvg({ stroke: STEEL_PRIMARY, strokeWidth: 5.5, size: 64 })), {
    density: 288,
  })
    .resize(64, 64)
    .png()
    .toFile(path.join(publicDir, 'favicon.png'));

  // Web-app icons: dark tile, mark inside the maskable safe area.
  const tileSvg = markSvg({
    stroke: ICON_STROKE,
    strokeWidth: 4,
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

  console.log('Wrote mark.svg, favicon.svg/png, icons/icon-*.png, mark-128/256/512.png');
}

main();
