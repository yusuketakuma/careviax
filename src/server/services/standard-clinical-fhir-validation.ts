import {
  ClinicalFhirResourceType,
  ClinicalFhirValidationStatus,
  type Prisma,
} from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import {
  JP_CORE_VERSION,
  normalizeFhirMedicationDispense,
  normalizeFhirMedicationRequest,
  normalizeFhirMedicationStatement,
  normalizeFhirPatient,
} from '@/server/adapters/fhir';

export const JP_CORE_PROFILE_URLS: Readonly<Partial<Record<ClinicalFhirResourceType, string>>> = {
  [ClinicalFhirResourceType.patient]: 'http://jpfhir.jp/fhir/core/StructureDefinition/JP_Patient',
  [ClinicalFhirResourceType.medication_request]:
    'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest',
  [ClinicalFhirResourceType.medication_dispense]:
    'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationDispense',
  [ClinicalFhirResourceType.medication_statement]:
    'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationStatement',
};

export interface ClinicalFhirValidationIssue {
  readonly code: string;
  readonly path?: string;
  readonly expected?: string;
}

export interface ClinicalFhirValidationInput {
  readonly resource: unknown;
  readonly resourceType: ClinicalFhirResourceType;
  /**
   * Caller-observed profile URLs. Kept for import metadata compatibility, but
   * validation decisions derive profile URLs from resource.meta.profile.
   */
  readonly profileUrls: readonly string[];
  readonly requestedStatus?: ClinicalFhirValidationStatus;
  readonly requestedErrors?: readonly unknown[];
}

export interface ClinicalFhirValidationAssessment {
  readonly status: ClinicalFhirValidationStatus;
  readonly errors?: readonly ClinicalFhirValidationIssue[];
}

function hasJpCoreProfile(profileUrls: readonly string[], expectedProfileUrl: string) {
  return profileUrls.includes(expectedProfileUrl);
}

function externalErrorsWereProvided(errors: readonly unknown[] | undefined) {
  return Array.isArray(errors) && errors.length > 0;
}

function appendJsonShapeIssues(
  value: unknown,
  path: string,
  issues: ClinicalFhirValidationIssue[],
) {
  if (value === undefined) {
    issues.push({ code: 'FHIR_JSON_UNDEFINED_NOT_ALLOWED', path });
    return;
  }

  if (value === null) {
    issues.push({ code: 'FHIR_JSON_NULL_NOT_ALLOWED', path });
    return;
  }

  if (typeof value === 'string' && value.length === 0) {
    issues.push({ code: 'FHIR_JSON_EMPTY_STRING_NOT_ALLOWED', path });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      issues.push({ code: 'FHIR_JSON_EMPTY_ARRAY_NOT_ALLOWED', path });
      return;
    }
    value.forEach((item, index) => appendJsonShapeIssues(item, `${path}[${index}]`, issues));
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      issues.push({ code: 'FHIR_JSON_EMPTY_OBJECT_NOT_ALLOWED', path });
      return;
    }
    for (const [key, item] of entries) {
      appendJsonShapeIssues(item, `${path}.${key}`, issues);
    }
  }
}

function validateFhirJsonShape(resource: unknown): readonly ClinicalFhirValidationIssue[] {
  const issues: ClinicalFhirValidationIssue[] = [];
  appendJsonShapeIssues(resource, '$', issues);

  const object = readJsonObject(resource);
  if (!object) {
    issues.push({ code: 'FHIR_JSON_RESOURCE_OBJECT_REQUIRED', path: '$' });
    return issues;
  }

  if (typeof object.resourceType !== 'string' || object.resourceType.trim() === '') {
    issues.push({
      code: 'FHIR_JSON_RESOURCE_TYPE_REQUIRED',
      path: '$.resourceType',
      expected: 'non-empty string',
    });
  }

  return issues;
}

function readResourceProfileUrls(resource: unknown): readonly string[] | null {
  const object = readJsonObject(resource);
  const meta = readJsonObject(object?.meta);
  if (!meta || meta.profile === undefined) return [];
  if (!Array.isArray(meta.profile)) return null;
  return meta.profile.every(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  )
    ? meta.profile
    : null;
}

