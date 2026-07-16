import {
  ClinicalFhirValidationStatus,
  ClinicalFhirResourceType,
  ClinicalIntegrationDirection,
  ClinicalLocalResourceType,
  ClinicalQueueStatus,
  ClinicalSyncStatus,
  MedicationTimelineSourceKind,
  type Prisma,
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { FHIR_R4_VERSION, JP_CORE_VERSION } from '@/server/adapters/fhir';

const DEFAULT_DRAIN_LIMIT = 50;
const MAX_DRAIN_LIMIT = 200;
const DEFAULT_LOCKED_BY = 'ph-os-yrese-clinical-sync';
const RETRY_DELAY_MS = 5 * 60 * 1000;

type ClinicalSyncQueueTx = Pick<
  Prisma.TransactionClient,
  | 'clinicalSyncQueueItem'
  | 'clinicalFhirResourceCache'
  | 'medicationTimelineItem'
  | 'clinicalProvenanceRecord'
>;

type RunInOrgContext = <T>(
  orgId: string,
  work: (tx: ClinicalSyncQueueTx) => Promise<T>,
) => Promise<T>;

type QueueRecord = {
  id: string;
  org_id: string;
  status: ClinicalQueueStatus;
  operation: string;
  aggregate_type: ClinicalLocalResourceType;
  aggregate_id: string | null;
  fhir_resource_cache_id: string | null;
  external_reference_id: string | null;
  yrese_event_id: string | null;
  attempt_count: number;
  max_attempts: number;
};

type CacheRecord = {
  id: string;
  org_id: string;
  patient_id: string | null;
  case_id: string | null;
  resource_type: ClinicalFhirResourceType;
  resource_id: string;
  version_id: string | null;
  external_reference_id: string | null;
  normalized_summary: Prisma.JsonValue;
  content_hash: string;
  validation_status: ClinicalFhirValidationStatus;
};

export interface DrainYreseClinicalSyncQueueOptions {
  readonly orgId: string;
  readonly limit?: number;
  readonly now?: Date;
  readonly lockedBy?: string;
}

export interface DrainYreseClinicalSyncQueueResult {
  readonly processedCount: number;
  readonly scannedCount: number;
  readonly succeededCount: number;
  readonly conflictCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly errors?: string[];
}

export interface DrainYreseClinicalSyncQueueTestOptions {
  readonly runInOrgContext?: RunInOrgContext;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DRAIN_LIMIT;
  const normalized = Math.trunc(value);
  if (normalized <= 0) return DEFAULT_DRAIN_LIMIT;
  return Math.min(normalized, MAX_DRAIN_LIMIT);
}

function readDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readMedicationCoding(summary: Record<string, unknown>) {
  const medication = readJsonObject(summary.medication);
  const coding = medication && Array.isArray(medication.coding) ? medication.coding : [];
  return coding.length > 0 ? coding : undefined;
}

function sourceKindForResource(
  resourceType: ClinicalFhirResourceType,
): MedicationTimelineSourceKind | null {
  switch (resourceType) {
    case ClinicalFhirResourceType.medication_request:
      return MedicationTimelineSourceKind.medication_request;
    case ClinicalFhirResourceType.medication_dispense:
      return MedicationTimelineSourceKind.medication_dispense;
    case ClinicalFhirResourceType.medication_statement:
      return MedicationTimelineSourceKind.medication_statement;
    default:
      return null;
  }
}

async function recordQueueProvenance(args: {
  readonly tx: ClinicalSyncQueueTx;
  readonly orgId: string;
  readonly queue: QueueRecord;
  readonly cache: CacheRecord;
  readonly subjectType: ClinicalLocalResourceType;
  readonly subjectId: string;
}) {
  // Provenance is append-only; conflict skipping is safe for idempotent queue replay.
  return args.tx.clinicalProvenanceRecord.createMany({
    data: {
      org_id: args.orgId,
      subject_type: args.subjectType,
      subject_id: args.subjectId,
      activity: 'clinical_sync_queue.medication_timeline_projection',
      direction: ClinicalIntegrationDirection.inbound,
      external_reference_id: args.cache.external_reference_id ?? args.queue.external_reference_id,
      fhir_resource_cache_id: args.cache.id,
      yrese_event_id: args.queue.yrese_event_id,
      input_hash: args.cache.content_hash,
      adapter_version: 'standard-clinical-sync-queue.v1',
      jp_core_version: JP_CORE_VERSION,
      fhir_version: FHIR_R4_VERSION,
      transformation_summary: toPrismaJsonInput({
        projector: 'medication_timeline',
        raw_storage: 'not_persisted',
      }),
    },
    skipDuplicates: true,
  });
}

async function assertClaimedTransition(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  lockedBy: string,
  data: Prisma.ClinicalSyncQueueItemUpdateManyMutationInput,
) {
  const updated = await tx.clinicalSyncQueueItem.updateMany({
    where: {
      id: queue.id,
      org_id: queue.org_id,
      status: ClinicalQueueStatus.running,
      locked_by: lockedBy,
      attempt_count: queue.attempt_count,
    },
    data: {
      ...data,
      locked_at: null,
      locked_by: null,
    },
  });
  if (updated.count !== 1) {
    throw new Error('Clinical sync queue claim was lost');
  }
}

async function markQueueSucceeded(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  now: Date,
  lockedBy: string,
) {
  await assertClaimedTransition(tx, queue, lockedBy, {
    status: ClinicalQueueStatus.succeeded,
    completed_at: now,
    last_error_code: null,
    last_error_metadata: PrismaNamespace.JsonNull,
  });
}

function failedTransitionData(queue: QueueRecord, now: Date, code: string) {
  const nextAttemptCount = Math.min(queue.attempt_count + 1, queue.max_attempts);
  const deadLetter = nextAttemptCount >= queue.max_attempts;
  return {
    status: deadLetter ? ClinicalQueueStatus.dead_letter : ClinicalQueueStatus.failed,
    locked_at: null,
    locked_by: null,
    attempt_count: nextAttemptCount,
    next_attempt_at: deadLetter ? now : new Date(now.getTime() + RETRY_DELAY_MS),
    completed_at: deadLetter ? now : null,
    last_error_code: code,
    last_error_metadata: toPrismaJsonInput({
      code,
      retryable: !deadLetter,
      raw_storage: 'not_persisted',
    }),
  } satisfies Prisma.ClinicalSyncQueueItemUpdateManyMutationInput;
}

async function markUnclaimedQueueFailed(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  now: Date,
  code: string,
) {
  const updated = await tx.clinicalSyncQueueItem.updateMany({
    where: {
      id: queue.id,
      org_id: queue.org_id,
      status: queue.status,
      attempt_count: queue.attempt_count,
      next_attempt_at: { lte: now },
    },
    data: failedTransitionData(queue, now, code),
  });
  return updated.count === 1;
}

async function markQueueConflict(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  now: Date,
  code: string,
  lockedBy: string,
) {
  await assertClaimedTransition(tx, queue, lockedBy, {
    status: ClinicalQueueStatus.conflict_requires_review,
    completed_at: now,
    last_error_code: code,
    last_error_metadata: toPrismaJsonInput({
      code,
      retryable: false,
      raw_storage: 'not_persisted',
    }),
  });
}

async function markClaimedQueueFailed(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  now: Date,
  code: string,
  lockedBy: string,
) {
  await assertClaimedTransition(tx, queue, lockedBy, failedTransitionData(queue, now, code));
}

async function markQueueExhausted(tx: ClinicalSyncQueueTx, queue: QueueRecord, now: Date) {
  const updated = await tx.clinicalSyncQueueItem.updateMany({
    where: {
      id: queue.id,
      org_id: queue.org_id,
      status: queue.status,
      attempt_count: queue.attempt_count,
      next_attempt_at: { lte: now },
    },
    data: {
      status: ClinicalQueueStatus.dead_letter,
      locked_at: null,
      locked_by: null,
      completed_at: now,
      next_attempt_at: now,
      last_error_code: 'MAX_ATTEMPTS_EXHAUSTED',
      last_error_metadata: toPrismaJsonInput({
        code: 'MAX_ATTEMPTS_EXHAUSTED',
        retryable: false,
        raw_storage: 'not_persisted',
      }),
    },
  });
  return updated.count === 1;
}

async function claimQueueItem(
  tx: ClinicalSyncQueueTx,
  queue: QueueRecord,
  now: Date,
  lockedBy: string,
) {
  const claim = await tx.clinicalSyncQueueItem.updateMany({
    where: {
      id: queue.id,
      org_id: queue.org_id,
      status: queue.status,
      attempt_count: queue.attempt_count,
      next_attempt_at: { lte: now },
    },
    data: {
      status: ClinicalQueueStatus.running,
      locked_at: now,
      locked_by: lockedBy,
    },
  });
  return claim.count === 1;
}

async function projectMedicationTimeline(args: {
  readonly tx: ClinicalSyncQueueTx;
  readonly queue: QueueRecord;
  readonly cache: CacheRecord;
  readonly now: Date;
  readonly lockedBy: string;
}) {
  const { tx, queue, cache, now, lockedBy } = args;
  const sourceKind = sourceKindForResource(cache.resource_type);
  if (!sourceKind) {
    await markQueueSucceeded(tx, queue, now, lockedBy);
    return 'succeeded' as const;
  }

  if (!cache.patient_id) {
    await markQueueConflict(
      tx,
      queue,
      now,
      'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
      lockedBy,
    );
    return 'conflict' as const;
  }

  if (cache.validation_status !== ClinicalFhirValidationStatus.valid) {
    await markQueueConflict(tx, queue, now, 'FHIR_PROFILE_VALIDATION_REQUIRED', lockedBy);
    return 'conflict' as const;
  }

  const summary = readJsonObject(cache.normalized_summary) ?? {};
  const authoredAt = readDate(summary.authored_at);
  const effectiveAt = readDate(summary.effective_at);
  const assertedAt = readDate(summary.asserted_at);
  const medicationCoding = readMedicationCoding(summary);

  const timelineItem = await tx.medicationTimelineItem.upsert({
    where: {
      org_id_source_kind_source_reference_id: {
        org_id: queue.org_id,
        source_kind: sourceKind,
        source_reference_id: cache.id,
      },
    },
    create: {
      org_id: queue.org_id,
      patient_id: cache.patient_id,
      case_id: cache.case_id,
      source_kind: sourceKind,
      source_reference_id: cache.id,
      external_reference_id: cache.external_reference_id,
      fhir_resource_cache_id: cache.id,
      medication_coding: medicationCoding ? toPrismaJsonInput(medicationCoding) : undefined,
      status: typeof summary.status === 'string' ? summary.status : undefined,
      authored_at: authoredAt,
      effective_at: effectiveAt,
      asserted_at: assertedAt,
      derived_from_item_ids: [],
      sync_status: ClinicalSyncStatus.synced,
    },
    update: {
      patient_id: cache.patient_id,
      case_id: cache.case_id,
      external_reference_id: cache.external_reference_id,
      fhir_resource_cache_id: cache.id,
      medication_coding: medicationCoding ? toPrismaJsonInput(medicationCoding) : undefined,
      status: typeof summary.status === 'string' ? summary.status : undefined,
      authored_at: authoredAt,
      effective_at: effectiveAt,
      asserted_at: assertedAt,
      sync_status: ClinicalSyncStatus.synced,
    },
    select: { id: true },
  });

  await recordQueueProvenance({
    tx,
    orgId: queue.org_id,
    queue,
    cache,
    subjectType: ClinicalLocalResourceType.other,
    subjectId: timelineItem.id,
  });
  await markQueueSucceeded(tx, queue, now, lockedBy);
  return 'succeeded' as const;
}

async function processQueueItem(args: {
  readonly tx: ClinicalSyncQueueTx;
  readonly queue: QueueRecord;
  readonly now: Date;
  readonly lockedBy: string;
}) {
  const { tx, queue, now, lockedBy } = args;
  if (queue.attempt_count >= queue.max_attempts) {
    return (await markQueueExhausted(tx, queue, now)) ? ('failed' as const) : ('skipped' as const);
  }

  if (!(await claimQueueItem(tx, queue, now, lockedBy))) {
    return 'skipped' as const;
  }

  if (!queue.fhir_resource_cache_id) {
    await markQueueConflict(tx, queue, now, 'FHIR_RESOURCE_CACHE_REQUIRED', lockedBy);
    return 'conflict' as const;
  }

  const cache = await tx.clinicalFhirResourceCache.findFirst({
    where: { id: queue.fhir_resource_cache_id, org_id: queue.org_id },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      resource_type: true,
      resource_id: true,
      version_id: true,
      external_reference_id: true,
      normalized_summary: true,
      content_hash: true,
      validation_status: true,
    },
  });
  if (!cache) {
    await markClaimedQueueFailed(tx, queue, now, 'FHIR_RESOURCE_CACHE_NOT_FOUND', lockedBy);
    return 'failed' as const;
  }

  return projectMedicationTimeline({ tx, queue, cache, now, lockedBy });
}

