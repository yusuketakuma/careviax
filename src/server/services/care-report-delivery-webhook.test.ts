import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueReportDeliveryUpdatedWebhookMock } = vi.hoisted(() => ({
  enqueueReportDeliveryUpdatedWebhookMock: vi.fn(),
}));

vi.mock('./outbound-webhook-queue', () => ({
  enqueueReportDeliveryUpdatedWebhook: enqueueReportDeliveryUpdatedWebhookMock,
}));

import { enqueueCareReportDeliveryWebhook } from './care-report-delivery-webhook';

describe('care report delivery webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enqueueReportDeliveryUpdatedWebhookMock.mockResolvedValue(1);
  });

  it('builds a stable reference-only aggregate event independent of outcome order', async () => {
    const tx = {} as never;
    const report = {
      id: 'report_1',
      patient_id: 'patient_1',
      report_type: 'physician_report',
    };
    const outcomes = [
      { deliveryRecordId: 'delivery_2', failureReason: 'fixed_failure' },
      { deliveryRecordId: 'delivery_1', failureReason: null },
    ];

    await enqueueCareReportDeliveryWebhook(tx, 'org_1', report, 'response_waiting', outcomes);
    const firstInput = enqueueReportDeliveryUpdatedWebhookMock.mock.calls[0]?.[1];
    await enqueueCareReportDeliveryWebhook(
      tx,
      'org_1',
      report,
      'response_waiting',
      [...outcomes].reverse(),
    );

    expect(firstInput).toEqual({
      orgId: 'org_1',
      eventId: expect.stringMatching(/^report-delivery:[a-f0-9]{64}$/),
      reportId: 'report_1',
      patientId: 'patient_1',
      reportType: 'physician_report',
      status: 'response_waiting',
      sentCount: 1,
      failedCount: 1,
    });
    expect(enqueueReportDeliveryUpdatedWebhookMock.mock.calls[1]?.[1]?.eventId).toBe(
      firstInput?.eventId,
    );
  });

  it('uses a distinct event id when the aggregate status changes', async () => {
    const tx = {} as never;
    const report = { id: 'report_1', patient_id: 'patient_1', report_type: 'physician_report' };
    const outcomes = [{ deliveryRecordId: 'delivery_1', failureReason: null }];

    await enqueueCareReportDeliveryWebhook(tx, 'org_1', report, 'response_waiting', outcomes);
    await enqueueCareReportDeliveryWebhook(tx, 'org_1', report, 'sent', outcomes);

    expect(enqueueReportDeliveryUpdatedWebhookMock.mock.calls[0]?.[1]?.eventId).not.toBe(
      enqueueReportDeliveryUpdatedWebhookMock.mock.calls[1]?.[1]?.eventId,
    );
  });
});
