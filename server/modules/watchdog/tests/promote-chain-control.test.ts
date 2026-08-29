import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const promotePath = path.resolve('scripts/macos/promote.sh');

type StubChainState = {
  status: 'running' | 'paused';
  holdRequested: boolean;
  holdReason: string | null;
};

type Harness = {
  calls: string;
  env: NodeJS.ProcessEnv;
  home: string;
  notifications: Array<Record<string, unknown>>;
  repo: string;
  run: (args: string[], extraEnvironment?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;
  states: () => Record<string, StubChainState>;
};

async function withPromoteHarness(
  options: {
    health?: (attempt: number) => boolean;
    neverHold?: string[];
    slugs?: string[];
  } = {},
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
  const notifications: Array<Record<string, unknown>> = [];
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
  const initialStates = Object.fromEntries(slugs.map((slug) => [slug, {
    status: 'running',
    holdRequested: false,
    holdReason: null,
  }] satisfies [string, StubChainState]));
  writeFileSync(stateFile, `${JSON.stringify(initialStates)}\n`);
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
if [[ "$action" == release-hold && "${'${STUB_FAIL_RELEASE_SLUG:-}'}" == "$slug" ]]; then
  print -u2 "dispatch: simulated resume refusal for $slug"
  exit 69
fi
result=$(python3 - "$STUB_STATE_FILE" "$slug" "$action" <<'PYEOF'
import json, sys
state_file, slug, action = sys.argv[1:4]
with open(state_file, encoding='utf-8') as handle:
    states = json.load(handle)
state = states[slug]
if action == 'hold':
    state['holdRequested'] = True
    state['holdReason'] = 'promote'
    result = 'hold'
elif action == 'release-hold':
    held = state['status'] == 'paused'
    state.update(status='running', holdRequested=False, holdReason=None)
    result = 'resume' if held else 'clear'
else:
    result = action
with open(state_file, 'w', encoding='utf-8') as handle:
    json.dump(states, handle)
    handle.write('\\n')
print(result)
PYEOF
)
if [[ "$result" == hold ]]; then
  print -r -- "dispatch: chain $slug will hold after its current job commits and verifies"
elif [[ "$result" == resume ]]; then
  print -r -- "dispatch: chain $slug resumed at job 2 (runner pid 1234)"
else
  print -r -- "dispatch: chain $slug promote hold cleared; the current job keeps running"
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
      const states = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, StubChainState>;
      for (const [slug, state] of Object.entries(states)) {
        if (state.status === 'running' && state.holdRequested && !options.neverHold?.includes(slug)) {
          appendFileSync(callLog, `unit-commit:${slug}\nunit-verify:${slug}\nheld:${slug}\n`);
          state.status = 'paused';
          mkdirSync(path.join(home, 'forge-logs', slug), { recursive: true });
          appendFileSync(path.join(home, 'forge-logs', slug, 'JOURNAL.md'), '12:00 | run | HELD | promote\n');
        }
      }
      writeFileSync(stateFile, `${JSON.stringify(states)}\n`);
      appendFileSync(callLog, `status:${Object.values(states).map((state) => state.status).join(',')}\n`);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        data: {
          chains: Object.entries(states).map(([slug, state]) => ({
            slug,
            ...state,
            projectPath: repo,
            phaseActive: state.status === 'running',
          })),
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
        notifications.push(JSON.parse(body) as Record<string, unknown>);
        appendFileSync(callLog, 'notify\n');
        response.statusCode = 201;
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
    PROMOTE_DRAIN_BUDGET_S: '20',
    PROMOTE_HOLD_POLL_S: '5',
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
      states: () => JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, StubChainState>,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

test('dry-run promote waits for committed and verified boundaries, records, then resumes', async () => {
  await withPromoteHarness({}, async ({ calls, home, notifications, repo, run, states }) => {
    const result = await run(['--dry-run']);
    assert.match(result.stdout, /all managed chains are held at clean boundaries/);
    assert.match(result.stdout, /dry run complete/);
    assert.deepEqual(Object.values(states()).map((state) => state.status), ['running', 'running']);

    const events = readFileSync(calls, 'utf8').trim().split('\n');
    const health = events.indexOf('health:ok');
    for (const slug of ['promote-stub-a', 'promote-stub-b']) {
      assert.ok(events.indexOf(`hold:${slug}`) < events.indexOf(`unit-commit:${slug}`));
      assert.ok(events.indexOf(`unit-commit:${slug}`) < events.indexOf(`unit-verify:${slug}`));
      assert.ok(events.indexOf(`unit-verify:${slug}`) < events.indexOf(`held:${slug}`));
      assert.ok(events.indexOf(`held:${slug}`) < health);
      assert.ok(events.indexOf(`release-hold:${slug}`) > health);
      const journal = readFileSync(path.join(home, 'forge-logs', slug, 'JOURNAL.md'), 'utf8');
      assert.match(journal, /^12:00 \| run \| HELD \| promote$/m);
      assert.match(journal, /^\d{2}:\d{2} \| run \| RESUMED \| promote$/m);
    }
    const promoted = notifications.filter((notification) => notification.kind === 'promoted');
    assert.equal(promoted.length, 1);
    assert.equal(promoted[0]?.projectPath, repo);
    assert.equal(promoted[0]?.dryRun, true);
  });
});

test('a 20-second boundary timeout clears holds, notifies, and leaves the unit running', async () => {
  await withPromoteHarness({ neverHold: ['promote-stub-a'] }, async ({ calls, notifications, run, states }) => {
    await assert.rejects(run(['--dry-run']), { code: 1 });
    const state = states()['promote-stub-a'];
    assert.deepEqual(state, { status: 'running', holdRequested: false, holdReason: null });
    assert.match(readFileSync(calls, 'utf8'), /release-hold:promote-stub-a/);
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /pause:|PAUSED|park/);
    const notice = notifications.find((notification) => notification.title === 'Promote timed out waiting for a clean unit boundary');
    assert.equal(notice?.kind, 'decision-needed');
    assert.match(String(notice?.body), /20s/);
  });
});

test('an abort after requesting holds releases every chain through the exit safety net', async () => {
  await withPromoteHarness({}, async ({ calls, run, states }) => {
    await assert.rejects(run(['--dry-run'], { PROMOTE_DRY_RUN_FAIL_AT: 'after-hold' }), { code: 1 });
    assert.deepEqual(Object.values(states()).map((state) => state.status), ['running', 'running']);
    const events = readFileSync(calls, 'utf8').trim().split('\n');
    assert.ok(events.indexOf('release-hold:promote-stub-a') > events.indexOf('hold:promote-stub-a'));
    assert.ok(events.indexOf('release-hold:promote-stub-b') > events.indexOf('hold:promote-stub-b'));
  });
});

test('a failed held-chain resume notifies with the slug while other chains resume', async () => {
  await withPromoteHarness({}, async ({ notifications, run, states }) => {
    await assert.rejects(run(['--dry-run'], { STUB_FAIL_RELEASE_SLUG: 'promote-stub-a' }), { code: 1 });
    assert.equal(states()['promote-stub-a']?.status, 'paused');
    assert.equal(states()['promote-stub-b']?.status, 'running');
    const notice = notifications.find((notification) => String(notification.title).includes('promote-stub-a'));
    assert.equal(notice?.kind, 'decision-needed');
    assert.match(String(notice?.body), /simulated resume refusal/);
  });
});

test('a healthy rollback resumes held chains before reporting rollback', async () => {
  await withPromoteHarness({ health: (attempt) => attempt === 1 || attempt >= 14 }, async ({ calls, notifications, run, states }) => {
    await assert.rejects(run([]), { code: 3 });
    assert.deepEqual(Object.values(states()).map((state) => state.status), ['running', 'running']);
    const events = readFileSync(calls, 'utf8').trim().split('\n');
    const rollbackHealth = events.lastIndexOf('health:ok');
    assert.ok(events.indexOf('release-hold:promote-stub-a') > rollbackHealth);
    assert.ok(events.indexOf('release-hold:promote-stub-b') > rollbackHealth);
    assert.equal(notifications.some((notification) => notification.title === 'Promote rolled back'), true);
  });
});

test('the standalone tag guard remains read-only and refuses a mid-phase chain', async () => {
  await withPromoteHarness({ slugs: ['tag-guard-stub'], neverHold: ['tag-guard-stub'] }, async ({ calls, run }) => {
    await assert.rejects(run(['--tag-guard']), { code: 2 });
    assert.doesNotMatch(readFileSync(calls, 'utf8'), /hold:|release-hold:/);
  });
});
