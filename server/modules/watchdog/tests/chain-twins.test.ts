import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  UnitIdentityCache,
  hiddenTwinUnits,
  parseUnitIdentity,
  summarizeHidden,
  unitPromptFiles,
  unitStatus,
  type TwinChain,
  type UnitIdentity,
} from '@/modules/watchdog/chain-twins.js';

const chain = (slug: string, status: TwinChain['status'], currentPhase: number, startedAt: number, units: number): TwinChain =>
  ({ slug, projectPath: '/repo', status, currentPhase, startedAt, units });

const keyed = (file: string, jobs: number[]): UnitIdentity[] =>
  jobs.map((job) => ({ key: `${file}#${job}`, supersedes: [] }));

test('unit status derives the jobs list rule from chain state', () => {
  const failed = { status: 'failed' as const, currentPhase: 3 };
  assert.equal(unitStatus(failed, 2), 'completed');
  assert.equal(unitStatus(failed, 3), 'cancelled');
  assert.equal(unitStatus(failed, 4), 'pending');
  assert.equal(unitStatus({ status: 'running', currentPhase: 5 }, 5), 'in-progress');
  assert.equal(unitStatus({ status: 'completed', currentPhase: 4 }, 9), 'completed');
});

test('identity parses the punch list job line and the supersedes header', () => {
  const text = `<!-- browser -->\n<!-- supersedes: ui15r/1, ui15/3 -->\n<!-- name: Jobs view polish -->\nExecute Job 3 of PUNCHLIST_ui15.md in this repo.`;
  assert.deepEqual(parseUnitIdentity(text), { key: 'PUNCHLIST_ui15.md#3', supersedes: ['ui15r/1', 'ui15/3'] });
  assert.deepEqual(parseUnitIdentity('Finish Phase 11 of PUNCHLIST_ui11.md now.'), { key: 'PUNCHLIST_ui11.md#11', supersedes: [] });
  assert.deepEqual(parseUnitIdentity('no job named here'), { key: null, supersedes: [] });
});

