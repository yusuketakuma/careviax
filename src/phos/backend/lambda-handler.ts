import { randomUUID } from 'node:crypto';
import { toErrorLambdaResponse, toLambdaJsonResponse } from './error-response';
import type { PhosLambdaResponse } from './error-response';
import {
  createConsoleObservabilitySink,
  hashTenantId,
  type PhosObservabilitySink,
} from './observability';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import {
  assertTenantIdNotInExternalInput,
  buildTenantContext,
  TenantContextError,
} from './tenant-context';
import type { TenantContext, JwtClaims } from './tenant-context';

export type PhosHttpEvent = {
  version?: string;
  routeKey?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  pathParameters?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  requestContext?: {
    requestId?: string;
    authorizer?: {
      jwt?: {
        claims?: JwtClaims;
      };
    };
  };
};

export type PhosHandlerInput = {
  event: PhosHttpEvent;
  ctx: TenantContext;
  body: unknown;
};

export type PhosHandler = (input: PhosHandlerInput) => Promise<unknown | PhosLambdaResponse>;

export type PhosLambdaOptions = {
  observability?: PhosObservabilitySink;
  now?: () => Date;
};

function readHeader(
  headers: Record<string, string | undefined> | undefined,
  key: string,
): string | undefined {
  const target = key.toLowerCase();
  const found = Object.entries(headers ?? {}).find(
    ([headerKey]) => headerKey.toLowerCase() === target,
  );
  return found?.[1];
}

function parseJsonBody(body: string | null | undefined, request_id: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    throw new TenantContextError(400, {
      request_id,
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.invalid_json',
    });
  }
}

function isLambdaResponse(value: unknown): value is PhosLambdaResponse {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PhosLambdaResponse).statusCode === 'number' &&
    typeof (value as PhosLambdaResponse).body === 'string'
  );
}

function routeKey(event: PhosHttpEvent): string {
  return event.routeKey ?? event.rawPath ?? 'UNKNOWN_ROUTE';
}

function emitBoundaryObservability(input: {
  observability: PhosObservabilitySink;
  event: PhosHttpEvent;
  ctx?: TenantContext;
  request_id: string;
  correlation_id: string;
  error_code: string;
  details?: Record<string, unknown>;
}) {
  const route_key = routeKey(input.event);
  if (input.error_code === 'TENANT_ID_IN_PAYLOAD_FORBIDDEN') {
    input.observability.emitMetric({
      name: 'TenantBoundaryRejectedCount',
      value: 1,
      unit: 'Count',
      route_key,
      ...(input.ctx
        ? {
            tenant_id: input.ctx.tenant_id,
            user_id: input.ctx.user_id,
          }
        : {}),
      request_id: input.request_id,
      correlation_id: input.correlation_id,
      error_code: input.error_code,
    });
    input.observability.emitMetric({
      name: 'CrossTenantAttemptCount',
      value: 1,
      unit: 'Count',
      route_key,
      ...(input.ctx
        ? {
            tenant_id: input.ctx.tenant_id,
            user_id: input.ctx.user_id,
          }
        : {}),
      request_id: input.request_id,
      correlation_id: input.correlation_id,
      error_code: input.error_code,
    });
    input.observability.recordSecurityEvent({
      event_type: 'TENANT_BOUNDARY_REJECTED',
      severity: 'ERROR',
      ...(input.ctx ? { tenant_id: input.ctx.tenant_id, user_id: input.ctx.user_id } : {}),
      request_id: input.request_id,
      correlation_id: input.correlation_id,
      route_key,
      error_code: input.error_code,
      details: input.details,
    });
  }
  if (input.error_code === 'INTERNAL_ERROR') {
    input.observability.emitMetric({
      name: 'InternalErrorCount',
      value: 1,
      unit: 'Count',
      route_key,
      ...(input.ctx
        ? {
            tenant_id: input.ctx.tenant_id,
            user_id: input.ctx.user_id,
          }
        : {}),
      request_id: input.request_id,
      correlation_id: input.correlation_id,
      error_code: input.error_code,
    });
  }
  input.observability.annotateTrace({
    route_key,
    ...(input.ctx ? { tenant_id_hash: hashTenantId(input.ctx.tenant_id) } : {}),
    error_code: input.error_code,
  });
}

