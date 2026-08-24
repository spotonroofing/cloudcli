import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Ban, ChevronDown, ChevronUp, Loader2, LogIn, Plus, Power } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button, Input } from '../../../../shared/view/ui';
import { EASE_OUT } from '../../../../shared/view/beui/ease';
import { authenticatedFetch } from '../../../../utils/api';
import { cn } from '../../../../lib/utils';

/**
 * Claude accounts panel (ui8 phase 6), modeled on Willem's cswap dashboard
 * reference and restyled to this app: one row per account — slot number,
 * email, active marker, 5h / 7d / per-model usage bars with reset countdowns —
 * hover-revealed actions on desktop (use, disable/enable, reorder), always
 * visible on touch, and an add-account form at the bottom whose token input is
 * masked and cleared the moment it is submitted (the token only ever travels
 * in the POST body, straight to cswap's stdin).
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
  /** Phone renders a full-width bottom sheet; desktop a sidebar-width drawer
      rising from the anchor block. Both portal to the body — the sidebar's
      backdrop-blur makes it the containing block for `fixed` descendants, so
      an in-tree backdrop could never cover the main pane. */
  isMobile: boolean;
  /** Desktop anchor: the accounts/settings block the drawer rises from. */
  anchorRef: RefObject<HTMLDivElement>;
  t: TFunction;
};

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

/** One usage meter: label, thin rectangular track, percent, reset countdown. */
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
      <span className="w-10 flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
      <span className="w-9 flex-shrink-0 text-right text-[10px] tabular-nums text-foreground">
        {pct !== null ? `${Math.round(pct)}%` : '—'}
      </span>
      <span className="w-16 flex-shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {reset ?? ''}
      </span>
    </div>
  );
}

