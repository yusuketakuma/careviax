// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { showBrowserNotification } from './browser-notifications';

const forbiddenOsNotificationTokens = [
  '山田',
  '太郎',
  'ワルファリン',
  'patient_1',
  '/patients/',
  '/prescriptions/',
  'secret-token',
];

function expectNoOsPhi(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const token of forbiddenOsNotificationTokens) {
    expect(serialized).not.toContain(token);
  }
}

describe('showBrowserNotification', () => {
  beforeEach(() => {
    vi.stubGlobal('ServiceWorkerRegistration', class ServiceWorkerRegistration {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Service Worker notification payload を helper 境界で redaction する', async () => {
    const showNotification = vi.fn(async () => undefined);
    const registration = { showNotification };
    const getRegistration = vi.fn(async () => registration);
    const register = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration,
        register,
      },
    });
    vi.stubGlobal(
      'Notification',
      class Notification {
        static permission = 'granted';
      },
    );

    await showBrowserNotification({
      tag: 'notification_phi_1',
      type: 'business',
      title: '山田 太郎さんの疑義照会',
      body: 'ワルファリン用量を確認してください',
      url: '/patients/patient_1/prescriptions/rx_1?token=secret-token',
    });

    expect(getRegistration).toHaveBeenCalledWith('/');
    expect(register).not.toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith('PH-OS 通知', {
      body: '新しい業務通知があります',
      tag: 'ph-os-business-notification',
      data: { url: '/notifications' },
    });
    expectNoOsPhi(showNotification.mock.calls);
  });

  it('fallback Notification click でも raw URL を開かない', async () => {
    const assign = vi.fn();
    const focus = vi.fn();
    const close = vi.fn();
    let notificationClick: unknown;
    let notificationOptions: NotificationOptions | undefined;

    vi.stubGlobal('ServiceWorkerRegistration', undefined);
    Object.defineProperty(window, 'focus', { value: focus, configurable: true });
    Object.defineProperty(window, 'location', {
      value: { assign },
      configurable: true,
    });
    vi.stubGlobal(
      'Notification',
      class Notification {
        static permission = 'granted';

        onclick: (() => void) | null = null;

        constructor(
          public readonly title: string,
          public readonly options: NotificationOptions,
        ) {
          notificationOptions = options;
          notificationClick = () => this.onclick?.();
          Object.defineProperty(this, 'close', { value: close });
        }
      },
    );

    await showBrowserNotification({
      tag: 'notification_phi_2',
      type: 'urgent',
      title: '山田 太郎さんの緊急連絡',
      body: 'ワルファリン / patient_1',
      url: 'https://evil.example.test/patients/patient_1?token=secret-token',
    });

    expect(notificationOptions).toMatchObject({
      body: '新しい緊急通知があります',
      tag: 'ph-os-urgent-notification',
    });
    expect(notificationClick).toBeTypeOf('function');
    if (typeof notificationClick !== 'function') {
      throw new Error('Notification click handler was not captured');
    }
    notificationClick();

    expect(focus).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/notifications');
    expect(assign).not.toHaveBeenCalledWith(expect.stringContaining('/patients/'));
    expect(close).toHaveBeenCalledOnce();
  });
});
