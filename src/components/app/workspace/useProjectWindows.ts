import { useCallback, useEffect, useState } from 'react';

import { onSettingChange, writeSetting } from '../../../utils/cloudSettings';

/** The windows a project can open in its pane strip (ui13 job 10). */
export type WindowId = 'planner' | 'worker' | 'files' | 'git';

/**
 * open = a tiled pane in the strip; rail = collapsed to the thin rotated-text
 * rail attached to its neighbors; closed = absent entirely (files/git only —
 * planner and worker never fully close, their rails always remain).
 */
export type PaneWindowState = 'open' | 'rail' | 'closed';

export type ProjectWindows = {
  states: Record<WindowId, PaneWindowState>;
  /** Flex weight per open pane; all-equal (1) is the deterministic default. */
  weights: Record<WindowId, number>;
  setWindowState: (id: WindowId, state: PaneWindowState) => void;
  setPairWeights: (idA: WindowId, weightA: number, idB: WindowId, weightB: number) => void;
};

export const WINDOW_ORDER: WindowId[] = ['planner', 'worker', 'files', 'git'];

export const WINDOW_LABELS: Record<WindowId, string> = {
  planner: 'Planner',
  worker: 'Worker',
  files: 'Files',
  git: 'Source Control',
};

const STORAGE_KEY = 'project-windows-v1';

const DEFAULT_STATES: Record<WindowId, PaneWindowState> = {
  planner: 'open',
  worker: 'open',
  files: 'closed',
  git: 'closed',
};

const DEFAULT_WEIGHTS: Record<WindowId, number> = { planner: 1, worker: 1, files: 1, git: 1 };

type StoredEntry = {
  states?: Partial<Record<WindowId, PaneWindowState>>;
  weights?: Partial<Record<WindowId, number>>;
};

type StoredMap = Record<string, StoredEntry>;

const isWindowState = (value: unknown): value is PaneWindowState =>
  value === 'open' || value === 'rail' || value === 'closed';

const readMap = (): StoredMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
};

const resolveEntry = (entry: StoredEntry | undefined) => {
  const states = { ...DEFAULT_STATES };
  const weights = { ...DEFAULT_WEIGHTS };
  for (const id of WINDOW_ORDER) {
    const state = entry?.states?.[id];
    if (isWindowState(state)) {
      states[id] = state;
    }
    const weight = entry?.weights?.[id];
    if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
      weights[id] = weight;
    }
  }
  // Planner and worker never fully close; a stale 'closed' reads as a rail.
  if (states.planner === 'closed') states.planner = 'rail';
  if (states.worker === 'closed') states.worker = 'rail';
  return { states, weights };
};

/**
 * Per-project window set for the workspace pane strip (ui13 job 10): which of
 * the project's windows (Planner, Worker, Files, Source Control) are open,
 * railed, or closed, plus their pane weights. Persisted per project in one
 * cloud-synced record, so each open project keeps its own window set across
 * project switches, reloads, and devices.
 */
export function useProjectWindows(projectId: string | null): ProjectWindows {
  const [resolved, setResolved] = useState(() => resolveEntry(projectId ? readMap()[projectId] : undefined));

  useEffect(() => {
    setResolved(resolveEntry(projectId ? readMap()[projectId] : undefined));
  }, [projectId]);

  // writeSetting announces every change (this tab included) as a storage
  // event, so all hook instances — including the writer — re-read here.
  useEffect(() => onSettingChange([STORAGE_KEY], () => {
    setResolved(resolveEntry(projectId ? readMap()[projectId] : undefined));
  }), [projectId]);

  const write = useCallback((mutate: (entry: ReturnType<typeof resolveEntry>) => ReturnType<typeof resolveEntry>) => {
    if (!projectId) {
      return;
    }
    const map = readMap();
    map[projectId] = mutate(resolveEntry(map[projectId]));
    try {
      writeSetting(STORAGE_KEY, JSON.stringify(map));
    } catch {
      // localStorage unavailable
    }
  }, [projectId]);

  const setWindowState = useCallback((id: WindowId, state: PaneWindowState) => {
    write((entry) => {
      const states = { ...entry.states, [id]: state };
      // Deterministic widths (ui13 job 10): opening an auxiliary window
      // resets every pane to the even split, squishing planner and worker
      // evenly so the two stay equal.
      const weights = state === 'open' && (id === 'files' || id === 'git')
        ? { ...DEFAULT_WEIGHTS }
        : entry.weights;
      return { states, weights };
    });
  }, [write]);

  const setPairWeights = useCallback((idA: WindowId, weightA: number, idB: WindowId, weightB: number) => {
    write((entry) => ({
      states: entry.states,
      weights: { ...entry.weights, [idA]: weightA, [idB]: weightB },
    }));
  }, [write]);

  return { states: resolved.states, weights: resolved.weights, setWindowState, setPairWeights };
}
