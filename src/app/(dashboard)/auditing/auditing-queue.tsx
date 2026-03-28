'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';

type AuditTaskRow = {
  id: string;
  priority: string;
  due_date: string | null;
  updated_at: string;
  facility_label: string | null;
  is_overdue: boolean;
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
      lines: Array<{ id: string; drug_name: string; days: number }>;
    }>;
  };
  results: Array<{
    id: string;
    actual_drug_name: string;
    actual_quantity: number;
    actual_unit: string | null;
    dispensed_at: string;
  }>;
};

const priorityConfig: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; icon?: React.ElementType }
> = {
  emergency: { label: '緊急', variant: 'destructive', icon: AlertTriangle },
  urgent: { label: '至急', variant: 'secondary' },
  normal: { label: '通常', variant: 'outline' },
};

const columns: ColumnDef<AuditTaskRow>[] = [
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
    id: 'facility',
    header: '施設/訪問先',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.facility_label ?? '自宅訪問'}
      </span>
    ),
  },
  {
    id: 'patient_name',
    header: '患者名',
    cell: ({ row }) => {
      const p = row.original.cycle.case_.patient;
      return (
        <Link
          href={`/auditing/${row.original.id}`}
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
              {line.drug_name} {line.days}日分
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
      if (!row.original.due_date) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }

      return (
        <span className={row.original.is_overdue ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}>
          {format(parseISO(row.original.due_date), 'MM/dd HH:mm', { locale: ja })}
          {row.original.is_overdue && ' / 期限超過'}
        </span>
      );
    },
  },
  {
    id: 'dispense_count',
    header: '調剤品目数',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.results.length} 品目</span>
    ),
  },
  {
    accessorKey: 'updated_at',
    header: '調剤完了',
    cell: ({ row }) => (
      <span className={row.original.is_overdue ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'}>
        {format(parseISO(row.original.updated_at), 'MM/dd HH:mm', { locale: ja })}
      </span>
    ),
  },
];

export function AuditingQueue() {
  const orgId = useOrgId();
  const router = useRouter();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['dispense-audits', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dispense-audits', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('鑑査キューの取得に失敗しました');
      return res.json() as Promise<{ data: AuditTaskRow[] }>;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const tasks = useMemo(() => data?.data ?? [], [data]);

  const handleMoveUp = useCallback(() => {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleMoveDown = useCallback(() => {
    setSelectedIndex((prev) => Math.min(Math.max(0, tasks.length - 1), prev + 1));
  }, [tasks.length]);

  const handleSelect = useCallback(() => {
    const task = tasks[selectedIndex];
    if (task) router.push(`/auditing/${task.id}`);
  }, [tasks, selectedIndex, router]);

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'ArrowUp', handler: handleMoveUp, description: '前の行へ移動', scope: 'auditing' },
      { key: 'ArrowDown', handler: handleMoveDown, description: '次の行へ移動', scope: 'auditing' },
      { key: 'Enter', handler: handleSelect, description: '選択した行を開く', scope: 'auditing' },
      { key: 'a', handler: () => {
        const task = tasks[selectedIndex];
        if (task) router.push(`/auditing/${task.id}?action=approve`);
      }, description: '承認', scope: 'auditing' },
      { key: 'r', handler: () => {
        const task = tasks[selectedIndex];
        if (task) router.push(`/auditing/${task.id}?action=reject`);
      }, description: '差戻し', scope: 'auditing' },
      { key: ' ', handler: () => {
        // Space toggles check items — placeholder for future checklist
      }, description: 'チェック項目トグル', scope: 'auditing' },
    ],
    [handleMoveUp, handleMoveDown, handleSelect, tasks, selectedIndex, router],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <DataTable
      columns={columns}
      data={tasks}
      isLoading={isLoading}
      caption="鑑査待ち一覧"
      selectedRowIndex={selectedIndex}
      onRowClick={(index) => setSelectedIndex(index)}
    />
  );
}
