import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSafeLogContext, logger } from './logger';

const { captureExceptionMock, captureMessageMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  captureMessageMock: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: captureExceptionMock,
  captureMessage: captureMessageMock,
}));

describe('buildSafeLogContext', () => {
  it('keeps only safe operational values', () => {
    expect(
      buildSafeLogContext({
        event: 'file_storage.complete_failed',
        orgId: 'org_123',
        entityType: 'file',
        entityId: 'file-123',
        code: 'S3_HEAD_FAILED',
      }),
    ).toMatchObject({
      event: 'file_storage.complete_failed',
      orgId: 'org_123',
      entityType: 'file',
      entityId: 'file-123',
      code: 'S3_HEAD_FAILED',
    });
  });

  it('redacts free-text values and invalid event names', () => {
    expect(
      buildSafeLogContext({
        event: 'Upload failed for patient Taro',
        entityId: 'patient name and address',
        code: 'UPLOAD FAILED',
      }),
    ).toMatchObject({
      event: 'invalid_event_name',
      entityId: 'redacted',
      code: 'redacted',
    });
  });
});

describe('logger structured errors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    captureExceptionMock.mockReset();
    captureMessageMock.mockReset();
  });

  it('does not write Error.message or stack to PHI-safe structured error logs', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error(
      {
        event: 'visit_route.preview_failed',
        orgId: 'org-1',
        entityType: 'visit_schedule_proposal',
        entityId: 'proposal-1',
        code: 'ROUTE_PREVIEW_FAILED',
      },
      new Error('patient name: Yamada Taro'),
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'visit_route.preview_failed',
      event: 'visit_route.preview_failed',
      orgId: 'org-1',
      entityType: 'visit_schedule_proposal',
      entityId: 'proposal-1',
      code: 'ROUTE_PREVIEW_FAILED',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('Yamada');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');
  });

  it('uses a sanitized Sentry message event for PHI-safe structured error logs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/patients',
        method: 'GET',
      },
      new Error('patient=青葉 花子 insurance=MED-SECRET-1'),
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      message: 'route_handler_unhandled_error',
      event: 'route_handler_unhandled_error',
      route: '/api/patients',
      method: 'GET',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('青葉');
    expect(JSON.stringify(entry)).not.toContain('MED-SECRET-1');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'route_handler_unhandled_error',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          event: 'route_handler_unhandled_error',
          route: '/api/patients',
          method: 'GET',
          error_name: 'Error',
        }),
      }),
    );
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('青葉');
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('MED-SECRET-1');
  });
});
