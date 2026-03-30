'use client';

import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addWeeks,
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfWeek,
  subWeeks,
} from 'date-fns';
import { ja } from 'date-fns/locale';
import { CalendarClock, GripVertical, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  PRIORITY_LABELS,
  PROPOSAL_STATUS_LABELS,
  type CaseOption,
  type Proposal,
  type VisitPriority,
  type VisitSchedule,
  type VisitType,
  VISIT_TYPE_LABELS,
} from '../day-view.shared';

type PharmacistShift = {
  id: string;
  user_id: string;
  site_id: string | null;
  date: string;
  available: boolean;
  available_from: string | null;
  available_to: string | null;
  user: {
    id: string;
    name: string;
    name_kana: string | null;
  };
  site: {
    id: string;
    name: string;
  } | null;
};

type WeeklyOptimizerProps = {
  initialDate?: string | null;
};

type ProposalPayload = {
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  start_date: string;
  locked_date: string;
  preferred_time_from?: string;
  preferred_time_to?: string;
  preferred_pharmacist_id: string;
  candidate_count: number;
};

type DragSchedule = {
  id: string;
  patientName: string;
  confirmedAt: string | null;
  sourceDateKey: string;
  sourcePharmacistId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
};

const EMPTY_CASES: CaseOption[] = [];
const EMPTY_SCHEDULES: VisitSchedule[] = [];
const EMPTY_PROPOSALS: Proposal[] = [];
const EMPTY_SHIFTS: PharmacistShift[] = [];

function dateKey(value: string) {
  return value.slice(0, 10);
}

function timeLabel(value: string | null | undefined) {
  if (!value) return null;
  return format(parseISO(value), 'HH:mm');
}

function shiftFitsSchedule(shift: PharmacistShift | null, schedule: DragSchedule) {
  if (!shift || !shift.available) return false;
  if (!schedule.timeWindowStart || !shift.available_from || !shift.available_to) return true;
  const scheduleStart = timeLabel(schedule.timeWindowStart);
  const scheduleEnd = timeLabel(schedule.timeWindowEnd) ?? scheduleStart;
  const shiftStart = timeLabel(shift.available_from);
  const shiftEnd = timeLabel(shift.available_to);
  if (!scheduleStart || !scheduleEnd || !shiftStart || !shiftEnd) return true;
  return scheduleStart >= shiftStart && scheduleEnd <= shiftEnd;
}

function normalizeFacilityKey(item: {
  case_: {
    patient: {
      residences: Array<{
        building_id?: string | null;
        address: string;
      }>;
    };
  };
}) {
  const residence = item.case_.patient.residences[0];
  if (!residence) return null;
  return residence.building_id ?? residence.address ?? null;
}

