import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runJobMock, drainMock, reconcileMock, listOrgIdsMock, prismaMock } = vi.hoisted(() => ({
  runJobMock: vi.fn(),
  drainMock: vi.fn(),
  reconcileMock: vi.fn(),
  listOrgIdsMock: vi.fn(),
  prismaMock: { organization: { findMany: vi.fn() } },
}));

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('./runner', () => ({ runJob: runJobMock }));
vi.mock('@/server/services/notification-delivery-outbox', () => ({
  drainNotificationDeliveryOutbox: drainMock,
  listNotificationDeliveryOrgIds: listOrgIdsMock,
}));
vi.mock('@/server/services/twilio-delivery-reconciliation', () => ({
  reconcileTwilioDeliveries: reconcileMock,
}));

import { drainNotificationDeliveries } from './notification-delivery';

describe('drainNotificationDeliveries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJobMock.mockImplementation(async (_name: string, work: () => Promise<unknown>) => work());
    drainMock.mockResolvedValue({
      processedCount: 1,
      acceptedCount: 1,
      retryCount: 0,
      unknownCount: 0,
      deadLetterCount: 0,
      errors: [],
    });
    reconcileMock.mockResolvedValue({
      scannedCount: 1,
      claimedCount: 1,
      reconciledCount: 1,
      terminalCount: 1,
      unavailableCount: 0,
      errors: [],
    });
  });

  it('keeps an authenticated tenant drain pinned to that organization', async () => {
    await expect(drainNotificationDeliveries({ orgId: 'org_1' })).resolves.toMatchObject({
      processedCount: 1,
      acceptedCount: 1,
    });

    expect(runJobMock).toHaveBeenCalledWith(
      'notification_delivery_drain',
      expect.any(Function),
      'org_1',
    );
    expect(listOrgIdsMock).not.toHaveBeenCalled();
    expect(drainMock).toHaveBeenCalledWith('org_1');
    expect(reconcileMock).toHaveBeenCalledWith('org_1');
  });

  it('enumerates organizations then drains each through the tenant-bound service', async () => {
    listOrgIdsMock.mockResolvedValue(['org_1', 'org_2']);

    await expect(drainNotificationDeliveries()).resolves.toMatchObject({
      processedCount: 2,
      acceptedCount: 2,
    });

    expect(listOrgIdsMock).toHaveBeenCalledWith(prismaMock);
    expect(drainMock).toHaveBeenNthCalledWith(1, 'org_1');
    expect(drainMock).toHaveBeenNthCalledWith(2, 'org_2');
    expect(reconcileMock).toHaveBeenNthCalledWith(1, 'org_1');
    expect(reconcileMock).toHaveBeenNthCalledWith(2, 'org_2');
  });

  it('returns only fixed diagnostics when one tenant drain fails', async () => {
    listOrgIdsMock.mockResolvedValue(['org_1', 'org_2']);
    drainMock.mockRejectedValueOnce(new Error('patient name and token')).mockResolvedValueOnce({
      processedCount: 1,
      acceptedCount: 0,
      retryCount: 1,
      unknownCount: 0,
      deadLetterCount: 0,
      errors: [],
    });

    const result = await drainNotificationDeliveries();

    expect(result).toMatchObject({ errors: ['notification_delivery_org_drain_failed'] });
    expect(JSON.stringify(result)).not.toContain('patient name');
  });

  it('continues status reconciliation when delivery drain fails', async () => {
    drainMock.mockRejectedValueOnce(new Error('database unavailable'));

    const result = await drainNotificationDeliveries({ orgId: 'org_1' });

    expect(reconcileMock).toHaveBeenCalledWith('org_1');
    expect(result).toMatchObject({
      reconciliationScannedCount: 1,
      reconciliationClaimedCount: 1,
      reconciliationReconciledCount: 1,
      reconciliationTerminalCount: 1,
      errors: ['notification_delivery_org_drain_failed'],
    });
  });
});
