import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

const dispatchPath = path.resolve('scripts/macos/dispatch');
const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function waitForFile(filePath: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.fail(`file did not appear within ${timeoutMs}ms: ${filePath}`);
}

async function waitForChainStatus(
  repo: string,
  slug: string,
  status: 'running' | 'paused' | 'completed',
  timeoutMs = 8_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (watchdogService.listWorkerRuns(repo).chains[slug]?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`chain ${slug} did not become ${status} within ${timeoutMs}ms`);
}

test('a hold lets the active build commit and verify, then resumes at the next unit', {
  skip: process.platform !== 'darwin',
  timeout: 35_000,
}, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHome = process.env.HOME;
  const cleanupDirectory = await mkdtemp(path.join(tmpdir(), 'hold-at-boundary-'));
  const directory = await realpath(cleanupDirectory);
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const fakeHome = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  const firstBuildStarted = path.join(directory, 'first-build-started');
  const releaseBuild = path.join(directory, 'release-build');
  const verifyStarted = path.join(directory, 'verify-started');
  const releaseVerify = path.join(directory, 'release-verify');
  const secondBuildStarted = path.join(directory, 'second-build-started');
  const slug = `hold-boundary-stub-${Date.now()}`;
  let server: ReturnType<express.Application['listen']> | null = null;
  let runner: ReturnType<typeof spawn> | null = null;

  closeConnection();
  process.env.DATABASE_PATH = database;
  process.env.HOME = fakeHome;
  try {
    await Promise.all([
      mkdir(repo),
      mkdir(bin),
      mkdir(path.join(fakeHome, 'forge-logs'), { recursive: true }),
    ]);
    await initializeDatabase();
    const user = userDb.createUser('hold-boundary-test', 'unused');
    apiKeysDb.createApiKey(Number(user.id), 'hold-boundary-test');
    projectsDb.createProjectPath(repo);
    appConfigDb.set('watchdog_terminal_wakes', '0');

    const app = express();
    app.use(express.json());
    app.use('/api/watchdog', createWatchdogRouter());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    await new Promise<void>((resolve, reject) => {
      const git = spawn('/usr/bin/git', ['init', '-q'], { cwd: repo });
      git.once('error', reject);
      git.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`git init exited ${code}`)));
    });
    for (const [key, value] of [['user.email', 'stub@example.com'], ['user.name', 'Hold Boundary Stub']]) {
      await new Promise<void>((resolve, reject) => {
        const git = spawn('/usr/bin/git', ['config', key, value], { cwd: repo });
        git.once('error', reject);
        git.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`git config exited ${code}`)));
      });
    }

    const phaseOne = path.join(repo, '01-one.md');
    const phaseTwo = path.join(repo, '02-two.md');
    await writeFile(phaseOne, '<!-- name: One -->\nFIRST_BUILD_STUB\n');
    await writeFile(phaseTwo, '<!-- name: Two -->\nSECOND_BUILD_STUB\n');
    await new Promise<void>((resolve, reject) => {
      const git = spawn('/usr/bin/git', ['add', '.'], { cwd: repo });
      git.once('error', reject);
      git.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`git add exited ${code}`)));
    });
    await new Promise<void>((resolve, reject) => {
      const git = spawn('/usr/bin/git', ['commit', '-q', '-m', 'stub base'], { cwd: repo });
      git.once('error', reject);
      git.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`git commit exited ${code}`)));
    });

    await executable(path.join(bin, 'codex'), `#!/bin/zsh
prompt=$(</dev/stdin)
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
stage=build
[[ "$prompt" == *"fresh-context verifier"* ]] && stage=verify
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"hold-$stage-$$\\"}"
if [[ "$stage" == verify ]]; then
  if [[ "$prompt" == *"FIRST_BUILD_STUB"* ]]; then
    : > "$STUB_VERIFY_STARTED"
    while [[ ! -f "$STUB_RELEASE_VERIFY" ]]; do /bin/sleep 0.05; done
  fi
  print -r -- "VERIFY: PASS" > "$output"
  exit 0
fi
if [[ "$prompt" == *"FIRST_BUILD_STUB"* ]]; then
  : > "$STUB_FIRST_BUILD_STARTED"
  while [[ ! -f "$STUB_RELEASE_BUILD" ]]; do /bin/sleep 0.05; done
  /usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub job one"
else
  : > "$STUB_SECOND_BUILD_STARTED"
  /usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub job two"
fi
print -r -- "done" > "$output"
`);

    const environment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      DISPATCH_SERVER_URL: serverUrl,
      DISPATCH_DB_PATH: database,
      DISPATCH_ENGINE: 'codex',
      DISPATCH_MANIFEST: '',
      DISPATCH_MODEL: 'gpt-test-build',
      DISPATCH_RELOADING: '',
      DISPATCH_RESUME_FROM: '1',
      DISPATCH_RESUMING: '',
      DISPATCH_VERIFY_ENGINE: 'codex',
      DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
      DISPATCHING_SESSION_ID: '',
      STUB_FIRST_BUILD_STARTED: firstBuildStarted,
      STUB_RELEASE_BUILD: releaseBuild,
      STUB_RELEASE_VERIFY: releaseVerify,
      STUB_REPO: repo,
      STUB_SECOND_BUILD_STARTED: secondBuildStarted,
      STUB_VERIFY_STARTED: verifyStarted,
    } as NodeJS.ProcessEnv;

    watchdogService.registerChain({
      slug,
      projectPath: repo,
      phases: 2,
      manifest: [
        { name: 'One', tasks: [], kind: 'phase' },
        { name: 'Two', tasks: [], kind: 'phase' },
      ],
    });
    runner = spawn('/bin/zsh', [runnerPath, repo, slug, phaseOne, phaseTwo], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let runnerOutput = '';
    runner.stdout?.on('data', (chunk) => { runnerOutput += String(chunk); });
    runner.stderr?.on('data', (chunk) => { runnerOutput += String(chunk); });

    await waitForFile(firstBuildStarted);
    const hold = spawn('/bin/zsh', [dispatchPath, 'hold', repo, slug], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let holdOutput = '';
    hold.stdout?.on('data', (chunk) => { holdOutput += String(chunk); });
    hold.stderr?.on('data', (chunk) => { holdOutput += String(chunk); });
    const holdExit = (await once(hold, 'exit') as [number])[0];
    assert.equal(holdExit, 0, holdOutput);
    assert.match(holdOutput, /will hold after its current job commits and verifies/);
    assert.equal(watchdogService.listWorkerRuns(repo).chains[slug]?.phaseActive, true);

    await writeFile(releaseBuild, 'commit\n');
    await waitForFile(verifyStarted);
    assert.equal(watchdogService.listWorkerRuns(repo).chains[slug]?.status, 'running');
    await writeFile(releaseVerify, 'pass\n');
    const runnerExit = runner.exitCode ?? (await once(runner, 'exit') as [number])[0];
    runner = null;
    assert.equal(runnerExit, 0, runnerOutput);
    await waitForChainStatus(repo, slug, 'paused');

    const held = watchdogService.listWorkerRuns(repo).chains[slug];
    assert.equal(held.holdReason, 'promote');
    assert.equal(held.currentPhase, 1);
    assert.equal(held.manifest?.[0]?.commitSubject, 'stub job one');
    assert.equal(held.manifest?.[0]?.verify, 'passed');
    const journalPath = path.join(fakeHome, 'forge-logs', slug, 'JOURNAL.md');
    const journal = await readFile(journalPath, 'utf8');
    assert.ok(journal.indexOf('phase 1/2 | end') < journal.indexOf('verify 1/2 | end | PASS'));
    assert.ok(journal.indexOf('verify 1/2 | end | PASS') < journal.indexOf('run | HELD | promote'));
    assert.doesNotMatch(journal, /PAUSED|parked/);

    const release = spawn('/bin/zsh', [dispatchPath, 'release-hold', repo, slug], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let releaseOutput = '';
    release.stdout?.on('data', (chunk) => { releaseOutput += String(chunk); });
    release.stderr?.on('data', (chunk) => { releaseOutput += String(chunk); });
    const releaseExit = (await once(release, 'exit') as [number])[0];
    assert.equal(releaseExit, 0, releaseOutput);
    assert.match(releaseOutput, /resumed at job 2/);
    await waitForFile(secondBuildStarted);
    await waitForChainStatus(repo, slug, 'completed');
    const finalJournal = await readFile(journalPath, 'utf8');
    assert.match(finalJournal, /phase 2\/2 \| start/);
    assert.match(finalJournal, /all 2 phases committed and verified/);

    const status = await new Promise<string>((resolve, reject) => {
      const git = spawn('/usr/bin/git', ['status', '--porcelain'], { cwd: repo });
      let output = '';
      git.stdout.on('data', (chunk) => { output += String(chunk); });
      git.once('error', reject);
      git.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`git status exited ${code}`)));
    });
    assert.equal(status, '');
  } finally {
    if (runner && runner.exitCode === null) {
      runner.kill('SIGTERM');
      await once(runner, 'exit').catch(() => undefined);
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(cleanupDirectory, { recursive: true, force: true });
  }
});
