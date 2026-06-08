import type { ErrorResponse } from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { FeeRuleSearchQuery, PhosFeeRulesRepository } from './fee-rules-repository';
import type { TenantContext } from './tenant-context';

export const FEE_RULE_DEFAULT_LIMIT = 50;
export const FEE_RULE_MAX_LIMIT = 50;

function readQueryParam(event: PhosHttpEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function validationError(details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 400,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  });
}

function parseSearchQuery(event: PhosHttpEvent): FeeRuleSearchQuery {
  const rawLimit = readQueryParam(event, 'limit');
  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : FEE_RULE_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FEE_RULE_MAX_LIMIT) {
    throw validationError({ field: 'limit', max: FEE_RULE_MAX_LIMIT });
  }
  return {
    ...(readQueryParam(event, 'fee_code') ? { fee_code: readQueryParam(event, 'fee_code') } : {}),
    ...(readQueryParam(event, 'cursor') ? { cursor: readQueryParam(event, 'cursor') } : {}),
    limit,
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

function assertFeeRuleReadAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'GET /fee-rules');
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
      message: 'PH-OS fee-rules handler failed',
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
      message: 'PH-OS fee-rules handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
    }),
  );
}

function withFeeRuleErrors(route_key: string, ctx: TenantContext, error: unknown) {
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

export function createFeeRuleSearchHandler(repository: PhosFeeRulesRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /fee-rules';
    try {
      assertFeeRuleReadAccess(ctx);
      const response = await repository.searchFeeRules(ctx, parseSearchQuery(event));
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
      return withFeeRuleErrors(route_key, ctx, error);
    }
  };
}
