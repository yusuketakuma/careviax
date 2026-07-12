import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders } from '@/lib/api/org-headers';
import { CYCLE_STATUS_LABELS } from '@/lib/prescription/cycle-workspace';
import { buildMedicationCycleHistoryApiPath } from '@/lib/prescriptions/api-paths';
import {
  cycleTransitionHistoryResponseSchema,
  type TransitionLog,
} from './cycle-transition-response-schema';

export type { TransitionLog } from './cycle-transition-response-schema';

export const WORKFLOW_STATUS_LABELS = CYCLE_STATUS_LABELS;

export const WORKFLOW_HISTORY_INVALIDATION_EVENTS = [
  'cycle_transition',
  { type: 'workflow_refresh', source: 'medication_cycles_transition' },
] as const;

export async function fetchCycleTransitionLogs(args: { cycleId: string; orgId: string }) {
  const res = await fetch(buildMedicationCycleHistoryApiPath(args.cycleId), {
    headers: buildOrgHeaders(args.orgId),
  });
  return readApiJson<TransitionLog[]>(res, {
    fallbackMessage: '履歴の取得に失敗しました',
    schema: cycleTransitionHistoryResponseSchema,
  });
}
