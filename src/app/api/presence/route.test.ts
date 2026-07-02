import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  userFindUniqueMock,
  visitRecordFindFirstMock,
  dispenseTaskFindFirstMock,
  setPresenceMock,
  getPresenceMock,
  broadcastStatusUpdateMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  dispenseTaskFindFirstMock: vi.fn(),
  setPresenceMock: vi.fn(),
  getPresenceMock: vi.fn(),
  broadcastStatusUpdateMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    visitRecord: { findFirst: visitRecordFindFirstMock },
    dispenseTask: { findFirst: dispenseTaskFindFirstMock },
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

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { POST, GET } from './route';

function createRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : {
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
  });
}

function createMalformedPostRequest() {
  return new NextRequest('http://localhost/api/presence', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: '{',
  });
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/presence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue(authCtx);
    visitRecordFindFirstMock.mockResolvedValue({ id: 'vr_1' });
    dispenseTaskFindFirstMock.mockResolvedValue({ id: 'dt_1' });
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
      expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'vr_1',
          org_id: 'org_1',
        },
        select: { id: true },
      });
      expect(setPresenceMock).toHaveBeenCalledWith(
        'org_1',
        'visit_record',
        'vr_1',
        'user_1',
        'Taro',
        'soap_plan',
      );
      expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('presence:org_1:visit_record:vr_1', {
        type: 'presence_update',
        entity_type: 'visit_record',
        entity_id: 'vr_1',
        user_id: 'user_1',
        display_name: 'Taro',
        active_field: 'soap_plan',
        updated_at: expect.any(String),
      });
    });

    it('returns 400 on invalid body', async () => {
      const req = createRequest('http://localhost/api/presence', {
        entity_type: '',
      });
      const res = await POST(req);
      expect(res!.status).toBe(400);
      expect(setPresenceMock).not.toHaveBeenCalled();
      expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON before access checks or broadcasting', async () => {
      const res = await POST(createMalformedPostRequest());

      expect(res!.status).toBe(400);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(setPresenceMock).not.toHaveBeenCalled();
      expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    });

    it('rejects non-object update payloads before access checks or broadcasting', async () => {
      const req = createRequest('http://localhost/api/presence', []);
      const res = await POST(req);

      expect(res!.status).toBe(400);
      expect(visitRecordFindFirstMock).not.toHaveBeenCalled();
      expect(dispenseTaskFindFirstMock).not.toHaveBeenCalled();
      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(setPresenceMock).not.toHaveBeenCalled();
      expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    });

    it('returns 404 before writing or broadcasting when the entity is inaccessible', async () => {
      visitRecordFindFirstMock.mockResolvedValue(null);

      const req = createRequest('http://localhost/api/presence', {
        entity_type: 'visit_record',
        entity_id: 'vr_unassigned',
        active_field: 'soap_plan',
      });
      const res = await POST(req);

      expect(res!.status).toBe(404);
      expect(userFindUniqueMock).not.toHaveBeenCalled();
      expect(setPresenceMock).not.toHaveBeenCalled();
      expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
    });

    it('authorizes dispense task presence org-wide for org-wide roles', async () => {
      userFindUniqueMock.mockResolvedValue({ name: 'Taro' });
      broadcastStatusUpdateMock.mockResolvedValue(undefined);

      const req = createRequest('http://localhost/api/presence', {
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        active_field: null,
      });
      const res = await POST(req);

      expect(res!.status).toBe(200);
      expect(dispenseTaskFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'dt_1',
          org_id: 'org_1',
        },
        select: { id: true },
      });
      expect(setPresenceMock).toHaveBeenCalledWith(
        'org_1',
        'dispense_task',
        'dt_1',
        'user_1',
        'Taro',
        null,
      );
      expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('presence:org_1:dispense_task:dt_1', {
        type: 'presence_update',
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
        user_id: 'user_1',
        display_name: 'Taro',
        active_field: null,
        updated_at: expect.any(String),
      });
    });

    it('keeps the heartbeat successful when realtime broadcast fails', async () => {
      userFindUniqueMock.mockResolvedValue({ name: 'Taro' });
      broadcastStatusUpdateMock.mockRejectedValue(new Error('redis unavailable'));

      const req = createRequest('http://localhost/api/presence', {
        entity_type: 'visit_record',
        entity_id: 'vr_1',
        active_field: 'soap_plan',
      });
      const res = await POST(req);

      expect(res!.status).toBe(200);
      expect(setPresenceMock).toHaveBeenCalledWith(
        'org_1',
        'visit_record',
        'vr_1',
        'user_1',
        'Taro',
        'soap_plan',
      );
      expect(broadcastStatusUpdateMock).toHaveBeenCalledWith(
        'presence:org_1:visit_record:vr_1',
        expect.objectContaining({
          type: 'presence_update',
          entity_type: 'visit_record',
          entity_id: 'vr_1',
        }),
      );
    });

    it('logs safe warning metadata when realtime broadcast fails', async () => {
      userFindUniqueMock.mockResolvedValue({ name: 'Taro' });
      const rawError = 'redis unavailable token=secret 患者A';
      const cause = new Error(rawError);
      broadcastStatusUpdateMock.mockRejectedValue(cause);

      const req = createRequest('http://localhost/api/presence', {
        entity_type: 'visit_record',
        entity_id: 'vr_1',
        active_field: 'soap_plan',
      });
      const res = await POST(req);

      expect(res!.status).toBe(200);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        {
          event: 'presence_realtime_broadcast_failed',
          route: '/api/presence',
          method: 'POST',
          operation: 'presence_update_broadcast',
          orgId: 'org_1',
          entityType: 'visit_record',
        },
        cause,
      );
      expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain(rawError);
      expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('soap_plan');
      expect(JSON.stringify(loggerWarnMock.mock.calls[0]?.[0])).not.toContain('Taro');
    });
  });

  describe('GET', () => {
    it('returns 200 with presence entries', async () => {
      const entries = [{ user_id: 'user_1', display_name: 'Taro' }];
      getPresenceMock.mockReturnValue(entries);

      const req = createRequest(
        'http://localhost/api/presence?entity_type=visit_record&entity_id=vr_1',
      );
      const res = await GET(req);
      expect(res!.status).toBe(200);
      const json = await res!.json();
      expect(json).toHaveLength(1);
      expect(visitRecordFindFirstMock).toHaveBeenCalledWith({
        where: {
          id: 'vr_1',
          org_id: 'org_1',
        },
        select: { id: true },
      });
    });

    it('returns 400 when params missing', async () => {
      const req = createRequest('http://localhost/api/presence');
      const res = await GET(req);
      expect(res!.status).toBe(400);
      expect(getPresenceMock).not.toHaveBeenCalled();
    });

    it('returns 400 for unsupported entity types before reading presence', async () => {
      // care_report 等はコメント連携で許可されたため、真に未対応な値で検証する。
      const req = createRequest(
        'http://localhost/api/presence?entity_type=unsupported_entity&entity_id=x_1',
      );
      const res = await GET(req);
      expect(res!.status).toBe(400);
      expect(getPresenceMock).not.toHaveBeenCalled();
    });

    it('returns 404 before reading presence entries when the entity is inaccessible', async () => {
      visitRecordFindFirstMock.mockResolvedValue(null);

      const req = createRequest(
        'http://localhost/api/presence?entity_type=visit_record&entity_id=vr_unassigned',
      );
      const res = await GET(req);

      expect(res!.status).toBe(404);
      expect(getPresenceMock).not.toHaveBeenCalled();
    });
  });
});
