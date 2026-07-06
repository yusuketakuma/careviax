import { describe, expect, it } from 'vitest';
import {
  decideInboundSignalReviewAction,
  extractInboundCommunicationSignals,
  toPublicInboundSignalSummary,
} from './inbound-signal-classifier';
import type { InboundCommunicationInput } from './inbound-communication';

function communication(
  overrides: Partial<InboundCommunicationInput> = {},
): InboundCommunicationInput {
  return {
    sourceChannel: 'mcs',
    senderRole: 'nurse',
    rawText: '',
    patientLinked: true,
    caseLinked: true,
    ...overrides,
  };
}

describe('extractInboundCommunicationSignals', () => {
  it('classifies "remaining N" text as an observed quantity, not a usage delta', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({ rawText: '訪問看護師より、湿布は残り4枚です。' }),
    });

    expect(result.action).toBe('signals_extracted');
    expect(result.signals).toEqual([
      expect.objectContaining({
        signalDomain: 'medication_stock',
        signalType: 'observed_quantity',
        extractedQuantity: 4,
        extractedUnit: '枚',
        quantityEffect: 'observed_absolute',
        sourceConfidence: 'text_parsed_high',
        evidenceCode: 'remaining_quantity_expression',
        requiresPharmacistReview: true,
      }),
    ]);
    expect(result.signals).not.toEqual([
      expect.objectContaining({
        signalType: 'usage_delta',
      }),
    ]);
  });

  it('classifies "used N" text as a usage delta, not an observed remaining quantity', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({ rawText: '昨夜カロナールを2錠使用しました。' }),
    });

    expect(result.action).toBe('signals_extracted');
    expect(result.signals).toEqual([
      expect.objectContaining({
        signalDomain: 'medication_stock',
        signalType: 'usage_delta',
        extractedQuantity: 2,
        extractedUnit: '錠',
        quantityEffect: 'decrease',
        sourceConfidence: 'text_parsed_high',
        evidenceCode: 'usage_delta_expression',
      }),
    ]);
  });

  it('turns unquantified low-stock reports into record-only style stock signals', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({ rawText: '軟膏が少ないので補充してほしいです。' }),
    });

    expect(result.action).toBe('signals_extracted');
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        signalDomain: 'medication_stock',
        signalType: 'low_stock_text',
        sourceConfidence: 'text_parsed_low',
      }),
    );
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        signalType: 'refill_request',
      }),
    );
  });

  it('extracts patient safety and schedule signals without exposing raw text in public summaries', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({
        rawText: '副作用かもしれない発疹があります。至急、早めに来てください。',
      }),
    });

    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalDomain: 'medication_safety',
          signalType: 'side_effect_suspected',
        }),
        expect.objectContaining({ signalDomain: 'schedule', signalType: 'visit_request' }),
        expect.objectContaining({ signalDomain: 'urgent', signalType: 'urgent_review_required' }),
      ]),
    );

    const publicSummary = result.signals.map(toPublicInboundSignalSummary);
    expect(JSON.stringify(publicSummary)).not.toContain('発疹');
    expect(JSON.stringify(publicSummary)).not.toContain('来てください');
  });

  it('rejects unsafe raw payload probes before extracting signals', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({ rawText: '湿布は残り4枚です。' }),
      unsafePayloadProbe: {
        raw_payload: {
          body: 'raw MCS body',
        },
      },
    });

    expect(result).toEqual({
      action: 'reject_unsafe_payload',
      signals: [],
      warnings: ['raw_phi_key_present'],
    });
  });

  it('warns when the source cannot be linked to a patient', () => {
    const result = extractInboundCommunicationSignals({
      communication: communication({ rawText: '湿布は残り4枚です。', patientLinked: false }),
    });

    expect(result.action).toBe('signals_extracted');
    expect(result.warnings).toContain('patient_not_linked');
  });
});

describe('decideInboundSignalReviewAction', () => {
  it('keeps auto-apply disabled unless every explicit gate is true', () => {
    const signal = extractInboundCommunicationSignals({
      communication: communication({ rawText: '湿布は残り4枚です。' }),
    }).signals[0];

    expect(
      decideInboundSignalReviewAction({
        signal,
        patientLinked: true,
        caseLinked: true,
        stockItemLinked: true,
        sourceTrusted: true,
        allowAutoApply: false,
      }),
    ).toEqual({
      action: 'proposed',
      reason: 'auto_apply_disabled',
    });

    expect(
      decideInboundSignalReviewAction({
        signal,
        patientLinked: true,
        caseLinked: true,
        stockItemLinked: true,
        sourceTrusted: true,
        allowAutoApply: true,
      }),
    ).toEqual({
      action: 'auto_apply',
      reason: 'auto_apply_conditions_met',
    });
  });

  it('uses record-only for unstructured stock text and proposed for missing linkage', () => {
    const lowStockSignal = extractInboundCommunicationSignals({
      communication: communication({ rawText: '軟膏が少ないです。' }),
    }).signals[0];

    expect(
      decideInboundSignalReviewAction({
        signal: lowStockSignal,
        patientLinked: true,
        caseLinked: true,
        stockItemLinked: true,
      }),
    ).toEqual({
      action: 'record_only',
      reason: 'unstructured_text_only',
    });

    expect(
      decideInboundSignalReviewAction({
        signal: lowStockSignal,
        patientLinked: false,
        caseLinked: true,
      }),
    ).toEqual({
      action: 'proposed',
      reason: 'patient_or_case_not_linked',
    });
  });

  it('rejects unsafe payload decisions and records absent signals only', () => {
    expect(
      decideInboundSignalReviewAction({
        unsafePayload: true,
        patientLinked: true,
      }),
    ).toEqual({
      action: 'reject',
      reason: 'unsafe_payload',
    });

    expect(
      decideInboundSignalReviewAction({
        signal: null,
        patientLinked: true,
      }),
    ).toEqual({
      action: 'record_only',
      reason: 'no_signal',
    });
  });
});
