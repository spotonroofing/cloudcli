import { getConnection } from '@/modules/database/connection.js';

export type MemoryUpdateRow = {
  id: number;
  session_id: string;
  files_json: string;
  /** JSON object: memory-relative path -> excerpt lines of the real change (ui14 job 3). */
  diffs_json: string | null;
  /** Elapsed watcher burst time in milliseconds; null on historical rows. */
  duration_ms: number | null;
  created_at: string;
};

export const memoryUpdatesDb = {
  listBySession(sessionId: string): MemoryUpdateRow[] {
    const db = getConnection();
    return db
      .prepare(`
        SELECT id, session_id, files_json, diffs_json, duration_ms, created_at
        FROM memory_updates
        WHERE session_id = ?
        ORDER BY id
      `)
      .all(sessionId) as MemoryUpdateRow[];
  },

  insert(input: { sessionId: string; files: string[]; diffs: Record<string, string[]>; durationMs: number; createdAt: string }): number {
    const db = getConnection();
    const result = db
      .prepare('INSERT INTO memory_updates (session_id, files_json, diffs_json, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(input.sessionId, JSON.stringify(input.files), JSON.stringify(input.diffs), input.durationMs, input.createdAt);
    return Number(result.lastInsertRowid);
  },
};
