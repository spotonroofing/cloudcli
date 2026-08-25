import os from 'node:os';
import path from 'node:path';
import fs, { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { memoryUpdatesDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

/**
 * Memory-write visibility (ui12 phase 7). Watches the planner memory repo
 * (spoton-worker/planner/<project>/) server-side and receives native
 * auto-memory events forwarded from the sessions watcher, attributes each
 * write burst to a session, persists it as a `memory_updates` row, and emits a
 * `memory_update` transcript frame — detection never relies on the model
 * announcing its own writes.
 */

export const PLANNER_MEMORY_ROOT = path.join(os.homedir(), 'Projects', 'spoton-worker', 'planner');
export const GLOBAL_MEMORY_DIR = path.join(PLANNER_MEMORY_ROOT, '_global');

/** Writes closer together than this land in one indicator row. */
const MEMORY_FLUSH_QUIET_MS = 2_500;
const MEMORY_FLUSH_MAX_WAIT_MS = 10_000;

type MemoryFileHit =
  | { scope: 'project'; memoryFolder: string; label: string }
  | { scope: 'global'; label: string }
  | { scope: 'auto'; autoSlug: string; label: string };

/**
 * Maps a planner-repo file path to its memory identity. Only the four memory
 * targets count (PROJECT.md, STATE.md, lessons/, sessions/) plus `_global/`;
 * everything else in the repo (reference/, handoffs/, PLANNER.md) is not
 * session memory and stays silent.
 */
function classifyPlannerRepoFile(filePath: string): MemoryFileHit | null {
  const relative = path.relative(PLANNER_MEMORY_ROOT, filePath);
  if (relative.startsWith('..')) {
    return null;
  }
  const parts = relative.split(path.sep);
  if (parts.length < 2 || !parts[parts.length - 1].endsWith('.md')) {
    return null;
  }
  const folder = parts[0];
  const rest = parts.slice(1).join('/');
  if (folder === '_global') {
    return { scope: 'global', label: `_global/${rest}` };
  }
  const isMemoryTarget =
    rest === 'PROJECT.md'
    || rest === 'STATE.md'
    || (parts.length === 3 && (parts[1] === 'lessons' || parts[1] === 'sessions'));
  return isMemoryTarget ? { scope: 'project', memoryFolder: folder, label: rest } : null;
}

/** The Claude auto-memory dir name for a repo path: `/` and `.` become `-`. */
function encodeProjectPathSlug(projectPath: string): string {
  return projectPath.replace(/[/.]/g, '-');
}

/**
 * Resolves the project repo path a memory write belongs to: planner-repo
 * writes match the project's planner memory folder name (explicit
 * `planner_memory_name` or the repo folder name), auto-memory writes match
 * the encoded-path slug of the memory directory.
 */
function resolveProjectPathForHit(hit: MemoryFileHit): string | null {
  if (hit.scope === 'global') {
    return null;
  }
  for (const project of projectsDb.getProjectPaths()) {
    if (hit.scope === 'project') {
      const memoryName = project.planner_memory_name?.trim() || path.basename(project.project_path);
      if (memoryName === hit.memoryFolder) {
        return project.project_path;
      }
    } else if (encodeProjectPathSlug(normalizeProjectPath(project.project_path)) === hit.autoSlug) {
      return project.project_path;
    }
  }
  return null;
}

/**
 * Picks the session a write burst renders under: the currently-running run on
 * the project (planner lane preferred — the planner is the writer of record),
 * falling back to the project's latest planner session. Global writes without
 * a project attribute to the most recent running planner-lane run anywhere.
 */
function pickSessionForHit(hit: MemoryFileHit): string | null {
  const projectPath = resolveProjectPathForHit(hit);
  const normalizedProjectPath = projectPath ? normalizeProjectPath(projectPath) : null;

  let best: { sessionId: string; startedAt: number; plannerLane: boolean } | null = null;
  for (const run of chatRunRegistry.listRunningRuns()) {
    const row = sessionsDb.getSessionById(run.sessionId);
    if (!row) continue;
    const plannerLane = row.origin === 'planner' || row.origin === null;
    if (normalizedProjectPath) {
      if (!row.project_path || normalizeProjectPath(row.project_path) !== normalizedProjectPath) continue;
    } else if (!plannerLane) {
      continue;
    }
    if (
      !best
      || (plannerLane && !best.plannerLane)
      || (plannerLane === best.plannerLane && run.startedAt > best.startedAt)
    ) {
      best = { sessionId: run.sessionId, startedAt: run.startedAt, plannerLane };
    }
  }
  if (best) {
    return best.sessionId;
  }

  if (normalizedProjectPath) {
    return sessionsDb.getLatestPlannerSession(normalizedProjectPath)?.session_id ?? null;
  }
  return null;
}

type PendingMemoryBurst = {
  files: Set<string>;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingBursts = new Map<string, PendingMemoryBurst>();
let plannerRepoWatcher: FSWatcher | null = null;

function flushBurst(sessionId: string): void {
  const burst = pendingBursts.get(sessionId);
  if (!burst) return;
  pendingBursts.delete(sessionId);
  if (burst.timer) clearTimeout(burst.timer);

  const files = [...burst.files].sort();
  const createdAt = new Date().toISOString();
  let rowId: number;
  try {
    rowId = memoryUpdatesDb.insert({ sessionId, files, createdAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Memory] Failed to persist memory update', { sessionId, files, error: message });
    return;
  }

  const sessionRow = sessionsDb.getSessionById(sessionId);
  const frame: NormalizedMessage = {
    id: `memory_${rowId}`,
    sessionId,
    timestamp: createdAt,
    provider: (sessionRow?.provider as LLMProvider | undefined) ?? 'claude',
    kind: 'memory_update',
    memoryFiles: files,
  };

  // A live run's writer assigns `seq` and buffers the frame for reconnect
  // replay; outside a run a plain broadcast still updates open transcripts.
  const run = chatRunRegistry.getRun(sessionId);
  if (run && run.status === 'running') {
    run.writer.send(frame);
    return;
  }
  const payload = JSON.stringify(frame);
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(payload);
    }
  });
}

function queueMemoryHit(hit: MemoryFileHit): void {
  const sessionId = pickSessionForHit(hit);
  if (!sessionId) {
    return;
  }

  let burst = pendingBursts.get(sessionId);
  if (!burst) {
    burst = { files: new Set(), startedAt: Date.now(), timer: null };
    pendingBursts.set(sessionId, burst);
  }
  burst.files.add(hit.label);

  if (burst.timer) clearTimeout(burst.timer);
  const elapsed = Date.now() - burst.startedAt;
  const delay = Math.min(MEMORY_FLUSH_QUIET_MS, Math.max(0, MEMORY_FLUSH_MAX_WAIT_MS - elapsed));
  burst.timer = setTimeout(() => flushBurst(sessionId), delay);
}

/**
 * Entry point for the sessions watcher: it already polls the provider config
 * tree, so auto-memory writes (`projects/<slug>/memory/*.md`) forward here
 * instead of running a second watcher over the same directory.
 */
export function handleAutoMemoryFileEvent(claudeProjectsRoot: string, filePath: string): void {
  const relative = path.relative(claudeProjectsRoot, filePath);
  if (relative.startsWith('..')) return;
  const parts = relative.split(path.sep);
  if (parts.length < 3 || parts[1] !== 'memory' || !parts[parts.length - 1].endsWith('.md')) {
    return;
  }
  queueMemoryHit({
    scope: 'auto',
    autoSlug: parts[0],
    label: `memory/${parts.slice(2).join('/')}`,
  });
}

/** Starts the chokidar watch over the planner memory repo. */
export async function initializeMemoryWatcher(): Promise<void> {
  if (!fs.existsSync(PLANNER_MEMORY_ROOT)) {
    console.log('[Memory] Planner memory repo not present; memory watcher disabled', {
      rootPath: PLANNER_MEMORY_ROOT,
    });
    return;
  }

  await fsPromises.mkdir(GLOBAL_MEMORY_DIR, { recursive: true });

  plannerRepoWatcher = chokidar.watch(PLANNER_MEMORY_ROOT, {
    ignored: ['**/.git/**', '**/node_modules/**', '**/.DS_Store', '**/*.tmp', '**/*.swp'],
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    depth: 3,
    usePolling: true,
    interval: 6_000,
    binaryInterval: 6_000,
  });

  const onEvent = (filePath: string) => {
    const hit = classifyPlannerRepoFile(filePath);
    if (hit) queueMemoryHit(hit);
  };

  plannerRepoWatcher
    .on('add', onEvent)
    .on('change', onEvent)
    .on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Memory] Planner memory watcher error', { error: message });
    });

  console.log('[Memory] Watching planner memory repo', { rootPath: PLANNER_MEMORY_ROOT });
}
