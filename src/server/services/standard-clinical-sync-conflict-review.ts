import { ClinicalIntegrationDirection, ClinicalQueueStatus, type Prisma } from '@prisma/client';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PROFILE_URL_COUNT = 20;
const MAX_PROFILE_URL_LENGTH = 500;

export const CLINICAL_SYNC_REVIEW_CONFLICT_CODES = [
  'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
  'FHIR_PROFILE_VALIDATION_REQUIRED',
] as const;

export type ClinicalSyncReviewConflictCode = (typeof CLINICAL_SYNC_REVIEW_CONFLICT_CODES)[number];

const REVIEW_CONFLICT_DEFINITIONS = {
  PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION: {
    conflictKind: 'patient_link_required',
    retryable: false,
  },
  FHIR_PROFILE_VALIDATION_REQUIRED: {
    conflictKind: 'fhir_profile_validation_required',
    retryable: false,
  },
} as const satisfies Record<
  ClinicalSyncReviewConflictCode,
  {
    conflictKind: 'patient_link_required' | 'fhir_profile_validation_required';
    retryable: false;
  }
>;

type ClinicalSyncConflictReviewDb = {
  clinicalSyncQueueItem: {
    findMany(args: {
      where: Prisma.ClinicalSyncQueueItemWhereInput;
      orderBy: Prisma.ClinicalSyncQueueItemOrderByWithRelationInput[];
      take: number;
      select: {
        display_id: true;
        aggregate_type: true;
        priority: true;
        attempt_count: true;
        max_attempts: true;
        external_reference_id: true;
        fhir_resource_cache_id: true;
        last_error_code: true;
        created_at: true;
        updated_at: true;
      };
    }): Promise<QueueConflictRecord[]>;
  };
  clinicalExternalReference: {
    findMany(args: {
      where: Prisma.ClinicalExternalReferenceWhereInput;
      select: {
        id: true;
        display_id: true;
        resource_type: true;
        status: true;
        confidence: true;
      };
    }): Promise<ExternalReferenceRecord[]>;
  };
  clinicalFhirResourceCache: {
    findMany(args: {
      where: Prisma.ClinicalFhirResourceCacheWhereInput;
      select: {
        id: true;
        resource_type: true;
        resource_id: true;
        version_id: true;
        profile_urls: true;
        validation_status: true;
      };
    }): Promise<FhirResourceCacheRecord[]>;
  };
};

type QueueConflictRecord = {
  display_id: string | null;
  aggregate_type: string;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  external_reference_id: string | null;
  fhir_resource_cache_id: string | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
};

type ExternalReferenceRecord = {
  id: string;
  display_id: string | null;
  resource_type: string;
  status: string;
  confidence: string;
};

type FhirResourceCacheRecord = {
  id: string;
  resource_type: string;
  resource_id: string;
  version_id: string | null;
  profile_urls: string[];
  validation_status: string;
};

type ClinicalSyncConflictBaseDto = {
  queue_display_id: string | null;
  conflict_kind: 'patient_link_required' | 'fhir_profile_validation_required';
  operation_kind: 'yrese_clinical_sync_projection';
  aggregate_type: string;
  priority: number;
  attempts: {
    count: number;
    max: number;
  };
  created_at: string;
  updated_at: string;
  error: {
    code: ClinicalSyncReviewConflictCode;
    retryable: false;
  };
};

export type PatientLinkRequiredConflictDto = ClinicalSyncConflictBaseDto & {
  conflict_kind: 'patient_link_required';
  patient_link_review: {
    external_reference_id: string;
    external_reference_display_id: string | null;
    resource_type: string;
    status: string;
    confidence: string;
  } | null;
};

export type FhirProfileValidationRequiredConflictDto = ClinicalSyncConflictBaseDto & {
  conflict_kind: 'fhir_profile_validation_required';
  profile_validation_review_required: true;
  fhir_resource: {
    resource_type: string;
    resource_id_available: boolean;
    version_id_available: boolean;
    profile_urls: string[];
    validation_status: string;
  } | null;
};

export type ClinicalSyncConflictDto =
  | PatientLinkRequiredConflictDto
  | FhirProfileValidationRequiredConflictDto;

export interface ListClinicalSyncConflictsInput {
  readonly orgId: string;
  readonly limit?: number;
  readonly errorCode?: ClinicalSyncReviewConflictCode;
}

export function isClinicalSyncReviewConflictCode(
  value: unknown,
): value is ClinicalSyncReviewConflictCode {
  return (
    typeof value === 'string' &&
    CLINICAL_SYNC_REVIEW_CONFLICT_CODES.includes(value as ClinicalSyncReviewConflictCode)
  );
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  const normalized = Math.trunc(value);
  if (normalized < 1) return 1;
  return Math.min(normalized, MAX_LIMIT);
}

function requireSupportedConflictCode(
  value: ClinicalSyncReviewConflictCode | undefined,
): ClinicalSyncReviewConflictCode | undefined {
  if (value === undefined) return undefined;
  if (isClinicalSyncReviewConflictCode(value)) return value;
  throw new Error('Unsupported clinical sync review conflict code');
}

