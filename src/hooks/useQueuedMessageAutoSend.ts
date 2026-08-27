import { useEffect, useRef } from 'react';

import { claimNextQueuedMessage, readQueuedMessages } from '../components/chat/utils/chatStorage';

import type { MarkSessionProcessing, SessionActivityMap } from './useSessionProtection';

interface UseQueuedMessageAutoSendArgs {
  processingSessions: SessionActivityMap;
  /**
   * The session currently open in the chat view. Its queued drafts are owned
   * by the composer (which also handles file attachments and slash commands),
   * so this hook never touches it.
   */
  activeSessionId: string | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  markSessionProcessing: MarkSessionProcessing;
}

/**
 * Dispatches queued messages for sessions the user is NOT currently viewing.
 *
 * The composer persists each queued draft (text + send options snapshotted at
 * queue time) in the server-side queued-message store. When a session's run
 * leaves the processing map — its previous response completed — this hook
 * sends that session's next queued message immediately instead of waiting for
 * the user to open the session again; any messages behind it flush the same
 * way at the following turn ends, preserving order. Claiming (popping) the
 * server row before sending is what keeps the composer's own flush (on any
 * device) from double-sending, and sending the popped copy is what keeps a
 * stale device from sending outdated content.
 */
export function useQueuedMessageAutoSend({
  processingSessions,
  activeSessionId,
  ws,
  sendMessage,
  markSessionProcessing,
}: UseQueuedMessageAutoSendArgs) {
  const prevProcessingRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const prev = prevProcessingRef.current;
    const current = new Set(processingSessions.keys());
    prevProcessingRef.current = current;

    for (const sessionId of prev) {
      if (current.has(sessionId) || sessionId === activeSessionId) {
        continue;
      }

      if (readQueuedMessages(sessionId).length === 0) {
        continue;
      }

      // A closed socket would drop the send silently; keep the draft so the
      // composer (or a later completion) can retry once we're connected.
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      // The server row is the claim shared with the viewing composer on every
      // device: only the client whose delete popped it sends, and it sends the
      // popped server copy, not this tab's cached one.
      void claimNextQueuedMessage(sessionId).then((popped) => {
        if (!popped) {
          return;
        }
        sendMessage({
          type: 'chat.send',
          sessionId,
          content: popped.content,
          options: { ...(popped.options ?? {}), attachments: popped.attachments ?? [] },
        });
        markSessionProcessing(sessionId, { statusText: null, canInterrupt: true });
      });
    }
  }, [processingSessions, activeSessionId, ws, sendMessage, markSessionProcessing]);
}
