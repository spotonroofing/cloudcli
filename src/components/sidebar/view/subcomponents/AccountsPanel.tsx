import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, ChevronDown, ChevronUp, Loader2, LogIn, Plus, Power, Terminal } from 'lucide-react';
import type { TFunction } from 'i18next';

import ProviderLoginModal from '../../../provider-auth/view/ProviderLoginModal';
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
 * cswap's list until the account lands.
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
};

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

const fetchAccountList = async (): Promise<CswapAccount[]> => {
  const response = await authenticatedFetch('/api/accounts');
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || 'Failed to load accounts');
  }
  const accounts = body?.data?.accounts;
  return Array.isArray(accounts) ? (accounts as CswapAccount[]) : [];
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
      setAccounts(list);
      setError(null);
      onActiveChange(list.find((account) => account.active)?.email ?? null);
      return list;
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

  const sorted = (accounts ?? []).slice().sort((a, b) => a.number - b.number);

  return (
    <SidebarFooterDrawer
      open={open}
      onClose={() => onOpenChange(false)}
      isMobile={isMobile}
      ariaLabel={t('accounts.title', 'Claude accounts')}
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
                      {!account.active && !account.disabled && (
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
                      {!account.active && (
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
