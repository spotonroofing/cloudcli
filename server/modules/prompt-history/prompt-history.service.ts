import fsSync from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { parseFilesInputTag, parseImagesInputTag, type ParsedImageAttachment } from '@/shared/image-attachments.js';

/**
 * Prompt history for the composer's history panel (ui15 job 2): the user's
 * own past prompts, read straight from the Claude transcript JSONLs of the
 * open session and the project's recent conversations. Only real typed
 * prompts surface — slash commands, tool results, meta rows, and internal
 * content are skipped — and each prompt carries the attachment descriptors
 * parsed back out of its `<files_input>`/`<images_input>` tags so the files
 * (which live in the server's asset store) stay downloadable.
 */

type AnyRecord = Record<string, any>;

export type PromptHistoryEntry = {
  id: string;
  sessionId: string;
  sessionTitle: string | null;
  timestamp: string;
  content: string;
  files: ParsedImageAttachment[];
  images: ParsedImageAttachment[];
};

const INTERNAL_CONTENT_PREFIXES = [
  '<system-reminder>',
  '<command-message>',
  '<command-name>',
  '<local-command-stdout>',
  'Caveat:',
  'Invalid API key',
  '[Request interrupted',
];

const MAX_SESSIONS_SCANNED = 10;
const MAX_PROMPTS_PER_SESSION = 30;

const extractText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  if (content.some((part: AnyRecord) => part?.type === 'tool_result')) {
    return '';
  }
  return content
    .filter((part: AnyRecord) => part?.type === 'text' && typeof part?.text === 'string')
    .map((part: AnyRecord) => String(part.text))
    .join('\n');
};

const isRealPrompt = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('/')) {
    return false;
  }
  return !INTERNAL_CONTENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
};

/** Raw prompt text of one transcript entry, or null when it is not a typed user prompt. */
const promptTextFromEntry = (entry: AnyRecord): string | null => {
  if (entry.isMeta || entry.isApiErrorMessage || entry.isCompactSummary) {
    return null;
  }
  // A message queued mid-turn persists as a queued_command attachment, not a
  // user row; it is still one of the user's own prompts.
  if (entry.type === 'attachment') {
    return entry.attachment?.type === 'queued_command' && typeof entry.attachment.prompt === 'string'
      ? entry.attachment.prompt
      : null;
  }
  if (entry.type !== 'user' || entry.message?.role !== 'user') {
    return null;
  }
  return extractText(entry.message.content) || null;
};

const readSessionPrompts = async (
  jsonlPath: string,
  providerSessionId: string | null,
  appSessionId: string,
  sessionTitle: string | null,
): Promise<PromptHistoryEntry[]> => {
  const prompts: PromptHistoryEntry[] = [];
  const stream = fsSync.createReadStream(jsonlPath);
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"type":"user"') && !line.includes('queued_command')) {
        continue;
      }
      let entry: AnyRecord;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      // Transcript files can interleave sessions; keep only this session's rows.
      if (providerSessionId && entry.sessionId && String(entry.sessionId) !== providerSessionId) {
        continue;
      }
      const rawText = promptTextFromEntry(entry);
      if (!rawText) {
        continue;
      }
      const parsedFiles = parseFilesInputTag(rawText);
      const parsedImages = parseImagesInputTag(parsedFiles.text);
      const content = parsedImages.text.trim();
      if (!isRealPrompt(content) && parsedFiles.attachments.length === 0 && parsedImages.attachments.length === 0) {
        continue;
      }
      if (content && !isRealPrompt(content)) {
        continue;
      }
      prompts.push({
        id: `${appSessionId}:${entry.uuid || prompts.length}`,
        sessionId: appSessionId,
        sessionTitle,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : '',
        content,
        files: parsedFiles.attachments,
        images: parsedImages.attachments,
      });
    }
  } catch {
    return prompts;
  } finally {
    lines.close();
    stream.destroy();
  }
  return prompts.slice(-MAX_PROMPTS_PER_SESSION);
};

export async function listPromptHistory(options: {
  projectId: string | null;
  sessionId: string | null;
  limit: number;
}): Promise<PromptHistoryEntry[]> {
  const { projectId, sessionId, limit } = options;

  const candidates = new Map<string, ReturnType<typeof sessionsDb.getSessionById>>();
  if (sessionId) {
    candidates.set(sessionId, sessionsDb.getSessionById(sessionId));
  }
  if (projectId) {
    for (const session of sessionsDb.getRecentSessionsPage(MAX_SESSIONS_SCANNED, 0, projectId).sessions) {
      if (!candidates.has(session.session_id)) {
        candidates.set(session.session_id, session);
      }
    }
  }

  const perSession = await Promise.all(
    [...candidates.values()].map((session) => {
      if (!session || session.provider !== 'claude' || !session.jsonl_path || !fsSync.existsSync(session.jsonl_path)) {
        return Promise.resolve<PromptHistoryEntry[]>([]);
      }
      return readSessionPrompts(
        session.jsonl_path,
        session.provider_session_id,
        session.session_id,
        session.custom_name,
      );
    }),
  );

  return perSession
    .flat()
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, limit);
}
