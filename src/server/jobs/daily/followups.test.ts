import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  managementPlanFindManyMock,
  residenceFindManyMock,
  patientSelfReportFindManyMock,
  patientFindManyMock,
  communityActivityFindManyMock,
  scheduleManagementPlanReviewAlertMock,
  dispatchNotificationEventMock,
  upsertOperationalTaskMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  managementPlanFindManyMock: vi.fn(),
  residenceFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  communityActivityFindManyMock: vi.fn(),
  scheduleManagementPlanReviewAlertMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    managementPlan: { findMany: managementPlanFindManyMock },
    visitScheduleContactLog: { findMany: vi.fn() },
    residence: { findMany: residenceFindManyMock },
    patientSelfReport: { findMany: patientSelfReportFindManyMock },
    patient: { findMany: patientFindManyMock },
    communityActivity: { findMany: communityActivityFindManyMock },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  scheduleManagementPlanReviewAlert: scheduleManagementPlanReviewAlertMock,
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('@/server/services/visit-schedule-communication', () => ({
  buildVisitScheduleContactFollowupTask: vi.fn(),
}));

import {
  checkCommunityFollowups,
  checkManagementPlanReviews,
  checkResidenceGeocodeQuality,
  checkSelfReportFollowups,
} from './followups';

beforeEach(() => {
  vi.clearAllMocks();
  runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
  // 各 withOrgContext 呼び出しは対象行自身の org_id で fn(tx) を実行する。
  // どの org_id が渡されたかをテスト側で検証できるよう tx に埋め込む。
  withOrgContextMock.mockImplementation(
    async (orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({ orgId }),
  );
});

describe('checkManagementPlanReviews', () => {
  it('schedules each review alert inside its own plan org context (no cross-org bleed)', async () => {
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_a',
        org_id: 'org_a',
        case_id: 'case_a',
        next_review_date: new Date('2026-07-01T00:00:00.000Z'),
        case_: { patient_id: 'patient_a', primary_pharmacist_id: 'pharmacist_a' },
      },
      {
        id: 'plan_b',
        org_id: 'org_b',
        case_id: 'case_b',
        next_review_date: new Date('2026-06-20T00:00:00.000Z'),
        case_: { patient_id: 'patient_b', primary_pharmacist_id: 'pharmacist_b' },
      },
    ]);

    const result = await checkManagementPlanReviews();

    expect(result).toEqual({ processedCount: 2 });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_a', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_b', expect.any(Function));

    expect(scheduleManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({
        orgId: 'org_a',
        planId: 'plan_a',
        caseId: 'case_a',
        patientId: 'patient_a',
        assignedTo: 'pharmacist_a',
      }),
    );
    expect(scheduleManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({
        orgId: 'org_b',
        planId: 'plan_b',
        caseId: 'case_b',
        patientId: 'patient_b',
        assignedTo: 'pharmacist_b',
      }),
    );
    // org_a のプランを org_b のコンテキストで処理していないこと。
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({ planId: 'plan_a' }),
    );
  });

  it('counts a plan without a next_review_date but does not schedule an alert for it (boundary)', async () => {
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_no_date',
        org_id: 'org_a',
        case_id: 'case_a',
        next_review_date: null,
        case_: { patient_id: 'patient_a', primary_pharmacist_id: 'pharmacist_a' },
      },
    ]);

    const result = await checkManagementPlanReviews();

    expect(result).toEqual({ processedCount: 1 });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(scheduleManagementPlanReviewAlertMock).not.toHaveBeenCalled();
  });

  it('falls back to a null assignee when the case has no primary pharmacist', async () => {
    managementPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_a',
        org_id: 'org_a',
        case_id: 'case_a',
        next_review_date: new Date('2026-07-01T00:00:00.000Z'),
        case_: { patient_id: 'patient_a', primary_pharmacist_id: null },
      },
    ]);

    await checkManagementPlanReviews();

    expect(scheduleManagementPlanReviewAlertMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedTo: null }),
    );
  });
});

describe('checkResidenceGeocodeQuality', () => {
  it('creates a geocode review task per residence, scoped to the residence org, assigned to the org-matching active case pharmacist', async () => {
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_a',
        org_id: 'org_a',
        patient: {
          id: 'patient_a',
          cases: [{ id: 'case_a', primary_pharmacist_id: 'pharmacist_a' }],
        },
      },
      {
        id: 'residence_b',
        org_id: 'org_b',
        patient: {
          id: 'patient_b',
          cases: [{ id: 'case_b', primary_pharmacist_id: 'pharmacist_b' }],
        },
      },
    ]);

    const result = await checkResidenceGeocodeQuality();

    expect(result).toEqual({ processedCount: 2 });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_a', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_b', expect.any(Function));

    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({
        orgId: 'org_a',
        taskType: 'geocode_review',
        assignedTo: 'pharmacist_a',
        relatedEntityId: 'patient_a',
        dedupeKey: 'geocode-review:patient_a',
        metadata: { residence_id: 'residence_a', case_id: 'case_a' },
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({
        orgId: 'org_b',
        assignedTo: 'pharmacist_b',
        relatedEntityId: 'patient_b',
        dedupeKey: 'geocode-review:patient_b',
      }),
    );
  });

  it('falls back to a null assignee and case_id when the patient has no active case (boundary)', async () => {
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_a',
        org_id: 'org_a',
        patient: { id: 'patient_a', cases: [] },
      },
    ]);

    const result = await checkResidenceGeocodeQuality();

    expect(result).toEqual({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        assignedTo: null,
        metadata: { residence_id: 'residence_a', case_id: null },
      }),
    );
  });
});

