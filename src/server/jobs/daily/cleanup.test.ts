import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  qrScanDraftFindManyMock,
  qrScanDraftUpdateManyMock,
  supplementalDeleteManyMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  qrScanDraftFindManyMock: vi.fn(),
  qrScanDraftUpdateManyMock: vi.fn(),
  supplementalDeleteManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { organization: { findMany: organizationFindManyMock } },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/lib/utils/logger', () => ({ logger: { info: vi.fn() } }));
vi.mock('../runner', () => ({
  runJob: vi.fn(async (_type: string, work: () => Promise<unknown>) => work()),
}));

import { cleanupAbandonedQrDrafts, cleanupTerminalQrDraftPayloads } from './cleanup';

describe('tenant-scoped QR draft cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }, { id: 'org_b' }]);
    withOrgContextMock.mockImplementation(
      async (orgId: string, work: (tx: unknown) => Promise<unknown>) =>
        work({
          qrScanDraft: {
            findMany: (args: unknown) => qrScanDraftFindManyMock(orgId, args),
            updateMany: (args: unknown) => qrScanDraftUpdateManyMock(orgId, args),
          },
          jahisSupplementalRecord: {
            deleteMany: (args: unknown) => supplementalDeleteManyMock(orgId, args),
          },
        }),
    );
    supplementalDeleteManyMock.mockResolvedValue({ count: 0 });
  });

  it('processes abandoned drafts in bounded tenant batches', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `draft_${index}` }));
    qrScanDraftFindManyMock.mockImplementation(async (orgId: string) => {
      const orgCalls = qrScanDraftFindManyMock.mock.calls.filter(
        ([calledOrg]) => calledOrg === orgId,
      );
      return orgCalls.length === 1 ? firstPage : [];
    });
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 100 });

    await expect(cleanupAbandonedQrDrafts()).resolves.toEqual({ processedCount: 200 });

    expect(qrScanDraftFindManyMock).toHaveBeenCalledTimes(4);
    expect(
      qrScanDraftFindManyMock.mock.calls.every(
        ([orgId, args]) =>
          ['org_a', 'org_b'].includes(orgId as string) && (args as { take: number }).take === 100,
      ),
    ).toBe(true);
    expect(qrScanDraftUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(supplementalDeleteManyMock).toHaveBeenCalledTimes(2);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_a', expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('continues after a concurrent update reduces the updated count of a full selected batch', async () => {
    organizationFindManyMock.mockResolvedValue([{ id: 'org_a' }]);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `draft_${index}` }));
    qrScanDraftFindManyMock.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([]);
    qrScanDraftUpdateManyMock.mockResolvedValueOnce({ count: 99 });

    await expect(cleanupAbandonedQrDrafts()).resolves.toEqual({ processedCount: 99 });

    expect(qrScanDraftFindManyMock).toHaveBeenCalledTimes(2);
  });

  it('scrubs terminal payloads once per tenant', async () => {
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 3 });

    await expect(cleanupTerminalQrDraftPayloads()).resolves.toEqual({ processedCount: 6 });

    expect(qrScanDraftUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      'org_a',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_a' }) }),
    );
    expect(qrScanDraftUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      'org_b',
      expect.objectContaining({ where: expect.objectContaining({ org_id: 'org_b' }) }),
    );
  });
});
