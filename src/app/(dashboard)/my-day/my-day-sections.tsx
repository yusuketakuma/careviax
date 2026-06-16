'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ClipboardList } from 'lucide-react';
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
        'inline-flex min-h-[44px] items-center rounded-full border px-3 py-1 text-xs font-medium sm:min-h-[32px]',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border/70 bg-background text-muted-foreground',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

export function QuickStat({
  label,
  value,
  loading,
  urgent,
}: {
  label: string;
  value: number;
  loading: boolean;
  urgent?: boolean;
}) {
  return (
    <div
      className={`flex min-h-[72px] flex-col justify-center rounded-lg border p-2.5 text-center ${urgent ? 'border-red-200 bg-red-50' : ''}`}
    >
      <p className={`text-xl font-bold ${urgent ? 'text-red-600' : 'text-foreground'}`}>
        {loading ? '...' : value}
      </p>
      <p className="text-[10px] leading-tight text-muted-foreground">{label}</p>
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

const nextStepToneClassName = {
  default: 'border-primary/20 bg-primary/5 text-primary',
  warning: 'border-orange-200 bg-orange-50 text-orange-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
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

export function MyDayEmptyAction({
  message,
  href,
  label,
}: {
  message: string;
  href: string;
  label: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Link
        href={href}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted/50"
      >
        {label}
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function MyDaySectionError({
  title,
  description,
  href,
  label,
}: {
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 text-red-800">{description}</p>
          <Link
            href={href}
            className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground ring-1 ring-red-200 transition-colors hover:bg-red-100"
          >
            {label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

export function UnpreparedVisitLink({ count }: { count: number }) {
  return (
    <Link
      href="/schedules"
      className="flex min-h-[44px] items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100"
    >
      <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
      <span>訪問前準備が未完了 {count}件</span>
      <ArrowRight className="ml-auto size-4" aria-hidden="true" />
    </Link>
  );
}