test('the ui15 family collapses to one row per punch list job', () => {
  // Live state on 2026-08-27: ui15 failed at 3 of 10, ui15r stopped at 1 of
  // 8 (jobs 3-10), ui15r2 failed at 1 of 10 (job 0, jobs 3-11).
  const chains = [
    chain('ui15', 'failed', 3, 100, 10),
    chain('ui15r', 'stopped', 1, 200, 8),
    chain('ui15r2', 'failed', 1, 300, 10),
  ];
  const identities = (c: TwinChain): UnitIdentity[] => {
    if (c.slug === 'ui15') return keyed('PUNCHLIST_ui15.md', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    if (c.slug === 'ui15r') return keyed('PUNCHLIST_ui15.md', [3, 4, 5, 6, 7, 8, 9, 10]);
    const ids = keyed('PUNCHLIST_ui15.md', [0, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    ids[1] = { ...ids[1], supersedes: ['ui15r/1', 'ui15/3'] };
    return ids;
  };
  const hidden = hiddenTwinUnits(chains, identities);
  const visible = chains.flatMap((c) =>
    Array.from({ length: c.units }, (_, i) => `${c.slug}/${i + 1}`)
      .filter((node) => !hidden.some((h) => `${h.slug}/${h.index}` === node)));
  // Completed jobs 1 and 2 stay on ui15; every later job shows once, on the
  // latest attempt (ui15r2); ui15r vanishes entirely.
  assert.deepEqual(visible, [
    'ui15/1', 'ui15/2',
    'ui15r2/1', 'ui15r2/2', 'ui15r2/3', 'ui15r2/4', 'ui15r2/5', 'ui15r2/6', 'ui15r2/7', 'ui15r2/8', 'ui15r2/9', 'ui15r2/10',
  ]);
  assert.equal(hidden.length, 16);
  assert.equal(summarizeHidden(hidden), 'ui15 8, ui15r 8');
  assert.equal(hidden.find((h) => h.slug === 'ui15' && h.index === 3)?.supersededBy, 'ui15r2/2');
});

test('a running rerun wins over the stopped original and completed twins are never hidden', () => {
  // codex stopped at 1 of 4; codexint running job 5 of 5 (jobs 1-4 completed).
  const chains = [chain('codexint', 'running', 5, 200, 5), chain('codex', 'stopped', 1, 100, 4)];
  const identities = (c: TwinChain) =>
    keyed('PUNCHLIST_codex.md', c.slug === 'codex' ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]);
  const hidden = hiddenTwinUnits(chains, identities);
  assert.deepEqual(hidden.map((h) => `${h.slug}/${h.index}`), ['codex/1', 'codex/2', 'codex/3', 'codex/4']);
  assert.equal(hidden[0].supersededBy, 'codexint/1');

  // Two completed twins both stay (the earlier one is the representative).
  const both = [chain('a', 'completed', 2, 100, 2), chain('b', 'completed', 2, 200, 2)];
  assert.deepEqual(hiddenTwinUnits(both, () => keyed('P.md', [1, 2])), []);
});

test('a running chain queued unit beats a dead chain and units without identity are untouched', () => {
  const chains = [chain('old', 'failed', 2, 100, 3), chain('new', 'running', 1, 200, 3)];
  const identities = (c: TwinChain) => (c.slug === 'old' ? keyed('P.md', [1, 2, 3]) : keyed('P.md', [2, 3, 4]));
  const hidden = hiddenTwinUnits(chains, identities);
  // old/2 (cancelled) and old/3 (pending) hide behind new/1 (running) and
  // new/2 (queued on a running chain); old/1 is completed and unique.
  assert.deepEqual(hidden.map((h) => `${h.slug}/${h.index}->${h.supersededBy}`), ['old/2->new/1', 'old/3->new/2']);
  assert.deepEqual(hiddenTwinUnits(chains, () => [{ key: null, supersedes: [] }, { key: null, supersedes: [] }, { key: null, supersedes: [] }]), []);
});

test('prompt files resolve from .dispatch in order plus consumed appends, cached by folder mtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-twins-'));
  const repo = path.join(root, 'repo');
  const forge = path.join(root, 'forge');
  const dispatch = path.join(repo, '.dispatch', 'demo');
  const consumed = path.join(forge, 'demo', 'append', 'consumed');
  fs.mkdirSync(dispatch, { recursive: true });
  fs.mkdirSync(consumed, { recursive: true });
  fs.writeFileSync(path.join(dispatch, '02-b.md'), 'Execute Job 2 of PUNCHLIST_x.md');
  fs.writeFileSync(path.join(dispatch, '01-a.md'), '<!-- name: A -->\nExecute Job 1 of PUNCHLIST_x.md');
  fs.writeFileSync(path.join(dispatch, 'manifest.json'), '[]');
  // A consumed append the dispatch folder already holds is skipped; a new one lands last.
  fs.writeFileSync(path.join(consumed, '1787852091-1.phase.02-b.md'), 'Execute Job 2 of PUNCHLIST_x.md');
  fs.writeFileSync(path.join(consumed, '1787852999-1.task.extra.md'), 'Execute Job 9 of PUNCHLIST_x.md');

  assert.deepEqual(
    unitPromptFiles(repo, 'demo', forge).map((file) => path.basename(file)),
    ['01-a.md', '02-b.md', '1787852999-1.task.extra.md'],
  );
  const cache = new UnitIdentityCache(forge);
  const chainInfo = { slug: 'demo', projectPath: repo, units: 4 };
  const first = cache.identities(chainInfo);
  assert.deepEqual(first.map((id) => id.key), ['PUNCHLIST_x.md#1', 'PUNCHLIST_x.md#2', 'PUNCHLIST_x.md#9', null]);
  assert.equal(cache.identities(chainInfo), first, 'unchanged folders return the cached identities');
  assert.deepEqual(new UnitIdentityCache(forge).identities({ slug: 'missing', projectPath: repo, units: 2 }).map((id) => id.key), [null, null]);
  fs.rmSync(root, { recursive: true, force: true });
});
