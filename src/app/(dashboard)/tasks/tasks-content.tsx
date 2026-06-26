'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { CheckSquare, Filter, Send, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageSection } from '@/components/layout/page-section';
import { DataTable } from '@/components/ui/data-table';
import { ErrorState } from '@/components/ui/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ActionRail } from '@/components/ui/action-rail';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterSummaryBar } from '@/components/ui/filter-summary-bar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { readApiJson } from '@/lib/api/client-json';
import { fetchAllCursorPages } from '@/lib/api/cursor-pagination-client';
import { useAuthStore } from '@/lib/stores/auth-store';
import { describeOperationalTask } from '@/lib/tasks/operational-task-presentation';
import {
  bulkCompleteTasksResponseSchema,
  type BulkCompleteTasksResponse,
} from '@/lib/tasks/bulk-completion-contract';
import { summarizeBulkCompleteTaskFailures } from '@/lib/tasks/bulk-completion-messages';
import { StateBadge } from '@/components/ui/state-badge';
import {
  PRIORITY_ROLE,
  TASK_STATUS_ROLE,
  type StatusRoleOrNeutral,
} from '@/lib/constants/status-labels';
import { formatDateLabel } from '@/lib/ui/date-format';
import type {
  TasksAssignedFilter,
  TasksPriorityFilter,
  TasksStatusFilter,
} from '@/lib/dashboard/home-link-builders';
import { useSyncedSearchParams } from '@/lib/navigation/use-synced-search-params';

// --- Types ---

type Task = {
  id: string;
  task_type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  can_complete_inline?: boolean;
  due_date: string | null;
  sla_due_at: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  completed_at: string | null;
  created_at: string;
};

const taskSchema: z.ZodType<Task> = z.object({
  id: z.string(),
  task_type: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  assigned_to: z.string().nullable(),
  assigned_to_name: z.string().nullable().optional(),
  can_complete_inline: z.boolean().optional(),
  due_date: z.string().nullable(),
  sla_due_at: z.string().nullable(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: z.string(),
});

type StaffWorkload = {
  id: string;
  name: string;
  role_label: string;
  open_task_count: number;
  today_visit_count: number;
  dispense_task_count: number;
  workload_score: number;
  visits: Array<{
    id: string;
    patient_name: string;
  }>;
  open_tasks: Array<{
    id: string;
    title: string;
  }>;
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
  { value: 'staff_work_request_visit', label: '訪問依頼' },
  { value: 'staff_work_request_audit', label: '監査依頼' },
  { value: 'staff_work_request_general', label: '業務依頼' },
  { value: 'visit_demand', label: '訪問候補' },
  { value: 'visit_preparation', label: '訪問準備' },
  { value: 'management_plan_review', label: '計画書' },
  { value: 'report_delivery_followup', label: '報告送達' },
  { value: 'report_response_followup', label: '報告返信待ち' },
  { value: 'communication_request_followup', label: '連携返信待ち' },
  { value: 'handoff_confirmation', label: '申し送り確認' },
  { value: 'conference_action_item', label: 'カンファレンス' },
  { value: 'emergency_coverage_gap', label: '当番体制' },
  { value: 'inquiry_workbench', label: '疑義照会' },
];

const WORK_REQUEST_OPTIONS = [
  { value: 'staff_work_request_visit', label: '訪問に行ってほしい' },
  { value: 'staff_work_request_audit', label: '監査をしてほしい' },
  { value: 'staff_work_request_general', label: 'その他の業務を依頼' },
];

// 状態色は 6 軸セマンティック（status-labels.ts の *_ROLE）を正本とする。
// docs/state-color-migration-map.md の TASK_STATUS_ROLE / PRIORITY_ROLE に追随。
const STATUS_CONFIG: Record<string, { label: string; role: StatusRoleOrNeutral }> = {
  pending: { label: '未着手', role: TASK_STATUS_ROLE.pending },
  in_progress: { label: '進行中', role: TASK_STATUS_ROLE.in_progress },
  completed: { label: '完了', role: TASK_STATUS_ROLE.completed },
  cancelled: { label: 'キャンセル', role: TASK_STATUS_ROLE.cancelled },
};

const PRIORITY_CONFIG: Record<string, { label: string; role: StatusRoleOrNeutral }> = {
  urgent: { label: '緊急', role: PRIORITY_ROLE.urgent },
  high: { label: '高', role: PRIORITY_ROLE.high },
  normal: { label: '通常', role: PRIORITY_ROLE.normal },
  low: { label: '低', role: PRIORITY_ROLE.low },
};

// neutral は状態色を付けず既定 Badge / text-muted で描く（移行台帳の neutral 運用）。
function TaskStateBadge({ label, role }: { label: string; role: StatusRoleOrNeutral }) {
  if (role === 'neutral') {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        {label}
      </Badge>
    );
  }
  return (
    <StateBadge role={role} showIcon={false} className="text-xs">
      {label}
    </StateBadge>
  );
}

