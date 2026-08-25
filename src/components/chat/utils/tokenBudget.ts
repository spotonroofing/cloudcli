export type TokenBudget = Record<string, unknown>;

/**
 * Merges an incoming token-budget snapshot over the previous one. Mid-stream
 * budgets and file snapshots carry fresh counters but only the env-guess
 * denominator; when the previous value came from the SDK, its window, category
 * breakdown, and source are kept until the next SDK-derived budget lands.
 */
export function mergeTokenBudget(
  previous: TokenBudget | null,
  incoming: TokenBudget,
): TokenBudget {
  if (incoming.contextUsageSource !== 'sdk' && previous?.contextUsageSource === 'sdk') {
    const { total, rawTotal, totalIsUsableWindow, categories, contextUsageSource } = previous;
    return { ...incoming, total, rawTotal, totalIsUsableWindow, categories, contextUsageSource };
  }
  return incoming;
}
