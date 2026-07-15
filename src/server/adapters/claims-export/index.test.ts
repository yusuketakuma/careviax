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
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ format: 'claims-xml', recordCount: 1 }), {
          status: 200,
        }),
      ),
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
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            format: 'csv',
            content: 'patient_id,billing_code',
            recordCount: 1,
            generatedAt: '2026-05-31T00:00:00.000Z',
            extra: 'ignored',
          }),
          { status: 200 },
        ),
      ),
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

  it('accepts bulk export responses above 1 MiB and within the shared 5 MiB hard limit', async () => {
    const content = 'x'.repeat(1024 * 1024 + 1);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            format: 'csv',
            content,
            recordCount: 1,
            generatedAt: '2026-05-31T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );
    const adapter = createClaimsExportAdapter({
      provider: 'rececom',
      baseUrl: 'https://rececom.example.test',
    });

    const result = await adapter.exportClaims(payload);

    expect(result.content).toHaveLength(content.length);
    expect(result.recordCount).toBe(1);
  });

  it('rejects bulk export responses above the shared 5 MiB hard limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            format: 'csv',
            content: 'raw-patient-export'.repeat(Math.ceil((5 * 1024 * 1024) / 18)),
            recordCount: 1,
            generatedAt: '2026-05-31T00:00:00.000Z',
          }),
          { status: 200 },
        ),
      ),
    );
    const adapter = createClaimsExportAdapter({
      provider: 'rececom',
      baseUrl: 'https://rececom.example.test',
    });

    const error = await adapter.exportClaims(payload).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      name: 'HttpAdapterError',
      status: 200,
      causeDetail: {
        reason: 'response_body_too_large',
        upstream_status: 200,
        max_bytes: 5 * 1024 * 1024,
      },
    });
    expect(JSON.stringify((error as { causeDetail?: unknown }).causeDetail)).not.toContain(
      'patient',
    );
  });
});
