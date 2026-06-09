import { createHash } from 'node:crypto';
import type { ActionCode, CurrentStep } from '@/phos/contracts/phos_contracts';
import { sanitizeLogDetails } from './structured-logger';

export const PHOS_METRICS_NAMESPACE = 'PHOS/Backend';

export const P0_REQUIRED_METRIC_NAMES = [
  'ActionLatencyMs',
  'ActionGuardFailedCount',
  'TenantBoundaryRejectedCount',
  'CrossTenantAttemptCount',
  'VisitCompleteGuardBlockedCount',
  'EvidenceUploadFailedCount',
  'OfflineSyncConflictCount',
  'HandoffReturnedCount',
  'ReportSendFailedCount',
] as const;

export type PhosMetricName =
  | 'RequestLatencyMs'
  | 'ActionLatencyMs'
  | 'ActionGuardFailedCount'
  | 'AuthorizationDeniedCount'
  | 'TenantBoundaryRejectedCount'
  | 'CrossTenantAttemptCount'
  | 'VisitCompleteGuardBlockedCount'
  | 'EvidenceUploadFailedCount'
  | 'OfflineSyncConflictCount'
  | 'HandoffReturnedCount'
  | 'ReportSendFailedCount'
  | 'InternalErrorCount';

export type PhosMetricUnit = 'Count' | 'Milliseconds';

export type PhosMetric = {
  name: PhosMetricName;
  value: number;
  unit: PhosMetricUnit;
  route_key: string;
  tenant_id?: string;
  user_id?: string;
  request_id?: string;
  correlation_id?: string;
  error_code?: string;
  action_code?: ActionCode;
};

export type PhosTraceAnnotation = {
  route_key: string;
  tenant_id_hash?: string;
  action_code?: ActionCode;
  current_step?: CurrentStep;
  error_code?: string;
};

export type PhosTraceAnnotationSink = {
  annotateTrace(annotation: PhosTraceAnnotation): void;
};

export type PhosSecurityEvent = {
  event_type:
    | 'AUTHORIZATION_DENIED'
    | 'TENANT_BOUNDARY_REJECTED'
    | 'CROSS_TENANT_ATTEMPT'
    | 'EVIDENCE_UPLOAD_REJECTED';
  severity: 'WARNING' | 'ERROR';
  tenant_id?: string;
  user_id?: string;
  request_id: string;
  correlation_id: string;
  route_key: string;
  error_code: string;
  details?: Record<string, unknown>;
};

export type PhosObservabilitySink = {
  emitMetric(metric: PhosMetric): void;
  annotateTrace(annotation: PhosTraceAnnotation): void;
  recordSecurityEvent(event: PhosSecurityEvent): void;
  flush?(): Promise<void>;
};

export function hashTenantId(tenant_id: string): string {
  return createHash('sha256').update(tenant_id).digest('hex').slice(0, 16);
}

function metricDimensions(metric: PhosMetric): Record<string, string> {
  return {
    route_key: metric.route_key,
    ...(metric.error_code ? { error_code: metric.error_code } : {}),
    ...(metric.action_code ? { action_code: metric.action_code } : {}),
  };
}

export function buildCloudWatchEmbeddedMetric(metric: PhosMetric) {
  const dimensions = metricDimensions(metric);
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: PHOS_METRICS_NAMESPACE,
          Dimensions: [Object.keys(dimensions)],
          Metrics: [{ Name: metric.name, Unit: metric.unit }],
        },
      ],
    },
    ...dimensions,
    tenant_id: metric.tenant_id ?? 'UNKNOWN',
    user_id: metric.user_id ?? 'UNKNOWN',
    request_id: metric.request_id ?? 'UNKNOWN',
    correlation_id: metric.correlation_id ?? 'UNKNOWN',
    [metric.name]: metric.value,
  };
}

export function createConsoleObservabilitySink(
  options: {
    trace_annotation_sink?: PhosTraceAnnotationSink;
  } = {},
): PhosObservabilitySink {
  return {
    emitMetric(metric) {
      console.log(JSON.stringify(buildCloudWatchEmbeddedMetric(metric)));
    },
    annotateTrace(annotation) {
      options.trace_annotation_sink?.annotateTrace(annotation);
      console.log(
        JSON.stringify({
          type: 'PHOS_TRACE_ANNOTATION',
          ...annotation,
        }),
      );
    },
    recordSecurityEvent(event) {
      console.error(
        JSON.stringify({
          type: 'PHOS_SECURITY_EVENT',
          ...event,
          ...(event.tenant_id ? { tenant_id_hash: hashTenantId(event.tenant_id) } : {}),
          ...(event.details
            ? { details: sanitizeLogDetails(event.details) as Record<string, unknown> }
            : {}),
        }),
      );
    },
  };
}

export function createInMemoryObservabilitySink(): PhosObservabilitySink & {
  metrics: PhosMetric[];
  annotations: PhosTraceAnnotation[];
  security_events: PhosSecurityEvent[];
} {
  const metrics: PhosMetric[] = [];
  const annotations: PhosTraceAnnotation[] = [];
  const security_events: PhosSecurityEvent[] = [];
  return {
    metrics,
    annotations,
    security_events,
    emitMetric(metric) {
      metrics.push(metric);
    },
    annotateTrace(annotation) {
      annotations.push(annotation);
    },
    recordSecurityEvent(event) {
      security_events.push(event);
    },
  };
}
