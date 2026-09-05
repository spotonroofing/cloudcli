import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appConfigDb, closeConnection, initializeDatabase, notificationPreferencesDb, projectsDb, sessionsDb, userDb, watchdogDb } from '@/modules/database/index.js';
import { providerRuntimeService } from '@/modules/providers/index.js';
import { watchdogService } from '@/modules/watchdog/index.js';
import { parseJobMeta } from '@/modules/watchdog/watchdog.service.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'running-chain-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  const user = userDb.createUser(`running-chain-${Date.now()}`, 'unused');
  notificationPreferencesDb.updatePreferences(Number(user.id), {
    channels: { inApp: true, webPush: false, desktop: false, sound: false },
    events: { actionRequired: true, stop: true, error: true },
  });
  assert.equal(userDb.getFirstUser()?.id, user.id);
  assert.equal(notificationPreferencesDb.getPreferences(Number(user.id)).channels.inApp, true);
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

async function waitFor(assertion: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`condition did not become true within ${timeoutMs}ms`);
}

test('persisted job metadata round-trips every settled verify verdict', () => {
  assert.deepEqual(parseJobMeta(JSON.stringify({
    11: { engine: 'codex', model: 'gpt-5.6-sol', verify: 'passed' },
    12: { verify: 'failed', verifyReason: 'observed defect', suite: 'red', suiteFailures: ['suite case'] },
    13: { verify: 'inconclusive', verifyReason: 'verify cap' },
  })), {
    11: { engine: 'codex', model: 'gpt-5.6-sol', verify: 'passed' },
    12: { verify: 'failed', verifyReason: 'observed defect', suite: 'red', suiteFailures: ['suite case'] },
    13: { verify: 'inconclusive', verifyReason: 'verify cap' },
  });
});

test('PASS, FAIL, and INCONCLUSIVE remain distinct in job_meta, jobs payload, and terminal totals', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/verdict-truth-project';
    const slug = `verdict-truth-${Date.now()}`;
    const messages: string[] = [];
    const notificationClient = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => { messages.push(message); },
    } as unknown as RealtimeClientConnection;
    connectedClients.add(notificationClient);
    try {
      appConfigDb.set('watchdog_terminal_wakes', '0');
      projectsDb.createProjectPath(projectPath);
      watchdogService.registerChain({
        slug,
        projectPath,
        phases: 3,
        manifest: [
          { name: 'Pass', tasks: [], kind: 'phase' },
          { name: 'Fail', tasks: [], kind: 'phase' },
          { name: 'Inconclusive', tasks: [], kind: 'phase' },
        ],
      });
      for (const phase of [1, 2, 3]) {
        watchdogService.chainEvent(slug, 'phase-start', { phase });
        watchdogService.chainEvent(slug, 'phase-end', {
          phase,
          commit: { hash: `commit-${phase}`, subject: `job ${phase}` },
        });
        watchdogService.chainEvent(slug, 'verify-start', { phase });
      }
      watchdogService.chainEvent(slug, 'verify-end', { phase: 1, verdict: 'PASS' });
      watchdogService.chainEvent(slug, 'verify-end', { phase: 2, verdict: 'FAIL', summaryTail: 'observed defect' });
      watchdogService.chainEvent(slug, 'verify-end', {
        phase: 3,
        verdict: 'INCONCLUSIVE',
        summaryTail: 'verify cap',
      });
      watchdogService.chainEvent(slug, 'suite-end', {
        phase: 2,
        suiteStatus: 'red',
        suiteFailures: ['database contract stays green'],
      });
      watchdogService.chainEvent(slug, 'completed', { phase: 3 });

      const snapshot = watchdogService.listWorkerRuns(projectPath).chains[slug];
      assert.deepEqual(snapshot.verifySummary, { passed: 1, failed: 1, inconclusive: 1 });
      assert.deepEqual(snapshot.manifest?.map((job) => job.verify), ['passed', 'failed', 'inconclusive']);
      assert.equal(snapshot.manifest?.[2]?.verifyReason, 'verify cap');
      assert.equal(snapshot.manifest?.[1]?.suite, 'red');
      assert.deepEqual(snapshot.manifest?.[1]?.suiteFailures, ['database contract stays green']);

      const persisted = watchdogDb.listChains().find((chain) => chain.slug === slug);
      assert.ok(persisted?.job_meta);
      assert.deepEqual(Object.values(parseJobMeta(persisted.job_meta)).map((meta) => meta.verify), [
        'passed',
        'failed',
        'inconclusive',
      ]);

      const terminal = messages
        .map((message) => JSON.parse(message) as { kind?: string; title?: string; body?: string })
        .find((message) => message.kind === 'fleet_notification' && message.title?.includes('completed with'));
      assert.match(terminal?.title ?? '', /1 failed and 1 inconclusive/);
      assert.match(terminal?.body ?? '', /Verification totals:/);
      assert.match(terminal?.body ?? '', /verify cap/);
    } finally {
      connectedClients.delete(notificationClient);
    }
  });
});

