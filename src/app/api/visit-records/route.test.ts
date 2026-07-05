import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  getRequestAuthContextMock,
  loggerErrorMock,
  loggerWarnMock,
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
  visitRecordUpdateManyMock,
  visitScheduleUpdateManyMock,
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
  drugMasterFindManyMock,
  patientLabObservationDeleteManyMock,
  patientLabObservationCreateManyMock,
  contactPartyFindManyMock,
  firstVisitDocumentFindFirstMock,
  firstVisitDocumentCreateMock,
  firstVisitDocumentUpdateMock,
  templateFindFirstMock,
  auditLogCreateMock,
  taskUpsertMock,
  billingEvidenceUpsertMock,
  listBillingEvidenceBlockersMock,
  buildPatientStateSnapshotMock,
  allocateDisplayIdMock,
  allocateDisplayIdRangeMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  getRequestAuthContextMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
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
  visitRecordUpdateManyMock: vi.fn(),
  visitScheduleUpdateManyMock: vi.fn(),
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
  drugMasterFindManyMock: vi.fn(),
  patientLabObservationDeleteManyMock: vi.fn(),
  patientLabObservationCreateManyMock: vi.fn(),
  contactPartyFindManyMock: vi.fn(),
  firstVisitDocumentFindFirstMock: vi.fn(),
  firstVisitDocumentCreateMock: vi.fn(),
  firstVisitDocumentUpdateMock: vi.fn(),
  templateFindFirstMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  billingEvidenceUpsertMock: vi.fn(),
  listBillingEvidenceBlockersMock: vi.fn(),
  buildPatientStateSnapshotMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
  allocateDisplayIdRangeMock: vi.fn(),
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

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
  allocateDisplayIdRange: allocateDisplayIdRangeMock,
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

vi.mock('@/server/services/visit-handoff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/visit-handoff')>();
  return {
    ...actual,
    processHandoffExtraction: processHandoffExtractionMock,
    VisitHandoffStaleRecordError: class VisitHandoffStaleRecordError extends Error {},
  };
});

vi.mock('@/server/services/patient-state-snapshot', () => ({
  buildPatientStateSnapshot: buildPatientStateSnapshotMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
    warn: loggerWarnMock,
  },
}));

import { GET as rawGET, POST as rawPOST } from './route';

const GET = (req: NextRequest) => rawGET(req);
const POST = (req: NextRequest) => rawPOST(req);

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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function expectVisitScheduleStatusClaim(scheduleStatus: string) {
  expect(visitScheduleUpdateManyMock).toHaveBeenCalledWith({
    where: {
      id: 'schedule_1',
      org_id: 'org_1',
      version: 4,
      schedule_status: 'ready',
    },
    data: {
      schedule_status: scheduleStatus,
      version: { increment: 1 },
    },
  });
}

function createVisitScheduleFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    version: 4,
    schedule_status: 'ready',
    carry_items_status: 'ready',
    recurrence_rule: null,
    scheduled_date: new Date('2026-03-25T00:00:00.000Z'),
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
    ...overrides,
  };
}

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
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
        medications: [{ drug_name: 'アムロジピン錠5mg', drug_code: '2149001F1020' }],
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

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1%20', 'patient_id', '患者IDの形式が不正です'],
    ['pharmacist_id=%20%20', 'pharmacist_id', '薬剤師IDを指定してください'],
    ['pharmacist_id=%20pharmacist_1', 'pharmacist_id', '薬剤師IDの形式が不正です'],
    ['date_from=', 'date_from', '日付形式が不正です（YYYY-MM-DD）'],
    ['date_from=%202026-04-20', 'date_from', '日付形式が不正です（YYYY-MM-DD）'],
    ['date_to=%20', 'date_to', '日付形式が不正です（YYYY-MM-DD）'],
  ])(
    'rejects blank present filter query "%s" before loading visit records',
    async (query, fieldName, message) => {
      const response = await GET(createGetRequest(`http://localhost/api/visit-records?${query}`));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [message],
        },
      });
    },
  );

  it('returns a sanitized no-store 500 without raw logging when visit record listing fails unexpectedly', async () => {
    const rawError = new Error('患者 山田太郎 raw visit record listing secret');
    visitRecordFindManyMock.mockRejectedValueOnce(rawError);

    const response = await GET(createGetRequest('http://localhost/api/visit-records'));

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw visit record');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'visit_records_get_unhandled_error',
        route: '/api/visit-records',
        method: 'GET',
        status: 500,
      }),
      rawError,
    );
    const [routeContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(rawError);
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('raw visit record');
  });

  it.each([
    ['patient_id=patient_1&patient_id=', 'patient_id'],
    ['pharmacist_id=pharmacist_1&pharmacist_id=other', 'pharmacist_id'],
    ['date_from=2026-04-01&date_from=2026-04-02', 'date_from'],
    ['date_to=2026-04-20&date_to=invalid', 'date_to'],
  ])(
    'rejects duplicate filter query "%s" before loading visit records',
    async (query, fieldName) => {
      const response = await GET(createGetRequest(`http://localhost/api/visit-records?${query}`));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
    },
  );

  it.each([
    ['date_from=2026-02-31', 'date_from', '日付形式が不正です（YYYY-MM-DD）'],
    ['date_to=invalid', 'date_to', '日付形式が不正です（YYYY-MM-DD）'],
    [
      'date_from=2026-04-21&date_to=2026-04-20',
      'date_to',
      'date_to は date_from 以降を指定してください',
    ],
  ])(
    'rejects invalid date filter query "%s" before loading visit records',
    async (query, fieldName, message) => {
      const response = await GET(createGetRequest(`http://localhost/api/visit-records?${query}`));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [message],
        },
      });
    },
  );

  it.each([
    [
      'include_history_summary=',
      'include_history_summary',
      'include_history_summary は true または false で指定してください',
    ],
    [
      'include_history_summary=true%20',
      'include_history_summary',
      'include_history_summary は true または false で指定してください',
    ],
    [
      'include_attachments=yes',
      'include_attachments',
      'include_attachments は true または false で指定してください',
    ],
    [
      'include_attachments=%20true',
      'include_attachments',
      'include_attachments は true または false で指定してください',
    ],
    ['view=', 'view', 'view は evidence_gallery を指定してください'],
    ['view=%20evidence_gallery', 'view', 'view は evidence_gallery を指定してください'],
    ['view=summary', 'view', 'view は evidence_gallery を指定してください'],
    [
      'view=evidence_gallery',
      'view',
      'view=evidence_gallery は include_attachments=true と一緒に指定してください',
    ],
    [
      'include_attachments=false&view=evidence_gallery',
      'view',
      'view=evidence_gallery は include_attachments=true と一緒に指定してください',
    ],
  ])(
    'rejects invalid view mode query "%s" before loading visit records',
    async (query, fieldName, message) => {
      const response = await GET(createGetRequest(`http://localhost/api/visit-records?${query}`));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(queryRawMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [message],
        },
      });
    },
  );

  it.each([
    ['include_history_summary=true&include_history_summary=false', 'include_history_summary'],
    ['include_attachments=true&include_attachments=false', 'include_attachments'],
    ['include_attachments=true&include_attachments=true', 'include_attachments'],
    ['view=evidence_gallery&view=summary', 'view'],
  ])(
    'rejects duplicate view mode query "%s" before loading visit records',
    async (query, fieldName) => {
      const response = await GET(createGetRequest(`http://localhost/api/visit-records?${query}`));

      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(queryRawMock).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
    },
  );

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
        drug_names: ['アムロジピン錠5mg', '同名薬', '同名薬'],
        medications: [
          { drug_name: 'アムロジピン錠5mg', drug_code: '2149001F1020' },
          { drug_name: '同名薬', drug_code: '9999001F1020' },
          { drug_name: '同名薬', drug_code: null },
        ],
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
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
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
              drug_names: ['アムロジピン錠5mg', '同名薬', '同名薬'],
              medications: [
                { drug_name: 'アムロジピン錠5mg', drug_code: '2149001F1020' },
                { drug_name: '同名薬', drug_code: '9999001F1020' },
                { drug_name: '同名薬', drug_code: null },
              ],
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

  it('returns normalized attachment summaries only when explicitly requested', async () => {
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
        attachments: [
          {
            file_id: 'file_1',
            file_name: '残薬写真_01.jpg',
            mime_type: 'image/jpeg',
            size_bytes: 1024,
            uploaded_at: '2026-04-20T09:05:00.000Z',
            kind: 'photo',
          },
          {
            file_id: 'file_2',
            file_name: '説明書.pdf',
            mime_type: 'application/pdf',
            size_bytes: 2048,
            uploaded_at: null,
            kind: 'attachment',
          },
          { file_id: 'broken' },
        ],
        schedule: null,
      },
    ]);

    const response = await GET(
      createGetRequest('http://localhost/api/visit-records?include_attachments=true&limit=12'),
    );

    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          attachments: true,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'visit_1',
          attachments: [
            {
              file_id: 'file_1',
              file_name: '残薬写真_01.jpg',
              uploaded_at: '2026-04-20T09:05:00.000Z',
              kind: 'photo',
            },
            {
              file_id: 'file_2',
              file_name: '説明書.pdf',
              uploaded_at: null,
              kind: 'attachment',
            },
          ],
        },
      ],
    });
  });

  it('uses a narrow projection for the evidence gallery attachment view', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      {
        id: 'visit_1',
        visit_date: new Date('2026-04-20T10:00:00.000Z'),
        created_at: new Date('2026-04-20T09:00:00.000Z'),
        attachments: [
          {
            file_id: 'file_1',
            file_name: '残薬写真_01.jpg',
            mime_type: 'image/jpeg',
            size_bytes: 1024,
            uploaded_at: '2026-04-20T09:05:00.000Z',
            kind: 'photo',
          },
        ],
      },
    ]);

    const response = await GET(
      createGetRequest(
        'http://localhost/api/visit-records?include_attachments=true&view=evidence_gallery&limit=12',
      ),
    );

    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: {
          id: true,
          visit_date: true,
          created_at: true,
          attachments: true,
        },
      }),
    );
    const body = await response.json();
    expect(body.data[0]).toEqual({
      id: 'visit_1',
      visit_date: '2026-04-20T10:00:00.000Z',
      created_at: '2026-04-20T09:00:00.000Z',
      attachments: [
        {
          file_id: 'file_1',
          file_name: '残薬写真_01.jpg',
          uploaded_at: '2026-04-20T09:05:00.000Z',
          kind: 'photo',
        },
      ],
    });
    expect(body.data[0]).not.toHaveProperty('soap_subjective');
    expect(body.data[0]).not.toHaveProperty('schedule');
    expect(body.data[0]).not.toHaveProperty('patient_history_summary');
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
    visitRecordFindFirstMock.mockReset();
    visitRecordCreateMock.mockReset();
    visitRecordUpdateManyMock.mockReset();
    visitScheduleUpdateManyMock.mockReset();

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
    visitScheduleFindFirstMock.mockResolvedValue(createVisitScheduleFixture());
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      required_visit_support: null,
    });
    visitRecordFindManyMock.mockResolvedValue([{ id: 'record_1' }]);
    listBillingEvidenceBlockersMock.mockResolvedValue([]);
    buildPatientStateSnapshotMock.mockResolvedValue({
      source: 'visit_record',
      patient: { id: 'patient_1', name: '患者A' },
    });
    visitRecordCreateMock.mockResolvedValue({ id: 'record_1', version: 1 });
    visitRecordFindFirstMock.mockResolvedValue(null);
    visitRecordUpdateManyMock.mockResolvedValue({ count: 1 });
    residualMedicationFindManyMock.mockResolvedValue([]);
    residualMedicationDeleteManyMock.mockResolvedValue({ count: 0 });
    residualMedicationCreateMock.mockResolvedValue({ id: 'residual_1' });
    drugMasterFindManyMock.mockResolvedValue([]);
    patientLabObservationDeleteManyMock.mockResolvedValue({ count: 0 });
    patientLabObservationCreateManyMock.mockResolvedValue({ count: 1 });
    contactPartyFindManyMock.mockResolvedValue([]);
    firstVisitDocumentFindFirstMock.mockResolvedValue(null);
    firstVisitDocumentCreateMock.mockResolvedValue({ id: 'first_visit_1' });
    firstVisitDocumentUpdateMock.mockResolvedValue({ id: 'first_visit_1' });
    templateFindFirstMock.mockResolvedValue({
      id: 'template_contract_2026',
      name: '居宅療養管理指導契約書 2026年版',
      template_type: 'contract_document',
      version: 2,
    });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    visitScheduleUpdateManyMock.mockResolvedValue({ count: 1 });
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
    medicationIssueCreateMock.mockResolvedValue({
      id: 'issue_1',
      display_id: 'miss0000000001',
    });
    allocateDisplayIdMock.mockResolvedValue('miss0000000001');
    allocateDisplayIdRangeMock.mockImplementation(
      async (_tx, model: string, _orgId: string, amount: number) => {
        const prefix = model === 'ResidualMedication' ? 'rmed' : 'plab';
        return Array.from(
          { length: amount },
          (_, index) => `${prefix}${String(index + 1).padStart(10, '0')}`,
        );
      },
    );
    tracingReportFindFirstMock.mockResolvedValue(null);
    tracingReportCreateMock.mockResolvedValue({ id: 'tracing_1' });
    communicationRequestFindFirstMock.mockResolvedValue(null);
    communicationRequestCreateMock.mockResolvedValue({ id: 'request_1' });
    taskUpsertMock.mockResolvedValue({ id: 'task_1', display_id: 'task0000000001' });
    billingEvidenceUpsertMock.mockResolvedValue({ id: 'evidence_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          updateMany: visitScheduleUpdateManyMock,
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
          updateMany: visitRecordUpdateManyMock,
        },
        residualMedication: {
          findMany: residualMedicationFindManyMock,
          deleteMany: residualMedicationDeleteManyMock,
          create: residualMedicationCreateMock,
        },
        drugMaster: {
          findMany: drugMasterFindManyMock,
        },
        patientLabObservation: {
          deleteMany: patientLabObservationDeleteManyMock,
          createMany: patientLabObservationCreateManyMock,
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
        template: {
          findFirst: templateFindFirstMock,
        },
        auditLog: {
          create: auditLogCreateMock,
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

  it.each(['completed', 'cancelled', 'postponed', 'rescheduled', 'no_show'] as const)(
    'rejects new records for %s schedules before clinical save side effects',
    async (scheduleStatus) => {
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        version: 4,
        schedule_status: scheduleStatus,
        carry_items_status: 'ready',
        recurrence_rule: null,
        scheduled_date: new Date('2026-03-25T00:00:00.000Z'),
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
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        code: 'WORKFLOW_CONFLICT',
        message: '訪問予定が同時に更新されました。再読み込みしてください',
        details: {
          current_schedule_status: scheduleStatus,
        },
      });
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(visitRecordCreateMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(taskUpsertMock).not.toHaveBeenCalled();
    },
  );

  it('returns conflict when the schedule status changes before the guarded save claim', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce(createVisitScheduleFixture())
      .mockResolvedValueOnce({
        schedule_status: 'cancelled',
      });
    visitScheduleUpdateManyMock.mockResolvedValueOnce({ count: 0 });

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
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定が同時に更新されました。再読み込みしてください',
      details: {
        current_schedule_status: 'cancelled',
      },
    });
    expectVisitScheduleStatusClaim('completed');
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(billingEvidenceUpsertMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes when carry items are blocked for a visit completion record', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('returns 400 before writes when partial carry items are completed without acknowledgement', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
      version: 4,
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

  it('persists explicit visit execution timestamps on create without inferring the end time', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          visit_started_at: '2026-03-26T01:00:00.000Z',
          visit_ended_at: '2026-03-26T01:35:00.000Z',
          outcome_status: 'completed',
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
          visit_started_at: new Date('2026-03-26T01:00:00.000Z'),
          visit_ended_at: new Date('2026-03-26T01:35:00.000Z'),
        }),
      }),
    );
  });

  it('logs only sanitized patient-state snapshot failure metadata and still saves the visit record', async () => {
    const rawError = new Error('患者 山田太郎 medication=アムロジピン raw snapshot secret');
    buildPatientStateSnapshotMock.mockRejectedValueOnce(rawError);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
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
      expect(visitRecordCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            patient_state_snapshot: undefined,
          }),
        }),
      );
      expect(loggerErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'visit_records_patient_state_snapshot_build_failed',
          route: '/api/visit-records',
          operation: 'build_patient_state_snapshot',
        }),
        rawError,
      );
      const [routeContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
      expect(logError).toBe(rawError);
      expect(routeContext).not.toHaveProperty('error_name');
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[visit-records] patient_state_snapshot build failed',
        rawError,
      );
      const serializedRouteContext = JSON.stringify(routeContext);
      expect(serializedRouteContext).not.toContain('山田太郎');
      expect(serializedRouteContext).not.toContain('アムロジピン');
      expect(serializedRouteContext).not.toContain('raw snapshot secret');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('山田太郎');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('アムロジピン');
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('raw snapshot secret');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it.each(['ready', null] as const)(
    'ignores carry-item acknowledgement for %s carry-item schedules',
    async (carryItemsStatus) => {
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        version: 4,
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
        version: 4,
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
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    },
  );

  it('allows a blocked carry-item schedule to be postponed without creating a completed visit', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    expectVisitScheduleStatusClaim('postponed');
    expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
  });

  it('allows a blocked carry-item schedule to be cancelled with a reason', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    expectVisitScheduleStatusClaim('cancelled');
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

  it('maps concurrent schedule record creation races to an existing-record conflict', async () => {
    visitRecordCreateMock.mockRejectedValueOnce(createUniqueConstraintError());
    visitRecordFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'record_existing',
      version: 1,
      patient_id: 'patient_1',
      visit_date: new Date('2026-03-26T00:00:00.000Z'),
      outcome_status: 'completed',
      soap_subjective: '別端末で保存済み',
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
        },
      },
    });
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects stale previous visit reuse metadata before creating a visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'previous_visit_1',
      patient_id: 'patient_1',
      version: 5,
      updated_at: new Date('2026-04-02T03:00:00.000Z'),
      schedule: { case_id: 'case_1' },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: {
            ...completedVisitStructuredSoap,
            previous_visit_reuse: {
              source_visit_record_id: 'previous_visit_1',
              source_visit_record_version: 4,
              source_visit_record_updated_at: '2026-04-01T03:00:00.000Z',
              carry_forward_items: ['眠気の継続確認'],
            },
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        reason: 'source_version_conflict',
      },
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects previous visit reuse without source revision metadata before creating a visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'previous_visit_1',
      patient_id: 'patient_1',
      version: 5,
      updated_at: new Date('2026-04-02T03:00:00.000Z'),
      schedule: { case_id: 'case_1' },
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: {
            ...completedVisitStructuredSoap,
            previous_visit_reuse: {
              source_visit_record_id: 'previous_visit_1',
              carry_forward_items: ['眠気の継続確認'],
            },
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        reason: 'source_revision_missing',
      },
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
  });

  it('rejects calendar-overflow visit and receipt dates before loading the visit schedule', async () => {
    const visitDateResponse = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-02-30',
          outcome_status: 'completed',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );
    const receiptResponse = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          receipt_at: '2026-02-30T10:00',
          structured_soap: completedVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!visitDateResponse || !receiptResponse) throw new Error('response is required');
    expect(visitDateResponse.status).toBe(400);
    expect(receiptResponse.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleFindFirstMock).not.toHaveBeenCalled();
  });

  it('rejects visit end timestamps without a start timestamp before loading the visit schedule', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          visit_ended_at: '2026-03-26T01:35:00.000Z',
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
      details: {
        visit_ended_at: ['訪問終了時刻を記録するには訪問開始時刻が必要です'],
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
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
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
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
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when visit record creation fails unexpectedly', async () => {
    const rawError = new Error('患者 山田太郎 raw visit record create secret');
    withOrgContextMock.mockRejectedValueOnce(rawError);

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
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw visit record');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'visit_records_post_unhandled_error',
        route: '/api/visit-records',
        method: 'POST',
        status: 500,
      }),
      rawError,
    );
    const [routeContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(rawError);
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('山田太郎');
    expect(serializedRouteContext).not.toContain('raw visit record');
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'pharmacist'] as const)(
    'allows a %s with org-wide access to create a record on a schedule assigned to another user',
    async (role) => {
      membershipFindFirstMock.mockResolvedValue({ role });
      visitScheduleFindFirstMock.mockResolvedValue({
        id: 'schedule_1',
        case_id: 'case_1',
        version: 4,
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
      expectSensitiveNoStore(response);
      expect(careCaseFindFirstMock).toHaveBeenCalled();
      expect(visitRecordCreateMock).toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).toHaveBeenCalled();
    },
  );

  it('denies an unassigned pharmacist trainee before creating visit-record side effects', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUTH_FORBIDDEN',
      message: 'この訪問予定の記録を作成する権限がありません',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledOnce();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(drugMasterFindManyMock).not.toHaveBeenCalled();
    expect(buildPatientStateSnapshotMock).not.toHaveBeenCalled();
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(residualMedicationDeleteManyMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
    expect(patientLabObservationDeleteManyMock).not.toHaveBeenCalled();
    expect(patientLabObservationCreateManyMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
    expect(firstVisitDocumentUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(billingEvidenceUpsertMock).not.toHaveBeenCalled();
    expect(processHandoffExtractionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['completed', { structured_soap: completedVisitStructuredSoap }],
    ['completed_with_issue', { structured_soap: completedVisitStructuredSoap }],
    ['revisit_needed', { revisit_reason: '残薬確認のため再訪問' }],
    ['delivery_only', {}],
    ['postponed', { postpone_reason: '発熱のため延期' }],
    ['cancelled', { cancellation_reason: '入院のため中止' }],
  ] as const)(
    'denies an assigned pharmacist trainee before finalizing visit outcome %s',
    async (outcomeStatus, extraPayload) => {
      membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist_trainee' });

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
      expect(response.status).toBe(403);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'AUTH_FORBIDDEN',
        message: '訪問結果の確定には薬剤師の確認が必要です',
      });
      expect(visitScheduleFindFirstMock).toHaveBeenCalledOnce();
      expect(careCaseFindFirstMock).not.toHaveBeenCalled();
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(visitRecordCreateMock).not.toHaveBeenCalled();
      expect(visitRecordUpdateManyMock).not.toHaveBeenCalled();
      expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
      expect(listBillingEvidenceBlockersMock).not.toHaveBeenCalled();
      expect(billingEvidenceUpsertMock).not.toHaveBeenCalled();
      expect(buildPatientStateSnapshotMock).not.toHaveBeenCalled();
      expect(drugMasterFindManyMock).not.toHaveBeenCalled();
      expect(residualMedicationDeleteManyMock).not.toHaveBeenCalled();
      expect(residualMedicationCreateMock).not.toHaveBeenCalled();
      expect(patientLabObservationDeleteManyMock).not.toHaveBeenCalled();
      expect(patientLabObservationCreateManyMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentFindFirstMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
      expect(firstVisitDocumentUpdateMock).not.toHaveBeenCalled();
      expect(templateFindFirstMock).not.toHaveBeenCalled();
      expect(auditLogCreateMock).not.toHaveBeenCalled();
      expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
      expect(medicationIssueCreateMock).not.toHaveBeenCalled();
      expect(tracingReportFindFirstMock).not.toHaveBeenCalled();
      expect(tracingReportCreateMock).not.toHaveBeenCalled();
      expect(communicationRequestFindFirstMock).not.toHaveBeenCalled();
      expect(communicationRequestCreateMock).not.toHaveBeenCalled();
      expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
      expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
      expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
      expect(medicationCycleUpdateMock).not.toHaveBeenCalled();
      expect(medicationCycleUpdateManyMock).not.toHaveBeenCalled();
      expect(cycleTransitionLogCreateMock).not.toHaveBeenCalled();
      expect(workflowExceptionFindFirstMock).not.toHaveBeenCalled();
      expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
      expect(taskUpsertMock).not.toHaveBeenCalled();
      expect(processHandoffExtractionMock).not.toHaveBeenCalled();
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
    expectVisitScheduleStatusClaim('postponed');
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
    expect(visitScheduleUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindFirstMock).not.toHaveBeenCalled();
  });

  it('auto-suggests the next visit date from recurrence rule when none is provided', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      scheduled_date: new Date('2026-03-25T00:00:00.000Z'),
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

  it('keeps auto-suggested biweekly visits anchored to the original scheduled date', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE',
      scheduled_date: new Date('2026-07-01T00:00:00.000Z'),
      cycle_id: 'cycle_1',
      visit_type: 'regular',
      pharmacist_id: 'user_1',
      site_id: 'site_1',
      time_window_start: null,
      time_window_end: null,
      medication_end_date: new Date('2026-07-31T00:00:00.000Z'),
      visit_deadline_date: null,
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-07-08',
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
          next_visit_suggestion_date: new Date('2026-07-15T00:00:00.000Z'),
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      suggestedSchedule: {
        suggested_date: '2026-07-15',
        auto_generated: true,
        interval_days: 7,
      },
    });
  });

  it('returns auto-suggested visit dates by the local pharmacy calendar day', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
      schedule_status: 'ready',
      recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=FR',
      scheduled_date: new Date('2026-03-27T00:00:00.000Z'),
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
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { title: 'アムロジピン錠5mg（2149001） の残薬調整' },
          { title: { contains: '（2149001） の残薬調整' } },
        ]),
      }),
      select: { id: true },
    });
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'miss0000000001',
        title: 'アムロジピン錠5mg（2149001） の残薬調整',
        description: expect.stringContaining('アムロジピン錠5mg（2149001）'),
        category: 'adherence',
      }),
      select: { id: true },
    });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({
        medicationIssue: expect.objectContaining({ create: medicationIssueCreateMock }),
      }),
      'MedicationIssue',
      'org_1',
    );
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
        description: expect.stringContaining('オキシコドン徐放錠（8114001）'),
        severity: 'critical',
      }),
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
          title: 'アムロジピン錠5mg（2149001） の残薬調整を確認',
          dedupe_key: 'tracing-report-followup:record_1:code:2149001',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing_1',
          metadata: expect.objectContaining({
            drug_name: 'アムロジピン錠5mg',
            drug_code: '2149001',
            drug_identity_key: 'code:2149001',
          }),
        }),
      }),
    );
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'residual_reduction_review',
          description: expect.stringContaining('オキシコドン徐放錠（8114001）'),
          metadata: expect.objectContaining({
            drugs: [
              expect.objectContaining({
                drug_name: 'オキシコドン徐放錠',
                drug_code: '8114001',
                drug_identity_key: 'code:8114001',
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('uses residual medication DrugMaster IDs before drug_code for persistence and task identity', async () => {
    drugMasterFindManyMock.mockResolvedValue([{ id: 'drug_master_amlodipine' }]);

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
              drug_master_id: ' drug_master_amlodipine ',
              drug_code: '2149001',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: ['drug_master_amlodipine'] } },
      select: { id: true },
    });
    expect(residualMedicationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          display_id: 'rmed0000000001',
          drug_master_id: 'drug_master_amlodipine',
          drug_code: '2149001',
        }),
      }),
    );
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: expect.objectContaining({
          drug_master_id: 'drug_master_amlodipine',
          drug_code: '2149001',
        }),
      }),
      select: { id: true },
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
          dedupe_key: 'tracing-report-followup:record_1:master:drug_master_amlodipine',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing_1',
          metadata: expect.objectContaining({
            drug_master_id: 'drug_master_amlodipine',
            drug_code: '2149001',
            drug_identity_key: 'master:drug_master_amlodipine',
          }),
        }),
      }),
    );
  });

  it('rejects unknown residual medication DrugMaster IDs before creating visit-derived rows', async () => {
    drugMasterFindManyMock.mockResolvedValue([]);

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
              drug_master_id: 'missing_master',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        drug_master_id: ['存在する医薬品マスターを選択してください'],
      },
    });
    expect(visitRecordCreateMock).not.toHaveBeenCalled();
    expect(residualMedicationDeleteManyMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdRangeMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
  });

  it('reuses residual reduction issues by drug_code when the medication name changes', async () => {
    medicationIssueFindFirstMock.mockResolvedValueOnce({ id: 'issue_existing_by_code' });

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
              drug_name: 'アムロジピンOD錠5mg',
              drug_code: '2149001',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        patient_id: 'patient_1',
        case_id: 'case_1',
        OR: expect.arrayContaining([
          { title: 'アムロジピンOD錠5mg（2149001） の残薬調整' },
          { title: { contains: '（2149001） の残薬調整' } },
        ]),
      }),
      select: { id: true },
    });
    expect(medicationIssueCreateMock).not.toHaveBeenCalled();
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(tracingReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: 'patient_1',
        issue_id: 'issue_existing_by_code',
        status: 'draft',
      }),
      select: { id: true },
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
          dedupe_key: 'tracing-report-followup:record_1:code:2149001',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing_1',
          metadata: expect.objectContaining({
            drug_name: 'アムロジピンOD錠5mg',
            drug_code: '2149001',
            drug_identity_key: 'code:2149001',
          }),
        }),
      }),
    );
  });

  it('keeps residual reduction issue lookup exact-title only for uncoded medications', async () => {
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
              drug_name: '名称未確定薬',
              remaining_quantity: 30,
              prescribed_daily_dose: 2,
              is_prohibited_reduction: false,
            },
          ],
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        title: '名称未確定薬 の残薬調整',
      }),
      select: { id: true },
    });
    expect(medicationIssueFindFirstMock.mock.calls[0]?.[0].where).not.toHaveProperty('OR');
    expect(medicationIssueCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'miss0000000001',
        title: '名称未確定薬 の残薬調整',
      }),
      select: { id: true },
    });
    expect(taskUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          task_type: 'tracing_report_followup',
          dedupe_key: 'tracing-report-followup:record_1:name:名称未確定薬',
          related_entity_type: 'tracing_report',
          related_entity_id: 'tracing_1',
          metadata: expect.objectContaining({
            drug_name: '名称未確定薬',
            drug_code: null,
            drug_identity_key: 'name:名称未確定薬',
          }),
        }),
      }),
    );
  });

  it('creates a first-visit document with delivery record for completed initial visits', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    expect(templateFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          template_type: {
            in: ['contract_document', 'important_matters', 'privacy_consent', 'consent_form'],
          },
          is_default: true,
        }),
      }),
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'first_visit_document.generated',
        target_type: 'first_visit_document',
        target_id: 'first_visit_1',
        changes: expect.objectContaining({
          document_action: expect.objectContaining({
            action: 'generated',
            document_type: 'contract',
            template_id: 'template_contract_2026',
            template_name: '居宅療養管理指導契約書 2026年版',
            template_version: '2',
            source: 'initial_visit_record',
          }),
          visit_record_id: 'record_1',
          delivered_to: '長男 山田',
        }),
      }),
    });
  });

  it('encodes first-visit document PDF URLs while preserving raw visit record identity', async () => {
    const visitRecordId = 'record/../1?x=1#frag';
    visitRecordCreateMock.mockResolvedValueOnce({ id: visitRecordId, version: 1 });
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedInitialVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const encodedDocumentUrl = `/api/visit-records/${encodeURIComponent(visitRecordId)}/pdf`;
    expect(firstVisitDocumentCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        document_url: encodedDocumentUrl,
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          visit_record_id: visitRecordId,
          document_url: encodedDocumentUrl,
        }),
      }),
    });
  });

  it('updates existing first-visit documents without duplicating generated history', async () => {
    visitScheduleFindFirstMock.mockResolvedValue({
      id: 'schedule_1',
      case_id: 'case_1',
      version: 4,
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
    firstVisitDocumentFindFirstMock.mockResolvedValue({
      id: 'first_visit_existing',
      document_url: '/reports/print?type=first_visit_documents&patient_id=patient_1',
      delivered_at: new Date('2026-03-20T09:00:00.000Z'),
      delivered_to: '長女 山田',
    });

    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          soap_subjective: '服薬状況問題なし',
          structured_soap: completedInitialVisitStructuredSoap,
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(firstVisitDocumentUpdateMock).toHaveBeenCalledWith({
      where: { id: 'first_visit_existing' },
      data: expect.objectContaining({
        document_url: '/reports/print?type=first_visit_documents&patient_id=patient_1',
        delivered_at: new Date('2026-03-20T09:00:00.000Z'),
        delivered_to: '長女 山田',
      }),
    });
    expect(firstVisitDocumentCreateMock).not.toHaveBeenCalled();
    expect(templateFindFirstMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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
        expectedVersion: 1,
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
        }),
      }),
    );
  });

  it('does not accept server-managed handoff metadata from ordinary visit record creation', async () => {
    const response = await POST(
      createRequest(
        {
          schedule_id: 'schedule_1',
          patient_id: 'patient_1',
          visit_date: '2026-03-26',
          outcome_status: 'completed',
          structured_soap: {
            ...completedVisitStructuredSoap,
            handoff: {
              next_check_items: ['眠気確認'],
              ongoing_monitoring: ['血圧変動'],
              decision_rationale: '通常保存からの入力',
              ai_extracted: true,
              ai_confidence: 0.99,
              confirmed_by: 'attacker',
              confirmed_at: '2026-04-01T00:00:00.000Z',
              extracted_at: '2026-04-01T00:00:00.000Z',
            },
          },
        },
        { 'x-org-id': 'org_1' },
      ),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const savedSoap = visitRecordCreateMock.mock.calls[0][0].data.structured_soap as Record<
      string,
      unknown
    >;
    expect(savedSoap.handoff).toMatchObject({
      next_check_items: ['眠気確認'],
      ongoing_monitoring: ['血圧変動'],
      decision_rationale: '通常保存からの入力',
      ai_extracted: false,
      ai_confidence: null,
      confirmed_by: null,
      confirmed_at: null,
      extracted_at: null,
    });
    expect(processHandoffExtractionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        structuredSoap: expect.objectContaining({
          handoff: expect.objectContaining({
            ai_extracted: false,
            confirmed_by: null,
            confirmed_at: null,
          }),
        }),
      }),
    );
  });

  it('logs only sanitized handoff extraction failure metadata after saving the visit record', async () => {
    const rawError = new Error('patient=田中太郎 SOAP=服薬状況 token=secret');
    rawError.name = 'Patient Tanaka token=secret';
    processHandoffExtractionMock.mockRejectedValue(rawError);

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
    await Promise.resolve();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'visit_records_handoff_extraction_failed',
        route: '/api/visit-records',
        operation: 'process_handoff_extraction',
        targetId: 'record_1',
      }),
      expect.any(Error),
    );
    const [routeContext, warnError] = loggerWarnMock.mock.calls[0] ?? [];
    expect(warnError).toBeInstanceOf(Error);
    expect(routeContext).not.toHaveProperty('error_name');
    const serializedRouteContext = JSON.stringify(routeContext);
    expect(serializedRouteContext).not.toContain('Patient Tanaka');
    expect(serializedRouteContext).not.toContain('田中太郎');
    expect(serializedRouteContext).not.toContain('SOAP=服薬状況');
    expect(serializedRouteContext).not.toContain('token=secret');
  });
});
