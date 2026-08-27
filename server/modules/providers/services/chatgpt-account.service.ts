import { promises as fsPromises } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { WS_OPEN_STATE, connectedClients } from '@/modules/websocket/index.js';

import { readCodexLogin } from '../list/codex/codex-auth.provider.js';

import { readCodexRateLimits } from './provider-token-usage.service.js';
import type { CodexRateLimitReading } from './provider-token-usage.service.js';

/**
 * The ChatGPT login next to the Claude accounts (codex job 3). One login, no
 * switch controls; its meters come from Codex's own rollout files (the
 * `rate_limits` block on `token_count` events under ~/.codex/sessions), never
 * from cswap and never invented: when no rollout carries a reading, usage is
 * null and the panel says so.
 */

export type ChatgptWindow = {
  pct: number;
  resetsAt: string;
  countdown: string;
  clock: string;
};

export type ChatgptAccount = {
  email: string | null;
  plan: string | null;
  /** `stale`: the id token expired long enough ago that nothing has refreshed it. */
  state: 'ok' | 'logged_out' | 'stale';
  usage: {
    fiveHour?: ChatgptWindow;
    sevenDay?: ChatgptWindow;
    /** Timestamp of the rollout event the meters come from. */
    readAt: string;
  } | null;
};

/** Codex refreshes the id token on every run; one expired this long ago has had no run refresh it. */
const STALE_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;

const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

const planName = (slug: string | null): string | null =>
  slug ? PLAN_NAMES[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1) : null;

/** Same shape as cswap's meters: "36m", "3h 12m", "5d 14h"; clock "14:40" today, "Sep 2 05:00" otherwise. */
const formatReset = (resetsAtMs: number, now: Date): { countdown: string; clock: string } => {
  const remainingMinutes = Math.max(0, Math.round((resetsAtMs - now.getTime()) / 60_000));
  const days = Math.floor(remainingMinutes / 1440);
  const hours = Math.floor((remainingMinutes % 1440) / 60);
  const minutes = remainingMinutes % 60;
  const countdown = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  const resetsAt = new Date(resetsAtMs);
  const time = resetsAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sameDay = resetsAt.toDateString() === now.toDateString();
  const clock = sameDay
    ? time
    : `${resetsAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
  return { countdown, clock };
};

const toWindow = (reading: CodexRateLimitReading, minutes: number, now: Date): ChatgptWindow | undefined => {
  const window = reading.windows.find((candidate) => candidate.windowMinutes === minutes);
  if (!window) {
    return undefined;
  }
  const resetsAtMs = window.resetsAt * 1000;
  return {
    pct: window.usedPercent,
    resetsAt: new Date(resetsAtMs).toISOString(),
    ...formatReset(resetsAtMs, now),
  };
};

/** Newest reading seen so far; the floor every rescan and watcher event compares against. */
let latest: CodexRateLimitReading | null = null;

const isNewer = (reading: CodexRateLimitReading | null): reading is CodexRateLimitReading =>
  reading !== null && (latest === null || reading.at > latest.at);

async function listRolloutFiles(directory: string, files: Array<{ filePath: string; mtimeMs: number }>) {
  let entries;
  try {
    entries = await fsPromises.readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await listRolloutFiles(entryPath, files);
    } else if (entry.name.endsWith('.jsonl')) {
      try {
        files.push({ filePath: entryPath, mtimeMs: (await fsPromises.stat(entryPath)).mtimeMs });
      } catch {
        // Removed between readdir and stat.
      }
    }
  }
  return files;
}

/**
 * Finds the newest reading across every rollout, newest file first. A file's
 * events are no newer than its mtime, so once a file is older than the best
 * reading in hand the rest cannot beat it; a rescan with a cached floor only
 * reads what changed since.
 */
async function scanRollouts(sessionsDir: string): Promise<void> {
  const files = (await listRolloutFiles(sessionsDir, [])).sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const file of files) {
    if (latest && file.mtimeMs <= Date.parse(latest.at)) {
      break;
    }
    try {
      const reading = readCodexRateLimits(await fsPromises.readFile(file.filePath, 'utf8'));
      if (isNewer(reading)) {
        latest = reading;
      }
    } catch {
      // Unreadable rollout: not a reading.
    }
  }
}

export async function buildChatgptAccount(
  login: Awaited<ReturnType<typeof readCodexLogin>>,
  reading: CodexRateLimitReading | null,
  now = new Date(),
): Promise<ChatgptAccount> {
  const plan = planName(login.plan ?? reading?.plan ?? null);
  if (!login.loggedIn) {
    return { email: login.email, plan, state: 'logged_out', usage: null };
  }
  if (login.tokenExpiresAt !== null && login.tokenExpiresAt * 1000 + STALE_TOKEN_MS < now.getTime()) {
    return { email: login.email, plan, state: 'stale', usage: null };
  }
  return {
    email: login.email,
    plan,
    state: 'ok',
    usage: reading
      ? {
        fiveHour: toWindow(reading, 300, now),
        sevenDay: toWindow(reading, 10_080, now),
        readAt: reading.at,
      }
      : null,
  };
}

/** The ChatGPT entry for `/api/accounts`: a fresh login read plus a rescan of rollouts newer than the last reading. */
export async function getChatgptAccount(): Promise<ChatgptAccount> {
  await scanRollouts(path.join(os.homedir(), '.codex', 'sessions'));
  return buildChatgptAccount(await readCodexLogin(), latest);
}

/**
 * Watcher hook: a rollout file changed. If it carries a newer reading than
 * the one in hand, push the ChatGPT entry to every open client.
 */
export async function noteCodexRollout(filePath: string): Promise<void> {
  let reading: CodexRateLimitReading | null;
  try {
    reading = readCodexRateLimits(await fsPromises.readFile(filePath, 'utf8'));
  } catch {
    return;
  }
  if (!isNewer(reading)) {
    return;
  }
  latest = reading;
  const frame = JSON.stringify({
    kind: 'chatgpt_usage',
    chatgpt: await buildChatgptAccount(await readCodexLogin(), latest),
    timestamp: new Date().toISOString(),
  });
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      client.send(frame);
    }
  });
}
