import { readFile } from 'node:fs/promises';

import { query, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

// Used only when the installed Claude CLI cannot report its own catalog. Keep
// the fallback complete enough for an offline server to remain operable.
export const CLAUDE_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: 'claude-fable-5-1',
      label: 'Claude Fable 5.1',
      description: 'Most capable for your hardest and longest-running tasks',
      group: 'current',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-fable-5',
      label: 'Claude Fable 5',
      description: 'For your toughest challenges',
      group: 'legacy',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-sonnet-5',
      label: 'Sonnet 5',
      description: 'Fast and capable',
      group: 'current',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-haiku-4-5',
      label: 'Haiku 4.5',
      description: 'Fastest for everyday tasks',
      group: 'current',
    },
    {
      value: 'claude-opus-4-8',
      label: 'Opus 4.8',
      description: 'Deep reasoning',
      group: 'legacy',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-opus-4-7',
      label: 'Opus 4.7',
      description: 'Strong sustained reasoning',
      group: 'legacy',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      // xhigh arrived with Opus 4.7; the 4.6 models reject it.
      value: 'claude-opus-4-6',
      label: 'Opus 4.6',
      description: 'Thorough and dependable',
      group: 'legacy',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'claude-3-opus-20240229',
      label: 'Opus 3',
      description: 'The original Opus',
      group: 'legacy',
    },
    {
      value: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      description: 'Balanced and efficient',
      group: 'legacy',
      effort: {
        default: 'high',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'max' },
        ],
      },
    },
  ],
  DEFAULT: 'claude-fable-5-1',
};

type ClaudeCliModelInfo = ModelInfo & { resolvedModel?: string };
type ClaudeModelsLoader = () => Promise<ClaudeCliModelInfo[]>;

const REQUIRED_CLAUDE_OPTIONS = CLAUDE_PREDEFINED_MODELS.OPTIONS.filter((option) => (
  option.value === 'claude-fable-5-1' || option.value === 'claude-fable-5'
));
const CLAUDE_CATALOG_TIMEOUT_MS = 10_000;

const normalizedClaudeModelId = (model: ClaudeCliModelInfo): string => (
  (model.resolvedModel || model.value).replace(/\[1m\]$/i, '').trim()
);

const labelForClaudeModel = (modelId: string, fallback: string): string => {
  const match = /^claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i.exec(modelId);
  if (!match) {
    return fallback;
  }
  const family = `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()}`;
  const minor = match[3]?.length && match[3].length <= 2 ? `.${match[3]}` : '';
  return `Claude ${family} ${match[2]}${minor}`;
};

const toClaudeModelOption = (model: ClaudeCliModelInfo): ProviderModelOption | null => {
  const value = normalizedClaudeModelId(model);
  if (!value || value === 'default') {
    return null;
  }
  const supportedEfforts = model.supportedEffortLevels ?? [];
  return {
    value,
    label: labelForClaudeModel(value, model.displayName),
    description: model.description,
    group: 'current',
    ...(model.supportsEffort && supportedEfforts.length > 0
      ? {
        effort: {
          default: supportedEfforts.includes('high') ? 'high' : supportedEfforts[0],
          values: supportedEfforts.map((effort) => ({ value: effort })),
        },
      }
      : {}),
  };
};

const buildClaudeModelsDefinition = (models: ClaudeCliModelInfo[]): ProviderModelsDefinition | null => {
  const byId = new Map<string, ProviderModelOption>();
  for (const model of models) {
    const option = toClaudeModelOption(model);
    if (option && !byId.has(option.value)) {
      byId.set(option.value, option);
    }
  }
  if (byId.size === 0) {
    return null;
  }
  for (const required of REQUIRED_CLAUDE_OPTIONS) {
    if (!byId.has(required.value)) {
      byId.set(required.value, required);
    }
  }
  return {
    OPTIONS: [...byId.values()],
    DEFAULT: CLAUDE_PREDEFINED_MODELS.DEFAULT,
  };
};

const loadInstalledClaudeModels: ClaudeModelsLoader = async () => {
  const queryInstance = query({
    prompt: '',
    options: {
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(),
      persistSession: false,
      settingSources: [],
      tools: [],
    },
  });
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      queryInstance.supportedModels() as Promise<ClaudeCliModelInfo[]>,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Claude model discovery timed out')), CLAUDE_CATALOG_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    queryInstance.close();
  }
};

// Published context window per model id, the default denominator wherever a
// live turn has not yet persisted the SDK-observed window. Fable 5 ships 1M by
// default (observed live), and so do Opus 5 and Sonnet 5 on this account:
// ui17 job 19 caught an Opus 5 session past 204k reading 98 percent of a
// cataloged 200k while its own calls kept succeeding, and a live Sonnet 5 turn
// has since reported 967k. Ids in neither this catalog nor the runtime cache
// keep the CONTEXT_WINDOW env / 160k fallback.
export const CLAUDE_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-fable-5-1': 1_000_000,
  'claude-fable-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-sonnet-5': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-8': 200_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-sonnet-4-6': 200_000,
};

