import { DynamoDBClient, type DynamoDBClient as AwsDynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  createConsoleObservabilitySink,
  type PhosObservabilitySink,
  type PhosSecurityEvent,
} from './observability';
import { recordDynamoSecurityEvent } from './security-events';

export type PhosLambdaRuntimeDependencies = {
  observability?: PhosObservabilitySink;
  security_event_client?: Pick<AwsDynamoDBClient, 'send'>;
  security_event_table_name?: string;
  now?: () => Date;
};

function shouldPersistSecurityEvents(): boolean {
  return process.env.PHOS_SECURITY_EVENTS_DYNAMO === '1';
}

export function createLambdaObservabilitySink(
  deps: PhosLambdaRuntimeDependencies = {},
): PhosObservabilitySink {
  if (deps.observability) return deps.observability;
  const consoleSink = createConsoleObservabilitySink();
  const securityEventClient =
    deps.security_event_client ?? (shouldPersistSecurityEvents() ? new DynamoDBClient({}) : null);

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
      void recordDynamoSecurityEvent({
        client: securityEventClient,
        table_name: deps.security_event_table_name,
        event,
        now: deps.now,
      }).catch((error: unknown) => {
        console.error(
          JSON.stringify({
            type: 'PHOS_SECURITY_EVENT_PERSIST_FAILED',
            event_type: event.event_type,
            route_key: event.route_key,
            error: error instanceof Error ? error.message : 'unknown',
          }),
        );
      });
    },
  };
}
