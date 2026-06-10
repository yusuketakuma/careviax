import type {
  BillingRequirementAlert,
  CaseOption,
  Pharmacist,
  Proposal,
  VisitScheduleBillingPreview,
  VisitPriority,
  VisitVehicleResourceSummary,
  VisitType,
} from './day-view.shared';
import { toDateKey } from './day-view.shared';

export type ScheduleDayRouteTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

export type ScheduleDayPlannerForm = {
  case_id: string;
  visit_type: VisitType;
  priority: VisitPriority;
  start_date: string;
  preferred_time_from: string;
  preferred_time_to: string;
  vehicle_resource_id: string;
  candidate_count: string;
};

export type ScheduleDayProposalGenerationResult = {
  data: Proposal[];
  alerts?: BillingRequirementAlert[];
};

export type ScheduleDayPharmacistLookup = {
  pharmacistNameById: Map<string, string>;
  pharmacistSiteIdById: Map<string, string | null>;
};

export type ScheduleDayPlannerSelection = {
  resolvedPlannerCaseId: string;
  selectedCase: CaseOption | null;
  selectedPlannerPharmacistId: string;
  selectedPlannerSiteId: string | null;
};

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

type WarningNotifier = (message: string, options: { description: string }) => void;

export function getDefaultScheduleDayPlannerForm(startDate: string): ScheduleDayPlannerForm {
  return {
    case_id: '',
    visit_type: 'regular',
    priority: 'normal',
    start_date: startDate,
    preferred_time_from: '09:00',
    preferred_time_to: '12:00',
    vehicle_resource_id: '',
    candidate_count: '3',
  };
}

export function resolveScheduleDayPlannerCaseId({
  plannerForm,
  cases,
}: {
  plannerForm: ScheduleDayPlannerForm;
  cases: Pick<CaseOption, 'id'>[];
}) {
  return plannerForm.case_id || cases[0]?.id || '';
}

export function filterScheduleDayPlannerCases(cases: CaseOption[]): CaseOption[] {
  return cases.filter((careCase) => !['discharged', 'terminated'].includes(careCase.status));
}

export function buildScheduleDayPharmacistLookup(
  pharmacists: Pick<Pharmacist, 'id' | 'name' | 'site_id'>[],
): ScheduleDayPharmacistLookup {
  return {
    pharmacistNameById: new Map(pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.name])),
    pharmacistSiteIdById: new Map(
      pharmacists.map((pharmacist) => [pharmacist.id, pharmacist.site_id]),
    ),
  };
}

export function buildScheduleDayPlannerSelection({
  plannerForm,
  cases,
  pharmacistSiteIdById,
}: {
  plannerForm: ScheduleDayPlannerForm;
  cases: CaseOption[];
  pharmacistSiteIdById: ReadonlyMap<string, string | null>;
}): ScheduleDayPlannerSelection {
  const resolvedPlannerCaseId = resolveScheduleDayPlannerCaseId({ plannerForm, cases });
  const selectedCase = cases.find((careCase) => careCase.id === resolvedPlannerCaseId) ?? null;
  const selectedPlannerPharmacistId = selectedCase?.primary_pharmacist_id ?? '';
  const selectedPlannerSiteId = pharmacistSiteIdById.get(selectedPlannerPharmacistId) ?? null;

  return {
    resolvedPlannerCaseId,
    selectedCase,
    selectedPlannerPharmacistId,
    selectedPlannerSiteId,
  };
}

export function buildScheduleDayVehicleResourcesRequestUrl(
  selectedPlannerSiteId: string | null | undefined,
) {
  const params = new URLSearchParams({ available: 'true' });
  if (selectedPlannerSiteId) params.set('site_id', selectedPlannerSiteId);
  return `/api/visit-vehicle-resources?${params}`;
}

