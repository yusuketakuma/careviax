import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EPrescriptionAdapterError,
  StubEPrescriptionAdapter,
  createEPrescriptionAdapter,
} from './index';

describe('EPrescriptionAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes disabled capabilities for the stub provider', () => {
    const adapter = new StubEPrescriptionAdapter();

    expect(adapter.getCapabilities()).toEqual({
      supportsSearch: false,
      supportsDispenseConfirmation: false,
      supportsPartialDispense: false,
      supportsCancelDispense: false,
    });
  });

  it('throws a typed error for unimplemented stub operations', async () => {
    const adapter = createEPrescriptionAdapter({ provider: 'stub' });

    await expect(adapter.fetchPrescription('ep-1')).rejects.toMatchObject({
      name: 'EPrescriptionAdapterError',
      code: 'NOT_IMPLEMENTED',
      retriable: false,
    } satisfies Partial<EPrescriptionAdapterError>);
  });

  it('uses the mhlw provider for fetch/search/confirm operations', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              prescriptionId: 'ep-1',
              issuedAt: '2026-03-31T00:00:00.000Z',
              expiresAt: null,
              patientExternalId: 'patient-ext-1',
              patientName: '患者一郎',
              prescriberName: '医師太郎',
              prescriberInstitution: 'CareViaX Clinic',
              status: 'issued',
              items: [],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const adapter = createEPrescriptionAdapter({
      provider: 'mhlw',
      baseUrl: 'https://example.jp/e-prescription',
      apiKey: 'ep-key',
      accessToken: 'ep-token',
    });

    expect(adapter.getCapabilities()).toEqual({
      supportsSearch: true,
      supportsDispenseConfirmation: true,
      supportsPartialDispense: true,
      supportsCancelDispense: false,
    });

    await expect(adapter.fetchPrescription('ep-1')).resolves.toMatchObject({
      prescriptionId: 'ep-1',
      patientName: '患者一郎',
    });
    await expect(
      adapter.searchPrescriptions({ patientExternalId: 'patient-ext-1', includeDispensed: true })
    ).resolves.toEqual([]);
    await expect(
      adapter.confirmDispense({
        prescriptionId: 'ep-1',
        confirmedAt: '2026-03-31T00:00:00.000Z',
        dispensingPharmacistId: 'user_1',
        dispensingOrgId: 'org_1',
        items: [{ lineNumber: 1, dispensedDrugName: 'アムロジピン錠5mg', quantity: 14 }],
      })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.jp/e-prescription/prescriptions/ep-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer ep-token',
          'x-api-key': 'ep-key',
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.jp/e-prescription/prescriptions?patientExternalId=patient-ext-1&includeDispensed=true',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.jp/e-prescription/dispenses/confirm',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });
});