/** Resolves the cataloged window for a model id, matching date-suffixed ids to their base entry. */
export const findClaudeContextWindow = (model: string | undefined | null): number | null => {
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedModel) {
    return null;
  }

  if (CLAUDE_CONTEXT_WINDOWS[normalizedModel]) {
    return CLAUDE_CONTEXT_WINDOWS[normalizedModel];
  }

  const baseId = Object.keys(CLAUDE_CONTEXT_WINDOWS)
    .find((id) => normalizedModel.startsWith(`${id}-`));
  return baseId ? CLAUDE_CONTEXT_WINDOWS[baseId] : null;
};
type ClaudeInitEvent = {
  sessionId?: string;
  session_id?: string;
  type?: string;
  subtype?: string;
  model?: string;
  message?: {
    content?: unknown;
    model?: string;
  };
};

const ANSI_PATTERN = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*(?:'
  + '(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]'
  + '|(?:[\\dA-PR-TZcf-ntqry=><~]))',
  'g',
);

const extractClaudeEventModel = (event: ClaudeInitEvent, sessionId: string): string | null => {
  const eventSessionId = event.sessionId ?? event.session_id;
  if (eventSessionId && eventSessionId !== sessionId) {
    return null;
  }

  const contentModel = extractClaudeModelFromMessageContent(event.message?.content);
  if (contentModel) {
    return contentModel;
  }

  const directModel = event.model?.trim();
  if (directModel) {
    return directModel;
  }

  const messageModel = event.message?.model?.trim();
  return messageModel || null;
};

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, '');

const extractTaggedContent = (content: string, tagName: string): string | null => {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
};

const extractClaudeModelFromTextContent = (content: string): string | null => {
  const localCommandStdout = extractTaggedContent(content, 'local-command-stdout');
  if (localCommandStdout !== null) {
    const cleanedStdout = stripAnsi(localCommandStdout).replace(/\s+/g, ' ').trim();
    const changedModel = /(?:set|changed|switched)\s+model\s+to\s+(.+?)\.?$/i.exec(cleanedStdout);
    if (changedModel?.[1]?.trim()) {
      return changedModel[1].trim();
    }
  }

  const modelTag = extractTaggedContent(content, 'model')?.trim();
  return modelTag || null;
};

const extractClaudeModelFromMessageContent = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return extractClaudeModelFromTextContent(content);
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part) || typeof part.text !== 'string') {
      continue;
    }

    const model = extractClaudeModelFromTextContent(part.text);
    if (model) {
      return model;
    }
  }

  return null;
};

const readClaudeSessionModelFromJsonl = async (
  sessionId: string,
  jsonlPath: string,
): Promise<ProviderCurrentActiveModel | null> => {
  const content = await readFile(jsonlPath, 'utf8');
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]) as ClaudeInitEvent;
      const model = extractClaudeEventModel(event, sessionId);
      if (model) {
        return { model, fromSessionState: true };
      }
    } catch {
      // Skip malformed JSONL lines that can happen during concurrent writes.
    }
  }

  return null;
};

/** Claude provider registry adapter used by provider routes and runtimes. */
export class ClaudeProviderModels implements IProviderModels {
  private catalogPromise: Promise<ProviderModelsDefinition>;

  private initialCatalogPending = true;

  constructor(private readonly loadModels: ClaudeModelsLoader = loadInstalledClaudeModels) {
    // Provider construction happens during registry initialization, so this
    // begins discovery at server start without holding module evaluation open.
    this.catalogPromise = this.discoverModels();
  }

  private async discoverModels(): Promise<ProviderModelsDefinition> {
    try {
      return buildClaudeModelsDefinition(await this.loadModels()) ?? CLAUDE_PREDEFINED_MODELS;
    } catch (error) {
      console.warn('[Claude models] Installed CLI catalog unavailable; using static fallback.', error);
      return CLAUDE_PREDEFINED_MODELS;
    }
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (this.initialCatalogPending) {
      this.initialCatalogPending = false;
      return this.catalogPromise;
    }
    // Provider catalog GETs power both the switcher and Settings refresh. A
    // fresh CLI initialization here picks up models installed since startup.
    this.catalogPromise = this.discoverModels();
    return this.catalogPromise;
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const jsonlPath = sessionsDb.getSessionById(sessionId)?.jsonl_path;
      const activeModel = jsonlPath
        ? await readClaudeSessionModelFromJsonl(sessionId, jsonlPath)
        : null;
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
