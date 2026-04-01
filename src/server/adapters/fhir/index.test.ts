import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FhirAdapter } from './index';

describe('FhirAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a patient and medication requests, then posts dispense data', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resourceType: 'Patient',
            id: 'patient-1',
            name: [{ family: '山田', given: ['太郎'] }],
            birthDate: '1940-01-01',
            gender: 'male',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'mr-1',
                  status: 'active',
                  medicationCodeableConcept: {
                    coding: [{ system: 'urn:system', code: '123', display: '薬剤A' }],
                  },
                  dosageInstruction: [
                    {
                      timing: { code: { text: '毎食後' } },
                      doseAndRate: [{ doseQuantity: { value: 1, unit: '錠' } }],
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const adapter = new FhirAdapter('https://example.jp/fhir', {
      accessToken: 'fhir-token',
      apiKey: 'fhir-key',
    });

    await expect(adapter.getPatient('patient-1')).resolves.toMatchObject({ id: 'patient-1' });
    await expect(adapter.getMedicationRequests('patient-1')).resolves.toHaveLength(1);
    await expect(
      adapter.createMedicationDispense({ resourceType: 'MedicationDispense', id: 'dispense-1' })
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.jp/fhir/Patient/patient-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fhir-token',
          'x-api-key': 'fhir-key',
        }),
      })
    );
  });
});