test('a running chain unit and its verify session feed the running-sessions poll; a finished unit does not', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/beam-project';
    const messages: string[] = [];
    const notificationClient = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => { messages.push(message); },
    } as unknown as RealtimeClientConnection;
    connectedClients.add(notificationClient);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    projectsDb.createProjectPath(projectPath);
    watchdogService.registerChain({
      slug: 'beamstub',
      projectPath,
      phases: 2,
      manifest: [{ name: 'One', tasks: [], kind: 'phase' }, { name: 'Two', tasks: [], kind: 'phase' }],
    });

    // Job 1 runs: the runner announces its build session with the prompt's name header.
    watchdogService.chainEvent('beamstub', 'phase-start', { phase: 1 });
    sessionsDb.setSessionOrigin('build-1', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 1, 'One');
    assert.deepEqual(
      watchdogService.listActiveDispatchRuns().map((run) => run.sessionId),
      ['build-1'],
      'the active build session is live even though no in-server run registered it',
    );
    assert.equal(sessionsDb.getSessionById('build-1')?.custom_name, 'One');

    // Job 1 ends and its verify starts while job 2 builds: both the verify
    // session and the new build are live; the finished build is not.
    watchdogService.chainEvent('beamstub', 'phase-end', { phase: 1 });
    assert.deepEqual(watchdogService.listActiveDispatchRuns(), []);
    watchdogService.chainEvent('beamstub', 'verify-start', { phase: 1 });
    sessionsDb.setSessionOrigin('verify-1', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 1, 'Verify: One');
    watchdogService.setChainVerifySession('beamstub', 1, 'verify-1');
    watchdogService.chainEvent('beamstub', 'phase-start', { phase: 2 });
    sessionsDb.setSessionOrigin('build-2', 'dispatch', null, 'beamstub', null, { provider: 'claude', projectPath }, 2, 'Two');
    assert.deepEqual(
      watchdogService.listActiveDispatchRuns().map((run) => run.sessionId).sort(),
      ['build-2', 'verify-1'],
    );
    assert.equal(sessionsDb.getSessionById('verify-1')?.custom_name, 'Verify: One');

    // A terminal chain has no live sessions.
    try {
      watchdogService.chainEvent('beamstub', 'stopped', { phase: 2 });
      assert.deepEqual(watchdogService.listActiveDispatchRuns(), []);
      const terminalNotice = messages
        .map((message) => JSON.parse(message) as { kind?: string; notificationKind?: string; title?: string })
        .find((message) => message.kind === 'fleet_notification' && message.title === 'Chain beamstub stopped');
      assert.equal(terminalNotice?.notificationKind, 'decision-needed');
    } finally {
      connectedClients.delete(notificationClient);
    }
  });
});

