import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, projectsDb } from '@/modules/database/index.js';
import { watchdogService } from '@/modules/watchdog/index.js';

/**
 * Resume from the worker pane header (audit1 job 8). The state flip alone
 * would leave a chain marked running with no runner behind it, so the app's
 * resume also starts one — and refuses, with the chain left paused, whenever
 * `dispatch resume` would have refused.
 */

type Harness = {
  repo: string;
  slug: string;
  runnerRoot: string;
  runnerMarker: string;
  journal: string;
};

async function withHarness(runTest: (harness: Harness) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousRepo = process.env.COMMAND_CENTER_REPO;
  const temp = await mkdtemp(path.join(tmpdir(), 'resume-from-app-'));
  const slug = `resume-app-${process.pid}-${Date.now()}`;
  const journal = path.join(homedir(), 'forge-logs', slug);
  const repo = path.join(temp, 'repo');
  const runnerRoot = path.join(temp, 'command-center');
  const runnerMarker = path.join(temp, 'runner-started.txt');

  await mkdir(repo, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init']);

  await mkdir(path.join(runnerRoot, 'scripts', 'macos'), { recursive: true });
  const runner = path.join(runnerRoot, 'scripts', 'macos', 'dispatch-chain-runner');
  await writeFile(
    runner,
    `#!/bin/sh\nprintf '%s\\n' "$DISPATCH_RESUME_FROM $DISPATCH_RESUMING $DISPATCH_ENGINE $*" > ${JSON.stringify(runnerMarker)}\n`,
    'utf8',
  );
  await chmod(runner, 0o755);

  closeConnection();
  process.env.DATABASE_PATH = path.join(temp, 'auth.db');
  process.env.COMMAND_CENTER_REPO = runnerRoot;
  await initializeDatabase();
  try {
    await runTest({ repo, slug, runnerRoot, runnerMarker, journal });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousRepo === undefined) delete process.env.COMMAND_CENTER_REPO;
    else process.env.COMMAND_CENTER_REPO = previousRepo;
    await rm(temp, { recursive: true, force: true });
    await rm(journal, { recursive: true, force: true });
  }
}

async function pausedChain(harness: Harness, phaseFile: string): Promise<void> {
  projectsDb.createProjectPath(harness.repo);
  watchdogService.registerChain({
    slug: harness.slug,
    projectPath: harness.repo,
    phases: 1,
    manifest: [{ name: 'One', tasks: ['first'], kind: 'phase' }],
  });
  watchdogService.chainEvent(harness.slug, 'phase-start', { phase: 1 });
  watchdogService.chainEvent(harness.slug, 'paused', { phase: 1 });
  await mkdir(harness.journal, { recursive: true });
  await writeFile(
    path.join(harness.journal, 'resume.json'),
    JSON.stringify({
      repo: harness.repo,
      slug: harness.slug,
      runDate: '20260905',
      engine: 'claude',
      model: '',
      effort: 'high',
      verifyEngine: 'claude',
      verifyModel: '',
      phaseFiles: [phaseFile],
    }),
    'utf8',
  );
}

test('resume from the app starts the runner at the resumed job', async () => {
  await withHarness(async (harness) => {
    const phaseFile = path.join(harness.repo, 'phase1.md');
    await writeFile(phaseFile, 'stub phase', 'utf8');
    execFileSync('git', ['-C', harness.repo, 'add', '-A']);
    execFileSync('git', ['-C', harness.repo, 'commit', '-q', '-m', 'phase file']);
    await pausedChain(harness, phaseFile);

    const launched = watchdogService.resumeChainRunner(harness.slug, harness.repo);

    assert.equal(launched.ok, true);
    assert.equal(watchdogService.listWorkerRuns(harness.repo).chains[harness.slug].status, 'running');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(existsSync(harness.runnerMarker), true);
    const argv = await readFile(harness.runnerMarker, 'utf8');
    assert.match(argv, /^1 1 claude /);
    assert.match(argv, new RegExp(`${harness.slug} `));
    assert.match(argv, /phase1\.md/);
  });
});

test('a dirty repo is refused in words and the chain stays paused', async () => {
  await withHarness(async (harness) => {
    const phaseFile = path.join(harness.repo, 'phase1.md');
    await writeFile(phaseFile, 'stub phase', 'utf8');
    execFileSync('git', ['-C', harness.repo, 'add', '-A']);
    execFileSync('git', ['-C', harness.repo, 'commit', '-q', '-m', 'phase file']);
    await pausedChain(harness, phaseFile);
    await writeFile(path.join(harness.repo, 'wip.txt'), 'uncommitted', 'utf8');

    const launched = watchdogService.resumeChainRunner(harness.slug, harness.repo);

    assert.equal(launched.ok, false);
    assert.match(launched.ok ? '' : launched.reason, /uncommitted work/);
    assert.equal(watchdogService.listWorkerRuns(harness.repo).chains[harness.slug].status, 'paused');
    assert.equal(existsSync(harness.runnerMarker), false);
  });
});

test('a missing saved runner state is refused and never flips the chain', async () => {
  await withHarness(async (harness) => {
    const phaseFile = path.join(harness.repo, 'phase1.md');
    await writeFile(phaseFile, 'stub phase', 'utf8');
    execFileSync('git', ['-C', harness.repo, 'add', '-A']);
    execFileSync('git', ['-C', harness.repo, 'commit', '-q', '-m', 'phase file']);
    await pausedChain(harness, phaseFile);
    await rm(path.join(harness.journal, 'resume.json'));

    const launched = watchdogService.resumeChainRunner(harness.slug, harness.repo);

    assert.equal(launched.ok, false);
    assert.match(launched.ok ? '' : launched.reason, /no saved runner state/);
    assert.equal(watchdogService.listWorkerRuns(harness.repo).chains[harness.slug].status, 'paused');
  });
});

test('a phase file that no longer exists is refused', async () => {
  await withHarness(async (harness) => {
    await pausedChain(harness, path.join(harness.repo, 'gone.md'));

    const launched = watchdogService.resumeChainRunner(harness.slug, harness.repo);

    assert.equal(launched.ok, false);
    assert.match(launched.ok ? '' : launched.reason, /missing phase file/);
    assert.equal(watchdogService.listWorkerRuns(harness.repo).chains[harness.slug].status, 'paused');
  });
});
