import { authenticatedFetch } from '../../../utils/api';
import type { ChatAttachment } from '../types/types';

/**
 * Server-persisted composer drafts (ui8 phase 2). One draft per composer
 * surface: the session id for open chats, `project:<projectId>` for the
 * new-chat composer. Writes broadcast `draft_updated` to every client;
 * `draftClientId` identifies this tab so its own echoes are ignored.
 */

export const draftClientId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export type ComposerDraft = {
  content: string;
  attachments: ChatAttachment[];
};

export const emptyComposerDraft: ComposerDraft = { content: '', attachments: [] };

export const fetchComposerDraft = async (draftKey: string): Promise<ComposerDraft | null> => {
  try {
    const response = await authenticatedFetch(`/api/drafts/${encodeURIComponent(draftKey)}`);
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    const draft = body?.data?.draft;
    if (!draft || typeof draft.content !== 'string') {
      return null;
    }
    return {
      content: draft.content,
      attachments: Array.isArray(draft.attachments) ? (draft.attachments as ChatAttachment[]) : [],
    };
  } catch {
    return null;
  }
};

/** Fire-and-forget: an empty draft deletes the server row. */
export const saveComposerDraft = (draftKey: string, content: string, attachments: ChatAttachment[]): void => {
  void authenticatedFetch(`/api/drafts/${encodeURIComponent(draftKey)}`, {
    method: 'PUT',
    body: JSON.stringify({ content, attachments, clientId: draftClientId }),
  }).catch(() => {
    // Transient network failure; the next divergence re-saves.
  });
};

export const sameDraftAttachments = (a: ChatAttachment[], b: ChatAttachment[]): boolean =>
  a.length === b.length && a.every((attachment, index) => attachment.path === b[index]?.path);
