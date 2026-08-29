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
  userDb,
  watchdogDb,
} from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');
const dispatchPath = path.resolve('scripts/macos/dispatch');

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

test('fast mode switches between build units while every verifier stays standard', {
  skip: process.platform !== 'darwin',
  timeout: 30_000,
}, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const cleanupDirectory = await mkdtemp(path.join(tmpdir(), 'chain-fast-mode-'));
  const directory = await realpath(cleanupDirectory);
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const fakeHome = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  const calls = path.join(directory, 'codex-calls.log');
  const firstStarted = path.join(directory, 'first-started');
  const releaseFirst = path.join(directory, 'release-first');
  const slug = `fast-stub-${Date.now()}`;
  const messages: string[] = [];
  const notificationClient = {
    readyState: WS_OPEN_STATE,
    send: (message: string) => { messages.push(message); },
  } as unknown as RealtimeClientConnection;
  let server: ReturnType<express.Application['listen']> | null = null;
  let runner: ReturnType<typeof spawn> | null = null;

  closeConnection();
  process.env.DATABASE_PATH = database;
  try {
    await Promise.all([mkdir(repo), mkdir(bin), mkdir(path.join(fakeHome, 'forge-logs'), { recursive: true })]);
    await initializeDatabase();
    const user = userDb.createUser('fast-test', 'unused');
    const apiKey = apiKeysDb.createApiKey(Number(user.id), 'fast-test').apiKey;
    projectsDb.createProjectPath(repo);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    connectedClients.add(notificationClient);

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
    for (const [key, value] of [['user.email', 'stub@example.com'], ['user.name', 'Fast Stub']]) {
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
args="$*"
stage=build
[[ "$prompt" == *"fresh-context verifier"* ]] && stage=verify
print -r -- "$stage|$args" >> "$STUB_CALLS"
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
thread="stub-$stage-$$"
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"$thread\\"}"
if [[ "$stage" == verify ]]; then
  print -r -- "VERIFY: PASS" > "$output"
  exit 0
fi
if [[ "$prompt" == *"FIRST_BUILD_STUB"* ]]; then
  : > "$STUB_FIRST_STARTED"
  tries=0
  while [[ ! -f "$STUB_RELEASE_FIRST" && $tries -lt 200 ]]; do
    /bin/sleep 0.05
    tries=$((tries + 1))
  done
  [[ -f "$STUB_RELEASE_FIRST" ]] || exit 9
fi
/usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub $stage $thread"
print -r -- "done" > "$output"
`);

    watchdogService.registerChain({
      slug,
      projectPath: repo,
      phases: 2,
      manifest: [
        { name: 'One', tasks: [], kind: 'phase' },
        { name: 'Two', tasks: [], kind: 'phase' },
      ],
    });
    assert.equal(watchdogService.chainFastMode(slug, repo), false);

    const environment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      DISPATCH_SERVER_URL: serverUrl,
      DISPATCH_DB_PATH: database,
      DISPATCH_ENGINE: 'codex',
      DISPATCH_MODEL: 'gpt-test-build',
      DISPATCH_VERIFY_ENGINE: 'codex',
      DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
      DISPATCH_RESUME_FROM: '1',
      DISPATCH_RESUMING: '',
      STUB_CALLS: calls,
      STUB_FIRST_STARTED: firstStarted,
      STUB_RELEASE_FIRST: releaseFirst,
      STUB_REPO: repo,
    } as NodeJS.ProcessEnv;

    runner = spawn('/bin/zsh', [runnerPath, repo, slug, phaseOne, phaseTwo], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    runner.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    runner.stderr?.on('data', (chunk) => { stderr += String(chunk); });

    await waitForFile(firstStarted);
    assert.equal(
      watchdogService.listWorkerRuns(repo).chains[slug]?.manifest?.[0]?.fastMode,
      false,
      'turning fast on during Job 1 must not rewrite its launch tier',
    );

    const cli = spawn('/bin/zsh', [dispatchPath, 'fast', repo, slug, 'on'], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let cliOutput = '';
    cli.stdout?.on('data', (chunk) => { cliOutput += String(chunk); });
    const [cliExit] = await once(cli, 'exit') as [number];
    assert.equal(cliExit, 0);
    assert.match(cliOutput, /fast mode on; the next Codex job reads the new setting/);
    assert.equal(watchdogService.chainFastMode(slug, repo), true);
    assert.equal(watchdogDb.listChains().find((row) => row.slug === slug)?.fast_mode, 1);
    assert.equal(messages.some((message) => {
      const event = JSON.parse(message) as { kind?: string; chain?: { slug?: string; fastMode?: boolean } };
      return event.kind === 'chain_progress' && event.chain?.slug === slug && event.chain.fastMode === true;
    }), true, 'the route broadcasts the changed chain snapshot');

    await writeFile(releaseFirst, 'go\n');
    const [runnerExit] = await once(runner, 'exit') as [number];
    assert.equal(runnerExit, 0, `runner stderr: ${stderr}\nrunner stdout: ${stdout}`);
    runner = null;

    const launchLines = (await readFile(calls, 'utf8')).trim().split('\n');
    const builds = launchLines.filter((line) => line.startsWith('build|'));
    const verifies = launchLines.filter((line) => line.startsWith('verify|'));
    assert.equal(builds.length, 2);
    assert.match(builds[0], /service_tier=default/);
    assert.match(builds[1], /service_tier=fast/);
    assert.equal(verifies.length, 2);
    for (const verify of verifies) {
      assert.match(verify, /service_tier=default/);
      assert.doesNotMatch(verify, /service_tier=fast/);
    }

    const journal = await readFile(path.join(fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    assert.match(journal, /phase 2\/2 \| start \| 02-two\.md \(codex gpt-test-build, effort high, fast\)/);
    assert.match(journal, /phase 2\/2 \| fast-confirmed \| rollout stub-build-/);
    assert.doesNotMatch(journal, /verify \d+\/2 \| start \| .*fast/);

    const snapshot = watchdogService.listWorkerRuns(repo).chains[slug];
    assert.equal(snapshot.fastMode, true);
    assert.equal(snapshot.manifest?.[0]?.fastMode, false);
    assert.equal(snapshot.manifest?.[1]?.fastMode, true);
    assert.equal(snapshot.manifest?.[0]?.verify, 'passed');
    assert.equal(snapshot.manifest?.[1]?.verify, 'passed');
  } finally {
    if (runner && runner.exitCode === null) {
      await writeFile(releaseFirst, 'cleanup\n').catch(() => undefined);
      await Promise.race([
        once(runner, 'exit'),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]).catch(() => undefined);
      if (runner.exitCode === null) {
        runner.kill('SIGTERM');
        await once(runner, 'exit').catch(() => undefined);
      }
    }
    connectedClients.delete(notificationClient);
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(cleanupDirectory, { recursive: true, force: true });
  }
});
