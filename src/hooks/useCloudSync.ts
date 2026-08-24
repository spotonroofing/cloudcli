import { useEffect } from 'react';

import {
  applyRemoteQueuedMessage,
  hydrateQueuedMessages,
  queuedClientId,
  type StoredQueuedMessage,
} from '../components/chat/utils/chatStorage';
import type { ServerEvent } from '../contexts/WebSocketContext';
import { applyRemoteSettings, hydrateSettings, settingsClientId } from '../utils/cloudSettings';

type UseCloudSyncArgs = {
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
  /** Signed-in user id; platform mode has none and accepts every settings frame. */
  userId: number | string | null | undefined;
};

/**
 * Cross-device persistence (ui11 phase 1): hydrates the settings boot cache
 * and the queued-message cache from the server at app load and after every
 * socket reconnect, and applies other clients' `settings_updated` and
 * `queued_message_updated` broadcasts live.
 */
export function useCloudSync({ subscribe, userId }: UseCloudSyncArgs) {
  useEffect(() => {
    void hydrateSettings();
    void hydrateQueuedMessages();
  }, []);

  useEffect(() => {
    return subscribe((event) => {
      if (event.kind === 'websocket_reconnected') {
        void hydrateSettings();
        void hydrateQueuedMessages();
        return;
      }
      if (event.kind === 'settings_updated') {
        if (event.clientId === settingsClientId) {
          return;
        }
        if (userId != null && event.userId != null && String(event.userId) !== String(userId)) {
          return;
        }
        if (event.settings && typeof event.settings === 'object') {
          applyRemoteSettings(event.settings as Record<string, string | null>);
        }
        return;
      }
      if (event.kind === 'queued_message_updated') {
        if (event.clientId === queuedClientId || typeof event.sessionId !== 'string') {
          return;
        }
        applyRemoteQueuedMessage(event.sessionId, (event.message as StoredQueuedMessage | null) ?? null);
      }
    });
  }, [subscribe, userId]);
}
