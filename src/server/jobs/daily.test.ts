import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionIntakeFindManyMock,
  pcaPumpRentalFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleContactLogFindManyMock,
  businessHolidayFindManyMock,
  pharmacistShiftFindManyMock,
  conferenceNoteFindManyMock,
  careCaseFindManyMock,
  careCaseFindFirstMock,
  visitRecordFindManyMock,
  patientFindManyMock,
  membershipFindManyMock,
  firstVisitDocumentFindManyMock,
  patientSelfReportFindManyMock,
  inquiryRecordFindManyMock,
  facilityStandardRegistrationFindManyMock,
  consentRecordFindManyMock,
  patientInsuranceFindManyMock,
  medicationCycleFindManyMock,
  pharmacistCredentialFindManyMock,
  notificationCreateMock,
  notificationCreateManyMock,
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
  businessHolidayFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  firstVisitDocumentFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  inquiryRecordFindManyMock: vi.fn(),
  facilityStandardRegistrationFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  pharmacistCredentialFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  qrScanDraftFindManyMock: vi.fn(),
  qrScanDraftUpdateManyMock: vi.fn(),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
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
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
      findFirst: careCaseFindFirstMock,
    },
    firstVisitDocument: {
      findMany: firstVisitDocumentFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
    facilityStandardRegistration: {
      findMany: facilityStandardRegistrationFindManyMock,
    },
    consentRecord: {
      findMany: consentRecordFindManyMock,
    },
    patientInsurance: {
      findMany: patientInsuranceFindManyMock,
    },
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
    },
    pharmacistCredential: {
      findMany: pharmacistCredentialFindManyMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
    notification: {
      create: notificationCreateMock,
      createMany: notificationCreateManyMock,
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
  checkConsentExpiry,
  checkPublicSubsidyExpiry,
  checkConferenceMeetingReminders,
  checkEmergencyCoverageGaps,
  checkFacilityStandardExpiry,
  checkCredentialExpiry,
  checkInitialHomeVisitAssessmentBacklog,
  checkPcaPumpReturnInspectionPending,
  checkPcaPumpRentalOverdues,
  checkPrescriptionExpiry,
  generateVisitDemands,
  checkVisitRecordRetention,
  cleanupAbandonedQrDrafts,
  cleanupTerminalQrDraftPayloads,
  runDailyOperationTasks,
  syncVisitSupportFeatureTasks,
} from './daily';
import { checkPrescriptionOriginalRetention } from './daily-prescription-original-retention';
import { generateVisitScheduleProposalDrafts } from '@/server/services/visit-schedule-planner';

function useTimezone(timezone: string) {
  const originalTimezone = process.env.TZ;
  process.env.TZ = timezone;
  return () => {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  };
}

describe('runDailyOperationTasks', () => {
  it('limits active task concurrency and preserves settled results', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const releases: Array<() => void> = [];
    const flushMicrotasks = async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    };
    const makeTask = (processedCount: number, reject = false) =>
      vi.fn(async () => {
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise<void>((resolve) => releases.push(resolve));
        activeCount -= 1;
        if (reject) throw new Error(`task_${processedCount}_failed`);
        return { processedCount };
      });
    const tasks = [makeTask(1), makeTask(2, true), makeTask(3)];

    const settledPromise = runDailyOperationTasks(tasks, 2);
    await flushMicrotasks();

    expect(tasks[0]).toHaveBeenCalledOnce();
    expect(tasks[1]).toHaveBeenCalledOnce();
    expect(tasks[2]).not.toHaveBeenCalled();
    expect(maxActiveCount).toBe(2);

    releases[0]!();
    await flushMicrotasks();

    expect(tasks[2]).toHaveBeenCalledOnce();
    expect(maxActiveCount).toBe(2);

    releases[1]!();
    releases[2]!();

    await expect(settledPromise).resolves.toEqual([
      { status: 'fulfilled', value: { processedCount: 1 } },
      { status: 'rejected', reason: expect.any(Error) },
      { status: 'fulfilled', value: { processedCount: 3 } },
    ]);
  });
});

