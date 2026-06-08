import { CapacityScope, type ErrorResponse } from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import type { CapacityQuery, PhosCapacityRepository } from './capacity-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

function readQueryParam(event: PhosHttpEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function validationError(details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 400,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  });
}

function parseCapacityQuery(event: PhosHttpEvent): CapacityQuery {
  const date = readQueryParam(event, 'date');
  if (!date || !isValidDateKey(date)) {
    throw validationError({ field: 'date', expected: 'YYYY-MM-DD' });
  }

  const scope = readQueryParam(event, 'scope') ?? CapacityScope.PHARMACY;
  if (!Object.values(CapacityScope).includes(scope as CapacityScope)) {
    throw validationError({ field: 'scope', allowed_values: Object.values(CapacityScope) });
  }

  return { date, scope: scope as CapacityScope };
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

function assertCapacityReadAccess(ctx: TenantContext, query: CapacityQuery) {
  assertRouteAccess(ctx, 'GET /capacity');
  if (query.scope === CapacityScope.ME && !ctx.user_id) {
    throw validationError({ field: 'scope', reason: 'missing_user_context' });
  }
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
      message: 'PH-OS capacity handler failed',
      ctx: input.ctx,
      route_key: input.route_key,
      error_code: input.error_code,
      details: input.details,
    }),
  );
}

function logHandlerSuccess(input: { ctx: TenantContext; route_key: string }) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS capacity handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
    }),
  );
}

export function createCapacityHandler(repository: PhosCapacityRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /capacity';
    try {
      const query = parseCapacityQuery(event);
      assertCapacityReadAccess(ctx, query);
      const response = await repository.getCapacity(ctx, query);
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
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
  };
}
