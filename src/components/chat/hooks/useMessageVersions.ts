import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../../../utils/api';
import type { SessionActivityMap } from '../../../hooks/useSessionProtection';
import {
  groupVersionRows,
  type MessageVersionGroup,
  type MessageVersionView,
} from '../utils/messageVersions';

export type MessageEditContext = {
  groupId: string;
  anchorUserMessageId: string;
  anchorPromptText: string;
};

/**
 * Edit-and-resend version state for the open session (ui9 B3): the server
 * rows, local selection overrides, and the optimistic mirror of what the
 * server records when an edit is resent. Rows refetch when the session's run
 * ends so this client converges with the server after every turn.
 */
export function useMessageVersions({
  sessionId,
  processingSessions,
}: {
  sessionId: string | null;
  processingSessions?: SessionActivityMap;
}) {
  const [groups, setGroups] = useState<MessageVersionGroup[]>([]);
  const [selections, setSelections] = useState<Map<string, number>>(new Map());
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const fetchVersions = useCallback(async (targetSessionId: string) => {
    try {
      const response = await api.sessionMessageVersions(targetSessionId);
      if (!response.ok) return;
      const body = await response.json();
      const rows = Array.isArray(body?.data?.versions) ? body.data.versions : [];
      if (sessionRef.current !== targetSessionId) return;
      setGroups(groupVersionRows(rows));
    } catch (error) {
      console.error('Failed to fetch message versions:', error);
    }
  }, []);

  useEffect(() => {
    setGroups([]);
    setSelections(new Map());
    if (sessionId) void fetchVersions(sessionId);
  }, [sessionId, fetchVersions]);

  // Converge with the server once the session's run ends (the resend's rows
  // and the reconciled transcript land together).
  const isProcessing = Boolean(sessionId && processingSessions?.get(sessionId));
  const wasProcessingRef = useRef(isProcessing);
  useEffect(() => {
    const wasProcessing = wasProcessingRef.current;
    wasProcessingRef.current = isProcessing;
    if (wasProcessing && !isProcessing && sessionId) void fetchVersions(sessionId);
  }, [isProcessing, sessionId, fetchVersions]);

  /** Optimistic mirror of the server's recordResend, applied at send time. */
  const registerEditResend = useCallback((edit: MessageEditContext, promptText: string) => {
    const now = new Date().toISOString();
    setGroups((previous) => {
      const next = previous.map((group) => ({ ...group, versions: [...group.versions] }));
      let group = next.find((candidate) => candidate.groupId === edit.groupId);
      if (!group) {
        group = {
          groupId: edit.groupId,
          versions: [{
            groupId: edit.groupId,
            version: 1,
            userMessageId: edit.anchorUserMessageId,
            promptText: edit.anchorPromptText,
            isSelected: false,
            createdAt: now,
          }],
        };
        next.push(group);
      }
      const maxVersion = group.versions[group.versions.length - 1]?.version ?? 0;
      group.versions = group.versions.map((entry) => ({ ...entry, isSelected: false }));
      group.versions.push({
        groupId: edit.groupId,
        version: maxVersion + 1,
        userMessageId: null,
        promptText,
        isSelected: true,
        createdAt: now,
      });
      return next;
    });
    setSelections((previous) => {
      if (!previous.has(edit.groupId)) return previous;
      const next = new Map(previous);
      next.delete(edit.groupId);
      return next;
    });
  }, []);

  /**
   * A normal (non-edit) send continues the conversation's latest thread, so
   * every group flips back to its newest version — otherwise the new turn
   * would land in a hidden segment and render invisibly.
   */
  const revealLatestVersions = useCallback(() => {
    const targetSessionId = sessionRef.current;
    setSelections((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const group of groupsRef.current) {
        if (group.versions.length < 2) continue;
        const latest = group.versions[group.versions.length - 1].version;
        const effective = previous.get(group.groupId)
          ?? group.versions.find((entry) => entry.isSelected)?.version
          ?? latest;
        if (effective !== latest) {
          next.set(group.groupId, latest);
          changed = true;
          if (targetSessionId) {
            void api.selectSessionMessageVersion(targetSessionId, group.groupId, latest).catch(() => {});
          }
        }
      }
      return changed ? next : previous;
    });
  }, []);

  const selectVersion = useCallback((groupId: string, version: number) => {
    setSelections((previous) => new Map(previous).set(groupId, version));
    const targetSessionId = sessionRef.current;
    if (targetSessionId) {
      void api.selectSessionMessageVersion(targetSessionId, groupId, version).catch((error: unknown) => {
        console.error('Failed to persist message version selection:', error);
      });
    }
  }, []);

  const view = useMemo<MessageVersionView>(() => ({ groups, selections }), [groups, selections]);

  return { view, groups, registerEditResend, selectVersion, revealLatestVersions };
}