describe('checkPcaPumpRentalOverdues', () => {
  let restoreTimezone: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTimezone = useTimezone('Asia/Tokyo');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00+09:00'));
    taskFindManyMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreTimezone?.();
  });

  it('marks due active rentals overdue and creates follow-up tasks', async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    // due_at(@db.Date)比較は「ローカル日付の UTC 深夜」規約(JST 6/8 → 2026-06-08T00:00Z)
    const today = new Date('2026-06-08T00:00:00.000Z');
    pcaPumpRentalFindManyMock.mockResolvedValue([
      {
        id: 'rental_1',
        org_id: 'org_1',
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: new Date('2026-05-19T15:30:00.000Z'),
        due_at: new Date('2026-05-31T15:30:00.000Z'),
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
          rented_at: '2026-05-20',
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

describe('checkPcaPumpReturnInspectionPending', () => {
  let restoreTimezone: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTimezone = useTimezone('Asia/Tokyo');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreTimezone?.();
  });

  it('creates follow-up tasks for returned PCA rentals waiting for inspection', async () => {
    pcaPumpRentalFindManyMock.mockResolvedValue([
      {
        id: 'rental_1',
        org_id: 'org_1',
        pump_id: 'pump_1',
        institution_id: 'institution_1',
        rented_at: new Date('2026-05-31T15:30:00.000Z'),
        due_at: new Date('2026-06-06T15:30:00.000Z'),
        returned_at: new Date('2026-06-05T15:30:00.000Z'),
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
        task: {
          upsert: vi.fn(),
        },
      }),
    );

    const result = await checkPcaPumpReturnInspectionPending({ orgId: 'org_1' });

    expect(result).toEqual({ processedCount: 1 });
    expect(runJobMock).toHaveBeenCalledWith(
      'pca_pump_return_inspection_pending_check',
      expect.any(Function),
      'org_1',
    );
    expect(pcaPumpRentalFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          status: 'returned',
          return_inspection_status: 'pending',
        },
      }),
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'pca_pump_return_inspection_pending',
        title: 'PCAポンプの返却検品が未完了です',
        priority: 'high',
        relatedEntityType: 'pca_pump_rental',
        relatedEntityId: 'rental_1',
        dedupeKey: 'pca-pump-return-inspection-pending:rental_1',
        metadata: expect.objectContaining({
          rental_id: 'rental_1',
          pump_id: 'pump_1',
          pump_asset_code: 'PCA-001',
          institution_id: 'institution_1',
          institution_name: 'サンプル在宅クリニック',
          rented_at: '2026-06-01',
          due_at: '2026-06-07',
          returned_at: '2026-06-06',
          pending_days: 2,
          action_href: '/admin/pca-pumps',
          action_label: '返却検品を確認',
        }),
      }),
    );
  });

  it('does not create tasks when no returned rentals are waiting for inspection', async () => {
    pcaPumpRentalFindManyMock.mockResolvedValue([]);

    const result = await checkPcaPumpReturnInspectionPending();

    expect(result).toEqual({ processedCount: 0 });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });

  it('completes stale inspection pending tasks without touching other orgs in scoped runs', async () => {
    pcaPumpRentalFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        task_type: 'pca_pump_return_inspection_pending',
        dedupe_key: 'pca-pump-return-inspection-pending:rental_stale',
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

    const result = await checkPcaPumpReturnInspectionPending({ orgId: 'org_1' });

    expect(result).toEqual({ processedCount: 0 });
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: { in: ['org_1'] },
          task_type: { in: ['pca_pump_return_inspection_pending'] },
          status: { in: ['pending', 'in_progress'] },
        }),
      }),
    );
    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        task_type: 'pca_pump_return_inspection_pending',
        status: { in: ['pending', 'in_progress'] },
        dedupe_key: { in: ['pca-pump-return-inspection-pending:rental_stale'] },
      },
      data: {
        status: 'completed',
        completed_at: expect.any(Date),
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
  });
});

