import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findUnpushedHandoff } from '@/modules/watchdog/handoff-push.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' }).toString();

test('handoff push check: clean and pushed is null; a failed push and uncommitted files are reported', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-push-'));
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'memory');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, repo);
  fs.mkdirSync(path.join(repo, 'planner', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'planner', 'demo', 'STATE.md'), 'now\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'handoff: demo');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  assert.equal(await findUnpushedHandoff(repo, 'demo'), null);

  // Forced push failure: the push URL points nowhere, the commit stays local.
  git(repo, 'remote', 'set-url', '--push', 'origin', path.join(root, 'missing.git'));
  fs.writeFileSync(path.join(repo, 'planner', 'demo', 'STATE.md'), 'later\n');
  git(repo, 'commit', '-q', '-am', 'handoff: demo again');
  assert.throws(() => git(repo, 'push', '-q'));
  assert.match((await findUnpushedHandoff(repo, 'demo')) ?? '', /1 commit\(s\) are not pushed/);

  fs.writeFileSync(path.join(repo, 'planner', 'demo', 'PROJECT.md'), 'draft\n');
  assert.match((await findUnpushedHandoff(repo, 'demo')) ?? '', /planner\/demo has 1 uncommitted file/);

  fs.rmSync(root, { recursive: true, force: true });
});
