/**
 * Twin units across dispatch chains (codex job 5): a rerun chain (ui15r,
 * ui15r2, codexint) carries the same punch-list jobs as the chain it resumes,
 * so jobs history would list one job several times. A unit's identity is the
 * punch list file and job number its prompt file names ("Execute Job 3 of
 * PUNCHLIST_ui15.md", "Finish Phase 11 of PUNCHLIST_ui11.md"), or an explicit
 * `<!-- supersedes: slug/n, slug/n -->` header. Within a twin group the
 * representative is the unit that is running, else the first-run completed
 * one, else the latest attempt; every other failed, stopped or never-reached
 * twin is marked hidden on its snapshot. Rows are never deleted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TwinChainStatus = 'running' | 'completed' | 'stopped' | 'failed';

/** The chain fields twin grouping reads; a projection of the watchdog's record. */
export type TwinChain = {
  slug: string;
  projectPath: string;
  status: TwinChainStatus;
  currentPhase: number | null;
  startedAt: number;
  /** Unit count: manifest length, else the runner-reported phase count. */
  units: number;
};

export type UnitStatus = 'completed' | 'in-progress' | 'cancelled' | 'pending';

export type UnitIdentity = {
  /** `PUNCHLIST_ui15.md#3` — the punch list file and job section; null when unknown. */
  key: string | null;
  /** Explicit twins named by a `supersedes` header, as `slug/n`. */
  supersedes: string[];
};

export type HiddenUnit = { slug: string; index: number; supersededBy: string };

const JOB_PATTERN = /\b(?:Job|Phase)\s+(\d+)\s+of\s+(PUNCHLIST_[\w.-]+\.md)/;
const SUPERSEDES_PATTERN = /<!--\s*supersedes:\s*([\s\S]*?)\s*-->/i;

/** The per-unit status the jobs list derives from a chain's state. */
export function unitStatus(chain: Pick<TwinChain, 'status' | 'currentPhase'>, index: number): UnitStatus {
  const current = chain.currentPhase ?? 0;
  if (chain.status === 'completed' || index < current) {
    return 'completed';
  }
  if (index === current) {
    return chain.status === 'running' ? 'in-progress' : 'cancelled';
  }
  return 'pending';
}

/** Identity of one prompt file's unit from its header and body. */
export function parseUnitIdentity(text: string): UnitIdentity {
  const job = JOB_PATTERN.exec(text);
  const supersedesMatch = SUPERSEDES_PATTERN.exec(text);
  const supersedes = supersedesMatch
    ? supersedesMatch[1]
        .split(',')
        .map((item) => item.trim())
        .filter((item) => /^[\w.-]+\/\d+$/.test(item))
    : [];
  return { key: job ? `${job[2]}#${Number(job[1])}` : null, supersedes };
}

/**
 * The prompt files behind a chain's units, in unit order: `.dispatch/<slug>`
 * in lexical order (the dispatch script's own order), then the appends the
 * runner consumed from `~/forge-logs/<slug>/append/consumed` (named
 * `<stamp>-<i>.<kind>.<file>`), skipping any the dispatch folder already
 * holds a copy of.
 */
export function unitPromptFiles(projectPath: string, slug: string, forgeRoot = path.join(os.homedir(), 'forge-logs')): string[] {
  const dispatchDir = path.join(projectPath, '.dispatch', slug);
  const files = listMarkdown(dispatchDir);
  const known = new Set(files.map((file) => path.basename(file)));
  const consumedDir = path.join(forgeRoot, slug, 'append', 'consumed');
  for (const file of listMarkdown(consumedDir)) {
    const original = path.basename(file).replace(/^\d+-\d+\.(?:phase|task)\./, '');
    if (known.has(original)) {
      continue;
    }
    known.add(original);
    files.push(file);
  }
  return files;
}

