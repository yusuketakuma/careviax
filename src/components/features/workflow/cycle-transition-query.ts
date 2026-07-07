import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';

export type TransitionLog = {
  id: string;
  from_status: string;
  to_status: string;
  actor_name: string;
  note: string | null;
  created_at: string;
};

export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  intake_received: '受付済',
  structuring: '構造化中',
  inquiry_pending: '疑義照会中',
  inquiry_resolved: '疑義解決',
  ready_to_dispense: '調剤準備完了',
  dispensing: '調剤中',
  dispensed: '調剤済',
  audit_pending: '監査待ち',
  audited: '監査済',
  setting: 'セット監査待ち',
  set_audited: 'セット監査済み',
  visit_ready: '訪問準備完了',
  visit_completed: '訪問完了',
  reported: '報告済',
  on_hold: '保留',
  cancelled: 'キャンセル',
};

export const WORKFLOW_HISTORY_INVALIDATION_EVENTS = [
  'cycle_transition',
  { type: 'workflow_refresh', source: 'medication_cycles_transition' },
] as const;

export async function fetchCycleTransitionLogs(args: { cycleId: string; orgId: string }) {
  const res = await fetch(`/api/medication-cycles/${args.cycleId}/history`, {
    headers: buildOrgHeaders(args.orgId),
  });
  return readApiJson<TransitionLog[]>(res, '履歴の取得に失敗しました');
}
