import type {
  ActionRequest,
  CreateHandoffRequest,
  ErrorResponse,
  ExcludeClaimCandidateRequest,
  EvidenceUploadRequest,
  OpenHandoffRequest,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
  MarkReportActionDoneRequest,
  RegisterReportReplyRequest,
  VisitStep,
  VisitStepMutationRequest,
} from '@/phos/contracts/phos_contracts';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  BoardQuickFilter,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
  ClaimCandidateStatus,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  SourceRefKind,
  Tag,
  TabKey,
  TriageLane,
  UserRole,
  VisitStatus,
  VisitStep as VisitStepValue,
} from '@/phos/contracts/phos_contracts';
import { findPhosRoute, type PhosApiRoute } from '@/phos/infra/api-gateway-routes';
import type {
  PhosApiClient,
  PhosCapacityQuery,
  PhosCardsQuery,
  PhosClaimCandidatesQuery,
  PhosReportDeliveriesQuery,
} from './types';
import { PhosApiError } from './types';

export type CreatePhosApiClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getAccessToken?: () => string | Promise<string>;
  correlationId?: () => string | undefined;
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('PH-OS API baseUrl is required');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('PH-OS API baseUrl must use http(s)');
  }
  const localHttpHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (parsed.protocol === 'http:' && !localHttpHosts.has(parsed.hostname)) {
    throw new Error('PH-OS API baseUrl must use https outside local development');
  }
  if (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) {
    throw new Error('PH-OS business API must not use Next.js /api routes');
  }
  return trimmed;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

type ParsedJsonResponse = {
  payload: unknown;
  invalid_json: boolean;
  content_type: string | null;
};

async function readJsonResponse(response: Response): Promise<ParsedJsonResponse> {
  const text = await response.text();
  const contentType = response.headers.get('content-type');
  if (!text) return { payload: undefined, invalid_json: false, content_type: contentType };
  try {
    return { payload: JSON.parse(text), invalid_json: false, content_type: contentType };
  } catch {
    return { payload: undefined, invalid_json: true, content_type: contentType };
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ErrorResponse).request_id === 'string' &&
    typeof (value as ErrorResponse).error_code === 'string' &&
    typeof (value as ErrorResponse).message_key === 'string'
  );
}

function assertSafePathSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`${label} contains an unsafe path segment`);
  }
}

function routeInfo(routeKey: string, params: Record<string, string> = {}) {
  const route = findPhosRoute(routeKey);
  if (!route) throw new Error(`PH-OS API route is not registered: ${routeKey}`);
  let path = route.path;
  for (const [key, value] of Object.entries(params)) {
    assertSafePathSegment(value, key);
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  if (path.includes('{')) {
    throw new Error(`PH-OS API route params are incomplete: ${routeKey}`);
  }
  return { path, response_contract: route.response_contract };
}

type ResponseContract = PhosApiRoute['response_contract'];

function invalidResponseError(
  status: number,
  parsed: ParsedJsonResponse,
  responseContract?: ResponseContract,
): ErrorResponse {
  return {
    request_id: '',
    error_code: 'INTERNAL_ERROR',
    message_key: 'api.error.invalid_response',
    details: {
      status,
      content_type: parsed.content_type,
      ...(responseContract ? { response_contract: responseContract } : {}),
      ...(parsed.invalid_json ? { invalid_json: true } : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasArray(record: Record<string, unknown>, key: string): boolean {
  return Array.isArray(record[key]);
}

function hasObject(record: Record<string, unknown>, key: string): boolean {
  return isRecord(record[key]);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return isString(record[key]);
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return isNumber(record[key]);
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isString(record[key]);
}

function hasOptionalNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || (isString(record[key]) && record[key].length > 0);
}

function hasOptionalNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isNumber(record[key]);
}

function hasOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === 'boolean';
}

function isOneOf(values: readonly string[], value: unknown): boolean {
  return isString(value) && values.includes(value);
}

function isOptionalOneOf(values: readonly string[], value: unknown): boolean {
  return value === undefined || isOneOf(values, value);
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isString);
}

function everyArrayItem(
  record: Record<string, unknown>,
  key: string,
  predicate: (item: unknown) => boolean,
): boolean {
  return hasArray(record, key) && (record[key] as unknown[]).every(predicate);
}

function optionalArrayEvery(
  record: Record<string, unknown>,
  key: string,
  predicate: (item: unknown) => boolean,
): boolean {
  return record[key] === undefined || everyArrayItem(record, key, predicate);
}

function isSourceRef(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(Object.values(SourceRefKind), value.kind) &&
    hasString(value, 'ref_id') &&
    hasString(value, 'label') &&
    hasOptionalString(value, 'uri') &&
    hasOptionalString(value, 'captured_at')
  );
}

