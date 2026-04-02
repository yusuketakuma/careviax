'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';
import { compareDispenseWorkflowOrder } from '@/lib/dispensing/workflow-order';
import {
  QueueDueDate,
  QueueFacilityLabel,
  QueuePatientLink,
  QueuePriorityBadge,
  useSelectableQueueState,
} from './dispense-work-queue.shared';

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
      lines: PrescriptionLineSummary[];
    }>;
  };
};

const columns: ColumnDef<DispenseTaskRow>[] = [
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
          href={`/dispensing/${row.original.id}`}
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
    cell: ({ row }) => (
      <QueueDueDate
        dueDate={row.original.due_date}
        isOverdue={row.original.is_overdue}
      />
    ),
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
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<'patient' | 'facility'>('patient');

  const { data, isLoading } = useRealtimeQuery({
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
    invalidateOn: ['cycle_transition'],
  });

  const tasks = useMemo(() => data?.data ?? [], [data]);
  const orderedTasks = useMemo(() => {
    const sorted = [...tasks];
    sorted.sort((a, b) => {
      const base = compareDispenseWorkflowOrder(a, b, { includeOverdue: true });
      if (base !== 0) return base;

      if (viewMode === 'facility') {
        const facilityA = a.facility_label ?? '自宅訪問';
        const facilityB = b.facility_label ?? '自宅訪問';
        if (facilityA !== facilityB) return facilityA.localeCompare(facilityB, 'ja');
      }
      return a.cycle.case_.patient.name.localeCompare(b.cycle.case_.patient.name, 'ja');
    });
    return sorted;
  }, [tasks, viewMode]);
  const {
    selectedItem,
    selectedRowIndex,
    handleMoveUp,
    handleMoveDown,
    handleRowClick,
    resetSelection,
  } = useSelectableQueueState(orderedTasks);

  const completeMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/dispense-tasks/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          status: 'in_progress',
        }),
      });
      if (!res.ok) throw new Error('着手処理に失敗しました');
      return res.json();
    },
    onSuccess: (_result, taskId) => {
      queryClient.invalidateQueries({ queryKey: ['dispense-queue', orgId] });
      router.push(`/dispensing/${taskId}`);
    },
  });

  const handleSelect = useCallback(() => {
    if (selectedItem) router.push(`/dispensing/${selectedItem.id}`);
  }, [router, selectedItem]);

  const handleQuickStart = useCallback(() => {
    if (selectedItem) completeMutation.mutate(selectedItem.id);
  }, [completeMutation, selectedItem]);

  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      { key: 'ArrowUp', handler: handleMoveUp, description: '前の行へ移動', scope: 'dispensing' },
      { key: 'ArrowDown', handler: handleMoveDown, description: '次の行へ移動', scope: 'dispensing' },
      { key: 'Enter', handler: handleSelect, description: '選択した行を開く', scope: 'dispensing' },
      { key: 'Enter', metaKey: true, handler: handleQuickStart, description: '着手して開く', scope: 'dispensing' },
    ],
    [handleMoveUp, handleMoveDown, handleSelect, handleQuickStart],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={viewMode === 'patient' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setViewMode('patient');
              resetSelection();
            }}
          >
            患者別
          </Button>
          <Button
            type="button"
            variant={viewMode === 'facility' ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setViewMode('facility');
              resetSelection();
            }}
          >
            施設別
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Cmd+Enter で選択行に着手して入力画面を開きます
        </p>
      </div>

      <DataTable
        columns={columns}
        data={orderedTasks}
        isLoading={isBootstrappingOrg || isLoading}
        caption="調剤キュー"
        selectedRowIndex={selectedRowIndex}
        onRowClick={handleRowClick}
      />
    </div>
  );
}
