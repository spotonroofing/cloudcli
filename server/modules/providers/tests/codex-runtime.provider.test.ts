import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCodexRuntimeConfig } from '@/modules/providers/list/codex/codex-runtime.provider.js';

test('Codex runtime selects the fast service tier only when explicitly enabled', () => {
  assert.deepEqual(buildCodexRuntimeConfig(true, undefined), {
    service_tier: 'fast',
    features: { fast_mode: true },
  });
  assert.deepEqual(buildCodexRuntimeConfig(false, undefined), {
    service_tier: 'default',
    features: { fast_mode: true },
  });
});

test('Codex runtime keeps chain MCP isolation alongside the standard tier', () => {
  assert.deepEqual(buildCodexRuntimeConfig(false, 'none'), {
    mcp_servers: {},
    service_tier: 'default',
    features: { fast_mode: true },
  });
});
