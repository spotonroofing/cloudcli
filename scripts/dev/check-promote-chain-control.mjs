#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = await realpath(await mkdtemp(path.join(tmpdir(), 'promote-dev-check-')));
const repoRoot = path.resolve(import.meta.dirname, '../..');
const promotePath = path.join(repoRoot, 'scripts/macos/promote.sh');
const runnerPath = path.join(repoRoot, 'scripts/macos/dispatch-chain-runner');
const devUrl = process.env.PROMOTE_DEV_URL ?? 'http://127.0.0.1:4748';
const devDatabase = process.env.PROMOTE_DB_PATH ?? path.join(process.env.HOME ?? '', '.cloudcli-dev/auth.db');
const fixtureRepo = path.join(root, 'repo');
const fixtureHome = path.join(root, 'home');
const fixtureBin = path.join(root, 'bin');
const phaseFile = path.join(fixtureRepo, '01-stub.md');
const childPids = new Set();

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function mustRun(command, args, options = {}) {
  const result = await run(command, args, options);
  assert.equal(result.code, 0, `${command} ${args.join(' ')} failed (${result.code}): ${result.stderr}`);
  return result;
}

async function waitFor(check, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${description} did not become true within ${timeoutMs}ms`);
}

async function apiKey() {
  const result = await mustRun('/usr/bin/sqlite3', [
    devDatabase,
    'SELECT api_key FROM api_keys WHERE is_active=1 ORDER BY id LIMIT 1',
  ]);
  const key = result.stdout.trim();
  assert.ok(key, `no active API key in ${devDatabase}`);
  return key;
}

async function chain(slug, key) {
  const response = await fetch(`${devUrl}/api/watchdog/status`, { headers: { 'x-api-key': key } });
  assert.equal(response.ok, true, `watchdog status returned HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data.chains.find((candidate) => candidate.slug === slug);
}

