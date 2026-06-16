import { createHash } from 'node:crypto';
import { serverCache } from '@/lib/utils/server-cache';
import {
  broadcastOrgRealtimeEvent,
  type WorkflowRealtimePayload,
} from '@/server/services/org-realtime';
import type { DashboardAssignmentScope } from './dashboard-assignment-scope';

export { sanitizeWorkflowRealtimeSource } from '@/server/services/org-realtime';

function formatCacheDay(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildWorkflowCacheKey(
  orgId: string,
  role: string,
  userId: string,
  today: Date,
  assignmentScopeFingerprint?: string,
  view?: 'full' | 'phase' | 'realtime',
) {
  const scopeKey = assignmentScopeFingerprint ? `:${assignmentScopeFingerprint}` : '';
  const viewKey = view && view !== 'full' ? `:${view}` : '';
  return `workflow:${orgId}:${role}:${userId}:${formatCacheDay(today)}${scopeKey}${viewKey}`;
}

export function buildCockpitCacheKey(
  orgId: string,
  role: string,
  userId: string,
  today: Date,
  scope: string,
  assignmentScopeFingerprint?: string,
) {
  const scopeKey = assignmentScopeFingerprint ? `:${assignmentScopeFingerprint}` : '';
  return `cockpit:${orgId}:${role}:${userId}:${formatCacheDay(today)}:${scope}${scopeKey}`;
}

export function buildWorkflowAssignmentScopeFingerprint(scope: DashboardAssignmentScope) {
  if (
    scope.caseIds === undefined &&
    scope.patientIds === undefined &&
    scope.caseIdsByPatient === undefined &&
    scope.assignedToUserId === undefined
  ) {
    return undefined;
  }

  const caseIdsByPatient = Object.fromEntries(
    Object.entries(scope.caseIdsByPatient ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([patientId, caseIds]) => [patientId, [...caseIds].sort()]),
  );
  const payload = JSON.stringify({
    assignedToUserId: scope.assignedToUserId ?? null,
    caseIds: scope.caseIds ? [...scope.caseIds].sort() : [],
    patientIds: scope.patientIds ? [...scope.patientIds].sort() : [],
    caseIdsByPatient,
  });

  return createHash('sha256').update(payload).digest('base64url').slice(0, 24);
}

export function invalidateWorkflowDashboardCache(orgId: string) {
  serverCache.invalidate(`workflow:${orgId}:`);
  serverCache.invalidate(`cockpit:${orgId}:`);
}

export async function notifyWorkflowMutation(args: {
  orgId: string;
  eventType?: 'cycle_transition' | 'workflow_refresh';
  payload?: WorkflowRealtimePayload;
}) {
  invalidateWorkflowDashboardCache(args.orgId);

  await broadcastOrgRealtimeEvent({
    orgId: args.orgId,
    type: args.eventType,
    payload: args.payload,
  });
}
