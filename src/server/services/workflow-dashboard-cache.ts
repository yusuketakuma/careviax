import { createHash } from 'node:crypto';
import { serverCache } from '@/lib/utils/server-cache';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import type { DashboardAssignmentScope } from './dashboard-assignment-scope';

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
) {
  const scopeKey = assignmentScopeFingerprint ? `:${assignmentScopeFingerprint}` : '';
  return `workflow:${orgId}:${role}:${userId}:${formatCacheDay(today)}${scopeKey}`;
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
}

export async function notifyWorkflowMutation(args: {
  orgId: string;
  eventType?: 'cycle_transition' | 'workflow_refresh';
  payload?: Record<string, unknown>;
}) {
  invalidateWorkflowDashboardCache(args.orgId);

  try {
    const adapter = getRealtimeAdapter();
    await adapter.broadcastStatusUpdate(`org:${args.orgId}`, {
      type: args.eventType ?? 'workflow_refresh',
      ...(args.payload ? { payload: args.payload } : {}),
    });
  } catch {
    // Realtime broadcast is best-effort.
  }
}
