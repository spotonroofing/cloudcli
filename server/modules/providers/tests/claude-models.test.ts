import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CLAUDE_PREDEFINED_MODELS,
  ClaudeProviderModels,
  findClaudeContextWindow,
} from '@/modules/providers/list/claude/claude-models.provider.js';

const cliModel = (
  value: string,
  resolvedModel: string,
  displayName: string,
) => ({
  value,
  resolvedModel,
  displayName,
  description: `${displayName} from the installed CLI`,
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] as Array<
    'low' | 'medium' | 'high' | 'xhigh' | 'max'
  >,
});

test('Claude catalog uses installed CLI models while retaining required Fable compatibility choices', async () => {
  const adapter = new ClaudeProviderModels(async () => [
    cliModel('claude-fable-5-1[1m]', 'claude-fable-5-1', 'Fable'),
    cliModel('opus[1m]', 'claude-opus-5[1m]', 'Opus (1M context)'),
    cliModel('sonnet', 'claude-sonnet-5', 'Sonnet'),
  ]);

  const catalog = await adapter.getSupportedModels();

  assert.equal(catalog.DEFAULT, 'claude-fable-5-1');
  assert.equal(catalog.OPTIONS.find((option) => option.value === 'claude-fable-5-1')?.label, 'Claude Fable 5.1');
  assert.equal(catalog.OPTIONS.some((option) => option.value === 'claude-fable-5'), true);
  assert.equal(catalog.OPTIONS.some((option) => option.value === 'claude-opus-5'), true);
  assert.equal(catalog.OPTIONS.some((option) => option.value === 'claude-opus-4-8'), false);
});

test('Claude catalog starts discovery at construction and refreshes from the CLI on the next read', async () => {
  let calls = 0;
  const adapter = new ClaudeProviderModels(async () => {
    calls += 1;
    return calls === 1
      ? [cliModel('sonnet', 'claude-sonnet-5', 'Sonnet')]
      : [cliModel('future', 'claude-sonnet-5-1', 'Sonnet')];
  });

  assert.equal(calls, 1);
  const startupCatalog = await adapter.getSupportedModels();
  assert.equal(startupCatalog.OPTIONS.some((option) => option.value === 'claude-sonnet-5'), true);
  assert.equal(calls, 1);

  const refreshedCatalog = await adapter.getSupportedModels();
  assert.equal(refreshedCatalog.OPTIONS.some((option) => option.value === 'claude-sonnet-5-1'), true);
  assert.equal(refreshedCatalog.OPTIONS.some((option) => option.value === 'claude-sonnet-5'), false);
  assert.equal(calls, 2);
});

test('Claude catalog falls back to the curated list when CLI discovery is unavailable', async () => {
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const adapter = new ClaudeProviderModels(async () => {
      throw new Error('CLI unavailable');
    });
    assert.deepEqual(await adapter.getSupportedModels(), CLAUDE_PREDEFINED_MODELS);
  } finally {
    console.warn = originalWarn;
  }
});

test('Claude Fable 5.1 has a one-million-token catalog window', () => {
  assert.equal(findClaudeContextWindow('claude-fable-5-1'), 1_000_000);
});
