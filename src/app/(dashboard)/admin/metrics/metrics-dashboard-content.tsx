'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Users, Home, FileText, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type MetricsData = {
  prescription_concentration_rate: number; // 処方箋集中率 (%)
  generic_dispensing_rate: number;          // 後発品調剤割合 (%)
  prescriptions_per_pharmacist: number;     // 薬剤師1人あたり処方箋枚数
  home_visit_count_ytd: number;             // 在宅訪問実績回数（年累計）
  monthly_prescription_count: number;       // 処方箋月次受付枚数
};

// --- Constants ---

const GENERIC_TARGET = 70;         // 後発品調剤割合目標 (%)
const PRESCRIPTIONS_LIMIT = 40;    // 薬剤師1人あたり上限（1日）
const HOME_VISIT_TARGET_YTD = 48;  // 年間訪問目標回数

// --- Placeholder data (API not yet available) ---

const PLACEHOLDER: MetricsData = {
  prescription_concentration_rate: 0,
  generic_dispensing_rate: 0,
  prescriptions_per_pharmacist: 0,
  home_visit_count_ytd: 0,
  monthly_prescription_count: 0,
};

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
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const targetPct = targetLine != null && max > 0 ? Math.min(100, Math.round((targetLine / max) * 100)) : null;

  return (
    <div className="relative">
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemax={max}
        aria-valuemin={0}
      >
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      {targetPct != null && (
        <div
          className="absolute top-0 h-3 w-0.5 bg-orange-500"
          style={{ left: `${targetPct}%` }}
          aria-label={`目標: ${targetLine}%`}
          title={`目標: ${targetLine}`}
        />
      )}
    </div>
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
  alertText,
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
  alertText?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              {title}
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tabular-nums text-foreground">{value.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        <ProgressBar value={value} max={max} targetLine={targetLine} colorClass={colorClass} />
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>0</span>
          {target && <span className="font-medium text-foreground">{target}</span>}
          <span>{max.toLocaleString()}{unit}</span>
        </div>
        {alertText && (
          <p className="text-xs text-orange-700">{alertText}</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Main ---

export function MetricsDashboardContent() {
  const orgId = useOrgId();

  const { data } = useQuery({
    queryKey: ['admin-metrics', orgId],
    queryFn: async () => {
      const res = await fetch('/api/admin/metrics', {
        headers: { 'x-org-id': orgId },
      });
      if (res.status === 404) return { data: PLACEHOLDER };
      if (!res.ok) throw new Error('経営指標の取得に失敗しました');
      return res.json() as Promise<{ data: MetricsData }>;
    },
    enabled: !!orgId,
  });

  const metrics = data?.data ?? PLACEHOLDER;

  const genericAlert =
    metrics.generic_dispensing_rate < GENERIC_TARGET
      ? `目標（${GENERIC_TARGET}%）未達。後発品の積極的な提案を検討してください。`
      : undefined;

  const prescriptionsAlert =
    metrics.prescriptions_per_pharmacist > PRESCRIPTIONS_LIMIT
      ? `基準（${PRESCRIPTIONS_LIMIT}枚/日）超過。人員配置を見直してください。`
      : undefined;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title="処方箋集中率"
        description="特定の処方元への集中度合い"
        value={metrics.prescription_concentration_rate}
        unit="%"
        max={100}
        icon={TrendingUp}
        colorClass="bg-blue-500"
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
        colorClass={metrics.generic_dispensing_rate >= GENERIC_TARGET ? 'bg-green-500' : 'bg-orange-400'}
        alertText={genericAlert}
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
        colorClass={metrics.prescriptions_per_pharmacist > PRESCRIPTIONS_LIMIT ? 'bg-red-500' : 'bg-blue-500'}
        alertText={prescriptionsAlert}
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
        colorClass={metrics.home_visit_count_ytd >= HOME_VISIT_TARGET_YTD ? 'bg-green-500' : 'bg-blue-500'}
      />
      <MetricCard
        title="処方箋月次受付枚数"
        description="当月受付枚数"
        value={metrics.monthly_prescription_count}
        unit="枚"
        max={2000}
        icon={FileText}
        colorClass="bg-blue-500"
      />
    </div>
  );
}
