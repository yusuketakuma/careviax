import { describe, expect, it } from 'vitest';
import {
  QualificationCheckAdapterError,
  StubQualificationCheckAdapter,
  createQualificationCheckAdapter,
} from './index';

describe('StubQualificationCheckAdapter', () => {
  it('exposes disabled capabilities for Phase 1', () => {
    const adapter = new StubQualificationCheckAdapter();

    expect(adapter.getCapabilities()).toEqual({
      supportsOnlineLookup: false,
      supportsBenefitHistory: false,
      supportsCareInsurance: false,
    });
  });

  it('throws a typed not-implemented error for online insurance checks', async () => {
    const adapter = createQualificationCheckAdapter({ provider: 'stub' });

    await expect(
      adapter.checkInsurance({
        patientExternalId: 'patient-ext-1',
        insuranceNumber: '12345678',
        asOfDate: '2026-03-28',
      })
    ).rejects.toMatchObject({
      name: 'QualificationCheckAdapterError',
      code: 'NOT_IMPLEMENTED',
      retriable: false,
    } satisfies Partial<QualificationCheckAdapterError>);
  });
});
