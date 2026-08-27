import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readCodexLogin } from '../list/codex/codex-auth.provider.js';
import { buildChatgptAccount } from '../services/chatgpt-account.service.js';
import { readCodexRateLimits } from '../services/provider-token-usage.service.js';

// Synthetic id token: a JWT-shaped string built from a plain payload at test
// time. No real token value lives in this file.
const fakeIdToken = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');

const tokenCount = (timestamp: string, rateLimits: unknown) =>
  JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rateLimits } });

test('readCodexRateLimits takes the newest token_count that carries a readable window', () => {
  const content = [
    JSON.stringify({ timestamp: '2026-08-27T10:00:00.000Z', type: 'session_meta', payload: { id: 'x' } }),
    tokenCount('2026-08-27T10:01:00.000Z', {
      limit_id: 'codex',
      primary: { used_percent: 12.5, window_minutes: 300, resets_at: 1_700_000_000 },
      secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1_700_500_000 },
      plan_type: 'plus',
    }),
    tokenCount('2026-08-27T10:02:00.000Z', { limit_id: 'premium', primary: null, secondary: null, plan_type: 'plus' }),
    tokenCount('2026-08-27T10:03:00.000Z', null),
    '{broken',
  ].join('\n');

  assert.deepEqual(readCodexRateLimits(content), {
    at: '2026-08-27T10:01:00.000Z',
    plan: 'plus',
    windows: [
      { windowMinutes: 300, usedPercent: 12.5, resetsAt: 1_700_000_000 },
      { windowMinutes: 10080, usedPercent: 40, resetsAt: 1_700_500_000 },
    ],
  });
  assert.equal(readCodexRateLimits('{"type":"event_msg","payload":{"type":"task_complete"}}'), null);
});

test('buildChatgptAccount maps windows to 5h / 7d meters and reports missing readings', async () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const login = { loggedIn: true, email: 'someone@example.com', plan: 'prolite', tokenExpiresAt: 1_800_000_000 };
  const account = await buildChatgptAccount(login, {
    at: '2026-08-27T11:59:30.000Z',
    plan: 'prolite',
    windows: [{ windowMinutes: 10080, usedPercent: 3, resetsAt: Math.floor(now.getTime() / 1000) + 5 * 86_400 + 14 * 3600 }],
  }, now);

  assert.equal(account.state, 'ok');
  assert.equal(account.email, 'someone@example.com');
  assert.equal(account.plan, 'Pro Lite');
  assert.equal(account.usage?.readAt, '2026-08-27T11:59:30.000Z');
  assert.equal(account.usage?.fiveHour, undefined);
  assert.equal(account.usage?.sevenDay?.pct, 3);
  assert.equal(account.usage?.sevenDay?.countdown, '5d 14h');

  const noReading = await buildChatgptAccount(login, null, now);
  assert.equal(noReading.state, 'ok');
  assert.equal(noReading.usage, null);
});

test('buildChatgptAccount reports logged out and stale logins without meters', async () => {
  const now = new Date('2026-08-27T12:00:00.000Z');
  const reading = { at: '2026-08-27T11:00:00.000Z', plan: 'plus', windows: [{ windowMinutes: 300, usedPercent: 50, resetsAt: 1_800_000_000 }] };

  const loggedOut = await buildChatgptAccount({ loggedIn: false, email: null, plan: null, tokenExpiresAt: null }, reading, now);
  assert.equal(loggedOut.state, 'logged_out');
  assert.equal(loggedOut.usage, null);
  assert.equal(loggedOut.plan, 'Plus');

  const expiredMonthsAgo = Math.floor(now.getTime() / 1000) - 60 * 86_400;
  const stale = await buildChatgptAccount({ loggedIn: true, email: 'a@b.c', plan: 'plus', tokenExpiresAt: expiredMonthsAgo }, reading, now);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.usage, null);

  const expiredYesterday = Math.floor(now.getTime() / 1000) - 86_400;
  const fresh = await buildChatgptAccount({ loggedIn: true, email: 'a@b.c', plan: 'plus', tokenExpiresAt: expiredYesterday }, reading, now);
  assert.equal(fresh.state, 'ok');
});

test('readCodexLogin decodes email and plan from auth.json and treats a missing file as logged out', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'codex-login-'));
  try {
    const authPath = path.join(directory, 'auth.json');
    await writeFile(authPath, JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        id_token: fakeIdToken({ email: 'someone@example.com', 'https://api.openai.com/auth.chatgpt_plan_type': 'pro', exp: 1_800_000_000 }),
        access_token: 'not-a-real-token',
      },
    }));
    assert.deepEqual(await readCodexLogin(authPath), {
      loggedIn: true,
      email: 'someone@example.com',
      plan: 'pro',
      tokenExpiresAt: 1_800_000_000,
    });

    await writeFile(authPath, JSON.stringify({ auth_mode: 'chatgpt', tokens: {} }));
    assert.equal((await readCodexLogin(authPath)).loggedIn, false);
    assert.equal((await readCodexLogin(path.join(directory, 'missing.json'))).loggedIn, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
