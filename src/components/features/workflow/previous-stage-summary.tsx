'use client';

import { formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import {
  fetchCycleTransitionLogs,
  WORKFLOW_HISTORY_INVALIDATION_EVENTS,
  WORKFLOW_STATUS_LABELS,
} from './cycle-transition-query';

type PreviousStageSummaryProps = {
  cycleId: string;
};

export function PreviousStageSummary({ cycleId }: PreviousStageSummaryProps) {
  const orgId = useOrgId();

  const { data: logs } = useRealtimeQuery({
    queryKey: ['cycle-transition-logs', cycleId, orgId],
    queryFn: () => fetchCycleTransitionLogs({ cycleId, orgId }),
    enabled: !!orgId && !!cycleId,
    invalidateOn: [...WORKFLOW_HISTORY_INVALIDATION_EVENTS],
  });

  if (!logs || logs.length === 0) return null;

  const latest = logs[logs.length - 1]!;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">
          {WORKFLOW_STATUS_LABELS[latest.from_status] ?? latest.from_status}
        </span>
        {' → '}
        <span className="font-medium text-foreground">
          {WORKFLOW_STATUS_LABELS[latest.to_status] ?? latest.to_status}
        </span>
      </span>
      <span>{latest.actor_name}</span>
      <span>
        {formatDistanceToNow(parseISO(latest.created_at), { locale: ja, addSuffix: true })}
      </span>
    </div>
  );
}
