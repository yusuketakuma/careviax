import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { facilityFindFirstMock, residenceFindManyMock } = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facility: {
      findFirst: facilityFindFirstMock,
    },
    residence: {
      findMany: residenceFindManyMock,
    },
  },
}));

import { GET } from './route';

const createRequest = () => new NextRequest('http://localhost/api/facilities/facility_1/patients');

function expectNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/facilities/[id]/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      name: 'あおば苑',
    });
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_1',
        address: '東京都千代田区1-1-1',
        unit_name: '203',
        patient: {
          id: 'patient_1',
          name: '山田 太郎',
          name_kana: 'ヤマダ タロウ',
          phone: '03-1111-2222',
          cases: [
            {
              id: 'case_1',
              status: 'active',
            },
          ],
        },
      },
    ]);
  });

  it('returns patients assigned to the facility', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(residenceFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
        is_primary: true,
      },
      orderBy: [{ unit_name: 'asc' }, { created_at: 'asc' }],
      select: expect.any(Object),
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        facility_id: 'facility_1',
        facility_name: 'あおば苑',
        patients: [
          expect.objectContaining({
            patient_id: 'patient_1',
            patient_name: '山田 太郎',
            case_status: 'active',
          }),
        ],
      },
    });
  });

  it('returns a no-store 404 when the facility does not exist', async () => {
    facilityFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectNoStore(response);
  });

  it('returns a sanitized no-store 500 when facility patients fail to load', async () => {
    residenceFindManyMock.mockRejectedValueOnce(new Error('raw patient facility secret'));

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectNoStore(response);
    const bodyText = await response.text();
    expect(bodyText).toContain('INTERNAL_ERROR');
    expect(bodyText).not.toContain('raw patient facility secret');
  });
});
