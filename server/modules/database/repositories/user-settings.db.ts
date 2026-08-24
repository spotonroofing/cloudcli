import { getConnection } from '@/modules/database/connection.js';

export const userSettingsDb = {
  /** Every synced preference for a user as a key -> raw string map. */
  getAll(userId: number): Record<string, string> {
    const db = getConnection();
    const rows = db
      .prepare('SELECT key, value FROM user_settings WHERE user_id = ?')
      .all(userId) as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  },

  /** Upserts string values and deletes keys whose value is null, in one transaction. */
  apply(userId: number, settings: Record<string, string | null>, updatedAt: string): void {
    const db = getConnection();
    const upsert = db.prepare(`
      INSERT INTO user_settings (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const remove = db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?');
    db.transaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        if (value === null) {
          remove.run(userId, key);
        } else {
          upsert.run(userId, key, value, updatedAt);
        }
      }
    })();
  },
};
