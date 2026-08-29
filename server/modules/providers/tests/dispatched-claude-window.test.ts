import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appConfigDb, closeConnection, initializeDatabase } from '@/modules/database/index.js';
import { seedDispatchedClaudeContextWindow } from '@/modules/providers/services/provider-token-usage.service.js';

/**
 * ui17 job 19: a dispatched unit runs `claude -p` outside the SDK runtime, so
 * no live turn ever persists its window and the meter served the cataloged
 * guess for the whole run. Announcing the session seeds the window instead.
 */
test('announcing a dispatched Claude unit persists that model window', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'dispatched-claude-window-'));
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');

  try {
    await initializeDatabase();

    assert.equal(seedDispatchedClaudeContextWindow('claude-opus-5'), true);
    assert.deepEqual(
      JSON.parse(appConfigDb.get('claude_context_window:claude-opus-5') as string),
      { total: 1_000_000, totalIsUsableWindow: false },
    );

    // An observed window always outranks the seed, and is never overwritten.
    appConfigDb.set(
      'claude_context_window:claude-sonnet-5',
      JSON.stringify({ total: 967_000, totalIsUsableWindow: false }),
    );
    assert.equal(seedDispatchedClaudeContextWindow('claude-sonnet-5'), false);
    assert.deepEqual(
      JSON.parse(appConfigDb.get('claude_context_window:claude-sonnet-5') as string),
      { total: 967_000, totalIsUsableWindow: false },
    );

    // Nothing to seed from, so nothing is written and the env / 160k fallback stands.
    assert.equal(seedDispatchedClaudeContextWindow('claude-something-unreleased'), false);
    assert.equal(appConfigDb.get('claude_context_window:claude-something-unreleased'), null);
    assert.equal(seedDispatchedClaudeContextWindow(null), false);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
