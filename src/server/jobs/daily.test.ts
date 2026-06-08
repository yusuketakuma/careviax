import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionIntakeFindManyMock,
  pcaPumpRentalFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleContactLogFindManyMock,
  conferenceNoteFindManyMock,
  careCaseFindManyMock,
  membershipFindManyMock,
  notificationCreateMock,
  dispatchNotificationEventMock,
  taskFindManyMock,
  qrScanDraftFindManyMock,
  qrScanDraftUpdateManyMock,
  jahisSupplementalRecordDeleteManyMock,
  upsertOperationalTaskMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  prescriptionIntakeFindManyMock: vi.fn(),
  pcaPumpRentalFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleContactLogFindManyMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  qrScanDraftFindManyMock: vi.fn(),
  qrScanDraftUpdateManyMock: vi.fn(),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    pcaPumpRental: {
      findMany: pcaPumpRentalFindManyMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    visitScheduleContactLog: {
      findMany: visitScheduleContactLogFindManyMock,
    },
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
    notification: {
      create: notificationCreateMock,
    },
    task: {
      findMany: taskFindManyMock,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    qrScanDraft: {
      findMany: qrScanDraftFindManyMock,
      updateMany: qrScanDraftUpdateManyMock,
    },
    jahisSupplementalRecord: {
      deleteMany: jahisSupplementalRecordDeleteManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

vi.mock('@/server/services/visit-schedule-planner', () => ({
  generateVisitScheduleProposalDrafts: vi.fn(),
}));

vi.mock('@/server/services/management-plans', () => ({
  scheduleManagementPlanReviewAlert: vi.fn(),
  formatVisitWorkflowGateIssues: vi.fn(),
  parseVisitWorkflowGateErrorMessage: vi.fn((message: string) =>
    message
      .replace('VISIT_WORKFLOW_GATE:', '')
      .split(',')
      .filter((issue) =>
        [
          'missing_visit_consent',
          'missing_management_plan',
          'management_plan_review_overdue',
        ].includes(issue),
      ),
  ),
  VISIT_WORKFLOW_GATE_ERROR_PREFIX: 'VISIT_WORKFLOW_GATE:',
}));

vi.mock('@/server/services/notifications', () => ({
  dispatchNotificationEvent: dispatchNotificationEventMock,
}));

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: vi.fn(),
  evaluateInitialHomeVisitAssessmentRequirement: vi.fn(),
}));

import { evaluateInitialHomeVisitAssessmentRequirement } from '@/server/services/billing-evidence';
import {
  checkCallbackFollowups,
  checkConferenceMeetingReminders,
  checkInitialHomeVisitAssessmentBacklog,
  checkPcaPumpRentalOverdues,
  cleanupAbandonedQrDrafts,
  cleanupTerminalQrDraftPayloads,
} from './daily';
import { checkPrescriptionOriginalRetention } from './daily-prescription-original-retention';

describe('checkPcaPumpRentalOverdues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks due active rentals overdue and creates follow-up tasks', async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const today = new Date(2026, 5, 8);
    pcaPumpRentalFindManyMock.mockResolvedValue([
      {
        id: 'rental_1',
        org_id: 'org_1',
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: new Date('2026-05-20T00:00:00.000Z'),
        due_at: new Date('2026-06-01T00:00:00.000Z'),
        rental_fee_yen: 12000,
        pump: {
          asset_code: 'PCA-001',
          model_name: 'CADD Legacy',
        },
        institution: {
          name: 'サンプル在宅クリニック',
        },
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pcaPumpRental: {
          updateMany: updateManyMock,
        },
        task: {
          upsert: vi.fn(),
        },
      }),
    );

    const result = await checkPcaPumpRentalOverdues({ orgId: 'org_1' });

    expect(result).toEqual({ processedCount: 1 });
    expect(runJobMock).toHaveBeenCalledWith(
      'pca_pump_rental_overdue_check',
      expect.any(Function),
      'org_1',
    );
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['scheduled', 'active'] },
          due_at: { lt: today },
        }),
      }),
    );
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'rental_1',
        org_id: 'org_1',
        status: { in: ['scheduled', 'active'] },
        due_at: { lt: today },
      },
      data: {
        status: 'overdue',
      },
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'pca_pump_rental_overdue',
        title: 'PCAポンプの返却期限を超過しています',
        priority: 'urgent',
        relatedEntityType: 'pca_pump_rental',
        relatedEntityId: 'rental_1',
        dedupeKey: 'pca-pump-rental-overdue:rental_1',
        metadata: expect.objectContaining({
          rental_id: 'rental_1',
          pump_id: 'pump_1',
          pump_asset_code: 'PCA-001',
          institution_id: 'institution_1',
          institution_name: 'サンプル在宅クリニック',
          due_at: '2026-06-01',
          overdue_days: 7,
          action_href: '/admin/pca-pumps',
        }),
      }),
    );
  });

  it('does not mutate when no PCA rentals are past due', async () => {
    pcaPumpRentalFindManyMock.mockResolvedValue([]);

    const result = await checkPcaPumpRentalOverdues();

    expect(result).toEqual({ processedCount: 0 });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });
});

describe('checkPrescriptionOriginalRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));
    membershipFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        user_id: 'admin_1',
      },
    ]);
    notificationCreateMock.mockResolvedValue({});
    taskFindManyMock.mockResolvedValue([]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates callback follow-up tasks from overdue contact logs', async () => {
    visitScheduleContactLogFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        proposal_id: 'proposal_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        note: '不在のため折り返し待ち',
        callback_due_at: new Date('2026-03-27T12:00:00.000Z'),
        proposal: {
          proposed_pharmacist_id: 'pharmacist_1',
          case_id: 'case_1',
        },
      },
    ]);

    const result = await checkCallbackFollowups();

    expect(result).toMatchObject({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'visit_contact_followup',
        title: '患者への再架電が必要です',
        description: '不在のため折り返し待ち',
        assignedTo: 'pharmacist_1',
        relatedEntityType: 'visit_schedule_proposal',
        relatedEntityId: 'proposal_1',
        dedupeKey: 'visit-contact-followup:proposal_1',
        metadata: {
          case_id: 'case_1',
          patient_id: 'patient_1',
        },
      }),
    );
  });

  it('creates overdue fax original follow-up tasks and notifications', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'intake_fax_1',
        org_id: 'org_1',
        source_type: 'fax',
        created_at: new Date('2026-03-24T09:00:00.000Z'),
        original_collected_at: null,
        cycle: {
          patient_id: 'patient_1',
          case_: {
            patient_id: 'patient_1',
            primary_pharmacist_id: 'pharmacist_1',
            patient: {
              name: '山田 太郎',
            },
          },
        },
      },
    ]);

    const result = await checkPrescriptionOriginalRetention();

    expect(result).toMatchObject({ processedCount: 2 });
    expect(notificationCreateMock).toHaveBeenCalledTimes(2);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'fax_original_followup',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_fax_1',
        dedupeKey: 'fax-original-followup:intake_fax_1',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          patient_name: '山田 太郎',
          action_href: '/patients/patient_1/prescriptions',
        }),
      }),
    );
  });

  it('clears stale fax follow-up tasks when nothing is overdue', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    taskFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        task_type: 'fax_original_followup',
        dedupe_key: 'fax-original-followup:stale',
      },
    ]);

    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        task: {
          updateMany: updateManyMock,
        },
      }),
    );

    const result = await checkPrescriptionOriginalRetention();

    expect(result).toMatchObject({ processedCount: 0 });
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          task_type: 'fax_original_followup',
        }),
        data: expect.objectContaining({
          status: 'completed',
        }),
      }),
    );
  });

  it('creates pre-visit initial assessment tasks and notifications for first-claim schedules', async () => {
    vi.mocked(evaluateInitialHomeVisitAssessmentRequirement).mockResolvedValue({
      required: true,
      satisfied: false,
      initialVisitRecordId: null,
      reason: '初回算定月のため、初回訪問前日までの患家訪問・環境聴取記録が必要です',
    });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        org_id: 'org_1',
        scheduled_date: new Date('2026-03-29T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_1',
        case_: {
          patient_id: 'patient_1',
          patient: {
            name: '山田 太郎',
          },
        },
      },
    ]);

    const result = await checkInitialHomeVisitAssessmentBacklog();

    expect(result).toMatchObject({ processedCount: 2 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'initial_home_visit_assessment',
        relatedEntityType: 'visit_schedule',
        relatedEntityId: 'schedule_1',
        dedupeKey: 'initial-home-visit-assessment:schedule_1',
        metadata: {
          patient_id: 'patient_1',
          patient_name: '山田 太郎',
          schedule_id: 'schedule_1',
          action_href: '/patients/patient_1',
          action_label: '患者記録を確認',
        },
      }),
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'billing_initial_assessment_due',
        explicitUserIds: ['pharmacist_1'],
        metadata: {
          patient_id: 'patient_1',
          schedule_id: 'schedule_1',
        },
      }),
    );
  });
});

