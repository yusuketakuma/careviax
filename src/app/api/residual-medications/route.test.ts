import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  visitRecordFindManyMock,
  visitRecordFindFirstMock,
  residualMedicationFindManyMock,
  residualMedicationCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string; role: 'pharmacist' },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        } as NextRequest & { orgId: string; userId: string; role: 'pharmacist' });
    },
  ),
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
  return {
    url,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
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
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=20'),
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
