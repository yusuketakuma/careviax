'use client';

import { useMemo } from 'react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Clock, FilePlus, FileText, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SkeletonRows } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import { SOURCE_LABELS } from './new/prescription-form.shared';
import { CYCLE_STATUS_CONFIG } from './prescription.shared';

// ---------------------------------------------------------------------------
// Types (exported for workspace)
// ---------------------------------------------------------------------------

export type PrescriptionIntakeRow = {
  id: string;
  cycle_id: string;
  source_type: string;
  prescribed_date: string;
  prescriber_name: string | null;
  prescriber_institution: string | null;
  prescription_expiry_date: string | null;
  refill_remaining_count: number | null;
  refill_next_dispense_date: string | null;
  created_at: string;
  cycle: {
    overall_status: string;
    patient_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
      };
    };
  };
};

// ---------------------------------------------------------------------------
// Compact status badge (small for dense rows)
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: string }) {
  const config = CYCLE_STATUS_CONFIG[status];
  if (!config) return <span className="text-[10px]">{status}</span>;
  return (
    <Badge
      variant={config.variant}
      className={cn('h-5 px-1.5 text-[10px] leading-none', config.className)}
    >
      {config.label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Expiry cell — ultra compact
// ---------------------------------------------------------------------------

function ExpiryCell({ date }: { date: string | null }) {
  if (!date) return null;
  const parsed = parseISO(date);
  const daysLeft = differenceInCalendarDays(parsed, new Date());

  if (daysLeft < 0) {
    return (
      <span className="text-[10px] font-medium text-destructive">
        <AlertTriangle className="mr-0.5 inline size-2.5" aria-hidden="true" />
        期限切
      </span>
    );
  }
  if (daysLeft === 0) {
    return (
      <span className="text-[10px] font-medium text-destructive">
        <Clock className="mr-0.5 inline size-2.5" aria-hidden="true" />
        本日
      </span>
    );
  }
  if (daysLeft === 1) {
    return (
      <span className="text-[10px] font-medium text-amber-700">明日</span>
    );
  }
  return null; // 2日以上先は非表示（コンパクト化）
}

// ---------------------------------------------------------------------------
// Compact table component (レセコン左パネル)
// ---------------------------------------------------------------------------

type PrescriptionsTableProps = {
  items: PrescriptionIntakeRow[];
  isLoading: boolean;
  selectedId: string | null;
  selectedRowIndex: number;
  onRowClick: (index: number) => void;
};

export function PrescriptionsTable({
  items,
  isLoading,
  selectedId,
  selectedRowIndex,
  onRowClick,
}: PrescriptionsTableProps) {
  if (isLoading) {
    return (
      <div className="px-2 py-4">
        <SkeletonRows rows={5} cols={4} />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
        <FileText className="size-8 opacity-20" aria-hidden="true" />
        <div className="text-center">
          <p className="text-sm">該当する処方受付がありません</p>
          <p className="mt-1 text-xs">新しい処方を登録して業務を開始しましょう</p>
        </div>
        <Button variant="default" size="sm" className="mt-2 gap-1" asChild>
          <Link href="/prescriptions/new">
            <FilePlus className="size-3.5" aria-hidden="true" />
            新規受付
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto" role="listbox" aria-label="処方受付一覧">
      <table className="w-full text-xs" aria-label="処方受付一覧">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <th scope="col" className="px-2 py-1.5">状態</th>
            <th scope="col" className="px-2 py-1.5">患者</th>
            <th scope="col" className="px-2 py-1.5">種別</th>
            <th scope="col" className="px-2 py-1.5">処方日</th>
            <th scope="col" className="px-2 py-1.5">処方医</th>
            <th scope="col" className="px-2 py-1.5 text-right">備考</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const isSelected = item.id === selectedId;
            const patient = item.cycle.case_.patient;
            return (
              <tr
                key={item.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onRowClick(index)}
                className={cn(
                  'cursor-pointer border-b border-border/30 transition-colors',
                  // zebra stripe
                  index % 2 === 0 ? 'bg-background' : 'bg-muted/20',
                  // selected row — レセコン風の強調
                  isSelected
                    ? 'bg-primary/10 outline outline-1 outline-primary/40'
                    : 'hover:bg-accent/50',
                )}
              >
                <td className="px-2 py-1.5">
                  <StatusDot status={item.cycle.overall_status} />
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-medium text-foreground leading-tight">
                    {patient.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    {patient.name_kana}
                  </div>
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {SOURCE_LABELS[item.source_type] ?? item.source_type}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                  {format(parseISO(item.prescribed_date), 'MM/dd', { locale: ja })}
                </td>
                <td className="max-w-[100px] truncate px-2 py-1.5 text-muted-foreground">
                  {item.prescriber_name ?? '—'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <ExpiryCell date={item.prescription_expiry_date} />
                    {item.source_type === 'refill' && item.refill_remaining_count != null && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <RefreshCw className="size-2.5" aria-hidden="true" />
                        {item.refill_remaining_count}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
