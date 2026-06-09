import type {
  ActionRequest,
  CapacityScope,
  CreateHandoffRequest,
  ErrorResponse,
  ExcludeClaimCandidateRequest,
  EvidenceUploadRequest,
  OpenHandoffRequest,
  ReportDeliveryStatus,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
  MarkReportActionDoneRequest,
  RegisterReportReplyRequest,
  VisitStep,
  VisitStepMutationRequest,
} from '@/phos/contracts/phos_contracts';
import { ActionCode, ActionKind, ButtonState } from '@/phos/contracts/phos_contracts';
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

function hasOptionalNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isNumber(record[key]);
}

function isOneOf(values: readonly string[], value: unknown): boolean {
  return isString(value) && values.includes(value);
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

function isCardSummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'card_id') &&
    hasString(value, 'card_type') &&
    hasString(value, 'patient_name') &&
    hasString(value, 'current_step') &&
    hasString(value, 'display_status') &&
    hasNumber(value, 'server_version') &&
    hasArray(value, 'tags')
  );
}

function isNextAction(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOneOf(Object.values(ActionCode), value.code) &&
    isOneOf(Object.values(ActionKind), value.kind) &&
    hasString(value, 'label_key') &&
    typeof value.enabled === 'boolean' &&
    typeof value.offline_allowed === 'boolean' &&
    isOneOf(['PRIMARY', 'SECONDARY', 'DANGER', 'INFO'], value.priority) &&
    hasArray(value, 'required_role') &&
    hasString(value, 'target_endpoint') &&
    isOneOf(Object.values(ButtonState), value.ui_state) &&
    typeof value.can_user_handle === 'boolean'
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
    hasString(value, 'status') &&
    hasString(value, 'status_label') &&
    hasArray(value, 'missing_evidence_keys') &&
    hasArray(value, 'evidence_requirements') &&
    hasString(value, 'rule_version_id') &&
    hasNumber(value, 'priority_rank') &&
    hasArray(value, 'source_refs') &&
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
    hasString(value, 'tenant_scope') &&
    hasString(value, 'revision_code') &&
    hasString(value, 'active_from') &&
    hasObject(value, 'condition') &&
    hasArray(value, 'evidence_requirements') &&
    hasArray(value, 'source_refs')
  );
}

function isHandoff(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasString(value, 'handoff_id') &&
    hasString(value, 'card_id') &&
    hasString(value, 'status') &&
    hasString(value, 'reason_code') &&
    hasString(value, 'summary') &&
    hasArray(value, 'source_refs') &&
    hasString(value, 'urgency') &&
    hasString(value, 'created_by_user_id') &&
    hasString(value, 'created_at') &&
    hasString(value, 'updated_at') &&
    hasNumber(value, 'server_version') &&
    hasString(value, 'patient_name') &&
    hasNumber(value, 'age_minutes')
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
    hasString(value, 'status') &&
    hasString(value, 'delivery_method') &&
    hasString(value, 'sent_at') &&
    hasNumber(value, 'stale_minutes') &&
    hasNumber(value, 'server_version') &&
    hasArray(value, 'source_refs')
  );
}

function isListResponse(value: unknown, itemPredicate?: (item: unknown) => boolean): boolean {
  return (
    isRecord(value) &&
    everyArrayItem(value, 'items', itemPredicate ?? (() => true)) &&
    hasString(value, 'server_time') &&
    hasOptionalString(value, 'next_cursor') &&
    hasOptionalNumber(value, 'total_estimate')
  );
}

function isMutationResponse(value: unknown, rootKey: string): boolean {
  return (
    isRecord(value) &&
    hasObject(value, rootKey) &&
    hasArray(value, 'side_effects') &&
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
        hasString(value, 'display_status') &&
        hasArray(value, 'blockers') &&
        hasArray(value, 'side_effects') &&
        hasNumber(value, 'server_version')
      );
    case 'CardDetailResponse':
      return (
        isRecord(value) &&
        isCardSummary(value.card) &&
        hasArray(value, 'visible_tabs') &&
        hasObject(value, 'permissions') &&
        isNextAction(value.next_action) &&
        hasArray(value, 'blockers') &&
        hasArray(value, 'source_refs') &&
        hasNumber(value, 'server_version')
      );
    case 'CapacityResponse':
      return (
        isRecord(value) &&
        hasString(value, 'date') &&
        hasString(value, 'scope') &&
        hasString(value, 'status') &&
        hasNumber(value, 'total_planned_minutes') &&
        hasNumber(value, 'total_available_minutes') &&
        hasNumber(value, 'utilization_percent') &&
        hasArray(value, 'work_buckets') &&
        hasArray(value, 'staff_loads') &&
        hasArray(value, 'bottlenecks') &&
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
        hasString(value, 'visit_status') &&
        hasArray(value, 'applicable_steps') &&
        hasArray(value, 'required_steps') &&
        hasObject(value, 'step_completed') &&
        hasString(value, 'last_opened_step') &&
        hasObject(value, 'evidence_sync') &&
        isNumber((value.evidence_sync as Record<string, unknown>).blocking_unsynced_count) &&
        isNumber((value.evidence_sync as Record<string, unknown>).non_blocking_unsynced_count) &&
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
