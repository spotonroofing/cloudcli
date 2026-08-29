import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';

const dispatchPath = path.resolve('scripts/macos/dispatch');

test('dispatch refuses the archived planner it would have used', {
  skip: process.platform !== 'darwin',
  timeout: 10_000,
}, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'dispatch-live-planner-'));
  const repoPath = path.join(directory, 'repo');
  const database = path.join(directory, 'auth.db');
  const prompt = path.join(directory, 'one.md');

  closeConnection();
  process.env.DATABASE_PATH = database;
  try {
    await mkdir(path.join(repoPath, '.git'), { recursive: true });
    const repo = await realpath(repoPath);
    await writeFile(prompt, '<!-- name: One -->\nStub unit.\n');
    await initializeDatabase();
    sessionsDb.createAppSession('archived-planner', 'claude', repo, 'Archived planner', 'planner');
    sessionsDb.markSessionBooted('archived-planner');
    sessionsDb.setSessionBootState('archived-planner', 'ready');
    sessionsDb.updateSessionIsArchived('archived-planner', true);

    const child = spawn('/bin/zsh', [dispatchPath, repo, 'dead-planner-stub', prompt], {
      cwd: repo,
      env: {
        ...process.env,
        CODEX_THREAD_ID: '',
        CLAUDE_CODE_SESSION_ID: '',
        DISPATCH_DB_PATH: database,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    const [exitCode] = await once(child, 'exit') as [number];

    assert.notEqual(exitCode, 0);
    assert.match(stderr, /resolved dispatching session archived-planner is not open right now/);
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