describe('cleanupAbandonedQrDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards stale QR drafts and removes unconfirmed supplemental records', async () => {
    qrScanDraftFindManyMock.mockResolvedValue([{ id: 'draft_1' }, { id: 'draft_2' }]);
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 2 });
    jahisSupplementalRecordDeleteManyMock.mockResolvedValue({ count: 3 });

    const result = await cleanupAbandonedQrDrafts();

    expect(result).toEqual({ processedCount: 2 });
    expect(qrScanDraftFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'pending' }),
        select: { id: true },
      }),
    );
    expect(qrScanDraftUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['draft_1', 'draft_2'] } },
      data: expect.objectContaining({
        status: 'discarded',
        raw_qr_texts: [],
        qr_payload_hash: null,
        parsed_data: expect.objectContaining({
          discarded: true,
          discarded_by: 'cleanup_abandoned_qr_drafts',
        }),
        expected_qr_count: null,
      }),
    });
    expect(jahisSupplementalRecordDeleteManyMock).toHaveBeenCalledWith({
      where: {
        qr_draft_id: { in: ['draft_1', 'draft_2'] },
        prescription_intake_id: null,
      },
    });
  });

  it('does not update or delete when no stale QR drafts exist', async () => {
    qrScanDraftFindManyMock.mockResolvedValue([]);

    const result = await cleanupAbandonedQrDrafts();

    expect(result).toEqual({ processedCount: 0 });
    expect(qrScanDraftUpdateManyMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe('cleanupTerminalQrDraftPayloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrubs raw QR payloads from all terminal QR drafts', async () => {
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 7 });

    const result = await cleanupTerminalQrDraftPayloads();

    expect(result).toEqual({ processedCount: 7 });
    expect(qrScanDraftUpdateManyMock).toHaveBeenCalledWith({
      where: {
        status: { in: ['confirmed', 'discarded'] },
      },
      data: expect.objectContaining({
        raw_qr_texts: [],
        qr_payload_hash: null,
        parsed_data: expect.objectContaining({
          scrubbed: true,
          scrubbed_by: 'cleanup_terminal_qr_draft_payloads',
          scrubbed_at: '2026-04-21T12:00:00.000Z',
        }),
        expected_qr_count: null,
      }),
    });
  });
});

describe('checkConferenceMeetingReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
    conferenceNoteFindManyMock.mockResolvedValue([
      {
        id: 'note_service_1',
        org_id: 'org_1',
        case_id: 'case_1',
        title: '担当者会議',
        structured_content: {
          sections: [
            { key: 'meeting_purpose', label: '会議目的', body: '訪問頻度の見直し' },
            { key: 'next_meeting_date', label: '次回会議日', body: '2026-03-31' },
          ],
        },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        patient: {
          name: '山田 太郎',
        },
      },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dispatches reminders for service_manager conferences with a next meeting scheduled for tomorrow', async () => {
    const result = await checkConferenceMeetingReminders();

    expect(result).toMatchObject({ processedCount: 1 });
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'conference_next_meeting_due',
        explicitUserIds: ['pharmacist_1'],
        dedupeKey: 'conference-next-meeting:note_service_1:2026-03-31',
      }),
    );
  });
});
