import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';

export type TransitionLog = {
  id: string;
  from_status: string;
  to_status: string;
  actor_name: string;
  note: string | null;
  created_at: string;
};

export const WORKFLOW_STATUS_LABELS = CYCLE_STATUS_LABELS;

export const WORKFLOW_HISTORY_INVALIDATION_EVENTS = [
  'cycle_transition',
  { type: 'workflow_refresh', source: 'medication_cycles_transition' },
] as const;

export async function fetchCycleTransitionLogs(args: { cycleId: string; orgId: string }) {
  const res = await fetch(`/api/medication-cycles/${args.cycleId}/history`, {
    headers: buildOrgHeaders(args.orgId),
  });
  const payload = await readApiJson<{ data: TransitionLog[] }>(res, '履歴の取得に失敗しました');
  return payload.data;
}