export function ScheduleWeeklyOptimizer({ initialDate }: WeeklyOptimizerProps) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [weekAnchor, setWeekAnchor] = useState(() =>
    initialDate ? startOfWeek(parseISO(initialDate), { weekStartsOn: 1 }) : startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [plannerSettings, setPlannerSettings] = useState({
    visit_type: 'regular' as VisitType,
    priority: 'normal' as VisitPriority,
    preferred_time_from: '09:00',
    preferred_time_to: '12:00',
  });
  const [draggingSchedule, setDraggingSchedule] = useState<DragSchedule | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const weekStart = weekAnchor;
  const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });
  const days = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekEnd, weekStart]
  );
  const dateFrom = format(weekStart, 'yyyy-MM-dd');
  const dateTo = format(weekEnd, 'yyyy-MM-dd');

  const casesQuery = useQuery({
    queryKey: ['cases', 'weekly-optimizer', orgId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'active', limit: '100' });
      const response = await fetch(`/api/cases?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ケース一覧の取得に失敗しました');
      return response.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId,
  });

  const schedulesQuery = useQuery({
    queryKey: ['visit-schedules', 'weekly-optimizer', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
        limit: '400',
      });
      const response = await fetch(`/api/visit-schedules?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('週間スケジュールの取得に失敗しました');
      return response.json() as Promise<{ data: VisitSchedule[] }>;
    },
    enabled: !!orgId,
  });

  const proposalsQuery = useQuery({
    queryKey: ['visit-schedule-proposals', 'weekly-optimizer', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
      });
      const response = await fetch(`/api/visit-schedule-proposals?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('週間候補の取得に失敗しました');
      return response.json() as Promise<{ data: Proposal[] }>;
    },
    enabled: !!orgId,
  });

  const shiftsQuery = useQuery({
    queryKey: ['pharmacist-shifts', 'weekly-optimizer', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams({
        date_from: dateFrom,
        date_to: dateTo,
      });
      const response = await fetch(`/api/pharmacist-shifts?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('薬剤師シフトの取得に失敗しました');
      return response.json() as Promise<{ data: PharmacistShift[] }>;
    },
    enabled: !!orgId,
  });

  const cases = useMemo(() => casesQuery.data?.data ?? EMPTY_CASES, [casesQuery.data]);
  const schedules = useMemo(
    () => schedulesQuery.data?.data ?? EMPTY_SCHEDULES,
    [schedulesQuery.data]
  );
  const proposals = useMemo(
    () => proposalsQuery.data?.data ?? EMPTY_PROPOSALS,
    [proposalsQuery.data]
  );
  const shifts = useMemo(() => shiftsQuery.data?.data ?? EMPTY_SHIFTS, [shiftsQuery.data]);

  const activeCase =
    cases.find((careCase) => careCase.id === selectedCaseId) ?? null;

  const pharmacists = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        siteName: string | null;
      }
    >();

    for (const shift of shifts) {
      if (!map.has(shift.user_id)) {
        map.set(shift.user_id, {
          id: shift.user_id,
          name: shift.user.name,
          siteName: shift.site?.name ?? null,
        });
      }
    }

    return Array.from(map.values()).sort((left, right) =>
      left.name.localeCompare(right.name, 'ja')
    );
  }, [shifts]);

  const shiftsByCell = useMemo(() => {
    const map = new Map<string, PharmacistShift>();
    for (const shift of shifts) {
      map.set(`${shift.user_id}:${dateKey(shift.date)}`, shift);
    }
    return map;
  }, [shifts]);

  const schedulesByCell = useMemo(() => {
    const map = new Map<string, VisitSchedule[]>();
    for (const schedule of schedules) {
      const key = `${schedule.pharmacist_id}:${dateKey(schedule.scheduled_date)}`;
      const list = map.get(key);
      if (list) {
        list.push(schedule);
      } else {
        map.set(key, [schedule]);
      }
    }

    for (const list of map.values()) {
      list.sort((left, right) => {
        const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return (left.time_window_start ?? '').localeCompare(right.time_window_start ?? '');
      });
    }

    return map;
  }, [schedules]);

  const proposalsByCell = useMemo(() => {
    const map = new Map<string, Proposal[]>();
    for (const proposal of proposals) {
      if (!['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(proposal.proposal_status)) {
        continue;
      }
      const key = `${proposal.proposed_pharmacist_id}:${dateKey(proposal.proposed_date)}`;
      const list = map.get(key);
      if (list) {
        list.push(proposal);
      } else {
        map.set(key, [proposal]);
      }
    }
    return map;
  }, [proposals]);

  const createProposalMutation = useMutation({
    mutationFn: async (payload: ProposalPayload) => {
      const response = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? '候補生成に失敗しました');
      }
      return response.json() as Promise<{ data: Proposal[] }>;
    },
    onSuccess: async (payload) => {
      toast.success(`${payload.data.length}件の候補を生成しました`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', 'weekly-optimizer', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補生成に失敗しました');
    },
  });

  const moveScheduleMutation = useMutation({
    mutationFn: async (payload: {
      scheduleId: string;
      scheduled_date: string;
      pharmacist_id: string;
      route_order: number;
    }) => {
      const response = await fetch(`/api/visit-schedules/${payload.scheduleId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          scheduled_date: payload.scheduled_date,
          pharmacist_id: payload.pharmacist_id,
          route_order: payload.route_order,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? '訪問予定の移動に失敗しました');
      }
      return response.json();
    },
    onSuccess: async () => {
      toast.success('週次ボード上で訪問予定を再配置しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'weekly-optimizer', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問予定の移動に失敗しました');
    },
  });

  const facilitySuggestions = useMemo(() => {
    const groups = new Map<
      string,
      {
        label: string;
        proposals: Proposal[];
      }
    >();

    for (const proposal of proposals) {
      if (!['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(proposal.proposal_status)) continue;
      const key = normalizeFacilityKey(proposal);
      if (!key) continue;
      const residence = proposal.case_.patient.residences[0];
      const existing = groups.get(key) ?? {
        label: residence?.building_id ?? residence?.address ?? '施設未設定',
        proposals: [],
      };
      existing.proposals.push(proposal);
      groups.set(key, existing);
    }

    return Array.from(groups.values())
      .map((group) => {
        const counts = new Map<string, number>();
        const pharmacistCounts = new Map<string, number>();
        for (const proposal of group.proposals) {
          const key = dateKey(proposal.proposed_date);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          pharmacistCounts.set(proposal.proposed_pharmacist_id, (pharmacistCounts.get(proposal.proposed_pharmacist_id) ?? 0) + 1);
        }
        if (counts.size <= 1 || group.proposals.length < 2) return null;

        const [targetDate] = [...counts.entries()].sort((left, right) => {
          if (right[1] !== left[1]) return right[1] - left[1];
          return left[0].localeCompare(right[0]);
        })[0] ?? [];
        if (!targetDate) return null;

        const [targetPharmacistId] = [...pharmacistCounts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
        const outliers = group.proposals.filter((proposal) => dateKey(proposal.proposed_date) !== targetDate);
        if (outliers.length === 0 || !targetPharmacistId) return null;

        return {
          label: group.label,
          targetDate,
          targetPharmacistId,
          outliers,
        };
      })
      .filter(
        (
          item
        ): item is {
          label: string;
          targetDate: string;
          targetPharmacistId: string;
          outliers: Proposal[];
        } => item !== null
      );
  }, [proposals]);

  const isLoading =
    casesQuery.isLoading ||
    schedulesQuery.isLoading ||
    proposalsQuery.isLoading ||
    shiftsQuery.isLoading;

  const handleGenerateForCell = (pharmacistId: string, scheduledDate: string) => {
    if (!selectedCaseId) {
      toast.error('ケースを選択してから空き枠提案を実行してください');
      return;
    }

    createProposalMutation.mutate({
      case_id: selectedCaseId,
      visit_type: plannerSettings.visit_type,
      priority: plannerSettings.priority,
      start_date: scheduledDate,
      locked_date: scheduledDate,
      preferred_time_from: plannerSettings.preferred_time_from || undefined,
      preferred_time_to: plannerSettings.preferred_time_to || undefined,
      preferred_pharmacist_id: pharmacistId,
      candidate_count: 1,
    });
  };

  const handleDrop = (pharmacistId: string, scheduledDate: string) => {
    if (!draggingSchedule) return;
    const cellKey = `${pharmacistId}:${scheduledDate}`;
    const shift = shiftsByCell.get(cellKey) ?? null;
    const targetSchedules = schedulesByCell.get(cellKey) ?? [];

    if (draggingSchedule.confirmedAt) {
      toast.error('電話確定済みの訪問予定は専用のリスケジュール操作を使ってください');
      setDraggingSchedule(null);
      setHoveredCell(null);
      return;
    }
    if (
      draggingSchedule.sourceDateKey === scheduledDate &&
      draggingSchedule.sourcePharmacistId === pharmacistId
    ) {
      setDraggingSchedule(null);
      setHoveredCell(null);
      return;
    }
    if (!shiftFitsSchedule(shift, draggingSchedule)) {
      toast.error('移動先シフトの時間帯に収まらないため再配置できません');
      setDraggingSchedule(null);
      setHoveredCell(null);
      return;
    }

    moveScheduleMutation.mutate({
      scheduleId: draggingSchedule.id,
      scheduled_date: scheduledDate,
      pharmacist_id: pharmacistId,
      route_order: targetSchedules.length + 1,
    });
    setDraggingSchedule(null);
    setHoveredCell(null);
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/95">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">週間最適化ビュー</CardTitle>
          <CardDescription>
            薬剤師 × 日のボードで、未確定予定の再配置と空き枠からの提案生成を行います。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>対象週</Label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setWeekAnchor((current) => subWeeks(current, 1))}>
                  前週
                </Button>
                <Button variant="outline" size="sm" onClick={() => setWeekAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
                  今週
                </Button>
                <Button variant="outline" size="sm" onClick={() => setWeekAnchor((current) => addWeeks(current, 1))}>
                  翌週
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-case">提案対象ケース</Label>
              <Select value={selectedCaseId} onValueChange={(value) => setSelectedCaseId(value ?? '')}>
                <SelectTrigger id="weekly-case" className="w-[22rem]">
                  <SelectValue placeholder="ケースを選択" />
                </SelectTrigger>
                <SelectContent>
                  {cases.map((careCase) => (
                    <SelectItem key={careCase.id} value={careCase.id}>
                      {careCase.patient.name}
                      {careCase.primary_pharmacist_name ? ` / 主担当 ${careCase.primary_pharmacist_name}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-visit-type">訪問種別</Label>
              <Select
                value={plannerSettings.visit_type}
                onValueChange={(value) =>
                  setPlannerSettings((current) => ({
                    ...current,
                    visit_type: value as VisitType,
                  }))
                }
              >
                <SelectTrigger id="weekly-visit-type" className="w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(VISIT_TYPE_LABELS) as VisitType[]).map((visitType) => (
                    <SelectItem key={visitType} value={visitType}>
                      {VISIT_TYPE_LABELS[visitType]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-priority">優先度</Label>
              <Select
                value={plannerSettings.priority}
                onValueChange={(value) =>
                  setPlannerSettings((current) => ({
                    ...current,
                    priority: value as VisitPriority,
                  }))
                }
              >
                <SelectTrigger id="weekly-priority" className="w-[9rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as VisitPriority[]).map((priority) => (
                    <SelectItem key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-time-from">希望枠</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="weekly-time-from"
                  type="time"
                  value={plannerSettings.preferred_time_from}
                  onChange={(event) =>
                    setPlannerSettings((current) => ({
                      ...current,
                      preferred_time_from: event.target.value,
                    }))
                  }
                  className="w-[8rem]"
                />
                <span className="text-sm text-muted-foreground">-</span>
                <Input
                  type="time"
                  value={plannerSettings.preferred_time_to}
                  onChange={(event) =>
                    setPlannerSettings((current) => ({
                      ...current,
                      preferred_time_to: event.target.value,
                    }))
                  }
                  className="w-[8rem]"
                />
              </div>
            </div>
          </div>

          {activeCase ? (
            <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">{activeCase.patient.name}</p>
              <p className="text-muted-foreground">
                主担当 {activeCase.primary_pharmacist_name ?? '未設定'} / 希望枠 {plannerSettings.preferred_time_from} - {plannerSettings.preferred_time_to}
              </p>
            </div>
          ) : null}

          {isLoading ? (
            <p className="py-8 text-sm text-muted-foreground">週間最適化ビューを読み込み中...</p>
          ) : pharmacists.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">対象週に勤務シフトがある薬剤師がいません。</p>
          ) : (
            <div className="overflow-x-auto">
              <div
                className="grid min-w-[1100px] gap-3"
                style={{ gridTemplateColumns: `220px repeat(${days.length}, minmax(170px, 1fr))` }}
              >
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  薬剤師 / 日付
                </div>
                {days.map((day) => (
                  <div key={day.toISOString()} className="rounded-xl border border-border/70 bg-muted/20 p-3">
                    <p className="text-sm font-medium text-foreground">
                      {format(day, 'M/d(E)', { locale: ja })}
                    </p>
                  </div>
                ))}

                {pharmacists.map((pharmacist) => (
                  <Fragment key={pharmacist.id}>
                    <div
                      key={`${pharmacist.id}-label`}
                      className="rounded-xl border border-border/70 bg-background p-3"
                    >
                      <p className="text-sm font-medium text-foreground">{pharmacist.name}</p>
                      <p className="text-xs text-muted-foreground">{pharmacist.siteName ?? '拠点未設定'}</p>
                    </div>
                    {days.map((day) => {
                      const dayKey = format(day, 'yyyy-MM-dd');
                      const cellKey = `${pharmacist.id}:${dayKey}`;
                      const shift = shiftsByCell.get(cellKey) ?? null;
                      const cellSchedules = schedulesByCell.get(cellKey) ?? [];
                      const cellProposals = proposalsByCell.get(cellKey) ?? [];
                      const canDrop =
                        draggingSchedule &&
                        !draggingSchedule.confirmedAt &&
                        shiftFitsSchedule(shift, draggingSchedule);

                      return (
                        <div
                          key={cellKey}
                          className={[
                            'min-h-[11rem] rounded-xl border p-3 transition-colors',
                            hoveredCell === cellKey && canDrop
                              ? 'border-primary bg-primary/5'
                              : 'border-border/70 bg-background',
                          ].join(' ')}
                          onDragOver={(event) => {
                            if (!draggingSchedule) return;
                            event.preventDefault();
                            setHoveredCell(cellKey);
                          }}
                          onDragLeave={() => {
                            if (hoveredCell === cellKey) {
                              setHoveredCell(null);
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            handleDrop(pharmacist.id, dayKey);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-foreground">
                                {shift?.site?.name ?? pharmacist.siteName ?? 'シフト未設定'}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                {shift?.available
                                  ? `${timeLabel(shift.available_from) ?? '09:00'} - ${timeLabel(shift.available_to) ?? '18:00'}`
                                  : '勤務シフトなし'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline">{cellSchedules.length}件</Badge>
                              {cellProposals.length > 0 ? (
                                <Badge variant="outline">{cellProposals.length}候補</Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            {cellSchedules.map((schedule) => (
                              <div
                                key={schedule.id}
                                draggable={!schedule.confirmed_at}
                                onDragStart={() =>
                                  setDraggingSchedule({
                                    id: schedule.id,
                                    patientName: schedule.case_.patient.name,
                                    confirmedAt: schedule.confirmed_at,
                                    sourceDateKey: dayKey,
                                    sourcePharmacistId: pharmacist.id,
                                    timeWindowStart: schedule.time_window_start,
                                    timeWindowEnd: schedule.time_window_end,
                                  })
                                }
                                onDragEnd={() => {
                                  setDraggingSchedule(null);
                                  setHoveredCell(null);
                                }}
                                className={[
                                  'rounded-xl border px-3 py-2 text-sm',
                                  schedule.confirmed_at
                                    ? 'border-border/60 bg-muted/20'
                                    : 'cursor-grab border-sky-200 bg-sky-50 active:cursor-grabbing',
                                ].join(' ')}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">
                                      {schedule.case_.patient.name}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {timeLabel(schedule.time_window_start) ?? '時間未定'}
                                      {schedule.time_window_end ? ` - ${timeLabel(schedule.time_window_end)}` : ''}
                                    </p>
                                  </div>
                                  {!schedule.confirmed_at ? (
                                    <GripVertical className="mt-0.5 size-4 text-muted-foreground" />
                                  ) : null}
                                </div>
                              </div>
                            ))}

                            {cellProposals.slice(0, 3).map((proposal) => (
                              <div key={proposal.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                                <p className="font-medium text-amber-900">{proposal.case_.patient.name}</p>
                                <p className="mt-1 text-amber-800">
                                  {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="w-full"
                              onClick={() => handleGenerateForCell(pharmacist.id, dayKey)}
                              disabled={
                                !shift?.available ||
                                !selectedCaseId ||
                                createProposalMutation.isPending
                              }
                            >
                              <CalendarClock className="mr-1.5 size-4" />
                              この枠に提案
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {facilitySuggestions.length > 0 ? (
        <Card className="border-border/70 bg-card/95">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-violet-600" />
              施設一括訪問の自動グループ化候補
            </CardTitle>
            <CardDescription>
              同一施設患者が週内で分散している候補を、同日に寄せる再提案へつなぎます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {facilitySuggestions.map((suggestion) => (
              <div key={`${suggestion.label}-${suggestion.targetDate}`} className="rounded-2xl border border-border/70 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{suggestion.label}</p>
                    <p className="text-sm text-muted-foreground">
                      集約候補日 {format(parseISO(suggestion.targetDate), 'M/d(E)', { locale: ja })} / 対象 {suggestion.outliers.length} 件
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      for (const proposal of suggestion.outliers) {
                        await createProposalMutation.mutateAsync({
                          case_id: proposal.case_id,
                          visit_type: proposal.visit_type,
                          priority: proposal.priority,
                          start_date: suggestion.targetDate,
                          locked_date: suggestion.targetDate,
                          preferred_time_from:
                            timeLabel(proposal.time_window_start) ?? plannerSettings.preferred_time_from,
                          preferred_time_to:
                            timeLabel(proposal.time_window_end) ?? plannerSettings.preferred_time_to,
                          preferred_pharmacist_id: suggestion.targetPharmacistId,
                          candidate_count: 1,
                        });
                      }
                    }}
                    disabled={createProposalMutation.isPending}
                  >
                    同日に集約提案
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestion.outliers.map((proposal) => (
                    <Badge key={proposal.id} variant="outline">
                      {proposal.case_.patient.name} / {format(parseISO(proposal.proposed_date), 'M/d', { locale: ja })}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
