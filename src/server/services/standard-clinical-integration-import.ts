import { createHash } from 'node:crypto';
import {
  ClinicalEventReceiptStatus,
  ClinicalExternalReferenceStatus,
  ClinicalExternalSystemType,
  ClinicalFhirResourceType,
  ClinicalFhirValidationStatus,
  ClinicalIntegrationDirection,
  ClinicalLocalResourceType,
  ClinicalMatchConfidence,
  ClinicalPayloadSensitivity,
  ClinicalQueueStatus,
  type Prisma,
  Prisma as PrismaNamespace,
} from '@prisma/client';
import { type RequestAuthContext } from '@/lib/auth/request-context';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { FHIR_R4_VERSION, JP_CORE_VERSION } from '@/server/adapters/fhir';
import {
  assessClinicalFhirValidation,
  toValidationErrorsJson,
} from '@/server/services/standard-clinical-fhir-validation';

const DEFAULT_YRESE_SYSTEM_KEY = 'yrese';
const DEFAULT_SCHEMA_VERSION = '1.0.0';
const DEFAULT_QUEUE_PRIORITY = 100;
const HASH_PREFIX = 'sha256:';

const FHIR_RESOURCE_TYPE_MAP: Readonly<Record<string, ClinicalFhirResourceType>> = {
  Patient: ClinicalFhirResourceType.patient,
  Coverage: ClinicalFhirResourceType.coverage,
  Medication: ClinicalFhirResourceType.medication,
  MedicationRequest: ClinicalFhirResourceType.medication_request,
  MedicationDispense: ClinicalFhirResourceType.medication_dispense,
  MedicationStatement: ClinicalFhirResourceType.medication_statement,
  Practitioner: ClinicalFhirResourceType.practitioner,
  PractitionerRole: ClinicalFhirResourceType.practitioner_role,
  Organization: ClinicalFhirResourceType.organization,
  AllergyIntolerance: ClinicalFhirResourceType.allergy_intolerance,
  Condition: ClinicalFhirResourceType.condition,
  Observation: ClinicalFhirResourceType.observation,
  CarePlan: ClinicalFhirResourceType.care_plan,
  Task: ClinicalFhirResourceType.task,
  Appointment: ClinicalFhirResourceType.appointment,
  Communication: ClinicalFhirResourceType.communication,
  DocumentReference: ClinicalFhirResourceType.document_reference,
  AuditEvent: ClinicalFhirResourceType.audit_event,
  Provenance: ClinicalFhirResourceType.provenance,
  Consent: ClinicalFhirResourceType.consent,
  Encounter: ClinicalFhirResourceType.encounter,
  CareTeam: ClinicalFhirResourceType.care_team,
  Bundle: ClinicalFhirResourceType.bundle,
};

type ClinicalImportTx = Pick<
  Prisma.TransactionClient,
  | 'clinicalExternalSystem'
  | 'clinicalExternalReference'
  | 'clinicalFhirResourceCache'
  | 'yreseClinicalEvent'
  | 'clinicalSyncQueueItem'
  | 'clinicalProvenanceRecord'
>;

type RunInOrgContext = <T>(
  orgId: string,
  work: (tx: ClinicalImportTx) => Promise<T>,
  options?: { requestContext?: RequestAuthContext },
) => Promise<T>;

export interface YreseWebhookEventInput {
  readonly eventId?: string;
  readonly eventType: string;
  readonly occurredAt?: Date;
  readonly receivedAt?: Date;
  readonly schemaVersion?: string;
  readonly resourceRefs?: readonly string[];
  readonly payload: unknown;
  readonly payloadProfile?: string;
  readonly sensitivity?: ClinicalPayloadSensitivity;
  readonly receiptStatus?: ClinicalEventReceiptStatus;
  readonly metadata?: Record<string, unknown>;
  readonly aggregate?: {
    readonly type: ClinicalLocalResourceType;
    readonly id: string;
  };
}

export interface FhirCacheImportResourceInput {
  readonly resource: unknown;
  readonly patientId?: string;
  readonly caseId?: string;
  readonly localResource?: {
    readonly type: ClinicalLocalResourceType;
    readonly id: string;
  };
  readonly status?: ClinicalExternalReferenceStatus;
  readonly confidence?: ClinicalMatchConfidence;
  readonly validationStatus?: ClinicalFhirValidationStatus;
  readonly validationErrors?: readonly unknown[];
}

