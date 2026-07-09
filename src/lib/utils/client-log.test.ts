import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessageMock } = vi.hoisted(() => ({
  captureMessageMock: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: captureMessageMock,
  captureException: vi.fn(),
}));

import { clientLog } from './client-log';

const PHI_SECRET = '患者 山田太郎 090-1234-5678 hoken-ABC123';

describe('clientLog', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captureMessageMock.mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  function loggedText() {
    return [...consoleErrorSpy.mock.calls, ...consoleLogSpy.mock.calls]
      .flat()
      .map((value) => (typeof value === 'string' ? value : JSON.stringify(value)))
      .join('\n');
  }

  it('never leaks the raw error message or stack to the console (warn)', () => {
    const error = new Error(PHI_SECRET);
    clientLog.warn('notifications.pending_sync_refresh_failed', error);

    const output = loggedText();
    expect(output).not.toContain(PHI_SECRET);
    expect(output).not.toContain('山田太郎');
    expect(output).toContain('notifications.pending_sync_refresh_failed');
    expect(output).toContain('"error_name":"Error"');
  });

  it('never leaks the raw error message or stack to the console (error)', () => {
    const error = new TypeError(PHI_SECRET);
    clientLog.error('react_error_boundary', error);

    const output = loggedText();
    expect(output).not.toContain(PHI_SECRET);
    expect(output).toContain('react_error_boundary');
    expect(output).toContain('"error_name":"TypeError"');
  });

  it('passes only the raw error object as never — console receives a single serialized JSON string', () => {
    clientLog.error('global_error_boundary', new Error(PHI_SECRET), { code: 'digest_abc' });

    // The console receives one serialized JSON string, never the raw Error as a second arg.
    for (const call of consoleErrorSpy.mock.calls) {
      expect(call).toHaveLength(1);
      expect(typeof call[0]).toBe('string');
      expect(call[0]).not.toContain(PHI_SECRET);
    }
  });

  it('keeps only allowlisted safe context values and drops unknown keys', () => {
    clientLog.warn('offline_cache.visit_brief_prune_failed', new Error(PHI_SECRET), {
      code: 'PRUNE_FAILED',
      requestId: 'req_123',
      patientName: PHI_SECRET,
    } as never);

    const output = loggedText();
    expect(output).toContain('"code":"PRUNE_FAILED"');
    expect(output).toContain('"requestId":"req_123"');
    expect(output).not.toContain(PHI_SECRET);
    expect(output).not.toContain('patientName');
  });

  it('redacts identifier-like context values before they reach the logger', () => {
    clientLog.error('route_error_boundary', new Error(PHI_SECRET), {
      code: '090-1234-5678',
      requestId: 'yamada@example.com',
      route: '/patients/pat_123/medication-stock?tab=secret#raw',
    });

    const output = loggedText();
    expect(output).toContain('"code":"redacted"');
    expect(output).toContain('"requestId":"redacted"');
    expect(output).toContain('"route":"redacted"');
    expect(output).not.toContain('090-1234-5678');
    expect(output).not.toContain('yamada@example.com');
    expect(output).not.toContain('pat_123');
    expect(output).not.toContain('tab=secret');
  });

  it('normalizes non-Error rejection reasons to a coded type without leaking their content', () => {
    clientLog.warn('notifications.pending_sync_refresh_failed', {
      secret: PHI_SECRET,
    });

    const output = loggedText();
    expect(output).not.toContain(PHI_SECRET);
    expect(output).toContain('"error_name":"object"');
  });

  it('forwards a coded event (never the raw error) to Sentry in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    clientLog.error('global_error_boundary', new Error(PHI_SECRET), { code: 'digest_xyz' });

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    const [message, options] = captureMessageMock.mock.calls[0];
    expect(message).toBe('global_error_boundary');
    expect(JSON.stringify(options)).not.toContain(PHI_SECRET);
    expect(JSON.stringify(options)).toContain('digest_xyz');
  });
});
