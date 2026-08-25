import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';

import type { SessionMemoryUpdate } from './useChatMessages';

/**
 * Persisted memory-updated rows for the open session (ui12 phase 7): fetched
 * on session open so the indicator rows survive reload, and refetched when the
 * session's run ends so a turn's writes land without a manual refresh (live
 * frames cover the in-run window; the refetch converges with the DB).
 */
export function useMemoryUpdates({
  sessionId,
  processingSessions,
}: {
  sessionId: string | null;
  processingSessions?: SessionActivityMap;
}) {
  const [updates, setUpdates] = useState<SessionMemoryUpdate[]>([]);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const fetchUpdates = useCallback(async (targetSessionId: string) => {
    try {
      const response = await api.sessionMemoryUpdates(targetSessionId);
      if (!response.ok) return;
      const body = await response.json();
      const rows = Array.isArray(body?.data?.updates) ? body.data.updates : [];
      if (sessionRef.current !== targetSessionId) return;
      setUpdates(rows);
    } catch (error) {
      console.error('Failed to fetch memory updates:', error);
    }
  }, []);

  useEffect(() => {
    setUpdates([]);
    if (sessionId) void fetchUpdates(sessionId);
  }, [sessionId, fetchUpdates]);

  const isProcessing = Boolean(sessionId && processingSessions?.get(sessionId));
  const wasProcessingRef = useRef(isProcessing);
  useEffect(() => {
    const wasProcessing = wasProcessingRef.current;
    wasProcessingRef.current = isProcessing;
    if (wasProcessing && !isProcessing && sessionId) void fetchUpdates(sessionId);
  }, [isProcessing, sessionId, fetchUpdates]);

  return { updates };
}
