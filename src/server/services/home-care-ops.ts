import { addDays, startOfDay } from 'date-fns';
import { formatDateKey } from '@/lib/date-key';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { listBillingEvidenceBlockers } from '@/server/services/billing-evidence';
import type {
  HomeCareFeatureDefinition,
  HomeCareFeatureKey,
  HomeCareFeatureState,
  HomeCareFeatureStatus,
  HomeCareFeatureSummary,
} from '@/types/home-care';

type DbClient = typeof prisma | Prisma.TransactionClient;

type FeatureTaskCountMap = Record<string, number>;

type HomeCareScheduleResidence = {
  facility_id?: string | null;
  facility_unit_id?: string | null;
  building_id?: string | null;
  address?: string | null;
  unit_name?: string | null;
};

type HomeCareFacilityClusterSchedule = {
  scheduled_date: Date;
  case_: {
    patient: {
      residences: HomeCareScheduleResidence[];
    };
  };
};

type HomeCareCoverageDate = {
  date: Date;
  site_id: string | null;
};

const ACTIVE_CASE_STATUSES = ['assessment', 'active', 'on_hold'] as const;
const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
const OPEN_SELF_REPORT_STATUSES = ['submitted', 'triaged', 'converted_to_task'] as const;
const OPEN_ISSUE_STATUSES = ['open', 'in_progress'] as const;
const OPEN_REPORT_STATUSES = ['draft', 'failed', 'response_waiting'] as const;
const OPEN_REQUEST_STATUSES = ['sent', 'received', 'in_progress', 'escalated'] as const;
const OPEN_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;
const DOSAGE_SUPPORT_KEYWORDS = [
  '飲みにく',
  '飲めない',
  'むせ',
  '嚥下',
  '粉砕',
  '一包化',
  '剤形',
  '貼付',
  '服用しづら',
] as const;
const ADHERENCE_KEYWORDS = [
  '飲み忘れ',
  '残薬',
  '余り',
  '服薬',
  'アドヒアランス',
  '飲めていない',
] as const;
const CHANGE_KEYWORDS = [
  '変更',
  '中止',
  '追加',
  '減量',
  '増量',
  '切替',
  '差分',
  '状態変化',
] as const;

