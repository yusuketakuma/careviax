'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  PhoneCall,
  RefreshCw,
  Route,
  Shuffle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { ScheduleMetricCard } from './schedule-metric-card';
import {
  addressOfPatient,
  CONTACT_STATUS_LABELS,
  countCompletedPreparationItems,
  formatTaskDueLabel,
  PREPARATION_ITEMS,
  PRIORITY_LABELS,
  priorityBadgeClass,
  readImpactCount,
  PROPOSAL_STATUS_LABELS,
  SCHEDULE_STATUS_LABELS,
  SCHEDULING_TASK_TYPES,
  statusBadgeClass,
  TASK_TYPE_LABELS,
  taskPriorityClass,
  timeLabel,
  toDateKey,
  type CaseOption,
  type Pharmacist,
  type Proposal,
  type ScheduleTask,
  type ScheduleTaskStatus,
  type VisitPreparation,
  type VisitPreparationPack,
  type VisitPriority,
  type VisitSchedule,
  type VisitType,
  VISIT_TYPE_LABELS,
} from './day-view.shared';

export function ScheduleDayView() {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(() =>
    format(new Date(), 'yyyy-MM-dd')
  );
  const [plannerForm, setPlannerForm] = useState({
    case_id: '',
    visit_type: 'regular' as VisitType,
    priority: 'normal' as VisitPriority,
    start_date: format(new Date(), 'yyyy-MM-dd'),
    preferred_time_from: '09:00',
    preferred_time_to: '12:00',
    candidate_count: '3',
  });
  const [rescheduleTarget, setRescheduleTarget] = useState<VisitSchedule | null>(null);
  const [rescheduleForm, setRescheduleForm] = useState({
    reason: '',
    start_date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
    priority: 'normal' as VisitPriority,
  });
  const [contactLogTarget, setContactLogTarget] = useState<Proposal | null>(null);
  const [contactLogForm, setContactLogForm] = useState({
    outcome: 'attempted' as 'attempted' | 'unreachable' | 'declined' | 'confirmed',
    contact_name: '',
    contact_phone: '',
    note: '',
    callback_due_at: '',
  });
  const [preparationTarget, setPreparationTarget] = useState<VisitSchedule | null>(null);
  const [preparationDetails, setPreparationDetails] = useState<{
    preparation: VisitPreparation | null;
    pack: VisitPreparationPack | null;
  } | null>(null);
  const [preparationLoading, setPreparationLoading] = useState(false);
  const [preparationForm, setPreparationForm] = useState({
    medication_changes_reviewed: false,
    carry_items_confirmed: false,
    previous_issues_reviewed: false,
    route_confirmed: false,
    offline_synced: false,
  });
  const preparationRequestIdRef = useRef<string | null>(null);

  const selectedDay = useMemo(() => parseISO(selectedDate), [selectedDate]);
  const weekStart = useMemo(
    () => startOfWeek(selectedDay, { weekStartsOn: 1 }),
    [selectedDay]
  );
  const weekEnd = useMemo(
    () => endOfWeek(selectedDay, { weekStartsOn: 1 }),
    [selectedDay]
  );
  const visibleDays = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekEnd, weekStart]
  );

  const { data: casesData, isLoading: casesLoading } = useQuery({
    queryKey: ['cases', 'schedule-planner', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      const res = await fetch(`/api/cases?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('ケースの取得に失敗しました');
      return res.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId,
  });

  const { data: pharmacistsData } = useQuery({
    queryKey: ['pharmacists', orgId, 'schedule-board'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{ data: Pharmacist[] }>;
    },
    enabled: !!orgId,
  });

  const { data: proposalsData, isLoading: proposalsLoading } = useQuery({
    queryKey: [
      'visit-schedule-proposals',
      orgId,
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: format(weekStart, 'yyyy-MM-dd'),
        date_to: format(weekEnd, 'yyyy-MM-dd'),
      });
      const res = await fetch(`/api/visit-schedule-proposals?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問候補の取得に失敗しました');
      return res.json() as Promise<{ data: Proposal[] }>;
    },
    enabled: !!orgId,
  });

  const { data: schedulesData, isLoading: schedulesLoading } = useQuery({
    queryKey: [
      'visit-schedules',
      'week-board',
      orgId,
      format(weekStart, 'yyyy-MM-dd'),
      format(weekEnd, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: format(weekStart, 'yyyy-MM-dd'),
        date_to: format(weekEnd, 'yyyy-MM-dd'),
        limit: '200',
      });
      const res = await fetch(`/api/visit-schedules?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('訪問予定の取得に失敗しました');
      return res.json() as Promise<{ data: VisitSchedule[] }>;
    },
    enabled: !!orgId,
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'schedule-board', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'pending' });
      const res = await fetch(`/api/tasks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('運用タスクの取得に失敗しました');
      return res.json() as Promise<{ data: ScheduleTask[] }>;
    },
    enabled: !!orgId,
  });

  const { data: callbackTasksData, isLoading: callbackTasksLoading } = useQuery({
    queryKey: ['tasks', 'visit-contact-followup', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({
        task_type: 'visit_contact_followup',
      });
      const res = await fetch(`/api/tasks?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('再架電タスクの取得に失敗しました');
      return res.json() as Promise<{ data: ScheduleTask[] }>;
    },
    enabled: !!orgId,
  });

  const cases = useMemo(
    () =>
      (casesData?.data ?? []).filter(
        (careCase) => !['discharged', 'terminated'].includes(careCase.status)
      ),
    [casesData]
  );
  const pharmacists = useMemo(() => pharmacistsData?.data ?? [], [pharmacistsData]);
  const proposals = useMemo(() => proposalsData?.data ?? [], [proposalsData]);
  const schedules = useMemo(() => schedulesData?.data ?? [], [schedulesData]);
  const tasks = useMemo(() => tasksData?.data ?? [], [tasksData]);
  const callbackTasks = useMemo(
    () =>
      (callbackTasksData?.data ?? []).filter((task) =>
        ['pending', 'in_progress'].includes(task.status)
      ),
    [callbackTasksData]
  );
  const resolvedPlannerCaseId = plannerForm.case_id || cases[0]?.id || '';
  const selectedCase =
    cases.find((careCase) => careCase.id === resolvedPlannerCaseId) ?? null;
  const pharmacistNameById = useMemo(
    () => new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.name])),
    [pharmacists]
  );
  const proposalById = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal])),
    [proposals]
  );
  const scheduleById = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.id, schedule])),
    [schedules]
  );
  const schedulingTasks = useMemo(
    () =>
      tasks
        .filter(
          (task) =>
            SCHEDULING_TASK_TYPES.has(task.task_type) &&
            task.task_type !== 'visit_contact_followup'
        )
        .slice(0, 6),
    [tasks]
  );

  const weekProposalStats = useMemo(() => {
    return {
      approvalPending: proposals.filter((proposal) =>
        ['proposed', 'reschedule_pending'].includes(proposal.proposal_status)
      ).length,
      contactPending: proposals.filter(
        (proposal) => proposal.proposal_status === 'patient_contact_pending'
      ).length,
      confirmedSchedules: schedules.filter((schedule) => schedule.confirmed_at).length,
      lockedSchedules: schedules.filter((schedule) => Boolean(schedule.confirmed_at)).length,
      pendingOverrides: schedules.filter(
        (schedule) => schedule.override_request?.status === 'pending'
      ).length,
      emergencyImpacts:
        proposals.filter((proposal) => proposal.priority === 'emergency').length +
        schedules.filter((schedule) => schedule.priority === 'emergency').length,
      fallbackAssignments:
        proposals.filter((proposal) => proposal.assignment_mode === 'fallback').length +
        schedules.filter((schedule) => schedule.assignment_mode === 'fallback').length,
    };
  }, [proposals, schedules]);

  function splitTrace(reason: string) {
    return reason
      .split(' / ')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  function scheduleLockText(schedule: VisitSchedule) {
    if (schedule.override_request?.status === 'pending') {
      return {
        label: '変更承認待ち',
        className: 'border-amber-200 bg-amber-50 text-amber-700',
        detail: schedule.override_request.reason,
      };
    }
    if (schedule.confirmed_at) {
      return {
        label: '運用ロック',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        detail: '確定後は原則変更せず、専用リスケのみ許可します',
      };
    }
    if (schedule.applied_override) {
      return {
        label: '再調整済み',
        className: 'border-orange-200 bg-orange-50 text-orange-700',
        detail: '確定済み訪問の変更から再構成されています',
      };
    }
    return {
      label: '変更可能',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
      detail: '未確定のため調整可能です',
    };
  }

  function proposalLockText(proposal: Proposal) {
    if (proposal.proposal_status === 'confirmed' || proposal.finalized_schedule_id) {
      return {
        label: '確定済み',
        className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      };
    }
    if (proposal.proposal_status === 'patient_contact_pending') {
      return {
        label: '電話待ち',
        className: 'border-sky-200 bg-sky-50 text-sky-700',
      };
    }
    if (proposal.proposal_status === 'reschedule_pending') {
      return {
        label: '再調整中',
        className: 'border-orange-200 bg-orange-50 text-orange-700',
      };
    }
    return {
      label: '提案中',
      className: 'border-slate-200 bg-slate-50 text-slate-600',
    };
  }

  const selectedDateProposals = proposals
    .filter((proposal) => toDateKey(proposal.proposed_date) === selectedDate)
    .sort((left, right) => {
      if (left.route_order == null && right.route_order == null) return 0;
      if (left.route_order == null) return 1;
      if (right.route_order == null) return -1;
      return left.route_order - right.route_order;
    });
  const selectedDateSchedules = schedules
    .filter((schedule) => toDateKey(schedule.scheduled_date) === selectedDate)
    .sort((left, right) => {
      const leftTime = left.time_window_start ?? '';
      const rightTime = right.time_window_start ?? '';
      return leftTime.localeCompare(rightTime);
    });

  function openRescheduleDialog(schedule: VisitSchedule) {
    setRescheduleTarget(schedule);
    setRescheduleForm({
      reason: '',
      start_date: format(addDays(parseISO(schedule.scheduled_date), 1), 'yyyy-MM-dd'),
      priority: schedule.priority,
    });
  }

  function openContactLogDialog(proposal: Proposal) {
    setContactLogTarget(proposal);
    const latestLog = proposal.contact_logs[0] ?? null;
    setContactLogForm({
      outcome:
        proposal.patient_contact_status === 'confirmed'
          ? 'confirmed'
          : proposal.patient_contact_status === 'declined'
            ? 'declined'
            : proposal.patient_contact_status === 'unreachable'
              ? 'unreachable'
              : 'attempted',
      contact_name: latestLog?.contact_name ?? '',
      contact_phone: latestLog?.contact_phone ?? '',
      note: '',
      callback_due_at: latestLog?.callback_due_at
        ? format(parseISO(latestLog.callback_due_at), "yyyy-MM-dd'T'HH:mm")
        : '',
    });
  }

  function openPreparationDialog(schedule: VisitSchedule) {
    const initialPreparation = schedule.preparation ?? null;
    const scheduleId = schedule.id;
    preparationRequestIdRef.current = scheduleId;
    setPreparationTarget(schedule);
    setPreparationDetails({
      preparation: initialPreparation,
      pack: null,
    });
    setPreparationForm({
      medication_changes_reviewed: initialPreparation?.medication_changes_reviewed ?? false,
      carry_items_confirmed: initialPreparation?.carry_items_confirmed ?? false,
      previous_issues_reviewed: initialPreparation?.previous_issues_reviewed ?? false,
      route_confirmed: initialPreparation?.route_confirmed ?? false,
      offline_synced: initialPreparation?.offline_synced ?? false,
    });

    if (!orgId) return;

    setPreparationLoading(true);
    void fetch(`/api/visit-preparations/${scheduleId}`, {
      headers: { 'x-org-id': orgId },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('訪問準備情報の取得に失敗しました');
        return (res.json() as Promise<{
          data: {
            preparation: VisitPreparation | null;
            pack: VisitPreparationPack | null;
          };
        }>).then((payload) => payload.data);
      })
      .then((payload) => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        setPreparationDetails(payload);
        setPreparationForm({
          medication_changes_reviewed:
            payload.preparation?.medication_changes_reviewed ?? false,
          carry_items_confirmed:
            payload.preparation?.carry_items_confirmed ?? false,
          previous_issues_reviewed:
            payload.preparation?.previous_issues_reviewed ?? false,
          route_confirmed: payload.preparation?.route_confirmed ?? false,
          offline_synced: payload.preparation?.offline_synced ?? false,
        });
      })
      .catch((error) => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        toast.error(
          error instanceof Error ? error.message : '訪問準備情報の取得に失敗しました'
        );
      })
      .finally(() => {
        if (preparationRequestIdRef.current !== scheduleId) return;
        setPreparationLoading(false);
      });
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          case_id: resolvedPlannerCaseId,
          visit_type: plannerForm.visit_type,
          priority: plannerForm.priority,
          start_date: plannerForm.start_date,
          preferred_time_from: plannerForm.preferred_time_from || undefined,
          preferred_time_to: plannerForm.preferred_time_to || undefined,
          candidate_count: Number(plannerForm.candidate_count),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '候補生成に失敗しました');
      }
      return res.json() as Promise<{ data: Proposal[] }>;
    },
    onSuccess: async (data) => {
      toast.success(`${data.data.length}件の訪問候補を生成しました`);
      await queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] });
      setSelectedDate(plannerForm.start_date);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補生成に失敗しました');
    },
  });

  const proposalActionMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload:
        | { action: 'approve' }
        | { action: 'confirm' }
        | { action: 'reject' }
        | {
            action: 'contact_attempt';
            outcome: 'attempted' | 'declined' | 'unreachable' | 'confirmed';
            contact_name?: string;
            contact_phone?: string;
            note?: string;
            callback_due_at?: string;
          };
    }) => {
      const res = await fetch(`/api/visit-schedule-proposals/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '候補更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      const message =
        variables.payload.action === 'approve'
          ? '候補を承認して架電待ちへ移しました'
          : variables.payload.action === 'confirm'
            ? '電話確認が完了し、訪問予定を確定しました'
            : variables.payload.action === 'reject'
              ? '候補を却下しました'
              : variables.payload.outcome === 'declined'
                ? '患者辞退として記録しました'
              : variables.payload.outcome === 'unreachable'
                ? '不通として記録しました'
                : variables.payload.outcome === 'confirmed'
                  ? '患者確認済みとして記録しました'
                  : '架電状況を更新しました';

      toast.success(message);
      if (variables.payload.action === 'contact_attempt') {
        setContactLogTarget(null);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['tasks', 'visit-contact-followup', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補更新に失敗しました');
    },
  });

  const rescheduleApprovalMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await fetch(`/api/visit-schedules/${scheduleId}/reschedule/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'リスケ承認に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('リスケ要求を承認しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'リスケ承認に失敗しました');
    },
  });

  const callbackTaskMutation = useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: Extract<ScheduleTaskStatus, 'in_progress' | 'completed'>;
    }) => {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '再架電タスクの更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.status === 'completed'
          ? '再架電タスクを完了しました'
          : '再架電タスクを対応中にしました'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['tasks', 'visit-contact-followup', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '再架電タスクの更新に失敗しました');
    },
  });

  const preparationMutation = useMutation({
    mutationFn: async ({
      scheduleId,
      markReady,
    }: {
      scheduleId: string;
      markReady: boolean;
    }) => {
      const preparationRes = await fetch(`/api/visit-preparations/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          checklist: preparationForm,
          ...preparationForm,
        }),
      });
      if (!preparationRes.ok) {
        const error = await preparationRes.json().catch(() => ({}));
        throw new Error(error.message ?? '訪問準備の保存に失敗しました');
      }

      if (markReady) {
        const readyRes = await fetch(`/api/visit-schedules/${scheduleId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-org-id': orgId,
          },
          body: JSON.stringify({
            schedule_status: 'ready',
          }),
        });
        if (!readyRes.ok) {
          const error = await readyRes.json().catch(() => ({}));
          throw new Error(error.message ?? '訪問予定を ready に更新できませんでした');
        }
      }

      return preparationRes.json();
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.markReady
          ? '訪問準備を保存し、ready へ進めました'
          : '訪問準備を保存しました'
      );
      preparationRequestIdRef.current = null;
      setPreparationLoading(false);
      setPreparationDetails(null);
      setPreparationTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問準備の保存に失敗しました');
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!rescheduleTarget) throw new Error('リスケ対象が選択されていません');

      const res = await fetch(`/api/visit-schedules/${rescheduleTarget.id}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(rescheduleForm),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? 'リスケ候補の生成に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('リスケ候補を生成しました');
      setRescheduleTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'リスケ候補の生成に失敗しました');
    },
  });

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <ScheduleMetricCard
          title="承認待ち"
          value={weekProposalStats.approvalPending}
          description="担当者が候補を確認する必要があります"
          icon={CalendarClock}
        />
        <ScheduleMetricCard
          title="架電待ち"
          value={weekProposalStats.contactPending}
          description="患者連絡で日時を確定させる段階です"
          icon={PhoneCall}
        />
        <ScheduleMetricCard
          title="確定訪問"
          value={weekProposalStats.confirmedSchedules}
          description="電話確定済みで原則変更しない予定です"
          icon={CheckCircle2}
        />
        <ScheduleMetricCard
          title="代替割当"
          value={weekProposalStats.fallbackAssignments}
          description="担当薬剤師不在のため他薬剤師へエスカレーション"
          icon={Shuffle}
        />
        <ScheduleMetricCard
          title="変更承認待ち"
          value={weekProposalStats.pendingOverrides}
          description="確定後の変更は専用リスケで管理します"
          icon={RefreshCw}
        />
        <ScheduleMetricCard
          title="緊急影響"
          value={weekProposalStats.emergencyImpacts}
          description="緊急訪問や割込対応の影響を見える化"
          icon={AlertTriangle}
        />
        <ScheduleMetricCard
          title="確定ロック"
          value={weekProposalStats.lockedSchedules}
          description="電話確定済みで原則変更しません"
          icon={CheckCircle2}
        />
      </section>

      <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(245,248,255,1),rgba(248,250,252,1))] ring-1 ring-slate-200">
        <CardContent className="grid gap-5 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Weekly Route Board
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">
              候補生成から電話確定までを一画面で管理
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              服薬最終日より前の訪問候補を自動生成し、患者住所と既存訪問順から
              ルート効率を加味して提案します。確定後は専用のリスケジュール操作以外で
              変更しません。
            </p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">対象週</span>
              <span className="font-medium text-slate-900">
                {format(weekStart, 'M/d', { locale: ja })} - {format(weekEnd, 'M/d', { locale: ja })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">選択日</span>
              <span className="font-medium text-slate-900">
                {format(selectedDay, 'yyyy年M月d日(E)', { locale: ja })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">担当薬剤師</span>
              <span className="font-medium text-slate-900">
                {selectedCase?.primary_pharmacist_name ?? '未設定'}
              </span>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              電話で患者合意が取れた候補のみ確定できます。確定後の変更は
              リスケジュール操作で行います。
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="text-base">週間スケジュール</CardTitle>
            <CardDescription>
              候補件数と確定件数を見ながら日別に切り替えます
            </CardDescription>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setSelectedDate(format(addDays(selectedDay, -7), 'yyyy-MM-dd'))
                }
                aria-label="前週"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Input
                type="date"
                className="w-[160px]"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
              <Button
                size="icon"
                variant="outline"
                onClick={() =>
                  setSelectedDate(format(addDays(selectedDay, 7), 'yyyy-MM-dd'))
                }
                aria-label="翌週"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {visibleDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const proposalCount = proposals.filter(
                  (proposal) => toDateKey(proposal.proposed_date) === dateKey
                ).length;
                const scheduleCount = schedules.filter(
                  (schedule) => toDateKey(schedule.scheduled_date) === dateKey
                ).length;
                const isSelected = dateKey === selectedDate;

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => setSelectedDate(dateKey)}
                    className={[
                      'min-w-[92px] rounded-xl border px-3 py-2 text-left transition',
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                        : 'border-border bg-background hover:border-slate-400',
                    ].join(' ')}
                  >
                    <div className="text-xs">
                      {format(day, 'M/d(E)', { locale: ja })}
                    </div>
                    <div className="mt-1 text-[11px] opacity-80">
                      候補 {proposalCount} / 確定 {scheduleCount}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card id="planner">
            <CardHeader>
              <CardTitle className="text-base">訪問候補を生成</CardTitle>
              <CardDescription>
                システムが候補を提案し、承認後に患者へ架電します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="planner-case">対象ケース</Label>
                <Select
                  value={resolvedPlannerCaseId}
                  onValueChange={(value) =>
                    setPlannerForm((current) => ({
                      ...current,
                      case_id: value ?? current.case_id,
                    }))
                  }
                >
                  <SelectTrigger id="planner-case" className="w-full">
                    <SelectValue placeholder={casesLoading ? '読み込み中...' : 'ケースを選択'} />
                  </SelectTrigger>
                  <SelectContent>
                    {cases.map((careCase) => (
                      <SelectItem key={careCase.id} value={careCase.id}>
                        {careCase.patient.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedCase && (
                  <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">{selectedCase.patient.name}</p>
                    <p>{selectedCase.patient.residences[0]?.address ?? '住所未登録'}</p>
                    <p className="mt-1">
                      担当薬剤師: {selectedCase.primary_pharmacist_name ?? '未設定'}
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="planner-visit-type">訪問種別</Label>
                  <Select
                    value={plannerForm.visit_type}
                    onValueChange={(value) =>
                      setPlannerForm((current) => ({
                        ...current,
                        visit_type: (value as VisitType | null) ?? current.visit_type,
                      }))
                    }
                  >
                    <SelectTrigger id="planner-visit-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(VISIT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="planner-priority">優先度</Label>
                  <Select
                    value={plannerForm.priority}
                    onValueChange={(value) =>
                      setPlannerForm((current) => ({
                        ...current,
                        priority: (value as VisitPriority | null) ?? current.priority,
                      }))
                    }
                  >
                    <SelectTrigger id="planner-priority" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="planner-start-date">訪問起点日</Label>
                  <Input
                    id="planner-start-date"
                    type="date"
                    value={plannerForm.start_date}
                    onChange={(event) =>
                      setPlannerForm((current) => ({
                        ...current,
                        start_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="planner-candidate-count">候補数</Label>
                  <Select
                    value={plannerForm.candidate_count}
                    onValueChange={(value) =>
                      setPlannerForm((current) => ({
                        ...current,
                        candidate_count: value ?? current.candidate_count,
                      }))
                    }
                  >
                    <SelectTrigger id="planner-candidate-count" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2件</SelectItem>
                      <SelectItem value="3">3件</SelectItem>
                      <SelectItem value="4">4件</SelectItem>
                      <SelectItem value="5">5件</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="planner-time-from">希望開始時刻</Label>
                  <Input
                    id="planner-time-from"
                    type="time"
                    value={plannerForm.preferred_time_from}
                    onChange={(event) =>
                      setPlannerForm((current) => ({
                        ...current,
                        preferred_time_from: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="planner-time-to">希望終了時刻</Label>
                  <Input
                    id="planner-time-to"
                    type="time"
                    value={plannerForm.preferred_time_to}
                    onChange={(event) =>
                      setPlannerForm((current) => ({
                        ...current,
                        preferred_time_to: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <Button
                className="w-full"
                onClick={() => generateMutation.mutate()}
                disabled={!resolvedPlannerCaseId || generateMutation.isPending}
              >
                {generateMutation.isPending ? '候補生成中...' : '訪問候補を生成'}
              </Button>

              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
                ルート候補は患者住所と既存訪問の順番から算出します。担当薬剤師に勤務枠が
                ない場合のみ、別薬剤師へ自動エスカレーションします。
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">運用タスク</CardTitle>
              <CardDescription>
                スケジュールに影響する未完了タスクを優先順で表示します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {callbackTasksLoading ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  再架電タスクを読み込んでいます...
                </div>
              ) : callbackTasks.length > 0 ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2 text-xs text-sky-900">
                    架電結果の再記録や折返し対応が必要な候補です。
                  </div>
                  {callbackTasks.map((task) => {
                    const relatedProposal = task.related_entity_id
                      ? proposalById.get(task.related_entity_id) ?? null
                      : null;

                    return (
                      <div
                        key={task.id}
                        className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{task.title}</p>
                              <Badge variant="outline">
                                {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={taskPriorityClass(task.priority)}
                              >
                                {task.priority}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              期限 {formatTaskDueLabel(task)}
                              {task.assigned_to
                                ? ` / 担当 ${pharmacistNameById.get(task.assigned_to) ?? '未登録'}`
                                : ''}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              task.status === 'in_progress'
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }
                          >
                            {task.status === 'in_progress' ? '対応中' : '未着手'}
                          </Badge>
                        </div>

                        {(relatedProposal || task.description) && (
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {relatedProposal ? (
                              <p>
                                {relatedProposal.case_.patient.name} /{' '}
                                {format(parseISO(relatedProposal.proposed_date), 'M/d', {
                                  locale: ja,
                                })}{' '}
                                {timeLabel(
                                  relatedProposal.time_window_start,
                                  relatedProposal.time_window_end
                                )}
                              </p>
                            ) : (
                              <p>対象候補は現在の表示週外です。</p>
                            )}
                            {task.description && <p className="leading-5">{task.description}</p>}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          {relatedProposal && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedDate(toDateKey(relatedProposal.proposed_date));
                                openContactLogDialog(relatedProposal);
                                if (task.status === 'pending') {
                                  callbackTaskMutation.mutate({
                                    id: task.id,
                                    status: 'in_progress',
                                  });
                                }
                              }}
                              disabled={callbackTaskMutation.isPending}
                            >
                              架電結果を記録
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              callbackTaskMutation.mutate({
                                id: task.id,
                                status: 'in_progress',
                              })
                            }
                            disabled={
                              callbackTaskMutation.isPending || task.status === 'in_progress'
                            }
                          >
                            対応中にする
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              callbackTaskMutation.mutate({
                                id: task.id,
                                status: 'completed',
                              })
                            }
                            disabled={callbackTaskMutation.isPending}
                          >
                            完了
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {tasksLoading ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  運用タスクを読み込んでいます...
                </div>
              ) : schedulingTasks.length === 0 ? (
                callbackTasks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                    スケジュール関連の未完了タスクはありません
                  </div>
                ) : null
              ) : (
                schedulingTasks.map((task) => {
                  const relatedSchedule =
                    task.related_entity_type === 'visit_schedule' && task.related_entity_id
                      ? scheduleById.get(task.related_entity_id) ?? null
                      : null;
                  const canApproveOverride =
                    task.task_type === 'visit_schedule_override_approval' &&
                    task.related_entity_id;
                  const canOpenPreparation =
                    task.task_type === 'visit_preparation' && relatedSchedule;

                  return (
                    <div
                      key={task.id}
                      className="space-y-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{task.title}</p>
                            <Badge variant="outline">
                              {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={taskPriorityClass(task.priority)}
                            >
                              {task.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            期限 {formatTaskDueLabel(task)}
                            {task.assigned_to
                              ? ` / 担当 ${pharmacistNameById.get(task.assigned_to) ?? '未登録'}`
                              : ''}
                          </p>
                        </div>
                      </div>

                      {(relatedSchedule || task.description) && (
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {relatedSchedule && (
                            <p>
                              {relatedSchedule.case_.patient.name} /{' '}
                              {format(parseISO(relatedSchedule.scheduled_date), 'M/d', {
                                locale: ja,
                              })}{' '}
                              {timeLabel(
                                relatedSchedule.time_window_start,
                                relatedSchedule.time_window_end
                              )}
                            </p>
                          )}
                          {task.description && (
                            <p className="leading-5">{task.description}</p>
                          )}
                        </div>
                      )}

                      {(canApproveOverride || canOpenPreparation) && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {canOpenPreparation && relatedSchedule && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openPreparationDialog(relatedSchedule)}
                            >
                              準備チェック
                            </Button>
                          )}
                          {canApproveOverride && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const scheduleId = task.related_entity_id;
                                if (!scheduleId) return;
                                rescheduleApprovalMutation.mutate(scheduleId);
                              }}
                              disabled={rescheduleApprovalMutation.isPending}
                            >
                              変更承認
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">関連管理</CardTitle>
              <CardDescription>
                ケース担当・シフト・休日設定は管理画面で更新します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/admin/shifts"
                className="flex items-center justify-between rounded-xl border px-3 py-3 transition hover:bg-muted/30"
              >
                <div>
                  <p className="font-medium text-foreground">薬剤師・シフト管理</p>
                  <p className="text-xs text-muted-foreground">
                    薬剤師登録、休日登録、月間シフト編集
                  </p>
                </div>
                <Route className="size-4 text-muted-foreground" />
              </Link>
              <Link
                href={`/patients/${selectedCase?.patient.id ?? ''}`}
                className={[
                  'flex items-center justify-between rounded-xl border px-3 py-3 transition',
                  selectedCase ? 'hover:bg-muted/30' : 'pointer-events-none opacity-50',
                ].join(' ')}
              >
                <div>
                  <p className="font-medium text-foreground">担当薬剤師の割当</p>
                  <p className="text-xs text-muted-foreground">
                    患者ケースで主担当薬剤師を設定します
                  </p>
                </div>
                <Shuffle className="size-4 text-muted-foreground" />
              </Link>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="proposals">
          <TabsList variant="line" className="mb-4">
            <TabsTrigger value="proposals">
              候補一覧
              <Badge variant="outline" className="ml-1.5">
                {selectedDateProposals.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="confirmed">
              確定予定
              <Badge variant="outline" className="ml-1.5">
                {selectedDateSchedules.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="proposals" className="space-y-4">
            {proposalsLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  訪問候補を読み込んでいます...
                </CardContent>
              </Card>
            ) : selectedDateProposals.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  {format(selectedDay, 'M月d日(E)', { locale: ja })} の候補はありません
                </CardContent>
              </Card>
            ) : (
              selectedDateProposals.map((proposal) => {
                const pharmacistName =
                  proposal.proposed_pharmacist?.name ??
                  pharmacistNameById.get(proposal.proposed_pharmacist_id) ??
                  '薬剤師未登録';
                const canApprove = ['proposed', 'reschedule_pending'].includes(
                  proposal.proposal_status
                );
                const canCall = proposal.proposal_status === 'patient_contact_pending';
                const canConfirm = canCall && proposal.patient_contact_status === 'confirmed';
                const impactCount = readImpactCount(
                  proposal.reschedule_source_schedule?.override_request?.impact_summary
                );

                return (
                  <Card key={proposal.id} className="overflow-hidden">
                    <CardContent className="space-y-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-foreground">
                              {proposal.case_.patient.name}
                            </p>
                            <Badge
                              variant="outline"
                              className={statusBadgeClass(proposal.proposal_status)}
                            >
                              {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={priorityBadgeClass(proposal.priority)}
                            >
                              {PRIORITY_LABELS[proposal.priority]}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={
                                proposal.assignment_mode === 'fallback'
                                  ? 'border-orange-200 bg-orange-50 text-orange-700'
                                  : 'border-sky-200 bg-sky-50 text-sky-700'
                              }
                            >
                              {proposal.assignment_mode === 'fallback'
                                ? '代替薬剤師'
                                : '担当薬剤師'}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={proposalLockText(proposal).className}
                            >
                              {proposalLockText(proposal).label}
                            </Badge>
                            {impactCount != null && impactCount > 0 && (
                              <Badge
                                variant="outline"
                                className="border-amber-200 bg-amber-50 text-amber-700"
                              >
                                影響 {impactCount} 件
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                            <span>{VISIT_TYPE_LABELS[proposal.visit_type]}</span>
                            <span>{timeLabel(proposal.time_window_start, proposal.time_window_end)}</span>
                            <span>架電状態: {CONTACT_STATUS_LABELS[proposal.patient_contact_status]}</span>
                          </div>
                        </div>
                        <div className="text-right text-sm">
                          <p className="font-medium text-foreground">{pharmacistName}</p>
                          <p className="text-muted-foreground">
                            {proposal.site?.name ?? '拠点未設定'}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 rounded-2xl bg-muted/30 p-4 lg:grid-cols-2">
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">患者住所</p>
                          <p className="text-foreground">{addressOfPatient(proposal)}</p>
                        </div>
                        <div className="grid gap-1 text-sm sm:grid-cols-2">
                          <div>
                            <p className="text-muted-foreground">服薬最終日</p>
                            <p className="text-foreground">
                              {proposal.medication_end_date
                                ? format(parseISO(proposal.medication_end_date), 'yyyy/MM/dd', { locale: ja })
                                : '未計算'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">訪問期限</p>
                            <p className="text-foreground">
                              {proposal.visit_deadline_date
                                ? format(parseISO(proposal.visit_deadline_date), 'yyyy/MM/dd', { locale: ja })
                                : '未設定'}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">ルート順</p>
                            <p className="text-foreground">{proposal.route_order ?? '未設定'}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">移動スコア</p>
                            <p className="text-foreground">
                              {proposal.route_distance_score?.toFixed(1) ?? '0.0'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 text-sm">
                        <p className="font-medium text-foreground">提案理由</p>
                        <div className="flex flex-wrap gap-2">
                          {splitTrace(proposal.proposal_reason).map((part) => (
                            <span
                              key={part}
                              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700"
                            >
                              {part}
                            </span>
                          ))}
                        </div>
                        {proposal.escalation_reason && (
                          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-800">
                            {proposal.escalation_reason}
                          </p>
                        )}
                      </div>

                      {proposal.contact_logs.length > 0 && (
                        <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                          <p className="text-sm font-medium text-foreground">架電ログ</p>
                          <div className="space-y-2 text-sm">
                            {proposal.contact_logs.map((log) => (
                              <div
                                key={log.id}
                                className="rounded-lg border border-border/60 bg-background px-3 py-2"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-medium text-foreground">
                                    {CONTACT_STATUS_LABELS[log.outcome]}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {format(parseISO(log.called_at), 'yyyy/MM/dd HH:mm', {
                                      locale: ja,
                                    })}
                                  </span>
                                </div>
                                {(log.contact_name || log.contact_phone) && (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {log.contact_name ?? '連絡先未記録'}
                                    {log.contact_phone ? ` / ${log.contact_phone}` : ''}
                                  </p>
                                )}
                                {log.note && (
                                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                    {log.note}
                                  </p>
                                )}
                                {log.callback_due_at && (
                                  <p className="mt-1 text-xs text-amber-700">
                                    折返し予定:{' '}
                                    {format(parseISO(log.callback_due_at), 'yyyy/MM/dd HH:mm', {
                                      locale: ja,
                                    })}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        {proposal.proposal_status === 'reschedule_pending' &&
                          proposal.reschedule_source_schedule_id && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                rescheduleApprovalMutation.mutate(
                                  proposal.reschedule_source_schedule_id as string
                                )
                              }
                              disabled={rescheduleApprovalMutation.isPending}
                            >
                              変更承認
                            </Button>
                          )}
                        {canApprove && (
                          <Button
                            size="sm"
                            onClick={() =>
                              proposalActionMutation.mutate({
                                id: proposal.id,
                                payload: { action: 'approve' },
                              })
                            }
                            disabled={
                              proposalActionMutation.isPending ||
                              rescheduleApprovalMutation.isPending
                            }
                          >
                            承認して架電へ
                          </Button>
                        )}
                        {canCall && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openContactLogDialog(proposal)}
                              disabled={proposalActionMutation.isPending}
                            >
                              架電結果を記録
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                proposalActionMutation.mutate({
                                  id: proposal.id,
                                  payload: {
                                    action: 'contact_attempt',
                                    outcome: 'declined',
                                  },
                                })
                              }
                              disabled={proposalActionMutation.isPending}
                            >
                              辞退
                            </Button>
                            <Button
                              size="sm"
                              onClick={() =>
                                proposalActionMutation.mutate({
                                  id: proposal.id,
                                  payload: { action: 'confirm' },
                                })
                              }
                              disabled={!canConfirm || proposalActionMutation.isPending}
                            >
                              日時確定
                            </Button>
                          </>
                        )}
                        {proposal.proposal_status === 'confirmed' && proposal.finalized_schedule && (
                          <Link
                            href={`/visits/${proposal.finalized_schedule.id}/record`}
                            className="inline-flex h-8 items-center rounded-lg border px-3 text-sm text-foreground hover:bg-muted/30"
                          >
                            確定予定を開く
                          </Link>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="confirmed" className="space-y-4">
            {schedulesLoading ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  確定予定を読み込んでいます...
                </CardContent>
              </Card>
            ) : selectedDateSchedules.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  {format(selectedDay, 'M月d日(E)', { locale: ja })} の確定予定はありません
                </CardContent>
              </Card>
            ) : (
              selectedDateSchedules.map((schedule) => (
                <Card key={schedule.id} className="overflow-hidden">
                  <CardContent className="space-y-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-foreground">
                            {schedule.case_.patient.name}
                          </p>
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(schedule.schedule_status)}
                          >
                            {SCHEDULE_STATUS_LABELS[schedule.schedule_status]}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={priorityBadgeClass(schedule.priority)}
                          >
                            {PRIORITY_LABELS[schedule.priority]}
                          </Badge>
                          {schedule.confirmed_at && (
                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-emerald-700"
                            >
                              電話確定済み
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={scheduleLockText(schedule).className}
                          >
                            {scheduleLockText(schedule).label}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={
                              schedule.preparation?.prepared_at
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : 'border-amber-200 bg-amber-50 text-amber-700'
                            }
                          >
                            {schedule.preparation?.prepared_at
                              ? `準備完了 ${countCompletedPreparationItems(schedule.preparation)}/5`
                              : `準備 ${countCompletedPreparationItems(schedule.preparation)}/5`}
                          </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          <span>{VISIT_TYPE_LABELS[schedule.visit_type]}</span>
                          <span>{timeLabel(schedule.time_window_start, schedule.time_window_end)}</span>
                          <span>ルート順 {schedule.route_order ?? '未設定'}</span>
                          <span>当日担当 {schedule.workload_hint.daily_visit_count}件</span>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium text-foreground">
                          {pharmacistNameById.get(schedule.pharmacist_id) ?? '薬剤師未登録'}
                        </p>
                        <p className="text-muted-foreground">
                          {schedule.site?.name ?? '拠点未設定'}
                        </p>
                      </div>
                    </div>

                      <div className="grid gap-3 rounded-2xl bg-muted/30 p-4 lg:grid-cols-2">
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">患者住所</p>
                          <p className="text-foreground">{addressOfPatient(schedule)}</p>
                        </div>
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">運用ルール</p>
                          <p className="text-foreground">
                            確定後は原則変更せず、緊急割込や担当者不在時のみリスケ候補を作成します。
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {scheduleLockText(schedule).detail}
                          </p>
                        </div>
                      </div>

                    {(schedule.facility_hint || schedule.handoff_hint) && (
                      <div className="grid gap-3 lg:grid-cols-2">
                        {schedule.facility_hint && (
                          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                            <p className="font-medium">施設モード</p>
                            <p className="mt-1 leading-6">
                              {schedule.facility_hint.label} で同日 {schedule.facility_hint.patient_count} 名を担当
                            </p>
                            <p className="mt-1 text-xs text-sky-800/80">
                              {schedule.facility_hint.patient_names.join('、')}
                            </p>
                          </div>
                        )}
                        {schedule.handoff_hint && (
                          <div className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-900">
                            <p className="font-medium">引継ぎ・例外メモ</p>
                            <p className="mt-1 leading-6">{schedule.handoff_hint.summary}</p>
                            {schedule.workload_hint.urgent_visit_count > 0 && (
                              <p className="mt-1 text-xs text-purple-800/80">
                                当日至急案件 {schedule.workload_hint.urgent_visit_count} 件
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {schedule.override_request?.status === 'pending' && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-medium">確定済み訪問の変更承認待ち</p>
                            <p className="mt-1 leading-6">
                              {schedule.override_request.reason}
                            </p>
                            {schedule.override_request.impact_summary &&
                              typeof schedule.override_request.impact_summary
                                .impacted_schedule_count === 'number' && (
                                <p className="mt-1 text-xs text-amber-800/80">
                                  影響予定:{' '}
                                  {
                                    schedule.override_request.impact_summary
                                      .impacted_schedule_count as number
                                  }
                                  件
                                </p>
                              )}
                            {schedule.override_request.impact_summary &&
                              typeof schedule.override_request.impact_summary
                                .proposed_replacements === 'number' && (
                                <p className="mt-1 text-xs text-amber-800/80">
                                  再提案候補:{' '}
                                  {
                                    schedule.override_request.impact_summary
                                      .proposed_replacements as number
                                  }
                                  件
                                </p>
                              )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rescheduleApprovalMutation.mutate(schedule.id)}
                            disabled={rescheduleApprovalMutation.isPending}
                          >
                            変更承認
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-foreground">訪問準備</p>
                        <span className="text-xs text-muted-foreground">
                          {countCompletedPreparationItems(schedule.preparation)}/
                          {PREPARATION_ITEMS.length} 完了
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {PREPARATION_ITEMS.map(([field, label]) => (
                          <div
                            key={field}
                            className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2"
                          >
                            <div
                              className={[
                                'size-2 rounded-full',
                                schedule.preparation?.[field]
                                  ? 'bg-emerald-500'
                                  : 'bg-slate-300',
                              ].join(' ')}
                            />
                            <span className="text-xs text-foreground">{label}</span>
                          </div>
                        ))}
                      </div>
                      {schedule.preparation?.prepared_at && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          最終更新{' '}
                          {format(parseISO(schedule.preparation.prepared_at), 'yyyy/MM/dd HH:mm', {
                            locale: ja,
                          })}
                        </p>
                      )}
                    </div>

                    {schedule.applied_override && (
                      <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
                        <p className="font-medium">例外変更履歴</p>
                        <p className="mt-1 leading-6">
                          {format(
                            parseISO(schedule.applied_override.source_schedule.scheduled_date),
                            'yyyy/MM/dd',
                            { locale: ja }
                          )}{' '}
                          {timeLabel(
                            schedule.applied_override.source_schedule.time_window_start,
                            schedule.applied_override.source_schedule.time_window_end
                          )}{' '}
                          から再調整。理由: {schedule.applied_override.reason}
                        </p>
                        <p className="mt-1 text-xs text-orange-800/80">
                          変更前担当:
                          {' '}
                          {pharmacistNameById.get(
                            schedule.applied_override.source_schedule.pharmacist_id
                          ) ?? '薬剤師未登録'}
                        </p>
                      </div>
                    )}

                    {['completed', 'cancelled', 'rescheduled'].includes(schedule.schedule_status) ? null : (
                      <div className="flex flex-wrap gap-2 border-t pt-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openPreparationDialog(schedule)}
                        >
                          訪問準備
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRescheduleDialog(schedule)}
                        >
                          リスケ候補を作る
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog
        open={rescheduleTarget !== null}
        onOpenChange={(open) => !open && setRescheduleTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>リスケジュール候補を生成</DialogTitle>
            <DialogDescription>
              緊急訪問や担当者不在などの割込時に、新しい候補を生成します。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              {rescheduleTarget && (
                <>
                  <p className="font-medium text-foreground">
                    {rescheduleTarget.case_.patient.name}
                  </p>
                  <p className="text-muted-foreground">
                    {format(parseISO(rescheduleTarget.scheduled_date), 'yyyy/MM/dd', {
                      locale: ja,
                    })}{' '}
                    {timeLabel(
                      rescheduleTarget.time_window_start,
                      rescheduleTarget.time_window_end
                    )}
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reschedule-reason">リスケ理由</Label>
              <Textarea
                id="reschedule-reason"
                value={rescheduleForm.reason}
                onChange={(event) =>
                  setRescheduleForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                placeholder="例: 緊急訪問が割り込んだため、担当薬剤師の当日訪問を再配置"
                rows={4}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-start-date">再提案開始日</Label>
                <Input
                  id="reschedule-start-date"
                  type="date"
                  value={rescheduleForm.start_date}
                  onChange={(event) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      start_date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reschedule-priority">優先度</Label>
                <Select
                  value={rescheduleForm.priority}
                  onValueChange={(value) =>
                    setRescheduleForm((current) => ({
                      ...current,
                      priority: (value as VisitPriority | null) ?? current.priority,
                    }))
                  }
                >
                  <SelectTrigger id="reschedule-priority" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRescheduleTarget(null)}
              disabled={rescheduleMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => rescheduleMutation.mutate()}
              disabled={!rescheduleForm.reason || rescheduleMutation.isPending}
            >
              {rescheduleMutation.isPending ? '生成中...' : 'リスケ候補を生成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={contactLogTarget !== null}
        onOpenChange={(open) => !open && setContactLogTarget(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>架電結果を記録</DialogTitle>
            <DialogDescription>
              患者への電話結果を残します。日時確定の前に「確認済み」を記録してください。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {contactLogTarget && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">
                  {contactLogTarget.case_.patient.name}
                </p>
                <p className="text-muted-foreground">
                  {format(parseISO(contactLogTarget.proposed_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    contactLogTarget.time_window_start,
                    contactLogTarget.time_window_end
                  )}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-outcome">架電結果</Label>
              <Select
                value={contactLogForm.outcome}
                onValueChange={(value) =>
                  value
                    ? setContactLogForm((current) => ({
                        ...current,
                        outcome: value as typeof current.outcome,
                      }))
                    : undefined
                }
              >
                <SelectTrigger id="contact-log-outcome" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="attempted">架電済み</SelectItem>
                  <SelectItem value="confirmed">患者確認済み</SelectItem>
                  <SelectItem value="unreachable">不通</SelectItem>
                  <SelectItem value="declined">辞退</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="contact-log-name">対応者名</Label>
                <Input
                  id="contact-log-name"
                  value={contactLogForm.contact_name}
                  onChange={(event) =>
                    setContactLogForm((current) => ({
                      ...current,
                      contact_name: event.target.value,
                    }))
                  }
                  placeholder="例: 本人 / ご家族"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contact-log-phone">電話番号</Label>
                <Input
                  id="contact-log-phone"
                  value={contactLogForm.contact_phone}
                  onChange={(event) =>
                    setContactLogForm((current) => ({
                      ...current,
                      contact_phone: event.target.value,
                    }))
                  }
                  placeholder="例: 090-0000-0000"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-callback">折返し予定</Label>
              <Input
                id="contact-log-callback"
                type="datetime-local"
                value={contactLogForm.callback_due_at}
                onChange={(event) =>
                  setContactLogForm((current) => ({
                    ...current,
                    callback_due_at: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contact-log-note">通話メモ</Label>
              <Textarea
                id="contact-log-note"
                rows={4}
                value={contactLogForm.note}
                onChange={(event) =>
                  setContactLogForm((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                placeholder="例: 家族同席で了承。来月以降は午前帯希望。"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setContactLogTarget(null)}
              disabled={proposalActionMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              onClick={() => {
                if (!contactLogTarget) return;
                proposalActionMutation.mutate({
                  id: contactLogTarget.id,
                  payload: {
                    action: 'contact_attempt',
                    outcome: contactLogForm.outcome,
                    contact_name: contactLogForm.contact_name || undefined,
                    contact_phone: contactLogForm.contact_phone || undefined,
                    note: contactLogForm.note || undefined,
                    callback_due_at: contactLogForm.callback_due_at
                      ? new Date(contactLogForm.callback_due_at).toISOString()
                      : undefined,
                  },
                });
              }}
              disabled={proposalActionMutation.isPending}
            >
              {proposalActionMutation.isPending ? '保存中...' : '架電結果を保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={preparationTarget !== null}
        onOpenChange={(open) => {
          if (open) return;
          preparationRequestIdRef.current = null;
          setPreparationLoading(false);
          setPreparationDetails(null);
          setPreparationTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>訪問準備チェック</DialogTitle>
            <DialogDescription>
              ready に進む前に、訪問前チェックリストを完了させます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {preparationTarget && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">
                  {preparationTarget.case_.patient.name}
                </p>
                <p className="text-muted-foreground">
                  {format(parseISO(preparationTarget.scheduled_date), 'yyyy/MM/dd', {
                    locale: ja,
                  })}{' '}
                  {timeLabel(
                    preparationTarget.time_window_start,
                    preparationTarget.time_window_end
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {preparationLoading
                    ? '最新の訪問準備を読み込み中...'
                    : preparationDetails?.preparation?.prepared_at
                      ? `最終更新 ${format(parseISO(preparationDetails.preparation.prepared_at), 'yyyy/MM/dd HH:mm', {
                          locale: ja,
                        })}`
                      : '未保存'}
                </p>
              </div>
            )}
            {preparationDetails?.pack && (
              <div className="grid gap-3 rounded-xl border bg-muted/20 p-4">
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">Pre-Visit Pack</p>
                    <p className="text-muted-foreground">
                      {preparationDetails.pack.patient.address ?? '住所未登録'}
                    </p>
                    {preparationDetails.pack.site && (
                      <p className="text-xs text-muted-foreground">
                        拠点: {preparationDetails.pack.site.name}
                      </p>
                    )}
                    {preparationDetails.pack.handoff.summary && (
                      <p className="text-xs leading-6 text-muted-foreground">
                        {preparationDetails.pack.handoff.summary}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className="font-medium text-foreground">当日状況</p>
                    <p className="text-muted-foreground">
                      同日担当 {preparationDetails.pack.workload.same_day_visit_count} 件
                    </p>
                    <p className="text-xs text-muted-foreground">
                      施設集約 {preparationDetails.pack.facility_mode.same_day_patient_count} 名
                    </p>
                    <p className="text-xs leading-6 text-muted-foreground">
                      {preparationDetails.pack.facility_mode.same_day_patient_names.join('、')}
                    </p>
                  </div>
                </div>

                {preparationDetails.pack.readiness_blockers.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    未完了: {preparationDetails.pack.readiness_blockers.join(' / ')}
                  </div>
                )}

                {preparationDetails.pack.previous_visit && (
                  <div className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs">
                    <p className="font-medium text-foreground">前回訪問</p>
                    <p className="mt-1 text-muted-foreground">
                      {format(
                        parseISO(preparationDetails.pack.previous_visit.visit_date),
                        'yyyy/MM/dd',
                        { locale: ja }
                      )}{' '}
                      / {preparationDetails.pack.previous_visit.outcome_status}
                    </p>
                    {preparationDetails.pack.previous_visit.soap_plan && (
                      <p className="mt-1 leading-6 text-muted-foreground">
                        {preparationDetails.pack.previous_visit.soap_plan}
                      </p>
                    )}
                  </div>
                )}

                {(preparationDetails.pack.open_tasks.length > 0 ||
                  preparationDetails.pack.recent_contact_logs.length > 0 ||
                  preparationDetails.pack.care_team.length > 0) && (
                  <div className="grid gap-3 lg:grid-cols-3">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">未処理タスク</p>
                      {preparationDetails.pack.open_tasks.length === 0 ? (
                        <p className="text-xs text-muted-foreground">なし</p>
                      ) : (
                        preparationDetails.pack.open_tasks.map((task) => (
                          <div
                            key={task.id}
                            className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                          >
                            <p className="font-medium text-foreground">{task.title}</p>
                            {task.due_at && (
                              <p className="mt-1 text-muted-foreground">
                                期限 {format(parseISO(task.due_at), 'M/d HH:mm', { locale: ja })}
                              </p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">直近架電</p>
                      {preparationDetails.pack.recent_contact_logs.length === 0 ? (
                        <p className="text-xs text-muted-foreground">なし</p>
                      ) : (
                        preparationDetails.pack.recent_contact_logs.map((log) => (
                          <div
                            key={log.id}
                            className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                          >
                            <p className="font-medium text-foreground">
                              {CONTACT_STATUS_LABELS[log.outcome]}
                            </p>
                            <p className="mt-1 leading-6 text-muted-foreground">
                              {log.note ?? 'メモなし'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">連携先</p>
                      {preparationDetails.pack.care_team.length === 0 ? (
                        <p className="text-xs text-muted-foreground">登録なし</p>
                      ) : (
                        preparationDetails.pack.care_team.slice(0, 4).map((member) => (
                          <div
                            key={member.id}
                            className="rounded-lg border border-border/70 bg-background px-3 py-2 text-xs"
                          >
                            <p className="font-medium text-foreground">
                              {member.role} / {member.name}
                            </p>
                            <p className="mt-1 text-muted-foreground">
                              {member.organization_name ?? '所属未登録'}
                              {member.phone ? ` / ${member.phone}` : ''}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3">
              {PREPARATION_ITEMS.map(([field, label]) => (
                <label
                  key={field}
                  className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <Checkbox
                    checked={preparationForm[field as keyof typeof preparationForm]}
                    onCheckedChange={(checked) =>
                      setPreparationForm((current) => ({
                        ...current,
                        [field]: Boolean(checked),
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                preparationRequestIdRef.current = null;
                setPreparationLoading(false);
                setPreparationDetails(null);
                setPreparationTarget(null);
              }}
              disabled={preparationMutation.isPending}
            >
              閉じる
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: false,
                })
              }
              disabled={preparationMutation.isPending}
            >
              保存
            </Button>
            <Button
              onClick={() =>
                preparationTarget &&
                preparationMutation.mutate({
                  scheduleId: preparationTarget.id,
                  markReady: true,
                })
              }
              disabled={
                preparationMutation.isPending ||
                Object.values(preparationForm).some((value) => !value)
              }
            >
              ready に進める
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
