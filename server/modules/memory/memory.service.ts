import os from 'node:os';
import path from 'node:path';
import fs, { promises as fsPromises } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import chokidar, { type FSWatcher } from 'chokidar';

import { memoryUpdatesDb, projectsDb, sessionsDb } from '@/modules/database/index.js';
import { chatRunRegistry, connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { LLMProvider, NormalizedMessage } from '@/shared/types.js';
import { getClaudeConfigDir, normalizeProjectPath } from '@/shared/utils.js';

const execFileAsync = promisify(execFile);

/**
 * Memory-write visibility (ui12 phase 7; per-session attribution ui13 job 8;
 * Bash and subagent attribution ui14 job 3).
 * Primary detection is per session: the sessions watcher hands each changed
 * Claude transcript here and the new tail is scanned for tool calls that
 * touch memory paths, so a write is attributed to the exact session that made
 * it — worker writes land in the worker transcript, planner writes in the
 * planner chat. Write/Edit/MultiEdit/NotebookEdit calls name their file and
 * report immediately on a non-error result. Bash calls (heredocs, appends —
 * the way workers actually write lessons and summaries) and Agent/Task calls
 * (a subagent writing on the session's behalf) cannot name the file reliably,
 * so they leave a claim on the files or a time window they mention and the
 * planner-repo watcher, which sees the real change, attributes it to the
 * claimant. Unclaimed writes (hand edits) wait a grace window, then fall back
 * to the running-run heuristic. Each burst persists as a `memory_updates` row
 * with a compact excerpt of the real file change and emits a `memory_update`
 * transcript frame — detection never relies on the model announcing itself.
 */

export const PLANNER_MEMORY_ROOT = process.env.PLANNER_MEMORY_ROOT
  || path.join(os.homedir(), 'Projects', 'spoton-worker', 'planner');
export const GLOBAL_MEMORY_DIR = path.join(PLANNER_MEMORY_ROOT, '_global');
/** The curated memory document: the one file the Memory surface shows and edits. */
export const CURATED_MEMORY_FILE = 'GLOBALMEMORY.md';
export const CURATED_MEMORY_PATH = path.join(GLOBAL_MEMORY_DIR, CURATED_MEMORY_FILE);
const CLAUDE_AI_EXPORT_FILE = 'claude-ai-memory-export.md';
/** The memory repo root (the planner folder's parent), where git runs. */
const MEMORY_REPO_ROOT = path.dirname(PLANNER_MEMORY_ROOT);

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
const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

/** Lines of excerpt kept per file on a memory-updated row. */
const DIFF_EXCERPT_MAX_LINES = 6;

type MemoryFileHit =
  | { scope: 'project'; memoryFolder: string; label: string; absPath: string }
  | { scope: 'global'; label: string; absPath: string }
  | { scope: 'auto'; autoSlug: string; label: string; absPath: string };

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
    return { scope: 'global', label: `_global/${rest}`, absPath: filePath };
  }
  const isMemoryTarget =
    rest === 'PROJECT.md'
    || rest === 'STATE.md'
    || (parts.length === 3 && (parts[1] === 'lessons' || parts[1] === 'sessions'));
  return isMemoryTarget ? { scope: 'project', memoryFolder: folder, label: rest, absPath: filePath } : null;
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
  /** label -> absolute path of each file in the burst. */
  files: Map<string, string>;
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

/**
 * Files recently claimed by a session's transcript tool calls: the latest
 * tool call that named the file owns its next changes. A file tool's claim
 * was already queued by the scanner; a Bash claim names the owner only, and
 * the watcher's hit, which proves the change, reports it to the claimant.
 */
const recentClaims = new Map<string, { sessionId: string; at: number }>();

/**
 * Sessions that recently ran something able to write memory without naming
 * the file (a Bash command touching the memory tree, a subagent). A watcher
 * hit with no file claim inside the window goes to the newest such session.
 */
const scopeClaims = new Map<string, { from: number; until: number }>();

