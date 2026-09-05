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

test('queuedMessagesDb stacks in order, dedupes retry keys, and removes claims exactly once', async () => {
  await withIsolatedDatabase(() => {
    assert.deepEqual(queuedMessagesDb.listAll(), []);

    queuedMessagesDb.upsert('s1', 'm1', 'first', '{"model":"m"}', null, '2026-08-24T00:00:00.000Z');
    queuedMessagesDb.upsert('s1', 'm2', 'second', null, null, '2026-08-24T00:00:01.000Z');
    queuedMessagesDb.upsert('s1', 'm1', 'edited', null, '[{"path":"/tmp/a.png"}]', '2026-08-24T00:00:02.000Z');
    queuedMessagesDb.upsert('s2', 'm3', 'other', null, null, '2026-08-24T00:00:03.000Z');

    // Editing m1 keeps its place at the head; m2 stays queued behind it.
    const s1 = queuedMessagesDb.listForSession('s1');
    assert.deepEqual(s1.map((row) => row.id), ['m1', 'm2']);
    assert.equal(s1[0].content, 'edited');
    assert.equal(s1[0].options_json, null);
    assert.equal(s1[0].attachments_json, '[{"path":"/tmp/a.png"}]');
    assert.equal(queuedMessagesDb.getHead('s1')?.id, 'm1');

    assert.equal(queuedMessagesDb.remove('s1', 'm1'), true);
    assert.equal(queuedMessagesDb.remove('s1', 'm1'), false);
    assert.equal(queuedMessagesDb.getHead('s1')?.id, 'm2');
    assert.equal(queuedMessagesDb.listAll().length, 2);

    // Appending after a pop lands behind the surviving tail.
    assert.equal(
      queuedMessagesDb.upsert('s1', 'm4', 'third', null, null, '2026-08-24T00:00:04.000Z'),
      true,
    );
    const firstPosition = queuedMessagesDb.get('s1', 'm4')?.position;
    assert.equal(
      queuedMessagesDb.upsert('s1', 'm4', 'third', null, null, '2026-08-24T00:00:05.000Z'),
      true,
    );
    assert.deepEqual(queuedMessagesDb.listForSession('s1').map((row) => row.id), ['m2', 'm4']);
    assert.equal(queuedMessagesDb.listForSession('s1').filter((row) => row.id === 'm4').length, 1);
    assert.equal(queuedMessagesDb.get('s1', 'm4')?.position, firstPosition);

    assert.equal(queuedMessagesDb.remove('s1', 'm4'), true);
    assert.equal(
      queuedMessagesDb.upsert('s1', 'm4', 'third', null, null, '2026-08-24T00:00:06.000Z'),
      false,
    );
    assert.deepEqual(queuedMessagesDb.listForSession('s1').map((row) => row.id), ['m2']);
  });
});
