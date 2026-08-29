import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import {
  apiKeysDb,
  appConfigDb,
  closeConnection,
  initializeDatabase,
  projectsDb,
  sessionsDb,
  userDb,
} from '@/modules/database/index.js';

import { createWatchdogRouter, watchdogService } from '../index.js';

const dispatchPath = path.resolve('scripts/macos/dispatch');

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

async function runDispatch(
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ code: number; output: string }> {
  const child = spawn('/bin/zsh', [dispatchPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += String(chunk); });
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const [code] = await once(child, 'exit') as [number];
  return { code, output };
}

async function waitForStatus(
  projectPath: string,
  slug: string,
  status: 'completed' | 'failed',
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (watchdogService.listWorkerRuns(projectPath).chains[slug]?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`chain ${slug} did not become ${status} within ${timeoutMs}ms`);
}

test('manifest-less dispatch compiles phase headers, refuses blank tasks, and remanifest repairs every chain state', {
  skip: process.platform !== 'darwin',
  timeout: 35_000,
}, async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const cleanupDirectory = await mkdtemp(path.join(tmpdir(), 'manifest-chain-'));
  const directory = await realpath(cleanupDirectory);
  const repo = path.join(directory, 'repo');
  const bin = path.join(directory, 'bin');
  const fakeHome = path.join(directory, 'home');
  const database = path.join(directory, 'auth.db');
  const slug = `manifest-stub-${Date.now()}`;
  const registrations: Array<Record<string, unknown>> = [];
  const serviceRuntimeDirectories: string[] = [];
  let server: ReturnType<express.Application['listen']> | null = null;

  closeConnection();
  process.env.DATABASE_PATH = database;
  try {
    await Promise.all([
      mkdir(repo),
      mkdir(bin),
      mkdir(path.join(fakeHome, 'forge-logs'), { recursive: true }),
    ]);
    await initializeDatabase();
    const user = userDb.createUser('manifest-chain-test', 'unused');
    apiKeysDb.createApiKey(Number(user.id), 'manifest-chain-test');
    projectsDb.createProjectPath(repo);
    appConfigDb.set('watchdog_terminal_wakes', '0');
    sessionsDb.createAppSession('manifest-planner', 'codex', repo, 'Manifest planner', 'planner');
    sessionsDb.markSessionBooted('manifest-planner');
    sessionsDb.setSessionBootState('manifest-planner', 'ready');

    const app = express();
    app.use(express.json());
    app.use('/api/watchdog/chains', (req, _res, next) => {
      if (req.method === 'POST' && req.path === '/') {
        registrations.push(req.body as Record<string, unknown>);
      }
      next();
    });
    app.use('/api/watchdog', createWatchdogRouter());
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${address.port}`;

    const git = async (...args: string[]): Promise<void> => {
      const child = spawn('/usr/bin/git', args, { cwd: repo, stdio: 'ignore' });
      const [code] = await once(child, 'exit') as [number];
      assert.equal(code, 0, `git ${args.join(' ')} exited ${code}`);
    };
    await git('init', '-q');
    await git('config', 'user.email', 'stub@example.com');
    await git('config', 'user.name', 'Manifest Stub');

    const punchlist = path.join(repo, 'PUNCHLIST_stub.md');
    const phaseOne = path.join(repo, '01-one.md');
    const phaseTwo = path.join(repo, '02-two.md');
    await writeFile(punchlist, '## Job 1: First real job\n\n- [ ] First task\n- [ ] Second task\n\n## Job 2: Second real job\n\n- [ ] Third task\n\n## Job 3: Explicit manifest\n\n- [ ] Stored task\n');
    await writeFile(phaseOne, '<!-- engine: codex -->\n<!-- verify: no -->\n<!-- name: First real job -->\n<!-- tasks: First task | Second task -->\nExecute Job 1 of PUNCHLIST_stub.md in this repo.\n');
    await writeFile(phaseTwo, '<!-- engine: codex -->\n<!-- verify: no -->\n<!-- name: Second real job -->\n<!-- tasks: Third task -->\nExecute Job 2 of PUNCHLIST_stub.md in this repo.\n');
    await git('add', '.');
    await git('commit', '-q', '-m', 'stub base');

    await executable(path.join(bin, 'codex'), `#!/bin/zsh
output=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "-o" ]]; then output="$2"; shift 2; else shift; fi
done
print -r -- "{\\"type\\":\\"thread.started\\",\\"thread_id\\":\\"manifest-$$\\"}"
/usr/bin/git -C "$STUB_REPO" commit --allow-empty -q -m "stub unit"
print -r -- "done" > "$output"
`);

    const environment = {
      ...process.env,
      HOME: fakeHome,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      CODEX_THREAD_ID: 'manifest-planner',
      DISPATCH_SERVER_URL: serverUrl,
      DISPATCH_DB_PATH: database,
      DISPATCH_ENGINE: 'codex',
      DISPATCH_MODEL: 'gpt-test',
      DISPATCH_MANIFEST: '',
      DISPATCH_RELOADING: '',
      DISPATCH_RESUME_FROM: '',
      DISPATCH_RESUMING: '',
      STUB_REPO: repo,
    } as NodeJS.ProcessEnv;

    const dispatched = await runDispatch([repo, slug, phaseOne, phaseTwo], { cwd: repo, env: environment });
    assert.equal(dispatched.code, 0, dispatched.output);
    await waitForStatus(repo, slug, 'completed');
    assert.deepEqual(registrations[0]?.manifest, JSON.parse(
      await readFile(path.join(fakeHome, 'forge-logs', slug, 'manifest.generated.json'), 'utf8'),
    ));
    const compiled = watchdogService.listWorkerRuns(repo).chains[slug];
    assert.deepEqual(compiled.manifest?.map((entry) => ({
      name: entry.name,
      tasks: entry.tasks,
      anchor: entry.anchor,
    })), [
      { name: 'First real job', tasks: ['First task', 'Second task'], anchor: 'Job 1' },
      { name: 'Second real job', tasks: ['Third task'], anchor: 'Job 2' },
    ]);
    const generated = JSON.parse(await readFile(path.join(fakeHome, 'forge-logs', slug, 'manifest.generated.json'), 'utf8')) as {
      punchlist?: string;
    };
    assert.equal(generated.punchlist, 'PUNCHLIST_stub.md');

    const missingTasks = path.join(repo, '03-missing-tasks.md');
    await writeFile(missingTasks, '<!-- engine: codex -->\n<!-- verify: no -->\n<!-- name: Missing tasks -->\nExecute Job 3 of PUNCHLIST_stub.md in this repo.\n');
    const refused = await runDispatch([repo, `${slug}-blank`, missingTasks], { cwd: repo, env: environment });
    assert.notEqual(refused.code, 0);
    assert.match(refused.output, new RegExp(`phase file ${missingTasks.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} has no tasks`));

    const explicitManifest = path.join(directory, 'explicit-manifest.json');
    await writeFile(explicitManifest, `${JSON.stringify({
      punchlist: 'PUNCHLIST_stub.md',
      entries: [{ name: 'Explicit wins', tasks: ['Stored task'], kind: 'phase', anchor: 'Job 3' }],
    })}\n`);
    await git('add', missingTasks);
    await git('commit', '-q', '-m', 'add explicit-manifest prompt');
    const explicitSlug = `${slug}-explicit`;
    const explicit = await runDispatch([repo, explicitSlug, missingTasks], {
      cwd: repo,
      env: { ...environment, DISPATCH_MANIFEST: explicitManifest },
    });
    assert.equal(explicit.code, 0, explicit.output);
    await waitForStatus(repo, explicitSlug, 'completed');
    assert.equal(watchdogService.listWorkerRuns(repo).chains[explicitSlug].manifest?.[0]?.name, 'Explicit wins');

    const statuses = ['running', 'completed', 'failed'] as const;
    for (const status of statuses) {
      const repairSlug = `${slug}-${status}`;
      const runtime = path.join(homedir(), 'forge-logs', repairSlug);
      serviceRuntimeDirectories.push(runtime);
      await mkdir(runtime, { recursive: true });
      await writeFile(path.join(runtime, 'resume.json'), `${JSON.stringify({ repo, phaseFiles: [phaseOne, phaseTwo] })}\n`);
      watchdogService.registerChain({
        slug: repairSlug,
        projectPath: repo,
        phases: 2,
        manifest: [
          { name: 'Job 1', tasks: [], kind: 'phase' },
          { name: 'Job 2', tasks: [], kind: 'phase' },
        ],
      });
      if (status !== 'running') {
        watchdogService.chainEvent(repairSlug, status, { quiet: true });
      }
      const remanifested = await runDispatch(['remanifest', repo, repairSlug], { cwd: repo, env: environment });
      assert.equal(remanifested.code, 0, remanifested.output);
      const repaired = watchdogService.listWorkerRuns(repo).chains[repairSlug];
      assert.equal(repaired.status, status);
      assert.deepEqual(repaired.manifest?.map((entry) => entry.name), ['First real job', 'Second real job']);
      assert.deepEqual(repaired.manifest?.map((entry) => entry.tasks.length), [2, 1]);
    }

    const amendSlug = `${slug}-amend`;
    watchdogService.registerChain({
      slug: amendSlug,
      projectPath: repo,
      phases: 2,
      manifest: [
        { name: 'Numbered', tasks: ['Old'], kind: 'phase', anchor: 'Job 1' },
        { name: 'Queued', tasks: ['Later'], kind: 'phase', anchor: 'Job 2' },
      ],
    });
    watchdogService.chainEvent(amendSlug, 'phase-start', { phase: 1 });
    const amended = await runDispatch([
      'amend', repo, amendSlug, '1', '--name', 'Executing repair', '--tasks', 'Current one | Current two',
    ], { cwd: repo, env: environment });
    assert.equal(amended.code, 0, amended.output);
    const anchorRefused = await runDispatch([
      'amend', repo, amendSlug, '1', '--anchor', 'Changed anchor',
    ], { cwd: repo, env: environment });
    assert.notEqual(anchorRefused.code, 0);
    assert.match(anchorRefused.output, /has started, so its punch-list anchor cannot change/);
    const executing = watchdogService.listWorkerRuns(repo).chains[amendSlug].manifest?.[0];
    assert.equal(executing?.name, 'Executing repair');
    assert.deepEqual(executing?.tasks, ['Current one', 'Current two']);
    assert.equal(executing?.anchor, 'Job 1');
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    await Promise.all(serviceRuntimeDirectories.map((runtime) => rm(runtime, { recursive: true, force: true })));
    await rm(cleanupDirectory, { recursive: true, force: true });
  }
});
