import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { patientFindManyMock } = vi.hoisted(() => ({
  patientFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextRequest & { orgId: string; userId: string; role: string }) => Promise<Response>) =>
    handler,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/patients/check-duplicate GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '山田 太郎',
        name_kana: 'ヤマダ タロウ',
        birth_date: new Date('1950-01-01'),
        gender: 'male',
      },
    ]);
  });

  it('returns validation error for missing required query params', async () => {
    const response = (await GET({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      url: 'http://localhost/api/patients/check-duplicate?name=山田',
    } as unknown as NextRequest & { orgId: string; userId: string; role: string }))!;

    expect(response.status).toBe(400);
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('searches duplicates by name, birth date, and gender', async () => {
    const response = (await GET({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      url: 'http://localhost/api/patients/check-duplicate?name=山田&date_of_birth=1950-01-01&gender=male',
    } as unknown as NextRequest & { orgId: string; userId: string; role: string }))!;

    expect(response.status).toBe(200);
    expect(patientFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        name: {
          contains: '山田',
          mode: 'insensitive',
        },
        birth_date: new Date('1950-01-01'),
        gender: 'male',
      },
      select: {
        id: true,
        name: true,
        name_kana: true,
        birth_date: true,
        gender: true,
      },
      take: 10,
    });
  });
});
