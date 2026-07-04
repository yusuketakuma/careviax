import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';

const { loggerWarnMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import {
  MHLW_IMPORT_URL_POLICY,
  extractImportSourceDateFromUrl,
  fetchBytes,
  parseImportSourceDateToken,
  parseJapaneseEraApplicableDateText,
  unzipWithLimits,
  validateImportSourceUrl,
  withImportLog,
} from './shared';

afterEach(() => {
  vi.restoreAllMocks();
  loggerWarnMock.mockReset();
});

describe('validateImportSourceUrl', () => {
  it('allows official HTTPS import URLs', () => {
    const result = validateImportSourceUrl(
      'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      MHLW_IMPORT_URL_POLICY,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects non-HTTPS and non-allowlisted import URLs', () => {
    expect(
      validateImportSourceUrl(
        'http://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
        MHLW_IMPORT_URL_POLICY,
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateImportSourceUrl('https://example.com/price.xlsx', MHLW_IMPORT_URL_POLICY),
    ).toMatchObject({ ok: false });
  });

  it('rejects credential-bearing official import URLs', () => {
    const result = validateImportSourceUrl(
      'https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/price.xlsx',
      MHLW_IMPORT_URL_POLICY,
    );

    expect(result).toMatchObject({
      ok: false,
      message: '認証情報を含む取込URLは指定できません',
    });
  });

  it('rejects private or reserved IP literals even when allowlisted by environment', () => {
    const previous = process.env.DRUG_MASTER_IMPORT_ALLOWED_HOSTS;
    process.env.DRUG_MASTER_IMPORT_ALLOWED_HOSTS = '127.0.0.1';
    try {
      expect(
        validateImportSourceUrl('https://127.0.0.1/price.xlsx', MHLW_IMPORT_URL_POLICY),
      ).toMatchObject({ ok: false });
    } finally {
      if (previous == null) {
        delete process.env.DRUG_MASTER_IMPORT_ALLOWED_HOSTS;
      } else {
        process.env.DRUG_MASTER_IMPORT_ALLOWED_HOSTS = previous;
      }
    }
  });
});

describe('import source date helpers', () => {
  it('parses official source date tokens without timezone drift', () => {
    expect(parseImportSourceDateToken('20260611')?.toISOString()).toBe('2026-06-11T00:00:00.000Z');
    expect(parseImportSourceDateToken('260401')?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(parseImportSourceDateToken('not-a-date')).toBeNull();
  });

  it('extracts publication dates from source URLs only through caller-supplied patterns', () => {
    expect(
      extractImportSourceDateFromUrl(
        'https://www.mhlw.go.jp/topics/2026/04/xls/tp20260520-01_01.xlsx',
        [/tp(\d{8})-/i],
      )?.toISOString(),
    ).toBe('2026-05-20T00:00:00.000Z');
    expect(
      extractImportSourceDateFromUrl('https://www.mhlw.go.jp/topics/2026/04/xls/file.xlsx', [
        /tp(\d{8})-/i,
      ]),
    ).toBeNull();
  });

  it('parses Japanese era applicable dates without timezone drift', () => {
    expect(parseJapaneseEraApplicableDateText('令和8年5月20日適用')?.toISOString()).toBe(
      '2026-05-20T00:00:00.000Z',
    );
    expect(parseJapaneseEraApplicableDateText('令和８年５月２０日')?.toISOString()).toBe(
      '2026-05-20T00:00:00.000Z',
    );
    expect(parseJapaneseEraApplicableDateText('平成1年1月8日適用')?.toISOString()).toBe(
      '1989-01-08T00:00:00.000Z',
    );
    expect(parseJapaneseEraApplicableDateText('令和8年13月1日適用')).toBeNull();
    expect(parseJapaneseEraApplicableDateText('令和8年2月31日適用')).toBeNull();
    expect(parseJapaneseEraApplicableDateText('適用日未掲載')).toBeNull();
  });
});

describe('fetchBytes', () => {
  it('rejects credential-bearing URLs before fetching or echoing credentials in errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked'));
    let error: unknown;

    try {
      await fetchBytes('https://importer:secret@www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        resolveHostname: async () => ['8.8.8.8'],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('認証情報を含む取込URLは指定できません');
    expect((error as Error).message).not.toMatch(/importer|secret/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects allowed hostnames that resolve to private addresses before fetching', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked'));

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        resolveHostname: async () => ['10.0.0.10'],
      }),
    ).rejects.toThrow(/private\/reserved IP/);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates redirects before following them', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/latest/meta-data/' },
        }),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/private\/reserved IP|公式取込ホスト/);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects responses over the configured size limit', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('oversized', {
          status: 200,
          headers: { 'content-length': '9' },
        }),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        maxBytes: 8,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/サイズが上限/);
  });

  it('caps invalid requested byte limits to the source policy limit', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('oversized', {
          status: 200,
          headers: { 'content-length': '9' },
        }),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          maxBytes: 8,
        },
        maxBytes: Number.POSITIVE_INFINITY,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/サイズが上限/);
  });

  it('rejects streamed responses that exceed the size limit without content-length', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4]));
              controller.enqueue(new Uint8Array([5, 6, 7, 8]));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        maxBytes: 7,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/サイズが上限/);
  });

  it('logs a safe warning when oversized stream cancellation fails', async () => {
    const cancelError = new Error('cancel failed token=secret');
    const cancelMock = vi.fn(() => {
      throw cancelError;
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3, 4]));
              controller.enqueue(new Uint8Array([5, 6, 7, 8]));
            },
            cancel: cancelMock,
          }),
          { status: 200 },
        ),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: MHLW_IMPORT_URL_POLICY,
        maxBytes: 7,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/サイズが上限/);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'drug-master-import.stream-cancel-failed',
        operation: 'read-response-bytes',
        code: 'max-bytes-exceeded',
        filePurpose: 'drug-master-import',
        externalProvider: 'mhlw-price',
      },
      cancelError,
    );
    const warningContext = JSON.stringify(loggerWarnMock.mock.calls[0]?.[0]);
    expect(warningContext).not.toContain('token=secret');
    expect(warningContext).not.toContain('https://www.mhlw.go.jp');
  });

  it('stops following redirect loops at the configured redirect limit', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx' },
        }),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          maxRedirects: 1,
        },
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/リダイレクト回数が上限/);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('uses the default redirect limit when the configured redirect limit is invalid', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx' },
        }),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          maxRedirects: Number.POSITIVE_INFINITY,
        },
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/リダイレクト回数が上限/);

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('uses the default fetch timeout when the configured timeout is invalid', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          timeoutMs: Number.NaN,
        },
        maxBytes: 8,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).resolves.toEqual(Buffer.from('ok'));

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
  });

  it('unrefs and clears the fetch timeout after a successful download', async () => {
    const timeoutHandle = { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue(timeoutHandle);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          timeoutMs: 2_500,
        },
        maxBytes: 8,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).resolves.toEqual(Buffer.from('ok'));

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_500);
    expect(timeoutHandle.unref).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutHandle);
  });

  it('aborts stalled response body reads with the configured timeout', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1]));
            },
          }),
          { status: 200 },
        ),
    );

    await expect(
      fetchBytes('https://www.mhlw.go.jp/topics/2026/04/xls/price.xlsx', {
        fetchImpl,
        policy: {
          ...MHLW_IMPORT_URL_POLICY,
          timeoutMs: 5,
        },
        maxBytes: 8,
        resolveHostname: async () => ['8.8.8.8'],
      }),
    ).rejects.toThrow(/タイムアウト/);
  });
});

