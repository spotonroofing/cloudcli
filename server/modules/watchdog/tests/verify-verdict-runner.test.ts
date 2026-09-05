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
} from '@/modules/database/index.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');

type Fixture = {
  directory: string;
  repo: string;
  bin: string;
  fakeHome: string;
  database: string;
  serverUrl: string;
  server: ReturnType<express.Application['listen']>;
  previousDatabasePath: string | undefined;
  previousHome: string | undefined;
};

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function runGit(repo: string, args: string[]): Promise<string> {
  const child = spawn('/usr/bin/git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const [exitCode] = await once(child, 'exit') as [number];
  assert.equal(exitCode, 0, `git ${args.join(' ')} failed: ${stderr}`);
  return stdout.trim();
}

async function waitForFile(filePath: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await readFile(filePath).then(() => true).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`file did not appear within ${timeoutMs}ms: ${filePath}`);
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

  const app = express();
  app.use(express.json());
  app.use('/api/watchdog', createWatchdogRouter());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;

  await runGit(repo, ['init', '-q']);
  await runGit(repo, ['config', 'user.email', 'stub@example.com']);
  await runGit(repo, ['config', 'user.name', 'Verify Truth Stub']);
  return {
    directory,
    repo,
    bin,
    fakeHome,
    database,
    serverUrl: `http://127.0.0.1:${address.port}`,
    server,
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
    DISPATCH_ENGINE: 'codex',
    DISPATCH_MANIFEST: '',
    DISPATCH_MODEL: 'gpt-test-build',
    DISPATCH_RELOADING: '',
    DISPATCH_RESUME_FROM: '1',
    DISPATCH_RESUMING: '',
    DISPATCH_VERIFY_ENGINE: 'codex',
    DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
    DISPATCHING_SESSION_ID: '',
    ...extra,
  };
}