describe('daily job local date keys', () => {
  let restoreTimezone: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreTimezone = useTimezone('Asia/Tokyo');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00+09:00'));
    notificationCreateMock.mockResolvedValue({});
    notificationCreateManyMock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
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
    restoreTimezone?.();
  });

  it('uses local-calendar expiry dates in prescription expiry notifications', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        prescription_expiry_date: new Date('2026-06-09T15:30:00.000Z'),
        cycle: {
          case_: {
            org_id: 'org_1',
            patient_id: 'patient_1',
            primary_pharmacist_id: 'pharmacist_1',
          },
        },
      },
    ]);

    const result = await checkPrescriptionExpiry();

    expect(result).toEqual({ processedCount: 1 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          user_id: 'pharmacist_1',
          message: '処方箋の有効期限が 2026-06-10 です。早急に対応してください。',
          dedupe_key: 'prescription-expiry:intake_1',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('batches prescription expiry notifications and reports inserted count', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        prescription_expiry_date: new Date('2026-06-09T15:30:00.000Z'),
        cycle: {
          case_: {
            org_id: 'org_1',
            patient_id: 'patient_1',
            primary_pharmacist_id: 'pharmacist_1',
          },
        },
      },
      {
        id: 'intake_2',
        prescription_expiry_date: new Date('2026-06-09T15:30:00.000Z'),
        cycle: {
          case_: {
            org_id: 'org_1',
            patient_id: 'patient_2',
            primary_pharmacist_id: null,
          },
        },
      },
      {
        id: 'intake_3',
        prescription_expiry_date: new Date('2026-06-09T15:30:00.000Z'),
        cycle: null,
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await checkPrescriptionExpiry();

    expect(result).toEqual({ processedCount: 1 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          user_id: 'pharmacist_1',
          dedupe_key: 'prescription-expiry:intake_1',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('uses local-calendar dates for emergency coverage gap task keys', async () => {
    businessHolidayFindManyMock.mockResolvedValue([
      {
        org_id: 'org_1',
        site_id: 'site_1',
        date: new Date('2026-06-09T15:30:00.000Z'),
        name: '夜間対応日',
        is_closed: true,
      },
    ]);
    pharmacistShiftFindManyMock.mockResolvedValue([]);

    const result = await checkEmergencyCoverageGaps();

    expect(result).toEqual({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'emergency_coverage_gap',
        title: '2026-06-10 の時間外・緊急対応体制が未設定です',
        relatedEntityId: 'site_1:2026-06-10',
        dedupeKey: 'emergency-coverage-gap:2026-06-10:site_1',
      }),
    );
  });

  it('groups facility visit batches by local-calendar schedule date', async () => {
    careCaseFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindManyMock.mockResolvedValue([]);
    patientSelfReportFindManyMock.mockResolvedValue([]);
    inquiryRecordFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        site_id: 'site_1',
        scheduled_date: new Date('2026-06-11T15:30:00.000Z'),
        priority: 'normal',
        schedule_status: 'planned',
        preparation: { offline_synced: true },
        case_: {
          id: 'case_1',
          patient_id: 'patient_1',
          patient: {
            name: '山田 太郎',
            residences: [{ building_id: '青葉レジデンス', address: '東京都港区1-1-1' }],
          },
        },
      },
      {
        id: 'schedule_2',
        org_id: 'org_1',
        pharmacist_id: 'pharmacist_1',
        site_id: 'site_1',
        scheduled_date: new Date('2026-06-11T16:30:00.000Z'),
        priority: 'normal',
        schedule_status: 'planned',
        preparation: { offline_synced: true },
        case_: {
          id: 'case_2',
          patient_id: 'patient_2',
          patient: {
            name: '佐藤 花子',
            residences: [{ building_id: '青葉レジデンス', address: '東京都港区1-1-1' }],
          },
        },
      },
    ]);

    const result = await syncVisitSupportFeatureTasks();

    expect(result).toEqual({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'facility_batch_tracker',
        title: '2026-06-12 の施設訪問バッチ確認',
        relatedEntityId: '2026-06-12:site_1:pharmacist_1:青葉レジデンス',
        dedupeKey: 'facility-batch-tracker:2026-06-12:site_1:pharmacist_1:青葉レジデンス',
        metadata: expect.objectContaining({
          facility_label: '青葉レジデンス',
          patient_count: 2,
        }),
      }),
    );
  });

  it('creates deduplicated patient foundation review tasks for active cases with foundation gaps', async () => {
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        status: 'active',
        primary_pharmacist_id: 'pharmacist_1',
        patient: {
          name: '山田 太郎',
          contacts: [
            {
              relation: 'child',
              is_primary: true,
              is_emergency_contact: true,
              phone: null,
              email: null,
              fax: null,
            },
          ],
          scheduling_preference: {
            preferred_contact_name: null,
            preferred_contact_phone: null,
            visit_before_contact_required: true,
            parking_available: null,
            care_level: null,
          },
        },
        care_team_links: [
          {
            role: 'physician',
            is_primary: true,
            phone: '03-1111-1111',
            email: null,
            fax: null,
          },
        ],
      },
    ]);
    firstVisitDocumentFindManyMock.mockResolvedValue([{ case_id: 'case_1' }]);
    patientSelfReportFindManyMock.mockResolvedValue([]);
    inquiryRecordFindManyMock.mockResolvedValue([]);
    visitScheduleFindManyMock.mockResolvedValue([]);

    const result = await syncVisitSupportFeatureTasks();

    expect(result).toEqual({ processedCount: 1 });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'patient_foundation_review',
        title: '山田 太郎 の患者基盤を整備',
        priority: 'high',
        assignedTo: 'pharmacist_1',
        relatedEntityType: 'patient',
        relatedEntityId: 'patient_1',
        dedupeKey: 'patient-foundation-review:patient_1',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          action_href: '/patients/patient_1#patient-foundation',
          missing_items: expect.arrayContaining([
            '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
            '駐車可否が未確認です。',
            '介護度が未確認です。',
          ]),
        }),
      }),
    );
  });

  it('uses local-calendar dates in facility standard expiry task descriptions', async () => {
    facilityStandardRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'facility_standard_1',
        org_id: 'org_1',
        standard_type: '在宅患者訪問薬剤管理指導料',
        expiry_date: new Date('2026-06-14T15:30:00.000Z'),
        site: { name: '本店' },
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ org_id: 'org_1', user_id: 'admin_1' }]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await checkFacilityStandardExpiry();

    expect(result).toEqual({ processedCount: 1 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          user_id: 'admin_1',
          title: '施設基準の有効期限',
          link: '/admin/facility-standards',
          dedupe_key: 'facility-std-expiry:facility_standard_1:7',
        }),
      ],
      skipDuplicates: true,
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'facility_standard_expiry',
        description: '本店 の 在宅患者訪問薬剤管理指導料 が 2026-06-15 に期限切れ',
        dedupeKey: 'facility-standard-expiry:facility_standard_1',
      }),
    );
  });

  it('prefetches facility standard expiry admins once per affected org set', async () => {
    facilityStandardRegistrationFindManyMock.mockResolvedValue([
      {
        id: 'facility_standard_1',
        org_id: 'org_1',
        standard_type: '在宅患者訪問薬剤管理指導料',
        expiry_date: new Date('2026-06-14T15:30:00.000Z'),
        site: { name: '本店' },
      },
      {
        id: 'facility_standard_2',
        org_id: 'org_1',
        standard_type: '地域支援体制加算',
        expiry_date: new Date('2026-06-20T15:30:00.000Z'),
        site: { name: '本店' },
      },
    ]);
    membershipFindManyMock.mockResolvedValue([{ org_id: 'org_1', user_id: 'admin_1' }]);
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await checkFacilityStandardExpiry();

    expect(result).toEqual({ processedCount: 2 });
    expect(membershipFindManyMock).toHaveBeenCalledTimes(1);
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: { in: ['org_1'] },
        role: { in: ['admin', 'owner'] },
        is_active: true,
      },
      select: { org_id: true, user_id: true },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          dedupe_key: 'facility-std-expiry:facility_standard_1:7',
        }),
        expect.objectContaining({
          dedupe_key: 'facility-std-expiry:facility_standard_2:30',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('prefetches credential expiry admins once and skips duplicate self-admin notices', async () => {
    pharmacistCredentialFindManyMock.mockResolvedValue([
      {
        id: 'credential_1',
        org_id: 'org_1',
        user_id: 'admin_1',
        certification_type: '認定薬剤師',
        expiry_date: new Date('2026-06-20T15:30:00.000Z'),
        user: { id: 'admin_1', org_id: 'org_1', name: '管理 薬剤師' },
      },
      {
        id: 'credential_2',
        org_id: 'org_1',
        user_id: 'pharmacist_1',
        certification_type: '実務実習指導薬剤師',
        expiry_date: new Date('2026-06-25T15:30:00.000Z'),
        user: { id: 'pharmacist_1', org_id: 'org_1', name: '担当 薬剤師' },
      },
    ]);
    membershipFindManyMock.mockResolvedValue([
      { org_id: 'org_1', user_id: 'admin_1' },
      { org_id: 'org_1', user_id: 'owner_1' },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 5 });

    const result = await checkCredentialExpiry();

    expect(result).toEqual({ processedCount: 5 });
    expect(membershipFindManyMock).toHaveBeenCalledTimes(1);
    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: { in: ['org_1'] },
        role: { in: ['admin', 'owner'] },
        is_active: true,
      },
      select: { org_id: true, user_id: true },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'admin_1',
          dedupe_key: 'credential-expiry:credential_1:30',
        }),
        expect.objectContaining({
          user_id: 'owner_1',
          dedupe_key: 'credential-expiry-admin:credential_2:owner_1:30',
        }),
      ]),
      skipDuplicates: true,
    });
    const [{ data: credentialNotifications }] = notificationCreateManyMock.mock.calls[0] as [
      { data: Array<{ dedupe_key: string }>; skipDuplicates: boolean },
    ];
    expect(credentialNotifications).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupe_key: 'credential-expiry-admin:credential_1:admin_1:30',
        }),
      ]),
    );
  });

  it('uses local-calendar dates in consent expiry notifications and tasks', async () => {
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        consent_type: '居宅療養管理指導',
        expiry_date: new Date('2026-06-14T15:30:00.000Z'),
        patient: { id: 'patient_1', name: '山田 太郎' },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await checkConsentExpiry();

    expect(result).toEqual({ processedCount: 1 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          user_id: 'pharmacist_1',
          message:
            '山田 太郎 さんの 居宅療養管理指導 同意が 2026-06-15 に期限切れ。再取得が必要です。',
        }),
      ],
      skipDuplicates: true,
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'consent_expiry',
        description: '居宅療養管理指導 の同意が 2026-06-15 に期限切れ',
        dedupeKey: 'consent-expiry:consent_1',
      }),
    );
  });

  it('prefetches consent expiry active cases once across case and patient fallbacks', async () => {
    consentRecordFindManyMock.mockResolvedValue([
      {
        id: 'consent_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        consent_type: '居宅療養管理指導',
        expiry_date: new Date('2026-06-14T15:30:00.000Z'),
        patient: { id: 'patient_1', name: '山田 太郎' },
      },
      {
        id: 'consent_2',
        org_id: 'org_1',
        patient_id: 'patient_2',
        case_id: null,
        consent_type: '在宅訪問同意',
        expiry_date: new Date('2026-06-20T15:30:00.000Z'),
        patient: { id: 'patient_2', name: '佐藤 花子' },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
      },
      {
        id: 'case_2',
        org_id: 'org_1',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharmacist_2',
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await checkConsentExpiry();

    expect(result).toEqual({ processedCount: 2 });
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['discharged', 'terminated'] },
        OR: [
          { id: { in: ['case_1'] } },
          { org_id: 'org_1', patient_id: { in: ['patient_1', 'patient_2'] } },
        ],
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        primary_pharmacist_id: true,
      },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'pharmacist_1',
          dedupe_key: 'consent-expiry:consent_1:7',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_2',
          dedupe_key: 'consent-expiry:consent_2:30',
        }),
      ]),
      skipDuplicates: true,
    });
  });

  it('notifies and creates a task for public subsidy insurance nearing expiry', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      {
        id: 'insurance_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'public_subsidy',
        valid_until: new Date('2026-06-14T15:30:00.000Z'),
        patient: { id: 'patient_1', name: '山田 太郎' },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    const result = await checkPublicSubsidyExpiry();

    expect(result).toEqual({ processedCount: 1 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          user_id: 'pharmacist_1',
          title: '公費の有効期限',
          link: '/patients/patient_1',
        }),
      ],
      skipDuplicates: true,
    });
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'public_subsidy_expiry',
        dedupeKey: 'public-subsidy-expiry:insurance_1',
        relatedEntityType: 'patient_insurance',
        relatedEntityId: 'insurance_1',
      }),
    );
  });

  it('prefetches public subsidy expiry active cases once per patient set', async () => {
    patientInsuranceFindManyMock.mockResolvedValue([
      {
        id: 'insurance_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        insurance_type: 'public_subsidy',
        valid_until: new Date('2026-06-14T15:30:00.000Z'),
        patient: { id: 'patient_1', name: '山田 太郎' },
      },
      {
        id: 'insurance_2',
        org_id: 'org_1',
        patient_id: 'patient_2',
        insurance_type: 'public_subsidy',
        valid_until: new Date('2026-06-20T15:30:00.000Z'),
        patient: { id: 'patient_2', name: '佐藤 花子' },
      },
    ]);
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
      },
      {
        id: 'case_2',
        org_id: 'org_1',
        patient_id: 'patient_2',
        primary_pharmacist_id: 'pharmacist_2',
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await checkPublicSubsidyExpiry();

    expect(result).toEqual({ processedCount: 2 });
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(1);
    expect(careCaseFindManyMock).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['discharged', 'terminated'] },
        OR: [{ org_id: 'org_1', patient_id: { in: ['patient_1', 'patient_2'] } }],
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        primary_pharmacist_id: true,
      },
    });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'pharmacist_1',
          dedupe_key: 'public-subsidy-expiry:insurance_1:7',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_2',
          dedupe_key: 'public-subsidy-expiry:insurance_2:30',
        }),
      ]),
      skipDuplicates: true,
    });
  });
});

