import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  medicationProfileFindManyMock,
  medicationProfileCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  medicationProfileFindManyMock: vi.fn(),
  medicationProfileCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>,
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/medication-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    medicationProfileFindManyMock.mockResolvedValue([
      { id: 'profile_1', patient_id: 'patient_1', drug_name: 'アムロジピン' },
    ]);
    medicationProfileCreateMock.mockResolvedValue({
      id: 'profile_2',
      patient_id: 'patient_1',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationProfile: {
          create: medicationProfileCreateMock,
        },
      }),
    );
  });

  it('lists medication profiles', async () => {
    const response = (await GET({
      url: 'http://localhost/api/medication-profiles?patient_id=patient_1&is_current=true',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'profile_1', drug_name: 'アムロジピン' }],
    });
  });

  it('creates a medication profile with normalized dates', async () => {
    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
        start_date: '2026-03-29',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(201);
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        drug_name: 'アムロジピン',
        start_date: new Date('2026-03-29'),
      }),
    });
  });
});
