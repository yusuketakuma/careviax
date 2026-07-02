'use client';

import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';
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

export function InlineFilterButton({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={[
        'inline-flex min-h-[44px] items-center justify-center rounded-full border px-3 py-1 text-xs font-medium',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/70 bg-background text-muted-foreground',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

type MyDayNextStepPanelProps = {
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  tone?: 'default' | 'warning' | 'danger';
};

const nextStepToneClassName = {
  default: 'border-primary/20 bg-primary/5 text-primary',
  warning: 'border-state-confirm/30 bg-state-confirm/10 text-state-confirm',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const;

export function MyDayNextStepPanel({
  title,
  description,
  href,
  ctaLabel,
  tone = 'default',
}: MyDayNextStepPanelProps) {
  return (
    <div className={`rounded-xl border p-3 ${nextStepToneClassName[tone]}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase">次にすること</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground ring-1 ring-border transition-colors hover:bg-muted"
        >
          {ctaLabel}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
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
