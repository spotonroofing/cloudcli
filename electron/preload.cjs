const { contextBridge, ipcRenderer } = require('electron');
const LEGACY_DESKTOP_NOTIFICATIONS_KEY = ['cloud', 'cliDesktopNotifications'].join('');
const LEGACY_DESKTOP_BRIDGE_KEY = ['cloud', 'cliDesktop'].join('');

function warnLegacyBridge(key) {
  console.warn(`[Command Center] ${key} is deprecated; use its commandCenter replacement.`);
}

function isCommandCenterAppOrigin(location) {
  if (location.protocol === 'file:') return true;

  if (location.protocol === 'http:') {
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  return location.protocol === 'https:' && (
    location.hostname === 'command-center.ai' || location.hostname.endsWith('.command-center.ai')
  );
}

function onDesktopStateUpdated(callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on('command-center-desktop:state-updated', listener);
  return () => {
    ipcRenderer.removeListener('command-center-desktop:state-updated', listener);
  };
}

if (isCommandCenterAppOrigin(window.location)) {
  const desktopNotificationsBridge = {
    getState: () => ipcRenderer.invoke('command-center-desktop:get-state'),
    update: (settings) => ipcRenderer.invoke('command-center-desktop:update-desktop-notifications', settings),
    onStateUpdated: onDesktopStateUpdated,
  };
  contextBridge.exposeInMainWorld('commandCenterDesktopNotifications', desktopNotificationsBridge);
  contextBridge.exposeInMainWorld(LEGACY_DESKTOP_NOTIFICATIONS_KEY, {
    getState: (...args) => { warnLegacyBridge(LEGACY_DESKTOP_NOTIFICATIONS_KEY); return desktopNotificationsBridge.getState(...args); },
    update: (...args) => { warnLegacyBridge(LEGACY_DESKTOP_NOTIFICATIONS_KEY); return desktopNotificationsBridge.update(...args); },
    onStateUpdated: (...args) => { warnLegacyBridge(LEGACY_DESKTOP_NOTIFICATIONS_KEY); return desktopNotificationsBridge.onStateUpdated(...args); },
  });
}

if (window.location.protocol === 'file:') {
  const desktopBridge = {
    connectCloud: () => ipcRenderer.invoke('command-center-desktop:connect-cloud'),
    disconnectCloud: () => ipcRenderer.invoke('command-center-desktop:disconnect-cloud'),
    copyDiagnostics: () => ipcRenderer.invoke('command-center-desktop:copy-diagnostics'),
    copyLocalWebUrl: () => ipcRenderer.invoke('command-center-desktop:copy-local-web-url'),
    getState: () => ipcRenderer.invoke('command-center-desktop:get-state'),
    openCloudDashboard: () => ipcRenderer.invoke('command-center-desktop:open-cloud-dashboard'),
    openEnvironment: (environmentId) => ipcRenderer.invoke('command-center-desktop:open-environment', environmentId),
    runActiveEnvironmentAction: (action) => ipcRenderer.invoke('command-center-desktop:run-active-environment-action', action),
    openLocal: () => ipcRenderer.invoke('command-center-desktop:open-local'),
    openLocalWebUi: () => ipcRenderer.invoke('command-center-desktop:open-local-web-ui'),
    refreshEnvironments: () => ipcRenderer.invoke('command-center-desktop:refresh-environments'),
    refreshActiveTab: () => ipcRenderer.invoke('command-center-desktop:reload-active-tab'),
    showEnvironmentPicker: () => ipcRenderer.invoke('command-center-desktop:show-environment-picker'),
    showLauncher: () => ipcRenderer.invoke('command-center-desktop:show-launcher'),
    showLocalSettings: () => ipcRenderer.invoke('command-center-desktop:show-local-settings'),
    showDesktopSettings: () => ipcRenderer.invoke('command-center-desktop:show-desktop-settings'),
    closeSettingsWindow: () => ipcRenderer.invoke('command-center-desktop:close-settings-window'),
    showActiveEnvironmentActionsMenu: () => ipcRenderer.invoke('command-center-desktop:show-active-environment-actions-menu'),
    showEnvironmentActionsMenu: (environmentId) => ipcRenderer.invoke('command-center-desktop:show-environment-actions-menu', environmentId),
    switchTab: (tabId) => ipcRenderer.invoke('command-center-desktop:switch-tab', tabId),
    closeTab: (tabId) => ipcRenderer.invoke('command-center-desktop:close-tab', tabId),
    updateSetting: (key, value) => ipcRenderer.invoke('command-center-desktop:update-setting', key, value),
    onStateUpdated: onDesktopStateUpdated,
    onLauncherCommand: (callback) => {
      ipcRenderer.on('command-center-desktop:launcher-command', (_event, command) => callback(command));
    },
  };
  contextBridge.exposeInMainWorld('commandCenterDesktop', desktopBridge);
  contextBridge.exposeInMainWorld(LEGACY_DESKTOP_BRIDGE_KEY, new Proxy(desktopBridge, {
    get(target, property) {
      warnLegacyBridge(LEGACY_DESKTOP_BRIDGE_KEY);
      return target[property];
    },
  }));
}
