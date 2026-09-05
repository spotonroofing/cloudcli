/**
 * What the worker pane header's chain controls may do right now (audit1 job
 * 8), derived from the chain row the pane is showing so the buttons and the
 * row can never disagree. Pure so the header's disabled reasons are testable.
 */

export type ControllableChain = {
  slug: string;
  status: 'running' | 'paused' | 'completed' | 'stopped' | 'failed';
};

export type ChainControlState = {
  /** The one toggling control: pause a running chain, resume a paused one. */
  toggle: 'pause' | 'resume' | null;
  canStop: boolean;
  /** Why the controls are disabled; null while at least one is available. */
  reason: string | null;
};

const TERMINAL_REASON: Record<string, string> = {
  completed: 'This chain finished.',
  stopped: 'This chain was stopped.',
  failed: 'This chain failed.',
};

export function chainControlState(chain: ControllableChain | null | undefined): ChainControlState {
  if (!chain) {
    return { toggle: null, canStop: false, reason: 'No chain is running for this project.' };
  }
  if (chain.status === 'running') {
    return { toggle: 'pause', canStop: true, reason: null };
  }
  if (chain.status === 'paused') {
    return { toggle: 'resume', canStop: true, reason: null };
  }
  return {
    toggle: null,
    canStop: false,
    reason: TERMINAL_REASON[chain.status] ?? 'This chain is not running.',
  };
}
