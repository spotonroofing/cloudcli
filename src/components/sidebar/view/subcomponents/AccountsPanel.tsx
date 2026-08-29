import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Ban, ChevronDown, ChevronUp, Loader2, LogIn, Power, Undo2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import ProviderMark from '../../../llm-provider-logo/ProviderMark';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import { Skeleton } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import { cn } from '../../../../lib/utils';

import SidebarFooterDrawer from './SidebarFooterDrawer';

/**
 * Claude accounts panel (ui8 phase 6; revamped ui14 job 4). One borderless
 * row per cswap account on the sidebar row anatomy: slot numeral, the name in
 * full, and the 5h / 7d / per-model meters underneath with reset countdowns.
 * The active row carries the accent wash; there is no dot. Row actions (use,
 * hold/return, reorder) take no space at rest on desktop and appear on hover
 * or focus, which is the only time the name truncates; touch shows them
 * always. Below the Claude accounts sits the ChatGPT group (codex job 3):
 * the one Codex login on the very same `AccountRow`, read from Codex's own
 * rollout files and pushed live over the websocket while the drawer is open.
 * No controls there: there is one login and nothing switches it. Accounts are
 * added by hand on the mini, so the drawer carries no add flow (ui17 job 4).
 */

type CswapWindow = {
  pct?: number;
  resetsAt?: string;
  countdown?: string;
  clock?: string;
};

type CswapScoped = CswapWindow & { name?: string };

type CswapUsage = {
  fiveHour?: CswapWindow;
  sevenDay?: CswapWindow;
  scoped?: CswapScoped[];
};

export type CswapAccount = {
  number: number;
  email: string;
  alias?: string;
  active: boolean;
  disabled?: boolean;
  usageStatus?: string;
  usage?: CswapUsage | null;
  lastGoodUsage?: CswapUsage | null;
  usageFetchedAt?: string;
  parkedUntil?: string;
  plan?: string;
};

export type ChatgptAccount = {
  email: string | null;
  plan: string | null;
  state: 'ok' | 'logged_out' | 'stale';
  usage: { fiveHour?: CswapWindow; sevenDay?: CswapWindow; readAt: string } | null;
};

type AccountList = { accounts: CswapAccount[]; chatgpt: ChatgptAccount | null };

type AccountsPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reports the active account's email whenever a fresh list arrives. */
  onActiveChange: (email: string | null) => void;
  /** Phone renders a full-width bottom sheet; desktop unfolds in-flow above
      the footer taskbar (ui13 job 4). */
  isMobile: boolean;
  dismissOnOutside?: boolean;
  t: TFunction;
};

const fetchAccountList = async (): Promise<AccountList> => {
  const response = await authenticatedFetch('/api/accounts');
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to load accounts');
  }
  const accounts = body?.data?.accounts;
  const chatgpt = body?.data?.chatgpt;
  return {
    accounts: Array.isArray(accounts) ? (accounts as CswapAccount[]) : [],
    chatgpt: chatgpt && typeof chatgpt === 'object' ? (chatgpt as ChatgptAccount) : null,
  };
};

