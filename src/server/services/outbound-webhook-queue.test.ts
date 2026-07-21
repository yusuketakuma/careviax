import { describe, expect, it, vi } from 'vitest';
import {
  enqueueHandoffCreatedWebhook,
  enqueueQualificationCheckedWebhook,
  enqueueReportDeliveryUpdatedWebhook,
  enqueueWebhookEvent,
} from './outbound-webhook-queue';

describe('outbound webhook queue', () => {
  it('queues reference-only webhook deliveries inside the caller transaction', async () => {
    const tx = {
      webhookRegistration: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'webhook_1',
            url: 'https://partner.example.com/hook?token=must-not-persist',
          },
        ]),
      },
      webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const occurredAt = new Date('2026-07-21T04:00:00.000Z');

    await expect(
      enqueueWebhookEvent(tx as never, {
        orgId: 'org_1',
        event: 'patient.created',
        eventId: 'event_1',
        occurredAt,
        data: { patientId: 'patient_1', createdAt: occurredAt.toISOString() },
      }),
    ).resolves.toBe(1);

    expect(tx.webhookRegistration.findMany).toHaveBeenCalledWith({
      where: { org_id: 'org_1', is_active: true, events: { has: 'patient.created' } },
      orderBy: { id: 'asc' },
      select: { id: true, url: true },
    });
    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          webhook_registration_id: 'webhook_1',
          delivery_id: 'event_1',
          event: 'patient.created',
          url: 'https://partner.example.com/hook',
          status: 'pending',
          next_attempt_at: occurredAt,
          payload: {
            id: 'event_1',
            event: 'patient.created',
            orgId: 'org_1',
            occurredAt: occurredAt.toISOString(),
            data: { patientId: 'patient_1', createdAt: occurredAt.toISOString() },
          },
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('rejects non-reference webhook data before reading registrations', async () => {
    const tx = {
      webhookRegistration: { findMany: vi.fn() },
      webhookDelivery: { createMany: vi.fn() },
    };

    await expect(
      enqueueWebhookEvent(tx as never, {
        orgId: 'org_1',
        event: 'patient.created',
        data: { patientId: 'patient_1', patientName: 'must not persist' },
      }),
    ).rejects.toThrow('webhook_reference_data_key_not_allowed');
    expect(tx.webhookRegistration.findMany).not.toHaveBeenCalled();
  });

  it('queues qualification checks without persisting insurance identifiers or provider payloads', async () => {
    const tx = {
      webhookRegistration: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'webhook_1', url: 'https://partner.example.com/qualification' },
          ]),
      },
      webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const checkedAt = new Date('2026-07-21T05:00:00.000Z');

    await expect(
      enqueueQualificationCheckedWebhook(tx as never, {
        orgId: 'org_1',
        patientId: 'patient_1',
        checkedAt,
        insuranceNumberPresent: true,
        identityMatch: 'matched',
      }),
    ).resolves.toBe(1);

    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          event: 'qualification.checked',
          next_attempt_at: checkedAt,
          payload: expect.objectContaining({
            event: 'qualification.checked',
            occurredAt: checkedAt.toISOString(),
            data: {
              patientId: 'patient_1',
              checkedAt: checkedAt.toISOString(),
              insuranceNumberPresent: true,
              identityMatch: 'matched',
            },
          }),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('queues handoff references without persisting content or recipient details', async () => {
    const tx = {
      webhookRegistration: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'webhook_1', url: 'https://partner.example.com/handoffs' }]),
      },
      webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await expect(
      enqueueHandoffCreatedWebhook(tx as never, {
        orgId: 'org_1',
        handoffItemId: 'item_1',
        boardId: 'board_1',
        handoffKind: 'transfer',
      }),
    ).resolves.toBe(1);

    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          event: 'handoff.created',
          payload: expect.objectContaining({
            event: 'handoff.created',
            data: {
              handoffItemId: 'item_1',
              boardId: 'board_1',
              handoffKind: 'transfer',
            },
          }),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('queues report delivery status without recipient or report content', async () => {
    const tx = {
      webhookRegistration: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'webhook_1', url: 'https://partner.example.com/reports' }]),
      },
      webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };

    await expect(
      enqueueReportDeliveryUpdatedWebhook(tx as never, {
        orgId: 'org_1',
        eventId: 'report-delivery:event_1',
        reportId: 'report_1',
        patientId: 'patient_1',
        reportType: 'physician_report',
        status: 'response_waiting',
        sentCount: 1,
        failedCount: 1,
      }),
    ).resolves.toBe(1);

    expect(tx.webhookDelivery.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          delivery_id: 'report-delivery:event_1',
          event: 'report.delivery_updated',
          payload: expect.objectContaining({
            event: 'report.delivery_updated',
            data: {
              reportId: 'report_1',
              patientId: 'patient_1',
              reportType: 'physician_report',
              status: 'response_waiting',
              sentCount: 1,
              failedCount: 1,
            },
          }),
        }),
      ],
      skipDuplicates: true,
    });
  });
});
