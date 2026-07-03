import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildExternalNotificationContent, dispatchNotificationEvent } from './notifications';

const {
  broadcastStatusUpdateMock,
  loggerWarnMock,
  sendSmsMock,
  sendLineMessageMock,
  sendWebPushMock,
  setVapidDetailsMock,
} = vi.hoisted(() => ({
  broadcastStatusUpdateMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  sendSmsMock: vi.fn(),
  sendLineMessageMock: vi.fn(),
  sendWebPushMock: vi.fn(),
  setVapidDetailsMock: vi.fn(),
}));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendWebPushMock,
  },
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

vi.mock('@/server/adapters/sms', () => ({
  SmsNotificationAdapter: class {
    sendSms = sendSmsMock;
  },
}));

vi.mock('@/server/adapters/line', () => ({
  LineNotificationAdapter: class {
    sendMessage = sendLineMessageMock;
  },
}));

async function runScheduledDeliveries() {
  await vi.runOnlyPendingTimersAsync();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForAsyncAssertion(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

function createTx() {
  const notificationRuleFindMany = vi.fn();
  const membershipFindMany = vi.fn();
  const notificationCreate = vi.fn();
  const notificationUpsert = vi.fn();
  const pushSubscriptionFindMany = vi.fn();
  const userFindMany = vi.fn();

  return {
    tx: {
      notificationRule: {
        findMany: notificationRuleFindMany,
      },
      membership: {
        findMany: membershipFindMany,
      },
      notification: {
        create: notificationCreate,
        upsert: notificationUpsert,
      },
      pushSubscription: {
        findMany: pushSubscriptionFindMany,
      },
      user: {
        findMany: userFindMany,
      },
    },
    notificationRuleFindMany,
    membershipFindMany,
    notificationCreate,
    notificationUpsert,
    pushSubscriptionFindMany,
    userFindMany,
  };
}

describe('dispatchNotificationEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delivers to explicit users when no notification rules exist', async () => {
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'visit_schedule_reschedule_requested',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user_1',
          event_type: 'visit_schedule_reschedule_requested',
        }),
      }),
    );
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('user:user_1', [
      {
        id: 'notification_1',
        type: 'business',
        title: '承認待ち',
        message: '通知を確認してください',
        link: null,
        is_read: false,
        created_at: '2026-06-17T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(broadcastStatusUpdateMock.mock.calls[0]?.[1])).not.toContain(
      'dedupe_key',
    );
  });

  it('logs a safe warning when realtime broadcast fails without rejecting persisted notifications', async () => {
    loggerWarnMock.mockReset();
    const rawError = 'realtime failed for 患者A token=secret notification body';
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));
    broadcastStatusUpdateMock.mockRejectedValueOnce(new Error(rawError));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'visit_schedule_reschedule_requested',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'notifications.realtime_delivery_failed',
        entityType: 'notification',
        operation: 'broadcast',
        count: 1,
      },
      expect.any(Error),
    );
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain(rawError);
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('患者A');
    expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('token=secret');
  });

  it('suppresses explicit notifications when in-app rules exist but are all disabled', async () => {
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_1',
        org_id: 'org_1',
        event_type: 'visit_schedule_reschedule_requested',
        channel: 'in_app',
        recipients: {},
        enabled: false,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'visit_schedule_reschedule_requested',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toEqual([]);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('includes explicit and rule-based recipients when an enabled rule exists', async () => {
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_1',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: {
          roles: ['admin'],
          user_ids: ['user_2'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_3', role: 'admin' }]);
    userFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1', 'user_2'],
    });

    expect(notifications).toHaveLength(3);
    expect(notificationCreate).toHaveBeenCalledTimes(3);
    const userIds = notificationCreate.mock.calls.map(
      ([args]) => (args as { data: { user_id: string } }).data.user_id,
    );
    expect(userIds).toEqual(['user_1', 'user_2', 'user_3']);
  });

  it('bounds concurrent notification row creation for large recipient sets', async () => {
    const originalConcurrency = process.env.NOTIFICATION_DELIVERY_CONCURRENCY;
    process.env.NOTIFICATION_DELIVERY_CONCURRENCY = '2';
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();
    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);

    let activeCreates = 0;
    let maxActiveCreates = 0;
    const pendingCreates: Array<() => void> = [];
    notificationCreate.mockImplementation(
      async ({ data }) =>
        new Promise((resolve) => {
          activeCreates += 1;
          maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
          pendingCreates.push(() => {
            activeCreates -= 1;
            resolve({
              id: `notification_${data.user_id as string}`,
              ...data,
            });
          });
        }),
    );

    try {
      const run = dispatchNotificationEvent(tx, {
        orgId: 'org_1',
        eventType: 'patient_self_report_followup_due',
        type: 'urgent',
        title: '折り返し依頼',
        message: '至急対応してください',
        explicitUserIds: ['user_1', 'user_2', 'user_3', 'user_4'],
      });

      await waitForAsyncAssertion(() => {
        expect(pendingCreates).toHaveLength(2);
      });
      expect(maxActiveCreates).toBe(2);

      pendingCreates.splice(0).forEach((release) => release());
      await waitForAsyncAssertion(() => {
        expect(pendingCreates).toHaveLength(2);
      });
      expect(maxActiveCreates).toBe(2);

      pendingCreates.splice(0).forEach((release) => release());
      await expect(run).resolves.toHaveLength(4);
      expect(notificationCreate).toHaveBeenCalledTimes(4);
      expect(maxActiveCreates).toBe(2);
    } finally {
      pendingCreates.splice(0).forEach((release) => release());
      if (originalConcurrency === undefined) {
        delete process.env.NOTIFICATION_DELIVERY_CONCURRENCY;
      } else {
        process.env.NOTIFICATION_DELIVERY_CONCURRENCY = originalConcurrency;
      }
    }
  });

  it('ignores unsupported role recipients before querying memberships', async () => {
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_1',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: {
          roles: ['physician', 'admin', 42, 'admin'],
          user_ids: ['user_2', null],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_3', role: 'admin' }]);
    userFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(3);
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['admin'] },
        }),
      }),
    );
    const userIds = notificationCreate.mock.calls.map(
      ([args]) => (args as { data: { user_id: string } }).data.user_id,
    );
    expect(userIds).toEqual(['user_1', 'user_2', 'user_3']);
  });

  it('ignores malformed recipient configs while keeping enabled explicit recipients', async () => {
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_1',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: ['admin'],
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user_1',
        }),
      }),
    );
  });

  it('routes sms notifications to users with phone numbers when sms rules are enabled', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'visit_schedule_reschedule_requested',
        channel: 'sms',
        recipients: {
          roles: ['admin'],
          user_ids: ['user_2'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_3', role: 'admin' }]);
    userFindMany.mockResolvedValue([
      { id: 'user_1', phone: '09000000001' },
      { id: 'user_2', phone: null },
      { id: 'user_3', phone: '09000000003' },
    ]);

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'visit_schedule_reschedule_requested',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();

    await runScheduledDeliveries();

    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      1,
      '09000000001',
      'PH-OS通知\nアプリで詳細を確認してください',
    );
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      2,
      '09000000003',
      'PH-OS通知\nアプリで詳細を確認してください',
    );
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('routes line notifications to explicit and rule-based user ids', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, userFindMany } = createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_line',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'line',
        recipients: {
          user_ids: ['user_2'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([
      { id: 'user_1', phone: null },
      { id: 'user_2', phone: null },
    ]);

    await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1'],
    });

    expect(sendLineMessageMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();

    await runScheduledDeliveries();

    expect(sendLineMessageMock).toHaveBeenCalledTimes(2);
    expect(sendLineMessageMock).toHaveBeenNthCalledWith(
      1,
      'user_1',
      'PH-OS通知\nアプリで詳細を確認してください',
    );
    expect(sendLineMessageMock).toHaveBeenNthCalledWith(
      2,
      'user_2',
      'PH-OS通知\nアプリで詳細を確認してください',
    );
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('keeps PHI in persisted in-app notifications while redacting external SMS and LINE bodies', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: {
          user_ids: ['user_1'],
        },
        enabled: true,
      },
      {
        id: 'rule_line',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'line',
        recipients: {
          user_ids: ['user_1'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([{ id: 'user_1', phone: '09000000001' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));

    await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '田中 一郎さんの麻薬管理確認',
      message: 'モルヒネ残薬と肺がん疼痛について確認してください',
      explicitUserIds: ['user_1'],
    });

    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: '田中 一郎さんの麻薬管理確認',
          message: 'モルヒネ残薬と肺がん疼痛について確認してください',
        }),
      }),
    );
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('user:user_1', [
      expect.objectContaining({
        title: '田中 一郎さんの麻薬管理確認',
        message: 'モルヒネ残薬と肺がん疼痛について確認してください',
      }),
    ]);

    await runScheduledDeliveries();

    const expectedExternalBody = 'PH-OS通知\nアプリで詳細を確認してください';
    expect(sendSmsMock).toHaveBeenCalledWith('09000000001', expectedExternalBody);
    expect(sendLineMessageMock).toHaveBeenCalledWith('user_1', expectedExternalBody);
    const externalPayloads = JSON.stringify([
      sendSmsMock.mock.calls,
      sendLineMessageMock.mock.calls,
      buildExternalNotificationContent(),
    ]);
    expect(externalPayloads).not.toContain('田中');
    expect(externalPayloads).not.toContain('一郎');
    expect(externalPayloads).not.toContain('モルヒネ');
    expect(externalPayloads).not.toContain('肺がん');
  });

  it('redacts Web Push payloads while preserving persisted in-app notification details', async () => {
    const originalPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const originalPrivateKey = process.env.VAPID_PRIVATE_KEY;
    const originalSubject = process.env.VAPID_SUBJECT;
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'public-key';
    process.env.VAPID_PRIVATE_KEY = 'private-key';
    process.env.VAPID_SUBJECT = 'mailto:test@example.com';
    vi.useFakeTimers();
    vi.resetModules();
    sendWebPushMock.mockReset();
    setVapidDetailsMock.mockReset();
    const { dispatchNotificationEvent: dispatchWithPush } = await import('./notifications');
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      pushSubscriptionFindMany,
    } = createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));
    pushSubscriptionFindMany.mockResolvedValue([
      {
        endpoint: 'https://push.example.test/subscription',
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
      },
    ]);

    try {
      await dispatchWithPush(tx, {
        orgId: 'org_1',
        eventType: 'patient_self_report_followup_due',
        type: 'urgent',
        title: '田中 一郎さんの麻薬管理確認',
        message: 'モルヒネ残薬と肺がん疼痛について確認してください',
        link: '/patients/patient_1',
        explicitUserIds: ['user_1'],
      });

      expect(notificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: '田中 一郎さんの麻薬管理確認',
            message: 'モルヒネ残薬と肺がん疼痛について確認してください',
          }),
        }),
      );
      expect(pushSubscriptionFindMany).toHaveBeenCalledWith({
        where: { org_id: 'org_1', user_id: { in: ['user_1'] } },
        select: { endpoint: true, p256dh: true, auth: true },
      });

      await runScheduledDeliveries();

      expect(setVapidDetailsMock).toHaveBeenCalledWith(
        'mailto:test@example.com',
        'public-key',
        'private-key',
      );
      expect(sendWebPushMock).toHaveBeenCalledTimes(1);
      const pushBody = JSON.parse(sendWebPushMock.mock.calls[0]?.[1] as string) as {
        title: string;
        body: string;
        link: string | null;
      };
      // OS/プッシュ層へは患者ディープリンク(患者 ID = PHI)を渡さず、汎用ランディング
      // /notifications のみを送る。title/body も種別非依存の汎用文言。
      expect(pushBody).toEqual({
        title: 'PH-OS通知',
        body: 'アプリで詳細を確認してください',
        link: '/notifications',
      });
      const payloadJson = JSON.stringify(pushBody);
      expect(payloadJson).not.toContain('田中');
      expect(payloadJson).not.toContain('一郎');
      expect(payloadJson).not.toContain('モルヒネ');
      expect(payloadJson).not.toContain('肺がん');
      // 患者 ID を含む生ディープリンクがプッシュ基盤へ漏れないことを明示的に検証する。
      expect(payloadJson).not.toContain('patient_1');
      expect(payloadJson).not.toContain('/patients/');
    } finally {
      if (originalPublicKey === undefined) {
        delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      } else {
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = originalPublicKey;
      }
      if (originalPrivateKey === undefined) {
        delete process.env.VAPID_PRIVATE_KEY;
      } else {
        process.env.VAPID_PRIVATE_KEY = originalPrivateKey;
      }
      if (originalSubject === undefined) {
        delete process.env.VAPID_SUBJECT;
      } else {
        process.env.VAPID_SUBJECT = originalSubject;
      }
      vi.resetModules();
    }
  });

  it('reuses role membership lookups across notification channels', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_in_app',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: {
          roles: ['admin'],
        },
        enabled: true,
      },
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: {
          roles: ['admin'],
        },
        enabled: true,
      },
      {
        id: 'rule_line',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'line',
        recipients: {
          roles: ['admin'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_admin', role: 'admin' }]);
    userFindMany.mockResolvedValue([{ id: 'user_admin', phone: '09000000000' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));

    await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
    });

    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['admin'] },
        }),
        select: {
          user_id: true,
          role: true,
        },
      }),
    );
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();

    await runScheduledDeliveries();

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it('shares pending role membership lookups across concurrent external channels', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_in_app',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: {},
        enabled: true,
      },
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: {
          roles: ['admin'],
        },
        enabled: true,
      },
      {
        id: 'rule_line',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'line',
        recipients: {
          roles: ['admin'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_admin', role: 'admin' }]);
    userFindMany.mockResolvedValue([{ id: 'user_admin', phone: '09000000000' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));

    await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_explicit'],
    });

    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();

    await runScheduledDeliveries();

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it('does not wait for external delivery promises before returning persisted notifications', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();
    const releases: Array<() => void> = [];

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: {
          user_ids: ['user_1'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([{ id: 'user_1', phone: '09000000001' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));
    sendSmsMock.mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve(undefined))),
    );

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(sendSmsMock).not.toHaveBeenCalled();

    await vi.runOnlyPendingTimersAsync();

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(releases).toHaveLength(1);
    releases.forEach((release) => release());
    await Promise.resolve();
  });

  it('logs background delivery failures without rejecting the dispatch', async () => {
    vi.useFakeTimers();
    loggerWarnMock.mockReset();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate, userFindMany } =
      createTx();

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: {
          user_ids: ['user_1'],
        },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([]);
    userFindMany.mockResolvedValue([{ id: 'user_1', phone: '09000000001' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      ...data,
    }));
    sendSmsMock.mockRejectedValue(new Error('sms unavailable'));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['user_1'],
    });

    expect(notifications).toHaveLength(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();

    await runScheduledDeliveries();

    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith('[notifications] background delivery failed', {
      failedCount: 1,
    });
  });
});
