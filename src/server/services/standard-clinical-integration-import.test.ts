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
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  importYreseClinicalWebhook,
  standardClinicalIntegrationInternals,
  type ImportYreseClinicalWebhookInput,
} from './standard-clinical-integration-import';

function createMockTx() {
  return {
    clinicalExternalSystem: {
      upsert: vi.fn().mockResolvedValue({ id: 'external_system_1' }),
    },
    yreseClinicalEvent: {
      create: vi.fn().mockResolvedValue({ id: 'yrese_event_1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    clinicalExternalReference: {
      upsert: vi.fn().mockResolvedValue({ id: 'external_reference_1' }),
    },
    clinicalFhirResourceCache: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({ id: 'fhir_cache_1' }),
    },
    clinicalSyncQueueItem: {
      upsert: vi.fn().mockResolvedValue({ id: 'sync_queue_1' }),
    },
    clinicalProvenanceRecord: {
      create: vi.fn().mockResolvedValue({ id: 'provenance_1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

const medicationRequestResource = {
  resourceType: 'MedicationRequest',
  id: 'medreq_abc',
  meta: {
    versionId: 'v1',
    profile: ['http://jpfhir.jp/fhir/core/StructureDefinition/JP_MedicationRequest'],
    lastUpdated: '2026-07-09T09:00:00+09:00',
  },
  identifier: [{ system: 'urn:yrese:prescription', value: 'LEAK_PRESCRIPTION_IDENTIFIER' }],
  status: 'active',
  intent: 'order',
  subject: { reference: 'Patient/patient_123' },
  medicationCodeableConcept: {
    coding: [{ system: 'urn:oid:1.2.392.100495.20.2.74', code: '1234567890' }],
    text: 'LEAK_MEDICATION_TEXT',
  },
  dosageInstruction: [{ text: 'LEAK_DOSAGE_TEXT' }],
  authoredOn: '2026-07-09',
};

function baseInput(): ImportYreseClinicalWebhookInput {
  return {
    orgId: 'org_1',
    externalSystem: {
      systemKey: 'yrese-main',
      systemType: ClinicalExternalSystemType.yrese_fhir,
      baseUrl: 'https://LEAK_BASE_URL.example.test/fhir',
    },
    webhook: {
      eventId: 'evt_001',
      eventType: 'dispensing.confirmed',
      occurredAt: new Date('2026-07-09T09:00:00+09:00'),
      schemaVersion: '1.0.0',
      resourceRefs: ['MedicationRequest/medreq_abc', 'MedicationDispense/dispense_def'],
      payload: {
        event_id: 'evt_001',
        raw_patient_name: 'LEAK_RAW_PAYLOAD_PATIENT_NAME',
      },
      payloadProfile: 'yrese.webhook.v1',
      metadata: { source: 'LEAK_WEBHOOK_METADATA' },
      sensitivity: ClinicalPayloadSensitivity.phi,
      receiptStatus: ClinicalEventReceiptStatus.accepted,
      aggregate: { type: ClinicalLocalResourceType.patient, id: 'patient_1' },
    },
    fhirResources: [
      {
        resource: medicationRequestResource,
        patientId: 'patient_1',
        caseId: 'case_1',
        localResource: {
          type: ClinicalLocalResourceType.prescription_line,
          id: 'timeline_1',
        },
        status: ClinicalExternalReferenceStatus.verified,
        confidence: ClinicalMatchConfidence.exact_identifier,
        validationStatus: ClinicalFhirValidationStatus.valid,
      },
    ],
    queue: { operation: 'yrese.dispensing.confirmed.import', priority: 50 },
  };
}

async function importWithMockTx(input: ImportYreseClinicalWebhookInput, tx: MockTx) {
  return importYreseClinicalWebhook(input, {
    runInOrgContext: async (orgId, work) => {
      expect(orgId).toBe(input.orgId);
      return work(tx as never);
    },
  });
}

function serializeCalls(tx: MockTx): string {
  return JSON.stringify({
    externalSystem: tx.clinicalExternalSystem.upsert.mock.calls,
    eventCreate: tx.yreseClinicalEvent.create.mock.calls,
    externalReference: tx.clinicalExternalReference.upsert.mock.calls,
    cacheUpdateMany: tx.clinicalFhirResourceCache.updateMany.mock.calls,
    cacheUpsert: tx.clinicalFhirResourceCache.upsert.mock.calls,
    queue: tx.clinicalSyncQueueItem.upsert.mock.calls,
    provenance: tx.clinicalProvenanceRecord.create.mock.calls,
  });
}

describe('importYreseClinicalWebhook', () => {
  it('writes an idempotent yrese event, FHIR cache row, sync queue item, and provenance record', async () => {
    const tx = createMockTx();
    const result = await importWithMockTx(baseInput(), tx);

    expect(result).toEqual({
      externalSystemId: 'external_system_1',
      yreseClinicalEventId: 'yrese_event_1',
      queueItemId: 'sync_queue_1',
      importedResources: [
        {
          resourceType: ClinicalFhirResourceType.medication_request,
          resourceId: 'medreq_abc',
          versionId: 'v1',
          contentHash: expect.stringMatching(/^sha256:/),
          externalReferenceId: 'external_reference_1',
          fhirResourceCacheId: 'fhir_cache_1',
          provenanceRecordId: 'provenance_1',
        },
      ],
    });

    expect(tx.clinicalExternalSystem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id_system_key: { org_id: 'org_1', system_key: 'yrese-main' } },
      }),
    );
    expect(tx.yreseClinicalEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          direction: ClinicalIntegrationDirection.inbound,
          event_type: 'dispensing.confirmed',
          external_event_id: 'evt_001',
          payload_hash: expect.stringMatching(/^sha256:/),
          idempotency_key_hash: expect.stringMatching(/^sha256:/),
        }),
      }),
    );
    expect(tx.clinicalFhirResourceCache.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { is_current: false },
        where: expect.objectContaining({
          org_id: 'org_1',
          external_system_id: 'external_system_1',
          resource_type: ClinicalFhirResourceType.medication_request,
          resource_id: 'medreq_abc',
          is_current: true,
        }),
      }),
    );
    expect(tx.clinicalFhirResourceCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_external_system_id_resource_type_resource_id_version_id: {
            org_id: 'org_1',
            external_system_id: 'external_system_1',
            resource_type: ClinicalFhirResourceType.medication_request,
            resource_id: 'medreq_abc',
            version_id: 'v1',
          },
        },
        create: expect.objectContaining({
          external_reference_id: 'external_reference_1',
          identifier_summary: expect.objectContaining({
            identifier_count: 1,
            identifiers: [
              expect.objectContaining({ value_hash: expect.stringMatching(/^sha256:/) }),
            ],
          }),
          normalized_summary: expect.objectContaining({
            resource_type: 'MedicationRequest',
            medication: {
              coding: [{ system: 'urn:oid:1.2.392.100495.20.2.74', code: '1234567890' }],
            },
          }),
          validation_status: ClinicalFhirValidationStatus.valid,
        }),
      }),
    );
    expect(tx.clinicalSyncQueueItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: ClinicalQueueStatus.pending,
          priority: 50,
          request_fingerprint_hash: expect.stringMatching(/^sha256:/),
        }),
      }),
    );
    expect(tx.clinicalProvenanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject_type: ClinicalLocalResourceType.prescription_line,
          subject_id: 'timeline_1',
          activity: 'fhir.medication_request.cache_write',
          input_hash: expect.stringMatching(/^sha256:/),
          output_hash: expect.stringMatching(/^sha256:/),
        }),
      }),
    );
  });

  it('handles duplicate yrese webhook receipts without updating the append-only event ledger', async () => {
    const tx = createMockTx();
    tx.yreseClinicalEvent.create.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 'P2002' }),
    );
    tx.yreseClinicalEvent.findFirst.mockResolvedValueOnce({ id: 'yrese_event_existing' });

    const result = await importWithMockTx(baseInput(), tx);

    expect(result.yreseClinicalEventId).toBe('yrese_event_existing');
    expect(tx.yreseClinicalEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          idempotency_key_hash: expect.stringMatching(/^sha256:/),
        }),
      }),
    );
    expect('update' in tx.yreseClinicalEvent).toBe(false);
  });

  it('does not persist raw FHIR payloads, patient names, medication text, dosage text, or identifier values', async () => {
    const tx = createMockTx();
    await importWithMockTx(baseInput(), tx);

    const serializedCalls = serializeCalls(tx);
    expect(serializedCalls).not.toContain('LEAK_RAW_PAYLOAD_PATIENT_NAME');
    expect(serializedCalls).not.toContain('LEAK_PRESCRIPTION_IDENTIFIER');
    expect(serializedCalls).not.toContain('LEAK_MEDICATION_TEXT');
    expect(serializedCalls).not.toContain('LEAK_DOSAGE_TEXT');
    expect(serializedCalls).not.toContain('LEAK_BASE_URL');
    expect(serializedCalls).not.toContain('LEAK_WEBHOOK_METADATA');
    expect(serializedCalls).toContain('payload_storage');
    expect(serializedCalls).toContain('metadata_storage');
    expect(serializedCalls).toContain('hash_only');
    expect(serializedCalls).toContain('sha256:');
  });

  it('uses a content hash as a deterministic version when a FHIR meta.versionId is absent', () => {
    const parsed = standardClinicalIntegrationInternals.parseFhirResource({
      resourceType: 'Patient',
      id: 'patient_without_version',
      identifier: [{ system: 'urn:mrn', value: 'LEAK_PATIENT_IDENTIFIER' }],
      name: [{ text: 'LEAK_FHIR_PATIENT_NAME' }],
    });

    expect(parsed.resourceType).toBe(ClinicalFhirResourceType.patient);
    expect(parsed.versionId).toMatch(/^sha256:/);
    expect(JSON.stringify(parsed.identifierSummary)).not.toContain('LEAK_PATIENT_IDENTIFIER');
    expect(JSON.stringify(parsed.normalizedSummary)).not.toContain('LEAK_FHIR_PATIENT_NAME');
  });
});
