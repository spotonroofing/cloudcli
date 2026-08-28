import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, ChevronDown, ChevronUp, Loader2, LogIn, Plus, Power, Terminal, Undo2 } from 'lucide-react';
import type { TFunction } from 'i18next';

import ProviderLoginModal from '../../../provider-auth/view/ProviderLoginModal';
import { useWebSocket } from '../../../../contexts/WebSocketContext';
import { Button } from '../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../utils/api';
import { cn } from '../../../../lib/utils';
import { addCompleted, captureAddBaseline } from '../../utils/accountsAdd';
import type { AddBaseline } from '../../utils/accountsAdd';

import SidebarFooterDrawer from './SidebarFooterDrawer';

/**
 * Claude accounts panel (ui8 phase 6; revamped ui14 job 4). One borderless
 * row per cswap account on the sidebar row anatomy: slot numeral, the name in
 * full, and the 5h / 7d / per-model meters underneath with reset countdowns.
 * The active row carries the accent wash; there is no dot. Row actions (use,
 * hold/return, reorder) take no space at rest on desktop and appear on hover
 * or focus, which is the only time the name truncates; touch shows them
 * always. Adding an account is the real flow: log in, then `cswap add`, each
 * a shell window opened from the two-step block, with the panel watching
 * cswap's list until the account lands. Below the Claude accounts sits the
 * ChatGPT group (codex job 3): the one Codex login with the same meters,
 * read from Codex's own rollout files, pushed live over the websocket while
 * the drawer is open. No controls: there is one login and nothing switches it.
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
  t: TFunction;
};

/**
 * The add flow's two shell commands. Both run against the machine-global
 * Claude profile (CLAUDE_CONFIG_DIR stripped, like every cswap call in
 * server/modules/accounts) so the login lands where cswap reads it, even
 * from an instance that runs on its own config dir. `claude auth login` is
 * the CLI's login subcommand: the same browser flow as `/login`, without
 * opening the REPL (and its trust prompt) in the shell's cwd. BROWSER is a
 * no-op so the server machine does not open its own browser: the CLI prints
 * the sign-in URL in the terminal, which Willem opens from wherever he is.
 */
const ADD_STEPS = {
  login: {
    label: 'claude /login',
    command: 'env -u CLAUDE_CONFIG_DIR BROWSER=/usr/bin/true claude auth login',
  },
  add: { label: 'cswap add', command: 'env -u CLAUDE_CONFIG_DIR cswap add' },
} as const;

type AddStep = keyof typeof ADD_STEPS;

/** How often the panel re-reads cswap's list while the add block is open. */
const ADD_POLL_MS = 5000;

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

/** The OpenAI mark, in the numeral slot of the ChatGPT row. */
function OpenAIMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

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
function UsageBar({ label, kind, window: win }: { label: string; kind: string; window: CswapWindow | undefined }) {
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
    </div>
  );
}

