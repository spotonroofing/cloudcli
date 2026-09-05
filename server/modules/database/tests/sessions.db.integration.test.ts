import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { projectsDb } from '@/modules/database/repositories/projects.db.js';
import { sessionsDb } from '@/modules/database/repositories/sessions.db.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'sessions-db-'));
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

test('session archive queries hide archived rows from active project views', async () => {
  await withIsolatedDatabase(() => {
    projectsDb.createProjectPath('/workspace/demo-project');
    sessionsDb.createSession('session-active', 'claude', '/workspace/demo-project', 'Active Session', undefined, undefined, null, null);
    sessionsDb.createSession('session-archived', 'claude', '/workspace/demo-project', 'Archived Session', undefined, undefined, null, null);
    sessionsDb.updateSessionIsArchived('session-archived', true);

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const activeProjectSessions = sessionsDb.getSessionsByProjectPath('/workspace/demo-project');
    const allProjectSessions = sessionsDb.getSessionsByProjectPathIncludingArchived('/workspace/demo-project');

    assert.deepEqual(activeSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(archivedSessions.map((session) => session.session_id), ['session-archived']);
    assert.deepEqual(activeProjectSessions.map((session) => session.session_id), ['session-active']);
    assert.deepEqual(
      allProjectSessions.map((session) => session.session_id).sort(),
      ['session-active', 'session-archived'],
    );
    assert.equal(sessionsDb.countSessionsByProjectPath('/workspace/demo-project'), 1);
  });
});

test('discovery never creates project rows: unknown cwd lands project-less', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-foreign', 'claude', '/some/novel/cwd', 'Discovered');

    assert.equal(projectsDb.getProjectPath('/some/novel/cwd'), null);
    assert.equal(sessionsDb.getSessionById('session-foreign')?.project_path, null);
    // Discovery created the row, so it defaults to the external origin.
    assert.equal(sessionsDb.getSessionById('session-foreign')?.origin, 'external');

    // A cwd matching an archived project keeps the association but must not
    // reactivate the archived row.
    projectsDb.createProjectPath('/workspace/dormant');
    projectsDb.updateProjectIsArchived('/workspace/dormant', true);
    sessionsDb.createSession('session-dormant', 'claude', '/workspace/dormant', 'Discovered');

    assert.equal(sessionsDb.getSessionById('session-dormant')?.project_path, '/workspace/dormant');
    assert.equal(projectsDb.getProjectPath('/workspace/dormant')?.isArchived, 1);
  });
});

test('createSession reactivates archived rows when the session becomes active again', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'First Name');
    sessionsDb.updateSessionIsArchived('session-reused', true);

    sessionsDb.createSession('session-reused', 'claude', '/workspace/demo-project', 'Updated Name');

    const activeSessions = sessionsDb.getAllSessions();
    const archivedSessions = sessionsDb.getArchivedSessions();
    const restoredSession = sessionsDb.getSessionById('session-reused');

    assert.equal(activeSessions.length, 1);
    assert.equal(activeSessions[0]?.session_id, 'session-reused');
    assert.equal(activeSessions[0]?.custom_name, 'Updated Name');
    assert.equal(archivedSessions.length, 0);
    assert.equal(restoredSession?.isArchived, 0);
  });
});

test('repository reads normalize SQLite UTC timestamps to ISO strings', async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('session-timezone', 'claude', '/workspace/demo-project');

    const row = sessionsDb.getSessionById('session-timezone');
    assert.ok(row?.created_at.endsWith('Z'));
    assert.ok(row?.updated_at.endsWith('Z'));
    assert.match(row?.created_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.match(row?.updated_at ?? '', /^\d{4}-\d{2}-\d{2}T/);
  });
});

test('watchdog wake resolution follows the dispatching planner lineage and ignores side-chat activity', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/wake-lineage';
    projectsDb.createProjectPath(projectPath);
    sessionsDb.createAppSession('planner-a', 'claude', projectPath, 'Planner A', 'planner');
    sessionsDb.createAppSession('side-chat-b', 'claude', projectPath, 'Side chat B', null);
    sessionsDb.createAppSession('direct-worker', 'claude', projectPath, 'Direct worker', 'direct');
    sessionsDb.setWatchdogWakeTarget('planner-a');

    assert.equal(sessionsDb.setWatchdogWakeTarget('direct-worker'), null);
    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath)?.session_id,
      'planner-a',
      'worker rows cannot become the project chat wake target',
    );

    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath, 'planner-a')?.session_id,
      'planner-a',
      'a side chat does not steal a chain wake from its dispatching planner',
    );

    sessionsDb.createAppSession('planner-a2', 'claude', projectPath, 'Planner A2', 'planner');
    assert.equal(sessionsDb.setSessionPredecessor('planner-a2', 'planner-a'), true);
    sessionsDb.setWatchdogWakeTarget('planner-a2');

    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath, 'planner-a')?.session_id,
      'planner-a2',
      'a chain wake follows the handoff successor',
    );

    sessionsDb.setWatchdogWakeTarget('side-chat-b');
    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath)?.session_id,
      'side-chat-b',
      'an unanchored wake uses the manual project target',
    );
    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath, 'planner-a')?.session_id,
      'planner-a2',
      'moving the project target does not redirect an existing chain lineage',
    );

    sessionsDb.createAppSession('planner-failed', 'claude', projectPath, 'Failed successor', 'planner');
    sessionsDb.setSessionPredecessor('planner-failed', 'planner-a2');
    sessionsDb.setSessionBootState('planner-failed', 'failed');
    assert.equal(
      sessionsDb.resolveWatchdogWakeSession(projectPath, 'planner-a')?.session_id,
      'planner-a2',
      'a failed successor never receives a wake',
    );
  });
});

