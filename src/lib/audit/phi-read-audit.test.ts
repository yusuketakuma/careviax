import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { withOrgContextMock } = vi.hoisted(() => ({ withOrgContextMock: vi.fn() }));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import {
  PHI_READ_AUDIT_ACTION,
  recordPhiReadAudit,
  recordPhiReadAuditForRequest,
} from './phi-read-audit';

describe('recordPhiReadAudit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a phi_read audit row with actor, org, patient, request metadata, and view', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
      },
      {
        patientId: 'patient_1',
        view: 'patient_detail',
        purpose: 'care',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_pharmacy_id: 'org_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient',
        target_id: 'patient_1',
        changes: { view: 'patient_detail', purpose: 'care' },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      },
    });
  });

  it('honors explicit targetType/targetId and non-PHI metadata', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_2' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      { orgId: 'org_1', userId: 'user_1', actorPharmacyId: 'pharmacy_9' },
      {
        patientId: 'patient_1',
        view: 'patient_timeline',
        targetType: 'patient_timeline',
        targetId: 'timeline_1',
        metadata: { event_count: 12 },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_pharmacy_id: 'pharmacy_9',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient_timeline',
        target_id: 'timeline_1',
        changes: { view: 'patient_timeline', metadata: { event_count: 12 } },
      }),
    });
  });

  it('adds validated request trace without replacing domain audit metadata', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_trace' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'req_phi_123',
        correlationId: 'corr_phi_456',
      },
      {
        patientId: 'patient_1',
        view: 'inbound_communication_detail',
        purpose: 'care_coordination',
        metadata: { request_id: 'domain_request_789', read_reason_code: 'review_inbound_detail' },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          view: 'inbound_communication_detail',
          purpose: 'care_coordination',
          metadata: {
            request_id: 'domain_request_789',
            read_reason_code: 'review_inbound_detail',
          },
          request_trace: {
            request_id: 'req_phi_123',
            correlation_id: 'corr_phi_456',
          },
        },
      }),
    });
  });

  it('omits invalid request trace while preserving the existing audit shape', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_invalid_trace' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      {
        orgId: 'org_1',
        userId: 'user_1',
        requestId: 'patient@example.com',
        correlationId: 'correlation id with spaces',
      },
      {
        patientId: 'patient_1',
        view: 'patient_detail',
        metadata: { request_id: 'domain_request_789' },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: {
          view: 'patient_detail',
          metadata: { request_id: 'domain_request_789' },
        },
      }),
    });
  });

  it('records target-only PHI reads when no patient is linked yet', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_target_only' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      { orgId: 'org_1', userId: 'user_1' },
      {
        patientId: null,
        view: 'inbound_communication_detail',
        targetType: 'inbound_communication_event',
        targetId: 'event_1',
        purpose: 'care_coordination',
        metadata: { request_id: 'req_1', read_reason_code: 'review_inbound_detail' },
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        patient_id: undefined,
        target_type: 'inbound_communication_event',
        target_id: 'event_1',
        changes: {
          view: 'inbound_communication_detail',
          purpose: 'care_coordination',
          metadata: { request_id: 'req_1', read_reason_code: 'review_inbound_detail' },
        },
      }),
    });
  });

  it('never records PHI body fields (only view/purpose/metadata in changes)', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_3' });

    await recordPhiReadAudit(
      { auditLog: { create } },
      { orgId: 'org_1', userId: 'user_1' },
      { patientId: 'patient_1', view: 'patient_header_summary' },
    );

    const changes = create.mock.calls[0]?.[0]?.data?.changes as Record<string, unknown>;
    expect(Object.keys(changes)).toEqual(['view']);
  });

  it('does not throw and emits a PHI-safe signal when the audit write fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const create = vi
      .fn()
      .mockRejectedValue(new Error('db down patient=patient_sensitive token=secret-audit-token'));

    await expect(
      recordPhiReadAudit(
        { auditLog: { create } },
        { orgId: 'org_sensitive', userId: 'user_sensitive' },
        { patientId: 'patient_sensitive', view: 'patient_detail' },
      ),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'phi_read_audit_write_failed',
      event: 'phi_read_audit_write_failed',
      operation: 'record_phi_read_audit',
      phase: 'audit_write',
      error_name: 'Error',
    });
    expect(entry).not.toHaveProperty('orgId');
    expect(entry).not.toHaveProperty('actorId');
    expect(entry).not.toHaveProperty('entityType');
    expect(entry).not.toHaveProperty('entityId');
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('org_sensitive');
    expect(serialized).not.toContain('user_sensitive');
    expect(serialized).not.toContain('patient_sensitive');
    expect(serialized).not.toContain('secret-audit-token');
    expect(serialized).not.toContain('db down');
  });

  it('does not throw when the audit client lacks a create method', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      recordPhiReadAudit(
        { auditLog: {} as never },
        { orgId: 'org_1', userId: 'user_1' },
        { patientId: 'patient_1', view: 'patient_detail' },
      ),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe('recordPhiReadAuditForRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    withOrgContextMock.mockReset();
  });

  it('writes the audit inside an org-scoped transaction with request metadata forwarded', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'audit_1' });
    let capturedRequestContext: unknown;
    withOrgContextMock.mockImplementation(async (_orgId, work, options) => {
      capturedRequestContext = options?.requestContext;
      return work({ auditLog: { create } });
    });

    recordPhiReadAuditForRequest(
      {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
        actorSiteId: 'site_1',
        ipAddress: '203.0.113.10',
        userAgent: 'vitest',
        requestId: 'req_phi_123',
        correlationId: 'corr_phi_456',
      },
      { patientId: 'patient_1', view: 'patient_detail', purpose: 'care' },
    );

    // fire-and-forget: flush the microtask queue
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      }),
    );
    expect(capturedRequestContext).toMatchObject({
      role: 'pharmacist',
      actorSiteId: 'site_1',
      requestId: 'req_phi_123',
      correlationId: 'corr_phi_456',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        actor_site_id: 'site_1',
        patient_id: 'patient_1',
        action: PHI_READ_AUDIT_ACTION,
        target_type: 'patient',
        target_id: 'patient_1',
        changes: {
          view: 'patient_detail',
          purpose: 'care',
          request_trace: {
            request_id: 'req_phi_123',
            correlation_id: 'corr_phi_456',
          },
        },
        ip_address: '203.0.113.10',
        user_agent: 'vitest',
      }),
    });
  });

  it('does not throw and emits a PHI-safe signal when the org context fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    withOrgContextMock.mockRejectedValue(
      new Error('tx open failed patient=patient_sensitive token=secret-context-token'),
    );

    expect(() =>
      recordPhiReadAuditForRequest(
        { orgId: 'org_sensitive', userId: 'user_sensitive', role: 'pharmacist' },
        { patientId: 'patient_sensitive', view: 'patient_detail' },
      ),
    ).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleErrorSpy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'phi_read_audit_context_failed',
      event: 'phi_read_audit_context_failed',
      operation: 'record_phi_read_audit_for_request',
      phase: 'org_context',
      error_name: 'Error',
    });
    expect(entry).not.toHaveProperty('orgId');
    expect(entry).not.toHaveProperty('actorId');
    expect(entry).not.toHaveProperty('entityType');
    expect(entry).not.toHaveProperty('entityId');
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('org_sensitive');
    expect(serialized).not.toContain('user_sensitive');
    expect(serialized).not.toContain('patient_sensitive');
    expect(serialized).not.toContain('secret-context-token');
    expect(serialized).not.toContain('tx open failed');
  });
});