export interface ImportYreseClinicalWebhookInput {
  readonly orgId: string;
  readonly externalSystem?: {
    readonly systemKey?: string;
    readonly systemType?: ClinicalExternalSystemType;
    readonly jpCoreVersion?: string;
    readonly fhirVersion?: string;
    readonly baseUrl?: string;
  };
  readonly webhook: YreseWebhookEventInput;
  readonly fhirResources?: readonly FhirCacheImportResourceInput[];
  readonly queue?: {
    readonly operation?: string;
    readonly priority?: number;
    readonly nextAttemptAt?: Date;
  };
  readonly requestContext?: RequestAuthContext;
}

export interface ImportedFhirResourceResult {
  readonly resourceType: ClinicalFhirResourceType;
  readonly resourceId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly externalReferenceId: string;
  readonly fhirResourceCacheId: string;
  readonly provenanceRecordId: string;
}

export interface ImportYreseClinicalWebhookResult {
  readonly externalSystemId: string;
  readonly yreseClinicalEventId: string;
  readonly queueItemId: string;
  readonly importedResources: readonly ImportedFhirResourceResult[];
}

export interface ImportYreseClinicalWebhookOptions {
  readonly runInOrgContext?: RunInOrgContext;
}

interface ParsedFhirResource {
  readonly resourceType: ClinicalFhirResourceType;
  readonly resourceTypeText: string;
  readonly resourceId: string;
  readonly versionId: string;
  readonly profileUrls: readonly string[];
  readonly lastModifiedAt?: Date;
  readonly identifierSummary: Record<string, unknown>;
  readonly normalizedSummary: Record<string, unknown>;
  readonly contentHash: string;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJsonValue(item)]),
    );
  }
  return String(value);
}

