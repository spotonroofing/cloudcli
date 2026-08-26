import type { ReactNode } from 'react';

import StandaloneShell from '../../standalone-shell/view/StandaloneShell';
import type { Project, ProjectSession } from '../../../types/app';
import { cn } from '../../../lib/utils';

type PaneShellProps = {
  project: Project;
  session: ProjectSession | null;
  /** The shell toggle is on. */
  open: boolean;
  /** The pane's session is mid-turn, so a second process cannot resume it safely. */
  busy: boolean;
  /** Hides the whole surface (the worker pane's full-pane jobs view). */
  hidden?: boolean;
  /** The pane's chat transcript. */
  children: ReactNode;
};

/**
 * A pane's chat/shell swap (ui13 job 9; bound shell ui14 job 11). Shell on and
 * the session idle: a terminal in the project's cwd resuming the pane's
 * session (`claude --resume`). Shell on while the session is working: the
 * same transcript stays up read-only (composer hidden, a slim status row
 * below) until the turn ends, when the real shell takes over — the SDK run
 * and an interactive resume would otherwise write the same session file.
 */
export default function PaneShell({ project, session, open, busy, hidden, children }: PaneShellProps) {
  const mirror = open && busy;
  const terminal = open && !busy;
  return (
    <>
      <div
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col', (hidden || terminal) && 'hidden')}
        data-shell-mirror={mirror ? '' : undefined}
      >
        <div className="min-h-0 flex-1">{children}</div>
        {mirror && (
          <div
            data-slot="pane-shell-busy"
            className="flex flex-shrink-0 items-center border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground"
          >
            Working. Shell opens when this session is idle.
          </div>
        )}
      </div>
      {terminal && !hidden && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-slot="pane-shell">
          <StandaloneShell project={project} session={session} showHeader={false} isActive />
        </div>
      )}
    </>
  );
}
