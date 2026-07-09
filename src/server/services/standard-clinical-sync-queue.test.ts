import {
  ClinicalFhirResourceType,
  ClinicalIntegrationDirection,
  ClinicalLocalResourceType,
  ClinicalQueueStatus,
  ClinicalSyncStatus,
  MedicationTimelineSourceKind,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { drainYreseClinicalSyncQueue } from './standard-clinical-sync-queue';

function createMockTx() {
  return {
    clinicalSyncQueueItem: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    clinicalFhirResourceCache: {
      findFirst: vi.fn(),
    },
    medicationTimelineItem: {
      upsert: vi.fn().mockResolvedValue({ id: 'timeline_1' }),
    },
    clinicalProvenanceRecord: {
      create: vi.fn().mockResolvedValue({ id: 'provenance_1' }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

const now = new Date('2026-07-09T09:00:00+09:00');

const queueRecord = {
  id: 'queue_1',
  org_id: 'org_1',
  status: ClinicalQueueStatus.pending,
  operation: 'yrese.dispensing.confirmed.process',
  aggregate_type: ClinicalLocalResourceType.none,
  aggregate_id: null,
  fhir_resource_cache_id: 'cache_1',
  external_reference_id: 'external_reference_1',
  yrese_event_id: 'event_1',
  attempt_count: 0,
  max_attempts: 8,
};

const cacheRecord = {
  id: 'cache_1',
  org_id: 'org_1',
  patient_id: 'patient_1',
  case_id: 'case_1',
  resource_type: ClinicalFhirResourceType.medication_request,
  resource_id: 'medreq_1',
  version_id: 'v1',
  external_reference_id: 'external_reference_1',
  content_hash: 'sha256:resource',
  normalized_summary: {
    resource_type: 'MedicationRequest',
    resource_id: 'medreq_1',
    status: 'active',
    authored_at: '2026-07-08T00:00:00+09:00',
    effective_at: '2026-07-09T00:00:00+09:00',
    medication: {
      coding: [{ system: 'urn:oid:1.2.392.100495.20.2.74', code: '1234567890' }],
    },
  },
};

async function drainWithTx(tx: MockTx) {
  return drainYreseClinicalSyncQueue(
    { orgId: 'org_1', now, lockedBy: 'worker_1' },
    {
      runInOrgContext: async (orgId, work) => {
        expect(orgId).toBe('org_1');
        return work(tx as never);
      },
    },
  );
}

describe('drainYreseClinicalSyncQueue', () => {
  it('claims due yrese queue items and projects medication FHIR cache rows to timeline items', async () => {
    const tx = createMockTx();
    tx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    tx.clinicalFhirResourceCache.findFirst.mockResolvedValue(cacheRecord);

    const result = await drainWithTx(tx);

    expect(result).toEqual({
      processedCount: 1,
      scannedCount: 1,
      succeededCount: 1,
      conflictCount: 0,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(tx.clinicalSyncQueueItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          direction: ClinicalIntegrationDirection.inbound,
          status: { in: [ClinicalQueueStatus.pending, ClinicalQueueStatus.failed] },
          operation: { startsWith: 'yrese.' },
        }),
      }),
    );
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'queue_1',
          org_id: 'org_1',
          status: ClinicalQueueStatus.pending,
          attempt_count: 0,
        }),
        data: expect.objectContaining({
          status: ClinicalQueueStatus.running,
          locked_by: 'worker_1',
        }),
      }),
    );
    expect(tx.medicationTimelineItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id_source_kind_source_reference_id: {
            org_id: 'org_1',
            source_kind: MedicationTimelineSourceKind.medication_request,
            source_reference_id: 'cache_1',
          },
        },
        create: expect.objectContaining({
          org_id: 'org_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          source_kind: MedicationTimelineSourceKind.medication_request,
          external_reference_id: 'external_reference_1',
          fhir_resource_cache_id: 'cache_1',
          status: 'active',
          sync_status: ClinicalSyncStatus.synced,
        }),
      }),
    );
    expect(JSON.stringify(tx.medicationTimelineItem.upsert.mock.calls)).not.toContain(
      'LEAK_MEDICATION_TEXT',
    );
    expect(tx.clinicalProvenanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          subject_type: ClinicalLocalResourceType.other,
          subject_id: 'timeline_1',
          fhir_resource_cache_id: 'cache_1',
          yrese_event_id: 'event_1',
          input_hash: 'sha256:resource',
        }),
      }),
    );
    expect(tx.clinicalSyncQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClinicalQueueStatus.succeeded,
          locked_at: null,
          locked_by: null,
          completed_at: now,
          last_error_code: null,
        }),
      }),
    );
  });

  it('moves medication projections without verified patient linkage to conflict review', async () => {
    const tx = createMockTx();
    tx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    tx.clinicalFhirResourceCache.findFirst.mockResolvedValue({ ...cacheRecord, patient_id: null });

    const result = await drainWithTx(tx);

    expect(result).toMatchObject({
      processedCount: 1,
      conflictCount: 1,
      succeededCount: 0,
    });
    expect(tx.medicationTimelineItem.upsert).not.toHaveBeenCalled();
    expect(tx.clinicalSyncQueueItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClinicalQueueStatus.conflict_requires_review,
          last_error_code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
        }),
      }),
    );
  });

  it('skips work when another worker already claimed the queue item', async () => {
    const tx = createMockTx();
    tx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    tx.clinicalSyncQueueItem.updateMany.mockResolvedValue({ count: 0 });

    const result = await drainWithTx(tx);

    expect(result).toMatchObject({
      processedCount: 0,
      skippedCount: 1,
    });
    expect(tx.clinicalFhirResourceCache.findFirst).not.toHaveBeenCalled();
    expect(tx.medicationTimelineItem.upsert).not.toHaveBeenCalled();
  });
});
