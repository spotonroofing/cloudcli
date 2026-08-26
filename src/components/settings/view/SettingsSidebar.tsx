import { Bell, Info, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

/**
 * Settings tab nav, reflowed for the sidebar width (ui13 job 5): one
 * horizontal pill bar on every form factor — the old desktop side rail
 * doesn't fit the full-sidebar surface.
 */
export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex-shrink-0 border-b border-border px-3 py-2">
      <PillBar className="w-full flex-wrap">
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
  );
}