export const HOME_CARE_FEATURE_DEFINITIONS: HomeCareFeatureDefinition[] = [
  {
    key: 'emergency_medication_playbook',
    title: '緊急時薬剤供給プレイブック',
    description: '緊急訪問・急変時に薬剤供給と連絡先を即時に確認します。',
    group: 'emergency',
    action_href: '/schedules',
    action_label: '緊急訪問を確認',
  },
  {
    key: 'after_hours_rotation_board',
    title: '24時間対応・輪番ボード',
    description: '夜間休日の当番と空白日を見える化します。',
    group: 'emergency',
    action_href: '/admin/shifts',
    action_label: '当番体制を確認',
  },
  {
    key: 'home_visit_gap_detection',
    title: '在宅導線ギャップ検知',
    description: '処方受付から訪問候補までの未接続案件を検出します。',
    group: 'continuity',
    action_href: '/workflow',
    action_label: '導線ギャップを確認',
  },
  {
    key: 'previsit_preparation_pack',
    title: '訪問前準備パック',
    description: '前回差分・連絡・課題・持参物を一括で確認します。',
    group: 'preparation',
    action_href: '/schedules',
    action_label: '準備を開く',
  },
  {
    key: 'emergency_contact_template',
    title: '緊急連絡テンプレ',
    description: '緊急連絡先と初回文書の不足を拾います。',
    group: 'communication',
    action_href: '/patients',
    action_label: '連絡先を確認',
  },
  {
    key: 'adherence_residual_triage',
    title: '残薬・飲み忘れ triage',
    description: '自己申告と課題からアドヒアランス異常を先回りします。',
    group: 'safety',
    action_href: '/external',
    action_label: '自己申告を確認',
  },
  {
    key: 'medication_safety_prioritizer',
    title: '薬学安全優先度',
    description: '多剤・疑義・薬学的課題の優先度を出します。',
    group: 'safety',
    action_href: '/workflow',
    action_label: '安全課題を確認',
  },
  {
    key: 'dosage_form_support',
    title: '剤形・服用形態支援',
    description: '飲みにくさや剤形調整候補をまとめます。',
    group: 'safety',
    action_href: '/set',
    action_label: '剤形支援を確認',
  },
  {
    key: 'caregiver_self_report_intake',
    title: '家族・施設セルフ報告',
    description: '外部共有と患者自己申告の流量を確認します。',
    group: 'communication',
    action_href: '/external',
    action_label: '外部共有を確認',
  },
  {
    key: 'carry_item_fallback',
    title: '持参物代替提案',
    description: '持参物 blocked / partial を先に拾います。',
    group: 'preparation',
    action_href: '/schedules',
    action_label: '持参物を確認',
  },
  {
    key: 'multidisciplinary_share_summary',
    title: '多職種共有サマリー',
    description: '報告送達と連携依頼の滞留を減らします。',
    group: 'communication',
    action_href: '/reports',
    action_label: '共有状況を確認',
  },
  {
    key: 'inquiry_workbench',
    title: '疑義照会ワークベンチ',
    description: '未解決の照会・処方提案を集約します。',
    group: 'safety',
    action_href: '/workflow',
    action_label: '照会を確認',
  },
  {
    key: 'facility_batch_tracker',
    title: '施設一括訪問トラッカー',
    description: '同一施設の同日訪問を束ねて管理します。',
    group: 'continuity',
    action_href: '/schedules',
    action_label: '施設訪問を確認',
  },
  {
    key: 'consent_plan_huddle',
    title: '同意・計画書ハドル',
    description: '訪問前の同意・計画書ブロックを見逃しません。',
    group: 'preparation',
    action_href: '/workflow',
    action_label: '前提不足を確認',
  },
  {
    key: 'refill_auto_revisit',
    title: 'リフィル自動再訪',
    description: 'リフィルや期限切れ前の再訪候補を補足します。',
    group: 'continuity',
    action_href: '/workflow',
    action_label: '再訪候補を確認',
  },
  {
    key: 'callback_sla_monitor',
    title: '再架電 SLA',
    description: '折返しと再架電の期限超過を監視します。',
    group: 'communication',
    action_href: '/schedules',
    action_label: '再架電を確認',
  },
  {
    key: 'change_delta_view',
    title: '前回からの差分ビュー',
    description: '直近の変更点だけを抜き出します。',
    group: 'continuity',
    action_href: '/patients',
    action_label: '差分を確認',
  },
  {
    key: 'billing_blocker_alert',
    title: '算定を止めている理由警告',
    description: '訪問前に請求不可の要因を拾います。',
    group: 'preparation',
    action_href: '/billing',
    action_label: '算定根拠を確認',
  },
  {
    key: 'regional_resource_map',
    title: '地域資源マップ',
    description: '拠点・座標・地域連携の不足を検知します。',
    group: 'emergency',
    action_href: '/admin/analytics',
    action_label: '拠点状況を確認',
  },
  {
    key: 'mobile_visit_mode',
    title: 'モバイル訪問モード',
    description: 'オフライン同期と訪問端末準備を監視します。',
    group: 'preparation',
    action_href: '/schedules',
    action_label: '同期状況を確認',
  },
];

function toTaskCountMap(
  grouped: Array<{
    task_type: string;
    _count: { id: number };
  }>,
): FeatureTaskCountMap {
  return grouped.reduce<FeatureTaskCountMap>((acc, row) => {
    acc[row.task_type] = row._count.id;
    return acc;
  }, {});
}

function countTask(taskCounts: FeatureTaskCountMap, taskType: string) {
  return taskCounts[taskType] ?? 0;
}

function hasAnyKeyword(values: Array<string | null | undefined>, keywords: readonly string[]) {
  const text = values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function findDefinition(key: HomeCareFeatureKey) {
  const definition = HOME_CARE_FEATURE_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`HOME_CARE_FEATURE_DEFINITION_NOT_FOUND:${key}`);
  }
  return definition;
}

function buildFeatureState(args: {
  key: HomeCareFeatureKey;
  count: number;
  summary: string;
  evidence?: Array<string | null | undefined>;
  status?: HomeCareFeatureStatus;
  severity?: HomeCareFeatureState['severity'];
  actionHref?: string;
  actionLabel?: string;
}): HomeCareFeatureState {
  const definition = findDefinition(args.key);
  const count = Math.max(args.count, 0);
  const status = args.status ?? (count > 0 ? 'attention' : 'ready');
  const severity =
    args.severity ??
    (status === 'blocked'
      ? 'urgent'
      : status === 'attention'
        ? 'high'
        : status === 'monitoring'
          ? 'normal'
          : 'low');

  return {
    ...definition,
    action_href: args.actionHref ?? definition.action_href,
    action_label: args.actionLabel ?? definition.action_label,
    count,
    status,
    severity,
    summary: args.summary,
    evidence: (args.evidence ?? []).filter((value): value is string => Boolean(value)).slice(0, 3),
  };
}

