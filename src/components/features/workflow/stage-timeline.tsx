'use client';

import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { Loading } from '@/components/ui/loading';
import { MEDICATION_CYCLE_STATUS_ROLE } from '@/lib/constants/status-labels';
import { STATUS_TOKENS, type StatusRole } from '@/lib/constants/status-tokens';
import {
  fetchCycleTransitionLogs,
  WORKFLOW_HISTORY_INVALIDATION_EVENTS,
  WORKFLOW_STATUS_LABELS,
} from './cycle-transition-query';

// 工程ドットの色は MedicationCycleStatus の正本ロール写像に従う。
// neutral(状態色を付けない)は中立の灰=readonly トークンに寄せる。
function dotColor(status: string): string {
  const role = MEDICATION_CYCLE_STATUS_ROLE[status];
  const tokenRole: StatusRole = role && role !== 'neutral' ? role : 'readonly';
  return STATUS_TOKENS[tokenRole].dotClassName;
}

type StageTimelineProps = {
  cycleId: string;
};

export function StageTimeline({ cycleId }: StageTimelineProps) {
  const orgId = useOrgId();

  const { data: logs, isLoading } = useRealtimeQuery({
    queryKey: ['cycle-transition-logs', cycleId, orgId],
    queryFn: () => fetchCycleTransitionLogs({ cycleId, orgId }),
    enabled: !!orgId && !!cycleId,
    invalidateOn: [...WORKFLOW_HISTORY_INVALIDATION_EVENTS],
  });

  if (isLoading) return <Loading />;

  if (!logs || logs.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        ステータス遷移履歴がありません
      </p>
    );
  }

  return (
    <div className="relative space-y-0 pl-6">
      {logs.map((log, index) => {
        const isLast = index === logs.length - 1;
        return (
          <div key={log.id} className="relative pb-6 last:pb-0">
            {/* Vertical line */}
            {!isLast && <div className="absolute left-[-18px] top-3 h-full w-px bg-border" />}
            {/* Dot */}
            <div
              className={`absolute left-[-22px] top-1.5 size-2.5 rounded-full ring-2 ring-background ${dotColor(log.to_status)}`}
            />
            {/* Content */}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">
                  {WORKFLOW_STATUS_LABELS[log.from_status] ?? log.from_status}
                </span>
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                  →
                </span>
                <span className="text-sm font-medium">
                  {WORKFLOW_STATUS_LABELS[log.to_status] ?? log.to_status}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {log.actor_name} ・{' '}
                {format(parseISO(log.created_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
              </p>
              {log.note && <p className="mt-1 text-xs text-muted-foreground/80">{log.note}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
