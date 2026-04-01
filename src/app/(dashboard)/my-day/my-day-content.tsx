'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  AlertCircle,
  ArrowRight,
  CalendarPlus,
  Car,
  CheckSquare,
  CirclePause,
  ClipboardList,
  Clock,
  FileWarning,
  Hospital,
  LogOut,
  PhoneOff,
  RefreshCw,
  Sparkles,
  Star,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/loading';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useAuthStore } from '@/lib/stores/auth-store';
import { STATUS_ICON_CONFIG } from '@/lib/patient/status-icon';
import { fetchActions, PRIORITY_STYLES } from '@/app/(dashboard)/dashboard/actions-section';
import {
  SCHEDULE_STATUS_LABELS,
  statusBadgeClass,
  timeLabel,
  type VisitSchedule,
  VISIT_TYPE_LABELS,
} from '@/app/(dashboard)/schedules/day-view.shared';
import type { PatientStatusIcon } from '@/types/dashboard-home';

type Task = {
  id: string;
  task_type: string;
  title: string;
  priority: string;
  status: string;
  due_date: string | null;
  sla_due_at: string | null;
};

const STATUS_ICONS: Record<PatientStatusIcon, typeof Star> = {
  stable: UserCheck,
  new: Sparkles,
  first_visit_soon: CalendarPlus,
  attention: Star,
  urgent: TriangleAlert,
  overdue_visit: Clock,
  report_pending: FileWarning,
  medication_change: RefreshCw,
  hospitalized: Hospital,
  discharged: LogOut,
  no_contact: PhoneOff,
  paused: CirclePause,
};

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function MyDayContent() {
  const orgId = useOrgId();
  const userId = useAuthStore((s) => s.currentUser.id);
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  // My visits today
  const visitsQuery = useQuery({
    queryKey: ['my-day-visits', orgId, userId, today],
    queryFn: async () => {
      const params = new URLSearchParams({ date_from: today, date_to: today });
      if (userId) params.set('pharmacist_id', userId);
      const res = await fetch(`/api/visit-schedules?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問スケジュールの取得に失敗しました');
      return res.json() as Promise<{ data: VisitSchedule[] }>;
    },
    enabled: !!orgId,
  });

  // My tasks
  const tasksQuery = useQuery({
    queryKey: ['my-day-tasks', orgId, userId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (userId) params.set('assigned_to', userId);
      const res = await fetch(`/api/tasks?${params.toString()}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('タスクの取得に失敗しました');
      return res.json() as Promise<{ data: Task[] }>;
    },
    enabled: !!orgId,
  });

  // Pipeline actions (from dashboard)
  const actionsQuery = useQuery({
    queryKey: ['dashboard', 'actions', orgId],
    queryFn: () => fetchActions(orgId),
    staleTime: 30_000,
    enabled: !!orgId,
  });

  // Status change notifications (recent)
  const statusChangesQuery = useQuery({
    queryKey: ['my-day-status-changes', orgId, today],
    queryFn: async () => {
      const res = await fetch(`/api/audit-logs?action=patient_status_change&limit=10&date_from=${today}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data ?? []) as Array<{
        id: string;
        target_id: string;
        changes: {
          patient_name: string;
          from: PatientStatusIcon;
          from_label: string;
          to: PatientStatusIcon;
          to_label: string;
        };
        created_at: string;
      }>;
    },
    enabled: !!orgId,
  });

  const todayVisits = visitsQuery.data?.data ?? [];
  const pendingTasks = (tasksQuery.data?.data ?? []).filter(
    (t) => t.status === 'pending' || t.status === 'in_progress'
  );
  const pipeline = actionsQuery.data?.pipeline ?? [];
  const urgentActions = (actionsQuery.data?.actions ?? []).filter(
    (a) => a.priority === 'urgent' || a.priority === 'high'
  );
  const unpreparedVisits = todayVisits.filter((v) => !v.preparation?.prepared_at);
  const statusChanges = statusChangesQuery.data ?? [];

  const totalPipeline = pipeline.reduce((s, p) => s + p.count, 0);

  return (
    <div className="space-y-4 p-4 max-w-lg mx-auto">
      {/* Quick stats bar */}
      <div className="grid grid-cols-4 gap-2">
        <QuickStat label="訪問" value={todayVisits.length} loading={visitsQuery.isLoading} />
        <QuickStat label="タスク" value={pendingTasks.length} loading={tasksQuery.isLoading} />
        <QuickStat label="パイプライン" value={totalPipeline} loading={actionsQuery.isLoading} />
        <QuickStat label="緊急" value={urgentActions.length} loading={actionsQuery.isLoading} urgent={urgentActions.length > 0} />
      </div>

      {/* Urgent actions */}
      {urgentActions.length > 0 && (
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-red-700">
              <TriangleAlert className="size-4" aria-hidden="true" />
              緊急・高優先アクション
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {urgentActions.slice(0, 5).map((item) => (
              <Link
                key={item.id}
                href={item.action_href}
                className="flex items-center justify-between rounded-md border border-red-200 bg-white p-2.5 transition-colors hover:bg-red-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.patient_name && `${item.patient_name} / `}{item.queue_label}
                  </p>
                </div>
                <Badge variant="outline" className={PRIORITY_STYLES[item.priority] ?? ''}>
                  {item.priority === 'urgent' ? '緊急' : '高'}
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Today's visits */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Car className="size-4 text-primary" aria-hidden="true" />
            今日の訪問
            <Badge variant="secondary" className="ml-auto text-xs">
              {visitsQuery.isLoading ? '…' : `${todayVisits.length}件`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {visitsQuery.isLoading ? (
            <SectionSkeleton />
          ) : todayVisits.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">本日の訪問はありません</p>
          ) : (
            todayVisits.map((visit) => {
              const windowLabel = timeLabel(visit.time_window_start, visit.time_window_end);
              return (
                <Link
                  key={visit.id}
                  href={`/visits/${visit.id}/record`}
                  className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{visit.case_.patient.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {windowLabel} / {VISIT_TYPE_LABELS[visit.visit_type] ?? visit.visit_type}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${statusBadgeClass(visit.schedule_status)}`}
                    >
                      {SCHEDULE_STATUS_LABELS[visit.schedule_status] ?? visit.schedule_status}
                    </Badge>
                    {!visit.preparation?.prepared_at && (
                      <Badge variant="outline" className="border-orange-300 text-[10px] text-orange-600">
                        準備未
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Preparation alert */}
      {unpreparedVisits.length > 0 && (
        <Link
          href="/schedules"
          className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-medium text-orange-800 transition-colors hover:bg-orange-100"
        >
          <ClipboardList className="size-4 shrink-0" aria-hidden="true" />
          <span>訪問前準備が未完了 {unpreparedVisits.length}件</span>
          <ArrowRight className="ml-auto size-4" aria-hidden="true" />
        </Link>
      )}

      {/* Pipeline summary */}
      {pipeline.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">パイプライン</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {pipeline.filter((p) => p.count > 0).map((step) => (
                <div key={step.key} className="rounded-md border p-2 text-center">
                  <p className="text-lg font-bold text-foreground">{step.count}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{step.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending tasks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <CheckSquare className="size-4 text-primary" aria-hidden="true" />
            未完了タスク
            <Badge variant="secondary" className="ml-auto text-xs">
              {tasksQuery.isLoading ? '…' : `${pendingTasks.length}件`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {tasksQuery.isLoading ? (
            <SectionSkeleton />
          ) : pendingTasks.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">未完了のタスクはありません</p>
          ) : (
            pendingTasks.slice(0, 8).map((task) => (
              <div key={task.id} className="flex items-center justify-between rounded-lg border p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted-foreground">{task.task_type}</p>
                </div>
                <div className="ml-2 flex shrink-0 items-center gap-1">
                  {(task.priority === 'urgent' || task.priority === 'high') && (
                    <Badge
                      variant={task.priority === 'urgent' ? 'destructive' : 'secondary'}
                      className="text-[10px]"
                    >
                      {task.priority === 'urgent' ? '緊急' : '高'}
                    </Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Status changes today */}
      {statusChanges.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="size-4 text-primary" aria-hidden="true" />
              ステータス変更
              <Badge variant="secondary" className="ml-auto text-xs">
                {statusChanges.length}件
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {statusChanges.map((change) => {
              const toCfg = STATUS_ICON_CONFIG[change.changes.to] ?? STATUS_ICON_CONFIG.stable;
              const ToIcon = STATUS_ICONS[change.changes.to] ?? UserCheck;
              return (
                <Link
                  key={change.id}
                  href={`/patients/${change.target_id}`}
                  className="flex items-center gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className={`shrink-0 rounded-full p-1 ${toCfg.color} ${toCfg.bg}`}>
                    <ToIcon className="size-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{change.changes.patient_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {change.changes.from_label} → {change.changes.to_label}
                    </p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          href="/"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          ダッシュボード
        </Link>
        <Link
          href="/schedules"
          className="flex items-center justify-center gap-1.5 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
        >
          スケジュール
        </Link>
      </div>
    </div>
  );
}

function QuickStat({
  label,
  value,
  loading,
  urgent,
}: {
  label: string;
  value: number;
  loading: boolean;
  urgent?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-2.5 text-center ${urgent ? 'border-red-200 bg-red-50' : ''}`}>
      <p className={`text-xl font-bold ${urgent ? 'text-red-600' : 'text-foreground'}`}>
        {loading ? '…' : value}
      </p>
      <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
