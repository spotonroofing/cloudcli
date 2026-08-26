import { Bell, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconTabs } from '../../../shared/view/ui';
import type { IconTab } from '../../../shared/view/ui';
import type { SettingsMainTab } from '../types/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

/**
 * Settings tab strip (ui14 job 5): the sidebar header's own icon-tab strip
 * (`IconTabs`, the Projects/Chats/Archive pattern) — left-aligned, icon-only,
 * the same padding as the header row it mirrors.
 */
export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  const tabs: IconTab<SettingsMainTab>[] = [
    { id: 'appearance', label: t('mainTabs.appearance'), icon: Palette },
    { id: 'notifications', label: t('mainTabs.notifications'), icon: Bell },
  ];

  return (
    <div className="flex-shrink-0 px-3 pb-2 pt-3" data-slot="settings-tabs">
      <IconTabs tabs={tabs} value={activeTab} onChange={onChange} layoutId="settings-tab-indicator" />
    </div>
  );
}
