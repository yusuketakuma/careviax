import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_CACHE_TTL_MS } from '@/lib/offline/cache-policy';

const { belowMock, deleteMock, whereMock, offlineDbFactoryMock } = vi.hoisted(() => {
  const deleteMock = vi.fn();
  const belowMock = vi.fn(() => ({ delete: deleteMock }));
  const whereMock = vi.fn(() => ({ below: belowMock }));

  return {
    belowMock,
    deleteMock,
    whereMock,
    offlineDbFactoryMock: vi.fn(() => ({
      visitBriefCache: {
        where: whereMock,
      },
    })),
  };
});

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: offlineDbFactoryMock(),
}));

describe('pruneExpiredOfflineVisitBriefCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load Dexie-backed offline DB when the provider module is imported', async () => {
    await import('./root-provider');

    expect(offlineDbFactoryMock).not.toHaveBeenCalled();
  });

  it('loads offline DB lazily only when pruning expired visit brief cache rows', async () => {
    const now = Date.UTC(2026, 5, 17, 12, 0, 0);
    const { pruneExpiredOfflineVisitBriefCache } = await import('./root-provider');

    await pruneExpiredOfflineVisitBriefCache(now);

    expect(offlineDbFactoryMock).toHaveBeenCalledTimes(1);
    expect(whereMock).toHaveBeenCalledWith('updatedAt');
    expect(belowMock).toHaveBeenCalledWith(new Date(now - OFFLINE_CACHE_TTL_MS));
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });
});
