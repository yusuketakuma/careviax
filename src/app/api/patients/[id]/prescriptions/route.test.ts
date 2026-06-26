import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { patientFindFirstMock, careCaseFindManyMock, prescriptionIntakeFindManyMock } = vi.hoisted(
  () => ({
    patientFindFirstMock: vi.fn(),
    careCaseFindManyMock: vi.fn(),
    prescriptionIntakeFindManyMock: vi.fn(),
  }),
);

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (
    handler: (
      req: NextRequest,
      ctx: { orgId: string; userId: string; role: string },
      routeContext: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
  ) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
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

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/prescriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      patient: expect.objectContaining({ id: 'patient_1' }),
      data: [{ id: 'intake_2', cycle_id: 'cycle_2' }],
      hasMore: true,
      nextCursor: expect.any(String),
    });
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
          }),
        }),
      }),
    );
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
    expect(body.diff_review.rows).toEqual([
      expect.objectContaining({
        key: 'line_current_evening',
        change_type: 'changed',
        previous_label: '1錠 夕食後 28日',
        current_label: '2錠 夕食後 28日',
        pharmacist_memo: '夕のみ増量',
      }),
      expect.objectContaining({
        key: 'line_current_morning',
        change_type: 'unchanged',
        previous_label: '1錠 朝食後 28日',
        current_label: '同じ',
      }),
    ]);
    expect(body.diff_review.change_count).toBe(1);
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
      patient: expect.objectContaining({ id: 'patient_1' }),
      data: [],
      hasMore: false,
      diff_review: null,
      diff_meta: null,
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
    patientFindFirstMock.mockRejectedValueOnce(new Error(rawError));

    const response = (await GET(createGetRequest('patient_1', 'limit=5'), {
      params: Promise.resolve({ id: 'patient_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
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
