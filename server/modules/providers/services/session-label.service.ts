import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { sessionsDb } from '@/modules/database/index.js';
import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { LLMProvider } from '@/shared/types.js';

const execFileAsync = promisify(execFile);

const SHORT_LABEL_MODEL = 'claude-haiku-4-5-20251001';
const SHORT_LABEL_TIMEOUT_MS = 30_000;
const SHORT_LABEL_MAX_BUFFER_BYTES = 1024 * 1024;
const SHORT_LABEL_MESSAGE_EXCERPT_CHARS = 500;
const SHORT_LABEL_MAX_WORDS = 8;
const SHORT_LABEL_MAX_CHARS = 60;
const LOG_PREFIX = 'Session short-label generation failed';

type ScheduleSessionShortLabelInput = {
  sessionId: string;
  provider: LLMProvider;
  message: string;
  /** The title written at scheduling time; the label only lands if the row still carries it. */
  currentTitle: string;
};

/**
 * Normalizes raw model stdout into a usable session label.
 *
 * Takes the last non-empty line (so any preamble the model emits is dropped),
 * strips surrounding quotes/backticks and a trailing period, and collapses
 * whitespace. Returns `null` when nothing usable remains or the result is
 * outside the 1-8 word / 60 character bounds.
 */
export function sanitizeShortLabel(raw: string): string | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return null;
  }

  const label = lastLine
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!label || label.length > SHORT_LABEL_MAX_CHARS) {
    return null;
  }
  if (label.split(' ').length > SHORT_LABEL_MAX_WORDS) {
    return null;
  }

  return label;
}

/**
 * Fire-and-forget: turns a session's first user-typed message into a short
 * Haiku-generated label and stores it as the session title.
 *
 * Runs one `claude -p` call per session, at creation only. The write is
 * guarded by re-reading the row and comparing against the title written at
 * scheduling time, so a user rename (or any other writer) is never clobbered.
 * Failures are logged and swallowed; the session keeps its truncated
 * first-message title.
 */
export function scheduleSessionShortLabel(input: ScheduleSessionShortLabelInput): void {
  if (!input.message.trim()) {
    return;
  }

  void (async () => {
    try {
      const excerpt = input.message.trim().slice(0, SHORT_LABEL_MESSAGE_EXCERPT_CHARS);
      const prompt = [
        'Produce a 3-6 word label for this chat session based on the message below.',
        'Reply with the label only - no quotes, no trailing punctuation, no preamble.',
        '',
        excerpt,
      ].join('\n');

      const claudeExecutable = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);
      // --no-session-persistence: without it every label call writes its own
      // transcript, which the session synchronizer then indexes as a phantom
      // external session titled with this prompt (observed live on dev).
      const { stdout } = await execFileAsync(
        claudeExecutable,
        ['-p', prompt, '--model', SHORT_LABEL_MODEL, '--no-session-persistence'],
        {
          timeout: SHORT_LABEL_TIMEOUT_MS,
          maxBuffer: SHORT_LABEL_MAX_BUFFER_BYTES,
        }
      );

      const label = sanitizeShortLabel(stdout);
      if (!label) {
        console.error(LOG_PREFIX, {
          sessionId: input.sessionId,
          reason: 'unusable model output',
          stdout: stdout.slice(0, 200),
        });
        return;
      }

      const row = sessionsDb.getSessionById(input.sessionId);
      if (!row || row.custom_name !== input.currentTitle) {
        return;
      }
      sessionsDb.updateSessionCustomName(input.sessionId, label);

      // Dynamic import: a static one would close an import cycle through
      // websocket/index -> chat-websocket.service -> this service.
      const { notifySessionRowChanged } = await import(
        '@/modules/providers/services/sessions-watcher.service.js'
      );
      notifySessionRowChanged(input.provider, input.sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(LOG_PREFIX, { sessionId: input.sessionId, error: message });
    }
  })();
}
