import {
  ClinicalExternalReferenceStatus,
  ClinicalLocalResourceType,
  ClinicalMatchConfidence,
  ClinicalQueueStatus,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { verifyClinicalExternalReferencePatientLink } from './standard-clinical-patient-linkage';

function createMockTx() {
  return {
    clinicalExternalReference: {
      findFirst: vi.fn().mockResolvedValue({ id: 'external_reference_1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    clinicalFhirResourceCache: {
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    clinicalSyncQueueItem: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    clinicalProvenanceRecord: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue({ id: 'provenance_1' }),
    },
  };
}

describe('verifyClinicalExternalReferencePatientLink', () => {
  it('marks an external reference as manually verified, updates FHIR caches, and requeues patient-link conflicts', async () => {
    const tx = createMockTx();

    const result = await verifyClinicalExternalReferencePatientLink(tx as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      externalReferenceId: 'external_reference_1',
      verifiedByUserId: 'user_1',
    });

    expect(result).toEqual({
      externalReferenceId: 'external_reference_1',
      patientId: 'patient_1',
      updatedCacheCount: 2,
      requeuedQueueItemCount: 1,
      provenanceRecordId: 'provenance_1',
    });
    expect(tx.clinicalExternalReference.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_org_id: { id: 'external_reference_1', org_id: 'org_1' } },
        data: expect.objectContaining({
          patient_id: 'patient_1',
          local_resource_type: ClinicalLocalResourceType.patient,
          local_resource_id: 'patient_1',
          status: ClinicalExternalReferenceStatus.verified,
          confidence: ClinicalMatchConfidence.verified_manual,
        }),
      }),
    );
    expect(tx.clinicalFhirResourceCache.updateMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        external_reference_id: 'external_reference_1',
      },
      data: { patient_id: 'patient_1' },
    });
    expect(tx.clinicalSyncQueueItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          external_reference_id: 'external_reference_1',
          status: ClinicalQueueStatus.conflict_requires_review,
          last_error_code: 'PATIENT_ID_REQUIRED_FOR_TIMELINE_PROJECTION',
        },
        data: expect.objectContaining({
          status: ClinicalQueueStatus.pending,
          locked_at: null,
          locked_by: null,
          completed_at: null,
          last_error_code: null,
        }),
      }),
    );
    expect(tx.clinicalProvenanceRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          subject_type: ClinicalLocalResourceType.patient,
          subject_id: 'patient_1',
          activity: 'clinical_external_reference.patient_link_verified',
          external_reference_id: 'external_reference_1',
          input_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          recorded_by: 'user_1',
        }),
        skipDuplicates: true,
      }),
    );
    expect(tx.clinicalProvenanceRecord.createMany.mock.calls[0]?.[0]?.data).not.toHaveProperty(
      'output_hash',
    );
  });

  it('returns null without writes when the external reference is unavailable', async () => {
    const tx = createMockTx();
    tx.clinicalExternalReference.findFirst.mockResolvedValueOnce(null);

    const result = await verifyClinicalExternalReferencePatientLink(tx as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      externalReferenceId: 'missing_reference',
      verifiedByUserId: 'user_1',
    });

    expect(result).toBeNull();
    expect(tx.clinicalExternalReference.update).not.toHaveBeenCalled();
    expect(tx.clinicalFhirResourceCache.updateMany).not.toHaveBeenCalled();
    expect(tx.clinicalSyncQueueItem.updateMany).not.toHaveBeenCalled();
    expect(tx.clinicalProvenanceRecord.createMany).not.toHaveBeenCalled();
  });

  it('finds existing provenance when a manual verification is replayed', async () => {
    const tx = createMockTx();
    tx.clinicalProvenanceRecord.createMany.mockResolvedValueOnce({ count: 0 });
    tx.clinicalProvenanceRecord.findFirst.mockResolvedValueOnce({ id: 'provenance_existing' });

    const result = await verifyClinicalExternalReferencePatientLink(tx as never, {
      orgId: 'org_1',
      patientId: 'patient_1',
      externalReferenceId: 'external_reference_1',
      verifiedByUserId: 'user_1',
    });

    expect(result?.provenanceRecordId).toBe('provenance_existing');
    expect(tx.clinicalProvenanceRecord.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(tx.clinicalProvenanceRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          subject_type: ClinicalLocalResourceType.patient,
          subject_id: 'patient_1',
          activity: 'clinical_external_reference.patient_link_verified',
          input_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        }),
      }),
    );
  });

  it('fails closed when provenance cannot be read after the conflict-safe insert', async () => {
    const tx = createMockTx();
    tx.clinicalProvenanceRecord.findFirst.mockResolvedValueOnce(null);

    await expect(
      verifyClinicalExternalReferencePatientLink(tx as never, {
        orgId: 'org_1',
        patientId: 'patient_1',
        externalReferenceId: 'external_reference_1',
        verifiedByUserId: 'user_1',
      }),
    ).rejects.toThrow('Patient linkage provenance was not recorded');
  });
});
