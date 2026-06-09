import { ActionCode, BoardQuickFilter, BoardSortKey } from '@/phos/contracts/phos_contracts';
import type { ActionRequest, ActionResponse, ErrorResponse } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { hashTenantId } from './observability';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import type { CardSearchQuery, PhosCardsRepository } from './cards-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';
import { toErrorLambdaResponse } from './error-response';
import {
  parseBoundedIntegerQuery,
  parseIdempotencyKey,
  parsePositiveVersion,
  readQueryParam,
  validationError,
} from './input-validation';

export const CARD_SEARCH_DEFAULT_LIMIT = 50;
export const CARD_SEARCH_MAX_LIMIT = 50;
const CARD_ACTION_ROUTE_KEY = 'POST /cards/{card_id}/actions';

type ParsedCardAction = ActionRequest & {
  action_code: ActionCode;
};

function readCardId(event: PhosHttpEvent): string | null {
  const value = event.pathParameters?.card_id ?? event.pathParameters?.cardId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function assertExpectedRouteKey(event: PhosHttpEvent, expectedRouteKey: string): void {
  if (!event.routeKey || event.routeKey === expectedRouteKey) return;
  throw validationError({ field: 'routeKey', expected: expectedRouteKey });
}

function parseSearchQuery(event: PhosHttpEvent): CardSearchQuery {
  const limit = parseBoundedIntegerQuery({
    value: readQueryParam(event, 'limit'),
    field: 'limit',
    defaultValue: CARD_SEARCH_DEFAULT_LIMIT,
    max: CARD_SEARCH_MAX_LIMIT,
  });
  const filter = readQueryParam(event, 'filter');
  if (filter && !Object.values(BoardQuickFilter).includes(filter as BoardQuickFilter)) {
    throw validationError({ field: 'filter', allowed_values: Object.values(BoardQuickFilter) });
  }
  const sort = readQueryParam(event, 'sort');
  if (sort && !Object.values(BoardSortKey).includes(sort as BoardSortKey)) {
    throw validationError({ field: 'sort', allowed_values: Object.values(BoardSortKey) });
  }

  return {
    query: readQueryParam(event, 'query'),
    filter: filter as BoardQuickFilter | undefined,
    sort: sort as BoardSortKey | undefined,
    cursor: readQueryParam(event, 'cursor'),
    limit,
  };
}

function parseActionPayload(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError({ field: 'payload' });
  }
  const payload = value as Record<string, unknown>;
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function parseActionRequest(body: unknown): ParsedCardAction {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }

  const input = body as Partial<ActionRequest>;
  const actionCode = input.action_code;

  if (!Object.values(ActionCode).includes(actionCode as ActionCode)) {
    throw validationError({ field: 'action_code' });
  }

  const transition = ACTION_TRANSITION_MATRIX[actionCode as ActionCode];
  const reasonCode = typeof input.reason_code === 'string' ? input.reason_code.trim() : undefined;
  const reasonNote = typeof input.reason_note === 'string' ? input.reason_note.trim() : undefined;
  const payload = parseActionPayload(input.payload);
  const reasonRequired = 'reason_required' in transition && transition.reason_required === true;
  if (reasonRequired && !reasonCode) {
    throw validationError({
      field: 'reason_code',
      action_code: actionCode,
      reason_required: true,
    });
  }

  return {
    action_code: actionCode as ActionCode,
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
    ...(payload ? { payload } : {}),
    ...(reasonCode ? { reason_code: reasonCode } : {}),
    ...(reasonNote ? { reason_note: reasonNote } : {}),
  };
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

function logHandlerError(input: {
  ctx: TenantContext;
  route_key: string;
  error_code: string;
  details?: Record<string, unknown>;
}) {
  logPhosEvent(
    buildLogEntry({
      level: 'ERROR',
      message: 'PH-OS cards handler failed',
      ctx: input.ctx,
      route_key: input.route_key,
      error_code: input.error_code,
      details: input.details,
    }),
  );
}

function logHandlerSuccess(input: {
  ctx: TenantContext;
  route_key: string;
  action_code?: ActionCode;
  card_id?: string;
}) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS cards handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
      ...(input.action_code ? { action_code: input.action_code } : {}),
      ...(input.card_id ? { card_id: input.card_id } : {}),
    }),
  );
}

