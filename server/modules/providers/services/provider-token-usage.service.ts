import fsSync, { type Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { appConfigDb, sessionsDb } from '@/modules/database/index.js';
import { findClaudeContextWindow } from '@/modules/providers/list/claude/claude-models.provider.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError, getClaudeConfigDir, getOpenCodeDatabasePath } from '@/shared/utils.js';

type SessionRow = NonNullable<ReturnType<typeof sessionsDb.getSessionById>>;

type ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId: string) => SessionRow | null | undefined;
  getHomeDirectory: () => string;
  getOpenCodeDatabasePath: () => string;
  fileExists: (filePath: string) => boolean;
  readDirectory: (directoryPath: string) => Promise<Dirent[]>;
  readTextFile: (filePath: string) => Promise<string>;
  getClaudeContextWindow: () => string | undefined;
  getPersistedClaudeWindow: (model: string) => PersistedClaudeWindow | null;
};

type PersistedClaudeWindow = {
  total: number;
  totalIsUsableWindow?: boolean;
};

type TokenUsageResult = {
  provider?: 'codex';
  readingAvailable?: boolean;
  used: number;
  total?: number;
  totalIsUsableWindow?: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  freshInputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cacheTokens?: number;
  breakdown: {
    input: number;
    output: number;
  };
  unsupported?: boolean;
  message?: string;
};

/**
 * A dispatched run's cost, split so the cache never inflates it (ui17 job 19).
 * A Claude turn re-reads the whole context from cache, so summing cache reads
 * across a run turned 133k of real output into a 12-14 million "spent" figure
 * fifteen minutes into a unit.
 */
type JobTokenUsageResult = {
  /** Fresh input plus output: what the run actually spent. */
  totalTokens: number;
  /** Fresh input only: new prompt content and cache writes. */
  inputTokens: number;
  outputTokens: number;
  /** Context re-read from cache, never summed into the spend. */
  cacheReadTokens: number;
};

type OpenCodeTokenRow = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

const defaultDependencies: ProviderTokenUsageServiceDependencies = {
  getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
  getHomeDirectory: () => os.homedir(),
  getOpenCodeDatabasePath,
  fileExists: (filePath) => fsSync.existsSync(filePath),
  readDirectory: (directoryPath) => fsp.readdir(directoryPath, { withFileTypes: true }),
  readTextFile: (filePath) => fsp.readFile(filePath, 'utf8'),
  getClaudeContextWindow: () => process.env.CONTEXT_WINDOW,
  // The Claude runtime provider persists the SDK-reported window per model id
  // whenever a live turn observes it, so idle and historical sessions get the
  // honest denominator on load instead of the CONTEXT_WINDOW env guess.
  getPersistedClaudeWindow: (model) => {
    const raw = appConfigDb.get(`claude_context_window:${model}`);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { total?: unknown; totalIsUsableWindow?: unknown };
      const total = Number(parsed.total);
      return Number.isFinite(total) && total > 0
        ? { total, totalIsUsableWindow: parsed.totalIsUsableWindow === true }
        : null;
    } catch {
      return null;
    }
  },
};

/**
 * Persists a dispatched Claude unit's context window (ui17 job 19).
 *
 * Headless units run `claude -p` outside the SDK runtime, so no live turn ever
 * reports their window: nothing was persisted for `claude-opus-5` and the
 * meter served the cataloged guess for the whole run. Announcing a dispatched
 * Claude session seeds the cataloged window when nothing has been observed for
 * that model yet; the first SDK-reported usable window a live turn observes
 * overwrites the seed.
 *
 * @returns True when a seed was written.
 */
export function seedDispatchedClaudeContextWindow(model: string | null | undefined): boolean {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return false;
  }
  const key = `claude_context_window:${normalizedModel}`;
  if (appConfigDb.get(key)) {
    return false;
  }
  const total = findClaudeContextWindow(normalizedModel);
  if (!total) {
    return false;
  }
  appConfigDb.set(key, JSON.stringify({ total, totalIsUsableWindow: false }));
  return true;
}

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

async function findCodexSessionFile(
  directoryPath: string,
  providerSessionId: string,
  dependencies: ProviderTokenUsageServiceDependencies,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await dependencies.readDirectory(directoryPath);
  } catch {
    // Codex session folders are date-partitioned and can disappear while a
    // cleanup is running. An unreadable branch is simply not a match.
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findCodexSessionFile(entryPath, providerSessionId, dependencies);
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }

    if (entry.name.includes(providerSessionId) && entry.name.endsWith('.jsonl')) {
      return entryPath;
    }
  }

  return null;
}

