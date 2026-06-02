import { getRealtimeAdapter } from '@/server/adapters/realtime';

export const ORG_REALTIME_EVENT_TYPES = [
  'cycle_transition',
  'workflow_refresh',
  'qr_draft_created',
  'qr_draft_confirmed',
] as const;

export const WORKFLOW_REALTIME_SOURCES = [
  'dispense_audits',
  'dispense_results',
  'dispense_results_rework',
  'dispense_tasks_update',
  'facility_visit_batch_delete',
  'facility_visit_batch_reorder',
  'facility_visit_batches_upsert',
  'facility_visit_days_upsert',
  'medication_cycles_transition',
  'set_audits',
  'set_batches_create',
  'set_batches_delete',
  'set_batches_generate',
  'set_batches_update',
  'set_plans',
  'set_plans_update',
  'visit_schedule_proposals_approve',
  'visit_schedule_proposals_confirm',
  'visit_schedule_proposals_contact_attempt',
  'visit_schedule_proposals_create',
  'visit_schedule_proposals_reject',
  'visit_schedule_proposals_reorder',
  'visit_schedules_create',
  'visit_schedules_delete',
  'visit_schedules_generate',
  'visit_schedules_reorder',
  'visit_schedules_reschedule_approve',
  'visit_schedules_reschedule_request',
  'visit_schedules_update',
] as const;

export type OrgRealtimeEventType = (typeof ORG_REALTIME_EVENT_TYPES)[number];
export type WorkflowRealtimeSource = (typeof WORKFLOW_REALTIME_SOURCES)[number];

export type WorkflowRealtimePayload = Record<string, unknown> & {
  source?: WorkflowRealtimeSource;
};

export type OrgRealtimePayload = Record<string, unknown> & {
  source?: WorkflowRealtimeSource;
};

export type OrgRealtimeEvent = {
  type: OrgRealtimeEventType;
  payload?: {
    source: WorkflowRealtimeSource;
  };
};

const ORG_REALTIME_EVENT_TYPE_SET = new Set<string>(ORG_REALTIME_EVENT_TYPES);
const WORKFLOW_REALTIME_SOURCE_SET = new Set<string>(WORKFLOW_REALTIME_SOURCES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOrgRealtimeEventType(value: unknown): value is OrgRealtimeEventType {
  return typeof value === 'string' && ORG_REALTIME_EVENT_TYPE_SET.has(value);
}

function isWorkflowRealtimeSource(value: unknown): value is WorkflowRealtimeSource {
  return typeof value === 'string' && WORKFLOW_REALTIME_SOURCE_SET.has(value);
}

export function buildOrgRealtimeChannel(orgId: string) {
  return `org:${orgId}`;
}

export function sanitizeWorkflowRealtimeSource(value: unknown): WorkflowRealtimeSource | null {
  return isWorkflowRealtimeSource(value) ? value : null;
}

export function sanitizeOrgRealtimeEvent(data: unknown): OrgRealtimeEvent {
  if (!isRecord(data)) return { type: 'workflow_refresh' };

  const type = isOrgRealtimeEventType(data.type) ? data.type : 'workflow_refresh';
  const payload = isRecord(data.payload) ? data.payload : null;
  const source = sanitizeWorkflowRealtimeSource(payload?.source);

  return source ? { type, payload: { source } } : { type };
}

export async function broadcastOrgRealtimeEvent(args: {
  orgId: string;
  type?: OrgRealtimeEventType;
  payload?: OrgRealtimePayload;
}) {
  try {
    const adapter = getRealtimeAdapter();
    await adapter.broadcastStatusUpdate(
      buildOrgRealtimeChannel(args.orgId),
      sanitizeOrgRealtimeEvent({
        type: args.type ?? 'workflow_refresh',
        payload: args.payload,
      }),
    );
  } catch {
    // Realtime broadcast is best-effort.
  }
}
