import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveLocalFile } from '@/modules/assets/services/local-files.service.js';

async function makeWorkspace(): Promise<{ root: string; outside: string }> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'local-files-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'elsewhere');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, 'PUNCHLIST.md'), '# punch list\n');
  await fs.writeFile(path.join(root, 'shot.png'), 'not really a png');
  await fs.writeFile(path.join(outside, 'secrets.env'), 'TOKEN=nope\n');
  return { root, outside };
}

test('a file inside the project workspace resolves with its name, size and kind', async () => {
  const { root } = await makeWorkspace();

  const relative = await resolveLocalFile('PUNCHLIST.md', root);
  assert.equal(relative.status, 'ok');
  assert.equal(relative.status === 'ok' && relative.name, 'PUNCHLIST.md');
  assert.equal(relative.status === 'ok' && relative.kind, 'text');
  assert.equal(relative.status === 'ok' && relative.size, '# punch list\n'.length);

  const absolute = await resolveLocalFile(path.join(root, 'shot.png'), root);
  assert.equal(absolute.status, 'ok');
  assert.equal(absolute.status === 'ok' && absolute.kind, 'image');
});

test('paths outside the allowed roots are refused, including through traversal and symlinks', async () => {
  const { root, outside } = await makeWorkspace();

  assert.equal((await resolveLocalFile(path.join(outside, 'secrets.env'), root)).status, 'missing');
  assert.equal((await resolveLocalFile('../elsewhere/secrets.env', root)).status, 'missing');

  await fs.symlink(path.join(outside, 'secrets.env'), path.join(root, 'linked.env'));
  assert.equal((await resolveLocalFile('linked.env', root)).status, 'missing');
});

test('a missing file, a directory, and an empty path never resolve', async () => {
  const { root } = await makeWorkspace();

  assert.equal((await resolveLocalFile('nope.md', root)).status, 'missing');
  assert.equal((await resolveLocalFile('.', root)).status, 'missing');
  assert.equal((await resolveLocalFile('', root)).status, 'invalid');
});