function isEvidenceRequirement(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'evidence_key') &&
    hasString(value, 'label') &&
    typeof value.required === 'boolean' &&
    isOneOf(Object.values(SourceRefKind), value.source_kind)
  );
}

function isTag(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(Object.values(Tag), value.code) &&
    hasString(value, 'label') &&
    isOneOf(Object.values(BlockerSeverity), value.severity) &&
    hasString(value, 'icon') &&
    typeof value.safety_critical === 'boolean'
  );
}

function isBlocker(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'blocker_code') &&
    isOneOf(Object.values(BlockerSeverity), value.severity) &&
    isOneOf(Object.values(UserRole), value.owner_role) &&
    hasString(value, 'message_key') &&
    (value.message_params === undefined || isStringRecord(value.message_params)) &&
    isOptionalOneOf(Object.values(ActionCode), value.required_action_code) &&
    typeof value.active === 'boolean'
  );
}

function isPermissions(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.can_read === 'boolean' &&
    typeof value.can_write === 'boolean' &&
    everyArrayItem(value, 'allowed_actions', (item) => isOneOf(Object.values(ActionCode), item))
  );
}

function isTabKey(value: unknown): boolean {
  return isOneOf(Object.values(TabKey), value);
}

function isSideEffect(value: unknown): boolean {
  if (!isRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case 'TASK_COMPLETED':
      return hasString(value, 'task_id');
    case 'BLOCKER_RESOLVED':
      return hasString(value, 'blocker_code');
    case 'BLOCKER_CREATED':
      return (
        hasString(value, 'blocker_code') && isOneOf(Object.values(BlockerSeverity), value.severity)
      );
    case 'READY_CHECK_RECALCULATED':
      return hasString(value, 'visit_packet_id');
    case 'CLAIM_RECALCULATED':
      return hasString(value, 'card_id');
    case 'HANDOFF_CREATED':
      return hasString(value, 'handoff_id');
    case 'REPORT_QUEUED':
    case 'REPORT_ACTION_DONE':
      return hasString(value, 'delivery_id');
    case 'REPORT_REPLY_REGISTERED':
      return (
        hasString(value, 'delivery_id') &&
        isOneOf(Object.values(ReportDeliveryStatus), value.status)
      );
    case 'CARD_GENERATED':
      return hasString(value, 'card_id') && isOneOf(Object.values(CardType), value.card_type);
    default:
      return false;
  }
}

function isCapacityWorkBucket(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(
      ['INTAKE', 'DISPENSING', 'AUDIT', 'VISIT', 'REPORT', 'CLAIM', 'OTHER'],
      value.bucket_code,
    ) &&
    hasString(value, 'label') &&
    hasNumber(value, 'planned_minutes') &&
    hasNumber(value, 'available_minutes') &&
    hasNumber(value, 'utilization_percent')
  );
}

function isCapacityStaffLoad(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'user_id') &&
    hasString(value, 'display_name') &&
    isOneOf(Object.values(UserRole), value.role) &&
    hasNumber(value, 'planned_minutes') &&
    hasNumber(value, 'available_minutes') &&
    hasNumber(value, 'utilization_percent') &&
    hasNumber(value, 'active_card_count')
  );
}

