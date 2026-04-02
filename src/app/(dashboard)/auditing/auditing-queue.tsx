'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { DataTable } from '@/components/ui/data-table';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';
import {
  QueueDueDate,
  QueueFacilityLabel,
  QueuePatientLink,
  QueuePriorityBadge,
  useSelectableQueueState,
} from '@/app/(dashboard)/dispensing/dispense-work-queue.shared';

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

const columns: ColumnDef<AuditTaskRow>[] = [
  {
    accessorKey: 'priority',
    header: '優先度',
    cell: ({ row }) => <QueuePriorityBadge priority={row.original.priority} />,
  },
  {
    id: 'facility',
    header: '施設/訪問先',
    cell: ({ row }) => <QueueFacilityLabel facilityLabel={row.original.facility_label} />,
  },
  {
    id: 'patient_name',
    header: '患者名',
    cell: ({ row }) => {
      const p = row.original.cycle.case_.patient;
      return (
        <QueuePatientLink
          href={`/auditing/${row.original.id}`}
          name={p.name}
          nameKana={p.name_kana}
        />
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
    cell: ({ row }) => (
      <QueueDueDate
        dueDate={row.original.due_date}
        isOverdue={row.original.is_overdue}
        showIcon={false}
      />
    ),
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
  const isBootstrappingOrg = !orgId;
  const router = useRouter();

  const { data, isLoading } = useRealtimeQuery({
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
    invalidateOn: ['cycle_transition'],
  });

  const tasks = useMemo(() => data?.data ?? [], [data]);
  const {
    selectedItem,
    selectedRowIndex,
    handleMoveUp,
    handleMoveDown,
    handleRowClick,
  } = useSelectableQueueState(tasks);

  const handleSelect = useCallback(() => {
    if (selectedItem) router.push(`/auditing/${selectedItem.id}`);
  }, [router, selectedItem]);

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'ArrowUp', handler: handleMoveUp, description: '前の行へ移動', scope: 'auditing' },
      { key: 'ArrowDown', handler: handleMoveDown, description: '次の行へ移動', scope: 'auditing' },
      { key: 'Enter', handler: handleSelect, description: '選択した行を開く', scope: 'auditing' },
      { key: 'a', handler: () => {
        if (selectedItem) router.push(`/auditing/${selectedItem.id}?action=approve`);
      }, description: '承認', scope: 'auditing' },
      { key: 'r', handler: () => {
        if (selectedItem) router.push(`/auditing/${selectedItem.id}?action=reject`);
      }, description: '差戻し', scope: 'auditing' },
      { key: ' ', handler: () => {
        // Space toggles check items — placeholder for future checklist
      }, description: 'チェック項目トグル', scope: 'auditing' },
    ],
    [handleMoveUp, handleMoveDown, handleSelect, router, selectedItem],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <DataTable
      columns={columns}
      data={tasks}
      isLoading={isBootstrappingOrg || isLoading}
      caption="鑑査待ち一覧"
      selectedRowIndex={selectedRowIndex}
      onRowClick={handleRowClick}
    />
  );
}
