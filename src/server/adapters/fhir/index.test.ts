import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FhirAdapter, normalizeFhirMedicationRequest, normalizeFhirPatient } from './index';

const validPatient = {
  resourceType: 'Patient',
  id: 'patient-1',
  name: [{ family: '山田', given: ['太郎'] }],
  birthDate: '1940-01-01',
  gender: 'male',
};

const validMedicationRequest = {
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
};

describe('FhirAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes valid Patient resources and rejects malformed values', () => {
    expect(normalizeFhirPatient(validPatient)).toEqual(validPatient);
    expect(normalizeFhirPatient(null)).toBeNull();
    expect(normalizeFhirPatient({ ...validPatient, resourceType: 'Practitioner' })).toBeNull();
    expect(normalizeFhirPatient({ ...validPatient, birthDate: '1940/01/01' })).toBeNull();
    expect(
      normalizeFhirPatient({ ...validPatient, name: [{ family: '山田', given: ['太郎', 123] }] }),
    ).toBeNull();
  });

  it('normalizes valid MedicationRequest resources and rejects malformed values', () => {
    expect(normalizeFhirMedicationRequest(validMedicationRequest)).toEqual(validMedicationRequest);
    expect(normalizeFhirMedicationRequest([])).toBeNull();
    expect(
      normalizeFhirMedicationRequest({
        ...validMedicationRequest,
        resourceType: 'MedicationDispense',
      }),
    ).toBeNull();
    expect(
      normalizeFhirMedicationRequest({
        ...validMedicationRequest,
        medicationCodeableConcept: {
          coding: [{ system: 'urn:system', code: '', display: '薬剤A' }],
        },
      }),
    ).toBeNull();
    expect(
      normalizeFhirMedicationRequest({
        ...validMedicationRequest,
        dosageInstruction: [
          {
            timing: { code: { text: '毎食後' } },
            doseAndRate: [{ doseQuantity: { value: Number.NaN, unit: '錠' } }],
          },
        ],
      }),
    ).toBeNull();
  });

  it('fetches a patient and medication requests, then posts dispense data', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify(validPatient), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resourceType: 'Bundle',
            entry: [
              {
                resource: validMedicationRequest,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 201 }));

    const adapter = new FhirAdapter('https://example.jp/fhir', {
      accessToken: 'fhir-token',
      apiKey: 'fhir-key',
    });

    await expect(adapter.getPatient('patient-1')).resolves.toMatchObject({ id: 'patient-1' });
    await expect(adapter.getMedicationRequests('patient-1')).resolves.toHaveLength(1);
    await expect(
      adapter.createMedicationDispense({ resourceType: 'MedicationDispense', id: 'dispense-1' }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.jp/fhir/Patient/patient-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer fhir-token',
          'x-api-key': 'fhir-key',
        }),
      }),
    );
  });

  it('rejects malformed successful Patient responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ...validPatient, name: [{ family: '山田', given: [123] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const adapter = new FhirAdapter('https://example.jp/fhir');

    await expect(adapter.getPatient('patient-1')).rejects.toMatchObject({
      name: 'HttpAdapterError',
      message: 'FHIR Patient レスポンス形式が不正です',
      status: 200,
    });
  });

  it('rejects malformed successful MedicationRequest bundle responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resourceType: 'Bundle',
          entry: [
            {
              resource: {
                ...validMedicationRequest,
                dosageInstruction: [
                  {
                    timing: { code: { text: '毎食後' } },
                    doseAndRate: [{ doseQuantity: { value: '1', unit: '錠' } }],
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const adapter = new FhirAdapter('https://example.jp/fhir');

    await expect(adapter.getMedicationRequests('patient-1')).rejects.toMatchObject({
      name: 'HttpAdapterError',
      message: 'FHIR MedicationRequest レスポンス形式が不正です',
      status: 200,
    });
  });
});
