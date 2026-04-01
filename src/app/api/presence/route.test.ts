import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  userFindUniqueMock,
  setPresenceMock,
  getPresenceMock,
  broadcastStatusUpdateMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  setPresenceMock: vi.fn(),
  getPresenceMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
  },
}));

vi.mock('@/server/services/presence-store', () => ({
  setPresence: setPresenceMock,
  getPresence: getPresenceMock,
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import { POST, GET } from './route';

function createRequest(url: string, body?: unknown) {
  return {
    url,
    method: body === undefined ? 'GET' : 'POST',
    headers: { get: () => null },
    nextUrl: new URL(url),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
  });

  describe('POST', () => {
    it('returns 200 on valid presence update', async () => {
      userFindUniqueMock.mockResolvedValue({ name: 'Taro' });
      broadcastStatusUpdateMock.mockResolvedValue(undefined);

      const req = createRequest('http://localhost/api/presence', {
        entity_type: 'visit_record',
        entity_id: 'vr_1',
        active_field: 'soap_plan',
      });
      const res = await POST(req);
      expect(res!.status).toBe(200);
      expect(setPresenceMock).toHaveBeenCalledWith(
        'org_1', 'visit_record', 'vr_1', 'user_1', 'Taro', 'soap_plan'
      );
    });

    it('returns 400 on invalid body', async () => {
      const req = createRequest('http://localhost/api/presence', {
        entity_type: '',
      });
      const res = await POST(req);
      expect(res!.status).toBe(400);
    });
  });

  describe('GET', () => {
    it('returns 200 with presence entries', async () => {
      const entries = [{ user_id: 'user_1', display_name: 'Taro' }];
      getPresenceMock.mockReturnValue(entries);

      const req = createRequest('http://localhost/api/presence?entity_type=visit_record&entity_id=vr_1');
      const res = await GET(req);
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json).toHaveLength(1);
    });

    it('returns 400 when params missing', async () => {
      const req = createRequest('http://localhost/api/presence');
      const res = await GET(req);
      expect(res!.status).toBe(400);
    });
  });
});
