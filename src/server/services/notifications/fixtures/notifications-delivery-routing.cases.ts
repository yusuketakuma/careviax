import { expect, it, vi } from 'vitest';
import { getNotificationTestSupport } from './notifications.test-support';

const {
  broadcastStatusUpdateMock,
  buildExternalNotificationContent,
  createTx,
  dispatchNotificationEvent,
  sendLineMessageMock,
  sendSmsMock,
  sendWebPushMock,
  setVapidDetailsMock,
  waitForAsyncAssertion,
} = getNotificationTestSupport();

export function registerNotificationDeliveryRoutingCases() {
  it('bounds concurrent notification row creation for large recipient sets', async () => {
    const originalConcurrency = process.env.NOTIFICATION_DELIVERY_CONCURRENCY;
    process.env.NOTIFICATION_DELIVERY_CONCURRENCY = '2';
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate } = createTx();
    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist' },
      { user_id: 'user_2', role: 'pharmacist' },
      { user_id: 'user_3', role: 'pharmacist' },
      { user_id: 'user_4', role: 'pharmacist' },
    ]);

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
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist' },
      { user_id: 'user_2', role: 'pharmacist' },
      { user_id: 'user_3', role: 'admin' },
    ]);
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
        where: {
          org_id: 'org_1',
          is_active: true,
          user: {
            is_active: true,
            account_status: 'active',
          },
          OR: [{ user_id: { in: ['user_1', 'user_2'] } }, { role: { in: ['admin'] } }],
        },
        select: {
          user_id: true,
          role: true,
        },
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
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
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
    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 'user_1',
        }),
      }),
    );
  });

  it('persists sms delivery intents for eligible rule recipients', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      domainEventOutboxCreateMany,
    } = createTx();

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
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist' },
      { user_id: 'user_2', role: 'pharmacist' },
      { user_id: 'user_3', role: 'admin' },
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

    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'user_1',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
        expect.objectContaining({
          aggregate_id: 'user_2',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
        expect.objectContaining({
          aggregate_id: 'user_3',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
      ]),
      skipDuplicates: true,
    });
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('persists line delivery intents for explicit and rule-based user ids', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, domainEventOutboxCreateMany } =
      createTx();

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
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist' },
      { user_id: 'user_2', role: 'pharmacist' },
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

    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'user_1',
          metadata: expect.objectContaining({ channel: 'line' }),
        }),
        expect.objectContaining({
          aggregate_id: 'user_2',
          metadata: expect.objectContaining({ channel: 'line' }),
        }),
      ]),
      skipDuplicates: true,
    });
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('keeps PHI in persisted in-app notifications while redacting external SMS and LINE bodies', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      domainEventOutboxCreateMany,
    } = createTx();

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
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
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
        title: '緊急通知',
        message: 'アプリで詳細を確認してください',
        link: '/notifications',
      }),
    ]);
    const realtimePayload = JSON.stringify(broadcastStatusUpdateMock.mock.calls[0]?.[1]);
    expect(realtimePayload).not.toContain('田中');
    expect(realtimePayload).not.toContain('一郎');
    expect(realtimePayload).not.toContain('モルヒネ');
    expect(realtimePayload).not.toContain('肺がん');

    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'user_1',
          metadata: { channel: 'sms', source_event_type: 'patient_self_report_followup_due' },
        }),
        expect.objectContaining({
          aggregate_id: 'user_1',
          metadata: { channel: 'line', source_event_type: 'patient_self_report_followup_due' },
        }),
      ]),
      skipDuplicates: true,
    });
    const externalPayloads = JSON.stringify([
      domainEventOutboxCreateMany.mock.calls,
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
    const { dispatchNotificationEvent: dispatchWithPush } = await import('../../notifications');
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      pushSubscriptionFindMany,
      domainEventOutboxCreateMany,
    } = createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));
    pushSubscriptionFindMany.mockResolvedValue([
      {
        id: 'push_subscription_1',
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
        select: { id: true },
      });
      expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            aggregate_type: 'push_subscription',
            aggregate_id: 'push_subscription_1',
            metadata: {
              channel: 'web_push',
              source_event_type: 'patient_self_report_followup_due',
              notification_type: 'urgent',
            },
          }),
        ]),
        skipDuplicates: true,
      });
      expect(sendWebPushMock).not.toHaveBeenCalled();
      const payloadJson = JSON.stringify(domainEventOutboxCreateMany.mock.calls);
      expect(payloadJson).not.toContain('田中');
      expect(payloadJson).not.toContain('一郎');
      expect(payloadJson).not.toContain('モルヒネ');
      expect(payloadJson).not.toContain('肺がん');
      // 患者 ID を含む生ディープリンクがプッシュ基盤へ漏れないことを明示的に検証する。
      expect(payloadJson).not.toContain('patient_1');
      expect(payloadJson).not.toContain('/patients/');
      expect(payloadJson).not.toContain('provider_error');
      expect(payloadJson).not.toContain('token=secret');
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
}