function listMarkdown(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

const EMPTY_IDENTITY: UnitIdentity = { key: null, supersedes: [] };

/**
 * Identities for a chain's units read off disk, cached per chain against
 * the two folders' mtimes (prompt files never change after dispatch; the
 * folders do when a unit is appended).
 */
export class UnitIdentityCache {
  private readonly entries = new Map<string, { signature: string; identities: UnitIdentity[] }>();

  constructor(private readonly forgeRoot = path.join(os.homedir(), 'forge-logs')) {}

  identities(chain: Pick<TwinChain, 'slug' | 'projectPath' | 'units'>): UnitIdentity[] {
    const dispatchDir = path.join(chain.projectPath, '.dispatch', chain.slug);
    const consumedDir = path.join(this.forgeRoot, chain.slug, 'append', 'consumed');
    const signature = `${mtime(dispatchDir)}|${mtime(consumedDir)}|${chain.units}`;
    const cached = this.entries.get(chain.slug);
    if (cached && cached.signature === signature) {
      return cached.identities;
    }
    const files = unitPromptFiles(chain.projectPath, chain.slug, this.forgeRoot);
    const identities: UnitIdentity[] = [];
    for (let index = 0; index < chain.units; index++) {
      const file = files[index];
      if (!file) {
        identities.push(EMPTY_IDENTITY);
        continue;
      }
      try {
        identities.push(parseUnitIdentity(fs.readFileSync(file, 'utf8')));
      } catch {
        identities.push(EMPTY_IDENTITY);
      }
    }
    this.entries.set(chain.slug, { signature, identities });
    return identities;
  }
}

function mtime(dir: string): number {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

type TwinUnit = {
  slug: string;
  index: number;
  status: UnitStatus;
  chainRunning: boolean;
  chainStartedAt: number;
};

/**
 * The units to hide across one project's chains. `identities` yields the
 * per-unit identity of a chain (index 0 = unit 1).
 */
export function hiddenTwinUnits(
  chains: TwinChain[],
  identities: (chain: TwinChain) => UnitIdentity[],
): HiddenUnit[] {
  // Union-find over unit nodes and identity keys: a punch-list key joins the
  // units that name it; a supersedes header joins the two units directly.
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    if (!parent.has(root)) {
      parent.set(root, root);
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      parent.set(ra, rb);
    }
  };

  const units = new Map<string, TwinUnit>();
  for (const chain of chains) {
    const ids = identities(chain);
    for (let index = 1; index <= chain.units; index++) {
      const node = `${chain.slug}/${index}`;
      units.set(node, {
        slug: chain.slug,
        index,
        status: unitStatus(chain, index),
        chainRunning: chain.status === 'running',
        chainStartedAt: chain.startedAt,
      });
      const identity = ids[index - 1] ?? EMPTY_IDENTITY;
      if (identity.key) {
        union(node, `key:${identity.key}`);
      }
      for (const twin of identity.supersedes) {
        union(node, twin);
      }
    }
  }

  const groups = new Map<string, TwinUnit[]>();
  for (const [node, unit] of units) {
    const root = find(node);
    const group = groups.get(root) ?? [];
    group.push(unit);
    groups.set(root, group);
  }

  const hidden: HiddenUnit[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const winner = [...group].sort(compareRepresentative)[0];
    for (const unit of group) {
      if (unit === winner || unit.status === 'completed' || unit.status === 'in-progress') {
        continue;
      }
      hidden.push({ slug: unit.slug, index: unit.index, supersededBy: `${winner.slug}/${winner.index}` });
    }
  }
  return hidden;
}

/**
 * Representative order: the running unit, else the completed one that ran
 * first, else the latest attempt (a running chain's queued unit before a dead
 * chain's) — the row that tells the truth about the job.
 */
function rank(unit: TwinUnit): number {
  if (unit.status === 'in-progress') return 4;
  if (unit.status === 'completed') return 3;
  return unit.chainRunning ? 2 : 1;
}

function compareRepresentative(a: TwinUnit, b: TwinUnit): number {
  const byRank = rank(b) - rank(a);
  if (byRank !== 0) {
    return byRank;
  }
  // Two live or completed twins: whichever chain ran first. Two dead or
  // queued twins: the latest attempt.
  return rank(a) >= 3 ? a.chainStartedAt - b.chainStartedAt : b.chainStartedAt - a.chainStartedAt;
}

/** One-line hidden-row count per chain, for the log. */
export function summarizeHidden(hidden: HiddenUnit[]): string {
  const counts = new Map<string, number>();
  for (const unit of hidden) {
    counts.set(unit.slug, (counts.get(unit.slug) ?? 0) + 1);
  }
  return [...counts.entries()].map(([slug, count]) => `${slug} ${count}`).join(', ');
}
