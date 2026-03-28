import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  visitRecordFindManyMock,
  residualMedicationFindManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  visitRecordFindManyMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findMany: visitRecordFindManyMock,
    },
    residualMedication: {
      findMany: residualMedicationFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return { url } as unknown as NextRequest;
}

describe('/api/residual-medications GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    residualMedicationFindManyMock.mockResolvedValue([]);
  });

  it('filters residual medications by patient visit records when patient_id is provided', async () => {
    visitRecordFindManyMock.mockResolvedValue([
      { id: 'visit_1' },
      { id: 'visit_2' },
    ]);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_1&limit=20')
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
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

  it('returns an empty payload without querying residuals when the patient has no visit records', async () => {
    visitRecordFindManyMock.mockResolvedValue([]);

    const response = await GET(
      createRequest('http://localhost/api/residual-medications?patient_id=patient_404')
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
    });
    expect(residualMedicationFindManyMock).not.toHaveBeenCalled();
  });
});
