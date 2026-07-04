import { beforeEach, describe, expect, it, vi } from 'vitest';

const { allocateGlobalDisplayIdMock } = vi.hoisted(() => ({
  allocateGlobalDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateGlobalDisplayId: allocateGlobalDisplayIdMock,
}));

import {
  parseDrugPriceVersionBackfillArgs,
  runDrugPriceVersionBackfill,
} from './backfill-drug-price-versions';

type BackfillClient = Parameters<typeof runDrugPriceVersionBackfill>[0];

function createBackfillClient(overrides?: {
  latestImportLog?: Awaited<ReturnType<BackfillClient['drugMasterImportLog']['findFirst']>>;
  drugMasters?: Awaited<ReturnType<BackfillClient['drugMaster']['findMany']>>;
  existingVersions?: Awaited<ReturnType<BackfillClient['drugPriceVersion']['findMany']>>;
}) {
  const drugMasters = overrides?.drugMasters ?? [
    {
      id: 'drug_1',
      yj_code: '1124001F1022',
      drug_name: 'ユーロジン１ｍｇ錠',
      drug_price: { toString: () => '7.10' },
      transitional_expiry_date: new Date(Date.UTC(2027, 2, 31)),
    },
    {
      id: 'drug_2',
      yj_code: '1124001F1030',
      drug_name: 'エスタゾラム錠１ｍｇ「アメル」',
      drug_price: { toString: () => '6.30' },
      transitional_expiry_date: null,
    },
  ];
  const drugPriceVersionCreateMock = vi.fn().mockResolvedValue({ id: 'dpv_1' });
  const client = {
    drugMasterImportLog: {
      findFirst: vi.fn().mockResolvedValue(
        overrides?.latestImportLog ?? {
          id: 'log_1',
          source_url: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
          source_file_hash: 'hash_1',
          source_published_at: new Date(Date.UTC(2026, 4, 20)),
        },
      ),
    },
    drugMaster: {
      count: vi.fn().mockResolvedValue(drugMasters.length),
      findMany: vi.fn().mockResolvedValue(drugMasters),
    },
    drugPriceVersion: {
      findMany: vi.fn().mockResolvedValue(
        overrides?.existingVersions ?? [
          {
            drug_master_id: 'drug_2',
          },
        ],
      ),
      create: drugPriceVersionCreateMock,
    },
    $transaction: vi.fn(async (callback: (tx: typeof client) => Promise<number>) =>
      callback(client),
    ),
  };

  return {
    client: client as unknown as BackfillClient,
    rawClient: client,
    drugPriceVersionCreateMock,
  };
}

describe('backfill-drug-price-versions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateGlobalDisplayIdMock.mockResolvedValue('dpv_000000000001');
  });

  it('defaults to dry-run and requires an explicit max row bound for apply mode', () => {
    expect(parseDrugPriceVersionBackfillArgs([])).toEqual({
      mode: 'dry-run',
      maxRows: 10_000,
      sampleLimit: 20,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });
    expect(
      parseDrugPriceVersionBackfillArgs([
        '--dry-run',
        '--max-rows',
        '5',
        '--sample-limit',
        '2',
        '--json-output',
        'tmp/backfill.json',
        '--markdown-output',
        'tmp/backfill.md',
      ]),
    ).toEqual({
      mode: 'dry-run',
      maxRows: 5,
      sampleLimit: 2,
      jsonOutputPath: 'tmp/backfill.json',
      markdownOutputPath: 'tmp/backfill.md',
    });
    expect(() => parseDrugPriceVersionBackfillArgs(['--apply'])).toThrow(/explicit --max-rows/);
    expect(() => parseDrugPriceVersionBackfillArgs(['--apply', '--dry-run'])).toThrow(
      /either --apply or --dry-run/,
    );
  });

  it('summarizes dry-run candidates without creating DrugPriceVersion rows', async () => {
    const { client, rawClient, drugPriceVersionCreateMock } = createBackfillClient();

    const result = await runDrugPriceVersionBackfill(client, {
      mode: 'dry-run',
      maxRows: 10,
      sampleLimit: 10,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'dry-run',
      dryRun: true,
      effectiveFrom: '2026-05-20',
      effectiveFromSource: 'latest_mhlw_price_import_log',
      totalPricedDrugMasters: 2,
      existingVersionRows: 1,
      backfillableRows: 1,
      backfilledRows: 0,
      truncated: false,
      latestImportLog: {
        id: 'log_1',
        sourceUrl: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
        sourceFileHash: 'hash_1',
        sourcePublishedAt: '2026-05-20',
      },
    });
    expect(result.samples).toEqual([
      expect.objectContaining({
        drugMasterId: 'drug_1',
        effectiveFrom: '2026-05-20',
        wouldCreate: true,
      }),
      expect.objectContaining({
        drugMasterId: 'drug_2',
        effectiveFrom: '2026-05-20',
        wouldCreate: false,
      }),
    ]);
    expect(drugPriceVersionCreateMock).not.toHaveBeenCalled();
    expect(rawClient.$transaction).not.toHaveBeenCalled();
    expect(allocateGlobalDisplayIdMock).not.toHaveBeenCalled();
  });

  it('applies only bounded missing versions using create-time global display ids', async () => {
    const { client, rawClient, drugPriceVersionCreateMock } = createBackfillClient();

    const result = await runDrugPriceVersionBackfill(client, {
      mode: 'apply',
      maxRows: 10,
      sampleLimit: 10,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });

    expect(result).toMatchObject({
      mode: 'apply',
      dryRun: false,
      backfillableRows: 1,
      backfilledRows: 1,
    });
    expect(rawClient.$transaction).toHaveBeenCalledTimes(1);
    expect(allocateGlobalDisplayIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ drugPriceVersion: expect.any(Object) }),
      'DrugPriceVersion',
    );
    expect(drugPriceVersionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        display_id: 'dpv_000000000001',
        drug_master_id: 'drug_1',
        import_log_id: 'log_1',
        source: 'mhlw_price',
        source_url: 'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
        source_file_hash: 'hash_1',
        source_published_at: new Date(Date.UTC(2026, 4, 20)),
        effective_from: new Date(Date.UTC(2026, 4, 20)),
        drug_price: expect.objectContaining({ toString: expect.any(Function) }),
        transitional_expiry_date: new Date(Date.UTC(2027, 2, 31)),
      }),
    });
  });
});