function buildMultidisciplinaryShareAction(args: {
  requestCount: number;
  stalledReportIds: string[];
  patientId?: string;
}) {
  if (args.requestCount > 0) {
    return {
      actionHref: buildCommunicationRequestsHref({ patientId: args.patientId }),
      actionLabel: '連携依頼を確認',
    };
  }

  if (args.stalledReportIds.length === 1) {
    return {
      actionHref: buildReportHref(args.stalledReportIds[0]),
      actionLabel: '報告書を確認',
    };
  }

  return {};
}

function buildSingleScheduleFocusAction(schedules: Array<{ id: string }>, actionLabel: string) {
  if (schedules.length !== 1) return {};

  return {
    actionHref: buildScheduleFocusHref(schedules[0].id),
    actionLabel,
  };
}

function summarizeTotals(features: HomeCareFeatureState[]): HomeCareFeatureSummary['totals'] {
  return features.reduce(
    (acc, feature) => {
      acc[feature.status] += 1;
      return acc;
    },
    {
      blocked: 0,
      attention: 0,
      monitoring: 0,
      ready: 0,
    } satisfies HomeCareFeatureSummary['totals'],
  );
}

function sortFeatures(features: HomeCareFeatureState[]) {
  const severityRank: Record<HomeCareFeatureState['severity'], number> = {
    urgent: 0,
    high: 1,
    normal: 2,
    low: 3,
  };

  return [...features].sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity];
    if (severityDelta !== 0) return severityDelta;
    if (left.count !== right.count) return right.count - left.count;
    return left.title.localeCompare(right.title, 'ja');
  });
}

export function countHomeCareFacilityClusters(schedules: HomeCareFacilityClusterSchedule[]) {
  const clusterCounts = schedules.reduce<Map<string, number>>((acc, schedule) => {
    const residence = schedule.case_.patient.residences[0] ?? null;
    const locationKey = deriveFacilityLabel(residence) ?? 'unknown';
    const key = `${formatDateKey(schedule.scheduled_date)}:${locationKey}`;
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map());

  return Array.from(clusterCounts.values()).filter((count) => count > 1).length;
}

export function countHomeCareHolidayCoverageGaps(
  emergencyShifts: HomeCareCoverageDate[],
  holidays: HomeCareCoverageDate[],
) {
  const holidayCoverage = new Set(
    emergencyShifts.map((shift) => `${shift.site_id ?? 'org'}:${formatDateKey(shift.date)}`),
  );

  return holidays.filter((holiday) => {
    const key = `${holiday.site_id ?? 'org'}:${formatDateKey(holiday.date)}`;
    return !holidayCoverage.has(key);
  }).length;
}

export function finalizeHomeCareFeatureSummary(
  features: HomeCareFeatureState[],
): HomeCareFeatureSummary {
  const sorted = sortFeatures(features);
  return {
    totals: summarizeTotals(sorted),
    features: sorted,
  };
}

export async function getHomeCareFeatureSummary(
  db: DbClient,
  args: { orgId: string },
): Promise<HomeCareFeatureSummary> {
  const today = startOfDay(new Date());
  const upcomingWindow = addDays(today, 7);
  const shortWindow = addDays(today, 3);

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
              gte: today,
              lte: upcomingWindow,
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
        request_type: true,
      },
    }),
    db.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        revoked_at: null,
        expires_at: { gte: today },
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
          gte: today,
          lte: shortWindow,
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
          gte: today,
          lte: shortWindow,
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
            OR: [{ expiry_date: null }, { expiry_date: { gte: today } }],
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
            refill_next_dispense_date: { gte: today, lte: upcomingWindow },
          },
          {
            prescription_expiry_date: { gte: today, lte: addDays(today, 5) },
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
        requestCount: openRequests.length,
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

export async function getPatientHomeCareFeatureSummary(
  db: DbClient,
  args: { orgId: string; patientId: string },
): Promise<HomeCareFeatureSummary> {
  const today = startOfDay(new Date());
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
            scheduled_date: { gte: today },
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
      select: { id: true },
    }),
    db.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        revoked_at: null,
        expires_at: { gte: today },
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
        OR: [{ expiry_date: null }, { expiry_date: { gte: today } }],
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
        requestCount: requests.length,
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
