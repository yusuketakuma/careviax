import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  QualificationCheckAdapterError,
  StubQualificationCheckAdapter,
  createQualificationCheckAdapter,
  normalizeQualificationCheckResult,
} from './index';

describe('QualificationCheckAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes disabled capabilities for the stub provider', () => {
    const adapter = new StubQualificationCheckAdapter();

    expect(adapter.getCapabilities()).toEqual({
      supportsOnlineLookup: false,
      supportsBenefitHistory: false,
      supportsCareInsurance: false,
    });
  });

  it('throws a typed not-implemented error for the stub provider', async () => {
    const adapter = createQualificationCheckAdapter({ provider: 'stub' });

    await expect(
      adapter.checkInsurance({
        patientExternalId: 'patient-ext-1',
        insuranceNumber: '12345678',
        asOfDate: '2026-03-31',
      }),
    ).rejects.toMatchObject({
      name: 'QualificationCheckAdapterError',
      code: 'NOT_IMPLEMENTED',
      retriable: false,
    } satisfies Partial<QualificationCheckAdapterError>);
  });

  it('uses the mhlw provider to perform online insurance checks', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            valid: true,
            patientName: '患者一郎',
            payerName: '協会けんぽ',
            payerType: 'medical',
            copayRatio: 0.3,
            coverage: {
              startDate: '2026-01-01',
              endDate: '2026-12-31',
            },
            warnings: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = createQualificationCheckAdapter({
      provider: 'mhlw',
      baseUrl: 'https://example.jp/qualification',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      accessToken: 'qualification-token',
    });

    expect(adapter.getCapabilities()).toEqual({
      supportsOnlineLookup: true,
      supportsBenefitHistory: true,
      supportsCareInsurance: true,
    });

    await expect(
      adapter.checkInsurance({
        patientExternalId: 'patient-ext-1',
        insuranceNumber: '12345678',
        asOfDate: '2026-03-31',
      }),
    ).resolves.toMatchObject({
      valid: true,
      payerName: '協会けんぽ',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.jp/qualification/insurance/check',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer qualification-token',
          'x-client-id': 'client-id',
          'x-client-secret': 'client-secret',
        }),
      }),
    );
  });

  it('normalizes valid qualification results and rejects malformed values', () => {
    expect(
      normalizeQualificationCheckResult({
        valid: true,
        patientName: '患者一郎',
        payerName: null,
        payerType: 'medical',
        copayRatio: 0.3,
        coverage: { startDate: '2026-01-01', endDate: null },
        warnings: [],
        raw: { source: 'mhlw' },
      }),
    ).toEqual({
      valid: true,
      patientName: '患者一郎',
      payerName: null,
      payerType: 'medical',
      copayRatio: 0.3,
      coverage: { startDate: '2026-01-01', endDate: null },
      warnings: [],
      raw: { source: 'mhlw' },
    });

    expect(normalizeQualificationCheckResult(['unexpected'])).toBeNull();
    expect(normalizeQualificationCheckResult({ valid: true, payerType: 'medical' })).toBeNull();
    expect(
      normalizeQualificationCheckResult({
        valid: true,
        patientName: '患者一郎',
        payerName: null,
        payerType: 'invalid',
        copayRatio: 0.3,
        coverage: { startDate: '2026-01-01', endDate: null },
        warnings: [],
      }),
    ).toBeNull();
    expect(
      normalizeQualificationCheckResult({
        valid: true,
        patientName: '患者一郎',
        payerName: null,
        payerType: 'medical',
        copayRatio: 0.3,
        coverage: { startDate: '2026-01-01', endDate: null },
        warnings: ['ok', 123],
      }),
    ).toBeNull();
  });

  it('fails closed for malformed successful qualification responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { valid: true, payerType: 'medical' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const adapter = createQualificationCheckAdapter({
      provider: 'mhlw',
      baseUrl: 'https://example.jp/qualification',
      accessToken: 'qualification-token',
    });

    await expect(
      adapter.checkInsurance({
        patientExternalId: 'patient-ext-1',
        asOfDate: '2026-03-31',
      }),
    ).rejects.toMatchObject({
      name: 'QualificationCheckAdapterError',
      code: 'UPSTREAM_FAILURE',
      retriable: false,
      status: 200,
    } satisfies Partial<QualificationCheckAdapterError>);
  });
});
