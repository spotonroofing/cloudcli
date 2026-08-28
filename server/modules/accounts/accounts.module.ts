import { appConfigDb } from '@/modules/database/index.js';
import { sendFleetNotification } from '@/modules/notifications/index.js';
import { settingsService } from '@/modules/settings/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/index.js';
import type { RealtimeClientConnection } from '@/shared/types.js';

import { createAccountUsageMonitor } from './account-usage.service.js';
import { listAccounts } from './accounts.service.js';

const ALERT_STATE_KEY = 'account_usage_alert_state_v1';
const visibleClients = new Set<RealtimeClientConnection>();

/** Shared Accounts monitor consumed by routes, server startup, watchdog events, and interactive retry. */
export const accountUsageMonitor = createAccountUsageMonitor({
  readAccounts: listAccounts,
  getThresholds: () => settingsService.getUsageAlertSettings().thresholds,
  readState: () => appConfigDb.get(ALERT_STATE_KEY),
  writeState: (value) => appConfigDb.set(ALERT_STATE_KEY, value),
  notify: ({ key, title, body, data }) => {
    void sendFleetNotification({ kind: 'usage-alert', title, body, data: { ...data, alertKey: key } });
    const frame = JSON.stringify({
      kind: 'fleet_notification',
      notificationKind: 'usage-alert',
      title,
      body,
      alertKey: key,
      data,
      timestamp: new Date().toISOString(),
    });
    connectedClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(frame);
    });
  },
  broadcastAccounts: (payload, reason) => {
    const frame = JSON.stringify({
      kind: 'accounts_usage',
      data: payload,
      reason,
      timestamp: new Date().toISOString(),
    });
    visibleClients.forEach((client) => {
      if (client.readyState === WS_OPEN_STATE) client.send(frame);
    });
  },
  now: () => new Date(),
  setInterval,
  clearInterval,
});

/** Chat WebSocket gateway marks one client as actively viewing a usage surface. */
export function setAccountUsageClientVisible(client: RealtimeClientConnection, visible: boolean): void {
  if (visible) visibleClients.add(client);
  else visibleClients.delete(client);
  accountUsageMonitor.setObserverCount(visibleClients.size);
}
