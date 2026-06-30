'use client';

import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import { CalendarClock, Car, GripVertical, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { ProposalGenerationDiagnosticsCardData } from '@/components/features/visits/visit-proposal-diagnostics-card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
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
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { useReplaceSearchParams } from '@/lib/navigation/use-synced-search-params';
import { fetchVisitSchedulesWindow } from '../visit-schedule-fetch.helpers';
import type { VisitRoutePlan } from '@/types/visit-route';
import { applyMixedVisitRouteUpdates, applyVisitScheduleRouteUpdates } from '../visit-route-client';
import { useRouteOrderDraft } from '../route-order-draft';
import { mergeScheduleProposalSearchParams } from './proposal-query-state';
import {
  AUTO_VEHICLE_RESOURCE_VALUE,
  formatNullableTimeOfDay,
  formatNullableTimeRange,
  formatShortEntityIdentifier,
  formatVehicleResourceLabel,
  normalizeVehicleResourceSelectValue,
  PRIORITY_LABELS,
  PROPOSAL_STATUS_LABELS,
  toDateKey,
  type CaseOption,
  type Proposal,
  type VisitPriority,
  type VisitVehicleResourceSummary,
  type VisitScheduleBillingPreview,
  type VisitSchedule,
  type VisitType,
  VISIT_TYPE_LABELS,
} from '../day-view.shared';
import { WeeklyCellInspector } from './weekly-cell-inspector';

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
  initialCaseId?: string | null;
  initialVisitType?: string | null;
  initialPriority?: string | null;
  initialTravelMode?: string | null;
  initialPreferredTimeFrom?: string | null;
  initialPreferredTimeTo?: string | null;
  initialRoutePharmacistId?: string | null;
  initialRouteDate?: string | null;
};

type TravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

type ProposalPayload = {
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  travel_mode: TravelMode;
  start_date: string;
  locked_date: string;
  preferred_time_from?: string;
  preferred_time_to?: string;
  preferred_pharmacist_id: string;
  vehicle_resource_id?: string;
  candidate_count: number;
};

type VisitVehicleResourceOption = VisitVehicleResourceSummary & {
  available: boolean;
  site: {
    id: string;
    name: string;
  } | null;
};