describe('PHI read audit failure observability contract', () => {
  it('keeps a no-dimension CloudWatch metric filter and alarm for every failure phase', () => {
    // AWS references confirmed 2026-07-13:
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntaxForMetricFilters.html
    const config = JSON.parse(
      readFileSync(join(process.cwd(), 'tools/infra/cloudwatch-alarms.json'), 'utf8'),
    ) as {
      alarms: Array<{
        name: string;
        metric: string;
        namespace: string;
        comparisonOperator: string;
        threshold: number;
        evaluationPeriods: number;
        periodSeconds: number;
        statistic: string;
        dimensions?: Record<string, string>;
        metricFilter?: {
          logGroupName: string;
          filterName: string;
          filterPattern: string;
          metricNamespace: string;
          metricName: string;
          metricValue: string;
          defaultValue: number;
          dimensions?: Record<string, string>;
        };
      }>;
    };

    const alarm = config.alarms.find((entry) => entry.name === 'ph-os-phi-read-audit-failure');
    expect(alarm).toMatchObject({
      metric: 'PhiReadAuditFailureCount',
      namespace: 'PH-OS/Application',
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      threshold: 1,
      evaluationPeriods: 1,
      periodSeconds: 300,
      statistic: 'Sum',
      metricFilter: {
        logGroupName: '/ph-os/application',
        filterName: 'ph-os-phi-read-audit-failure',
        filterPattern: '{ $.event = "phi_read_audit_*_failed" }',
        metricNamespace: 'PH-OS/Application',
        metricName: 'PhiReadAuditFailureCount',
        metricValue: '1',
        defaultValue: 0,
      },
    });
    expect(alarm).not.toHaveProperty('dimensions');
    expect(alarm?.metricFilter).not.toHaveProperty('dimensions');
  });
});
