import { describe, expect, it, vi } from 'vitest';

const { retryDueWebhookDeliveriesMock, runJobMock } = vi.hoisted(() => ({
  retryDueWebhookDeliveriesMock: vi.fn(),
  runJobMock: vi.fn(async (...args: [string, () => Promise<unknown>, string?]) => args[1]()),
}));

vi.mock('@/server/services/outbound-webhook', () => ({
  retryDueWebhookDeliveries: retryDueWebhookDeliveriesMock,
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { retryWebhookDeliveries } from './webhook';

describe('retryWebhookDeliveries', () => {
  it('runs the webhook delivery retry drain through the job runner', async () => {
    retryDueWebhookDeliveriesMock.mockResolvedValue({
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      blockedCount: 0,
    });

    const result = await retryWebhookDeliveries({ orgId: 'org_1' });

    expect(runJobMock).toHaveBeenCalledWith(
      'webhook_delivery_retry',
      expect.any(Function),
      'org_1',
    );
    expect(retryDueWebhookDeliveriesMock).toHaveBeenCalledWith({ orgId: 'org_1' });
    expect(result).toMatchObject({
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      blockedCount: 0,
    });
  });
});
