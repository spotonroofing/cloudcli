import { prettifyModelId } from './modelLabels';

type WorkerRunLabelInput = {
  origin: string | null;
  provider: string;
  model: string | null;
  startedAt: number | string | null;
};

const RUN_KIND_LABELS: Record<string, string> = {
  direct: 'One-off',
  dispatch: 'Dispatched',
  external: 'Headless',
  maintenance: 'Maintenance',
};

function shortModelLabel(model: string | null, provider: string): string {
  if (!model) {
    return provider.toLowerCase() === 'codex' ? 'Codex' : provider.toLowerCase() === 'claude' ? 'Claude' : prettifyModelId(provider);
  }
  const normalized = model.toLowerCase();
  for (const label of ['Sol', 'Terra', 'Luna', 'Opus', 'Sonnet', 'Haiku']) {
    if (normalized.includes(label.toLowerCase())) {
      return label;
    }
  }
  return prettifyModelId(model);
}

function easternStartTime(value: number | string | null): string {
  const date = typeof value === 'number' ? new Date(value) : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'time unavailable';
  }
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  }).toLowerCase();
}

/**
 * Stable label for a worker run that has no dispatch-chain slug. Prompt text
 * and session ids are deliberately excluded: the run kind, model, and
 * Eastern start time remain useful even when a session has never been named.
 */
export function workerRunLabel(input: WorkerRunLabelInput): string {
  const kind = RUN_KIND_LABELS[input.origin ?? ''] ?? 'One-off';
  return `${kind}, ${shortModelLabel(input.model, input.provider)}, ${easternStartTime(input.startedAt)}`;
}