function readCodexTokenUsage(fileContent: string): TokenUsageResult {
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const tokenInfo = entry.type === 'event_msg' && entry.payload?.type === 'token_count'
        ? entry.payload.info
        : null;
      if (!tokenInfo) {
        continue;
      }

      const usage = tokenInfo.last_token_usage as AnyRecord | null;
      if (!usage) {
        continue;
      }

      const inputTokens = readUsageNumber(usage.input_tokens);
      const cachedInputTokens = readUsageNumber(usage.cached_input_tokens);
      const freshInputTokens = Math.max(0, inputTokens - cachedInputTokens);
      const outputTokens = readUsageNumber(usage.output_tokens);
      const reasoningTokens = readUsageNumber(usage.reasoning_output_tokens);
      const used = readUsageNumber(usage.total_tokens) || inputTokens + outputTokens;

      return {
        provider: 'codex',
        readingAvailable: true,
        used,
        total: readUsageNumber(tokenInfo.model_context_window) || undefined,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        freshInputTokens,
        reasoningTokens,
        breakdown: { input: inputTokens, output: outputTokens },
      };
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }

  return {
    provider: 'codex',
    readingAvailable: false,
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
  };
}

/** Total billed transcript usage from the newest cumulative Codex rollout frame. */
function readCodexJobTokenUsage(fileContent: string): JobTokenUsageResult {
  const lines = fileContent.trim().split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const usage = entry.type === 'event_msg' && entry.payload?.type === 'token_count'
        ? entry.payload.info?.total_token_usage as AnyRecord | null
        : null;
      if (!usage) continue;
      // Codex reports total input with the cached part called out, so fresh
      // input is the difference.
      const cacheReadTokens = readUsageNumber(usage.cached_input_tokens);
      const inputTokens = Math.max(0, readUsageNumber(usage.input_tokens) - cacheReadTokens);
      const outputTokens = readUsageNumber(usage.output_tokens);
      return {
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
      };
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }
  return { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
}

export type CodexRateLimitWindow = {
  windowMinutes: number;
  usedPercent: number;
  /** Unix seconds. */
  resetsAt: number;
};

export type CodexRateLimitReading = {
  /** The rollout event's timestamp. */
  at: string;
  plan: string | null;
  windows: CodexRateLimitWindow[];
};

function readCodexRateLimitWindow(value: unknown): CodexRateLimitWindow | null {
  const window = value as AnyRecord | null;
  const windowMinutes = Number(window?.window_minutes);
  const usedPercent = Number(window?.used_percent);
  const resetsAt = Number(window?.resets_at);
  return Number.isFinite(windowMinutes) && Number.isFinite(usedPercent) && Number.isFinite(resetsAt)
    ? { windowMinutes, usedPercent, resetsAt }
    : null;
}

/**
 * The newest `rate_limits` block a Codex rollout carries (on `token_count`
 * events): the ChatGPT account's 5-hour / 7-day meters as Codex last saw
 * them. Null when no event in the file carries a readable window.
 */
export function readCodexRateLimits(fileContent: string): CodexRateLimitReading | null {
  const lines = fileContent.trim().split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const rateLimits = entry.type === 'event_msg' && entry.payload?.type === 'token_count'
        ? (entry.payload.rate_limits as AnyRecord | null)
        : null;
      if (!rateLimits || typeof entry.timestamp !== 'string') {
        continue;
      }
      const windows = [rateLimits.primary, rateLimits.secondary]
        .map(readCodexRateLimitWindow)
        .filter((window): window is CodexRateLimitWindow => window !== null);
      if (windows.length === 0) {
        continue;
      }
      return {
        at: entry.timestamp,
        plan: typeof rateLimits.plan_type === 'string' ? rateLimits.plan_type : null,
        windows,
      };
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }
  return null;
}

