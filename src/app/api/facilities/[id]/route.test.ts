import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  facilityFindFirstMock,
  residenceCountMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  facilityFindFirstMock: vi.fn(),
  residenceCountMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facility: {
      findFirst: facilityFindFirstMock,
    },
    residence: {
      count: residenceCountMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, DELETE } from './route';

describe('/api/facilities/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facilityFindFirstMock.mockResolvedValue({
      id: 'fac_1',
      name: 'テスト施設',
      facility_type: 'nursing_home',
      address: '東京都千代田区',
      phone: null,
      fax: null,
      acceptance_time_from: null,
      acceptance_time_to: null,
      regular_visit_weekdays: [],
      notes: null,
      contacts: [],
      _count: { residences: 3 },
    });
    residenceCountMock.mockResolvedValue(3);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        facility: {
          delete: vi.fn().mockResolvedValue({ id: 'fac_1' }),
        },
        residence: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with facility detail', async () => {
      const response = (await GET(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'fac_1' }) },
      ))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.name).toBe('テスト施設');
      expect(body.data.patient_count).toBe(3);
    });

    it('returns 404 when not found', async () => {
      facilityFindFirstMock.mockResolvedValue(null);

      const response = (await GET(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('returns 200 when deleting facility with no linked patients', async () => {
      const response = (await DELETE(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'fac_1' }) },
      ))!;

      expect(response.status).toBe(200);
    });

    it('returns 404 when facility not found', async () => {
      facilityFindFirstMock.mockResolvedValue(null);

      const response = (await DELETE(
        {} as NextRequest,
        { params: Promise.resolve({ id: 'nonexistent' }) },
      ))!;

      expect(response.status).toBe(404);
    });
  });
});
