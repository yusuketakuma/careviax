import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return {
    url,
    headers: { get: () => null },
  } as unknown as NextRequest;
}

describe('/api/patients/export GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '青葉 花子',
        name_kana: 'アオバ ハナコ',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'female',
        phone: '090-0000-0000',
        medical_insurance_number: 'med-1',
        care_insurance_number: 'care-1',
        created_at: new Date('2026-04-01T00:00:00.000Z'),
        residences: [{ address: '東京都新宿区1-1-1' }],
        cases: [{ status: 'active' }],
      },
    ]);
  });

  it('selects the filtered case status when exporting with case_status', async () => {
    const response = await GET(
      createRequest('http://localhost/api/patients/export?case_status=active')
    );

    if (!response) throw new Error('response is required');
    expect(patientFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cases: { some: { status: 'active' } },
        },
        include: expect.objectContaining({
          cases: {
            where: { status: 'active' },
            orderBy: { created_at: 'desc' },
            select: { status: true },
            take: 1,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv).toContain('active');
  });
});