async function flushObservability(observability: PhosObservabilitySink): Promise<void> {
  try {
    await observability.flush?.();
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'PHOS_OBSERVABILITY_FLUSH_FAILED',
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
}

function emitSuccessObservability(input: {
  observability: PhosObservabilitySink;
  event: PhosHttpEvent;
  ctx: TenantContext;
  latency_ms: number;
}) {
  const route_key = routeKey(input.event);
  input.observability.emitMetric({
    name: 'RequestLatencyMs',
    value: input.latency_ms,
    unit: 'Milliseconds',
    route_key,
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
  });
  input.observability.annotateTrace({
    route_key,
    tenant_id_hash: hashTenantId(input.ctx.tenant_id),
  });
}

function logBoundaryError(input: {
  event: PhosHttpEvent;
  ctx?: TenantContext;
  request_id: string;
  correlation_id: string;
  error_code: string;
  details?: Record<string, unknown>;
}) {
  if (input.ctx) {
    logPhosEvent(
      buildLogEntry({
        level: 'ERROR',
        message: 'PH-OS lambda boundary failed',
        ctx: input.ctx,
        route_key: routeKey(input.event),
        error_code: input.error_code,
        details: input.details,
      }),
    );
    return;
  }

  logPhosEvent({
    level: 'ERROR',
    message: 'PH-OS lambda boundary failed before tenant context',
    tenant_id: 'UNKNOWN',
    user_id: 'UNKNOWN',
    request_id: input.request_id,
    correlation_id: input.correlation_id,
    route_key: routeKey(input.event),
    error_code: input.error_code,
    ...(input.details ? { details: input.details } : {}),
  });
}

export function withTenantContext(handler: PhosHandler, options: PhosLambdaOptions = {}) {
  return async (event: PhosHttpEvent) => {
    const observability = options.observability ?? createConsoleObservabilitySink();
    const start = options.now?.() ?? new Date();
    const request_id = event.requestContext?.requestId ?? randomUUID();
    const correlation_id = readHeader(event.headers, 'x-correlation-id') ?? request_id;
    let ctx: TenantContext | undefined;

    try {
      const body = parseJsonBody(event.body, request_id);
      assertTenantIdNotInExternalInput({
        request_id,
        body,
        query: event.queryStringParameters,
        path: event.pathParameters,
      });

      ctx = buildTenantContext({
        claims: event.requestContext?.authorizer?.jwt?.claims ?? {},
        request_id,
        correlation_id,
        observability,
      });

      const result = await handler({ event, ctx, body });
      emitSuccessObservability({
        observability,
        event,
        ctx,
        latency_ms: (options.now?.() ?? new Date()).getTime() - start.getTime(),
      });
      const response = isLambdaResponse(result) ? result : toLambdaJsonResponse(200, result);
      await flushObservability(observability);
      return response;
    } catch (error) {
      if (error instanceof TenantContextError) {
        logBoundaryError({
          event,
          ctx,
          request_id,
          correlation_id,
          error_code: error.response.error_code,
          details: error.response.details,
        });
        emitBoundaryObservability({
          observability,
          event,
          ctx,
          request_id,
          correlation_id,
          error_code: error.response.error_code,
          details: error.response.details,
        });
        await flushObservability(observability);
        return toErrorLambdaResponse(error.status, error.response);
      }

      logBoundaryError({
        event,
        ctx,
        request_id,
        correlation_id,
        error_code: 'INTERNAL_ERROR',
      });
      emitBoundaryObservability({
        observability,
        event,
        ctx,
        request_id,
        correlation_id,
        error_code: 'INTERNAL_ERROR',
      });
      await flushObservability(observability);
      return toErrorLambdaResponse(500, {
        request_id,
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.internal',
      });
    }
  };
}