function sha256Hex(value: string): string {
  return `${HASH_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
}

function hashJson(scope: string, value: unknown): string {
  return sha256Hex(`${scope}\0${stableJson(value)}`);
}

function hashString(scope: string, value: string): string {
  return sha256Hex(`${scope}\0${value}`);
}

function hashOptionalJson(scope: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return hashJson(scope, value);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readFhirDateTime(value: unknown): Date | undefined {
  const text = readNonEmptyString(value);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function readFhirResourceType(resource: Record<string, unknown>): {
  resourceType: ClinicalFhirResourceType;
  resourceTypeText: string;
} {
  const resourceTypeText = readNonEmptyString(resource.resourceType);
  if (!resourceTypeText) {
    throw new Error('FHIR resourceType is required');
  }
  return {
    resourceType: FHIR_RESOURCE_TYPE_MAP[resourceTypeText] ?? ClinicalFhirResourceType.other,
    resourceTypeText,
  };
}

function readFhirResourceId(resource: Record<string, unknown>): string {
  const id = readNonEmptyString(resource.id);
  if (!id) {
    throw new Error('FHIR resource id is required');
  }
  return id;
}

function readMeta(resource: Record<string, unknown>) {
  const meta = readJsonObject(resource.meta);
  const profileUrls = Array.isArray(meta?.profile)
    ? meta.profile.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
  const versionId = readNonEmptyString(meta?.versionId) ?? undefined;
  const lastModifiedAt = readFhirDateTime(meta?.lastUpdated);
  return { profileUrls, versionId, lastModifiedAt };
}

function summarizeIdentifier(identifier: unknown): Record<string, unknown> | null {
  const object = readJsonObject(identifier);
  if (!object) return null;

  const value = readNonEmptyString(object.value);
  if (!value) return null;

  const system = readNonEmptyString(object.system);
  const type = readJsonObject(object.type);
  return {
    ...(system ? { system } : {}),
    value_hash: hashString('fhir-identifier-value', `${system ?? ''}\0${value}`),
    ...(readNonEmptyString(object.use) ? { use: readNonEmptyString(object.use) } : {}),
    ...(readNonEmptyString(type?.text) ? { type_text: readNonEmptyString(type?.text) } : {}),
  };
}

function summarizeIdentifiers(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => summarizeIdentifier(item))
    .filter((item): item is Record<string, unknown> => item !== null);
}

function summarizeReference(value: unknown): Record<string, unknown> | undefined {
  const object = readJsonObject(value);
  if (!object) return undefined;

  const reference = readNonEmptyString(object.reference);
  const identifier = summarizeIdentifier(object.identifier);
  if (!reference && !identifier) return undefined;

  return {
    ...(reference ? { reference } : {}),
    ...(identifier ? { identifier } : {}),
  };
}

function summarizeCoding(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = readJsonObject(item);
    if (!object) return [];
    const system = readNonEmptyString(object.system);
    const code = readNonEmptyString(object.code);
    if (!system || !code) return [];
    return [{ system, code }];
  });
}

function summarizeMedication(
  resource: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const medication = readJsonObject(resource.medicationCodeableConcept);
  if (!medication) return undefined;

  const coding = summarizeCoding(medication.coding);
  return coding.length > 0 ? { coding } : undefined;
}

function summarizeDosageCount(resource: Record<string, unknown>): number {
  return Array.isArray(resource.dosageInstruction)
    ? resource.dosageInstruction.length
    : Array.isArray(resource.dosage)
      ? resource.dosage.length
      : 0;
}

function summarizeReferenceArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => summarizeReference(item))
    .filter((item): item is Record<string, unknown> => item !== undefined);
}

function parseFhirResource(resourceValue: unknown): ParsedFhirResource {
  const resource = readJsonObject(resourceValue);
  if (!resource) {
    throw new Error('FHIR resource must be a JSON object');
  }

  const { resourceType, resourceTypeText } = readFhirResourceType(resource);
  const resourceId = readFhirResourceId(resource);
  const { profileUrls, versionId, lastModifiedAt } = readMeta(resource);
  const contentHash = hashJson('fhir-resource', resourceValue);
  const effectiveVersionId = versionId ?? contentHash;
  const identifiers = summarizeIdentifiers(resource.identifier);
  const subject = summarizeReference(resource.subject);
  const medication = summarizeMedication(resource);

  return {
    resourceType,
    resourceTypeText,
    resourceId,
    versionId: effectiveVersionId,
    profileUrls,
    ...(lastModifiedAt ? { lastModifiedAt } : {}),
    identifierSummary: {
      resource_type: resourceTypeText,
      resource_id: resourceId,
      profile_urls: profileUrls,
      identifier_count: identifiers.length,
      identifiers,
      ...(subject ? { subject } : {}),
    },
    normalizedSummary: {
      resource_type: resourceTypeText,
      resource_id: resourceId,
      status: readNonEmptyString(resource.status),
      intent: readNonEmptyString(resource.intent),
      authored_at: readNonEmptyString(resource.authoredOn),
      effective_at: readNonEmptyString(resource.effectiveDateTime),
      asserted_at: readNonEmptyString(resource.dateAsserted),
      dosage_count: summarizeDosageCount(resource),
      ...(subject ? { subject } : {}),
      ...(medication ? { medication } : {}),
      based_on: summarizeReferenceArray(resource.basedOn),
      part_of: summarizeReferenceArray(resource.partOf),
      derived_from: summarizeReferenceArray(resource.derivedFrom),
      authorizing_prescription: summarizeReferenceArray(resource.authorizingPrescription),
    },
    contentHash,
  };
}

function normalizeResourceRefs(refs: readonly string[] | undefined): string[] {
  if (!refs) return [];
  return refs.filter((ref) => ref.trim() !== '');
}

function normalizeQueuePriority(value: number | undefined): number {
  if (value === undefined) return DEFAULT_QUEUE_PRIORITY;
  if (!Number.isFinite(value)) return DEFAULT_QUEUE_PRIORITY;
  return Math.max(0, Math.trunc(value));
}

function isUniqueConstraintError(error: unknown): boolean {
  if (error instanceof PrismaNamespace.PrismaClientKnownRequestError) {
    return error.code === 'P2002';
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function resolveSystemInput(input: ImportYreseClinicalWebhookInput) {
  return {
    systemKey: input.externalSystem?.systemKey ?? DEFAULT_YRESE_SYSTEM_KEY,
    systemType: input.externalSystem?.systemType ?? ClinicalExternalSystemType.yrese_fhir,
    jpCoreVersion: input.externalSystem?.jpCoreVersion ?? JP_CORE_VERSION,
    fhirVersion: input.externalSystem?.fhirVersion ?? FHIR_R4_VERSION,
    baseUrlHash: input.externalSystem?.baseUrl
      ? hashString('clinical-external-system-base-url', input.externalSystem.baseUrl)
      : undefined,
  };
}

async function ensureExternalSystem(
  tx: ClinicalImportTx,
  orgId: string,
  system: ReturnType<typeof resolveSystemInput>,
) {
  return tx.clinicalExternalSystem.upsert({
    where: {
      org_id_system_key: {
        org_id: orgId,
        system_key: system.systemKey,
      },
    },
    create: {
      org_id: orgId,
      system_key: system.systemKey,
      system_type: system.systemType,
      status: 'active',
      jp_core_version: system.jpCoreVersion,
      fhir_version: system.fhirVersion,
      base_url_hash: system.baseUrlHash,
      last_verified_at: new Date(),
    },
    update: {
      system_type: system.systemType,
      status: 'active',
      jp_core_version: system.jpCoreVersion,
      fhir_version: system.fhirVersion,
      ...(system.baseUrlHash ? { base_url_hash: system.baseUrlHash } : {}),
      last_verified_at: new Date(),
    },
    select: { id: true },
  });
}

async function createOrFindYreseEvent(args: {
  readonly tx: ClinicalImportTx;
  readonly orgId: string;
  readonly externalSystemId: string;
  readonly webhook: YreseWebhookEventInput;
  readonly payloadHash: string;
  readonly idempotencyKeyHash: string;
}) {
  const { tx, orgId, externalSystemId, webhook, payloadHash, idempotencyKeyHash } = args;
  const resourceRefs = normalizeResourceRefs(webhook.resourceRefs);
  try {
    return await tx.yreseClinicalEvent.create({
      data: {
        org_id: orgId,
        external_system_id: externalSystemId,
        direction: ClinicalIntegrationDirection.inbound,
        event_type: webhook.eventType,
        external_event_id: webhook.eventId,
        schema_version: webhook.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
        resource_refs: resourceRefs,
        payload_hash: payloadHash,
        payload_profile: webhook.payloadProfile,
        sensitivity: webhook.sensitivity ?? ClinicalPayloadSensitivity.phi,
        metadata: toPrismaJsonInput({
          resource_ref_count: resourceRefs.length,
          payload_storage: 'hash_only',
          metadata_storage: webhook.metadata ? 'hash_only' : 'none',
          ...(webhook.metadata
            ? { metadata_hash: hashOptionalJson('yrese-webhook-metadata', webhook.metadata) }
            : {}),
        }),
        receipt_status: webhook.receiptStatus ?? ClinicalEventReceiptStatus.accepted,
        occurred_at: webhook.occurredAt,
        received_at: webhook.receivedAt ?? new Date(),
        aggregate_type: webhook.aggregate?.type,
        aggregate_id: webhook.aggregate?.id,
        idempotency_key_hash: idempotencyKeyHash,
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await tx.yreseClinicalEvent.findFirst({
      where: { org_id: orgId, idempotency_key_hash: idempotencyKeyHash },
      select: { id: true },
    });
    if (!existing) throw error;
    return existing;
  }
}

async function upsertExternalReference(args: {
  readonly tx: ClinicalImportTx;
  readonly orgId: string;
  readonly externalSystemId: string;
  readonly resource: ParsedFhirResource;
  readonly input: FhirCacheImportResourceInput;
}) {
  const { tx, orgId, externalSystemId, resource, input } = args;
  const primaryIdentifier = Array.isArray(resource.identifierSummary.identifiers)
    ? (resource.identifierSummary.identifiers[0] as Record<string, unknown> | undefined)
    : undefined;
  const localResourceType = input.localResource?.type ?? ClinicalLocalResourceType.none;
  const localResourceId = input.localResource?.id;

  return tx.clinicalExternalReference.upsert({
    where: {
      org_id_external_system_id_resource_type_external_resource_id: {
        org_id: orgId,
        external_system_id: externalSystemId,
        resource_type: resource.resourceType,
        external_resource_id: resource.resourceId,
      },
    },
    create: {
      org_id: orgId,
      external_system_id: externalSystemId,
      resource_type: resource.resourceType,
      external_resource_id: resource.resourceId,
      external_version_id: resource.versionId,
      identifier_system: readNonEmptyString(primaryIdentifier?.system),
      identifier_value_hash: readNonEmptyString(primaryIdentifier?.value_hash),
      local_resource_type: localResourceType,
      local_resource_id: localResourceId,
      patient_id: input.patientId,
      case_id: input.caseId,
      status: input.status ?? ClinicalExternalReferenceStatus.candidate,
      confidence: input.confidence ?? ClinicalMatchConfidence.none,
      first_seen_at: new Date(),
      last_seen_at: new Date(),
    },
    update: {
      external_version_id: resource.versionId,
      identifier_system: readNonEmptyString(primaryIdentifier?.system),
      identifier_value_hash: readNonEmptyString(primaryIdentifier?.value_hash),
      local_resource_type: localResourceType,
      local_resource_id: localResourceId,
      patient_id: input.patientId,
      case_id: input.caseId,
      status: input.status ?? ClinicalExternalReferenceStatus.candidate,
      confidence: input.confidence ?? ClinicalMatchConfidence.none,
      last_seen_at: new Date(),
    },
    select: { id: true },
  });
}

async function writeFhirResourceCache(args: {
  readonly tx: ClinicalImportTx;
  readonly orgId: string;
  readonly externalSystemId: string;
  readonly externalReferenceId: string;
  readonly resource: ParsedFhirResource;
  readonly input: FhirCacheImportResourceInput;
}) {
  const { tx, orgId, externalSystemId, externalReferenceId, resource, input } = args;
  const validationAssessment = assessClinicalFhirValidation({
    resource: input.resource,
    resourceType: resource.resourceType,
    profileUrls: resource.profileUrls,
    requestedStatus: input.validationStatus,
    requestedErrors: input.validationErrors,
  });
  const validationErrors = toValidationErrorsJson(validationAssessment);

  await tx.clinicalFhirResourceCache.updateMany({
    where: {
      org_id: orgId,
      external_system_id: externalSystemId,
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      is_current: true,
    },
    data: { is_current: false },
  });

  return tx.clinicalFhirResourceCache.upsert({
    where: {
      org_id_external_system_id_resource_type_resource_id_version_id: {
        org_id: orgId,
        external_system_id: externalSystemId,
        resource_type: resource.resourceType,
        resource_id: resource.resourceId,
        version_id: resource.versionId,
      },
    },
    create: {
      org_id: orgId,
      external_system_id: externalSystemId,
      external_reference_id: externalReferenceId,
      patient_id: input.patientId,
      case_id: input.caseId,
      resource_type: resource.resourceType,
      resource_id: resource.resourceId,
      version_id: resource.versionId,
      profile_urls: [...resource.profileUrls],
      identifier_summary: toPrismaJsonInput(resource.identifierSummary),
      normalized_summary: toPrismaJsonInput(resource.normalizedSummary),
      content_hash: resource.contentHash,
      last_modified_at: resource.lastModifiedAt,
      fetched_at: new Date(),
      is_current: true,
      validation_status: validationAssessment.status,
      validation_errors: validationErrors ? toPrismaJsonInput(validationErrors) : undefined,
    },
    update: {
      external_reference_id: externalReferenceId,
      patient_id: input.patientId,
      case_id: input.caseId,
      profile_urls: [...resource.profileUrls],
      identifier_summary: toPrismaJsonInput(resource.identifierSummary),
      normalized_summary: toPrismaJsonInput(resource.normalizedSummary),
      content_hash: resource.contentHash,
      last_modified_at: resource.lastModifiedAt,
      fetched_at: new Date(),
      is_current: true,
      validation_status: validationAssessment.status,
      validation_errors: validationErrors ? toPrismaJsonInput(validationErrors) : undefined,
    },
    select: { id: true },
  });
}

async function createOrFindProvenance(args: {
  readonly tx: ClinicalImportTx;
  readonly orgId: string;
  readonly subjectType: ClinicalLocalResourceType;
  readonly subjectId: string;
  readonly activity: string;
  readonly externalReferenceId?: string;
  readonly fhirResourceCacheId?: string;
  readonly yreseClinicalEventId?: string;
  readonly inputHash: string;
  readonly outputHash?: string;
}) {
  const { tx, orgId, subjectType, subjectId, activity, inputHash } = args;
  try {
    return await tx.clinicalProvenanceRecord.create({
      data: {
        org_id: orgId,
        subject_type: subjectType,
        subject_id: subjectId,
        activity,
        direction: ClinicalIntegrationDirection.inbound,
        external_reference_id: args.externalReferenceId,
        fhir_resource_cache_id: args.fhirResourceCacheId,
        yrese_event_id: args.yreseClinicalEventId,
        input_hash: inputHash,
        output_hash: args.outputHash,
        adapter_version: 'standard-clinical-integration-import.v1',
        jp_core_version: JP_CORE_VERSION,
        fhir_version: FHIR_R4_VERSION,
        transformation_summary: toPrismaJsonInput({
          raw_storage: 'not_persisted',
          raw_payload: 'hash_only',
        }),
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await tx.clinicalProvenanceRecord.findFirst({
      where: {
        org_id: orgId,
        subject_type: subjectType,
        subject_id: subjectId,
        activity,
        input_hash: inputHash,
      },
      select: { id: true },
    });
    if (!existing) throw error;
    return existing;
  }
}

async function upsertQueueItem(args: {
  readonly tx: ClinicalImportTx;
  readonly orgId: string;
  readonly externalSystemId: string;
  readonly input: ImportYreseClinicalWebhookInput;
  readonly yreseClinicalEventId: string;
  readonly idempotencyKeyHash: string;
  readonly firstResource?: ImportedFhirResourceResult;
}) {
  const operation = args.input.queue?.operation ?? `yrese.${args.input.webhook.eventType}.process`;
  return args.tx.clinicalSyncQueueItem.upsert({
    where: {
      org_id_external_system_id_operation_idempotency_key_hash: {
        org_id: args.orgId,
        external_system_id: args.externalSystemId,
        operation,
        idempotency_key_hash: args.idempotencyKeyHash,
      },
    },
    create: {
      org_id: args.orgId,
      external_system_id: args.externalSystemId,
      direction: ClinicalIntegrationDirection.inbound,
      operation,
      aggregate_type: args.input.webhook.aggregate?.type ?? ClinicalLocalResourceType.none,
      aggregate_id: args.input.webhook.aggregate?.id,
      yrese_event_id: args.yreseClinicalEventId,
      fhir_resource_cache_id: args.firstResource?.fhirResourceCacheId,
      external_reference_id: args.firstResource?.externalReferenceId,
      status: ClinicalQueueStatus.pending,
      priority: normalizeQueuePriority(args.input.queue?.priority),
      next_attempt_at: args.input.queue?.nextAttemptAt ?? new Date(),
      idempotency_key_hash: args.idempotencyKeyHash,
      request_fingerprint_hash: hashJson('clinical-sync-request', {
        event_type: args.input.webhook.eventType,
        event_id: args.input.webhook.eventId,
        resource_count: args.input.fhirResources?.length ?? 0,
      }),
      metadata: toPrismaJsonInput({
        event_type: args.input.webhook.eventType,
        resource_count: args.input.fhirResources?.length ?? 0,
        payload_storage: 'hash_only',
      }),
    },
    update: {
      yrese_event_id: args.yreseClinicalEventId,
      fhir_resource_cache_id: args.firstResource?.fhirResourceCacheId,
      external_reference_id: args.firstResource?.externalReferenceId,
      status: ClinicalQueueStatus.pending,
      priority: normalizeQueuePriority(args.input.queue?.priority),
      next_attempt_at: args.input.queue?.nextAttemptAt ?? new Date(),
      metadata: toPrismaJsonInput({
        event_type: args.input.webhook.eventType,
        resource_count: args.input.fhirResources?.length ?? 0,
        payload_storage: 'hash_only',
      }),
    },
    select: { id: true },
  });
}

async function importWithinTransaction(
  tx: ClinicalImportTx,
  input: ImportYreseClinicalWebhookInput,
): Promise<ImportYreseClinicalWebhookResult> {
  const system = await ensureExternalSystem(tx, input.orgId, resolveSystemInput(input));
  const payloadHash = hashJson('yrese-webhook-payload', input.webhook.payload);
  const idempotencyKeyHash = hashJson('yrese-webhook-idempotency', {
    org_id: input.orgId,
    system_key: input.externalSystem?.systemKey ?? DEFAULT_YRESE_SYSTEM_KEY,
    event_type: input.webhook.eventType,
    event_id: input.webhook.eventId,
    payload_hash: payloadHash,
  });
  const event = await createOrFindYreseEvent({
    tx,
    orgId: input.orgId,
    externalSystemId: system.id,
    webhook: input.webhook,
    payloadHash,
    idempotencyKeyHash,
  });

  const importedResources: ImportedFhirResourceResult[] = [];
  for (const resourceInput of input.fhirResources ?? []) {
    const resource = parseFhirResource(resourceInput.resource);
    const externalReference = await upsertExternalReference({
      tx,
      orgId: input.orgId,
      externalSystemId: system.id,
      resource,
      input: resourceInput,
    });
    const cache = await writeFhirResourceCache({
      tx,
      orgId: input.orgId,
      externalSystemId: system.id,
      externalReferenceId: externalReference.id,
      resource,
      input: resourceInput,
    });
    const subjectType = resourceInput.localResource?.type ?? ClinicalLocalResourceType.none;
    const subjectId =
      resourceInput.localResource?.id ?? `${resource.resourceType}:${resource.resourceId}`;
    const provenance = await createOrFindProvenance({
      tx,
      orgId: input.orgId,
      subjectType,
      subjectId,
      activity: `fhir.${resource.resourceType}.cache_write`,
      externalReferenceId: externalReference.id,
      fhirResourceCacheId: cache.id,
      yreseClinicalEventId: event.id,
      inputHash: resource.contentHash,
      outputHash: hashJson('fhir-cache-row', {
        external_reference_id: externalReference.id,
        fhir_resource_cache_id: cache.id,
      }),
    });

    importedResources.push({
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      versionId: resource.versionId,
      contentHash: resource.contentHash,
      externalReferenceId: externalReference.id,
      fhirResourceCacheId: cache.id,
      provenanceRecordId: provenance.id,
    });
  }

  const queueItem = await upsertQueueItem({
    tx,
    orgId: input.orgId,
    externalSystemId: system.id,
    input,
    yreseClinicalEventId: event.id,
    idempotencyKeyHash,
    firstResource: importedResources[0],
  });

  if (importedResources.length === 0) {
    await createOrFindProvenance({
      tx,
      orgId: input.orgId,
      subjectType: input.webhook.aggregate?.type ?? ClinicalLocalResourceType.none,
      subjectId: input.webhook.aggregate?.id ?? `event:${input.webhook.eventType}`,
      activity: `yrese.${input.webhook.eventType}.received`,
      yreseClinicalEventId: event.id,
      inputHash: payloadHash,
      outputHash: hashJson('yrese-event-row', { yrese_event_id: event.id }),
    });
  }

  return {
    externalSystemId: system.id,
    yreseClinicalEventId: event.id,
    queueItemId: queueItem.id,
    importedResources,
  };
}

export async function importYreseClinicalWebhook(
  input: ImportYreseClinicalWebhookInput,
  options: ImportYreseClinicalWebhookOptions = {},
): Promise<ImportYreseClinicalWebhookResult> {
  const runInOrgContext =
    options.runInOrgContext ??
    (<T>(orgId: string, work: (tx: ClinicalImportTx) => Promise<T>) =>
      withOrgContext(orgId, (tx) => work(tx), {
        requestContext: input.requestContext,
        timeoutMs: 10_000,
      }));

  return runInOrgContext(input.orgId, (tx) => importWithinTransaction(tx, input), {
    requestContext: input.requestContext,
  });
}

export const standardClinicalIntegrationInternals = {
  hashJson,
  parseFhirResource,
  stableJson,
};
