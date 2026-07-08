import { describe, expect, it } from 'vitest';

import { extractInboundCommunicationSignals } from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';

import { stageInboundMedicationStockSignalForReview } from './medication-stock-signal-adapter';
import {
  adaptInboundMedicationStockStagingToRiskFindings,
  adaptMedicationStockSnapshotToRiskFinding,
  type MedicationStockSnapshotRiskInput,
  type MedicationStockStagingRiskContext,
} from './medication-stock-risk-adapter';

const medication = {
  clinical: { yjCode: 'YJ0001', medicationNameKey: '外用薬A' },
};

function medicationStockSignal(rawText: string) {
  const extraction = extractInboundCommunicationSignals({
    communication: {
      sourceChannel: 'mcs',
      senderRole: 'nurse',
      rawText,
      patientLinked: true,
      caseLinked: true,
    },
  });
  const signal = extraction.signals.find(
    (candidate) => candidate.signalDomain === 'medication_stock',
  );
  if (!signal) throw new Error(`Expected medication stock signal for ${rawText}`);
  return signal;
}

describe('medication stock risk adapter', () => {
  const stockSnapshot = (
    overrides: Partial<MedicationStockSnapshotRiskInput> = {},
  ): MedicationStockSnapshotRiskInput => ({
    id: overrides.id ?? 'snapshot_1',
    stock_item_id: overrides.stock_item_id ?? 'stock_item_1',
    patient_id: overrides.patient_id ?? 'patient_1',
    case_id: overrides.case_id ?? 'case_1',
    stock_risk_level: overrides.stock_risk_level ?? 'urgent',
    estimated_stockout_date:
      overrides.estimated_stockout_date ?? new Date('2026-07-08T00:00:00.000Z'),
    days_until_stockout: overrides.days_until_stockout ?? 0,
    calculated_at: overrides.calculated_at ?? new Date('2026-07-07T01:00:00.000Z'),
  });

  it('creates a controlled medication stock snapshot finding for urgent stock risk', () => {
    const finding = adaptMedicationStockSnapshotToRiskFinding(stockSnapshot(), {
      patientId: 'patient_1',
      caseId: 'case_1',
      patientHref: '/patients/patient_1',
    });

    expect(finding).toMatchObject({
      key: 'medication_stock:medication_stock_urgent_shortage:stock_item:stock_item_1',
      domain: 'medication',
      severity: 'urgent',
      title: '外用・頓服の不足リスクがあります',
      detail:
        '残数台帳で外用薬・頓服薬の不足または不足見込みが検出されています。薬剤師が確認し、必要なら補充・連絡・次アクションへ反映してください。',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'medication_stock_item',
      related_entity_id: 'stock_item_1',
      due_at: '2026-07-08T00:00:00.000Z',
      action_href: '/patients/patient_1#medication-stock-events',
      action_label: '残数台帳を確認',
      resolution_state: 'open',
      source: 'computed',
    });
  });

  it('uses warning severity for shortage_expected without changing the bridge key code', () => {
    const finding = adaptMedicationStockSnapshotToRiskFinding(
      stockSnapshot({
        stock_item_id: 'stock_item_expected',
        stock_risk_level: 'shortage_expected',
      }),
      { patientId: 'patient_1', caseId: 'case_1' },
    );

    expect(finding).toMatchObject({
      key: 'medication_stock:medication_stock_urgent_shortage:stock_item:stock_item_expected',
      severity: 'warning',
      action_href: '/patients/patient_1#medication-stock-events',
    });
  });

  it('does not create stock snapshot findings for non-shortage levels', () => {
    for (const stockRiskLevel of ['ok', 'watch', 'unknown'] as const) {
      expect(
        adaptMedicationStockSnapshotToRiskFinding(
          stockSnapshot({ stock_risk_level: stockRiskLevel }),
          { patientId: 'patient_1', caseId: 'case_1' },
        ),
      ).toBeNull();
    }
  });

  it('keeps patient, drug, quantity, unit, raw reason, and idempotency material out of snapshot findings', () => {
    const hostile = {
      ...stockSnapshot({ stock_item_id: 'stock_item_1' }),
      patient_name: '山田太郎',
      drug_name: '湿布',
      current_quantity: '4',
      unit: 'sheet',
      raw_reason: '訪問看護師の本文',
      idempotency_key_hash: 'idempotency_secret',
      request_fingerprint_hash: 'fingerprint_secret',
    } satisfies MedicationStockSnapshotRiskInput & Record<string, unknown>;

    const finding = adaptMedicationStockSnapshotToRiskFinding(hostile, {
      patientId: 'patient_1',
      caseId: 'case_1',
      patientHref: '/patients/patient_1',
    });

    const serialized = JSON.stringify(finding);
    expect(serialized).not.toContain('山田太郎');
    expect(serialized).not.toContain('湿布');
    expect(serialized).not.toContain('sheet');
    expect(serialized).not.toContain('訪問看護師');
    expect(serialized).not.toContain('idempotency_secret');
    expect(serialized).not.toContain('fingerprint_secret');
  });

  it('creates a controlled review finding for external remaining quantity reports', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse', occurredAtDateKey: '2026-07-07' },
      sourceRecordId: 'mcs_message_1',
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication,
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
      caseId: 'case_1',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      domain: 'medication',
      severity: 'warning',
      title: '外用・頓服の残数報告を確認してください',
      detail:
        '他職種から、外用薬・頓服薬の残数に関する報告があります。薬剤師確認後に残数台帳へ反映してください。',
      patient_id: 'patient_1',
      case_id: 'case_1',
      related_entity_type: 'inbound_medication_stock_signal',
      related_entity_id: null,
      action_href: '/patients/patient_1#medication-stock-events',
      action_label: '残数報告を確認',
      resolution_state: 'open',
      source: 'external',
    });
    expect(findings[0]?.key).toMatch(
      /^medication_stock:medication_stock_external_observation_review_required:h[a-z0-9]+$/,
    );
  });

  it('creates an urgent controlled finding for no-stock reports', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'email', senderRole: 'care_manager' },
      sourceRecordId: 'communication_event_1',
      signal: medicationStockSignal('湿布がなくなりました'),
      medication,
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'urgent',
      title: '外用・頓服の不足報告があります',
      action_label: '不足報告を確認',
    });
    expect(findings[0]?.key).toContain('medication_stock_urgent_shortage');
  });

  it('treats zero remaining quantity as urgent even when the signal is an observation', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse', occurredAtDateKey: '2026-07-07' },
      sourceRecordId: 'mcs_message_zero_1',
      signal: medicationStockSignal('湿布は残り0枚です'),
      medication,
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'urgent',
      title: '外用・頓服の不足報告があります',
      action_label: '不足報告を確認',
    });
    expect(findings[0]?.key).toContain('medication_stock_urgent_shortage');
  });

  it('keeps usage reports distinct from remaining quantity review findings', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'phone', senderRole: 'family' },
      sourceRecordId: 'communication_event_1',
      signal: medicationStockSignal('カロナールを夜に2錠飲みました'),
      medication,
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      title: '外用・頓服の使用量報告を確認してください',
      action_label: '使用量報告を確認',
    });
    expect(findings[0]?.key).toContain('medication_stock_usage_report_review_required');
  });

  it('adds a separate controlled finding when medication identity needs pharmacist review', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      sourceRecordId: 'mcs_message_1',
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication: {
        clinical: {},
        package: { gtin: '04987000000001', janCode: '4987000000001' },
      },
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.title)).toEqual([
      '外用・頓服の残数報告を確認してください',
      '外用・頓服報告の薬剤名寄せ確認が必要です',
    ]);

    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('04987000000001');
    expect(serialized).not.toContain('4987000000001');
    expect(serialized).not.toContain('湿布');
    expect(serialized).not.toContain('mcs_message_1');
  });

  it('uses source and quantity only as hashed key material so distinct reports do not collapse', () => {
    const first = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse', occurredAtDateKey: '2026-07-07' },
      sourceRecordId: 'mcs_message_1',
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication,
    });
    const second = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse', occurredAtDateKey: '2026-07-07' },
      sourceRecordId: 'mcs_message_2',
      signal: medicationStockSignal('湿布は残り5枚です'),
      medication,
    });

    const firstFinding = adaptInboundMedicationStockStagingToRiskFindings(first, {
      patientId: 'patient_1',
    })[0];
    const secondFinding = adaptInboundMedicationStockStagingToRiskFindings(second, {
      patientId: 'patient_1',
    })[0];

    expect(firstFinding?.key).toMatch(
      /^medication_stock:medication_stock_external_observation_review_required:h[0-9a-f]{16}$/,
    );
    expect(secondFinding?.key).toMatch(
      /^medication_stock:medication_stock_external_observation_review_required:h[0-9a-f]{16}$/,
    );
    expect(firstFinding?.key).not.toBe(secondFinding?.key);

    const serialized = JSON.stringify([firstFinding, secondFinding]);
    expect(serialized).not.toContain('mcs_message_1');
    expect(serialized).not.toContain('mcs_message_2');
    expect(serialized).not.toContain('4枚');
    expect(serialized).not.toContain('5枚');
    expect(serialized).not.toContain('湿布');
  });

  it('does not describe pharmacist-owned manual observations as external reports', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'manual', senderRole: 'pharmacist' },
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication,
    });

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, {
      patientId: 'patient_1',
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      source: 'manual',
      detail:
        '薬局内で、外用薬・頓服薬の残数に関する報告があります。薬剤師確認後に残数台帳へ反映してください。',
    });
    expect(findings[0]?.detail).not.toContain('他職種');
    expect(findings[0]?.detail).not.toContain('患者または家族');
  });

  it('ignores hostile caller-supplied hrefs and identifiers outside the public context contract', () => {
    const staged = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      sourceRecordId: 'mcs_message_patient_taro_1',
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication,
    });
    const hostileContext = {
      patientId: 'patient_1',
      actionHref: '/patients/patient_1?patient_name=山田太郎&raw_text=湿布は残り4枚です',
      relatedEntityId: 'mcs_message_patient_taro_1',
      riskKeySeed: '湿布:4枚:mcs_message_patient_taro_1:04987000000001',
    } satisfies MedicationStockStagingRiskContext & Record<string, unknown>;

    const findings = adaptInboundMedicationStockStagingToRiskFindings(staged, hostileContext);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      related_entity_id: null,
      action_href: '/patients/patient_1#medication-stock-events',
    });

    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('patient_name');
    expect(serialized).not.toContain('raw_text');
    expect(serialized).not.toContain('山田太郎');
    expect(serialized).not.toContain('湿布');
    expect(serialized).not.toContain('4枚');
    expect(serialized).not.toContain('mcs_message_patient_taro_1');
    expect(serialized).not.toContain('04987000000001');
  });

  it('does not create risk findings for ignored or unsafe payload results', () => {
    const safetySignal = extractInboundCommunicationSignals({
      communication: {
        sourceChannel: 'mcs',
        senderRole: 'nurse',
        rawText: '薬の副作用かもしれない発疹があります',
        patientLinked: true,
        caseLinked: true,
      },
    }).signals[0];
    if (!safetySignal) throw new Error('Expected a safety signal');

    const ignored = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      signal: safetySignal,
    });
    const unsafe = stageInboundMedicationStockSignalForReview({
      communication: { sourceChannel: 'mcs', senderRole: 'nurse' },
      signal: medicationStockSignal('湿布は残り4枚です'),
      medication,
      unsafePayloadProbe: { raw_text: '湿布は残り4枚です' },
    });

    expect(adaptInboundMedicationStockStagingToRiskFindings(ignored)).toEqual([]);
    expect(adaptInboundMedicationStockStagingToRiskFindings(unsafe)).toEqual([]);
  });
});
