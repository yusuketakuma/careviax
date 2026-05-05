import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  authMock,
  membershipFindFirstMock,
  careCaseFindManyMock,
  userFindManyMock,
  patientFindFirstMock,
  careCaseCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    membership: {
      findFirst: membershipFindFirstMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
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
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' })[key] ?? null,
    },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist' });
    careCaseFindManyMock.mockResolvedValue([
      {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        primary_pharmacist_id: 'pharmacist_1',
        updated_at: new Date('2026-03-29T00:00:00.000Z'),
        patient: {
          id: 'patient_1',
          name: '患者A',
          name_kana: 'カンジャエー',
          residences: [],
        },
      },
    ]);
    userFindManyMock.mockResolvedValue([{ id: 'pharmacist_1', name: '担当薬剤師' }]);
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseCreateMock.mockResolvedValue({
      id: 'case_2',
      org_id: 'org_1',
      patient_id: 'patient_1',
      referral_source: '病院A',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          create: careCaseCreateMock,
        },
      }),
    );
  });

  it('lists cases and resolves primary pharmacist names', async () => {
    const response = (await GET(
      createRequest(
        'http://localhost/api/cases?patient_id=patient_1&status=active&q=%E6%82%A3%E8%80%85',
      ),
    ))!;

    expect(response.status).toBe(200);
    expect(careCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          status: 'active',
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'case_1',
          primary_pharmacist_name: '担当薬剤師',
        }),
      ],
    });
  });

  it('creates a case for a patient in the same org', async () => {
    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_1',
        referral_source: '病院A',
        referral_date: '2026-03-28',
        notes: '初回相談',
      }),
    ))!;

    expect(response.status).toBe(201);
    expect(careCaseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        referral_source: '病院A',
        notes: '初回相談',
      }),
    });
  });

  it('does not create a case for an unassigned patient', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(
      createRequest('http://localhost/api/cases', {
        patient_id: 'patient_2',
        referral_source: '病院A',
        referral_date: '2026-03-28',
        notes: '初回相談',
      }),
    ))!;

    expect(response.status).toBe(404);
    expect(careCaseCreateMock).not.toHaveBeenCalled();
  });
});