async function runCase(name, injectAbort, key) {
  const slug = `job18-dev-${name}-${Date.now()}`;
  const attempt = path.join(root, `${slug}.attempt`);
  const started = path.join(root, `${slug}.started`);
  const resumed = path.join(root, `${slug}.resumed`);
  const release = path.join(root, `${slug}.release`);
  const workFile = path.join(fixtureRepo, `${slug}.txt`);
  const environment = {
    ...process.env,
    HOME: fixtureHome,
    PATH: `${fixtureBin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    COMMAND_CENTER_REPO: fixtureRepo,
    DISPATCH_SERVER_URL: devUrl,
    DISPATCH_DB_PATH: devDatabase,
    DISPATCH_ENGINE: 'codex',
    DISPATCH_MODEL: 'gpt-test-build',
    DISPATCH_VERIFY_ENGINE: 'codex',
    DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
    PROMOTE_SERVER_URL: devUrl,
    PROMOTE_DEV_URL: devUrl,
    PROMOTE_DB_PATH: devDatabase,
    STUB_ATTEMPT: attempt,
    STUB_RELEASE: release,
    STUB_RESUMED: resumed,
    STUB_STARTED: started,
    STUB_WORK_FILE: workFile,
  };

  const runner = spawn('/bin/zsh', [runnerPath, fixtureRepo, slug, phaseFile], {
    cwd: fixtureRepo,
    env: environment,
    stdio: 'ignore',
  });
  childPids.add(runner.pid);
  runner.once('exit', () => childPids.delete(runner.pid));

  await waitFor(async () => {
    try { await readFile(started); return true; } catch { return false; }
  }, `${slug} initial build`);
  await waitFor(async () => {
    const record = await chain(slug, key);
    return record?.status === 'running' && record.phaseActive === true;
  }, `${slug} mid-phase watchdog record`);

  const promote = await run('/bin/zsh', [promotePath, '--dry-run'], {
    cwd: fixtureRepo,
    env: injectAbort ? { ...environment, PROMOTE_DRY_RUN_FAIL_AT: 'after-pause' } : environment,
  });
  assert.equal(promote.code, injectAbort ? 1 : 0, `unexpected promote exit: ${promote.stderr}\n${promote.stdout}`);
  const pauseLine = promote.stdout.indexOf(`chain ${slug} paused for promote`);
  const drainLine = promote.stdout.indexOf('draining in-flight');
  assert.ok(pauseLine >= 0, `pause line missing:\n${promote.stdout}\n${promote.stderr}`);
  if (!injectAbort) {
    assert.ok(pauseLine < drainLine, `pause/drain order missing:\n${promote.stdout}\n${promote.stderr}`);
    assert.ok(promote.stdout.indexOf('dry-run dev health check passed') < promote.stdout.indexOf(`chain ${slug} resumed after promote`));
  } else {
    assert.equal(drainLine, -1, 'the injected abort must happen before drain');
    assert.match(promote.stdout, /promote is exiting; resuming 1 paused chain/);
  }

  const resumedPid = /runner pid (\d+)/.exec(promote.stdout)?.[1];
  if (resumedPid) childPids.add(Number(resumedPid));
  await waitFor(async () => {
    try { await readFile(resumed); return true; } catch { return false; }
  }, `${slug} resumed build`);
  await waitFor(async () => {
    const record = await chain(slug, key);
    return record?.status === 'running' && record.phaseActive === true;
  }, `${slug} running state after promote`);

  const journal = await readFile(path.join(fixtureHome, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
  assert.match(journal, /^\d{2}:\d{2} \| run \| PAUSED \| promote$/m);
  assert.match(journal, /^\d{2}:\d{2} \| run \| RESUMED \| promote$/m);

  await writeFile(release, 'finish\n');
  await waitFor(async () => (await chain(slug, key))?.status === 'completed', `${slug} cleanup completion`);
  if (resumedPid) childPids.delete(Number(resumedPid));
  return { journal, output: promote.stdout, slug };
}

try {
  await Promise.all([
    mkdir(fixtureRepo),
    mkdir(fixtureBin),
    mkdir(path.join(fixtureHome, 'forge-logs'), { recursive: true }),
  ]);
  await mustRun('/usr/bin/git', ['init', '-q'], { cwd: fixtureRepo });
  await mustRun('/usr/bin/git', ['config', 'user.email', 'promote-dev-check@example.com'], { cwd: fixtureRepo });
  await mustRun('/usr/bin/git', ['config', 'user.name', 'Promote Dev Check'], { cwd: fixtureRepo });
  await writeFile(phaseFile, '<!-- name: Promote dev stub -->\n<!-- verify: no -->\nPROMOTE_DEV_STUB\n');
  await mustRun('/usr/bin/git', ['add', '.'], { cwd: fixtureRepo });
  await mustRun('/usr/bin/git', ['commit', '-qm', 'stub base'], { cwd: fixtureRepo });

  const fakeCodex = path.join(fixtureBin, 'codex');
  await writeFile(fakeCodex, `#!/bin/zsh
prompt=$(</dev/stdin)
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
print -r -- '{"type":"thread.started","thread_id":"promote-dev-'$$'"}'
if [[ ! -f "$STUB_ATTEMPT" ]]; then
  : > "$STUB_ATTEMPT"
  print -r -- "work before pause" > "$STUB_WORK_FILE"
  : > "$STUB_STARTED"
  while true; do /bin/sleep 0.05; done
fi
: > "$STUB_RESUMED"
while [[ ! -f "$STUB_RELEASE" ]]; do /bin/sleep 0.05; done
/usr/bin/git add -A
/usr/bin/git commit -q -m "stub resumed completion"
print -r -- "done" > "$output"
`);
  await chmod(fakeCodex, 0o755);

  const key = await apiKey();
  const healthy = await runCase('healthy', false, key);
  const aborted = await runCase('abort', true, key);
  process.stdout.write(`PASS ${healthy.slug}: pause before drain, resume after health, journaled\n`);
  process.stdout.write(`PASS ${aborted.slug}: abort exit resumed the paused chain, journaled\n`);
} finally {
  for (const pid of childPids) {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
  }
  await rm(root, { recursive: true, force: true });
}