export function buildScheduleDayVehicleResourcesQueryKey({
  orgId,
  selectedPlannerSiteId,
}: {
  orgId: string;
  selectedPlannerSiteId: string | null;
}) {
  return ['visit-vehicle-resources', orgId, 'schedule-planner', selectedPlannerSiteId] as const;
}

export function buildScheduleDayPlannerBillingPreviewQueryKey({
  orgId,
  resolvedPlannerCaseId,
  proposedDate,
  visitType,
  pharmacistId,
  siteId,
}: {
  orgId: string;
  resolvedPlannerCaseId: string;
  proposedDate: string;
  visitType: VisitType;
  pharmacistId: string;
  siteId: string | null;
}) {
  return [
    'visit-schedule-billing-preview',
    orgId,
    resolvedPlannerCaseId,
    proposedDate,
    visitType,
    pharmacistId,
    siteId,
  ] as const;
}

export function buildScheduleDayPlannerBillingPreviewRequestUrl({
  resolvedPlannerCaseId,
  proposedDate,
  visitType,
  pharmacistId,
  siteId,
}: {
  resolvedPlannerCaseId: string;
  proposedDate: string;
  visitType: VisitType | '' | null | undefined;
  pharmacistId: string | null | undefined;
  siteId: string | null | undefined;
}) {
  const params = new URLSearchParams({
    case_id: resolvedPlannerCaseId,
    proposed_date: proposedDate,
  });
  if (visitType) params.set('visit_type', visitType);
  if (pharmacistId) params.set('pharmacist_id', pharmacistId);
  if (siteId) params.set('site_id', siteId);
  return `/api/visit-schedule-proposals/billing-preview?${params}`;
}

export function buildScheduleDaySelectedDateProposals<
  T extends Pick<Proposal, 'proposed_date' | 'route_order'>,
>(proposals: T[], selectedDate: string): T[] {
  return proposals
    .filter((proposal) => toDateKey(proposal.proposed_date) === selectedDate)
    .sort((left, right) => {
      if (left.route_order == null && right.route_order == null) return 0;
      if (left.route_order == null) return 1;
      if (right.route_order == null) return -1;
      return left.route_order - right.route_order;
    });
}

export function getScheduleDayEffectivePlannerCandidateCount({
  plannerForm,
  billingPreview,
  isManual,
}: {
  plannerForm: ScheduleDayPlannerForm;
  billingPreview:
    | Pick<VisitScheduleBillingPreview, 'suggested_schedule_slot_count'>
    | null
    | undefined;
  isManual: boolean;
}) {
  return !isManual && billingPreview?.suggested_schedule_slot_count
    ? String(billingPreview.suggested_schedule_slot_count)
    : plannerForm.candidate_count;
}

export function applyScheduleDayPlannerCaseSelection(
  current: ScheduleDayPlannerForm,
  caseId: string | null | undefined,
): ScheduleDayPlannerForm {
  if (caseId == null) return current;

  return {
    ...current,
    case_id: caseId,
    vehicle_resource_id: caseId === current.case_id ? current.vehicle_resource_id : '',
  };
}

export function clearScheduleDayPlannerVehicleResourceSelection(
  current: ScheduleDayPlannerForm,
): ScheduleDayPlannerForm {
  if (!current.vehicle_resource_id) return current;
  return {
    ...current,
    vehicle_resource_id: '',
  };
}

export function applyScheduleDayPlannerStartDate(
  current: ScheduleDayPlannerForm,
  startDate: string | null | undefined,
): ScheduleDayPlannerForm {
  return {
    ...current,
    start_date: startDate ?? current.start_date,
  };
}

function applyScheduleDayPlannerField<K extends keyof ScheduleDayPlannerForm>(
  current: ScheduleDayPlannerForm,
  field: K,
  value: ScheduleDayPlannerForm[K] | null | undefined,
): ScheduleDayPlannerForm {
  return {
    ...current,
    [field]: value ?? current[field],
  };
}

