import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaimsExportAdapterError,
  createClaimsExportAdapter,
  normalizeClaimsExportResult,
  type ClaimsExportPayload,
} from './index';

const payload: ClaimsExportPayload = {
  orgId: 'org_1',
  siteId: 'site_1',
  billingMonth: '2026-05',
  records: [
    {
      patientId: 'patient_1',
      patientName: '山田花子',
      billingMonth: '2026-05',
      insuranceType: 'medical',
      billingCode: 'CODE-1',
      billingName: '居宅療養管理指導',
      points: 500,
      status: 'ready',
    },
  ],
};

describe('claims export adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes valid export results and rejects malformed roots', () => {
    expect(
      normalizeClaimsExportResult({
        format: 'claims-xml',
        content: '<ClaimsExport />',
        recordCount: 1,
        generatedAt: '2026-05-31T00:00:00.000Z',
        extra: 'ignored',
      }),
    ).toEqual({
      format: 'claims-xml',
      content: '<ClaimsExport />',
      recordCount: 1,
      generatedAt: '2026-05-31T00:00:00.000Z',
    });

    expect(normalizeClaimsExportResult(['unexpected'])).toBeNull();
    expect(normalizeClaimsExportResult(null)).toBeNull();
    expect(
      normalizeClaimsExportResult({
        format: 'pdf',
        content: '<ClaimsExport />',
        recordCount: 1,
        generatedAt: '2026-05-31T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      normalizeClaimsExportResult({
        format: 'claims-xml',
        content: '<ClaimsExport />',
        recordCount: 1.5,
        generatedAt: '2026-05-31T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      normalizeClaimsExportResult({
        format: 'claims-xml',
        content: '<ClaimsExport />',
        recordCount: 1,
        generatedAt: 'not-a-date',
      }),
    ).toBeNull();
  });

  it('fails closed for malformed successful rececom responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ format: 'claims-xml', recordCount: 1 })),
      }),
    );

    const adapter = createClaimsExportAdapter({
      provider: 'rececom',
      baseUrl: 'https://rececom.example.test',
      apiKey: 'api-key',
    });

    await expect(adapter.exportClaims(payload)).rejects.toMatchObject({
      name: 'ClaimsExportAdapterError',
      code: 'UPSTREAM_FAILURE',
      retriable: false,
      status: 200,
    } satisfies Partial<ClaimsExportAdapterError>);
  });

  it('returns normalized rececom export results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              format: 'csv',
              content: 'patient_id,billing_code',
              recordCount: 1,
              generatedAt: '2026-05-31T00:00:00.000Z',
              extra: 'ignored',
            }),
          ),
      }),
    );

    const adapter = createClaimsExportAdapter({
      provider: 'rececom',
      baseUrl: 'https://rececom.example.test/',
      accessToken: 'access-token',
    });

    await expect(adapter.exportClaims(payload)).resolves.toEqual({
      format: 'csv',
      content: 'patient_id,billing_code',
      recordCount: 1,
      generatedAt: '2026-05-31T00:00:00.000Z',
    });
  });
});