test('runner holds a dev restart through a 30-second verify and mechanically rejects dirty and docs-only outcomes', {
  skip: process.platform !== 'darwin',
  timeout: 55_000,
}, async () => {
  const fixture = await createFixture('verify-truth-runner');
  const slug = `verify-truth-runner-${Date.now()}`;
  const verifyStarted = path.join(fixture.directory, 'verify-started');
  const secondBuildStarted = path.join(fixture.directory, 'second-build-started');
  const devRestarted = path.join(fixture.directory, 'dev-restarted');
  const promptDirectory = path.join(fixture.directory, 'verify-prompts');
  let runner: ReturnType<typeof spawn> | null = null;
  try {
    await mkdir(promptDirectory);
    const punchlist = path.join(fixture.repo, 'PUNCHLIST_stub.md');
    const phases = [1, 2, 3, 4].map((phase) => path.join(fixture.repo, `0${phase}-job.md`));
    await writeFile(punchlist, [
      '## Job 1 — Hold', '', '- [ ] Hold restart', '', 'Done check: held.', '',
      '## Job 2 — Inconclusive', '', '- [ ] Preserve verdict', '', 'Done check: inconclusive.', '',
      '## Job 3 — Dirty', '', '- [ ] Pre-check tree', '', 'Done check: skipped.', '',
      '## Job 4 — Docs only', '', '- [ ] Gate commit', '', 'Done check: stopped.', '',
    ].join('\n'));
    for (const phase of [1, 2, 3, 4]) {
      await writeFile(
        phases[phase - 1],
        `<!-- name: Unit ${phase} -->\nExecute Job ${phase} of PUNCHLIST_stub.md in this repo.\nUNIT_${phase}_BUILDER_ONLY\n`,
      );
    }
    await runGit(fixture.repo, ['add', '.']);
    await runGit(fixture.repo, ['commit', '-q', '-m', 'stub base']);

    await executable(path.join(fixture.bin, 'npm'), `#!/bin/zsh
print -r -- "dev restarted" > "$STUB_DEV_RESTARTED"
exit 0
`);
    await executable(path.join(fixture.bin, 'codex'), `#!/bin/zsh
prompt=$(</dev/stdin)
stage=build
[[ "$prompt" == *"fresh-context verifier"* ]] && stage=verify
unit=0
if [[ "$stage" == verify ]]; then
  [[ "$prompt" == *"job 1 of 4 (Unit 1)"* ]] && unit=1
  [[ "$prompt" == *"job 2 of 4 (Unit 2)"* ]] && unit=2
  [[ "$prompt" == *"job 3 of 4 (Unit 3)"* ]] && unit=3
  [[ "$prompt" == *"job 4 of 4 (Unit 4)"* ]] && unit=4
else
  [[ "$prompt" == *"UNIT_1_BUILDER_ONLY"* ]] && unit=1
  [[ "$prompt" == *"UNIT_2_BUILDER_ONLY"* ]] && unit=2
  [[ "$prompt" == *"UNIT_3_BUILDER_ONLY"* ]] && unit=3
  [[ "$prompt" == *"UNIT_4_BUILDER_ONLY"* ]] && unit=4
fi
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"truth-$stage-$unit-$$\\"}"
if [[ "$stage" == verify ]]; then
  print -r -- "$prompt" > "$STUB_VERIFY_PROMPTS/$unit.md"
  if [[ "$unit" == 1 ]]; then
    : > "$STUB_VERIFY_STARTED"
    /bin/sleep 30
    print -r -- "VERIFY: PASS" > "$output"
  elif [[ "$unit" == 2 ]]; then
    print -r -- "VERIFY: INCONCLUSIVE: fake environment unavailable" > "$output"
  else
    print -r -- "VERIFY: PASS" > "$output"
  fi
  exit 0
fi
if [[ "$unit" == 1 ]]; then
  print -r -- one > "$STUB_REPO/one.txt"
  /bin/mkdir -p "$STUB_REPO/.dispatch"
  print -r -- allowed > "$STUB_REPO/.dispatch/runtime-noise"
  /usr/bin/git -C "$STUB_REPO" add one.txt
  /usr/bin/git -C "$STUB_REPO" commit -q -m "fix(stub): unit one"
elif [[ "$unit" == 2 ]]; then
  : > "$STUB_SECOND_BUILD_STARTED"
  npm run build
  print -r -- two > "$STUB_REPO/two.txt"
  /usr/bin/git -C "$STUB_REPO" add two.txt
  /usr/bin/git -C "$STUB_REPO" commit -q -m "fix(stub): unit two"
  /usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "docs(stub): after unit two"
elif [[ "$unit" == 3 ]]; then
  print -r -- three > "$STUB_REPO/three.txt"
  /usr/bin/git -C "$STUB_REPO" add three.txt
  /usr/bin/git -C "$STUB_REPO" commit -q -m "fix(stub): unit three"
  print -r -- dirty > "$STUB_REPO/unexpected.tmp"
else
  /usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "docs(stub): planner only"
fi
print -r -- done > "$output"
`);

    watchdogService.registerChain({
      slug,
      projectPath: fixture.repo,
      phases: 4,
      manifest: [1, 2, 3, 4].map((phase) => ({ name: `Unit ${phase}`, tasks: [], kind: 'phase' })),
    });
    const startedAt = Date.now();
    runner = spawn('/bin/zsh', [runnerPath, fixture.repo, slug, ...phases], {
      cwd: fixture.repo,
      env: runnerEnvironment(fixture, {
        DISPATCH_VERIFY_CAP_SECS: '45',
        STUB_DEV_RESTARTED: devRestarted,
        STUB_REPO: fixture.repo,
        STUB_SECOND_BUILD_STARTED: secondBuildStarted,
        STUB_VERIFY_PROMPTS: promptDirectory,
        STUB_VERIFY_STARTED: verifyStarted,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    runner.stdout?.on('data', (chunk) => { output += String(chunk); });
    runner.stderr?.on('data', (chunk) => { output += String(chunk); });

    await Promise.all([waitForFile(verifyStarted), waitForFile(secondBuildStarted)]).catch(async (error) => {
      const journal = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8')
        .catch(() => '(journal unavailable)');
      const verifyLog = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'verify1.log'), 'utf8')
        .catch(() => '(verify log unavailable)');
      assert.fail(`${String(error)}\nrunner output:\n${output}\nrunner journal:\n${journal}\nverify log:\n${verifyLog}`);
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await readFile(devRestarted).then(() => true).catch(() => false), false);

    const [exitCode] = await once(runner, 'exit') as [number];
    runner = null;
    assert.equal(exitCode, 2, output);
    assert.ok(Date.now() - startedAt >= 29_000, 'the stub verifier must hold the dev command for its full sleep');
    assert.equal(await readFile(devRestarted, 'utf8'), 'dev restarted\n');

    const snapshot = watchdogService.listWorkerRuns(fixture.repo).chains[slug];
    assert.equal(snapshot.status, 'stopped');
    assert.deepEqual(snapshot.verifySummary, { passed: 1, failed: 0, inconclusive: 3 });
    assert.deepEqual(snapshot.manifest?.map((job) => job.verify), [
      'passed',
      'inconclusive',
      'inconclusive',
      'inconclusive',
    ]);
    assert.match(snapshot.manifest?.[1]?.verifyReason ?? '', /fake environment unavailable/);
    assert.match(snapshot.manifest?.[2]?.verifyReason ?? '', /unexpected\.tmp/);
    assert.match(snapshot.manifest?.[3]?.verifyReason ?? '', /contains no non-docs commit/);
    assert.equal(snapshot.manifest?.[1]?.commitSubject, 'fix(stub): unit two');

    const verifyPrompt = await readFile(path.join(promptDirectory, '1.md'), 'utf8');
    assert.match(verifyPrompt, /## Job 1 — Hold/);
    assert.match(verifyPrompt, /Done check: held\./);
    assert.match(verifyPrompt, /Commit range:/);
    assert.match(verifyPrompt, /one\.txt/);
    assert.doesNotMatch(verifyPrompt, /UNIT_1_BUILDER_ONLY/);

    const journal = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    assert.equal((journal.match(/\| hold \| next unit dev rebuild\/restart waits/g) ?? []).length, 1);
    assert.match(journal, /verify 3\/4 \| pre-check \| INCONCLUSIVE: .*unexpected\.tmp; model verify skipped/);
    assert.match(journal, /verify 4\/4 \| pre-check \| INCONCLUSIVE: .*no non-docs commit; model verify skipped/);
    assert.match(journal, /phase 4\/4 \| STOPPED \| commit gate: BASE\.\.HEAD has no non-docs commit/);
    assert.equal(await readFile(path.join(promptDirectory, '3.md')).then(() => true).catch(() => false), false);
  } finally {
    if (runner && runner.exitCode === null) {
      runner.kill('SIGTERM');
      await once(runner, 'exit').catch(() => undefined);
    }
    await destroyFixture(fixture);
  }
});

test('verify cap records INCONCLUSIVE with reason verify cap and releases a held dev command', {
  skip: process.platform !== 'darwin',
  timeout: 15_000,
}, async () => {
  const fixture = await createFixture('verify-cap-runner');
  const slug = `verify-cap-runner-${Date.now()}`;
  const devRestarted = path.join(fixture.directory, 'cap-dev-restarted');
  let runner: ReturnType<typeof spawn> | null = null;
  try {
    const punchlist = path.join(fixture.repo, 'PUNCHLIST_stub.md');
    const phaseOne = path.join(fixture.repo, '01-cap.md');
    const phaseTwo = path.join(fixture.repo, '02-after-cap.md');
    await writeFile(punchlist, [
      '## Job 1 — Cap', '', '- [ ] Bound verify', '', 'Done check: capped.', '',
      '## Job 2 — After cap', '', '- [ ] Restart', '', 'Done check: restarted.', '',
    ].join('\n'));
    await writeFile(phaseOne, '<!-- name: Cap -->\nExecute Job 1 of PUNCHLIST_stub.md in this repo.\nCAP_BUILD_ONE\n');
    await writeFile(phaseTwo, '<!-- name: After cap -->\nExecute Job 2 of PUNCHLIST_stub.md in this repo.\nCAP_BUILD_TWO\n');
    await runGit(fixture.repo, ['add', '.']);
    await runGit(fixture.repo, ['commit', '-q', '-m', 'stub base']);
    await executable(path.join(fixture.bin, 'npm'), `#!/bin/zsh
print -r -- restarted > "$STUB_DEV_RESTARTED"
exit 0
`);
    await executable(path.join(fixture.bin, 'codex'), `#!/bin/zsh
prompt=$(</dev/stdin)
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
stage=build
[[ "$prompt" == *"fresh-context verifier"* ]] && stage=verify
unit=1
[[ "$prompt" == *"job 2 of 2 (After cap)"* || "$prompt" == *"CAP_BUILD_TWO"* ]] && unit=2
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"cap-$stage-$$\\"}"
if [[ "$stage" == verify ]]; then
  [[ "$unit" == 1 ]] && /bin/sleep 30
  print -r -- "VERIFY: PASS" > "$output"
  exit 0
fi
[[ "$unit" == 2 ]] && npm run build
print -r -- changed > "$STUB_REPO/cap-$unit.txt"
/usr/bin/git -C "$STUB_REPO" add "cap-$unit.txt"
/usr/bin/git -C "$STUB_REPO" commit -q -m "fix(stub): cap build $unit"
print -r -- done > "$output"
`);
    watchdogService.registerChain({
      slug,
      projectPath: fixture.repo,
      phases: 2,
      manifest: [
        { name: 'Cap', tasks: [], kind: 'phase' },
        { name: 'After cap', tasks: [], kind: 'phase' },
      ],
    });
    runner = spawn('/bin/zsh', [runnerPath, fixture.repo, slug, phaseOne, phaseTwo], {
      cwd: fixture.repo,
      env: runnerEnvironment(fixture, {
        DISPATCH_VERIFY_CAP_SECS: '1',
        STUB_DEV_RESTARTED: devRestarted,
        STUB_REPO: fixture.repo,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    runner.stdout?.on('data', (chunk) => { output += String(chunk); });
    runner.stderr?.on('data', (chunk) => { output += String(chunk); });
    const [exitCode] = await once(runner, 'exit') as [number];
    runner = null;
    assert.equal(exitCode, 0, output);
    const snapshot = watchdogService.listWorkerRuns(fixture.repo).chains[slug];
    assert.deepEqual(snapshot.verifySummary, { passed: 1, failed: 0, inconclusive: 1 });
    assert.equal(snapshot.manifest?.[0]?.verify, 'inconclusive');
    assert.equal(snapshot.manifest?.[0]?.verifyReason, 'verify cap');
    assert.equal(snapshot.manifest?.[1]?.verify, 'passed');
    assert.equal(await readFile(devRestarted, 'utf8'), 'restarted\n');
    const journal = await readFile(path.join(fixture.fakeHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
    assert.match(journal, /INCONCLUSIVE for .*: verify cap/);
    assert.match(journal, /verify totals include 0 failed and 1 inconclusive/);
  } finally {
    if (runner && runner.exitCode === null) {
      runner.kill('SIGTERM');
      await once(runner, 'exit').catch(() => undefined);
    }
    await destroyFixture(fixture);
  }
});
