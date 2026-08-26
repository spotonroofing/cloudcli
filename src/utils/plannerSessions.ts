import type { ProjectSession } from '../types/app';

/**
 * The project's most recent planner chat: the session a planner pane adopts
 * when nothing more specific is selected. Session lists arrive newest-first;
 * a null origin is a legacy planner row from before origins were stamped.
 */
export function findLatestPlannerSession(sessions: ProjectSession[] | undefined): ProjectSession | null {
  return (
    (sessions ?? []).find((session) => {
      const origin = (session.origin as string | null) ?? null;
      return origin === 'planner' || origin === null;
    }) ?? null
  );
}
