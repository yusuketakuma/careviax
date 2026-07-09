import { Prisma, MedicationTimelineSourceKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { listStandardMedicationTimeline } from './standard-medication-timeline';

describe('listStandardMedicationTimeline', () => {
  it('returns patient medication timeline DTOs without exposing FHIR cache IDs or raw source references', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'timeline_1',
        source_kind: MedicationTimelineSourceKind.medication_request,
        medication_coding: [{ system: 'urn:drug', code: '1234567890' }],
        medication_display: null,
        medication_text: null,
        status: 'active',
        authored_at: new Date('2026-07-08T00:00:00+09:00'),
        effective_at: new Date('2026-07-09T00:00:00+09:00'),
        dispensed_at: null,
        asserted_at: null,
        quantity_value: new Prisma.Decimal('14'),
        quantity_unit: 'tablet',
        dosage_text: null,
        sync_status: 'synced',
        updated_at: new Date('2026-07-09T10:00:00+09:00'),
        fhir_resource_cache_id: 'cache_should_not_leak',
        source_reference_id: 'source_should_not_leak',
      },
    ]);

    const result = await listStandardMedicationTimeline(
      { medicationTimelineItem: { findMany } },
      { orgId: 'org_1', patientId: 'patient_1', caseId: 'case_1', limit: 20 },
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { org_id: 'org_1', patient_id: 'patient_1', case_id: 'case_1' },
        take: 20,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'timeline_1',
        category: 'prescription',
        medication_label: '1234567890',
        status: 'active',
        quantity: { value: '14', unit: 'tablet' },
        sync_status: 'synced',
      }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('cache_should_not_leak');
    expect(serialized).not.toContain('source_should_not_leak');
    expect(serialized).not.toContain('MedicationRequest');
  });
});
