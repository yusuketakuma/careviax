import { readJsonResponseBody } from '@/lib/api/response-body';

export type CollaborationRoomTokenResponse = {
  room: string;
  token: string;
  expires_at: string;
};

export type RoomTokenFetchResult =
  | { kind: 'ok'; roomToken: CollaborationRoomTokenResponse }
  | { kind: 'access-denied' }
  | { kind: 'transient-error'; retryAfterMs?: number };

interface FetchCollaborationRoomTokenOptions {
  orgId: string;
  entityType: string;
  entityId: string;
  nowMs?: number;
}

interface GetRoomTokenRetryDelayOptions {
  retryAfterMs?: number;
  transientRetryCount: number;
  random?: () => number;
}

export const ROOM_TOKEN_REFRESH_SKEW_MS = 60_000;
export const ROOM_TOKEN_REFRESH_RETRY_BASE_MS = 5_000;
export const ROOM_TOKEN_REFRESH_RETRY_MAX_MS = 60_000;
export const ROOM_TOKEN_REFRESH_RETRY_JITTER_MS = 1_000;
export const PROVIDER_RENEWAL_CANDIDATE_TIMEOUT_MS = 10_000;

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function readCollaborationRoomTokenResponse(
  payload: unknown,
): CollaborationRoomTokenResponse | null {
  const object = readRecord(payload);
  if (!object) return null;

  const room = readNonBlankString(object.room);
  const token = readNonBlankString(object.token);
  const expiresAt = readNonBlankString(object.expires_at);
  if (!room || !token || !expiresAt) return null;

  return { room, token, expires_at: expiresAt };
}

export function parseRoomTokenRetryAfterMs(retryAfterHeader: string | null, nowMs = Date.now()) {
  if (!retryAfterHeader) return undefined;

  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1_000;
  }

  const retryAtMs = Date.parse(retryAfterHeader);
  if (!Number.isFinite(retryAtMs)) return undefined;

  const delayMs = retryAtMs - nowMs;
  return delayMs > 0 ? delayMs : undefined;
}

export function getRoomTokenRetryDelayMs({
  retryAfterMs,
  transientRetryCount,
  random = Math.random,
}: GetRoomTokenRetryDelayOptions) {
  if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, ROOM_TOKEN_REFRESH_RETRY_MAX_MS);
  }

  const exponentialDelayMs =
    ROOM_TOKEN_REFRESH_RETRY_BASE_MS * 2 ** Math.min(transientRetryCount, 4);
  const jitterMs = Math.floor(random() * ROOM_TOKEN_REFRESH_RETRY_JITTER_MS);
  return Math.min(exponentialDelayMs + jitterMs, ROOM_TOKEN_REFRESH_RETRY_MAX_MS);
}

export async function fetchCollaborationRoomToken({
  orgId,
  entityType,
  entityId,
  nowMs = Date.now(),
}: FetchCollaborationRoomTokenOptions): Promise<RoomTokenFetchResult> {
  const tokenResponse = await fetch('/api/collaboration/room-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
    body: JSON.stringify({
      entity_type: entityType,
      entity_id: entityId,
    }),
  }).catch(() => null);

  if (!tokenResponse) return { kind: 'transient-error' };
  if (!tokenResponse.ok) {
    const isTransientFailure = tokenResponse.status === 429 || tokenResponse.status >= 500;
    return isTransientFailure
      ? {
          kind: 'transient-error',
          retryAfterMs: parseRoomTokenRetryAfterMs(tokenResponse.headers.get('Retry-After'), nowMs),
        }
      : { kind: 'access-denied' };
  }

  const roomToken = readCollaborationRoomTokenResponse(await readJsonResponseBody(tokenResponse));
  if (!roomToken) return { kind: 'transient-error' };
  const expiresAtMs = Date.parse(roomToken.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return { kind: 'transient-error' };
  }
  return { kind: 'ok', roomToken };
}
