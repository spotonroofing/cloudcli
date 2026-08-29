import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';
import { watchdogService } from '@/modules/watchdog/index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'pause-resume-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

test('pause and resume preserve one chain and restart at the first job without a commit', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/pause-resume-project';
    const slug = 'pause-resume-stub';
    projectsDb.createProjectPath(projectPath);
    watchdogService.registerChain({
      slug,
      projectPath,
      phases: 3,
      manifest: [
        { name: 'One', tasks: ['first'], kind: 'phase' },
        { name: 'Two', tasks: ['second'], kind: 'phase' },
        { name: 'Three', tasks: ['third'], kind: 'phase' },
      ],
    });

    watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });
    watchdogService.chainEvent(slug, 'phase-end', {
      phase: 1,
      commit: { hash: 'abc1234', subject: 'job one' },
    });
    watchdogService.chainEvent(slug, 'verify-start', { phase: 1 });
    watchdogService.chainEvent(slug, 'phase-start', { phase: 2 });
    watchdogService.chainEvent(slug, 'verify-end', { phase: 1 });
    assert.equal(watchdogService.chainEvent(slug, 'paused', { phase: 2 }), true);

    const paused = watchdogService.listWorkerRuns(projectPath).chains[slug];
    assert.equal(paused.status, 'paused');
    assert.equal(paused.phaseActive, false);
    assert.equal(paused.currentPhase, 2);
    assert.equal(paused.manifest?.length, 3);
    assert.equal(paused.manifest?.[0].verify, 'passed');

    assert.deepEqual(watchdogService.resumeChain(slug, projectPath), { phase: 2, phases: 3 });
    const resumed = watchdogService.listWorkerRuns(projectPath).chains[slug];
    assert.equal(resumed.status, 'running');
    assert.equal(resumed.currentPhase, 2);
    assert.equal(resumed.manifest?.length, 3);
    assert.equal(resumed.manifest?.[0].commitHash, 'abc1234');
    assert.equal(watchdogService.resumeChain(slug, projectPath), null, 'a running chain cannot be resumed again');
  });
});
