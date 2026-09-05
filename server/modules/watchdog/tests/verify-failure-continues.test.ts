import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  notificationPreferencesDb,
  projectsDb,
  userDb,
} from '@/modules/database/index.js';
import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

const sourceRunnerPath = path.resolve('scripts/macos/dispatch-chain-runner');
const sourceDispatchPath = path.resolve('scripts/macos/dispatch');
const sourcePhaseTailPath = path.resolve('scripts/macos/phase-tail/v1.md');
const sourceRuntimeAnchorsPath = path.resolve('shared/runtime-anchors.js');

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function runGit(repo: string, args: string[]): Promise<string> {
  const process = spawn('/usr/bin/git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  process.stdout?.on('data', (chunk) => { stdout += String(chunk); });
  process.stderr?.on('data', (chunk) => { stderr += String(chunk); });
  const [exitCode] = await once(process, 'exit') as [number];
  assert.equal(exitCode, 0, `git ${args.join(' ')} failed: ${stderr}`);
  return stdout.trim();
}

test('a boundary reload runs new code and a later failed verify still notifies while the chain continues', {
  skip: process.platform !== 'darwin',
  timeout: 30_000,
}, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousHome = process.env.HOME;
  const cleanupDirectory = await mkdtemp(path.join(tmpdir(), 'verify-failure-continues-'));
  const directory = await realpath(cleanupDirectory);
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const fakeHome = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  const calls = path.join(directory, 'codex-calls.log');
  const firstBuildStarted = path.join(directory, 'first-build-started');
  const releaseFirstBuild = path.join(directory, 'release-first-build');
  const runnerRoot = path.join(directory, 'runner-root');
  const runnerPath = path.join(runnerRoot, 'scripts', 'macos', 'dispatch-chain-runner');
  const slug = `verify-failure-stub-${Date.now()}`;
  const messages: string[] = [];
  const notificationClient = {
    readyState: WS_OPEN_STATE,
    send: (message: string) => { messages.push(message); },
  } as unknown as RealtimeClientConnection;
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
      mkdir(path.dirname(runnerPath), { recursive: true }),
      mkdir(path.join(runnerRoot, 'scripts', 'macos', 'phase-tail'), { recursive: true }),
      mkdir(path.join(runnerRoot, 'shared'), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(sourceRunnerPath, runnerPath),
      copyFile(sourceDispatchPath, path.join(runnerRoot, 'scripts', 'macos', 'dispatch')),
      copyFile(sourcePhaseTailPath, path.join(runnerRoot, 'scripts', 'macos', 'phase-tail', 'v1.md')),
      copyFile(sourceRuntimeAnchorsPath, path.join(runnerRoot, 'shared', 'runtime-anchors.js')),
    ]);
    await Promise.all([
      chmod(runnerPath, 0o755),
      chmod(path.join(runnerRoot, 'scripts', 'macos', 'dispatch'), 0o755),
    ]);
    await initializeDatabase();
    const user = userDb.createUser('verify-failure-test', 'unused');
    notificationPreferencesDb.updatePreferences(Number(user.id), {
      channels: { inApp: true, webPush: false, desktop: false, sound: false },
      events: { actionRequired: true, stop: true, error: true },
    });
    apiKeysDb.createApiKey(Number(user.id), 'verify-failure-test');
    projectsDb.createProjectPath(repo);
    // The terminal fleet notification carries the same payload queued for a
    // planner wake; disabling delivery keeps this runner regression hermetic.
    appConfigDb.set('watchdog_terminal_wakes', '0');
    connectedClients.add(notificationClient);

    const app = express();
    app.use(express.json());
    app.use('/api/watchdog', createWatchdogRouter());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    await runGit(repo, ['init', '-q']);
    await runGit(repo, ['config', 'user.email', 'stub@example.com']);
    await runGit(repo, ['config', 'user.name', 'Verify Failure Stub']);
    const phaseOne = path.join(repo, '01-one.md');
    const phaseTwo = path.join(repo, '02-two.md');
    const phaseThree = path.join(repo, '03-three.md');
    const punchlist = path.join(repo, 'PUNCHLIST_fixture.md');
    await writeFile(punchlist, '## Job 16 — One\n\n- [x] Previously complete\n');
    await writeFile(phaseOne, '<!-- name: One -->\nExecute Job 16 of PUNCHLIST_fixture.md in this repo.\nFIRST_BUILD_STUB\n');
    await writeFile(phaseTwo, '<!-- name: Two -->\nSECOND_BUILD_STUB\n');
    await writeFile(phaseThree, '<!-- name: Three -->\nTHIRD_BUILD_STUB\n');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-q', '-m', 'stub base']);

    await executable(path.join(bin, 'codex'), `#!/bin/zsh
prompt=$(</dev/stdin)
stage=build
[[ "$prompt" == *"fresh-context verifier"* ]] && stage=verify
unit=unknown
if [[ "$stage" == verify ]]; then
  [[ "$prompt" == *"job 1 of 3 (One)"* ]] && unit=one
  [[ "$prompt" == *"job 2 of 3 (Two)"* ]] && unit=two
  [[ "$prompt" == *"job 3 of 3 (Three)"* ]] && unit=three
else
  [[ "$prompt" == *"FIRST_BUILD_STUB"* ]] && unit=one
  [[ "$prompt" == *"SECOND_BUILD_STUB"* ]] && unit=two
  [[ "$prompt" == *"THIRD_BUILD_STUB"* ]] && unit=three
fi
output=""
model=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then
    output="$2"; shift 2
  elif [[ "$1" == "-m" ]]; then
    model="$2"; shift 2
  else
    shift
  fi
done
print -r -- "$stage|$unit|$model" >> "$STUB_CALLS"
thread="stub-$stage-$unit-$$"
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"$thread\\"}"
if [[ "$stage" == verify ]]; then
  if [[ "$unit" == two ]]; then
    print -r -- "VERIFY: FAIL: second unit missed its budget" > "$output"
  else
    print -r -- "VERIFY: PASS" > "$output"
  fi
  exit 0
fi
if [[ "$unit" == one ]]; then
  : > "$STUB_FIRST_BUILD_STARTED"
  while [[ ! -f "$STUB_RELEASE_FIRST_BUILD" ]]; do /bin/sleep 0.05; done
fi
/usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub build $unit"
print -r -- "done" > "$output"
`);

    watchdogService.registerChain({
      slug,
      projectPath: repo,
      phases: 3,
      manifest: [
        { name: 'One', tasks: [], kind: 'phase' },
        { name: 'Two', tasks: [], kind: 'phase' },
        { name: 'Three', tasks: [], kind: 'phase' },
      ],
    });

    const environment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      DISPATCH_SERVER_URL: serverUrl,
      DISPATCH_DB_PATH: database,
      DISPATCH_ENGINE: 'codex',
      DISPATCH_MANIFEST: '',
      DISPATCH_MODEL: '',
      DISPATCH_RELOADING: '',
      DISPATCH_VERIFY_ENGINE: 'codex',
      DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
      DISPATCH_RESUME_FROM: '1',
      DISPATCH_RESUMING: '',
      DISPATCHING_SESSION_ID: '',
      STUB_CALLS: calls,
      STUB_FIRST_BUILD_STARTED: firstBuildStarted,
      STUB_RELEASE_FIRST_BUILD: releaseFirstBuild,
      STUB_REPO: repo,
    } as NodeJS.ProcessEnv;

    runner = spawn('/bin/zsh', [runnerPath, repo, slug, phaseOne, phaseTwo, phaseThree], {
      cwd: repo,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    runner.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    runner.stderr?.on('data', (chunk) => { stderr += String(chunk); });

    const editDeadline = Date.now() + 5_000;
    while (Date.now() < editDeadline) {
      if (await readFile(firstBuildStarted, 'utf8').then(() => true).catch(() => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(await readFile(firstBuildStarted, 'utf8').then(() => true).catch(() => false), true);
    const originalRunner = await readFile(runnerPath, 'utf8');
    assert.match(originalRunner, /CODEX_DEFAULT_MODEL="gpt-5\.6-sol"/);
    await writeFile(
      runnerPath,
      originalRunner.replace('CODEX_DEFAULT_MODEL="gpt-5.6-sol"', 'CODEX_DEFAULT_MODEL="gpt-reloaded-stub"'),
    );
    await writeFile(releaseFirstBuild, 'continue\n');

    const [runnerExit] = await once(runner, 'exit') as [number];
    assert.equal(runnerExit, 0, `runner stderr: ${stderr}\nrunner stdout: ${stdout}`);
    runner = null;

    assert.match(stdout, /completed with 1 verify failure \(3 phases\)/);
    assert.equal(await runGit(repo, ['rev-list', '--count', 'HEAD']), '5');
    assert.equal(await readFile(punchlist, 'utf8'), '## Job 16 — One\n\n- [ ] Previously complete\n');
    assert.match(await runGit(repo, ['log', '--format=%s']), new RegExp(`docs\\(dispatch\\): reset job 16 for ${slug}`));
    const callLines = (await readFile(calls, 'utf8')).trim().split('\n');
    assert.deepEqual(callLines.filter((line) => line.startsWith('build|')), [
      'build|one|gpt-5.6-sol',
      'build|two|gpt-reloaded-stub',
      'build|three|gpt-reloaded-stub',
    ]);
    assert.deepEqual(callLines.filter((line) => line.startsWith('verify|')), [
      'verify|one|gpt-test-verify',
      'verify|two|gpt-test-verify',
      'verify|three|gpt-test-verify',
    ]);

    const snapshot = watchdogService.listWorkerRuns(repo).chains[slug];
    assert.equal(snapshot.status, 'completed');
    assert.equal(snapshot.currentPhase, 3);
    assert.equal(snapshot.verifyFailures, 1);
    assert.equal(snapshot.manifest?.[1]?.verify, 'failed');
    assert.match(snapshot.manifest?.[1]?.failureReason ?? '', /second unit missed its budget/);
    assert.match(snapshot.manifest?.[1]?.failureReason ?? '', /Resume point: append a fix unit for job 2/);
    assert.equal(snapshot.manifest?.[2]?.verify, 'passed');

    const fleetNotifications = messages
      .map((message) => JSON.parse(message) as {
        kind?: string;
        notificationKind?: string;
        title?: string;
        body?: string;
      })
      .filter((message) => message.kind === 'fleet_notification');
    const failureNotification = fleetNotifications.find((message) => message.title?.includes('job 2 verify failed'));
    assert.equal(failureNotification?.notificationKind, 'decision-needed');
    assert.match(failureNotification?.body ?? '', /Job 2 of 3 \(Two\) failed verification/);
    assert.match(failureNotification?.body ?? '', /second unit missed its budget/);

    const terminalNotification = fleetNotifications.find((message) => message.title?.includes('completed with 1 verify failure'));
    assert.equal(terminalNotification?.notificationKind, 'decision-needed');
    assert.match(terminalNotification?.body ?? '', /verification is not clean/);
    assert.match(terminalNotification?.body ?? '', /Job 2 \(Two\) failed.*second unit missed its budget/);
    assert.doesNotMatch(terminalNotification?.body ?? '', /append a fix unit|Resume point/);

    const journal = await readFile(path.join(fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    assert.match(journal, /run \| reload \| runner reloaded at [a-f0-9]{64}/);
    assert.match(journal, /verify 2\/3 \| FAILED \| VERIFY: FAIL: second unit missed its budget/);
    assert.match(journal, /run \| end \| all 3 phases committed; completed with 1 verify failure/);
    assert.doesNotMatch(journal, /\| (?:killed|rewind) \|/);
    assert.doesNotMatch(journal, /parked after .*failed verify/);
  } finally {
    if (runner && runner.exitCode === null) {
      runner.kill('SIGTERM');
      await once(runner, 'exit').catch(() => undefined);
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
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(cleanupDirectory, { recursive: true, force: true });
  }
});
