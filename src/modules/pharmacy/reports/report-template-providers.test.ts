import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportTemplateRegistry, type ReportTemplateType } from '@/core/report/template-registry';
import type { StructuredSoap } from '@/types/structured-soap';
import { createPharmacyReportTemplateProviders } from './report-template-providers';
import {
  buildCareManagerReport,
  buildFacilityReport,
  buildPhysicianReport,
  buildVisitingNurseReport,
} from './report-templates';

const structuredSoap: StructuredSoap = {
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

const sharedContext = {
  patient: { name: '田中 一郎', birth_date: '1940-01-01' },
  visitRecord: { visited_at: '2026-06-14' },
  structuredSoap,
  prescriptionLines,
  residualMedications,
  pharmacistName: '鈴木 薬剤師',
};

describe('createPharmacyReportTemplateProviders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers pharmacy report templates with output policy metadata', () => {
    const providers = createPharmacyReportTemplateProviders();

    expect(providers.map((provider) => provider.templateType)).toEqual([
      'physician_report',
      'care_manager_report',
      'nurse_share',
      'facility_handoff',
    ]);
    expect(providers).toEqual(
      providers.map(() =>
        expect.objectContaining({
          module: 'pharmacy',
          policy: expect.objectContaining({
            requiredPermission: 'canSendCareReport',
            maskingProfile: 'care_report_template_draft',
            auditSurface: 'care_report_generation',
            printable: true,
          }),
        }),
      ),
    );
  });

  it.each<ReportTemplateType>([
    'physician_report',
    'care_manager_report',
    'nurse_share',
    'facility_handoff',
  ])('renders %s with the same content as its pharmacy builder', (templateType) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T01:00:00.000Z'));
    const registry = new ReportTemplateRegistry(createPharmacyReportTemplateProviders());

    const contextByType = {
      physician_report: {
        ...sharedContext,
        patient: { ...sharedContext.patient, gender: 'male' },
        prescriber: { name: '佐藤 医師', organization_name: '在宅クリニック' },
      },
      care_manager_report: {
        ...sharedContext,
        careManager: { name: '高橋 ケアマネ', organization_name: '居宅介護支援事業所' },
      },
      nurse_share: sharedContext,
      facility_handoff: sharedContext,
    } satisfies Record<ReportTemplateType, unknown>;

    const expectedByType = {
      physician_report: buildPhysicianReport(contextByType.physician_report),
      care_manager_report: buildCareManagerReport(contextByType.care_manager_report),
      nurse_share: buildVisitingNurseReport(contextByType.nurse_share),
      facility_handoff: buildFacilityReport(contextByType.facility_handoff),
    } satisfies Record<ReportTemplateType, unknown>;

    expect(registry.render(templateType, contextByType[templateType])).toEqual(
      expectedByType[templateType],
    );
  });
});
