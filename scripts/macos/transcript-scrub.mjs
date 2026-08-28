#!/usr/bin/env node
// transcript-scrub — redacts known secret shapes in the mini's local session
// transcripts (audit 3.3/3.5, ui14 job 9).
//
//   transcript-scrub [--dry-run] [dir ...]
//
// Walks ~/.claude/projects and ~/.claude-dev/projects (or the dirs given),
// rewrites every file in place with each matched secret replaced by a
// [REDACTED:<shape>] marker (no quotes or backslashes, so JSONL stays
// parseable), and logs counts only — never a value. Files written in the last
// ten minutes are skipped: a live session appends to its transcript and the
// hourly launchd run catches them once quiet. --dry-run counts without writing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LEGACY_RUNTIME_ANCHORS } from '../../shared/runtime-anchors.js';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const givenRoots = args.filter((arg) => !arg.startsWith('--'));
const ROOTS = givenRoots.length
  ? givenRoots
  : [path.join(os.homedir(), '.claude', 'projects'), path.join(os.homedir(), '.claude-dev', 'projects')];
const LOG = path.join(os.homedir(), 'forge-logs', LEGACY_RUNTIME_ANCHORS.scrubLogDirectoryName, 'scrub.log');
const QUIET_MS = 10 * 60 * 1000;

// Twilio API Key SID (with its `:secret` basic-auth tail when present), the
// secret alone in `"secret": "..."` / `SECRET=...` form, the AccountSid,
// Anthropic keys, GitHub tokens, and Bearer/Basic authorization values.
const SHAPES = [
  { name: 'twilio-key', re: /\bSK[0-9a-f]{32}\b(?::[A-Za-z0-9]{32}\b)?/g, marker: '[REDACTED:twilio-key]' },
  { name: 'twilio-secret', re: /(secret\\?"?\s*[:=]\s*\\?"?)([A-Za-z0-9]{32})\b/gi, marker: '$1[REDACTED:twilio-secret]' },
  { name: 'twilio-account', re: /\bAC[0-9a-f]{32}\b/g, marker: '[REDACTED:twilio-account]' },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, marker: '[REDACTED:anthropic-key]' },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, marker: '[REDACTED:github-token]' },
  { name: 'auth-header', re: /\b(Bearer|Basic) [A-Za-z0-9._~+/=-]{20,}/g, marker: '$1 [REDACTED:token]' },
];

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const counts = Object.fromEntries(SHAPES.map((shape) => [shape.name, 0]));
let scanned = 0;
let changed = 0;
let skippedRecent = 0;
const now = Date.now();

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const stat = fs.statSync(file);
    if (now - stat.mtimeMs < QUIET_MS) {
      skippedRecent += 1;
      continue;
    }
    scanned += 1;
    const original = fs.readFileSync(file, 'utf8');
    let text = original;
    for (const shape of SHAPES) {
      const hits = text.match(shape.re)?.length ?? 0;
      if (hits) {
        counts[shape.name] += hits;
        text = text.replace(shape.re, shape.marker);
      }
    }
    if (text !== original) {
      changed += 1;
      if (!DRY_RUN) {
        fs.writeFileSync(file, text, { mode: stat.mode });
      }
    }
  }
}

const summary = Object.entries(counts).map(([name, n]) => `${name}=${n}`).join(' ');
const line = `[${new Date().toISOString()}] ${DRY_RUN ? 'dry-run ' : ''}scanned=${scanned} changed=${changed} skipped-recent=${skippedRecent} ${summary}`;
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.appendFileSync(LOG, `${line}\n`);
console.log(line);
