import { describe, expect, it } from 'vitest';
import {
  EPrescriptionAdapterError,
  StubEPrescriptionAdapter,
  createEPrescriptionAdapter,
} from './index';

describe('StubEPrescriptionAdapter', () => {
  it('exposes disabled capabilities for Phase 1', () => {
    const adapter = new StubEPrescriptionAdapter();

    expect(adapter.getCapabilities()).toEqual({
      supportsSearch: false,
      supportsDispenseConfirmation: false,
      supportsPartialDispense: false,
      supportsCancelDispense: false,
    });
  });

  it('throws a typed error for unimplemented fetch/search/confirm operations', async () => {
    const adapter = createEPrescriptionAdapter({ provider: 'stub' });

    await expect(adapter.fetchPrescription('ep-1')).rejects.toMatchObject({
      name: 'EPrescriptionAdapterError',
      code: 'NOT_IMPLEMENTED',
      retriable: false,
    } satisfies Partial<EPrescriptionAdapterError>);

    await expect(
      adapter.searchPrescriptions({ patientExternalId: 'patient-ext-1' })
    ).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    } satisfies Partial<EPrescriptionAdapterError>);

    await expect(
      adapter.confirmDispense({
        prescriptionId: 'ep-1',
        confirmedAt: '2026-03-28T00:00:00.000Z',
        dispensingPharmacistId: 'user_1',
        dispensingOrgId: 'org_1',
        items: [
          {
            lineNumber: 1,
            dispensedDrugName: 'アムロジピン錠5mg',
            quantity: 14,
          },
        ],
      })
    ).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
    } satisfies Partial<EPrescriptionAdapterError>);
  });
});
