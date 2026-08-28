import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const runnerPath = path.resolve('scripts/macos/dispatch-chain-runner');

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

test('all-dry chain recovery sleeps to reset and marker parking never changes cswap enabled flags', {
  skip: process.platform !== 'darwin',
  timeout: 20_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dispatch-parking-'));
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const home = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  const claudeState = path.join(directory, 'claude-state');
  const cswapCalls = path.join(directory, 'cswap-calls');
  const receivedEvents: Array<{ url: string; body: string }> = [];
  await Promise.all([mkdir(repo), mkdir(bin), mkdir(home)]);
  await mkdir(path.join(home, 'forge-logs'));

  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      receivedEvents.push({ url: request.url ?? '', body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"success":true}');
    });
  });

  try {
    await execFileAsync('/usr/bin/git', ['init', '-q'], { cwd: repo });
    await execFileAsync('/usr/bin/git', ['config', 'user.email', 'stub@example.com'], { cwd: repo });
    await execFileAsync('/usr/bin/git', ['config', 'user.name', 'Usage Stub'], { cwd: repo });
    const phase = path.join(repo, 'job.md');
    await writeFile(phase, '<!-- verify: no -->\n<!-- name: All dry stub -->\nStub phase.\n');
    await execFileAsync('/usr/bin/git', ['add', 'job.md'], { cwd: repo });
    await execFileAsync('/usr/bin/git', ['commit', '-q', '-m', 'stub base'], { cwd: repo });

    await executable(path.join(bin, 'claude'), `#!/bin/zsh
count=0
[[ -f "$STUB_CLAUDE_STATE" ]] && count=$(<"$STUB_CLAUDE_STATE")
count=$((count + 1))
print -r -- "$count" > "$STUB_CLAUDE_STATE"
if [[ $count -eq 1 ]]; then
  print -r -- "spend limit reached"
  exit 1
fi
/usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub recovered"
print -r -- "recovered after reset"
`);
    await executable(path.join(bin, 'codex'), '#!/bin/zsh\nexit 0\n');
    await executable(path.join(bin, 'sleep'), '#!/bin/zsh\nexit 0\n');
    const reset = new Date(Date.now() + 60 * 60_000).toISOString();
    await executable(path.join(bin, 'cswap'), `#!/bin/zsh
print -r -- "$*" >> "$STUB_CSWAP_CALLS"
if [[ "$1" == list ]]; then
  print -r -- '${JSON.stringify({
    activeAccountNumber: 1,
    accounts: [
      { number: 1, email: 'one@example.com', active: true, usage: { fiveHour: { pct: 100, resetsAt: reset } } },
      { number: 2, email: 'two@example.com', active: false, usage: { fiveHour: { pct: 100, resetsAt: reset } } },
    ],
  })}'
fi
`);
    await execFileAsync('/usr/bin/sqlite3', [
      database,
      'CREATE TABLE api_keys (id INTEGER PRIMARY KEY, api_key TEXT, is_active INTEGER); INSERT INTO api_keys VALUES (1,\'stub-key\',1);',
    ]);

    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const environment = {
      ...process.env,
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      DISPATCH_SERVER_URL: `http://127.0.0.1:${address.port}`,
      DISPATCH_DB_PATH: database,
      DISPATCH_ENGINE: 'claude',
      CSWAP_PATH: path.join(bin, 'cswap'),
      STUB_CLAUDE_STATE: claudeState,
      STUB_CSWAP_CALLS: cswapCalls,
      STUB_REPO: repo,
    } as NodeJS.ProcessEnv;
    delete environment.CLAUDE_CONFIG_DIR;

    const result = await execFileAsync('/bin/zsh', [runnerPath, repo, 'usage-stub', phase], {
      cwd: repo,
      env: environment,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(result.stderr, '');

    const calls = await readFile(cswapCalls, 'utf8');
    assert.match(calls, /list --json/);
    assert.doesNotMatch(calls, /(^|\n)(disable|enable)\b/);
    const marker = await readFile(path.join(home, 'forge-logs', 'cswap-parked', '1'), 'utf8');
    assert.match(marker, /^\d{4}-\d{2} one@example\.com\n$/);
    const journal = await readFile(path.join(home, 'forge-logs', 'usage-stub', 'JOURNAL.md'), 'utf8');
    assert.match(journal, /runner marker skips it/);
    assert.match(journal, /no account with 5h headroom; sleeping/);
    assert.match(journal, /re-running job\.md after limit recovery/);
    assert.match(journal, /run \| end \| all 1 phases committed and verified/);
    assert.equal(receivedEvents.some((event) => event.url.endsWith('/events') && event.body.includes('"event": "limit"')), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
