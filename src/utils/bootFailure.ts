/**
 * A failed boot's one line and who shows it (ui17 jobs 17 and 21).
 *
 * Two sources say a boot failed: the live frame the pane just received, and
 * the `bootState` / `bootError` the session record carries. A reopened handoff
 * successor has only the persisted pair, so the pane and the sidebar row both
 * read them through here and land on the same sentence.
 */

/** Shown when a failure left no line of its own. */
export const BOOT_FAILED_FALLBACK_REASON = 'The session failed to start.';

/** Sidebar Retry asks the pane holding that session to re-run its boot. */
export const BOOT_RETRY_REQUESTED_EVENT = 'command-center:boot-retry-requested';

type BootFailureInput = {
  /** The pane's own boot phase (idle when it owns no boot right now). */
  bootPhase: 'idle' | 'booting' | 'failed';
  /** The line the live failure frame carried, if any. */
  bootReason?: string | null;
  /** True when the pane's boot record belongs to the session on screen. */
  viewingBootSession: boolean;
  /** Persisted boot lifecycle on the session record. */
  sessionBootState?: string | null;
  /** Persisted line on the session record. */
  sessionBootError?: string | null;
  /** A ready assistant message means the chat became usable despite the stamp. */
  hasReadyAssistantText?: boolean;
};

/**
 * Whether the failed-boot view shows, and the one line it shows. The live
 * frame wins over the persisted line; a reopened session with no live record
 * falls back to what the server wrote when the boot died.
 */
export const resolveBootFailure = ({
  bootPhase,
  bootReason = null,
  viewingBootSession,
  sessionBootState = null,
  sessionBootError = null,
  hasReadyAssistantText = false,
}: BootFailureInput): { failed: boolean; reason: string | null } => {
  const liveFailed = viewingBootSession && bootPhase === 'failed';
  const persistedFailed =
    bootPhase === 'idle' && sessionBootState === 'failed' && !hasReadyAssistantText;
  const reason =
    (viewingBootSession ? bootReason : null)
    ?? (typeof sessionBootError === 'string' && sessionBootError.trim() ? sessionBootError : null);

  return { failed: liveFailed || persistedFailed, reason };
};
