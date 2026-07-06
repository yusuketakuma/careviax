import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { serverCache } from '@/lib/utils/server-cache';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authContextMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  loggerErrorMock,
  withRoutePerformanceMock,
  cycleGroupByMock,
  workflowExceptionCountMock,
  workflowExceptionFindManyMock,
  communicationRequestCountMock,
  communicationRequestFindManyMock,
  visitScheduleCountMock,
  medicationCycleCountMock,
  medicationCycleFindManyMock,
  visitScheduleFindManyMock,
  consentRecordFindManyMock,
  managementPlanFindManyMock,
  prescriptionIntakeFindManyMock,
  deliveryRecordCountMock,
  taskGroupByMock,
  taskFindManyMock,
  taskCountMock,
  visitScheduleProposalFindManyMock,
  patientSelfReportFindManyMock,
  patientFindManyMock,
  patientCountMock,
  userFindManyMock,
  communityActivityFindManyMock,
  careCaseCountMock,
  careCaseFindManyMock,
  pharmacistShiftFindManyMock,
  businessHolidayFindManyMock,
  inquiryRecordFindManyMock,
  medicationIssueFindManyMock,
  firstVisitDocumentCountMock,
  conferenceNoteFindManyMock,
  communicationQueueMock,
  patientRiskQueueMock,
  homeCareFeatureSummaryMock,
  billingPreviewBatchMock,
  queryRawMock,
} = vi.hoisted(() => ({
  authContextMock: { orgId: 'org_1', userId: 'user_1', role: 'clerk' },
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback) => callback()),
  loggerErrorMock: vi.fn(),
  withRoutePerformanceMock: vi.fn((_req, handler) => handler()),
  cycleGroupByMock: vi.fn(),
  workflowExceptionCountMock: vi.fn(),
  workflowExceptionFindManyMock: vi.fn(),
  communicationRequestCountMock: vi.fn(),
  communicationRequestFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  medicationCycleCountMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  consentRecordFindManyMock: vi.fn(),
  managementPlanFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  deliveryRecordCountMock: vi.fn(),
  taskGroupByMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  patientSelfReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientCountMock: vi.fn(),
  userFindManyMock: vi.fn(),
  communityActivityFindManyMock: vi.fn(),
  careCaseCountMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  inquiryRecordFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  firstVisitDocumentCountMock: vi.fn(),
  conferenceNoteFindManyMock: vi.fn(),
  communicationQueueMock: vi.fn(),
  patientRiskQueueMock: vi.fn(),
  homeCareFeatureSummaryMock: vi.fn(),
  billingPreviewBatchMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      groupBy: cycleGroupByMock,
      count: medicationCycleCountMock,
      findMany: medicationCycleFindManyMock,
    },
    workflowException: {
      count: workflowExceptionCountMock,
      findMany: workflowExceptionFindManyMock,
    },
    communicationRequest: {
      count: communicationRequestCountMock,
      findMany: communicationRequestFindManyMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
      findMany: visitScheduleFindManyMock,
    },
    consentRecord: {
      findMany: consentRecordFindManyMock,
    },
    managementPlan: {
      findMany: managementPlanFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
    medicationIssue: {
      findMany: medicationIssueFindManyMock,
    },
    deliveryRecord: {
      count: deliveryRecordCountMock,
    },
    task: {
      groupBy: taskGroupByMock,
      findMany: taskFindManyMock,
      count: taskCountMock,
    },
    visitScheduleProposal: {
      findMany: visitScheduleProposalFindManyMock,
    },
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
      count: patientCountMock,
    },
    firstVisitDocument: {
      count: firstVisitDocumentCountMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    communityActivity: {
      findMany: communityActivityFindManyMock,
    },
    careCase: {
      count: careCaseCountMock,
      findMany: careCaseFindManyMock,
    },
    conferenceNote: {
      findMany: conferenceNoteFindManyMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/server/services/communication-queue', () => ({
  listCommunicationQueue: communicationQueueMock,
}));

vi.mock('@/server/services/patient-risk', () => ({
  listPatientRiskSummaries: patientRiskQueueMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getHomeCareFeatureSummary: homeCareFeatureSummaryMock,
}));

