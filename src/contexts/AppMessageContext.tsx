import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  addAppMessage,
  dismissAppMessage,
  type AppMessage,
} from '../components/app/appMessages';

type ReportedFailure = Omit<AppMessage, 'detail'> & { detail?: string | null };

type AppMessageContextValue = {
  messages: AppMessage[];
  /** Puts one failure on the strip; the same id replaces its own entry. */
  reportFailure: (failure: ReportedFailure) => void;
  dismissFailure: (id: string) => void;
};

const AppMessageContext = createContext<AppMessageContextValue | null>(null);

/**
 * The app-level message surface's store (audit1 job 8). Mounted once by
 * AppContent; components report through the hook, which is a no-op outside a
 * provider so an isolated render (tests, the Electron shells) still works.
 */
export function AppMessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AppMessage[]>([]);

  const reportFailure = useCallback((failure: ReportedFailure) => {
    setMessages((previous) => addAppMessage(previous, { ...failure, detail: failure.detail ?? null }));
  }, []);

  const dismissFailure = useCallback((id: string) => {
    setMessages((previous) => dismissAppMessage(previous, id));
  }, []);

  const value = useMemo<AppMessageContextValue>(
    () => ({ messages, reportFailure, dismissFailure }),
    [messages, reportFailure, dismissFailure],
  );

  return <AppMessageContext.Provider value={value}>{children}</AppMessageContext.Provider>;
}

const NO_MESSAGES: AppMessage[] = [];

export function useAppMessages(): AppMessageContextValue {
  const context = useContext(AppMessageContext);
  return useMemo<AppMessageContextValue>(
    () => context ?? {
      messages: NO_MESSAGES,
      reportFailure: () => undefined,
      dismissFailure: () => undefined,
    },
    [context],
  );
}

/** The reporting half alone, for hooks that never render the strip. */
export function useReportFailure(): (failure: ReportedFailure) => void {
  return useAppMessages().reportFailure;
}