describe('unzipWithLimits', () => {
  it('rejects ZIP archives over the entry count limit before extraction', () => {
    const zipped = zipSync({
      'a.txt': new TextEncoder().encode('a'),
      'b.txt': new TextEncoder().encode('b'),
    });

    expect(() =>
      unzipWithLimits(zipped, {
        sourceLabel: 'テストZIP',
        limits: {
          maxEntries: 1,
          maxEntryBytes: 16,
          maxTotalBytes: 16,
        },
      }),
    ).toThrow(/エントリ数が上限/);
  });

  it('rejects ZIP archives over the per-entry uncompressed byte limit', () => {
    const zipped = zipSync({
      'large.txt': new TextEncoder().encode('12345'),
    });

    expect(() =>
      unzipWithLimits(zipped, {
        sourceLabel: 'テストZIP',
        limits: {
          maxEntries: 5,
          maxEntryBytes: 4,
          maxTotalBytes: 16,
        },
      }),
    ).toThrow(/ZIP展開サイズが上限/);
  });
});

describe('withImportLog', () => {
  it('persists a safe failure message without leaking caught error diagnostics', async () => {
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockResolvedValue({ id: 'log_1', status: 'failed' }),
      },
    };
    const unsafeError = new Error(
      'database failed patient=患者A token=secret source_url=https://internal.example/import.xlsx',
    );

    await expect(
      withImportLog(db, 'mhlw_price', async () => {
        throw unsafeError;
      }),
    ).rejects.toBe(unsafeError);

    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: {
        status: 'failed',
        error_log: '医薬品マスタ取込に失敗しました',
      },
    });
    const failedUpdate = JSON.stringify(db.drugMasterImportLog.update.mock.calls.at(-1)?.[0]);
    expect(failedUpdate).not.toContain('患者A');
    expect(failedUpdate).not.toContain('token=secret');
    expect(failedUpdate).not.toContain('internal.example');
  });

  it('rethrows the original importer error when recording the failed import log also fails', async () => {
    const db = {
      drugMasterImportLog: {
        create: vi.fn().mockResolvedValue({ id: 'log_1', status: 'running' }),
        update: vi.fn().mockRejectedValue(new Error('log update failed token=secret 患者A')),
      },
    };
    const unsafeError = new Error(
      'import failed patient=患者B source_url=https://internal.example/a',
    );

    await expect(
      withImportLog(db, 'pmda', async () => {
        throw unsafeError;
      }),
    ).rejects.toBe(unsafeError);

    expect(db.drugMasterImportLog.update).toHaveBeenCalledWith({
      where: { id: 'log_1' },
      data: {
        status: 'failed',
        error_log: '医薬品マスタ取込に失敗しました',
      },
    });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      {
        event: 'drug-master-import.failure-log-update-failed',
        operation: 'with-import-log',
        filePurpose: 'drug-master-import',
        externalProvider: 'pmda',
      },
      expect.any(Error),
    );
    const warningContext = JSON.stringify(loggerWarnMock.mock.calls.at(-1)?.[0]);
    expect(warningContext).not.toContain('患者A');
    expect(warningContext).not.toContain('患者B');
    expect(warningContext).not.toContain('token=secret');
    expect(warningContext).not.toContain('internal.example');
  });
});
