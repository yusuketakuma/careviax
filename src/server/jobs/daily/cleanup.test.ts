import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  qrScanDraftFindManyMock,
  qrScanDraftUpdateManyMock,
  jahisSupplementalRecordDeleteManyMock,
  runJobMock,
} = vi.hoisted(() => ({
  qrScanDraftFindManyMock: vi.fn(),
  qrScanDraftUpdateManyMock: vi.fn(),
  jahisSupplementalRecordDeleteManyMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    qrScanDraft: {
      findMany: qrScanDraftFindManyMock,
      updateMany: qrScanDraftUpdateManyMock,
    },
    jahisSupplementalRecord: {
      deleteMany: jahisSupplementalRecordDeleteManyMock,
    },
  },
}));

vi.mock('../runner', () => ({
  runJob: runJobMock,
}));

import { cleanupAbandonedQrDrafts, cleanupTerminalQrDraftPayloads } from './cleanup';

describe('cleanupAbandonedQrDrafts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries drafts older than the 24h cutoff (boundary) and processes them', async () => {
    qrScanDraftFindManyMock.mockResolvedValue([{ id: 'draft_1' }, { id: 'draft_2' }]);
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 2 });
    jahisSupplementalRecordDeleteManyMock.mockResolvedValue({ count: 1 });

    const result = await cleanupAbandonedQrDrafts();

    expect(result).toEqual({ processedCount: 2 });

    const findManyArgs = qrScanDraftFindManyMock.mock.calls[0]?.[0];
    expect(findManyArgs.where.status).toBe('pending');
    // cutoff は現在時刻から厳密に 24 時間前。
    expect(findManyArgs.where.created_at.lt).toEqual(new Date('2026-07-02T12:00:00.000Z'));

    expect(qrScanDraftUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['draft_1', 'draft_2'] } },
        data: expect.objectContaining({ status: 'discarded' }),
      }),
    );
    // 破棄対象のドラフトIDのみをスコープに JAHIS 補足レコードを削除すること
    // （放置ドラフトに紐づかないレコードを巻き込まない）。
    expect(jahisSupplementalRecordDeleteManyMock).toHaveBeenCalledWith({
      where: {
        qr_draft_id: { in: ['draft_1', 'draft_2'] },
        prescription_intake_id: null,
      },
    });
  });

  it('skips the update/delete calls entirely when there are no abandoned drafts (boundary: empty result)', async () => {
    qrScanDraftFindManyMock.mockResolvedValue([]);

    const result = await cleanupAbandonedQrDrafts();

    expect(result).toEqual({ processedCount: 0 });
    expect(qrScanDraftUpdateManyMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe('cleanupTerminalQrDraftPayloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runJobMock.mockImplementation(async (_jobType: string, fn: () => Promise<unknown>) => fn());
  });

  it('scrubs only confirmed/discarded draft payloads and reports the scrubbed count', async () => {
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 5 });

    const result = await cleanupTerminalQrDraftPayloads();

    expect(result).toEqual({ processedCount: 5 });
    expect(qrScanDraftUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['confirmed', 'discarded'] } },
        data: expect.objectContaining({
          raw_qr_texts: [],
          qr_payload_hash: null,
        }),
      }),
    );
    // 破棄済みQRドラフトのクリーンアップは JAHIS 補足レコードには触れないこと。
    expect(jahisSupplementalRecordDeleteManyMock).not.toHaveBeenCalled();
  });

  it('reports zero when nothing needed scrubbing (boundary: no rows updated)', async () => {
    qrScanDraftUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await cleanupTerminalQrDraftPayloads();

    expect(result).toEqual({ processedCount: 0 });
  });
});
