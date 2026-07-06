import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const forbiddenOsNotificationTokens = [
  '山田',
  '太郎',
  'P-00421',
  'ワルファリン',
  'モルヒネ',
  '肺がん',
  'patient_1',
  'report_1',
  'visit_1',
  'rx_1',
  '/patients/',
  '/prescriptions/',
  'secret-token',
];

type CapturedHandlers = Map<string, Array<(event: Record<string, unknown>) => void>>;

function expectNoOsPhi(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const token of forbiddenOsNotificationTokens) {
    expect(serialized).not.toContain(token);
  }
}

async function loadServiceWorker() {
  vi.resetModules();
  vi.doMock('serwist', () => ({
    CacheFirst: class CacheFirst {},
    ExpirationPlugin: class ExpirationPlugin {},
    NetworkFirst: class NetworkFirst {},
    NetworkOnly: class NetworkOnly {},
    Serwist: class Serwist {
      addEventListeners = vi.fn();
    },
    StaleWhileRevalidate: class StaleWhileRevalidate {},
  }));

  const handlers: CapturedHandlers = new Map();
  const showNotification = vi.fn(async () => undefined);
  const openWindow = vi.fn(async () => undefined);
  const fakeSelf = {
    __SW_MANIFEST: [],
    addEventListener: vi.fn((type: string, handler: (event: Record<string, unknown>) => void) => {
      const current = handlers.get(type) ?? [];
      current.push(handler);
      handlers.set(type, current);
    }),
    caches: {
      delete: vi.fn(async () => true),
    },
    clients: {
      openWindow,
    },
    registration: {
      showNotification,
    },
  };
  vi.stubGlobal('self', fakeSelf);

  await import('./sw');

  return { handlers, showNotification, openWindow };
}

describe('service worker OS notification boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('redacts hostile Web Push payloads before showNotification', async () => {
    const { handlers, showNotification } = await loadServiceWorker();
    const pushHandler = handlers.get('push')?.[0];
    expect(pushHandler).toBeTypeOf('function');

    let waited: Promise<unknown> | undefined;
    pushHandler?.({
      data: {
        json: () => ({
          type: 'urgent',
          title: '山田 太郎さんの緊急連絡',
          body: '患者番号 P-00421 / ワルファリン / モルヒネ / 肺がん疼痛',
          link: '/patients/patient_1/prescriptions/rx_1?name=山田太郎',
          patientId: 'patient_1',
          reportId: 'report_1',
          visitId: 'visit_1',
          metadata: { drugName: 'ワルファリン', token: 'secret-token' },
        }),
      },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    });
    await waited;

    expect(showNotification).toHaveBeenCalledWith('PH-OS 通知', {
      body: '新しい緊急通知があります',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-72x72.png',
      tag: 'ph-os-urgent-notification',
      data: { url: '/notifications' },
    });
    expectNoOsPhi(showNotification.mock.calls);
  });

  it('notificationclick ignores hostile notification data URLs', async () => {
    const { handlers, openWindow } = await loadServiceWorker();
    const clickHandler = handlers.get('notificationclick')?.[0];
    expect(clickHandler).toBeTypeOf('function');
    const close = vi.fn();

    let waited: Promise<unknown> | undefined;
    clickHandler?.({
      notification: {
        close,
        data: {
          url: 'https://evil.example.test/patients/patient_1?name=山田太郎',
        },
      },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    });
    await waited;

    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith('/notifications');
    expect(openWindow).not.toHaveBeenCalledWith(expect.stringContaining('/patients/'));
  });
});
