import { DynamoDBClient, type DynamoDBClient as AwsDynamoDBClient } from '@aws-sdk/client-dynamodb';
import * as xray from 'aws-xray-sdk-core';
import {
  createConsoleObservabilitySink,
  lowCardinalityTraceAnnotation,
  type PhosObservabilitySink,
  type PhosSecurityEvent,
  type PhosTraceAnnotation,
  type PhosTraceAnnotationSink,
} from './observability';
import { recordDynamoSecurityEvent } from './security-events';

export type PhosLambdaRuntimeDependencies = {
  observability?: PhosObservabilitySink;
  security_event_client?: Pick<AwsDynamoDBClient, 'send'>;
  security_event_table_name?: string;
  trace_annotation_sink?: PhosTraceAnnotationSink;
  now?: () => Date;
};

function shouldPersistSecurityEvents(): boolean {
  return process.env.PHOS_SECURITY_EVENTS_DYNAMO === '1';
}

function securityEventTableName(deps: PhosLambdaRuntimeDependencies): string | undefined {
  return deps.security_event_table_name ?? process.env.PHOS_SECURITY_EVENT_TABLE_NAME?.trim();
}

export function createLambdaObservabilitySink(
  deps: PhosLambdaRuntimeDependencies = {},
): PhosObservabilitySink {
  if (deps.observability) return deps.observability;
  const consoleSink = createConsoleObservabilitySink({
    trace_annotation_sink: deps.trace_annotation_sink ?? createXRayTraceAnnotationSink(),
  });
  const securityEventClient =
    deps.security_event_client ?? (shouldPersistSecurityEvents() ? new DynamoDBClient({}) : null);
  const pendingSecurityEvents = new Set<Promise<void>>();

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
              tenant_id: event.tenant_id ?? 'UNKNOWN',
              user_id: event.user_id ?? 'UNKNOWN',
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
      await Promise.allSettled([...pendingSecurityEvents]);
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
