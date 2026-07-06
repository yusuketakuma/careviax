import { describe, expect, it } from 'vitest';

import type { InboundSignalCandidate } from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';
import { extractInboundCommunicationSignals } from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';

import {
  buildInboundMedicationStockSignalStagingKey,
  mapInboundCommunicationToExternalStockSource,
  stageInboundMedicationStockSignalForReview,
} from './medication-stock-signal-adapter';

const medication = {
  clinical: { yjCode: 'YJ0001', medicationNameKey: '外用薬A' },
};

function firstSignal(rawText: string): InboundSignalCandidate {
  const extraction = extractInboundCommunicationSignals({
    communication: {
      sourceChannel: 'mcs',
      senderRole: 'nurse',
      rawText,
      patientLinked: true,
      caseLinked: true,
    },
  });
  const signal = extraction.signals[0];
  if (!signal) throw new Error(`Expected a signal for ${rawText}`);
  return signal;
}

describe('inbound medication stock signal adapter', () => {
  it('maps inbound source metadata into the medication stock external source shape', () => {
    expect(
      mapInboundCommunicationToExternalStockSource({
        sourceChannel: 'phone',
        senderRole: 'care_manager',
        sourceRecordId: 'communication_event_1',
        occurredAtDateKey: '2026-07-07',
      }),
    ).toEqual({
      sourceType: 'communication_event',
      sourceRecordId: 'communication_event_1',
      occurredAtDateKey: '2026-07-07',
      observedByRole: 'care_manager',
    });

    expect(
      mapInboundCommunicationToExternalStockSource({
        sourceChannel: 'manual',
        senderRole: 'pharmacist',
      }),
    ).toMatchObject({
      sourceType: 'manual_pharmacist_review',
      observedByRole: 'pharmacist',
    });
  });

  it('stages remaining quantity reports without writing directly to the ledger', () => {
    const result = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse', occurredAtDateKey: '2026-07-07' },
      sourceRecordId: 'mcs_message_1',
      signal: firstSignal('湿布は残り4枚です'),
      medication,
    });

    expect(result).toMatchObject({
      action: 'stage_for_pharmacist_review',
      observation: {
        source: {
          sourceType: 'mcs',
          sourceRecordId: 'mcs_message_1',
          observedByRole: 'nurse',
        },
        observationKind: 'remaining_quantity',
        observedQuantity: { value: 4, unitKey: '枚' },
      },
      decision: {
        action: 'stage_for_pharmacist_review',
        ledgerWritePolicy: 'never_direct_from_external',
        reviewPriority: 'medium',
        publicSummary: {
          sourceType: 'mcs',
          observationKind: 'remaining_quantity',
          hasMedicationIdentity: true,
          hasObservedQuantity: true,
        },
      },
    });
    if (result.action !== 'stage_for_pharmacist_review') {
      throw new Error('Expected remaining quantity signal to be staged');
    }
    expect(JSON.stringify(result.decision.publicSummary)).not.toContain('mcs_message_1');
  });

  it('builds a deterministic non-PHI staging key for later persistence dedupe', () => {
    const input = {
      communication: {
        sourceChannel: 'mcs',
        senderRole: 'nurse',
        occurredAtDateKey: '2026-07-07',
      },
      sourceRecordId: 'mcs_message_1',
      signal: firstSignal('湿布は残り4枚です'),
    } as const;

    expect(buildInboundMedicationStockSignalStagingKey(input)).toBe(
      'inbound-medication-stock-signal:mcs:mcs_message_1:2026-07-07:medication_stock:observed_quantity:remaining_quantity:4:_',
    );
    expect(buildInboundMedicationStockSignalStagingKey(input)).toBe(
      buildInboundMedicationStockSignalStagingKey(input),
    );
  });

  it('keeps usage delta separate from remaining quantity observations', () => {
    const result = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'phone', senderRole: 'family' },
      sourceRecordId: 'communication_event_1',
      signal: firstSignal('カロナールを夜に2錠飲みました'),
      medication,
    });

    expect(result).toMatchObject({
      action: 'stage_for_pharmacist_review',
      observation: {
        source: {
          sourceType: 'patient_or_family_report',
          observedByRole: 'patient_or_family',
        },
        observationKind: 'prn_usage_report',
        observedQuantity: null,
        usageQuantity: { value: 2, unitKey: '錠' },
      },
      decision: {
        ledgerWritePolicy: 'never_direct_from_external',
      },
    });
  });

  it('stages unquantified low-stock and no-stock reports for pharmacist review', () => {
    const lowStock = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'fax', senderRole: 'facility_staff' },
      signal: firstSignal('軟膏が少ないので補充希望です'),
    });
    const noStock = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'email', senderRole: 'care_manager' },
      signal: firstSignal('湿布がなくなりました'),
      medication,
    });

    expect(lowStock).toMatchObject({
      action: 'stage_for_pharmacist_review',
      observation: {
        source: { sourceType: 'communication_event', observedByRole: 'care_worker' },
        observationKind: 'patient_held_stock',
        observedQuantity: null,
      },
      decision: { reviewPriority: 'medium' },
      warnings: ['medication_identity_missing'],
    });
    expect(noStock).toMatchObject({
      action: 'stage_for_pharmacist_review',
      observation: { observationKind: 'no_stock_observed' },
      decision: { reviewPriority: 'high' },
    });
  });

  it('ignores non-stock inbound signals instead of creating medication stock review work', () => {
    const safetySignal = firstSignal('薬の副作用かもしれない発疹があります');
    const result = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      signal: safetySignal,
    });

    expect(result).toEqual({
      action: 'ignore_non_stock_signal',
      reason: 'not_medication_stock',
      warnings: ['ignored_signal:medication_safety:side_effect_suspected'],
    });
  });

  it('fails closed when an adapter caller passes raw PHI-like payload keys', () => {
    const result = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      signal: firstSignal('湿布は残り4枚です'),
      medication,
      unsafePayloadProbe: {
        raw_text: '湿布は残り4枚です',
      },
    });

    expect(result).toEqual({
      action: 'reject_unsafe_payload',
      reason: 'raw_phi_key_present',
      warnings: ['raw_phi_key_present'],
    });
  });

  it('keeps package-only medication identity staged for review without direct ledger writes', () => {
    const result = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      signal: firstSignal('湿布は残り4枚です'),
      medication: {
        clinical: {},
        package: { gtin: '04987000000001', janCode: '4987000000001' },
      },
    });

    expect(result).toMatchObject({
      action: 'stage_for_pharmacist_review',
      decision: {
        ledgerWritePolicy: 'never_direct_from_external',
        publicSummary: {
          hasMedicationIdentity: true,
        },
      },
      warnings: [
        'medication_equivalence_review_required',
        'package_identity_without_clinical_code',
      ],
    });
    if (result.action !== 'stage_for_pharmacist_review') {
      throw new Error('Expected package-only medication identity to be staged');
    }
    expect(JSON.stringify(result.decision.publicSummary)).not.toContain('04987000000001');
    expect(JSON.stringify(result.decision.publicSummary)).not.toContain('4987000000001');
  });
});