test('an anchor-less planner manifest streams prompt-derived punch-list check-offs and task times', async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'prompt-punchlist-'));
  const slug = 'prompt-punchlist-stub';
  const promptDir = path.join(projectPath, '.dispatch', slug);
  const punchlistPath = path.join(projectPath, 'PUNCHLIST_fixture.md');
  await mkdir(promptDir, { recursive: true });
  await writeFile(
    path.join(promptDir, '01-live-jobs.md'),
    'Execute Job 23 of PUNCHLIST_fixture.md in this repo.\n',
  );
  await writeFile(punchlistPath, '## Job 23 — Live jobs\n\n- [ ] First task\n- [ ] Second task\n- [ ] Design note\n');

  try {
    await withIsolatedDatabase(async () => {
      const messages: string[] = [];
      const notificationClient = {
        readyState: WS_OPEN_STATE,
        send: (message: string) => { messages.push(message); },
      } as unknown as RealtimeClientConnection;
      connectedClients.add(notificationClient);
      appConfigDb.set('watchdog_punchlist_watching', '1');
      appConfigDb.set('watchdog_terminal_wakes', '0');
      projectsDb.createProjectPath(projectPath);
      watchdogService.registerChain({
        slug,
        projectPath,
        phases: 1,
        manifest: [{ name: 'Live jobs', tasks: ['First task', 'Second task'], kind: 'phase' }],
      });
      watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });
      messages.length = 0;

      try {
        await writeFile(punchlistPath, '## Job 23 — Live jobs\n\n- [x] First task\n- [ ] Second task\n- [ ] Design note\n');
        await waitFor(() => messages.some((message) => {
          const event = JSON.parse(message) as Record<string, unknown>;
          return event.kind === 'chain_progress'
            && event.chainSlug === slug
            && event.unit === 1
            && event.taskIndex === 0
            && event.checked === true
            && event.chain === undefined;
        }));
        let snapshot = watchdogService.listWorkerRuns(projectPath).chains[slug];
        assert.equal(snapshot.manifest?.[0]?.done, 1);
        assert.equal(snapshot.manifest?.[0]?.taskTimes?.length, 1);
        assert.equal(typeof snapshot.manifest?.[0]?.taskTimes?.[0], 'number');

        messages.length = 0;
        await writeFile(punchlistPath, '## Job 23 — Live jobs\n\n- [x] First task\n- [x] Second task\n- [x] Design note\n');
        await waitFor(() => messages.some((message) => {
          const event = JSON.parse(message) as Record<string, unknown>;
          return event.kind === 'chain_progress'
            && event.chainSlug === slug
            && event.unit === 1
            && event.taskIndex === 1
            && event.checked === true
            && event.chain === undefined;
        }));
        snapshot = watchdogService.listWorkerRuns(projectPath).chains[slug];
        assert.equal(snapshot.manifest?.[0]?.done, 2);
        assert.equal(snapshot.manifest?.[0]?.taskTimes?.length, 2);
        assert.equal(typeof snapshot.manifest?.[0]?.taskTimes?.[1], 'number');
      } finally {
        watchdogService.chainEvent(slug, 'stopped', { phase: 1 });
        connectedClients.delete(notificationClient);
      }
    });
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('phase start baselines existing checks so only this attempt advances', async () => {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'punchlist-baseline-'));
  const slug = 'punchlist-baseline-stub';
  const promptDir = path.join(projectPath, '.dispatch', slug);
  const punchlistPath = path.join(projectPath, 'PUNCHLIST_fixture.md');
  await mkdir(promptDir, { recursive: true });
  await writeFile(path.join(promptDir, '01-rerun.md'), 'Execute Job 16 of PUNCHLIST_fixture.md in this repo.\n');
  await writeFile(punchlistPath, '## Job 16 — Rerun\n\n- [x] Old check\n- [ ] New check\n');

  try {
    await withIsolatedDatabase(async () => {
      appConfigDb.set('watchdog_terminal_wakes', '0');
      projectsDb.createProjectPath(projectPath);
      watchdogService.registerChain({
        slug,
        projectPath,
        phases: 1,
        manifest: [{ name: 'Rerun', tasks: ['Old check', 'New check'], kind: 'phase' }],
      });
      watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });

      let snapshot = watchdogService.listWorkerRuns(projectPath).chains[slug];
      assert.equal(snapshot.manifest?.[0]?.done, 0);
      assert.deepEqual(snapshot.manifest?.[0]?.taskTimes, []);
      assert.equal('taskDoneBaseline' in (snapshot.manifest?.[0] ?? {}), false);

      await writeFile(punchlistPath, '## Job 16 — Rerun\n\n- [x] Old check\n- [x] New check\n');
      snapshot = watchdogService.listWorkerRuns(projectPath).chains[slug];
      assert.equal(snapshot.manifest?.[0]?.done, 1);
      assert.equal(snapshot.manifest?.[0]?.taskTimes?.length, 1);
      assert.equal(typeof snapshot.manifest?.[0]?.taskTimes?.[0], 'number');
      watchdogService.chainEvent(slug, 'stopped', { phase: 1 });
    });
  } finally {
    await rm(projectPath, { recursive: true, force: true });
  }
});