function readClaudeTokenUsage(
  fileContent: string,
  configuredContextWindow: string | undefined,
  windowsForModel: (model: string | null) => {
    persisted: PersistedClaudeWindow | null;
    catalog: number | null;
  },
): TokenUsageResult {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let model: string | null = null;
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      // Sidechain rows are subagent turns with their own small context; the
      // session's cumulative context lives on the last main-chain row only.
      const usage = entry.type === 'assistant' && entry.isSidechain !== true
        ? entry.message?.usage
        : null;
      if (!usage) {
        continue;
      }

      model = typeof entry.message?.model === 'string' ? entry.message.model : null;
      const directInputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
      cacheReadTokens = readUsageNumber(
        usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens,
      );
      cacheCreationTokens = readUsageNumber(
        usage.cache_creation_input_tokens
          ?? usage.cacheCreationInputTokens
          ?? usage.cacheCreationTokens,
      );
      inputTokens = directInputTokens + cacheReadTokens + cacheCreationTokens;
      outputTokens = readUsageNumber(usage.output_tokens ?? usage.outputTokens);
      break;
    } catch {
      // Skip malformed lines without discarding usage from earlier messages.
    }
  }

  const { persisted: persistedWindow, catalog: catalogWindow } = windowsForModel(model);
  const parsedContextWindow = Number.parseInt(configuredContextWindow ?? '', 10);
  // Published catalog window beats the CONTEXT_WINDOW env guess; the env value
  // and the 160k floor remain only for ids in neither catalog nor cache.
  const contextWindow = catalogWindow
    ?? (Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160_000);
  const cacheTokens = cacheReadTokens + cacheCreationTokens;

  return {
    used: inputTokens + outputTokens,
    total: persistedWindow?.total ?? contextWindow,
    ...(persistedWindow ? { totalIsUsableWindow: persistedWindow.totalIsUsableWindow === true } : {}),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

/**
 * Sums Claude usage across the job transcript. Claude repeats one API
 * message's usage on each persisted content block, so message ids are counted
 * once; counting raw JSONL rows would multiply thinking/tool/text blocks.
 */
function readClaudeJobTokenUsage(fileContent: string): JobTokenUsageResult {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  const countedMessageIds = new Set<string>();
  const lines = fileContent.trim().split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const usage = entry.message?.usage as AnyRecord | null;
      if (!usage) continue;
      const messageId = typeof entry.message?.id === 'string' && entry.message.id
        ? entry.message.id
        : typeof entry.uuid === 'string' && entry.uuid
          ? entry.uuid
          : `line:${index}`;
      if (countedMessageIds.has(messageId)) continue;
      countedMessageIds.add(messageId);

      // Cache writes are fresh content billed as input; cache reads are the
      // same context read back every turn and are counted on their own.
      inputTokens += readUsageNumber(usage.input_tokens ?? usage.inputTokens)
        + readUsageNumber(usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens);
      cacheReadTokens += readUsageNumber(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens);
      outputTokens += readUsageNumber(usage.output_tokens ?? usage.outputTokens);
    } catch {
      // Skip malformed or concurrently-written rows and retain earlier usage.
    }
  }

  return { totalTokens: inputTokens + outputTokens, inputTokens, outputTokens, cacheReadTokens };
}

