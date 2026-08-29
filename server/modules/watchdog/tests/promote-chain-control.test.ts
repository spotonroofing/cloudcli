import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import http from 'node:http';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const promotePath = path.resolve('scripts/macos/promote.sh');

type Harness = {
  calls: string;
  env: NodeJS.ProcessEnv;
  home: string;
  notifications: Array<{ kind?: string; title?: string; body?: string }>;
  repo: string;
  run: (args: string[], extraEnvironment?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
  states: () => Record<string, string>;
};

async function withPromoteHarness(
  options: { health?: (attempt: number) => boolean; slugs?: string[] } = {},
  runTest: (harness: Harness) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'promote-chain-control-'));
  const repo = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const commandDirectory = path.join(root, 'bin');
  const stateFile = path.join(root, 'states.json');
  const callLog = path.join(root, 'calls.log');
  const dispatchStub = path.join(root, 'dispatch-stub');
  const databasePath = path.join(root, 'auth.db');
  const slugs = options.slugs ?? ['promote-stub-a', 'promote-stub-b'];
  const notifications: Array<{ kind?: string; title?: string; body?: string }> = [];
  let healthAttempt = 0;

  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(commandDirectory, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'promote-test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Promote Test']);
  writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  execFileSync('git', ['-C', repo, 'add', 'seed.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed']);
  for (const directory of ['dist', 'dist-server', 'dist-dev', 'dist-server-dev', '.last-good/dist', '.last-good/dist-server']) {
    mkdirSync(path.join(repo, directory), { recursive: true });
    writeFileSync(path.join(repo, directory, 'artifact.txt'), `${directory}\n`);
  }
  writeFileSync(stateFile, `${JSON.stringify(Object.fromEntries(slugs.map((slug) => [slug, 'running'])))}\n`);
  writeFileSync(callLog, '');
  execFileSync('/usr/bin/sqlite3', [
    databasePath,
    "CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT, is_active INTEGER); INSERT INTO api_keys(api_key,is_active) VALUES ('test-key',1);",
  ]);

  writeFileSync(dispatchStub, `#!/bin/zsh
set -u
action="$1"
slug="$3"
print -r -- "$action:$slug" >> "$STUB_CALL_LOG"
if [[ "$action" == resume && "${'${STUB_FAIL_RESUME_SLUG:-}'}" == "$slug" ]]; then
  print -u2 "dispatch: simulated resume refusal for $slug"
  exit 69
fi
python3 - "$STUB_STATE_FILE" "$slug" "$action" <<'PYEOF'
import json, sys
state_file, slug, action = sys.argv[1:4]
with open(state_file, encoding='utf-8') as handle:
    states = json.load(handle)
states[slug] = 'paused' if action == 'pause' else 'running'
with open(state_file, 'w', encoding='utf-8') as handle:
    json.dump(states, handle)
    handle.write('\\n')
PYEOF
if [[ "$action" == pause ]]; then
  print -r -- "dispatch: chain $slug paused; its runner and active stages have exited"
else
  print -r -- "dispatch: chain $slug resumed at job 2 (runner pid 1234)"
fi
`);
  chmodSync(dispatchStub, 0o755);

  for (const command of ['npm', 'launchctl', 'rsync', 'sleep']) {
    const commandPath = path.join(commandDirectory, command);
    writeFileSync(commandPath, `#!/bin/zsh
print -r -- "command:${command}:$*" >> "$STUB_CALL_LOG"
exit 0
`);
    chmodSync(commandPath, 0o755);
  }

  const server = http.createServer((request, response) => {
    if (request.url === '/api/watchdog/status') {
      const states = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, string>;
      appendFileSync(callLog, `status:${Object.values(states).join(',')}\n`);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        data: {
          chains: Object.entries(states).map(([slug, status]) => ({ slug, status, projectPath: repo, phaseActive: status === 'running' })),
          dispatchRuns: [],
        },
      }));
      return;
    }
    if (request.url === '/health') {
      healthAttempt += 1;
      const healthy = options.health?.(healthAttempt) ?? true;
      appendFileSync(callLog, `health:${healthy ? 'ok' : 'failed'}\n`);
      response.statusCode = healthy ? 200 : 503;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: healthy ? 'ok' : 'failed' }));
      return;
    }
    if (request.url === '/api/watchdog/notify' && request.method === 'POST') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        notifications.push(JSON.parse(body) as { kind?: string; title?: string; body?: string });
        appendFileSync(callLog, 'notify\n');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: { ok: true } }));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const serverUrl = `http://127.0.0.1:${address.port}`;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    PATH: `${commandDirectory}:${process.env.PATH ?? ''}`,
    COMMAND_CENTER_REPO: repo,
    PROMOTE_DB_PATH: databasePath,
    PROMOTE_DEV_URL: serverUrl,
    PROMOTE_DISPATCH_PATH: dispatchStub,
    PROMOTE_SERVER_URL: serverUrl,
    STUB_CALL_LOG: callLog,
    STUB_STATE_FILE: stateFile,
  };

  try {
    await runTest({
      calls: callLog,
      env: environment,
      home,
      notifications,
      repo,
      run: async (args, extraEnvironment = {}) => execFileAsync(promotePath, args, {
        cwd: repo,
        env: { ...environment, ...extraEnvironment },
      }),
      states: () => JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, string>,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

test('promote dry run pauses every project chain before drain and resumes after dev health', async () => {
  await withPromoteHarness({}, async ({ calls, home, run, states }) => {
    const result = await run(['--dry-run']);
    assert.match(result.stdout, /dry run complete/);
    assert.deepEqual(states(), { 'promote-stub-a': 'running', 'promote-stub-b': 'running' });

    const events = readFileSync(calls, 'utf8').trim().split('\n');
    const drained = events.indexOf('status:paused,paused');
    const health = events.indexOf('health:ok');
    assert.ok(events.indexOf('pause:promote-stub-a') < drained);
    assert.ok(events.indexOf('pause:promote-stub-b') < drained);
    assert.ok(health > drained);
    assert.ok(events.indexOf('resume:promote-stub-a') > health);
    assert.ok(events.indexOf('resume:promote-stub-b') > health);
    for (const slug of ['promote-stub-a', 'promote-stub-b']) {
      const journal = readFileSync(path.join(home, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
      assert.match(journal, /^\d{2}:\d{2} \| run \| PAUSED \| promote$/m);
      assert.match(journal, /^\d{2}:\d{2} \| run \| RESUMED \| promote$/m);
    }
  });
});

test('an abort after pause resumes every chain through the exit safety net', async () => {
  await withPromoteHarness({}, async ({ calls, run, states }) => {
    await assert.rejects(run(['--dry-run'], { PROMOTE_DRY_RUN_FAIL_AT: 'after-pause' }), { code: 1 });
    assert.deepEqual(states(), { 'promote-stub-a': 'running', 'promote-stub-b': 'running' });
    const events = readFileSync(calls, 'utf8').trim().split('\n');
    assert.ok(events.indexOf('resume:promote-stub-a') > events.indexOf('pause:promote-stub-a'));
    assert.ok(events.indexOf('resume:promote-stub-b') > events.indexOf('pause:promote-stub-b'));
  });
});

test('a failed resume notifies with the slug and CLI reason while other chains resume', async () => {
  await withPromoteHarness({}, async ({ notifications, run, states }) => {
    await assert.rejects(run(['--dry-run'], { STUB_FAIL_RESUME_SLUG: 'promote-stub-a' }), { code: 1 });
    assert.deepEqual(states(), { 'promote-stub-a': 'paused', 'promote-stub-b': 'running' });
    const notice = notifications.find((notification) => notification.title?.includes('promote-stub-a'));
    assert.equal(notice?.kind, 'decision-needed');
    assert.match(notice?.body ?? '', /simulated resume refusal for promote-stub-a/);
  });
});

test('a healthy rollback resumes chains before reporting the rolled-back promote', async () => {
  await withPromoteHarness({ health: (attempt) => attempt === 1 || attempt >= 14 }, async ({ calls, notifications, run, states }) => {
    await assert.rejects(run([]), { code: 3 });
    assert.deepEqual(states(), { 'promote-stub-a': 'running', 'promote-stub-b': 'running' });
    const events = readFileSync(calls, 'utf8').trim().split('\n');
    const rollbackHealth = events.lastIndexOf('health:ok');
    assert.ok(events.indexOf('resume:promote-stub-a') > rollbackHealth);
    assert.ok(events.indexOf('resume:promote-stub-b') > rollbackHealth);
    assert.equal(notifications.some((notification) => notification.title === 'Promote rolled back'), true);
  });
});

test('the standalone tag guard remains read-only and refuses a mid-phase chain', async () => {
  await withPromoteHarness({ slugs: ['tag-guard-stub'] }, async ({ calls, run }) => {
    await assert.rejects(run(['--tag-guard']), { code: 2 });
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /pause:|resume:/);
  });
});
