import { useCallback, useEffect, useRef, useState } from 'react';

import { authenticatedFetch } from '../utils/api';
import { getDesktopNotificationsBridge } from '../shared/desktopBridge';

type WebPushState = {
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  /** The current reason, readable the instant subscribe() settles. */
  lastError: () => string | null;
  requiresHomeScreen: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
};

const HOME_SCREEN_ERROR = 'Install Command Center to your Home Screen before enabling notifications on iPhone or iPad.';

function requiresIosHomeScreen(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigatorWithStandalone.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
  return isiOS && !standalone;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json() as {
      error?: unknown;
      message?: unknown;
    };
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error.trim();
    if (
      payload.error
      && typeof payload.error === 'object'
      && 'message' in payload.error
      && typeof payload.error.message === 'string'
      && payload.error.message.trim()
    ) {
      return payload.error.message.trim();
    }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  } catch {
    // The status text below is still more useful than hiding the failure.
  }
  return response.statusText ? `${fallback}: ${response.statusText}` : fallback;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useWebPush(): WebPushState {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (
      typeof window === 'undefined'
      || Boolean(getDesktopNotificationsBridge())
      || !('Notification' in window)
      || !('serviceWorker' in navigator)
    ) {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  // A caller that awaits subscribe() needs the reason before the state render
  // reaches it (audit1 job 8), so the reason is mirrored into a ref.
  const errorRef = useRef<string | null>(null);
  const setError = useCallback((value: string | null) => {
    errorRef.current = value;
    setErrorState(value);
  }, []);
  const lastError = useCallback(() => errorRef.current, []);
  const [requiresHomeScreen] = useState(requiresIosHomeScreen);

  // Check existing subscription on mount; a local subscription only counts as
  // enabled once the server confirms it has the stored row.
  useEffect(() => {
    // subscribe/unsubscribe own the state transition while their request is in
    // flight. Re-check the server after they settle instead of racing them.
    if (isLoading) return;
    if (permission === 'unsupported') {
      setIsReady(true);
      return;
    }
    if (requiresHomeScreen) {
      setError(HOME_SCREEN_ERROR);
      setIsSubscribed(false);
      setIsReady(true);
      return;
    }

    navigator.serviceWorker.ready.then(async (registration) => {
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        setIsReady(true);
        return;
      }
      try {
        const res = await authenticatedFetch(
          `/api/settings/push/subscription-status?endpoint=${encodeURIComponent(sub.endpoint)}`,
        );
        if (!res.ok) throw new Error(await responseError(res, 'Could not confirm the push subscription'));
        const { subscribed } = await res.json() as { subscribed?: unknown };
        setIsSubscribed(subscribed === true);
        setError(null);
      } catch (caught) {
        setIsSubscribed(false);
        setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setIsReady(true);
      }
    }).catch((caught) => {
      setIsSubscribed(false);
      setError(caught instanceof Error ? caught.message : 'The notification service worker is not ready.');
      setIsReady(true);
    });
  }, [isLoading, permission, requiresHomeScreen, setError]);

  const subscribe = useCallback(async () => {
    setError(null);
    setIsSubscribed(false);
    if (permission === 'unsupported') {
      setError('Push notifications are not supported in this browser.');
      return false;
    }
    if (requiresHomeScreen) {
      setError(HOME_SCREEN_ERROR);
      return false;
    }
    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError(perm === 'denied' ? 'Notification permission is blocked in browser settings.' : 'Notification permission was not granted.');
        return false;
      }

      const keyRes = await authenticatedFetch('/api/settings/push/vapid-public-key');
      if (!keyRes.ok) throw new Error(await responseError(keyRes, 'Could not load the push key'));
      const { publicKey } = await keyRes.json() as { publicKey?: unknown };
      if (typeof publicKey !== 'string' || !publicKey) {
        throw new Error('The server did not provide a push key.');
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
      });

      const subJson = subscription.toJSON();
      const subscribeResponse = await authenticatedFetch('/api/settings/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
        }),
      });
      if (!subscribeResponse.ok) {
        throw new Error(await responseError(subscribeResponse, 'The server rejected the push subscription'));
      }
      const acknowledgement = await subscribeResponse.json() as { success?: unknown; subscribed?: unknown };
      if (acknowledgement.success !== true || acknowledgement.subscribed !== true) {
        throw new Error('The server did not confirm the push subscription.');
      }

      setIsSubscribed(true);
      return true;
    } catch (caught) {
      setIsSubscribed(false);
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsLoading(false);
      setIsReady(true);
    }
  }, [permission, requiresHomeScreen, setError]);

  const unsubscribe = useCallback(async () => {
    setIsLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        const response = await authenticatedFetch('/api/settings/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
        });
        if (!response.ok) throw new Error(await responseError(response, 'The server could not disable push notifications'));
        const acknowledgement = await response.json() as { success?: unknown; subscribed?: unknown };
        if (acknowledgement.success !== true || acknowledgement.subscribed !== false) {
          throw new Error('The server did not confirm that push notifications were disabled.');
        }
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
      setError(null);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  return { permission, isSubscribed, isLoading, isReady, error, lastError, requiresHomeScreen, subscribe, unsubscribe };
}
