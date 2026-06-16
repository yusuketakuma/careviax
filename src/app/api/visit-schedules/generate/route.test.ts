import { format } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  careCaseFindFirstMock,
  pharmacistShiftFindManyMock,
  visitVehicleResourceFindFirstMock,
  visitScheduleCountMock,
  visitScheduleFindManyMock,
  visitScheduleCreateMock,
  visitScheduleProposalFindManyMock,
  patientInsuranceFindFirstMock,
  evaluateVisitWorkflowGateMock,
  notifyWorkflowMutationMock,
  authRoleRef,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  evaluateVisitWorkflowGateMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
  authRoleRef: { current: 'pharmacist' },
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    visitSchedule: {
      count: visitScheduleCountMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGate: evaluateVisitWorkflowGateMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(' / '),
}));

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/visit-schedules/generate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/visit-schedules/generate', {
    method: 'POST',
    body: '{"case_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

function buildCareCase(overrides?: Record<string, unknown>) {
  return {
    patient_id: 'patient_1',
    primary_pharmacist_id: 'pharmacist_1',
    backup_pharmacist_id: 'user_1',
    patient: {
      scheduling_preference: {
        preferred_weekdays: [2, 'legacy-debug'],
        preferred_time_from: new Date('1970-01-01T10:00:00.000Z'),
        preferred_time_to: new Date('1970-01-01T17:00:00.000Z'),
        facility_time_from: new Date('1970-01-01T11:00:00.000Z'),
        facility_time_to: new Date('1970-01-01T13:00:00.000Z'),
      },
    },
    ...overrides,
  };
}

function buildShift(
  date: string,
  overrides?: Partial<{
    site_id: string;
    available: boolean;
    available_from: Date | null;
    available_to: Date | null;
  }>,
) {
  return {
    date: new Date(`${date}T00:00:00.000Z`),
    site_id: 'site_1',
    available: true,
    available_from: new Date('1970-01-01T09:00:00.000Z'),
    available_to: new Date('1970-01-01T18:00:00.000Z'),
    ...overrides,
  };
}

function buildInsuranceRecord(insuranceType: 'medical' | 'care', number = `${insuranceType}_1`) {
  return {
    id: `insurance_${insuranceType}`,
    number,
    insurance_type: insuranceType,
    application_status: 'confirmed',
    public_program_code: null,
    previous_care_level: null,
    provisional_care_level: null,
    confirmed_care_level: null,
    is_active: true,
  };
}

function mockPatientInsuranceTypes(types: Array<'medical' | 'care'>) {
  patientInsuranceFindFirstMock.mockImplementation(async ({ where }) => {
    const insuranceType = where?.insurance_type;
    return types.includes(insuranceType) ? buildInsuranceRecord(insuranceType) : null;
  });
}

