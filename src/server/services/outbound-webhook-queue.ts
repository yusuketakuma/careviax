import type { Prisma } from '@prisma/client';
import {
  assertReferenceOnlyWebhookData,
  redactWebhookUrlForDisplay,
  type WebhookEventType,
  type WebhookPayload,
} from './outbound-webhook';

type WebhookEnqueueTx = {
  webhookRegistration: Pick<Prisma.TransactionClient['webhookRegistration'], 'findMany'>;
  webhookDelivery: Pick<Prisma.TransactionClient['webhookDelivery'], 'createMany'>;
};

export async function enqueueWebhookEvent(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    event: WebhookEventType;
    data: Record<string, unknown>;
    eventId?: string;
    occurredAt?: Date;
  },
) {
  assertReferenceOnlyWebhookData(input.event, input.data);
  const registrations = await tx.webhookRegistration.findMany({
    where: { org_id: input.orgId, is_active: true, events: { has: input.event } },
    orderBy: { id: 'asc' },
    select: { id: true, url: true },
  });
  if (registrations.length === 0) return 0;

  const eventId = input.eventId ?? crypto.randomUUID();
  const occurredAt = (input.occurredAt ?? new Date()).toISOString();
  const payload: WebhookPayload = {
    id: eventId,
    event: input.event,
    orgId: input.orgId,
    occurredAt,
    data: input.data,
  };
  const queued = await tx.webhookDelivery.createMany({
    data: registrations.map((registration) => ({
      org_id: input.orgId,
      webhook_registration_id: registration.id,
      delivery_id: eventId,
      event: input.event,
      payload,
      url: redactWebhookUrlForDisplay(registration.url),
      status: 'pending',
      next_attempt_at: input.occurredAt ?? new Date(occurredAt),
    })),
    skipDuplicates: true,
  });
  return queued.count;
}

export function enqueuePatientCreatedWebhook(
  tx: WebhookEnqueueTx,
  orgId: string,
  patient: { id: string; created_at?: Date | null },
) {
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'patient.created',
    data: {
      patientId: patient.id,
      ...(patient.created_at instanceof Date
        ? { createdAt: patient.created_at.toISOString() }
        : {}),
    },
  });
}

export function enqueuePrescriptionCreatedWebhook(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    intakeId: string;
    cycleId: string;
    patientId: string;
    sourceType: string;
    lineCount: number;
  },
) {
  const { orgId, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'prescription.created',
    data,
  });
}

export function enqueuePrescriptionDispensedWebhook(
  tx: WebhookEnqueueTx,
  input: { orgId: string; taskId: string; resultCount: number },
) {
  const { orgId, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'prescription.dispensed',
    data,
  });
}

export function enqueueQualificationCheckedWebhook(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    patientId: string;
    checkedAt: Date;
    insuranceNumberPresent: boolean;
    identityMatch: 'matched' | 'mismatch' | 'unknown';
  },
) {
  const { orgId, checkedAt, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'qualification.checked',
    occurredAt: checkedAt,
    data: { ...data, checkedAt: checkedAt.toISOString() },
  });
}

export function enqueueHandoffCreatedWebhook(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    handoffItemId: string;
    boardId: string;
    handoffKind: 'transfer' | 'consult' | 'message';
  },
) {
  const { orgId, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'handoff.created',
    data,
  });
}

export function enqueueReportDeliveryUpdatedWebhook(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    eventId: string;
    reportId: string;
    patientId: string;
    reportType: string;
    status: 'sent' | 'response_waiting' | 'failed';
    sentCount: number;
    failedCount: number;
  },
) {
  const { orgId, eventId, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    eventId,
    event: 'report.delivery_updated',
    data,
  });
}

export function enqueueAuditExportedWebhook(
  tx: WebhookEnqueueTx,
  input: {
    orgId: string;
    exportType: 'audit_log';
    format: 'csv' | 'json';
    recordCount: number;
    truncated: boolean;
  },
) {
  const { orgId, ...data } = input;
  return enqueueWebhookEvent(tx, {
    orgId,
    event: 'audit.exported',
    data,
  });
}
