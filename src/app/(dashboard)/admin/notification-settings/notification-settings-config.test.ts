// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browserNotificationMocks = vi.hoisted(() => ({
  getBrowserNotificationPreference: vi.fn(() => false),
  isBrowserNotificationSupported: vi.fn(() => false),
}));

vi.mock('@/lib/browser-notifications', () => browserNotificationMocks);

import {
  ESCALATION_ACTION_OPTIONS,
  ESCALATION_ROLE_OPTIONS,
  ESCALATION_TRIGGER_OPTIONS,
  EVENT_CONFIGS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNEL_OPTIONS,
  escalationRuleSummary,
  isPermissionSupported,
  readBrowserNotificationState,
  type EscalationRule,
} from './notification-settings-config';

describe('notification settings configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserNotificationMocks.getBrowserNotificationPreference.mockReturnValue(false);
    browserNotificationMocks.isBrowserNotificationSupported.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the supported notification channels and labels aligned', () => {
    expect(NOTIFICATION_CHANNEL_OPTIONS.map(({ value }) => value)).toEqual([
      'in_app',
      'sms',
      'line',
      'fax',
      'mcs',
    ]);
    expect(NOTIFICATION_CHANNEL_LABELS).toEqual({
      in_app: 'アプリ内',
      sms: 'SMS',
      line: 'LINE',
      fax: 'FAX',
      mcs: 'MCS',
    });
  });

  it('keeps every notification event mapped to its badge class', () => {
    expect(EVENT_CONFIGS.map(({ eventType, badge }) => ({ eventType, badge }))).toEqual([
      { eventType: 'patient_self_report_followup_due', badge: 'urgent' },
      { eventType: 'visit_schedule_reschedule_requested', badge: 'business' },
      { eventType: 'visit_schedule_reschedule_approved', badge: 'business' },
      { eventType: 'visit_intake_linkage_due', badge: 'business' },
      { eventType: 'visit_demand_created', badge: 'business' },
      { eventType: 'medication_deadline_approaching', badge: 'reminder' },
      { eventType: 'refill_due_soon', badge: 'reminder' },
      { eventType: 'management_plan_review_due', badge: 'reminder' },
    ]);
  });

  it('keeps escalation notification roles explicit', () => {
    expect(ESCALATION_ROLE_OPTIONS).toEqual([
      { value: 'admin', label: '管理者' },
      { value: 'manager', label: 'マネージャー' },
      { value: 'pharmacist', label: '薬剤師' },
      { value: 'office_staff', label: '事務' },
    ]);
  });

  it('keeps every escalation trigger and action label explicit', () => {
    expect(ESCALATION_TRIGGER_OPTIONS.map(({ value, label }) => ({ value, label }))).toEqual([
      { value: 'communication_response_overdue', label: '連携返信期限超過' },
      { value: 'workflow_exception_unresolved', label: 'WorkflowException 未解消' },
      { value: 'report_delivery_failed', label: '報告書送付失敗' },
      { value: 'billing_review_stalled', label: '請求レビュー停滞' },
      { value: 'visit_reschedule_unapproved', label: '訪問変更承認待ち' },
    ]);
    expect(ESCALATION_ACTION_OPTIONS).toEqual([
      { value: 'in_app_notification', label: 'アプリ内通知' },
      { value: 'email_digest', label: 'メール通知' },
      { value: 'conference_task', label: 'タスク起票' },
      { value: 'admin_alert', label: '管理者アラート' },
    ]);
  });

  it('summarizes escalation values without dropping nullable fields or the threshold', () => {
    const knownRule: EscalationRule = {
      id: 'rule_1',
      trigger_type: 'communication_response_overdue',
      action: 'in_app_notification',
      notify_role: 'admin',
      condition: { threshold_hours: 24 },
      is_active: true,
      created_at: '2026-07-22T00:00:00.000Z',
    };
    const nullableRule: EscalationRule = {
      ...knownRule,
      notify_role: null,
      condition: null,
    };

    expect(escalationRuleSummary(knownRule)).toBe(
      '連携返信期限超過 / アプリ内通知 / 管理者 / 24時間',
    );
    expect(escalationRuleSummary(nullableRule)).toBe(
      '連携返信期限超過 / アプリ内通知 / 通知先未指定 / 未設定時間',
    );
  });

  it('does not read browser permission or preference when notifications are unsupported', () => {
    expect(isPermissionSupported()).toBe(false);
    expect(readBrowserNotificationState()).toEqual({ permission: 'unsupported', enabled: false });
    expect(browserNotificationMocks.getBrowserNotificationPreference).not.toHaveBeenCalled();
  });

  it('reads browser permission and preference only after support is confirmed', () => {
    browserNotificationMocks.isBrowserNotificationSupported.mockReturnValue(true);
    browserNotificationMocks.getBrowserNotificationPreference.mockReturnValue(true);
    vi.stubGlobal('Notification', { permission: 'granted' });

    expect(readBrowserNotificationState()).toEqual({ permission: 'granted', enabled: true });
    expect(browserNotificationMocks.getBrowserNotificationPreference).toHaveBeenCalledOnce();
  });
});
