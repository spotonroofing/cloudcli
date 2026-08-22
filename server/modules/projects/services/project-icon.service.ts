import fs from 'node:fs';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/** Icon filenames probed at a project's repo root, in preference order. */
const PROJECT_ROOT_ICON_CANDIDATES = ['app-icon.svg', 'icon.svg', 'icon.png'] as const;

/** Icons larger than this are skipped; project-list payloads stay small. */
const MAX_ICON_FILE_SIZE_BYTES = 512 * 1024;

/**
 * Known SpotOn projects mapped to their bundled icon slug under
 * `public/project-icons/`, keyed by the project directory basename.
 */
const SPOTON_PROJECT_ICON_SLUGS: Record<string, string> = {
  SignTool: 'sign',
  'snapbridge-photos': 'cam',
  'spoton-book': 'book',
  'spoton-payroll': 'payroll',
  'spoton-stats': 'stats',
  'spoton-core': 'design',
};

const BUNDLED_ICONS_DIRECTORY = path.join(
  findApplicationRoot(getModuleDirectory(import.meta.url)),
  'public',
  'project-icons',
);

/**
 * Data-URL cache keyed by absolute icon path; entries are invalidated by
 * mtime so repeated project-list fetches don't re-read unchanged files.
 */
const iconDataUrlCache = new Map<string, { mtimeMs: number; dataUrl: string }>();

/**
 * Reads an icon file and returns it as a data URL, or null when the path is
 * not a regular file, is too large, or cannot be read.
 */
function readIconFileAsDataUrl(iconPath: string): string | null {
  try {
    const stats = fs.statSync(iconPath);
    if (!stats.isFile() || stats.size > MAX_ICON_FILE_SIZE_BYTES) {
      return null;
    }

    const cached = iconDataUrlCache.get(iconPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.dataUrl;
    }

    const mimeType = iconPath.endsWith('.png') ? 'image/png' : 'image/svg+xml';
    const dataUrl = `data:${mimeType};base64,${fs.readFileSync(iconPath).toString('base64')}`;
    iconDataUrlCache.set(iconPath, { mtimeMs: stats.mtimeMs, dataUrl });
    return dataUrl;
  } catch {
    return null;
  }
}

/**
 * Resolves a project's sidebar icon as a data URL. A repo-root icon file
 * wins; known SpotOn projects fall back to bundled icons; everything else
 * returns null and the client renders its default. Never throws.
 */
export function getProjectIconDataUrl(projectPath: string): string | null {
  for (const candidate of PROJECT_ROOT_ICON_CANDIDATES) {
    const dataUrl = readIconFileAsDataUrl(path.join(projectPath, candidate));
    if (dataUrl) {
      return dataUrl;
    }
  }

  const bundledSlug = SPOTON_PROJECT_ICON_SLUGS[path.basename(projectPath)];
  if (bundledSlug) {
    return readIconFileAsDataUrl(path.join(BUNDLED_ICONS_DIRECTORY, `${bundledSlug}.svg`));
  }

  return null;
}
