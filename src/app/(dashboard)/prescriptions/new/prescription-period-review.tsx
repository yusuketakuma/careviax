'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { cn } from '@/lib/utils';
import {
  buildPeriodReviewNotices,
  buildPeriodReviewRows,
  buildPeriodSummaryLabel,
  buildProcessingChips,
  type PeriodReviewLineInput,
  type PeriodReviewRow,
} from './prescription-period-review.shared';

const periodReviewColumns: ColumnDef<PeriodReviewRow>[] = [
  {
    accessorKey: 'drugName',
    header: '薬剤名',
    cell: ({ row }) => (
      <span data-testid="period-review-row" className="font-medium text-foreground">
        {row.original.drugName}
      </span>
    ),
  },
  { accessorKey: 'frequencyLabel', header: '用法' },
  { accessorKey: 'daysLabel', header: '日数' },
  { accessorKey: 'startLabel', header: '開始日' },
  { accessorKey: 'endLabel', header: '終了日' },
  { accessorKey: 'processingLabel', header: '加工・セット' },
  {
    accessorKey: 'noteLabel',
    header: '注意',
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.noteLabel}</span>,
  },
];

/**
 * p0_10「処方入力・服用期間」: いつからいつまでの薬か・加工する薬かを
 * 保存前にひと目で確認するレビューカード。明細編集の下、登録操作の前に置く。
 */

type PrescriptionPeriodReviewProps = {
  lines: PeriodReviewLineInput[];
  patientName: string;
  submitBlockers: string[];
  canSubmit: boolean;
  isSubmitting: boolean;
};

export function PrescriptionPeriodReview({
  lines,
  patientName,
  submitBlockers,
  canSubmit,
  isSubmitting,
}: PrescriptionPeriodReviewProps) {
  const rows = buildPeriodReviewRows(lines);
  if (rows.length === 0) return null;

  const periodLabel = buildPeriodSummaryLabel(lines);
  const chips = buildProcessingChips(lines);
  const notices = buildPeriodReviewNotices({ lines, submitBlockers });

  return (
    <section
      data-testid="prescription-period-review"
      className="rounded-lg border border-border/70 bg-card p-4 sm:p-5"
      aria-labelledby="period-review-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="period-review-heading" className="text-base font-bold text-foreground">
            処方入力・編集
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            いつからいつまでの薬か、加工する薬かをここで確認します
          </p>
          <p className="mt-2 text-base font-bold text-foreground">
            {patientName ? `${patientName} 様` : '患者未選択'}
            {periodLabel ? `　今回の薬:${periodLabel}` : ''}
          </p>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isSubmitting ? '保存中...' : '保存して次へ'}
        </button>
      </div>

      <div className="mt-4">
        <DataTable
          columns={periodReviewColumns}
          data={rows}
          getRowId={(row, index) => `${row.drugName}-${index}`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section
          aria-labelledby="period-review-processing-heading"
          className="rounded-lg border border-border/60 bg-background p-4"
        >
          <h3 id="period-review-processing-heading" className="text-sm font-bold text-foreground">
            薬の加工指定
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {chips.map((chip) => (
              <div
                key={chip.key}
                data-testid="processing-chip"
                data-active={chip.active}
                className={cn(
                  'rounded-lg border px-4 py-2.5',
                  chip.active ? 'border-primary/50 bg-primary/5' : 'border-border bg-background',
                )}
              >
                <p
                  className={cn(
                    'text-sm font-bold',
                    chip.active ? 'text-primary' : 'text-foreground',
                  )}
                >
                  {chip.label}
                  {chip.active ? `(${chip.count}剤)` : ''}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{chip.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="period-review-notices-heading"
          className="rounded-lg border border-border/60 bg-background p-4"
        >
          <h3 id="period-review-notices-heading" className="text-sm font-bold text-foreground">
            止まっている理由
          </h3>
          {notices.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">止まっている理由はありません。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {notices.map((notice) => (
                <li
                  key={notice.text}
                  className={cn(
                    'text-sm font-medium leading-6',
                    notice.severity === 'critical' ? 'text-state-blocked' : 'text-state-confirm',
                  )}
                >
                  ・{notice.text}
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/handoff"
            className={cn(buttonVariants({ variant: 'default' }), 'mt-4 min-h-11 w-full')}
          >
            薬剤師へ相談
          </Link>
        </section>
      </div>
    </section>
  );
}
