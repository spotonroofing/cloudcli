import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { userSettingsDb } from '@/modules/database/repositories/user-settings.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'user-settings-db-'));
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

test('userSettingsDb.apply upserts, deletes on null, and scopes by user', async () => {
  await withIsolatedDatabase(() => {
    assert.deepEqual(userSettingsDb.getAll(1), {});

    userSettingsDb.apply(1, { 'color-theme': 'moss', theme: 'dark' }, '2026-08-24T00:00:00.000Z');
    userSettingsDb.apply(2, { 'color-theme': 'dune' }, '2026-08-24T00:00:00.000Z');
    assert.deepEqual(userSettingsDb.getAll(1), { 'color-theme': 'moss', theme: 'dark' });
    assert.deepEqual(userSettingsDb.getAll(2), { 'color-theme': 'dune' });

    userSettingsDb.apply(1, { 'color-theme': 'ink', theme: null }, '2026-08-24T00:00:01.000Z');
    assert.deepEqual(userSettingsDb.getAll(1), { 'color-theme': 'ink' });
    assert.deepEqual(userSettingsDb.getAll(2), { 'color-theme': 'dune' });
  });
});
