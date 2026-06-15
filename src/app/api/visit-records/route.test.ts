import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  getRequestAuthContextMock,
  membershipFindFirstMock,
  patientFindFirstMock,
  queryRawMock,
  processHandoffExtractionMock,
  withOrgContextMock,
  visitScheduleFindFirstMock,
  careCaseFindFirstMock,
  visitRecordFindManyMock,
  visitRecordCreateMock,
  visitRecordFindFirstMock,
  visitScheduleUpdateMock,
  consentRecordFindFirstMock,
  medicationCycleFindFirstMock,
  medicationCycleFindManyMock,
  medicationCycleUpdateMock,
  medicationCycleUpdateManyMock,
  cycleTransitionLogCreateMock,
  workflowExceptionFindFirstMock,
  workflowExceptionCreateMock,
  medicationIssueFindFirstMock,
  medicationIssueCreateMock,
  tracingReportFindFirstMock,
  tracingReportCreateMock,
  communicationRequestFindFirstMock,
  communicationRequestCreateMock,
  residualMedicationFindManyMock,
  residualMedicationDeleteManyMock,
  residualMedicationCreateMock,
  contactPartyFindManyMock,
  firstVisitDocumentFindFirstMock,
  firstVisitDocumentCreateMock,
  firstVisitDocumentUpdateMock,
  taskUpsertMock,
  billingEvidenceUpsertMock,
  listBillingEvidenceBlockersMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getRequestAuthContextMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  queryRawMock: vi.fn(),
  processHandoffExtractionMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  visitRecordFindManyMock: vi.fn(),
  visitRecordCreateMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitScheduleUpdateMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  medicationCycleUpdateMock: vi.fn(),
  medicationCycleUpdateManyMock: vi.fn(),
  cycleTransitionLogCreateMock: vi.fn(),
  workflowExceptionFindFirstMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationIssueCreateMock: vi.fn(),
  tracingReportFindFirstMock: vi.fn(),
  tracingReportCreateMock: vi.fn(),
  communicationRequestFindFirstMock: vi.fn(),
  communicationRequestCreateMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  residualMedicationDeleteManyMock: vi.fn(),
  residualMedicationCreateMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  firstVisitDocumentCreateMock: vi.fn(),
  firstVisitDocumentUpdateMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  billingEvidenceUpsertMock: vi.fn(),
  listBillingEvidenceBlockersMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    $queryRaw: queryRawMock,
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/auth/request-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/request-context')>();
  return {
    ...actual,
    getRequestAuthContext: getRequestAuthContextMock,
  };
});

vi.mock('@/server/services/billing-evidence', () => ({
  upsertBillingEvidenceForVisit: billingEvidenceUpsertMock,
  listBillingEvidenceBlockers: listBillingEvidenceBlockersMock,
}));

