import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
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
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

const dispatchPath = path.resolve('scripts/macos/dispatch');
const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');

type Fixture = {
  directory: string;
  repo: string;
  bin: string;
  fakeHome: string;
  database: string;
  serverUrl: string;
  server: ReturnType<express.Application['listen']>;
  requests: Array<{ path: string; body: Record<string, unknown> }>;
  previousDatabasePath: string | undefined;
  previousHome: string | undefined;
};

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function runProcess(
  executablePath: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; output: string }> {
  const child = spawn(executablePath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const [code] = await once(child, 'exit') as [number];
  return { code, output };
}

async function runGit(repo: string, args: string[]): Promise<void> {
  const result = await runProcess('/usr/bin/git', args, { cwd: repo, env: process.env });
  assert.equal(result.code, 0, result.output);
}

async function createFixture(name: string): Promise<Fixture> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHome = process.env.HOME;
  const cleanupDirectory = await mkdtemp(path.join(tmpdir(), `${name}-`));
  const directory = await realpath(cleanupDirectory);
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const fakeHome = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  await Promise.all([
    mkdir(repo),
    mkdir(bin),
    mkdir(path.join(fakeHome, 'forge-logs'), { recursive: true }),
  ]);
  closeConnection();
  process.env.DATABASE_PATH = database;
  process.env.HOME = fakeHome;
  await initializeDatabase();
  const user = userDb.createUser(`${name}-user`, 'unused');
  apiKeysDb.createApiKey(Number(user.id), `${name}-key`);
  projectsDb.createProjectPath(repo);
  appConfigDb.set('watchdog_terminal_wakes', '0');
  sessionsDb.createAppSession(`${name}-planner`, 'codex', repo, `${name} planner`, 'planner');
  sessionsDb.markSessionBooted(`${name}-planner`);
  sessionsDb.setSessionBootState(`${name}-planner`, 'ready');

  const requests: Fixture['requests'] = [];
  const app = express();
  app.use(express.json());
  app.use('/api/watchdog', (req, _res, next) => {
    if (req.path === '/notify' || req.path.endsWith('/events')) {
      requests.push({ path: req.path, body: req.body as Record<string, unknown> });
    }
    next();
  });
  app.use('/api/watchdog', createWatchdogRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  await runGit(repo, ['init', '-q']);
  await runGit(repo, ['config', 'user.email', 'stub@example.com']);
  await runGit(repo, ['config', 'user.name', 'Runner Budget Stub']);
  return {
    directory,
    repo,
    bin,
    fakeHome,
    database,
    serverUrl: `http://127.0.0.1:${address.port}`,
    server,
    requests,
    previousDatabasePath,
    previousHome,
  };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
  await new Promise<void>((resolve) => fixture.server.close(() => resolve()));
  closeConnection();
  if (fixture.previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = fixture.previousDatabasePath;
  if (fixture.previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = fixture.previousHome;
  await rm(fixture.directory, { recursive: true, force: true });
}

function runnerEnvironment(fixture: Fixture, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fixture.fakeHome,
    PATH: `${fixture.bin}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    DISPATCH_SERVER_URL: fixture.serverUrl,
    DISPATCH_DB_PATH: fixture.database,
    DISPATCH_ENGINE: 'claude',
    DISPATCH_MANIFEST: '',
    DISPATCH_MODEL: '',
    DISPATCH_RELOADING: '',
    // The parent process may itself be a dispatch unit. This fixture verifies
    // fresh-run defaults, so it must not inherit that outer chain's identity.
    DISPATCH_RUN_DATE: undefined,
    DISPATCH_RUN_SUMMARY_PATH: undefined,
    DISPATCH_RESUME_FROM: '1',
    DISPATCH_RESUMING: '',
    DISPATCH_VERIFY_ENGINE: 'codex',
    DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
    DISPATCHING_SESSION_ID: '',
    ...extra,
  };
}

function localRunDate(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

test('runner stops a model-turn-heavy unit, dates journal lines, reports an orphan, and exports its run date', {
  skip: process.platform !== 'darwin',
  timeout: 20_000,
}, async () => {
  const fixture = await createFixture('runner-turn-budget');
  const slug = `runner-turn-budget-${Date.now()}`;
  try {
    const phase = path.join(fixture.repo, '01-budget.md');
    const observed = path.join(fixture.directory, 'observed.txt');
    await writeFile(phase, '<!-- name: Budget unit -->\n<!-- tasks: Stop at the ceiling -->\n<!-- verify: no -->\nBUDGET_STUB\n');
    await runGit(fixture.repo, ['add', '.']);
    await runGit(fixture.repo, ['commit', '-q', '-m', 'stub base']);
    const appendDirectory = path.join(fixture.fakeHome, 'forge-logs', slug, 'append');
    await mkdir(appendDirectory, { recursive: true });
    await writeFile(path.join(appendDirectory, 'queued.phase.orphan.md'), '<!-- name: Orphan -->\n<!-- tasks: Remains queued -->\n');

    await executable(path.join(fixture.bin, 'claude'), `#!/bin/zsh
session=""
model=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--session-id" ]]; then session="$2"; shift 2
  elif [[ "$1" == "--model" ]]; then model="$2"; shift 2
  else shift
  fi
done
/bin/mkdir -p "$HOME/.claude/projects/stub"
print -r -- "$model|$DISPATCH_RUN_DATE|$DISPATCH_RUN_SUMMARY_PATH" > "$STUB_OBSERVED"
print -r -- '{"type":"assistant","message":{"content":[]}}' > "$HOME/.claude/projects/stub/$session.jsonl"
print -r -- '{"type":"assistant","message":{"content":[]}}' >> "$HOME/.claude/projects/stub/$session.jsonl"
while true; do /bin/sleep 0.1; done
`);

    const result = await runProcess('/bin/zsh', [runnerPath, fixture.repo, slug, phase], {
      cwd: fixture.repo,
      env: runnerEnvironment(fixture, {
        DISPATCH_UNIT_MODEL_TURN_BUDGET: '1',
        DISPATCH_UNIT_WALL_TIME_BUDGET_SECS: '30',
        STUB_OBSERVED: observed,
      }),
    });
    assert.equal(result.code, 2, result.output);

    const journal = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    const lines = journal.trim().split('\n');
    assert.ok(lines.length >= 4, journal);
    for (const line of lines) assert.match(line, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/);
    assert.match(journal, /passed the 1 model-turn budget \(observed 2 turns\)/);
    assert.match(journal, /Claude unit ended with zero Read tool calls/);
    assert.match(journal, /orphaned-appends \| 1 queued append file remain/);

    const expectedSummary = path.join(
      fixture.fakeHome,
      'Projects',
      'spoton-worker',
      'planner',
      path.basename(fixture.repo),
      'sessions',
      `${localRunDate()}-${slug}-summary.md`,
    );
    assert.equal((await readFile(observed, 'utf8')).trim(), `claude-opus-5|${localRunDate()}|${expectedSummary}`);
    const resume = JSON.parse(await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'resume.json'), 'utf8')) as {
      runDate?: string;
      summaryPath?: string;
    };
    assert.equal(resume.runDate, localRunDate());
    assert.equal(resume.summaryPath, expectedSummary);

    const budgetNotice = fixture.requests.find((request) => request.path === '/notify'
      && request.body.title === `Chain ${slug} stopped on a unit budget`);
    assert.match(String(budgetNotice?.body.body), /Job 1 of 1 .*observed 2 turns/);
    const stoppedEvent = fixture.requests.find((request) => request.path.endsWith('/events')
      && request.body.event === 'stopped');
    assert.equal(stoppedEvent?.body.orphanedAppends, 1);
    assert.match(String(stoppedEvent?.body.summaryTail), /1 queued append file remain/);
    const snapshot = watchdogService.listWorkerRuns(fixture.repo).chains[slug];
    assert.equal(snapshot.status, 'stopped');
    assert.equal(snapshot.orphanedAppends, 1);

    const source = await readFile(runnerPath, 'utf8');
    assert.match(source, /^CLAUDE_DEFAULT_MODEL="claude-opus-5"$/m);
    assert.match(source, /^UNIT_MODEL_TURN_BUDGET=.*160/m);
    assert.match(source, /^UNIT_WALL_TIME_BUDGET_SECS=.*10800/m);

    const timeSlug = `${slug}-time`;
    const timeResult = await runProcess('/bin/zsh', [runnerPath, fixture.repo, timeSlug, phase], {
      cwd: fixture.repo,
      env: runnerEnvironment(fixture, {
        DISPATCH_UNIT_MODEL_TURN_BUDGET: '160',
        DISPATCH_UNIT_WALL_TIME_BUDGET_SECS: '1',
        STUB_OBSERVED: observed,
      }),
    });
    assert.equal(timeResult.code, 2, timeResult.output);
    const timeJournal = await readFile(path.join(fixture.fakeHome, 'forge-logs', timeSlug, 'JOURNAL.md'), 'utf8');
    assert.match(timeJournal, /reached the 1s wall-time budget \(observed \d+s\)/);
  } finally {
    await destroyFixture(fixture);
  }
});

test('runner stops after four limit retries and dispatch validates append, amend, and remanifest metadata', {
  skip: process.platform !== 'darwin',
  timeout: 20_000,
}, async () => {
  const fixture = await createFixture('runner-limit-validation');
  const slug = `runner-limit-validation-${Date.now()}`;
  try {
    const phase = path.join(fixture.repo, '01-limit.md');
    const attempts = path.join(fixture.directory, 'attempts');
    await writeFile(phase, '<!-- name: Limit unit -->\n<!-- tasks: Cap retries -->\n<!-- verify: no -->\nLIMIT_STUB\n');
    await runGit(fixture.repo, ['add', '.']);
    await runGit(fixture.repo, ['commit', '-q', '-m', 'stub base']);
    await executable(path.join(fixture.bin, 'claude'), `#!/bin/zsh
count=0
[[ -f "$STUB_ATTEMPTS" ]] && count=$(<"$STUB_ATTEMPTS")
count=$((count + 1))
print -r -- "$count" > "$STUB_ATTEMPTS"
print -u2 -- "hit your session limit"
exit 1
`);
    await executable(path.join(fixture.bin, 'cswap'), `#!/bin/zsh
if [[ "$1" == list ]]; then
  print -r -- '{"activeAccountNumber":1,"accounts":[{"number":1,"email":"stub@example.com","usage":{"fiveHour":{"pct":10}}}]}'
  exit 0
fi
exit 0
`);

    const result = await runProcess('/bin/zsh', [runnerPath, fixture.repo, slug, phase], {
      cwd: fixture.repo,
      env: runnerEnvironment(fixture, { CSWAP_PATH: path.join(fixture.bin, 'cswap'), STUB_ATTEMPTS: attempts }),
    });
    assert.equal(result.code, 2, result.output);
    assert.equal((await readFile(attempts, 'utf8')).trim(), '4');
    const journal = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    assert.match(journal, /session limit retry cap reached after 4 limit waits/);
    assert.match(journal, /Claude unit ended with zero Read tool calls/);
    const retryNotice = fixture.requests.find((request) => request.path === '/notify'
      && request.body.title === `Chain ${slug} stopped after repeated limit waits`);
    assert.match(String(retryNotice?.body.body), /after 4 limit waits/);

    const badPhase = path.join(fixture.repo, '02-missing-tasks.md');
    await writeFile(badPhase, '<!-- name: Missing tasks -->\n');
    const environment = {
      ...runnerEnvironment(fixture),
      CODEX_THREAD_ID: 'runner-limit-validation-planner',
    };
    const initialRefusal = await runProcess('/bin/zsh', [dispatchPath, fixture.repo, `${slug}-initial`, badPhase], {
      cwd: fixture.repo,
      env: environment,
    });
    assert.equal(initialRefusal.code, 65);

    const appendSlug = `${slug}-append`;
    watchdogService.registerChain({
      slug: appendSlug,
      projectPath: fixture.repo,
      phases: 1,
      manifest: [{ name: 'Existing', tasks: ['Existing task'], kind: 'phase' }],
    });
    const appendRefusal = await runProcess('/bin/zsh', [dispatchPath, 'append', fixture.repo, appendSlug, badPhase], {
      cwd: fixture.repo,
      env: environment,
    });
    assert.equal(appendRefusal.code, 65);
    assert.equal(appendRefusal.output, initialRefusal.output);

    const runtime = path.join(fixture.fakeHome, 'forge-logs', `${slug}-remanifest`);
    await mkdir(runtime, { recursive: true });
    await writeFile(path.join(runtime, 'resume.json'), `${JSON.stringify({ repo: fixture.repo, phaseFiles: [badPhase] })}\n`);
    watchdogService.registerChain({
      slug: `${slug}-remanifest`,
      projectPath: fixture.repo,
      phases: 1,
      manifest: [{ name: 'Old', tasks: ['Old task'], kind: 'phase' }],
    });
    const remanifestRefusal = await runProcess(
      '/bin/zsh',
      [dispatchPath, 'remanifest', fixture.repo, `${slug}-remanifest`],
      { cwd: fixture.repo, env: environment },
    );
    assert.equal(remanifestRefusal.code, 69);
    assert.match(remanifestRefusal.output, /has no tasks/);

    const amendSlug = `${slug}-amend`;
    watchdogService.registerChain({
      slug: amendSlug,
      projectPath: fixture.repo,
      phases: 1,
      manifest: [{ name: 'Queued', tasks: ['Task'], kind: 'phase' }],
    });
    const amendRefusal = await runProcess(
      '/bin/zsh',
      [dispatchPath, 'amend', fixture.repo, amendSlug, '1', '--name', 'x'.repeat(121)],
      { cwd: fixture.repo, env: environment },
    );
    assert.equal(amendRefusal.code, 65);
    assert.match(amendRefusal.output, /amend name is longer than 120 characters/);
  } finally {
    await destroyFixture(fixture);
  }
});
