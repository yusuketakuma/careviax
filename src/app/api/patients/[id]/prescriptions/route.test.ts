import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  patientFindFirstMock,
  careCaseFindManyMock,
  prescriptionIntakeFindManyMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withOrgContextMock,
  withRoutePerformanceMock,
  loggerErrorMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  prescriptionIntakeFindManyMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  withRoutePerformanceMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    prescriptionIntake: {
      findMany: prescriptionIntakeFindManyMock,
    },
  },
}));

import { GET } from './route';

function createGetRequest(patientId: string, query = '') {
  return new NextRequest(
    `http://localhost/api/patients/${patientId}/prescriptions${query ? `?${query}` : ''}`,
  );
}

describe('/api/patients/[id]/prescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const ctx = {
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      ipAddress: '203.0.113.10',
      userAgent: 'vitest',
    };
    requireAuthContextMock.mockResolvedValue({ ctx });
    runWithRequestAuthContextMock.mockImplementation(
      (_ctx: typeof ctx, fn: () => Promise<Response>) => fn(),
    );
    withRoutePerformanceMock.mockImplementation((_req: NextRequest, fn: () => Promise<Response>) =>
      fn(),
    );
    withOrgContextMock.mockImplementation((_orgId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        patient: {
          findFirst: patientFindFirstMock,
        },
        careCase: {
          findMany: careCaseFindManyMock,
        },
        prescriptionIntake: {
          findMany: prescriptionIntakeFindManyMock,
        },
      }),
    );
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
    });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    prescriptionIntakeFindManyMock.mockResolvedValue([
      { id: 'intake_1', cycle_id: 'cycle_1', lines: [] },
    ]);
  });

  it('returns patient prescriptions with pagination metadata', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_2',
        cycle_id: 'cycle_2',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [],
      },
      {
        id: 'intake_1',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: { patient_id: 'patient_1', case_id: { in: ['case_1'] } },
        }),
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient: expect.objectContaining({ id: 'patient_1' }),
        data: [{ id: 'intake_2', cycle_id: 'cycle_2' }],
        hasMore: true,
        nextCursor: expect.any(String),
      },
    });
  });

  it('uses route-local auth, performance tracking, and explicit RLS request context', async () => {
    const response = (await GET(createGetRequest('patient_1', 'limit=5'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '患者処方履歴の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
      expect.any(Function),
    );
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
  });

  it('returns no-store auth failures before reading prescription PHI', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response('forbidden', { status: 403 }),
    });

    const response = (await GET(createGetRequest('patient_1', 'limit=5'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
  });

  it('filters previous prescriptions to the requested accessible case', async () => {
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }, { id: 'case_2' }]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_2'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(prescriptionIntakeFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          cycle: { patient_id: 'patient_1', case_id: { in: ['case_2'] } },
        }),
      }),
    );
  });

  it('selects intake and line updated_at for previous-prescription reuse provenance', async () => {
    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs.select).toEqual(
      expect.objectContaining({
        updated_at: true,
        lines: expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            updated_at: true,
            drug_master_id: true,
            drug_code: true,
            source_drug_code: true,
            source_drug_code_type: true,
            drug_resolution_status: true,
          }),
        }),
      }),
    );
  });

  it('returns medication resolution fields so unresolved drugs are visible in history', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_unresolved',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [
          {
            id: 'line_unresolved',
            line_number: 1,
            drug_name: '未確認薬',
            drug_master_id: null,
            drug_code: null,
            source_drug_code: 'RC001',
            source_drug_code_type: 'receipt',
            drug_resolution_status: 'review_required',
            dose: '1錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.data[0].lines[0]).toMatchObject({
      drug_master_id: null,
      drug_code: null,
      source_drug_code: 'RC001',
      source_drug_code_type: 'receipt',
      drug_resolution_status: 'review_required',
    });
  });

  it('keeps diff review rows line-scoped when the same drug appears twice', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [
          {
            id: 'line_current_morning',
            drug_name: 'メトホルミン錠500mg',
            drug_master_id: 'drug_master_metformin',
            drug_code: 'YJ002',
            dose: '1錠',
            frequency: '朝食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
          {
            id: 'line_current_evening',
            drug_name: 'メトホルミン錠500mg',
            drug_master_id: 'drug_master_metformin',
            drug_code: 'YJ002',
            dose: '2錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: '夕のみ増量',
          },
        ],
      },
      {
        id: 'intake_previous',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [
          {
            id: 'line_previous_morning',
            drug_name: 'メトホルミン錠500mg',
            drug_master_id: 'drug_master_metformin',
            drug_code: 'YJ002',
            dose: '1錠',
            frequency: '朝食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
          {
            id: 'line_previous_evening',
            drug_name: 'メトホルミン錠500mg',
            drug_master_id: 'drug_master_metformin',
            drug_code: 'YJ002',
            dose: '1錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.diff_review.rows).toEqual([
      expect.objectContaining({
        key: 'line_current_evening',
        current_drug_master_id: 'drug_master_metformin',
        current_drug_code: 'YJ002',
        previous_drug_master_id: 'drug_master_metformin',
        previous_drug_code: 'YJ002',
        change_type: 'changed',
        previous_label: '1錠 夕食後 28日',
        current_label: '2錠 夕食後 28日',
        pharmacist_memo: '夕のみ増量',
      }),
      expect.objectContaining({
        key: 'line_current_morning',
        current_drug_master_id: 'drug_master_metformin',
        current_drug_code: 'YJ002',
        previous_drug_master_id: 'drug_master_metformin',
        previous_drug_code: 'YJ002',
        change_type: 'unchanged',
        previous_label: '1錠 朝食後 28日',
        current_label: '同じ',
      }),
    ]);
    expect(body.data.diff_review.change_count).toBe(1);
  });

  it('matches diff review rows by drug code when names are identical', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [
          {
            id: 'line_current_b',
            drug_name: '同名薬',
            drug_code: 'YJ_B',
            dose: '2錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
      {
        id: 'intake_previous',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [
          {
            id: 'line_previous_a',
            drug_name: '同名薬',
            drug_code: 'YJ_A',
            dose: '1錠',
            frequency: '朝食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
          {
            id: 'line_previous_b',
            drug_name: '同名薬',
            drug_code: 'YJ_B',
            dose: '1錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.diff_review.rows).toContainEqual(
      expect.objectContaining({
        key: 'line_current_b',
        current_drug_code: 'YJ_B',
        previous_drug_code: 'YJ_B',
        change_type: 'changed',
        previous_label: '1錠 夕食後 28日',
        current_label: '2錠 夕食後 28日',
      }),
    );
    expect(body.data.diff_review.rows).toContainEqual(
      expect.objectContaining({
        key: 'removed-line_previous_a',
        current_drug_code: null,
        previous_drug_code: 'YJ_A',
        change_type: 'removed',
      }),
    );
  });

  it('keeps diff review master-scoped when drug codes are identical but drug masters differ', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [
          {
            id: 'line_current_master_b',
            drug_name: '同一コード薬B',
            drug_master_id: 'drug_master_b',
            drug_code: 'YJ_SHARED',
            dose: '1錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
      {
        id: 'intake_previous',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [
          {
            id: 'line_previous_master_a',
            drug_name: '同一コード薬A',
            drug_master_id: 'drug_master_a',
            drug_code: 'YJ_SHARED',
            dose: '1錠',
            frequency: '夕食後',
            days: 28,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.diff_review.rows).toContainEqual(
      expect.objectContaining({
        key: 'line_current_master_b',
        current_drug_master_id: 'drug_master_b',
        current_drug_code: 'YJ_SHARED',
        previous_drug_master_id: null,
        previous_drug_code: null,
        change_type: 'added',
      }),
    );
    expect(body.data.diff_review.rows).toContainEqual(
      expect.objectContaining({
        key: 'removed-line_previous_master_a',
        current_drug_master_id: null,
        current_drug_code: null,
        previous_drug_master_id: 'drug_master_a',
        previous_drug_code: 'YJ_SHARED',
        change_type: 'removed',
      }),
    );
  });

  it('keeps removed diff review fallback keys bare when a legacy row id is missing', async () => {
    prescriptionIntakeFindManyMock.mockResolvedValue([
      {
        id: 'intake_current',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
        created_at: new Date('2026-04-20T10:00:00.000Z'),
        lines: [],
      },
      {
        id: 'intake_previous',
        cycle_id: 'cycle_1',
        prescribed_date: new Date('2026-04-01T00:00:00.000Z'),
        created_at: new Date('2026-04-01T10:00:00.000Z'),
        lines: [
          {
            id: '',
            drug_name: '中止薬',
            drug_master_id: null,
            drug_code: 'YJ_REMOVED',
            dose: '1錠',
            frequency: '朝食後',
            days: 14,
            packaging_instructions: null,
            dispensing_method: null,
            start_date: null,
            notes: null,
          },
        ],
      },
    ]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_1'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.diff_review.rows[0]).toEqual(
      expect.objectContaining({
        key: 'removed-YJ_REMOVED',
        current_drug_master_id: null,
        current_drug_code: null,
        previous_drug_master_id: null,
        previous_drug_code: 'YJ_REMOVED',
        change_type: 'removed',
      }),
    );
    expect(JSON.stringify(body.data.diff_review.rows)).not.toContain('code:');
  });

  it('returns an empty result for inaccessible case filters without loading prescriptions', async () => {
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);

    const response = (await GET(createGetRequest('patient_1', 'limit=5&case_id=case_other'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        patient: expect.objectContaining({ id: 'patient_1' }),
        data: [],
        hasMore: false,
        diff_review: null,
        diff_meta: null,
      },
    });
  });

  it('rejects blank patient ids before loading prescriptions', async () => {
    const response = (await GET(createGetRequest('%20%20', 'limit=1'), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when prescription reads fail', async () => {
    const rawError = 'raw patient prescriptions read failure';
    const unsafeError = new Error(rawError);
    patientFindFirstMock.mockRejectedValueOnce(unsafeError);

    const response = (await GET(createGetRequest('patient_1', 'limit=5'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'patient_prescriptions_get_unhandled_error',
        route: '/api/patients/[id]/prescriptions',
        method: 'GET',
        status: 500,
      },
      unsafeError,
    );
    const [routeContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(routeContext).not.toHaveProperty('error_name');
    expect(JSON.stringify(routeContext)).not.toContain(rawError);
  });

  it.each([
    {
      query: 'limit=5&case_id=',
      details: { case_id: ['case_id が不正です'] },
    },
    {
      query: 'limit=5&case_id=%20case_1%20',
      details: { case_id: ['case_id が不正です'] },
    },
    {
      query: 'limit=5&case_id=case_1&case_id=case_2',
      details: { case_id: ['case_id は1つだけ指定してください'] },
    },
  ])(
    'rejects invalid case_id query $query before loading prescriptions',
    async ({ query, details }) => {
      const response = (await GET(createGetRequest('patient_1', query), {
        params: Promise.resolve({ id: 'patient_1' }),
      }))!;

      expect(response.status).toBe(400);
      expectSensitiveNoStore(response);
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details,
      });
      expect(patientFindFirstMock).not.toHaveBeenCalled();
      expect(careCaseFindManyMock).not.toHaveBeenCalled();
      expect(prescriptionIntakeFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('uses keyset cursor conditions after the first page', async () => {
    const keysetCursor = Buffer.from(
      JSON.stringify({
        prescribed_date: '2026-04-20T00:00:00.000Z',
        created_at: '2026-04-20T10:00:00.000Z',
        id: 'intake_2',
      }),
      'utf8',
    ).toString('base64url');

    const response = (await GET(createGetRequest('patient_1', `limit=20&cursor=${keysetCursor}`), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { prescribed_date: { lt: new Date('2026-04-20T00:00:00.000Z') } },
            {
              prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
              created_at: { lt: new Date('2026-04-20T10:00:00.000Z') },
            },
            {
              prescribed_date: new Date('2026-04-20T00:00:00.000Z'),
              created_at: new Date('2026-04-20T10:00:00.000Z'),
              id: { lt: 'intake_2' },
            },
          ],
        }),
      }),
    );
  });

  it('ignores legacy numeric cursors instead of offset paging', async () => {
    const response = (await GET(createGetRequest('patient_1', 'limit=20&cursor=20'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(200);
    const findManyArgs = prescriptionIntakeFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs).not.toHaveProperty('skip');
    expect(findManyArgs.where).not.toHaveProperty('OR');
  });
});
