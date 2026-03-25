'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Clock } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';

type PrescriptionLineSummary = {
  id: string;
  drug_name: string;
  dose: string;
  frequency: string;
  days: number;
};

type DispenseTaskRow = {
  id: string;
  priority: string;
  due_date: string | null;
  status: string;
  created_at: string;
  cycle: {
    id: string;
    patient_id: string;
    case_: {
      patient: {
        id: string;
        name: string;
        name_kana: string;
      };
    };
    prescription_intakes: Array<{
      id: string;
      prescribed_date: string;
      prescriber_name: string | null;
      lines: PrescriptionLineSummary[];
    }>;
  };
};

const priorityConfig: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon?: React.ElementType }
> = {
  emergency: { label: '緊急', variant: 'destructive', icon: AlertTriangle },
  urgent: { label: '至急', variant: 'secondary' },
  normal: { label: '通常', variant: 'outline' },
};

const columns: ColumnDef<DispenseTaskRow>[] = [
  {
    accessorKey: 'priority',
    header: '優先度',
    cell: ({ row }) => {
      const config = priorityConfig[row.original.priority] ?? priorityConfig.normal;
      const Icon = config.icon;
      return (
        <Badge variant={config.variant} className="gap-1 whitespace-nowrap">
          {Icon && <Icon className="size-3" aria-hidden="true" />}
          {config.label}
        </Badge>
      );
    },
  },
  {
    id: 'patient_name',
    header: '患者名',
    cell: ({ row }) => {
      const p = row.original.cycle.case_.patient;
      return (
        <Link
          href={`/dispensing/${row.original.id}`}
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {p.name}
          {p.name_kana && (
            <span className="ml-1 text-xs text-muted-foreground">({p.name_kana})</span>
          )}
        </Link>
      );
    },
  },
  {
    id: 'prescription_summary',
    header: '処方内容',
    cell: ({ row }) => {
      const intake = row.original.cycle.prescription_intakes[0];
      if (!intake) return <span className="text-muted-foreground text-xs">—</span>;
      const lines = intake.lines.slice(0, 3);
      return (
        <div className="space-y-0.5 text-xs">
          {lines.map((line) => (
            <div key={line.id} className="text-muted-foreground">
              {line.drug_name} {line.dose} / {line.days}日分
            </div>
          ))}
          {intake.lines.length > 3 && (
            <div className="text-muted-foreground">他 {intake.lines.length - 3} 品目</div>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'due_date',
    header: '期限',
    cell: ({ row }) => {
      if (!row.original.due_date)
        return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex items-center gap-1 text-sm">
          <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {format(parseISO(row.original.due_date), 'MM/dd HH:mm', { locale: ja })}
        </div>
      );
    },
  },
  {
    id: 'prescriber',
    header: '処方医',
    cell: ({ row }) => {
      const intake = row.original.cycle.prescription_intakes[0];
      return (
        <span className="text-sm text-muted-foreground">
          {intake?.prescriber_name ?? '—'}
        </span>
      );
    },
  },
];

export function DispensingQueue() {
  const orgId = useOrgId();

  const { data, isLoading } = useQuery({
    queryKey: ['dispense-queue', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dispense-queue', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('調剤キューの取得に失敗しました');
      return res.json() as Promise<{ data: DispenseTaskRow[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const tasks = useMemo(() => data?.data ?? [], [data]);

  return (
    <DataTable
      columns={columns}
      data={tasks}
      isLoading={isLoading}
      caption="調剤キュー"
    />
  );
}
