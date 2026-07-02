import { afterEach, describe, expect, it, vi } from 'vitest';
import { logSecurityEvent } from './security-events';

const { auditLogCreateMock, captureMessageMock } = vi.hoisted(() => ({
  auditLogCreateMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    auditLog: {
      create: auditLogCreateMock,
    },
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
  });

  it('logs audit persistence failures without raw path or error details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auditLogCreateMock.mockRejectedValueOnce(
      new Error('audit db failed patient=山田 token=secret-audit-token'),
    );

    logSecurityEvent({
      event_type: 'unauthorized_access',
      ip_address: '192.0.2.1',
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
      level: 'warn',
      message: 'security_event.audit_log_failed',
      event: 'security_event.audit_log_failed',
      entityType: 'security_event',
      code: 'unauthorized_access',
      method: 'GET',
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
});
