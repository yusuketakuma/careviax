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

  it('drops runtime-only keys and redacts unsupported value types', () => {
    const unsafeContext = {
      event: 'route_handler_unhandled_error',
      route: '/api/patients',
      method: 'POST',
      status: 500,
      requestId: 'req_123',
      code: 'UNHANDLED_ERROR',
      orgId: { id: 'org_patient_secret' },
      body: 'patient=山田太郎 phone=090-1234-5678',
      patientEmail: 'taro.yamada@example.com',
      insuranceNumber: 'ABC-123',
      authorization: 'Bearer sk-live-abc',
      token: 'secret-token',
      password: 'secret-password',
    } as unknown as Parameters<typeof buildSafeLogContext>[0];

    const safeContext = buildSafeLogContext(unsafeContext);

    expect(safeContext).toMatchObject({
      event: 'route_handler_unhandled_error',
      route: '/api/patients',
      method: 'POST',
      status: 500,
      requestId: 'req_123',
      code: 'UNHANDLED_ERROR',
      orgId: 'redacted',
    });
    expect(safeContext).not.toHaveProperty('body');
    expect(safeContext).not.toHaveProperty('patientEmail');
    expect(safeContext).not.toHaveProperty('insuranceNumber');
    expect(safeContext).not.toHaveProperty('authorization');
    expect(safeContext).not.toHaveProperty('token');
    expect(safeContext).not.toHaveProperty('password');
    expect(JSON.stringify(safeContext)).not.toContain('山田太郎');
    expect(JSON.stringify(safeContext)).not.toContain('090-1234-5678');
    expect(JSON.stringify(safeContext)).not.toContain('taro.yamada@example.com');
    expect(JSON.stringify(safeContext)).not.toContain('ABC-123');
    expect(JSON.stringify(safeContext)).not.toContain('sk-live-abc');
    expect(JSON.stringify(safeContext)).not.toContain('secret-token');
    expect(JSON.stringify(safeContext)).not.toContain('secret-password');
    expect(JSON.stringify(safeContext)).not.toContain('org_patient_secret');
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

  it('does not write Error.message or stack to PHI-safe structured warning logs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error(
      'patient=田中太郎 SOAP=服薬状況 token=secret visit handoff extraction secret',
    );
    err.stack = 'Error: patient=田中太郎 token=secret\n    at route.ts:1:1';

    logger.warn(
      {
        event: 'visit_records_handoff_extraction_failed',
        route: '/api/visit-records',
        operation: 'process_handoff_extraction',
        targetId: 'record_1',
      },
      err,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'warn',
      message: 'visit_records_handoff_extraction_failed',
      event: 'visit_records_handoff_extraction_failed',
      route: '/api/visit-records',
      operation: 'process_handoff_extraction',
      targetId: 'record_1',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('田中太郎');
    expect(JSON.stringify(entry)).not.toContain('服薬状況');
    expect(JSON.stringify(entry)).not.toContain('token=secret');
    expect(JSON.stringify(entry)).not.toContain('visit handoff extraction secret');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'visit_records_handoff_extraction_failed',
      expect.objectContaining({
        level: 'warning',
        extra: expect.objectContaining({
          event: 'visit_records_handoff_extraction_failed',
          route: '/api/visit-records',
          operation: 'process_handoff_extraction',
          targetId: 'record_1',
          error_name: 'Error',
        }),
      }),
    );
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('田中太郎');
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('token=secret');
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

  it('normalizes unsafe runtime error names on PHI-safe structured error logs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new Error('patient name: Yamada Taro');
    err.name = 'YamadaTaroSecretError';

    logger.error(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/patients',
        method: 'POST',
        code: 'UNHANDLED_ERROR',
      },
      err,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: 'route_handler_unhandled_error',
      route: '/api/patients',
      method: 'POST',
      code: 'UNHANDLED_ERROR',
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('YamadaTaroSecretError');
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('YamadaTaroSecretError');
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('normalizes custom error class names on PHI-safe structured error logs', () => {
    class PatientInsuranceEligibilityError extends Error {
      constructor() {
        super('insurance eligibility failed for patient Yamada Taro');
        this.name = new.target.name;
      }
    }

    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = new PatientInsuranceEligibilityError();

    logger.error(
      {
        event: 'dashboard_monthly_stats_unhandled_error',
        route: '/api/dashboard/monthly-stats',
        method: 'GET',
        status: 500,
      },
      err,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: 'dashboard_monthly_stats_unhandled_error',
      route: '/api/dashboard/monthly-stats',
      method: 'GET',
      status: 500,
      error_name: 'Error',
    });
    expect(JSON.stringify(entry)).not.toContain('PatientInsuranceEligibilityError');
    expect(JSON.stringify(entry)).not.toContain('Yamada');
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain(
      'PatientInsuranceEligibilityError',
    );
    expect(JSON.stringify(captureMessageMock.mock.calls)).not.toContain('Yamada');
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('omits incident report narrative details from PHI-safe structured error logs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unsafeNarrative =
      'patient name: Yamada Taro medication=SecretDrug incident narrative secret';
    const err = new Error(`incident report failed: ${unsafeNarrative}`);
    err.name = 'crafted.incident.patient.medication.secret';
    err.stack = `Error: ${unsafeNarrative}\n    at POST (/api/incident-reports/route.ts:1:1)`;

    logger.error(
      {
        event: 'incident_reports_post_unhandled_error',
        route: '/api/incident-reports',
        method: 'POST',
        status: 500,
      },
      err,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'incident_reports_post_unhandled_error',
      event: 'incident_reports_post_unhandled_error',
      route: '/api/incident-reports',
      method: 'POST',
      status: 500,
      error_name: 'Error',
    });

    const consolePayload = JSON.stringify(entry);
    expect(consolePayload).not.toContain('Yamada');
    expect(consolePayload).not.toContain('SecretDrug');
    expect(consolePayload).not.toContain('incident narrative secret');
    expect(consolePayload).not.toContain('crafted.incident');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_message');

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'incident_reports_post_unhandled_error',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          event: 'incident_reports_post_unhandled_error',
          route: '/api/incident-reports',
          method: 'POST',
          status: 500,
          error_name: 'Error',
        }),
      }),
    );
    const sentryPayload = JSON.stringify(captureMessageMock.mock.calls);
    expect(sentryPayload).not.toContain('Yamada');
    expect(sentryPayload).not.toContain('SecretDrug');
    expect(sentryPayload).not.toContain('incident narrative secret');
    expect(sentryPayload).not.toContain('crafted.incident');
  });

  it('omits raw error message, stack, and request body sentinels from safe object overload output', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBodySentinel =
      'patient=山田太郎 phone=090-1234-5678 address=東京都 medication=SecretDrug request_body_secret';
    const err = new Error(`adapter failed with body ${rawBodySentinel}`);
    err.stack = `Error: ${rawBodySentinel}\n    at POST (/api/patients/route.ts:1:1)`;

    logger.error(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/patients',
        method: 'POST',
        status: 500,
        requestId: 'req_123',
        code: 'UNHANDLED_ERROR',
        body: rawBodySentinel,
        patientEmail: 'taro.yamada@example.com',
        insuranceNumber: 'ABC-123',
        authorization: 'Bearer sk-live-abc',
        token: 'secret-token',
        password: 'secret-password',
        error_message: 'raw-error-message',
        stack: 'raw-stack',
        error_raw: 'raw-error',
        cause: 'raw-cause',
      } as unknown as Parameters<typeof buildSafeLogContext>[0],
      err,
    );

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'route_handler_unhandled_error',
      event: 'route_handler_unhandled_error',
      route: '/api/patients',
      method: 'POST',
      status: 500,
      requestId: 'req_123',
      code: 'UNHANDLED_ERROR',
      error_name: 'Error',
    });

    const consolePayload = JSON.stringify(entry);
    expect(consolePayload).not.toContain('山田太郎');
    expect(consolePayload).not.toContain('090-1234-5678');
    expect(consolePayload).not.toContain('東京都');
    expect(consolePayload).not.toContain('SecretDrug');
    expect(consolePayload).not.toContain('request_body_secret');
    expect(consolePayload).not.toContain('taro.yamada@example.com');
    expect(consolePayload).not.toContain('ABC-123');
    expect(consolePayload).not.toContain('sk-live-abc');
    expect(consolePayload).not.toContain('secret-token');
    expect(consolePayload).not.toContain('secret-password');
    expect(consolePayload).not.toContain('adapter failed with body');
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('patientEmail');
    expect(entry).not.toHaveProperty('insuranceNumber');
    expect(entry).not.toHaveProperty('authorization');
    expect(entry).not.toHaveProperty('token');
    expect(entry).not.toHaveProperty('password');
    expect(entry).not.toHaveProperty('error_message');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_raw');
    expect(entry).not.toHaveProperty('cause');

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'route_handler_unhandled_error',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          event: 'route_handler_unhandled_error',
          route: '/api/patients',
          method: 'POST',
          status: 500,
          requestId: 'req_123',
          code: 'UNHANDLED_ERROR',
          error_name: 'Error',
        }),
      }),
    );

    const sentryPayload = JSON.stringify(captureMessageMock.mock.calls);
    expect(sentryPayload).not.toContain('山田太郎');
    expect(sentryPayload).not.toContain('090-1234-5678');
    expect(sentryPayload).not.toContain('東京都');
    expect(sentryPayload).not.toContain('SecretDrug');
    expect(sentryPayload).not.toContain('request_body_secret');
    expect(sentryPayload).not.toContain('taro.yamada@example.com');
    expect(sentryPayload).not.toContain('ABC-123');
    expect(sentryPayload).not.toContain('sk-live-abc');
    expect(sentryPayload).not.toContain('secret-token');
    expect(sentryPayload).not.toContain('secret-password');
    expect(sentryPayload).not.toContain('adapter failed with body');
  });

  it('does not leak raw errors when the legacy string overload is bypassed at runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sentinel =
      'patient=佐藤次郎 phone=090-9999-1111 medication=SecretDrug string_overload_secret';
    const err = new Error(`legacy string overload failed: ${sentinel}`);
    err.stack = `Error: ${sentinel}\n    at POST (/api/patients/route.ts:1:1)`;
    const legacyLoggerError = logger.error as (
      message: string,
      error?: unknown,
      ctx?: Record<string, unknown>,
    ) => void;

    legacyLoggerError('legacy_route_unhandled_error', err, {
      route: '/api/patients',
      method: 'POST',
      status: 500,
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(consoleError.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      message: 'legacy_route_unhandled_error',
      route: '/api/patients',
      method: 'POST',
      status: 500,
      error_name: 'Error',
    });
    expect(entry).not.toHaveProperty('error_message');
    expect(entry).not.toHaveProperty('stack');
    expect(entry).not.toHaveProperty('error_raw');

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).toHaveBeenCalledWith(
      'legacy_route_unhandled_error',
      expect.objectContaining({
        level: 'error',
        extra: expect.objectContaining({
          route: '/api/patients',
          method: 'POST',
          status: 500,
          error_name: 'Error',
        }),
      }),
    );

    const consolePayload = JSON.stringify(entry);
    const sentryPayload = JSON.stringify(captureMessageMock.mock.calls);
    for (const payload of [consolePayload, sentryPayload]) {
      expect(payload).not.toContain('佐藤');
      expect(payload).not.toContain('090-9999-1111');
      expect(payload).not.toContain('SecretDrug');
      expect(payload).not.toContain('string_overload_secret');
      expect(payload).not.toContain('legacy string overload failed');
    }
  });
});
