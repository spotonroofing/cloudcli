import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  apiKeysDb,
  appConfigDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  userDb,
} from '@/modules/database/index.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(tmpdir(), 'job-history-data-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();
  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await rm(directory, { recursive: true, force: true });
  }
}

test('worker-run chain units expose verdict, failure, suite, hold, budget, and commit state', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/job-state-payload';
    const slug = 'job-state-payload';
    projectsDb.createProjectPath(projectPath);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    watchdogService.registerChain({
      slug,
      projectPath,
      phases: 4,
      manifest: ['Passed', 'Failed', 'Inconclusive', 'Stopped'].map((name) => ({
        name,
        tasks: [],
        kind: 'phase' as const,
      })),
    });

    watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });
    watchdogService.chainEvent(slug, 'phase-end', {
      phase: 1,
      commit: { hash: 'abc1234', subject: 'record worker commit' },
    });
    watchdogService.chainEvent(slug, 'verify-start', { phase: 1 });
    watchdogService.chainEvent(slug, 'verify-end', { phase: 1, verdict: 'PASS' });
    watchdogService.chainEvent(slug, 'suite-end', { phase: 1, suiteStatus: 'green' });

    watchdogService.chainEvent(slug, 'phase-start', { phase: 2 });
    watchdogService.chainEvent(slug, 'phase-end', { phase: 2 });
    watchdogService.chainEvent(slug, 'verify-start', { phase: 2 });
    watchdogService.chainEvent(slug, 'verify-end', {
      phase: 2,
      verdict: 'FAIL',
      summaryTail: 'focused verifier failed',
    });

    watchdogService.chainEvent(slug, 'phase-start', { phase: 3 });
    watchdogService.chainEvent(slug, 'phase-end', { phase: 3 });
    watchdogService.chainEvent(slug, 'verify-start', { phase: 3 });
    watchdogService.chainEvent(slug, 'verify-end', {
      phase: 3,
      verdict: 'INCONCLUSIVE',
      summaryTail: 'verifier could not decide',
    });
    watchdogService.chainEvent(slug, 'suite-end', {
      phase: 3,
      suiteStatus: 'red',
      suiteFailures: ['server test'],
    });

    watchdogService.chainEvent(slug, 'phase-start', { phase: 4 });
    assert.equal(watchdogService.requestChainHold(slug, projectPath, 'promote'), 'holding');
    watchdogService.chainEvent(slug, 'stopped', {
      phase: 4,
      summaryTail: 'Job 4 stopped on its unit budget.',
    });

    const units = watchdogService.listWorkerRuns(projectPath).chains[slug]?.manifest;
    assert.equal(units?.[0]?.verdict, 'passed');
    assert.equal(units?.[0]?.suiteResult, 'green');
    assert.deepEqual(units?.[0]?.workerCommit, { hash: 'abc1234', subject: 'record worker commit' });
    assert.equal(units?.[1]?.verdict, 'failed');
    assert.equal(units?.[1]?.verifyFailureReason, 'focused verifier failed');
    assert.equal(units?.[2]?.verdict, 'inconclusive');
    assert.equal(units?.[2]?.suiteResult, 'red');
    assert.equal(units?.[3]?.verdict, 'skipped');
    assert.equal(units?.[3]?.holdRequested, true);
    assert.equal(units?.[3]?.budgetStop, true);
  });
});

test('the stop route turns an already parked chain into a stopped chain', async () => {
  await withIsolatedDatabase(async () => {
    const projectPath = '/workspace/stop-route';
    const slug = 'stop-route';
    projectsDb.createProjectPath(projectPath);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    const user = userDb.createUser('stop-route-test', 'unused');
    const apiKey = apiKeysDb.createApiKey(Number(user.id), 'stop-route-test').apiKey;
    watchdogService.registerChain({ slug, projectPath, phases: 1 });
    watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });
    watchdogService.chainEvent(slug, 'paused', {
      phase: 1,
      summaryTail: 'Uncommitted work is parked on the pause branch.',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/watchdog', createWatchdogRouter());
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/watchdog/chains/${slug}/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ projectPath }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, data: { slug, status: 'stopped' } });
      assert.equal(watchdogService.listWorkerRuns(projectPath).chains[slug]?.status, 'stopped');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
