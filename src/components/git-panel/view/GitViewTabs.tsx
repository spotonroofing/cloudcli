import { FileText, GitBranch, GitFork, History } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger } from '../../../shared/view/beui/BeuiTabs';
import type { GitPanelView } from '../types/types';

type GitViewTabsProps = {
  activeView: GitPanelView;
  isHidden: boolean;
  changeCount: number;
  onChange: (view: GitPanelView) => void;
};

const TABS: { id: GitPanelView; label: string; Icon: typeof FileText }[] = [
  { id: 'changes', label: 'Changes', Icon: FileText },
  { id: 'history', label: 'Commits', Icon: History },
  { id: 'branches', label: 'Branches', Icon: GitBranch },
  { id: 'worktrees', label: 'Worktrees', Icon: GitFork },
];

export default function GitViewTabs({ activeView, isHidden, changeCount, onChange }: GitViewTabsProps) {
  return (
    <div
      className={`transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-16 translate-y-0 opacity-100'
      }`}
    >
      <Tabs
        variant="underline"
        value={activeView}
        onValueChange={(view) => onChange(view as GitPanelView)}
      >
        <TabsList
          ariaLabel="Source control views"
          className="scrollbar-hide flex w-full snap-x overflow-x-auto overscroll-x-contain border-border/60 [-webkit-overflow-scrolling:touch]"
        >
          {TABS.map(({ id, label, Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="min-w-max flex-none snap-start justify-center sm:min-w-0 sm:flex-1"
            >
              <span className="flex items-center justify-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {id === 'changes' && changeCount > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
                    {changeCount}
                  </span>
                )}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