function validateSupportedResourceStructure(
  resourceType: ClinicalFhirResourceType,
  resource: unknown,
): readonly ClinicalFhirValidationIssue[] {
  switch (resourceType) {
    case ClinicalFhirResourceType.patient:
      return normalizeFhirPatient(resource)
        ? []
        : [{ code: 'FHIR_R4_PATIENT_SHAPE_INVALID', path: '$' }];
    case ClinicalFhirResourceType.medication_request:
      return normalizeFhirMedicationRequest(resource)
        ? []
        : [{ code: 'FHIR_R4_MEDICATION_REQUEST_SHAPE_INVALID', path: '$' }];
    case ClinicalFhirResourceType.medication_dispense:
      return normalizeFhirMedicationDispense(resource)
        ? []
        : [{ code: 'FHIR_R4_MEDICATION_DISPENSE_SHAPE_INVALID', path: '$' }];
    case ClinicalFhirResourceType.medication_statement:
      return normalizeFhirMedicationStatement(resource)
        ? []
        : [{ code: 'FHIR_R4_MEDICATION_STATEMENT_SHAPE_INVALID', path: '$' }];
    default:
      return [];
  }
}

function normalizeRequestedStatus(status: ClinicalFhirValidationStatus | undefined) {
  return status ?? ClinicalFhirValidationStatus.not_validated;
}

function errorPayloadMarker(requestedErrors: readonly unknown[] | undefined) {
  return externalErrorsWereProvided(requestedErrors)
    ? [{ code: 'EXTERNAL_VALIDATOR_ERRORS_REDACTED', path: '$' }]
    : [];
}

export function assessClinicalFhirValidation(
  input: ClinicalFhirValidationInput,
): ClinicalFhirValidationAssessment {
  const requestedStatus = normalizeRequestedStatus(input.requestedStatus);
  const resourceProfileUrls = readResourceProfileUrls(input.resource);
  const errors = [
    ...validateFhirJsonShape(input.resource),
    ...(resourceProfileUrls === null
      ? [
          {
            code: 'FHIR_JSON_META_PROFILE_INVALID',
            path: '$.meta.profile',
            expected: 'non-empty string[]',
          },
        ]
      : []),
    ...validateSupportedResourceStructure(input.resourceType, input.resource),
    ...errorPayloadMarker(input.requestedErrors),
  ];

  if (errors.length > 0) {
    return { status: ClinicalFhirValidationStatus.invalid, errors };
  }

  const expectedProfileUrl = JP_CORE_PROFILE_URLS[input.resourceType];
  const profileUrls = resourceProfileUrls ?? [];
  if (!expectedProfileUrl) {
    return {
      status: ClinicalFhirValidationStatus.unsupported_profile,
      errors: [
        {
          code: 'JP_CORE_PROFILE_NOT_SUPPORTED_BY_PH_OS',
          path: '$.meta.profile',
          expected: `JP Core ${JP_CORE_VERSION} supported PH-OS profile`,
        },
      ],
    };
  }

  if (profileUrls.length > 0 && !hasJpCoreProfile(profileUrls, expectedProfileUrl)) {
    return {
      status: ClinicalFhirValidationStatus.unsupported_profile,
      errors: [
        {
          code: 'JP_CORE_PROFILE_URL_UNSUPPORTED',
          path: '$.meta.profile',
          expected: expectedProfileUrl,
        },
      ],
    };
  }

  if (requestedStatus === ClinicalFhirValidationStatus.valid) {
    if (!hasJpCoreProfile(profileUrls, expectedProfileUrl)) {
      return {
        status: ClinicalFhirValidationStatus.unsupported_profile,
        errors: [
          {
            code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS',
            path: '$.meta.profile',
            expected: expectedProfileUrl,
          },
        ],
      };
    }
    return { status: ClinicalFhirValidationStatus.valid };
  }

  return { status: requestedStatus };
}

export function toValidationErrorsJson(
  assessment: ClinicalFhirValidationAssessment,
): Prisma.InputJsonValue | undefined {
  if (!assessment.errors || assessment.errors.length === 0) return undefined;
  return assessment.errors.map((issue) => ({
    code: issue.code,
    ...(issue.path ? { path: issue.path } : {}),
    ...(issue.expected ? { expected: issue.expected } : {}),
  }));
}
