import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  prescriptionIntakeFindManyMock,
  visitScheduleFindManyMock,
  visitScheduleContactLogFindManyMock,
  conferenceNoteFindManyMock,
  careCaseFindManyMock,
  membershipFindManyMock,
  notificationCreateMock,
  dispatchNotificationEventMock,
  taskFindManyMock,
  upsertOperationalTaskMock,
  withOrgContextMock,
  runJobMock,
} = vi.hoisted(() => ({
  prescriptionIntakeFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleContactLogFindManyMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationCreateMock: vi.fn(),
  dispatchNotificationEventMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
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
  checkPrescriptionOriginalRetention,
} from './daily';

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
      })
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
      })
    );
  });

  it('creates overdue fax original follow-up tasks and notifications', async () => {
    prescriptionIntakeFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
      })
    );
  });

  it('clears stale fax follow-up tasks when nothing is overdue', async () => {
    prescriptionIntakeFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
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
      })
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
      })
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
      })
    );
    expect(dispatchNotificationEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        eventType: 'billing_initial_assessment_due',
        explicitUserIds: ['pharmacist_1'],
      })
    );
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
      })
    );
  });
});
