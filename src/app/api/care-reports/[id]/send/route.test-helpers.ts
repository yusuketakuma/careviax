import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { expect } from 'vitest';

type MockWithCalls = { mock: { calls: unknown[][] } };

export function buildUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['org_id', 'delivery_intent_key'] },
  });
}

export function buildExpectedSendRequestFingerprint(
  recipients: unknown[],
  expectedUpdatedAtOrSecret: Date | string = new Date('2026-05-12T00:00:00.000Z'),
  secretMaybe?: string,
) {
  const expectedUpdatedAt =
    expectedUpdatedAtOrSecret instanceof Date
      ? expectedUpdatedAtOrSecret
      : new Date('2026-05-12T00:00:00.000Z');
  const secret =
    typeof expectedUpdatedAtOrSecret === 'string'
      ? expectedUpdatedAtOrSecret
      : (secretMaybe ?? 'ph-os-local-auth-secret');
  return `care-report-send-request:v2:${createHmac('sha256', secret)
    .update(
      JSON.stringify({
        action: 'care_report.send',
        report_id: 'report_1',
        expected_updated_at: expectedUpdatedAt.toISOString(),
        recipients,
        safety_ack: true,
      }),
    )
    .digest('hex')}`;
}

export function expectCareReportDeliveryWebhookCall(
  mock: MockWithCalls,
  tx: unknown,
  status: 'sent' | 'response_waiting' | 'failed',
  sentCount: number,
  failedCount: number,
) {
  const call = mock.mock.calls.find((candidate) => candidate[3] === status);
  expect(call?.[0]).toBe(tx);
  expect(call?.[1]).toBe('org_1');
  expect(call?.[2]).toEqual(
    expect.objectContaining({
      id: 'report_1',
      patient_id: 'patient_1',
      report_type: 'physician_report',
    }),
  );
  const outcomes = (call?.[4] ?? []) as Array<{ failureReason: string | null }>;
  expect(outcomes.filter((outcome) => outcome.failureReason === null)).toHaveLength(sentCount);
  expect(outcomes.filter((outcome) => outcome.failureReason !== null)).toHaveLength(failedCount);
}
