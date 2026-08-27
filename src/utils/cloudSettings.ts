import { authenticatedFetch } from './api';

/**
 * Cloud-synced client preferences (ui11 phase 1). Every preference that used
 * to live only in this browser's localStorage now has its row in the server's
 * per-user settings store. localStorage is the boot cache: readers keep
 * reading it synchronously at first render, `hydrateSettings` overwrites it
 * from the server at app load, and each write goes to the server immediately.
 * Every change (local or remote) is announced as a `storage` event on window,
 * so consumers react to a remote device's change exactly as they already
 * react to another tab's.
 */

export const settingsClientId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Exact localStorage keys that follow the user across devices. */
export const SYNCED_SETTING_KEYS = [
  'theme',
  'color-theme',
  'custom-accent',
  'codeEditorWordWrap',
  'codeEditorShowMinimap',
  'codeEditorLineNumbers',
  'codeEditorFontSize',
  'claude-settings',
  'cursor-tools-settings',
  'codex-settings',
  'uiPreferences',
  'selected-provider',
  'claude-model',
  'cursor-model',
  'codex-model',
  'opencode-model',
  'claude-effort',
  'cursor-effort',
  'codex-effort',
  'opencode-effort',
  'workspace-layout-v1',
  'project-windows-v1',
  'project-last-opened-v1',
  'worker-jobs-view-open-v1',
  'activeTab',
  'sidebar-active-tab',
  'file-tree-view-mode',
  'voiceConfig',
  'notificationSoundEnabled',
  'tasks-enabled',
];

/** Key families with a dynamic suffix (per project) that sync the same way. */
export const SYNCED_SETTING_PREFIXES = ['command_history_'];

// Set once this device has hydrated from the server. Before that, a local key
// the server lacks is this device's pre-sync preference and migrates up; after
// that, a key the server lacks was deleted on another device and clears here.
const HYDRATED_MARKER_KEY = 'cloud-settings-hydrated';

const isSyncedKey = (key: string): boolean =>
  SYNCED_SETTING_KEYS.includes(key) || SYNCED_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix));

let pendingWrites: Record<string, string | null> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Nothing reaches the server until the first hydrate has answered: the boot
// effects of a fresh browser write their defaults on mount, and pushing those
// would overwrite the user's real preferences with the app's defaults.
// Hydrate reconciles them instead (server wins; keys the server lacks go up).
let hydrated = false;

const flushWrites = () => {
  flushTimer = null;
  const settings = pendingWrites;
  pendingWrites = {};
  void authenticatedFetch('/api/settings/preferences', {
    method: 'PUT',
    body: JSON.stringify({ settings, clientId: settingsClientId }),
  }).catch(() => {
    // Transient network failure; the next hydrate reconciles.
  });
};

const queueWrite = (key: string, value: string | null) => {
  if (!hydrated) {
    return;
  }
  pendingWrites[key] = value;
  if (flushTimer === null) {
    flushTimer = setTimeout(flushWrites, 0);
  }
};

/** Writes the boot cache and tells every listener; returns false when unchanged. */
const setLocal = (key: string, value: string | null): boolean => {
  const previous = localStorage.getItem(key);
  if (previous === value) {
    return false;
  }
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, value);
  }
  window.dispatchEvent(
    new StorageEvent('storage', { key, oldValue: previous, newValue: value, storageArea: localStorage }),
  );
  return true;
};

/** Persists one preference locally and on the server; null deletes it. */
export const writeSetting = (key: string, value: string | null): void => {
  if (setLocal(key, value)) {
    queueWrite(key, value);
  }
};

export const applyRemoteSettings = (settings: Record<string, string | null>): void => {
  for (const [key, value] of Object.entries(settings)) {
    setLocal(key, value);
  }
};

export const hydrateSettings = async (): Promise<void> => {
  let remote: Record<string, string>;
  try {
    const response = await authenticatedFetch('/api/settings/preferences');
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    remote = body?.settings && typeof body.settings === 'object' ? body.settings : {};
  } catch {
    return;
  } finally {
    hydrated = true;
  }

  const hydratedBefore = localStorage.getItem(HYDRATED_MARKER_KEY) === '1';
  const localOnly: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && isSyncedKey(key) && !(key in remote)) {
      localOnly[key] = localStorage.getItem(key) as string;
    }
  }

  applyRemoteSettings(remote);
  for (const [key, value] of Object.entries(localOnly)) {
    if (hydratedBefore) {
      setLocal(key, null);
    } else {
      queueWrite(key, value);
    }
  }
  localStorage.setItem(HYDRATED_MARKER_KEY, '1');
};

/**
 * Subscribes to changes of the given keys from any source (this tab, another
 * tab, another device); the handler gets the new raw value or null.
 */
export const onSettingChange = (
  keys: string[],
  handler: (key: string, value: string | null) => void,
): (() => void) => {
  const listener = (event: StorageEvent) => {
    if (event.key && keys.includes(event.key)) {
      handler(event.key, event.newValue);
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
};
