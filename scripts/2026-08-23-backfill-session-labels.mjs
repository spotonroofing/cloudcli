#!/usr/bin/env node
// Backfills Haiku short labels for existing sessions (ui8 phase 1).
//
// The label pipeline only fires at session creation, so every session that
// predates it still shows its truncated first prompt as a title. This walks
// both instance DBs and, for each unarchived session whose title still
// derives from its first user message (manual renames and already-applied
// labels diverge and are left alone), asks Haiku for a 3-6 word label and
// writes it to custom_name. Worker-lane rows (direct/dispatch/external) are
// always relabeled from the transcript - nobody hand-names those.
//
// Usage: node scripts/2026-08-23-backfill-session-labels.mjs [--dry-run]
import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const execFileAsync = promisify(execFile);

const DRY_RUN = process.argv.includes('--dry-run');
const HOME = os.homedir();
const DBS = [path.join(HOME, '.cloudcli', 'auth.db'), path.join(HOME, '.cloudcli-dev', 'auth.db')];
const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 5;

function firstRealUserMessage(jsonlPath) {
  let raw;
  try {
    raw = readFileSync(jsonlPath, 'utf8');
  } catch {
    return null;
  }
  // A session whose only user text is the boot prologue still deserves a
  // short label; fall back to the boot message when nothing else exists.
  let bootFallback = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (data?.type !== 'user' || !data.message || data.isMeta) continue;
    const content = data.message.content;
    let text = null;
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      const part = content.find((p) => p?.type === 'text' && typeof p.text === 'string');
      text = part ? part.text : null;
    }
    if (!text) continue;
    const trimmed = text.trim();
    // Skip slash-command boots, command envelopes, and auto-sent planner boot
    // prologues; label from the first message a human (or dispatcher) wrote.
    if (
      trimmed.startsWith('/')
      || trimmed.startsWith('<command-name>')
      || trimmed.startsWith('<local-command')
      || trimmed.startsWith('Boot (or re-ground)')
    ) {
      if (trimmed.startsWith('Boot (or re-ground)') && !bootFallback) bootFallback = trimmed;
      continue;
    }
    return trimmed;
  }
  return bootFallback;
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function titleDerivesFromMessage(title, message) {
  if (!title) return true;
  const t = normalize(title);
  // Boot-prompt fragments are placeholders too: the label message is the
  // first non-boot message, so a title cut from the boot prologue never
  // prefix-matches it and would otherwise be mistaken for a manual rename.
  if (
    !t
    || t === 'untitled claude session'
    || t === 'new session'
    || t.startsWith('/')
    || t.startsWith('[pasted text')
    || t.startsWith('boot (or re-ground)')
  ) return true;
  const m = normalize(message);
  return m.startsWith(t) || t.startsWith(m.slice(0, 60));
}

function sanitizeLabel(raw) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  const label = last.replace(/^["'`*]+/, '').replace(/["'`*]+$/, '').replace(/\.+$/, '').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 60 || label.split(' ').length > 8) return null;
  return label;
}

async function generateLabel(message) {
  const excerpt = message.replace(/^<!--[^>]*-->\s*/, '').slice(0, 500);
  const prompt = [
    'Produce a 3-6 word label for this chat session based on the message below.',
    'Reply with the label only - no quotes, no trailing punctuation, no preamble.',
    '',
    excerpt,
  ].join('\n');
  const { stdout } = await execFileAsync('claude', ['-p', prompt, '--model', MODEL, '--no-session-persistence'], {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  return sanitizeLabel(stdout);
}

async function runPool(items, worker) {
  const queue = [...items];
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

for (const dbPath of DBS) {
  if (!existsSync(dbPath)) continue;
  const db = new Database(dbPath);
  const rows = db
    .prepare(`SELECT session_id, custom_name, origin, jsonl_path FROM sessions WHERE isArchived = 0 AND jsonl_path IS NOT NULL`)
    .all();

  const candidates = [];
  for (const row of rows) {
    const message = firstRealUserMessage(row.jsonl_path);
    if (!message) continue;
    const workerLane = row.origin === 'direct' || row.origin === 'dispatch' || row.origin === 'external';
    if (!workerLane && !titleDerivesFromMessage(row.custom_name, message)) continue;
    candidates.push({ ...row, message });
  }
  console.log(`${dbPath}: ${candidates.length} of ${rows.length} session(s) need labels`);

  const update = db.prepare('UPDATE sessions SET custom_name = ? WHERE session_id = ?');
  let done = 0;
  let failed = 0;
  await runPool(candidates, async (row) => {
    try {
      let label = await generateLabel(row.message);
      if (!label) {
        label = await generateLabel(row.message);
      }
      if (!label) {
        failed += 1;
        console.error(`  unusable label for ${row.session_id}`);
        return;
      }
      if (DRY_RUN) {
        console.log(`  [dry] ${row.session_id}: "${(row.custom_name ?? '').slice(0, 40)}" -> "${label}"`);
      } else {
        update.run(label, row.session_id);
      }
      done += 1;
    } catch (error) {
      failed += 1;
      console.error(`  label failed for ${row.session_id}: ${error.message}`);
    }
  });
  console.log(`${dbPath}: labeled ${done}, failed ${failed}`);
  db.close();
}
