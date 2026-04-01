'use client';

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { AlertTriangle, Clock } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useKeyboardShortcuts, type ShortcutDefinition } from '@/components/features/keyboard/use-keyboard-shortcuts';
import { compareDispenseWorkflowOrder } from '@/lib/dispensing/workflow-order';

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
        <div
          className={`flex items-center gap-1 text-sm ${row.original.is_overdue ? 'font-medium text-destructive' : ''}`}
        >
          <Clock
            className={`size-3.5 ${row.original.is_overdue ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-hidden="true"
          />
          {format(parseISO(row.original.due_date), 'MM/dd HH:mm', { locale: ja })}
          {row.original.is_overdue && <span className="text-[11px]">期限超過</span>}
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
  const isBootstrappingOrg = !orgId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedIndex, setSelectedIndex] = useState(0);
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

  const handleMoveUp = useCallback(() => {
    setSelectedIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleMoveDown = useCallback(() => {
    setSelectedIndex((prev) => Math.min(Math.max(0, orderedTasks.length - 1), prev + 1));
  }, [orderedTasks.length]);

  const handleSelect = useCallback(() => {
    const task = orderedTasks[selectedIndex];
    if (task) router.push(`/dispensing/${task.id}`);
  }, [orderedTasks, selectedIndex, router]);

  const handleQuickStart = useCallback(() => {
    const task = orderedTasks[selectedIndex];
    if (task) completeMutation.mutate(task.id);
  }, [orderedTasks, selectedIndex, completeMutation]);

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
              setSelectedIndex(0);
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
              setSelectedIndex(0);
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
        selectedRowIndex={selectedIndex}
        onRowClick={(index) => setSelectedIndex(index)}
      />
    </div>
  );
}
