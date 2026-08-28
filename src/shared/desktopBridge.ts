const LEGACY_DESKTOP_NOTIFICATIONS_KEY = ['cloud', 'cliDesktopNotifications'].join('');
let legacyBridgeWarningLogged = false;

/**
 * Returns the desktop notifications bridge and temporarily accepts the legacy
 * preload key so an older desktop shell can host a freshly updated frontend.
 */
export function getDesktopNotificationsBridge(): any {
  if (typeof window === 'undefined') return null;
  const commandCenterWindow = window as unknown as Record<string, unknown>;
  if (commandCenterWindow.commandCenterDesktopNotifications) {
    return commandCenterWindow.commandCenterDesktopNotifications;
  }
  const legacyBridge = commandCenterWindow[LEGACY_DESKTOP_NOTIFICATIONS_KEY];
  if (legacyBridge && !legacyBridgeWarningLogged) {
    legacyBridgeWarningLogged = true;
    console.warn('[Command Center] The legacy desktop notifications bridge key is deprecated.');
  }
  return legacyBridge || null;
}
