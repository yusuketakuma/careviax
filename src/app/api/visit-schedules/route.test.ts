import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const {
  authMock,
  membershipFindFirstMock,
  pharmacistShiftFindFirstMock,
  visitScheduleFindManyMock,
  visitScheduleFindFirstMock,
  visitScheduleProposalFindFirstMock,
  visitScheduleRouteFindManyMock,
  visitScheduleProposalRouteFindManyMock,
  visitScheduleCountMock,
  visitVehicleResourceFindFirstMock,
  patientInsuranceFindFirstMock,
  userFindFirstMock,
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
  careCaseFindFirstMock,
  validateOrgReferencesMock,
  evaluateVisitWorkflowGateMock,
  visitScheduleCreateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacistShiftFindFirstMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleFindFirstMock: vi.fn(),
  visitScheduleProposalFindFirstMock: vi.fn(),
  visitScheduleRouteFindManyMock: vi.fn(),
  visitScheduleProposalRouteFindManyMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  validateOrgReferencesMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    pharmacistShift: {
      findFirst: pharmacistShiftFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
    user: {
      findFirst: userFindFirstMock,
    },
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    managementPlan: {
      findFirst: managementPlanFindFirstMock,
    },
  },
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(','),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function expectUtcTimeDate(value: Date, hhmm: string) {
  expect(value.toISOString()).toBe(`1970-01-01T${hhmm}:00.000Z`);
}

function createRequest(url: string, body?: unknown) {
  if (body === undefined) {
    return new NextRequest(url, {
      headers: { 'x-org-id': 'org_1' },
    });
  }
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonPostRequest() {
  return new NextRequest('http://localhost/api/visit-schedules', {
    method: 'POST',
    body: '{"case_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

describe('/api/visit-schedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    visitScheduleFindManyMock.mockResolvedValue([
      {
        id: 'schedule_1',
        display_id: 'vs0000000001',
        org_id: 'org_1',
        pharmacist_id: 'user_2',
        schedule_status: 'ready',
        scheduled_date: new Date('2026-03-30T00:00:00.000Z'),
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        time_window_end: new Date('1970-01-01T10:00:00.000Z'),
        priority: 'urgent',
        assignment_mode: 'fallback',
        route_order: 2,
        facility_batch_id: null,
        confirmed_at: new Date('2026-03-29T09:00:00.000Z'),
        carry_items_status: 'ready',
        visit_record: null,
        facility_batch: null,
        preparation: null,
        override_request: null,
        applied_override: null,
        case_: {
          display_id: 'cc0000000001',
          patient: {
            id: 'patient_1',
            display_id: 'p0000000001',
            name: '患者A',
            archived_at: new Date('2026-03-01T00:00:00.000Z'),
            allergy_info: [{ substance: 'ペニシリン' }],
            insurances: [
              {
                insurance_type: 'medical',
                application_status: 'confirmed',
                public_program_code: null,
                copay_ratio: 30,
                valid_from: new Date('2020-01-01T00:00:00.000Z'),
                valid_until: new Date('2099-12-31T00:00:00.000Z'),
                is_active: true,
                insurer_number: 'raw-insurer-number',
              },
            ],
            lab_observations: [
              {
                analyte_code: 'egfr',
                value_numeric: 29,
                value_text: null,
                unit: 'mL/min/1.73m2',
                measured_at: new Date('2026-03-20T00:00:00.000Z'),
                abnormal_flag: 'L',
              },
            ],
            residences: [{ address: '施設A', building_id: 'facility_1' }],
          },
        },
        cycle: { overall_status: 'visit_ready' },
        site: { id: 'site_1', name: '本店', address: '東京都', lat: 35, lng: 139 },
        vehicle_resource: {
          id: 'vehicle_1',
          label: '社用車A',
          travel_mode: 'DRIVE',
          max_stops: 8,
          max_route_duration_minutes: 240,
        },
      },
    ]);
    pharmacistShiftFindFirstMock.mockResolvedValue({
      site_id: 'site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    visitScheduleFindFirstMock.mockResolvedValue(null);
    visitScheduleProposalFindFirstMock.mockResolvedValue(null);
    visitScheduleRouteFindManyMock.mockResolvedValue([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValue([]);
    visitScheduleCountMock.mockResolvedValue(0);
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: null });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: null,
    });
    careCaseFindFirstMock.mockResolvedValue({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      required_visit_support: null,
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    evaluateVisitWorkflowGateMock.mockResolvedValue({ ok: true, issues: [] });
    visitScheduleCreateMock.mockResolvedValue({
      id: 'schedule_2',
      assignment_mode: 'primary',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findFirst: visitScheduleFindFirstMock,
          findMany: visitScheduleRouteFindManyMock,
          count: visitScheduleCountMock,
          create: visitScheduleCreateMock,
        },
        visitVehicleResource: {
          findFirst: visitVehicleResourceFindFirstMock,
        },
        visitScheduleProposal: {
          findFirst: visitScheduleProposalFindFirstMock,
          findMany: visitScheduleProposalRouteFindManyMock,
        },
        patientInsurance: {
          findFirst: patientInsuranceFindFirstMock,
        },
        user: {
          findFirst: userFindFirstMock,
        },
        consentRecord: {
          findFirst: consentRecordFindFirstMock,
        },
        managementPlan: {
          findFirst: managementPlanFindFirstMock,
        },
      }),
    );
  });

  it('lists visit schedules with workload and facility hints', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?patient_id=patient_1&limit=%201%20'),
    ))!;

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const payload = await response.json();

    expect(payload).toMatchObject({
      data: [
        expect.objectContaining({
          id: 'schedule_1',
          display_id: 'vs0000000001',
          pharmacist_id: 'user_2',
          schedule_status: 'ready',
          priority: 'urgent',
          route_order: 2,
          confirmed_at: '2026-03-29T09:00:00.000Z',
          case_: expect.objectContaining({
            display_id: 'cc0000000001',
            patient: expect.objectContaining({
              id: 'patient_1',
              display_id: 'p0000000001',
              name: '患者A',
            }),
          }),
          facility_hint: null,
          handoff_hint: expect.objectContaining({
            summary: expect.stringContaining('代替担当'),
          }),
          workload_hint: expect.objectContaining({
            daily_visit_count: 1,
          }),
          patient_summary: expect.objectContaining({
            patient_id: 'patient_1',
            name: '患者A',
            archive: expect.objectContaining({
              status: 'archived',
            }),
            insurance: expect.objectContaining({
              missing: false,
              current_count: 1,
            }),
            safety: expect.objectContaining({
              has_allergy: true,
              critical_lab_count: 1,
            }),
          }),
          vehicle_resource: expect.objectContaining({
            id: 'vehicle_1',
            label: '社用車A',
          }),
        }),
      ],
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
      }),
    );
    const patientSelect =
      visitScheduleFindManyMock.mock.calls[0]?.[0]?.include.case_.select.patient.select;
    expect(visitScheduleFindManyMock.mock.calls[0]?.[0]?.include.case_.select.display_id).toBe(
      true,
    );
    expect(patientSelect.display_id).toBe(true);
    expect(patientSelect.insurances.where).toMatchObject({ org_id: 'org_1' });
    expect(patientSelect.lab_observations.where).toMatchObject({ org_id: 'org_1' });
    expect(payload.data[0].case_.patient).not.toHaveProperty('archived_at');
    expect(payload.data[0].case_.patient).not.toHaveProperty('allergy_info');
    expect(payload.data[0].case_.patient).not.toHaveProperty('insurances');
    expect(payload.data[0].case_.patient).not.toHaveProperty('lab_observations');
    expect(JSON.stringify(payload)).not.toContain('raw-insurer-number');
    expect(payload).toMatchSnapshot();
  });

  it('rejects malformed limit values before listing schedules', async () => {
    const response = (await GET(createRequest('http://localhost/api/visit-schedules?limit=10.0')))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        limit: ['limit は整数で指定してください'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects invalid calendar date filters before listing schedules', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?date_from=2026-02-30'),
    ))!;

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'クエリパラメータが不正です',
      details: {
        date_from: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(visitScheduleFindManyMock).not.toHaveBeenCalled();
  });

  it('queries scheduled_date with an exclusive UTC-midnight upper bound for date filters', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?date_from=2026-06-12&date_to=2026-06-12'),
    ))!;

    expect(response.status).toBe(200);
    const where = visitScheduleFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where?.scheduled_date).toEqual({
      gte: new Date('2026-06-12T00:00:00.000Z'),
      lt: new Date('2026-06-13T00:00:00.000Z'),
    });
    expect(where?.scheduled_date).not.toHaveProperty('lte');
  });

  it('returns a sanitized no-store 500 when schedule listing fails unexpectedly', async () => {
    visitScheduleFindManyMock.mockRejectedValueOnce(
      new Error('患者 山田太郎 raw visit schedule list facility address'),
    );

    const response = (await GET(createRequest('http://localhost/api/visit-schedules')))!;

    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田太郎');
    expect(JSON.stringify(body)).not.toContain('raw visit schedule');
    expect(JSON.stringify(body)).not.toContain('facility address');
  });

  it('supports the active schedule scope filter', async () => {
    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?status_scope=active'),
    ))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        }),
      }),
    );
  });

  it('does not add assignment filters for admin schedule listing', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });

    const response = (await GET(
      createRequest('http://localhost/api/visit-schedules?status_scope=active'),
    ))!;

    expect(response.status).toBe(200);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          AND: expect.anything(),
        }),
      }),
    );
  });

  it('creates a visit schedule after gate and reference checks', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expectSensitiveNoStore(response);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      pharmacist_id: 'user_2',
      site_id: 'site_1',
    });
    expect(evaluateVisitWorkflowGateMock).toHaveBeenCalled();
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        case_id: 'case_1',
        pharmacist_id: 'user_2',
        assignment_mode: 'primary',
        confirmed_by: 'user_1',
        route_order: 1,
      }),
    });
    const created = visitScheduleCreateMock.mock.calls[0][0].data;
    expectUtcTimeDate(created.time_window_start, '09:00');
    expectUtcTimeDate(created.time_window_end, '10:00');
  });

  it('rejects manual schedule creation when existing active schedules fill the monthly billing cap', async () => {
    patientInsuranceFindFirstMock.mockImplementation(async ({ where }) =>
      where.insurance_type === 'medical' ? { number: 'medical_1' } : null,
    );
    visitScheduleCountMock.mockResolvedValueOnce(4).mockResolvedValue(0);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when open proposals plus active schedules fill the monthly billing cap', async () => {
    patientInsuranceFindFirstMock.mockImplementation(async ({ where }) =>
      where.insurance_type === 'medical' ? { number: 'medical_1' } : null,
    );
    visitScheduleCountMock.mockResolvedValueOnce(3).mockResolvedValue(0);
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([
      {
        id: 'proposal_same_month',
        case_id: 'case_1',
        proposal_batch_id: null,
        proposed_date: new Date('2026-03-24T00:00:00.000Z'),
        proposed_pharmacist_id: 'user_3',
        visit_type: 'regular',
        finalized_schedule_id: null,
        reschedule_source_schedule_id: null,
        case_: { patient_id: 'patient_1' },
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when manual schedule creation fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('患者 山田花子 090-1234-5678 raw visit schedule creation detail'),
    );

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('山田花子');
    expect(JSON.stringify(body)).not.toContain('090-1234-5678');
    expect(JSON.stringify(body)).not.toContain('raw visit schedule creation detail');
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate manual schedule creation for the same active case date and visit type', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        cycle_id: 'cycle_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください',
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      cycle_id: 'cycle_1',
      pharmacist_id: 'user_2',
      site_id: 'site_1',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: { id: true },
    });
    expect(visitScheduleProposalFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleRouteFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleProposalRouteFindManyMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when an open proposal already occupies the same case date and type', async () => {
    visitScheduleProposalFindFirstMock.mockResolvedValueOnce({ id: 'proposal_existing' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の未確定候補が既に存在します。既存候補を確認してください',
    });
    expect(visitScheduleProposalFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        proposed_date: new Date('2026-03-31T00:00:00.000Z'),
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the pharmacist time window overlaps an active schedule', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'schedule_overlap' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一薬剤師・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenNthCalledWith(2, {
      where: expect.objectContaining({
        org_id: 'org_1',
        pharmacist_id: 'user_2',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
        time_window_start: { lt: new Date('1970-01-01T10:00:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:00:00.000Z') },
      }),
      select: { id: true },
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the selected vehicle time window overlaps an active schedule', async () => {
    visitScheduleFindFirstMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'schedule_vehicle_overlap' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一車両・同一日付の訪問時間帯が既存予定と重複しています。再読み込みしてください',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenNthCalledWith(3, {
      where: expect.objectContaining({
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        time_window_start: { lt: new Date('1970-01-01T10:00:00.000Z') },
        time_window_end: { gt: new Date('1970-01-01T09:00:00.000Z') },
      }),
      select: { id: true },
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rechecks selected vehicle stop limits inside the manual create transaction', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects duplicate manual schedule creation even when the request has a different cycle', async () => {
    visitScheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_existing' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        cycle_id: 'cycle_2',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください',
    });
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      cycle_id: 'cycle_2',
      pharmacist_id: 'user_2',
      site_id: 'site_1',
    });
    expect(visitScheduleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: new Date('2026-03-31T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: { id: true },
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries manual schedule creation conflicts and rejects a retry-time duplicate schedule', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          visitSchedule: {
            findFirst: visitScheduleFindFirstMock,
            findMany: visitScheduleRouteFindManyMock,
            count: visitScheduleCountMock,
            create: visitScheduleCreateMock,
          },
          visitVehicleResource: {
            findFirst: visitVehicleResourceFindFirstMock,
          },
          visitScheduleProposal: {
            findFirst: visitScheduleProposalFindFirstMock,
            findMany: visitScheduleProposalRouteFindManyMock,
          },
          patientInsurance: {
            findFirst: patientInsuranceFindFirstMock,
          },
          user: {
            findFirst: userFindFirstMock,
          },
          consentRecord: {
            findFirst: consentRecordFindFirstMock,
          },
          managementPlan: {
            findFirst: managementPlanFindFirstMock,
          },
        }),
      );
    visitScheduleFindFirstMock.mockResolvedValueOnce({ id: 'schedule_after_retry' });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('uses the pharmacist shift site and appends route order when creating a schedule', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'shift_site_1',
      available: true,
      available_from: new Date('1970-01-01T08:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });
    visitScheduleRouteFindManyMock.mockResolvedValueOnce([
      {
        scheduled_date: new Date('2026-03-31'),
        pharmacist_id: 'user_2',
        route_order: 3,
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      case_id: 'case_1',
      pharmacist_id: 'user_2',
      site_id: 'shift_site_1',
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        site_id: 'shift_site_1',
        route_order: 4,
      }),
    });
  });

  it('appends manual schedule route order after open proposals in the same pharmacist day', async () => {
    visitScheduleRouteFindManyMock.mockResolvedValueOnce([]);
    visitScheduleProposalRouteFindManyMock.mockResolvedValueOnce([
      {
        proposed_date: new Date('2026-03-31'),
        proposed_pharmacist_id: 'user_2',
        route_order: 4,
        reschedule_source_schedule_id: null,
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
        route_order: { not: null },
        OR: [
          {
            pharmacist_id: 'user_2',
            scheduled_date: new Date('2026-03-31'),
          },
        ],
      },
      select: {
        scheduled_date: true,
        pharmacist_id: true,
        route_order: true,
      },
    });
    expect(visitScheduleProposalRouteFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: { in: ['proposed', 'patient_contact_pending', 'reschedule_pending'] },
        route_order: { not: null },
        OR: [
          {
            proposed_pharmacist_id: 'user_2',
            proposed_date: new Date('2026-03-31'),
          },
        ],
      },
      select: {
        proposed_date: true,
        proposed_pharmacist_id: true,
        route_order: true,
        reschedule_source_schedule_id: true,
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        route_order: 5,
      }),
    });
  });

  it('assigns selected vehicle resources during manual schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        id: 'vehicle_1',
        available: true,
      },
      select: {
        id: true,
        site_id: true,
        label: true,
        max_stops: true,
        max_route_duration_minutes: true,
        travel_mode: true,
        site: {
          select: {
            address: true,
            lat: true,
            lng: true,
          },
        },
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-31'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vehicle_resource_id: 'vehicle_1',
      }),
    });
  });

  it('rejects manual schedule creation when the selected vehicle belongs to another site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      max_stops: 8,
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the selected vehicle stop limit is exceeded', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(1);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the selected vehicle route duration limit is exceeded', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      required_visit_support: null,
      patient: {
        scheduling_preference: null,
        residences: [
          {
            facility_unit_id: null,
            address: '候補患者宅',
            lat: 0,
            lng: 0.2,
            facility: null,
          },
        ],
      },
    });
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
      max_route_duration_minutes: 30,
      travel_mode: 'DRIVE',
      site: {
        address: '本店',
        lat: 0,
        lng: 0,
      },
    });
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        route_order: 1,
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            residences: [
              {
                address: '既存患者宅',
                lat: 0,
                lng: 0.1,
              },
            ],
          },
        },
      },
    ]);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '10:00',
        time_window_end: '11:00',
        vehicle_resource_id: 'vehicle_1',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-03-31'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
      select: {
        route_order: true,
        time_window_start: true,
        case_: {
          select: {
            patient: {
              select: {
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    lat: true,
                    lng: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('allows org-wide pharmacist visit schedule creation even when not assigned to the case', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'other_user',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalled();
  });

  it('allows admin visit schedule creation even when not assigned to the case', async () => {
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'primary_user',
      backup_pharmacist_id: 'backup_user',
      patient: {
        scheduling_preference: null,
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        site_id: 'site_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'other_user',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalled();
  });

  it('rejects schedules outside an explicit pharmacist shift window', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce({
      site_id: 'shift_site_1',
      available: true,
      available_from: new Date('1970-01-01T09:30:00.000Z'),
      available_to: new Date('1970-01-01T17:30:00.000Z'),
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation when the selected pharmacist has no shift', async () => {
    pharmacistShiftFindFirstMock.mockResolvedValueOnce(null);

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した薬剤師のシフトがありません',
    });
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation outside patient preferred time windows', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T10:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻が患者または施設の希望開始時刻 10:00 より前です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation without a time window when patient preferences define one', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [],
          preferred_time_from: new Date('1970-01-01T10:00:00.000Z'),
          preferred_time_to: new Date('1970-01-01T12:00:00.000Z'),
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問開始時刻を患者または施設の希望開始時刻 10:00 以降で指定してください',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects manual schedule creation outside patient preferred weekdays', async () => {
    careCaseFindFirstMock.mockResolvedValueOnce({
      patient_id: 'patient_1',
      primary_pharmacist_id: 'user_2',
      backup_pharmacist_id: 'user_1',
      patient: {
        scheduling_preference: {
          preferred_weekdays: [1],
          preferred_time_from: null,
          preferred_time_to: null,
          facility_time_from: null,
          facility_time_to: null,
        },
        residences: [{ facility_unit_id: null, facility: null }],
      },
    });

    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者または施設の訪問希望曜日と一致しない日付です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed visit time windows before service-side schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        time_window_start: '9:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_start: ['時刻形式が不正です（HH:mm）'],
      },
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      payload: { time_window_start: '09:00' },
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '10:00' },
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])(
    'rejects incomplete visit time windows before service-side schedule creation',
    async (caseItem) => {
      const response = (await POST(
        createRequest('http://localhost/api/visit-schedules', {
          case_id: 'case_1',
          visit_type: 'regular',
          scheduled_date: '2026-03-31',
          pharmacist_id: 'user_2',
          ...caseItem.payload,
        }),
      ))!;

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        message: '入力値が不正です',
        details: caseItem.details,
      });
      expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
      expect(validateOrgReferencesMock).not.toHaveBeenCalled();
      expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    },
  );

  it('rejects invalid calendar scheduled dates before service-side schedule creation', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-02-30',
        pharmacist_id: 'user_2',
        time_window_start: '09:00',
        time_window_end: '10:00',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        scheduled_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object create payloads before schedule service work', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', ['case_1']),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON create payloads before schedule service work', async () => {
    const response = (await POST(createMalformedJsonPostRequest()))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistShiftFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGateMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported visit schedule notes instead of dropping them silently', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/visit-schedules', {
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: '2026-03-31',
        pharmacist_id: 'user_2',
        notes: '玄関前で連絡',
      }),
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '訪問予定メモはまだ保存できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });
});
