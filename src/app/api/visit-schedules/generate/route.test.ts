import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';

const {
  authMock,
  membershipFindFirstMock,
  withOrgContextMock,
  careCaseFindFirstMock,
  medicationCycleFindFirstMock,
  pharmacistShiftFindManyMock,
  pharmacyOperatingHoursFindManyMock,
  businessHolidayFindManyMock,
  visitVehicleResourceFindFirstMock,
  visitScheduleCountMock,
  visitScheduleFindManyMock,
  visitScheduleCreateMock,
  visitScheduleProposalFindManyMock,
  auditLogCreateMock,
  patientInsuranceFindFirstMock,
  patientInsuranceFindManyMock,
  userFindFirstMock,
  consentRecordFindFirstMock,
  managementPlanFindFirstMock,
  evaluateVisitWorkflowGatesMock,
  notifyWorkflowMutationMock,
  authRoleRef,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  medicationCycleFindFirstMock: vi.fn(),
  pharmacistShiftFindManyMock: vi.fn(),
  pharmacyOperatingHoursFindManyMock: vi.fn(),
  businessHolidayFindManyMock: vi.fn(),
  visitVehicleResourceFindFirstMock: vi.fn(),
  visitScheduleCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  visitScheduleCreateMock: vi.fn(),
  visitScheduleProposalFindManyMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  patientInsuranceFindFirstMock: vi.fn(),
  patientInsuranceFindManyMock: vi.fn(),
  userFindFirstMock: vi.fn(),
  consentRecordFindFirstMock: vi.fn(),
  managementPlanFindFirstMock: vi.fn(),
  evaluateVisitWorkflowGatesMock: vi.fn(),
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
    medicationCycle: {
      findFirst: medicationCycleFindFirstMock,
    },
    pharmacistShift: {
      findMany: pharmacistShiftFindManyMock,
    },
    pharmacyOperatingHours: {
      findMany: pharmacyOperatingHoursFindManyMock,
    },
    businessHoliday: {
      findMany: businessHolidayFindManyMock,
    },
    visitVehicleResource: {
      findFirst: visitVehicleResourceFindFirstMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
      count: visitScheduleCountMock,
    },
    patientInsurance: {
      findFirst: patientInsuranceFindFirstMock,
      findMany: patientInsuranceFindManyMock,
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
    membership: {
      findFirst: membershipFindFirstMock,
    },
  },
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/server/services/management-plans', () => ({
  evaluateVisitWorkflowGates: evaluateVisitWorkflowGatesMock,
  formatVisitWorkflowGateIssues: (issues: string[]) => issues.join(' / '),
}));

import { POST as rawPOST } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function expectUtcTimeDate(value: Date, hhmm: string) {
  expect(value.toISOString()).toBe(`1970-01-01T${hhmm}:00.000Z`);
}

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

function buildSerializableConflictError() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
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
      residences: [
        {
          address: '患者宅',
          lat: 35.681236,
          lng: 139.767125,
        },
      ],
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

function buildOperatingHours(
  weekday: number,
  overrides?: Partial<{
    site_id: string;
    is_open: boolean;
    open_time: Date | null;
    close_time: Date | null;
    note: string | null;
  }>,
) {
  return {
    id: `hours_${weekday}`,
    site_id: 'site_1',
    weekday,
    is_open: true,
    open_time: null,
    close_time: null,
    note: null,
    ...overrides,
  };
}

