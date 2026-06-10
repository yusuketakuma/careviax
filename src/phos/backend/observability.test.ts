import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCloudWatchEmbeddedMetric,
  createConsoleObservabilitySink,
  createInMemoryObservabilitySink,
  hashTenantId,
  hashUserId,
  P0_REQUIRED_METRIC_NAMES,
  PHOS_METRICS_NAMESPACE,
} from './observability';

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('PH-OS observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps every spec-required P0 CloudWatch metric in the metric contract', () => {
    expect([...P0_REQUIRED_METRIC_NAMES].sort()).toEqual(
      [
        'ActionLatencyMs',
        'ActionGuardFailedCount',
        'TenantBoundaryRejectedCount',
        'CrossTenantAttemptCount',
        'VisitCompleteGuardBlockedCount',
        'EvidenceUploadFailedCount',
        'OfflineSyncConflictCount',
        'HandoffReturnedCount',
        'ReportSendFailedCount',
      ].sort(),
    );
  });

  it('keeps every P0 metric wired to at least one emission source', () => {
    const emissionSources = {
      ActionLatencyMs: ['src/phos/backend/cards-handlers.ts'],
      ActionGuardFailedCount: ['src/phos/backend/cards-handlers.ts'],
      TenantBoundaryRejectedCount: ['src/phos/backend/lambda-handler.ts'],
      CrossTenantAttemptCount: ['src/phos/backend/lambda-handler.ts'],
      VisitCompleteGuardBlockedCount: ['src/phos/backend/visit-mode-lifecycle-repository.ts'],
      EvidenceUploadFailedCount: ['src/phos/backend/evidence-handlers.ts'],
      OfflineSyncConflictCount: ['src/phos/backend/cards-handlers.ts'],
      HandoffReturnedCount: ['src/phos/backend/handoffs-handlers.ts'],
      ReportSendFailedCount: ['src/phos/backend/cards-handlers.ts'],
    } satisfies Record<(typeof P0_REQUIRED_METRIC_NAMES)[number], string[]>;

    expect(Object.keys(emissionSources).sort()).toEqual([...P0_REQUIRED_METRIC_NAMES].sort());
    for (const metricName of P0_REQUIRED_METRIC_NAMES) {
      const source = emissionSources[metricName].map(readSource).join('\n');
      expect(source, metricName).toContain(`name: '${metricName}'`);
    }
  });

  it('builds CloudWatch embedded metrics in the PHOS backend namespace', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'TenantBoundaryRejectedCount',
      value: 1,
      unit: 'Count',
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
    });

    expect(metric._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: PHOS_METRICS_NAMESPACE,
      Metrics: [{ Name: 'TenantBoundaryRejectedCount', Unit: 'Count' }],
    });
    expect(metric).toMatchObject({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      user_id_hash: hashUserId('user_1'),
      request_id: 'req_1',
      correlation_id: 'corr_1',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      TenantBoundaryRejectedCount: 1,
    });
    expect(JSON.stringify(metric)).not.toContain('tenant_abc123');
    expect(JSON.stringify(metric)).not.toContain('user_1');
  });

  it('keeps correlation fields on CloudWatch EMF log events without using them as dimensions', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'RequestLatencyMs',
      value: 12,
      unit: 'Milliseconds',
      route_key: 'GET /cards',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
    });

    expect(metric).toMatchObject({
      route_key: 'GET /cards',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      user_id_hash: hashUserId('user_1'),
      request_id: 'req_1',
      correlation_id: 'corr_1',
      RequestLatencyMs: 12,
    });
    expect(metric._aws.CloudWatchMetrics[0].Dimensions).toEqual([['route_key']]);
  });

  it('uses explicit UNKNOWN correlation fields for pre-context metric logs', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'TenantBoundaryRejectedCount',
      value: 1,
      unit: 'Count',
      route_key: 'UNKNOWN_ROUTE',
    });

    expect(metric).toMatchObject({
      tenant_id_hash: 'UNKNOWN',
      user_id_hash: 'UNKNOWN',
      request_id: 'UNKNOWN',
      correlation_id: 'UNKNOWN',
    });
  });

  it('calls the trace annotation sink before writing the console trace log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const traceSink = { annotateTrace: vi.fn() };
    const sink = createConsoleObservabilitySink({ trace_annotation_sink: traceSink });

    sink.annotateTrace({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      error_code: 'ACTION_GUARD_FAILED',
    });

    expect(traceSink.annotateTrace).toHaveBeenCalledWith({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      error_code: 'ACTION_GUARD_FAILED',
    });
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      type: 'PHOS_TRACE_ANNOTATION',
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      user_id_hash: hashUserId('user_1'),
      request_id: 'req_1',
      correlation_id: 'corr_1',
    });
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('tenant_abc123');
    expect(String(logSpy.mock.calls[0]?.[0])).not.toContain('user_1');
  });

  it('keeps CloudWatch trace logs correlated even before tenant context exists', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const sink = createConsoleObservabilitySink();

    sink.annotateTrace({
      route_key: 'GET /cards',
      error_code: 'TENANT_CONTEXT_MISSING',
    });

    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
      type: 'PHOS_TRACE_ANNOTATION',
      route_key: 'GET /cards',
      tenant_id_hash: 'UNKNOWN',
      user_id_hash: 'UNKNOWN',
      request_id: 'UNKNOWN',
      correlation_id: 'UNKNOWN',
      error_code: 'TENANT_CONTEXT_MISSING',
    });
  });

  it('hashes tenant ids before trace or security output uses tenant identity', () => {
    expect(hashTenantId('tenant_abc123')).toHaveLength(16);
    expect(hashTenantId('tenant_abc123')).toBe(hashTenantId('tenant_abc123'));
    expect(hashTenantId('tenant_abc123')).not.toBe('tenant_abc123');
  });

  it('keeps in-memory metrics, annotations, and security events separate for tests', () => {
    const sink = createInMemoryObservabilitySink();

    sink.emitMetric({
      name: 'EvidenceUploadFailedCount',
      value: 1,
      unit: 'Count',
      route_key: 'POST /evidence/presign-upload',
      tenant_id: 'tenant_abc123',
      error_code: 'VALIDATION_ERROR',
    });
    sink.annotateTrace({
      route_key: 'POST /evidence/presign-upload',
      error_code: 'VALIDATION_ERROR',
    });
    sink.recordSecurityEvent({
      event_type: 'EVIDENCE_UPLOAD_REJECTED',
      severity: 'WARNING',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'POST /evidence/presign-upload',
      error_code: 'FORBIDDEN',
    });

    expect(sink.metrics).toHaveLength(1);
    expect(sink.annotations).toHaveLength(1);
    expect(sink.security_events).toHaveLength(1);
  });

  it('redacts PHI-like detail keys from console security events', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = createConsoleObservabilitySink();

    sink.recordSecurityEvent({
      event_type: 'AUTHORIZATION_DENIED',
      severity: 'WARNING',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'GET /cards',
      error_code: 'FORBIDDEN',
      details: {
        patient_name: '患者 山田太郎',
        missing_scopes: ['phos/cards.read'],
      },
    });

    const logged = JSON.parse(String(errorSpy.mock.calls[0]?.[0]));
    expect(logged).toMatchObject({
      type: 'PHOS_SECURITY_EVENT',
      tenant_id_hash: hashTenantId('tenant_abc123'),
      user_id_hash: hashUserId('user_1'),
      details: {
        patient_name: '[REDACTED]',
        missing_scopes: ['phos/cards.read'],
      },
    });
    expect(JSON.stringify(logged)).not.toContain('患者 山田太郎');
    expect(JSON.stringify(logged)).not.toContain('tenant_abc123');
    expect(JSON.stringify(logged)).not.toContain('user_1');
  });
});
