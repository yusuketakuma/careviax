import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCloudWatchEmbeddedMetric,
  createConsoleObservabilitySink,
  createInMemoryObservabilitySink,
  hashTenantId,
  PHOS_METRICS_NAMESPACE,
} from './observability';

describe('PH-OS observability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds CloudWatch embedded metrics in the PHOS backend namespace', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'TenantBoundaryRejectedCount',
      value: 1,
      unit: 'Count',
      route_key: 'POST /cards/{card_id}/actions',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
    });

    expect(metric._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: PHOS_METRICS_NAMESPACE,
      Metrics: [{ Name: 'TenantBoundaryRejectedCount', Unit: 'Count' }],
    });
    expect(metric).toMatchObject({
      route_key: 'POST /cards/{card_id}/actions',
      error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
      TenantBoundaryRejectedCount: 1,
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
      details: {
        patient_name: '[REDACTED]',
        missing_scopes: ['phos/cards.read'],
      },
    });
    expect(JSON.stringify(logged)).not.toContain('患者 山田太郎');
  });
});
