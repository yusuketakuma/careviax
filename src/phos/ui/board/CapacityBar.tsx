'use client';

import { AlertTriangle, BarChart3 } from 'lucide-react';
import {
  BlockerSeverity,
  CapacityStatus,
  type CapacityResponse,
  type CapacityStatus as CapacityStatusType,
} from '@/phos/contracts/phos_contracts';
import { PhosEmptyState } from '@/phos/contracts/phos_copy.ja';
import { SeverityToken } from '@/phos/contracts/phos_design_tokens';
import { warningFeedbackStyle } from '@/phos/ui/feedback/feedbackStyles';

export type CapacityBarProps = {
  capacity?: CapacityResponse;
  phase?: 'IDLE' | 'LOADING' | 'ERROR';
  errorMessage?: string;
};

const CAPACITY_STATUS_LABEL = {
  [CapacityStatus.AVAILABLE]: '余力あり',
  [CapacityStatus.TIGHT]: '逼迫',
  [CapacityStatus.OVER_CAPACITY]: '超過',
  [CapacityStatus.UNREGISTERED]: '未登録',
} as const satisfies Record<CapacityStatusType, string>;

const CAPACITY_STATUS_SEVERITY = {
  [CapacityStatus.AVAILABLE]: BlockerSeverity.INFO,
  [CapacityStatus.TIGHT]: BlockerSeverity.WARNING,
  [CapacityStatus.OVER_CAPACITY]: BlockerSeverity.CRITICAL,
  [CapacityStatus.UNREGISTERED]: BlockerSeverity.ERROR,
} as const satisfies Record<CapacityStatusType, BlockerSeverity>;

function capacityStyle(status: CapacityStatusType) {
  return SeverityToken[CAPACITY_STATUS_SEVERITY[status]];
}

function barWidth(percent: number): string {
  return `${Math.min(Math.max(percent, 0), 100)}%`;
}

export function CapacityBar({ capacity, phase = 'IDLE', errorMessage }: CapacityBarProps) {
  if (phase === 'LOADING') {
    return (
      <section
        aria-label="Capacity loading"
        className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm text-muted-foreground"
      >
        可処分時間を確認中
      </section>
    );
  }

  if (phase === 'ERROR') {
    return (
      <section
        aria-label="Capacity error"
        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        style={warningFeedbackStyle}
      >
        <AlertTriangle className="size-4" aria-hidden="true" />
        <span>{errorMessage ?? '可処分時間を読み込めません'}</span>
      </section>
    );
  }

  if (!capacity) return null;

  const style = capacityStyle(capacity.status);
  const statusLabel = CAPACITY_STATUS_LABEL[capacity.status];
  const utilizationLabel = `${capacity.utilization_percent}%`;

  return (
    <section
      aria-labelledby="phos-capacity-title"
      className="rounded-md border border-border/70 bg-background px-3 py-2"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 id="phos-capacity-title" className="text-sm font-semibold text-foreground">
              Capacity
            </h3>
            <span
              className="rounded-sm border px-1.5 py-0.5 text-xs font-medium"
              style={{ borderColor: style.border, backgroundColor: style.bg, color: style.fg }}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {capacity.date} / {capacity.scope} / {capacity.total_planned_minutes}分 /{' '}
            {capacity.total_available_minutes}分
          </p>
        </div>

        <div className="w-full lg:max-w-80">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>利用率</span>
            <span>{utilizationLabel}</span>
          </div>
          <div
            aria-label={`Capacity utilization ${utilizationLabel}, ${statusLabel}`}
            className="h-3 overflow-hidden rounded-sm bg-muted"
            role="img"
          >
            <div
              className="h-full"
              style={{ width: barWidth(capacity.utilization_percent), backgroundColor: style.fg }}
            />
          </div>
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          工程・スタッフ別の内訳
        </summary>
        {capacity.total_available_minutes <= 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {PhosEmptyState.EMPTY_CAPACITY_NO_AVAIL}
          </p>
        ) : null}
        {capacity.bottlenecks.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground" aria-label="Bottlenecks">
            {capacity.bottlenecks.map((bottleneck) => (
              <li key={bottleneck.bottleneck_code}>
                {bottleneck.label}: {bottleneck.affected_count}件
                {bottleneck.over_minutes ? ` / ${bottleneck.over_minutes}分超過` : ''}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <caption className="sr-only">
              Capacity table fallback for work buckets and staff loads
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="border-b border-border/70 py-2 pr-3 font-medium">区分</th>
                <th className="border-b border-border/70 py-2 pr-3 font-medium">予定分</th>
                <th className="border-b border-border/70 py-2 pr-3 font-medium">可処分分</th>
                <th className="border-b border-border/70 py-2 pr-3 font-medium">利用率</th>
              </tr>
            </thead>
            <tbody>
              {capacity.work_buckets.map((bucket) => (
                <tr key={`bucket-${bucket.bucket_code}`}>
                  <td className="border-b border-border/50 py-2 pr-3">{bucket.label}</td>
                  <td className="border-b border-border/50 py-2 pr-3">{bucket.planned_minutes}</td>
                  <td className="border-b border-border/50 py-2 pr-3">
                    {bucket.available_minutes}
                  </td>
                  <td className="border-b border-border/50 py-2 pr-3">
                    {bucket.utilization_percent}%
                  </td>
                </tr>
              ))}
              {capacity.staff_loads.map((staff) => (
                <tr key={`staff-${staff.user_id}`}>
                  <td className="border-b border-border/50 py-2 pr-3">
                    {staff.display_name} / {staff.active_card_count}件
                  </td>
                  <td className="border-b border-border/50 py-2 pr-3">{staff.planned_minutes}</td>
                  <td className="border-b border-border/50 py-2 pr-3">{staff.available_minutes}</td>
                  <td className="border-b border-border/50 py-2 pr-3">
                    {staff.utilization_percent}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
