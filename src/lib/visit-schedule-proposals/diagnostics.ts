type JsonRecord = Record<string, unknown>;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VISIT_ROUTE_TRAVEL_MODES = new Set(['DRIVE', 'BICYCLE', 'WALK', 'TWO_WHEELER']);

type DiagnosticMode = 'response' | 'audit';

export type SafeDeadlinePolicyDiagnostic = {
  code: string;
  site_id: string | null;
  date_key?: string;
  from_date_key?: string;
  to_date_key?: string;
  value?: string | number | boolean;
};

export type SafeProposalAcceptedDiagnostic = {
  pharmacist_id: string;
  pharmacist_name?: string;
  site_id: string | null;
  site_name?: string | null;
  proposed_date: string;
  travel_mode?: string;
  route_order?: number;
  route_distance_score?: number;
  travel_summary?: string;
  vehicle_resource_id?: string | null;
  vehicle_resource_label?: string | null;
  vehicle_load?: number | null;
  assignment_mode?: string;
  care_relationship?: string;
  score?: number;
  score_breakdown?: Record<string, number>;
  time_window_start?: string;
  time_window_end?: string;
};

export type SafeProposalRejectedDiagnostic = {
  pharmacist_id?: string;
  pharmacist_name?: string;
  site_id: string | null;
  site_name?: string | null;
  proposed_date: string;
  travel_mode?: string;
  reason_code: string;
  reason_label?: string;
  detail?: string;
  availability_reason_code?: string;
};