function isCapacityBottleneck(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'bottleneck_code') &&
    hasString(value, 'label') &&
    isOneOf(Object.values(BlockerSeverity), value.severity) &&
    hasNumber(value, 'affected_count') &&
    hasOptionalNumber(value, 'over_minutes')
  );
}

function isCardSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'card_id') &&
    isOneOf(Object.values(CardType), value.card_type) &&
    hasString(value, 'patient_name') &&
    hasOptionalString(value, 'facility_name') &&
    hasOptionalString(value, 'room') &&
    hasOptionalString(value, 'visit_time') &&
    hasOptionalString(value, 'visit_date') &&
    hasOptionalString(value, 'service_date') &&
    hasOptionalString(value, 'due_at') &&
    hasOptionalString(value, 'updated_at') &&
    hasOptionalNumber(value, 'stale_minutes') &&
    hasOptionalNumber(value, 'urgency_rank') &&
    isOneOf(Object.values(CurrentStep), value.current_step) &&
    isOneOf(Object.values(DisplayStatus), value.display_status) &&
    hasOptionalString(value, 'assigned_user') &&
    hasNumber(value, 'server_version') &&
    everyArrayItem(value, 'tags', isTag) &&
    optionalArrayEvery(value, 'quick_filter_keys', (item) =>
      isOneOf(Object.values(BoardQuickFilter), item),
    ) &&
    optionalArrayEvery(value, 'triage_lanes', (item) => isOneOf(Object.values(TriageLane), item)) &&
    optionalArrayEvery(value, 'search_texts', isString)
  );
}

function isNextAction(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(Object.values(ActionCode), value.code) &&
    isOneOf(Object.values(ActionKind), value.kind) &&
    hasString(value, 'label_key') &&
    hasOptionalString(value, 'disabled_reason_key') &&
    typeof value.enabled === 'boolean' &&
    typeof value.offline_allowed === 'boolean' &&
    isOneOf(['PRIMARY', 'SECONDARY', 'DANGER', 'INFO'], value.priority) &&
    everyArrayItem(value, 'required_role', (item) => isOneOf(Object.values(UserRole), item)) &&
    hasString(value, 'target_endpoint') &&
    isOneOf(Object.values(ButtonState), value.ui_state) &&
    typeof value.can_user_handle === 'boolean' &&
    hasOptionalBoolean(value, 'reason_required')
  );
}

function isCardBoardItem(value: unknown): boolean {
  return isRecord(value) && isCardSummary(value.card) && isNextAction(value.next_action);
}

function isClaimCandidate(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'candidate_id') &&
    hasString(value, 'card_id') &&
    hasString(value, 'patient_name') &&
    hasString(value, 'fee_code') &&
    hasString(value, 'fee_label') &&
    hasString(value, 'billing_month') &&
    isOneOf(Object.values(ClaimCandidateStatus), value.status) &&
    hasString(value, 'status_label') &&
    everyArrayItem(value, 'missing_evidence_keys', isString) &&
    everyArrayItem(value, 'evidence_requirements', isEvidenceRequirement) &&
    hasString(value, 'rule_version_id') &&
    hasNumber(value, 'priority_rank') &&
    everyArrayItem(value, 'source_refs', isSourceRef) &&
    hasString(value, 'created_at') &&
    hasString(value, 'updated_at') &&
    hasNumber(value, 'server_version')
  );
}

function isFeeRule(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'rule_id') &&
    hasString(value, 'rule_version_id') &&
    hasString(value, 'fee_code') &&
    hasString(value, 'fee_label') &&
    isOneOf(['SYSTEM', 'TENANT'], value.tenant_scope) &&
    hasString(value, 'revision_code') &&
    hasString(value, 'active_from') &&
    hasOptionalString(value, 'active_to') &&
    hasObject(value, 'condition') &&
    everyArrayItem(value, 'evidence_requirements', isEvidenceRequirement) &&
    everyArrayItem(value, 'source_refs', isSourceRef)
  );
}

