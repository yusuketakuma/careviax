'use client';

import { useQuery } from '@tanstack/react-query';
import { platformFetchJson } from './platform-fetch';

export type BreakGlassSessionSummary = {
  id: string;
  target_org_id: string;
  reason: string;
  reference_ticket: string | null;
  scope: 'read_only' | 'read_write';
  status: 'active' | 'expired' | 'revoked';
  granted_at: string;
  expires_at: string;
  revoked_at: string | null;
};

type BreakGlassSessionsResponse = { sessions: BreakGlassSessionSummary[] };

export const BREAK_GLASS_SESSIONS_QUERY_KEY = ['platform-break-glass-sessions'] as const;

/**
 * The operator's currently-active break-glass sessions (across all tenants).
 * Shared react-query cache: the launch/revoke panel and the data-explorer /
 * audit panels all need to know "is there an active session for this org?",
 * and using the same query key keeps them in sync after a mutation without
 * prop-drilling session state between siblings.
 */
export function useBreakGlassSessions() {
  return useQuery({
    queryKey: BREAK_GLASS_SESSIONS_QUERY_KEY,
    queryFn: () => platformFetchJson<BreakGlassSessionsResponse>('/api/platform/break-glass'),
  });
}

export function findActiveSessionForOrg(
  sessions: BreakGlassSessionSummary[] | undefined,
  orgId: string,
): BreakGlassSessionSummary | null {
  if (!sessions) return null;
  return (
    sessions.find((session) => session.target_org_id === orgId && session.status === 'active') ??
    null
  );
}
