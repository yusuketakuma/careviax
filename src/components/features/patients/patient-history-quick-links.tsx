'use client';

import Link from 'next/link';
import { Activity, ClipboardList, History } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

type PatientHistoryQuickLinksVariant = 'panel' | 'inline';

type PatientHistoryQuickLinksProps = {
  patientId: string;
  patientName?: string | null;
  variant?: PatientHistoryQuickLinksVariant;
  showTimeline?: boolean;
  className?: string;
};

function getHistoryLinks(patientId: string, showTimeline: boolean) {
  return [
    {
      key: 'prescriptions',
      href: `/patients/${patientId}/prescriptions`,
      label: '処方歴',
      description: '前回処方・Do・変更点',
      icon: ClipboardList,
    },
    {
      key: 'visits',
      href: `/patients/${patientId}?tab=visits`,
      label: '訪問歴',
      description: '訪問記録・次回提案',
      icon: History,
    },
    ...(showTimeline
      ? [
          {
            key: 'timeline',
            href: `/patients/${patientId}?tab=timeline`,
            label: '統合履歴',
            description: '処方・訪問・連携の時系列',
            icon: Activity,
          },
        ]
      : []),
  ];
}

export function PatientHistoryQuickLinks({
  patientId,
  patientName,
  variant = 'panel',
  showTimeline = true,
  className,
}: PatientHistoryQuickLinksProps) {
  const links = getHistoryLinks(patientId, showTimeline);
  const labelPrefix = patientName ? `${patientName}の` : '患者の';
  const headingId = useId();

  if (variant === 'inline') {
    return (
      <div
        className={cn('flex flex-wrap items-center gap-1.5', className)}
        aria-label={`${labelPrefix}過去歴リンク`}
      >
        {links.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border/70 bg-card px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-7 sm:px-2"
          >
            {item.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <section
      className={cn('border-b border-border/70 bg-card px-3 py-2', className)}
      aria-labelledby={headingId}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-0.5">
          <h2 id={headingId} className="text-xs font-semibold text-foreground">
            患者の過去歴
          </h2>
          <p className="text-[11px] text-muted-foreground">
            今回の内容を判断する前に、過去処方・訪問記録・統合履歴を同じ患者文脈で確認します。
          </p>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-3 lg:min-w-[26rem]">
          {links.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                className="group rounded-lg border border-border/70 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground group-hover:text-primary">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  {item.description}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
