import { readJsonResponseBody } from '@/lib/api/response-body';
import { readPresenceUsersResponse, type PresenceUser } from './presence-contract';

interface PresenceRequestOptions {
  orgId: string;
  entityType: string;
  entityId: string;
}

interface PostPresenceUpdateOptions extends PresenceRequestOptions {
  activeField?: string | null;
}

export function buildPresenceQueryKey(entityType: string, entityId: string, orgId: string) {
  return ['presence', entityType, entityId, orgId] as const;
}

export function buildPresenceUrl(entityType: string, entityId: string) {
  return `/api/presence?entity_type=${encodeURIComponent(entityType)}&entity_id=${encodeURIComponent(entityId)}`;
}

export async function fetchPresenceUsers({
  orgId,
  entityType,
  entityId,
}: PresenceRequestOptions): Promise<PresenceUser[]> {
  const response = await fetch(buildPresenceUrl(entityType, entityId), {
    headers: { 'x-org-id': orgId },
  });
  if (!response.ok) return [];
  return readPresenceUsersResponse(await readJsonResponseBody(response));
}

export function postPresenceUpdate({
  orgId,
  entityType,
  entityId,
  activeField = null,
}: PostPresenceUpdateOptions) {
  return fetch('/api/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
    body: JSON.stringify({
      entity_type: entityType,
      entity_id: entityId,
      active_field: activeField,
    }),
  }).catch(() => undefined);
}