export default function AccountsPanel({ open, onOpenChange, onActiveChange, isMobile, anchorRef, t }: AccountsPanelProps) {
  const reduceMotion = useReducedMotion();

  // Desktop drawer geometry: measured from the anchor block on open, so the
  // portaled panel sits flush over the sidebar with its bottom edge just
  // above the accounts/settings rows.
  const [anchorStyle, setAnchorStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open || isMobile) {
      setAnchorStyle(null);
      return;
    }
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      setAnchorStyle({ left: rect.left, width: rect.width, bottom: window.innerHeight - rect.top });
    }
  }, [open, isMobile, anchorRef]);
  const [accounts, setAccounts] = useState<CswapAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `<action>:<slot>` while a row action runs; disables every action. */
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addToken, setAddToken] = useState('');
  const [addEmail, setAddEmail] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAccountList();
      setAccounts(list);
      setError(null);
      onActiveChange(list.find((account) => account.active)?.email ?? null);
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
      // Never keep a typed token around after the panel closes.
      setShowAdd(false);
      setAddToken('');
      setAddEmail('');
      setError(null);
    }
  }, [open, refresh]);

  // Escape closes the drawer (the Dialog primitive used to own this).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

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

  const submitAdd = () =>
    runAction('add', async () => {
      const token = addToken.trim();
      if (!token) {
        return;
      }
      // Clear the masked field before the request settles: the token's only
      // life in this client is the request body.
      setAddToken('');
      await postAccountAction('/api/accounts/add', {
        token,
        ...(addEmail.trim() ? { email: addEmail.trim() } : {}),
      });
      setAddEmail('');
      setShowAdd(false);
    });

  const sorted = (accounts ?? []).slice().sort((a, b) => a.number - b.number);

  // Drawer shell (ui11 phase 5): slides up from above the Settings row inside
  // the sidebar on desktop, a full-width bottom sheet on phone. The backdrop
  // catches outside taps (including a second tap on the trigger).
  const drawer = (
    <AnimatePresence>
      {open && (isMobile || anchorStyle) && (
        <>
          <motion.div
            className={cn('fixed inset-0 z-40', isMobile ? 'bg-background/60 backdrop-blur-sm' : 'bg-transparent')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            onClick={() => onOpenChange(false)}
            aria-hidden
          />
          <div
            className={cn(
              'pointer-events-none fixed z-50',
              isMobile ? 'inset-x-0 bottom-0' : 'overflow-hidden px-1.5 pb-1',
            )}
            style={isMobile ? undefined : anchorStyle ?? undefined}
          >
            <motion.div
              role="dialog"
              aria-label={t('accounts.title', 'Claude accounts')}
              data-slot="accounts-panel"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
              className={cn(
                'pointer-events-auto border-border bg-popover shadow-lg',
                isMobile
                  ? 'border-t rounded-t-lg pb-safe-area-inset-bottom'
                  : 'rounded-lg border',
              )}
            >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">
              {t('accounts.title', 'Claude accounts')}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {t('accounts.subtitle', 'Switching applies to new sessions')}
            </p>
          </div>
          {loading && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <ul className="max-h-[60dvh] space-y-2 overflow-y-auto px-4 py-3">
          {sorted.map((account, index) => {
            const usage = account.usage ?? account.lastGoodUsage ?? undefined;
            const scoped = Array.isArray(usage?.scoped) ? usage.scoped : [];
            const rowBusy = busy !== null && busy.endsWith(`:${account.number}`);
            return (
              <li
                key={account.number}
                className={cn(
                  'group rounded-lg border border-border/60 px-3 py-2.5',
                  account.disabled && 'opacity-60',
                )}
                data-slot="account-row"
                data-account-number={account.number}
                data-active={account.active || undefined}
                data-disabled={account.disabled || undefined}
              >
                <div className="flex items-center gap-2">
                  <span className="w-4 flex-shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {account.number}
                  </span>
                  <span
                    className={cn(
                      'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                      account.active ? 'bg-primary' : 'bg-transparent',
                    )}
                    data-slot="account-active-marker"
                    aria-hidden
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px] font-medium',
                      account.active ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    title={account.email}
                  >
                    {account.alias || account.email}
                  </span>
                  {account.disabled && (
                    <span className="flex-shrink-0 rounded-sm border border-border px-1 py-px text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('accounts.disabledTag', 'disabled')}
                    </span>
                  )}
                  <span
                    className={cn(
                      'flex flex-shrink-0 items-center gap-0.5 transition-opacity',
                      'md:opacity-0 md:focus-within:opacity-100 md:group-hover:opacity-100',
                    )}
                  >
                    {rowBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : (
                      <>
                        {!account.active && !account.disabled && (
                          <button
                            className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                            className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => void swapWith(account, sorted[index - 1])}
                          disabled={busy !== null || index === 0}
                          title={t('accounts.moveUp', 'Move up')}
                          aria-label={`${t('accounts.moveUp', 'Move up')}: ${account.email}`}
                          data-slot="account-move-up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="touch-hit relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
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

                <div className="mt-2 space-y-1 pl-6">
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
            <li className="px-1 py-2 text-xs text-muted-foreground">
              {t('accounts.empty', 'No managed accounts yet.')}
            </li>
          )}

          <li data-slot="account-add-row">
            {showAdd ? (
              <form
                className="space-y-2 rounded-lg border border-border/60 px-3 py-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAdd();
                }}
              >
                <Input
                  type="password"
                  value={addToken}
                  onChange={(event) => setAddToken(event.target.value)}
                  placeholder={t('accounts.tokenPlaceholder', 'Setup token or API key')}
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  className="text-base md:text-sm"
                  data-slot="account-token-input"
                />
                <Input
                  type="email"
                  value={addEmail}
                  onChange={(event) => setAddEmail(event.target.value)}
                  placeholder={t('accounts.emailPlaceholder', 'Email (optional)')}
                  autoComplete="off"
                  spellCheck={false}
                  className="text-base md:text-sm"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowAdd(false);
                      setAddToken('');
                      setAddEmail('');
                    }}
                  >
                    {t('actions.cancel', 'Cancel')}
                  </Button>
                  <Button type="submit" variant="default" size="sm" disabled={!addToken.trim() || busy !== null}>
                    {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t('accounts.add', 'Add account')}
                  </Button>
                </div>
              </form>
            ) : (
              <button
                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                onClick={() => setShowAdd(true)}
                data-slot="account-add-trigger"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('accounts.add', 'Add account')}
              </button>
            )}
          </li>
        </ul>

        {error && (
          <p className="border-t border-border px-5 py-3 text-xs text-destructive" data-slot="accounts-error">
            {error}
          </p>
        )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  return createPortal(drawer, document.body);
}
