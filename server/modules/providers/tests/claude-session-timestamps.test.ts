import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { ClaudeSessionSynchronizer } from '@/modules/providers/list/claude/claude-session-synchronizer.provider.js';

// Honest row timestamps (ui14 job 12): `updated_at` reflects the last real
// message in the transcript, never the file mtime — so watcher re-indexing,
// label-pass marker lines, and compaction rewrites cannot make a days-old
// chat read "1hr".

async function withIsolatedDatabase(runTest: (tempDirectory: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'claude-sync-ts-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const SESSION_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
const OLD_USER_AT = '2026-08-20T12:00:00.000Z';
const OLD_ASSISTANT_AT = '2026-08-20T12:00:30.000Z';

function transcriptLines(): string {
  const lines = [
    { type: 'user', sessionId: SESSION_ID, cwd: '/workspace/old-chat', timestamp: OLD_USER_AT, message: { role: 'user', content: 'hello' } },
    { type: 'assistant', sessionId: SESSION_ID, cwd: '/workspace/old-chat', timestamp: OLD_ASSISTANT_AT, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
  ];
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

test('synchronizeFile stamps updated_at from the last real message, not file mtime', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
    // The file is written now, so its mtime is "now" while every message
    // inside is days old.
    await writeFile(transcriptPath, transcriptLines(), 'utf8');

    const synchronizer = new ClaudeSessionSynchronizer();
    const sessionId = await synchronizer.synchronizeFile(transcriptPath);
    assert.equal(sessionId, SESSION_ID);

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(row);
    assert.equal(row.updated_at, OLD_ASSISTANT_AT);
  });
});

test('marker-line appends (label pass) do not move the age on re-index', async () => {
  await withIsolatedDatabase(async (tempDirectory) => {
    const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
    await writeFile(transcriptPath, transcriptLines(), 'utf8');

    const synchronizer = new ClaudeSessionSynchronizer();
    await synchronizer.synchronizeFile(transcriptPath);

    // An ai-title marker lands at the tail (what a label pass writes); the
    // mtime bumps to now, the watcher re-indexes.
    await appendFile(
      transcriptPath,
      `${JSON.stringify({ type: 'ai-title', sessionId: SESSION_ID, aiTitle: 'Old chat', timestamp: new Date().toISOString() })}\n`,
      'utf8',
    );
    await synchronizer.synchronizeFile(transcriptPath);

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(row);
    assert.equal(row.updated_at, OLD_ASSISTANT_AT);
  });
});

test('createSession keeps the existing updated_at when no timestamp can be read', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(SESSION_ID, 'claude', '/workspace/old-chat', 'Old chat', OLD_USER_AT, OLD_ASSISTANT_AT, null, null);

    // A re-index that could not read a real timestamp (stat failure, empty
    // tail) passes undefined; the row must keep its age instead of taking
    // CURRENT_TIMESTAMP.
    sessionsDb.createSession(SESSION_ID, 'claude', '/workspace/old-chat', 'Old chat', undefined, undefined, null, null);

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(row);
    assert.equal(row.updated_at, OLD_ASSISTANT_AT);
  });
});

test('identity wiring and project moves never bump updated_at', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createSession(SESSION_ID, 'claude', '/workspace/old-chat', 'Old chat', OLD_USER_AT, OLD_ASSISTANT_AT, null, null);

    sessionsDb.assignProviderSessionId(SESSION_ID, 'bbbbbbbb-1111-2222-3333-444444444444');
    sessionsDb.assignSessionToProject(SESSION_ID, '/workspace/other-project');

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(row);
    assert.equal(row.updated_at, OLD_ASSISTANT_AT);
  });
});
