import { japanDayInstantRange, todayUtcRange } from '@/lib/utils/date-boundary';
import { buildPatientHref } from '@/lib/patient/navigation';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import type { HomeCareFeatureKey, HomeCareFeatureSummary } from '@/types/home-care';

import {
  ACTIVE_CASE_STATUSES,
  ADHERENCE_KEYWORDS,
  CHANGE_KEYWORDS,
  DOSAGE_SUPPORT_KEYWORDS,
  OPEN_ISSUE_STATUSES,
  OPEN_REPORT_STATUSES,
  OPEN_REQUEST_STATUSES,
  OPEN_SCHEDULE_STATUSES,
  OPEN_SELF_REPORT_STATUSES,
  OPEN_TASK_STATUSES,
  buildFeatureState,
  buildMultidisciplinaryShareAction,
  buildSingleScheduleFocusAction,
  countTask,
  finalizeHomeCareFeatureSummary,
  hasAnyKeyword,
  type DbClient,
  type FeatureTaskCountMap,
} from './home-care-ops-shared';
export {
  HOME_CARE_FEATURE_DEFINITIONS,
  countHomeCareFacilityClusters,
  countHomeCareHolidayCoverageGaps,
  finalizeHomeCareFeatureSummary,
} from './home-care-ops-shared';

export { getHomeCareFeatureSummary } from './home-care-ops-summary';

