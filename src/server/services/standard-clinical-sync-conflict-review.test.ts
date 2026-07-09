import {
  ClinicalFhirResourceType,
  ClinicalFhirValidationStatus,
  ClinicalIntegrationDirection,
  ClinicalLocalResourceType,
  ClinicalQueueStatus,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getClinicalSyncFhirValidationDetail,
  listClinicalSyncConflicts,
  type ClinicalSyncReviewConflictCode,
} from './standard-clinical-sync-conflict-review';

function createMockDb() {
  return {
    clinicalSyncQueueItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    clinicalExternalReference: {
      findMany: vi.fn(),
    },
    clinicalFhirResourceCache: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

function createQueueRow(overrides: Record<string, unknown> = {}) {
  return {
    display_id: 'queue_display_1',
    aggregate_type: ClinicalLocalResourceType.none,
    priority: 50,
    attempt_count: 1,
    max_attempts: 8,
    external_reference_id: null,
    fhir_resource_cache_id: null,
    last_error_code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
    created_at: new Date('2026-07-09T00:00:00.000Z'),
    updated_at: new Date('2026-07-09T00:10:00.000Z'),
    metadata: 'SHOULD_NOT_LEAK_METADATA',
    idempotency_key_hash: 'SHOULD_NOT_LEAK_IDEMPOTENCY',
    request_fingerprint_hash: 'SHOULD_NOT_LEAK_FINGERPRINT',
    ...overrides,
  };
}

describe('listClinicalSyncConflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only safe patient-link and FHIR validation review DTOs', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findMany.mockResolvedValue([
      createQueueRow({
        display_id: null,
        external_reference_id: 'external_reference_1',
      }),
      createQueueRow({
        display_id: 'queue_display_2',
        external_reference_id: 'SHOULD_NOT_LEAK_EXTERNAL_REFERENCE_FOR_FHIR',
        fhir_resource_cache_id: 'cache_1',
        last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
      }),
    ]);
    db.clinicalExternalReference.findMany.mockResolvedValue([
      {
        id: 'external_reference_1',
        display_id: 'external_reference_display_1',
        resource_type: ClinicalFhirResourceType.patient,
        status: 'candidate',
        confidence: 'none',
        external_resource_id: 'SHOULD_NOT_LEAK_EXTERNAL_RESOURCE_ID',
        patient_id: 'SHOULD_NOT_LEAK_PATIENT_ID',
      },
    ]);
    db.clinicalFhirResourceCache.findMany.mockResolvedValue([
      {
        id: 'cache_1',
        resource_type: ClinicalFhirResourceType.medication_request,
        resource_id: 'SHOULD_NOT_LEAK_RESOURCE_ID',
        version_id: 'SHOULD_NOT_LEAK_VERSION_ID',
        profile_urls: [
          'https://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest',
          `https://example.test/${'x'.repeat(600)}`,
        ],
        validation_status: ClinicalFhirValidationStatus.unsupported_profile,
        validation_errors: 'SHOULD_NOT_LEAK_VALIDATION_ERRORS',
        content_hash: 'SHOULD_NOT_LEAK_CONTENT_HASH',
        etag_hash: 'SHOULD_NOT_LEAK_ETAG_HASH',
        normalized_summary: 'SHOULD_NOT_LEAK_NORMALIZED_SUMMARY',
        identifier_summary: 'SHOULD_NOT_LEAK_IDENTIFIER_SUMMARY',
      },
    ]);

    const conflicts = await listClinicalSyncConflicts(db as never, {
      orgId: 'org_1',
      limit: 20,
    });

    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]).toMatchObject({
      queue_display_id: null,
      conflict_kind: 'patient_link_required',
      operation_kind: 'yrese_clinical_sync_projection',
      error: {
        code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
        retryable: false,
      },
      patient_link_review: {
        external_reference_id: 'external_reference_1',
        external_reference_display_id: 'external_reference_display_1',
        resource_type: ClinicalFhirResourceType.patient,
      },
    });
    expect(conflicts[1]).toMatchObject({
      queue_display_id: 'queue_display_2',
      conflict_kind: 'fhir_profile_validation_required',
      profile_validation_review_required: true,
      fhir_resource: {
        resource_type: ClinicalFhirResourceType.medication_request,
        resource_id_available: true,
        version_id_available: true,
        validation_status: ClinicalFhirValidationStatus.unsupported_profile,
      },
    });
    expect(conflicts[1]).not.toHaveProperty('external_reference_id');
    expect(JSON.stringify(conflicts)).not.toContain('SHOULD_NOT_LEAK');
    expect(
      (conflicts[1] as { fhir_resource: { profile_urls: string[] } }).fhir_resource.profile_urls[1]
        ?.length,
    ).toBe(500);
  });

  it('uses org-scoped allowlisted review query conditions and safe selects', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findMany.mockResolvedValue([]);

    await listClinicalSyncConflicts(db as never, {
      orgId: 'org_1',
      limit: 999,
    });

    expect(db.clinicalSyncQueueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          direction: ClinicalIntegrationDirection.inbound,
          status: ClinicalQueueStatus.conflict_requires_review,
          operation: { startsWith: 'yrese.' },
          last_error_code: {
            in: ['PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION', 'FHIR_PROFILE_VALIDATION_REQUIRED'],
          },
        }),
        take: 100,
      }),
    );
    const call = db.clinicalSyncQueueItem.findMany.mock.calls[0]?.[0];
    expect(JSON.stringify(call?.select)).not.toContain('metadata');
    expect(JSON.stringify(call?.select)).not.toContain('idempotency_key_hash');
    expect(JSON.stringify(call?.select)).not.toContain('request_fingerprint_hash');
    expect(JSON.stringify(call?.select)).not.toContain('last_error_metadata');
  });

  it('applies an explicit conflict code filter and normalizes small limits', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findMany.mockResolvedValue([]);

    await listClinicalSyncConflicts(db as never, {
      orgId: 'org_1',
      limit: 0,
      errorCode: 'FHIR_PROFILE_VALIDATION_REQUIRED',
    });

    expect(db.clinicalSyncQueueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
        }),
        take: 1,
      }),
    );
  });

  it('rejects unsupported runtime conflict codes instead of widening the query', async () => {
    const db = createMockDb();

    await expect(
      listClinicalSyncConflicts(db as never, {
        orgId: 'org_1',
        errorCode: 'FHIR_RESOURCE_CACHE_REQUIRED' as ClinicalSyncReviewConflictCode,
      }),
    ).rejects.toThrow('Unsupported clinical sync review conflict code');
    expect(db.clinicalSyncQueueItem.findMany).not.toHaveBeenCalled();
  });
});

describe('getClinicalSyncFhirValidationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns capped validation diagnostics without exposing internal IDs, hashes, or raw summaries', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findFirst.mockResolvedValue(
      createQueueRow({
        display_id: 'csq0000000001',
        fhir_resource_cache_id: 'cache_1',
        last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
      }),
    );
    db.clinicalFhirResourceCache.findFirst.mockResolvedValue({
      resource_type: ClinicalFhirResourceType.medication_request,
      resource_id: 'SHOULD_NOT_LEAK_RESOURCE_ID',
      version_id: 'SHOULD_NOT_LEAK_VERSION_ID',
      profile_urls: [
        'http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest',
        `https://example.test/${'x'.repeat(600)}`,
      ],
      validation_status: ClinicalFhirValidationStatus.unsupported_profile,
      validation_errors: [
        {
          code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS',
          path: '$.meta.profile',
          expected: `http://example.test/${'y'.repeat(600)}`,
          detail: 'SHOULD_NOT_LEAK_RAW_DETAIL',
        },
        {
          code: 'EXTERNAL_VALIDATOR_ERRORS_REDACTED',
          path: '$',
          raw_patient_id: 'SHOULD_NOT_LEAK_PATIENT_ID',
        },
      ],
      fetched_at: new Date('2026-07-09T01:00:00.000Z'),
      last_modified_at: new Date('2026-07-09T00:00:00.000Z'),
      updated_at: new Date('2026-07-09T02:00:00.000Z'),
      content_hash: 'SHOULD_NOT_LEAK_CONTENT_HASH',
      identifier_summary: 'SHOULD_NOT_LEAK_IDENTIFIER_SUMMARY',
      normalized_summary: 'SHOULD_NOT_LEAK_NORMALIZED_SUMMARY',
    });

    const detail = await getClinicalSyncFhirValidationDetail(db as never, {
      orgId: 'org_1',
      queueDisplayId: 'csq0000000001',
    });

    expect(detail).toMatchObject({
      queue_display_id: 'csq0000000001',
      conflict_kind: 'fhir_profile_validation_required',
      profile_validation_review_required: true,
      fhir_resource: {
        resource_type: ClinicalFhirResourceType.medication_request,
        resource_id_available: true,
        version_id_available: true,
        validation_status: ClinicalFhirValidationStatus.unsupported_profile,
        fetched_at: '2026-07-09T01:00:00.000Z',
        last_modified_at: '2026-07-09T00:00:00.000Z',
        updated_at: '2026-07-09T02:00:00.000Z',
      },
      validation_diagnostics: {
        issue_count: 2,
        returned_issue_count: 2,
        truncated: false,
        issues: [
          {
            code: 'JP_CORE_PROFILE_URL_REQUIRED_FOR_VALID_STATUS',
            path: '$.meta.profile',
          },
          {
            code: 'EXTERNAL_VALIDATOR_ERRORS_REDACTED',
            path: '$',
            expected: null,
          },
        ],
      },
    });
    expect(detail?.fhir_resource?.profile_urls[1]?.length).toBe(500);
    expect(detail?.validation_diagnostics.issues[0]?.expected?.length).toBe(500);
    expect(JSON.stringify(detail)).not.toContain('SHOULD_NOT_LEAK');
    expect(JSON.stringify(detail)).not.toContain('cache_1');
  });

  it('uses queue_display_id and FHIR validation conflict conditions before reading the cache', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findFirst.mockResolvedValue(null);

    const detail = await getClinicalSyncFhirValidationDetail(db as never, {
      orgId: 'org_1',
      queueDisplayId: 'csq0000000001',
    });

    expect(detail).toBeNull();
    expect(db.clinicalSyncQueueItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          display_id: 'csq0000000001',
          direction: ClinicalIntegrationDirection.inbound,
          status: ClinicalQueueStatus.conflict_requires_review,
          operation: { startsWith: 'yrese.' },
          last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
        }),
      }),
    );
    expect(
      JSON.stringify(db.clinicalSyncQueueItem.findFirst.mock.calls[0]?.[0]?.select),
    ).not.toContain('idempotency_key_hash');
    expect(db.clinicalFhirResourceCache.findFirst).not.toHaveBeenCalled();
  });

  it('caps returned validation issues', async () => {
    const db = createMockDb();
    db.clinicalSyncQueueItem.findFirst.mockResolvedValue(
      createQueueRow({
        display_id: 'csq0000000001',
        fhir_resource_cache_id: 'cache_1',
        last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
      }),
    );
    db.clinicalFhirResourceCache.findFirst.mockResolvedValue({
      resource_type: ClinicalFhirResourceType.medication_request,
      resource_id: 'medreq_1',
      version_id: null,
      profile_urls: [],
      validation_status: ClinicalFhirValidationStatus.invalid,
      validation_errors: Array.from({ length: 55 }, (_, index) => ({
        code: `ISSUE_${index}`,
      })),
      fetched_at: new Date('2026-07-09T01:00:00.000Z'),
      last_modified_at: null,
      updated_at: new Date('2026-07-09T02:00:00.000Z'),
    });

    const detail = await getClinicalSyncFhirValidationDetail(db as never, {
      orgId: 'org_1',
      queueDisplayId: 'csq0000000001',
    });

    expect(detail?.validation_diagnostics).toMatchObject({
      issue_count: 55,
      returned_issue_count: 50,
      truncated: true,
    });
  });
});