describe('/api/visit-schedules/generate POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authRoleRef.current = 'pharmacist';
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockImplementation(() =>
      Promise.resolve({ role: authRoleRef.current }),
    );

    careCaseFindFirstMock.mockResolvedValue(buildCareCase());
    evaluateVisitWorkflowGateMock.mockResolvedValue({ ok: true, issues: [] });
    pharmacistShiftFindManyMock.mockImplementation(async ({ where }) => {
      const dates = Array.isArray(where.date?.in) ? where.date.in : [];
      return dates.map((date: Date) => buildShift(format(date, 'yyyy-MM-dd')));
    });
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
    });
    visitScheduleCountMock.mockResolvedValue(0);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    visitScheduleCreateMock.mockImplementation(async ({ data }) => ({
      id: `schedule_${String(data.scheduled_date)}`,
      ...data,
    }));
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
          create: visitScheduleCreateMock,
        },
        visitScheduleProposal: {
          findMany: visitScheduleProposalFindManyMock,
        },
      }),
    );
  });

  it('generates monthly recurring schedules for multiple ordinal weekdays and intersects patient/facility windows', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=1TU,3TU',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
        time_window_start: '09:00',
        time_window_end: '12:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(2);
    const firstCall = visitScheduleCreateMock.mock.calls[0][0].data;
    const secondCall = visitScheduleCreateMock.mock.calls[1][0].data;
    expect(firstCall.case_id).toBe('case_1');
    expect(format(firstCall.scheduled_date, 'yyyy-MM-dd')).toBe('2026-04-07');
    expect(format(firstCall.time_window_start, 'HH:mm')).toBe('11:00');
    expect(format(firstCall.time_window_end, 'HH:mm')).toBe('12:00');
    expect(firstCall.assignment_mode).toBe('primary');
    expect(firstCall.route_order).toBe(1);
    expect(format(secondCall.scheduled_date, 'yyyy-MM-dd')).toBe('2026-04-21');
    expect(secondCall.route_order).toBe(1);
  });

  it('assigns route order after the existing schedule order for the same pharmacist and date', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );
    visitScheduleFindManyMock.mockResolvedValue([
      {
        scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
        route_order: 3,
      },
    ]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          pharmacist_id: 'pharmacist_1',
          schedule_status: { notIn: ['cancelled', 'rescheduled'] },
          route_order: { not: null },
        }),
      }),
    );
    expect(visitScheduleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
          route_order: 4,
        }),
      }),
    );
  });

  it('assigns route order after open proposal orders for the same pharmacist and date', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );
    visitScheduleFindManyMock.mockResolvedValue([
      {
        scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
        route_order: 2,
      },
    ]);
    visitScheduleProposalFindManyMock.mockResolvedValue([
      {
        proposed_date: new Date('2026-04-07T00:00:00.000Z'),
        route_order: 4,
      },
    ]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
        proposed_pharmacist_id: 'pharmacist_1',
        proposed_date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
        route_order: { not: null },
      },
      select: {
        proposed_date: true,
        route_order: true,
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
          route_order: 5,
        }),
      }),
    );
  });

  it('assigns selected vehicle resources to generated recurring schedules', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    if (!response) throw new Error('response is required');
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
      },
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        vehicle_resource_id: 'vehicle_1',
        scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
        schedule_status: {
          notIn: ['cancelled', 'rescheduled'],
        },
      },
    });
    expect(visitScheduleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          vehicle_resource_id: 'vehicle_1',
        }),
      }),
    );
  });

  it('rejects recurring generation when the selected vehicle belongs to another shift site', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_2',
      site_id: 'site_2',
      label: '別拠点車両',
      max_stops: 8,
    });

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        vehicle_resource_id: 'vehicle_2',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '選択した車両リソースは訪問予定の拠点では利用できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects recurring generation when the selected vehicle stop limit is exceeded', async () => {
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 1,
    });
    visitScheduleCountMock.mockResolvedValueOnce(1);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        vehicle_resource_id: 'vehicle_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '社用車A で訪問できる件数は最大 1 件です',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects recurrence rules that exceed the weekly limit resolved from patient insurance', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );
    mockPatientInsuranceTypes(['medical']);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
        start_date: '2026-03-30',
        end_date: '2026-04-05',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '週次訪問回数の上限を超えています（医療保険: 週1回まで）',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('ignores client-supplied insurance_type when applying server-resolved visit limits', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );
    mockPatientInsuranceTypes(['medical']);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
        insurance_type: 'care',
        start_date: '2026-03-30',
        end_date: '2026-04-05',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '週次訪問回数の上限を超えています（医療保険: 週1回まで）',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('does not apply insurance visit limits when no effective patient insurance exists', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [1, 3],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE',
        insurance_type: 'medical',
        start_date: '2026-03-30',
        end_date: '2026-04-05',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(2);
  });

  it('allows org-wide pharmacist generation even when not assigned to the case', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        primary_pharmacist_id: 'primary_user',
        backup_pharmacist_id: 'backup_user',
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: null,
            preferred_time_to: null,
            facility_time_from: null,
            facility_time_to: null,
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'other_user',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalled();
  });

  it('rejects generation when the visit workflow gate is not satisfied', async () => {
    evaluateVisitWorkflowGateMock.mockResolvedValueOnce({
      ok: false,
      issues: ['management_plan_not_approved', 'consent_missing'],
    });

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-07: management_plan_not_approved / consent_missing',
    });
    expect(evaluateVisitWorkflowGateMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      asOf: new Date('2026-04-07T00:00:00.000Z'),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generation when any recurring candidate fails the visit workflow gate', async () => {
    evaluateVisitWorkflowGateMock
      .mockResolvedValueOnce({ ok: true, issues: [] })
      .mockResolvedValueOnce({
        ok: false,
        issues: ['consent_missing'],
      });

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-14',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-14: consent_missing',
    });
    expect(evaluateVisitWorkflowGateMock).toHaveBeenCalledTimes(2);
    expect(evaluateVisitWorkflowGateMock).toHaveBeenNthCalledWith(1, expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      asOf: new Date('2026-04-07T00:00:00.000Z'),
    });
    expect(evaluateVisitWorkflowGateMock).toHaveBeenNthCalledWith(2, expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      asOf: new Date('2026-04-14T00:00:00.000Z'),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects reversed recurring time windows before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        time_window_start: '12:00',
        time_window_end: '11:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        time_window_end: ['終了時刻は開始時刻より後にしてください'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid recurring date keys before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-02-30',
        end_date: '2026-03-03',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        start_date: ['日付形式が不正です（YYYY-MM-DD）'],
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generate payloads before loading the case', async () => {
    const response = await POST(createRequest(['case_1']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON generate payloads before loading the case', async () => {
    const response = await POST(createMalformedJsonRequest());

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects schedules when patient and facility windows do not overlap', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [2],
            preferred_time_from: new Date('1970-01-01T09:00:00.000Z'),
            preferred_time_to: new Date('1970-01-01T10:00:00.000Z'),
            facility_time_from: new Date('1970-01-01T13:00:00.000Z'),
            facility_time_to: new Date('1970-01-01T14:00:00.000Z'),
          },
        },
      }),
    );

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '患者在宅時間帯と施設受入時間帯が重ならないため訪問枠を確定できません',
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the selected pharmacist has no shift for a candidate date', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-07: 選択した薬剤師のシフトがありません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the selected pharmacist is unavailable on a candidate date', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      buildShift('2026-04-07', { available: false }),
    ]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-07: 選択した薬剤師は指定日のシフトが休みです',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects generation when the visit window starts before the selected pharmacist shift', async () => {
    pharmacistShiftFindManyMock.mockResolvedValueOnce([
      buildShift('2026-04-07', {
        available_from: new Date('1970-01-01T12:00:00.000Z'),
        available_to: new Date('1970-01-01T18:00:00.000Z'),
      }),
    ]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-07: 訪問開始時刻が薬剤師シフトの開始前です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });
});
