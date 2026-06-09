import { CapacityScope, type ErrorResponse } from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import type { CapacityQuery, PhosCapacityRepository } from './capacity-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import { parseDateKeyQuery, readQueryParam, validationError } from './input-validation';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

function parseCapacityQuery(event: PhosHttpEvent): CapacityQuery {
  const date = parseDateKeyQuery(readQueryParam(event, 'date'));

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
      assertRouteAccess(ctx, 'GET /capacity');
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