describe('generateVisitDemands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T09:00:00+09:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allocates generated proposal route order after active schedules and open proposals', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_1',
        org_id: 'org_1',
        case_id: 'case_1',
        patient_id: 'patient_1',
        case_: {
          primary_pharmacist_id: 'pharmacist_1',
        },
        prescription_intakes: [
          {
            refill_next_dispense_date: null,
            lines: [{ end_date: new Date('2026-06-10T00:00:00.000Z') }],
          },
        ],
        visit_schedules: [],
        visit_schedule_proposals: [],
      },
    ]);
    vi.mocked(generateVisitScheduleProposalDrafts).mockResolvedValue({
      diagnostics: {
        accepted: [],
        rejected: [],
      },
      drafts: [
        {
          org_id: 'org_1',
          cycle_id: 'cycle_1',
          case_id: 'case_1',
          site_id: 'site_1',
          visit_type: 'regular',
          priority: 'urgent',
          proposal_status: 'proposed',
          patient_contact_status: 'pending',
          proposed_date: new Date('2026-06-09T00:00:00.000Z'),
          time_window_start: null,
          time_window_end: null,
          proposed_pharmacist_id: 'pharmacist_1',
          assignment_mode: 'primary',
          route_order: 1,
          route_distance_score: 0,
          medication_end_date: null,
          visit_deadline_date: new Date('2026-06-10T00:00:00.000Z'),
          proposal_reason: 'daily demand',
          escalation_reason: null,
          reschedule_source_schedule_id: null,
        },
      ],
    });
    const activeRouteOrderFindManyMock = vi.fn().mockResolvedValue([
      {
        pharmacist_id: 'pharmacist_1',
        scheduled_date: new Date('2026-06-09T00:00:00.000Z'),
        route_order: 3,
      },
    ]);
    const proposalRouteOrderFindManyMock = vi.fn().mockResolvedValue([
      {
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-06-09T00:00:00.000Z'),
        route_order: 5,
        reschedule_source_schedule_id: null,
      },
    ]);
    const visitScheduleProposalCreateMock = vi.fn().mockResolvedValue({});
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: activeRouteOrderFindManyMock,
        },
        visitScheduleProposal: {
          findMany: proposalRouteOrderFindManyMock,
          create: visitScheduleProposalCreateMock,
        },
        task: {
          upsert: vi.fn(),
        },
      }),
    );

    const result = await generateVisitDemands();

    expect(result).toEqual({ processedCount: 1 });
    expect(activeRouteOrderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [
            {
              pharmacist_id: 'pharmacist_1',
              scheduled_date: new Date('2026-06-09T00:00:00.000Z'),
            },
          ],
        }),
      }),
    );
    expect(proposalRouteOrderFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: [
            {
              proposed_pharmacist_id: 'pharmacist_1',
              proposed_date: new Date('2026-06-09T00:00:00.000Z'),
            },
          ],
        }),
      }),
    );
    expect(visitScheduleProposalCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: new Date('2026-06-09T00:00:00.000Z'),
        route_order: 6,
      }),
    });
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
    notificationCreateManyMock.mockImplementation(async ({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
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
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'admin_1',
          dedupe_key: 'fax-original-followup:intake_fax_1:admin_1:high',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_1',
          dedupe_key: 'fax-original-followup:intake_fax_1:pharmacist_1:high',
        }),
      ]),
      skipDuplicates: true,
    });
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

  it('creates retention tasks with local-calendar retention dates in the description', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    vi.setSystemTime(new Date('2026-03-28T00:00:00+09:00'));
    prescriptionIntakeFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'intake_original_1',
          org_id: 'org_1',
          source_type: 'paper',
          prescribed_date: new Date('2021-04-25T15:30:00.000Z'),
          original_document_url: 's3://bucket/original.pdf',
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
      ])
      .mockResolvedValueOnce([]);

    try {
      const result = await checkPrescriptionOriginalRetention();

      expect(result).toMatchObject({ processedCount: 2 });
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org_1',
          taskType: 'prescription_original_retention',
          title: '処方箋原本保存期限確認: 山田 太郎',
          description:
            '原本スキャンが 2026-04-26 に5年保存期限を迎えます。Object Lock と保全状況を確認してください。',
          assignedTo: 'pharmacist_1',
          relatedEntityType: 'prescription_intake',
          relatedEntityId: 'intake_original_1',
          dedupeKey: 'prescription-original-retention:intake_original_1',
          metadata: expect.objectContaining({
            patient_id: 'patient_1',
            source_type: 'paper',
          }),
        }),
      );
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('batches prescription original notifications with duplicate-safe inserts', async () => {
    membershipFindManyMock.mockResolvedValue([]);
    prescriptionIntakeFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'intake_original_1',
          org_id: 'org_1',
          source_type: 'paper',
          prescribed_date: new Date('2021-04-01T00:00:00.000Z'),
          original_document_url: 's3://bucket/original-1.pdf',
          cycle: {
            patient_id: 'patient_1',
            case_: {
              patient_id: 'patient_1',
              primary_pharmacist_id: 'pharmacist_1',
              patient: { name: '山田 太郎' },
            },
          },
        },
        {
          id: 'intake_original_2',
          org_id: 'org_1',
          source_type: 'paper',
          prescribed_date: new Date('2021-04-02T00:00:00.000Z'),
          original_document_url: 's3://bucket/original-2.pdf',
          cycle: {
            patient_id: 'patient_2',
            case_: {
              patient_id: 'patient_2',
              primary_pharmacist_id: 'pharmacist_2',
              patient: { name: '佐藤 花子' },
            },
          },
        },
      ])
      .mockResolvedValueOnce([]);
    notificationCreateManyMock.mockResolvedValue({ count: 2 });

    const result = await checkPrescriptionOriginalRetention();

    expect(result).toMatchObject({ processedCount: 2 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'pharmacist_1',
          dedupe_key: 'prescription-original-retention:intake_original_1:pharmacist_1:urgent',
        }),
        expect.objectContaining({
          user_id: 'pharmacist_2',
          dedupe_key: 'prescription-original-retention:intake_original_2:pharmacist_2:urgent',
        }),
      ]),
      skipDuplicates: true,
    });
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

