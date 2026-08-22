#!/usr/bin/env node
// Retags discovered terminal chain sessions as origin 'external' (ui6 fix).
//
// Targets rows discovery created (origin NULL, session_id = provider_session_id,
// provider claude) whose transcript's first user message opens with a chain
// prompt ("Execute Phase", "First, sync the repo", "First, run git pull").
// App-created chats keep their rows untouched. Safe to re-run; re-run after
// promote so rows the old build indexed between fix and restart get caught.
//
// Usage: node scripts/2026-08-22-retag-external-chain-sessions.mjs <db-path> [<db-path>...]
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// '<task>' catches the equivalent headless chain briefs used in other projects
// (e.g. spoton-payroll's BUILD_frontend phases).
const CHAIN_PROMPT_PREFIXES = ['Execute Phase', 'First, sync the repo', 'First, run git pull', '<task>'];

function firstUserMessageText(jsonlPath) {
  let raw;
  try {
    raw = readFileSync(jsonlPath, 'utf8');
  } catch {
    return null;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    if (data?.type !== 'user' || !data.message) continue;
    const content = data.message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textPart = content.find((part) => part?.type === 'text' && typeof part.text === 'string');
      return textPart ? textPart.text : null;
    }
    return null;
  }
  return null;
}

const dbPaths = process.argv.slice(2);
if (dbPaths.length === 0) {
  console.error('Usage: node scripts/2026-08-22-retag-external-chain-sessions.mjs <db-path> [<db-path>...]');
  process.exit(1);
}

for (const dbPath of dbPaths) {
  if (!existsSync(dbPath)) {
    console.log(`${dbPath}: missing, skipped`);
    continue;
  }
  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `SELECT session_id, jsonl_path, custom_name FROM sessions
       WHERE origin IS NULL AND provider = 'claude' AND session_id = provider_session_id
         AND jsonl_path IS NOT NULL`,
    )
    .all();
  const retag = db.prepare(`UPDATE sessions SET origin = 'external' WHERE session_id = ?`);
  let changed = 0;
  for (const row of rows) {
    const text = firstUserMessageText(row.jsonl_path);
    if (text && CHAIN_PROMPT_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix))) {
      retag.run(row.session_id);
      changed += 1;
      console.log(`  external: ${row.session_id} (${(row.custom_name ?? '').slice(0, 60)})`);
    }
  }
  db.close();
  console.log(`${dbPath}: retagged ${changed} of ${rows.length} candidate row(s)`);
}
