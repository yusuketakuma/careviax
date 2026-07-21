import { addUtcDays, japanDayInstantRange, todayUtcRange } from '@/lib/utils/date-boundary';
import type { HomeCareFeatureSummary } from '@/types/home-care';
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
  countHomeCareFacilityClusters,
  countHomeCareHolidayCoverageGaps,
  countTask,
  finalizeHomeCareFeatureSummary,
  hasAnyKeyword,
  toTaskCountMap,
  type DbClient,
} from './home-care-ops-shared';

export async function getHomeCareFeatureSummary(
  db: DbClient,
  args: { orgId: string },
): Promise<HomeCareFeatureSummary> {
  const now = new Date();
  // @db.Date カラム(scheduled_date / businessHoliday.date / pharmacistShift.date)用:
  // JST 業務日の UTC 深夜 sentinel。
  const todayDateOnly = todayUtcRange(now).gte;
  const upcomingWindowDateOnly = addUtcDays(todayDateOnly, 7);
  const shortWindowDateOnly = addUtcDays(todayDateOnly, 3);
  // 実時刻 DateTime カラム(expires_at / expiry_date / refill_next_dispense_date /
  // prescription_expiry_date)用: JST 業務日の開始瞬間。UTC prod で startOfDay を使うと 9h ずれる。
  const todayInstant = japanDayInstantRange(now).gte;
  const upcomingWindowInstant = addUtcDays(todayInstant, 7);

  const activeCases = await db.careCase.findMany({
    where: {
      org_id: args.orgId,
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
        },
      },
    },
  });
  const caseIds = activeCases.map((item) => item.id);
  const patientIds = Array.from(new Set(activeCases.map((item) => item.patient_id)));

  const [
    taskBuckets,
    openSelfReports,
    openIssues,
    currentMedicationCounts,
    upcomingSchedules,
    unresolvedInquiries,
    stalledReports,
    openRequests,
    activeShares,
    firstVisitDocs,
    holidays,
    emergencyShifts,
    sites,
    activeConsents,
    refillIntakes,
    pendingOverrides,
  ] = await Promise.all([
    db.task.groupBy({
      by: ['task_type'],
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_TASK_STATUSES] },
      },
      _count: { id: true },
    }),
    db.patientSelfReport.findMany({
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_SELF_REPORT_STATUSES] },
      },
      select: {
        id: true,
        patient_id: true,
        category: true,
        subject: true,
        content: true,
        requested_callback: true,
      },
    }),
    db.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_ISSUE_STATUSES] },
      },
      select: {
        id: true,
        patient_id: true,
        priority: true,
        category: true,
        title: true,
        description: true,
      },
    }),
    patientIds.length === 0
      ? Promise.resolve([])
      : db.medicationProfile.groupBy({
          by: ['patient_id'],
          where: {
            org_id: args.orgId,
            patient_id: { in: patientIds },
            is_current: true,
          },
          _count: { id: true },
        }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.visitSchedule.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
            scheduled_date: {
              gte: todayDateOnly,
              lte: upcomingWindowDateOnly,
            },
            schedule_status: { in: [...OPEN_SCHEDULE_STATUSES] },
          },
          select: {
            id: true,
            case_id: true,
            scheduled_date: true,
            priority: true,
            visit_type: true,
            carry_items_status: true,
            facility_batch_id: true,
            preparation: {
              select: {
                medication_changes_reviewed: true,
                carry_items_confirmed: true,
                previous_issues_reviewed: true,
                route_confirmed: true,
                offline_synced: true,
              },
            },
            case_: {
              select: {
                patient: {
                  select: {
                    residences: {
                      where: { is_primary: true },
                      take: 1,
                      select: {
                        building_id: true,
                        address: true,
                      },
                    },
                  },
                },
              },
            },
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
            id: true,
            reason: true,
            cycle: {
              select: {
                patient_id: true,
              },
            },
          },
        }),
    db.careReport.findMany({
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_REPORT_STATUSES] },
      },
      select: {
        id: true,
        patient_id: true,
        report_type: true,
      },
    }),
    db.communicationRequest.findMany({
      where: {
        org_id: args.orgId,
        status: { in: [...OPEN_REQUEST_STATUSES] },
      },
      select: {
        id: true,
        patient_id: true,
        status: true,
        request_type: true,
        related_entity_type: true,
        related_entity_id: true,
      },
    }),
    db.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        revoked_at: null,
        expires_at: { gte: todayInstant },
      },
      select: {
        id: true,
        patient_id: true,
        accessed_at: true,
      },
    }),
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            case_id: { in: caseIds },
          },
          select: {
            id: true,
            case_id: true,
          },
        }),
    db.businessHoliday.findMany({
      where: {
        org_id: args.orgId,
        date: {
          gte: todayDateOnly,
          lte: shortWindowDateOnly,
        },
        is_closed: true,
      },
      select: {
        site_id: true,
        date: true,
      },
    }),
    db.pharmacistShift.findMany({
      where: {
        org_id: args.orgId,
        date: {
          gte: todayDateOnly,
          lte: shortWindowDateOnly,
        },
        available: true,
        user: {
          is_active: true,
          can_accept_emergency: true,
        },
      },
      select: {
        site_id: true,
        date: true,
      },
    }),
    db.pharmacySite.findMany({
      where: {
        org_id: args.orgId,
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        is_regional_support: true,
        is_health_support_pharmacy: true,
      },
    }),
    patientIds.length === 0
      ? Promise.resolve([])
      : db.consentRecord.findMany({
          where: {
            org_id: args.orgId,
            patient_id: { in: patientIds },
            consent_type: 'visit_medication_management',
            is_active: true,
            revoked_date: null,
            OR: [{ expiry_date: null }, { expiry_date: { gte: todayInstant } }],
          },
          select: {
            patient_id: true,
          },
        }),
    db.prescriptionIntake.findMany({
      where: {
        org_id: args.orgId,
        OR: [
          {
            source_type: 'refill',
            refill_remaining_count: { gt: 0 },
            refill_next_dispense_date: { gte: todayInstant, lte: upcomingWindowInstant },
          },
          {
            prescription_expiry_date: { gte: todayInstant, lte: addUtcDays(todayInstant, 5) },
          },
        ],
      },
      select: {
        id: true,
      },
    }),
    db.visitScheduleOverride.count({
      where: {
        org_id: args.orgId,
        status: 'pending',
      },
    }),
  ]);

  const taskCounts = toTaskCountMap(taskBuckets);
  const consentedPatientIds = new Set(activeConsents.map((item) => item.patient_id));
  const firstVisitCaseIds = new Set(firstVisitDocs.map((item) => item.case_id));
  const sharedPatientIds = new Set(activeShares.map((item) => item.patient_id));
  const polypharmacyCount = currentMedicationCounts.filter((item) => item._count.id >= 6).length;
  const urgentScheduleCount = upcomingSchedules.filter(
    (schedule) => schedule.priority !== 'normal' || schedule.visit_type === 'emergency',
  ).length;
  const preparationPendingCount = upcomingSchedules.filter((schedule) => {
    const preparation = schedule.preparation;
    return !(
      preparation?.medication_changes_reviewed &&
      preparation?.carry_items_confirmed &&
      preparation?.previous_issues_reviewed &&
      preparation?.route_confirmed &&
      preparation?.offline_synced
    );
  }).length;
  const carryFallbackCount = upcomingSchedules.filter((schedule) =>
    ['blocked', 'partial'].includes(schedule.carry_items_status ?? ''),
  ).length;
  const offlinePendingCount = upcomingSchedules.filter(
    (schedule) => !schedule.preparation?.offline_synced,
  ).length;
  const missingEmergencyContactCount = activeCases.filter(
    (careCase) =>
      !careCase.patient.contacts.some(
        (contact) => contact.is_emergency_contact || contact.relation === 'facility_staff',
      ),
  ).length;
  const missingFirstVisitDocumentCount = activeCases.filter(
    (careCase) => !firstVisitCaseIds.has(careCase.id),
  ).length;
  const adherenceSignalCount = openSelfReports.filter((report) =>
    hasAnyKeyword([report.category, report.subject, report.content], ADHERENCE_KEYWORDS),
  ).length;
  const dosageSupportSignalCount = openSelfReports.filter((report) =>
    hasAnyKeyword([report.category, report.subject, report.content], DOSAGE_SUPPORT_KEYWORDS),
  ).length;
  const shareGapCount = activeCases.filter(
    (careCase) => !sharedPatientIds.has(careCase.patient_id),
  ).length;
  const facilityClusterCount = countHomeCareFacilityClusters(upcomingSchedules);
  const consentHuddleCount =
    upcomingSchedules.filter(
      (schedule) =>
        !consentedPatientIds.has(
          activeCases.find((careCase) => careCase.id === schedule.case_id)?.patient_id ?? '',
        ),
    ).length + countTask(taskCounts, 'management_plan_review');
  const holidayGapCount = countHomeCareHolidayCoverageGaps(emergencyShifts, holidays);
  const siteGapCount = sites.filter(
    (site) =>
      site.lat == null ||
      site.lng == null ||
      !site.is_regional_support ||
      !site.is_health_support_pharmacy,
  ).length;
  const changeSignalCount =
    pendingOverrides +
    openSelfReports.filter((report) =>
      hasAnyKeyword([report.category, report.subject, report.content], CHANGE_KEYWORDS),
    ).length;

  const features = [
    buildFeatureState({
      key: 'emergency_medication_playbook',
      count: urgentScheduleCount + carryFallbackCount,
      summary:
        urgentScheduleCount + carryFallbackCount > 0
          ? '緊急度の高い訪問または持参物不足があります。'
          : '緊急訪問の薬剤供給は安定しています。',
      evidence: [
        `緊急/至急訪問 ${urgentScheduleCount}件`,
        `持参物 blocked/partial ${carryFallbackCount}件`,
      ],
      status: urgentScheduleCount + carryFallbackCount > 0 ? 'attention' : 'ready',
    }),
    buildFeatureState({
      key: 'after_hours_rotation_board',
      count: holidayGapCount,
      summary:
        holidayGapCount > 0
          ? '夜間休日の対応空白があります。'
          : '時間外の輪番・当番は埋まっています。',
      evidence: [`休日ギャップ ${holidayGapCount}件`],
      status: holidayGapCount > 0 ? 'blocked' : 'ready',
    }),
    buildFeatureState({
      key: 'home_visit_gap_detection',
      count: countTask(taskCounts, 'visit_demand') + countTask(taskCounts, 'visit_intake_linkage'),
      summary:
        countTask(taskCounts, 'visit_demand') + countTask(taskCounts, 'visit_intake_linkage') > 0
          ? '処方受付から訪問候補までの未接続があります。'
          : '在宅導線の未接続は見つかっていません。',
      evidence: [
        `訪問候補承認 ${countTask(taskCounts, 'visit_demand')}件`,
        `intake連携 ${countTask(taskCounts, 'visit_intake_linkage')}件`,
      ],
    }),
    buildFeatureState({
      key: 'previsit_preparation_pack',
      count: preparationPendingCount,
      summary:
        preparationPendingCount > 0
          ? '訪問前準備が未完了の予定があります。'
          : '訪問前準備は概ね完了しています。',
      evidence: [`準備未完了 ${preparationPendingCount}件`],
    }),
    buildFeatureState({
      key: 'emergency_contact_template',
      count: missingEmergencyContactCount + missingFirstVisitDocumentCount,
      summary:
        missingEmergencyContactCount + missingFirstVisitDocumentCount > 0
          ? '緊急連絡先または初回文書が不足しています。'
          : '緊急連絡先と初回文書は揃っています。',
      evidence: [
        `緊急連絡先不足 ${missingEmergencyContactCount}件`,
        `初回文書不足 ${missingFirstVisitDocumentCount}件`,
      ],
    }),
    buildFeatureState({
      key: 'adherence_residual_triage',
      count: adherenceSignalCount + countTask(taskCounts, 'patient_self_report_followup'),
      summary:
        adherenceSignalCount + countTask(taskCounts, 'patient_self_report_followup') > 0
          ? '残薬・飲み忘れ関連の triage が必要です。'
          : 'アドヒアランス由来の triage は落ち着いています。',
      evidence: [
        `自己申告シグナル ${adherenceSignalCount}件`,
        `フォローアップ ${countTask(taskCounts, 'patient_self_report_followup')}件`,
      ],
    }),
    buildFeatureState({
      key: 'medication_safety_prioritizer',
      count: openIssues.length + unresolvedInquiries.length + polypharmacyCount,
      summary:
        openIssues.length + unresolvedInquiries.length + polypharmacyCount > 0
          ? '薬学安全の優先付けが必要です。'
          : '薬学安全上の目立つ滞留はありません。',
      evidence: [
        `薬学的課題 ${openIssues.length}件`,
        `未解決照会 ${unresolvedInquiries.length}件`,
        `多剤患者 ${polypharmacyCount}名`,
      ],
    }),
    buildFeatureState({
      key: 'dosage_form_support',
      count: dosageSupportSignalCount + countTask(taskCounts, 'dosage_form_support'),
      summary:
        dosageSupportSignalCount + countTask(taskCounts, 'dosage_form_support') > 0
          ? '剤形・飲みにくさ支援の候補があります。'
          : '剤形支援の候補は目立っていません。',
      evidence: [
        `自己申告シグナル ${dosageSupportSignalCount}件`,
        `要支援タスク ${countTask(taskCounts, 'dosage_form_support')}件`,
      ],
      status:
        dosageSupportSignalCount + countTask(taskCounts, 'dosage_form_support') > 0
          ? 'monitoring'
          : 'ready',
      severity:
        dosageSupportSignalCount + countTask(taskCounts, 'dosage_form_support') > 0
          ? 'normal'
          : 'low',
    }),
    buildFeatureState({
      key: 'caregiver_self_report_intake',
      count: shareGapCount + openSelfReports.length,
      summary:
        shareGapCount + openSelfReports.length > 0
          ? '家族/施設からの入力導線を強化する余地があります。'
          : 'セルフ報告導線は回っています。',
      evidence: [`共有未展開患者 ${shareGapCount}名`, `自己申告 ${openSelfReports.length}件`],
      status: shareGapCount > 0 ? 'monitoring' : openSelfReports.length > 0 ? 'attention' : 'ready',
    }),
    buildFeatureState({
      key: 'carry_item_fallback',
      count: carryFallbackCount,
      summary:
        carryFallbackCount > 0
          ? '持参物の代替・再確認が必要です。'
          : '持参物の不足は見つかっていません。',
      evidence: [`持参物不足 ${carryFallbackCount}件`],
    }),
    buildFeatureState({
      key: 'multidisciplinary_share_summary',
      count: stalledReports.length + openRequests.length,
      summary:
        stalledReports.length + openRequests.length > 0
          ? '報告送達または連携依頼に滞留があります。'
          : '多職種共有の滞留は少ない状態です。',
      evidence: [`報告滞留 ${stalledReports.length}件`, `連携依頼 ${openRequests.length}件`],
      ...buildMultidisciplinaryShareAction({
        requests: openRequests,
        stalledReportIds: stalledReports.map((report) => report.id),
      }),
    }),
    buildFeatureState({
      key: 'inquiry_workbench',
      count: unresolvedInquiries.length + countTask(taskCounts, 'inquiry_workbench'),
      summary:
        unresolvedInquiries.length + countTask(taskCounts, 'inquiry_workbench') > 0
          ? '疑義照会や処方提案が未解決です。'
          : '疑義照会の滞留はありません。',
      evidence: [
        `未解決照会 ${unresolvedInquiries.length}件`,
        `workbenchタスク ${countTask(taskCounts, 'inquiry_workbench')}件`,
      ],
    }),
    buildFeatureState({
      key: 'facility_batch_tracker',
      count: facilityClusterCount + countTask(taskCounts, 'facility_batch_tracker'),
      summary:
        facilityClusterCount + countTask(taskCounts, 'facility_batch_tracker') > 0
          ? '施設まとめ訪問を束ねる余地があります。'
          : '施設バッチ化の候補は少ない状態です。',
      evidence: [
        `同日施設クラスター ${facilityClusterCount}件`,
        `trackerタスク ${countTask(taskCounts, 'facility_batch_tracker')}件`,
      ],
      status:
        facilityClusterCount + countTask(taskCounts, 'facility_batch_tracker') > 0
          ? 'monitoring'
          : 'ready',
      severity:
        facilityClusterCount + countTask(taskCounts, 'facility_batch_tracker') > 0
          ? 'normal'
          : 'low',
    }),
    buildFeatureState({
      key: 'consent_plan_huddle',
      count: consentHuddleCount,
      summary:
        consentHuddleCount > 0
          ? '同意・計画書起因の訪問前ブロックがあります。'
          : '同意・計画書の前提は満たされています。',
      evidence: [`前提不足 ${consentHuddleCount}件`],
      status: consentHuddleCount > 0 ? 'blocked' : 'ready',
    }),
    buildFeatureState({
      key: 'refill_auto_revisit',
      count: refillIntakes.length,
      summary:
        refillIntakes.length > 0
          ? 'リフィルまたは期限切れ接近から再訪候補を起こせます。'
          : '直近の自動再訪候補はありません。',
      evidence: [`対象 intake ${refillIntakes.length}件`],
    }),
    buildFeatureState({
      key: 'callback_sla_monitor',
      count: countTask(taskCounts, 'visit_contact_followup'),
      summary:
        countTask(taskCounts, 'visit_contact_followup') > 0
          ? '折返し・再架電の SLA が滞留しています。'
          : '再架電の滞留はありません。',
      evidence: [`再架電 ${countTask(taskCounts, 'visit_contact_followup')}件`],
    }),
    buildFeatureState({
      key: 'change_delta_view',
      count: changeSignalCount,
      summary:
        changeSignalCount > 0
          ? '前回からの差分確認が必要な患者や予定があります。'
          : '大きな差分シグナルは出ていません。',
      evidence: [`変更シグナル ${changeSignalCount}件`],
      status: changeSignalCount > 0 ? 'monitoring' : 'ready',
      severity: changeSignalCount > 0 ? 'normal' : 'low',
    }),
    buildFeatureState({
      key: 'billing_blocker_alert',
      count:
        countTask(taskCounts, 'billing_evidence_review') +
        countTask(taskCounts, 'initial_home_visit_assessment') +
        consentHuddleCount,
      summary:
        countTask(taskCounts, 'billing_evidence_review') +
          countTask(taskCounts, 'initial_home_visit_assessment') +
          consentHuddleCount >
        0
          ? '算定前に確認すべき止まっている理由があります。'
          : '算定前に止まっている理由は目立っていません。',
      evidence: [
        `算定レビュー ${countTask(taskCounts, 'billing_evidence_review')}件`,
        `初回算定前確認 ${countTask(taskCounts, 'initial_home_visit_assessment')}件`,
        `前提不足 ${consentHuddleCount}件`,
      ],
    }),
    buildFeatureState({
      key: 'regional_resource_map',
      count: countTask(taskCounts, 'geocode_review') + siteGapCount,
      summary:
        countTask(taskCounts, 'geocode_review') + siteGapCount > 0
          ? '座標や地域連携の補完が必要です。'
          : '地域資源情報は概ね揃っています。',
      evidence: [
        `座標レビュー ${countTask(taskCounts, 'geocode_review')}件`,
        `拠点不足 ${siteGapCount}件`,
      ],
      status: countTask(taskCounts, 'geocode_review') + siteGapCount > 0 ? 'monitoring' : 'ready',
      severity: countTask(taskCounts, 'geocode_review') + siteGapCount > 0 ? 'normal' : 'low',
    }),
    buildFeatureState({
      key: 'mobile_visit_mode',
      count: offlinePendingCount + countTask(taskCounts, 'mobile_visit_mode'),
      summary:
        offlinePendingCount + countTask(taskCounts, 'mobile_visit_mode') > 0
          ? 'オフライン同期か端末準備が未完了です。'
          : 'モバイル訪問の準備は整っています。',
      evidence: [
        `未同期予定 ${offlinePendingCount}件`,
        `モバイル準備 ${countTask(taskCounts, 'mobile_visit_mode')}件`,
      ],
    }),
  ];

  return finalizeHomeCareFeatureSummary(features);
}