describe('checkVisitRecordRetention', () => {
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
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1', name: '山田 太郎' }]);
    notificationCreateMock.mockResolvedValue({});
    notificationCreateManyMock.mockResolvedValue({ count: 1 });
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

  it('creates retention tasks with local-calendar visit retention dates in the description', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    vi.setSystemTime(new Date('2026-03-28T00:00:00+09:00'));
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_record_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        visit_date: new Date('2021-04-25T15:30:00.000Z'),
      },
    ]);

    try {
      const result = await checkVisitRecordRetention();

      expect(result).toMatchObject({ processedCount: 1 });
      expect(notificationCreateMock).not.toHaveBeenCalled();
      expect(notificationCreateManyMock).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            org_id: 'org_1',
            user_id: 'admin_1',
            type: 'business',
            title: '薬歴の保存期限',
            link: '/visits/visit_record_1',
            dedupe_key: 'visit-record-retention:visit_record_1:admin_1:high',
          }),
        ],
        skipDuplicates: true,
      });
      expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orgId: 'org_1',
          taskType: 'visit_record_retention',
          title: '薬歴保存期限確認: 山田 太郎',
          description:
            '訪問記録が 2026-04-26 に5年保存期限を迎えます。PDF出力・保全状況を確認してください。',
          relatedEntityType: 'visit_record',
          relatedEntityId: 'visit_record_1',
          dedupeKey: 'visit-record-retention:visit_record_1',
          metadata: expect.objectContaining({
            patient_id: 'patient_1',
          }),
        }),
      );
    } finally {
      process.env.TZ = originalTimezone;
    }
  });

  it('batches multiple retention notifications and reports inserted count', async () => {
    membershipFindManyMock.mockResolvedValue([
      { org_id: 'org_1', user_id: 'admin_1' },
      { org_id: 'org_1', user_id: 'owner_1' },
    ]);
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_record_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        visit_date: new Date('2021-03-25T00:00:00.000Z'),
      },
      {
        id: 'visit_record_2',
        org_id: 'org_1',
        patient_id: 'patient_1',
        visit_date: new Date('2021-03-26T00:00:00.000Z'),
      },
    ]);
    notificationCreateManyMock.mockResolvedValue({ count: 3 });

    const result = await checkVisitRecordRetention();

    expect(result).toMatchObject({ processedCount: 3 });
    expect(notificationCreateMock).not.toHaveBeenCalled();
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          user_id: 'admin_1',
          dedupe_key: 'visit-record-retention:visit_record_1:admin_1:urgent',
        }),
        expect.objectContaining({
          user_id: 'owner_1',
          dedupe_key: 'visit-record-retention:visit_record_2:owner_1:urgent',
        }),
      ]),
      skipDuplicates: true,
    });
    const [{ data }] = notificationCreateManyMock.mock.calls[0] as [
      { data: unknown[]; skipDuplicates: boolean },
    ];
    expect(data).toHaveLength(4);
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
