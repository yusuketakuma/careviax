import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FHIR_R4_VERSION,
  FhirAdapter,
  JP_CORE_VERSION,
  normalizeFhirMedicationDispense,
  normalizeFhirMedicationRequest,
  normalizeFhirMedicationStatement,
  normalizeFhirPatient,
} from './index';

const jpCorePatientProfile = 'http://jpfhir.jp/fhir/core/StructureDefinition/JP_Patient';
const jpCoreMedicationRequestProfile =
  'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest';
const jpCoreMedicationDispenseProfile =
  'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationDispense';
const jpCoreMedicationStatementProfile =
  'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationStatement';

const patientIdentifier = {
  system: 'urn:yrese:patient-id',
  value: 'yr-patient-1',
  use: 'official',
  type: {
    coding: [{ system: 'urn:identifier-type', code: 'MR', display: 'Medical record number' }],
    text: 'yrese patient id',
  },
  assigner: { display: 'yrese' },
};

const medicationCoding = {
  system: 'urn:oid:1.2.392.100495.20.1.73',
  code: '123456789',
  display: '薬剤A',
};

const validPatient = {
  resourceType: 'Patient',
  id: 'patient-1',
  meta: {
    versionId: '7',
    lastUpdated: '2026-07-09T09:00:00+09:00',
    profile: [jpCorePatientProfile],
  },
  identifier: [patientIdentifier],
  name: [{ family: '山田', given: ['太郎'] }],
  birthDate: '1940-01-01',
  gender: 'male',
};

const validMedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'mr-1',
  meta: {
    versionId: '3',
    profile: [jpCoreMedicationRequestProfile],
  },
  identifier: [{ system: 'urn:yrese:prescription-id', value: 'rx-1' }],
  status: 'active',
  intent: 'order',
  medicationCodeableConcept: {
    coding: [medicationCoding],
    text: '薬剤A 10mg',
  },
  subject: { reference: 'Patient/patient-1', identifier: patientIdentifier },
  authoredOn: '2026-07-09T09:00:00+09:00',
  dosageInstruction: [
    {
      text: '毎食後 1回1錠',
      timing: { code: { text: '毎食後' } },
      doseAndRate: [{ doseQuantity: { value: 1, unit: '錠' } }],
    },
  ],
  dispenseRequest: {
    quantity: { value: 28, unit: '錠' },
    expectedSupplyDuration: { value: 14, unit: '日' },
  },
};

const validMedicationDispense = {
  resourceType: 'MedicationDispense',
  id: 'md-1',
  meta: {
    versionId: '1',
    profile: [jpCoreMedicationDispenseProfile],
  },
  identifier: [{ system: 'urn:yrese:dispense-id', value: 'dispense-1' }],
  status: 'completed',
  medicationCodeableConcept: {
    coding: [medicationCoding],
  },
  subject: { reference: 'Patient/patient-1' },
  authorizingPrescription: [{ reference: 'MedicationRequest/mr-1' }],
  quantity: { value: 28, unit: '錠' },
  daysSupply: { value: 14, unit: '日' },
  whenPrepared: '2026-07-09T10:00:00+09:00',
  whenHandedOver: '2026-07-09T11:00:00+09:00',
  dosageInstruction: [{ text: '毎食後 1回1錠', doseAndRate: [] }],
};

const validMedicationStatement = {
  resourceType: 'MedicationStatement',
  id: 'ms-1',
  meta: {
    versionId: '1',
    profile: [jpCoreMedicationStatementProfile],
  },
  identifier: [{ system: 'urn:phos:statement-id', value: 'statement-1' }],
  status: 'active',
  medicationCodeableConcept: {
    coding: [medicationCoding],
  },
  subject: { reference: 'Patient/patient-1' },
  basedOn: [{ reference: 'MedicationRequest/mr-1' }],
  partOf: [{ reference: 'MedicationDispense/md-1' }],
  effectiveDateTime: '2026-07-09T12:00:00+09:00',
  dateAsserted: '2026-07-09T12:30:00+09:00',
  informationSource: { reference: 'RelatedPerson/caregiver-1', display: '家族' },
  derivedFrom: [{ reference: 'MedicationDispense/md-1' }],
  dosage: [{ text: '飲めている', doseAndRate: [] }],
};

