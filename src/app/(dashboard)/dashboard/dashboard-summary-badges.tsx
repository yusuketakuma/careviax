'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useOrgId } from '@/lib/hooks/use-org-id';

/**
 * p0_07 の集計バッジ行。今日の残作業を件数バッジで横一列に出し、
 * クリックで該当画面へ移動する。データは /api/dashboard/today を利用。
 */

type TodaySummaryResponse = {
  visits: { total: number; completed: number; pending: number };
  tasks: { open: number };
  role_focus?: { items?: { label: string; count: number; action_href: string }[] };
};

async function fetchTodaySummary(orgId: string): Promise<TodaySummaryResponse> {
  const res = await fetch('/api/dashboard/today', { headers: { 'x-org-id': orgId } });
  if (!res.ok) throw new Error('今日の集計の取得に失敗しました');
  const json = await res.json();
  // /api/dashboard/today は success() で素の JSON を返す({data} ラッパー無し)
  return (json.data ?? json) as TodaySummaryResponse;
}

type SummaryBadge = {
  label: string;
  count: number;
  href: string;
  tone: 'progress' | 'waiting' | 'attention' | 'neutral';
};

const TONE_CLASSES: Record<SummaryBadge['tone'], string> = {
  progress: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  waiting: 'border-sky-200 bg-sky-50 text-sky-700',
  attention: 'border-amber-200 bg-amber-50 text-amber-700',
  neutral: 'border-border bg-muted/40 text-muted-foreground',
};

export function DashboardSummaryBadges() {
  const orgId = useOrgId();
  const { data } = useQuery({
    queryKey: ['dashboard', 'today-summary', orgId],
    queryFn: () => fetchTodaySummary(orgId),
    staleTime: 60_000,
    enabled: Boolean(orgId),
  });

  if (!data) {
    return (
      <div
        className="h-9 animate-pulse rounded-full bg-muted/50"
        role="status"
        aria-label="今日の集計を読み込み中"
      />
    );
  }

  const badges: SummaryBadge[] = [
    {
      label: '訪問予定',
      count: data.visits.pending,
      href: '/schedules',
      tone: 'waiting',
    },
    {
      label: '訪問完了',
      count: data.visits.completed,
      href: '/visits',
      tone: 'progress',
    },
    {
      label: '未完了タスク',
      count: data.tasks.open,
      href: '/tasks',
      tone: data.tasks.open > 0 ? 'attention' : 'neutral',
    },
    ...(data.role_focus?.items ?? []).map(
      (item): SummaryBadge => ({
        label: item.label,
        count: item.count,
        href: item.action_href,
        tone: item.count > 0 ? 'attention' : 'neutral',
      }),
    ),
  ];

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="dashboard-summary-badges"
      aria-label="今日の件数サマリー"
    >
      {badges.map((badge) => (
        <Link
          key={`${badge.label}-${badge.href}`}
          href={badge.href}
          className={cn(
            'inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors hover:opacity-85',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            TONE_CLASSES[badge.tone],
          )}
        >
          <span>{badge.label}</span>
          <span className="font-bold">{badge.count}件</span>
        </Link>
      ))}
    </div>
  );
}
