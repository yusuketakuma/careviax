import type { NotificationType } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { getNotificationTestSupport } from './notifications.test-support';

const {
  createTx,
  dispatchNotificationEvent,
  loggerWarnMock,
  sendLineMessageMock,
  sendSmsMock,
  sendWebPushMock,
  setVapidDetailsMock,
} = getNotificationTestSupport();

export function registerNotificationDurableDeliveryCases() {
  it('normalizes unsafe future notification types before Web Push dispatch', async () => {
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
        type: 'patient_specific_future_type' as NotificationType,
        title: '田中 一郎さんの麻薬管理確認',
        message: 'モルヒネ残薬と肺がん疼痛について確認してください',
        link: '/patients/patient_1',
        explicitUserIds: ['user_1'],
      });

      expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            aggregate_type: 'push_subscription',
            aggregate_id: 'push_subscription_1',
            metadata: expect.objectContaining({
              channel: 'web_push',
              notification_type: 'system',
            }),
          }),
        ]),
        skipDuplicates: true,
      });
      expect(sendWebPushMock).not.toHaveBeenCalled();
      const payloadJson = JSON.stringify(domainEventOutboxCreateMany.mock.calls);
      expect(payloadJson).not.toContain('patient_specific_future_type');
      expect(payloadJson).not.toContain('田中');
      expect(payloadJson).not.toContain('一郎');
      expect(payloadJson).not.toContain('モルヒネ');
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
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      domainEventOutboxCreateMany,
    } = createTx();

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
    expect(membershipFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        is_active: true,
        user: {
          is_active: true,
          account_status: 'active',
        },
        OR: [{ role: { in: ['admin'] } }],
      },
      select: {
        user_id: true,
        role: true,
      },
    });
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();

    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'user_admin',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
        expect.objectContaining({
          aggregate_id: 'user_admin',
          metadata: expect.objectContaining({ channel: 'line' }),
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('uses one membership snapshot for direct and role recipients across channels', async () => {
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
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_explicit', role: 'pharmacist' },
      { user_id: 'user_admin', role: 'admin' },
    ]);
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

    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'user_admin',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
        expect.objectContaining({
          aggregate_id: 'user_admin',
          metadata: expect.objectContaining({ channel: 'line' }),
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('persists external intents without starting provider requests in the mutation transaction', async () => {
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
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
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
    expect(sendSmsMock).not.toHaveBeenCalled();

    expect(domainEventOutboxCreateMany).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('leaves provider result handling to the durable worker', async () => {
    vi.useFakeTimers();
    loggerWarnMock.mockReset();
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
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
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
    expect(loggerWarnMock).not.toHaveBeenCalled();

    expect(domainEventOutboxCreateMany).toHaveBeenCalledTimes(1);
    expect(sendSmsMock).not.toHaveBeenCalled();
  });
}
