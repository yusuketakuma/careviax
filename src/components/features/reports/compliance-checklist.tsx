'use client';

import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  PhysicianReportContent,
  CareManagerReportContent,
  AudienceReportContent,
} from '@/types/care-report-content';

export type ReportComplianceCheckItem = {
  key: string;
  label: string;
  passed: boolean;
};

function derivePhysicianChecks(content: PhysicianReportContent): ReportComplianceCheckItem[] {
  return [
    {
      key: 'prescriptions',
      label: '処方内容が記載されている',
      passed: content.prescriptions.length > 0,
    },
    {
      key: 'medication_status',
      label: '服薬状況が記載されている',
      passed:
        !!content.medication_management.compliance_summary?.trim() &&
        content.medication_management.adherence_score > 0,
    },
    {
      key: 'adverse_events',
      label: '有害事象の確認が記載されている',
      passed: content.adverse_events.has_events !== undefined,
    },
    {
      key: 'functional_assessment',
      label: '薬学的機能評価が記載されている',
      passed: !!(
        content.functional_assessment.sleep ||
        content.functional_assessment.cognition ||
        content.functional_assessment.diet_oral
      ),
    },
    {
      key: 'assessment',
      label: '薬学的評価（assessment）が記載されている',
      passed: !!content.assessment?.trim(),
    },
    {
      key: 'plan',
      label: '介入計画（plan）が記載されている',
      passed: !!content.plan?.trim(),
    },
    {
      key: 'physician_communication',
      label: '処方医への連絡事項が記載されている',
      passed: !!content.physician_communication?.trim(),
    },
  ];
}

function deriveCareManagerChecks(content: CareManagerReportContent): ReportComplianceCheckItem[] {
  return [
    {
      key: 'medication_summary',
      label: '服薬管理状況が記載されている',
      passed:
        !!content.medication_management_summary.compliance_summary?.trim() &&
        content.medication_management_summary.total_drugs > 0,
    },
    {
      key: 'functional_impact',
      label: '生活機能への影響が記載されている',
      passed: !!(
        content.functional_impact.sleep_impact ||
        content.functional_impact.cognition_impact ||
        content.functional_impact.diet_impact
      ),
    },
    {
      key: 'residual_status',
      label: '残薬状況が記載されている',
      passed: !!content.residual_status.summary?.trim(),
    },
    {
      key: 'care_coordination',
      label: '介護連携事項が記載されている',
      passed: !!(
        content.care_service_coordination.medication_assistance ||
        content.care_service_coordination.unit_dose_packaging ||
        content.care_service_coordination.calendar_recommendation ||
        content.care_service_coordination.other_items?.trim()
      ),
    },
    {
      key: 'next_plan',
      label: '今後の計画が記載されている',
      passed: !!content.next_visit_plan.date || content.next_visit_plan.followup_items.length > 0,
    },
  ];
}

function deriveAudienceChecks(content: AudienceReportContent): ReportComplianceCheckItem[] {
  return [
    { key: 'summary', label: '今日の要点が記載されている', passed: !!content.summary?.trim() },
    {
      key: 'medication',
      label: '服薬状況が記載されている',
      passed: !!content.medication?.trim(),
    },
    { key: 'residual', label: '残薬状況が記載されている', passed: !!content.residual?.trim() },
    {
      key: 'evaluation',
      label: '薬剤師の評価が記載されている',
      passed: !!content.evaluation?.trim(),
    },
    {
      key: 'requests',
      label: 'お願いしたいことが記載されている',
      passed: !!content.requests?.trim(),
    },
  ];
}

type Props = {
  reportType: string;
  content: PhysicianReportContent | CareManagerReportContent | AudienceReportContent;
  warnings?: string[];
};

export function ComplianceChecklist({ reportType, content, warnings = [] }: Props) {
  const checks = deriveReportComplianceChecks(reportType, content);
  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;
  const allPassed = passedCount === totalCount && warnings.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <span>算定要件チェック</span>
          <span
            className={`text-xs font-normal tabular-nums ${
              allPassed ? 'text-state-done' : 'text-state-confirm'
            }`}
          >
            {passedCount}/{totalCount} 充足
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {checks.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-xs">
              {item.passed ? (
                <CheckCircle2
                  className="mt-0.5 size-3.5 shrink-0 text-state-done"
                  aria-label="充足"
                />
              ) : (
                <AlertCircle
                  className="mt-0.5 size-3.5 shrink-0 text-state-confirm"
                  aria-label="未入力/不足"
                />
              )}
              <span className={item.passed ? 'text-foreground' : 'font-medium text-state-confirm'}>
                {item.label}
              </span>
            </li>
          ))}
        </ul>

        {/* API warnings from auto-generation */}
        {warnings.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-state-confirm">自動生成時の警告</p>
            <ul className="space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <AlertCircle
                    className="mt-0.5 size-3.5 shrink-0 text-state-confirm"
                    aria-hidden="true"
                  />
                  <span className="text-state-confirm">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {allPassed && (
          <p className="mt-3 text-center text-xs font-medium text-state-done">
            全項目充足 — 算定要件を満たしています
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function deriveReportComplianceChecks(
  reportType: string,
  content: PhysicianReportContent | CareManagerReportContent | AudienceReportContent,
): ReportComplianceCheckItem[] {
  if (reportType === 'physician_report') {
    return derivePhysicianChecks(content as PhysicianReportContent);
  }
  if (reportType === 'care_manager_report') {
    return deriveCareManagerChecks(content as CareManagerReportContent);
  }
  if (reportType === 'nurse_share' || reportType === 'facility_handoff') {
    return deriveAudienceChecks(content as AudienceReportContent);
  }
  return [];
}