export function applyScheduleDayPlannerVisitType(
  current: ScheduleDayPlannerForm,
  visitType: VisitType | null | undefined,
): ScheduleDayPlannerForm {
  return applyScheduleDayPlannerField(current, 'visit_type', visitType);
}

export function applyScheduleDayPlannerPriority(
  current: ScheduleDayPlannerForm,
  priority: VisitPriority | null | undefined,
): ScheduleDayPlannerForm {
  return applyScheduleDayPlannerField(current, 'priority', priority);
}

export function applyScheduleDayPlannerCandidateCount(
  current: ScheduleDayPlannerForm,
  candidateCount: string | null | undefined,
): ScheduleDayPlannerForm {
  return applyScheduleDayPlannerField(current, 'candidate_count', candidateCount);
}

export function applyScheduleDayPlannerPreferredTimeFrom(
  current: ScheduleDayPlannerForm,
  preferredTimeFrom: string | null | undefined,
): ScheduleDayPlannerForm {
  return applyScheduleDayPlannerField(current, 'preferred_time_from', preferredTimeFrom);
}

export function applyScheduleDayPlannerPreferredTimeTo(
  current: ScheduleDayPlannerForm,
  preferredTimeTo: string | null | undefined,
): ScheduleDayPlannerForm {
  return applyScheduleDayPlannerField(current, 'preferred_time_to', preferredTimeTo);
}

export function applyScheduleDayPlannerBillingRecommendations({
  current,
  billingPreview,
}: {
  current: ScheduleDayPlannerForm;
  billingPreview:
    | Pick<
        VisitScheduleBillingPreview,
        'recommended_visit_type' | 'recommended_priority' | 'suggested_schedule_slot_count'
      >
    | null
    | undefined;
}): ScheduleDayPlannerForm {
  return {
    ...current,
    visit_type: billingPreview?.recommended_visit_type ?? current.visit_type,
    priority: billingPreview?.recommended_priority ?? current.priority,
    candidate_count: String(
      billingPreview?.suggested_schedule_slot_count ?? Number(current.candidate_count),
    ),
  };
}

function resolveScheduleDayPlannerVehicleResourceId({
  selectedValue,
  autoValue,
}: {
  selectedValue: string | null | undefined;
  autoValue: string;
}): string {
  return selectedValue && selectedValue !== autoValue ? selectedValue : '';
}

export function applyScheduleDayPlannerVehicleResourceSelection(
  current: ScheduleDayPlannerForm,
  selectedValue: string | null | undefined,
  autoValue: string,
): ScheduleDayPlannerForm {
  return {
    ...current,
    vehicle_resource_id: resolveScheduleDayPlannerVehicleResourceId({
      selectedValue,
      autoValue,
    }),
  };
}

export function resolveScheduleDayPlannerVehicleRouteTravelMode({
  selectedValue,
  autoValue,
  vehicleResources,
  currentRouteTravelMode,
}: {
  selectedValue: string | null | undefined;
  autoValue: string;
  vehicleResources: Pick<VisitVehicleResourceSummary, 'id' | 'travel_mode'>[];
  currentRouteTravelMode: ScheduleDayRouteTravelMode;
}): ScheduleDayRouteTravelMode {
  const vehicleResourceId = resolveScheduleDayPlannerVehicleResourceId({
    selectedValue,
    autoValue,
  });
  const selectedVehicle = vehicleResources.find((vehicle) => vehicle.id === vehicleResourceId);
  return selectedVehicle?.travel_mode ?? currentRouteTravelMode;
}

