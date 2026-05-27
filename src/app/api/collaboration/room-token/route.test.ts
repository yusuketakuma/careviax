import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  canAccessCollaborationEntityMock,
  buildCollaborationRoomNameMock,
  issueCollaborationRoomTokenMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  canAccessCollaborationEntityMock: vi.fn(),
  buildCollaborationRoomNameMock: vi.fn(),
  issueCollaborationRoomTokenMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: { findFirst: vi.fn() },
    visitRecord: { findFirst: vi.fn() },
  },
}));

vi.mock('@/server/services/collaboration-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/services/collaboration-access')>();
  return {
    ...actual,
    canAccessCollaborationEntity: canAccessCollaborationEntityMock,
    buildCollaborationRoomName: buildCollaborationRoomNameMock,
  };
});

vi.mock('@/server/services/collaboration-room-token', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/server/services/collaboration-room-token')>();
  return {
    ...actual,
    issueCollaborationRoomToken: issueCollaborationRoomTokenMock,
  };
});

import { POST } from './route';
import { MissingCollaborationRoomTokenSecretError } from '@/server/services/collaboration-room-token';

function createRequest(body: unknown) {
  return {
    url: 'http://localhost/api/collaboration/room-token',
    method: 'POST',
    headers: { get: () => null },
    nextUrl: new URL('http://localhost/api/collaboration/room-token'),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const authCtx = {
  ctx: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
};

describe('/api/collaboration/room-token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', 'wss://example.test/yjs');
    requireAuthContextMock.mockResolvedValue(authCtx);
    canAccessCollaborationEntityMock.mockResolvedValue(true);
    buildCollaborationRoomNameMock.mockReturnValue('org_1:dispense_task:dt_1');
    issueCollaborationRoomTokenMock.mockResolvedValue('room-token');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('issues a room token only after entity access is confirmed', async () => {
    const res = await POST(
      createRequest({
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      }),
    );

    expect(res.status).toBe(200);
    expect(canAccessCollaborationEntityMock).toHaveBeenCalledWith(
      authCtx.ctx,
      'dispense_task',
      'dt_1',
    );
    expect(buildCollaborationRoomNameMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });
    expect(issueCollaborationRoomTokenMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      userId: 'user_1',
      entityType: 'dispense_task',
      entityId: 'dt_1',
    });
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('pragma')).toBe('no-cache');
    expect(res.headers.get('expires')).toBe('0');
    await expect(res.json()).resolves.toMatchObject({
      room: 'org_1:dispense_task:dt_1',
      token: 'room-token',
      expires_at: expect.any(String),
    });
  });

  it('returns 404 before issuing a token when the entity is inaccessible', async () => {
    canAccessCollaborationEntityMock.mockResolvedValue(false);

    const res = await POST(
      createRequest({
        entity_type: 'dispense_task',
        entity_id: 'dt_unassigned',
      }),
    );

    expect(res.status).toBe(404);
    expect(issueCollaborationRoomTokenMock).not.toHaveBeenCalled();
  });

  it('returns 503 without access or token side effects when realtime is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_YJS_WEBSOCKET_URL', '');

    const res = await POST(
      createRequest({
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(canAccessCollaborationEntityMock).not.toHaveBeenCalled();
    expect(issueCollaborationRoomTokenMock).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toMatchObject({
      code: 'COLLABORATION_TOKEN_UNAVAILABLE',
    });
  });

  it('returns retry-after when the token signing secret is unavailable', async () => {
    issueCollaborationRoomTokenMock.mockRejectedValue(
      new MissingCollaborationRoomTokenSecretError(),
    );

    const res = await POST(
      createRequest({
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      }),
    );

    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('retry-after')).toBe('60');
    expect(canAccessCollaborationEntityMock).toHaveBeenCalledWith(
      authCtx.ctx,
      'dispense_task',
      'dt_1',
    );
    await expect(res.json()).resolves.toMatchObject({
      code: 'COLLABORATION_TOKEN_UNAVAILABLE',
    });
  });

  it('rejects unsupported entity types before access or token side effects', async () => {
    const res = await POST(
      createRequest({
        entity_type: 'patient',
        entity_id: 'patient_1',
      }),
    );

    expect(res.status).toBe(400);
    expect(canAccessCollaborationEntityMock).not.toHaveBeenCalled();
    expect(issueCollaborationRoomTokenMock).not.toHaveBeenCalled();
  });
});
