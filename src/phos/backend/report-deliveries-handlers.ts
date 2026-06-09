import {
  ReportDeliveryStatus,
  type ErrorResponse,
  type MarkReportActionDoneRequest,
  type RegisterReportReplyRequest,
} from '@/phos/contracts/phos_contracts';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { PhosDomainError } from './cards-repository';
import { toErrorLambdaResponse } from './error-response';
import {
  parseBoundedIntegerQuery,
  parseIdempotencyKey,
  parseOptionalIsoDate,
  parsePositiveVersion,
  parseSourceRefs,
  readQueryParam,
  validationError,
} from './input-validation';
import type { PhosHandler, PhosHttpEvent } from './lambda-handler';
import type {
  PhosReportDeliveriesRepository,
  ReportDeliverySearchQuery,
} from './report-deliveries-repository';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

export const REPORT_DELIVERY_DEFAULT_LIMIT = 50;
export const REPORT_DELIVERY_MAX_LIMIT = 50;

function readDeliveryId(event: PhosHttpEvent): string | null {
  const value = event.pathParameters?.delivery_id ?? event.pathParameters?.deliveryId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseRegisterReplyRequest(body: unknown): RegisterReportReplyRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<RegisterReportReplyRequest>;
  if (
    input.result_status !== ReportDeliveryStatus.REPLIED &&
    input.result_status !== ReportDeliveryStatus.ACTION_REQUIRED &&
    input.result_status !== ReportDeliveryStatus.ACTION_DONE
  ) {
    throw validationError({
      field: 'result_status',
      allowed_values: [
        ReportDeliveryStatus.REPLIED,
        ReportDeliveryStatus.ACTION_REQUIRED,
        ReportDeliveryStatus.ACTION_DONE,
      ],
    });
  }
  if (typeof input.reply_summary !== 'string' || input.reply_summary.trim().length === 0) {
    throw validationError({ field: 'reply_summary' });
  }
  if (
    input.result_status === ReportDeliveryStatus.ACTION_REQUIRED &&
    (typeof input.action_required_note !== 'string' ||
      input.action_required_note.trim().length === 0)
  ) {
    throw validationError({ field: 'action_required_note' });
  }
  const reply_received_at = parseOptionalIsoDate(input.reply_received_at, 'reply_received_at');
  const source_refs = parseSourceRefs(input.source_refs);

  return {
    result_status: input.result_status,
    reply_summary: input.reply_summary.trim(),
    ...(input.action_required_note
      ? { action_required_note: input.action_required_note.trim() }
      : {}),
    ...(reply_received_at ? { reply_received_at } : {}),
    ...(source_refs ? { source_refs } : {}),
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function parseMarkActionDoneRequest(body: unknown): MarkReportActionDoneRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError({ field: 'body' });
  }
  const input = body as Partial<MarkReportActionDoneRequest>;
  if (typeof input.action_note !== 'string' || input.action_note.trim().length === 0) {
    throw validationError({ field: 'action_note' });
  }
  return {
    action_note: input.action_note.trim(),
    idempotency_key: parseIdempotencyKey(input.idempotency_key),
    client_version: parsePositiveVersion(input.client_version),
  };
}

function parseSearchQuery(event: PhosHttpEvent): ReportDeliverySearchQuery {
  const limit = parseBoundedIntegerQuery({
    value: readQueryParam(event, 'limit'),
    field: 'limit',
    defaultValue: REPORT_DELIVERY_DEFAULT_LIMIT,
    max: REPORT_DELIVERY_MAX_LIMIT,
  });

  const status = readQueryParam(event, 'status') ?? ReportDeliveryStatus.WAITING_REPLY;
  if (!Object.values(ReportDeliveryStatus).includes(status as ReportDeliveryStatus)) {
    throw validationError({
      field: 'status',
      allowed_values: Object.values(ReportDeliveryStatus),
    });
  }

  return {
    status: status as ReportDeliveryStatus,
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

function assertReportDeliveryReadAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'GET /report-deliveries');
}

function assertReportDeliveryReplyAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'POST /report-deliveries/{delivery_id}/reply');
}

function assertReportDeliveryActionDoneAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'POST /report-deliveries/{delivery_id}/action-done');
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
      message: 'PH-OS report-deliveries handler failed',
      ctx: input.ctx,
      route_key: input.route_key,
      error_code: input.error_code,
      details: input.details,
    }),
  );
}

function logHandlerSuccess(input: { ctx: TenantContext; route_key: string; delivery_id?: string }) {
  logPhosEvent(
    buildLogEntry({
      level: 'INFO',
      message: 'PH-OS report-deliveries handler succeeded',
      ctx: input.ctx,
      route_key: input.route_key,
      ...(input.delivery_id ? { delivery_id: input.delivery_id } : {}),
    }),
  );
}

function withReportDeliveryErrors(route_key: string, ctx: TenantContext, error: unknown) {
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

export function createReportDeliverySearchHandler(
  repository: PhosReportDeliveriesRepository,
): PhosHandler {
  return async ({ event, ctx }) => {
    const route_key = event.routeKey ?? 'GET /report-deliveries';
    try {
      assertReportDeliveryReadAccess(ctx);
      const response = await repository.searchReportDeliveries(ctx, parseSearchQuery(event));
      logHandlerSuccess({ ctx, route_key });
      return response;
    } catch (error) {
      return withReportDeliveryErrors(route_key, ctx, error);
    }
  };
}

export function createRegisterReportReplyHandler(
  repository: PhosReportDeliveriesRepository,
): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = event.routeKey ?? 'POST /report-deliveries/{delivery_id}/reply';
    const delivery_id = readDeliveryId(event);
    if (!delivery_id) return domainErrorResponse(ctx, validationError({ field: 'delivery_id' }));
    try {
      assertReportDeliveryReplyAccess(ctx);
      const response = await repository.registerReportReply(
        ctx,
        delivery_id,
        parseRegisterReplyRequest(body),
      );
      logHandlerSuccess({ ctx, route_key, delivery_id });
      return response;
    } catch (error) {
      return withReportDeliveryErrors(route_key, ctx, error);
    }
  };
}

export function createMarkReportActionDoneHandler(
  repository: PhosReportDeliveriesRepository,
): PhosHandler {
  return async ({ event, ctx, body }) => {
    const route_key = event.routeKey ?? 'POST /report-deliveries/{delivery_id}/action-done';
    const delivery_id = readDeliveryId(event);
    if (!delivery_id) return domainErrorResponse(ctx, validationError({ field: 'delivery_id' }));
    try {
      assertReportDeliveryActionDoneAccess(ctx);
      const response = await repository.markReportActionDone(
        ctx,
        delivery_id,
        parseMarkActionDoneRequest(body),
      );
      logHandlerSuccess({ ctx, route_key, delivery_id });
      return response;
    } catch (error) {
      return withReportDeliveryErrors(route_key, ctx, error);
    }
  };
}
