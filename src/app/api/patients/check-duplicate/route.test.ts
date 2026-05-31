import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & {
  orgId: string;
  userId: string;
  role: string;
};

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

function createGetRequest(search = '') {
  return Object.assign(new NextRequest(`http://localhost/api/patients/check-duplicate${search}`), {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'pharmacist',
  }) as AuthenticatedTestRequest;
}

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
    const response = (await GET(createGetRequest('?name=山田')))!;

    expect(response.status).toBe(400);
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });

  it('searches duplicates by name, birth date, and gender', async () => {
    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=male'),
    ))!;

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

  it('returns validation error for unsupported gender before querying patients', async () => {
    const response = (await GET(
      createGetRequest('?name=山田&date_of_birth=1950-01-01&gender=unknown'),
    ))!;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.gender).toEqual(['対応していない性別です']);
    expect(patientFindManyMock).not.toHaveBeenCalled();
  });
});
