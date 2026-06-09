import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type {
  CreateHandoffRequest,
  ErrorResponse,
  HandoffSearchQuery,
  OpenHandoffRequest,
  ResolveHandoffRequest,
  ReturnHandoffRequest,
} from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import {
  parseBoundedIntegerQuery,
  parseIdempotencyKey,
  parsePositiveVersion,
  parseSourceRefs,
  readQueryParam,
  validationError,
} from './input-validation';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import type { PhosHandoffsRepository } from './handoffs-repository';
import { hashTenantId } from './observability';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

export const HANDOFF_SEARCH_DEFAULT_LIMIT = 50;
export const HANDOFF_SEARCH_MAX_LIMIT = 50;
const HANDOFF_SEARCH_ROUTE_KEY = 'GET /handoffs';
const HANDOFF_CREATE_ROUTE_KEY = 'POST /handoffs';
const HANDOFF_RESOLVE_ROUTE_KEY = 'POST /handoffs/{handoff_id}/resolve';
const HANDOFF_OPEN_ROUTE_KEY = 'POST /handoffs/{handoff_id}/open';
const HANDOFF_RETURN_ROUTE_KEY = 'POST /handoffs/{handoff_id}/return';

function readHandoffId(event: PhosHttpEvent): string | null {
  const value = event.pathParameters?.handoff_id ?? event.pathParameters?.handoffId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function assertExpectedRouteKey(event: PhosHttpEvent, expectedRouteKey: string): void {
  if (!event.routeKey || event.routeKey === expectedRouteKey) return;
  throw validationError({ field: 'routeKey', expected: expectedRouteKey });
}

function domainErrorResponse(ctx: TenantContext, error: PhosDomainError) {
  const response: ErrorResponse = {
    request_id: ctx.request_id,
    error_code: error.error_code,
    message_key: error.message_key,
    ...(error.details ? { details: error.details } : {}),
  };
  return toErrorLambdaResponse(error.status, response);
}

function forbiddenError(error: PhosAuthorizationError): PhosDomainError {
  return new PhosDomainError({
    status: 403,
    error_code: 'FORBIDDEN',
    message_key: 'api.error.forbidden',
    details: error.details,
  });
}

function parseSearchQuery(event: PhosHttpEvent): HandoffSearchQuery {
  const limit = parseBoundedIntegerQuery({
    value: readQueryParam(event, 'limit'),
    field: 'limit',
    defaultValue: HANDOFF_SEARCH_DEFAULT_LIMIT,
    max: HANDOFF_SEARCH_MAX_LIMIT,
  });

  const status = readQueryParam(event, 'status');
  if (status && !Object.values(HandoffStatus).includes(status as HandoffStatus)) {
    throw validationError({ field: 'status' });
  }

  return {
    ...(status ? { status: status as HandoffStatus } : {}),
    ...(readQueryParam(event, 'assignee') ? { assignee: readQueryParam(event, 'assignee') } : {}),
    ...(readQueryParam(event, 'cursor') ? { cursor: readQueryParam(event, 'cursor') } : {}),
    limit,
  };
}

function parseCreateRequest(body: unknown): CreateHandoffRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<CreateHandoffRequest>;
  if (typeof input.card_id !== 'string' || input.card_id.trim().length === 0) {
    throw validationError({ field: 'card_id' });
  }
  if (typeof input.reason_code !== 'string' || input.reason_code.trim().length === 0) {
    throw validationError({ field: 'reason_code' });
  }
  if (typeof input.summary !== 'string' || input.summary.trim().length === 0) {
    throw validationError({ field: 'summary' });
  }
  if (!Object.values(HandoffUrgency).includes(input.urgency as HandoffUrgency)) {
    throw validationError({ field: 'urgency' });
  }
  if (
    input.requested_action !== undefined &&
    !Object.values(ActionCode).includes(input.requested_action as ActionCode)
  ) {
    throw validationError({ field: 'requested_action' });
  }
  const assignee_user_id =
    typeof input.assignee_user_id === 'string' ? input.assignee_user_id.trim() : undefined;
  if (input.assignee_user_id !== undefined && !assignee_user_id) {
    throw validationError({ field: 'assignee_user_id' });
  }

  return {
    card_id: input.card_id.trim(),
    reason_code: input.reason_code.trim(),
    summary: input.summary.trim(),
    source_refs: parseSourceRefs(input.source_refs, { requireNonEmpty: true }) ?? [],
    urgency: input.urgency as HandoffUrgency,
    ...(input.requested_action ? { requested_action: input.requested_action } : {}),
    ...(assignee_user_id ? { assignee_user_id } : {}),
    ...(typeof input.related_blocker_code === 'string'
      ? { related_blocker_code: input.related_blocker_code.trim() }
      : {}),
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function parseResolveRequest(body: unknown): ResolveHandoffRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<ResolveHandoffRequest>;
  if (!Object.values(ActionCode).includes(input.resolved_action_code as ActionCode)) {
    throw validationError({ field: 'resolved_action_code' });
  }
  return {
    resolved_action_code: input.resolved_action_code as ActionCode,
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function parseOpenRequest(body: unknown): OpenHandoffRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<OpenHandoffRequest>;
  return {
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function parseReturnRequest(body: unknown): ReturnHandoffRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<ReturnHandoffRequest>;
  if (
    typeof input.return_reason_code !== 'string' ||
    input.return_reason_code.trim().length === 0
  ) {
    throw validationError({ field: 'return_reason_code' });
  }
  if (typeof input.return_note !== 'string' || input.return_note.trim().length === 0) {
    throw validationError({ field: 'return_note' });
  }
  return {
    return_reason_code: input.return_reason_code.trim(),
    return_note: input.return_note.trim(),
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function assertHandoffReadAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, HANDOFF_SEARCH_ROUTE_KEY);
}

function assertHandoffCreateAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, HANDOFF_CREATE_ROUTE_KEY);
}

function assertHandoffMutationAccess(ctx: TenantContext, route_key: string) {
  assertRouteAccess(ctx, route_key);
}

function logHandlerError(input: {
  ctx: TenantContext;
  route_key: string;
  error_code: string;
  details?: Record<string, unknown>;
}) {
  logPhosEvent(
    buildLogEntry({
      level: 'ERROR',
      message: 'PH-OS handoffs handler failed',
      ctx: input.ctx,
      route_key: input.route_key,
      error_code: input.error_code,
      details: input.details,
    }),
  );
}

function logHandlerSuccess(input: { ctx: TenantContext; route_key: string; handoff_id?: string }) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS handoffs handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
      ...(input.handoff_id ? { handoff_id: input.handoff_id } : {}),
    }),
  );
}