function isHandoff(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'handoff_id') &&
    hasString(value, 'card_id') &&
    isOneOf(Object.values(HandoffStatus), value.status) &&
    hasString(value, 'reason_code') &&
    hasString(value, 'summary') &&
    everyArrayItem(value, 'source_refs', isSourceRef) &&
    isOptionalOneOf(Object.values(ActionCode), value.requested_action) &&
    isOneOf(Object.values(HandoffUrgency), value.urgency) &&
    hasOptionalString(value, 'related_blocker_code') &&
    hasString(value, 'created_by_user_id') &&
    hasOptionalString(value, 'assignee_user_id') &&
    hasString(value, 'created_at') &&
    hasString(value, 'updated_at') &&
    hasNumber(value, 'server_version') &&
    hasString(value, 'patient_name') &&
    hasNumber(value, 'age_minutes') &&
    hasOptionalString(value, 'return_reason_code') &&
    hasOptionalString(value, 'return_note') &&
    isOptionalOneOf(Object.values(ActionCode), value.resolved_action_code)
  );
}

function isReportDelivery(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'delivery_id') &&
    hasString(value, 'card_id') &&
    hasString(value, 'report_id') &&
    hasString(value, 'patient_name') &&
    hasString(value, 'target_label') &&
    isOneOf(Object.values(ReportDeliveryStatus), value.status) &&
    hasString(value, 'delivery_method') &&
    hasString(value, 'sent_at') &&
    hasNumber(value, 'stale_minutes') &&
    hasNumber(value, 'server_version') &&
    everyArrayItem(value, 'source_refs', isSourceRef)
  );
}

function isListResponse(value: unknown, itemPredicate?: (item: unknown) => boolean): boolean {
  return (
    isRecord(value) &&
    everyArrayItem(value, 'items', itemPredicate ?? (() => true)) &&
    hasString(value, 'server_time') &&
    hasOptionalNonEmptyString(value, 'next_cursor') &&
    hasOptionalNumber(value, 'total_estimate')
  );
}

function isMutationResponse(value: unknown, rootKey: string): boolean {
  return (
    isRecord(value) &&
    hasObject(value, rootKey) &&
    everyArrayItem(value, 'side_effects', isSideEffect) &&
    hasNumber(value, 'server_version')
  );
}

