'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CheckCircle2, AlertCircle, Clock, XCircle, Package, AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrgId } from '@/lib/hooks/use-org-id';

type VisitRecordRow = {
  id: string;
  patient_id: string;
  pharmacist_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  schedule: {
    visit_type: string;
    scheduled_date: string;
  } | null;
};

const outcomeConfig: Record<
  string,
  { label: string; icon: React.ElementType; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
> = {
  completed: { label: '完了', icon: CheckCircle2, variant: 'default' },
  revisit_needed: { label: '再訪必要', icon: AlertTriangle, variant: 'secondary' },
  postponed: { label: '延期', icon: Clock, variant: 'outline' },
  cancelled: { label: 'キャンセル', icon: XCircle, variant: 'destructive' },
  delivery_only: { label: '投薬のみ', icon: Package, variant: 'secondary' },
  completed_with_issue: { label: '完了（課題あり）', icon: AlertCircle, variant: 'outline' },
};

const visitTypeLabel: Record<string, string> = {
  initial: '初回',
  regular: '定期',
  temporary: '臨時',
  revisit: '再訪',
  delivery_only: '投薬のみ',
  emergency: '緊急',
  physician_co_visit: '医師同行',
};

function hasSoap(row: VisitRecordRow): boolean {
  return !!(
    row.soap_subjective ||
    row.soap_objective ||
    row.soap_assessment ||
    row.soap_plan
  );
}

const columns: ColumnDef<VisitRecordRow>[] = [
  {
    accessorKey: 'visit_date',
    header: '訪問日',
    cell: ({ row }) => (
      <Link
        href={`/visits/${row.original.id}`}
        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {format(parseISO(row.original.visit_date), 'yyyy/MM/dd', { locale: ja })}
      </Link>
    ),
  },
  {
    accessorKey: 'patient_id',
    header: '患者ID',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground font-mono">{row.original.patient_id}</span>
    ),
  },
  {
    accessorKey: 'pharmacist_id',
    header: '薬剤師ID',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground font-mono">{row.original.pharmacist_id}</span>
    ),
  },
  {
    id: 'visitType',
    header: '訪問タイプ',
    cell: ({ row }) => {
      const type = row.original.schedule?.visit_type;
      return (
        <span className="text-sm">
          {type ? (visitTypeLabel[type] ?? type) : '—'}
        </span>
      );
    },
  },
  {
    accessorKey: 'outcome_status',
    header: '訪問結果',
    cell: ({ row }) => {
      const config = outcomeConfig[row.original.outcome_status];
      if (!config) return <span className="text-muted-foreground">{row.original.outcome_status}</span>;
      const Icon = config.icon;
      return (
        <Badge variant={config.variant} className="gap-1">
          <Icon className="size-3" aria-hidden="true" />
          {config.label}
        </Badge>
      );
    },
  },
  {
    id: 'soapPresent',
    header: 'SOAP',
    cell: ({ row }) =>
      hasSoap(row.original) ? (
        <Badge variant="default" className="text-xs">あり</Badge>
      ) : (
        <span className="text-xs text-muted-foreground">なし</span>
      ),
  },
];

export function VisitsTable() {
  const orgId = useOrgId();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const queryParams = new URLSearchParams({ limit: '50' });
  if (dateFrom) queryParams.set('date_from', dateFrom);
  if (dateTo) queryParams.set('date_to', dateTo);

  const { data, isLoading } = useQuery({
    queryKey: ['visit-records', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/visit-records?${queryParams.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問記録の取得に失敗しました');
      return res.json() as Promise<{ data: VisitRecordRow[] }>;
    },
    enabled: !!orgId,
  });

  const records = useMemo(() => data?.data ?? [], [data]);

  return (
    <div className="space-y-4">
      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="date-from" className="text-xs">開始日</Label>
          <Input
            id="date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="date-to" className="text-xs">終了日</Label>
          <Input
            id="date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 w-40 text-sm"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={records}
        isLoading={isLoading}
        caption="訪問記録一覧"
      />
    </div>
  );
}
