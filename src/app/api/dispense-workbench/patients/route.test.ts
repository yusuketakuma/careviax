import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  medicationCycleFindManyMock,
  setPlanFindManyMock,
  buildMedicationCycleAssignmentWhereMock,
  buildSetPlanAssignmentWhereMock,
} = vi.hoisted(() => ({
  authCtx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' as MemberRole },
  medicationCycleFindManyMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  buildMedicationCycleAssignmentWhereMock: vi.fn(),
  buildSetPlanAssignmentWhereMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (
      handler: (
        req: NextRequest,
        ctx: { orgId: string; userId: string; role: MemberRole },
        routeContext: { params: Promise<Record<string, never>> },
      ) => Promise<Response>,
      options?: { permission?: string; message?: string },
    ) =>
    (req: NextRequest, routeContext: { params: Promise<Record<string, never>> }) => {
      if (options?.permission === 'canDispense' && authCtx.role === 'clerk') {
        return Promise.resolve(
          new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN', message: options.message }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return handler(req, { ...authCtx }, routeContext);
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationCycle: {
      findMany: medicationCycleFindManyMock,
    },
    setPlan: {
      findMany: setPlanFindManyMock,
    },
  },
}));

vi.mock('@/server/services/prescription-access', () => ({
  buildMedicationCycleAssignmentWhere: buildMedicationCycleAssignmentWhereMock,
  buildSetPlanAssignmentWhere: buildSetPlanAssignmentWhereMock,
}));

import { GET } from './route';

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/dispense-workbench/patients${query}`);
}

function cycle(overrides: {
  id: string;
  patient_id: string;
  overall_status: string;
  caseStart?: Date | null;
  patientCreatedAt: Date;
  name?: string;
  nameKana?: string;
  lineStart?: Date | null;
}) {
  return {
    id: overrides.id,
    patient_id: overrides.patient_id,
    overall_status: overrides.overall_status,
    case_: {
      start_date: overrides.caseStart ?? null,
      patient: {
        id: overrides.patient_id,
        name: overrides.name ?? '患者',
        name_kana: overrides.nameKana ?? 'カンジャ',
        created_at: overrides.patientCreatedAt,
      },
    },
    prescription_intakes:
      overrides.lineStart !== undefined
        ? [{ lines: overrides.lineStart ? [{ start_date: overrides.lineStart }] : [] }]
        : [{ lines: [] }],
  };
}

describe('GET /api/dispense-workbench/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCtx.orgId = 'org_1';
    authCtx.userId = 'user_1';
    authCtx.role = 'pharmacist';
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
    buildSetPlanAssignmentWhereMock.mockReturnValue(null);
    setPlanFindManyMock.mockResolvedValue([]);
  });

  it('returns patient rows without SetPlan hydration by default', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'audit_pending',
        caseStart: new Date('2026-04-01T00:00:00.000Z'),
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
        name: '山田 太郎',
        nameKana: 'ヤマダ タロウ',
      }),
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          patient_id: 'patient_1',
          cycle_id: 'cycle_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          overall_status: 'audit_pending',
          badge: 'in_progress',
          start_date: '2026-04-01',
          registered_date: '2026-03-20',
          latest_set_plan_id: null,
          latest_set_plan_cycle_id: null,
        },
      ],
    });
    expect(setPlanFindManyMock).not.toHaveBeenCalled();
  });

  it('hydrates the patient-level latest SetPlan only when requested', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_new_without_plan',
        patient_id: 'patient_1',
        overall_status: 'audit_pending',
        caseStart: new Date('2026-04-01T00:00:00.000Z'),
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
        name: '山田 太郎',
        nameKana: 'ヤマダ タロウ',
      }),
    ]);
    setPlanFindManyMock.mockResolvedValue([
      {
        id: 'plan_old',
        cycle_id: 'cycle_old_with_plan',
        cycle: { patient_id: 'patient_1' },
      },
    ]);

    const response = await GET(createRequest('?include_set_plan=1'), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          patient_id: 'patient_1',
          cycle_id: 'cycle_new_without_plan',
          latest_set_plan_id: 'plan_old',
          latest_set_plan_cycle_id: 'cycle_old_with_plan',
        },
      ],
    });
    expect(setPlanFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          AND: [
            {
              cycle: {
                patient_id: { in: ['patient_1'] },
              },
            },
          ],
        }),
      }),
    );
  });

  it('keeps only the latest cycle per patient (findMany ordered desc)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_new',
        patient_id: 'patient_1',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      cycle({
        id: 'cycle_old',
        patient_id: 'patient_1',
        overall_status: 'reported',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].cycle_id).toBe('cycle_new');
    expect(body.data[0].badge).toBe('in_progress');
    expect(body.data[0].latest_set_plan_id).toBeNull();
  });

  it('falls back to earliest prescription line start_date when case start_date is null', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'ready_to_dispense',
        caseStart: null,
        lineStart: new Date('2026-05-10T00:00:00.000Z'),
        patientCreatedAt: new Date('2026-05-01T00:00:00.000Z'),
      }),
    ]);

    const response = await GET(createRequest(), { params: Promise.resolve({}) });
    const body = await response.json();
    expect(body.data[0].start_date).toBe('2026-05-10');
    expect(body.data[0].badge).toBe('not_started');
  });

  it('sorts by start_date when requested, pushing null start_date to the end', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'c_a',
        patient_id: 'p_a',
        overall_status: 'dispensing',
        caseStart: new Date('2026-04-05T00:00:00.000Z'),
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'アア',
      }),
      cycle({
        id: 'c_b',
        patient_id: 'p_b',
        overall_status: 'dispensing',
        caseStart: null,
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'イイ',
      }),
      cycle({
        id: 'c_c',
        patient_id: 'p_c',
        overall_status: 'dispensing',
        caseStart: new Date('2026-04-10T00:00:00.000Z'),
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'ウウ',
      }),
    ]);

    const response = await GET(createRequest('?sort=start_date&order=desc'), {
      params: Promise.resolve({}),
    });
    const body = await response.json();
    expect(body.data.map((row: { patient_id: string }) => row.patient_id)).toEqual([
      'p_c',
      'p_a',
      'p_b',
    ]);
  });

  it('rejects invalid sort with 400', async () => {
    const response = await GET(createRequest('?sort=bogus'), { params: Promise.resolve({}) });
    expect(response.status).toBe(400);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the role lacks dispense permission', async () => {
    authCtx.role = 'clerk';
    const response = await GET(createRequest(), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
  });
});