vi.mock('@/server/services/visit-handoff', () => ({
  processHandoffExtraction: processHandoffExtractionMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-records', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function createMalformedJsonRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/visit-records', {
    method: 'POST',
    body: '{"schedule_id":',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

const completedVisitStructuredSoap = {
  legacy_debug: undefined,
  subjective: { symptom_checks: [], free_text: '服薬状況を確認' },
  objective: {
    medication_status: 'full_compliance',
    adherence_score: 4,
    side_effect_checks: ['none'],
  },
  assessment: {
    problem_checks: ['interaction_risk'],
  },
  plan: {
    intervention_checks: ['physician_report'],
    free_text: '医師へ報告し次回も確認',
  },
  home_visit_2026: {
    medication_review_completed: true,
    residual_medication_checked: true,
    adverse_event_checked: true,
    polypharmacy_reviewed: true,
    after_hours_contact_confirmed: true,
  },
};

const completedInitialVisitStructuredSoap = {
  ...completedVisitStructuredSoap,
  home_visit_2026: {
    ...completedVisitStructuredSoap.home_visit_2026,
    initial_transition_management: {
      target: true,
      pre_visit_environment_assessed: true,
      medication_risk_assessed: true,
      transition_support_summary: '在宅移行初期の服薬支援体制を確認',
    },
  },
};

function createGetRequest(url = 'http://localhost/api/visit-records') {
  return new NextRequest(url, {
    headers: { 'x-org-id': 'org_1' },
  });
}

describe('/api/visit-records GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRawMock.mockReset();
    authMock.mockResolvedValue({ user: { id: 'user_1', orgId: 'org_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        schedule_id: 'schedule_1',
        patient_id: 'patient_1',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-20T10:00:00.000Z'),
        outcome_status: 'completed',
        soap_subjective: '眠気なし',
        soap_objective: null,
        soap_assessment: null,
        soap_plan: null,
        receipt_person_name: null,
        receipt_person_relation: null,
        receipt_at: null,
        next_visit_suggestion_date: null,
        version: 1,
        created_at: new Date('2026-04-20T09:00:00.000Z'),
        updated_at: new Date('2026-04-20T10:00:00.000Z'),
        schedule: {
          visit_type: 'regular',
          scheduled_date: new Date('2026-04-20T00:00:00.000Z'),
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田太郎',
              name_kana: 'ヤマダタロウ',
            },
          },
        },
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        patient_id: 'patient_1',
        id: 'intake_1',
        prescribed_date: new Date('2026-04-18T00:00:00.000Z'),
        prescriber_name: '佐藤医師',
        prescription_count: BigInt(1),
        drug_names: ['アムロジピン錠5mg'],
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        record_id: 'visit_1',
        visit_count: BigInt(2),
        previous_visit_id: 'visit_prev',
        previous_visit_date: new Date('2026-04-01T10:00:00.000Z'),
        previous_outcome_status: 'completed_with_issue',
        previous_next_visit_suggestion_date: new Date('2026-04-20T00:00:00.000Z'),
      },
    ]);
  });

  it('returns patient context and history summaries so visit pages can check patient-level past records', async () => {
    queryRawMock.mockReset();
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_2',
        schedule_id: 'schedule_2',
        patient_id: 'patient_1',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-22T10:00:00.000Z'),
        outcome_status: 'completed',
        soap_subjective: null,
        soap_objective: null,
        soap_assessment: null,
        soap_plan: null,
        receipt_person_name: null,
        receipt_person_relation: null,
        receipt_at: null,
        next_visit_suggestion_date: null,
        version: 1,
        created_at: new Date('2026-04-22T10:30:00.000Z'),
        updated_at: new Date('2026-04-22T10:30:00.000Z'),
        schedule: null,
      },
      {
        id: 'visit_1',
        schedule_id: 'schedule_1',
        patient_id: 'patient_1',
        pharmacist_id: 'pharmacist_1',
        visit_date: new Date('2026-04-20T10:00:00.000Z'),
        outcome_status: 'completed',
        soap_subjective: '眠気なし',
        soap_objective: null,
        soap_assessment: null,
        soap_plan: null,
        receipt_person_name: null,
        receipt_person_relation: null,
        receipt_at: null,
        next_visit_suggestion_date: null,
        version: 1,
        created_at: new Date('2026-04-20T09:00:00.000Z'),
        updated_at: new Date('2026-04-20T10:00:00.000Z'),
        schedule: {
          visit_type: 'regular',
          scheduled_date: new Date('2026-04-20T00:00:00.000Z'),
          case_: {
            patient: {
              id: 'patient_1',
              name: '山田太郎',
              name_kana: 'ヤマダタロウ',
            },
          },
        },
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        patient_id: 'patient_1',
        id: 'intake_1',
        prescribed_date: new Date('2026-04-18T00:00:00.000Z'),
        prescriber_name: '佐藤医師',
        prescription_count: BigInt(1),
        drug_names: ['アムロジピン錠5mg'],
      },
    ]);
    queryRawMock.mockResolvedValueOnce([
      {
        record_id: 'visit_2',
        visit_count: BigInt(2),
        previous_visit_id: 'visit_1',
        previous_visit_date: new Date('2026-04-20T10:00:00.000Z'),
        previous_outcome_status: 'completed',
        previous_next_visit_suggestion_date: null,
      },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/visit-records?include_history_summary=true&limit=1'),
    );

    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        select: expect.objectContaining({
          schedule: {
            select: expect.objectContaining({
              case_: {
                select: {
                  patient: {
                    select: {
                      id: true,
                      name: true,
                      name_kana: true,
                    },
                  },
                },
              },
            }),
          },
        }),
      }),
    );
    expect(queryRawMock).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'visit_2',
          patient_id: 'patient_1',
          patient_history_summary: {
            prescription_count: 1,
            visit_count: 2,
            latest_prescription: {
              id: 'intake_1',
              prescriber_name: '佐藤医師',
              drug_names: ['アムロジピン錠5mg'],
            },
            previous_visit: {
              id: 'visit_1',
              outcome_status: 'completed',
            },
          },
        },
      ],
      hasMore: true,
      nextCursor: expect.any(String),
    });
  });

  it('uses keyset cursor conditions after the first visit page', async () => {
    const cursor = Buffer.from(
      JSON.stringify({
        visit_date: '2026-04-20T10:00:00.000Z',
        created_at: '2026-04-20T09:00:00.000Z',
        id: 'visit_1',
      }),
      'utf8',
    ).toString('base64url');

    const response = await GET(
      createGetRequest(`http://localhost/api/visit-records?limit=20&cursor=${cursor}`),
    );

    expect(response.status).toBe(200);
    const findManyArgs = visitRecordFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('cursor');
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { visit_date: { lt: new Date('2026-04-20T10:00:00.000Z') } },
            {
              visit_date: new Date('2026-04-20T10:00:00.000Z'),
              created_at: { lt: new Date('2026-04-20T09:00:00.000Z') },
            },
            {
              visit_date: new Date('2026-04-20T10:00:00.000Z'),
              created_at: new Date('2026-04-20T09:00:00.000Z'),
              id: { lt: 'visit_1' },
            },
          ],
        }),
      }),
    );
  });

  it('ignores legacy visit id cursors instead of id cursor paging', async () => {
    const response = await GET(
      createGetRequest('http://localhost/api/visit-records?cursor=visit_1'),
    );

    expect(response.status).toBe(200);
    const findManyArgs = visitRecordFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('cursor');
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs.where).not.toHaveProperty('OR');
  });

  it('skips patient history summary queries unless explicitly requested', async () => {
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(queryRawMock).not.toHaveBeenCalled();
    expect(visitRecordFindManyMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          patient_history_summary: null,
        },
      ],
    });
  });

  it('does not restrict pharmacist list reads by schedule assignment', async () => {
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
  });

  it('does not restrict admin list reads by schedule assignment', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          AND: expect.any(Array),
        }),
      }),
    );
  });
});

