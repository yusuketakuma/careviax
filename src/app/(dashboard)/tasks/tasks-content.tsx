'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { CheckSquare, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';

// --- Types ---

type Task = {
  id: string;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_date: string | null;
  sla_due_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  completed_at: string | null;
  created_at: string;
};

// --- Constants ---

const STATUS_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'pending', label: '未着手' },
  { value: 'in_progress', label: '進行中' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: 'キャンセル' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'urgent', label: '緊急' },
  { value: 'high', label: '高' },
  { value: 'normal', label: '通常' },
  { value: 'low', label: '低' },
];

const TASK_TYPE_OPTIONS = [
  { value: '', label: 'すべて' },
  { value: 'visit_demand', label: '訪問候補' },
  { value: 'visit_preparation', label: '訪問準備' },
  { value: 'management_plan_review', label: '計画書' },
  { value: 'report_delivery_followup', label: '報告送達' },
  { value: 'report_response_followup', label: '報告返信待ち' },
  { value: 'handoff_confirmation', label: '申し送り確認' },
  { value: 'conference_action_item', label: 'カンファレンス' },
  { value: 'emergency_coverage_gap', label: '当番体制' },
  { value: 'inquiry_workbench', label: '疑義照会' },
];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  pending:     { label: '未着手',   className: 'bg-blue-100 text-blue-800 border-blue-200' },
  in_progress: { label: '進行中',   className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  completed:   { label: '完了',     className: 'bg-gray-100 text-gray-600 border-gray-200' },
  cancelled:   { label: 'キャンセル', className: 'bg-red-100 text-red-800 border-red-200' },
};

const PRIORITY_CONFIG: Record<string, { label: string; className: string }> = {
  urgent: { label: '緊急', className: 'bg-red-100 text-red-800 border-red-200' },
  high:   { label: '高',   className: 'bg-orange-100 text-orange-800 border-orange-200' },
  normal: { label: '通常', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  low:    { label: '低',   className: 'bg-gray-100 text-gray-600 border-gray-200' },
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return format(parseISO(value), 'MM/dd', { locale: ja });
}

// --- Main ---

export function TasksContent() {
  const orgId = useOrgId();
  const currentUserId = useAuthStore((s) => s.currentUser.id);
  const queryClient = useQueryClient();

  const [assignedToMe, setAssignedToMe] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [taskTypeFilter, setTaskTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([]);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (taskTypeFilter) p.set('task_type', taskTypeFilter);
    if (priorityFilter) p.set('priority', priorityFilter);
    if (assignedToMe && currentUserId) p.set('assigned_to', currentUserId);
    return p.toString();
  }, [statusFilter, taskTypeFilter, priorityFilter, assignedToMe, currentUserId]);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', orgId, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?${queryParams}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('タスクの取得に失敗しました');
      return res.json() as Promise<{ data: Task[] }>;
    },
    enabled: !!orgId,
  });

  const tasks = data?.data ?? [];

  const bulkCompleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/tasks/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
            body: JSON.stringify({ status: 'completed' }),
          })
        )
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      if (failed === 0) {
        toast.success(`${total}件のタスクを完了しました`);
      } else {
        toast.warning(`${total - failed}件完了、${failed}件失敗しました`);
      }
      setSelectedTasks([]);
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
    },
    onError: () => {
      toast.error('タスクの一括完了に失敗しました');
    },
  });

  const completableTasks = selectedTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        accessorKey: 'priority',
        header: '優先度',
        cell: ({ row }) => {
          const cfg = PRIORITY_CONFIG[row.original.priority];
          return cfg ? (
            <Badge variant="outline" className={`text-xs ${cfg.className}`}>
              {cfg.label}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{row.original.priority}</span>
          );
        },
        size: 70,
      },
      {
        accessorKey: 'title',
        header: 'タイトル',
        cell: ({ row }) => {
          const task = row.original;
          const { actionHref, queueLabel } = describeOperationalTask(task);
          return (
            <div className="space-y-0.5">
              <p className="text-sm font-medium leading-snug">{task.title}</p>
              <p className="text-xs text-muted-foreground">{queueLabel}</p>
              <Link
                href={actionHref}
                className="text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                → 確認する
              </Link>
            </div>
          );
        },
      },
      {
        accessorKey: 'status',
        header: '状態',
        cell: ({ row }) => {
          const cfg = STATUS_CONFIG[row.original.status];
          return cfg ? (
            <Badge variant="outline" className={`text-xs ${cfg.className}`}>
              {cfg.label}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{row.original.status}</span>
          );
        },
        size: 90,
      },
      {
        accessorKey: 'assigned_to',
        header: '担当',
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.assigned_to ?? '—'}
          </span>
        ),
        size: 120,
      },
      {
        id: 'due',
        header: '期限',
        cell: ({ row }) => {
          const due = row.original.sla_due_at ?? row.original.due_date;
          const label = formatDate(due);
          const isOverdue =
            due && row.original.status !== 'completed'
              ? new Date(due) < new Date()
              : false;
          return (
            <span className={`text-xs tabular-nums ${isOverdue ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
              {label}
            </span>
          );
        },
        size: 70,
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4" aria-hidden="true" />
            フィルタ
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="status-filter">状態</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? '')}>
                <SelectTrigger id="status-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type-filter">種別</Label>
              <Select value={taskTypeFilter} onValueChange={(v) => setTaskTypeFilter(v ?? '')}>
                <SelectTrigger id="type-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="priority-filter">優先度</Label>
              <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v ?? '')}>
                <SelectTrigger id="priority-filter">
                  <SelectValue placeholder="すべて" />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-0.5">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={assignedToMe}
                  onCheckedChange={(v) => setAssignedToMe(!!v)}
                />
                自分に割り当て
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk actions bar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{tasks.length}件</p>
        {completableTasks.length > 0 && (
          <Button
            size="sm"
            onClick={() => bulkCompleteMutation.mutate(completableTasks.map((t) => t.id))}
            disabled={bulkCompleteMutation.isPending}
          >
            <CheckSquare className="mr-1.5 size-3.5" aria-hidden="true" />
            選択した{completableTasks.length}件を完了
          </Button>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={tasks}
        isLoading={isLoading}
        caption="タスク一覧"
        enableRowSelection
        onSelectionChange={setSelectedTasks}
        getRowId={(row) => row.id}
      />

      {/* Mobile card list */}
      <div className="sm:hidden space-y-3">
        {tasks.map((task) => {
          const cfg = STATUS_CONFIG[task.status];
          const priCfg = PRIORITY_CONFIG[task.priority];
          const { actionHref } = describeOperationalTask(task);
          const due = task.sla_due_at ?? task.due_date;
          const isOverdue = due && task.status !== 'completed' ? new Date(due) < new Date() : false;
          return (
            <div
              key={task.id}
              className="rounded-xl border border-border/70 p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {priCfg && (
                  <Badge variant="outline" className={`text-xs ${priCfg.className}`}>
                    {priCfg.label}
                  </Badge>
                )}
                {cfg && (
                  <Badge variant="outline" className={`text-xs ${cfg.className}`}>
                    {cfg.label}
                  </Badge>
                )}
              </div>
              <p className="text-sm font-medium">{task.title}</p>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${isOverdue ? 'font-semibold text-red-600' : 'text-muted-foreground'}`}>
                  期限: {formatDate(due)}
                </span>
                <Link href={actionHref} className="text-xs text-primary hover:underline">
                  確認する →
                </Link>
              </div>
            </div>
          );
        })}
        {!isLoading && tasks.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            該当するタスクはありません
          </p>
        )}
      </div>
    </div>
  );
}