function isValidResponseContract(value: unknown, contract: ResponseContract): boolean {
  switch (contract) {
    case 'CardSearchResponse':
      return isListResponse(value, isCardBoardItem);
    case 'ClaimCandidateSearchResponse':
      return isListResponse(value, isClaimCandidate);
    case 'FeeRuleSearchResponse':
      return isListResponse(value, isFeeRule);
    case 'HandoffSearchResponse':
      return isListResponse(value, isHandoff);
    case 'ReportDeliverySearchResponse':
      return isListResponse(value, isReportDelivery);
    case 'ActionResponse':
      return (
        isRecord(value) &&
        isCardSummary(value.card) &&
        isNextAction(value.next_action) &&
        isOneOf(Object.values(DisplayStatus), value.display_status) &&
        everyArrayItem(value, 'blockers', isBlocker) &&
        optionalArrayEvery(value, 'visible_tabs', isTabKey) &&
        everyArrayItem(value, 'side_effects', isSideEffect) &&
        hasNumber(value, 'server_version')
      );
    case 'CardDetailResponse':
      return (
        isRecord(value) &&
        isCardSummary(value.card) &&
        everyArrayItem(value, 'visible_tabs', isTabKey) &&
        isPermissions(value.permissions) &&
        isNextAction(value.next_action) &&
        everyArrayItem(value, 'blockers', isBlocker) &&
        everyArrayItem(value, 'source_refs', isSourceRef) &&
        hasNumber(value, 'server_version')
      );
    case 'CapacityResponse':
      return (
        isRecord(value) &&
        hasString(value, 'date') &&
        isOneOf(Object.values(CapacityScope), value.scope) &&
        isOneOf(Object.values(CapacityStatus), value.status) &&
        hasNumber(value, 'total_planned_minutes') &&
        hasNumber(value, 'total_available_minutes') &&
        hasNumber(value, 'utilization_percent') &&
        everyArrayItem(value, 'work_buckets', isCapacityWorkBucket) &&
        everyArrayItem(value, 'staff_loads', isCapacityStaffLoad) &&
        everyArrayItem(value, 'bottlenecks', isCapacityBottleneck) &&
        hasString(value, 'server_time')
      );
    case 'ClaimCandidateMutationResponse':
      return (
        isMutationResponse(value, 'candidate') &&
        isRecord(value) &&
        isClaimCandidate(value.candidate)
      );
    case 'HandoffMutationResponse':
      return isMutationResponse(value, 'handoff') && isRecord(value) && isHandoff(value.handoff);
    case 'ReportDeliveryMutationResponse':
      return (
        isMutationResponse(value, 'delivery') && isRecord(value) && isReportDelivery(value.delivery)
      );
    case 'EvidencePresignUploadResponse':
      return (
        isRecord(value) &&
        hasString(value, 'request_id') &&
        hasString(value, 'evidence_id') &&
        hasString(value, 's3_key') &&
        hasString(value, 'upload_url') &&
        value.method === 'PUT' &&
        isStringRecord(value.headers) &&
        hasNumber(value, 'expires_in_seconds') &&
        hasNumber(value, 'max_size_bytes')
      );
    case 'VisitModeView':
      return (
        isRecord(value) &&
        hasString(value, 'packet_id') &&
        hasNumber(value, 'server_version') &&
        hasString(value, 'patient_name') &&
        hasOptionalString(value, 'card_id') &&
        hasOptionalString(value, 'assignee_user_id') &&
        optionalArrayEvery(value, 'support_user_ids', isString) &&
        hasOptionalString(value, 'facility') &&
        hasOptionalString(value, 'room') &&
        isOneOf(Object.values(VisitStatus), value.visit_status) &&
        everyArrayItem(value, 'applicable_steps', (item) =>
          isOneOf(Object.values(VisitStepValue), item),
        ) &&
        everyArrayItem(value, 'required_steps', (item) =>
          isOneOf(Object.values(VisitStepValue), item),
        ) &&
        hasObject(value, 'step_completed') &&
        Object.values(value.step_completed as Record<string, unknown>).every(
          (stepComplete) => typeof stepComplete === 'boolean',
        ) &&
        isOneOf(Object.values(VisitStepValue), value.last_opened_step) &&
        hasObject(value, 'evidence_sync') &&
        isNumber((value.evidence_sync as Record<string, unknown>).blocking_unsynced_count) &&
        isNumber((value.evidence_sync as Record<string, unknown>).non_blocking_unsynced_count) &&
        optionalArrayEvery(value, 'blockers', isBlocker) &&
        typeof value.online === 'boolean'
      );
  }
}

