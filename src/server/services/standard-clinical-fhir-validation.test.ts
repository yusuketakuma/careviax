import { ClinicalFhirResourceType, ClinicalFhirValidationStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assessClinicalFhirValidation,
  JP_CORE_PROFILE_URLS,
  toValidationErrorsJson,
} from './standard-clinical-fhir-validation';

const MEDICATION_REQUEST_PROFILE =
  JP_CORE_PROFILE_URLS[ClinicalFhirResourceType.medication_request] ??
  'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest';

const validMedicationRequest = {
  resourceType: 'MedicationRequest',
  id: 'medreq_1',
  meta: {
    profile: [MEDICATION_REQUEST_PROFILE],
    versionId: 'v1',
    lastUpdated: '2026-07-09T09:00:00+09:00',
  },
  identifier: [{ system: 'urn:yrese:prescription', value: 'LEAK_IDENTIFIER' }],
  status: 'active',
  intent: 'order',
  medicationCodeableConcept: {
    coding: [
      {
        system: 'urn:oid:1.2.392.100495.20.2.74',
        code: '1234567890',
        display: 'LEAK_MEDICATION_DISPLAY',
      },
    ],
  },
  subject: { reference: 'Patient/patient_1' },
  dosageInstruction: [{ text: 'LEAK_DOSAGE_TEXT' }],
  authoredOn: '2026-07-09T09:00:00+09:00',
};

describe('assessClinicalFhirValidation', () => {
  it('marks a supported JP Core resource valid only when the caller supplies a valid external validation result', () => {
    const assessment = assessClinicalFhirValidation({
      resource: validMedicationRequest,
      resourceType: ClinicalFhirResourceType.medication_request,
      profileUrls: [MEDICATION_REQUEST_PROFILE],
      requestedStatus: ClinicalFhirValidationStatus.valid,
    });

    expect(assessment).toEqual({ status: ClinicalFhirValidationStatus.valid });
  });

  it('does not promote an externally valid resource when the JP Core profile URL is missing', () => {
    const assessment = assessClinicalFhirValidation({
      resource: { ...validMedicationRequest, meta: { versionId: 'v1' } },
      resourceType: ClinicalFhirResourceType.medication_request,
      profileUrls: [],
      requestedStatus: ClinicalFhirValidationStatus.valid,
    });

    expect(assessment).toMatchObject({
      status: ClinicalFhirValidationStatus.unsupported_profile,
      errors: [
        expect.objectContaining({
          code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS',
          expected: MEDICATION_REQUEST_PROFILE,
        }),
      ],
    });
  });

  it('derives profile trust from resource.meta.profile instead of caller-provided profile URLs', () => {
    const assessment = assessClinicalFhirValidation({
      resource: { ...validMedicationRequest, meta: { versionId: 'v1' } },
      resourceType: ClinicalFhirResourceType.medication_request,
      profileUrls: [MEDICATION_REQUEST_PROFILE],
      requestedStatus: ClinicalFhirValidationStatus.valid,
    });

    expect(assessment).toMatchObject({
      status: ClinicalFhirValidationStatus.unsupported_profile,
      errors: [
        expect.objectContaining({
          code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS',
        }),
      ],
    });
  });

  it('keeps malformed FHIR JSON invalid and stores only redacted issue metadata', () => {
    const assessment = assessClinicalFhirValidation({
      resource: {
        ...validMedicationRequest,
        status: null,
        contained: [{ resourceType: 'Patient', id: 'LEAK_PATIENT_ID', name: '' }],
      },
      resourceType: ClinicalFhirResourceType.medication_request,
      profileUrls: [MEDICATION_REQUEST_PROFILE],
      requestedStatus: ClinicalFhirValidationStatus.valid,
      requestedErrors: [{ detail: 'LEAK_EXTERNAL_VALIDATOR_DETAIL' }],
    });

    expect(assessment.status).toBe(ClinicalFhirValidationStatus.invalid);
    const serializedErrors = JSON.stringify(toValidationErrorsJson(assessment));
    expect(serializedErrors).toContain('FHIR_JSON_NULL_NOT_ALLOWED');
    expect(serializedErrors).toContain('EXTERNAL_VALIDATOR_ERRORS_REDACTED');
    expect(serializedErrors).not.toContain('LEAK_PATIENT_ID');
    expect(serializedErrors).not.toContain('LEAK_EXTERNAL_VALIDATOR_DETAIL');
  });

  it('rejects JavaScript undefined values before treating an object as FHIR JSON', () => {
    const assessment = assessClinicalFhirValidation({
      resource: {
        ...validMedicationRequest,
        authoredOn: undefined,
      },
      resourceType: ClinicalFhirResourceType.medication_request,
      profileUrls: [MEDICATION_REQUEST_PROFILE],
      requestedStatus: ClinicalFhirValidationStatus.valid,
    });

    expect(assessment).toMatchObject({
      status: ClinicalFhirValidationStatus.invalid,
      errors: [expect.objectContaining({ code: 'FHIR_JSON_UNDEFINED_NOT_ALLOWED' })],
    });
  });

  it('marks unsupported resource profiles as unsupported instead of JP Core valid', () => {
    const assessment = assessClinicalFhirValidation({
      resource: {
        resourceType: 'Coverage',
        id: 'coverage_1',
        meta: {
          profile: ['http://jpfhir.jp/fhir/core/StructureDefinition/JP_Coverage'],
        },
      },
      resourceType: ClinicalFhirResourceType.coverage,
      profileUrls: ['http://jpfhir.jp/fhir/core/StructureDefinition/JP_Coverage'],
      requestedStatus: ClinicalFhirValidationStatus.valid,
    });

    expect(assessment.status).toBe(ClinicalFhirValidationStatus.unsupported_profile);
  });
});
