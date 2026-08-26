import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSidebar from '../view/SettingsSidebar';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import NotificationsSettingsTab from '../view/tabs/NotificationsSettingsTab';
import AboutTab from '../view/tabs/AboutTab';
import { useSettingsController } from '../hooks/useSettingsController';
import { useWebPush } from '../../../hooks/useWebPush';
import type { SettingsProps } from '../types/types';

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

function Settings({ isOpen, initialTab = 'appearance' }: SettingsProps) {
  const { t } = useTranslation('settings');
  const desktopNotificationsBridge = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : ((window as any).cloudcliDesktopNotifications || null)
  ), []);
  const [desktopNotificationsState, setDesktopNotificationsState] = useState<DesktopNotificationsState | null>(null);
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    codeEditorSettings,
    updateCodeEditorSetting,
    notificationPreferences,
    setNotificationPreferences,
  } = useSettingsController({
    isOpen,
    initialTab
  });

  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const handleEnablePush = async () => {
    await pushSubscribe();
    // Server sets webPush: true in preferences on subscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: true },
    });
  };

  const handleDisablePush = async () => {
    await pushUnsubscribe();
    // Server sets webPush: false in preferences on unsubscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: false },
    });
  };

  useEffect(() => {
    if (!desktopNotificationsBridge) return undefined;
    let mounted = true;
    desktopNotificationsBridge.getState().then((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    }).catch(() => {});
    const unsubscribe = desktopNotificationsBridge.onStateUpdated?.((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [desktopNotificationsBridge]);

  const handleEnableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: true });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: true },
    });
  };

  const handleDisableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: false });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: false },
    });
  };

  if (!isOpen) {
    return null;
  }

  // Full-sidebar surface content (ui13 job 5): no modal chrome, no close
  // button — the shell's taskbar icon and Escape close it. One column
  // reflowed for the sidebar width: title, pill-bar nav, scrolling content.
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="settings-surface-content">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{t('title')}</h2>
        {saveStatus === 'success' && (
          <span className="text-xs text-muted-foreground">{t('saveStatus.success')}</span>
        )}
      </div>

      <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div key={activeTab} className="settings-content-enter min-w-0 space-y-6 overflow-x-hidden p-4 pb-safe-area-inset-bottom">
          {activeTab === 'appearance' && (
            <AppearanceSettingsTab
              codeEditorSettings={codeEditorSettings}
              onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
              onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
              onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
              onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
            />
          )}

          {activeTab === 'notifications' && (
            <NotificationsSettingsTab
              notificationPreferences={notificationPreferences}
              onNotificationPreferencesChange={setNotificationPreferences}
              pushPermission={pushPermission}
              isPushSubscribed={isPushSubscribed}
              isPushLoading={isPushLoading}
              onEnablePush={handleEnablePush}
              onDisablePush={handleDisablePush}
              isDesktop={Boolean(desktopNotificationsBridge)}
              desktopNotifications={desktopNotificationsState}
              onEnableDesktopNotifications={handleEnableDesktopNotifications}
              onDisableDesktopNotifications={handleDisableDesktopNotifications}
            />
          )}

          {activeTab === 'about' && <AboutTab />}
        </div>
      </main>
    </div>
  );
}

export default Settings;
