import type { VisitPreparationSourceStatus } from '@/components/features/visits/visit-medication-management-section';
import type { VisitReportReadinessItem } from '@/components/features/visits/visit-report-readiness-panel';
import {
  buildHomeVisit2026ReadinessItems,
  isHomeVisit2026CompletionOutcome,
} from '@/lib/visits/home-visit-2026-evidence';
import type { VisitGeoLog } from '@/lib/visit-location';
import type { StructuredSoap } from '@/types/structured-soap';
import { getVisitReceiptReadiness } from './visit-record-form.shared';
import type { FormValues } from './visit-record-form-model';

export function buildVisitRecordReadiness({
  values,
  structuredSoap,
  visitType,
  selectedAttachmentCount,
  visitGeoLog,
  billingBlockers,
  intakeInitialTransitionExpected,
  preparationSourceStatus,
}: {
  values: FormValues;
  structuredSoap: StructuredSoap;
  visitType: string | undefined;
  selectedAttachmentCount: number;
  visitGeoLog: VisitGeoLog | null;
  billingBlockers: Parameters<typeof buildHomeVisit2026ReadinessItems>[0]['billingBlockers'];
  intakeInitialTransitionExpected: boolean | null;
  preparationSourceStatus: VisitPreparationSourceStatus;
}) {
  const residualMedicationCount = values.residual_medications?.length ?? 0;
  const visitReceiptReadiness = getVisitReceiptReadiness(values);
  const homeVisit2026ReadinessItems = buildHomeVisit2026ReadinessItems({
    structuredSoap,
    visitType,
    residualMedicationCount,
    billingBlockers,
    intakeInitialTransitionExpected,
  });
  const requiredHomeVisit2026Items = homeVisit2026ReadinessItems.filter((item) => item.required);
  const completedHomeVisit2026Count = requiredHomeVisit2026Items.filter((item) => item.done).length;
  const missingHomeVisit2026Items = requiredHomeVisit2026Items.filter((item) => !item.done);
  const isCompletionOutcome = isHomeVisit2026CompletionOutcome(values.outcome_status);
  const visitReportReadinessItems: VisitReportReadinessItem[] = [
    {
      key: 'subjective',
      label: '患者・家族の訴え',
      description: '服薬状況、困りごと、自己申告を S に残します。',
      done: Boolean(
        structuredSoap.subjective.free_text?.trim() ||
        structuredSoap.subjective.symptom_checks.length > 0,
      ),
    },
    {
      key: 'objective',
      label: '客観情報・観察',
      description: '残薬、服薬カレンダー、バイタル、検査値、添付写真を O に残します。',
      done: Boolean(
        structuredSoap.objective.free_text?.trim() ||
        structuredSoap.objective.side_effect_checks.length > 0 ||
        selectedAttachmentCount > 0,
      ),
    },
    {
      key: 'assessment',
      label: '薬学的評価',
      description: '問題点、重症度、薬学的判断を A に残します。',
      done: Boolean(
        structuredSoap.assessment.free_text?.trim() ||
        structuredSoap.assessment.problem_checks.length > 0,
      ),
    },
    {
      key: 'plan',
      label: '介入・次回計画',
      description: '介入内容、次回訪問日、処方提案を P に残します。',
      done: Boolean(
        structuredSoap.plan.free_text?.trim() ||
        structuredSoap.plan.intervention_checks.length > 0 ||
        structuredSoap.plan.next_visit_date,
      ),
    },
    {
      key: 'collaboration',
      label: '他職種へ渡す事項',
      description: '医師向け、ケアマネ向け、介護サービス連携の要点を分けて残します。',
      done: Boolean(
        structuredSoap.plan.physician_report_items?.trim() ||
        structuredSoap.plan.care_manager_report_items?.trim() ||
        structuredSoap.plan.care_service_coordination?.trim(),
      ),
    },
    {
      key: 'receipt',
      label: '受領・現地証跡',
      description: visitReceiptReadiness.hasIdentityInput
        ? visitReceiptReadiness.hasCompleteIdentity
          ? '受領者、続柄、受領日時が揃っています。'
          : `不足: ${visitReceiptReadiness.missingLabels.join(' / ')}`
        : '受領者、位置情報、添付で訪問時の証跡を補強します。',
      done: Boolean(
        visitReceiptReadiness.hasCompleteIdentity || visitGeoLog?.start || visitGeoLog?.end,
      ),
      required: false,
    },
    {
      key: 'medication_management',
      label: '訪問薬剤管理の確認',
      description:
        preparationSourceStatus !== 'ready'
          ? '訪問準備情報が最新でないため、必須項目の判定を保留しています。'
          : missingHomeVisit2026Items.length === 0
            ? '服薬状況、残薬、副作用、連携、該当時の加算根拠が揃っています。'
            : `未確認: ${missingHomeVisit2026Items
                .slice(0, 4)
                .map((item) => item.label)
                .join(' / ')}`,
      done:
        preparationSourceStatus === 'ready' &&
        completedHomeVisit2026Count === requiredHomeVisit2026Items.length,
      required: true,
    },
  ];

  return {
    residualMedicationCount,
    missingHomeVisit2026Items,
    isCompletionOutcome,
    visitReportReadinessItems,
  };
}
