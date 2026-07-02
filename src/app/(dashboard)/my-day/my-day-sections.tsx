'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/loading';

export function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

type MyDayNextStepPanelProps = {
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  tone?: 'default' | 'warning' | 'danger';
};

// SSOT 3.2: ステータスカードは全面塗りしない。タイルは bg-card 中立に保ち、tone は
// 左ボーダー(border-l-4 border-l-state-*)と見出しラベルの文字色の2点だけで表す。
// danger は 6軸の state-blocked(差戻し/エラー)を使う(生 destructive は使わない)。
const nextStepAccent = {
  default: { border: 'border-l-primary', eyebrow: 'text-primary' },
  warning: { border: 'border-l-state-confirm', eyebrow: 'text-state-confirm' },
  danger: { border: 'border-l-state-blocked', eyebrow: 'text-state-blocked' },
} as const;

export function MyDayNextStepPanel({
  title,
  description,
  href,
  ctaLabel,
  tone = 'default',
}: MyDayNextStepPanelProps) {
  const accent = nextStepAccent[tone];
  return (
    <div className={`rounded-xl border border-l-4 bg-card p-3 ${accent.border}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase ${accent.eyebrow}`}>次にすること</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        {/* SSOT 8: 画面の主操作は唯一の Primary(--primary 塗り)。my-day ではこの CTA のみ。 */}
        <Button asChild className="shrink-0">
          <Link href={href}>
            {ctaLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function UnpreparedVisitLink({ count }: { count: number }) {
  return (
    <Link
      href="/schedules"
      className="flex min-h-[44px] items-center gap-3 rounded-lg border border-state-confirm/30 bg-state-confirm/10 p-3 text-sm font-medium text-state-confirm transition-colors hover:bg-state-confirm/15"
    >
      <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
      <span>訪問前準備が未完了 {count}件</span>
      <ArrowRight className="ml-auto size-4" aria-hidden="true" />
    </Link>
  );
}
