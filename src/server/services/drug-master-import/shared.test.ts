import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  MHLW_IMPORT_URL_POLICY,
  extractImportSourceDateFromUrl,
  fetchBytes,
  parseImportSourceDateToken,
  unzipWithLimits,
  validateImportSourceUrl,
} from './shared';

afterEach(() => {
  vi.restoreAllMocks();
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
