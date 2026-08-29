#!/usr/bin/env node
// Copies a real Codex rollout into a dev fixture the pane checks can append to
// (ui18 job 6). The rollout of a finished run is a historical record shared with
// live, so a check never writes to it directly: this makes a copy under the same
// watched root (`~/.codex/sessions`, the only tree the sessions watcher reads)
// with a fresh session id, and registers it in the dev database as the newest
// dispatch run of its chain so the worker pane follows it.
//
// `--head <n>` keeps only the first n events, which is how the trapping state
// is staged: a Codex run whose whole transcript is shorter than the pane has
// nothing left for the fill loop to fetch, so the pane's own layout decides
// where the live indicator sits.
//
// usage: node scripts/dev/make-codex-pane-fixture.mjs <sourceRollout> [chainSlug] [phase] [--head n]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const headIndex = argv.indexOf('--head');
const head = headIndex === -1 ? 0 : Number(argv[headIndex + 1]);
if (headIndex !== -1) argv.splice(headIndex, 2);
const tailIndex = argv.indexOf('--tail');
const tail = tailIndex === -1 ? 0 : Number(argv[tailIndex + 1]);
if (tailIndex !== -1) argv.splice(tailIndex, 2);
const [source, chainSlug = 'ui18', phaseArg = '1'] = argv;
if (!source || !fs.existsSync(source)) {
  console.error('usage: make-codex-pane-fixture.mjs <sourceRollout> [chainSlug] [phase]');
  process.exit(2);
}

const DEV_DB = path.join(os.homedir(), '.cloudcli-dev', 'auth.db');
const sessionId = randomUUID();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(os.homedir(), '.codex', 'sessions', ...new Date().toISOString().slice(0, 10).split('-'));
fs.mkdirSync(dir, { recursive: true });
const target = path.join(dir, `rollout-${stamp}-${sessionId}.jsonl`);

// The session id lives in session_meta and in every event's own envelope; a
// copy that kept the source id would be indexed as the same session.
const sourceId = JSON.parse(fs.readFileSync(source, 'utf8').split('\n', 1)[0]).payload.session_id;
const lines = fs.readFileSync(source, 'utf8').split('\n').filter(Boolean);
// `--tail` keeps the session envelope (meta plus turn context) and the last n
// events, which is the short transcript a long thinking stretch leaves behind.
const kept = tail > 0
  ? [...lines.filter((line) => /"type": ?"(session_meta|turn_context)"/.test(line)), ...lines.slice(-tail)]
  : head > 0 ? lines.slice(0, head) : lines;
fs.writeFileSync(target, `${kept.join('\n').split(sourceId).join(sessionId)}\n`);
console.log(`fixture rollout: ${target}`);

const sql = (statement) => execFileSync('sqlite3', [DEV_DB, statement], { encoding: 'utf8' });
// The watcher indexes the file within a couple of seconds; the row must exist
// before it can be promoted to a dispatch run of the chain.
const deadline = Date.now() + 30_000;
let indexed = '';
while (Date.now() < deadline && !indexed.trim()) {
  indexed = sql(`select session_id from sessions where session_id='${sessionId}';`);
  if (!indexed.trim()) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!indexed.trim()) {
  console.error('the dev watcher never indexed the fixture rollout');
  process.exit(1);
}

sql(`update sessions set provider='codex', model='gpt-5.6-sol', origin='dispatch', chain_slug='${chainSlug}',
  chain_phase=${Number(phaseArg)}, booted=0,
  project_path='${process.cwd()}', assigned_project_path='${process.cwd()}',
  jsonl_path='${target}', provider_session_id='${sessionId}',
  created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  where session_id='${sessionId}';`);
console.log(`fixture session: ${sessionId}`);