export type SafeProposalGenerationDiagnostics = {
  accepted: SafeProposalAcceptedDiagnostic[];
  rejected: SafeProposalRejectedDiagnostic[];
  deadline_policy: SafeDeadlinePolicyDiagnostic[];
  billing_constraint_count?: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNullableString(record: JsonRecord, key: string) {
  const value = record[key];
  if (value == null) return null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDateKey(record: JsonRecord, key: string) {
  const value = readString(record, key);
  return value && DATE_KEY_PATTERN.test(value) ? value : null;
}

function readTravelMode(record: JsonRecord, key: string) {
  const value = readString(record, key);
  return value && VISIT_ROUTE_TRAVEL_MODES.has(value) ? value : null;
}

function readTimeLike(record: JsonRecord, key: string) {
  const value = record[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (TIME_PATTERN.test(trimmed)) return trimmed;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function readNumberMap(record: JsonRecord, key: string) {
  const value = record[key];
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : {};
}

function readScalarDiagnosticValue(record: JsonRecord, key: string) {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && DATE_KEY_PATTERN.test(value.trim())) return value.trim();
  return null;
}

function normalizeAcceptedDiagnostic(
  value: unknown,
  mode: DiagnosticMode,
): SafeProposalAcceptedDiagnostic | null {
  if (!isRecord(value)) return null;
  const pharmacistId = readString(value, 'pharmacist_id');
  const proposedDate = readDateKey(value, 'proposed_date');
  if (!pharmacistId || !proposedDate) return null;

  const normalized: SafeProposalAcceptedDiagnostic = {
    pharmacist_id: pharmacistId,
    site_id: readNullableString(value, 'site_id'),
    proposed_date: proposedDate,
  };

  const travelMode = readTravelMode(value, 'travel_mode');
  if (travelMode) normalized.travel_mode = travelMode;
  const routeOrder = readNumber(value, 'route_order');
  if (routeOrder != null) normalized.route_order = routeOrder;
  const score = readNumber(value, 'score');
  if (score != null) normalized.score = score;
  const assignmentMode = readString(value, 'assignment_mode');
  if (assignmentMode) normalized.assignment_mode = assignmentMode;
  const careRelationship = readString(value, 'care_relationship');
  if (careRelationship) normalized.care_relationship = careRelationship;
  const vehicleResourceId = readNullableString(value, 'vehicle_resource_id');
  if (vehicleResourceId) normalized.vehicle_resource_id = vehicleResourceId;

  if (mode === 'response') {
    const pharmacistName = readString(value, 'pharmacist_name');
    if (pharmacistName) normalized.pharmacist_name = pharmacistName;
    normalized.site_name = readNullableString(value, 'site_name');
    const routeDistanceScore = readNumber(value, 'route_distance_score');
    if (routeDistanceScore != null) normalized.route_distance_score = routeDistanceScore;
    const travelSummary = readString(value, 'travel_summary');
    if (travelSummary) normalized.travel_summary = travelSummary;
    const vehicleResourceLabel = readNullableString(value, 'vehicle_resource_label');
    if (vehicleResourceLabel) normalized.vehicle_resource_label = vehicleResourceLabel;
    const vehicleLoad = readNumber(value, 'vehicle_load');
    if (vehicleLoad != null) normalized.vehicle_load = vehicleLoad;
    const scoreBreakdown = readNumberMap(value, 'score_breakdown');
    if (scoreBreakdown) normalized.score_breakdown = scoreBreakdown;
    const timeWindowStart = readTimeLike(value, 'time_window_start');
    if (timeWindowStart) normalized.time_window_start = timeWindowStart;
    const timeWindowEnd = readTimeLike(value, 'time_window_end');
    if (timeWindowEnd) normalized.time_window_end = timeWindowEnd;
  }

  return normalized;
}

function normalizeRejectedDiagnostic(
  value: unknown,
  mode: DiagnosticMode,
): SafeProposalRejectedDiagnostic | null {
  if (!isRecord(value)) return null;
  const proposedDate = readDateKey(value, 'proposed_date');
  const reasonCode = readString(value, 'reason_code');
  if (!proposedDate || !reasonCode) return null;

  const normalized: SafeProposalRejectedDiagnostic = {
    site_id: readNullableString(value, 'site_id'),
    proposed_date: proposedDate,
    reason_code: reasonCode,
  };

  const pharmacistId = readString(value, 'pharmacist_id');
  if (pharmacistId) normalized.pharmacist_id = pharmacistId;
  const travelMode = readTravelMode(value, 'travel_mode');
  if (travelMode) normalized.travel_mode = travelMode;
  const availabilityReasonCode = readString(value, 'availability_reason_code');
  if (availabilityReasonCode) normalized.availability_reason_code = availabilityReasonCode;

  if (mode === 'response') {
    const pharmacistName = readString(value, 'pharmacist_name');
    if (pharmacistName) normalized.pharmacist_name = pharmacistName;
    normalized.site_name = readNullableString(value, 'site_name');
    const reasonLabel = readString(value, 'reason_label');
    if (reasonLabel) normalized.reason_label = reasonLabel;
    const detail = readString(value, 'detail');
    if (detail) normalized.detail = detail;
  }

  return normalized;
}

function normalizeDeadlinePolicyDiagnostic(value: unknown): SafeDeadlinePolicyDiagnostic | null {
  if (!isRecord(value)) return null;
  const code = readString(value, 'code');
  if (!code) return null;

  const normalized: SafeDeadlinePolicyDiagnostic = {
    code,
    site_id: readNullableString(value, 'site_id'),
  };
  const dateKey = readDateKey(value, 'date_key');
  if (dateKey) normalized.date_key = dateKey;
  const fromDateKey = readDateKey(value, 'from_date_key');
  if (fromDateKey) normalized.from_date_key = fromDateKey;
  const toDateKey = readDateKey(value, 'to_date_key');
  if (toDateKey) normalized.to_date_key = toDateKey;
  const diagnosticValue = readScalarDiagnosticValue(value, 'value');
  if (diagnosticValue != null) normalized.value = diagnosticValue;

  return normalized;
}

export function normalizeProposalGenerationDiagnostics(
  value: unknown,
  options: { mode: DiagnosticMode },
): SafeProposalGenerationDiagnostics {
  const source = isRecord(value) ? value : {};
  const acceptedSource = Array.isArray(source.accepted) ? source.accepted : [];
  const rejectedSource = Array.isArray(source.rejected) ? source.rejected : [];
  const deadlinePolicySource = Array.isArray(source.deadline_policy) ? source.deadline_policy : [];
  const accepted = acceptedSource
    .map((item) => normalizeAcceptedDiagnostic(item, options.mode))
    .filter((item): item is SafeProposalAcceptedDiagnostic => item != null);
  const rejected = rejectedSource
    .map((item) => normalizeRejectedDiagnostic(item, options.mode))
    .filter((item): item is SafeProposalRejectedDiagnostic => item != null);
  const deadlinePolicy = deadlinePolicySource
    .map(normalizeDeadlinePolicyDiagnostic)
    .filter((item): item is SafeDeadlinePolicyDiagnostic => item != null);
  const billingConstraintCount = rejected.filter(
    (item) => item.reason_code === 'billing_constraint',
  ).length;

  return {
    accepted,
    rejected,
    deadline_policy: deadlinePolicy,
    ...(billingConstraintCount > 0 ? { billing_constraint_count: billingConstraintCount } : {}),
  };
}