export function selectScheduleDayPlannerVehicle({
  current,
  selectedValue,
  autoValue,
  vehicleResources,
  currentRouteTravelMode,
}: {
  current: ScheduleDayPlannerForm;
  selectedValue: string | null | undefined;
  autoValue: string;
  vehicleResources: Pick<VisitVehicleResourceSummary, 'id' | 'travel_mode'>[];
  currentRouteTravelMode: ScheduleDayRouteTravelMode;
}): { plannerForm: ScheduleDayPlannerForm; routeTravelMode: ScheduleDayRouteTravelMode } {
  return {
    plannerForm: applyScheduleDayPlannerVehicleResourceSelection(current, selectedValue, autoValue),
    routeTravelMode: resolveScheduleDayPlannerVehicleRouteTravelMode({
      selectedValue,
      autoValue,
      vehicleResources,
      currentRouteTravelMode,
    }),
  };
}

export function getScheduleDaySelectedPlannerVehicle<
  T extends Pick<VisitVehicleResourceSummary, 'id'>,
>(plannerForm: ScheduleDayPlannerForm, vehicleResources: T[]): T | null {
  return vehicleResources.find((vehicle) => vehicle.id === plannerForm.vehicle_resource_id) ?? null;
}

export function buildScheduleDayProposalGenerationPayload({
  resolvedCaseId,
  plannerForm,
  routeTravelMode,
  effectiveCandidateCount,
}: {
  resolvedCaseId: string;
  plannerForm: ScheduleDayPlannerForm;
  routeTravelMode: ScheduleDayRouteTravelMode;
  effectiveCandidateCount: string | number;
}) {
  return {
    case_id: resolvedCaseId,
    visit_type: plannerForm.visit_type,
    priority: plannerForm.priority,
    travel_mode: routeTravelMode,
    start_date: plannerForm.start_date,
    preferred_time_from: plannerForm.preferred_time_from || undefined,
    preferred_time_to: plannerForm.preferred_time_to || undefined,
    vehicle_resource_id: plannerForm.vehicle_resource_id || undefined,
    candidate_count: Number(effectiveCandidateCount),
  };
}

export async function generateScheduleDayProposals({
  orgId,
  resolvedCaseId,
  plannerForm,
  routeTravelMode,
  effectiveCandidateCount,
  fetchImpl = fetch,
}: {
  orgId: string;
  resolvedCaseId: string;
  plannerForm: ScheduleDayPlannerForm;
  routeTravelMode: ScheduleDayRouteTravelMode;
  effectiveCandidateCount: string | number;
  fetchImpl?: FetchLike;
}): Promise<ScheduleDayProposalGenerationResult> {
  const res = await fetchImpl('/api/visit-schedule-proposals', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify(
      buildScheduleDayProposalGenerationPayload({
        resolvedCaseId,
        plannerForm,
        routeTravelMode,
        effectiveCandidateCount,
      }),
    ),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(typeof error.message === 'string' ? error.message : '候補生成に失敗しました');
  }

  return res.json() as Promise<ScheduleDayProposalGenerationResult>;
}

export function getScheduleDayProposalWarningDescription(
  alerts: BillingRequirementAlert[] | undefined,
): string | null {
  const warningMessages =
    alerts?.filter((alert) => alert.severity !== 'info').map((alert) => alert.message) ?? [];

  return warningMessages.length > 0 ? warningMessages.slice(0, 2).join(' / ') : null;
}

export async function handleScheduleDayProposalGenerationSuccess({
  data,
  orgId,
  plannerStartDate,
  notifySuccess,
  notifyWarning,
  invalidateQueries,
  setSelectedDate,
}: {
  data: ScheduleDayProposalGenerationResult;
  orgId: string;
  plannerStartDate: string;
  notifySuccess: (message: string) => void;
  notifyWarning: WarningNotifier;
  invalidateQueries: QueryInvalidator;
  setSelectedDate: (date: string) => void;
}) {
  notifySuccess(`${data.data.length}件の訪問候補を生成しました`);

  const warningDescription = getScheduleDayProposalWarningDescription(data.alerts);
  if (warningDescription) {
    notifyWarning('算定アラート', {
      description: warningDescription,
    });
  }

  await invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] });
  setSelectedDate(plannerStartDate);
}
