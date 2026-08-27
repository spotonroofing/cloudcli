import { Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { playChatCompletionSound } from '../../../../utils/notificationSound';
import type { NotificationPreferencesState } from '../../types/types';
import SettingsCard from '../SettingsCard';
import SettingsRow from '../SettingsRow';
import SettingsSection from '../SettingsSection';
import SettingsToggle from '../SettingsToggle';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
  isDesktop?: boolean;
  desktopNotifications?: {
    enabled: boolean;
    supported: boolean;
    connectedCount?: number;
    targetCount?: number;
    lastError?: string | null;
  } | null;
  onEnableDesktopNotifications?: () => void;
  onDisableDesktopNotifications?: () => void;
};

/**
 * Notifications tab on the Appearance tab's anatomy (ui14 job 5): sections of
 * rows in cards, every on/off through the app's one toggle, no tab-level
 * heading (the tab strip already names it).
 */
export default function NotificationsSettingsTab({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
  isDesktop = false,
  desktopNotifications = null,
  onEnableDesktopNotifications,
  onDisableDesktopNotifications,
}: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';
  const desktopUnsupported = desktopNotifications?.supported === false;

  const setEvent = (key: keyof NotificationPreferencesState['events'], value: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      events: { ...notificationPreferences.events, [key]: value },
    });
  };

  return (
    <div className="space-y-5">
      <SettingsSection title={t('notifications.title')}>
        <SettingsCard divided>
          {isDesktop ? (
            <SettingsRow
              label={t('notifications.desktop.title', { defaultValue: 'Notify this desktop app' })}
              description={
                desktopUnsupported
                  ? t('notifications.desktop.unsupported', { defaultValue: 'Desktop notifications are not supported on this system.' })
                  : desktopNotifications?.lastError ?? undefined
              }
            >
              <SettingsToggle
                checked={Boolean(desktopNotifications?.enabled)}
                onChange={(value) => (value ? onEnableDesktopNotifications?.() : onDisableDesktopNotifications?.())}
                ariaLabel={t('notifications.desktop.title', { defaultValue: 'Notify this desktop app' })}
                disabled={desktopUnsupported}
              />
            </SettingsRow>
          ) : (
            <SettingsRow
              label={t('notifications.webPush.title')}
              description={
                !pushSupported
                  ? t('notifications.webPush.unsupported')
                  : pushDenied
                    ? t('notifications.webPush.denied')
                    : undefined
              }
            >
              <div className="flex items-center gap-2">
                {isPushLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
                <SettingsToggle
                  checked={isPushSubscribed}
                  onChange={(value) => (value ? onEnablePush() : onDisablePush())}
                  ariaLabel={t('notifications.webPush.title')}
                  disabled={isPushLoading || !pushSupported || pushDenied}
                />
              </div>
            </SettingsRow>
          )}

          <SettingsRow
            label={t('notifications.sound.title', { defaultValue: 'Sound' })}
            description={t('notifications.sound.description', { defaultValue: 'Play a short tone when a chat run finishes.' })}
          >
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  void playChatCompletionSound({ force: true });
                }}
              >
                <Play className="h-3.5 w-3.5" />
                {t('notifications.sound.test', { defaultValue: 'Test sound' })}
              </Button>
              <SettingsToggle
                checked={notificationPreferences.channels.sound}
                onChange={(value) =>
                  onNotificationPreferencesChange({
                    ...notificationPreferences,
                    channels: { ...notificationPreferences.channels, sound: value },
                  })
                }
                ariaLabel={t('notifications.sound.title', { defaultValue: 'Sound' })}
              />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('notifications.events.title')}>
        <SettingsCard divided>
          <SettingsRow label={t('notifications.events.actionRequired')}>
            <SettingsToggle
              checked={notificationPreferences.events.actionRequired}
              onChange={(value) => setEvent('actionRequired', value)}
              ariaLabel={t('notifications.events.actionRequired')}
            />
          </SettingsRow>
          <SettingsRow label={t('notifications.events.stop')}>
            <SettingsToggle
              checked={notificationPreferences.events.stop}
              onChange={(value) => setEvent('stop', value)}
              ariaLabel={t('notifications.events.stop')}
            />
          </SettingsRow>
          <SettingsRow label={t('notifications.events.error')}>
            <SettingsToggle
              checked={notificationPreferences.events.error}
              onChange={(value) => setEvent('error', value)}
              ariaLabel={t('notifications.events.error')}
            />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
