import type { DynamoDBClient as AwsDynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as xray from 'aws-xray-sdk-core';
import {
  createConsoleObservabilitySink,
  hashTenantId,
  hashUserId,
  lowCardinalityTraceAnnotation,
  type PhosObservabilitySink,
  type PhosSecurityEvent,
  type PhosTraceAnnotation,
  type PhosTraceAnnotationSink,
} from './observability';
import { recordDynamoSecurityEvent } from './security-events';
import { getDefaultPhosDynamoClient } from './phos-aws-clients';

export type PhosLambdaRuntimeDependencies = {
  observability?: PhosObservabilitySink;
  security_event_client?: Pick<AwsDynamoDBClient, 'send'>;
  security_event_table_name?: string;
  security_event_flush_timeout_ms?: number;
  trace_annotation_sink?: PhosTraceAnnotationSink;
  now?: () => Date;
};

const DEFAULT_SECURITY_EVENT_FLUSH_TIMEOUT_MS = 250;

function maybeUnrefTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout === 'object' && timeout && 'unref' in timeout) {
    (timeout as { unref?: () => void }).unref?.();
  }
}

function shouldPersistSecurityEvents(): boolean {
  return process.env.PHOS_SECURITY_EVENTS_DYNAMO === '1';
}

function securityEventTableName(deps: PhosLambdaRuntimeDependencies): string | undefined {
  return deps.security_event_table_name ?? process.env.PHOS_SECURITY_EVENT_TABLE_NAME?.trim();
}

function defaultSecurityEventClient(): Pick<AwsDynamoDBClient, 'send'> | null {
  if (!shouldPersistSecurityEvents()) return null;
  return getDefaultPhosDynamoClient();
}

export function createLambdaObservabilitySink(
  deps: PhosLambdaRuntimeDependencies = {},
): PhosObservabilitySink {
  if (deps.observability) return deps.observability;
  const consoleSink = createConsoleObservabilitySink({
    trace_annotation_sink: deps.trace_annotation_sink ?? createXRayTraceAnnotationSink(),
  });
  const securityEventClient = deps.security_event_client ?? defaultSecurityEventClient();
  const pendingSecurityEvents = new Set<Promise<void>>();
  const securityEventFlushTimeoutMs = Math.max(
    1,
    deps.security_event_flush_timeout_ms ?? DEFAULT_SECURITY_EVENT_FLUSH_TIMEOUT_MS,
  );

  return {
    emitMetric(metric) {
      consoleSink.emitMetric(metric);
    },
    annotateTrace(annotation) {
      consoleSink.annotateTrace(annotation);
    },
    recordSecurityEvent(event: PhosSecurityEvent) {
      consoleSink.recordSecurityEvent(event);
      if (!securityEventClient) return;
      const persistence = recordDynamoSecurityEvent({
        client: securityEventClient,
        table_name: securityEventTableName(deps),
        event,
        now: deps.now,
      })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              type: 'PHOS_SECURITY_EVENT_PERSIST_FAILED',
              event_type: event.event_type,
              route_key: event.route_key,
              tenant_id_hash: event.tenant_id ? hashTenantId(event.tenant_id) : 'UNKNOWN',
              user_id_hash: event.user_id ? hashUserId(event.user_id) : 'UNKNOWN',
              request_id: event.request_id,
              correlation_id: event.correlation_id,
              error: error instanceof Error ? error.message : 'unknown',
            }),
          );
        })
        .finally(() => {
          pendingSecurityEvents.delete(persistence);
        });
      pendingSecurityEvents.add(persistence);
    },
    async flush() {
      const pending = [...pendingSecurityEvents];
      if (pending.length === 0) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.allSettled(pending),
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              console.error(
                JSON.stringify({
                  type: 'PHOS_SECURITY_EVENT_FLUSH_TIMEOUT',
                  pending_count: pending.length,
                  timeout_ms: securityEventFlushTimeoutMs,
                }),
              );
              resolve();
            }, securityEventFlushTimeoutMs);
            maybeUnrefTimeout(timeout);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

export function createXRayTraceAnnotationSink(
  getSegment: () =>
    | {
        addAnnotation(key: string, value: string | number | boolean): void;
      }
    | undefined = xray.getSegment,
): PhosTraceAnnotationSink {
  xray.setContextMissingStrategy('IGNORE_ERROR');
  return {
    annotateTrace(annotation: PhosTraceAnnotation) {
      const segment = getSegment();
      if (!segment) return;
      for (const [key, value] of Object.entries(lowCardinalityTraceAnnotation(annotation))) {
        if (value === undefined) continue;
        segment.addAnnotation(key, value);
      }
    },
  };
}
