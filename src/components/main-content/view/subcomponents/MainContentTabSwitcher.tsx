import { MessageSquare, Hammer, type LucideIcon } from 'lucide-react';
import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip } from '../../../../shared/view/ui';
import { Tabs, TabsList, TabsTrigger } from '../../../../shared/view/beui/BeuiTabs';
import type { AppTab } from '../../../../types/app';

type MainContentTabSwitcherProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
};

type TabDefinition = {
  id: AppTab;
  labelKey: string;
  icon: LucideIcon;
};

// Chat and Worker only (ui13 job 9): the shell lives behind each pane's own
// chat/shell toggle, and files/source control become windows (job 10).
const TABS: TabDefinition[] = [
  { id: 'chat',  labelKey: 'tabs.chat',  icon: MessageSquare },
  { id: 'worker', labelKey: 'tabs.worker', icon: Hammer },
];

export default function MainContentTabSwitcher({
  activeTab,
  setActiveTab,
}: MainContentTabSwitcherProps) {
  const { t } = useTranslation();

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabList = event.currentTarget.closest('[role="tablist"]');
    if (!tabList) return;

    const tabButtons = Array.from(tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const currentIndex = tabButtons.indexOf(event.currentTarget);
    let nextIndex: number;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabButtons.length - 1;
    else return;

    event.preventDefault();
    tabButtons[nextIndex]?.focus();
    tabButtons[nextIndex]?.click();
  };

  return (
    <Tabs
      variant="segment"
      value={activeTab}
      onValueChange={(tab) => setActiveTab(tab as AppTab)}
      className="w-fit min-w-max"
    >
      <TabsList
        ariaLabel={t('tabs.views', { defaultValue: 'Workspace views' })}
        className="min-w-max gap-[2px] border border-border/40 bg-muted/50 p-[3px] shadow-inner shadow-black/[0.025] dark:shadow-black/10"
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          const displayLabel = t(tab.labelKey);

          return (
            <Tooltip key={tab.id} content={displayLabel} position="bottom">
              <TabsTrigger
                value={tab.id}
                ariaLabel={displayLabel}
                tabIndex={isActive ? 0 : -1}
                onKeyDown={handleTabKeyDown}
                className="touch-hit relative h-8 max-w-44 touch-manipulation gap-1.5 px-2.5 py-[5px]"
              >
                <tab.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                <span className={`${isActive ? 'inline max-w-28' : 'hidden'} truncate sm:max-w-36 lg:inline`}>
                  {displayLabel}
                </span>
              </TabsTrigger>
            </Tooltip>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