test('an announced title replaces a prompt-shaped name discovery wrote first', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/title-project';
    projectsDb.createProjectPath(projectPath);
    const id = sessionsDb.createSession('thread-1', 'codex', projectPath, '<!-- name: Two --> Execute Job 2', undefined, undefined, null, null);
    sessionsDb.setSessionOrigin('thread-1', 'dispatch', null, 'demo', null, { provider: 'codex', projectPath }, 2, 'Two');
    assert.equal(sessionsDb.getSessionById(id)?.custom_name, 'Two');
    // No title announced: the existing name is left alone.
    sessionsDb.setSessionOrigin('thread-1', 'dispatch', null, 'demo', null, { provider: 'codex', projectPath }, 2);
    assert.equal(sessionsDb.getSessionById(id)?.custom_name, 'Two');
  });
});

test('a chain keeps its first dispatching planner across re-registration', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/dispatch-owner';
    projectsDb.createProjectPath(projectPath);
    sessionsDb.createAppSession('dispatch-planner-a', 'claude', projectPath, 'Planner A', 'planner');
    sessionsDb.createAppSession('dispatch-planner-b', 'claude', projectPath, 'Planner B', 'planner');

    watchdogService.registerChain({
      slug: 'dispatch-owner-stub',
      projectPath,
      dispatchingSessionId: 'dispatch-planner-a',
      phases: 1,
    });
    watchdogService.registerChain({
      slug: 'dispatch-owner-stub',
      projectPath,
      dispatchingSessionId: 'dispatch-planner-b',
      phases: 1,
    });

    const chain = watchdogDb.listChains().find((row) => row.slug === 'dispatch-owner-stub');
    assert.equal(chain?.dispatching_session_id, 'dispatch-planner-a');
    assert.equal(sessionsDb.resolveWatchdogWakeSession(projectPath)?.session_id, 'dispatch-planner-a');
  });
});