test('recent sessions are globally ordered, paginated, and limited to visible conversations', async () => {
  await withIsolatedDatabase(() => {
    projectsDb.createProjectPath('/workspace/project-a');
    projectsDb.createProjectPath('/workspace/project-b');
    projectsDb.createProjectPath('/workspace/project-hidden');
    // Discovered app-run transcripts (the synchronizer's honest marker) index
    // with a null origin so they stay visible as conversations.
    const fixtures: Array<Parameters<typeof sessionsDb.createSession>> = [
      ['session-oldest', 'claude', '/workspace/project-a', 'Oldest', '2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z', null, null],
      ['session-newest', 'codex', '/workspace/project-b', 'Newest', '2026-07-18T11:00:00.000Z', '2026-07-18T12:00:00.900Z', null, null],
      ['session-same-second', 'claude', '/workspace/project-a', 'Same second, slightly older', '2026-07-18T12:00:00.000Z', '2026-07-18T12:00:00.100Z', null, null],
      ['session-middle', 'claude', '/workspace/project-a', 'Middle', '2026-07-18T10:00:00.000Z', '2026-07-18T11:00:00.000Z', null, null],
      ['session-archived', 'claude', '/workspace/project-a', 'Archived session', '2026-07-18T13:00:00.000Z', '2026-07-18T13:00:00.000Z', null, null],
      ['session-hidden-project', 'claude', '/workspace/project-hidden', 'Archived project session', '2026-07-18T14:00:00.000Z', '2026-07-18T14:00:00.000Z', null, null],
    ];
    fixtures.forEach((fixture) => sessionsDb.createSession(...fixture));

    sessionsDb.updateSessionIsArchived('session-archived', true);
    projectsDb.updateProjectIsArchived('/workspace/project-hidden', true);

    // Machine-started runs (worker pane 'direct', dispatched 'dispatch',
    // terminal-launched 'external') never appear in the recent-conversations
    // feed; planner chats do.
    sessionsDb.createSession('session-worker', 'claude', '/workspace/project-a', 'Worker run', '2026-07-18T15:00:00.000Z', '2026-07-18T15:00:00.000Z');
    sessionsDb.setSessionOrigin('session-worker', 'direct');
    sessionsDb.createSession('session-dispatched', 'claude', '/workspace/project-a', 'Dispatched run', '2026-07-18T16:00:00.000Z', '2026-07-18T16:00:00.000Z');
    sessionsDb.setSessionOrigin('session-dispatched', 'dispatch');
    sessionsDb.createSession('session-terminal', 'claude', '/workspace/project-a', 'Terminal chain run', '2026-07-18T17:00:00.000Z', '2026-07-18T17:00:00.000Z');
    sessionsDb.createSession('session-planner', 'claude', '/workspace/project-a', 'Planner chat', '2026-07-17T09:00:00.000Z', '2026-07-17T09:00:00.000Z');
    sessionsDb.setSessionOrigin('session-planner', 'planner');

    // The discovery-created terminal run is external: hidden from the feed and
    // the project chat list, surfaced by the worker pane's run switcher.
    assert.equal(sessionsDb.getSessionById('session-terminal')?.origin, 'external');
    assert.ok(
      !sessionsDb
        .getSessionsByProjectPathPage('/workspace/project-a', 50, 0)
        .some((session) => session.session_id === 'session-terminal'),
    );
    assert.ok(
      sessionsDb
        .listWorkerSessions('/workspace/project-a', 10)
        .some((session) => session.session_id === 'session-terminal'),
    );

    const firstPage = sessionsDb.getRecentSessionsPage(2, 0);
    const secondPage = sessionsDb.getRecentSessionsPage(2, 2);
    const thirdPage = sessionsDb.getRecentSessionsPage(2, 4);

    assert.equal(firstPage.total, 5);
    assert.deepEqual(
      firstPage.sessions.map((session) => session.session_id),
      ['session-newest', 'session-same-second'],
    );
    assert.equal(secondPage.total, 5);
    assert.deepEqual(
      secondPage.sessions.map((session) => session.session_id),
      ['session-middle', 'session-oldest'],
    );
    assert.deepEqual(
      thirdPage.sessions.map((session) => session.session_id),
      ['session-planner'],
    );
  });
});

test('worker history cursor-pages all 130 sessions with an exact total', async () => {
  await withIsolatedDatabase(() => {
    const projectPath = '/workspace/worker-history';
    projectsDb.createProjectPath(projectPath);
    for (let index = 0; index < 130; index += 1) {
      const sessionId = `worker-${String(index).padStart(3, '0')}`;
      const timestamp = new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString();
      sessionsDb.createSession(sessionId, 'claude', projectPath, sessionId, timestamp, timestamp);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = sessionsDb.listWorkerSessionsPage(projectPath, 50, cursor);
      assert.equal(page.total, 130);
      assert.ok(page.sessions.length > 0 && page.sessions.length <= 50);
      seen.push(...page.sessions.map((session) => session.session_id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.equal(seen.length, 130);
    assert.equal(new Set(seen).size, 130);
    assert.equal(seen[0], 'worker-129');
    assert.equal(seen.at(-1), 'worker-000');
  });
});