function fileClaim(hit: MemoryFileHit): { sessionId: string } | null {
  const claim = recentClaims.get(keyForHit(hit));
  return claim && Date.now() - claim.at < CLAIM_TTL_MS ? claim : null;
}

/** Newest open scope window whose session works the hit's project (any session for global memory). */
function scopeClaimant(hit: MemoryFileHit): string | null {
  const now = Date.now();
  const projectPath = resolveProjectPathForHit(hit);
  const normalizedProjectPath = projectPath ? normalizeProjectPath(projectPath) : null;
  let best: { sessionId: string; from: number } | null = null;
  for (const [sessionId, window] of scopeClaims) {
    if (window.until < now) {
      scopeClaims.delete(sessionId);
      continue;
    }
    if (window.from > now) continue;
    if (normalizedProjectPath) {
      const row = sessionsDb.getSessionById(sessionId);
      if (row?.project_path && normalizeProjectPath(row.project_path) !== normalizedProjectPath) continue;
    }
    if (!best || window.from > best.from) best = { sessionId, from: window.from };
  }
  return best?.sessionId ?? null;
}

/** Last-known content per memory file, the "before" side of row excerpts. */
const fileSnapshots = new Map<string, string>();

async function readSnapshotSource(absPath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(absPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Compact excerpt of what changed between two versions of a memory file:
 * the lines present only in the new version (added or edited), then the
 * lines present only in the old one (removed or edited away), blank lines
 * skipped, capped with a trailing count. Memory files are one-fact-per-line
 * prose, so a line-set difference reads as the change itself.
 */
export function diffExcerpt(previous: string, current: string): string[] {
  const oldLines = previous.split('\n').map((line) => line.trimEnd());
  const newLines = current.split('\n').map((line) => line.trimEnd());
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const changed = [
    ...newLines.filter((line) => line.trim() && !oldSet.has(line)).map((line) => `+ ${line.trim()}`),
    ...oldLines.filter((line) => line.trim() && !newSet.has(line)).map((line) => `- ${line.trim()}`),
  ];
  if (changed.length <= DIFF_EXCERPT_MAX_LINES) return changed;
  const shown = changed.slice(0, DIFF_EXCERPT_MAX_LINES - 1);
  shown.push(`${changed.length - shown.length} more lines`);
  return shown;
}

async function excerptForFile(absPath: string): Promise<string[]> {
  // Every memory file is snapshotted at boot, so no "before" side means a
  // new file: its lines are the added lines.
  const previous = fileSnapshots.get(absPath) ?? '';
  const current = await readSnapshotSource(absPath);
  if (current === null) return [];
  fileSnapshots.set(absPath, current);
  return diffExcerpt(previous, current);
}

async function flushBurst(sessionId: string): Promise<void> {
  const burst = pendingBursts.get(sessionId);
  if (!burst) return;
  pendingBursts.delete(sessionId);
  if (burst.timer) clearTimeout(burst.timer);

  const files = [...burst.files.keys()].sort();
  const diffs: Record<string, string[]> = {};
  for (const label of files) {
    const excerpt = await excerptForFile(burst.files.get(label) as string);
    if (excerpt.length > 0) diffs[label] = excerpt;
  }

  const createdAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.now() - burst.startedAt);
  let rowId: number;
  try {
    rowId = memoryUpdatesDb.insert({ sessionId, files, diffs, durationMs, createdAt });
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
    memoryDiffs: diffs,
    durationMs,
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

function enqueueBurst(sessionId: string, hit: MemoryFileHit): void {
  let burst = pendingBursts.get(sessionId);
  if (!burst) {
    burst = { files: new Map(), startedAt: Date.now(), timer: null };
    pendingBursts.set(sessionId, burst);
  }
  burst.files.set(hit.label, hit.absPath);

  if (burst.timer) clearTimeout(burst.timer);
  const elapsed = Date.now() - burst.startedAt;
  const delay = Math.min(MEMORY_FLUSH_QUIET_MS, Math.max(0, MEMORY_FLUSH_MAX_WAIT_MS - elapsed));
  burst.timer = setTimeout(() => void flushBurst(sessionId), delay);
}

/**
 * Attributes a watcher-observed change. The surface's own edit of the
 * curated document is never a row (the surface shows the result). A file
 * that still matches its snapshot is the watcher echoing a write the scanner
 * already reported and flushed (drop). Otherwise a file claim names the
 * owner — including a further change inside the claim window, such as a
 * second append — and a scope window names the owner of an unnamed file.
 * Returns false when nothing claims the file.
 */
async function attributeClaimedHit(hit: MemoryFileHit): Promise<boolean> {
  if (hit.absPath === CURATED_MEMORY_PATH && curatedEditsInFlight > 0) return true;
  const claim = fileClaim(hit);
  if (claim?.sessionId === CURATED_EDIT_SENTINEL) return true;
  if ((await readSnapshotSource(hit.absPath)) === fileSnapshots.get(hit.absPath)) return true;
  const sessionId = claim?.sessionId ?? scopeClaimant(hit);
  if (!sessionId) return false;
  enqueueBurst(sessionId, hit);
  return true;
}

/**
 * Fallback-watcher entry (planner repo chokidar, forwarded auto-memory
 * events). A claimed hit attributes at once; an unclaimed one waits out the
 * grace window for a trailing claim before the running-run heuristic
 * attributes it.
 */
function queueMemoryHit(hit: MemoryFileHit): void {
  void (async () => {
    if (await attributeClaimedHit(hit)) return;
    await new Promise((resolve) => setTimeout(resolve, FALLBACK_GRACE_MS));
    if (await attributeClaimedHit(hit)) return;
    const sessionId = pickSessionForHit(hit);
    if (sessionId) enqueueBurst(sessionId, hit);
  })();
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
    absPath: filePath,
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

/** Planner-repo watcher entry (exported so tests can stand in for chokidar). */
export function handlePlannerRepoFileEvent(filePath: string): void {
  const hit = classifyPlannerRepoFile(path.normalize(filePath));
  if (hit) queueMemoryHit(hit);
}

const transcriptOffsets = new Map<string, number>();
const scanChains = new Map<string, Promise<void>>();

type PendingTool =
  | { kind: 'write'; sessionId: string; hit: MemoryFileHit; at: number }
  | { kind: 'bash'; sessionId: string; hits: MemoryFileHit[]; at: number }
  | { kind: 'agent'; sessionId: string; at: number };

/**
 * Memory-relevant tool calls whose result has not appeared in the transcript
 * yet. Only a non-error tool_result confirms a write — a denied or failed
 * Edit lands a tool_use line too, and firing on it would both show a false
 * indicator and suppress the fallback watcher's honest detection.
 */
const pendingTools = new Map<string, PendingTool>();
const PENDING_TOOL_TTL_MS = 10 * 60_000;

/** Cap on how much of a never-seen transcript the first scan reads. */
const MAX_FIRST_SCAN_BYTES = 262_144;

/** Memory file paths spelled out in a shell command. */
function memoryPathsInCommand(command: string, claudeProjectsRoot: string): MemoryFileHit[] {
  const hits: MemoryFileHit[] = [];
  for (const root of [PLANNER_MEMORY_ROOT, claudeProjectsRoot]) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}/[^\\s"'\`;|&<>)]+\\.md`, 'g');
    for (const match of command.match(pattern) ?? []) {
      const normalized = path.normalize(match);
      const hit = classifyPlannerRepoFile(normalized) ?? classifyAutoMemoryFile(claudeProjectsRoot, normalized);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/** Whether a shell command could write memory: it mentions a memory tree, or runs inside the memory repo. */
function commandTouchesMemory(command: string, cwd: string | null, claudeProjectsRoot: string): boolean {
  if (command.includes(PLANNER_MEMORY_ROOT) || command.includes(claudeProjectsRoot)) return true;
  return cwd !== null && !path.relative(MEMORY_REPO_ROOT, cwd).startsWith('..');
}

function openScope(sessionId: string, from: number, until: number): void {
  const existing = scopeClaims.get(sessionId);
  scopeClaims.set(sessionId, {
    from: existing ? Math.min(existing.from, from) : from,
    until: existing ? Math.max(existing.until, until) : until,
  });
}

/**
 * Per-session detection (ui13 job 8; Bash/subagent claims ui14 job 3): scans
 * the new tail of a changed Claude transcript for tool calls that touch
 * memory paths and attributes each confirmed write to this exact session —
 * the transcript is the honest record of who wrote. Called by the sessions
 * watcher after indexing, so `sessionId` is the canonical app session id.
 * Scans of one file serialize so overlapping events cannot regress the
 * offset and double-report a line.
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
        const cwd = typeof entry.cwd === 'string' ? entry.cwd : null;
        for (const item of content as Array<Record<string, unknown>>) {
          if (item?.type !== 'tool_use' || typeof item.id !== 'string') continue;
          const toolName = String(item.name);
          const input = item.input as Record<string, unknown> | undefined;
          const now = Date.now();

          if (MEMORY_WRITE_TOOLS.has(toolName)) {
            const rawPath = typeof input?.file_path === 'string'
              ? input.file_path
              : typeof input?.notebook_path === 'string'
                ? input.notebook_path
                : null;
            if (!rawPath) continue;
            const absolute = path.isAbsolute(rawPath) ? rawPath : cwd ? path.resolve(cwd, rawPath) : null;
            if (!absolute) continue;
            const normalized = path.normalize(absolute);
            const hit = classifyPlannerRepoFile(normalized) ?? classifyAutoMemoryFile(claudeProjectsRoot, normalized);
            if (hit) pendingTools.set(item.id, { kind: 'write', sessionId, hit, at: now });
          } else if (toolName === 'Bash') {
            const command = typeof input?.command === 'string' ? input.command : '';
            if (!commandTouchesMemory(command, cwd, claudeProjectsRoot)) continue;
            pendingTools.set(item.id, {
              kind: 'bash',
              sessionId,
              hits: memoryPathsInCommand(command, claudeProjectsRoot),
              at: now,
            });
          } else if (SUBAGENT_TOOLS.has(toolName)) {
            // The subagent may write any time until it returns; its own
            // transcript is not indexed, so the parent owns the window.
            pendingTools.set(item.id, { kind: 'agent', sessionId, at: now });
            openScope(sessionId, now, Number.POSITIVE_INFINITY);
          }
        }
      } else if (entry.type === 'user') {
        for (const item of content as Array<Record<string, unknown>>) {
          if (item?.type !== 'tool_result' || typeof item.tool_use_id !== 'string') continue;
          const pending = pendingTools.get(item.tool_use_id);
          if (!pending) continue;
          pendingTools.delete(item.tool_use_id);
          const now = Date.now();
          if (pending.kind === 'agent') {
            // Close the window with a tail long enough for the watcher's poll.
            const window = scopeClaims.get(pending.sessionId);
            if (window) window.until = now + CLAIM_TTL_MS;
            continue;
          }
          if (item.is_error === true) continue;
          if (pending.kind === 'write') {
            recentClaims.set(keyForHit(pending.hit), { sessionId: pending.sessionId, at: now });
            enqueueBurst(pending.sessionId, pending.hit);
            continue;
          }
          for (const hit of pending.hits) {
            recentClaims.set(keyForHit(hit), { sessionId: pending.sessionId, at: now });
          }
          openScope(pending.sessionId, pending.at, now + CLAIM_TTL_MS);
        }
      }
    }

    const now = Date.now();
    if (recentClaims.size > 200) {
      for (const [key, claim] of recentClaims) {
        if (now - claim.at >= CLAIM_TTL_MS) recentClaims.delete(key);
      }
    }
    for (const [id, pending] of pendingTools) {
      if (now - pending.at < PENDING_TOOL_TTL_MS) continue;
      pendingTools.delete(id);
      // A subagent whose result never came (the process died) must not hold
      // the session's window open forever.
      if (pending.kind === 'agent') {
        const window = scopeClaims.get(pending.sessionId);
        if (window && window.until === Number.POSITIVE_INFINITY) window.until = now + CLAIM_TTL_MS;
      }
    }
  } catch {
    // Unreadable tail; the next change event rescans from the same offset.
  } finally {
    await handle?.close();
  }
}

/** Snapshots every memory file's content so the first change after boot has a "before" side. */
export async function snapshotMemoryFiles(): Promise<void> {
  const claudeProjectsRoot = path.join(getClaudeConfigDir(), 'projects');
  const walk = async (dir: string, depth: number): Promise<string[]> => {
    if (depth < 0) return [];
    let entries: fs.Dirent[];
    try {
      entries = await fsPromises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(full, depth - 1));
      else if (entry.name.endsWith('.md')) found.push(full);
    }
    return found;
  };
  const candidates = [
    ...await walk(PLANNER_MEMORY_ROOT, 2),
    ...await walk(claudeProjectsRoot, 2),
  ];
  for (const file of candidates) {
    if (!classifyPlannerRepoFile(file) && !classifyAutoMemoryFile(claudeProjectsRoot, file)) continue;
    const content = await readSnapshotSource(file);
    if (content !== null) fileSnapshots.set(file, content);
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
  await snapshotMemoryFiles();

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

  plannerRepoWatcher
    .on('add', handlePlannerRepoFileEvent)
    .on('change', handlePlannerRepoFileEvent)
    .on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Memory] Planner memory watcher error', { error: message });
    });

  console.log('[Memory] Watching planner memory repo', { rootPath: PLANNER_MEMORY_ROOT });

  void importClaudeAiExportIfPresent();
}

/* ─── Curated memory: one-off prompt edits (ui14 job 3) ─────────────────── */

const CURATED_EDIT_MODEL = 'claude-sonnet-5';
const CURATED_EDIT_TIMEOUT_MS = 240_000;
/** Sentinel claimant for the surface's own edits: the watcher drops them, no transcript row. */
const CURATED_EDIT_SENTINEL = 'memory-surface';

let curatedEditChain: Promise<unknown> = Promise.resolve();
/** Edits the surface is running right now; their file changes are never rows. */
let curatedEditsInFlight = 0;

export type CuratedEditResult = {
  content: string;
  changed: boolean;
  /** The edit landed but a later step (push) did not; the caller shows it. */
  warning?: string;
};

function claimCuratedForSurface(): void {
  recentClaims.set(`global:_global/${CURATED_MEMORY_FILE}`, { sessionId: CURATED_EDIT_SENTINEL, at: Date.now() });
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', MEMORY_REPO_ROOT, ...args], { timeout: 60_000 });
  return stdout;
}

/**
 * Applies one edit instruction to the curated memory document through a
 * one-off headless Claude session (not a chat, not a planner session), then
 * commits and pushes the memory repo. Edits serialize; the returned content
 * is the document after the edit.
 */
export function editCuratedMemory(instruction: string, extraCommitPaths: string[] = []): Promise<CuratedEditResult> {
  const run = curatedEditChain.then(() => runCuratedEdit(instruction, extraCommitPaths), () => runCuratedEdit(instruction, extraCommitPaths));
  curatedEditChain = run.catch(() => undefined);
  return run;
}

async function runCuratedEdit(instruction: string, extraCommitPaths: string[]): Promise<CuratedEditResult> {
  const relativePath = path.relative(MEMORY_REPO_ROOT, CURATED_MEMORY_PATH);
  const before = (await readSnapshotSource(CURATED_MEMORY_PATH)) ?? '';
  const prompt = [
    `You are editing Willem's curated memory document at ${relativePath} (repository root: ${MEMORY_REPO_ROOT}). Read it first.`,
    'It is one self-maintained document; follow the rules its header states: add a new fact under the section it belongs to, update an existing entry in place when the instruction changes or refines it, rotate out entries the instruction makes stale, keep entries to one line each in the existing voice, and keep the structure. Technical and project state does not belong in this file. Do not use em dashes.',
    'Apply the instruction below and nothing else, then stop. Reply with one short line describing the change, no preamble.',
    '',
    instruction,
  ].join('\n');

  curatedEditsInFlight += 1;
  const claudeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
  const emptyMcpConfigPath = path.join(os.tmpdir(), 'command-center-empty-mcp.json');
  try {
    await fsPromises.writeFile(emptyMcpConfigPath, '{"mcpServers":{}}\n', { mode: 0o600 });
    // --no-session-persistence: a one-off edit must not leave a transcript
    // the session synchronizer would index as a phantom session.
    await execFileAsync(
      claudeExecutable,
      [
        '-p', prompt,
        '--model', CURATED_EDIT_MODEL,
        '--no-session-persistence',
        '--strict-mcp-config',
        '--mcp-config', emptyMcpConfigPath,
        '--allowedTools', 'Read', 'Edit', 'Write',
      ],
      { cwd: MEMORY_REPO_ROOT, timeout: CURATED_EDIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Memory] Curated edit failed', { error: message });
    throw new Error('The edit session failed.');
  } finally {
    // The watcher's echo of the edit can trail the session by a poll cycle.
    claimCuratedForSurface();
    curatedEditsInFlight -= 1;
  }

  const content = (await readSnapshotSource(CURATED_MEMORY_PATH)) ?? '';
  fileSnapshots.set(CURATED_MEMORY_PATH, content);
  const changed = content !== before || extraCommitPaths.length > 0;
  if (!changed) return { content, changed: false };

  const summary = instruction.replace(/\s+/g, ' ').trim().slice(0, 60);
  try {
    await git(['add', '--', CURATED_MEMORY_PATH, ...extraCommitPaths]);
    await git(['commit', '-m', `memory: ${summary}`]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Memory] Curated edit commit failed', { error: message });
    return { content, changed: true, warning: 'Edited, but the commit failed.' };
  }
  try {
    await git(['push']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Memory] Curated edit push failed', { error: message });
    return { content, changed: true, warning: 'Committed, but the push failed.' };
  }
  return { content, changed: true };
}

/**
 * One-time import of Willem's Claude.ai memory export (ui14 job 3): if the
 * planner filed `planner/_global/claude-ai-memory-export.md`, fold what
 * applies to how Willem works and his coding projects into the curated
 * document and rename the export `.imported`. Renaming first keeps a second
 * instance (live and dev share the repo) from importing it twice.
 */
export async function importClaudeAiExportIfPresent(
  globalDir: string = GLOBAL_MEMORY_DIR,
  runEdit: (instruction: string, extraCommitPaths: string[]) => Promise<CuratedEditResult> = editCuratedMemory,
): Promise<boolean> {
  const exportPath = path.join(globalDir, CLAUDE_AI_EXPORT_FILE);
  const importedPath = `${exportPath.replace(/\.md$/, '')}.imported`;
  if (!fs.existsSync(exportPath)) return false;
  await fsPromises.rename(exportPath, importedPath);
  try {
    await runEdit(
      [
        `Import Willem's Claude.ai memory export at ${importedPath}: read it, keep only what applies to how Willem works and his coding projects (drop unrelated personal facts),`,
        'and merge those entries into the curated document under the sections they belong to, deduplicating against what is already there.',
      ].join(' '),
      [exportPath, importedPath],
    );
    console.log('[Memory] Claude.ai memory export imported', { importedPath });
    return true;
  } catch (error) {
    await fsPromises.rename(importedPath, exportPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Memory] Claude.ai memory export import failed', { error: message });
    return false;
  }
}
