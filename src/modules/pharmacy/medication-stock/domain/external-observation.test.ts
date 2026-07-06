import { describe, expect, it } from 'vitest';
import {
  classifyExternalObservationSource,
  hasDisallowedRawPhiKeys,
  stageExternalStockObservationForReview,
  toPublicExternalStockObservationSummary,
} from './external-observation';

const medication = {
  clinical: { yjCode: 'YJ0001', medicationNameKey: 'acetaminophen tablet' },
};

describe('external stock observation domain', () => {
  it.each(['mcs', 'communication_event', 'partner_visit_record'] as const)(
    'stages %s observations and never writes directly to the ledger',
    (sourceType) => {
      const decision = stageExternalStockObservationForReview({
        source: { sourceType, sourceRecordId: `${sourceType}_1`, observedByRole: 'nurse' },
        observationKind: 'remaining_quantity',
        medication,
        observedQuantity: { value: 4, unitKey: 'sheet' },
      });

      expect(decision).toMatchObject({
        action: 'stage_for_pharmacist_review',
        ledgerWritePolicy: 'never_direct_from_external',
        sourceClassification: {
          sourceGroup: 'external_multi_professional',
          directLedgerWriteAllowed: false,
          requiresPharmacistReview: true,
        },
        reviewPriority: 'medium',
      });
    },
  );

  it('keeps pharmacist-owned observations staged in this pure domain slice', () => {
    const classification = classifyExternalObservationSource({
      sourceType: 'manual_pharmacist_review',
    });

    expect(classification).toEqual({
      sourceGroup: 'pharmacy_owned',
      requiresPharmacistReview: true,
      directLedgerWriteAllowed: false,
    });
  });

  it('does not expose source record ids or raw text in public summaries', () => {
    const summary = toPublicExternalStockObservationSummary({
      source: {
        sourceType: 'mcs',
        sourceRecordId: 'mcs_message_1',
        observedByRole: 'care_manager',
        occurredAtDateKey: '2026-07-06',
      },
      observationKind: 'prn_usage_report',
      medication,
      observedQuantity: { value: 2, unitKey: 'dose' },
    });

    expect(summary).toEqual({
      sourceType: 'mcs',
      observedByRole: 'care_manager',
      observationKind: 'prn_usage_report',
      hasMedicationIdentity: true,
      hasObservedQuantity: true,
      occurredAtDateKey: '2026-07-06',
    });
    expect(summary).not.toHaveProperty('sourceRecordId');
    expect(summary).not.toHaveProperty('rawText');
    expect(summary).not.toHaveProperty('patientName');
  });

  it('rejects unsafe raw PHI-like payload keys before staging', () => {
    const decision = stageExternalStockObservationForReview({
      source: { sourceType: 'communication_event' },
      observationKind: 'remaining_quantity',
      medication,
      observedQuantity: { value: 1, unitKey: 'tube' },
      rawText: '患者名を含む自由記載',
    } as never);

    expect(decision).toMatchObject({
      action: 'reject_unsafe_payload',
      ledgerWritePolicy: 'not_applicable',
      warnings: ['raw_phi_key_present'],
    });
  });

  it('detects nested raw PHI-like keys in hostile adapter payloads', () => {
    expect(
      hasDisallowedRawPhiKeys({
        extracted: { message_body: '残薬の自由記載' },
      }),
    ).toBe(true);
    expect(
      hasDisallowedRawPhiKeys({
        extractedMedicationName: '外用薬A',
        observedQuantity: 3,
      }),
    ).toBe(false);
  });

  it('ignores unknown non-stock observations without creating review work', () => {
    const decision = stageExternalStockObservationForReview({
      source: { sourceType: 'unknown' },
      observationKind: 'unknown',
    });

    expect(decision).toMatchObject({
      action: 'ignore_non_stock_observation',
      ledgerWritePolicy: 'not_applicable',
      reviewPriority: 'low',
      warnings: ['no_stock_signal'],
    });
  });

  it('raises high priority for no-stock observations', () => {
    const decision = stageExternalStockObservationForReview({
      source: { sourceType: 'partner_visit_record', observedByRole: 'partner_staff' },
      observationKind: 'no_stock_observed',
      medication,
      observedQuantity: { value: 0, unitKey: 'dose' },
    });

    expect(decision.reviewPriority).toBe('high');
    expect(decision.publicSummary).toMatchObject({
      hasMedicationIdentity: true,
      hasObservedQuantity: true,
    });
  });
});