async function listDueQueueItems(
  tx: ClinicalSyncQueueTx,
  options: Required<Pick<DrainYreseClinicalSyncQueueOptions, 'orgId' | 'now' | 'lockedBy'>> & {
    limit: number;
  },
): Promise<QueueRecord[]> {
  return tx.clinicalSyncQueueItem.findMany({
    where: {
      org_id: options.orgId,
      direction: ClinicalIntegrationDirection.inbound,
      status: { in: [ClinicalQueueStatus.pending, ClinicalQueueStatus.failed] },
      next_attempt_at: { lte: options.now },
      operation: { startsWith: 'yrese.' },
    },
    orderBy: [{ priority: 'asc' }, { created_at: 'asc' }],
    take: options.limit,
    select: {
      id: true,
      org_id: true,
      status: true,
      operation: true,
      aggregate_type: true,
      aggregate_id: true,
      fhir_resource_cache_id: true,
      external_reference_id: true,
      yrese_event_id: true,
      attempt_count: true,
      max_attempts: true,
    },
  });
}

export async function drainYreseClinicalSyncQueue(
  options: DrainYreseClinicalSyncQueueOptions,
  testOptions: DrainYreseClinicalSyncQueueTestOptions = {},
): Promise<DrainYreseClinicalSyncQueueResult> {
  const normalized = {
    orgId: options.orgId,
    limit: normalizeLimit(options.limit),
    now: options.now ?? new Date(),
    lockedBy: options.lockedBy ?? DEFAULT_LOCKED_BY,
  };
  const runInOrgContext =
    testOptions.runInOrgContext ??
    (<T>(orgId: string, work: (tx: ClinicalSyncQueueTx) => Promise<T>) =>
      withOrgContext(orgId, (tx) => work(tx), { timeoutMs: 10_000 }));

  const dueItems = await runInOrgContext(normalized.orgId, (tx) =>
    listDueQueueItems(tx, normalized),
  );
  const result = {
    succeededCount: 0,
    conflictCount: 0,
    failedCount: 0,
    skippedCount: 0,
    errors: [] as string[],
  };

  for (const queue of dueItems) {
    try {
      const itemResult = await runInOrgContext(normalized.orgId, (tx) =>
        processQueueItem({
          tx,
          queue,
          now: normalized.now,
          lockedBy: normalized.lockedBy,
        }),
      );
      if (itemResult === 'succeeded') result.succeededCount += 1;
      if (itemResult === 'conflict') result.conflictCount += 1;
      if (itemResult === 'failed') result.failedCount += 1;
      if (itemResult === 'skipped') result.skippedCount += 1;
    } catch {
      try {
        const failed = await runInOrgContext(normalized.orgId, (tx) =>
          markUnclaimedQueueFailed(tx, queue, normalized.now, 'CLINICAL_SYNC_QUEUE_ITEM_FAILED'),
        );
        if (failed) {
          result.failedCount += 1;
          result.errors.push('Clinical sync queue item failed');
        } else {
          result.skippedCount += 1;
        }
      } catch {
        result.failedCount += 1;
        result.errors.push('Clinical sync queue failure transition failed');
      }
    }
  }

  return {
    processedCount: result.succeededCount + result.conflictCount + result.failedCount,
    scannedCount: dueItems.length,
    succeededCount: result.succeededCount,
    conflictCount: result.conflictCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    ...(result.errors.length > 0 ? { errors: result.errors } : {}),
  };
}
