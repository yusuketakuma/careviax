import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetSecurityEventDedupForTest, logSecurityEvent } from './security-events';

const { auditLogCreateMock, captureMessageMock, executeRawMock, transactionMock } = vi.hoisted(
  () => ({
    auditLogCreateMock: vi.fn(),
    captureMessageMock: vi.fn(),
    executeRawMock: vi.fn(),
    transactionMock: vi.fn(),
  }),
);

const tx = {
  $executeRaw: executeRawMock,
  auditLog: {
    create: auditLogCreateMock,
  },
};

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: captureMessageMock,
}));

describe('logSecurityEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    auditLogCreateMock.mockReset();
    captureMessageMock.mockReset();
    executeRawMock.mockReset();
    transactionMock.mockReset();
    __resetSecurityEventDedupForTest();
  });

  it('persists org-known events inside one RLS-scoped transaction', async () => {
    transactionMock.mockImplementationOnce(async (callback) => callback(tx));
    executeRawMock.mockResolvedValue(undefined);
    auditLogCreateMock.mockResolvedValueOnce({ id: 'audit_1' });

    logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: '192.0.2.1',
      user_id: 'user_1',
      org_id: 'org_1',
      path: '/api/patients/patient_123456?name=山田&token=secret-path-token',
      method: 'GET',
      user_agent: 'test-agent',
      details: {
        reason: 'scope_denied',
        raw_patient_name: '山田',
      },
    });

    await vi.waitFor(() => expect(auditLogCreateMock).toHaveBeenCalledTimes(1));

    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 2000,
      timeout: 3000,
    });
    expect(executeRawMock).toHaveBeenCalledTimes(5);
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'security:unauthorized_access',
        target_type: 'security_event',
        target_id: '/api/patients/:id',
        ip_address: '192.0.2.1',
        user_agent: 'test-agent',
        changes: {
          method: 'GET',
          reason: 'scope_denied',
        },
      },
    });
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0])).not.toContain('山田');
    expect(JSON.stringify(auditLogCreateMock.mock.calls[0])).not.toContain('secret-path-token');
  });

  it('makes org-unknown events fail-visible without attempting an AuditLog insert', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSecurityEvent({
      event_type: 'auth_failure',
      ip_address: '192.0.2.2',
      path: '/api/auth/callback/credentials?email=patient@example.test',
      method: 'POST',
      details: { reason: 'no_org_id' },
    });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));

    expect(transactionMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'security_event.audit_log_org_unknown',
      event: 'security_event.audit_log_org_unknown',
      entityType: 'security_event',
      code: 'auth_failure',
      method: 'POST',
      operation: 'audit_log_create',
      status: 'skipped',
    });
    expect(JSON.stringify(entry)).not.toContain('patient@example.test');
  });

  it('rejects invalid org ids without logging raw path or invalid value', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: '192.0.2.3',
      user_id: 'user_1',
      org_id: 'bad org;drop',
      path: '/api/patients/patient_123?name=山田',
      method: 'GET',
      details: { reason: 'no_membership' },
    });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));

    expect(transactionMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
    const serialized = String(consoleError.mock.calls[0]?.[0]);
    expect(serialized).toContain('security_event.audit_log_invalid_org');
    expect(serialized).not.toContain('bad org');
    expect(serialized).not.toContain('/api/patients');
    expect(serialized).not.toContain('patient_123');
    expect(serialized).not.toContain('山田');
  });

  it('logs audit persistence failures without raw path or error details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    transactionMock.mockRejectedValueOnce(
      new Error('audit db failed patient=山田 token=secret-audit-token'),
    );

    logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: '192.0.2.4',
      user_id: 'user_1',
      org_id: 'org_1',
      path: '/api/patients/patient_123?name=山田&token=secret-path-token',
      method: 'GET',
      details: {
        reason: 'scope_denied',
      },
    });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));

    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'security_event.audit_log_persist_failed',
      event: 'security_event.audit_log_persist_failed',
      entityType: 'security_event',
      code: 'unauthorized_access',
      method: 'GET',
      operation: 'audit_log_create',
      error_name: 'Error',
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('/api/patients');
    expect(serialized).not.toContain('patient_123');
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('secret-path-token');
    expect(serialized).not.toContain('secret-audit-token');
    expect(serialized).not.toContain('audit db failed');
  });

  it('deduplicates per org scope without dropping another org event', async () => {
    transactionMock.mockImplementation(async (callback) => callback(tx));
    executeRawMock.mockResolvedValue(undefined);
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });

    const event = {
      event_type: 'csrf_rejected' as const,
      ip_address: '192.0.2.5',
      path: '/api/shared/resource_123456',
      method: 'POST',
      details: { reason: 'bad_origin' },
    };

    logSecurityEvent({ ...event, org_id: 'org_a' });
    logSecurityEvent({ ...event, org_id: 'org_b' });
    logSecurityEvent({ ...event, org_id: 'org_a' });

    await vi.waitFor(() => expect(auditLogCreateMock).toHaveBeenCalledTimes(2));
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(auditLogCreateMock.mock.calls.map((call) => call[0]?.data?.org_id)).toEqual([
      'org_a',
      'org_b',
    ]);
  });
});
