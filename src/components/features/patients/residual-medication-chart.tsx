'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { useOrgId } from '@/lib/hooks/use-org-id';

type ResidualRecord = {
  id: string;
  drug_name: string;
  excess_days: number;
  created_at: string;
};

type ChartDataPoint = {
  date: string;
  label: string;
  totalExcessDays: number;
  count: number;
};

export function ResidualMedicationChart({ patientId }: { patientId: string }) {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['residual-medications-chart', orgId, patientId],
    queryFn: async () => {
      const res = await fetch(
        `/api/residual-medications?patient_id=${patientId}&limit=100`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('残薬データの取得に失敗しました');
      return res.json() as Promise<{ data: ResidualRecord[] }>;
    },
    enabled: !!orgId && !!patientId,
  });

  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!data?.data) return [];

    // Group by date (yyyy-MM-dd)
    const grouped = new Map<string, { totalExcessDays: number; count: number }>();
    for (const r of data.data) {
      const dateKey = r.created_at.slice(0, 10);
      const existing = grouped.get(dateKey) ?? { totalExcessDays: 0, count: 0 };
      existing.totalExcessDays += r.excess_days;
      existing.count++;
      grouped.set(dateKey, existing);
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => ({
        date,
        label: format(new Date(date), 'MM/dd', { locale: ja }),
        ...vals,
      }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
        残薬データがありません
      </div>
    );
  }

  // Simple SVG chart (no external chart library needed)
  const maxVal = Math.max(...chartData.map((d) => d.totalExcessDays), 1);
  const chartWidth = 600;
  const chartHeight = 200;
  const paddingX = 40;
  const paddingY = 20;
  const plotWidth = chartWidth - paddingX * 2;
  const plotHeight = chartHeight - paddingY * 2;

  const points = chartData.map((d, i) => {
    const x = paddingX + (chartData.length > 1 ? (i / (chartData.length - 1)) * plotWidth : plotWidth / 2);
    const y = paddingY + plotHeight - (d.totalExcessDays / maxVal) * plotHeight;
    return { x, y, ...d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">残薬推移</h3>
      <div className="overflow-x-auto rounded-md border bg-card p-3">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full"
          aria-label="残薬推移グラフ"
          role="img"
        >
          {/* Y-axis gridlines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = paddingY + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={chartWidth - paddingX}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                />
                <text
                  x={paddingX - 4}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {Math.round(maxVal * ratio)}
                </text>
              </g>
            );
          })}

          {/* Line */}
          <polyline
            points={polyline}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinejoin="round"
          />

          {/* Data points */}
          {points.map((p, i) => (
            <g key={p.date}>
              <circle
                cx={p.x}
                cy={p.y}
                r={3}
                fill="hsl(var(--primary))"
              />
              {/* X-axis labels (show every nth to avoid overlap) */}
              {(i % Math.max(1, Math.floor(chartData.length / 8)) === 0 || i === chartData.length - 1) && (
                <text
                  x={p.x}
                  y={chartHeight - 2}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={9}
                >
                  {p.label}
                </text>
              )}
            </g>
          ))}

          {/* 7-day threshold line (減数調剤対象) */}
          {maxVal >= 7 && (
            <>
              <line
                x1={paddingX}
                y1={paddingY + plotHeight - (7 / maxVal) * plotHeight}
                x2={chartWidth - paddingX}
                y2={paddingY + plotHeight - (7 / maxVal) * plotHeight}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 2"
                strokeWidth={1}
              />
              <text
                x={chartWidth - paddingX + 2}
                y={paddingY + plotHeight - (7 / maxVal) * plotHeight + 3}
                className="fill-destructive"
                fontSize={9}
              >
                7日
              </text>
            </>
          )}
        </svg>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          余剰日数の推移（赤点線: 減数調剤対象7日ライン）
        </p>
      </div>
    </div>
  );
}
