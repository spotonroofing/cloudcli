import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createProviderTokenUsageService } from '@/modules/providers/services/provider-token-usage.service.js';
import { AppError } from '@/shared/utils.js';

function createSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'app-session',
    provider: 'claude',
    provider_session_id: 'provider-session',
    project_path: null,
    assigned_project_path: null,
    origin: null,
    base_commit: null,
    chain_slug: null,
    chain_phase: null,
    booted: 0,
    boot_state: null,
    jsonl_path: null,
    custom_name: null,
    model: null,
    effort: null,
    isArchived: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('token usage lookup requires only the app-facing session id for Claude', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-claude-'));
  const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');

  try {
    await writeFile(sessionFilePath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 5,
            output_tokens: 30,
          },
        },
      }),
      '{incomplete',
    ].join('\n'));

    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({ jsonl_path: sessionFilePath }),
      getClaudeContextWindow: () => '180000',
    });

    assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
      used: 155,
      total: 180_000,
      inputTokens: 125,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      cacheTokens: 25,
      breakdown: { input: 125, output: 30 },
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Claude token usage skips trailing sidechain (subagent) rows', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-sidechain-'));
  const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');

  try {
    await writeFile(sessionFilePath, [
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 200,
            cache_read_input_tokens: 50_000,
            cache_creation_input_tokens: 1_000,
            output_tokens: 400,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        message: {
          usage: {
            input_tokens: 10,
            cache_read_input_tokens: 500,
            cache_creation_input_tokens: 0,
            output_tokens: 20,
          },
        },
      }),
    ].join('\n'));

    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({ jsonl_path: sessionFilePath }),
      getClaudeContextWindow: () => '180000',
    });

    const result = await service.getSessionTokenUsage('app-session');
    assert.equal(result.used, 51_600);
    assert.equal(result.inputTokens, 51_200);
    assert.equal(result.outputTokens, 400);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Claude job tokens sum unique message usage across the whole transcript', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-job-token-usage-claude-'));
  const sessionFilePath = path.join(tempDirectory, 'provider-session.jsonl');

  try {
    const repeatedUsage = {
      input_tokens: 100,
      cache_read_input_tokens: 1_000,
      cache_creation_input_tokens: 50,
      output_tokens: 25,
    };
    await writeFile(sessionFilePath, [
      JSON.stringify({ uuid: 'thinking-block', message: { id: 'message-1', usage: repeatedUsage } }),
      JSON.stringify({ uuid: 'text-block', message: { id: 'message-1', usage: repeatedUsage } }),
      JSON.stringify({
        uuid: 'message-2',
        message: {
          id: 'message-2',
          usage: { input_tokens: 20, cache_read_input_tokens: 200, output_tokens: 5 },
        },
      }),
      '{incomplete',
    ].join('\n'));

    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({ jsonl_path: sessionFilePath }),
    });

    assert.deepEqual(await service.getJobTokenUsage('app-session'), {
      totalTokens: 1_400,
      inputTokens: 1_370,
      outputTokens: 30,
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Codex token usage uses the latest turn rather than cumulative rollout usage', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-codex-'));
  const sessionFilePath = path.join(tempDirectory, 'rollout-provider-session.jsonl');

  try {
    await writeFile(sessionFilePath, [
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 110, output_tokens: 14, total_tokens: 124 },
            last_token_usage: {
              input_tokens: 10,
              cached_input_tokens: 6,
              output_tokens: 4,
              reasoning_output_tokens: 1,
              total_tokens: 14,
            },
            model_context_window: 100_000,
          },
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 4_000, output_tokens: 900, total_tokens: 4_900 },
            last_token_usage: {
              input_tokens: 40,
              cached_input_tokens: 25,
              output_tokens: 9,
              reasoning_output_tokens: 3,
              total_tokens: 49,
            },
            model_context_window: 250_000,
          },
        },
      }),
    ].join('\n'));

    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({
        provider: 'codex',
        jsonl_path: sessionFilePath,
      }),
    });

    assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
      provider: 'codex',
      readingAvailable: true,
      used: 49,
      total: 250_000,
      inputTokens: 40,
      outputTokens: 9,
      cachedInputTokens: 25,
      freshInputTokens: 15,
      reasoningTokens: 3,
      breakdown: { input: 40, output: 9 },
    });
    assert.deepEqual(await service.getJobTokenUsage('app-session'), {
      totalTokens: 4_900,
      inputTokens: 4_000,
      outputTokens: 900,
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Codex token usage reports no reading before the first token_count event', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => createSessionRow({
      provider: 'codex',
      jsonl_path: '/tmp/codex-session.jsonl',
    }),
    fileExists: () => true,
    readTextFile: async () => JSON.stringify({ type: 'session_meta', payload: { id: 'provider-session' } }),
  });

  assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
    provider: 'codex',
    readingAvailable: false,
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
  });
});

test('OpenCode token usage resolves its provider-native id from the session row', async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'provider-token-usage-opencode-'));
  const databasePath = path.join(tempDirectory, 'opencode.db');
  const database = new Database(databasePath);

  try {
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        tokens_input INTEGER,
        tokens_output INTEGER,
        tokens_reasoning INTEGER,
        tokens_cache_read INTEGER,
        tokens_cache_write INTEGER
      )
    `);
    database.prepare(`
      INSERT INTO session (
        id,
        tokens_input,
        tokens_output,
        tokens_reasoning,
        tokens_cache_read,
        tokens_cache_write
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run('provider-session', 12, 7, 3, 5, 2);
  } finally {
    database.close();
  }

  try {
    const service = createProviderTokenUsageService({
      getSessionById: () => createSessionRow({ provider: 'opencode' }),
      getOpenCodeDatabasePath: () => databasePath,
    });

    assert.deepEqual(await service.getSessionTokenUsage('app-session'), {
      used: 29,
      inputTokens: 17,
      outputTokens: 7,
      breakdown: { input: 17, output: 7 },
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test('Cursor returns an explicit unsupported token usage result', async () => {
  const service = createProviderTokenUsageService({
    getSessionById: () => createSessionRow({ provider: 'cursor' }),
  });

  const result = await service.getSessionTokenUsage('app-session');

  assert.equal(result.unsupported, true);
  assert.equal(result.used, 0);
  assert.equal(result.total, 0);
});

test('token usage reports SESSION_NOT_FOUND for an unknown app session id', async () => {
  const service = createProviderTokenUsageService({ getSessionById: () => null });

  await assert.rejects(
    () => service.getSessionTokenUsage('missing-session'),
    (error: unknown) => (
      error instanceof AppError
      && error.code === 'SESSION_NOT_FOUND'
      && error.statusCode === 404
    ),
  );
});