describe('/api/visit-records POST', () => {
  const originalTimeZone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });

  afterAll(() => {
    if (originalTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimeZone;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();

    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    getRequestAuthContextMock.mockReturnValue({
      userId: 'user_1',
      orgId: 'org_1',
      role: 'pharmacist',
    });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    patientFindFirstMock.mockResolvedValue({ name: '患者A' });
    processHandoffExtractionMock.mockResolvedValue({
      next_check_items: [],
      ongoing_monitoring: [],
      decision_rationale: '',
      ai_extracted: true,
      ai_confidence: 0.9,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: '2026-04-01T00:00:00Z',
    });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'ready',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      required_visit_support: null,
    });
    visitRecordFindManyMock.mockResolvedValue([{ id: 'record_1' }]);
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
    visitRecordCreateMock.mockResolvedValue({ id: 'record_1' });
    visitRecordFindFirstMock.mockResolvedValue(null);
    residualMedicationFindManyMock.mockResolvedValue([]);
    residualMedicationDeleteManyMock.mockResolvedValue({ count: 0 });
    residualMedicationCreateMock.mockResolvedValue({ id: 'residual_1' });
    contactPartyFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
    firstVisitDocumentCreateMock.mockResolvedValue({ id: 'first_visit_1' });
    firstVisitDocumentUpdateMock.mockResolvedValue({ id: 'first_visit_1' });
    visitScheduleUpdateMock.mockResolvedValue({ id: 'schedule_1' });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'visit_ready',
      version: 1,
      patient_id: 'patient_1',
    });
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1' }]);
    medicationCycleUpdateMock.mockResolvedValue({ id: 'cycle_1' });
    medicationCycleUpdateManyMock.mockResolvedValue({ count: 1 });
    cycleTransitionLogCreateMock.mockResolvedValue({ id: 'transition_1' });
    workflowExceptionFindFirstMock.mockResolvedValue(null);
    workflowExceptionCreateMock.mockResolvedValue({ id: 'exception_1' });
    medicationIssueFindFirstMock.mockResolvedValue(null);
    medicationIssueCreateMock.mockResolvedValue({ id: 'issue_1' });
    tracingReportFindFirstMock.mockResolvedValue(null);
    tracingReportCreateMock.mockResolvedValue({ id: 'tracing_1' });
    communicationRequestFindFirstMock.mockResolvedValue(null);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    taskUpsertMock.mockResolvedValue({ id: 'task_1' });
    billingEvidenceUpsertMock.mockResolvedValue({ id: 'evidence_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          update: visitScheduleUpdateMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        patientInsurance: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        visitRecord: {
          create: visitRecordCreateMock,
          findFirst: visitRecordFindFirstMock,
          findMany: visitRecordFindManyMock,
        },
        residualMedication: {
          findMany: residualMedicationFindManyMock,
          deleteMany: residualMedicationDeleteManyMock,
          create: residualMedicationCreateMock,
        },
        contactParty: {
          findMany: contactPartyFindManyMock,
        },
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
        },
        medicationCycle: {
          findFirst: medicationCycleFindFirstMock,
          findMany: medicationCycleFindManyMock,
          update: medicationCycleUpdateMock,
          updateMany: medicationCycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: cycleTransitionLogCreateMock,
        },
        workflowException: {
          findFirst: workflowExceptionFindFirstMock,
          create: workflowExceptionCreateMock,
        },
        medicationIssue: {
          findFirst: medicationIssueFindFirstMock,
          create: medicationIssueCreateMock,
        },
        tracingReport: {
          findFirst: tracingReportFindFirstMock,
          create: tracingReportCreateMock,
        },
        communicationRequest: {
          findFirst: communicationRequestFindFirstMock,
          create: communicationRequestCreateMock,
        },
        firstVisitDocument: {
          findFirst: firstVisitDocumentFindFirstMock,
          create: firstVisitDocumentCreateMock,
          update: firstVisitDocumentUpdateMock,
        },
        task: {
          upsert: taskUpsertMock,
          create: taskUpsertMock,
        },
      }),
    );
  });

  it('returns 400 when the request patient does not match the scheduled case', async () => {
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_2',
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定に紐づく患者と記録対象患者が一致しません',
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes when carry items are blocked for a visit completion record', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'blocked',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message:
        '持参物が未確定のため訪問記録を作成できません。持参物を確定するか代替手配を記録してください',
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes when partial carry items are completed without acknowledgement', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'partial',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '持参物が一部未確定のため、代替手配または現地対応方針の確認が必要です',
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('records partial carry-item acknowledgement in the visit plan when completing the visit', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'partial',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
          carry_item_warning_acknowledged: true,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          soap_plan: expect.stringContaining('持参物一部未確定の警告確認'),
          // 訪問時点の患者状態スナップショットが create に凍結配線されている
          patient_state_snapshot: expect.objectContaining({
            source: 'visit_record',
            patient: expect.objectContaining({ name: '患者A' }),
          }),
        }),
      }),
    );
  });

  it.each(['ready', null] as const)(
    'ignores carry-item acknowledgement for %s carry-item schedules',
    async (carryItemsStatus) => {
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        schedule_status: 'ready',
        carry_items_status: carryItemsStatus,
        recurrence_rule: null,
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        pharmacist_id: 'user_1',
        site_id: 'site_1',
        time_window_start: null,
        time_window_end: null,
        medication_end_date: null,
        visit_deadline_date: null,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      });

      const response = await POST(
        createRequest(
          {
            schedule_id: 'schedule_1',
            patient_id: 'patient_1',
            visit_date: '2026-03-26',
            outcome_status: 'completed',
            structured_soap: completedVisitStructuredSoap,
            carry_item_warning_acknowledged: true,
          },
          { 'x-org-id': 'org_1' },
        ),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      const createData = visitRecordCreateMock.mock.calls[0]?.[0]?.data as
        | { soap_plan?: string | null }
        | undefined;
      expect(createData?.soap_plan ?? '').not.toContain('持参物一部未確定');
    },
  );

  it.each([
    ['postponed', '延期理由', {}],
    ['cancelled', 'キャンセル理由', {}],
  ] as const)(
    'returns 400 when a blocked carry-item schedule is %s without a reason',
    async (outcomeStatus, messagePart, extraPayload) => {
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        schedule_status: 'ready',
        carry_items_status: 'blocked',
        recurrence_rule: null,
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        pharmacist_id: 'user_1',
        site_id: 'site_1',
        time_window_start: null,
        time_window_end: null,
        medication_end_date: null,
        visit_deadline_date: null,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      });

      const response = await POST(
        createRequest(
          {
            schedule_id: 'schedule_1',
            patient_id: 'patient_1',
            visit_date: '2026-03-26',
            outcome_status: outcomeStatus,
            ...extraPayload,
          },
          { 'x-org-id': 'org_1' },
        ),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining(messagePart),
      });
      expect(visitRecordCreateMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    },
  );

  it('allows a blocked carry-item schedule to be postponed without creating a completed visit', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'blocked',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'postponed',
          postpone_reason: '持参物が未確定のため延期',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'postponed' },
    });
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('allows a blocked carry-item schedule to be cancelled with a reason', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      carry_items_status: 'blocked',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
      case_: {
        primary_pharmacist_id: 'user_primary',
        backup_pharmacist_id: null,
      },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'cancelled',
          cancellation_reason: '持参物が未確定で安全に訪問できないためキャンセル',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'cancelled' },
    });
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('returns existing conflict dates by the local pharmacy calendar day', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'record_existing',
      version: 3,
      patient_id: 'patient_1',
      visit_date: new Date('2026-03-25T15:30:00.000Z'),
      outcome_status: 'completed',
      soap_subjective: '前回記録',
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      next_visit_suggestion_date: null,
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        existing_record: {
          id: 'record_existing',
          visit_date: '2026-03-26',
        },
      },
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before loading the visit schedule', async () => {
    const response = await POST(createRequest(['schedule_1'], { 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before loading the visit schedule', async () => {
    const response = await POST(createMalformedJsonRequest({ 'x-org-id': 'org_1' }));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it.each(['pharmacist', 'pharmacist_trainee'] as const)(
    'allows a %s with org-wide access to create a record on a schedule assigned to another user',
    async (role) => {
      membershipFindFirstMock.mockResolvedValue({ role });
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        schedule_status: 'ready',
        carry_items_status: 'ready',
        recurrence_rule: null,
        cycle_id: 'cycle_1',
        visit_type: 'regular',
        pharmacist_id: 'user_other',
        site_id: 'site_1',
        time_window_start: null,
        time_window_end: null,
        medication_end_date: null,
        visit_deadline_date: null,
        case_: {
          primary_pharmacist_id: 'user_primary',
          backup_pharmacist_id: null,
        },
      });

      const response = await POST(
        createRequest(
          {
            schedule_id: 'schedule_1',
            patient_id: 'patient_1',
            visit_date: '2026-03-26',
            outcome_status: 'completed',
            structured_soap: completedVisitStructuredSoap,
          },
          { 'x-org-id': 'org_1' },
        ),
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(201);
      expect(careCaseFindFirstMock).toHaveBeenCalled();
      expect(visitRecordCreateMock).toHaveBeenCalled();
    },
  );

  it('marks postponed visits as postponed without advancing the visit workflow', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'postponed',
          postpone_reason: '発熱のため延期',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: 'schedule_1' },
      data: { schedule_status: 'postponed' },
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes when completing a visit without required medication-management readiness', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問完了には訪問薬剤管理の必須確認が必要です',
      details: {
        home_visit_2026_readiness: expect.arrayContaining(['残薬確認']),
      },
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
  });

  it('auto-suggests the next visit date from recurrence rule when none is provided', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: new Date('2026-04-30T00:00:00.000Z'),
      visit_deadline_date: null,
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          next_visit_suggestion_date: new Date('2026-04-01T00:00:00.000Z'),
        }),
      }),
    );
    expect(
      (visitRecordCreateMock.mock.calls[0][0].data.structured_soap as Record<string, unknown>)
        .legacy_debug,
    ).toBeUndefined();
    await expect(response.json()).resolves.toMatchObject({
      suggestedSchedule: {
        suggested_date: '2026-04-01',
        auto_generated: true,
        interval_days: 6,
      },
    });
  });

  it('returns auto-suggested visit dates by the local pharmacy calendar day', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=FR',
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: new Date('2026-04-30T00:00:00.000Z'),
      visit_deadline_date: null,
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-25T15:30:00.000Z',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      suggestedSchedule: {
        suggested_date: '2026-03-27',
        auto_generated: true,
        interval_days: 1,
      },
    });
  });

  it('advances the medication cycle to visit completed through transition logging', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationCycleUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'cycle_1', version: 1 }),
        data: expect.objectContaining({ overall_status: 'visit_completed' }),
      }),
    );
    expect(cycleTransitionLogCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycle_id: 'cycle_1',
          from_status: 'visit_ready',
          to_status: 'visit_completed',
          note: '訪問記録作成に伴う訪問完了',
        }),
      }),
    );
  });

  it('creates tracing follow-up work for reduction targets and raises an exception for prohibited reductions', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedVisitStructuredSoap,
          residual_medications: [
            {
              drug_name: 'アムロジピン錠5mg',
              drug_code: '2149001',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
            {
              drug_name: 'オキシコドン徐放錠',
              drug_code: '8114001',
              remaining_quantity: 14,
              prescribed_daily_dose: 1,
              is_prohibited_reduction: true,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: 'アムロジピン錠5mg の残薬調整',
        category: 'adherence',
      }),
      select: { id: true },
    });
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        issue_id: 'issue_1',
        status: 'draft',
      }),
      select: { id: true },
    });
    expect(communicationRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        request_type: 'tracing_report',
        related_entity_type: 'tracing_report',
        recipient_role: 'physician',
        status: 'draft',
      }),
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exception_type: 'reduction_prohibited_drug',
        severity: 'critical',
      }),
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
        }),
      }),
    );
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'residual_reduction_review',
        }),
      }),
    );
  });

  it('creates a first-visit document with delivery record for completed initial visits', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      schedule_status: 'ready',
      recurrence_rule: null,
      cycle_id: 'cycle_1',
      visit_type: 'initial',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: null,
      visit_deadline_date: null,
    });
    contactPartyFindManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '長男 山田',
        relation: 'child',
        phone: '090-0000-1111',
        email: null,
        fax: null,
        organization_name: null,
        department: null,
        is_primary: true,
        is_emergency_contact: true,
      },
    ]);

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedInitialVisitStructuredSoap,
          receipt_person_name: '長男 山田',
          receipt_at: '2026-03-26T10:30',
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        document_url: '/api/visit-records/record_1/pdf',
        delivered_at: new Date('2026-03-26T10:30'),
        delivered_to: '長男 山田',
        emergency_contacts: [
          expect.objectContaining({
            id: 'contact_1',
            name: '長男 山田',
            relation: 'child',
            phone: '090-0000-1111',
          }),
        ],
      }),
    });
    expect(firstVisitDocumentUpdateMock).not.toHaveBeenCalled();
  });

  it('kicks off handoff extraction without blocking the save response when structured SOAP is provided', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(processHandoffExtractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        visitRecordId: 'record_1',
        patientId: 'patient_1',
        patientName: '患者A',
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
        }),
      }),
    );
  });
});