function emitActionObservability(input: {
  ctx: TenantContext;
  route_key: string;
  action_code: ActionCode;
  started_at_ms: number;
  current_step?: ActionResponse['card']['current_step'];
  error_code?: string;
}) {
  const latency_ms = Math.max(0, Date.now() - input.started_at_ms);
  input.ctx.observability?.emitMetric({
    name: 'ActionLatencyMs',
    value: latency_ms,
    unit: 'Milliseconds',
    route_key: input.route_key,
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
    action_code: input.action_code,
    ...(input.error_code ? { error_code: input.error_code } : {}),
  });
  input.ctx.observability?.annotateTrace({
    route_key: input.route_key,
    tenant_id_hash: hashTenantId(input.ctx.tenant_id),
    action_code: input.action_code,
    ...(input.current_step ? { current_step: input.current_step } : {}),
    ...(input.error_code ? { error_code: input.error_code } : {}),
  });
}

function emitActionFailureMetrics(input: {
  ctx: TenantContext;
  route_key: string;
  action_code: ActionCode;
  error_code: string;
}) {
  if (input.error_code === 'ACTION_GUARD_FAILED') {
    input.ctx.observability?.emitMetric({
      name: 'ActionGuardFailedCount',
      value: 1,
      unit: 'Count',
      route_key: input.route_key,
      tenant_id: input.ctx.tenant_id,
      user_id: input.ctx.user_id,
      request_id: input.ctx.request_id,
      correlation_id: input.ctx.correlation_id,
      action_code: input.action_code,
      error_code: input.error_code,
    });
  }
  if (input.action_code === ActionCode.SEND_REPORT) {
    input.ctx.observability?.emitMetric({
      name: 'ReportSendFailedCount',
      value: 1,
      unit: 'Count',
      route_key: input.route_key,
      tenant_id: input.ctx.tenant_id,
      user_id: input.ctx.user_id,
      request_id: input.ctx.request_id,
      correlation_id: input.ctx.correlation_id,
      action_code: input.action_code,
      error_code: input.error_code,
    });
  }
}

export function createCardSearchHandler(repository: PhosCardsRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /cards';
    try {
      assertRouteAccess(ctx, route_key);
      const query = parseSearchQuery(event);
      const response = await repository.searchCards(ctx, query);
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
      if (error instanceof PhosDomainError) {
        logHandlerError({
          ctx,
          route_key,
          error_code: error.error_code,
          details: error.details,
        });
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
  };
}

export function createCardDetailHandler(repository: PhosCardsRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /cards/{card_id}';
    try {
      assertRouteAccess(ctx, route_key);
      const card_id = readCardId(event);
      if (!card_id) {
        throw validationError({ field: 'card_id' });
      }

      const detail = await repository.getCardDetail(ctx, card_id);
      if (!detail) {
        throw new PhosDomainError({
          status: 404,
          error_code: 'NOT_FOUND',
          message_key: 'api.error.card_not_found',
          details: { card_id },
        });
      }
      logHandlerSuccess({ ctx, route_key, card_id });
      return detail;
    } catch (error) {
      if (error instanceof PhosDomainError) {
        logHandlerError({
          ctx,
          route_key,
          error_code: error.error_code,
          details: error.details,
        });
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
  };
}

export function createExecuteCardActionHandler(repository: PhosCardsRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = CARD_ACTION_ROUTE_KEY;
    const card_id = readCardId(event);
    if (!card_id) {
      return domainErrorResponse(ctx, validationError({ field: 'card_id' }));
    }

    let action_code: ActionCode | undefined;
    let started_at_ms = 0;
    try {
      assertExpectedRouteKey(event, route_key);
      assertRouteAccess(ctx, route_key);
      const request = parseActionRequest(body);
      action_code = request.action_code;
      started_at_ms = Date.now();
      const response = await repository.executeCardAction(ctx, card_id, request);
      emitActionObservability({
        ctx,
        route_key,
        action_code: request.action_code,
        current_step: response.card.current_step,
        started_at_ms,
      });
      logHandlerSuccess({
        ctx,
        route_key,
        card_id,
        action_code: request.action_code,
      });
      return response;
    } catch (error) {
      if (error instanceof PhosDomainError) {
        if (action_code && started_at_ms > 0) {
          emitActionObservability({
            ctx,
            route_key,
            action_code,
            started_at_ms,
            error_code: error.error_code,
          });
          emitActionFailureMetrics({
            ctx,
            route_key,
            action_code,
            error_code: error.error_code,
          });
        }
        logHandlerError({
          ctx,
          route_key,
          error_code: error.error_code,
          details: error.details,
        });
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
  };
}
