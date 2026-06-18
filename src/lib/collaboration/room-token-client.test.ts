import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
