import { getConnection } from '@/modules/database/connection.js';

export type QueuedMessageRow = {
  id: string;
  session_id: string;
  content: string;
  options_json: string | null;
  attachments_json: string | null;
  position: number;
  updated_at: string;
};

const COLUMNS = 'id, session_id, content, options_json, attachments_json, position, updated_at';

/**
 * Per-session queued-message stack (ui15 job 2): any number of rows per
 * session, delivered in `position` (append) order. `id` is the
 * client-generated message id, so an offline append never waits on a server
 * round trip for its identity.
 */
export const queuedMessagesDb = {
  listAll(): QueuedMessageRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${COLUMNS} FROM queued_messages ORDER BY session_id, position`)
      .all() as QueuedMessageRow[];
  },

  listForSession(sessionId: string): QueuedMessageRow[] {
    const db = getConnection();
    return db
      .prepare(`SELECT ${COLUMNS} FROM queued_messages WHERE session_id = ? ORDER BY position`)
      .all(sessionId) as QueuedMessageRow[];
  },

  /** The next message to deliver: the session's lowest position. */
  getHead(sessionId: string): QueuedMessageRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${COLUMNS} FROM queued_messages WHERE session_id = ? ORDER BY position LIMIT 1`)
      .get(sessionId);
    return (row as QueuedMessageRow | undefined) ?? null;
  },

  get(sessionId: string, id: string): QueuedMessageRow | null {
    const db = getConnection();
    const row = db
      .prepare(`SELECT ${COLUMNS} FROM queued_messages WHERE session_id = ? AND id = ?`)
      .get(sessionId, id);
    return (row as QueuedMessageRow | undefined) ?? null;
  },

  /** Updates an existing row in place, or appends it after the session's tail. */
  upsert(
    sessionId: string,
    id: string,
    content: string,
    optionsJson: string | null,
    attachmentsJson: string | null,
    updatedAt: string,
  ): void {
    const db = getConnection();
    db.prepare(`
      INSERT INTO queued_messages (id, session_id, content, options_json, attachments_json, position, updated_at)
      VALUES (?, ?, ?, ?, ?, (
        SELECT COALESCE(MAX(position), 0) + 1 FROM queued_messages WHERE session_id = ?
      ), ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        options_json = excluded.options_json,
        attachments_json = excluded.attachments_json,
        updated_at = excluded.updated_at
    `).run(id, sessionId, content, optionsJson, attachmentsJson, sessionId, updatedAt);
  },

  /**
   * Removes one queued message and reports whether the row existed. The
   * boolean is the cross-device claim: the one client that deletes the live
   * row is the one that sends the message.
   */
  remove(sessionId: string, id: string): boolean {
    const db = getConnection();
    const result = db
      .prepare('DELETE FROM queued_messages WHERE session_id = ? AND id = ?')
      .run(sessionId, id);
    return result.changes > 0;
  },
};
