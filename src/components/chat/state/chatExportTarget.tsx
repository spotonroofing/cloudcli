import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { ChatMessage } from '../types/types';

/**
 * The pane's export target (ui17 job 10): the download control lives in the
 * pane top bar, but the transcript is what knows the messages. The transcript
 * registers a getter (held in a ref, so a new message never re-renders the
 * header) and publishes only the boolean "there is something to export", which
 * is all the header needs to decide whether to show the button.
 */
export type ChatExportSnapshot = {
  messages: ChatMessage[];
  sessionTitle?: string;
};

type ChatExportContextValue = {
  available: boolean;
  register: (getSnapshot: (() => ChatExportSnapshot) | null) => void;
  setAvailable: (available: boolean) => void;
  read: () => ChatExportSnapshot | null;
};

const ChatExportContext = createContext<ChatExportContextValue | null>(null);

export function ChatExportProvider({ children }: { children: ReactNode }) {
  const getSnapshotRef = useRef<(() => ChatExportSnapshot) | null>(null);
  const [available, setAvailable] = useState(false);

  const register = useCallback((getSnapshot: (() => ChatExportSnapshot) | null) => {
    getSnapshotRef.current = getSnapshot;
  }, []);

  const read = useCallback(() => (getSnapshotRef.current ? getSnapshotRef.current() : null), []);

  const value = useMemo<ChatExportContextValue>(
    () => ({ available, register, setAvailable, read }),
    [available, register, read],
  );

  return <ChatExportContext.Provider value={value}>{children}</ChatExportContext.Provider>;
}

export function useChatExportTarget() {
  return useContext(ChatExportContext);
}

/** Called by the transcript: keeps the getter fresh and flips availability. */
export function useProvideChatExport(messages: ChatMessage[], sessionTitle?: string) {
  const ctx = useContext(ChatExportContext);
  const latest = useRef<ChatExportSnapshot>({ messages, sessionTitle });
  latest.current = { messages, sessionTitle };

  const hasMessages = messages.length > 0;

  useEffect(() => {
    if (!ctx) return undefined;
    ctx.register(() => latest.current);
    return () => ctx.register(null);
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setAvailable(hasMessages);
    return () => ctx.setAvailable(false);
  }, [ctx, hasMessages]);
}
