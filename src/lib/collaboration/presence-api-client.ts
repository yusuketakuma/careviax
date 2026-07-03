import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readJsonResponseBody } from '@/lib/api/response-body';
import { logger } from '@/lib/utils/logger';
import { readPresenceUsersResponse, type PresenceUser } from './presence-contract';

interface PresenceRequestOptions {
  orgId: string;
  entityType: string;
  entityId: string;
}

interface PostPresenceUpdateOptions extends PresenceRequestOptions {
  activeField?: string | null;
}

const warnedPresenceUpdateFailures = new Set<string>();

function warnPresenceUpdateFailure(entityType: string, status?: number, error?: unknown) {
  const warningKey = `${entityType}:${status ?? 'network'}`;
  if (warnedPresenceUpdateFailures.has(warningKey)) return;
  warnedPresenceUpdateFailures.add(warningKey);

  const context = {
    event: 'presence_update_post_failed',
    route: '/api/presence',
    method: 'POST',
    operation: 'post_presence_update',
    entityType,
    ...(typeof status === 'number' ? { status } : {}),
  };

  if (error === undefined) {
    logger.warn(context);
    return;
  }
  logger.warn(context, error);
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
    headers: buildOrgHeaders(orgId),
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
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify({
      entity_type: entityType,
      entity_id: entityId,
      active_field: activeField,
    }),
  })
    .then((response) => {
      if (!response.ok) warnPresenceUpdateFailure(entityType, response.status);
      return response;
    })
    .catch((error: unknown) => {
      warnPresenceUpdateFailure(entityType, undefined, error);
      return undefined;
    });
}
