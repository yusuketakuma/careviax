import { serverCache } from '@/lib/utils/server-cache';
import { getRealtimeAdapter } from '@/server/adapters/realtime';

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
  today: Date
) {
  return `workflow:${orgId}:${role}:${userId}:${formatCacheDay(today)}`;
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
