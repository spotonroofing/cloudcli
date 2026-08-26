import os from 'node:os';
import path from 'node:path';
import fs, { promises as fsPromises } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import { memoryUpdatesDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { normalizeProjectPath } from '@/shared/utils.js';

/**
 * Memory-write visibility (ui12 phase 7; per-session attribution ui13 job 8).
 * Primary detection is per session: the sessions watcher hands each changed
 * Claude transcript here and the new tail is scanned for file-tool calls
 * (Write/Edit/MultiEdit/NotebookEdit) targeting memory paths, so a write is
 * attributed to the exact session that made it — worker writes land in the
 * worker transcript, planner writes in the planner chat. The planner-repo
 * chokidar watch and forwarded auto-memory events remain as a fallback for
 * writes no transcript claims (hand edits, Bash appends, subagent writes);
 * they defer briefly so a transcript claim wins, then fall back to the
 * running-run heuristic. Each burst persists as a `memory_updates` row and
 * emits a `memory_update` transcript frame — detection never relies on the
 * model announcing its own writes.
 */

export const PLANNER_MEMORY_ROOT = path.join(os.homedir(), 'Projects', 'spoton-worker', 'planner');
export const GLOBAL_MEMORY_DIR = path.join(PLANNER_MEMORY_ROOT, '_global');

/** Writes closer together than this land in one indicator row. */
const MEMORY_FLUSH_QUIET_MS = 2_500;
const MEMORY_FLUSH_MAX_WAIT_MS = 10_000;

/** How long a transcript claim outranks the fallback watchers for one file. */
const CLAIM_TTL_MS = 30_000;
/**
 * How long an unclaimed watcher hit waits for a transcript claim before the
 * running-run heuristic attributes it. Both watchers poll at 6s, so the claim
 * for the same write can trail the repo event by up to two poll cycles.
 */
const FALLBACK_GRACE_MS = 15_000;
/**
 * First scan of a transcript with no recorded offset (server restart mid-
 * session) reads from byte 0; only entries this recent count, so historical
 * writes are not replayed as fresh indicator rows.
 */
const FIRST_SCAN_WINDOW_MS = 20_000;

const MEMORY_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

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

/** Scope-qualified identity of one memory file, for claim matching. */
function keyForHit(hit: MemoryFileHit): string {
  if (hit.scope === 'project') return `project:${hit.memoryFolder}/${hit.label}`;
  if (hit.scope === 'auto') return `auto:${hit.autoSlug}/${hit.label}`;
  return `global:${hit.label}`;
}

/** Files recently claimed by a session's transcript tool calls. */
const recentClaims = new Map<string, { sessionId: string; at: number }>();

function claimedSession(hit: MemoryFileHit): string | null {
  const claim = recentClaims.get(keyForHit(hit));
  return claim && Date.now() - claim.at < CLAIM_TTL_MS ? claim.sessionId : null;
}

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

function enqueueBurst(sessionId: string, label: string): void {
  let burst = pendingBursts.get(sessionId);
  if (!burst) {
    burst = { files: new Set(), startedAt: Date.now(), timer: null };
    pendingBursts.set(sessionId, burst);
  }
  burst.files.add(label);

  if (burst.timer) clearTimeout(burst.timer);
  const elapsed = Date.now() - burst.startedAt;
  const delay = Math.min(MEMORY_FLUSH_QUIET_MS, Math.max(0, MEMORY_FLUSH_MAX_WAIT_MS - elapsed));
  burst.timer = setTimeout(() => flushBurst(sessionId), delay);
}

/**
 * Fallback-watcher entry (planner repo chokidar, forwarded auto-memory
 * events). A claimed hit was already queued by the transcript scanner, so it
 * drops here; an unclaimed hit waits out the grace window for a trailing
 * claim before the running-run heuristic attributes it.
 */
function queueMemoryHit(hit: MemoryFileHit): void {
  if (claimedSession(hit)) return;
  setTimeout(() => {
    if (claimedSession(hit)) return;
    const sessionId = pickSessionForHit(hit);
    if (sessionId) enqueueBurst(sessionId, hit.label);
  }, FALLBACK_GRACE_MS);
}

/** Maps a path under the Claude projects tree to its auto-memory identity. */
function classifyAutoMemoryFile(claudeProjectsRoot: string, filePath: string): MemoryFileHit | null {
  const relative = path.relative(claudeProjectsRoot, filePath);
  if (relative.startsWith('..')) return null;
  const parts = relative.split(path.sep);
  if (parts.length < 3 || parts[1] !== 'memory' || !parts[parts.length - 1].endsWith('.md')) {
    return null;
  }
  return {
    scope: 'auto',
    autoSlug: parts[0],
    label: `memory/${parts.slice(2).join('/')}`,
  };
}

/**
 * Entry point for the sessions watcher: it already polls the provider config
 * tree, so auto-memory writes (`projects/<slug>/memory/*.md`) forward here
 * instead of running a second watcher over the same directory.
 */
export function handleAutoMemoryFileEvent(claudeProjectsRoot: string, filePath: string): void {
  const hit = classifyAutoMemoryFile(claudeProjectsRoot, filePath);
  if (hit) queueMemoryHit(hit);
}

const transcriptOffsets = new Map<string, number>();
const scanChains = new Map<string, Promise<void>>();

/**
 * Memory-target tool calls whose result has not appeared in the transcript
 * yet. Only a non-error tool_result confirms the write — a denied or failed
 * Edit lands a tool_use line too, and firing on it would both show a false
 * indicator and suppress the fallback watcher's honest detection.
 */
const pendingToolWrites = new Map<string, { sessionId: string; hit: MemoryFileHit; at: number }>();
const PENDING_TOOL_TTL_MS = 10 * 60_000;

/** Cap on how much of a never-seen transcript the first scan reads. */
const MAX_FIRST_SCAN_BYTES = 262_144;

/**
 * Per-session detection (ui13 job 8): scans the new tail of a changed Claude
 * transcript for file-tool calls (Write/Edit/MultiEdit/NotebookEdit) whose
 * target is a memory path, and attributes each confirmed write to this exact
 * session — the transcript is the honest record of who wrote. Called by the
 * sessions watcher after indexing, so `sessionId` is the canonical app
 * session id. Scans of one file serialize so overlapping events cannot
 * regress the offset and double-report a line.
 */
export function handleSessionTranscriptEvent(
  claudeProjectsRoot: string,
  filePath: string,
  sessionId: string,
): Promise<void> {
  const chained = (scanChains.get(filePath) ?? Promise.resolve())
    .then(() => scanTranscriptTail(claudeProjectsRoot, filePath, sessionId));
  scanChains.set(filePath, chained);
  return chained;
}

async function scanTranscriptTail(
  claudeProjectsRoot: string,
  filePath: string,
  sessionId: string,
): Promise<void> {
  let handle: Awaited<ReturnType<typeof fsPromises.open>> | null = null;
  try {
    handle = await fsPromises.open(filePath, 'r');
    const size = (await handle.stat()).size;
    const recorded = transcriptOffsets.get(filePath);
    // A shrunken file was rewritten (compaction); rescan under the window.
    const fresh = recorded === undefined || recorded > size;
    let offset = fresh ? 0 : recorded;
    if (size <= offset) {
      transcriptOffsets.set(filePath, size);
      return;
    }
    // A never-seen transcript can be tens of MB; the recency window skips
    // everything old anyway, so read only a bounded tail and drop the
    // partial line the cap cut into.
    let skipPartialFirstLine = false;
    if (fresh && size - offset > MAX_FIRST_SCAN_BYTES) {
      offset = size - MAX_FIRST_SCAN_BYTES;
      skipPartialFirstLine = true;
    }

    const buffer = Buffer.alloc(size - offset);
    await handle.read(buffer, 0, buffer.length, offset);
    const text = buffer.toString('utf8');
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline === -1) return; // incomplete tail line; next event rescans
    transcriptOffsets.set(filePath, offset + Buffer.byteLength(text.slice(0, lastNewline + 1), 'utf8'));

    const cutoff = fresh ? Date.now() - FIRST_SCAN_WINDOW_MS : null;
    const lines = text.slice(0, lastNewline).split('\n');
    if (skipPartialFirstLine) lines.shift();
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const content = (entry.message as Record<string, unknown> | undefined)?.content;
      if (!Array.isArray(content)) continue;

      if (entry.type === 'assistant') {
        if (cutoff !== null) {
          const ts = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
          if (!Number.isFinite(ts) || ts < cutoff) continue;
        }
        for (const item of content as Array<Record<string, unknown>>) {
          if (item?.type !== 'tool_use' || !MEMORY_WRITE_TOOLS.has(String(item.name))) continue;
          const toolUseId = typeof item.id === 'string' ? item.id : null;
          const input = item.input as Record<string, unknown> | undefined;
          const rawPath = typeof input?.file_path === 'string'
            ? input.file_path
            : typeof input?.notebook_path === 'string'
              ? input.notebook_path
              : null;
          if (!toolUseId || !rawPath) continue;
          const absolute = path.isAbsolute(rawPath)
            ? rawPath
            : typeof entry.cwd === 'string'
              ? path.resolve(entry.cwd, rawPath)
              : null;
          if (!absolute) continue;
          const normalized = path.normalize(absolute);
          const hit = classifyPlannerRepoFile(normalized) ?? classifyAutoMemoryFile(claudeProjectsRoot, normalized);
          if (!hit) continue;
          pendingToolWrites.set(toolUseId, { sessionId, hit, at: Date.now() });
        }
      } else if (entry.type === 'user') {
        for (const item of content as Array<Record<string, unknown>>) {
          if (item?.type !== 'tool_result' || typeof item.tool_use_id !== 'string') continue;
          const pending = pendingToolWrites.get(item.tool_use_id);
          if (!pending) continue;
          pendingToolWrites.delete(item.tool_use_id);
          if (item.is_error === true) continue;
          recentClaims.set(keyForHit(pending.hit), { sessionId: pending.sessionId, at: Date.now() });
          enqueueBurst(pending.sessionId, pending.hit.label);
        }
      }
    }

    const now = Date.now();
    if (recentClaims.size > 200) {
      for (const [key, claim] of recentClaims) {
        if (now - claim.at >= CLAIM_TTL_MS) recentClaims.delete(key);
      }
    }
    for (const [id, pending] of pendingToolWrites) {
      if (now - pending.at >= PENDING_TOOL_TTL_MS) pendingToolWrites.delete(id);
    }
  } catch {
    // Unreadable tail; the next change event rescans from the same offset.
  } finally {
    await handle?.close();
  }
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