// --- Main ---

type TasksContentProps = {
  initialAssigned?: TasksAssignedFilter;
  initialStatus?: TasksStatusFilter;
  initialTaskType?: string | null;
  initialPriority?: TasksPriorityFilter;
  initialContext?: string | null;
  initialWorkRequestType?: string | null;
  initialWorkRequestTitle?: string | null;
  initialWorkRequestDescription?: string | null;
  initialRelatedEntityType?: string | null;
  initialRelatedEntityId?: string | null;
};

export function TasksContent({
  initialAssigned,
  initialStatus,
  initialTaskType,
  initialPriority,
  initialContext,
  initialWorkRequestType,
  initialWorkRequestTitle,
  initialWorkRequestDescription,
  initialRelatedEntityType,
  initialRelatedEntityId,
}: TasksContentProps = {}) {
  const replaceTaskUrl = useSyncedSearchParams();
  const orgId = useOrgId();
  const currentUserId = useAuthStore((s) => s.currentUser.id);
  const queryClient = useQueryClient();

  const [assignedToMe, setAssignedToMe] = useState(initialAssigned === 'me');
  const [statusFilter, setStatusFilter] = useState(initialStatus ?? 'pending');
  const [taskTypeFilter, setTaskTypeFilter] = useState(initialTaskType ?? '');
  const [priorityFilter, setPriorityFilter] = useState(initialPriority ?? '');
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([]);
  const [requestAssignee, setRequestAssignee] = useState('');
  const [requestType, setRequestType] = useState(
    initialWorkRequestType ?? 'staff_work_request_visit',
  );
  const [requestPriority, setRequestPriority] = useState('normal');
  const [requestDueDate, setRequestDueDate] = useState('');
  const [requestTitle, setRequestTitle] = useState(initialWorkRequestTitle ?? '');
  const [requestDescription, setRequestDescription] = useState(initialWorkRequestDescription ?? '');

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (taskTypeFilter) p.set('task_type', taskTypeFilter);
    if (priorityFilter) p.set('priority', priorityFilter);
    if (assignedToMe && currentUserId) p.set('assigned_to', currentUserId);
    return p.toString();
  }, [statusFilter, taskTypeFilter, priorityFilter, assignedToMe, currentUserId]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tasks', orgId, queryParams],
    queryFn: async () => {
      return fetchAllCursorPages<Task>({
        path: '/api/tasks',
        params: new URLSearchParams(queryParams),
        init: { headers: { 'x-org-id': orgId } },
        errorMessage: 'タスクの取得に失敗しました',
        itemSchema: taskSchema,
      });
    },
    enabled: !!orgId,
  });

  const tasks = data?.data ?? [];

  const {
    data: staffWorkloadData,
    isLoading: isStaffWorkloadLoading,
    isError: isStaffWorkloadError,
    refetch: refetchStaffWorkload,
  } = useQuery({
    queryKey: ['staff-workload', orgId],
    queryFn: async () => {
      const res = await fetch('/api/staff-workload', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('スタッフ別業務量の取得に失敗しました');
      return res.json() as Promise<{ data: StaffWorkload[]; date: string }>;
    },
    enabled: !!orgId,
  });

  const staffWorkload = staffWorkloadData?.data ?? [];
  const selectedAssignee = staffWorkload.find((staff) => staff.id === requestAssignee) ?? null;
  const selectedRequestTypeLabel =
    WORK_REQUEST_OPTIONS.find((option) => option.value === requestType)?.label ?? '業務を依頼';
  const selectedRequestPriorityLabel =
    PRIORITY_OPTIONS.find((option) => option.value === requestPriority)?.label ?? '通常';
  const relatedEntitySummary =
    initialRelatedEntityType && initialRelatedEntityId
      ? initialRelatedEntityType === 'visit_schedule'
        ? '対象の訪問予定に紐づけて依頼します。'
        : initialRelatedEntityType === 'dispense_task'
          ? '対象の監査タスクに紐づけて依頼します。'
          : '対象業務に紐づけて依頼します。'
      : null;

  const createRequestMutation = useMutation({
    mutationFn: async () => {
      const dueDateIso = requestDueDate
        ? new Date(`${requestDueDate}T23:59:00+09:00`).toISOString()
        : null;
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          task_type: requestType,
          title: requestTitle.trim(),
          description: requestDescription.trim() || undefined,
          priority: requestPriority,
          assigned_to: requestAssignee,
          due_date: dueDateIso,
          related_entity_type: initialRelatedEntityType ?? undefined,
          related_entity_id: initialRelatedEntityId ?? undefined,
          metadata: {
            source: 'staff_work_request',
            requested_by: currentUserId,
            request_type_label: selectedRequestTypeLabel,
            related_entity_type: initialRelatedEntityType ?? undefined,
            related_entity_id: initialRelatedEntityId ?? undefined,
          },
        }),
      });
      if (!res.ok) throw new Error('業務依頼の作成に失敗しました');
      return res.json();
    },
    onSuccess: () => {
      toast.success('業務を依頼しました');
      setRequestTitle('');
      setRequestDescription('');
      setRequestDueDate('');
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['staff-workload', orgId] });
    },
    onError: () => {
      toast.error('業務依頼の作成に失敗しました');
    },
  });

  const bulkCompleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ ids }),
      });
      const payload = await readApiJson<BulkCompleteTasksResponse>(res, {
        fallbackMessage: 'タスク更新に失敗しました',
        schema: bulkCompleteTasksResponseSchema,
      });
      return payload.data;
    },
    onSuccess: ({ total, completed, failed, failures }) => {
      if (failed === 0) {
        toast.success(`${total}件のタスクを完了しました`);
      } else {
        const failureSummary = summarizeBulkCompleteTaskFailures(failures);
        if (failureSummary) {
          toast.warning(`${completed}件完了、${failed}件失敗しました`, {
            description: failureSummary,
          });
        } else {
          toast.warning(`${completed}件完了、${failed}件失敗しました`);
        }
      }
      setSelectedTasks([]);
      void queryClient.invalidateQueries({ queryKey: ['tasks', orgId] });
    },
    onError: () => {
      toast.error('タスクの一括完了に失敗しました');
    },
  });

  const completableTasks = selectedTasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.can_complete_inline !== false,
  );
  const dedicatedCompletionCount = selectedTasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' && t.can_complete_inline === false,
  ).length;
  const overdueTasks = tasks.filter((task) => {
    const due = task.sla_due_at ?? task.due_date;
    return due && task.status !== 'completed' && new Date(due) < new Date();
  }).length;
  const highPriorityTasks = tasks.filter((task) => task.priority === 'high').length;
  const contextSummary =
    initialContext === 'dashboard_home'
      ? assignedToMe
        ? 'ホームから自分担当の未完了タスクにフォーカスして開いています。'
        : 'ホームから優先タスクにフォーカスして開いています。'
      : null;

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        accessorKey: 'priority',
        header: '優先度',
        cell: ({ row }) => {
          const cfg = PRIORITY_CONFIG[row.original.priority];
          return cfg ? (
            <TaskStateBadge label={cfg.label} role={cfg.role} />
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
            <TaskStateBadge label={cfg.label} role={cfg.role} />
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
            {row.original.assigned_to_name ?? row.original.assigned_to ?? '—'}
          </span>
        ),
        size: 120,
      },
      {
        id: 'due',
        header: '期限',
        cell: ({ row }) => {
          const due = row.original.sla_due_at ?? row.original.due_date;
          const label = formatDateLabel(due, { pattern: 'MM/dd' });
          const isOverdue =
            due && row.original.status !== 'completed' ? new Date(due) < new Date() : false;
          return (
            <span
              className={`text-xs tabular-nums ${isOverdue ? 'font-semibold text-state-blocked' : 'text-muted-foreground'}`}
            >
              {label}
            </span>
          );
        },
        size: 70,
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      {contextSummary ? (
        <Alert
          className="border-tag-info/30 bg-tag-info/10 text-tag-info"
          data-testid="tasks-context-banner"
        >
          <Filter className="size-4 text-tag-info" aria-hidden="true" />
          <AlertDescription className="text-tag-info">{contextSummary}</AlertDescription>
        </Alert>
      ) : null}
      <PageSection
        title="今すぐ処理"
        description="未完了タスクの量、期限超過、高優先度を先に確認します。"
        tone="subtle"
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="min-h-[44px]">
              <a href="#tasks-list">一覧へ移動</a>
            </Button>
            <Button asChild size="sm" variant="ghost" className="min-h-[44px]">
              <Link href="/my-day">My Day</Link>
            </Button>
            <Button asChild size="sm" variant="ghost" className="min-h-[44px]">
              <Link href="/workflow">ワークフロー</Link>
            </Button>
          </>
        }
      >
        <FilterSummaryBar
          items={[
            { label: '表示件数', value: `${tasks.length}件` },
            { label: '期限超過', value: `${overdueTasks}件` },
            { label: '高優先度', value: `${highPriorityTasks}件` },
            {
              label: '担当',
              value: assignedToMe ? '自分' : '全員',
            },
          ]}
        />
      </PageSection>

      <PageSection
        title="スタッフ別の抱え込み"
        description="今日の訪問、未完了タスク、調剤中の件数をスタッフごとに見て、依頼先の負荷を確認します。"
        tone="subtle"
        contentClassName="space-y-4"
      >
        <div className="grid gap-3 lg:grid-cols-3" data-testid="staff-workload-board">
          {staffWorkload.map((staff) => (
            <button
              key={staff.id}
              type="button"
              onClick={() => setRequestAssignee(staff.id)}
              className={`rounded-lg border p-4 text-left transition hover:border-primary/60 hover:bg-primary/5 ${
                requestAssignee === staff.id ? 'border-primary bg-primary/5' : 'border-border/70'
              }`}
              data-testid="staff-workload-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{staff.name}</p>
                  <p className="text-xs text-muted-foreground">{staff.role_label}</p>
                </div>
                <Badge variant="outline" className="text-xs">
                  負荷 {staff.workload_score}
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-muted/60 p-2">
                  <p className="font-semibold text-foreground">{staff.today_visit_count}</p>
                  <p className="text-muted-foreground">訪問</p>
                </div>
                <div className="rounded-md bg-muted/60 p-2">
                  <p className="font-semibold text-foreground">{staff.open_task_count}</p>
                  <p className="text-muted-foreground">未完了</p>
                </div>
                <div className="rounded-md bg-muted/60 p-2">
                  <p className="font-semibold text-foreground">{staff.dispense_task_count}</p>
                  <p className="text-muted-foreground">調剤中</p>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                {staff.visits.slice(0, 2).map((visit) => (
                  <p key={visit.id} className="truncate">
                    訪問: {visit.patient_name}
                  </p>
                ))}
                {staff.open_tasks.slice(0, 2).map((task) => (
                  <p key={task.id} className="truncate">
                    依頼: {task.title}
                  </p>
                ))}
                {!isStaffWorkloadLoading &&
                staff.visits.length === 0 &&
                staff.open_tasks.length === 0 ? (
                  <p>現在表示する抱え込みはありません</p>
                ) : null}
              </div>
            </button>
          ))}
          {isStaffWorkloadLoading ? (
            <p className="text-sm text-muted-foreground">スタッフ別業務量を読み込み中...</p>
          ) : null}
          {!isStaffWorkloadLoading && isStaffWorkloadError ? (
            // 取得失敗時は「スタッフがいない」かのような false-empty を出さず、再読み込み導線を示す。
            <div className="col-span-full flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <span>スタッフ別業務量を取得できませんでした。</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refetchStaffWorkload()}
              >
                再読み込み
              </Button>
            </div>
          ) : !isStaffWorkloadLoading && staffWorkload.length === 0 ? (
            <p className="text-sm text-muted-foreground">依頼可能なスタッフが見つかりません</p>
          ) : null}
        </div>
      </PageSection>

      <PageSection
        title="スタッフへ業務依頼"
        description="訪問、監査、その他業務を特定スタッフへ割り当てます。依頼は未完了タスクとして残ります。"
        tone="subtle"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="work-request-assignee">依頼先</Label>
            <Select
              value={requestAssignee}
              onValueChange={(value) => setRequestAssignee(value ?? '')}
            >
              <SelectTrigger id="work-request-assignee">
                <SelectValue placeholder="スタッフを選択" />
              </SelectTrigger>
              <SelectContent>
                {staffWorkload.map((staff) => (
                  <SelectItem key={staff.id} value={staff.id}>
                    {staff.name} / 未完了{staff.open_task_count}件
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-request-type">依頼内容</Label>
            <Select value={requestType} onValueChange={(value) => setRequestType(value ?? '')}>
              <SelectTrigger id="work-request-type">
                <span>{selectedRequestTypeLabel}</span>
              </SelectTrigger>
              <SelectContent>
                {WORK_REQUEST_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-request-priority">優先度</Label>
            <Select
              value={requestPriority}
              onValueChange={(value) => setRequestPriority(value ?? '')}
            >
              <SelectTrigger id="work-request-priority">
                <span>{selectedRequestPriorityLabel}</span>
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.filter((option) => option.value).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_180px]">
          <div className="space-y-1.5">
            <Label htmlFor="work-request-title">件名</Label>
            <Input
              id="work-request-title"
              value={requestTitle}
              onChange={(event) => setRequestTitle(event.target.value)}
              placeholder="例: 山田さんの訪問に行ってほしい"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-request-due-date">期限</Label>
            <Input
              id="work-request-due-date"
              type="date"
              value={requestDueDate}
              onChange={(event) => setRequestDueDate(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="work-request-description">補足</Label>
          <Textarea
            id="work-request-description"
            value={requestDescription}
            onChange={(event) => setRequestDescription(event.target.value)}
            placeholder="対象患者、理由、完了条件を短く記録"
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5 text-sm text-muted-foreground">
            <p>
              {selectedAssignee
                ? `${selectedAssignee.name}さんに「${selectedRequestTypeLabel}」を依頼します。`
                : '依頼先スタッフを選ぶと、現在の抱え込みを見ながら依頼できます。'}
            </p>
            {relatedEntitySummary ? <p>{relatedEntitySummary}</p> : null}
          </div>
          <Button
            type="button"
            onClick={() => createRequestMutation.mutate()}
            disabled={!requestAssignee || !requestTitle.trim() || createRequestMutation.isPending}
            data-testid="staff-work-request-submit"
          >
            <Send className="mr-1.5 size-3.5" aria-hidden="true" />
            {createRequestMutation.isPending ? '依頼中...' : '依頼する'}
          </Button>
        </div>
      </PageSection>

      <PageSection
        title="絞り込み"
        description="状態、種別、優先度、自分担当を先に絞り込み、処理対象のタスクだけに集中できるようにします。"
        tone="subtle"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="status-filter">状態</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                const nextValue = v ?? '';
                setStatusFilter(nextValue);
                replaceTaskUrl({ status: nextValue || null });
              }}
            >
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
            <Select
              value={taskTypeFilter}
              onValueChange={(v) => {
                const nextValue = v ?? '';
                setTaskTypeFilter(nextValue);
                replaceTaskUrl({ task_type: nextValue || null });
              }}
            >
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
            <Select
              value={priorityFilter}
              onValueChange={(v) => {
                const nextValue = v ?? '';
                setPriorityFilter(nextValue);
                replaceTaskUrl({ priority: nextValue || null });
              }}
            >
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
            <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm sm:min-h-0">
              <Checkbox
                checked={assignedToMe}
                onCheckedChange={(v) => {
                  const nextValue = !!v;
                  setAssignedToMe(nextValue);
                  replaceTaskUrl({ assigned: nextValue ? 'me' : null });
                }}
              />
              <UserRoundCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
              自分に割り当て
            </label>
          </div>
        </div>
      </PageSection>

      <PageSection
        title="実行サマリー"
        description="現在の件数と一括完了アクションをまとめ、処理の着手前に全体量を把握します。"
        tone="subtle"
        actions={
          completableTasks.length > 0 ? (
            <ActionRail>
              <Button
                size="sm"
                onClick={() => bulkCompleteMutation.mutate(completableTasks.map((t) => t.id))}
                disabled={bulkCompleteMutation.isPending}
              >
                <CheckSquare className="mr-1.5 size-3.5" aria-hidden="true" />
                選択した{completableTasks.length}件を完了
              </Button>
            </ActionRail>
          ) : null
        }
      >
        <FilterSummaryBar
          items={[
            { label: '表示件数', value: `${tasks.length}件` },
            { label: '選択中', value: `${selectedTasks.length}件` },
            { label: '完了可能', value: `${completableTasks.length}件` },
            ...(dedicatedCompletionCount > 0
              ? [{ label: '専用画面', value: `${dedicatedCompletionCount}件` }]
              : []),
            {
              label: '状態',
              value:
                STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? 'すべて',
            },
            {
              label: '種別',
              value:
                TASK_TYPE_OPTIONS.find((option) => option.value === taskTypeFilter)?.label ??
                'すべて',
            },
            {
              label: '優先度',
              value:
                PRIORITY_OPTIONS.find((option) => option.value === priorityFilter)?.label ??
                'すべて',
            },
            ...(assignedToMe ? [{ label: '担当', value: '自分' }] : []),
          ]}
        />
      </PageSection>

      <PageSection
        id="tasks-list"
        title="タスク一覧"
        description="選択した条件に合うタスクを一覧し、各業務画面へ直接移動できます。"
        tone="subtle"
        contentClassName="space-y-4"
      >
        {isError ? (
          // 取得失敗時は空一覧(false-empty)・偽の0件にせず、再読み込み導線つき ErrorState を出す。
          <ErrorState
            size="inline"
            description="タスクを取得できませんでした。時間をおいて再読み込みしてください。"
            action={{ label: '再読み込み', onClick: () => void refetch() }}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={tasks}
              isLoading={isLoading}
              caption="タスク一覧"
              enableRowSelection
              onSelectionChange={setSelectedTasks}
              getRowId={(row) => row.id}
              getRowA11yLabel={(row) => row.title}
            />

            <div className="space-y-3 sm:hidden">
              {tasks.map((task) => {
                const cfg = STATUS_CONFIG[task.status];
                const priCfg = PRIORITY_CONFIG[task.priority];
                const { actionHref } = describeOperationalTask(task);
                const due = task.sla_due_at ?? task.due_date;
                const isOverdue =
                  due && task.status !== 'completed' ? new Date(due) < new Date() : false;
                return (
                  <div key={task.id} className="space-y-2 rounded-xl border border-border/70 p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {priCfg && <TaskStateBadge label={priCfg.label} role={priCfg.role} />}
                      {cfg && <TaskStateBadge label={cfg.label} role={cfg.role} />}
                    </div>
                    <p className="text-sm font-medium">{task.title}</p>
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-xs ${isOverdue ? 'font-semibold text-state-blocked' : 'text-muted-foreground'}`}
                      >
                        期限: {formatDateLabel(due, { pattern: 'MM/dd' })}
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
          </>
        )}
      </PageSection>
    </div>
  );
}
