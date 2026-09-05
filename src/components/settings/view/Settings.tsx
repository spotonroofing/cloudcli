import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSidebar from '../view/SettingsSidebar';
import AppearanceSettingsTab from '../view/tabs/AppearanceSettingsTab';
import NotificationsSettingsTab from '../view/tabs/NotificationsSettingsTab';
import SystemSettingsTab from '../view/tabs/SystemSettingsTab';
import { useSettingsController } from '../hooks/useSettingsController';
import { useWebPush } from '../../../hooks/useWebPush';
import { useReportFailure } from '../../../contexts/AppMessageContext';
import type { SettingsProps } from '../types/types';
import { getDesktopNotificationsBridge } from '../../../shared/desktopBridge';

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

function Settings({ isOpen, initialTab = 'system', projects = [] }: SettingsProps) {
  const { t } = useTranslation('settings');
  const desktopNotificationsBridge = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : getDesktopNotificationsBridge()
  ), []);
  const [desktopNotificationsState, setDesktopNotificationsState] = useState<DesktopNotificationsState | null>(null);
  const reportFailure = useReportFailure();
  const {
    activeTab,
    setActiveTab,
    saveStatus,
    saveError,
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
    isReady: isPushReady,
    error: pushError,
    lastError: lastPushError,
    requiresHomeScreen: pushRequiresHomeScreen,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const handleEnablePush = async () => {
    if (await pushSubscribe()) {
      setNotificationPreferences((previous) => ({
        ...previous,
        channels: { ...previous.channels, webPush: true },
      }));
      return;
    }
    // The row already carries the reason; the strip carries it out of Settings
    // so a failed subscribe is visible wherever Willem is (audit1 job 8).
    reportFailure({
      id: 'push-subscribe',
      title: 'Push notifications did not turn on',
      detail: lastPushError(),
    });
  };

  const handleDisablePush = async () => {
    if (await pushUnsubscribe()) {
      setNotificationPreferences((previous) => ({
        ...previous,
        channels: { ...previous.channels, webPush: false },
      }));
    }
  };

  useEffect(() => {
    if (!isPushReady) return;
    setNotificationPreferences((previous) => previous.channels.webPush === isPushSubscribed
      ? previous
      : { ...previous, channels: { ...previous.channels, webPush: isPushSubscribed } });
  }, [
    isPushReady,
    isPushSubscribed,
    notificationPreferences.channels.webPush,
    setNotificationPreferences,
  ]);

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
  // reflowed for the sidebar width: title, icon-tab strip, scrolling content.
  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="settings-surface-content">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-foreground">{t('title')}</h2>
        {saveStatus === 'success' && (
          <span className="text-xs text-muted-foreground">{t('saveStatus.success')}</span>
        )}
        {/* The error state renders too (audit1 job 8): the reason, and the
            switches already back at what the server holds. */}
        {saveStatus === 'error' && (
          <span
            data-slot="settings-save-error"
            className="min-w-0 truncate pl-3 text-right text-xs text-destructive"
            title={saveError ?? undefined}
          >
            {saveError ? `${t('saveStatus.error')}: ${saveError}` : t('saveStatus.error')}
          </span>
        )}
      </div>

      <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

      <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div key={activeTab} className="settings-content-enter min-w-0 overflow-x-hidden px-3 py-3 pb-safe-area-inset-bottom">
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
              pushError={pushError}
              pushRequiresHomeScreen={pushRequiresHomeScreen}
              onEnablePush={handleEnablePush}
              onDisablePush={handleDisablePush}
              isDesktop={Boolean(desktopNotificationsBridge)}
              desktopNotifications={desktopNotificationsState}
              onEnableDesktopNotifications={handleEnableDesktopNotifications}
              onDisableDesktopNotifications={handleDisableDesktopNotifications}
            />
          )}

          {activeTab === 'system' && <SystemSettingsTab projects={projects} />}
        </div>
      </main>
    </div>
  );
}

export default Settings;
