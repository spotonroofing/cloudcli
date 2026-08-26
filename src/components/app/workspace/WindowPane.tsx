import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../../../shared/view/ui';

import type { WindowId } from './useProjectWindows';

type WindowPaneProps = {
  id: WindowId;
  label: string;
  icon: LucideIcon;
  /** Collapses the window to its rail (the pane header's X); absent on phones, where windows have no rail. */
  onRail?: () => void;
  /** Leading header control (the phone's menu button). */
  leading?: ReactNode;
  /** Trailing header controls (the phone's window selector). */
  trailing?: ReactNode;
  /** Header vertical padding; the phone passes its safe-area top bar classes. */
  headerClassName?: string;
  children: ReactNode;
};

/**
 * Auxiliary window chrome (ui13 job 10): the standard slim pane-header bar —
 * muted icon + label + trailing X — over the window's content, matching the
 * planner/worker pane headers so every tile in the grid reads as one family.
 * On phones (ui14 job 11) the same bar carries the menu button and the window
 * selector instead of the X.
 */
export default function WindowPane({
  id,
  label,
  icon: Icon,
  onRail,
  leading,
  trailing,
  headerClassName,
  children,
}: WindowPaneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="window-pane" data-window={id}>
      <div
        className={`flex flex-shrink-0 items-center gap-2 overflow-hidden border-b border-border/60 bg-muted/30 px-3 ${headerClassName ?? 'py-1.5'}`}
        data-slot="pane-header"
      >
        {leading}
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="min-w-0 flex-1" />
        {trailing}
        {onRail && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={onRail}
            aria-label={`Hide ${label}`}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