export function createPhosApiClient(options: CreatePhosApiClientOptions): PhosApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(input: {
    path: string;
    method: 'GET' | 'POST';
    responseContract: ResponseContract;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
  }): Promise<T> {
    const token = await options.getAccessToken?.();
    const correlationId = options.correlationId?.();
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(input.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    };

    const response = await fetchImpl(buildUrl(baseUrl, input.path, input.query), {
      method: input.method,
      headers,
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
    const parsed = await readJsonResponse(response);
    if (!response.ok) {
      if (isErrorResponse(parsed.payload)) throw new PhosApiError(response.status, parsed.payload);
      throw new PhosApiError(
        response.status,
        invalidResponseError(response.status, parsed, input.responseContract),
      );
    }
    if (parsed.invalid_json) {
      throw new PhosApiError(
        response.status,
        invalidResponseError(response.status, parsed, input.responseContract),
      );
    }
    if (!isValidResponseContract(parsed.payload, input.responseContract)) {
      throw new PhosApiError(
        response.status,
        invalidResponseError(response.status, parsed, input.responseContract),
      );
    }
    return parsed.payload as T;
  }

  return {
    getCards(query?: PhosCardsQuery) {
      const route = routeInfo('GET /cards');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query,
      });
    },
    getCapacity(query: PhosCapacityQuery) {
      const route = routeInfo('GET /capacity');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query: query satisfies { date: string; scope: CapacityScope },
      });
    },
    getClaimCandidates(query: PhosClaimCandidatesQuery = {}) {
      const route = routeInfo('GET /claim-candidates');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query: query satisfies {
          card_id?: string;
          status?: string;
          cursor?: string;
          limit?: number;
        },
      });
    },
    excludeClaimCandidate(candidate_id: string, excludeRequest: ExcludeClaimCandidateRequest) {
      const route = routeInfo('POST /claim-candidates/{candidate_id}/exclude', { candidate_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: excludeRequest,
      });
    },
    getFeeRules(query: { fee_code?: string; cursor?: string; limit?: number } = {}) {
      const route = routeInfo('GET /fee-rules');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query,
      });
    },
    getCardDetail(card_id: string) {
      const route = routeInfo('GET /cards/{card_id}', { card_id });
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
      });
    },
    executeCardAction(card_id: string, actionRequest: ActionRequest) {
      const route = routeInfo('POST /cards/{card_id}/actions', { card_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: actionRequest,
      });
    },
    getVisitMode(packet_id: string) {
      const route = routeInfo('GET /visit-packets/{packet_id}/visit-mode', { packet_id });
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
      });
    },
    updateVisitStep(packet_id: string, step: VisitStep, visitRequest: VisitStepMutationRequest) {
      const route = routeInfo('POST /visit-packets/{packet_id}/visit-steps/{step}', {
        packet_id,
        step,
      });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: visitRequest,
      });
    },
    presignEvidenceUpload(uploadRequest: EvidenceUploadRequest) {
      const route = routeInfo('POST /evidence/presign-upload');
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: uploadRequest,
      });
    },
    getHandoffs(query) {
      const route = routeInfo('GET /handoffs');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query,
      });
    },
    getReportDeliveries(query: PhosReportDeliveriesQuery = {}) {
      const route = routeInfo('GET /report-deliveries');
      return request({
        method: 'GET',
        path: route.path,
        responseContract: route.response_contract,
        query: query satisfies {
          status?: ReportDeliveryStatus;
          cursor?: string;
          limit?: number;
        },
      });
    },
    registerReportReply(delivery_id: string, reportReplyRequest: RegisterReportReplyRequest) {
      const route = routeInfo('POST /report-deliveries/{delivery_id}/reply', { delivery_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: reportReplyRequest,
      });
    },
    markReportActionDone(
      delivery_id: string,
      reportActionDoneRequest: MarkReportActionDoneRequest,
    ) {
      const route = routeInfo('POST /report-deliveries/{delivery_id}/action-done', {
        delivery_id,
      });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: reportActionDoneRequest,
      });
    },
    createHandoff(handoffRequest: CreateHandoffRequest) {
      const route = routeInfo('POST /handoffs');
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: handoffRequest,
      });
    },
    openHandoff(handoff_id: string, handoffRequest: OpenHandoffRequest) {
      const route = routeInfo('POST /handoffs/{handoff_id}/open', { handoff_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: handoffRequest,
      });
    },
    resolveHandoff(handoff_id: string, handoffRequest: ResolveHandoffRequest) {
      const route = routeInfo('POST /handoffs/{handoff_id}/resolve', { handoff_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: handoffRequest,
      });
    },
    returnHandoff(handoff_id: string, handoffRequest: ReturnHandoffRequest) {
      const route = routeInfo('POST /handoffs/{handoff_id}/return', { handoff_id });
      return request({
        method: 'POST',
        path: route.path,
        responseContract: route.response_contract,
        body: handoffRequest,
      });
    },
  };
}
