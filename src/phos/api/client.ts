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
import { findPhosRoute } from '@/phos/infra/api-gateway-routes';
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

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  return JSON.parse(text);
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

function routePath(routeKey: string, params: Record<string, string> = {}): string {
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
  return path;
}

export function createPhosApiClient(options: CreatePhosApiClientOptions): PhosApiClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(input: {
    path: string;
    method: 'GET' | 'POST';
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
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      if (isErrorResponse(payload)) throw new PhosApiError(response.status, payload);
      throw new PhosApiError(response.status, {
        request_id: '',
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.invalid_response',
        details: { status: response.status },
      });
    }
    return payload as T;
  }

  return {
    getCards(query?: PhosCardsQuery) {
      return request({ method: 'GET', path: routePath('GET /cards'), query });
    },
    getCapacity(query: PhosCapacityQuery) {
      return request({
        method: 'GET',
        path: routePath('GET /capacity'),
        query: query satisfies { date: string; scope: CapacityScope },
      });
    },
    getClaimCandidates(query: PhosClaimCandidatesQuery = {}) {
      return request({
        method: 'GET',
        path: routePath('GET /claim-candidates'),
        query: query satisfies {
          card_id?: string;
          status?: string;
          cursor?: string;
          limit?: number;
        },
      });
    },
    excludeClaimCandidate(candidate_id: string, excludeRequest: ExcludeClaimCandidateRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /claim-candidates/{candidate_id}/exclude', { candidate_id }),
        body: excludeRequest,
      });
    },
    getFeeRules(query: { fee_code?: string; cursor?: string; limit?: number } = {}) {
      return request({
        method: 'GET',
        path: routePath('GET /fee-rules'),
        query,
      });
    },
    getCardDetail(card_id: string) {
      return request({ method: 'GET', path: routePath('GET /cards/{card_id}', { card_id }) });
    },
    executeCardAction(card_id: string, actionRequest: ActionRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /cards/{card_id}/actions', { card_id }),
        body: actionRequest,
      });
    },
    getVisitMode(packet_id: string) {
      return request({
        method: 'GET',
        path: routePath('GET /visit-packets/{packet_id}/visit-mode', { packet_id }),
      });
    },
    updateVisitStep(packet_id: string, step: VisitStep, visitRequest: VisitStepMutationRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /visit-packets/{packet_id}/visit-steps/{step}', {
          packet_id,
          step,
        }),
        body: visitRequest,
      });
    },
    presignEvidenceUpload(uploadRequest: EvidenceUploadRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /evidence/presign-upload'),
        body: uploadRequest,
      });
    },
    getHandoffs(query) {
      return request({ method: 'GET', path: routePath('GET /handoffs'), query });
    },
    getReportDeliveries(query: PhosReportDeliveriesQuery = {}) {
      return request({
        method: 'GET',
        path: routePath('GET /report-deliveries'),
        query: query satisfies {
          status?: ReportDeliveryStatus;
          cursor?: string;
          limit?: number;
        },
      });
    },
    registerReportReply(delivery_id: string, reportReplyRequest: RegisterReportReplyRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /report-deliveries/{delivery_id}/reply', { delivery_id }),
        body: reportReplyRequest,
      });
    },
    markReportActionDone(
      delivery_id: string,
      reportActionDoneRequest: MarkReportActionDoneRequest,
    ) {
      return request({
        method: 'POST',
        path: routePath('POST /report-deliveries/{delivery_id}/action-done', { delivery_id }),
        body: reportActionDoneRequest,
      });
    },
    createHandoff(handoffRequest: CreateHandoffRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /handoffs'),
        body: handoffRequest,
      });
    },
    openHandoff(handoff_id: string, handoffRequest: OpenHandoffRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /handoffs/{handoff_id}/open', { handoff_id }),
        body: handoffRequest,
      });
    },
    resolveHandoff(handoff_id: string, handoffRequest: ResolveHandoffRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /handoffs/{handoff_id}/resolve', { handoff_id }),
        body: handoffRequest,
      });
    },
    returnHandoff(handoff_id: string, handoffRequest: ReturnHandoffRequest) {
      return request({
        method: 'POST',
        path: routePath('POST /handoffs/{handoff_id}/return', { handoff_id }),
        body: handoffRequest,
      });
    },
  };
}
