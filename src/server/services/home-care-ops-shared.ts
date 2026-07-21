import { formatDateKey } from '@/lib/date-key';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import type {
  HomeCareFeatureDefinition,
  HomeCareFeatureKey,
  HomeCareFeatureState,
  HomeCareFeatureStatus,
  HomeCareFeatureSummary,
} from '@/types/home-care';

export type DbClient = typeof prisma | Prisma.TransactionClient;

export type FeatureTaskCountMap = Record<string, number>;

export type HomeCareScheduleResidence = {
  facility_id?: string | null;
  facility_unit_id?: string | null;
  building_id?: string | null;
  address?: string | null;
  unit_name?: string | null;
};

export type HomeCareFacilityClusterSchedule = {
  scheduled_date: Date;
  case_: {
    patient: {
      residences: HomeCareScheduleResidence[];
    };
  };
};

export type HomeCareCoverageDate = {
  date: Date;
  site_id: string | null;
};

export const ACTIVE_CASE_STATUSES = ['assessment', 'active', 'on_hold'] as const;
export const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const;
export const OPEN_SELF_REPORT_STATUSES = ['submitted', 'triaged', 'converted_to_task'] as const;
export const OPEN_ISSUE_STATUSES = ['open', 'in_progress'] as const;
export const OPEN_REPORT_STATUSES = ['draft', 'failed', 'response_waiting'] as const;
export const OPEN_REQUEST_STATUSES = ['sent', 'received', 'in_progress', 'escalated'] as const;
export const OPEN_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;
export const DOSAGE_SUPPORT_KEYWORDS = [
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
export const ADHERENCE_KEYWORDS = [
  '飲み忘れ',
  '残薬',
  '余り',
  '服薬',
  'アドヒアランス',
  '飲めていない',
] as const;
export const CHANGE_KEYWORDS = [
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

export function toTaskCountMap(
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

export function countTask(taskCounts: FeatureTaskCountMap, taskType: string) {
  return taskCounts[taskType] ?? 0;
}

export function hasAnyKeyword(
  values: Array<string | null | undefined>,
  keywords: readonly string[],
) {
  const text = values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function findDefinition(key: HomeCareFeatureKey) {
  const definition = HOME_CARE_FEATURE_DEFINITIONS.find((item) => item.key === key);
  if (!definition) {
    throw new Error(`HOME_CARE_FEATURE_DEFINITION_NOT_FOUND:${key}`);
  }
  return definition;
}

export function buildFeatureState(args: {
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

export type MultidisciplinaryShareRequest = {
  id: string;
  request_type?: string | null;
  patient_id?: string | null;
  status?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
};

export function buildMultidisciplinaryShareAction(args: {
  requests: MultidisciplinaryShareRequest[];
  stalledReportIds: string[];
  patientId?: string;
}) {
  if (args.requests.length > 0) {
    if (args.requests.length === 1) {
      const request = args.requests[0];
      return {
        actionHref: buildCommunicationRequestsHref({
          status: request.status ?? null,
          requestType: request.request_type ?? null,
          patientId: request.patient_id ?? args.patientId,
          requestId: request.id,
          relatedEntityType: request.related_entity_type ?? null,
          relatedEntityId: request.related_entity_id ?? null,
        }),
        actionLabel: '連携依頼を確認',
      };
    }

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

export function buildSingleScheduleFocusAction(
  schedules: Array<{ id: string }>,
  actionLabel: string,
) {
  if (schedules.length !== 1) return {};

  return {
    actionHref: buildScheduleFocusHref(schedules[0].id),
    actionLabel,
  };
}

export function summarizeTotals(
  features: HomeCareFeatureState[],
): HomeCareFeatureSummary['totals'] {
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

export function sortFeatures(features: HomeCareFeatureState[]) {
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
