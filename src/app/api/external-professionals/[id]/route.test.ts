import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { externalProfessionalFindFirstMock, withOrgContextMock } = vi.hoisted(() => ({
  externalProfessionalFindFirstMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(
        req,
        { orgId: 'org_1', userId: 'user_1', ipAddress: '127.0.0.1', userAgent: 'vitest' },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    externalProfessional: {
      findFirst: externalProfessionalFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/patient/facility-reference', () => ({
  assertFacilityReference: vi.fn(),
}));

import { GET, DELETE } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/external-professionals/ep_1');
}

describe('/api/external-professionals/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    externalProfessionalFindFirstMock.mockResolvedValue({
      id: 'ep_1',
      profession_type: 'doctor',
      name: '田中医師',
      facility_id: null,
      facility: null,
      organization_name: 'テスト病院',
      department: null,
      phone: null,
      email: null,
      fax: null,
      preferred_contact_method: null,
      preferred_contact_time: null,
      last_contacted_at: null,
      last_success_channel: null,
      address: null,
      notes: null,
      created_at: new Date('2026-01-01'),
      updated_at: new Date('2026-01-01'),
      _count: { care_team_links: 2 },
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        externalProfessional: {
          delete: vi.fn().mockResolvedValue({ id: 'ep_1' }),
        },
      }),
    );
  });

  describe('GET', () => {
    it('returns 200 with professional detail', async () => {
      const response = (await GET(createRequest(), { params: Promise.resolve({ id: 'ep_1' }) }))!;

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.name).toBe('田中医師');
    });

    it('returns 404 when not found', async () => {
      externalProfessionalFindFirstMock.mockResolvedValue(null);

      const response = (await GET(createRequest(), {
        params: Promise.resolve({ id: 'nonexistent' }),
      }))!;

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE', () => {
    it('returns 200 when deleting', async () => {
      externalProfessionalFindFirstMock.mockResolvedValueOnce({
        id: 'ep_1',
        _count: { care_team_links: 0 },
      });

      const response = (await DELETE(createRequest(), {
        params: Promise.resolve({ id: 'ep_1' }),
      }))!;

      expect(response.status).toBe(200);
    });
  });
});
