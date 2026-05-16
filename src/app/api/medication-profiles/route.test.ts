import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  patientFindFirstMock,
  medicationProfileFindManyMock,
  medicationProfileCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  patientFindFirstMock: vi.fn(),
  medicationProfileFindManyMock: vi.fn(),
  medicationProfileCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
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
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
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
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
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
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'patient_1',
        org_id: 'org_1',
        AND: [
          {
            cases: {
              some: {
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              },
            },
          },
        ],
      }),
      select: { id: true },
    });
    expect(medicationProfileFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          is_current: true,
          patient: {
            cases: {
              some: expect.objectContaining({
                OR: expect.arrayContaining([
                  { primary_pharmacist_id: 'user_1' },
                  { backup_pharmacist_id: 'user_1' },
                  { visit_schedules: { some: { pharmacist_id: 'user_1' } } },
                ]),
              }),
            },
          },
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'profile_1', drug_name: 'アムロジピン' }],
    });
  });

  it('hides an inaccessible patient before reading medication profiles', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await GET({
      url: 'http://localhost/api/medication-profiles?patient_id=patient_2',
    } as NextRequest))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      hasMore: false,
    });
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
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

  it('returns 404 before creating a medication profile for an inaccessible patient', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_2',
        drug_name: 'アムロジピン',
      }),
    } as NextRequest))!;

    expect(response.status).toBe(404);
    expect(medicationProfileFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });
});