/** "12s", "5m", "3h", "2d": how old the ChatGPT reading is. */
const formatAge = (readAt: string, now: number): string => {
  const seconds = Math.max(0, Math.round((now - Date.parse(readAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
};

const postAccountAction = async (url: string, payload: Record<string, unknown>) => {
  const response = await authenticatedFetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || 'Account action failed');
  }
  return body?.data;
};

const ROW_ACTION_CLASS =
  'touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30';

/** One usage meter: label, the bar, percent, reset countdown. */
function UsageBar({
  label,
  kind,
  window: win,
  emptyLabel,
}: {
  label: string;
  kind: string;
  window: CswapWindow | undefined;
  emptyLabel?: string;
}) {
  const pct = typeof win?.pct === 'number' ? Math.max(0, Math.min(100, win.pct)) : null;
  const reset = win?.countdown || win?.clock || null;

  return (
    <div
      className="flex items-center gap-2"
      data-slot="account-usage-bar"
      data-usage-kind={kind}
      data-pct={pct ?? ''}
    >
      <span className="w-9 flex-shrink-0 truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {pct === null && emptyLabel ? (
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" data-slot="account-usage-empty">
          {emptyLabel}
        </span>
      ) : (
        <>
      <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
        {pct !== null && (
          <span
            className={cn(
              'block h-full rounded-sm',
              pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </span>
      <span className="w-7 flex-shrink-0 text-right text-[10px] tabular-nums text-foreground">
        {pct !== null ? `${Math.round(pct)}%` : '—'}
      </span>
      <span className="w-10 flex-shrink-0 whitespace-nowrap text-right text-[10px] tabular-nums text-muted-foreground">
        {reset ?? ''}
      </span>
        </>
      )}
    </div>
  );
}

function PlanTag({ plan }: { plan?: string | null }) {
  if (!plan) return null;
  return (
    <span
      className="flex-shrink-0 rounded-sm border border-border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
      data-slot="account-plan"
    >
      {plan}
    </span>
  );
}

function ProviderGroupHeader({ provider }: { provider: 'claude' | 'chatgpt' }) {
  return (
    <li
      className="flex items-center gap-2 px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
      data-slot="account-group-header"
      data-provider={provider}
    >
      {/* The model switcher's marks: a plain glyph in the ink around it, no
          disc, plate or tint behind it, so both providers read the same. */}
      <span className="flex w-4 flex-shrink-0 justify-end text-foreground" aria-hidden="true">
        <ProviderMark provider={provider === 'claude' ? 'claude' : 'codex'} className="h-3.5 w-3.5" />
      </span>
      <span>{provider === 'claude' ? 'Claude' : 'ChatGPT'}</span>
    </li>
  );
}

type AccountMeter = {
  key: string;
  label: string;
  kind: string;
  window?: CswapWindow;
  emptyLabel?: string;
};

/**
 * The one account row both providers use (ui17 job 4), so the two lists
 * cannot drift again: the slot numeral, the email, its tags and any row
 * actions on the header line, then the meters and the meta line indented to
 * the email's left edge. The header line wraps rather than crushing the
 * email — on a phone the tags and actions drop under it once the email is
 * down to its minimum, which no viewport takes below eight characters.
 */
function AccountRow({
  number,
  email,
  plan,
  tag,
  actions,
  meters,
  meta,
  active = false,
  dim = false,
  attributes,
}: {
  number: ReactNode;
  email: string;
  plan?: string | null;
  tag?: ReactNode;
  actions?: ReactNode;
  meters: AccountMeter[];
  meta: ReactNode;
  active?: boolean;
  dim?: boolean;
  attributes?: Record<string, string | number | boolean | undefined>;
}) {
  const trailing = tag || plan || actions;
  return (
    <li
      className={cn('group rounded-lg px-2 py-2.5', active && 'bg-accent/40', dim && 'opacity-60')}
      data-slot="account-row"
      {...attributes}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-4 flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          {number}
        </span>
        <span
          className={cn(
            'min-w-[10ch] flex-1 truncate text-[13px] font-medium',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
          data-slot="account-name"
        >
          {email}
        </span>
        {trailing && (
          <span className="ml-auto flex max-w-full flex-shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {tag}
            <PlanTag plan={plan} />
            {actions}
          </span>
        )}
      </div>

      <div className="mt-1.5 space-y-1 pl-6">
        {meters.map((meter) => (
          <UsageBar
            key={meter.key}
            label={meter.label}
            kind={meter.kind}
            window={meter.window}
            emptyLabel={meter.emptyLabel}
          />
        ))}
        {meta}
      </div>
    </li>
  );
}

export default function AccountsPanel({ open, onOpenChange, onActiveChange, isMobile, dismissOnOutside = false, t }: AccountsPanelProps) {
  const [accounts, setAccounts] = useState<CswapAccount[] | null>(null);
  const [chatgpt, setChatgpt] = useState<ChatgptAccount | null>(null);
  /** Ticks while open so the ChatGPT "updated ago" hint stays honest. */
  const [now, setNow] = useState(() => Date.now());
  const { isConnected, sendMessage, subscribe } = useWebSocket();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `<action>:<slot>` while a row action runs; disables every action. */
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAccountList();
      setAccounts(list.accounts);
      setChatgpt(list.chatgpt);
      setNow(Date.now());
      setError(null);
      onActiveChange(list.accounts.find((account) => account.active)?.email ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onActiveChange]);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setError(null);
    }
  }, [open, refresh]);

  // The cache-backed short cadence runs only while this usage surface is
  // visible. Reconnects re-subscribe; closing removes the server-side watcher.
  useEffect(() => {
    if (!open || !isConnected) return;
    sendMessage({ type: 'accounts.subscribe' });
    return () => sendMessage({ type: 'accounts.unsubscribe' });
  }, [isConnected, open, sendMessage]);

  // The ChatGPT meters update live: the server pushes `chatgpt_usage` when a
  // Codex rollout carries a newer reading. Only an open drawer listens.
  useEffect(() => {
    if (!open) return;
    return subscribe((event) => {
      if (event.kind === 'accounts_usage' && event.data && typeof event.data === 'object') {
        const payload = event.data as Partial<AccountList>;
        if (Array.isArray(payload.accounts)) {
          setAccounts(payload.accounts);
          onActiveChange(payload.accounts.find((account) => account.active)?.email ?? null);
        }
        if (payload.chatgpt && typeof payload.chatgpt === 'object') setChatgpt(payload.chatgpt);
        setNow(Date.now());
      } else if (event.kind === 'chatgpt_usage' && event.chatgpt && typeof event.chatgpt === 'object') {
        setChatgpt(event.chatgpt as ChatgptAccount);
        setNow(Date.now());
      }
    });
  }, [onActiveChange, open, subscribe]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [open]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const switchTo = (account: CswapAccount) =>
    runAction(`switch:${account.number}`, async () => {
      const data = await postAccountAction('/api/accounts/switch', { target: String(account.number) });
      if (data && data.mirrored === false) {
        setError(
          t(
            'accounts.mirrorFailed',
            'Switched, but this instance could not refresh its own credentials — new sessions may still use the previous account until the server restarts.',
          ),
        );
      }
    });

  const toggleDisabled = (account: CswapAccount) =>
    runAction(`toggle:${account.number}`, async () => {
      await postAccountAction(account.disabled ? '/api/accounts/enable' : '/api/accounts/disable', {
        target: String(account.number),
      });
    });

  const swapWith = (account: CswapAccount, neighbor: CswapAccount) =>
    runAction(`swap:${account.number}`, async () => {
      await postAccountAction('/api/accounts/swap', {
        a: String(account.number),
        b: String(neighbor.number),
      });
    });

  const unpark = (account: CswapAccount) =>
    runAction(`unpark:${account.number}`, async () => {
      await postAccountAction('/api/accounts/unpark', { target: String(account.number) });
    });

  const sorted = (accounts ?? []).slice().sort((a, b) => a.number - b.number);

  return (
    <SidebarFooterDrawer
      open={open}
      onClose={() => onOpenChange(false)}
      isMobile={isMobile}
      dismissOnOutside={dismissOnOutside}
      ariaLabel={t('accounts.title', 'Accounts')}
      dataSlot="accounts-panel"
    >
      {/* Top padding, not a divider, separates the panel from the list above. */}
      <ul className="max-h-[60dvh] space-y-1 overflow-y-auto px-2 pb-2 pt-3">
        {loading && accounts === null && (
          <li className="space-y-2 px-2 py-2" data-slot="accounts-skeleton" aria-busy="true">
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2 rounded-lg py-1">
                <div className="flex h-7 items-center gap-2">
                  <Skeleton className="h-3 w-4 rounded-sm" />
                  <Skeleton className="h-3 rounded-sm" style={{ width: `${[62, 48, 70][row]}%` }} />
                </div>
                <Skeleton className="ml-6 h-1 w-[calc(100%_-_1.5rem)] rounded-sm" />
                <Skeleton className="ml-6 h-1 w-[calc(100%_-_1.5rem)] rounded-sm" />
              </div>
            ))}
          </li>
        )}
        {accounts !== null && <ProviderGroupHeader provider="claude" />}
        {sorted.map((account, index) => {
          const usage = account.usage ?? account.lastGoodUsage ?? undefined;
          const scoped = Array.isArray(usage?.scoped) ? usage.scoped : [];
          const rowBusy = busy !== null && busy.endsWith(`:${account.number}`);
          return (
            <AccountRow
              key={account.number}
              number={account.number}
              email={account.alias || account.email}
              plan={account.plan}
              active={account.active}
              dim={Boolean(account.disabled)}
              attributes={{
                'data-account-number': account.number,
                'data-active': account.active || undefined,
                'data-disabled': account.disabled || undefined,
                'data-parked': account.parkedUntil || undefined,
              }}
              tag={
                account.disabled ? (
                  <span className="flex-shrink-0 rounded-sm border border-border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('accounts.disabledTag', 'disabled')}
                  </span>
                ) : null
              }
              actions={
                /* Actions take no width at rest on desktop, so the email has
                   the whole row; they appear (and the email truncates) only
                   on hover or focus. Touch shows them always. */
                <span
                  className="flex flex-shrink-0 items-center gap-0.5 md:hidden md:group-focus-within:flex md:group-hover:flex"
                  data-slot="account-actions"
                >
                  {rowBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      {account.parkedUntil && (
                        <button
                          className={ROW_ACTION_CLASS}
                          onClick={() => void unpark(account)}
                          disabled={busy !== null}
                          title={t('accounts.unpark', 'Unpark')}
                          aria-label={`${t('accounts.unpark', 'Unpark')}: ${account.email}`}
                          data-slot="account-unpark"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!account.active && !account.disabled && !account.parkedUntil && (
                        <button
                          className={ROW_ACTION_CLASS}
                          onClick={() => void switchTo(account)}
                          disabled={busy !== null}
                          title={t('accounts.use', 'Use this account')}
                          aria-label={`${t('accounts.use', 'Use this account')}: ${account.email}`}
                          data-slot="account-use"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!account.active && !account.parkedUntil && (
                        <button
                          className={ROW_ACTION_CLASS}
                          onClick={() => void toggleDisabled(account)}
                          disabled={busy !== null}
                          title={
                            account.disabled
                              ? t('accounts.enable', 'Return to rotation')
                              : t('accounts.disable', 'Hold out of rotation')
                          }
                          aria-label={`${
                            account.disabled
                              ? t('accounts.enable', 'Return to rotation')
                              : t('accounts.disable', 'Hold out of rotation')
                          }: ${account.email}`}
                          data-slot="account-toggle-disabled"
                        >
                          {account.disabled ? <Power className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      <button
                        className={ROW_ACTION_CLASS}
                        onClick={() => void swapWith(account, sorted[index - 1])}
                        disabled={busy !== null || index === 0}
                        title={t('accounts.moveUp', 'Move up')}
                        aria-label={`${t('accounts.moveUp', 'Move up')}: ${account.email}`}
                        data-slot="account-move-up"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        className={ROW_ACTION_CLASS}
                        onClick={() => void swapWith(account, sorted[index + 1])}
                        disabled={busy !== null || index === sorted.length - 1}
                        title={t('accounts.moveDown', 'Move down')}
                        aria-label={`${t('accounts.moveDown', 'Move down')}: ${account.email}`}
                        data-slot="account-move-down"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </span>
              }
              meters={[
                { key: '5h', label: t('accounts.fiveHour', '5h'), kind: '5h', window: usage?.fiveHour },
                { key: '7d', label: t('accounts.sevenDay', '7d'), kind: '7d', window: usage?.sevenDay },
                ...scoped.map((entry) => ({
                  key: `scoped:${entry.name ?? ''}`,
                  label: entry.name ?? t('accounts.model', 'Model'),
                  kind: `scoped:${entry.name ?? ''}`,
                  window: entry,
                })),
              ]}
              meta={
                <p
                  className={cn('text-[10px] text-muted-foreground', account.parkedUntil && 'text-amber-600 dark:text-amber-400')}
                  data-slot={account.parkedUntil ? 'account-parked-meta' : 'account-usage-meta'}
                >
                  {account.parkedUntil
                    ? t('accounts.parkedUntil', 'parked until {{date}}', { date: account.parkedUntil })
                    : account.usageFetchedAt
                      ? t('accounts.updatedAgo', 'updated {{age}} ago', { age: formatAge(account.usageFetchedAt, now) })
                      : t('accounts.noUsage', 'no usage recorded yet')}
                </p>
              }
            />
          );
        })}

        {accounts !== null && sorted.length === 0 && !loading && (
          <li className="px-2 py-2 text-xs text-muted-foreground">
            {t('accounts.empty', 'No managed accounts yet.')}
          </li>
        )}

        {/* The ChatGPT group (codex job 3): the same row, no controls. */}
        {chatgpt && (
          <>
            <ProviderGroupHeader provider="chatgpt" />
            <AccountRow
              number={1}
              email={chatgpt.email ?? 'ChatGPT'}
              plan={chatgpt.plan}
              attributes={{ 'data-account': 'chatgpt', 'data-state': chatgpt.state }}
              meters={
                chatgpt.state === 'ok'
                  ? [
                      {
                        key: '5h',
                        label: t('accounts.fiveHour', '5h'),
                        kind: '5h',
                        window: chatgpt.usage?.fiveHour,
                        emptyLabel: t('accounts.noFiveHourWindow', 'no 5-hour window on this plan'),
                      },
                      { key: '7d', label: t('accounts.sevenDay', '7d'), kind: '7d', window: chatgpt.usage?.sevenDay },
                    ]
                  : []
              }
              meta={
                chatgpt.state === 'ok' ? (
                  <p className="text-[10px] text-muted-foreground" data-slot="account-usage-meta">
                    {chatgpt.usage
                      ? t('accounts.updatedAgo', 'updated {{age}} ago', { age: formatAge(chatgpt.usage.readAt, now) })
                      : t('accounts.noUsage', 'no usage recorded yet')}
                  </p>
                ) : (
                  <p className="text-[10px] text-muted-foreground" data-slot="account-login-fix">
                    {chatgpt.state === 'logged_out'
                      ? t('accounts.chatgptLoggedOut', 'Logged out.')
                      : t('accounts.chatgptStale', 'Login stale.')}{' '}
                    <span className="font-mono text-foreground">codex login</span> on the mini
                  </p>
                )
              }
            />
          </>
        )}
      </ul>

      {error && (
        <p className="px-4 pb-3 text-xs text-destructive" data-slot="accounts-error">
          {error}
        </p>
      )}

    </SidebarFooterDrawer>
  );
}
