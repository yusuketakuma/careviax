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
  resource?: string;
  httpMethod?: string;
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
      claims?: JwtClaims;
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

function withRequestIdHeader(response: PhosLambdaResponse, request_id: string): PhosLambdaResponse {
  return {
    ...response,
    headers: {
      ...response.headers,
      'X-Request-Id': response.headers['X-Request-Id'] || request_id,
    },
  };
}

function routeKey(event: PhosHttpEvent): string {
  if (event.routeKey) return event.routeKey;
  if (event.httpMethod && event.resource) return `${event.httpMethod} ${event.resource}`;
  return event.rawPath ?? 'UNKNOWN_ROUTE';
}

function authorizerClaims(event: PhosHttpEvent): JwtClaims {
  return (
    event.requestContext?.authorizer?.jwt?.claims ?? event.requestContext?.authorizer?.claims ?? {}
  );
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
    tenant_id: input.ctx?.tenant_id,
    user_id: input.ctx?.user_id,
    request_id: input.request_id,
    correlation_id: input.correlation_id,
    error_code: input.error_code,
  });
}

async function flushObservability(input: {
  observability: PhosObservabilitySink;
  ctx?: TenantContext;
  event: PhosHttpEvent;
  request_id: string;
  correlation_id: string;
}): Promise<void> {
  try {
    await input.observability.flush?.();
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'PHOS_OBSERVABILITY_FLUSH_FAILED',
        tenant_id: input.ctx?.tenant_id ?? 'UNKNOWN',
        user_id: input.ctx?.user_id ?? 'UNKNOWN',
        request_id: input.request_id,
        correlation_id: input.correlation_id,
        route_key: routeKey(input.event),
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
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
  });
}

function readResponseErrorCode(response: PhosLambdaResponse): string | undefined {
  if (response.statusCode < 400) return undefined;
  try {
    const parsed = JSON.parse(response.body) as { error_code?: unknown };
    return typeof parsed.error_code === 'string' ? parsed.error_code : undefined;
  } catch {
    return undefined;
  }
}

function logRequestCompleted(input: {
  event: PhosHttpEvent;
  ctx: TenantContext;
  response: PhosLambdaResponse;
  latency_ms: number;
}) {
  const error_code = readResponseErrorCode(input.response);
  logPhosEvent(
    buildLogEntry({
      level: input.response.statusCode >= 400 ? 'ERROR' : 'INFO',
      message: 'PH-OS lambda request completed',
      result: input.response.statusCode >= 400 ? 'ERROR' : 'SUCCESS',
      status_code: input.response.statusCode,
      ctx: input.ctx,
      route_key: routeKey(input.event),
      latency_ms: input.latency_ms,
      ...(error_code ? { error_code } : {}),
    }),
  );
}

function logBoundaryError(input: {
  event: PhosHttpEvent;
  ctx?: TenantContext;
  request_id: string;
  correlation_id: string;
  error_code: string;
  status_code: number;
  details?: Record<string, unknown>;
}) {
  if (input.ctx) {
    logPhosEvent(
      buildLogEntry({
        level: 'ERROR',
        message: 'PH-OS lambda boundary failed',
        result: 'ERROR',
        status_code: input.status_code,
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
    result: 'ERROR',
    status_code: input.status_code,
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
      ctx = buildTenantContext({
        claims: authorizerClaims(event),
        request_id,
        correlation_id,
        observability,
      });

      const body = parseJsonBody(event.body, request_id);
      assertTenantIdNotInExternalInput({
        request_id,
        body,
        query: event.queryStringParameters,
        path: event.pathParameters,
      });

      const result = await handler({ event, ctx, body });
      const latency_ms = (options.now?.() ?? new Date()).getTime() - start.getTime();
      emitSuccessObservability({
        observability,
        event,
        ctx,
        latency_ms,
      });
      const response = withRequestIdHeader(
        isLambdaResponse(result) ? result : toLambdaJsonResponse(200, result),
        ctx.request_id,
      );
      logRequestCompleted({
        event,
        ctx,
        response,
        latency_ms,
      });
      await flushObservability({
        observability,
        event,
        ctx,
        request_id,
        correlation_id,
      });
      return response;
    } catch (error) {
      if (error instanceof TenantContextError) {
        logBoundaryError({
          event,
          ctx,
          request_id,
          correlation_id,
          error_code: error.response.error_code,
          status_code: error.status,
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
        await flushObservability({
          observability,
          event,
          ctx,
          request_id,
          correlation_id,
        });
        return toErrorLambdaResponse(error.status, error.response);
      }

      logBoundaryError({
        event,
        ctx,
        request_id,
        correlation_id,
        error_code: 'INTERNAL_ERROR',
        status_code: 500,
      });
      emitBoundaryObservability({
        observability,
        event,
        ctx,
        request_id,
        correlation_id,
        error_code: 'INTERNAL_ERROR',
      });
      await flushObservability({
        observability,
        event,
        ctx,
        request_id,
        correlation_id,
      });
      return toErrorLambdaResponse(500, {
        request_id,
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.internal',
      });
    }
  };
}
