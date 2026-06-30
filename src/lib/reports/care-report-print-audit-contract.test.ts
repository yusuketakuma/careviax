import { describe, expect, it } from 'vitest';
import {
  CARE_REPORT_PRINT_AUDIT_INTENTS,
  PRINTABLE_CARE_REPORT_TYPES,
  type PrintableCareReportType,
  careReportPrintAuditRequestSchema,
  careReportPrintAuditResponseSchema,
} from './care-report-print-audit-contract';

function printableContentFor(reportType: PrintableCareReportType) {
  if (reportType === 'physician_report') {
    return {
      patient: { name: '佐藤 花子', birth_date: '1940-01-01', gender: 'F' },
      report_date: '2026-06-19',
      visit_date: '2026-06-18',
      pharmacist_name: '薬剤師 太郎',
      prescriber: { name: '主治医 一郎', institution: '在宅診療所' },
      prescriptions: [
        {
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '1日1回朝食後',
          days: 28,
        },
      ],
      medication_management: {
        compliance_summary: '概ね良好',
        adherence_score: 4,
        self_management: '家族支援あり',
        calendar_used: true,
      },
      adverse_events: { has_events: false, events: [] },
      functional_assessment: {
        sleep: '良好',
        cognition: '変化なし',
        diet_oral: '良好',
        mobility: '杖歩行',
        excretion: '自立',
      },
      residual_medications: [],
      assessment: '服薬継続可能',
      plan: '次回も残薬確認',
      physician_communication: '処方継続で問題ありません',
      warnings: [],
    };
  }
  if (reportType === 'care_manager_report') {
    return {
      patient: { name: '佐藤 花子', birth_date: '1940-01-01' },
      care_manager: { name: '介護 支援', organization: '居宅介護支援事業所' },
      report_date: '2026-06-19',
      visit_date: '2026-06-18',
      pharmacist_name: '薬剤師 太郎',
      medication_management_summary: {
        total_drugs: 4,
        compliance_summary: '概ね良好',
        self_management: '家族支援あり',
        calendar_used: true,
      },
      functional_impact: {
        sleep_impact: '影響なし',
        cognition_impact: '変化なし',
        diet_impact: '良好',
        mobility_impact: '転倒なし',
        excretion_impact: '自立',
      },
      residual_status: { summary: '残薬なし', reduction_proposals: [] },
      care_service_coordination: {
        medication_assistance: '声かけ継続',
        unit_dose_packaging: true,
        calendar_recommendation: true,
        other_items: '特記事項なし',
      },
      next_visit_plan: { followup_items: ['残薬確認'] },
      warnings: [],
    };
  }
  if (
    reportType === 'nurse_share' ||
    reportType === 'facility_handoff' ||
    reportType === 'family_share'
  ) {
    return {
      report_audience:
        reportType === 'nurse_share'
          ? 'visiting_nurse'
          : reportType === 'family_share'
            ? 'family'
            : 'facility',
      patient: { name: '佐藤 花子', birth_date: '1940-01-01' },
      report_date: '2026-06-19',
      visit_date: '2026-06-18',
      pharmacist_name: '薬剤師 太郎',
      summary: '今日の要点',
      medication: '服薬状況',
      residual: '残薬なし',
      evaluation: '安定',
      requests: '継続確認',
      warnings: [],
    };
  }
  return { summary: '印刷本文' };
}

describe('care report print audit contract', () => {
  it('accepts the shared print audit intents', () => {
    for (const intent of CARE_REPORT_PRINT_AUDIT_INTENTS) {
      const payload =
        intent === 'print_requested'
          ? { intent, expected_report_updated_at: '2026-06-18T01:02:03.000Z' }
          : { intent };
      expect(careReportPrintAuditRequestSchema.safeParse(payload).success).toBe(true);
    }
  });

  it('requires a report version for print-requested audits', () => {
    const result = careReportPrintAuditRequestSchema.safeParse({ intent: 'print_requested' });

    expect(result.success).toBe(false);
  });

  it('rejects unknown print audit intents', () => {
    expect(careReportPrintAuditRequestSchema.safeParse({ intent: 'downloaded' }).success).toBe(
      false,
    );
  });

  it('accepts audited printable report responses', () => {
    for (const reportType of PRINTABLE_CARE_REPORT_TYPES) {
      expect(
        careReportPrintAuditResponseSchema.safeParse({
          data: {
            audited: true,
            report: {
              id: 'report_1',
              report_type: reportType,
              updated_at: '2026-06-18T01:02:03.000Z',
              content: printableContentFor(reportType),
            },
          },
        }).success,
      ).toBe(true);
    }
  });

  it('rejects incomplete printable report responses', () => {
    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'physician_report',
          },
        },
      }).success,
    ).toBe(false);

    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'physician_report',
            content: null,
          },
        },
      }).success,
    ).toBe(false);

    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'physician_report',
            content: { summary: '印刷本文' },
          },
        },
      }).success,
    ).toBe(false);

    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'care_manager_report',
            content: { summary: '印刷本文' },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects non-printable report responses', () => {
    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'internal_record',
            content: { summary: '内部記録' },
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects audience report content that does not match the printable report type', () => {
    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'family_share',
            content: { summary: '家族共有向け印刷本文' },
          },
        },
      }).success,
    ).toBe(false);

    expect(
      careReportPrintAuditResponseSchema.safeParse({
        data: {
          audited: true,
          report: {
            id: 'report_1',
            report_type: 'family_share',
            content: {
              ...printableContentFor('family_share'),
              report_audience: 'facility',
            },
          },
        },
      }).success,
    ).toBe(false);
  });
});
