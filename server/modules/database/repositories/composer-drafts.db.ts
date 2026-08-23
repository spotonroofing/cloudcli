import { getConnection } from '@/modules/database/connection.js';

export type ComposerDraftRow = {
  draft_key: string;
  content: string;
  attachments_json: string | null;
  updated_at: string;
};

export const composerDraftsDb = {
  getDraft(draftKey: string): ComposerDraftRow | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT draft_key, content, attachments_json, updated_at FROM composer_drafts WHERE draft_key = ?')
      .get(draftKey) as ComposerDraftRow | undefined;
    return row ?? null;
  },

  upsertDraft(draftKey: string, content: string, attachmentsJson: string | null, updatedAt: string): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO composer_drafts (draft_key, content, attachments_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(draft_key) DO UPDATE SET
        content = excluded.content,
        attachments_json = excluded.attachments_json,
        updated_at = excluded.updated_at
    `).run(draftKey, content, attachmentsJson, updatedAt);
  },

  deleteDraft(draftKey: string): void {
    const db = getConnection();
    db.prepare('DELETE FROM composer_drafts WHERE draft_key = ?').run(draftKey);
  },
};
