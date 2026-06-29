import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  loggerErrorMock,
  requireAuthContextMock,
  runWithRequestAuthContextMock,
  withRoutePerformanceMock,
  visitRecordFindManyMock,
  visitRecordFindFirstMock,
  residualMedicationFindManyMock,
  residualMedicationCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  loggerErrorMock: vi.fn(),
  requireAuthContextMock: vi.fn(),
  runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
  withRoutePerformanceMock: vi.fn((_req, callback: () => unknown) => callback()),
  visitRecordFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  residualMedicationCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

const emptyRouteContext = { params: Promise.resolve({}) };
const authContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/lib/utils/performance', () => ({
  withRoutePerformance: withRoutePerformanceMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
      findFirst: visitRecordFindFirstMock,
    },
    residualMedication: {
      findMany: residualMedicationFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createMalformedJsonRequest(url: string) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"visit_record_id":',
  });
}

describe('/api/residual-medications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({ ctx: authContext });
    runWithRequestAuthContextMock.mockImplementation((_ctx, callback) => callback());
    visitRecordFindFirstMock.mockResolvedValue({ id: 'visit_1' });
    residualMedicationFindManyMock.mockResolvedValue([]);
    residualMedicationCreateMock.mockResolvedValue({
      id: 'residual_1',
      visit_record_id: 'visit_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        residualMedication: {
          create: residualMedicationCreateMock,
        },
      }),
    );
  });

  it('filters residual medications by patient visit records when patient_id is provided', async () => {
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }, { id: 'visit_2' }]);

    const response = await GET(
      createRequest(
        'http://localhost/api/residual-medications?patient_id=patient_1&limit=%2020%20',
      ),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '残薬情報の閲覧権限がありません',
    });
    expect(runWithRequestAuthContextMock).toHaveBeenCalledWith(authContext, expect.any(Function));
    expect(visitRecordFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(residualMedicationFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        visit_record_id: {
          in: ['visit_1', 'visit_2'],
        },
      },
      orderBy: { created_at: 'asc' },
      take: 20,
    });
  });

  it.each([
    ['patient_id=', 'patient_id', '患者IDを指定してください'],
    ['patient_id=%20patient_1', 'patient_id', '患者IDの形式が不正です'],
    ['visit_record_id=%20%20', 'visit_record_id', '訪問記録IDを指定してください'],
    ['visit_record_id=visit_1%20', 'visit_record_id', '訪問記録IDの形式が不正です'],
  ])(
    'rejects blank or padded residual medication filter query "%s" before DB access',
    async (query, fieldName, message) => {
      const response = await GET(
        createRequest(`http://localhost/api/residual-medications?${query}`),
        emptyRouteContext,
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [message],
        },
      });
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['patient_id=patient_1&patient_id=patient_2', 'patient_id'],
    ['visit_record_id=visit_1&visit_record_id=', 'visit_record_id'],
  ])(
    'rejects duplicate residual medication filter query "%s" before DB access',
    async (query, fieldName) => {
      const response = await GET(
        createRequest(`http://localhost/api/residual-medications?${query}`),
        emptyRouteContext,
      );

      if (!response) throw new Error('response is required');
      expect(response.status).toBe(400);
      expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
      expect(response.headers.get('Pragma')).toBe('no-cache');
      await expect(response.json()).resolves.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: {
          [fieldName]: [`${fieldName} は1つだけ指定してください`],
        },
      });
      expect(visitRecordFindManyMock).not.toHaveBeenCalled();
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed residual medication limits before visit record lookup', async () => {
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }]);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=20abc'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
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
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when residual listing fails unexpectedly', async () => {
    residualMedicationFindManyMock.mockRejectedValueOnce(
      new Error('raw residual medication listing secret'),
    );

    const response = await GET(
      createRequest('http://localhost/api/residual-medications'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw residual medication listing secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'residual_medications_get_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'residual_medications_get_unhandled_error',
        route: '/api/residual-medications',
        method: 'GET',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'raw residual medication listing secret',
    );
  });

  it('rejects oversized residual medication limits before visit record lookup', async () => {
    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=9999'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('preserves unbounded residual medication reads when limit is omitted', async () => {
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }]);

    await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1'),
      emptyRouteContext,
    );

    expect(residualMedicationFindManyMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        take: expect.any(Number),
      }),
    );
  });

  it('returns an empty payload without querying residuals when the patient has no visit records', async () => {
    visitRecordFindManyMock.mockResolvedValue([]);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_404'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('returns an empty payload before reading residuals for an inaccessible visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?visit_record_id=visit_2'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });

  it('creates residual medications for an accessible visit record', async () => {
    const response = await POST(
      createRequest('http://localhost/api/residual-medications', {
        visit_record_id: 'visit_1',
        medications: [
          {
            drug_name: 'アムロジピン',
            prescribed_daily_dose: 1,
            remaining_quantity: 10,
          },
        ],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withRoutePerformanceMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.any(Function),
    );
    expect(requireAuthContextMock).toHaveBeenCalledWith(expect.any(NextRequest), {
      permission: 'canVisit',
      message: '残薬情報の作成権限がありません',
    });
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(residualMedicationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        visit_record_id: 'visit_1',
        drug_name: 'アムロジピン',
        remaining_quantity: 10,
        excess_days: 10,
        is_reduction_target: true,
      }),
    });
  });

  it('rejects non-object create payloads before visit record lookup or writes', async () => {
    const response = await POST(
      createRequest('http://localhost/api/residual-medications', []),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before visit record lookup or writes', async () => {
    const response = await POST(
      createMalformedJsonRequest('http://localhost/api/residual-medications'),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'リクエストボディが不正です',
    });
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });

  it('returns 404 before writing residual medications for an inaccessible visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest('http://localhost/api/residual-medications', {
        visit_record_id: 'visit_2',
        medications: [
          {
            drug_name: 'アムロジピン',
            remaining_quantity: 10,
          },
        ],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 without raw logging when residual create fails unexpectedly', async () => {
    residualMedicationCreateMock.mockRejectedValueOnce(new Error('raw residual medication secret'));

    const response = await POST(
      createRequest('http://localhost/api/residual-medications', {
        visit_record_id: 'visit_1',
        medications: [
          {
            drug_name: 'アムロジピン',
            remaining_quantity: 10,
          },
        ],
      }),
      emptyRouteContext,
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw residual medication secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'residual_medications_post_unhandled_error',
      undefined,
      expect.objectContaining({
        event: 'residual_medications_post_unhandled_error',
        route: '/api/residual-medications',
        method: 'POST',
        status: 500,
        error_name: 'Error',
      }),
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain(
      'raw residual medication secret',
    );
  });
});
