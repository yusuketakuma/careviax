'use client';

import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Clock, FileText, RefreshCw } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumnMeta } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { SkeletonRows } from '@/components/ui/loading';
import { cn } from '@/lib/utils';
import { SOURCE_LABELS } from './new/prescription-form.shared';
import { CYCLE_STATUS_CONFIG } from './prescription.shared';

// ---------------------------------------------------------------------------
// Types (exported for workspace)
// ---------------------------------------------------------------------------

export type PrescriptionIntakeRow = {
  id: string;
  display_id?: string | null;
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
    display_id?: string | null;
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
    return <span className="text-[10px] font-medium text-state-confirm">明日</span>;
  }
  return null; // 2日以上先は非表示（コンパクト化）
}

// ---------------------------------------------------------------------------
// Compact table component (レセコン左パネル)
// ---------------------------------------------------------------------------

type PrescriptionsTableProps = {
  items: PrescriptionIntakeRow[];
  isLoading: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  selectedId: string | null;
  onRowClick: (index: number) => void;
};

const PRESCRIPTION_TABLE_COLUMNS: ColumnDef<PrescriptionIntakeRow>[] = [
  {
    id: 'status',
    header: '状態',
    enableSorting: false,
    cell: ({ row }) => <StatusDot status={row.original.cycle.overall_status} />,
    meta: { mobileLabel: '状態' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
  {
    id: 'patient',
    header: '患者',
    enableSorting: false,
    cell: ({ row }) => {
      const patient = row.original.cycle.case_.patient;
      return (
        <div className="leading-tight">
          <div className="font-medium text-foreground">{patient.name}</div>
          <div className="text-[10px] text-muted-foreground">{patient.name_kana}</div>
        </div>
      );
    },
    meta: { mobileLabel: '患者' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
  {
    id: 'source',
    header: '種別',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {SOURCE_LABELS[row.original.source_type] ?? row.original.source_type}
      </span>
    ),
    meta: { mobileLabel: '種別' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
  {
    id: 'prescribed_date',
    header: '処方日',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="text-xs tabular-nums text-muted-foreground">
        {format(parseISO(row.original.prescribed_date), 'MM/dd', { locale: ja })}
      </span>
    ),
    meta: { mobileLabel: '処方日' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
  {
    id: 'prescriber',
    header: '処方医',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="block max-w-[100px] truncate text-xs text-muted-foreground">
        {row.original.prescriber_name ?? '—'}
      </span>
    ),
    meta: { mobileLabel: '処方医' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
  {
    id: 'notes',
    header: '備考',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex items-center justify-end gap-1">
        <ExpiryCell date={row.original.prescription_expiry_date} />
        {row.original.source_type === 'refill' && row.original.refill_remaining_count != null && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            <RefreshCw className="size-2.5" aria-hidden="true" />
            {row.original.refill_remaining_count}
          </span>
        )}
      </div>
    ),
    meta: { mobileLabel: '備考' } satisfies DataTableColumnMeta<PrescriptionIntakeRow>,
  },
];

export function PrescriptionsTable({
  items,
  isLoading,
  isError = false,
  errorMessage,
  onRetry,
  selectedId,
  onRowClick,
}: PrescriptionsTableProps) {
  if (isLoading) {
    return (
      <div className="px-2 py-4">
        <SkeletonRows rows={5} cols={4} />
      </div>
    );
  }

  if (isError && items.length === 0) {
    return (
      <div className="p-3">
        <ErrorState
          variant="server"
          title="処方受付一覧を表示できません"
          description="処方受付データの取得に失敗しました。空の一覧として扱わず、通信状況を確認して再読み込みしてください。"
          detail={errorMessage}
          action={onRetry ? { label: '再読み込み', onClick: onRetry } : undefined}
          headingLevel={3}
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="該当する処方受付がありません"
        description="新しい処方を登録して業務を開始しましょう"
        action={{ label: '新規受付', href: '/prescriptions/new' }}
      />
    );
  }

  const selectedRowIndex = items.findIndex((item) => item.id === selectedId);

  return (
    <DataTable
      columns={PRESCRIPTION_TABLE_COLUMNS}
      data={items}
      getRowId={(item) => item.id}
      getRowA11yLabel={(item) => item.cycle.case_.patient.name}
      selectedRowIndex={selectedRowIndex >= 0 ? selectedRowIndex : undefined}
      onRowClick={onRowClick}
      rowInteractionMode="selectable-listbox"
      listboxLabel="処方受付一覧"
      caption="処方受付一覧"
    />
  );
}
