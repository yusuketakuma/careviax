import { describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerMocks.warn,
  },
}));

import { logCareReportEmailDeliveryFailure } from './care-report-send-observability';

describe('care report send observability', () => {
  it('logs bounded SES diagnostics without raw provider messages or contacts', () => {
    const error = Object.assign(new Error('SES unavailable for doctor@example.com'), {
      name: 'TimeoutError',
      $metadata: { httpStatusCode: 503 },
    });

    logCareReportEmailDeliveryFailure({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'admin',
      },
      reportId: 'report_1',
      deliveryRecordId: 'delivery_1',
      error,
    });

    expect(loggerMocks.warn).toHaveBeenCalledWith('care report email delivery failed', {
      event: 'care_report.email_delivery_failed',
      orgId: 'org_1',
      actorId: 'user_1',
      entityType: 'care_report',
      entityId: 'report_1',
      targetId: 'delivery_1',
      externalProvider: 'ses',
      error_name: 'TimeoutError',
      status: 503,
      failure_class: 'transient',
    });
    const payload = loggerMocks.warn.mock.calls[0]![1];
    expect(JSON.stringify(payload)).not.toContain('SES unavailable');
    expect(JSON.stringify(payload)).not.toContain('doctor@example.com');
  });
});
