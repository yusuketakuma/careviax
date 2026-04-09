export type ScheduleProposalWorkspace = 'dashboard' | 'optimizer';

type SearchParamRecord = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;

function readValue(params: SearchParamRecord, key: string) {
  if (!params) return null;
  if (params instanceof URLSearchParams) {
    return params.get(key);
  }
  const value = params[key];
  return typeof value === 'string' ? value : null;
}

export function readScheduleProposalWorkspace(params: SearchParamRecord): ScheduleProposalWorkspace {
  return readValue(params, 'workspace') === 'optimizer' ? 'optimizer' : 'dashboard';
}

export function readScheduleProposalDashboardState(params: SearchParamRecord) {
  const status = readValue(params, 'status');
  const legacyDate = readValue(params, 'date');
  return {
    initialStatus: status,
    initialCaseId: readValue(params, 'case_id'),
    initialPatientId: readValue(params, 'patient_id'),
    initialDateFrom: readValue(params, 'date_from') ?? legacyDate,
    initialDateTo: readValue(params, 'date_to'),
    initialFocus: readValue(params, 'focus'),
    initialPreset: readValue(params, 'preset'),
    initialDetailId: readValue(params, 'detail'),
    initialTravelMode: readValue(params, 'travel_mode'),
  };
}

export function readScheduleProposalOptimizerState(params: SearchParamRecord) {
  const legacyDate = readValue(params, 'date');
  return {
    initialDate: readValue(params, 'week') ?? legacyDate,
    initialCaseId: readValue(params, 'optimizer_case_id'),
    initialVisitType: readValue(params, 'optimizer_visit_type'),
    initialPriority: readValue(params, 'optimizer_priority'),
    initialTravelMode: readValue(params, 'optimizer_travel_mode'),
    initialPreferredTimeFrom: readValue(params, 'optimizer_time_from'),
    initialPreferredTimeTo: readValue(params, 'optimizer_time_to'),
    initialRoutePharmacistId: readValue(params, 'optimizer_pharmacist_id'),
    initialRouteDate: readValue(params, 'optimizer_date'),
  };
}

export function mergeScheduleProposalSearchParams(args: {
  params: URLSearchParams;
  patch: Record<string, string | null | undefined>;
}) {
  const next = new URLSearchParams(args.params.toString());
  for (const [key, value] of Object.entries(args.patch)) {
    if (value == null || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return next;
}

export function buildScheduleProposalHref(args: {
  params: SearchParamRecord;
  patch: Record<string, string | null | undefined>;
}) {
  const base =
    args.params instanceof URLSearchParams
      ? new URLSearchParams(args.params.toString())
      : new URLSearchParams(
          Object.entries(args.params ?? {}).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : []
          )
        );
  const next = mergeScheduleProposalSearchParams({ params: base, patch: args.patch });
  const query = next.toString();
  return query ? `/schedules/proposals?${query}` : '/schedules/proposals';
}
