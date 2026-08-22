import { Bell, Info, Palette } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { TABS_INDICATOR_SPRING } from '../../../shared/view/beui/BeuiTabs';
import { PillBar, Pill } from '../../../shared/view/ui';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof Palette;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');
  const reduce = useReducedMotion();

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 border-r border-border bg-muted/30 md:flex md:flex-col">
        {/* layoutRoot scopes the gliding indicator's projection to this nav
            (beUI tabs pattern), so page scroll never replays as movement. */}
        <motion.nav layoutRoot data-slot="beui-tabs" className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onChange(item.id)}
                className={cn(
                  'relative isolate flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="settings-nav-indicator"
                    transition={reduce ? { duration: 0 } : TABS_INDICATOR_SPRING}
                    className="absolute inset-0 -z-10 rounded-lg bg-accent"
                  />
                )}
                <Icon className="h-4 w-4 flex-shrink-0" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </motion.nav>
      </aside>

      {/* Mobile horizontal nav — pill bar */}
      <div className="flex-shrink-0 border-b border-border px-3 py-2 md:hidden">
        <PillBar className="scrollbar-hide w-full overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <Pill
                key={item.id}
                isActive={activeTab === item.id}
                onClick={() => onChange(item.id)}
                className="flex-shrink-0"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </Pill>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