vi.mock('@/server/services/visit-schedule-billing-preview', () => ({
  buildVisitScheduleBillingPreviewBatch: billingPreviewBatchMock,
}));

import {
  buildWorkflowAssignmentScopeFingerprint,
  buildWorkflowCacheKey,
} from '@/server/services/workflow-dashboard-cache';
import { GET as rawGET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);

function createRequest(headers?: Record<string, string>, search = '') {
  return new NextRequest(`http://localhost/api/dashboard/workflow${search}`, { headers });
}

describe('/api/dashboard/workflow GET', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    serverCache.clear();

    requireAuthContextMock.mockResolvedValue({ ctx: authContextMock });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    withRoutePerformanceMock.mockImplementation((_req, handler) => handler());
    queryRawMock.mockResolvedValue([{ count: BigInt(0) }]);
    cycleGroupByMock.mockResolvedValue([
      { overall_status: 'visit_completed', _count: { id: 2 } },
      { overall_status: 'dispensing', _count: { id: 1 } },
    ]);
    workflowExceptionCountMock.mockResolvedValue(3);
    workflowExceptionFindManyMock.mockResolvedValue([
      {
        id: 'exception_1',
        exception_type: 'medication_gap',
        description: '薬剤残数が不足しています',
        severity: 'warning',
        created_at: new Date('2026-03-25T08:00:00Z'),
        cycle: {
          case_: {
            patient: {
              name: '山田 花子',
            },
          },
        },
      },
    ]);
    communicationRequestCountMock.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    communicationRequestFindManyMock.mockResolvedValue([]);
    medicationCycleFindManyMock.mockResolvedValue([]);
    inquiryRecordFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    taskGroupByMock.mockResolvedValue([
      { task_type: 'visit_demand', _count: { id: 2 } },
      { task_type: 'visit_contact_followup', _count: { id: 1 } },
      { task_type: 'visit_intake_linkage', _count: { id: 1 } },
    ]);
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task_1',
        task_type: 'visit_preparation',
        title: '訪問準備が未完了です',
        description: '明日の訪問準備を完了してください。',
        status: 'pending',
        priority: 'high',
        assigned_to: 'user_1',
        due_date: new Date('2026-03-27T00:00:00Z'),
        sla_due_at: new Date('2026-03-27T00:00:00Z'),
        related_entity_type: 'visit_schedule',
        related_entity_id: 'schedule_1',
        metadata: {
          patient_name: '山田 太郎',
          action_href: '/patients/patient_1/prescriptions',
          action_label: '原本回収を記録',
        },
      },
    ]);
    visitScheduleCountMock.mockResolvedValue(2);
    medicationCycleCountMock.mockResolvedValue(5);
    visitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_1',
          case_id: 'case_1',
          scheduled_date: new Date('2026-03-27T00:00:00Z'),
          time_window_start: new Date('1970-01-01T09:00:00Z'),
          time_window_end: new Date('1970-01-01T10:00:00Z'),
          schedule_status: 'planned',
          priority: 'normal',
          pharmacist_id: 'user_1',
          assignment_mode: 'primary',
          route_order: 1,
          escalation_reason: null,
          preparation: {
            medication_changes_reviewed: false,
            carry_items_confirmed: true,
            previous_issues_reviewed: false,
            route_confirmed: true,
            offline_synced: false,
            prepared_at: null,
          },
          override_request: null,
          applied_override: null,
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田 太郎',
              residences: [
                {
                  address: '東京都港区1-1-1',
                  building_id: 'facility_a',
                },
              ],
            },
          },
          site: {
            id: 'site_1',
            name: '本店',
          },
        },
        {
          id: 'schedule_2',
          case_id: 'case_2',
          scheduled_date: new Date('2026-03-27T00:00:00Z'),
          time_window_start: new Date('1970-01-01T10:00:00Z'),
          time_window_end: new Date('1970-01-01T11:00:00Z'),
          schedule_status: 'ready',
          priority: 'urgent',
          pharmacist_id: 'user_1',
          assignment_mode: 'fallback',
          route_order: 2,
          escalation_reason: '担当薬剤師が不在',
          preparation: {
            medication_changes_reviewed: true,
            carry_items_confirmed: true,
            previous_issues_reviewed: true,
            route_confirmed: true,
            offline_synced: true,
            prepared_at: new Date('2026-03-26T08:00:00Z'),
          },
          override_request: {
            id: 'override_1',
            status: 'pending',
            reason: '緊急割込',
          },
          applied_override: null,
          case_: {
            patient: {
              id: 'patient_2',
              name: '山田 花子',
              residences: [
                {
                  address: '東京都港区1-1-1',
                  building_id: 'facility_a',
                },
              ],
            },
          },
          site: {
            id: 'site_1',
            name: '本店',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'recent_1',
          schedule_status: 'completed',
          priority: 'urgent',
        },
        {
          id: 'recent_2',
          schedule_status: 'postponed',
          priority: 'normal',
        },
      ])
      .mockResolvedValue([]);
    consentRecordFindManyMock.mockResolvedValue([{ patient_id: 'patient_1' }]);
    managementPlanFindManyMock.mockResolvedValue([{ case_id: 'case_1' }]);
    visitScheduleProposalFindManyMock.mockResolvedValue([
      {
        id: 'proposal_1',
        proposal_status: 'patient_contact_pending',
        patient_contact_status: 'attempted',
        priority: 'high',
        proposed_date: new Date('2026-03-27T00:00:00Z'),
        visit_deadline_date: new Date('2026-03-28T00:00:00Z'),
        proposed_pharmacist_id: 'user_1',
        proposal_reason: '服薬最終日より前に配置',
        reschedule_source_schedule_id: null,
        case_: {
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
          },
        },
      },
    ]);
    deliveryRecordCountMock.mockResolvedValue(2);
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        source_type: 'refill',
        refill_remaining_count: 2,
        split_dispense_total: null,
        split_dispense_current: null,
        prescribed_date: new Date('2026-03-20T00:00:00Z'),
        prescription_expiry_date: null,
        refill_next_dispense_date: new Date('2026-03-30T00:00:00Z'),
        split_next_dispense_date: null,
        cycle: {
          id: 'cycle_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          case_: {
            id: 'case_1',
            primary_pharmacist_id: 'user_1',
            patient: {
              id: 'patient_1',
              name: '山田 太郎',
            },
          },
          visit_schedules: [],
          visit_schedule_proposals: [],
        },
      },
    ]);
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_2',
        reported_by_name: '家族A',
        relation: '娘',
        category: '服薬状況',
        subject: '飲み忘れが増えています',
        requested_callback: true,
        preferred_contact_time: '午後',
        status: 'submitted',
        created_at: new Date('2026-03-26T01:00:00Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([{ id: 'patient_2', name: '山田 花子' }]);
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: '田中 薬剤師' }]);
    taskCountMock.mockResolvedValue(3);
    communityActivityFindManyMock.mockResolvedValue([
      {
        id: 'community_1',
        title: '地域ケア会議',
        partner_name: '地域包括支援センター',
        activity_type: 'conference',
        activity_date: new Date('2026-03-25T00:00:00Z'),
        referrals_generated: 1,
      },
    ]);
    careCaseCountMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1', patient_id: 'patient_1' }]);
    conferenceNoteFindManyMock.mockResolvedValue([]);
    pharmacistShiftFindManyMock.mockResolvedValue([
      {
        date: new Date('2026-03-27T00:00:00Z'),
        site_id: 'site_1',
        user_id: 'user_1',
      },
    ]);
    businessHolidayFindManyMock.mockResolvedValue([
      {
        id: 'holiday_1',
        date: new Date('2026-03-29T00:00:00Z'),
        name: '棚卸休業',
        site_id: 'site_1',
      },
    ]);
    communicationQueueMock.mockResolvedValue({
      summary: {
        pending_count: 2,
        overdue_count: 1,
        self_reports: 1,
        callback_followups: 1,
        inbound_communications: 1,
        open_requests: 1,
        delivery_backlog: 1,
        expiring_external_shares: 0,
      },
      items: [
        {
          id: 'queue_1',
          queue_type: 'self_report',
          title: '山田 花子 の自己申告',
          summary: '飲み忘れが増えています',
          channel: 'patient_portal',
          status: 'submitted',
          priority: 'urgent',
          patient_name: '山田 花子',
          due_at: '2026-03-26T01:00:00.000Z',
          action_href: '/external',
          action_label: '自己申告を確認',
        },
      ],
    });
    patientRiskQueueMock.mockResolvedValue([
      {
        patient_id: 'patient_2',
        patient_name: '山田 花子',
        score: 7,
        level: 'high',
        reasons: ['患者・家族から 1 件の自己申告があります'],
        unresolved_self_reports: 1,
        open_issues: 0,
        disrupted_visits_30d: 0,
        pending_reports: 1,
        open_tasks: 1,
        missing_visit_consent: false,
        missing_management_plan: false,
      },
    ]);
    billingPreviewBatchMock.mockResolvedValue({});
    homeCareFeatureSummaryMock.mockResolvedValue({
      totals: { blocked: 1, attention: 1, monitoring: 1, ready: 17 },
      features: [],
    });
    firstVisitDocumentCountMock.mockResolvedValue(1);
    patientCountMock.mockResolvedValue(1);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_UNAUTHORIZED' }, { status: 401 }),
    });
    const cacheGetSpy = vi.spyOn(serverCache, 'get');
    const cacheSetSpy = vi.spyOn(serverCache, 'set');

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(401);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(cacheSetSpy).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(cycleGroupByMock).not.toHaveBeenCalled();
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(taskFindManyMock).not.toHaveBeenCalled();
    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
    expect(patientRiskQueueMock).not.toHaveBeenCalled();
    expect(homeCareFeatureSummaryMock).not.toHaveBeenCalled();
    expect(billingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('returns unified workflow/workbench data', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canViewDashboard',
      message: 'ダッシュボードの閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      authContextMock,
      expect.any(Function),
    );
    expectSensitiveNoStore(response);

    const payload = await response.json();

    expect(payload).toMatchObject({
      data: {
        cycle_status_counts: {
          visit_completed: 2,
          dispensing: 1,
        },
        visit_operations: {
          overdue: 2,
          awaiting_reports: 5,
          missing_visit_consent: 1,
          missing_management_plan: 1,
          missing_first_visit_doc: expect.any(Number),
          missing_emergency_contact: 1,
          missing_primary_physician: 1,
        },
        operations_queue: {
          visit_demands: 2,
          callback_followups: 1,
          intake_linkages: 1,
          self_reports_triage: 1,
        },
        communication_queue: {
          summary: expect.objectContaining({
            pending_count: 2,
            overdue_count: 1,
          }),
        },
        home_care_feature_summary: {
          totals: {
            blocked: 0,
            attention: 0,
            monitoring: 0,
            ready: 0,
          },
        },
        patient_risk_queue: {
          high_risk_count: 1,
          items: [
            expect.objectContaining({
              patient_name: '山田 花子',
              level: 'high',
            }),
          ],
        },
        role_inboxes: {
          current_role: 'clerk',
          buckets: expect.arrayContaining([
            expect.objectContaining({
              role: 'clerk',
            }),
          ]),
        },
        remediation_guidance: expect.arrayContaining([
          expect.objectContaining({
            id: 'missing_visit_consent',
            count: 1,
          }),
          expect.objectContaining({
            id: 'visit_intake_linkage',
            count: 1,
          }),
          expect.objectContaining({
            id: 'missing_primary_physician',
            count: 1,
          }),
        ]),
        unified_workbench: expect.arrayContaining([
          expect.objectContaining({
            id: 'task:task_1',
            queue_label: '訪問準備',
            action_href: '/patients/patient_1/prescriptions',
            action_label: '原本回収を記録',
          }),
          expect.objectContaining({
            id: 'self-report:report_1',
            queue_label: 'セルフレポート',
          }),
        ]),
        facility_visibility: {
          clusters: [
            expect.objectContaining({
              label: 'facility_a',
              patient_count: 2,
            }),
          ],
        },
        workload_metrics: {
          pharmacists: [
            expect.objectContaining({
              pharmacist_name: '田中 薬剤師',
              confirmed_visits: 2,
            }),
          ],
        },
        outcome_metrics: {
          completed_last_7_days: 1,
          disrupted_last_7_days: 1,
          urgent_completed_last_7_days: 1,
          awaiting_reports: 5,
          open_exceptions: 3,
        },
        route_control: {
          locked_schedules: 0,
          pending_override_requests: 1,
          emergency_impact_items: 0,
        },
        after_hours_readiness: {
          emergency_capable_shift_count: 1,
          holiday_gap_count: 1,
          holiday_gaps: [
            expect.objectContaining({
              name: '棚卸休業',
            }),
          ],
        },
        regional_pipeline: expect.objectContaining({
          follow_up_activities: 1,
          intake_cases: 2,
        }),
        billing_prevention: expect.objectContaining({
          review_tasks: 3,
        }),
        intake_linkage: [
          expect.objectContaining({
            patient_name: '山田 太郎',
          }),
        ],
        self_reports: [
          expect.objectContaining({
            patient_name: '山田 花子',
            requested_callback: true,
          }),
        ],
      },
    });
    expect(payload).toMatchSnapshot();
    expect(payload.data.communication_queue.summary).toMatchObject({
      pending_count: 2,
      overdue_count: 1,
      self_reports: 1,
      callback_followups: 1,
      inbound_communications: 1,
      open_requests: 1,
      delivery_backlog: 1,
      expiring_external_shares: 0,
    });
    expect(payload.data.communication_queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: 'patient_portal',
        }),
      ]),
    );
    expect(payload.data.patient_risk_queue.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'high',
        }),
      ]),
    );
    expect(homeCareFeatureSummaryMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      caseIds: ['case_1'],
      patientIds: ['patient_1'],
      limit: expect.any(Number),
    });
    expect(cycleGroupByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(visitScheduleFindManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_id: { in: ['case_1'] },
        }),
      }),
    );
    expect(taskFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          OR: expect.arrayContaining([
            { assigned_to: 'user_1' },
            { related_entity_type: 'patient', related_entity_id: { in: ['patient_1'] } },
            { related_entity_type: 'case', related_entity_id: { in: ['case_1'] } },
          ]),
        }),
      }),
    );
    expect(patientSelfReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: { in: ['patient_1'] },
        }),
      }),
    );
    expect(patientRiskQueueMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'org_1',
      patientIds: ['patient_1'],
      caseIdsByPatient: { patient_1: ['case_1'] },
      limit: expect.any(Number),
      candidateLimit: expect.any(Number),
    });
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
  });

  it('flags overdue 連携依頼 against the day sentinel, not the current instant (CE07)', async () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'UTC';
    vi.useFakeTimers();
    try {
      // JST 2026-06-12 08:00(UTC では 2026-06-11T23:00Z)。due_date は YYYY-MM-DD の
      // UTC 深夜 sentinel で保存されるため、当日期限の依頼を new Date()(実時刻)と比べると
      // JST 09:00 以降に当日誤検知していた。当日 sentinel と比較すべき。
      vi.setSystemTime(new Date('2026-06-11T23:00:00Z'));

      const response = await GET(createRequest({ 'x-org-id': 'org_1' }));
      expect(response.status).toBe(200);

      // 2 回目の communicationRequest.count が overdue 判定
      const overdueWhere = communicationRequestCountMock.mock.calls[1]?.[0]?.where;
      expect(overdueWhere?.due_date.lt.toISOString()).toBe('2026-06-11T00:00:00.000Z');
    } finally {
      vi.useRealTimers();
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it('works when called directly without a routeContext argument', async () => {
    const response = await rawGET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        role_inboxes: {
          current_role: 'clerk',
        },
      },
    });
  });

  it('wraps cached workflow responses in no-store headers without rerunning aggregate reads', async () => {
    const firstResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));
    const secondResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expectSensitiveNoStore(firstResponse);
    expectSensitiveNoStore(secondResponse);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(2);
    expect(cycleGroupByMock).toHaveBeenCalledTimes(1);

    const firstPayload = await firstResponse.json();
    const secondPayload = await secondResponse.json();
    expect(secondPayload).toEqual(firstPayload);
  });

  it('passes upcoming schedule local calendar dates to billing previews', async () => {
    visitScheduleFindManyMock.mockReset();
    visitScheduleFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'schedule_local_midnight',
          case_id: 'case_1',
          visit_type: 'regular',
          scheduled_date: new Date(2026, 2, 28, 0, 0, 0),
          time_window_start: new Date('1970-01-01T09:00:00Z'),
          time_window_end: new Date('1970-01-01T10:00:00Z'),
          confirmed_at: null,
          schedule_status: 'planned',
          priority: 'normal',
          pharmacist_id: 'user_1',
          assignment_mode: 'primary',
          carry_items_status: null,
          route_order: 1,
          escalation_reason: null,
          preparation: null,
          override_request: null,
          applied_override: null,
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田 太郎',
              residences: [
                {
                  address: '東京都港区1-1-1',
                  building_id: 'facility_a',
                },
              ],
            },
          },
          site: {
            id: 'site_1',
            name: '本店',
          },
        },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(200);
    expect(billingPreviewBatchMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          key: 'schedule_local_midnight',
          proposedDate: '2026-03-28',
        }),
      ],
      'org_1',
    );
  });

  it('keeps patient-level issue cycle fallback inside assigned cases', async () => {
    medicationIssueFindManyMock.mockResolvedValue([
      {
        id: 'issue_patient_level',
        patient_id: 'patient_1',
        case_id: null,
        title: '服薬状況の確認が必要',
        description: null,
        status: 'open',
        priority: 'high',
        category: 'adherence',
        identified_at: new Date('2026-03-25T00:00:00Z'),
      },
    ]);
    medicationCycleFindManyMock.mockResolvedValue([
      {
        id: 'cycle_allowed',
        case_id: 'case_1',
        patient_id: 'patient_1',
        prescription_intakes: [{ prescriber_name: '佐藤 医師' }],
      },
    ]);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(response.status).toBe(200);
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            {
              patient_id: { in: ['patient_1'] },
              case_id: { in: ['case_1'] },
            },
          ],
        },
      }),
    );
  });

  it('serves phase navigation data without running full dashboard side-rail aggregations', async () => {
    const response = await GET(createRequest({ 'x-org-id': 'org_1' }, '?view=phase'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();

    expect(payload.data).toMatchObject({
      cycle_status_counts: {
        visit_completed: 2,
        dispensing: 1,
      },
      operations_queue: {
        visit_demands: 2,
        intake_linkages: 1,
        self_reports_triage: 1,
      },
      visit_operations: {
        overdue: 2,
        awaiting_reports: 5,
        missing_visit_consent: 0,
        missing_management_plan: 0,
        missing_first_visit_doc: 0,
        missing_emergency_contact: 0,
        missing_primary_physician: 0,
      },
      unified_workbench: expect.arrayContaining([
        expect.objectContaining({ id: 'task:task_1' }),
        expect.objectContaining({ id: 'proposal:proposal_1' }),
      ]),
      intake_linkage: [
        expect.objectContaining({
          patient_name: '山田 太郎',
        }),
      ],
      refill_upcoming: [
        expect.objectContaining({
          id: 'intake_1',
        }),
      ],
    });
    expect(communicationQueueMock).not.toHaveBeenCalled();
    expect(patientRiskQueueMock).not.toHaveBeenCalled();
    expect(homeCareFeatureSummaryMock).not.toHaveBeenCalled();
    expect(billingPreviewBatchMock).not.toHaveBeenCalled();
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentCountMock).not.toHaveBeenCalled();
  });

  it('serves realtime admin data with open exception counts but without full dashboard aggregations', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { ...authContextMock, role: 'admin' },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }, '?view=realtime'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();

    expect(payload.data).toMatchObject({
      workflow_exceptions: {
        open: 3,
        items: [],
      },
      operations_queue: {
        callback_followups: 1,
        self_reports_triage: 1,
      },
      outcome_metrics: {
        awaiting_reports: 5,
      },
      route_control: {
        pending_override_requests: 1,
        locked_schedules: 0,
      },
      unified_workbench: expect.arrayContaining([expect.objectContaining({ id: 'task:task_1' })]),
    });
    expect(workflowExceptionCountMock).toHaveBeenCalledTimes(1);
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
    expect(patientRiskQueueMock).not.toHaveBeenCalled();
    expect(homeCareFeatureSummaryMock).not.toHaveBeenCalled();
    expect(billingPreviewBatchMock).not.toHaveBeenCalled();
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentCountMock).not.toHaveBeenCalled();
  });

  it('serves performance admin data with workload metrics but without full dashboard aggregations', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { ...authContextMock, role: 'admin' },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }, '?view=performance'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const payload = await response.json();

    expect(payload.data).toMatchObject({
      outcome_metrics: {
        awaiting_reports: 5,
      },
      route_control: {
        pending_override_requests: 1,
        emergency_impact_items: 0,
      },
      workload_metrics: {
        pharmacists: [
          expect.objectContaining({
            pharmacist_name: '田中 薬剤師',
            confirmed_visits: 2,
            pending_tasks: 1,
          }),
        ],
      },
    });
    expect(workflowExceptionCountMock).not.toHaveBeenCalled();
    expect(workflowExceptionFindManyMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
    expect(patientRiskQueueMock).not.toHaveBeenCalled();
    expect(homeCareFeatureSummaryMock).not.toHaveBeenCalled();
    expect(billingPreviewBatchMock).not.toHaveBeenCalled();
    expect(conferenceNoteFindManyMock).not.toHaveBeenCalled();
    expect(consentRecordFindManyMock).not.toHaveBeenCalled();
    expect(managementPlanFindManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentCountMock).not.toHaveBeenCalled();
  });

  it('accepts an explicit full workflow view as the full dashboard aggregate', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { ...authContextMock, role: 'admin' },
    });

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }, '?view=full'));

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(communicationQueueMock).toHaveBeenCalled();
    expect(patientRiskQueueMock).toHaveBeenCalled();
    expect(billingPreviewBatchMock).toHaveBeenCalled();
  });

  it.each(['?view=', '?view=%20phase', '?view=phase%20', '?view=unknown'])(
    'rejects malformed workflow view "%s" before cache or dashboard aggregate reads',
    async (search) => {
      requireAuthContextMock.mockResolvedValueOnce({
        ctx: { ...authContextMock, role: 'admin' },
      });
      const cacheGetSpy = vi.spyOn(serverCache, 'get');

      const response = await GET(createRequest({ 'x-org-id': 'org_1' }, search));

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: '検索条件が不正です',
        details: { view: ['view が不正です'] },
      });
      expect(cacheGetSpy).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(cycleGroupByMock).not.toHaveBeenCalled();
      expect(communicationQueueMock).not.toHaveBeenCalled();
      expect(patientRiskQueueMock).not.toHaveBeenCalled();
      expect(billingPreviewBatchMock).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate workflow view before cache or dashboard aggregate reads', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      ctx: { ...authContextMock, role: 'admin' },
    });
    const cacheGetSpy = vi.spyOn(serverCache, 'get');

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }, '?view=phase&view=realtime'));

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '検索条件が不正です',
      details: { view: ['view は1つだけ指定してください'] },
    });
    expect(cacheGetSpy).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(cycleGroupByMock).not.toHaveBeenCalled();
    expect(communicationQueueMock).not.toHaveBeenCalled();
    expect(patientRiskQueueMock).not.toHaveBeenCalled();
    expect(billingPreviewBatchMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when workflow dashboard reads fail', async () => {
    const rawError =
      'raw workflow raw patient raw dashboard SQL stack trace raw-error text must not leak';
    const unsafeError = new Error(rawError);
    unsafeError.name = 'crafted-name.raw-workflow.raw-patient.raw-dashboard.SQL.stack.raw-error';
    cycleGroupByMock.mockRejectedValueOnce(unsafeError);

    const response = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(withRoutePerformanceMock).toHaveBeenCalledTimes(1);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('raw workflow');
    expect(body).not.toContain('raw patient');
    expect(body).not.toContain('raw dashboard');
    expect(body).not.toContain('SQL');
    expect(body).not.toContain('stack trace');
    expect(body).not.toContain('crafted-name');
    expect(body).not.toContain('raw-error text');
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'dashboard_workflow_unhandled_error',
        route: '/api/dashboard/workflow',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, loggedError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(routeContext).not.toHaveProperty('error_name');
    expect(loggedError).toBe(unsafeError);
    const logged = JSON.stringify(routeContext);
    expect(logged).not.toContain('raw workflow');
    expect(logged).not.toContain('raw patient');
    expect(logged).not.toContain('raw dashboard');
    expect(logged).not.toContain('SQL');
    expect(logged).not.toContain('stack trace');
    expect(logged).not.toContain('crafted-name');
    expect(logged).not.toContain('raw-error text');
  });

  it('keeps role-specific inbox state out of cross-role cache hits', async () => {
    requireAuthContextMock
      .mockResolvedValueOnce({ ctx: { ...authContextMock, role: 'clerk' } })
      .mockResolvedValueOnce({ ctx: { ...authContextMock, role: 'pharmacist' } });

    const firstResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));
    const secondResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));

    if (!firstResponse || !secondResponse) throw new Error('response is required');

    const firstPayload = await firstResponse.json();
    const secondPayload = await secondResponse.json();

    expect(firstPayload.data.role_inboxes.current_role).toBe('clerk');
    expect(secondPayload.data.role_inboxes.current_role).toBe('pharmacist');
  });

  it('does not replay cached workflow PHI after the same user assignment scope changes', async () => {
    careCaseFindManyMock
      .mockResolvedValueOnce([{ id: 'case_1', patient_id: 'patient_1' }])
      .mockResolvedValueOnce([]);

    const firstResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const secondResponse = await GET(createRequest({ 'x-org-id': 'org_1' }));

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(careCaseFindManyMock).toHaveBeenCalledTimes(2);
    expect(cycleGroupByMock).toHaveBeenCalledTimes(2);
    expect(cycleGroupByMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          case_id: { in: [] },
        }),
      }),
    );
  });

  it('keys workflow cache by org, role, user, and local day', () => {
    expect(buildWorkflowCacheKey('org_1', 'clerk', 'user_1', new Date(2026, 2, 27, 12, 0, 0))).toBe(
      'workflow:org_1:clerk:user_1:2026-03-27',
    );
    expect(buildWorkflowCacheKey('org_1', 'clerk', 'user_1', new Date(2026, 2, 28, 12, 0, 0))).toBe(
      'workflow:org_1:clerk:user_1:2026-03-28',
    );
  });

  it('adds a stable assignment-scope fingerprint to scoped workflow cache keys', () => {
    const fingerprint = buildWorkflowAssignmentScopeFingerprint({
      assignedToUserId: 'user_1',
      caseIds: ['case_2', 'case_1'],
      patientIds: ['patient_1'],
      caseIdsByPatient: {
        patient_1: ['case_2', 'case_1'],
      },
    });

    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(
      buildWorkflowCacheKey(
        'org_1',
        'clerk',
        'user_1',
        new Date(2026, 2, 27, 12, 0, 0),
        fingerprint,
      ),
    ).toBe(`workflow:org_1:clerk:user_1:2026-03-27:${fingerprint}`);
    expect(
      buildWorkflowCacheKey(
        'org_1',
        'clerk',
        'user_1',
        new Date(2026, 2, 27, 12, 0, 0),
        fingerprint,
        'phase',
      ),
    ).toBe(`workflow:org_1:clerk:user_1:2026-03-27:${fingerprint}:phase`);
    expect(
      buildWorkflowCacheKey(
        'org_1',
        'clerk',
        'user_1',
        new Date(2026, 2, 27, 12, 0, 0),
        fingerprint,
        'realtime',
      ),
    ).toBe(`workflow:org_1:clerk:user_1:2026-03-27:${fingerprint}:realtime`);
    expect(
      buildWorkflowCacheKey(
        'org_1',
        'clerk',
        'user_1',
        new Date(2026, 2, 27, 12, 0, 0),
        fingerprint,
        'performance',
      ),
    ).toBe(`workflow:org_1:clerk:user_1:2026-03-27:${fingerprint}:performance`);
    expect(
      buildWorkflowAssignmentScopeFingerprint({
        assignedToUserId: 'user_1',
        caseIds: ['case_1', 'case_2'],
        patientIds: ['patient_1'],
        caseIdsByPatient: {
          patient_1: ['case_1', 'case_2'],
        },
      }),
    ).toBe(fingerprint);
    expect(buildWorkflowAssignmentScopeFingerprint({})).toBeUndefined();
  });
});
