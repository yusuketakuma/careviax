import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  integrationJobFindFirstMock,
  drugMasterImportLogFindFirstMock,
  membershipFindManyMock,
  notificationCreateManyMock,
  drugMasterCountMock,
  fetchLatestSskDrugMasterZipMock,
  importSskDrugMasterMock,
  runJobMock,
} = vi.hoisted(() => ({
  integrationJobFindFirstMock: vi.fn(),
  drugMasterImportLogFindFirstMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationCreateManyMock: vi.fn(),
  drugMasterCountMock: vi.fn(),
  fetchLatestSskDrugMasterZipMock: vi.fn(),
  importSskDrugMasterMock: vi.fn(),
  runJobMock: vi.fn(async (_jobType: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    integrationJob: {
      findFirst: integrationJobFindFirstMock,
    },
    drugMasterImportLog: {
      findFirst: drugMasterImportLogFindFirstMock,
    },
    membership: {
      findMany: membershipFindManyMock,
    },
    notification: {
      createMany: notificationCreateManyMock,
    },
    drugMaster: {
      count: drugMasterCountMock,
    },
  },
}));

vi.mock('@/server/services/drug-master-import/ssk', () => ({
  buildSskDrugMasterDedupeKey: (sourceFileHash: string) => `ssk:${sourceFileHash}`,
  fetchLatestSskDrugMasterZip: fetchLatestSskDrugMasterZipMock,
  importSskDrugMaster: importSskDrugMasterMock,
}));

vi.mock('@/server/services/drug-master-import/mhlw', () => ({
  importGenericNameMappings: vi.fn(),
  importMhlwGenericFlags: vi.fn(),
  importMhlwPriceList: vi.fn(),
}));

vi.mock('@/server/services/drug-master-import/pmda', () => ({
  importPmdaPackageInserts: vi.fn(),
}));

vi.mock('./runner', () => ({
  runJob: runJobMock,
}));

import { checkDrugMasterFreshness, refreshSskDrugMaster } from './drug-master';

describe('refreshSskDrugMaster', () => {
  const latestZipPayload = {
    zipUrl: 'https://www.ssk.or.jp/y_ALL20260611.zip',
    sourceFileHash: 'a'.repeat(64),
    entries: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchLatestSskDrugMasterZipMock.mockResolvedValue(latestZipPayload);
    integrationJobFindFirstMock.mockResolvedValue(null);
    importSskDrugMasterMock.mockResolvedValue({ importedCount: 120 });
  });

  it('uses the source file hash as the refresh dedupe key', async () => {
    await expect(refreshSskDrugMaster()).resolves.toEqual({ processedCount: 120 });

    expect(runJobMock).toHaveBeenCalledWith(
      'drug_master_refresh',
      expect.any(Function),
      undefined,
      `ssk:${latestZipPayload.sourceFileHash}`,
    );
    expect(importSskDrugMasterMock).toHaveBeenCalledWith(expect.any(Object), {
      zipPayload: latestZipPayload,
    });
  });

  it('skips import when the latest completed job already has the same source hash', async () => {
    integrationJobFindFirstMock.mockResolvedValueOnce({
      dedupe_key: `ssk:${latestZipPayload.sourceFileHash}`,
    });

    await expect(refreshSskDrugMaster()).resolves.toEqual({ processedCount: 0, errors: [] });

    expect(importSskDrugMasterMock).not.toHaveBeenCalled();
  });
});

describe('checkDrugMasterFreshness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T00:00:00.000Z'));
    delete process.env.DRUG_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT;
    drugMasterImportLogFindFirstMock.mockResolvedValue({
      imported_at: new Date('2026-06-29T00:00:00.000Z'),
      record_count: 100,
    });
    membershipFindManyMock.mockResolvedValue([{ user_id: 'admin_1', org_id: 'org_1' }]);
    notificationCreateManyMock.mockResolvedValue({ count: 1 });
    drugMasterCountMock.mockImplementation((args?: { where?: unknown }) =>
      Promise.resolve(args?.where ? 100 : 100),
    );
  });

  afterEach(() => {
    delete process.env.DRUG_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT;
    vi.useRealTimers();
  });

  it('does not alert when package-linked DrugMaster coverage meets the threshold', async () => {
    await expect(checkDrugMasterFreshness()).resolves.toEqual({ processedCount: 0 });

    expect(drugMasterCountMock).toHaveBeenCalledWith();
    expect(drugMasterCountMock).toHaveBeenCalledWith({
      where: { drug_packages: { some: { is_active: true } } },
    });
    expect(notificationCreateManyMock).not.toHaveBeenCalled();
  });

  it('alerts admins when package-linked DrugMaster coverage is below the configured threshold', async () => {
    process.env.DRUG_PACKAGE_COVERAGE_ALERT_THRESHOLD_PERCENT = '5';
    drugMasterCountMock.mockImplementation((args?: { where?: unknown }) =>
      Promise.resolve(args?.where ? 1 : 200),
    );

    await expect(checkDrugMasterFreshness()).resolves.toEqual({ processedCount: 1 });

    expect(notificationCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          org_id: 'org_1',
          user_id: 'admin_1',
          type: 'system',
          title: '医薬品包装マスター不足',
          link: '/admin/drug-masters',
          dedupe_key: 'drug-package-coverage:2026-06-30',
        }),
      ],
      skipDuplicates: true,
    });
    const notification = notificationCreateManyMock.mock.calls[0]?.[0]?.data?.[0];
    expect(notification?.message).toContain('包装GTIN/JANマスター');
    expect(notification?.message).toContain('0.5%');
    expect(notification?.message).toContain('1/200件');
  });
});
