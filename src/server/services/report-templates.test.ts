import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredSoap } from '@/types/structured-soap';
import {
  buildCareManagerReport,
  buildFacilityReport,
  buildPhysicianReport,
  buildVisitingNurseReport,
} from './report-templates';

const baseSoap: StructuredSoap = {
  subjective: { symptom_checks: ['no_symptoms'], free_text: '本人より変化なし。' },
  objective: {
    medication_status: 'full_compliance',
    adherence_score: 5,
    self_management_ability: 'with_support',
    medication_calendar_used: true,
    side_effect_checks: [],
    functional_assessment: {
      sleep: ['no_issues'],
      cognition: ['no_issues'],
      diet_oral: ['no_issues'],
      mobility: ['no_issues'],
      excretion: ['no_issues'],
    },
    adverse_events: { has_events: false, events: [] },
  },
  assessment: { problem_checks: ['no_issues'], free_text: '服薬管理は安定。' },
  plan: {
    intervention_checks: ['medication_guidance'],
    next_visit_date: '2026-06-29',
    physician_report_items: '処方継続で問題ないと考えます。',
    care_manager_report_items: '服薬カレンダーの見守り継続をお願いします。',
    care_service_coordination: '服薬時の声かけを継続。',
  },
};

const prescriptionLines = [
  {
    drug_name: 'アムロジピン錠5mg',
    dose: '1錠',
    frequency: '朝食後',
    days_supply: 14,
  },
];

const residualMedications = [
  {
    drug_name: '酸化マグネシウム錠330mg',
    remaining_quantity: 8,
    excess_days: 4,
    is_reduction_target: true,
  },
];

describe('report template builders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits ISO date keys so generated drafts render consistently in views and PDFs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 10, 0, 0));

    const physician = buildPhysicianReport({
      patient: { name: '田中 一郎', birth_date: new Date(1940, 0, 1), gender: 'male' },
      visitRecord: { visited_at: new Date(2026, 5, 14, 9, 30, 0) },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      prescriber: { name: '佐藤 医師', organization_name: '在宅クリニック' },
      pharmacistName: '鈴木 薬剤師',
    });

    const careManager = buildCareManagerReport({
      patient: { name: '田中 一郎', birth_date: '1940-01-01' },
      visitRecord: { visited_at: '2026-06-14T09:30:00+09:00' },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      careManager: { name: '高橋 ケアマネ', organization_name: '居宅介護支援事業所' },
      pharmacistName: '鈴木 薬剤師',
    });

    const nurse = buildVisitingNurseReport({
      patient: { name: '田中 一郎', birth_date: new Date(1940, 0, 1) },
      visitRecord: { visited_at: new Date(2026, 5, 14, 9, 30, 0) },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      pharmacistName: '鈴木 薬剤師',
    });

    const facility = buildFacilityReport({
      patient: { name: '田中 一郎', birth_date: '1940-01-01' },
      visitRecord: { visited_at: '2026-06-14T09:30:00+09:00' },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      pharmacistName: '鈴木 薬剤師',
    });

    for (const report of [physician, careManager, nurse, facility]) {
      expect(report.report_date).toBe('2026-06-15');
      expect(report.visit_date).toBe('2026-06-14');
      expect(report.patient.birth_date).toBe('1940-01-01');
    }
  });

  it('keeps submission-critical recipient and medication context in generated professional reports', () => {
    const physician = buildPhysicianReport({
      patient: { name: '田中 一郎', birth_date: '1940-01-01', gender: 'male' },
      visitRecord: { visited_at: '2026-06-14' },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      prescriber: { name: '佐藤 医師', organization_name: '在宅クリニック' },
      pharmacistName: '鈴木 薬剤師',
    });

    const careManager = buildCareManagerReport({
      patient: { name: '田中 一郎', birth_date: '1940-01-01' },
      visitRecord: { visited_at: '2026-06-14' },
      structuredSoap: baseSoap,
      prescriptionLines,
      residualMedications,
      careManager: { name: '高橋 ケアマネ', organization_name: '居宅介護支援事業所' },
      pharmacistName: '鈴木 薬剤師',
    });

    expect(physician.prescriber).toEqual({
      name: '佐藤 医師',
      institution: '在宅クリニック',
    });
    expect(physician.prescriptions).toHaveLength(1);
    expect(physician.physician_communication).toContain('処方継続で問題ない');
    expect(careManager.care_manager).toEqual({
      name: '高橋 ケアマネ',
      organization: '居宅介護支援事業所',
    });
    expect(careManager.residual_status.reduction_proposals).toEqual(['酸化マグネシウム錠330mg']);
  });
});
