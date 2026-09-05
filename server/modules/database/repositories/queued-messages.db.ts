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

  /**
   * Updates an existing row in place, or appends it after the session's tail.
   * The client-generated id is also the retry idempotency key. A durable
   * receipt survives row removal, so an acknowledgement-lost retry cannot
   * append a second delivery after the first one was claimed. Returns false
   * only when the key was already received and its queue row is gone.
   */
  upsert(
    sessionId: string,
    id: string,
    content: string,
    optionsJson: string | null,
    attachmentsJson: string | null,
    updatedAt: string,
  ): boolean {
    const db = getConnection();
    return db.transaction(() => {
      const existing = db
        .prepare('SELECT 1 FROM queued_messages WHERE session_id = ? AND id = ?')
        .get(sessionId, id);
      if (existing) {
        db.prepare(`
          UPDATE queued_messages
          SET content = ?, options_json = ?, attachments_json = ?, updated_at = ?
          WHERE session_id = ? AND id = ?
        `).run(content, optionsJson, attachmentsJson, updatedAt, sessionId, id);
        return true;
      }

      const receipt = db.prepare(`
        INSERT OR IGNORE INTO queued_message_receipts (id, session_id, received_at)
        VALUES (?, ?, ?)
      `).run(id, sessionId, updatedAt);
      if (receipt.changes === 0) {
        return false;
      }

      db.prepare(`
        INSERT INTO queued_messages (id, session_id, content, options_json, attachments_json, position, updated_at)
        VALUES (?, ?, ?, ?, ?, (
          SELECT COALESCE(MAX(position), 0) + 1 FROM queued_messages WHERE session_id = ?
        ), ?)
      `).run(id, sessionId, content, optionsJson, attachmentsJson, sessionId, updatedAt);
      return true;
    })();
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
