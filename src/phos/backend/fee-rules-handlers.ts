import { UserRole, type ErrorResponse } from '@/phos/contracts/phos_contracts';
import { assertAllowedRole, assertRequiredScopes, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
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
  assertRequiredScopes(ctx, ['phos/fee-rules.read']);
  assertAllowedRole(ctx, [
    UserRole.PHARMACIST,
    UserRole.PHARMACY_CLERK,
    UserRole.MANAGER,
    UserRole.ADMIN,
  ]);
}

export function createFeeRuleSearchHandler(repository: PhosFeeRulesRepository): PhosHandler {
  return async ({ event, ctx }) => {
    try {
      assertFeeRuleReadAccess(ctx);
      return await repository.searchFeeRules(ctx, parseSearchQuery(event));
    } catch (error) {
      if (error instanceof PhosDomainError) return domainErrorResponse(ctx, error);
      if (error instanceof PhosAuthorizationError)
        return domainErrorResponse(ctx, forbiddenError(error));
      throw error;
    }
  };
}
