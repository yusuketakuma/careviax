import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';

const {
  authCtx,
  medicationCycleFindManyMock,
  setPlanFindManyMock,
  setBatchFindManyMock,
  buildMedicationCycleAssignmentWhereMock,
  buildSetPlanAssignmentWhereMock,
} = vi.hoisted(() => ({
  authCtx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' as MemberRole },
  medicationCycleFindManyMock: vi.fn(),
  setPlanFindManyMock: vi.fn(),
  setBatchFindManyMock: vi.fn(),
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
    setBatch: {
      findMany: setBatchFindManyMock,
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
    setBatchFindManyMock.mockResolvedValue([]);
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

  it('without a phase filter excludes only cancelled (backward compatible)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    await GET(createRequest(), { params: Promise.resolve({}) });

    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          overall_status: { notIn: ['cancelled'] },
        }),
      }),
    );
  });

  it('filters by the dispense phase status set (ready_to_dispense + dispensing)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    await GET(createRequest('?phase=dispense'), { params: Promise.resolve({}) });

    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          overall_status: { in: ['ready_to_dispense', 'dispensing'] },
        }),
      }),
    );
  });

  it('filters by the audit phase status set (dispensed + audit_pending)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    await GET(createRequest('?phase=audit'), { params: Promise.resolve({}) });

    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          overall_status: { in: ['dispensed', 'audit_pending'] },
        }),
      }),
    );
  });

  it('uses the shared audited+setting base for set and set-audit (split happens on SetBatch)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    await GET(createRequest('?phase=set-audit'), { params: Promise.resolve({}) });

    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ overall_status: { in: ['audited', 'setting'] } }),
      }),
    );
  });

  // set / set-audit を SetBatch 集計で排他分割する共通フィクスチャ:
  //  - patient_a (plan_a): 全セット済・未監査 → set-audit 工程
  //  - patient_b (plan_b): 一部未セット(pending) → set 工程
  const PATIENT_CREATED_AT = new Date('2026-06-01T00:00:00Z');
  function seedSetSplitMocks() {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_a',
        patient_id: 'patient_a',
        overall_status: 'setting',
        patientCreatedAt: PATIENT_CREATED_AT,
        name: 'あ患者',
        nameKana: 'アカンジャ',
      }),
      cycle({
        id: 'cycle_b',
        patient_id: 'patient_b',
        overall_status: 'audited',
        patientCreatedAt: PATIENT_CREATED_AT,
        name: 'い患者',
        nameKana: 'イカンジャ',
      }),
    ]);
    setPlanFindManyMock.mockResolvedValue([
      { id: 'plan_a', cycle_id: 'cycle_a', cycle: { patient_id: 'patient_a' } },
      { id: 'plan_b', cycle_id: 'cycle_b', cycle: { patient_id: 'patient_b' } },
    ]);
    setBatchFindManyMock.mockResolvedValue([
      { plan_id: 'plan_a', set_state: 'set', audit_state: 'unaudited' },
      { plan_id: 'plan_a', set_state: 'hold', audit_state: 'unaudited' }, // hold はセット完了を妨げない
      { plan_id: 'plan_b', set_state: 'pending', audit_state: 'unaudited' },
      { plan_id: 'plan_b', set_state: 'set', audit_state: 'unaudited' },
    ]);
  }

  it('set-audit phase keeps only fully-set, unaudited patients (audit-pending)', async () => {
    seedSetSplitMocks();

    const response = await GET(createRequest('?phase=set-audit'), { params: Promise.resolve({}) });
    const body = (await response.json()) as { data: { patient_id: string }[] };

    expect(body.data.map((row) => row.patient_id)).toEqual(['patient_a']);
    // SetBatch は plan_id の単一 findMany（org スコープ）で集計する（N+1 回避）。
    expect(setBatchFindManyMock).toHaveBeenCalledTimes(1);
    expect(setBatchFindManyMock).toHaveBeenCalledWith({
      where: { org_id: 'org_1', plan_id: { in: expect.arrayContaining(['plan_a', 'plan_b']) } },
      select: { plan_id: true, set_state: true, audit_state: true },
    });
  });

  it('set phase keeps only patients still being set (pending cells remain)', async () => {
    seedSetSplitMocks();

    const response = await GET(createRequest('?phase=set'), { params: Promise.resolve({}) });
    const body = (await response.json()) as { data: { patient_id: string }[] };

    expect(body.data.map((row) => row.patient_id)).toEqual(['patient_b']);
  });

  it('set-audit excludes a fully audited plan (complete → neither queue)', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_done',
        patient_id: 'patient_done',
        overall_status: 'audited',
        patientCreatedAt: PATIENT_CREATED_AT,
      }),
    ]);
    setPlanFindManyMock.mockResolvedValue([
      { id: 'plan_done', cycle_id: 'cycle_done', cycle: { patient_id: 'patient_done' } },
    ]);
    setBatchFindManyMock.mockResolvedValue([
      { plan_id: 'plan_done', set_state: 'set', audit_state: 'ok' },
      { plan_id: 'plan_done', set_state: 'set', audit_state: 'ok' },
    ]);

    const setAudit = await GET(createRequest('?phase=set-audit'), { params: Promise.resolve({}) });
    const setPhase = await GET(createRequest('?phase=set'), { params: Promise.resolve({}) });

    await expect(setAudit.json()).resolves.toEqual({ data: [] });
    await expect(setPhase.json()).resolves.toEqual({ data: [] });
  });

  it('set-audit keeps a fully set plan with an NG cell (rework pending, not complete)', async () => {
    // 全セット済・未監査ゼロでも NG が残る間は監査未完了 → set-audit 工程に残す（set/complete でない）。
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_ng',
        patient_id: 'patient_ng',
        overall_status: 'setting',
        patientCreatedAt: PATIENT_CREATED_AT,
      }),
    ]);
    setPlanFindManyMock.mockResolvedValue([
      { id: 'plan_ng', cycle_id: 'cycle_ng', cycle: { patient_id: 'patient_ng' } },
    ]);
    setBatchFindManyMock.mockResolvedValue([
      { plan_id: 'plan_ng', set_state: 'set', audit_state: 'ok' },
      { plan_id: 'plan_ng', set_state: 'set', audit_state: 'ng' },
    ]);

    const setAudit = await GET(createRequest('?phase=set-audit'), { params: Promise.resolve({}) });
    const setPhase = await GET(createRequest('?phase=set'), { params: Promise.resolve({}) });
    const auditBody = (await setAudit.json()) as { data: { patient_id: string }[] };

    expect(auditBody.data.map((row) => row.patient_id)).toEqual(['patient_ng']);
    await expect(setPhase.json()).resolves.toEqual({ data: [] });
  });

  it('rejects an unknown phase value', async () => {
    const response = await GET(createRequest('?phase=bogus'), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
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