test('a terminal chain wake leaves a dead handoff lineage for the newest live planner and persists the new anchor', async () => {
  const slug = `wake-reroute-stub-${Date.now()}`;
  const journalDirectory = path.join(homedir(), 'forge-logs', slug);
  const originalGetRunner = providerRuntimeService.getRunner;
  let resumedProviderSessionId: string | null = null;

  try {
    await withIsolatedDatabase(async () => {
      const projectPath = '/workspace/wake-reroute';
      projectsDb.createProjectPath(projectPath);
      const createBootedPlanner = (sessionId: string, origin: 'planner' | null = 'planner') => {
        sessionsDb.createSession(
          sessionId,
          'claude',
          projectPath,
          sessionId,
          undefined,
          undefined,
          path.join(projectPath, `${sessionId}.jsonl`),
          origin,
        );
        if (origin === 'planner') {
          sessionsDb.markSessionBooted(sessionId);
          sessionsDb.setSessionBootState(sessionId, 'ready');
        }
      };

      createBootedPlanner('planner-anchor-a');
      createBootedPlanner('planner-successor-b');
      sessionsDb.setSessionPredecessor('planner-successor-b', 'planner-anchor-a');
      sessionsDb.updateSessionIsArchived('planner-successor-b', true);
      createBootedPlanner('planner-live-z');
      createBootedPlanner('side-chat-zz', null);

      providerRuntimeService.getRunner = () => async (_command, options) => {
        resumedProviderSessionId = typeof options.sessionId === 'string' ? options.sessionId : null;
      };
      appConfigDb.set('watchdog_terminal_wakes', '1');
      watchdogService.registerChain({
        slug,
        projectPath,
        dispatchingSessionId: 'planner-anchor-a',
        phases: 1,
      });
      watchdogService.chainEvent(slug, 'phase-start', { phase: 1 });
      watchdogService.chainEvent(slug, 'completed', { phase: 1 });

      await waitFor(() => resumedProviderSessionId === 'planner-live-z');
      const chain = watchdogDb.listChains().find((row) => row.slug === slug);
      assert.equal(chain?.dispatching_session_id, 'planner-live-z');
      assert.notEqual(resumedProviderSessionId, 'side-chat-zz');
      assert.match(
        await readFile(path.join(journalDirectory, 'JOURNAL.md'), 'utf8'),
        /watchdog \| wake-reroute \| dispatching session planner-anchor-a was dead; updated to live planner planner-live-z/,
      );
    });
  } finally {
    providerRuntimeService.getRunner = originalGetRunner;
    await rm(journalDirectory, { recursive: true, force: true });
  }
});

test('terminal job snapshots retain the runner failure reason', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/failed-job';
    appConfigDb.set('watchdog_terminal_wakes', '0');
    projectsDb.createProjectPath(projectPath);
    watchdogService.registerChain({
      slug: 'failed-job-stub',
      projectPath,
      phases: 1,
      manifest: [{ name: 'Polish jobs', tasks: ['Build', 'Check'], kind: 'phase' }],
    });

    watchdogService.chainEvent('failed-job-stub', 'phase-start', { phase: 1 });
    watchdogService.chainEvent('failed-job-stub', 'failed', {
      phase: 1,
      summaryTail: 'Build command exited 1.',
    });

    const snapshot = watchdogService.listWorkerRuns(projectPath).chains['failed-job-stub'];
    assert.equal(snapshot.manifest?.[0]?.failureReason, 'Build command exited 1.');
  });
});

test('an auto-recovering limit posts a recovery notice without waking a planner', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/recovery-project';
    const messages: string[] = [];
    const notificationClient = {
      readyState: WS_OPEN_STATE,
      send: (message: string) => { messages.push(message); },
    } as unknown as RealtimeClientConnection;
    connectedClients.add(notificationClient);
    appConfigDb.set('watchdog_recovery_notices', '1');
    projectsDb.createProjectPath(projectPath);
    watchdogService.registerChain({
      slug: 'recoverystub',
      projectPath,
      phases: 1,
      manifest: [{ name: 'One', tasks: [], kind: 'phase' }],
    });

    try {
      watchdogService.chainEvent('recoverystub', 'phase-start', { phase: 1 });
      assert.equal(watchdogService.chainEvent('recoverystub', 'limit', {
        phase: 1,
        summaryTail: 'switched account and retrying',
      }), true);

      const notifications = messages
        .map((message) => JSON.parse(message) as { kind?: string; notificationKind?: string; title?: string })
        .filter((message) => message.kind === 'fleet_notification');
      assert.deepEqual(
        notifications.map((message) => [message.notificationKind, message.title]),
        [['recovery', 'Chain recoverystub is auto-recovering']],
      );
      assert.equal(
        notifications.some((message) => message.title?.includes('wake undeliverable')),
        false,
      );
    } finally {
      connectedClients.delete(notificationClient);
    }
  });
});