function readOpenCodeTokenUsage(databasePath: string, providerSessionId: string): TokenUsageResult {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const columns = database.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const requiredColumns = [
      'tokens_input',
      'tokens_output',
      'tokens_reasoning',
      'tokens_cache_read',
      'tokens_cache_write',
    ];

    if (!requiredColumns.every((column) => columnNames.has(column))) {
      return {
        used: 0,
        inputTokens: 0,
        outputTokens: 0,
        breakdown: { input: 0, output: 0 },
        unsupported: true,
        message: 'Token usage tracking is not available in this OpenCode database schema',
      };
    }

    const row = database.prepare(`
      SELECT
        tokens_input AS inputTokens,
        tokens_output AS outputTokens,
        tokens_reasoning AS reasoningTokens,
        tokens_cache_read AS cacheReadTokens,
        tokens_cache_write AS cacheWriteTokens
      FROM session
      WHERE id = ?
    `).get(providerSessionId) as OpenCodeTokenRow | undefined;

    if (!row) {
      throw new AppError('OpenCode session was not found.', {
        code: 'OPENCODE_SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const inputTokens = readUsageNumber(row.inputTokens) + readUsageNumber(row.cacheReadTokens);
    const outputTokens = readUsageNumber(row.outputTokens);
    const used = readUsageNumber(row.inputTokens)
      + outputTokens
      + readUsageNumber(row.reasoningTokens)
      + readUsageNumber(row.cacheReadTokens)
      + readUsageNumber(row.cacheWriteTokens);

    return {
      used,
      inputTokens,
      outputTokens,
      breakdown: { input: inputTokens, output: outputTokens },
    };
  } finally {
    database.close();
  }
}

/**
 * Creates the provider token-usage service used by the provider routes. The
 * provider test suite supplies isolated filesystem and session dependencies so
 * every calculator can be exercised without touching a developer's real data.
 */
export function createProviderTokenUsageService(
  dependencyOverrides: Partial<ProviderTokenUsageServiceDependencies> = {},
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const jobUsageCache = new Map<string, {
    filePath: string;
    size: number;
    modifiedAt: number;
    usage: JobTokenUsageResult;
  }>();

  const resolveCodexSessionFile = async (
    session: SessionRow,
    providerSessionId: string,
  ): Promise<string | null> => {
    const indexedFilePath = session.jsonl_path && dependencies.fileExists(session.jsonl_path)
      ? session.jsonl_path
      : null;
    return indexedFilePath ?? findCodexSessionFile(
      path.join(dependencies.getHomeDirectory(), '.codex', 'sessions'),
      providerSessionId,
      dependencies,
    );
  };

  const resolveClaudeSessionFile = (session: SessionRow, providerSessionId: string): string | null => {
    if (session.jsonl_path) return session.jsonl_path;
    if (!session.project_path) return null;
    const encodedProjectPath = session.project_path.replace(/[^a-zA-Z0-9-]/g, '-');
    const projectDirectory = path.join(getClaudeConfigDir(), 'projects', encodedProjectPath);
    const sessionFilePath = path.join(projectDirectory, `${providerSessionId}.jsonl`);
    const relativePath = path.relative(path.resolve(projectDirectory), path.resolve(sessionFilePath));
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new AppError('Resolved session path is invalid.', {
        code: 'INVALID_SESSION_PATH',
        statusCode: 400,
      });
    }
    return sessionFilePath;
  };

  return {
    /**
     * Resolves all provider-specific storage details from one app-facing
     * session id, then returns the latest usage snapshot for that provider.
     */
    async getSessionTokenUsage(sessionId: string): Promise<TokenUsageResult> {
      const session = dependencies.getSessionById(sessionId);
      if (!session) {
        throw new AppError(`Session "${sessionId}" was not found.`, {
          code: 'SESSION_NOT_FOUND',
          statusCode: 404,
        });
      }

      const providerSessionId = session.provider_session_id || sessionId;

      if (session.provider === 'cursor') {
        return {
          used: 0,
          total: 0,
          inputTokens: 0,
          outputTokens: 0,
          breakdown: { input: 0, output: 0 },
          unsupported: true,
          message: 'Token usage tracking not available for Cursor sessions',
        };
      }

      if (session.provider === 'opencode') {
        const databasePath = dependencies.getOpenCodeDatabasePath();
        if (!dependencies.fileExists(databasePath)) {
          throw new AppError('OpenCode database was not found.', {
            code: 'OPENCODE_DATABASE_NOT_FOUND',
            statusCode: 404,
          });
        }

        return readOpenCodeTokenUsage(databasePath, providerSessionId);
      }

      if (session.provider === 'codex') {
        const sessionFilePath = await resolveCodexSessionFile(session, providerSessionId);

        if (!sessionFilePath) {
          throw new AppError(`Codex session file for "${sessionId}" was not found.`, {
            code: 'CODEX_SESSION_FILE_NOT_FOUND',
            statusCode: 404,
          });
        }

        const fileContent = await dependencies.readTextFile(sessionFilePath);
        return readCodexTokenUsage(fileContent);
      }

      const sessionFilePath = resolveClaudeSessionFile(session, providerSessionId);

      if (!sessionFilePath || !dependencies.fileExists(sessionFilePath)) {
        throw new AppError(`Session file for "${sessionId}" was not found.`, {
          code: 'SESSION_FILE_NOT_FOUND',
          statusCode: 404,
        });
      }

      const fileContent = await dependencies.readTextFile(sessionFilePath);
      return readClaudeTokenUsage(fileContent, dependencies.getClaudeContextWindow(), (model) => {
        const resolvedModel = model ?? session.model;
        return {
          persisted: resolvedModel ? dependencies.getPersistedClaudeWindow(resolvedModel) : null,
          catalog: findClaudeContextWindow(resolvedModel),
        };
      });
    },

    /**
     * Returns the whole dispatched session's token cost for the watchdog jobs
     * history. Claude sums unique message usage; Codex reads cumulative rollout
     * usage. Other providers do not yet expose the named source formats.
     */
    async getJobTokenUsage(sessionId: string): Promise<JobTokenUsageResult | null> {
      const session = dependencies.getSessionById(sessionId);
      if (!session || (session.provider !== 'claude' && session.provider !== 'codex')) {
        return null;
      }
      const providerSessionId = session.provider_session_id || sessionId;
      const sessionFilePath = session.provider === 'codex'
        ? await resolveCodexSessionFile(session, providerSessionId)
        : resolveClaudeSessionFile(session, providerSessionId);
      if (!sessionFilePath || !dependencies.fileExists(sessionFilePath)) {
        return null;
      }

      const stats = await fsp.stat(sessionFilePath);
      const cached = jobUsageCache.get(sessionId);
      if (
        cached
        && cached.filePath === sessionFilePath
        && cached.size === stats.size
        && cached.modifiedAt === stats.mtimeMs
      ) {
        return cached.usage;
      }

      const fileContent = await dependencies.readTextFile(sessionFilePath);
      const usage = session.provider === 'codex'
        ? readCodexJobTokenUsage(fileContent)
        : readClaudeJobTokenUsage(fileContent);
      jobUsageCache.set(sessionId, {
        filePath: sessionFilePath,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        usage,
      });
      return usage;
    },
  };
}

/**
 * Used by the provider routes to serve token usage from only an app session id.
 */
export const providerTokenUsageService = createProviderTokenUsageService();
