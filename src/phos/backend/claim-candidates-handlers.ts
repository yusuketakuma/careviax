import {
  ClaimCandidateStatus,
  type ErrorResponse,
  type ExcludeClaimCandidateRequest,
} from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import {
  parseBoundedIntegerQuery,
  parseIdempotencyKey,
  parsePositiveVersion,
  readQueryParam,
  validationError,
} from './input-validation';
import type {
  ClaimCandidateSearchQuery,
  PhosClaimCandidatesRepository,
} from './claim-candidates-repository';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

export const CLAIM_CANDIDATE_DEFAULT_LIMIT = 50;
export const CLAIM_CANDIDATE_MAX_LIMIT = 50;

function readCandidateId(event: PhosHttpEvent): string | null {
  const value = event.pathParameters?.candidate_id ?? event.pathParameters?.candidateId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseSearchQuery(event: PhosHttpEvent): ClaimCandidateSearchQuery {
  const limit = parseBoundedIntegerQuery({
    value: readQueryParam(event, 'limit'),
    field: 'limit',
    defaultValue: CLAIM_CANDIDATE_DEFAULT_LIMIT,
    max: CLAIM_CANDIDATE_MAX_LIMIT,
  });
  const status = readQueryParam(event, 'status') as ClaimCandidateStatus | undefined;
  if (status && !Object.values(ClaimCandidateStatus).includes(status)) {
    throw validationError({ field: 'status' });
  }
  return {
    ...(readQueryParam(event, 'card_id') ? { card_id: readQueryParam(event, 'card_id') } : {}),
    ...(status ? { status } : {}),
    ...(readQueryParam(event, 'cursor') ? { cursor: readQueryParam(event, 'cursor') } : {}),
    limit,
  };
}

function parseExcludeRequest(body: unknown): ExcludeClaimCandidateRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<ExcludeClaimCandidateRequest>;
  if (typeof input.reason_code !== 'string' || input.reason_code.trim().length === 0) {
    throw validationError({ field: 'reason_code' });
  }
  return {
    reason_code: input.reason_code.trim(),
    ...(typeof input.reason_note === 'string' && input.reason_note.trim().length > 0
      ? { reason_note: input.reason_note.trim() }
      : {}),
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
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

function assertClaimCandidateReadAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'GET /claim-candidates');
}

function assertClaimCandidateWriteAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'POST /claim-candidates/{candidate_id}/exclude');
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
      message: 'PH-OS claim-candidates handler failed',
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
  candidate_id?: string;
}) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS claim-candidates handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
      ...(input.candidate_id ? { candidate_id: input.candidate_id } : {}),
    }),
  );
}

function withClaimCandidateErrors(route_key: string, ctx: TenantContext, error: unknown) {
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

export function createClaimCandidateSearchHandler(
  repository: PhosClaimCandidatesRepository,
): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /claim-candidates';
    try {
      assertClaimCandidateReadAccess(ctx);
      const response = await repository.searchClaimCandidates(ctx, parseSearchQuery(event));
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
      return withClaimCandidateErrors(route_key, ctx, error);
    }
  };
}

export function createExcludeClaimCandidateHandler(
  repository: PhosClaimCandidatesRepository,
): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = event.routeKey ?? 'POST /claim-candidates/{candidate_id}/exclude';
    try {
      assertClaimCandidateWriteAccess(ctx);
      const candidate_id = readCandidateId(event);
      if (!candidate_id) throw validationError({ field: 'candidate_id' });
      const response = await repository.excludeClaimCandidate(
        ctx,
        candidate_id,
        parseExcludeRequest(body),
      );
      logHandlerSuccess({ ctx, route_key, candidate_id });
      return response;
    } catch (error) {
      return withClaimCandidateErrors(route_key, ctx, error);
    }
  };
}
