import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: 'pharmacist';
};

const {
  withAuthMock,
  visitRecordFindManyMock,
  visitRecordFindFirstMock,
  residualMedicationFindManyMock,
  residualMedicationCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((handler: (req: AuthenticatedTestRequest) => Promise<Response>) => {
    return (req: NextRequest) =>
      handler(
        Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist' as const,
        }),
      );
  }),
  visitRecordFindManyMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
  residualMedicationCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        AND: [
          {
            schedule: {
              OR: expect.arrayContaining([
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ]),
            },
          },
        ],
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

  it('rejects malformed residual medication limits before visit record lookup', async () => {
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }]);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=20abc'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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

  it('rejects oversized residual medication limits before visit record lookup', async () => {
    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=9999'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitRecordFindManyMock).not.toHaveBeenCalled();
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('preserves unbounded residual medication reads when limit is omitted', async () => {
    visitRecordFindManyMock.mockResolvedValue([{ id: 'visit_1' }]);

    await GET(createRequest('http://localhost/api/residual-medications?patient_id=patient_1'));

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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });

  it('returns an empty payload before reading residuals for an inaccessible visit record', async () => {
    visitRecordFindFirstMock.mockResolvedValue(null);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?visit_record_id=visit_2'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'visit_1',
        org_id: 'org_1',
        AND: [
          {
            schedule: {
              OR: expect.arrayContaining([
                { pharmacist_id: 'user_1' },
                { case_: { primary_pharmacist_id: 'user_1' } },
                { case_: { backup_pharmacist_id: 'user_1' } },
              ]),
            },
          },
        ],
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
    const response = await POST(createRequest('http://localhost/api/residual-medications', []));

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before visit record lookup or writes', async () => {
    const response = await POST(
      createMalformedJsonRequest('http://localhost/api/residual-medications'),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(residualMedicationCreateMock).not.toHaveBeenCalled();
  });
});
