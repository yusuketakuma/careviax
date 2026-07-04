import { describe, expect, it } from 'vitest';
import { structuredSoapInputSchema } from './structured-soap';

describe('structuredSoapInputSchema', () => {
  it('accepts full and partial structured SOAP payloads for backward compatibility', () => {
    expect(structuredSoapInputSchema.safeParse({ subjective: {}, objective: {} }).success).toBe(
      true,
    );
    expect(
      structuredSoapInputSchema.safeParse({
        subjective: { symptom_checks: ['眠気'], free_text: '本人申告あり' },
        objective: {
          medication_status: '服薬継続',
          adherence_score: 4,
          side_effect_checks: ['ふらつきなし'],
          lab_values: { egfr: 45 },
        },
        assessment: { problem_checks: [] },
        plan: { intervention_checks: [], next_visit_date: '2026-06-19' },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed known sections while allowing unknown extension keys', () => {
    expect(
      structuredSoapInputSchema.safeParse({
        objective: 'not-object',
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        objective: { adherence_score: 9 },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        extension_payload: { vendor: 'local' },
      }).success,
    ).toBe(true);
  });

  it('accepts structured special-patient status capture entries', () => {
    const parsed = structuredSoapInputSchema.safeParse({
      special_patient_statuses: [
        {
          status_type: 'home_central_venous_nutrition',
          evidence_summary: '中心静脈栄養法の継続管理を確認',
          set_by: 'user_1',
          set_at: '2026-07-04T00:20:00.000Z',
          valid_from: '2026-07-01',
          valid_to: null,
          local_note: 'optional provenance',
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects malformed special-patient status fields when the known section is present', () => {
    expect(
      structuredSoapInputSchema.safeParse({
        special_patient_statuses: [
          {
            status_type: 'unknown_status',
            evidence_summary: '確認',
            set_at: '2026-07-04T00:20:00.000Z',
            valid_from: '2026-07-01',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        special_patient_statuses: [
          {
            status_type: 'terminal_cancer',
            evidence_summary: '',
            set_at: 'not-a-date',
            valid_from: '2026/07/01',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts optional add-on evidence sections with billing-rule key references', () => {
    const parsed = structuredSoapInputSchema.safeParse({
      narcotic_guidance_evidence: {
        billing_rule_keys: [
          'medical.addition.narcotic',
          'medical.addition.narcotic_online',
          'care.addition.narcotic_management',
        ],
        narcotic_prescription_confirmed: true,
        storage_status_checked: true,
        administration_status_checked: true,
        residual_status_checked: true,
        handling_guidance_provided: true,
        physician_information_provided: true,
        evidence_summary: '麻薬の保管・服薬・残薬・取扱い指導を確認',
        confirmed_at: '2026-07-04T01:10:00.000Z',
        confirmed_by: 'user_1',
        local_provenance: { visit_section: 'narcotic' },
      },
      continuous_narcotic_infusion_evidence: {
        billing_rule_keys: [
          'medical.addition.continuous_narcotic_infusion',
          'care.addition.narcotic_continuous_injection',
        ],
        infusion_device_checked: true,
        administration_status_checked: true,
        storage_status_checked: true,
        adverse_effects_checked: true,
        handling_guidance_provided: true,
        evidence_summary: '持続注射の投与・保管・副作用を確認',
        confirmed_at: '2026-07-04T01:11:00.000Z',
      },
      home_central_venous_nutrition_evidence: {
        billing_rule_keys: [
          'medical.addition.central_venous_nutrition',
          'care.addition.central_venous_nutrition',
        ],
        route_device_checked: true,
        administration_status_checked: true,
        storage_status_checked: true,
        compatibility_or_mixing_change_checked: true,
        complication_signs_checked: true,
        evidence_summary: '中心静脈栄養法の投与・保管・配合変化を確認',
        confirmed_at: '2026-07-04T01:12:00.000Z',
      },
      infant_guidance_evidence: {
        billing_rule_keys: ['medical.addition.infant', 'medical.addition.infant_online'],
        direct_guidance_provided: true,
        caregiver_guidance_provided: true,
        age_basis_confirmed: true,
        evidence_summary: '6歳未満患者への直接指導を確認',
      },
      drug_adherence_evidence: {
        medication_status_reviewed: true,
        adherence_by_drug: [
          {
            drug_master_id: 'drug_1',
            drug_code: 'YJ123',
            drug_name: 'アムロジピン',
            adherence_status: 'partial',
            issue_summary: '朝分の飲み忘れあり',
            intervention_summary: '服薬カレンダーで再指導',
            local_note: 'unknown provenance is allowed',
          },
        ],
        evidence_summary: '薬剤別アドヒアランスを確認',
      },
      qr_residual_reconciliation: {
        performed: true,
        reconciled_at: '2026-07-04T01:13:00.000Z',
        scanner_type: 'qr',
        items: [
          {
            drug_master_id: 'drug_1',
            drug_code: 'YJ123',
            drug_name: 'アムロジピン',
            expected_quantity: 14,
            observed_quantity: 12,
            discrepancy_reason: '2錠飲み忘れ',
          },
        ],
        evidence_summary: 'QR照合で残薬を確認',
      },
      legal_record_flags: {
        visit_date_recorded: true,
        pharmacist_recorded: true,
        prescriber_summary_recorded: true,
        pharmacological_management_recorded: true,
        physician_report_summary_recorded: true,
        interprofessional_share_summary_recorded: true,
        online_medication_info_recorded: true,
        evidence_summary: '薬剤管理指導記録の法定項目を確認',
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects malformed add-on evidence known fields', () => {
    expect(
      structuredSoapInputSchema.safeParse({
        narcotic_guidance_evidence: {
          billing_rule_keys: 'medical.addition.narcotic',
        },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        continuous_narcotic_infusion_evidence: {
          confirmed_at: 'not-a-date-time',
        },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        drug_adherence_evidence: {
          adherence_by_drug: [{ drug_name: '' }],
        },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        qr_residual_reconciliation: {
          reconciled_at: 'not-a-date-time',
          items: [{ drug_name: 'アムロジピン', expected_quantity: -1 }],
        },
      }).success,
    ).toBe(false);
    expect(
      structuredSoapInputSchema.safeParse({
        legal_record_flags: {
          visit_date_recorded: 'yes',
        },
      }).success,
    ).toBe(false);
  });
});
