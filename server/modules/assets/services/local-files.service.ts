import fsSync, { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import mime from 'mime-types';

/**
 * Read-only lookup for a file a session presents in chat by path (a markdown
 * link in an assistant message). Only two roots are reachable: the pane's own
 * project workspace and the planner memory repo. Everything else — a path that
 * escapes a root, a symlink pointing out of one, a directory — is refused, so
 * this route can never widen into a general filesystem reader.
 */

/** The planner memory repo sessions present summaries and lessons from. */
export const PLANNER_REPO_ROOT = path.join(os.homedir(), 'Projects', 'spoton-worker');

export type LocalFileKind = 'image' | 'text' | 'file';

export type LocalFileLookup =
  | { status: 'invalid' }
  | { status: 'missing' }
  | {
      status: 'ok';
      absolutePath: string;
      name: string;
      size: number;
      mimeType: string;
      kind: LocalFileKind;
    };

const TEXT_FILE_PATTERN =
  /\.(md|markdown|txt|log|json|jsonl|ya?ml|toml|csv|tsx?|jsx?|mjs|cjs|css|scss|html?|sh|zsh|bash|py|rb|go|rs|java|c|h|cpp|sql|env|gitignore)$/i;

const expandHome = (value: string): string =>
  value === '~' || value.startsWith('~/') ? path.join(os.homedir(), value.slice(1)) : value;

const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** Real path of an existing directory, or null when it does not resolve. */
async function realDirectory(candidate: string | null | undefined): Promise<string | null> {
  if (!candidate) {
    return null;
  }
  try {
    const resolved = await fs.realpath(candidate);
    const stats = await fs.stat(resolved);
    return stats.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function classifyFile(mimeType: string, name: string): LocalFileKind {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('text/') || TEXT_FILE_PATTERN.test(name)) {
    return 'text';
  }
  return 'file';
}

/**
 * Resolves one requested path against the allowed roots. Relative paths are
 * tried against each root in turn (project workspace first), absolute paths
 * must land inside one. The containment check runs on real paths, so a symlink
 * inside a root that points outside it is refused like any other escape.
 */
export async function resolveLocalFile(
  requestedPath: string,
  projectRoot: string | null,
): Promise<LocalFileLookup> {
  const requested = expandHome((requestedPath || '').trim());
  if (!requested || requested.includes('\0')) {
    return { status: 'invalid' };
  }

  const roots = (
    await Promise.all([realDirectory(projectRoot), realDirectory(PLANNER_REPO_ROOT)])
  ).filter((root): root is string => Boolean(root));
  if (roots.length === 0) {
    return { status: 'missing' };
  }

  const candidates = path.isAbsolute(requested)
    ? [requested]
    : roots.map((root) => path.resolve(root, requested));

  for (const candidate of candidates) {
    let resolved: string;
    try {
      resolved = await fs.realpath(candidate);
    } catch {
      continue;
    }
    if (!roots.some((root) => isInside(root, resolved))) {
      continue;
    }

    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch {
      continue;
    }
    if (!stats.isFile()) {
      continue;
    }

    const name = path.basename(resolved);
    const mimeType = mime.lookup(resolved) || 'application/octet-stream';
    return {
      status: 'ok',
      absolutePath: resolved,
      name,
      size: stats.size,
      mimeType,
      kind: classifyFile(mimeType, name),
    };
  }

  return { status: 'missing' };
}

/** Opens a resolved local file for streaming. */
export function openLocalFile(absolutePath: string): fsSync.ReadStream {
  return fsSync.createReadStream(absolutePath);
}