function sanitizeProfileUrls(profileUrls: readonly string[]): string[] {
  return profileUrls
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .slice(0, MAX_PROFILE_URL_COUNT)
    .map((value) => value.trim().slice(0, MAX_PROFILE_URL_LENGTH));
}

function buildBaseDto(
  row: QueueConflictRecord,
  errorCode: ClinicalSyncReviewConflictCode,
): ClinicalSyncConflictBaseDto {
  const definition = REVIEW_CONFLICT_DEFINITIONS[errorCode];
  return {
    queue_display_id: row.display_id,
    conflict_kind: definition.conflictKind,
    operation_kind: 'yrese_clinical_sync_projection',
    aggregate_type: row.aggregate_type,
    priority: row.priority,
    attempts: {
      count: row.attempt_count,
      max: row.max_attempts,
    },
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    error: {
      code: errorCode,
      retryable: definition.retryable,
    },
  };
}

function mapConflictDto(args: {
  row: QueueConflictRecord;
  externalReferencesById: Map<string, ExternalReferenceRecord>;
  fhirCachesById: Map<string, FhirResourceCacheRecord>;
}): ClinicalSyncConflictDto | null {
  const errorCode = args.row.last_error_code;
  if (!isClinicalSyncReviewConflictCode(errorCode)) return null;

  const base = buildBaseDto(args.row, errorCode);

  if (errorCode === 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION') {
    const reference = args.row.external_reference_id
      ? args.externalReferencesById.get(args.row.external_reference_id)
      : undefined;

    return {
      ...base,
      conflict_kind: 'patient_link_required',
      patient_link_review:
        reference && args.row.external_reference_id
          ? {
              external_reference_id: args.row.external_reference_id,
              external_reference_display_id: reference.display_id,
              resource_type: reference.resource_type,
              status: reference.status,
              confidence: reference.confidence,
            }
          : null,
    };
  }

  const cache = args.row.fhir_resource_cache_id
    ? args.fhirCachesById.get(args.row.fhir_resource_cache_id)
    : undefined;

  return {
    ...base,
    conflict_kind: 'fhir_profile_validation_required',
    profile_validation_review_required: true,
    fhir_resource: cache
      ? {
          resource_type: cache.resource_type,
          resource_id_available: cache.resource_id.trim().length > 0,
          version_id_available: Boolean(cache.version_id?.trim()),
          profile_urls: sanitizeProfileUrls(cache.profile_urls),
          validation_status: cache.validation_status,
        }
      : null,
  };
}

export async function listClinicalSyncConflicts(
  db: ClinicalSyncConflictReviewDb,
  input: ListClinicalSyncConflictsInput,
): Promise<ClinicalSyncConflictDto[]> {
  const errorCode = requireSupportedConflictCode(input.errorCode);
  const limit = normalizeLimit(input.limit);
  const lastErrorCodeWhere = errorCode ?? { in: [...CLINICAL_SYNC_REVIEW_CONFLICT_CODES] };

  const rows = await db.clinicalSyncQueueItem.findMany({
    where: {
      org_id: input.orgId,
      direction: ClinicalIntegrationDirection.inbound,
      status: ClinicalQueueStatus.conflict_requires_review,
      operation: { startsWith: 'yrese.' },
      last_error_code: lastErrorCodeWhere,
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: limit,
    select: {
      display_id: true,
      aggregate_type: true,
      priority: true,
      attempt_count: true,
      max_attempts: true,
      external_reference_id: true,
      fhir_resource_cache_id: true,
      last_error_code: true,
      created_at: true,
      updated_at: true,
    },
  });

  const externalReferenceIds = [
    ...new Set(
      rows
        .filter((row) => row.last_error_code === 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION')
        .map((row) => row.external_reference_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const fhirResourceCacheIds = [
    ...new Set(
      rows
        .filter((row) => row.last_error_code === 'FHIR_PROFILE_VALIDATION_REQUIRED')
        .map((row) => row.fhir_resource_cache_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const [externalReferences, fhirCaches] = await Promise.all([
    externalReferenceIds.length > 0
      ? db.clinicalExternalReference.findMany({
          where: {
            org_id: input.orgId,
            id: { in: externalReferenceIds },
          },
          select: {
            id: true,
            display_id: true,
            resource_type: true,
            status: true,
            confidence: true,
          },
        })
      : Promise.resolve([]),
    fhirResourceCacheIds.length > 0
      ? db.clinicalFhirResourceCache.findMany({
          where: {
            org_id: input.orgId,
            id: { in: fhirResourceCacheIds },
          },
          select: {
            id: true,
            resource_type: true,
            resource_id: true,
            version_id: true,
            profile_urls: true,
            validation_status: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const externalReferencesById = new Map(externalReferences.map((item) => [item.id, item]));
  const fhirCachesById = new Map(fhirCaches.map((item) => [item.id, item]));

  return rows
    .map((row) => mapConflictDto({ row, externalReferencesById, fhirCachesById }))
    .filter((item): item is ClinicalSyncConflictDto => item !== null);
}