type VisitVehicleResourcesResponse = {
  data: VisitVehicleResourceOption[];
  total_count?: number;
  visible_count?: number;
  hidden_count?: number;
  truncated?: boolean;
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

type RouteCellSelection = {
  pharmacistId: string;
  dateKey: string;
};

type MixedRouteItem = {
  routeId: string;
  itemType: 'schedule' | 'proposal';
  itemId: string;
  patientName: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  routeOrder: number | null;
};

type ProposalGenerationDiagnostics = ProposalGenerationDiagnosticsCardData;

const EMPTY_CASES: CaseOption[] = [];
const EMPTY_SCHEDULES: VisitSchedule[] = [];
const EMPTY_PROPOSALS: Proposal[] = [];
const EMPTY_SHIFTS: PharmacistShift[] = [];
const EMPTY_VEHICLE_RESOURCES: VisitVehicleResourceOption[] = [];

function shiftFitsSchedule(shift: PharmacistShift | null, schedule: DragSchedule) {
  if (!shift || !shift.available) return false;
  if (!schedule.timeWindowStart || !shift.available_from || !shift.available_to) return true;
  const scheduleStart = formatNullableTimeOfDay(schedule.timeWindowStart);
  const scheduleEnd = formatNullableTimeOfDay(schedule.timeWindowEnd) ?? scheduleStart;
  const shiftStart = formatNullableTimeOfDay(shift.available_from);
  const shiftEnd = formatNullableTimeOfDay(shift.available_to);
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
  return deriveFacilityLabel(residence);
}

type FacilitySuggestion = {
  label: string;
  targetDate: string;
  targetPharmacistId: string;
  outliers: Proposal[];
};

function computeFacilitySuggestions(proposals: Proposal[]): FacilitySuggestion[] {
  const groups = new Map<
    string,
    {
      label: string;
      proposals: Proposal[];
    }
  >();

  for (const proposal of proposals) {
    if (
      !['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(
        proposal.proposal_status,
      )
    )
      continue;
    const key = normalizeFacilityKey(proposal);
    if (!key) continue;
    const residence = proposal.case_.patient.residences[0];
    const existing = groups.get(key) ?? {
      label: deriveFacilityLabel(residence ?? null) ?? '施設未設定',
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
        const key = toDateKey(proposal.proposed_date);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        pharmacistCounts.set(
          proposal.proposed_pharmacist_id,
          (pharmacistCounts.get(proposal.proposed_pharmacist_id) ?? 0) + 1,
        );
      }
      if (counts.size <= 1 || group.proposals.length < 2) return null;

      const [targetDate] =
        [...counts.entries()].sort((left, right) => {
          if (right[1] !== left[1]) return right[1] - left[1];
          return left[0].localeCompare(right[0]);
        })[0] ?? [];
      if (!targetDate) return null;

      const [targetPharmacistId] =
        [...pharmacistCounts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
      const outliers = group.proposals.filter(
        (proposal) => toDateKey(proposal.proposed_date) !== targetDate,
      );
      if (outliers.length === 0 || !targetPharmacistId) return null;

      return {
        label: group.label,
        targetDate,
        targetPharmacistId,
        outliers,
      };
    })
    .filter((item): item is FacilitySuggestion => item !== null);
}

function buildRouteReorderPayloads(args: {
  draggedSchedule: DragSchedule;
  sourceSchedules: VisitSchedule[];
  targetSchedules: VisitSchedule[];
  targetPharmacistId: string;
  targetDate: string;
}) {
  const payloads: Array<{
    scheduleId: string;
    scheduled_date: string;
    pharmacist_id: string;
    route_order: number;
  }> = [];

  const sourceRemaining = args.sourceSchedules.filter(
    (schedule) => schedule.id !== args.draggedSchedule.id,
  );
  sourceRemaining.forEach((schedule, index) => {
    payloads.push({
      scheduleId: schedule.id,
      scheduled_date: toDateKey(schedule.scheduled_date),
      pharmacist_id: schedule.pharmacist_id,
      route_order: index + 1,
    });
  });

  const destinationPayloads = args.targetSchedules
    .filter((schedule) => schedule.id !== args.draggedSchedule.id)
    .map((schedule) => ({
      scheduleId: schedule.id,
      scheduled_date: toDateKey(schedule.scheduled_date),
      pharmacist_id: schedule.pharmacist_id,
      route_order: 0,
    }));
  destinationPayloads.push({
    scheduleId: args.draggedSchedule.id,
    scheduled_date: args.targetDate,
    pharmacist_id: args.targetPharmacistId,
    route_order: 0,
  });

  destinationPayloads.forEach((schedule, index) => {
    payloads.push({
      scheduleId: schedule.scheduleId,
      scheduled_date: schedule.scheduled_date,
      pharmacist_id: schedule.pharmacist_id,
      route_order: index + 1,
    });
  });

  const uniquePayloads = new Map<string, (typeof payloads)[number]>();
  for (const payload of payloads) {
    uniquePayloads.set(payload.scheduleId, payload);
  }

  return Array.from(uniquePayloads.values());
}

function compareMixedRouteItems(left: MixedRouteItem, right: MixedRouteItem) {
  const leftOrder = left.routeOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.routeOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  const leftTime = left.timeWindowStart ?? '';
  const rightTime = right.timeWindowStart ?? '';
  if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
  if (left.itemType !== right.itemType) return left.itemType === 'schedule' ? -1 : 1;
  return left.itemId.localeCompare(right.itemId);
}

function buildMixedRouteItems(args: {
  schedules: VisitSchedule[];
  proposals: Proposal[];
}): MixedRouteItem[] {
  return [
    ...args.schedules.map((schedule) => ({
      routeId: schedule.id,
      itemType: 'schedule' as const,
      itemId: schedule.id,
      patientName: schedule.case_.patient.name,
      timeWindowStart: schedule.time_window_start,
      timeWindowEnd: schedule.time_window_end,
      routeOrder: schedule.route_order,
    })),
    ...args.proposals.map((proposal) => ({
      routeId: `proposal:${proposal.id}`,
      itemType: 'proposal' as const,
      itemId: proposal.id,
      patientName: proposal.case_.patient.name,
      timeWindowStart: proposal.time_window_start,
      timeWindowEnd: proposal.time_window_end,
      routeOrder: proposal.route_order,
    })),
  ].sort(compareMixedRouteItems);
}

async function requestVisitScheduleProposal(
  orgId: string,
  payload: ProposalPayload,
): Promise<{ data: Proposal[]; diagnostics?: ProposalGenerationDiagnostics }> {
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
  return response.json() as Promise<{
    data: Proposal[];
    diagnostics?: ProposalGenerationDiagnostics;
  }>;
}

export function ScheduleWeeklyOptimizer({
  initialDate,
  initialCaseId,
  initialVisitType,
  initialPriority,
  initialTravelMode,
  initialPreferredTimeFrom,
  initialPreferredTimeTo,
  initialRoutePharmacistId,
  initialRouteDate,
}: WeeklyOptimizerProps) {
  const searchParams = useSearchParams();
  const replaceSearchParams = useReplaceSearchParams();
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [weekAnchor, setWeekAnchor] = useState(() =>
    initialDate
      ? startOfWeek(parseISO(initialDate), { weekStartsOn: 1 })
      : startOfWeek(new Date(), { weekStartsOn: 1 }),
  );
  const [selectedCaseId, setSelectedCaseId] = useState(initialCaseId ?? '');
  const [caseSearchInput, setCaseSearchInput] = useState('');
  const [plannerSettings, setPlannerSettings] = useState({
    visit_type:
      initialVisitType &&
      (Object.keys(VISIT_TYPE_LABELS) as VisitType[]).includes(initialVisitType as VisitType)
        ? (initialVisitType as VisitType)
        : ('regular' as VisitType),
    priority:
      initialPriority &&
      (Object.keys(PRIORITY_LABELS) as VisitPriority[]).includes(initialPriority as VisitPriority)
        ? (initialPriority as VisitPriority)
        : ('normal' as VisitPriority),
    travel_mode:
      initialTravelMode === 'BICYCLE' ||
      initialTravelMode === 'WALK' ||
      initialTravelMode === 'TWO_WHEELER'
        ? initialTravelMode
        : ('DRIVE' as TravelMode),
    preferred_time_from: initialPreferredTimeFrom ?? '09:00',
    preferred_time_to: initialPreferredTimeTo ?? '12:00',
    vehicle_resource_id: '',
  });
  const [draggingSchedule, setDraggingSchedule] = useState<DragSchedule | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [selectedRouteCell, setSelectedRouteCell] = useState<RouteCellSelection | null>(null);
  const [routeApplyConfirmOpen, setRouteApplyConfirmOpen] = useState(false);
  const [lastPlannerDiagnostics, setLastPlannerDiagnostics] =
    useState<ProposalGenerationDiagnostics | null>(null);
  const deferredCaseSearchInput = useDeferredValue(caseSearchInput.trim());
  const replaceOptimizerUrl = (patch: Record<string, string | null | undefined>) => {
    const next = mergeScheduleProposalSearchParams({
      params: new URLSearchParams(searchParams.toString()),
      patch: {
        workspace: 'optimizer',
        ...patch,
      },
    });
    replaceSearchParams(next);
  };

  const weekStart = weekAnchor;
  const weekEnd = endOfWeek(weekAnchor, { weekStartsOn: 1 });
  const days = useMemo(
    () => eachDayOfInterval({ start: weekStart, end: weekEnd }),
    [weekEnd, weekStart],
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
  const caseSearchQuery = useQuery({
    queryKey: ['cases', 'weekly-optimizer-search', orgId, deferredCaseSearchInput],
    queryFn: async () => {
      const params = new URLSearchParams({
        status: 'active',
        limit: '8',
        q: deferredCaseSearchInput,
      });
      const response = await fetch(`/api/cases?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('ケース候補の取得に失敗しました');
      return response.json() as Promise<{ data: CaseOption[] }>;
    },
    enabled: !!orgId && deferredCaseSearchInput.length >= 2,
  });

  const schedulesQuery = useRealtimeQuery({
    queryKey: ['visit-schedules', 'weekly-optimizer', orgId, dateFrom, dateTo],
    queryFn: async () => {
      const data = await fetchVisitSchedulesWindow<VisitSchedule>({
        orgId,
        dateFrom,
        dateTo,
      });
      return { data };
    },
    enabled: !!orgId,
    invalidateOn: ['workflow_refresh'],
  });

  const proposalsQuery = useRealtimeQuery({
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
    invalidateOn: ['workflow_refresh'],
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

  const vehicleResourcesQuery = useQuery({
    queryKey: ['visit-vehicle-resources', orgId, 'weekly-optimizer', 'available'],
    queryFn: async () => {
      const response = await fetch('/api/visit-vehicle-resources?available=true', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('社用車リソースの取得に失敗しました');
      return response.json() as Promise<VisitVehicleResourcesResponse>;
    },
    enabled: !!orgId,
  });

  const cases = useMemo(() => casesQuery.data?.data ?? EMPTY_CASES, [casesQuery.data]);
  const caseSearchResults = useMemo(
    () => caseSearchQuery.data?.data ?? EMPTY_CASES,
    [caseSearchQuery.data],
  );
  const schedules = useMemo(
    () => schedulesQuery.data?.data ?? EMPTY_SCHEDULES,
    [schedulesQuery.data],
  );
  const proposals = useMemo(
    () => proposalsQuery.data?.data ?? EMPTY_PROPOSALS,
    [proposalsQuery.data],
  );
  const shifts = useMemo(() => shiftsQuery.data?.data ?? EMPTY_SHIFTS, [shiftsQuery.data]);
  const vehicleResources = useMemo(
    () => vehicleResourcesQuery.data?.data ?? EMPTY_VEHICLE_RESOURCES,
    [vehicleResourcesQuery.data],
  );
  const vehicleResourceHiddenCount =
    vehicleResourcesQuery.data?.hidden_count ??
    Math.max(
      (vehicleResourcesQuery.data?.total_count ?? vehicleResources.length) -
        (vehicleResourcesQuery.data?.visible_count ?? vehicleResources.length),
      0,
    );
  const selectedPlannerVehicle =
    vehicleResources.find((vehicle) => vehicle.id === plannerSettings.vehicle_resource_id) ?? null;

  const activeCase =
    cases.find((careCase) => careCase.id === selectedCaseId) ??
    caseSearchResults.find((careCase) => careCase.id === selectedCaseId) ??
    null;
  const applySelectedCase = (careCase: CaseOption | null) => {
    const nextCaseId = careCase?.id ?? '';
    setSelectedCaseId(nextCaseId);
    setCaseSearchInput('');
    replaceOptimizerUrl({ optimizer_case_id: nextCaseId || null });
  };
  const { data: cadencePreview } = useQuery({
    queryKey: ['weekly-optimizer-billing-preview', orgId, selectedCaseId, dateFrom],
    queryFn: async () => {
      const params = new URLSearchParams({
        case_id: selectedCaseId,
        proposed_date: dateFrom,
      });
      const response = await fetch(`/api/visit-schedule-proposals/billing-preview?${params}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) throw new Error('算定プレビューの取得に失敗しました');
      return response.json() as Promise<VisitScheduleBillingPreview>;
    },
    enabled: !!orgId && !!selectedCaseId,
  });

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
      left.name.localeCompare(right.name, 'ja'),
    );
  }, [shifts]);
  const defaultSelectedRouteCell =
    pharmacists.length > 0 && days.length > 0
      ? {
          pharmacistId: pharmacists.some((pharmacist) => pharmacist.id === initialRoutePharmacistId)
            ? (initialRoutePharmacistId as string)
            : pharmacists[0].id,
          dateKey:
            initialRouteDate && days.some((day) => format(day, 'yyyy-MM-dd') === initialRouteDate)
              ? initialRouteDate
              : format(days[0], 'yyyy-MM-dd'),
        }
      : null;
  const effectiveSelectedRouteCell = selectedRouteCell ?? defaultSelectedRouteCell;

  const shiftsByCell = useMemo(() => {
    const map = new Map<string, PharmacistShift>();
    for (const shift of shifts) {
      map.set(`${shift.user_id}:${toDateKey(shift.date)}`, shift);
    }
    return map;
  }, [shifts]);

  const schedulesByCell = useMemo(() => {
    const map = new Map<string, VisitSchedule[]>();
    for (const schedule of schedules) {
      const key = `${schedule.pharmacist_id}:${toDateKey(schedule.scheduled_date)}`;
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
      if (
        !['proposed', 'patient_contact_pending', 'reschedule_pending'].includes(
          proposal.proposal_status,
        )
      ) {
        continue;
      }
      const key = `${proposal.proposed_pharmacist_id}:${toDateKey(proposal.proposed_date)}`;
      const list = map.get(key);
      if (list) {
        list.push(proposal);
      } else {
        map.set(key, [proposal]);
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
  }, [proposals]);

  const selectedCellSchedules = useMemo(() => {
    if (!effectiveSelectedRouteCell) return [];
    return (
      schedulesByCell.get(
        `${effectiveSelectedRouteCell.pharmacistId}:${effectiveSelectedRouteCell.dateKey}`,
      ) ?? []
    );
  }, [effectiveSelectedRouteCell, schedulesByCell]);
  const selectedCellProposals = useMemo(() => {
    if (!effectiveSelectedRouteCell) return [];
    return (
      proposalsByCell.get(
        `${effectiveSelectedRouteCell.pharmacistId}:${effectiveSelectedRouteCell.dateKey}`,
      ) ?? []
    );
  }, [effectiveSelectedRouteCell, proposalsByCell]);
  const selectedCellMixedRouteItems = useMemo(
    () =>
      buildMixedRouteItems({ schedules: selectedCellSchedules, proposals: selectedCellProposals }),
    [selectedCellProposals, selectedCellSchedules],
  );
  const currentSelectedCellOrderedIds = useMemo(
    () => selectedCellMixedRouteItems.map((item) => item.routeId),
    [selectedCellMixedRouteItems],
  );

  const routePreviewQuery = useQuery<VisitRoutePlan>({
    queryKey: [
      'weekly-optimizer-route-preview',
      orgId,
      effectiveSelectedRouteCell?.pharmacistId ?? '',
      effectiveSelectedRouteCell?.dateKey ?? '',
      plannerSettings.travel_mode,
      selectedCellSchedules.map((schedule) => schedule.id).join(','),
      selectedCellProposals.map((proposal) => proposal.id).join(','),
    ],
    queryFn: async () => {
      const response = await fetch('/api/visit-routes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': orgId,
        },
        body: JSON.stringify({
          schedule_ids: selectedCellSchedules.map((schedule) => schedule.id),
          proposal_ids: selectedCellProposals.map((proposal) => proposal.id),
          travel_mode: plannerSettings.travel_mode,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? 'ルートプレビューの取得に失敗しました');
      }
      return response.json();
    },
    enabled: Boolean(
      orgId &&
      effectiveSelectedRouteCell &&
      (selectedCellSchedules.length > 0 || selectedCellProposals.length > 0),
    ),
  });
  const selectedCellRouteDraft = useRouteOrderDraft({
    sourceKey: `${effectiveSelectedRouteCell?.pharmacistId ?? 'none'}:${effectiveSelectedRouteCell?.dateKey ?? 'none'}:${plannerSettings.travel_mode}:${routePreviewQuery.data?.orderedScheduleIds.join(',') ?? ''}:${currentSelectedCellOrderedIds.join(',')}`,
    optimizedIds: routePreviewQuery.data?.orderedScheduleIds ?? currentSelectedCellOrderedIds,
    currentIds: currentSelectedCellOrderedIds,
  });
  const selectedCellRouteItemById = useMemo(
    () => new Map(selectedCellMixedRouteItems.map((item) => [item.routeId, item])),
    [selectedCellMixedRouteItems],
  );
  const selectedCellRouteApplyRows = useMemo(
    () =>
      selectedCellRouteDraft.draftIds
        .map((routeId, index) => {
          const item = selectedCellRouteItemById.get(routeId);
          if (!item) return null;
          const currentIndex = selectedCellRouteDraft.currentIds.indexOf(routeId);
          return {
            ...item,
            currentOrder: currentIndex >= 0 ? currentIndex + 1 : null,
            nextOrder: index + 1,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null),
    [selectedCellRouteDraft.currentIds, selectedCellRouteDraft.draftIds, selectedCellRouteItemById],
  );
  const proposalGenerationCaseError = !selectedCaseId
    ? '提案対象ケースを選択してから空き枠提案を実行してください'
    : null;
  const proposalGenerationCaseErrorId = 'weekly-proposal-case-required-error';

  const createProposalMutation = useMutation({
    mutationFn: async (payload: ProposalPayload) => requestVisitScheduleProposal(orgId, payload),
    onSuccess: async (payload) => {
      setLastPlannerDiagnostics(payload.diagnostics ?? null);
      toast.success(`${payload.data.length}件の候補を生成しました`);
      if ((payload.diagnostics?.rejected.length ?? 0) > 0) {
        toast.info(`採用外 ${payload.diagnostics?.rejected.length ?? 0} 件の理由を表示しています`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['visit-schedule-proposals', 'weekly-optimizer', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '候補生成に失敗しました');
    },
  });

  const reorderSchedulesMutation = useMutation({
    mutationFn: async (
      payloads: Array<{
        scheduleId: string;
        scheduled_date: string;
        pharmacist_id: string;
        route_order: number;
      }>,
    ) => applyVisitScheduleRouteUpdates({ orgId, updates: payloads }),
    onSuccess: async () => {
      toast.success('route_order を再採番して訪問予定を再配置しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'weekly-optimizer', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '訪問予定の移動に失敗しました');
    },
  });

  const aggregateProposalsMutation = useMutation({
    mutationFn: async (suggestion: FacilitySuggestion) => {
      const results = await Promise.allSettled(
        suggestion.outliers.map((proposal) =>
          requestVisitScheduleProposal(orgId, {
            case_id: proposal.case_id,
            visit_type: proposal.visit_type,
            priority: proposal.priority,
            travel_mode: plannerSettings.travel_mode,
            start_date: suggestion.targetDate,
            locked_date: suggestion.targetDate,
            preferred_time_from:
              formatNullableTimeOfDay(proposal.time_window_start) ??
              plannerSettings.preferred_time_from,
            preferred_time_to:
              formatNullableTimeOfDay(proposal.time_window_end) ??
              plannerSettings.preferred_time_to,
            preferred_pharmacist_id: suggestion.targetPharmacistId,
            vehicle_resource_id:
              plannerSettings.vehicle_resource_id || proposal.vehicle_resource?.id || undefined,
            candidate_count: 1,
          }),
        ),
      );
      const moved: string[] = [];
      const failed: Array<{ name: string; reason: string }> = [];
      suggestion.outliers.forEach((proposal, index) => {
        const result = results[index];
        const name = proposal.case_.patient.name;
        if (result.status === 'fulfilled') {
          moved.push(name);
        } else {
          failed.push({
            name,
            reason: result.reason instanceof Error ? result.reason.message : '不明なエラー',
          });
        }
      });
      return { moved, failed };
    },
    onSuccess: async ({ moved, failed }) => {
      // partial-batch failure を黙らない: 成功/失敗を1サマリで提示し、未処理患者名を明示する。
      if (failed.length === 0) {
        toast.success(`${moved.length}件を同日へ集約提案しました`);
      } else if (moved.length === 0) {
        toast.error(
          `集約提案に失敗しました（${failed.length}件）: ${failed.map((item) => item.name).join('、')}`,
        );
      } else {
        toast.warning(
          `${moved.length}件を集約、${failed.length}件は失敗しました。未処理: ${failed
            .map((item) => item.name)
            .join('、')}`,
        );
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['visit-schedule-proposals', 'weekly-optimizer', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '集約提案に失敗しました');
    },
  });

  const facilitySuggestions = useMemo(() => computeFacilitySuggestions(proposals), [proposals]);

  const isLoading =
    casesQuery.isLoading ||
    schedulesQuery.isLoading ||
    proposalsQuery.isLoading ||
    shiftsQuery.isLoading;
  // 取得失敗を空ボード(false-empty)へ潰さない: schedules/proposals/shifts のいずれかが
  // 失敗すると週が「予定ゼロ=フリー」に化けて overbook を誘発するため、再読み込み導線つきの
  // ErrorState を出し、空き判定・cadence ロジックを silently-empty なデータで走らせない。
  const boardError = schedulesQuery.isError || proposalsQuery.isError || shiftsQuery.isError;
  const refetchBoard = () => {
    void schedulesQuery.refetch();
    void proposalsQuery.refetch();
    void shiftsQuery.refetch();
  };

  const selectedCellRoutePoints = useMemo(() => {
    const plan = routePreviewQuery.data;
    const planById = new Map(
      (plan?.stopSummaries ?? []).map((summary) => [summary.scheduleId, summary]),
    );
    const draftIndexById = new Map(
      selectedCellRouteDraft.draftIds.map((scheduleId, index) => [scheduleId, index + 1]),
    );
    return [
      ...selectedCellSchedules.map((schedule) => {
        const residence = schedule.case_.patient.residences[0];
        if (residence?.lat == null || residence.lng == null) return null;
        const summary = planById.get(schedule.id);
        return {
          scheduleId: schedule.id,
          patientName: schedule.case_.patient.name,
          address: residence.address,
          lat: residence.lat,
          lng: residence.lng,
          orderLabel: String(draftIndexById.get(schedule.id) ?? '•'),
          status: schedule.schedule_status,
          priority: schedule.priority,
          pointKind: 'schedule' as const,
          timeLabel: formatNullableTimeRange(schedule.time_window_start, schedule.time_window_end),
          etaLabel:
            !selectedCellRouteDraft.manualDirty && summary?.arrivalOffsetSeconds != null
              ? `${Math.round(summary.arrivalOffsetSeconds / 60)}分`
              : null,
        };
      }),
      ...selectedCellProposals.map((proposal) => {
        const residence = proposal.case_.patient.residences[0];
        if (residence?.lat == null || residence.lng == null) return null;
        const routeId = `proposal:${proposal.id}`;
        const summary = planById.get(routeId);
        return {
          scheduleId: routeId,
          patientName: proposal.case_.patient.name,
          address: residence.address,
          lat: residence.lat,
          lng: residence.lng,
          orderLabel: String(draftIndexById.get(routeId) ?? '•'),
          status: 'planned' as const,
          priority: proposal.priority,
          pointKind: 'proposal' as const,
          timeLabel: formatNullableTimeRange(proposal.time_window_start, proposal.time_window_end),
          etaLabel:
            !selectedCellRouteDraft.manualDirty && summary?.arrivalOffsetSeconds != null
              ? `${Math.round(summary.arrivalOffsetSeconds / 60)}分`
              : null,
        };
      }),
    ].filter((value): value is NonNullable<typeof value> => value != null);
  }, [
    routePreviewQuery.data,
    selectedCellProposals,
    selectedCellSchedules,
    selectedCellRouteDraft.draftIds,
    selectedCellRouteDraft.manualDirty,
  ]);

  const selectedCellSite =
    selectedCellSchedules[0]?.site?.lat != null && selectedCellSchedules[0]?.site?.lng != null
      ? {
          name: selectedCellSchedules[0].site.name,
          lat: selectedCellSchedules[0].site.lat as number,
          lng: selectedCellSchedules[0].site.lng as number,
        }
      : selectedCellProposals[0]?.site?.lat != null && selectedCellProposals[0]?.site?.lng != null
        ? {
            name: selectedCellProposals[0].site.name,
            lat: selectedCellProposals[0].site.lat as number,
            lng: selectedCellProposals[0].site.lng as number,
          }
        : null;
  const selectedRouteCellPharmacist =
    pharmacists.find((item) => item.id === effectiveSelectedRouteCell?.pharmacistId) ?? null;
  const selectedRouteCellSummary = effectiveSelectedRouteCell
    ? `${selectedRouteCellPharmacist?.name ?? effectiveSelectedRouteCell.pharmacistId} / ${effectiveSelectedRouteCell.dateKey}`
    : null;
  const applySelectedRouteMutation = useMutation({
    mutationFn: async () => {
      if (!routePreviewQuery.data || selectedCellRouteDraft.draftIds.length === 0) {
        throw new Error('反映できるルート順がありません');
      }
      if (!effectiveSelectedRouteCell) throw new Error('対象セルが選択されていません');

      const updates = selectedCellRouteDraft.draftIds.map((routeId, index) =>
        routeId.startsWith('proposal:')
          ? {
              item_type: 'proposal' as const,
              id: routeId.replace('proposal:', ''),
              route_order: index + 1,
            }
          : {
              item_type: 'schedule' as const,
              id: routeId,
              route_order: index + 1,
            },
      );

      await applyMixedVisitRouteUpdates({
        orgId,
        updates,
        confirmationContext: {
          source: 'weekly_optimizer_mixed_route_preview',
          date: effectiveSelectedRouteCell.dateKey,
          pharmacist_id: effectiveSelectedRouteCell.pharmacistId,
          travel_mode: plannerSettings.travel_mode,
          target_count: updates.length,
          route_order_diff_count: selectedCellRouteDraft.diffCount,
        },
      });
    },
    onSuccess: async () => {
      setRouteApplyConfirmOpen(false);
      toast.success('セル内の route_order を更新しました');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'weekly-optimizer', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
        queryClient.invalidateQueries({
          queryKey: ['visit-schedule-proposals', 'weekly-optimizer', orgId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'route_order の反映に失敗しました');
    },
  });

  const handleGenerateForCell = (pharmacistId: string, scheduledDate: string) => {
    if (!selectedCaseId) {
      toast.error('ケースを選択してから空き枠提案を実行してください');
      return;
    }

    createProposalMutation.mutate({
      case_id: selectedCaseId,
      visit_type: plannerSettings.visit_type,
      priority: plannerSettings.priority,
      travel_mode: plannerSettings.travel_mode,
      start_date: scheduledDate,
      locked_date: scheduledDate,
      preferred_time_from: plannerSettings.preferred_time_from || undefined,
      preferred_time_to: plannerSettings.preferred_time_to || undefined,
      preferred_pharmacist_id: pharmacistId,
      vehicle_resource_id: plannerSettings.vehicle_resource_id || undefined,
      candidate_count: 1,
    });
  };

  const updateSelectedRouteCell = (value: RouteCellSelection) => {
    setSelectedRouteCell(value);
    replaceOptimizerUrl({
      optimizer_pharmacist_id: value.pharmacistId,
      optimizer_date: value.dateKey,
    });
  };
  const moveSelectionToNextDay = () => {
    if (!effectiveSelectedRouteCell) return;
    const currentIndex = days.findIndex(
      (day) => format(day, 'yyyy-MM-dd') === effectiveSelectedRouteCell.dateKey,
    );
    const nextDay = days[currentIndex + 1] ?? null;
    if (!nextDay) return;
    updateSelectedRouteCell({
      pharmacistId: effectiveSelectedRouteCell.pharmacistId,
      dateKey: format(nextDay, 'yyyy-MM-dd'),
    });
  };
  const selectAlternatePharmacist = () => {
    if (!effectiveSelectedRouteCell) return;
    const currentIndex = pharmacists.findIndex(
      (pharmacist) => pharmacist.id === effectiveSelectedRouteCell.pharmacistId,
    );
    const alternate =
      pharmacists.find((pharmacist) => pharmacist.id !== effectiveSelectedRouteCell.pharmacistId) ??
      pharmacists[(currentIndex + 1) % Math.max(pharmacists.length, 1)] ??
      null;
    if (!alternate) return;
    updateSelectedRouteCell({
      pharmacistId: alternate.id,
      dateKey: effectiveSelectedRouteCell.dateKey,
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

    reorderSchedulesMutation.mutate(
      buildRouteReorderPayloads({
        draggedSchedule: draggingSchedule,
        sourceSchedules:
          schedulesByCell.get(
            `${draggingSchedule.sourcePharmacistId}:${draggingSchedule.sourceDateKey}`,
          ) ?? [],
        targetSchedules,
        targetPharmacistId: pharmacistId,
        targetDate: scheduledDate,
      }),
    );
    setDraggingSchedule(null);
    setHoveredCell(null);
  };

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/95">
        <CardHeader className="pb-3">
          <h2 className="font-heading text-base leading-snug font-medium">週間最適化ビュー</h2>
          <CardDescription>
            薬剤師 × 日のボードで、未確定予定の再配置と空き枠からの提案生成を行います。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>対象週</Label>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = subWeeks(weekAnchor, 1);
                    setWeekAnchor(next);
                    replaceOptimizerUrl({ week: format(next, 'yyyy-MM-dd') });
                  }}
                >
                  前週
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = startOfWeek(new Date(), { weekStartsOn: 1 });
                    setWeekAnchor(next);
                    replaceOptimizerUrl({ week: format(next, 'yyyy-MM-dd') });
                  }}
                >
                  今週
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const next = addWeeks(weekAnchor, 1);
                    setWeekAnchor(next);
                    replaceOptimizerUrl({ week: format(next, 'yyyy-MM-dd') });
                  }}
                >
                  翌週
                </Button>
              </div>
            </div>
            <div className="min-w-[18rem] space-y-1.5">
              <Label htmlFor="weekly-case-search">提案対象ケース</Label>
              <Input
                id="weekly-case-search"
                value={caseSearchInput}
                onChange={(event) => setCaseSearchInput(event.target.value)}
                placeholder="患者名・かなで検索"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-visit-type">訪問種別</Label>
              <Select
                value={plannerSettings.visit_type}
                onValueChange={(value) => {
                  setPlannerSettings((current) => ({
                    ...current,
                    visit_type: value as VisitType,
                  }));
                  replaceOptimizerUrl({ optimizer_visit_type: value });
                }}
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
                onValueChange={(value) => {
                  setPlannerSettings((current) => ({
                    ...current,
                    priority: value as VisitPriority,
                  }));
                  replaceOptimizerUrl({ optimizer_priority: value });
                }}
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
              <Label htmlFor="weekly-travel-mode">移動手段</Label>
              <Select
                value={plannerSettings.travel_mode}
                onValueChange={(value) => {
                  setPlannerSettings((current) => ({
                    ...current,
                    travel_mode: value as TravelMode,
                  }));
                  replaceOptimizerUrl({ optimizer_travel_mode: value });
                }}
              >
                <SelectTrigger id="weekly-travel-mode" className="w-[10rem]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRIVE">車</SelectItem>
                  <SelectItem value="BICYCLE">自転車</SelectItem>
                  <SelectItem value="WALK">徒歩</SelectItem>
                  <SelectItem value="TWO_WHEELER">二輪</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-vehicle-resource">社用車</Label>
              <Select
                value={plannerSettings.vehicle_resource_id || AUTO_VEHICLE_RESOURCE_VALUE}
                onValueChange={(value) => {
                  const selectedVehicleResourceId = normalizeVehicleResourceSelectValue(
                    value,
                    AUTO_VEHICLE_RESOURCE_VALUE,
                  );
                  const selectedVehicle = vehicleResources.find(
                    (vehicle) => vehicle.id === selectedVehicleResourceId,
                  );
                  setPlannerSettings((current) => ({
                    ...current,
                    vehicle_resource_id: selectedVehicleResourceId,
                    travel_mode: selectedVehicle?.travel_mode ?? current.travel_mode,
                  }));
                  replaceOptimizerUrl({
                    optimizer_travel_mode:
                      selectedVehicle?.travel_mode ?? plannerSettings.travel_mode,
                  });
                }}
              >
                <SelectTrigger id="weekly-vehicle-resource" className="w-[14rem]">
                  <Car className="mr-2 size-4 text-muted-foreground" />
                  <SelectValue placeholder="自動割当" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_VEHICLE_RESOURCE_VALUE}>自動割当</SelectItem>
                  {vehicleResources.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id}>
                      {vehicle.site?.name
                        ? `${formatVehicleResourceLabel(vehicle)} / ${vehicle.site.name}`
                        : formatVehicleResourceLabel(vehicle)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="max-w-[14rem] text-xs text-muted-foreground">
                {selectedPlannerVehicle
                  ? formatVehicleResourceLabel(selectedPlannerVehicle)
                  : vehicleResourcesQuery.isLoading
                    ? '社用車候補を読み込み中'
                    : '未指定なら自動割当'}
              </p>
              {vehicleResourceHiddenCount > 0 ? (
                <p className="max-w-[14rem] text-xs text-state-confirm">
                  社用車候補が他{vehicleResourceHiddenCount}
                  件あります。表示中の車両だけで全体の割当可否を判断しないでください。
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weekly-time-from">希望枠</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="weekly-time-from"
                  type="time"
                  value={plannerSettings.preferred_time_from}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPlannerSettings((current) => ({
                      ...current,
                      preferred_time_from: value,
                    }));
                    replaceOptimizerUrl({ optimizer_time_from: value });
                  }}
                  className="w-[8rem]"
                />
                <span className="text-sm text-muted-foreground">-</span>
                <Input
                  id="weekly-time-to"
                  aria-label="希望枠 終了"
                  type="time"
                  value={plannerSettings.preferred_time_to}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPlannerSettings((current) => ({
                      ...current,
                      preferred_time_to: value,
                    }));
                    replaceOptimizerUrl({ optimizer_time_to: value });
                  }}
                  className="w-[8rem]"
                />
              </div>
            </div>
          </div>

          {selectedCaseId && activeCase ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/15 px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-foreground">{activeCase.patient.name}</p>
                <p className="text-muted-foreground">
                  主担当 {activeCase.primary_pharmacist_name ?? '未設定'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => applySelectedCase(null)}
              >
                ケース固定を解除
              </Button>
            </div>
          ) : null}
          {proposalGenerationCaseError ? (
            <p id={proposalGenerationCaseErrorId} role="alert" className="text-xs text-destructive">
              {proposalGenerationCaseError}
            </p>
          ) : null}

          {caseSearchInput.trim().length >= 2 ? (
            <div className="space-y-2 rounded-lg border border-border/70 bg-muted/10 p-3">
              <p className="text-xs font-medium text-muted-foreground">検索結果</p>
              {caseSearchQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">ケース候補を読み込み中...</p>
              ) : caseSearchResults.length === 0 ? (
                <p className="text-sm text-muted-foreground">一致するケースはありません。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {caseSearchResults.map((careCase) => (
                    <Button
                      key={careCase.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applySelectedCase(careCase)}
                    >
                      {careCase.patient.name}
                      {careCase.primary_pharmacist_name
                        ? ` / ${careCase.primary_pharmacist_name}`
                        : ''}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {activeCase ? (
            <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">{activeCase.patient.name}</p>
              <p className="text-muted-foreground">
                主担当 {activeCase.primary_pharmacist_name ?? '未設定'} / 希望枠{' '}
                {plannerSettings.preferred_time_from} - {plannerSettings.preferred_time_to}
              </p>
              {cadencePreview ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  次回算定可能日 {cadencePreview.cadence.next_billable_date ?? '提案不可'} / 残回数{' '}
                  {cadencePreview.cadence.remaining_month_count} / 推奨枠数{' '}
                  {cadencePreview.suggested_schedule_slot_count}
                </p>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <p className="py-8 text-sm text-muted-foreground">週間最適化ビューを読み込み中...</p>
          ) : boardError ? (
            <div className="py-8">
              <ErrorState
                variant="server"
                size="inline"
                title="週間ボードを取得できませんでした"
                description="訪問予定・候補・シフトのいずれかの取得に失敗しました。空き枠は実際の状態と異なる可能性があるため、再読み込みしてから操作してください。"
                action={{ label: '再読み込み', onClick: refetchBoard }}
              />
            </div>
          ) : pharmacists.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              対象週に勤務シフトがある薬剤師がいません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[1100px] grid-cols-[220px_repeat(7,minmax(170px,1fr))] gap-3">
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                  薬剤師 / 日付
                </div>
                {days.map((day) => (
                  <div
                    key={day.toISOString()}
                    className="rounded-xl border border-border/70 bg-muted/20 p-3"
                  >
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
                      <p className="text-xs text-muted-foreground">
                        {pharmacist.siteName ?? '拠点未設定'}
                      </p>
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
                      const isSuggestedBillableDay =
                        cadencePreview?.cadence.suggested_dates.includes(dayKey) ?? false;
                      const isNextBillableDay =
                        cadencePreview?.cadence.next_billable_date === dayKey;

                      return (
                        <div
                          key={cellKey}
                          className={[
                            'min-h-[11rem] rounded-xl border p-3 transition-colors',
                            hoveredCell === cellKey && canDrop
                              ? 'border-primary bg-primary/5'
                              : 'border-border/70 bg-background',
                          ].join(' ')}
                          onClick={() =>
                            updateSelectedRouteCell({
                              pharmacistId: pharmacist.id,
                              dateKey: dayKey,
                            })
                          }
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
                                  ? `${formatNullableTimeOfDay(shift.available_from) ?? '09:00'} - ${formatNullableTimeOfDay(shift.available_to) ?? '18:00'}`
                                  : '勤務シフトなし'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline">{cellSchedules.length}件</Badge>
                              {cellProposals.length > 0 ? (
                                <Badge variant="outline">{cellProposals.length}候補</Badge>
                              ) : null}
                              {isNextBillableDay ? (
                                <StateBadge role="done">次回算定可</StateBadge>
                              ) : isSuggestedBillableDay ? (
                                <StateBadge role="info">候補日</StateBadge>
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
                                    : 'cursor-grab border-tag-info/30 bg-tag-info/10 active:cursor-grabbing',
                                ].join(' ')}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-foreground">
                                      {schedule.case_.patient.name}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {formatNullableTimeOfDay(schedule.time_window_start) ??
                                        '時間未定'}
                                      {schedule.time_window_end
                                        ? ` - ${formatNullableTimeOfDay(schedule.time_window_end)}`
                                        : ''}
                                    </p>
                                  </div>
                                  {!schedule.confirmed_at ? (
                                    <GripVertical className="mt-0.5 size-4 text-muted-foreground" />
                                  ) : null}
                                </div>
                              </div>
                            ))}

                            {cellProposals.slice(0, 3).map((proposal) => (
                              <div
                                key={proposal.id}
                                className="rounded-xl border-l-4 border-border/70 border-l-state-confirm bg-card px-3 py-2 text-xs"
                              >
                                <p className="font-medium text-foreground">
                                  {proposal.case_.patient.name}
                                </p>
                                <p className="mt-1 text-state-confirm">
                                  {PROPOSAL_STATUS_LABELS[proposal.proposal_status]}
                                </p>
                              </div>
                            ))}
                          </div>

                          <div className="mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="min-h-[44px] w-full sm:h-11 sm:min-h-[44px]"
                              onClick={() => handleGenerateForCell(pharmacist.id, dayKey)}
                              disabled={
                                !shift?.available ||
                                !selectedCaseId ||
                                createProposalMutation.isPending
                              }
                              aria-describedby={
                                !selectedCaseId ? proposalGenerationCaseErrorId : undefined
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
            <h2 className="flex items-center gap-2 font-heading text-base leading-snug font-medium">
              <Sparkles className="size-4 text-muted-foreground" />
              施設一括訪問の自動グループ化候補
            </h2>
            <CardDescription>
              同一施設患者が週内で分散している候補を、同日に寄せる再提案へつなぎます。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {facilitySuggestions.map((suggestion) => (
              <div
                key={`${suggestion.label}-${suggestion.targetDate}`}
                className="rounded-lg border border-border/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{suggestion.label}</p>
                    <p className="text-sm text-muted-foreground">
                      集約候補日 {format(parseISO(suggestion.targetDate), 'M/d(E)', { locale: ja })}{' '}
                      / 対象 {suggestion.outliers.length} 件
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => aggregateProposalsMutation.mutate(suggestion)}
                    disabled={aggregateProposalsMutation.isPending}
                  >
                    同日に集約提案
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestion.outliers.map((proposal) => (
                    <Badge key={proposal.id} variant="outline">
                      {proposal.case_.patient.name} /{' '}
                      {format(parseISO(proposal.proposed_date), 'M/d', { locale: ja })}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {effectiveSelectedRouteCell ? (
        <WeeklyCellInspector
          title="セルインスペクタ"
          description="選択セルの予定、候補、route、提案生成をここでまとめて操作します。"
          selectionLabel={selectedRouteCellSummary}
          pharmacistOptions={pharmacists}
          selectedPharmacistId={effectiveSelectedRouteCell.pharmacistId}
          onSelectPharmacist={(value) =>
            updateSelectedRouteCell({
              pharmacistId: value,
              dateKey: effectiveSelectedRouteCell.dateKey,
            })
          }
          dayOptions={days.map((day) => ({
            value: format(day, 'yyyy-MM-dd'),
            label: format(day, 'M/d(E)', { locale: ja }),
          }))}
          selectedDateKey={effectiveSelectedRouteCell.dateKey}
          onSelectDate={(value) =>
            updateSelectedRouteCell({
              pharmacistId: effectiveSelectedRouteCell.pharmacistId,
              dateKey: value,
            })
          }
          travelMode={plannerSettings.travel_mode}
          onTravelModeChange={(value) => {
            setPlannerSettings((current) => ({
              ...current,
              travel_mode: value as TravelMode,
            }));
            replaceOptimizerUrl({ optimizer_travel_mode: value });
          }}
          plan={routePreviewQuery.data}
          points={selectedCellRoutePoints}
          site={selectedCellSite}
          currentOrderedIds={selectedCellRouteDraft.currentIds}
          draftOrderedIds={selectedCellRouteDraft.draftIds}
          onMoveRouteItem={(scheduleId, direction) =>
            selectedCellRouteDraft.moveItem(scheduleId, direction)
          }
          onResetRouteDraft={selectedCellRouteDraft.resetToOptimized}
          routeDiffCount={selectedCellRouteDraft.diffCount}
          routeLoading={routePreviewQuery.isLoading}
          routeError={
            routePreviewQuery.error instanceof Error ? routePreviewQuery.error.message : null
          }
          onApplyRoute={() => setRouteApplyConfirmOpen(true)}
          applyRouteDisabled={
            !routePreviewQuery.data ||
            selectedCellRouteDraft.draftIds.length === 0 ||
            applySelectedRouteMutation.isPending ||
            !selectedCellRouteDraft.differsFromCurrent
          }
          applyRoutePending={applySelectedRouteMutation.isPending}
          schedules={selectedCellSchedules}
          proposals={selectedCellProposals}
          selectedCaseId={selectedCaseId}
          onGenerateForCell={() =>
            handleGenerateForCell(
              effectiveSelectedRouteCell.pharmacistId,
              effectiveSelectedRouteCell.dateKey,
            )
          }
          generateDisabled={!selectedCaseId || createProposalMutation.isPending}
          generateDisabledReasonId={!selectedCaseId ? proposalGenerationCaseErrorId : undefined}
          diagnostics={lastPlannerDiagnostics}
          onApplyTimeExpansion={() => {
            setPlannerSettings((current) => ({
              ...current,
              preferred_time_from: '09:00',
              preferred_time_to: '18:00',
            }));
            replaceOptimizerUrl({
              optimizer_time_from: '09:00',
              optimizer_time_to: '18:00',
            });
          }}
          onSwitchToDrive={() => {
            setPlannerSettings((current) => ({
              ...current,
              travel_mode: 'DRIVE',
            }));
            replaceOptimizerUrl({ optimizer_travel_mode: 'DRIVE' });
          }}
          onMoveSelectionToNextDay={moveSelectionToNextDay}
          onSelectAlternatePharmacist={selectAlternatePharmacist}
        />
      ) : null}

      <AlertDialog
        open={routeApplyConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !applySelectedRouteMutation.isPending) {
            setRouteApplyConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>週間ルートの route_order を反映しますか</AlertDialogTitle>
            <AlertDialogDescription>
              確定予定と未確定候補を同じ順路として扱います。対象セル、順序、件数を確認してから反映してください。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 text-sm">
            <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted-foreground">対象セル</dt>
                <dd className="font-medium">{selectedRouteCellSummary ?? '薬剤師・日付未選択'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">移動手段</dt>
                <dd className="font-medium">{plannerSettings.travel_mode}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">差分</dt>
                <dd className="font-medium">{selectedCellRouteDraft.diffCount}件</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">確定予定</dt>
                <dd className="font-medium">{selectedCellSchedules.length}件</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">未確定候補</dt>
                <dd className="font-medium">{selectedCellProposals.length}件</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">反映対象</dt>
                <dd className="font-medium">{selectedCellRouteApplyRows.length}件</dd>
              </div>
            </dl>

            <div className="max-h-[18rem] space-y-2 overflow-y-auto rounded-lg border border-border/70 bg-background p-2">
              {selectedCellRouteApplyRows.map((row) => (
                <div
                  key={row.routeId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">
                        {row.itemType === 'schedule' ? '確定予定' : '候補'}
                      </Badge>
                      <p className="font-medium text-foreground">{row.patientName}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatNullableTimeRange(row.timeWindowStart, row.timeWindowEnd)} / ID{' '}
                      {formatShortEntityIdentifier(row.itemId)}
                    </p>
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    #{row.currentOrder ?? '-'} → #{row.nextOrder}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-xs leading-5 text-muted-foreground">
              住所、電話番号、薬剤名、処方の細部はこの確認画面には表示しません。対象セルと順路が一致している場合のみ反映してください。
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={applySelectedRouteMutation.isPending}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => applySelectedRouteMutation.mutate()}
              disabled={
                !routePreviewQuery.data ||
                selectedCellRouteDraft.draftIds.length === 0 ||
                applySelectedRouteMutation.isPending ||
                !selectedCellRouteDraft.differsFromCurrent
              }
            >
              {applySelectedRouteMutation.isPending
                ? 'route_order 反映中...'
                : `${selectedCellRouteApplyRows.length}件の route_order を反映`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
