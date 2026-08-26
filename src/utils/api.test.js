import assert from 'node:assert/strict';
import test from 'node:test';

import { isAuthTokenExpired, TOKEN_EXPIRY_SKEW_MS } from './api.js';

// Builds a JWT-shaped string (header.payload.signature, base64url segments) without
// needing a real signing library — isAuthTokenExpired() never verifies the signature,
// it only decodes the payload, so the header/signature segments are placeholders.
const makeToken = (payload) => {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

test('isAuthTokenExpired: a token well before its exp is not expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now - 60, exp: now + 600 }); // 10 min from now
  assert.equal(isAuthTokenExpired(token), false);
});

test('isAuthTokenExpired: a token expired within the clock-skew tolerance is not treated as expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ iat: now - 600, exp: now - Math.floor(skewSeconds / 2) });
  assert.equal(isAuthTokenExpired(token), false);
});

test('isAuthTokenExpired: a token expired just past the clock-skew tolerance is expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const skewSeconds = TOKEN_EXPIRY_SKEW_MS / 1000;
  const token = makeToken({ iat: now - 600, exp: now - skewSeconds - 5 });
  assert.equal(isAuthTokenExpired(token), true);
});

test('isAuthTokenExpired: a token expired well past the skew tolerance is expired', () => {
  const now = Math.floor(Date.now() / 1000);
  const token = makeToken({ iat: now - 600, exp: now - 600 }); // 10 min ago
  assert.equal(isAuthTokenExpired(token), true);
});

test('isAuthTokenExpired: a malformed/unreadable token is unaffected by the skew change', () => {
  // readTokenClaims() returns null for these, so isAuthTokenExpired() short-circuits
  // to false regardless of TOKEN_EXPIRY_SKEW_MS — behaviour unchanged by this fix.
  assert.equal(isAuthTokenExpired('not-a-jwt'), false);
  assert.equal(isAuthTokenExpired('only.two-segments'), false);
  assert.equal(isAuthTokenExpired(null), false);
});

// In-flight GET sharing (ui13 job 15): concurrent identical GETs collapse into
// one network request; anything else (POST, aborted, or settled) fetches anew.
const withMockFetch = async (run) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return Promise.resolve(new Response(JSON.stringify({ url, n: calls.length }), {
      headers: { 'Content-Type': 'application/json' },
    }));
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
  }
};

test('authenticatedFetch: concurrent identical GETs share one request and each caller can read the body', async () => {
  const { authenticatedFetch } = await import('./api.js');
  await withMockFetch(async (calls) => {
    const [a, b, c] = await Promise.all([
      authenticatedFetch('/api/providers/capabilities'),
      authenticatedFetch('/api/providers/capabilities'),
      authenticatedFetch('/api/providers/capabilities'),
    ]);
    assert.equal(calls.length, 1);
    const bodies = await Promise.all([a.json(), b.json(), c.json()]);
    assert.deepEqual(bodies.map((body) => body.n), [1, 1, 1]);
  });
});

test('authenticatedFetch: sequential GETs after settling, POSTs, and aborted requests are never shared', async () => {
  const { authenticatedFetch } = await import('./api.js');
  await withMockFetch(async (calls) => {
    await authenticatedFetch('/api/commands/list');
    await authenticatedFetch('/api/commands/list');
    assert.equal(calls.length, 2);

    await Promise.all([
      authenticatedFetch('/api/settings/preferences', { method: 'PUT', body: '{}' }),
      authenticatedFetch('/api/settings/preferences', { method: 'PUT', body: '{}' }),
    ]);
    assert.equal(calls.length, 4);

    const controller = new AbortController();
    await Promise.all([
      authenticatedFetch('/api/providers/sessions/x/messages', { signal: controller.signal }),
      authenticatedFetch('/api/providers/sessions/x/messages', { signal: controller.signal }),
    ]);
    assert.equal(calls.length, 6);
  });
});
