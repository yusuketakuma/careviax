import { expect, it, vi } from 'vitest';
import { getNotificationTestSupport } from './notifications.test-support';

const {
  createTx,
  broadcastStatusUpdateMock,
  loggerWarnMock,
  sendSmsMock,
  sendLineMessageMock,
  dispatchNotificationEvent,
} = getNotificationTestSupport();

export function registerNotificationCoreCases() {
  it('delivers to explicit users when no notification rules exist', async () => {
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate } = createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: 'notification_1',
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      metadata: { token: 'raw-token-secret' },
      provider_error: 'storage_key=org_1/patients/patient_1/reports/report_1.pdf',
      token: 'raw-token-secret',
      storage_key: 'org_1/patients/patient_1/reports/report_1.pdf',
      signed_url: 'https://s3.example.test/file?X-Amz-Signature=secret',
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
        title: '業務通知',
        message: 'アプリで詳細を確認してください',
        link: '/notifications',
        is_read: false,
        created_at: '2026-06-17T00:00:00.000Z',
      },
    ]);
    expect(JSON.stringify(broadcastStatusUpdateMock.mock.calls[0]?.[1])).not.toContain(
      'dedupe_key',
    );
    const broadcastPayload = JSON.stringify(broadcastStatusUpdateMock.mock.calls[0]?.[1]);
    for (const forbidden of [
      'metadata',
      'provider_error',
      'raw-token-secret',
      'storage_key',
      'signed_url',
      'X-Amz-Signature',
      '承認待ち',
    ]) {
      expect(broadcastPayload).not.toContain(forbidden);
    }
  });

  it('logs a safe warning when realtime broadcast fails without rejecting persisted notifications', async () => {
    loggerWarnMock.mockReset();
    const rawError = 'realtime failed for 患者A token=secret notification body';
    const { tx, notificationRuleFindMany, membershipFindMany, notificationCreate } = createTx();

    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
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
    membershipFindMany.mockResolvedValue([
      { user_id: 'user_1', role: 'pharmacist' },
      { user_id: 'user_2', role: 'pharmacist' },
      { user_id: 'user_3', role: 'admin' },
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
      explicitUserIds: ['user_1', 'user_2', 'user_3'],
    });

    expect(notifications).toHaveLength(3);
    expect(notificationCreate).toHaveBeenCalledTimes(3);
    const userIds = notificationCreate.mock.calls.map(
      ([args]) => (args as { data: { user_id: string } }).data.user_id,
    );
    expect(userIds).toEqual(['user_1', 'user_2', 'user_3']);
  });

  it('filters invalid direct recipients from in-app and external delivery while keeping valid members', async () => {
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
    const configuredUserIds = [
      'valid_rule',
      'cross_org',
      'inactive_membership',
      'inactive_user',
      'suspended_user',
      'orphan_user',
    ];

    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_in_app',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'in_app',
        recipients: { user_ids: configuredUserIds },
        enabled: true,
      },
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: { user_ids: configuredUserIds },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([
      { user_id: 'valid_explicit', role: 'pharmacist' },
      { user_id: 'valid_rule', role: 'admin' },
    ]);
    notificationCreate.mockImplementation(async ({ data }) => ({
      id: `notification_${data.user_id as string}`,
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      is_read: false,
      ...data,
    }));

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['valid_explicit', 'cross_org', 'inactive_membership'],
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
        OR: [
          {
            user_id: {
              in: [
                'valid_explicit',
                'cross_org',
                'inactive_membership',
                'valid_rule',
                'inactive_user',
                'suspended_user',
                'orphan_user',
              ],
            },
          },
        ],
      },
      select: { user_id: true, role: true },
    });
    expect(notifications).toHaveLength(2);
    expect(
      notificationCreate.mock.calls.map(
        ([args]) => (args as { data: { user_id: string } }).data.user_id,
      ),
    ).toEqual(['valid_explicit', 'valid_rule']);
    expect(broadcastStatusUpdateMock).toHaveBeenCalledTimes(2);
    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          aggregate_id: 'valid_explicit',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
        expect.objectContaining({
          aggregate_id: 'valid_rule',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
      ]),
      skipDuplicates: true,
    });
    const serializedSideEffects = JSON.stringify([
      notificationCreate.mock.calls,
      broadcastStatusUpdateMock.mock.calls,
      domainEventOutboxCreateMany.mock.calls,
    ]);
    for (const invalidUserId of [
      'cross_org',
      'inactive_membership',
      'inactive_user',
      'suspended_user',
      'orphan_user',
    ]) {
      expect(serializedSideEffects).not.toContain(invalidUserId);
    }
  });

  it('returns no notifications or delivery side effects when every candidate lacks eligibility', async () => {
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      notificationUpsert,
      pushSubscriptionFindMany,
      userFindMany,
    } = createTx();
    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([]);

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
      explicitUserIds: ['other_org_user'],
    });

    expect(notifications).toEqual([]);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationUpsert).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    expect(pushSubscriptionFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('keeps fax and mcs rules delivery-free while resolving their recipients through membership', async () => {
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      notificationUpsert,
      userFindMany,
    } = createTx();
    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_fax',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'fax',
        recipients: { user_ids: ['valid_user', 'invalid_user'] },
        enabled: true,
      },
      {
        id: 'rule_mcs',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'mcs',
        recipients: { user_ids: ['valid_user', 'invalid_user'] },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'valid_user', role: 'pharmacist' }]);

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
    });

    expect(notifications).toEqual([]);
    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationUpsert).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('fails closed before notification side effects when membership eligibility lookup fails', async () => {
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      notificationUpsert,
      pushSubscriptionFindMany,
      userFindMany,
    } = createTx();
    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockRejectedValue(new Error('membership lookup failed'));

    await expect(
      dispatchNotificationEvent(tx, {
        orgId: 'org_1',
        eventType: 'patient_self_report_followup_due',
        type: 'urgent',
        title: '折り返し依頼',
        message: '至急対応してください',
        explicitUserIds: ['user_1'],
      }),
    ).rejects.toThrow('membership lookup failed');

    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationUpsert).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    expect(pushSubscriptionFindMany).not.toHaveBeenCalled();
    expect(userFindMany).not.toHaveBeenCalled();
    expect(sendSmsMock).not.toHaveBeenCalled();
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('uses same-org membership instead of legacy User.org_id for multi-org external delivery', async () => {
    vi.useFakeTimers();
    sendSmsMock.mockReset();
    sendLineMessageMock.mockReset();
    const { tx, notificationRuleFindMany, membershipFindMany, domainEventOutboxCreateMany } =
      createTx();
    notificationRuleFindMany.mockResolvedValue([
      {
        id: 'rule_sms',
        org_id: 'org_1',
        event_type: 'patient_self_report_followup_due',
        channel: 'sms',
        recipients: { user_ids: ['multi_org_user'] },
        enabled: true,
      },
    ]);
    membershipFindMany.mockResolvedValue([{ user_id: 'multi_org_user', role: 'pharmacist' }]);

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'patient_self_report_followup_due',
      type: 'urgent',
      title: '折り返し依頼',
      message: '至急対応してください',
    });

    expect(notifications).toEqual([]);
    expect(domainEventOutboxCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          aggregate_id: 'multi_org_user',
          metadata: expect.objectContaining({ channel: 'sms' }),
        }),
      ],
      skipDuplicates: true,
    });
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('preserves dedupe-key upsert semantics after recipient eligibility filtering', async () => {
    const {
      tx,
      notificationRuleFindMany,
      membershipFindMany,
      notificationCreate,
      notificationUpsert,
    } = createTx();
    notificationRuleFindMany.mockResolvedValue([]);
    membershipFindMany.mockResolvedValue([{ user_id: 'user_1', role: 'pharmacist' }]);
    notificationUpsert.mockResolvedValue({
      id: 'notification_1',
      user_id: 'user_1',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      link: null,
    });

    const notifications = await dispatchNotificationEvent(tx, {
      orgId: 'org_1',
      eventType: 'visit_schedule_reschedule_requested',
      type: 'business',
      title: '承認待ち',
      message: '通知を確認してください',
      explicitUserIds: ['user_1'],
      dedupeKey: 'visit_schedule:1',
    });

    expect(notifications).toHaveLength(1);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(notificationUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_user_id_dedupe_key: {
            org_id: 'org_1',
            user_id: 'user_1',
            dedupe_key: 'visit_schedule:1',
          },
        },
      }),
    );
  });
}
