'use client';

import {
  OS_BRIDGE_LANDING_URL,
  redactNotificationForOsBridge,
} from '@/lib/notifications/os-bridge-redaction';

export const BROWSER_NOTIFICATION_PREFERENCE_KEY = 'ph-os.browserNotificationsEnabled';

export function isBrowserNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isBrowserNotificationServiceWorkerSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof ServiceWorkerRegistration !== 'undefined'
  );
}

export function getBrowserNotificationPreference() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(BROWSER_NOTIFICATION_PREFERENCE_KEY) === 'true';
}

export function setBrowserNotificationPreference(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BROWSER_NOTIFICATION_PREFERENCE_KEY, enabled ? 'true' : 'false');
}

export async function ensureBrowserNotificationRegistration() {
  if (!isBrowserNotificationServiceWorkerSupported()) return null;

  try {
    return (await navigator.serviceWorker.getRegistration('/')) ?? null;
  } catch {
    return null;
  }
}

export async function showBrowserNotification(args: {
  tag: string;
  type?: string | null;
  title?: string;
  body?: string;
  url?: string | null;
}) {
  if (!isBrowserNotificationSupported() || Notification.permission !== 'granted') return;

  const redacted = redactNotificationForOsBridge({ type: args.type ?? 'system' });
  const registration = await ensureBrowserNotificationRegistration();
  if (registration) {
    await registration.showNotification(redacted.title, {
      body: redacted.body,
      tag: redacted.tag,
      data: {
        url: redacted.url,
      },
    });
    return;
  }

  const notification = new Notification(redacted.title, {
    body: redacted.body,
    tag: redacted.tag,
  });

  notification.onclick = () => {
    window.focus();
    window.location.assign(OS_BRIDGE_LANDING_URL);
    notification.close();
  };
}
