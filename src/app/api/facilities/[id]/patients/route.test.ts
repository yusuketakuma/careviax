import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const { facilityFindFirstMock, residenceCountMock, residenceFindManyMock } = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceCountMock: vi.fn(),
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
      count: residenceCountMock,
      findMany: residenceFindManyMock,
    },
  },
}));

import { GET } from './route';

const createRequest = (query = '') =>
  new NextRequest(`http://localhost/api/facilities/facility_1/patients${query}`);

describe('/api/facilities/[id]/patients GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'facility_1',
      name: 'あおば苑',
    });
    residenceCountMock.mockResolvedValue(1);
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
          archived_at: null,
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
        patient: { archived_at: null },
      },
      orderBy: [{ unit_name: 'asc' }, { created_at: 'asc' }],
      take: 101,
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
            archive: { status: 'active', archived: false, archived_at: null },
          }),
        ],
      },
      metadata: {
        limit: 100,
        total_count: 1,
        visible_count: 1,
        hidden_count: 0,
        has_more: false,
        count_basis: 'primary_residences',
        filters_applied: {
          facility_id: 'facility_1',
          archive_status: 'active',
          assignment_scoped: false,
        },
      },
    });
  });

  it('returns archived patients only when archive_status=archived is explicit and exposes hidden counts', async () => {
    residenceCountMock.mockResolvedValue(2);
    residenceFindManyMock.mockResolvedValue([
      {
        id: 'residence_archived_1',
        address: '東京都千代田区1-1-1',
        unit_name: '203',
        patient: {
          id: 'patient_archived_1',
          name: '佐藤 太郎',
          name_kana: 'サトウ タロウ',
          phone: '03-1111-2222',
          archived_at: new Date('2026-04-01T09:30:00.000Z'),
          cases: [{ id: 'case_archived_1', status: 'archived' }],
        },
      },
      {
        id: 'residence_archived_2',
        address: '東京都千代田区2-2-2',
        unit_name: '204',
        patient: {
          id: 'patient_archived_2',
          name: '鈴木 花子',
          name_kana: 'スズキ ハナコ',
          phone: null,
          archived_at: new Date('2026-04-02T09:30:00.000Z'),
          cases: [{ id: 'case_archived_2', status: 'archived' }],
        },
      },
    ]);

    const response = await GET(createRequest('?archive_status=archived&limit=1'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(residenceCountMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        facility_id: 'facility_1',
        is_primary: true,
        patient: { archived_at: { not: null } },
      },
    });
    expect(residenceFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          facility_id: 'facility_1',
          is_primary: true,
          patient: { archived_at: { not: null } },
        },
        take: 2,
      }),
    );
    const body = await response.json();
    expect(body.data.patients).toHaveLength(1);
    expect(body.data.patients[0]).toMatchObject({
      patient_id: 'patient_archived_1',
      archived_at: '2026-04-01T09:30:00.000Z',
      archive: {
        status: 'archived',
        archived: true,
        archived_at: '2026-04-01T09:30:00.000Z',
      },
    });
    expect(body.metadata).toMatchObject({
      limit: 1,
      total_count: 2,
      visible_count: 1,
      hidden_count: 1,
      has_more: true,
      filters_applied: { archive_status: 'archived' },
    });
  });

  it('rejects malformed limit values before loading the facility', async () => {
    const response = await GET(createRequest('?limit=1.5'), {
      params: Promise.resolve({ id: 'facility_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { limit: ['limit は整数で指定してください'] },
    });
    expect(facilityFindFirstMock).not.toHaveBeenCalled();
    expect(residenceCountMock).not.toHaveBeenCalled();
    expect(residenceFindManyMock).not.toHaveBeenCalled();
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
