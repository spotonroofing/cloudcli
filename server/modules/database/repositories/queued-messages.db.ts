import { getConnection } from '@/modules/database/connection.js';

export type QueuedMessageRow = {
  session_id: string;
  content: string;
  options_json: string | null;
  attachments_json: string | null;
  updated_at: string;
};

const COLUMNS = 'session_id, content, options_json, attachments_json, updated_at';

export const queuedMessagesDb = {
  listAll(): QueuedMessageRow[] {
    const db = getConnection();
    return db.prepare(`SELECT ${COLUMNS} FROM queued_messages`).all() as QueuedMessageRow[];
  },

  upsert(
    sessionId: string,
    content: string,
    optionsJson: string | null,
    attachmentsJson: string | null,
    updatedAt: string,
  ): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO queued_messages (${COLUMNS})
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        content = excluded.content,
        options_json = excluded.options_json,
        attachments_json = excluded.attachments_json,
        updated_at = excluded.updated_at
    `).run(sessionId, content, optionsJson, attachmentsJson, updatedAt);
  },

  /**
   * Removes a session's queued message and reports whether a row existed.
   * The boolean is the cross-device claim: the one client that deletes the
   * live row is the one that sends the message.
   */
  remove(sessionId: string): boolean {
    const db = getConnection();
    const result = db.prepare('DELETE FROM queued_messages WHERE session_id = ?').run(sessionId);
    return result.changes > 0;
  },
};
