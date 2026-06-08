import { ActionCode } from '@/phos/contracts/phos_contracts';
import type { ActionRequest, ErrorResponse } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import type { CardSearchQuery, PhosCardsRepository } from './cards-repository';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';
import { toErrorLambdaResponse } from './error-response';

export const CARD_SEARCH_DEFAULT_LIMIT = 50;
export const CARD_SEARCH_MAX_LIMIT = 50;

type ParsedCardAction = ActionRequest & {
  action_code: ActionCode;
};

function readQueryParam(event: PhosHttpEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readCardId(event: PhosHttpEvent): string | null {
  const value = event.pathParameters?.card_id ?? event.pathParameters?.cardId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validationError(ctx: TenantContext, details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 400,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  });
}

function parseSearchQuery(ctx: TenantContext, event: PhosHttpEvent): CardSearchQuery {
  const rawLimit = readQueryParam(event, 'limit');
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : CARD_SEARCH_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CARD_SEARCH_MAX_LIMIT) {
    throw validationError(ctx, {
      field: 'limit',
      max: CARD_SEARCH_MAX_LIMIT,
    });
  }

  return {
    query: readQueryParam(event, 'query'),
    filter: readQueryParam(event, 'filter'),
    sort: readQueryParam(event, 'sort'),
    cursor: readQueryParam(event, 'cursor'),
    limit,
  };
}

function parseActionRequest(ctx: TenantContext, body: unknown): ParsedCardAction {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError(ctx, { field: 'body' });
  }

  const input = body as Partial<ActionRequest>;
  const actionCode = input.action_code;
  const idempotencyKey = input.idempotency_key;
  const clientVersion = input.client_version;

  if (!Object.values(ActionCode).includes(actionCode as ActionCode)) {
    throw validationError(ctx, { field: 'action_code' });
  }
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw validationError(ctx, { field: 'idempotency_key' });
  }
  if (!Number.isSafeInteger(clientVersion) || Number(clientVersion) < 1) {
    throw validationError(ctx, { field: 'client_version' });
  }

  const transition = ACTION_TRANSITION_MATRIX[actionCode as ActionCode];
  const reasonRequired = 'reason_required' in transition && transition.reason_required === true;
  if (
    reasonRequired &&
    (typeof input.reason_code !== 'string' || input.reason_code.trim().length === 0)
  ) {
    throw validationError(ctx, {
      field: 'reason_code',
      action_code: actionCode,
      reason_required: true,
    });
  }

  return {
    action_code: actionCode as ActionCode,
    idempotency_key: idempotencyKey.trim(),
    client_version: Number(clientVersion),
    ...(input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? { payload: input.payload }
      : {}),
    ...(typeof input.reason_code === 'string' ? { reason_code: input.reason_code.trim() } : {}),
    ...(typeof input.reason_note === 'string' ? { reason_note: input.reason_note } : {}),
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

export function createCardSearchHandler(repository: PhosCardsRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /cards';
    try {
      assertRouteAccess(ctx, route_key);
      const query = parseSearchQuery(ctx, event);
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
        throw validationError(ctx, { field: 'card_id' });
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
    const route_key = event.routeKey ?? 'POST /cards/{card_id}/actions';
    const card_id = readCardId(event);
    if (!card_id) {
      return domainErrorResponse(ctx, validationError(ctx, { field: 'card_id' }));
    }

    try {
      assertRouteAccess(ctx, route_key);
      const request = parseActionRequest(ctx, body);
      const response = await repository.executeCardAction(ctx, card_id, request);
      logHandlerSuccess({
        ctx,
        route_key,
        card_id,
        action_code: request.action_code,
      });
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
