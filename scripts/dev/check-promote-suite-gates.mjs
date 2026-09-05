import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

const repoRoot = process.cwd();
const promotePath = path.join(repoRoot, 'scripts/macos/promote.sh');
const runnerPath = path.join(repoRoot, 'scripts/macos/dispatch-chain-runner');
const devUrl = process.env.PROMOTE_DEV_URL ?? 'http://127.0.0.1:4748';
const devDatabase = process.env.PROMOTE_DB_PATH ?? path.join(os.homedir(), '.cloudcli-dev', 'auth.db');

function run(executable, args, options) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('exit', (code) => resolve({ code, output }));
  });
}

async function executable(filePath, source) {
  await writeFile(filePath, source);
  await chmod(filePath, 0o755);
}

async function api(apiKey, pathname, init = {}) {
  const response = await fetch(`${devUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  });
  const responseText = await response.text();
  assert.equal(response.ok, true, `${init.method ?? 'GET'} ${pathname} failed: ${response.status} ${responseText}`);
  return JSON.parse(responseText);
}

const database = new Database(devDatabase, { readonly: true });
const apiKey = database.prepare('SELECT api_key FROM api_keys WHERE is_active=1 ORDER BY id LIMIT 1').pluck().get();
database.close();
assert.equal(typeof apiKey, 'string', 'dev has no active API key');

const root = await mkdtemp(path.join(os.tmpdir(), 'audit1-promote-suite-'));
const fixtureRepo = path.join(root, 'repo');
const bin = path.join(root, 'bin');
const notices = [];
let proxy;

try {
  await Promise.all([mkdir(fixtureRepo), mkdir(bin)]);
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 'audit1-done-check@example.com'],
    ['config', 'user.name', 'Audit1 Done Check'],
  ]) {
    const result = await run('/usr/bin/git', args, { cwd: fixtureRepo, env: process.env });
    assert.equal(result.code, 0, result.output);
  }
  await writeFile(path.join(fixtureRepo, 'seed.txt'), 'seed\n');
  for (const args of [['add', '.'], ['commit', '-qm', 'stub base']]) {
    const result = await run('/usr/bin/git', args, { cwd: fixtureRepo, env: process.env });
    assert.equal(result.code, 0, result.output);
  }

  await executable(path.join(bin, 'npm'), `#!/bin/zsh
if [[ "${'${STUB_GATE_MODE:-}'}" == client-fail && "$*" == "run test:client" ]]; then
  print -r -- "not ok 1 - deliberate client done-check failure"
  exit 1
fi
if [[ "${'${STUB_GATE_MODE:-}'}" == runner-red && "$*" == test ]]; then
  print -r -- "TAP version 13"
  print -r -- "not ok 1 - deliberate server done-check failure"
  exit 1
fi
print -r -- "ok 1 - $*"
exit 0
`);

  proxy = http.createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += String(chunk);
      const parsed = body ? JSON.parse(body) : null;
      if (parsed?.kind === 'decision-needed') notices.push(parsed);
      const upstream = await fetch(`${devUrl}${request.url}`, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
      });
      let payload = await upstream.text();
      if (request.url === '/api/watchdog/status' && upstream.ok) {
        const status = JSON.parse(payload);
        status.data.chains = (status.data.chains ?? []).filter((chain) => chain.projectPath === fixtureRepo);
        status.data.dispatchRuns = (status.data.dispatchRuns ?? []).filter((item) => item.projectPath === fixtureRepo);
        payload = JSON.stringify(status);
      }
      response.statusCode = upstream.status;
      response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
      response.end(payload);
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  assert.ok(address && typeof address === 'object');
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const promoteEnvironment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    COMMAND_CENTER_REPO: fixtureRepo,
    PROMOTE_DB_PATH: devDatabase,
    PROMOTE_DEV_URL: proxyUrl,
    PROMOTE_SERVER_URL: proxyUrl,
    PROMOTE_DRAIN_BUDGET_S: '5',
    PROMOTE_HOLD_POLL_S: '1',
  };

  const failed = await run('/bin/zsh', [promotePath, '--dry-run'], {
    cwd: fixtureRepo,
    env: { ...promoteEnvironment, STUB_GATE_MODE: 'client-fail' },
  });
  assert.equal(failed.code, 1, failed.output);
  assert.match(failed.output, /ABORT at client test/);
  assert.match(notices.at(-1)?.title ?? '', /Promote failed at client test/);

  const passed = await run('/bin/zsh', [promotePath, '--dry-run'], {
    cwd: fixtureRepo,
    env: { ...promoteEnvironment, STUB_GATE_MODE: 'pass' },
  });
  assert.equal(passed.code, 0, passed.output);
  assert.match(passed.output, /dry run complete/);

  const promotesPayload = await api(apiKey, `/api/watchdog/promotes?projectPath=${encodeURIComponent(fixtureRepo)}`);
  const attempts = promotesPayload.data.promotes;
  assert.equal(attempts.length, 2);
  const failedAttempt = attempts.find((attempt) => attempt.status === 'failed');
  const passedAttempt = attempts.find((attempt) => attempt.status === 'passed');
  assert.equal(failedAttempt?.stage, 'client-test');
  assert.equal(passedAttempt?.stage, 'complete');
  for (const attempt of attempts) {
    assert.equal(typeof attempt.startedAt, 'number');
    assert.equal(typeof attempt.endedAt, 'number');
    assert.match(attempt.logPath, /forge-logs\/promote\/\d{8}-\d{4}\/attempt-\d+$/);
    for (const logName of ['build.log', 'typecheck.log', 'test.log', 'client.log']) {
      await readFile(path.join(attempt.logPath, logName));
    }
  }

  const slug = `audit1-suite-${Date.now()}`;
  const phase = path.join(fixtureRepo, '01-suite.md');
  await writeFile(phase, '<!-- name: Dev suite stub -->\n<!-- tasks: Record the failing test -->\n<!-- verify: no -->\nDEV_SUITE_STUB\n');
  await executable(path.join(bin, 'codex'), `#!/bin/zsh
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
print -r -- '{"type":"thread.started","thread_id":"audit1-dev-suite-stub"}'
print -r -- changed > "$STUB_REPO/suite.txt"
/usr/bin/git -C "$STUB_REPO" add suite.txt 01-suite.md
/usr/bin/git -C "$STUB_REPO" commit -q -m "fix(stub): dev suite payload"
print -r -- done > "$output"
`);
  await api(apiKey, '/api/watchdog/chains', {
    method: 'POST',
    body: JSON.stringify({
      slug,
      projectPath: fixtureRepo,
      phases: 1,
      manifest: [{ name: 'Dev suite stub', tasks: ['Record the failing test'], kind: 'phase' }],
    }),
  });
  const runner = await run('/bin/zsh', [runnerPath, fixtureRepo, slug, phase], {
    cwd: fixtureRepo,
    env: {
      ...process.env,
      HOME: os.homedir(),
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      DISPATCH_SERVER_URL: devUrl,
      DISPATCH_DB_PATH: devDatabase,
      DISPATCH_ENGINE: 'codex',
      DISPATCH_MANIFEST: '',
      DISPATCH_MODEL: 'gpt-test-build',
      DISPATCH_RELOADING: '',
      DISPATCH_RESUME_FROM: '1',
      DISPATCH_RESUMING: '',
      DISPATCH_RUN_DATE: undefined,
      DISPATCH_RUN_SUMMARY_PATH: undefined,
      DISPATCH_VERIFY_ENGINE: 'codex',
      DISPATCH_VERIFY_MODEL: 'gpt-test-verify',
      DISPATCHING_SESSION_ID: '',
      STUB_GATE_MODE: 'runner-red',
      STUB_REPO: fixtureRepo,
    },
  });
  assert.equal(runner.code, 0, runner.output);
  const statusPayload = await api(apiKey, '/api/watchdog/status');
  const chain = statusPayload.data.chains.find((candidate) => candidate.slug === slug);
  assert.equal(chain?.status, 'completed');
  assert.equal(chain?.jobs?.[1]?.suite, 'red');
  assert.deepEqual(chain?.jobs?.[1]?.suiteFailures, ['deliberate server done-check failure']);
  const journal = await readFile(path.join(os.homedir(), 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
  assert.match(journal, /suite 1\/1 \| end \| RED: deliberate server done-check failure/);

  process.stdout.write(`${JSON.stringify({
    failedAttempt: { id: failedAttempt.id, stage: failedAttempt.stage, status: failedAttempt.status, logPath: failedAttempt.logPath },
    passedAttempt: { id: passedAttempt.id, stage: passedAttempt.stage, status: passedAttempt.status, logPath: passedAttempt.logPath },
    notice: notices.at(-1)?.title,
    suite: chain.jobs[1].suite,
    suiteFailures: chain.jobs[1].suiteFailures,
    slug,
  }, null, 2)}\n`);
} finally {
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  await rm(root, { recursive: true, force: true });
}
