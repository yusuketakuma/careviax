import { describe, expect, it, vi } from 'vitest';
import { enqueueWebhookEvent } from './outbound-webhook-queue';

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
});
