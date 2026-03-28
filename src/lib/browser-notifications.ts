'use client';

export const BROWSER_NOTIFICATION_PREFERENCE_KEY =
  'careviax.browserNotificationsEnabled';
const BROWSER_NOTIFICATION_SW_URL = '/browser-notifications-sw.js';

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
  window.localStorage.setItem(
    BROWSER_NOTIFICATION_PREFERENCE_KEY,
    enabled ? 'true' : 'false'
  );
}

export async function ensureBrowserNotificationRegistration() {
  if (!isBrowserNotificationServiceWorkerSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.register(BROWSER_NOTIFICATION_SW_URL, {
      scope: '/',
    });
    await navigator.serviceWorker.ready;
    return registration;
  } catch {
    return null;
  }
}

export async function showBrowserNotification(args: {
  title: string;
  body: string;
  tag: string;
  url?: string | null;
}) {
  if (!isBrowserNotificationSupported() || Notification.permission !== 'granted') return;

  const registration = await ensureBrowserNotificationRegistration();
  if (registration) {
    await registration.showNotification(args.title, {
      body: args.body,
      tag: args.tag,
      data: {
        url: args.url ?? null,
      },
    });
    return;
  }

  const notification = new Notification(args.title, {
    body: args.body,
    tag: args.tag,
  });

  notification.onclick = () => {
    window.focus();
    if (args.url) {
      window.location.assign(args.url);
    }
    notification.close();
  };
}
