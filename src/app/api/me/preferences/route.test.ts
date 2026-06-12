import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  settingFindUniqueMock,
  withOrgContextMock,
  settingUpsertMock,
  auditLogCreateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  settingUpsertMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) =>
    async (req: NextRequest) => {
      const authResult = await requireAuthContextMock();
      if ('response' in authResult) return authResult.response;
      return handler(req, authResult.ctx, { params: Promise.resolve({}) });
    },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    setting: {
      findUnique: settingFindUniqueMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, PATCH } from './route';

const routeCtx = { params: Promise.resolve({}) };

function makePatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/me/preferences', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/me/preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'pharmacist',
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      },
    });
    settingFindUniqueMock.mockResolvedValue(null);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    settingUpsertMock.mockResolvedValue({ id: 'setting_1' });
    withOrgContextMock.mockImplementation(async (_orgId: string, callback: (tx: unknown) => unknown) =>
      callback({
        setting: { upsert: settingUpsertMock },
        auditLog: { create: auditLogCreateMock },
      }),
    );
  });

  describe('GET', () => {
    it('returns default preferences when no setting exists', async () => {
      const response = await GET(new NextRequest('http://localhost/api/me/preferences'), routeCtx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({ work_mode: 'pharmacist', care_mode: 'home_visit' });
    });

    it('returns stored preferences', async () => {
      settingFindUniqueMock.mockResolvedValue({
        value: { work_mode: 'clerk_support', care_mode: 'outpatient' },
      });

      const response = await GET(new NextRequest('http://localhost/api/me/preferences'), routeCtx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({ work_mode: 'clerk_support', care_mode: 'outpatient' });
    });
  });

  describe('PATCH', () => {
    it('upserts preferences and creates an audit log', async () => {
      const response = await PATCH(
        makePatchRequest({ work_mode: 'clerk_support', care_mode: 'outpatient' }),
        routeCtx,
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({ work_mode: 'clerk_support', care_mode: 'outpatient' });

      expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
      expect(auditLogCreateMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          org_id: 'org_1',
          actor_id: 'user_1',
          action: 'user_preferences_updated',
          target_type: 'Setting',
          target_id: 'user_1',
        }),
      });
    });

    it('merges partial updates with existing preferences', async () => {
      settingFindUniqueMock.mockResolvedValue({
        value: { work_mode: 'pharmacist', care_mode: 'home_visit', start_page: '/dashboard' },
      });

      const response = await PATCH(makePatchRequest({ care_mode: 'outpatient' }), routeCtx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({
        work_mode: 'pharmacist',
        care_mode: 'outpatient',
        start_page: '/dashboard',
      });
    });

    it('stores the saved filter view (p1_01) alongside other preferences', async () => {
      settingFindUniqueMock.mockResolvedValue({
        value: { work_mode: 'pharmacist' },
      });

      const savedView = {
        conditions: [
          { field: 'visit_date', value: 'today_to_this_week' },
          { field: 'assignee', value: 'me' },
        ],
        saved_at: '2026-06-13T09:00:00.000Z',
      };

      const response = await PATCH(makePatchRequest({ saved_view: savedView }), routeCtx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toMatchObject({ work_mode: 'pharmacist', saved_view: savedView });
    });

    it('rejects saved_view conditions with unknown fields', async () => {
      const response = await PATCH(
        makePatchRequest({
          saved_view: { conditions: [{ field: 'unknown_field', value: 'x' }] },
        }),
        routeCtx,
      );

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects invalid work_mode values', async () => {
      const response = await PATCH(makePatchRequest({ work_mode: 'invalid_mode' }), routeCtx);

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('rejects invalid care_mode values', async () => {
      const response = await PATCH(makePatchRequest({ care_mode: 'invalid' }), routeCtx);

      expect(response.status).toBe(400);
      expect(withOrgContextMock).not.toHaveBeenCalled();
    });

    it('returns 400 when request body is malformed', async () => {
      const req = new NextRequest('http://localhost/api/me/preferences', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{"work_mode":',
      });

      const response = await PATCH(req, routeCtx);

      expect(response.status).toBe(400);
    });
  });
});
