import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBytes, validateImportSourceUrl, type ImportSourceUrlPolicy } from './shared';

const MHLW_CARE_IMPORT_POLICY: ImportSourceUrlPolicy<'mhlw_care_service'> = {
  source: 'mhlw_care_service',
  allowedHosts: ['www.mhlw.go.jp'],
  maxBytes: 1024,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('import-source shared helpers', () => {
  it('supports non-drug import source policy names without widening URL validation', () => {
    expect(
      validateImportSourceUrl(
        'https://www.mhlw.go.jp/content/12300000/jigyosho_430.csv',
        MHLW_CARE_IMPORT_POLICY,
      ),
    ).toMatchObject({ ok: true });

    expect(
      validateImportSourceUrl('https://example.com/jigyosho_430.csv', MHLW_CARE_IMPORT_POLICY),
    ).toMatchObject({ ok: false });
  });

  it('can scope extra allowed hosts to a caller-specific environment variable', () => {
    const previous = process.env.CARE_IMPORT_ALLOWED_HOSTS;
    process.env.CARE_IMPORT_ALLOWED_HOSTS = 'staging.mhlw.example';
    try {
      expect(
        validateImportSourceUrl('https://staging.mhlw.example/jigyosho_430.csv', {
          ...MHLW_CARE_IMPORT_POLICY,
          extraAllowedHostsEnv: 'CARE_IMPORT_ALLOWED_HOSTS',
        }),
      ).toMatchObject({ ok: true });
    } finally {
      if (previous == null) {
        delete process.env.CARE_IMPORT_ALLOWED_HOSTS;
      } else {
        process.env.CARE_IMPORT_ALLOWED_HOSTS = previous;
      }
    }
  });

  it('keeps credential-bearing URLs out of fetch calls and error messages', async () => {
    const fetchImpl = vi.fn(async () => new Response('blocked'));
    let error: unknown;

    try {
      await fetchBytes('https://importer:secret@www.mhlw.go.jp/content/123/jigyosho_430.csv', {
        fetchImpl,
        policy: MHLW_CARE_IMPORT_POLICY,
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
});
