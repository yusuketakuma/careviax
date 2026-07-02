import { afterEach, describe, expect, it, vi } from 'vitest';

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  fetchCollaborationRoomToken,
  getRoomTokenRetryDelayMs,
  parseRoomTokenRetryAfterMs,
  readCollaborationRoomTokenResponse,
  ROOM_TOKEN_REFRESH_RETRY_MAX_MS,
} from './room-token-client';

describe('room-token-client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    loggerWarnMock.mockReset();
  });

  it('normalizes valid room-token responses and rejects malformed payloads', () => {
    expect(
      readCollaborationRoomTokenResponse({
        room: ' org_1:patient:p_1 ',
        token: ' token ',
        expires_at: ' 2026-06-18T00:10:00.000Z ',
      }),
    ).toEqual({
      room: 'org_1:patient:p_1',
      token: 'token',
      expires_at: '2026-06-18T00:10:00.000Z',
    });
    expect(readCollaborationRoomTokenResponse({ room: '', token: 'token' })).toBeNull();
    expect(readCollaborationRoomTokenResponse(null)).toBeNull();
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRoomTokenRetryAfterMs('3', Date.parse('2026-06-18T00:00:00.000Z'))).toBe(3_000);
    expect(
      parseRoomTokenRetryAfterMs(
        'Thu, 18 Jun 2026 00:00:05 GMT',
        Date.parse('2026-06-18T00:00:00.000Z'),
      ),
    ).toBe(5_000);
    expect(parseRoomTokenRetryAfterMs('invalid', Date.parse('2026-06-18T00:00:00.000Z'))).toBe(
      undefined,
    );
  });

  it('computes bounded retry delays with retry-after taking precedence', () => {
    expect(
      getRoomTokenRetryDelayMs({
        retryAfterMs: ROOM_TOKEN_REFRESH_RETRY_MAX_MS + 1_000,
        transientRetryCount: 0,
      }),
    ).toBe(ROOM_TOKEN_REFRESH_RETRY_MAX_MS);
    expect(getRoomTokenRetryDelayMs({ transientRetryCount: 2, random: () => 0.5 })).toBe(20_500);
  });

  it('fetches a valid room token with the collaboration request shape', async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        room: 'org_1:dispense_task:dt_1',
        token: 'room-token',
        expires_at: '2026-06-18T00:10:00.000Z',
      }),
    ) as typeof fetch;

    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'dispense_task',
        entityId: 'dt_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({
      kind: 'ok',
      roomToken: {
        room: 'org_1:dispense_task:dt_1',
        token: 'room-token',
        expires_at: '2026-06-18T00:10:00.000Z',
      },
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/collaboration/room-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({
        entity_type: 'dispense_task',
        entity_id: 'dt_1',
      }),
    });
  });

  it('classifies denied, transient, malformed, and expired token responses', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'access-denied' });

    global.fetch = vi.fn(
      async () => new Response(null, { status: 429, headers: { 'Retry-After': '7' } }),
    ) as typeof fetch;
    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error', retryAfterMs: 7_000 });

    global.fetch = vi.fn(async () =>
      Response.json({ room: 'room', token: '', expires_at: 'x' }),
    ) as typeof fetch;
    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error' });

    global.fetch = vi.fn(async () =>
      Response.json({
        room: 'room',
        token: 'token',
        expires_at: '2026-06-17T23:59:59.000Z',
      }),
    ) as typeof fetch;
    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error' });
  });

  it('warns safely when the room-token request rejects and keeps transient retry behavior', async () => {
    const rejection = new Error('patient=山田太郎 token=secret-room-token');
    global.fetch = vi.fn(async () => {
      throw rejection;
    }) as typeof fetch;

    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'patient',
        entityId: 'patient_secret_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error' });

    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'collaboration_room_token_fetch_failed',
        route: '/api/collaboration/room-token',
        method: 'POST',
        operation: 'fetch_collaboration_room_token',
        entityType: 'patient',
        code: 'FETCH_REJECTED',
      },
      rejection,
    );

    const context = JSON.stringify(loggerWarnMock.mock.calls[0]?.[0]);
    expect(context).not.toContain('patient_secret_1');
    expect(context).not.toContain('山田太郎');
    expect(context).not.toContain('secret-room-token');
  });

  it('warns safely for transient and invalid room-token responses without changing classification', async () => {
    global.fetch = vi.fn(
      async () => new Response(null, { status: 503, headers: { 'Retry-After': '7' } }),
    ) as typeof fetch;

    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'dispense_task',
        entityId: 'dispense_task_secret_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error', retryAfterMs: 7_000 });

    global.fetch = vi.fn(async () =>
      Response.json({ room: 'room', token: '', expires_at: 'x' }),
    ) as typeof fetch;

    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'visit_record',
        entityId: 'visit_record_secret_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error' });

    global.fetch = vi.fn(async () =>
      Response.json({
        room: 'room',
        token: 'secret-expired-room-token',
        expires_at: '2026-06-17T23:59:59.000Z',
      }),
    ) as typeof fetch;

    await expect(
      fetchCollaborationRoomToken({
        orgId: 'org_1',
        entityType: 'care_report',
        entityId: 'care_report_secret_1',
        nowMs: Date.parse('2026-06-18T00:00:00.000Z'),
      }),
    ).resolves.toEqual({ kind: 'transient-error' });

    expect(loggerWarnMock).toHaveBeenCalledTimes(3);
    expect(loggerWarnMock.mock.calls.map((call) => call[0])).toEqual([
      {
        event: 'collaboration_room_token_fetch_failed',
        route: '/api/collaboration/room-token',
        method: 'POST',
        operation: 'fetch_collaboration_room_token',
        entityType: 'dispense_task',
        status: 503,
        code: 'TRANSIENT_HTTP',
      },
      {
        event: 'collaboration_room_token_fetch_failed',
        route: '/api/collaboration/room-token',
        method: 'POST',
        operation: 'fetch_collaboration_room_token',
        entityType: 'visit_record',
        status: 200,
        code: 'MALFORMED_PAYLOAD',
      },
      {
        event: 'collaboration_room_token_fetch_failed',
        route: '/api/collaboration/room-token',
        method: 'POST',
        operation: 'fetch_collaboration_room_token',
        entityType: 'care_report',
        status: 200,
        code: 'EXPIRED_TOKEN',
      },
    ]);

    const contexts = JSON.stringify(loggerWarnMock.mock.calls.map((call) => call[0]));
    expect(contexts).not.toContain('dispense_task_secret_1');
    expect(contexts).not.toContain('visit_record_secret_1');
    expect(contexts).not.toContain('care_report_secret_1');
    expect(contexts).not.toContain('secret-expired-room-token');
  });
});