export default function AccountsPanel({ open, onOpenChange, onActiveChange, isMobile, t }: AccountsPanelProps) {
  const [accounts, setAccounts] = useState<CswapAccount[] | null>(null);
  const [chatgpt, setChatgpt] = useState<ChatgptAccount | null>(null);
  /** Ticks while open so the ChatGPT "updated ago" hint stays honest. */
  const [now, setNow] = useState(() => Date.now());
  const { isConnected, sendMessage, subscribe } = useWebSocket();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `<action>:<slot>` while a row action runs; disables every action. */
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  /** Which add step's shell window is open. */
  const [shellStep, setShellStep] = useState<AddStep | null>(null);
  /** cswap's list as it stood when the add block opened. */
  const addBaselineRef = useRef<AddBaseline | null>(null);

  const refresh = useCallback(async (): Promise<CswapAccount[] | null> => {
    setLoading(true);
    try {
      const list = await fetchAccountList();
      setAccounts(list.accounts);
      setChatgpt(list.chatgpt);
      setNow(Date.now());
      setError(null);
      onActiveChange(list.accounts.find((account) => account.active)?.email ?? null);
      return list.accounts;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setLoading(false);
    }
  }, [onActiveChange]);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setShowAdd(false);
      setShellStep(null);
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

  // Re-read cswap's list and close the add block once the flow is done: a
  // new slot appeared, or the active slot changed (an in-place re-add).
  const checkAdd = useCallback(async () => {
    const list = await refresh();
    const baseline = addBaselineRef.current;
    if (list && baseline && addCompleted(baseline, list)) {
      setShowAdd(false);
      setShellStep(null);
    }
  }, [refresh]);

  // While the add block is open, poll for it; a shell window closing checks
  // immediately.
  useEffect(() => {
    if (!showAdd) return;
    const id = window.setInterval(() => void checkAdd(), ADD_POLL_MS);
    return () => window.clearInterval(id);
  }, [showAdd, checkAdd]);

  const openAdd = () => {
    addBaselineRef.current = captureAddBaseline(accounts ?? []);
    setShowAdd(true);
  };

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
      ariaLabel={t('accounts.title', 'Accounts')}
      dataSlot="accounts-panel"
    >
      {/* Top padding, not a divider, separates the panel from the list above. */}
      <ul className="max-h-[60dvh] space-y-1 overflow-y-auto px-2 pb-2 pt-3">
        {loading && accounts === null && (
          <li className="flex justify-center px-1 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </li>
        )}
        {sorted.map((account, index) => {
          const usage = account.usage ?? account.lastGoodUsage ?? undefined;
          const scoped = Array.isArray(usage?.scoped) ? usage.scoped : [];
          const rowBusy = busy !== null && busy.endsWith(`:${account.number}`);
          return (
            <li
              key={account.number}
              className={cn(
                'group rounded-lg px-2 py-2.5',
                account.active && 'bg-accent/40',
                account.disabled && 'opacity-60',
              )}
              data-slot="account-row"
              data-account-number={account.number}
              data-active={account.active || undefined}
              data-disabled={account.disabled || undefined}
              data-parked={account.parkedUntil || undefined}
            >
              <div className="flex h-7 items-center gap-2">
                <span className="w-4 flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {account.number}
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-[13px] font-medium',
                    account.active ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  data-slot="account-name"
                >
                  {account.alias || account.email}
                </span>
                {account.disabled && (
                  <span className="flex-shrink-0 rounded-sm border border-border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('accounts.disabledTag', 'disabled')}
                  </span>
                )}
                {/* Actions take no width at rest on desktop, so the name has
                    the whole row; they appear (and the name truncates) only
                    on hover or focus. Touch shows them always. */}
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
              </div>

              <div className="mt-1.5 space-y-1 pl-6">
                <UsageBar label={t('accounts.fiveHour', '5h')} kind="5h" window={usage?.fiveHour} />
                <UsageBar label={t('accounts.sevenDay', '7d')} kind="7d" window={usage?.sevenDay} />
                {scoped.map((entry) => (
                  <UsageBar
                    key={entry.name ?? 'scoped'}
                    label={entry.name ?? t('accounts.model', 'Model')}
                    kind={`scoped:${entry.name ?? ''}`}
                    window={entry}
                  />
                ))}
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
              </div>
            </li>
          );
        })}

        {accounts !== null && sorted.length === 0 && !loading && (
          <li className="px-2 py-2 text-xs text-muted-foreground">
            {t('accounts.empty', 'No managed accounts yet.')}
          </li>
        )}

        <li data-slot="account-add-row">
          {showAdd ? (
            <div className="rounded-lg bg-muted/30 px-2 py-2.5" data-slot="account-add-steps">
              <ol className="space-y-1.5">
                {(['login', 'add'] as const).map((step, index) => (
                  <li key={step} className="flex h-7 items-center gap-2">
                    <span className="w-4 flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                      {step === 'login'
                        ? t('accounts.stepLogin', 'Log in')
                        : t('accounts.stepAdd', 'Add to cswap')}
                    </span>
                    <button
                      type="button"
                      className="flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 font-mono text-[11px] text-foreground transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setShellStep(step)}
                      data-slot={`account-add-${step}`}
                    >
                      <Terminal className="h-3 w-3 text-muted-foreground" />
                      {ADD_STEPS[step].label}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex items-center justify-between gap-2 pl-6">
                <span
                  className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                  data-slot="account-add-watching"
                >
                  <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                  <span className="truncate">{t('accounts.addWatching', 'Waiting for it')}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setShowAdd(false);
                    setShellStep(null);
                  }}
                >
                  {t('actions.cancel', 'Cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              onClick={openAdd}
              data-slot="account-add-trigger"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('accounts.add', 'Add account')}
            </button>
          )}
        </li>

        {/* The ChatGPT group (codex job 3): one login, no controls. */}
        {chatgpt && (
          <>
            <li
              className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              data-slot="account-group-chatgpt"
            >
              ChatGPT
            </li>
            <li
              className="rounded-lg px-2 py-2.5"
              data-slot="account-row"
              data-account="chatgpt"
              data-state={chatgpt.state}
            >
              <div className="flex h-7 items-center gap-2">
                <span className="flex w-4 flex-shrink-0 justify-end text-muted-foreground">
                  <OpenAIMark className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" data-slot="account-name">
                  {chatgpt.email ?? 'ChatGPT'}
                </span>
                {chatgpt.plan && (
                  <span
                    className="flex-shrink-0 rounded-sm border border-border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                    data-slot="account-plan"
                  >
                    {chatgpt.plan}
                  </span>
                )}
              </div>
              {chatgpt.state === 'ok' ? (
                <div className="mt-1.5 space-y-1 pl-6">
                  <UsageBar label={t('accounts.fiveHour', '5h')} kind="5h" window={chatgpt.usage?.fiveHour} />
                  <UsageBar label={t('accounts.sevenDay', '7d')} kind="7d" window={chatgpt.usage?.sevenDay} />
                  <p className="text-[10px] text-muted-foreground" data-slot="account-usage-meta">
                    {chatgpt.usage
                      ? t('accounts.updatedAgo', 'updated {{age}} ago', { age: formatAge(chatgpt.usage.readAt, now) })
                      : t('accounts.noUsage', 'no usage recorded yet')}
                  </p>
                </div>
              ) : (
                <p className="mt-1.5 pl-6 text-[10px] text-muted-foreground" data-slot="account-login-fix">
                  {chatgpt.state === 'logged_out'
                    ? t('accounts.chatgptLoggedOut', 'Logged out.')
                    : t('accounts.chatgptStale', 'Login stale.')}{' '}
                  <span className="font-mono text-foreground">codex login</span> on the mini
                </p>
              )}
            </li>
          </>
        )}
      </ul>

      {error && (
        <p className="px-4 pb-3 text-xs text-destructive" data-slot="accounts-error">
          {error}
        </p>
      )}

      {shellStep && (
        <ProviderLoginModal
          isOpen
          onClose={() => {
            setShellStep(null);
            void checkAdd();
          }}
          customCommand={ADD_STEPS[shellStep].command}
          title={ADD_STEPS[shellStep].label}
        />
      )}
    </SidebarFooterDrawer>
  );
}
