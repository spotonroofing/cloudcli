import { Check, Compass, FolderTree, GitBranch, Hammer, PanelsTopLeft, type LucideIcon } from 'lucide-react';

import { ActionMenu } from '../../../shared/view/ui';

import { WINDOW_LABELS, type WindowId } from './useProjectWindows';

const WINDOW_ICONS: Record<WindowId, LucideIcon> = {
  planner: Compass,
  worker: Hammer,
  files: FolderTree,
  git: GitBranch,
};

export type WindowSelectorItem = {
  id: WindowId;
  /** Renders the trailing check; the row still toggles either way. */
  open: boolean;
  onSelect: () => void;
};

/**
 * The window selector (ui13 job 10): a control in each project's pane chrome
 * listing the project's available windows — Planner, Worker, Files, Source
 * Control — with a check on the open ones. Desktop toggles windows in the
 * pane strip; mobile routes the same list to full-pane views.
 */
export default function WindowSelector({ items }: { items: WindowSelectorItem[] }) {
  return (
    <ActionMenu
      label="Windows"
      ariaLabel="Windows"
      icon={PanelsTopLeft}
      iconOnly
      variant="ghost"
      size="sm"
      triggerClassName="h-6 w-6 p-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
      className="flex-shrink-0"
      menuClassName="min-w-[180px]"
      items={items.map((item) => ({
        key: item.id,
        label: WINDOW_LABELS[item.id],
        icon: WINDOW_ICONS[item.id],
        trailing: item.open ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : undefined,
        onSelect: item.onSelect,
      }))}
    />
  );
}
