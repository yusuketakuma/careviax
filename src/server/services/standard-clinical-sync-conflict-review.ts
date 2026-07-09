import {
  ClinicalFhirValidationStatus,
  ClinicalIntegrationDirection,
  ClinicalLocalResourceType,
  ClinicalQueueStatus,
  type Prisma,
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { toPrismaJsonInput } from '@/lib/db/json';
import { FHIR_R4_VERSION, JP_CORE_VERSION } from '@/server/adapters/fhir';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PROFILE_URL_COUNT = 20;
const MAX_PROFILE_URL_LENGTH = 500;
const MAX_VALIDATION_ISSUE_COUNT = 50;
const MAX_VALIDATION_ISSUE_TEXT_LENGTH = 500;

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

type ClinicalSyncConflictListDb = {
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

type ClinicalSyncFhirValidationDetailDb = {
  clinicalSyncQueueItem: {
    findFirst(args: {
      where: Prisma.ClinicalSyncQueueItemWhereInput;
      select: {
        display_id: true;
        id: true;
        aggregate_type: true;
        aggregate_id: true;
        priority: true;
        attempt_count: true;
        max_attempts: true;
        fhir_resource_cache_id: true;
        yrese_event_id: true;
        last_error_code: true;
        created_at: true;
        updated_at: true;
      };
    }): Promise<QueueFhirValidationConflictRecord | null>;
  };
  clinicalFhirResourceCache: {
    findFirst(args: {
      where: Prisma.ClinicalFhirResourceCacheWhereInput;
      select: {
        resource_type: true;
        resource_id: true;
        version_id: true;
        profile_urls: true;
        validation_status: true;
        validation_errors: true;
        fetched_at: true;
        last_modified_at: true;
        updated_at: true;
      };
    }): Promise<FhirResourceCacheValidationDetailRecord | null>;
  };
};

type ClinicalSyncFhirValidationRequeueDb = {
  clinicalSyncQueueItem: ClinicalSyncFhirValidationDetailDb['clinicalSyncQueueItem'] & {
    updateMany(args: {
      where: Prisma.ClinicalSyncQueueItemWhereInput;
      data: Prisma.ClinicalSyncQueueItemUpdateManyMutationInput;
    }): Promise<{ count: number }>;
  };
  clinicalFhirResourceCache: {
    findFirst(args: {
      where: Prisma.ClinicalFhirResourceCacheWhereInput;
      select: {
        id: true;
        resource_type: true;
        validation_status: true;
        content_hash: true;
      };
    }): Promise<FhirResourceCacheRequeueRecord | null>;
  };
  clinicalProvenanceRecord: {
    createMany(args: {
      data: Prisma.ClinicalProvenanceRecordCreateManyInput;
      skipDuplicates: true;
    }): Promise<{ count: number }>;
  };
};

type QueueConflictBaseRecord = {
  display_id: string | null;
  aggregate_type: ClinicalLocalResourceType;
  priority: number;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
};

type QueueFhirValidationConflictRecord = QueueConflictBaseRecord & {
  id: string;
  aggregate_id: string | null;
  fhir_resource_cache_id: string | null;
  yrese_event_id: string | null;
};

type QueueConflictRecord = QueueConflictBaseRecord & {
  external_reference_id: string | null;
  fhir_resource_cache_id: string | null;
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

type FhirResourceCacheValidationDetailRecord = {
  resource_type: string;
  resource_id: string;
  version_id: string | null;
  profile_urls: string[];
  validation_status: string;
  validation_errors: Prisma.JsonValue;
  fetched_at: Date;
  last_modified_at: Date | null;
  updated_at: Date;
};

type FhirResourceCacheRequeueRecord = {
  id: string;
  resource_type: string;
  validation_status: ClinicalFhirValidationStatus;
  content_hash: string;
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

export type ClinicalFhirValidationIssueDto = {
  code: string;
  path: string | null;
  expected: string | null;
};

export type ClinicalSyncFhirValidationDetailDto = ClinicalSyncConflictBaseDto & {
  queue_display_id: string;
  conflict_kind: 'fhir_profile_validation_required';
  profile_validation_review_required: true;
  fhir_resource: {
    resource_type: string;
    resource_id_available: boolean;
    version_id_available: boolean;
    profile_urls: string[];
    validation_status: string;
    fetched_at: string;
    last_modified_at: string | null;
    updated_at: string;
  } | null;
  validation_diagnostics: {
    issue_count: number;
    returned_issue_count: number;
    truncated: boolean;
    issues: ClinicalFhirValidationIssueDto[];
  };
};

export interface ListClinicalSyncConflictsInput {
  readonly orgId: string;
  readonly limit?: number;
  readonly errorCode?: ClinicalSyncReviewConflictCode;
}

export interface GetClinicalSyncFhirValidationDetailInput {
  readonly orgId: string;
  readonly queueDisplayId: string;
}

export interface RequeueClinicalSyncFhirValidationConflictInput {
  readonly orgId: string;
  readonly queueDisplayId: string;
  readonly reviewedByUserId: string;
  readonly now?: Date;
}

export type RequeueClinicalSyncFhirValidationConflictResult =
  | {
      kind: 'requeued';
      queue_display_id: string;
      queue_status: 'pending';
      validation_status: 'valid';
      requeued_queue_item_count: 1;
      provenance_recorded: true;
    }
  | { kind: 'not_found' }
  | { kind: 'cache_missing'; queue_display_id: string }
  | {
      kind: 'validation_not_ready';
      queue_display_id: string;
      validation_status: ClinicalFhirValidationStatus;
    }
  | { kind: 'stale_conflict'; queue_display_id: string };

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

function truncateDiagnosticText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_VALIDATION_ISSUE_TEXT_LENGTH);
}

function readValidationIssues(value: Prisma.JsonValue): {
  issueCount: number;
  issues: ClinicalFhirValidationIssueDto[];
  truncated: boolean;
} {
  const values = Array.isArray(value) ? value : [];
  const issues = values
    .slice(0, MAX_VALIDATION_ISSUE_COUNT)
    .map((item) => {
      const object = typeof item === 'object' && item !== null && !Array.isArray(item) ? item : {};
      const record = object as Record<string, unknown>;
      const code = truncateDiagnosticText(record.code);
      if (!code) return null;
      return {
        code,
        path: truncateDiagnosticText(record.path),
        expected: truncateDiagnosticText(record.expected),
      };
    })
    .filter((item): item is ClinicalFhirValidationIssueDto => item !== null);

  return {
    issueCount: values.length,
    issues,
    truncated: values.length > issues.length,
  };
}

function buildBaseDto(
  row: QueueConflictBaseRecord,
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

function buildFhirValidationDetailDto(args: {
  row: QueueFhirValidationConflictRecord;
  cache: FhirResourceCacheValidationDetailRecord | null;
}): ClinicalSyncFhirValidationDetailDto | null {
  if (args.row.last_error_code !== 'FHIR_PROFILE_VALIDATION_REQUIRED' || !args.row.display_id) {
    return null;
  }

  const base = buildBaseDto(args.row, 'FHIR_PROFILE_VALIDATION_REQUIRED');
  const diagnostics = readValidationIssues(args.cache?.validation_errors ?? null);

  return {
    ...base,
    queue_display_id: args.row.display_id,
    conflict_kind: 'fhir_profile_validation_required',
    profile_validation_review_required: true,
    fhir_resource: args.cache
      ? {
          resource_type: args.cache.resource_type,
          resource_id_available: args.cache.resource_id.trim().length > 0,
          version_id_available: Boolean(args.cache.version_id?.trim()),
          profile_urls: sanitizeProfileUrls(args.cache.profile_urls),
          validation_status: args.cache.validation_status,
          fetched_at: args.cache.fetched_at.toISOString(),
          last_modified_at: args.cache.last_modified_at?.toISOString() ?? null,
          updated_at: args.cache.updated_at.toISOString(),
        }
      : null,
    validation_diagnostics: {
      issue_count: diagnostics.issueCount,
      returned_issue_count: diagnostics.issues.length,
      truncated: diagnostics.truncated,
      issues: diagnostics.issues,
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
  db: ClinicalSyncConflictListDb,
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

export async function getClinicalSyncFhirValidationDetail(
  db: ClinicalSyncFhirValidationDetailDb,
  input: GetClinicalSyncFhirValidationDetailInput,
): Promise<ClinicalSyncFhirValidationDetailDto | null> {
  const row = await db.clinicalSyncQueueItem.findFirst({
    where: {
      org_id: input.orgId,
      display_id: input.queueDisplayId,
      direction: ClinicalIntegrationDirection.inbound,
      status: ClinicalQueueStatus.conflict_requires_review,
      operation: { startsWith: 'yrese.' },
      last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
    },
    select: {
      id: true,
      display_id: true,
      aggregate_type: true,
      aggregate_id: true,
      priority: true,
      attempt_count: true,
      max_attempts: true,
      fhir_resource_cache_id: true,
      yrese_event_id: true,
      last_error_code: true,
      created_at: true,
      updated_at: true,
    },
  });
  if (!row) return null;

  const cache = row.fhir_resource_cache_id
    ? await db.clinicalFhirResourceCache.findFirst({
        where: {
          org_id: input.orgId,
          id: row.fhir_resource_cache_id,
        },
        select: {
          resource_type: true,
          resource_id: true,
          version_id: true,
          profile_urls: true,
          validation_status: true,
          validation_errors: true,
          fetched_at: true,
          last_modified_at: true,
          updated_at: true,
        },
      })
    : null;

  return buildFhirValidationDetailDto({ row, cache });
}

async function createOrFindFhirValidationRequeueProvenance(args: {
  readonly db: ClinicalSyncFhirValidationRequeueDb;
  readonly orgId: string;
  readonly row: QueueFhirValidationConflictRecord;
  readonly cache: FhirResourceCacheRequeueRecord;
  readonly reviewedByUserId: string;
}) {
  const subjectId = args.row.id;
  const activity = 'clinical_sync_queue.fhir_validation_requeued';
  const provenanceSubjectType = args.row.aggregate_type || ClinicalLocalResourceType.other;

  // The ledger is append-only, so use ON CONFLICT DO NOTHING semantics instead of
  // an upsert update or a caught P2002 (which would abort the surrounding transaction).
  return args.db.clinicalProvenanceRecord.createMany({
    data: {
      org_id: args.orgId,
      subject_type: provenanceSubjectType,
      subject_id: args.row.aggregate_id ?? subjectId,
      activity,
      direction: ClinicalIntegrationDirection.inbound,
      fhir_resource_cache_id: args.cache.id,
      yrese_event_id: args.row.yrese_event_id,
      input_hash: args.cache.content_hash,
      recorded_by: args.reviewedByUserId,
      adapter_version: 'standard-clinical-sync-conflict-review.v1',
      jp_core_version: JP_CORE_VERSION,
      fhir_version: FHIR_R4_VERSION,
      transformation_summary: toPrismaJsonInput({
        action: 'requeue_after_fhir_validation',
        queue_display_id: args.row.display_id,
        validation_status: args.cache.validation_status,
        raw_storage: 'not_persisted',
      }),
    },
    skipDuplicates: true,
  });
}

export async function requeueClinicalSyncFhirValidationConflict(
  db: ClinicalSyncFhirValidationRequeueDb,
  input: RequeueClinicalSyncFhirValidationConflictInput,
): Promise<RequeueClinicalSyncFhirValidationConflictResult> {
  const row = await db.clinicalSyncQueueItem.findFirst({
    where: {
      org_id: input.orgId,
      display_id: input.queueDisplayId,
      direction: ClinicalIntegrationDirection.inbound,
      status: ClinicalQueueStatus.conflict_requires_review,
      operation: { startsWith: 'yrese.' },
      last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
    },
    select: {
      id: true,
      display_id: true,
      aggregate_type: true,
      aggregate_id: true,
      priority: true,
      attempt_count: true,
      max_attempts: true,
      fhir_resource_cache_id: true,
      yrese_event_id: true,
      last_error_code: true,
      created_at: true,
      updated_at: true,
    },
  });
  if (!row?.display_id) return { kind: 'not_found' };
  if (!row.fhir_resource_cache_id) {
    return { kind: 'cache_missing', queue_display_id: row.display_id };
  }

  const cache = await db.clinicalFhirResourceCache.findFirst({
    where: {
      org_id: input.orgId,
      id: row.fhir_resource_cache_id,
    },
    select: {
      id: true,
      resource_type: true,
      validation_status: true,
      content_hash: true,
    },
  });
  if (!cache) {
    return { kind: 'cache_missing', queue_display_id: row.display_id };
  }
  if (cache.validation_status !== ClinicalFhirValidationStatus.valid) {
    return {
      kind: 'validation_not_ready',
      queue_display_id: row.display_id,
      validation_status: cache.validation_status,
    };
  }

  const updated = await db.clinicalSyncQueueItem.updateMany({
    where: {
      id: row.id,
      org_id: input.orgId,
      display_id: row.display_id,
      status: ClinicalQueueStatus.conflict_requires_review,
      last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
      fhir_resource_cache_id: cache.id,
    },
    data: {
      status: ClinicalQueueStatus.pending,
      next_attempt_at: input.now ?? new Date(),
      locked_at: null,
      locked_by: null,
      completed_at: null,
      last_error_code: null,
      last_error_metadata: PrismaNamespace.JsonNull,
    },
  });
  if (updated.count !== 1) {
    return { kind: 'stale_conflict', queue_display_id: row.display_id };
  }

  await createOrFindFhirValidationRequeueProvenance({
    db,
    orgId: input.orgId,
    row,
    cache,
    reviewedByUserId: input.reviewedByUserId,
  });

  return {
    kind: 'requeued',
    queue_display_id: row.display_id,
    queue_status: 'pending',
    validation_status: ClinicalFhirValidationStatus.valid,
    requeued_queue_item_count: 1,
    provenance_recorded: true,
  };
}
