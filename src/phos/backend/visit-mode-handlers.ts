import {
  VisitArrivalOutcome,
  VisitStep,
  type ErrorResponse,
  type VisitStepMutationPayload,
  type VisitStepMutationRequest,
} from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';
import type { PhosVisitModeRepository } from './visit-mode-repository';

function readPathParam(event: PhosHttpEvent, key: string): string | null {
  const value = event.pathParameters?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validationError(details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 400,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  });
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

function parsePositiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw validationError({ field: 'client_version' });
  }
  return Number(value);
}

function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError({ field: 'idempotency_key' });
  }
  return value.trim();
}

function parseStep(event: PhosHttpEvent): VisitStep {
  const value = readPathParam(event, 'step');
  if (!value || !Object.values(VisitStep).includes(value as VisitStep)) {
    throw validationError({ field: 'step', allowed_values: Object.values(VisitStep) });
  }
  return value as VisitStep;
}

function parsePacketId(event: PhosHttpEvent): string {
  const value = readPathParam(event, 'packet_id');
  if (!value) throw validationError({ field: 'packet_id' });
  return value;
}

function parsePayload(value: unknown): VisitStepMutationPayload | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError({ field: 'payload' });
  }
  const input = value as Partial<VisitStepMutationPayload>;
  return {
    ...(input.arrival_outcome ? { arrival_outcome: input.arrival_outcome } : {}),
    ...(typeof input.reason_code === 'string' ? { reason_code: input.reason_code.trim() } : {}),
    ...(typeof input.reason_note === 'string' ? { reason_note: input.reason_note.trim() } : {}),
    ...(typeof input.evidence_key === 'string' ? { evidence_key: input.evidence_key.trim() } : {}),
  };
}

function parseMutationRequest(step: VisitStep, body: unknown): VisitStepMutationRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<VisitStepMutationRequest>;
  const payload = parsePayload(input.payload);

  if (step === VisitStep.ARRIVAL_CONFIRM) {
    const outcome = payload?.arrival_outcome;
    if (!Object.values(VisitArrivalOutcome).includes(outcome as VisitArrivalOutcome)) {
      throw validationError({ field: 'payload.arrival_outcome' });
    }
    if (
      outcome === VisitArrivalOutcome.CANCELED &&
      !payload?.reason_code &&
      !payload?.reason_note
    ) {
      throw validationError({ field: 'payload.reason_note', reason: 'required_for_canceled' });
    }
  } else if (payload?.arrival_outcome) {
    throw validationError({
      field: 'payload.arrival_outcome',
      allowed_step: VisitStep.ARRIVAL_CONFIRM,
    });
  }

  return {
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
    ...(payload ? { payload } : {}),
  };
}

function assertVisitReadAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'GET /visit-packets/{packet_id}/visit-mode');
}

function assertVisitWriteAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'POST /visit-packets/{packet_id}/visit-steps/{step}');
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
      message: 'PH-OS visit-mode handler failed',
      ctx: input.ctx,
      route_key: input.route_key,
      error_code: input.error_code,
      details: input.details,
    }),
  );
}

function logHandlerSuccess(input: { ctx: TenantContext; route_key: string; packet_id: string }) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS visit-mode handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
      details: { packet_id: input.packet_id },
    }),
  );
}

function withVisitErrors(route_key: string, ctx: TenantContext, error: unknown) {
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

export function createGetVisitModeHandler(repository: PhosVisitModeRepository): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /visit-packets/{packet_id}/visit-mode';
    try {
      assertVisitReadAccess(ctx);
      const packet_id = parsePacketId(event);
      const response = await repository.getVisitMode(ctx, packet_id);
      if (!response) {
        return domainErrorResponse(
          ctx,
          new PhosDomainError({
            status: 404,
            error_code: 'NOT_FOUND',
            message_key: 'api.error.visit_packet_not_found',
            details: { packet_id },
          }),
        );
      }
      logHandlerSuccess({ ctx, route_key, packet_id });
      return response;
    } catch (error) {
      return withVisitErrors(route_key, ctx, error);
    }
  };
}

export function createUpdateVisitStepHandler(repository: PhosVisitModeRepository): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = event.routeKey ?? 'POST /visit-packets/{packet_id}/visit-steps/{step}';
    try {
      assertVisitWriteAccess(ctx);
      const packet_id = parsePacketId(event);
      const step = parseStep(event);
      const response = await repository.updateVisitStep(
        ctx,
        packet_id,
        step,
        parseMutationRequest(step, body),
      );
      logHandlerSuccess({ ctx, route_key, packet_id });
      return response;
    } catch (error) {
      return withVisitErrors(route_key, ctx, error);
    }
  };
}
