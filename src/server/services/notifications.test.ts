import { describe, expect, it, vi } from 'vitest';
import { dispatchNotificationEvent } from './notifications';

const { sendSmsMock, sendLineMessageMock } = vi.hoisted(() => ({
  sendSmsMock: vi.fn(),
  sendLineMessageMock: vi.fn(),
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
    expect(sendSmsMock).toHaveBeenCalledTimes(2);
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      1,
      '09000000001',
      '承認待ち\n通知を確認してください',
    );
    expect(sendSmsMock).toHaveBeenNthCalledWith(
      2,
      '09000000003',
      '承認待ち\n通知を確認してください',
    );
    expect(sendLineMessageMock).not.toHaveBeenCalled();
  });

  it('routes line notifications to explicit and rule-based user ids', async () => {
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

    expect(sendLineMessageMock).toHaveBeenCalledTimes(2);
    expect(sendLineMessageMock).toHaveBeenNthCalledWith(
      1,
      'user_1',
      '折り返し依頼\n至急対応してください',
    );
    expect(sendLineMessageMock).toHaveBeenNthCalledWith(
      2,
      'user_2',
      '折り返し依頼\n至急対応してください',
    );
    expect(sendSmsMock).not.toHaveBeenCalled();
  });

  it('reuses role membership lookups across notification channels', async () => {
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
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendLineMessageMock).toHaveBeenCalledTimes(1);
  });

  it('shares pending role membership lookups across concurrent external channels', async () => {
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
    expect(sendSmsMock).toHaveBeenCalledTimes(1);
    expect(sendLineMessageMock).toHaveBeenCalledTimes(1);
  });
});
