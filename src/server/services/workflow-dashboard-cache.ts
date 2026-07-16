import {
  broadcastOrgRealtimeEvent,
  type WorkflowRealtimePayload,
} from '@/server/services/org-realtime';

export { sanitizeWorkflowRealtimeSource } from '@/server/services/org-realtime';

export const WORKFLOW_DASHBOARD_VIEWS = ['full', 'phase', 'realtime', 'performance'] as const;
export type WorkflowDashboardView = (typeof WORKFLOW_DASHBOARD_VIEWS)[number];

export function parseWorkflowDashboardView(value: string | null): WorkflowDashboardView {
  return WORKFLOW_DASHBOARD_VIEWS.find((view) => view === value) ?? 'full';
}

export async function notifyWorkflowMutation(args: {
  orgId: string;
  eventType?: 'cycle_transition' | 'workflow_refresh';
  payload?: WorkflowRealtimePayload;
}) {
  await broadcastOrgRealtimeEvent({
    orgId: args.orgId,
    type: args.eventType,
    payload: args.payload,
  });
}
