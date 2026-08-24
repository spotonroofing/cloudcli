import { getConnection } from '@/modules/database/connection.js';

export type MessageVersionRow = {
  session_id: string;
  group_id: string;
  version: number;
  user_message_id: string | null;
  prompt_text: string;
  is_selected: number;
  created_at: string;
};

export const messageVersionsDb = {
  listBySession(sessionId: string): MessageVersionRow[] {
    const db = getConnection();
    return db
      .prepare(`
        SELECT session_id, group_id, version, user_message_id, prompt_text, is_selected, created_at
        FROM message_versions
        WHERE session_id = ?
        ORDER BY group_id, version
      `)
      .all(sessionId) as MessageVersionRow[];
  },

  /**
   * Records an edit-and-resend. On a group's first resend the original turn is
   * captured as version 1 (anchored to its transcript user-message id); the
   * resend becomes the next version, selected. The resend's own transcript id
   * is unknown at send time and stays null — the client resolves it.
   */
  recordResend(input: {
    sessionId: string;
    groupId: string;
    anchorUserMessageId: string;
    anchorPromptText: string;
    promptText: string;
  }): void {
    const db = getConnection();
    const now = new Date().toISOString();
    const record = db.transaction(() => {
      const maxRow = db
        .prepare('SELECT MAX(version) AS maxVersion FROM message_versions WHERE session_id = ? AND group_id = ?')
        .get(input.sessionId, input.groupId) as { maxVersion: number | null };
      const insert = db.prepare(`
        INSERT INTO message_versions (session_id, group_id, version, user_message_id, prompt_text, is_selected, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      let nextVersion = (maxRow.maxVersion ?? 0) + 1;
      if (nextVersion === 1) {
        insert.run(input.sessionId, input.groupId, 1, input.anchorUserMessageId, input.anchorPromptText, 0, now);
        nextVersion = 2;
      }
      db.prepare('UPDATE message_versions SET is_selected = 0 WHERE session_id = ? AND group_id = ?')
        .run(input.sessionId, input.groupId);
      insert.run(input.sessionId, input.groupId, nextVersion, null, input.promptText, 1, now);
    });
    record();
  },

  selectVersion(sessionId: string, groupId: string, version: number): void {
    const db = getConnection();
    const apply = db.transaction(() => {
      db.prepare('UPDATE message_versions SET is_selected = 0 WHERE session_id = ? AND group_id = ?')
        .run(sessionId, groupId);
      db.prepare('UPDATE message_versions SET is_selected = 1 WHERE session_id = ? AND group_id = ? AND version = ?')
        .run(sessionId, groupId, version);
    });
    apply();
  },
};