function emitHandoffReturnedMetric(input: { ctx: TenantContext; route_key: string }) {
  input.ctx.observability?.emitMetric({
    name: 'HandoffReturnedCount',
    value: 1,
    unit: 'Count',
    route_key: input.route_key,
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
  });
  input.ctx.observability?.annotateTrace({
    route_key: input.route_key,
    tenant_id_hash: hashTenantId(input.ctx.tenant_id),
  });
}

function withHandoffErrors(route_key: string, ctx: TenantContext, error: unknown) {
  if (error instanceof PhosDomainError) {
    logHandlerError({ ctx, route_key, error_code: error.error_code, details: error.details });
    return domainErrorResponse(ctx, error);
  }
  if (error instanceof PhosAuthorizationError) {
    const forbidden = forbiddenError(error);
    logHandlerError({
      ctx,
      route_key,
      error_code: forbidden.error_code,
      details: forbidden.details,
    });
    return domainErrorResponse(ctx, forbidden);
  }
  throw error;
}

export function createHandoffSearchHandler(repository: PhosHandoffsRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = HANDOFF_SEARCH_ROUTE_KEY;
    try {
      assertExpectedRouteKey(event, route_key);
      assertHandoffReadAccess(ctx);
      const response = await repository.searchHandoffs(ctx, parseSearchQuery(event));
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
      return withHandoffErrors(route_key, ctx, error);
    }
  };
}

export function createCreateHandoffHandler(repository: PhosHandoffsRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = HANDOFF_CREATE_ROUTE_KEY;
    try {
      assertExpectedRouteKey(event, route_key);
      assertHandoffCreateAccess(ctx);
      const response = await repository.createHandoff(ctx, parseCreateRequest(body));
      logHandlerSuccess({ ctx, route_key, handoff_id: response.handoff.handoff_id });
      return response;
    } catch (error) {
      return withHandoffErrors(route_key, ctx, error);
    }
  };
}

export function createResolveHandoffHandler(repository: PhosHandoffsRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = HANDOFF_RESOLVE_ROUTE_KEY;
    const handoff_id = readHandoffId(event);
    if (!handoff_id) return domainErrorResponse(ctx, validationError({ field: 'handoff_id' }));
    try {
      assertExpectedRouteKey(event, route_key);
      assertHandoffMutationAccess(ctx, route_key);
      const response = await repository.resolveHandoff(ctx, handoff_id, parseResolveRequest(body));
      logHandlerSuccess({ ctx, route_key, handoff_id });
      return response;
    } catch (error) {
      return withHandoffErrors(route_key, ctx, error);
    }
  };
}

export function createOpenHandoffHandler(repository: PhosHandoffsRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = HANDOFF_OPEN_ROUTE_KEY;
    const handoff_id = readHandoffId(event);
    if (!handoff_id) return domainErrorResponse(ctx, validationError({ field: 'handoff_id' }));
    try {
      assertExpectedRouteKey(event, route_key);
      assertHandoffMutationAccess(ctx, route_key);
      const response = await repository.openHandoff(ctx, handoff_id, parseOpenRequest(body));
      logHandlerSuccess({ ctx, route_key, handoff_id });
      return response;
    } catch (error) {
      return withHandoffErrors(route_key, ctx, error);
    }
  };
}

export function createReturnHandoffHandler(repository: PhosHandoffsRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = HANDOFF_RETURN_ROUTE_KEY;
    const handoff_id = readHandoffId(event);
    if (!handoff_id) return domainErrorResponse(ctx, validationError({ field: 'handoff_id' }));
    try {
      assertExpectedRouteKey(event, route_key);
      assertHandoffMutationAccess(ctx, route_key);
      const response = await repository.returnHandoff(ctx, handoff_id, parseReturnRequest(body));
      emitHandoffReturnedMetric({ ctx, route_key });
      logHandlerSuccess({ ctx, route_key, handoff_id });
      return response;
    } catch (error) {
      return withHandoffErrors(route_key, ctx, error);
    }
  };
}
