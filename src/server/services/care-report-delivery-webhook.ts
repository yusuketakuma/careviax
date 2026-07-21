import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { enqueueReportDeliveryUpdatedWebhook } from './outbound-webhook-queue';

type ReportDeliveryWebhookStatus = 'sent' | 'response_waiting' | 'failed';
type ReportDeliveryWebhookOutcome = {
  deliveryRecordId: string;
  failureReason: string | null;
};

function buildReportDeliveryWebhookEventId(
  reportId: string,
  status: ReportDeliveryWebhookStatus,
  outcomes: ReportDeliveryWebhookOutcome[],
) {
  const deliveryRecordIds = outcomes
    .map((outcome) => outcome.deliveryRecordId)
    .sort((left, right) => left.localeCompare(right));
  const digest = createHash('sha256')
    .update(JSON.stringify({ reportId, status, deliveryRecordIds }))
    .digest('hex');
  return `report-delivery:${digest}`;
}

export function enqueueCareReportDeliveryWebhook(
  tx: Prisma.TransactionClient,
  orgId: string,
  report: { id: string; patient_id: string; report_type: string },
  status: ReportDeliveryWebhookStatus,
  outcomes: ReportDeliveryWebhookOutcome[],
) {
  return enqueueReportDeliveryUpdatedWebhook(tx, {
    orgId,
    eventId: buildReportDeliveryWebhookEventId(report.id, status, outcomes),
    reportId: report.id,
    patientId: report.patient_id,
    reportType: report.report_type,
    status,
    sentCount: outcomes.filter((outcome) => outcome.failureReason === null).length,
    failedCount: outcomes.filter((outcome) => outcome.failureReason !== null).length,
  });
}
