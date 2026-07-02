'use client';

import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  Users,
  Home,
  FileText,
  Activity,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { HelpPopover } from '@/components/ui/help-popover';
import { SegmentedProgressBar } from '@/components/ui/segmented-progress-bar';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/loading';

/** 指標カードの注意文。重大度(role)で色とアイコンを分け、色だけに依存させない。 */
type MetricAlert = { text: string; role: 'confirm' | 'blocked' };

// --- Types ---

type MetricsData = {
  prescription_concentration_rate: number; // 処方箋集中率 (%)
  generic_dispensing_rate: number; // 後発品調剤割合 (%)
  prescriptions_per_pharmacist: number; // 薬剤師1人あたり処方箋枚数
  home_visit_count_ytd: number; // 在宅訪問実績回数（年累計）
  monthly_prescription_count: number; // 処方箋月次受付枚数
};

// --- Constants ---

const GENERIC_TARGET = 70; // 後発品調剤割合目標 (%)
const PRESCRIPTIONS_LIMIT = 40; // 薬剤師1人あたり上限（1日）
const HOME_VISIT_TARGET_YTD = 48; // 年間訪問目標回数

// --- Components ---

function ProgressBar({
  value,
  max,
  targetLine,
  colorClass,
}: {
  value: number;
  max: number;
  targetLine?: number;
  colorClass: string;
}) {
  return (
    <SegmentedProgressBar
      value={value}
      max={max}
      markerValue={targetLine}
      className="h-3"
      filledClassName={colorClass}
      markerClassName="bg-foreground/40"
    />
  );
}

function MetricCard({
  title,
  description,
  value,
  unit,
  max,
  targetLine,
  target,
  icon: Icon,
  colorClass,
  alert,
}: {
  title: string;
  description: string;
  value: number;
  unit: string;
  max: number;
  targetLine?: number;
  target?: string;
  icon: React.ElementType;
  colorClass: string;
  alert?: MetricAlert;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {title}
              <HelpPopover title={title} description={description} />
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums text-foreground">
            {value.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        <ProgressBar value={value} max={max} targetLine={targetLine} colorClass={colorClass} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>0</span>
          {target && <span className="font-medium text-foreground">{target}</span>}
          <span>
            {max.toLocaleString()}
            {unit}
          </span>
        </div>
        {alert && (
          <p
            className={cn(
              'flex items-start gap-1 text-xs',
              alert.role === 'blocked' ? 'text-state-blocked' : 'text-state-confirm',
            )}
          >
            {alert.role === 'blocked' ? (
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>{alert.text}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function MetricsDashboardContent() {
  const orgId = useOrgId();

  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-metrics', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/metrics', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('経営指標の取得に失敗しました');
      return res.json() as Promise<{ data: MetricsData }>;
    },
    enabled: !!orgId,
  });

  const hasData = data !== undefined;

  // First-load failure with no usable data -> blocking error. A refetch failure that
  // still has prior data is handled below (keep the data, show a non-blocking warning).
  if (isError && !hasData) {
    return (
      <ErrorState
        variant="server"
        size="page"
        description="経営指標を取得できませんでした。時間をおいて再度お試しください。"
        action={{ label: '再読み込み', onClick: () => void refetch() }}
        live="assertive"
      />
    );
  }

  if (isLoading && !hasData) {
    return (
      <div
        role="status"
        aria-label="経営指標を読み込み中"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="py-10">
              <Skeleton className="h-8 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!hasData) {
    return (
      <ErrorState
        variant="server"
        size="page"
        description="経営指標を表示するための組織情報を取得できませんでした。組織を選択して再読み込みしてください。"
        live="assertive"
      />
    );
  }

  const metrics = data.data;

  // 目標未達は confirm(橙)、基準超過は blocked(赤)で重大度を分離する。
  const genericAlert: MetricAlert | undefined =
    metrics.monthly_prescription_count > 0 && metrics.generic_dispensing_rate < GENERIC_TARGET
      ? {
          text: `目標（${GENERIC_TARGET}%）未達。後発品の積極的な提案を検討してください。`,
          role: 'confirm',
        }
      : undefined;

  const prescriptionsAlert: MetricAlert | undefined =
    metrics.prescriptions_per_pharmacist > PRESCRIPTIONS_LIMIT
      ? {
          text: `基準（${PRESCRIPTIONS_LIMIT}枚/日）超過。人員配置を見直してください。`,
          role: 'blocked',
        }
      : undefined;

  return (
    <div className="space-y-4">
      {isError && hasData && (
        <ErrorState
          variant="server"
          size="inline"
          description="最新の経営指標を取得できませんでした。表示は前回取得した値です。"
          action={{
            label: '再読み込み',
            onClick: () => void refetch(),
            variant: 'outline',
            size: 'sm',
          }}
          live="polite"
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="処方箋集中率"
          description="特定の処方元への集中度合い"
          value={metrics.prescription_concentration_rate}
          unit="%"
          max={100}
          icon={TrendingUp}
          colorClass="bg-chart-1"
          target="基準: 70%以下"
        />
        <MetricCard
          title="後発医薬品調剤割合"
          description="全調剤に占める後発品の割合"
          value={metrics.generic_dispensing_rate}
          unit="%"
          max={100}
          targetLine={GENERIC_TARGET}
          target={`目標: ${GENERIC_TARGET}%以上`}
          icon={Activity}
          colorClass={
            metrics.monthly_prescription_count === 0
              ? 'bg-chart-1'
              : metrics.generic_dispensing_rate >= GENERIC_TARGET
                ? 'bg-state-done'
                : 'bg-state-confirm'
          }
          alert={genericAlert}
        />
        <MetricCard
          title="薬剤師1人あたり処方箋枚数"
          description="1日平均（当月）"
          value={metrics.prescriptions_per_pharmacist}
          unit="枚/日"
          max={60}
          targetLine={PRESCRIPTIONS_LIMIT}
          target={`基準: ${PRESCRIPTIONS_LIMIT}枚/日`}
          icon={Users}
          colorClass={
            metrics.prescriptions_per_pharmacist > PRESCRIPTIONS_LIMIT
              ? 'bg-state-blocked'
              : 'bg-chart-1'
          }
          alert={prescriptionsAlert}
        />
        <MetricCard
          title="在宅訪問実績回数"
          description="年度累計"
          value={metrics.home_visit_count_ytd}
          unit="回"
          max={HOME_VISIT_TARGET_YTD}
          targetLine={HOME_VISIT_TARGET_YTD}
          target={`目標: ${HOME_VISIT_TARGET_YTD}回/年`}
          icon={Home}
          colorClass={
            metrics.home_visit_count_ytd >= HOME_VISIT_TARGET_YTD ? 'bg-state-done' : 'bg-chart-1'
          }
        />
        <MetricCard
          title="処方箋月次受付枚数"
          description="当月受付枚数"
          value={metrics.monthly_prescription_count}
          unit="枚"
          max={2000}
          icon={FileText}
          colorClass="bg-chart-1"
        />
      </div>
    </div>
  );
}
