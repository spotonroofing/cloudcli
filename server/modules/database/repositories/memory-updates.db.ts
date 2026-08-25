import { getConnection } from '@/modules/database/connection.js';

export type MemoryUpdateRow = {
  id: number;
  session_id: string;
  files_json: string;
  created_at: string;
};

export const memoryUpdatesDb = {
  listBySession(sessionId: string): MemoryUpdateRow[] {
    const db = getConnection();
    return db
      .prepare(`
        SELECT id, session_id, files_json, created_at
        FROM memory_updates
        WHERE session_id = ?
        ORDER BY id
      `)
      .all(sessionId) as MemoryUpdateRow[];
  },

  insert(input: { sessionId: string; files: string[]; createdAt: string }): number {
    const db = getConnection();
    const result = db
      .prepare('INSERT INTO memory_updates (session_id, files_json, created_at) VALUES (?, ?, ?)')
      .run(input.sessionId, JSON.stringify(input.files), input.createdAt);
    return Number(result.lastInsertRowid);
  },
};
