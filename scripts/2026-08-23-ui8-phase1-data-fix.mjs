#!/usr/bin/env node
// ui8 phase 1 data fixes (PUNCHLIST_ui8.md). Idempotent; safe to re-run.
//
// Live DB (~/.cloudcli/auth.db):
//   - Stamps chain_slug on the ui7/ui8 out-of-process dispatch phase rows
//     (origin already dispatch; slug was never recorded).
//   - Deletes the two Haiku label-prompt phantom rows and their transcripts.
//   - Deletes throwaway reply-ok test sessions and "New session" boots from
//     the ui7 round, with their transcripts.
//
// Dev DB (~/.cloudcli-dev/auth.db):
//   - Seeds the curated project rows missing since the dev DB was created
//     (the synchronizer stopped auto-creating projects on 2026-08-20, so the
//     twelve curated projects must exist as rows on every instance).
//   - Deletes the ui7-round throwaway test sessions with their transcripts.
//
// Usage: node scripts/2026-08-23-ui8-phase1-data-fix.mjs
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const HOME = os.homedir();
const LIVE_DB = path.join(HOME, '.cloudcli', 'auth.db');
const DEV_DB = path.join(HOME, '.cloudcli-dev', 'auth.db');

// ui7 chains per the dispatch registration (aae5f12): ui7 = phases 1-6,
// ui7b = phase 7 (workspace), ui7c = phase 8 (mobile+verify); ui8 phase 1
// is the currently running chain.
const LIVE_CHAIN_SLUGS = {
  '052591d2-c1ff-4ccb-838e-664b62b3294e': 'ui7',
  'da919f57-1c58-48f7-b070-21929a0d82d8': 'ui7',
  '7d24c445-fe57-4bf6-9109-bcf10ea8ae17': 'ui7',
  '6c2a744a-c640-4326-8433-50ee0393e5e3': 'ui7',
  '26e68c7b-b6b2-4a3f-8844-4513db428c55': 'ui7',
  'cac4971c-30d6-4784-af32-3274a4328a98': 'ui7',
  'b42984a7-33aa-4585-b97d-fff1af3b54eb': 'ui7b',
  '8925b27b-46c6-4917-a68b-f985cb907fe4': 'ui7c',
  '17d997f0-7486-418d-bb3d-1365d1ffd7c7': 'ui8',
};

const LIVE_DELETE_IDS = [
  // Haiku label-call phantom transcripts indexed as sessions.
  '42e4f630-4a0e-4188-beb9-54c7611867ce',
  'c01f9f7e-c15e-424e-86c4-706c8465698d',
  // reply-ok/echo throwaway test chats from the ui6/ui7 rounds.
  '6f1eaabc-9a60-4682-b8b5-b5634fa2a557',
  '859d3094-7f9a-4cb2-b248-c42f1e09a5ae',
  'ebb67710-7a4c-4400-9b48-1385164620d9',
  'b575dbd9-59df-410d-86de-aced01bb9e29',
  'd1101240-f872-43ec-89e8-3dcc911dca85',
  'ace919b8-1492-46ac-bef0-8a82a2521401',
  // "New session" boot that never got a typed message.
  '912ccfed-1c78-46ce-805e-b021cfadb393',
];