export async function getPatientHomeCareFeatureSummary(
  db: DbClient,
  args: { orgId: string; patientId: string },
): Promise<HomeCareFeatureSummary> {
  const now = new Date();
  // @db.Date(scheduled_date)用の UTC 深夜 sentinel と、実時刻カラム用の JST 開始瞬間を分ける。
  const todayDateOnly = todayUtcRange(now).gte;
  const todayInstant = japanDayInstantRange(now).gte;
  const activeCases = await db.careCase.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      status: { in: [...ACTIVE_CASE_STATUSES] },
    },
    select: {
      id: true,
      patient_id: true,
      management_plans: {
        where: {
          status: 'approved',
        },
        select: {
          id: true,
          next_review_date: true,
        },
      },
      patient: {
        select: {
          contacts: {
            select: {
              relation: true,
              is_emergency_contact: true,
            },
          },
          medication_profiles: {
            where: { is_current: true },
            select: { id: true },
          },
        },
      },
    },
  });
  const caseIds = activeCases.map((item) => item.id);

  const [
    tasks,
    selfReports,
    issues,
    inquiries,
    upcomingSchedules,
    stalledReports,
    requests,
    shares,
    consents,
    firstVisitDocs,
    billingEvidenceBlockers,
  ] = await Promise.all([
    db.task.findMany({
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_TASK_STATUSES] },
        OR: [
          {
            related_entity_type: 'patient',
            related_entity_id: args.patientId,
          },
          ...(caseIds.length > 0
            ? [
                {
                  related_entity_type: 'case',
                  related_entity_id: { in: caseIds },
                },
              ]
            : []),
        ],
      },
      select: {
        task_type: true,
      },
    }),
    db.patientSelfReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: { in: [...OPEN_SELF_REPORT_STATUSES] },
      },
      select: {
        category: true,
        subject: true,
        content: true,
        requested_callback: true,
      },
    }),
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: { in: [...OPEN_ISSUE_STATUSES] },
      },
      select: {
        category: true,
        title: true,
        description: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.inquiryRecord.findMany({
          where: {
            org_id: args.orgId,
            cycle: {
              case_id: { in: caseIds },
            },
            OR: [{ result: null }, { result: 'pending' }],
          },
          select: {
            reason: true,
          },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
            scheduled_date: { gte: todayDateOnly },
            schedule_status: { in: [...OPEN_SCHEDULE_STATUSES] },
          },
          select: {
            id: true,
            priority: true,
            visit_type: true,
            carry_items_status: true,
            preparation: {
              select: {
                medication_changes_reviewed: true,
                carry_items_confirmed: true,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
              },
            },
          },
        }),
    db.careReport.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: { in: [...OPEN_REPORT_STATUSES] },
      },
      select: { id: true },
    }),
    db.communicationRequest.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        status: { in: [...OPEN_REQUEST_STATUSES] },
      },
      select: {
        id: true,
        patient_id: true,
        status: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    db.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        revoked_at: null,
        expires_at: { gte: todayInstant },
      },
      select: { id: true },
    }),
    db.consentRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        consent_type: 'visit_medication_management',
        is_active: true,
        revoked_date: null,
        OR: [{ expiry_date: null }, { expiry_date: { gte: todayInstant } }],
      },
      select: { id: true },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
          },
          select: { id: true },
        }),
    listBillingEvidenceBlockers(db, {
      orgId: args.orgId,
      patientId: args.patientId,
      limit: 4,
    }),
  ]);

  const taskCounts = tasks.reduce<FeatureTaskCountMap>((acc, task) => {
    acc[task.task_type] = (acc[task.task_type] ?? 0) + 1;
    return acc;
  }, {});

  const missingEmergencyContact =
    activeCases.length > 0 &&
    !activeCases.some((careCase) =>
      careCase.patient.contacts.some(
        (contact) => contact.is_emergency_contact || contact.relation === 'facility_staff',
      ),
    );
  const urgentSchedules = upcomingSchedules.filter(
    (schedule) => schedule.priority !== 'normal' || schedule.visit_type === 'emergency',
  ).length;
  const preparationPendingSchedules = upcomingSchedules.filter((schedule) => {
    const preparation = schedule.preparation;
    return !(
      preparation?.medication_changes_reviewed &&
      preparation?.carry_items_confirmed &&
      preparation?.previous_issues_reviewed &&
      preparation?.route_confirmed &&
      preparation?.offline_synced
    );
  });
  const adherenceSignals = selfReports.filter((report) =>
    hasAnyKeyword([report.category, report.subject, report.content], ADHERENCE_KEYWORDS),
  ).length;
  const dosageSignals = selfReports.filter((report) =>
    hasAnyKeyword([report.category, report.subject, report.content], DOSAGE_SUPPORT_KEYWORDS),
  ).length;
  const changeSignals = selfReports.filter((report) =>
    hasAnyKeyword([report.category, report.subject, report.content], CHANGE_KEYWORDS),
  ).length;
  const carryFallbackSchedules = upcomingSchedules.filter((schedule) =>
    ['blocked', 'partial'].includes(schedule.carry_items_status ?? ''),
  );
  const mobilePendingSchedules = upcomingSchedules.filter(
    (schedule) => !schedule.preparation?.offline_synced,
  );
  const billingEvidenceBlockerCount = billingEvidenceBlockers.reduce(
    (total, item) => total + item.blockers.length,
    0,
  );
  const billingEvidenceReasons = Array.from(
    new Set(
      billingEvidenceBlockers.flatMap((item) => item.blockers.map((blocker) => blocker.reason)),
    ),
  ).slice(0, 2);

  const features = [
    buildFeatureState({
      key: 'emergency_medication_playbook',
      count: urgentSchedules + carryFallbackSchedules.length,
      summary:
        urgentSchedules + carryFallbackSchedules.length > 0
          ? 'この患者では緊急時の薬剤供給確認が必要です。'
          : '緊急供給のシグナルはありません。',
      evidence: [
        `緊急/至急訪問 ${urgentSchedules}件`,
        `持参物不足 ${carryFallbackSchedules.length}件`,
      ],
    }),
    buildFeatureState({
      key: 'after_hours_rotation_board',
      count: 0,
      summary: 'この feature は組織単位で管理します。',
      status: 'monitoring',
      severity: 'low',
    }),
    buildFeatureState({
      key: 'home_visit_gap_detection',
      count: countTask(taskCounts, 'visit_demand') + countTask(taskCounts, 'visit_intake_linkage'),
      summary:
        countTask(taskCounts, 'visit_demand') + countTask(taskCounts, 'visit_intake_linkage') > 0
          ? '訪問導線の未接続があります。'
          : '訪問導線は接続済みです。',
      evidence: [
        `導線ギャップ ${countTask(taskCounts, 'visit_demand') + countTask(taskCounts, 'visit_intake_linkage')}件`,
      ],
    }),
    buildFeatureState({
      key: 'previsit_preparation_pack',
      count: preparationPendingSchedules.length,
      summary:
        preparationPendingSchedules.length > 0
          ? '訪問前準備が未完了です。'
          : '訪問前準備は整っています。',
      evidence: [`準備未完了 ${preparationPendingSchedules.length}件`],
      ...buildSingleScheduleFocusAction(preparationPendingSchedules, '準備を開く'),
    }),
    buildFeatureState({
      key: 'emergency_contact_template',
      count:
        Number(missingEmergencyContact) +
        (firstVisitDocs.length === 0 && activeCases.length > 0 ? 1 : 0),
      summary:
        missingEmergencyContact || (firstVisitDocs.length === 0 && activeCases.length > 0)
          ? '緊急連絡先または初回文書を整備してください。'
          : '緊急連絡先と初回文書はあります。',
      evidence: [
        missingEmergencyContact ? '緊急連絡先が不足しています' : null,
        firstVisitDocs.length === 0 && activeCases.length > 0 ? '初回文書がありません' : null,
      ],
    }),
    buildFeatureState({
      key: 'adherence_residual_triage',
      count: adherenceSignals + selfReports.length,
      summary:
        adherenceSignals + selfReports.length > 0
          ? '残薬・飲み忘れの triage が必要です。'
          : '残薬/飲み忘れのシグナルはありません。',
      evidence: [`自己申告 ${selfReports.length}件`, `アドヒアランス該当 ${adherenceSignals}件`],
    }),
    buildFeatureState({
      key: 'medication_safety_prioritizer',
      count:
        issues.length +
        inquiries.length +
        Number(activeCases[0]?.patient.medication_profiles.length >= 6),
      summary:
        issues.length + inquiries.length > 0
          ? '薬学安全の優先確認があります。'
          : '薬学安全の滞留は少ない状態です。',
      evidence: [`薬学的課題 ${issues.length}件`, `照会 ${inquiries.length}件`],
    }),
    buildFeatureState({
      key: 'dosage_form_support',
      count: dosageSignals + countTask(taskCounts, 'dosage_form_support'),
      summary:
        dosageSignals + countTask(taskCounts, 'dosage_form_support') > 0
          ? '剤形・服用形態支援の候補があります。'
          : '剤形支援の候補は出ていません。',
      evidence: [`シグナル ${dosageSignals}件`],
      status:
        dosageSignals + countTask(taskCounts, 'dosage_form_support') > 0 ? 'monitoring' : 'ready',
      severity: dosageSignals + countTask(taskCounts, 'dosage_form_support') > 0 ? 'normal' : 'low',
    }),
    buildFeatureState({
      key: 'caregiver_self_report_intake',
      count: Number(shares.length === 0 && activeCases.length > 0) + selfReports.length,
      summary:
        shares.length === 0 && activeCases.length > 0
          ? '家族/施設からの入力導線を整備してください。'
          : 'セルフ報告導線は確保されています。',
      evidence: [
        shares.length === 0 && activeCases.length > 0 ? '外部共有リンクなし' : null,
        `自己申告 ${selfReports.length}件`,
      ],
      status:
        shares.length === 0 && activeCases.length > 0
          ? 'monitoring'
          : selfReports.length > 0
            ? 'attention'
            : 'ready',
      ...(shares.length === 0 && activeCases.length > 0
        ? {
            actionHref: buildPatientHref(args.patientId, '/share'),
            actionLabel: '外部共有を確認',
          }
        : {}),
    }),
    buildFeatureState({
      key: 'carry_item_fallback',
      count: carryFallbackSchedules.length,
      summary:
        carryFallbackSchedules.length > 0
          ? '持参物の代替確認が必要です。'
          : '持参物不足はありません。',
      evidence: [`不足 ${carryFallbackSchedules.length}件`],
      ...buildSingleScheduleFocusAction(carryFallbackSchedules, '持参物を確認'),
    }),
    buildFeatureState({
      key: 'multidisciplinary_share_summary',
      count: stalledReports.length + requests.length,
      summary:
        stalledReports.length + requests.length > 0
          ? '多職種共有に滞留があります。'
          : '多職種共有は回っています。',
      evidence: [`報告滞留 ${stalledReports.length}件`, `連携依頼 ${requests.length}件`],
      ...buildMultidisciplinaryShareAction({
        requests,
        stalledReportIds: stalledReports.map((report) => report.id),
        patientId: args.patientId,
      }),
    }),
    buildFeatureState({
      key: 'inquiry_workbench',
      count: inquiries.length + countTask(taskCounts, 'inquiry_workbench'),
      summary:
        inquiries.length + countTask(taskCounts, 'inquiry_workbench') > 0
          ? '疑義照会・処方提案が未解決です。'
          : '疑義照会の滞留はありません。',
      evidence: [`照会 ${inquiries.length}件`],
    }),
    buildFeatureState({
      key: 'facility_batch_tracker',
      count:
        upcomingSchedules.filter((schedule) => schedule.carry_items_status != null).length > 1
          ? 1
          : 0,
      summary: '施設訪問はスケジュール単位で確認できます。',
      status: 'monitoring',
      severity: 'low',
    }),
    buildFeatureState({
      key: 'consent_plan_huddle',
      count:
        Number(consents.length === 0 && activeCases.length > 0) +
        Number(
          activeCases.length > 0 &&
            activeCases.every((careCase) => careCase.management_plans.length === 0),
        ),
      summary:
        consents.length === 0 ||
        activeCases.every((careCase) => careCase.management_plans.length === 0)
          ? '同意または計画書の整備が必要です。'
          : '同意・計画書は整っています。',
      evidence: [
        consents.length === 0 && activeCases.length > 0 ? '有効同意なし' : null,
        activeCases.length > 0 &&
        activeCases.every((careCase) => careCase.management_plans.length === 0)
          ? '承認済み計画書なし'
          : null,
      ],
      status:
        consents.length === 0 ||
        activeCases.every((careCase) => careCase.management_plans.length === 0)
          ? 'blocked'
          : 'ready',
    }),
    buildFeatureState({
      key: 'refill_auto_revisit',
      count: countTask(taskCounts, 'visit_intake_linkage'),
      summary:
        countTask(taskCounts, 'visit_intake_linkage') > 0
          ? '再訪候補の接続が必要です。'
          : '再訪候補は接続済みです。',
      evidence: [`未接続 ${countTask(taskCounts, 'visit_intake_linkage')}件`],
    }),
    buildFeatureState({
      key: 'callback_sla_monitor',
      count: countTask(taskCounts, 'visit_contact_followup'),
      summary:
        countTask(taskCounts, 'visit_contact_followup') > 0
          ? '再架電が必要です。'
          : '再架電滞留はありません。',
      evidence: [`再架電 ${countTask(taskCounts, 'visit_contact_followup')}件`],
    }),
    buildFeatureState({
      key: 'change_delta_view',
      count: changeSignals,
      summary:
        changeSignals > 0 ? '前回からの差分シグナルがあります。' : '差分シグナルはありません。',
      evidence: [`差分シグナル ${changeSignals}件`],
      status: changeSignals > 0 ? 'monitoring' : 'ready',
      severity: changeSignals > 0 ? 'normal' : 'low',
    }),
    buildFeatureState({
      key: 'billing_blocker_alert',
      count:
        billingEvidenceBlockerCount +
        countTask(taskCounts, 'billing_evidence_review') +
        countTask(taskCounts, 'initial_home_visit_assessment'),
      summary:
        billingEvidenceBlockerCount +
          countTask(taskCounts, 'billing_evidence_review') +
          countTask(taskCounts, 'initial_home_visit_assessment') >
        0
          ? '算定前レビューが必要です。'
          : '算定レビューの滞留はありません。',
      evidence: [
        `算定根拠不足 ${billingEvidenceBlockerCount}件`,
        ...billingEvidenceReasons,
        `レビュー ${countTask(taskCounts, 'billing_evidence_review')}件`,
        `初回算定前確認 ${countTask(taskCounts, 'initial_home_visit_assessment')}件`,
      ],
    }),
    buildFeatureState({
      key: 'regional_resource_map',
      count: 0,
      summary: 'この feature は組織単位で管理します。',
      status: 'monitoring',
      severity: 'low',
    }),
    buildFeatureState({
      key: 'mobile_visit_mode',
      count: mobilePendingSchedules.length + countTask(taskCounts, 'mobile_visit_mode'),
      summary:
        mobilePendingSchedules.length + countTask(taskCounts, 'mobile_visit_mode') > 0
          ? 'オフライン同期または端末準備が未完了です。'
          : 'モバイル訪問準備は整っています。',
      evidence: [`未同期 ${mobilePendingSchedules.length}件`],
      ...buildSingleScheduleFocusAction(mobilePendingSchedules, '同期状況を確認'),
    }),
  ];

  return finalizeHomeCareFeatureSummary(features);
}

export function selectScheduleHomeCareFeatureHighlights(summary: HomeCareFeatureSummary) {
  const scheduleKeys = new Set<HomeCareFeatureKey>([
    'emergency_medication_playbook',
    'previsit_preparation_pack',
    'carry_item_fallback',
    'consent_plan_huddle',
    'callback_sla_monitor',
    'change_delta_view',
    'billing_blocker_alert',
    'mobile_visit_mode',
  ]);

  return summary.features.filter((feature) => scheduleKeys.has(feature.key));
}
