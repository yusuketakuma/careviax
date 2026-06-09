'use client';

import { AlertTriangle, BarChart3, Clock3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import {
  BlockerSeverity,
  CapacityStatus,
  UserRole,
  type CapacityBottleneck,
  type CapacityResponse,
  type CapacityWorkBucket,
} from '@/phos/contracts/phos_contracts';
import { SeverityToken } from '@/phos/contracts/phos_design_tokens';

export type CapacityDashboardProps = {
  capacity?: CapacityResponse;
  canView: boolean;
};

const WORK_MINUTES_COLOR = SeverityToken[BlockerSeverity.INFO].fg;
const BOTTLENECK_COLOR = SeverityToken[BlockerSeverity.WARNING].fg;

const STATUS_LABEL = {
  [CapacityStatus.AVAILABLE]: '余力あり',
  [CapacityStatus.TIGHT]: '逼迫',
  [CapacityStatus.OVER_CAPACITY]: '超過',
  [CapacityStatus.UNREGISTERED]: '未登録',
} as const;

const ROLE_LABEL = {
  [UserRole.PHARMACIST]: '薬剤師',
  [UserRole.PHARMACY_CLERK]: '薬局事務員',
  [UserRole.DISPENSE_ASSISTANT]: '調剤補助',
  [UserRole.MANAGER]: '管理薬剤師',
  [UserRole.ADMIN]: '管理者',
} as const satisfies Record<UserRole, string>;

function payloadLabel(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const label = (payload as { label?: unknown }).label;
  return typeof label === 'string' ? label : undefined;
}

function chartTooltip({ active, payload }: TooltipContentProps) {
  if (!active || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm shadow-sm">
      <p className="font-medium text-foreground">{payloadLabel(item.payload) ?? item.name}</p>
      <p className="text-muted-foreground">{item.value ?? 0}</p>
    </div>
  );
}

function remainingMinutes(capacity: CapacityResponse): number {
  return Math.max(capacity.total_available_minutes - capacity.total_planned_minutes, 0);
}

function bottleneckLabel(bottleneck: CapacityBottleneck): string {
  return `${bottleneck.label}: ${bottleneck.affected_count}件${
    bottleneck.over_minutes ? ` / ${bottleneck.over_minutes}分超過` : ''
  }`;
}

function chartBucket(bucket: CapacityWorkBucket) {
  return {
    code: bucket.bucket_code,
    label: bucket.label,
    planned: bucket.planned_minutes,
    available: bucket.available_minutes,
  };
}

export function CapacityDashboard({ capacity, canView }: CapacityDashboardProps) {
  if (!canView) {
    return (
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Capacity Dashboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          管理薬剤師または管理者のみ確認できます。
        </p>
      </section>
    );
  }

  if (!capacity) {
    return (
      <section className="rounded-lg border border-border/70 bg-card p-4">
        <h2 className="text-base font-semibold text-foreground">Capacity Dashboard</h2>
        <p className="mt-2 text-sm text-muted-foreground">キャパシティ情報を読み込めません。</p>
      </section>
    );
  }

  const workData = capacity.work_buckets.map(chartBucket);
  const bottleneckData = capacity.bottlenecks.map((bottleneck) => ({
    code: bottleneck.bottleneck_code,
    label: bottleneck.label,
    affected: bottleneck.affected_count,
  }));
  const statusToken =
    capacity.status === CapacityStatus.OVER_CAPACITY
      ? SeverityToken[BlockerSeverity.CRITICAL]
      : capacity.status === CapacityStatus.TIGHT
        ? SeverityToken[BlockerSeverity.WARNING]
        : SeverityToken[BlockerSeverity.INFO];

  return (
    <section
      aria-labelledby="phos-capacity-dashboard-title"
      className="space-y-4 rounded-lg border border-border/70 bg-card p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 id="phos-capacity-dashboard-title" className="text-lg font-semibold text-foreground">
            Capacity Dashboard
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {capacity.date} / {capacity.scope} / {STATUS_LABEL[capacity.status]}
          </p>
        </div>
        <span
          className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium"
          style={{
            borderColor: statusToken.border,
            backgroundColor: statusToken.bg,
            color: statusToken.fg,
          }}
        >
          {capacity.utilization_percent}% 使用中
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-border/70 bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
            本日の残作業分数
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {capacity.total_planned_minutes}分
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            可処分 {capacity.total_available_minutes}分 / 追加可能 {remainingMinutes(capacity)}分
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
            最大ボトルネック
          </div>
          <p className="mt-2 text-base font-semibold text-foreground">
            {capacity.bottlenecks[0] ? bottleneckLabel(capacity.bottlenecks[0]) : 'なし'}
          </p>
        </div>
        <div className="rounded-md border border-border/70 bg-background p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <BarChart3 className="size-4 text-muted-foreground" aria-hidden="true" />
            訪問枠
          </div>
          <p className="mt-2 text-base font-semibold text-foreground">
            planned {capacity.total_planned_minutes} / available {capacity.total_available_minutes}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            additional {remainingMinutes(capacity)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-md border border-border/70 bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">工程別作業分数</h3>
          <div className="mt-3 overflow-x-auto">
            <BarChart
              width={560}
              height={240}
              data={workData}
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip content={chartTooltip} />
              <Bar dataKey="planned" name="予定分" fill={WORK_MINUTES_COLOR} />
            </BarChart>
          </div>
        </section>

        <section className="rounded-md border border-border/70 bg-background p-3">
          <h3 className="text-sm font-semibold text-foreground">ボトルネック</h3>
          <div className="mt-3 overflow-x-auto">
            <BarChart
              width={560}
              height={240}
              data={bottleneckData}
              margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip content={chartTooltip} />
              <Bar dataKey="affected" name="件数" fill={BOTTLENECK_COLOR} />
            </BarChart>
          </div>
        </section>
      </div>

      <div className="overflow-x-auto rounded-md border border-border/70 bg-background">
        <table className="w-full min-w-[680px] text-left text-sm">
          <caption className="sr-only">Capacity Dashboard table fallback</caption>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="border-b border-border/70 px-3 py-2 font-medium">区分</th>
              <th className="border-b border-border/70 px-3 py-2 font-medium">予定分</th>
              <th className="border-b border-border/70 px-3 py-2 font-medium">可処分分</th>
              <th className="border-b border-border/70 px-3 py-2 font-medium">利用率</th>
              <th className="border-b border-border/70 px-3 py-2 font-medium">件数</th>
            </tr>
          </thead>
          <tbody>
            {capacity.work_buckets.map((bucket) => (
              <tr key={`bucket-${bucket.bucket_code}`}>
                <td className="border-b border-border/50 px-3 py-2">{bucket.label}</td>
                <td className="border-b border-border/50 px-3 py-2">{bucket.planned_minutes}</td>
                <td className="border-b border-border/50 px-3 py-2">{bucket.available_minutes}</td>
                <td className="border-b border-border/50 px-3 py-2">
                  {bucket.utilization_percent}%
                </td>
                <td className="border-b border-border/50 px-3 py-2">-</td>
              </tr>
            ))}
            {capacity.staff_loads.map((staff) => (
              <tr key={`staff-${staff.user_id}`}>
                <td className="border-b border-border/50 px-3 py-2">
                  {staff.display_name} / {ROLE_LABEL[staff.role]}
                </td>
                <td className="border-b border-border/50 px-3 py-2">{staff.planned_minutes}</td>
                <td className="border-b border-border/50 px-3 py-2">{staff.available_minutes}</td>
                <td className="border-b border-border/50 px-3 py-2">
                  {staff.utilization_percent}%
                </td>
                <td className="border-b border-border/50 px-3 py-2">{staff.active_card_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
