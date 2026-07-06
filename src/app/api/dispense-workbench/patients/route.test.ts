import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { MemberRole } from '@prisma/client';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authCtx,
  medicationCycleFindManyMock,
  dispenseTaskFindManyMock,
  setPlanFindManyMock,
  setBatchFindManyMock,
  buildMedicationCycleAssignmentWhereMock,
  buildSetPlanAssignmentWhereMock,
} = vi.hoisted(() => ({
  authCtx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' as MemberRole },
  medicationCycleFindManyMock: vi.fn(),
  dispenseTaskFindManyMock: vi.fn(),
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
    dispenseTask: {
      findMany: dispenseTaskFindManyMock,
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

function expectDefaultMeta(
  body: unknown,
  overrides: Partial<{
    returned_count: number;
    has_more: boolean;
    next_cursor: string | null;
    total_count: number;
    phase: string | null;
    q_present: boolean;
  }> = {},
) {
  expect(body).toMatchObject({
    meta: {
      generated_at: expect.any(String),
      limit: 50,
      returned_count: overrides.returned_count ?? expect.any(Number),
      has_more: overrides.has_more ?? expect.any(Boolean),
      next_cursor: overrides.next_cursor ?? null,
      total_count: overrides.total_count ?? expect.any(Number),
      count_basis: {
        rows: 'authorized_latest_cycle_per_patient',
        total_count: 'authorized_phase_search_exact',
        phase_counts: 'authorized_phase_search_exact',
        set_split: 'latest_set_plan_set_batch_exact',
      },
      filters_applied: {
        phase: overrides.phase ?? null,
        q_present: overrides.q_present ?? false,
        sort: 'name_kana',
        order: 'asc',
        include_set_plan: false,
      },
      facets: {
        total: expect.any(Number),
        phase_counts: {
          dispense: expect.any(Number),
          audit: expect.any(Number),
          set: expect.any(Number),
          'set-audit': expect.any(Number),
        },
        other: expect.any(Number),
      },
    },
  });
}

describe('GET /api/dispense-workbench/patients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authCtx.orgId = 'org_1';
    authCtx.userId = 'user_1';
    authCtx.role = 'pharmacist';
    buildMedicationCycleAssignmentWhereMock.mockReturnValue(null);
    buildSetPlanAssignmentWhereMock.mockReturnValue(null);
    dispenseTaskFindManyMock.mockResolvedValue([]);
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
    expectNoStore(response);
    const body = await response.json();
    expect(body.data).toEqual([
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
        representative_task_id: null,
        representative_task_status: null,
      },
    ]);
    expectDefaultMeta(body, { returned_count: 1, has_more: false, total_count: 1 });
    expect(setPlanFindManyMock).not.toHaveBeenCalled();
    expect(dispenseTaskFindManyMock).not.toHaveBeenCalled();
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

  it('filters dispense phase after choosing each patient latest cycle', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_new_reported',
        patient_id: 'patient_1',
        overall_status: 'reported',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
      cycle({
        id: 'cycle_old_dispense',
        patient_id: 'patient_1',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
      cycle({
        id: 'cycle_dispense',
        patient_id: 'patient_2',
        overall_status: 'ready_to_dispense',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
    ]);

    const response = await GET(createRequest('?phase=dispense'), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body.data.map((row: { patient_id: string }) => row.patient_id)).toEqual(['patient_2']);
    expectDefaultMeta(body, {
      returned_count: 1,
      has_more: false,
      total_count: 1,
      phase: 'dispense',
    });
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          overall_status: { notIn: ['cancelled'] },
        }),
      }),
    );
  });

  it('filters by audit phase after latest-cycle selection', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_audit',
        patient_id: 'patient_1',
        overall_status: 'audit_pending',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
      cycle({
        id: 'cycle_dispense',
        patient_id: 'patient_2',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
    ]);

    const response = await GET(createRequest('?phase=audit'), { params: Promise.resolve({}) });
    const body = await response.json();

    expect(body.data.map((row: { patient_id: string }) => row.patient_id)).toEqual(['patient_1']);
    expectDefaultMeta(body, {
      returned_count: 1,
      has_more: false,
      total_count: 1,
      phase: 'audit',
    });
  });

  it('hydrates a representative dispense task for phase=dispense in one batch query', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
    ]);
    dispenseTaskFindManyMock.mockResolvedValue([
      { id: 'task_pending', cycle_id: 'cycle_1', status: 'pending' },
      { id: 'task_in_progress', cycle_id: 'cycle_1', status: 'in_progress' },
    ]);

    const response = await GET(createRequest('?phase=dispense'), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          patient_id: 'patient_1',
          cycle_id: 'cycle_1',
          representative_task_id: 'task_in_progress',
          representative_task_status: 'in_progress',
        },
      ],
    });
    expect(dispenseTaskFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        cycle_id: { in: ['cycle_1'] },
        status: { in: ['pending', 'in_progress', 'completed'] },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: { id: true, cycle_id: true, status: true },
    });
  });

  it('uses the completed dispense task as the representative for phase=audit', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'audit_pending',
        patientCreatedAt: new Date('2026-03-20T09:00:00.000Z'),
      }),
    ]);
    dispenseTaskFindManyMock.mockResolvedValue([
      { id: 'task_old_pending', cycle_id: 'cycle_1', status: 'pending' },
      { id: 'task_audit_ready', cycle_id: 'cycle_1', status: 'completed' },
    ]);

    const response = await GET(createRequest('?phase=audit'), { params: Promise.resolve({}) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          patient_id: 'patient_1',
          representative_task_id: 'task_audit_ready',
          representative_task_status: 'completed',
        },
      ],
    });
  });

  it('does not narrow the DB query before the set/set-audit SetBatch split', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    await GET(createRequest('?phase=set-audit'), { params: Promise.resolve({}) });

    expect(medicationCycleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ overall_status: { notIn: ['cancelled'] } }),
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

    await expect(setAudit.json()).resolves.toMatchObject({ data: [] });
    await expect(setPhase.json()).resolves.toMatchObject({ data: [] });
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
    await expect(setPhase.json()).resolves.toMatchObject({ data: [] });
  });

  it('rejects an unknown phase value', async () => {
    const response = await GET(createRequest('?phase=bogus'), { params: Promise.resolve({}) });

    expect(response.status).toBe(400);
    expectNoStore(response);
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

  it('paginates with an opaque cursor and hydrates representative tasks for page rows only', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_a',
        patient_id: 'patient_a',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'アア',
      }),
      cycle({
        id: 'cycle_b',
        patient_id: 'patient_b',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'イイ',
      }),
    ]);
    dispenseTaskFindManyMock.mockResolvedValue([
      { id: 'task_page', cycle_id: 'cycle_a', status: 'in_progress' },
    ]);

    const firstResponse = await GET(createRequest('?phase=dispense&limit=1'), {
      params: Promise.resolve({}),
    });
    const firstBody = await firstResponse.json();

    expect(firstBody.data.map((row: { patient_id: string }) => row.patient_id)).toEqual([
      'patient_a',
    ]);
    expect(firstBody.meta).toMatchObject({
      limit: 1,
      returned_count: 1,
      has_more: true,
      next_cursor: expect.any(String),
      total_count: 2,
    });
    expect(firstBody.meta.next_cursor).not.toContain('patient_a');
    expect(firstBody.meta.next_cursor).not.toContain('cycle_a');
    expect(dispenseTaskFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cycle_id: { in: ['cycle_a'] } }),
      }),
    );

    dispenseTaskFindManyMock.mockClear();
    dispenseTaskFindManyMock.mockResolvedValue([
      { id: 'task_second_page', cycle_id: 'cycle_b', status: 'in_progress' },
    ]);
    const secondResponse = await GET(
      createRequest(
        `?phase=dispense&limit=1&cursor=${encodeURIComponent(firstBody.meta.next_cursor)}`,
      ),
      { params: Promise.resolve({}) },
    );
    const secondBody = await secondResponse.json();

    expect(secondBody.data.map((row: { patient_id: string }) => row.patient_id)).toEqual([
      'patient_b',
    ]);
    expect(secondBody.meta).toMatchObject({
      limit: 1,
      returned_count: 1,
      has_more: false,
      next_cursor: null,
      total_count: 2,
    });
    expect(dispenseTaskFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cycle_id: { in: ['cycle_b'] } }),
      }),
    );
  });

  it('rejects a cursor when filters change between pages', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_a',
        patient_id: 'patient_a',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'アア',
      }),
      cycle({
        id: 'cycle_b',
        patient_id: 'patient_b',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        nameKana: 'イイ',
      }),
    ]);
    const firstResponse = await GET(createRequest('?phase=dispense&limit=1'), {
      params: Promise.resolve({}),
    });
    const firstBody = await firstResponse.json();
    medicationCycleFindManyMock.mockClear();

    const mismatchResponse = await GET(
      createRequest(
        `?phase=audit&limit=1&cursor=${encodeURIComponent(firstBody.meta.next_cursor)}`,
      ),
      { params: Promise.resolve({}) },
    );

    expect(mismatchResponse.status).toBe(400);
    expectNoStore(mismatchResponse);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
  });

  it('rejects tampered cursor payloads before querying', async () => {
    const response = await GET(createRequest('?phase=dispense&cursor=abc.def'), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
  });

  it('does not echo q in response metadata or cursor payload', async () => {
    medicationCycleFindManyMock.mockResolvedValue([
      cycle({
        id: 'cycle_a',
        patient_id: 'patient_a',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        name: '山田 太郎',
        nameKana: 'ヤマダ タロウ',
      }),
      cycle({
        id: 'cycle_b',
        patient_id: 'patient_b',
        overall_status: 'dispensing',
        patientCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        name: '佐藤 花子',
        nameKana: 'サトウ ハナコ',
      }),
    ]);

    const response = await GET(createRequest('?phase=dispense&q=secret-token&limit=1'), {
      params: Promise.resolve({}),
    });
    const body = await response.json();

    expect(body.meta.filters_applied).toMatchObject({ q_present: true });
    expect(JSON.stringify({ meta: body.meta })).not.toContain('secret-token');
    expect(body.meta.next_cursor).not.toContain('secret-token');
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
    expectNoStore(response);
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when patient listing fails unexpectedly', async () => {
    medicationCycleFindManyMock.mockRejectedValueOnce(
      new Error('raw dispense workbench patient medication secret'),
    );

    const response = await GET(createRequest(), { params: Promise.resolve({}) });

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({
      code: 'INTERNAL_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('patient medication secret');
  });
});
