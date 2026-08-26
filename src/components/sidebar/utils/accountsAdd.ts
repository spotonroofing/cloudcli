/**
 * Add-account completion detection (ui14 job 4). The add flow is two shell
 * steps Willem runs himself (`claude auth login`, then `cswap add`), so the
 * panel learns the account landed by watching cswap's list: either a slot
 * appears that was not there when the flow opened, or the active slot
 * changed (`cswap add` on an already-managed account refreshes it in place
 * and makes it active without adding a row).
 */

export type AccountIdentity = { number: number; email: string; active: boolean };

export type AddBaseline = { keys: Set<string>; activeNumber: number | null };

export const accountKey = (account: AccountIdentity): string => `${account.number}:${account.email}`;

export const captureAddBaseline = (accounts: AccountIdentity[]): AddBaseline => ({
  keys: new Set(accounts.map(accountKey)),
  activeNumber: accounts.find((account) => account.active)?.number ?? null,
});

export const addCompleted = (baseline: AddBaseline, accounts: AccountIdentity[]): boolean => {
  if (accounts.some((account) => !baseline.keys.has(accountKey(account)))) return true;
  const activeNumber = accounts.find((account) => account.active)?.number ?? null;
  return activeNumber !== null && activeNumber !== baseline.activeNumber;
};
