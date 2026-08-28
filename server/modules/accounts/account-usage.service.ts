type UsageAlertThresholds = {
  accountWarning: number;
  accountUrgent: number;
  fleetWarning: number;
  fleetUrgent: number;
  fleetSevenDay: number;
};

type UsageAlert = {
  key: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

type MonitorDependencies = {
  readAccounts(): Promise<unknown>;
  getThresholds(): UsageAlertThresholds;
  readState(): string | null;
  writeState(value: string): void;
  notify(alert: UsageAlert): void | Promise<void>;
  broadcastAccounts(payload: unknown, reason: string): void;
  now(): Date;
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>;
  clearInterval(timer: ReturnType<typeof setInterval>): void;
};

type UsageWindow = { pct: number; resetsAt: string | null };
type ClaudeAccount = {
  number: number;
  email: string;
  alias: string | null;
  disabled: boolean;
  parkedUntil: string | null;
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
  fable: UsageWindow | null;
};
type UsageSnapshot = {
  raw: unknown;
  claude: ClaudeAccount[];
  chatgpt: { email: string | null; sevenDay: UsageWindow | null } | null;
};
type RecoveryStatus = { hasHeadroom: boolean; earliestResetAt: string | null };
type AlertState = { values: Record<string, number> };

const BACKGROUND_POLL_MS = 60_000;
const VISIBLE_POLL_MS = 15_000;
const EXHAUSTED_THRESHOLD = 100;

const record = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const windowReading = (value: unknown): UsageWindow | null => {
  const source = record(value);
  if (!source || typeof source.pct !== 'number' || !Number.isFinite(source.pct)) {
    return null;
  }
  return {
    pct: Math.max(0, Math.min(100, source.pct)),
    resetsAt: typeof source.resetsAt === 'string' ? source.resetsAt : null,
  };
};

const parseSnapshot = (raw: unknown): UsageSnapshot => {
  const source = record(raw) ?? {};
  const claude = (Array.isArray(source.accounts) ? source.accounts : []).flatMap((value) => {
    const account = record(value);
    if (!account || typeof account.number !== 'number' || typeof account.email !== 'string') {
      return [];
    }
    const usage = record(account.usage) ?? record(account.lastGoodUsage);
    const scoped = usage && Array.isArray(usage.scoped) ? usage.scoped : [];
    const fable = scoped
      .map(record)
      .find((entry) => typeof entry?.name === 'string' && entry.name.toLowerCase() === 'fable');
    return [{
      number: account.number,
      email: account.email,
      alias: typeof account.alias === 'string' ? account.alias : null,
      disabled: account.disabled === true,
      parkedUntil: typeof account.parkedUntil === 'string' ? account.parkedUntil : null,
      fiveHour: windowReading(usage?.fiveHour),
      sevenDay: windowReading(usage?.sevenDay),
      fable: windowReading(fable),
    }];
  });
  const chatgptSource = record(source.chatgpt);
  const chatgptUsage = record(chatgptSource?.usage);
  return {
    raw,
    claude,
    chatgpt: chatgptSource
      ? {
        email: typeof chatgptSource.email === 'string' ? chatgptSource.email : null,
        sevenDay: windowReading(chatgptUsage?.sevenDay),
      }
      : null,
  };
};

const average = (values: Array<number | null>): number | null => {
  const readable = values.filter((value): value is number => typeof value === 'number');
  if (readable.length === 0) return null;
  return readable.reduce((sum, value) => sum + value, 0) / readable.length;
};

const band = (value: number, thresholds: number[]): number => (
  thresholds.filter((threshold) => value >= threshold).length
);

const formatPercent = (threshold: number): string => `${Math.round(threshold)}%`;

const recoveryFrom = (snapshot: UsageSnapshot): RecoveryStatus => {
  const eligible = snapshot.claude.filter((account) => !account.disabled && !account.parkedUntil);
  const hasHeadroom = eligible.some((account) => account.fiveHour !== null && account.fiveHour.pct < 90);
  const resets = eligible
    .map((account) => account.fiveHour?.resetsAt ?? null)
    .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return { hasHeadroom, earliestResetAt: resets[0] ?? null };
};

/** Creates the Accounts module's cached-usage poller, threshold engine, and recovery signal. */
export function createAccountUsageMonitor(dependencies: MonitorDependencies) {
  let state: AlertState | null = null;
  let refreshTail: Promise<unknown> = Promise.resolve();
  let latest: UsageSnapshot | null = null;
  let backgroundTimer: ReturnType<typeof setInterval> | null = null;
  let visibleTimer: ReturnType<typeof setInterval> | null = null;
  let observerCount = 0;
  const recoveryListeners = new Set<(status: RecoveryStatus) => void>();

  const readAlertState = (): AlertState => {
    if (state) return state;
    try {
      const parsed = JSON.parse(dependencies.readState() ?? '') as Partial<AlertState>;
      state = { values: record(parsed.values) as Record<string, number> ?? {} };
    } catch {
      state = { values: {} };
    }
    return state;
  };

  const evaluate = async (snapshot: UsageSnapshot): Promise<void> => {
    const thresholds = dependencies.getThresholds();
    const alertState = readAlertState();
    let stateChanged = false;
    const crossed = async (
      key: string,
      pct: number | null,
      crossings: number[],
      onCrossing: (threshold: number) => UsageAlert | null,
    ) => {
      if (pct === null) return;
      const previous = alertState.values[key];
      if (typeof previous !== 'number') {
        alertState.values[key] = pct;
        stateChanged = true;
        return;
      }
      const normalized = [...new Set(crossings)].sort((left, right) => left - right);
      const hits = normalized.filter((threshold) => previous < threshold && pct >= threshold);
      for (const threshold of hits) {
        const alert = onCrossing(threshold);
        if (alert) await dependencies.notify(alert);
      }
      if (hits.length > 0 || band(previous, normalized) !== band(pct, normalized)) {
        alertState.values[key] = pct;
        stateChanged = true;
      }
    };

    for (const account of snapshot.claude) {
      if (account.disabled || account.parkedUntil) continue;
      await crossed(
        `claude:${account.email}:5h`,
        account.fiveHour?.pct ?? null,
        [thresholds.accountWarning, thresholds.accountUrgent, EXHAUSTED_THRESHOLD],
        (threshold) => {
          const alternatives = snapshot.claude
            .filter((candidate) => (
              candidate.number !== account.number
              && !candidate.disabled
              && !candidate.parkedUntil
              && candidate.fiveHour !== null
            ))
            .sort((left, right) => (left.fiveHour?.pct ?? 101) - (right.fiveHour?.pct ?? 101));
          const fresh = alternatives.find((candidate) => (
            (candidate.fiveHour?.pct ?? 101) < thresholds.accountWarning
          ));
          if (fresh) return null;
          const best = alternatives[0] ?? null;
          const displayName = account.alias || account.email;
          const title = threshold === EXHAUSTED_THRESHOLD
            ? `${displayName} 5h window exhausted`
            : `${displayName} 5h window at ${formatPercent(threshold)}`;
          const body = best
            ? `Best swap target ${best.alias || best.email} is already at ${Math.round(best.fiveHour?.pct ?? 100)}%.`
            : 'No other enabled Claude account has a reliable 5h reading.';
          return {
            key: `claude:${account.email}:5h:${threshold}`,
            title,
            body,
            data: { provider: 'claude', account: account.email, window: '5h', threshold },
          };
        },
      );
    }

    if (snapshot.chatgpt?.sevenDay) {
      const label = snapshot.chatgpt.email ? `ChatGPT (${snapshot.chatgpt.email})` : 'ChatGPT';
      await crossed(
        `chatgpt:${snapshot.chatgpt.email ?? 'account'}:7d`,
        snapshot.chatgpt.sevenDay.pct,
        [thresholds.accountWarning, thresholds.accountUrgent, EXHAUSTED_THRESHOLD],
        (threshold) => ({
          key: `chatgpt:7d:${threshold}`,
          title: threshold === EXHAUSTED_THRESHOLD
            ? `${label} 7-day window exhausted`
            : `${label} 7-day window at ${formatPercent(threshold)}`,
          body: 'ChatGPT usage is separate from Claude account switching.',
          data: { provider: 'chatgpt', window: '7d', threshold },
        }),
      );
    }

    const fleetMetrics: Array<{
      key: string;
      label: string;
      pct: number | null;
      crossings: number[];
    }> = [
      {
        key: 'fleet:5h',
        label: '5h',
        pct: average(snapshot.claude.map((account) => account.fiveHour?.pct ?? null)),
        crossings: [thresholds.fleetWarning, thresholds.fleetUrgent],
      },
      {
        key: 'fleet:7d',
        label: '7-day',
        pct: average(snapshot.claude.map((account) => account.sevenDay?.pct ?? null)),
        crossings: [thresholds.fleetSevenDay],
      },
      {
        key: 'fleet:fable',
        label: 'Fable',
        pct: average(snapshot.claude.map((account) => account.fable?.pct ?? null)),
        crossings: [thresholds.fleetWarning, thresholds.fleetUrgent],
      },
    ];
    for (const metric of fleetMetrics) {
      await crossed(metric.key, metric.pct, metric.crossings, (threshold) => ({
        key: `${metric.key}:${threshold}`,
        title: `Fleet ${metric.label} window at ${formatPercent(threshold)}`,
        body: `Aggregate across ${snapshot.claude.length} managed Claude account${snapshot.claude.length === 1 ? '' : 's'}.`,
        data: { provider: 'claude', fleet: true, window: metric.label, threshold },
      }));
    }

    if (stateChanged) {
      dependencies.writeState(JSON.stringify(alertState));
    }
  };

  const doRefresh = async (reason: string): Promise<RecoveryStatus> => {
    const raw = await dependencies.readAccounts();
    const snapshot = parseSnapshot(raw);
    await evaluate(snapshot);
    latest = snapshot;
    dependencies.broadcastAccounts(raw, reason);
    const recovery = recoveryFrom(snapshot);
    recoveryListeners.forEach((listener) => listener(recovery));
    return recovery;
  };

  const refresh = (reason = 'manual'): Promise<RecoveryStatus> => {
    const operation = refreshTail.then(() => doRefresh(reason), () => doRefresh(reason));
    refreshTail = operation.catch(() => undefined);
    return operation;
  };

  return {
    /** Server startup begins one cheap cadence over cswap's daemon-owned cache. */
    start(): void {
      if (backgroundTimer) return;
      void refresh('startup').catch((error) => {
        console.error('[Accounts] Initial usage refresh failed:', error);
      });
      backgroundTimer = dependencies.setInterval(() => {
        void refresh('cadence').catch((error) => {
          console.error('[Accounts] Usage refresh failed:', error);
        });
      }, BACKGROUND_POLL_MS);
      backgroundTimer.unref?.();
    },
    /** Server shutdown clears monitor timers. */
    stop(): void {
      if (backgroundTimer) dependencies.clearInterval(backgroundTimer);
      if (visibleTimer) dependencies.clearInterval(visibleTimer);
      backgroundTimer = null;
      visibleTimer = null;
    },
    /** Routes and limit handlers request immediate cached readings after events. */
    refresh,
    /** WebSocket gateway changes the short cadence only while a usage surface is visible. */
    setObserverCount(count: number): void {
      observerCount = Math.max(0, count);
      if (observerCount > 0 && !visibleTimer) {
        void refresh('visible').catch(() => undefined);
        visibleTimer = dependencies.setInterval(() => {
          void refresh('visible-cadence').catch(() => undefined);
        }, VISIBLE_POLL_MS);
        visibleTimer.unref?.();
      } else if (observerCount === 0 && visibleTimer) {
        dependencies.clearInterval(visibleTimer);
        visibleTimer = null;
      }
    },
    /** Interactive limit recovery reads current Claude swap headroom. */
    getRecoveryStatus(): RecoveryStatus {
      return latest ? recoveryFrom(latest) : { hasHeadroom: false, earliestResetAt: null };
    },
    /** Interactive limit recovery retries early when a later cache reading regains headroom. */
    subscribeRecovery(listener: (status: RecoveryStatus) => void): () => void {
      recoveryListeners.add(listener);
      return () => recoveryListeners.delete(listener);
    },
  };
}
