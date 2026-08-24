import { useCallback, useEffect, useRef, useState } from 'react';

import type { Project } from '../../../types/app';
import { STANDALONE_PROJECT_ID } from '../../../types/app';
import { onSettingChange, writeSetting } from '../../../utils/cloudSettings';

export type WorkspaceMode = 'rows' | 'columns';

/** dataTransfer MIME type for dragging a sidebar project row into the view. */
export const PROJECT_DRAG_TYPE = 'application/x-cloudcli-project';

export type WorkspaceState = {
  /** Ordered project ids of every open workspace row (the primary included). */
  order: string[];
  mode: WorkspaceMode;
  /** Shared planner fraction in rows mode, so planners stay aligned over planners. */
  split: number;
  /** Per-project planner fraction in columns mode (falls back to `split`). */
  columnSplits: Record<string, number>;
  /** Per-project flex weight along the stacking axis (row height / group width). */
  weights: Record<string, number>;
  /** Drop-to-combine: opens (or moves) a project at `index` and sets the layout mode. */
  openProjectAt: (projectId: string, index: number, mode: WorkspaceMode) => void;
  closeProject: (projectId: string) => void;
  /** Moves a project so it sits before boundary `index` in the current order. */
  moveProject: (projectId: string, boundaryIndex: number) => void;
  toggleMode: () => void;
  setSplit: (fraction: number) => void;
  setColumnSplit: (projectId: string, fraction: number) => void;
  setPairWeights: (idA: string, weightA: number, idB: string, weightB: number) => void;
};

const STORAGE_KEY = 'workspace-layout-v1';
/** Planner fraction of a row; 50/50 by default (ui8 phase 5), shared with the single-project two-pane view. */
const DEFAULT_SPLIT = 0.5;
const MIN_SPLIT = 0.25;
const MAX_SPLIT = 0.75;

const clampSplit = (value: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isNumberRecord = (value: unknown): value is Record<string, number> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every(
    (item) => typeof item === 'number' && Number.isFinite(item) && item > 0,
  );

const readPersisted = () => {
  const defaults = {
    order: [] as string[],
    mode: 'rows' as WorkspaceMode,
    split: DEFAULT_SPLIT,
    columnSplits: {} as Record<string, number>,
    weights: {} as Record<string, number>,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      order: isStringArray(parsed.order) ? parsed.order : defaults.order,
      mode: parsed.mode === 'columns' ? 'columns' as const : 'rows' as const,
      split: typeof parsed.split === 'number' && Number.isFinite(parsed.split)
        ? clampSplit(parsed.split)
        : defaults.split,
      columnSplits: isNumberRecord(parsed.columnSplits) ? parsed.columnSplits : defaults.columnSplits,
      weights: isNumberRecord(parsed.weights) ? parsed.weights : defaults.weights,
    };
  } catch {
    return defaults;
  }
};

/**
 * Multi-project workspace state (phase 7): which projects are open as rows,
 * their order, the stacked-rows vs side-by-side-columns mode, and the resize
 * geometry. Everything persists to localStorage so the workspace survives
 * reloads. With a single open project the app renders exactly as before —
 * this state only shapes the UI once a second project is opened.
 */
export function useWorkspace({
  selectedProjectId,
  projects,
}: {
  selectedProjectId: string | null;
  projects: Project[];
}): WorkspaceState {
  const [persisted] = useState(readPersisted);
  const [order, setOrder] = useState<string[]>(persisted.order);
  const [mode, setMode] = useState<WorkspaceMode>(persisted.mode);
  const [split, setSplitState] = useState<number>(persisted.split);
  const [columnSplits, setColumnSplits] = useState<Record<string, number>>(persisted.columnSplits);
  const [weights, setWeights] = useState<Record<string, number>>(persisted.weights);
  const primaryRef = useRef<string | null>(null);

  // The URL-driven selection always has a row. Ordinary project switching
  // replaces the previous primary row in place, so navigation never grows the
  // workspace — only the explicit open action does. Selecting a project that
  // is already open just hands it the primary (URL-driven) slot.
  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === STANDALONE_PROJECT_ID) {
      return;
    }
    setOrder((previous) => {
      if (previous.includes(selectedProjectId)) {
        primaryRef.current = selectedProjectId;
        return previous;
      }
      if (previous.length <= 1) {
        primaryRef.current = selectedProjectId;
        return [selectedProjectId];
      }
      const previousPrimary =
        primaryRef.current && previous.includes(primaryRef.current) ? primaryRef.current : previous[0];
      primaryRef.current = selectedProjectId;
      return previous.map((id) => (id === previousPrimary ? selectedProjectId : id));
    });
  }, [selectedProjectId]);

  // Drop rows whose project no longer exists (deleted or archived).
  useEffect(() => {
    if (projects.length === 0) {
      return;
    }
    setOrder((previous) => {
      const valid = previous.filter((id) => projects.some((project) => project.projectId === id));
      return valid.length === previous.length ? previous : valid;
    });
  }, [projects]);

  useEffect(() => {
    try {
      writeSetting(STORAGE_KEY, JSON.stringify({ order, mode, split, columnSplits, weights }));
    } catch {
      // localStorage unavailable
    }
  }, [order, mode, split, columnSplits, weights]);

  // Another tab or device changed the layout: apply it live.
  useEffect(() => onSettingChange([STORAGE_KEY], () => {
    const next = readPersisted();
    setOrder(next.order);
    setMode(next.mode);
    setSplitState(next.split);
    setColumnSplits(next.columnSplits);
    setWeights(next.weights);
  }), []);

  const openProjectAt = useCallback((projectId: string, index: number, nextMode: WorkspaceMode) => {
    setMode(nextMode);
    setOrder((previous) => {
      const without = previous.filter((id) => id !== projectId);
      const target = Math.min(Math.max(index, 0), without.length);
      without.splice(target, 0, projectId);
      return without;
    });
  }, []);

  const closeProject = useCallback((projectId: string) => {
    setOrder((previous) => previous.filter((id) => id !== projectId));
  }, []);

  const moveProject = useCallback((projectId: string, boundaryIndex: number) => {
    setOrder((previous) => {
      const from = previous.indexOf(projectId);
      if (from < 0) {
        return previous;
      }
      const target = boundaryIndex > from ? boundaryIndex - 1 : boundaryIndex;
      if (target === from) {
        return previous;
      }
      const next = previous.filter((id) => id !== projectId);
      next.splice(target, 0, projectId);
      return next;
    });
  }, []);

  const toggleMode = useCallback(() => {
    setMode((previous) => (previous === 'rows' ? 'columns' : 'rows'));
  }, []);

  const setSplit = useCallback((fraction: number) => {
    setSplitState(clampSplit(fraction));
  }, []);

  const setColumnSplit = useCallback((projectId: string, fraction: number) => {
    setColumnSplits((previous) => ({ ...previous, [projectId]: clampSplit(fraction) }));
  }, []);

  const setPairWeights = useCallback((idA: string, weightA: number, idB: string, weightB: number) => {
    setWeights((previous) => ({ ...previous, [idA]: weightA, [idB]: weightB }));
  }, []);

  return {
    order,
    mode,
    split,
    columnSplits,
    weights,
    openProjectAt,
    closeProject,
    moveProject,
    toggleMode,
    setSplit,
    setColumnSplit,
    setPairWeights,
  };
}