const DEV_DELETE_IDS = [
  // reply-ok / say-ok / shell-echo test chats.
  'f2dc1c3f-7d96-40f6-9fa3-a5cb260d0a1c',
  'bd3ea61c-b12e-4af8-8df6-c26d0259a7d5',
  '3df3c326-c714-4c74-b236-0a38964a4a3e',
  '791ed9f5-1697-47ae-908c-4c1a59179b1f',
  'af7ca4d7-5933-408d-a6b0-7cc1977dfda6',
  'd9117f50-b16c-4996-8f30-24dcc767ecd2',
  '116284dc-5572-4cfa-8786-d43109e9b89c',
  'd253372e-798c-42ae-8bfe-62de291f7da2',
  '46633885-ca30-4c11-8fc4-2f9d31f37e2f',
  '60d3b9e8-809b-4f43-bdb3-bc6a42c12ac2',
  '5f60b7fe-8fc4-4055-b9fb-048faa5ecffb',
  '08231067-d2b6-4000-838e-f7f7952a0440',
  'd8c5e305-5daa-4d72-94d6-4b737c8dbffd',
  '139cc970-f08c-442a-9abd-0e44b0721a8c',
  '296f7f78-2ff0-4c6a-ae51-80ace0e58d57',
  '2b569c1e-dabc-4aec-8d2f-218c3fbd2891',
  'e28371c9-e8ad-4761-afaf-7d1035566a03',
  '039ae703-c47b-4a95-8230-c587b277237b',
  '4ff78664-67f8-423b-a698-b3c35529877b',
  '5579cfcc-8db2-4a69-b70f-d80f3aeeb165',
  '5a230e81-8fe3-4e8e-ad01-6d4fd9e824ab',
  // "New session" boots that never got a typed message.
  '39f5d3ab-688c-4493-be24-2958101bf102',
  '8292bd1b-55fd-4d61-a898-e09a660636d0',
  '9d7dfc42-a747-4bf1-8c86-34e6d8dcd272',
  '4b957858-4a0c-4e83-983f-32cecb02ae12',
  'fee7a424-ed44-4bdc-9c9b-00df676e77a3',
  // Haiku label-call phantom transcript.
  '44af5d8e-3f63-49bb-9a1e-d29dad57bade',
  // API probe session created while diagnosing the label pipeline (2026-08-23).
  '816a55b0-331f-4704-9e36-03d2bbf74e18',
];

function deleteSessions(db, ids, label) {
  const select = db.prepare('SELECT session_id, jsonl_path FROM sessions WHERE session_id = ? OR provider_session_id = ?');
  const remove = db.prepare('DELETE FROM sessions WHERE session_id = ? OR provider_session_id = ?');
  let rows = 0;
  let files = 0;
  for (const id of ids) {
    const row = select.get(id, id);
    if (!row) continue;
    if (row.jsonl_path && existsSync(row.jsonl_path)) {
      unlinkSync(row.jsonl_path);
      files += 1;
    }
    rows += remove.run(id, id).changes;
  }
  console.log(`${label}: deleted ${rows} session row(s), ${files} transcript file(s)`);
}

// ----- live -----
{
  const db = new Database(LIVE_DB);
  const stamp = db.prepare(`UPDATE sessions SET origin = 'dispatch', chain_slug = ? WHERE session_id = ?`);
  let stamped = 0;
  for (const [id, slug] of Object.entries(LIVE_CHAIN_SLUGS)) {
    stamped += stamp.run(slug, id).changes;
  }
  console.log(`live: stamped chain_slug on ${stamped} dispatch phase row(s)`);

  // Catch-up sweep for the ui8 chain itself: it was launched with the
  // pre-fix runner (the running zsh holds the old script inode), so phases
  // that start after this script first ran are still discovered untagged by
  // the live build. Idempotent - RE-RUN THIS SCRIPT AFTER THE ui8 CHAIN
  // COMPLETES (and again at promote time) to sweep them.
  const swept = db
    .prepare(`UPDATE sessions SET origin = 'dispatch', chain_slug = 'ui8'
              WHERE custom_name LIKE '%Execute Phase % of PUNCHLIST_ui8%'
                AND (origin IS NULL OR origin = 'external' OR chain_slug IS NULL)`)
    .run().changes;
  console.log(`live: catch-up sweep tagged ${swept} ui8 phase row(s)`);
  deleteSessions(db, LIVE_DELETE_IDS, 'live');
  db.close();
}

// ----- dev -----
{
  const live = new Database(LIVE_DB, { readonly: true });
  const curated = live
    .prepare(`SELECT project_id, project_path, custom_project_name, isStarred, isArchived, planner_memory_name
              FROM projects WHERE isArchived = 0`)
    .all();
  live.close();

  const db = new Database(DEV_DB);
  const insert = db.prepare(`INSERT INTO projects (project_id, project_path, custom_project_name, isStarred, isArchived, planner_memory_name)
                             VALUES (?, ?, ?, ?, 0, ?)`);
  const exists = db.prepare('SELECT 1 FROM projects WHERE project_path = ?');
  let seeded = 0;
  for (const row of curated) {
    if (exists.get(row.project_path)) continue;
    insert.run(row.project_id, row.project_path, row.custom_project_name, row.isStarred, row.planner_memory_name);
    seeded += 1;
  }
  console.log(`dev: seeded ${seeded} missing curated project row(s)`);
  deleteSessions(db, DEV_DELETE_IDS, 'dev');
  db.close();
}