describe('checkSelfReportFollowups', () => {
  it('only dispatches a notification to the report org own active-case pharmacist (multi-org, no cross-org recipient)', async () => {
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_a',
        org_id: 'org_a',
        patient_id: 'patient_a',
        subject: '体調不良',
        preferred_contact_time: null,
        requested_callback: false,
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
      {
        id: 'report_b',
        org_id: 'org_b',
        patient_id: 'patient_b',
        subject: '薬の飲み忘れ',
        preferred_contact_time: null,
        requested_callback: false,
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_a',
        name: '山田 太郎',
        cases: [{ id: 'case_a', primary_pharmacist_id: 'pharmacist_a' }],
      },
      {
        id: 'patient_b',
        name: '佐藤 花子',
        cases: [{ id: 'case_b', primary_pharmacist_id: 'pharmacist_b' }],
      },
    ]);

    const result = await checkSelfReportFollowups();

    expect(result).toEqual({ processedCount: 2 });

    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({ orgId: 'org_a', explicitUserIds: ['pharmacist_a'] }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({ orgId: 'org_b', explicitUserIds: ['pharmacist_b'] }),
    );
    // org_a の報告に対して org_b の薬剤師へ通知していないこと。
    expect(dispatchNotificationEventMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_a', explicitUserIds: ['pharmacist_b'] }),
    );
  });

  it('skips notification dispatch (but still creates the task) when there is no active-case pharmacist', async () => {
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_a',
        org_id: 'org_a',
        patient_id: 'patient_a',
        subject: '体調不良',
        preferred_contact_time: null,
        requested_callback: false,
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_a', name: '山田 太郎', cases: [] }]);

    const result = await checkSelfReportFollowups();

    expect(result).toEqual({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({ assignedTo: null }),
    );
    expect(dispatchNotificationEventMock).not.toHaveBeenCalled();
  });

  it('sets a 1-day due date when a callback was requested and 2 days otherwise (boundary)', async () => {
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_callback',
        org_id: 'org_a',
        patient_id: 'patient_a',
        subject: '緊急の相談',
        preferred_contact_time: null,
        requested_callback: true,
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
      {
        id: 'report_no_callback',
        org_id: 'org_a',
        patient_id: 'patient_a',
        subject: '通常の相談',
        preferred_contact_time: null,
        requested_callback: false,
        created_at: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_a',
        name: '山田 太郎',
        cases: [{ id: 'case_a', primary_pharmacist_id: 'p_a' }],
      },
    ]);

    await checkSelfReportFollowups();

    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relatedEntityId: 'report_callback',
        priority: 'urgent',
        dueDate: new Date('2026-06-02T00:00:00.000Z'),
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        relatedEntityId: 'report_no_callback',
        priority: 'high',
        dueDate: new Date('2026-06-03T00:00:00.000Z'),
      }),
    );
  });
});

describe('checkCommunityFollowups', () => {
  it('creates follow-up tasks per activity org with a due date 7 days after the activity date (org scope + boundary)', async () => {
    communityActivityFindManyMock.mockResolvedValue([
      {
        id: 'activity_a',
        org_id: 'org_a',
        title: '地域包括ケア会議',
        outcome_summary: null,
        partner_name: '〇〇地域包括支援センター',
        activity_type: 'meeting',
        activity_date: new Date('2026-06-01T00:00:00.000Z'),
        referrals_generated: 0,
        created_by: 'staff_a',
      },
      {
        id: 'activity_b',
        org_id: 'org_b',
        title: '施設連携訪問',
        outcome_summary: '紹介患者あり',
        partner_name: null,
        activity_type: 'visit',
        activity_date: new Date('2026-06-05T00:00:00.000Z'),
        referrals_generated: 2,
        created_by: 'staff_b',
      },
    ]);

    const result = await checkCommunityFollowups();

    expect(result).toEqual({ processedCount: 2 });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_a', expect.any(Function));
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_b', expect.any(Function));

    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      { orgId: 'org_a' },
      expect.objectContaining({
        orgId: 'org_a',
        priority: 'normal',
        assignedTo: 'staff_a',
        dueDate: new Date('2026-06-08T00:00:00.000Z'),
        dedupeKey: 'community-activity-followup:activity_a',
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      { orgId: 'org_b' },
      expect.objectContaining({
        orgId: 'org_b',
        priority: 'high',
        assignedTo: 'staff_b',
        dueDate: new Date('2026-06-12T00:00:00.000Z'),
        dedupeKey: 'community-activity-followup:activity_b',
      }),
    );
  });
});
