import { describe, expect, it } from 'vitest';
import {
  classifyInboundSource,
  hasRawPhiPayloadKeys,
  toPublicInboundCommunicationSummary,
  type InboundCommunicationInput,
} from './inbound-communication';

const baseCommunication = {
  sourceChannel: 'mcs',
  senderRole: 'nurse',
  occurredAtDateKey: '2026-07-07',
  rawText: '湿布は残り4枚です。患者さんは痛みが増えています。',
  normalizedSummary: '湿布残数の報告あり',
  attachmentCount: 1,
  patientLinked: true,
  caseLinked: true,
} satisfies InboundCommunicationInput;

describe('classifyInboundSource', () => {
  it('classifies MCS and phone style sources as external multi-professional input', () => {
    expect(classifyInboundSource({ sourceChannel: 'mcs', senderRole: 'nurse' })).toEqual({
      sourceGroup: 'external_multi_professional',
      requiresReview: true,
      rawTextPermissionRequired: true,
      directWorkflowWriteAllowed: false,
    });
    expect(
      classifyInboundSource({ sourceChannel: 'phone', senderRole: 'care_manager' }),
    ).toMatchObject({
      sourceGroup: 'external_multi_professional',
      directWorkflowWriteAllowed: false,
    });
  });

  it('keeps patient and family reports separate from professional sources', () => {
    expect(
      classifyInboundSource({ sourceChannel: 'patient_family', senderRole: 'family' }),
    ).toMatchObject({
      sourceGroup: 'patient_or_family_reported',
      requiresReview: true,
      directWorkflowWriteAllowed: false,
    });
  });

  it('still requires review for pharmacy-owned manual sources', () => {
    expect(
      classifyInboundSource({ sourceChannel: 'manual', senderRole: 'pharmacist' }),
    ).toMatchObject({
      sourceGroup: 'pharmacy_owned',
      requiresReview: true,
      directWorkflowWriteAllowed: false,
    });
  });
});

describe('toPublicInboundCommunicationSummary', () => {
  it('returns controlled metadata without exposing raw text, sender names, contacts, or source URLs', () => {
    const summary = toPublicInboundCommunicationSummary(baseCommunication);

    expect(summary).toEqual({
      sourceChannel: 'mcs',
      senderRole: 'nurse',
      sourceGroup: 'external_multi_professional',
      occurredAtDateKey: '2026-07-07',
      hasRawText: true,
      rawTextLength: baseCommunication.rawText.length,
      hasSummary: true,
      attachmentCount: 1,
      patientLinked: true,
      caseLinked: true,
      requiresReview: true,
    });
    expect(JSON.stringify(summary)).not.toContain('湿布');
    expect(JSON.stringify(summary)).not.toContain('患者さん');
  });

  it('normalizes negative attachment counts to zero', () => {
    expect(
      toPublicInboundCommunicationSummary({
        ...baseCommunication,
        attachmentCount: -3,
      }).attachmentCount,
    ).toBe(0);
  });
});

describe('hasRawPhiPayloadKeys', () => {
  it('detects raw text and contact-style keys recursively', () => {
    expect(
      hasRawPhiPayloadKeys({
        safe: true,
        nested: {
          source_url: 'https://example.invalid/thread',
        },
      }),
    ).toBe(true);
    expect(
      hasRawPhiPayloadKeys({
        event: {
          senderContact: '090-0000-0000',
        },
      }),
    ).toBe(true);
  });

  it('allows controlled summary-like keys', () => {
    expect(
      hasRawPhiPayloadKeys({
        sourceChannel: 'mcs',
        rawTextLength: 24,
        signalType: 'observed_quantity',
      }),
    ).toBe(false);
  });
});
