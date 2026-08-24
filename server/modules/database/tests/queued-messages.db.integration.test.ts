import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { queuedMessagesDb } from '@/modules/database/repositories/queued-messages.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'queued-messages-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
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

test('queuedMessagesDb upserts per session and remove claims exactly once', async () => {
  await withIsolatedDatabase(() => {
    assert.deepEqual(queuedMessagesDb.listAll(), []);

    queuedMessagesDb.upsert('s1', 'first', '{"model":"m"}', null, '2026-08-24T00:00:00.000Z');
    queuedMessagesDb.upsert('s1', 'edited', null, '[{"path":"/tmp/a.png"}]', '2026-08-24T00:00:01.000Z');
    queuedMessagesDb.upsert('s2', 'other', null, null, '2026-08-24T00:00:02.000Z');

    const rows = queuedMessagesDb.listAll();
    assert.equal(rows.length, 2);
    const s1 = rows.find((row) => row.session_id === 's1');
    assert.equal(s1?.content, 'edited');
    assert.equal(s1?.options_json, null);
    assert.equal(s1?.attachments_json, '[{"path":"/tmp/a.png"}]');

    assert.equal(queuedMessagesDb.remove('s1'), true);
    assert.equal(queuedMessagesDb.remove('s1'), false);
    assert.equal(queuedMessagesDb.listAll().length, 1);
  });
});
