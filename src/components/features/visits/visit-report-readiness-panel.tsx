'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, CircleAlert, FileText, Stethoscope, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type VisitReportReadinessMode = 'visit_mobile' | 'visit_detail' | 'report_detail';

export type VisitReportReadinessItem = {
  key: string;
  label: string;
  description: string;
  done: boolean;
  required?: boolean;
};

const MODE_COPY: Record<
  VisitReportReadinessMode,
  {
    eyebrow: string;
    title: string;
    description: string;
    icon: typeof Stethoscope;
  }
> = {
  visit_mobile: {
    eyebrow: 'Mobile Visit Capture',
    title: '訪問先で報告書に必要な材料を集める',
    description:
      '現地ではスマホで最低限の観察・評価・計画・連携先メモを押さえ、薬局に戻ってから算定要件を満たす報告書へ展開します。',
    icon: Stethoscope,
  },
  visit_detail: {
    eyebrow: 'Report Ready Check',
    title: '薬局で報告書化する前の確認',
    description:
      '訪問記録の不足、添付、残薬、他職種へ送る論点を確認してから、医師向け・ケアマネ向け報告書を生成します。',
    icon: FileText,
  },
  report_detail: {
    eyebrow: 'Billing & Collaboration',
    title: '算定要件と他職種送付の最終確認',
    description:
      '報告書本文、算定チェック、送付先候補、送達履歴を確認し、薬局内で完結できる状態にします。',
    icon: UsersRound,
  },
};

export function VisitReportReadinessPanel({
  mode,
  items,
  actions,
  className,
}: {
  mode: VisitReportReadinessMode;
  items: readonly VisitReportReadinessItem[];
  actions?: ReactNode;
  className?: string;
}) {
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;
  const requiredItems = items.filter((item) => item.required !== false);
  const requiredDoneCount = requiredItems.filter((item) => item.done).length;
  const missingRequiredItems = requiredItems.filter((item) => !item.done);
  const ready = requiredDoneCount === requiredItems.length;
  const nextActionText = ready
    ? mode === 'visit_mobile'
      ? '現地で必要な材料は揃っています。保存して薬局で報告書化できます。'
      : mode === 'visit_detail'
        ? '報告書生成へ進めます。必要に応じて医師向け・ケアマネ向けを選択してください。'
        : '算定・送付前の必須確認は揃っています。送付前に宛先だけ最終確認してください。'
    : `次に入力: ${missingRequiredItems.map((item) => item.label).join(' / ')}`;

  return (
    <Card className={cn('border-border/70 bg-card shadow-sm', className)}>
      <CardContent className="space-y-3 p-3 sm:space-y-4 sm:p-4 xl:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="inline-flex items-center rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {copy.eyebrow}
            </p>
            <div className="flex items-start gap-2">
              <div className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background sm:size-9">
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground sm:text-base">{copy.title}</h2>
                <p
                  className={cn(
                    'mt-1 max-w-4xl text-sm leading-6 text-muted-foreground',
                    mode === 'visit_mobile' ? 'hidden sm:block' : null,
                  )}
                >
                  {copy.description}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={ready ? 'default' : 'outline'} className="w-fit">
              {requiredItems.length > 0
                ? `必須 ${requiredDoneCount}/${requiredItems.length} 充足`
                : '必須項目なし'}
            </Badge>
            {actions}
          </div>
        </div>

        <div
          className={cn(
            'rounded-xl border px-3 py-2 text-sm',
            ready
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
              : 'border-amber-200 bg-amber-50/80 text-amber-950',
          )}
          role="status"
          aria-live="polite"
        >
          {nextActionText}
        </div>

        <ul
          className={cn(
            'grid gap-2',
            mode === 'visit_mobile'
              ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'
              : 'md:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {items.map((item) => {
            const required = item.required !== false;
            return (
              <li
                key={item.key}
                className={cn(
                  'rounded-xl border px-2.5 py-2.5 sm:px-3 sm:py-3',
                  item.done
                    ? 'border-emerald-200 bg-emerald-50/70'
                    : required
                      ? 'border-amber-200 bg-amber-50/70'
                      : 'border-border/70 bg-muted/15',
                )}
              >
                <div className="flex items-start gap-2">
                  {item.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  ) : (
                    <CircleAlert
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        required ? 'text-amber-700' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-snug text-foreground">{item.label}</p>
                    <p
                      className={cn(
                        'text-xs leading-5 text-muted-foreground',
                        mode === 'visit_mobile' ? 'hidden sm:block' : null,
                      )}
                    >
                      {item.description}
                    </p>
                    {!required ? (
                      <p className="text-[11px] font-medium text-muted-foreground">任意補足</p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
