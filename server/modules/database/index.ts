export { initializeDatabase } from '@/modules/database/init-db.js';
export { closeConnection, getConnection, getDatabasePath } from '@/modules/database/connection.js';
export { apiKeysDb } from '@/modules/database/repositories/api-keys.js';
export { appConfigDb } from '@/modules/database/repositories/app-config.js';
// composerDraftsDb: used by the Drafts module to persist per-session composer drafts.
export { composerDraftsDb } from '@/modules/database/repositories/composer-drafts.db.js';
export { credentialsDb } from '@/modules/database/repositories/credentials.js';
export { githubTokensDb } from '@/modules/database/repositories/github-tokens.js';
// memoryUpdatesDb: memory-updated transcript indicators (ui12 phase 7).
export { memoryUpdatesDb } from '@/modules/database/repositories/memory-updates.db.js';
// messageVersionsDb: edit-and-resend response versioning (ui9 B3).
export { messageVersionsDb } from '@/modules/database/repositories/message-versions.db.js';
export { notificationChannelEndpointsDb } from '@/modules/database/repositories/notification-channel-endpoints.js';
export { notificationPreferencesDb } from '@/modules/database/repositories/notification-preferences.js';
// providerModelsDb: used by Providers to persist user-managed custom model rows.
export { providerModelsDb } from '@/modules/database/repositories/provider-models.js';
// projectsDb: used by Projects, Worktrees, Git, WebSocket, and notification modules to persist and resolve project records.
export { projectsDb } from '@/modules/database/repositories/projects.db.js';
// queuedMessagesDb: per-session queued messages (ui11 phase 1).
export { queuedMessagesDb, type QueuedMessageRow } from '@/modules/database/repositories/queued-messages.db.js';
export { pushSubscriptionsDb } from '@/modules/database/repositories/push-subscriptions.js';
export { scanStateDb } from '@/modules/database/repositories/scan-state.db.js';
export { sessionsDb } from '@/modules/database/repositories/sessions.db.js';
export { userDb } from '@/modules/database/repositories/users.js';
// userSettingsDb: per-user synced client preferences (ui11 phase 1).
export { userSettingsDb } from '@/modules/database/repositories/user-settings.db.js';
// watchdogDb: persists the watchdog's chain/dispatched-run registries across restarts.
export { watchdogDb } from '@/modules/database/repositories/watchdog.db.js';
export { vapidKeysDb } from '@/modules/database/repositories/vapid-keys.js';