function buildBusinessHoliday(
  date: string,
  overrides?: Partial<{
    site_id: string | null;
    name: string;
    holiday_type: string;
    is_closed: boolean;
    open_time: Date | null;
    close_time: Date | null;
  }>,
) {
  return {
    id: `holiday_${date}`,
    site_id: null,
    date: new Date(`${date}T00:00:00.000Z`),
    name: '臨時休業',
    holiday_type: 'org_event',
    is_closed: true,
    open_time: null,
    close_time: null,
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
    valid_from: null,
    valid_until: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function mockPatientInsuranceTypes(types: Array<'medical' | 'care'>) {
  patientInsuranceFindManyMock.mockResolvedValue(
    types.map((insuranceType) => buildInsuranceRecord(insuranceType)),
  );
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
    medicationCycleFindFirstMock.mockResolvedValue({
      id: 'cycle_1',
      overall_status: 'set_audited',
    });
    evaluateVisitWorkflowGatesMock.mockImplementation((_prisma, args) =>
      Promise.resolve(args.asOfDates.map(() => ({ ok: true, issues: [] }))),
    );
    pharmacistShiftFindManyMock.mockImplementation(async ({ where }) => {
      const dates = Array.isArray(where.date?.in) ? where.date.in : [];
      return dates.map((date: Date) => buildShift(formatUtcDateKey(date)));
    });
    pharmacyOperatingHoursFindManyMock.mockResolvedValue([]);
    businessHolidayFindManyMock.mockResolvedValue([]);
    visitVehicleResourceFindFirstMock.mockResolvedValue({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
      max_route_duration_minutes: null,
      travel_mode: 'DRIVE',
      site: {
        address: '薬局',
        lat: 35.681236,
        lng: 139.767125,
      },
    });
    visitScheduleCountMock.mockResolvedValue(0);
    visitScheduleFindManyMock.mockResolvedValue([]);
    visitScheduleProposalFindManyMock.mockResolvedValue([]);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    visitScheduleCreateMock.mockImplementation(async ({ data }) => ({
      id: `schedule_${String(data.scheduled_date)}`,
      ...data,
    }));
    patientInsuranceFindFirstMock.mockResolvedValue(null);
    patientInsuranceFindManyMock.mockResolvedValue([]);
    userFindFirstMock.mockResolvedValue({ max_weekly_visits: null });
    consentRecordFindFirstMock.mockResolvedValue({ id: 'consent_1' });
    managementPlanFindFirstMock.mockResolvedValue({
      id: 'plan_1',
      status: 'approved',
      next_review_date: null,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitSchedule: {
          count: visitScheduleCountMock,
          findMany: visitScheduleFindManyMock,
          create: visitScheduleCreateMock,
        },
        visitVehicleResource: {
          findFirst: visitVehicleResourceFindFirstMock,
        },
        visitScheduleProposal: {
          findMany: visitScheduleProposalFindManyMock,
        },
        patientInsurance: {
          findFirst: patientInsuranceFindFirstMock,
          findMany: patientInsuranceFindManyMock,
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
        auditLog: {
          create: auditLogCreateMock,
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
    expectSensitiveNoStore(response);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(2);
    const firstCall = visitScheduleCreateMock.mock.calls[0][0].data;
    const secondCall = visitScheduleCreateMock.mock.calls[1][0].data;
    expect(firstCall.case_id).toBe('case_1');
    expect(firstCall.cycle_id).toBe('cycle_1');
    expect(formatUtcDateKey(firstCall.scheduled_date)).toBe('2026-04-07');
    expectUtcTimeDate(firstCall.time_window_start, '11:00');
    expectUtcTimeDate(firstCall.time_window_end, '12:00');
    expect(firstCall.assignment_mode).toBe('primary');
    expect(firstCall.route_order).toBe(1);
    expect(formatUtcDateKey(secondCall.scheduled_date)).toBe('2026-04-21');
    expect(secondCall.route_order).toBe(1);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('keeps windowed biweekly generation anchored to the original series date', async () => {
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
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
        series_anchor_date: '2026-01-05',
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    const expectedDateKeys = ['2026-05-11', '2026-05-13', '2026-05-25', '2026-05-27'];
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(4);
    expect(
      visitScheduleCreateMock.mock.calls.map((call) =>
        formatUtcDateKey(call[0].data.scheduled_date),
      ),
    ).toEqual(expectedDateKeys);
    expect(evaluateVisitWorkflowGatesMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asOfDates: expectedDateKeys.map((dateKey) => new Date(`${dateKey}T00:00:00.000Z`)),
      }),
    );
    expect(
      pharmacistShiftFindManyMock.mock.calls[0]?.[0].where.date.in.map((date: Date) =>
        formatUtcDateKey(date),
      ),
    ).toEqual(expectedDateKeys);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
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
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
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

  it('returns conflict instead of creating duplicate schedules for the same case, type, and date across cycles', async () => {
    visitScheduleCountMock.mockResolvedValueOnce(1);

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
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の訪問予定が既に存在します。再読み込みしてください',
    });
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
    });
    expect(visitScheduleCountMock.mock.calls[0]?.[0].where).not.toHaveProperty('cycle_id');
    expect(visitScheduleProposalFindManyMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict instead of creating schedules over an open proposal for the same case, type, and date', async () => {
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([{ id: 'proposal_existing' }]);

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同一ケース・同一日付の未確定候補が既に存在します。既存候補を確認してください',
    });
    expect(visitScheduleProposalFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        proposed_date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
        finalized_schedule_id: null,
        proposal_status: {
          in: ['proposed', 'patient_contact_pending', 'reschedule_pending'],
        },
      },
      select: { id: true },
      take: 1,
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('retries serializable generation conflicts and rejects when the competing request created the same schedule', async () => {
    withOrgContextMock
      .mockRejectedValueOnce(buildSerializableConflictError())
      .mockImplementationOnce(async (_orgId, callback) =>
        callback({
          visitSchedule: {
            count: visitScheduleCountMock,
            findMany: visitScheduleFindManyMock,
            create: visitScheduleCreateMock,
          },
          visitScheduleProposal: {
            findMany: visitScheduleProposalFindManyMock,
          },
          auditLog: {
            create: auditLogCreateMock,
          },
        }),
      );
    visitScheduleCountMock.mockResolvedValueOnce(1);

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
    expect(response.status).toBe(409);
    expect(withOrgContextMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenNthCalledWith(1, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(withOrgContextMock).toHaveBeenNthCalledWith(2, 'org_1', expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns conflict when serializable generation conflicts exceed the retry limit', async () => {
    withOrgContextMock.mockRejectedValue(buildSerializableConflictError());

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
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '訪問予定の生成が同時に更新されました。再読み込みしてください',
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(3);
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    expect(visitVehicleResourceFindFirstMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        visit_type: 'regular',
        scheduled_date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
        schedule_status: { notIn: ['cancelled', 'rescheduled'] },
      },
    });
    expect(visitScheduleCountMock.mock.calls[0]?.[0].where).not.toHaveProperty('cycle_id');
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          vehicle_resource_id: 'vehicle_1',
          scheduled_date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
          schedule_status: {
            notIn: ['cancelled', 'rescheduled'],
          },
        },
        select: expect.objectContaining({
          scheduled_date: true,
          route_order: true,
          time_window_start: true,
          case_: expect.any(Object),
        }),
      }),
    );
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
      max_route_duration_minutes: null,
      travel_mode: 'DRIVE',
      site: {
        address: '別拠点',
        lat: 35.7,
        lng: 139.7,
      },
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
      max_route_duration_minutes: null,
      travel_mode: 'DRIVE',
      site: {
        address: '薬局',
        lat: 35.681236,
        lng: 139.767125,
      },
    });
    visitScheduleFindManyMock.mockResolvedValueOnce([
      { scheduled_date: new Date('2026-04-07T00:00:00.000Z') },
    ]);

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
    expect(visitScheduleCountMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('rejects recurring generation when the selected vehicle route duration limit is exceeded', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: null,
          residences: [
            {
              address: '近隣患者宅',
              lat: 35.681236,
              lng: 139.78,
            },
          ],
        },
      }),
    );
    visitVehicleResourceFindFirstMock.mockResolvedValueOnce({
      id: 'vehicle_1',
      site_id: 'site_1',
      label: '社用車A',
      max_stops: 8,
      max_route_duration_minutes: 30,
      travel_mode: 'DRIVE',
      site: {
        address: '薬局',
        lat: 35.681236,
        lng: 139.767125,
      },
    });
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
        route_order: 1,
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            residences: [
              {
                address: '既存患者宅',
                lat: 35.681236,
                lng: 139.95,
              },
            ],
          },
        },
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
        vehicle_resource_id: 'vehicle_1',
        time_window_start: '10:00',
        time_window_end: '11:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
  });

  it('revalidates selected vehicle route duration inside the serializable generation transaction', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: null,
          residences: [
            {
              address: '近隣患者宅',
              lat: 35.681236,
              lng: 139.78,
            },
          ],
        },
      }),
    );
    visitVehicleResourceFindFirstMock
      .mockResolvedValueOnce({
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        max_stops: 8,
        max_route_duration_minutes: 90,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      })
      .mockResolvedValueOnce({
        id: 'vehicle_1',
        site_id: 'site_1',
        label: '社用車A',
        max_stops: 8,
        max_route_duration_minutes: 30,
        travel_mode: 'DRIVE',
        site: {
          address: '薬局',
          lat: 35.681236,
          lng: 139.767125,
        },
      });
    visitScheduleFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
        route_order: 1,
        time_window_start: new Date('1970-01-01T09:00:00.000Z'),
        case_: {
          patient: {
            residences: [
              {
                address: '同時追加患者宅',
                lat: 35.681236,
                lng: 139.95,
              },
            ],
          },
        },
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
        vehicle_resource_id: 'vehicle_1',
        time_window_start: '10:00',
        time_window_end: '11:00',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining('上限 30分を超えます'),
    });
    expect(withOrgContextMock).toHaveBeenCalledTimes(1);
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

  it('treats Sunday and Saturday as the same billing week for insurance weekly limits', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [0, 6],
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
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,SA',
        start_date: '2026-04-12',
        end_date: '2026-04-18',
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

  it('resolves visit-limit insurance with range queries before and inside the transaction', async () => {
    careCaseFindFirstMock.mockResolvedValue(
      buildCareCase({
        patient: {
          scheduling_preference: {
            preferred_weekdays: [1],
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
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
        start_date: '2026-03-30',
        end_date: '2026-04-06',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(2);
    expect(patientInsuranceFindManyMock).toHaveBeenCalledTimes(2);
    expect(patientInsuranceFindFirstMock).not.toHaveBeenCalled();
    expect(patientInsuranceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          insurance_type: { in: ['medical', 'care'] },
          is_active: true,
        }),
      }),
    );
  });

  it('rejects direct generation when existing active schedules already fill the monthly billing cap', async () => {
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
    mockPatientInsuranceTypes(['medical']);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'existing_1',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_2',
        scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_3',
        scheduled_date: new Date('2026-04-15T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_4',
        scheduled_date: new Date('2026-04-22T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
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
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects direct generation when open proposals plus active schedules fill the monthly billing cap', async () => {
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
    mockPatientInsuranceTypes(['medical']);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'existing_1',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_2',
        scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_3',
        scheduled_date: new Date('2026-04-15T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
    ]);
    visitScheduleProposalFindManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'proposal_same_month',
        case_id: 'case_1',
        proposal_batch_id: null,
        proposed_date: new Date('2026-04-22T00:00:00.000Z'),
        proposed_pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        finalized_schedule_id: null,
        reschedule_source_schedule_id: null,
        case_: { patient_id: 'patient_1' },
      },
    ]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-28',
        end_date: '2026-04-28',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects direct generation when generated rows cumulatively exceed the monthly billing cap', async () => {
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
    mockPatientInsuranceTypes(['medical']);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'existing_1',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_2',
        scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_3',
        scheduled_date: new Date('2026-04-15T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
    ]);

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
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects direct generation when transaction-time insurance activates into a filled billing cap', async () => {
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
    patientInsuranceFindManyMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildInsuranceRecord('medical')]);
    visitScheduleFindManyMock.mockResolvedValueOnce([
      {
        id: 'existing_1',
        scheduled_date: new Date('2026-04-01T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_2',
        scheduled_date: new Date('2026-04-08T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_3',
        scheduled_date: new Date('2026-04-15T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
      },
      {
        id: 'existing_4',
        scheduled_date: new Date('2026-04-22T00:00:00.000Z'),
        pharmacist_id: 'pharmacist_2',
        visit_type: 'regular',
        case_: { patient_id: 'patient_1' },
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
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('月上限4回を超過します'),
    });
    expect(patientInsuranceFindManyMock).toHaveBeenCalledTimes(2);
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
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
    evaluateVisitWorkflowGatesMock.mockResolvedValueOnce([
      {
        ok: false,
        issues: ['management_plan_not_approved', 'consent_missing'],
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
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-07: management_plan_not_approved / consent_missing',
    });
    expect(evaluateVisitWorkflowGatesMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      asOfDates: [new Date('2026-04-07T00:00:00.000Z')],
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects generation when any recurring candidate fails the visit workflow gate', async () => {
    evaluateVisitWorkflowGatesMock.mockResolvedValueOnce([
      { ok: true, issues: [] },
      {
        ok: false,
        issues: ['consent_missing'],
      },
    ]);

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
    expect(evaluateVisitWorkflowGatesMock).toHaveBeenCalledTimes(1);
    expect(evaluateVisitWorkflowGatesMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      asOfDates: [new Date('2026-04-07T00:00:00.000Z'), new Date('2026-04-14T00:00:00.000Z')],
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects recurring generation when no schedulable medication cycle exists for the case', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce(null);

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
      message:
        '訪問予定に紐付けられる処方サイクルがありません。セット監査まで完了した処方を確認してください',
    });
    expect(medicationCycleFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        case_id: 'case_1',
        overall_status: { in: ['audited', 'setting', 'set_audited', 'visit_ready'] },
      },
      orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
      include: {
        prescription_intakes: {
          include: {
            lines: {
              select: expect.objectContaining({
                drug_name: true,
                end_date: true,
                start_date: true,
                days: true,
                frequency: true,
                route: true,
                notes: true,
              }),
            },
          },
        },
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('persists medication deadline metadata from the schedulable cycle', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      overall_status: 'set_audited',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              end_date: new Date('2026-04-07T00:00:00.000Z'),
            },
          ],
        },
      ],
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
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cycle_id: 'cycle_1',
          scheduled_date: new Date('2026-04-07T00:00:00.000Z'),
          medication_end_date: new Date('2026-04-07T00:00:00.000Z'),
          visit_deadline_date: new Date('2026-04-07T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('rejects recurring generation beyond the medication visit deadline before creation side effects', async () => {
    medicationCycleFindFirstMock.mockResolvedValueOnce({
      id: 'cycle_1',
      overall_status: 'set_audited',
      prescription_intakes: [
        {
          refill_next_dispense_date: null,
          split_next_dispense_date: null,
          lines: [
            {
              drug_name: '継続薬',
              frequency: '朝食後',
              end_date: new Date('2026-04-07T00:00:00.000Z'),
            },
          ],
        },
      ],
    });

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-14',
        end_date: '2026-04-14',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2026-04-14: 訪問期限 2026-04-07 を超えるため定期訪問を生成できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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

  it.each([
    {
      payload: { time_window_start: '12:00' },
      details: { time_window_end: ['終了時刻も入力してください'] },
    },
    {
      payload: { time_window_end: '13:00' },
      details: { time_window_start: ['開始時刻も入力してください'] },
    },
  ])('rejects incomplete recurring time windows before loading the case', async (caseItem) => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        ...caseItem.payload,
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: caseItem.details,
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

  it('rejects recurrence rules with invalid BYDAY tokens before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,XX,WE',
        start_date: '2026-03-30',
        end_date: '2026-04-01',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'RRULEのBYDAYに無効な指定があります',
      details: {
        recurrence_rule: ['BYDAYに無効な指定があります: XX'],
        rrule: {
          code: 'RRULE_INVALID_BYDAY',
          part: 'BYDAY',
          invalidTokens: ['XX'],
        },
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGatesMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects monthly recurrence rules with impossible ordinal BYDAY tokens before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=MONTHLY;INTERVAL=1;BYDAY=1WE,6MO,-1FR',
        start_date: '2026-04-01',
        end_date: '2026-04-30',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'RRULEのBYDAYに無効な指定があります',
      details: {
        recurrence_rule: ['BYDAYに無効な指定があります: 6MO'],
        rrule: {
          code: 'RRULE_INVALID_BYDAY',
          part: 'BYDAY',
          invalidTokens: ['6MO'],
        },
      },
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGatesMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('rejects recurring generation ranges longer than 120 days before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-01',
        end_date: '2026-08-01',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '訪問予定の一括生成期間は120日以内にしてください',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGatesMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects recurring rules that would create more than 100 candidates before loading the case', async () => {
    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR,SA,SU',
        start_date: '2026-04-01',
        end_date: '2026-07-29',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '一度に生成できる訪問予定は100件までです',
    });
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(evaluateVisitWorkflowGatesMock).not.toHaveBeenCalled();
    expect(pharmacistShiftFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects non-object generate payloads before loading the case', async () => {
    const response = await POST(createRequest(['case_1']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
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

  it('returns a sanitized no-store 500 when auth plumbing fails before body parsing', async () => {
    authMock.mockRejectedValueOnce(
      new Error('raw auth schedule generate patient 山田 花子 token secret'),
    );

    const response = await POST(createRequest(['case_1']));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw auth');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(notifyWorkflowMutationMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when generation transaction fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw schedule generation transaction patient 山田 花子 token secret'),
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
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('raw schedule generation');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('token secret');
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
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

  it('rejects generation on an org-wide pharmacy holiday unless an override reason is provided', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([buildBusinessHoliday('2026-04-07')]);

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
      message:
        '2026-04-07: 訪問拠点が休業日のため訪問予定を生成できません。生成するには上書き理由を入力してください',
    });
    expect(businessHolidayFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          date: { in: [new Date('2026-04-07T00:00:00.000Z')] },
          OR: [{ site_id: { in: ['site_1'] } }, { site_id: null }],
        }),
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects generation on a regular closed operating weekday unless an override reason is provided', async () => {
    pharmacyOperatingHoursFindManyMock.mockResolvedValueOnce([
      buildOperatingHours(2, { is_open: false }),
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
      message:
        '2026-04-07: 訪問拠点が定休日のため訪問予定を生成できません。生成するには上書き理由を入力してください',
    });
    expect(pharmacyOperatingHoursFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          site_id: { in: ['site_1'] },
        },
      }),
    );
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(visitScheduleCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('allows pharmacy holiday generation with an override reason and records the audit entry', async () => {
    businessHolidayFindManyMock.mockResolvedValueOnce([buildBusinessHoliday('2026-04-07')]);

    const response = await POST(
      createRequest({
        case_id: 'case_1',
        visit_type: 'regular',
        pharmacist_id: 'pharmacist_1',
        recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        start_date: '2026-04-07',
        end_date: '2026-04-07',
        operating_day_override_reason: '緊急訪問のため休日訪問を薬剤師が確認済み',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitScheduleCreateMock).toHaveBeenCalledTimes(1);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        patient_id: 'patient_1',
        action: 'visit_schedule_operating_day_override_applied',
        target_type: 'VisitSchedule',
        target_id: expect.any(String),
        changes: expect.objectContaining({
          case_id: 'case_1',
          cycle_id: 'cycle_1',
          scheduled_date: '2026-04-07',
          pharmacist_id: 'pharmacist_1',
          site_id: 'site_1',
          operating_day_reason: 'holiday',
          override_reason: '緊急訪問のため休日訪問を薬剤師が確認済み',
          recurrence_rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=TU',
        }),
      }),
    });
  });
});