describe('FhirAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pins the JP Core and FHIR versions used by PH-OS integration', () => {
    expect(JP_CORE_VERSION).toBe('1.2.0');
    expect(FHIR_R4_VERSION).toBe('4.0.1');
  });

  it('normalizes valid Patient resources and preserves JP Core identifiers/profile metadata', () => {
    expect(normalizeFhirPatient(validPatient)).toMatchObject({
      id: 'patient-1',
      meta: { profile: [jpCorePatientProfile], versionId: '7' },
      identifier: [patientIdentifier],
      name: [{ family: '山田', given: ['太郎'] }],
    });
    expect(normalizeFhirPatient(null)).toBeNull();
    expect(normalizeFhirPatient({ ...validPatient, resourceType: 'Practitioner' })).toBeNull();
    expect(normalizeFhirPatient({ ...validPatient, birthDate: '1940/01/01' })).toBeNull();
    expect(
      normalizeFhirPatient({ ...validPatient, name: [{ family: '山田', given: ['太郎', 123] }] }),
    ).toBeNull();
  });

  it('normalizes MedicationRequest as a request fact and rejects malformed values', () => {
    expect(normalizeFhirMedicationRequest(validMedicationRequest)).toMatchObject({
      resourceType: 'MedicationRequest',
      id: 'mr-1',
      status: 'active',
      intent: 'order',
      subject: { reference: 'Patient/patient-1' },
      authoredOn: '2026-07-09T09:00:00+09:00',
      medicationCodeableConcept: { coding: [medicationCoding] },
    });
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
        intent: undefined,
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
  });

  it('normalizes MedicationDispense separately from requests and statements', () => {
    expect(normalizeFhirMedicationDispense(validMedicationDispense)).toMatchObject({
      resourceType: 'MedicationDispense',
      id: 'md-1',
      status: 'completed',
      authorizingPrescription: [{ reference: 'MedicationRequest/mr-1' }],
      quantity: { value: 28, unit: '錠' },
      whenHandedOver: '2026-07-09T11:00:00+09:00',
    });
    expect(normalizeFhirMedicationDispense(validMedicationRequest)).toBeNull();
    expect(
      normalizeFhirMedicationDispense({
        ...validMedicationDispense,
        medicationCodeableConcept: undefined,
      }),
    ).toBeNull();
  });

  it('normalizes MedicationStatement as reported or derived medication use', () => {
    expect(normalizeFhirMedicationStatement(validMedicationStatement)).toMatchObject({
      resourceType: 'MedicationStatement',
      id: 'ms-1',
      status: 'active',
      basedOn: [{ reference: 'MedicationRequest/mr-1' }],
      partOf: [{ reference: 'MedicationDispense/md-1' }],
      derivedFrom: [{ reference: 'MedicationDispense/md-1' }],
      informationSource: { reference: 'RelatedPerson/caregiver-1' },
    });
    expect(normalizeFhirMedicationStatement(validMedicationDispense)).toBeNull();
    expect(
      normalizeFhirMedicationStatement({
        ...validMedicationStatement,
        subject: undefined,
      }),
    ).toBeNull();
  });

  it('fetches patient medication request, dispense, and statement resources, then posts dispense data', async () => {
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
            entry: [{ resource: validMedicationRequest }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resourceType: 'Bundle',
            entry: [{ resource: validMedicationDispense }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            resourceType: 'Bundle',
            entry: [{ resource: validMedicationStatement }],
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
    await expect(adapter.getMedicationDispenses('patient-1')).resolves.toHaveLength(1);
    await expect(adapter.getMedicationStatements('patient-1')).resolves.toHaveLength(1);
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
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.jp/fhir/MedicationRequest?patient=patient-1',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.jp/fhir/MedicationDispense?patient=patient-1',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://example.jp/fhir/MedicationStatement?patient=patient-1',
      expect.anything(),
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
