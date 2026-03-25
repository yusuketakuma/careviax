'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, subMonths, addMonths, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Download, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';

// --- Types ---

type BillingCandidate = {
  id: string;
  patient_id: string;
  billing_month: string;
  billing_code: string;
  billing_name: string;
  points: number | null;
  status: string;
  exclusion_reason: string | null;
};

// --- Constants ---

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  candidate: { label: '候補', icon: AlertTriangle, className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  confirmed: { label: '確定', icon: CheckCircle2, className: 'bg-green-100 text-green-800 border-green-200' },
  excluded: { label: '除外', icon: XCircle, className: 'bg-gray-100 text-gray-600 border-gray-200' },
  exported: { label: '出力済', icon: CheckCircle2, className: 'bg-blue-100 text-blue-800 border-blue-200' },
};

const VALIDATION_OK = ['confirmed', 'exported'];
const VALIDATION_NG = ['excluded'];

function ValidationBadge({ status }: { status: string }) {
  if (VALIDATION_OK.includes(status)) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-700" aria-label="バリデーションOK">
        <CheckCircle2 className="size-3.5" aria-hidden="true" /> OK
      </span>
    );
  }
  if (VALIDATION_NG.includes(status)) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-700" aria-label="バリデーションNG">
        <XCircle className="size-3.5" aria-hidden="true" /> NG
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-yellow-700" aria-label="要確認">
      <AlertTriangle className="size-3.5" aria-hidden="true" /> 要確認
    </span>
  );
}

// --- Main ---

export function BillingCandidatesContent() {
  const orgId = useOrgId();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const billingMonthStr = format(currentMonth, 'yyyy-MM-dd');
  const billingMonthLabel = format(currentMonth, 'yyyy年M月', { locale: ja });

  const { data, isLoading } = useQuery({
    queryKey: ['billing-candidates', orgId, billingMonthStr],
    queryFn: async () => {
      const res = await fetch(
        `/api/billing-candidates?billing_month=${billingMonthStr}&limit=100`,
        { headers: { 'x-org-id': orgId } }
      );
      if (!res.ok) throw new Error('請求候補の取得に失敗しました');
      return res.json() as Promise<{ data: BillingCandidate[]; hasMore: boolean }>;
    },
    enabled: !!orgId,
  });

  const candidates = data?.data ?? [];

  const columns = useMemo<ColumnDef<BillingCandidate>[]>(
    () => [
      {
        accessorKey: 'billing_code',
        header: '請求コード',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.billing_code}</span>
        ),
      },
      {
        accessorKey: 'billing_name',
        header: '算定名称',
        cell: ({ row }) => (
          <span className="text-sm">{row.original.billing_name}</span>
        ),
      },
      {
        accessorKey: 'points',
        header: '点数',
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {row.original.points != null ? `${row.original.points}点` : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: '状態',
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          if (!cfg) return <span className="text-xs text-muted-foreground">{row.original.status}</span>;
          const Icon = cfg.icon;
          return (
            <Badge variant="outline" className={`flex w-fit items-center gap-1 text-xs ${cfg.className}`}>
              <Icon className="size-3" aria-hidden="true" />
              {cfg.label}
            </Badge>
          );
        },
      },
      {
        id: 'validation',
        header: 'バリデーション',
        cell: ({ row }) => <ValidationBadge status={row.original.status} />,
      },
      {
        accessorKey: 'exclusion_reason',
        header: '除外理由',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.exclusion_reason ?? '—'}
          </span>
        ),
      },
    ],
    []
  );

  function handleExport() {
    const url = `/api/billing-candidates/export?billing_month=${billingMonthStr}`;
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `billing_${billingMonthStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('CSVエクスポートを開始しました');
  }

  const okCount = candidates.filter((c) => VALIDATION_OK.includes(c.status)).length;
  const ngCount = candidates.filter((c) => VALIDATION_NG.includes(c.status)).length;
  const warningCount = candidates.filter((c) => !VALIDATION_OK.includes(c.status) && !VALIDATION_NG.includes(c.status)).length;

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
            aria-label="前月"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[120px] text-center text-base font-semibold text-foreground">
            {billingMonthLabel}
          </span>
          <Button
            size="icon"
            variant="outline"
            onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
            aria-label="翌月"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <Button size="sm" variant="outline" onClick={handleExport} disabled={candidates.length === 0}>
          <Download className="mr-1.5 size-3.5" aria-hidden="true" />
          CSV出力
        </Button>
      </div>

      {/* Validation summary */}
      <div className="flex items-center gap-4 text-sm">
        <span className="flex items-center gap-1 text-green-700">
          <CheckCircle2 className="size-4" aria-hidden="true" /> OK: {okCount}件
        </span>
        <span className="flex items-center gap-1 text-red-700">
          <XCircle className="size-4" aria-hidden="true" /> NG: {ngCount}件
        </span>
        <span className="flex items-center gap-1 text-yellow-700">
          <AlertTriangle className="size-4" aria-hidden="true" /> 要確認: {warningCount}件
        </span>
      </div>

      {/* Candidates table */}
      <DataTable
        columns={columns}
        data={candidates}
        isLoading={isLoading}
        caption="月次請求候補一覧"
      />

      {!isLoading && candidates.length === 0 && (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-dashed border-border">
          <p className="text-sm text-muted-foreground">
            {billingMonthLabel} の請求候補はありません
          </p>
        </div>
      )}
    </div>
  );
}
