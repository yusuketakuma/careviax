import {
  ClinicalFhirValidationStatus,
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
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

type MockTx = ReturnType<typeof createMockTx>;

const now = new Date('2026-07-09T09:00:00+09:00');
const VALID_CONTENT_HASH =
  'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

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
  content_hash: VALID_CONTENT_HASH,
  validation_status: ClinicalFhirValidationStatus.valid,
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
    expect(tx.clinicalProvenanceRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org_id: 'org_1',
          subject_type: ClinicalLocalResourceType.other,
          subject_id: 'timeline_1',
          fhir_resource_cache_id: 'cache_1',
          yrese_event_id: 'event_1',
          input_hash: VALID_CONTENT_HASH,
        }),
        skipDuplicates: true,
      }),
    );
    expect(tx.clinicalProvenanceRecord.createMany.mock.calls[0]?.[0]?.data).not.toHaveProperty(
      'output_hash',
    );
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'queue_1',
          status: ClinicalQueueStatus.running,
          locked_by: 'worker_1',
        }),
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
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ClinicalQueueStatus.running,
          locked_by: 'worker_1',
        }),
        data: expect.objectContaining({
          status: ClinicalQueueStatus.conflict_requires_review,
          last_error_code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
        }),
      }),
    );
  });

  it('keeps unvalidated medication FHIR cache rows out of the medication timeline', async () => {
    const tx = createMockTx();
    tx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    tx.clinicalFhirResourceCache.findFirst.mockResolvedValue({
      ...cacheRecord,
      validation_status: ClinicalFhirValidationStatus.not_validated,
    });

    const result = await drainWithTx(tx);

    expect(result).toMatchObject({
      processedCount: 1,
      conflictCount: 1,
      succeededCount: 0,
    });
    expect(tx.medicationTimelineItem.upsert).not.toHaveBeenCalled();
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: ClinicalQueueStatus.running,
          locked_by: 'worker_1',
        }),
        data: expect.objectContaining({
          status: ClinicalQueueStatus.conflict_requires_review,
          last_error_code: 'FHIR_PROFILE_VALIDATION_REQUIRED',
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

  it('isolates a poison item and persists its failure in a fresh transaction before continuing', async () => {
    const scanTx = createMockTx();
    const poisonTx = createMockTx();
    const failureTx = createMockTx();
    const successTx = createMockTx();
    const secondQueue = {
      ...queueRecord,
      id: 'queue_2',
      fhir_resource_cache_id: 'cache_2',
      external_reference_id: 'external_reference_2',
      yrese_event_id: 'event_2',
    };
    scanTx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord, secondQueue]);
    poisonTx.clinicalFhirResourceCache.findFirst.mockResolvedValue(cacheRecord);
    poisonTx.medicationTimelineItem.upsert.mockRejectedValue(
      new Error('statement failed token=secret patient=山田太郎'),
    );
    successTx.clinicalFhirResourceCache.findFirst.mockResolvedValue({
      ...cacheRecord,
      id: 'cache_2',
      external_reference_id: 'external_reference_2',
    });
    const transactions = [scanTx, poisonTx, failureTx, successTx];
    let transactionIndex = 0;

    const result = await drainYreseClinicalSyncQueue(
      { orgId: 'org_1', now, lockedBy: 'worker_1' },
      {
        runInOrgContext: async (orgId, work) => {
          expect(orgId).toBe('org_1');
          const tx = transactions[transactionIndex++];
          if (!tx) throw new Error('Unexpected transaction');
          return work(tx as never);
        },
      },
    );

    expect(result).toEqual({
      processedCount: 2,
      scannedCount: 2,
      succeededCount: 1,
      conflictCount: 0,
      failedCount: 1,
      skippedCount: 0,
      errors: ['Clinical sync queue item failed'],
    });
    expect(transactionIndex).toBe(4);
    expect(failureTx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'queue_1',
        org_id: 'org_1',
        status: ClinicalQueueStatus.pending,
        attempt_count: 0,
        next_attempt_at: { lte: now },
      },
      data: expect.objectContaining({
        status: ClinicalQueueStatus.failed,
        attempt_count: 1,
        last_error_code: 'CLINICAL_SYNC_QUEUE_ITEM_FAILED',
      }),
    });
    expect(successTx.medicationTimelineItem.upsert).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('token=secret');
    expect(JSON.stringify(result)).not.toContain('山田太郎');
  });

  it('does not overwrite a competing terminal result when failure CAS loses', async () => {
    const scanTx = createMockTx();
    const poisonTx = createMockTx();
    const failureTx = createMockTx();
    scanTx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    poisonTx.clinicalFhirResourceCache.findFirst.mockRejectedValue(new Error('statement failed'));
    failureTx.clinicalSyncQueueItem.updateMany.mockResolvedValue({ count: 0 });
    const transactions = [scanTx, poisonTx, failureTx];
    let transactionIndex = 0;

    const result = await drainYreseClinicalSyncQueue(
      { orgId: 'org_1', now, lockedBy: 'worker_1' },
      {
        runInOrgContext: async (_orgId, work) => {
          const tx = transactions[transactionIndex++];
          if (!tx) throw new Error('Unexpected transaction');
          return work(tx as never);
        },
      },
    );

    expect(result).toEqual({
      processedCount: 0,
      scannedCount: 1,
      succeededCount: 0,
      conflictCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
  });

  it('persists a fixed retryable failure after an item transaction timeout', async () => {
    const scanTx = createMockTx();
    const failureTx = createMockTx();
    scanTx.clinicalSyncQueueItem.findMany.mockResolvedValue([queueRecord]);
    let transactionIndex = 0;

    const result = await drainYreseClinicalSyncQueue(
      { orgId: 'org_1', now, lockedBy: 'worker_1' },
      {
        runInOrgContext: async (_orgId, work) => {
          transactionIndex += 1;
          if (transactionIndex === 1) return work(scanTx as never);
          if (transactionIndex === 2) {
            throw new Error('transaction timeout provider_payload=secret patient=山田太郎');
          }
          return work(failureTx as never);
        },
      },
    );

    expect(result).toMatchObject({
      processedCount: 1,
      failedCount: 1,
      skippedCount: 0,
      errors: ['Clinical sync queue item failed'],
    });
    expect(failureTx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: ClinicalQueueStatus.failed,
          attempt_count: 1,
          last_error_code: 'CLINICAL_SYNC_QUEUE_ITEM_FAILED',
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('provider_payload');
    expect(JSON.stringify(result)).not.toContain('山田太郎');
  });

  it('dead-letters an already exhausted item without exceeding its attempt bound', async () => {
    const tx = createMockTx();
    tx.clinicalSyncQueueItem.findMany.mockResolvedValue([
      { ...queueRecord, attempt_count: 8, max_attempts: 8 },
    ]);

    const result = await drainWithTx(tx);

    expect(result).toMatchObject({ processedCount: 1, failedCount: 1 });
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'queue_1',
        status: ClinicalQueueStatus.pending,
        attempt_count: 8,
      }),
      data: expect.objectContaining({
        status: ClinicalQueueStatus.dead_letter,
        completed_at: now,
        next_attempt_at: now,
        last_error_code: 'MAX_ATTEMPTS_EXHAUSTED',
      }),
    });
    const transition = tx.clinicalSyncQueueItem.updateMany.mock.calls.find(
      ([call]) => call.data?.status === ClinicalQueueStatus.dead_letter,
    )?.[0];
    expect(transition?.data).not.toHaveProperty('attempt_count');
  });
});
