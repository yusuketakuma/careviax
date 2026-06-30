import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { formatUtcDateKey } from '@/lib/date-key';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { getProcessStepKeyForStatus } from '@/lib/prescription/cycle-workspace';
import { careLevelLabels } from '@/lib/patient/home-visit-intake';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
  selectPrimaryCareTeamCase,
} from '@/lib/patient/care-team-contact';
import { buildReportHref } from '@/lib/reports/navigation';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import { buildPatientFoundationSummary } from '@/server/services/patient-detail-foundation';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { buildPatientHref } from '@/lib/patient/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { isVisitCarryItemsStatusBlockingReady } from '@/server/services/visit-preparation-readiness';
import type {
  PatientAttentionKey,
  PatientBoardBlockedReason,
  PatientBoardCard,
  PatientBoardResponse,
  PatientStatusTone,
} from '@/types/patient-board';

/**
 * new_02_patient_list(患者カード一覧)用 BFF。
 * フィルタチップ件数 / 患者カード(状態語彙・危険タグ・工程・自然文)/ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録の集計)を 1 リクエストで賄う
 * 読み取り専用集計(docs/design-gap-analysis-new.md new_02_patient_list)。
 */

const PATIENT_FETCH_LIMIT = 80;
const PATIENT_FILTERED_FETCH_LIMIT = 500;
const BLOCKED_REASONS_LIMIT = 2;

const boardQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  foundation_issue: z
    .enum(['needs_confirmation', 'missing_contact', 'missing_care_team'])
    .optional(),
});

const boardSingleValueQueryNames = [
  'scope',
  'foundation_issue',
] as const satisfies readonly (keyof z.infer<typeof boardQuerySchema>)[];

function findDuplicateBoardQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of boardSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

const ACTIVE_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;

/** 危険タグの表示順(麻薬 → 冷所 → 一包化 → 注意系 → 患者属性)。 */
const SAFETY_TAG_ORDER = [
  'narcotic',
  'cold_storage',
  'unit_dose',
  'half_tablet',
  'crush_prohibited',
  'renal',
  'swallowing',
  'allergy',
];

/** 「対応が必要な順」のソート優先度。 */
const ATTENTION_PRIORITY: Record<PatientAttentionKey, number> = {
  urgent_now: 0,
  wait_release: 1,
  acceptance: 2,
  visit_today: 3,
  external_wait: 4,
  checking: 5,
  reply_wait: 6,
  steady: 7,
  paused: 8,
};

const FOUNDATION_STATUS_PRIORITY: Record<
  NonNullable<PatientBoardCard['foundation_summary']>['status'],
  number
> = {
  missing: 0,
  needs_confirmation: 1,
  ready: 2,
};

/** 現在工程 → 工程ショートカット(「→ 監査へ」等)。 */
const STEP_LINKS: Record<string, { label: string; href: string }> = {
  intake: { label: '取込へ', href: '/prescriptions' },
  entry: { label: '入力へ', href: '/prescriptions' },
  decision: { label: 'カードへ', href: '' }, // href は患者詳細(呼び出し側で補完)
  dispense: { label: '調剤へ', href: '/dispense' },
  audit: { label: '監査へ', href: '/audit' },
  set: { label: 'セットへ', href: '/set' },
  visit: { label: '訪問へ', href: '/visits' },
  report: { label: '報告・共有へ', href: '/reports' },
  billing: { label: '算定チェックへ', href: '/billing' },
};

/** 順調(steady)時の状態自然文。 */
const STEADY_STATUS_TEXT: Record<string, string> = {
  intake: '処方の取込待ち',
  entry: '処方の入力中',
  decision: '処方内容の判断中',
  dispense: '調剤中(通常レーン)',
  audit: '調剤監査の順番待ち',
  set: 'セット作成中(通常レーン)',
  visit: '訪問準備が整っています',
  report: '報告書 作成待ち',
  billing: '報告済み — 算定チェック待ち',
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60_000)));
}

function calculateAge(birthDate: Date, now: Date): number {
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/** allergy_info(Json)が「アレルギーあり」を表すか。空配列/空文字/None 表記は除外。 */
function hasAllergyInfo(value: unknown): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && !['なし', 'none', '無し'].includes(trimmed.toLowerCase());
  }
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function buildOperationSummary(
  patient: PatientQueryRow,
  args: {
    visitToday: boolean;
    visitPrepared: boolean;
    facilityBatchPatientCount: number;
    contactReady: boolean;
  },
): string[] {
  const preference = patient.scheduling_preference;
  const parking =
    preference?.parking_available === true
      ? '駐車場あり'
      : preference?.parking_available === false
        ? '駐車場なし'
        : '駐車未確認';
  const careLevel = preference?.care_level
    ? (careLevelLabels[preference.care_level] ?? preference.care_level)
    : null;

  const visitLabels = args.visitToday
    ? [
        args.facilityBatchPatientCount > 0 ? `施設一括${args.facilityBatchPatientCount}名` : null,
        args.visitPrepared ? '訪問準備済' : '準備未完',
      ]
    : [];

  return [...visitLabels, args.contactReady ? '連絡先あり' : '連絡先未設定', parking, careLevel]
    .filter((item): item is string => Boolean(item))
    .slice(0, 4);
}

type PatientQueryRow = {
  id: string;
  name: string;
  birth_date: Date;
  allergy_info: unknown;
  scheduling_preference: {
    swallowing_route: string | null;
    preferred_contact_name: string | null;
    preferred_contact_phone: string | null;
    visit_before_contact_required: boolean | null;
    parking_available: boolean | null;
    care_level: string | null;
  } | null;
  contacts: Array<{
    is_primary: boolean | null;
    is_emergency_contact: boolean | null;
    phone: string | null;
    email: string | null;
    fax: string | null;
  }>;
  residences: Array<{
    facility_id: string | null;
    building_id: string | null;
  }>;
  lab_observations: Array<{ id: string }>;
  cases: Array<{
    id: string;
    status: string;
    care_team_links: Array<{
      role: string;
      phone: string | null;
      email: string | null;
      fax: string | null;
      is_primary: boolean | null;
    }>;
    care_reports?: Array<{
      id: string;
      status: string;
    }>;
    medication_cycles: Array<{
      id: string;
      overall_status: string;
      exception_status: string | null;
      updated_at: Date;
      prescription_intakes: Array<{
        lines: Array<{
          packaging_instruction_tags: string[];
          dispensing_method: string | null;
        }>;
      }>;
      inquiries: Array<{ inquired_at: Date; resolved_at: Date | null }>;
      dispense_tasks: Array<{
        due_date: Date | null;
        audits: Array<{ result: string }>;
      }>;
      workflow_exceptions: Array<{
        exception_type: string;
        description: string;
        created_at: Date;
      }>;
    }>;
    visit_schedules: Array<{
      id: string;
      scheduled_date: Date;
      time_window_start: Date | null;
      carry_items_status: string | null;
      facility_batch_id: string | null;
      facility_batch: { patient_ids: unknown } | null;
      preparation: {
        prepared_at: Date | null;
        medication_changes_reviewed: boolean;
        carry_items_confirmed: boolean;
        previous_issues_reviewed: boolean;
        route_confirmed: boolean;
        offline_synced: boolean;
      } | null;
    }>;
  }>;
};

type DerivedCard = PatientBoardCard & {
  facility_batch_id: string | null;
  facility_batch_patient_count: number;
};

type NextVisitSchedule = PatientQueryRow['cases'][number]['visit_schedules'][number] | null;

function isVisitPreparationDisplayReady(schedule: NextVisitSchedule): boolean {
  const preparation = schedule?.preparation;
  return Boolean(
    preparation?.prepared_at &&
    preparation.medication_changes_reviewed &&
    preparation.carry_items_confirmed &&
    preparation.previous_issues_reviewed &&
    preparation.route_confirmed &&
    preparation.offline_synced &&
    !isVisitCarryItemsStatusBlockingReady(schedule?.carry_items_status),
  );
}

/** 1 患者 → 患者カード(状態語彙・危険タグ・工程・自然文)導出。 */
function derivePatientBoardCard(patient: PatientQueryRow, now: Date): DerivedCard {
  const todayKey = japanDateKey(now);

  const careCase = selectPrimaryCareTeamCase(patient.cases);
  const cycle = careCase?.medication_cycles[0] ?? null;
  const pendingReport = careCase?.care_reports?.[0] ?? null;
  const nextSchedule = careCase?.visit_schedules[0] ?? null;
  const openException = cycle?.workflow_exceptions[0] ?? null;
  const latestInquiry = cycle?.inquiries[0] ?? null;
  const auditTask = cycle?.dispense_tasks[0] ?? null;
  const latestAuditResult = auditTask?.audits[0]?.result ?? null;
  const auditWaiting =
    cycle != null &&
    ['dispensed', 'audit_pending'].includes(cycle.overall_status) &&
    (latestAuditResult == null || latestAuditResult === 'hold');

  // 危険タグ: 処方行の取扱タグ + 腎機能(eGFR 検査あり) + 嚥下 + アレルギー
  const tagSet = new Set<string>();
  for (const line of cycle?.prescription_intakes[0]?.lines ?? []) {
    for (const tag of line.packaging_instruction_tags) tagSet.add(tag);
    if (line.dispensing_method === 'unit_dose') tagSet.add('unit_dose');
  }
  if (patient.lab_observations.length > 0) tagSet.add('renal');
  if (patient.scheduling_preference?.swallowing_route?.trim()) tagSet.add('swallowing');
  if (hasAllergyInfo(patient.allergy_info)) tagSet.add('allergy');
  const safetyTags = SAFETY_TAG_ORDER.filter((tag) => tagSet.has(tag));

  const hospitalized =
    cycle?.exception_status === 'hospitalized' || openException?.exception_type === 'hospitalized';
  const isFacility = Boolean(
    patient.residences[0]?.facility_id || patient.residences[0]?.building_id,
  );
  const residenceKind = hospitalized ? 'hospital' : isFacility ? 'facility' : 'home';
  const residenceLabel = hospitalized ? '入院中' : isFacility ? '施設' : '在宅';

  const hasNarcotic = tagSet.has('narcotic');
  // @db.Date は UTC 深夜で返るため、日付キー(UTC)とローカル今日キーで突き合わせる
  const visitToday =
    nextSchedule != null && formatUtcDateKey(nextSchedule.scheduled_date) === todayKey;
  const visitPreparationReady = isVisitPreparationDisplayReady(nextSchedule);

  const currentStep = cycle ? getProcessStepKeyForStatus(cycle.overall_status) : null;

  let attention: PatientAttentionKey;
  let statusText: string;
  let tone: PatientStatusTone;
  let link = currentStep ? STEP_LINKS[currentStep] : null;
  let nextVisitLabel: string | null = null;

  if (hospitalized) {
    attention = 'paused';
    statusText = '入院中 — 退院時共同指導の対象';
    tone = 'neutral';
    link = STEP_LINKS.billing;
    nextVisitLabel = '退院連絡待ち';
  } else if (careCase && ['referral_received', 'assessment'].includes(careCase.status)) {
    attention = 'acceptance';
    statusText = '受入の返答待ち — 訪問枠を調整中';
    tone = 'caution';
    link = {
      label: 'スケジュールへ',
      href: nextSchedule ? buildScheduleFocusHref(nextSchedule.id) : '/schedules',
    };
    if (!nextSchedule) nextVisitLabel = '未定(調整中)';
  } else if (!careCase || careCase.status === 'on_hold' || cycle?.overall_status === 'on_hold') {
    attention = 'paused';
    statusText = '休止中 — 再開の判断待ち';
    tone = 'neutral';
    link = null;
  } else if (auditWaiting && (hasNarcotic || auditTask?.due_date != null)) {
    attention = 'urgent_now';
    const dueLabel = auditTask?.due_date ? ` 期限${formatTimeOfDay(auditTask.due_date)}` : '';
    statusText = hasNarcotic
      ? `麻薬監査${dueLabel} — 持参薬が未確定`
      : `調剤監査${dueLabel} — 完了で次工程が動きます`;
    tone = 'critical';
    link = STEP_LINKS.audit;
  } else if (cycle?.overall_status === 'inquiry_resolved') {
    attention = 'wait_release';
    const resolvedAt = latestInquiry?.resolved_at;
    statusText = resolvedAt
      ? `照会回答が届きました(${formatTimeOfDay(resolvedAt)}) — 調剤を再開できます`
      : '照会回答が届きました — 調剤を再開できます';
    tone = 'positive';
    link = STEP_LINKS.dispense;
  } else if (visitToday) {
    attention = 'visit_today';
    statusText = visitPreparationReady
      ? '準備完了 — パケット・ルート・セット✓'
      : '本日訪問 — 出発前チェックを確認';
    tone = 'info';
    link = {
      ...STEP_LINKS.visit,
      href: nextSchedule ? buildScheduleFocusHref(nextSchedule.id) : STEP_LINKS.visit.href,
    };
  } else if (cycle?.overall_status === 'inquiry_pending') {
    attention = 'external_wait';
    const waitingDays = latestInquiry ? daysBetween(latestInquiry.inquired_at, now) : 0;
    statusText =
      waitingDays > 0
        ? `医師回答待ち ${waitingDays}日 — 再照会を検討`
        : '医師回答待ち — 本日照会済み';
    tone = 'external';
    link = null;
  } else if (cycle && ['awaiting_reply', 'report_failed'].includes(cycle.exception_status ?? '')) {
    attention = 'reply_wait';
    const waitingDays = daysBetween(cycle.updated_at, now);
    statusText =
      waitingDays > 0
        ? `報告先の返信待ち ${waitingDays}日 — 再送できます`
        : '報告先の返信待ち — 再送できます';
    tone = 'external';
    link = pendingReport
      ? { ...STEP_LINKS.report, href: buildReportHref(pendingReport.id) }
      : STEP_LINKS.report;
  } else if (openException) {
    attention = 'checking';
    statusText = openException.description;
    tone = 'caution';
  } else {
    attention = 'steady';
    statusText = currentStep ? STEADY_STATUS_TEXT[currentStep] : '進行中の処方サイクルはありません';
    tone = 'neutral';
  }

  const patientHref = buildPatientHref(patient.id);
  if (nextSchedule && link?.href === STEP_LINKS.visit.href) {
    link = { ...link, href: buildScheduleFocusHref(nextSchedule.id) };
  }
  const resolvedLink = link ?? { label: 'カードへ', href: patientHref };
  const linkHref = resolvedLink.href.length > 0 ? resolvedLink.href : patientHref;

  const batchPatientIds = nextSchedule?.facility_batch?.patient_ids;
  const facilityBatchPatientCount = Array.isArray(batchPatientIds) ? batchPatientIds.length : 0;
  const preference = patient.scheduling_preference;
  const contactReadiness = buildPatientContactReadiness({
    contacts: patient.contacts,
    preferredContactName: preference?.preferred_contact_name,
    preferredContactPhone: preference?.preferred_contact_phone,
    visitBeforeContactRequired: preference?.visit_before_contact_required,
  });
  const careTeamReliability = buildCareTeamReliabilitySummary({
    contacts: patient.contacts,
    careTeamLinks: careCase?.care_team_links ?? [],
  });

  const operationSummary = buildOperationSummary(patient, {
    visitToday,
    visitPrepared: visitPreparationReady,
    facilityBatchPatientCount,
    contactReady: contactReadiness.ready,
  });
  const foundationSummary = buildPatientFoundationSummary({
    hasPreferredContact: contactReadiness.ready,
    parkingAvailable: preference?.parking_available,
    careLevel: preference?.care_level,
    visitToday,
    visitPrepared: visitPreparationReady,
    safetyTagCount: safetyTags.length,
    careTeamReliabilityAlertCount: careTeamReliability.alert_count,
  });

  return {
    patient_id: patient.id,
    name: patient.name,
    age: calculateAge(patient.birth_date, now),
    residence_kind: residenceKind,
    residence_label: residenceLabel,
    attention,
    safety_tags: safetyTags,
    next_visit_date: nextSchedule ? formatUtcDateKey(nextSchedule.scheduled_date) : null,
    next_visit_time: nextSchedule?.time_window_start
      ? (timeDateToString(nextSchedule.time_window_start) ?? null)
      : null,
    next_visit_label: nextSchedule ? null : nextVisitLabel,
    current_step: attention === 'paused' || attention === 'acceptance' ? null : currentStep,
    status_text: statusText,
    status_tone: tone,
    operation_summary: operationSummary,
    foundation_summary: foundationSummary,
    foundation_href: `${patientHref}#patient-foundation`,
    link_label: resolvedLink.label,
    link_href: linkHref,
    facility_batch_id: visitToday ? (nextSchedule?.facility_batch_id ?? null) : null,
    facility_batch_patient_count: visitToday ? facilityBatchPatientCount : 0,
  };
}

function compareCards(left: DerivedCard, right: DerivedCard): number {
  const priorityDiff = ATTENTION_PRIORITY[left.attention] - ATTENTION_PRIORITY[right.attention];
  if (priorityDiff !== 0) return priorityDiff;
  const foundationDiff =
    FOUNDATION_STATUS_PRIORITY[left.foundation_summary?.status ?? 'ready'] -
    FOUNDATION_STATUS_PRIORITY[right.foundation_summary?.status ?? 'ready'];
  if (foundationDiff !== 0) return foundationDiff;
  const leftDate = left.next_visit_date ?? '9999-99-99';
  const rightDate = right.next_visit_date ?? '9999-99-99';
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  return left.name.localeCompare(right.name, 'ja');
}

function matchesFoundationIssue(
  card: DerivedCard,
  issue: z.infer<typeof boardQuerySchema>['foundation_issue'],
) {
  if (!issue) return true;
  if (issue === 'needs_confirmation') return card.foundation_summary?.status !== 'ready';
  if (issue === 'missing_contact') {
    return card.foundation_summary?.items.some((item) => item.includes('連絡先')) ?? false;
  }
  if (issue === 'missing_care_team') {
    return card.foundation_summary?.items.some((item) => item.includes('連携先')) ?? false;
  }
  return true;
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const duplicateFieldErrors = findDuplicateBoardQueryParams(searchParams);
    if (duplicateFieldErrors) {
      return validationError('クエリパラメータが不正です', duplicateFieldErrors);
    }

    const parsed = parseSearchParams(boardQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }
    const scope = parsed.data.scope ?? 'mine';
    const foundationIssue = parsed.data.foundation_issue;

    const now = new Date();
    const todayKey = japanDateKey(now);
    // scheduled_date(@db.Date)は UTC 深夜で保存されるため、日本業務日キーの
    // UTC 深夜 Date で比較する(ローカル深夜 setHours(0,0,0,0) では JST で 1 日ずれる)
    const today = utcDateFromLocalKey(todayKey);

    const accessContext: VisitScheduleAccessContext = { userId: ctx.userId, role: ctx.role };
    // 「私の担当」: 担当ケース(主担当/副担当/訪問割当)に絞る。owner/admin は全件(コックピットと同じ規約)。
    const mineCaseWhere =
      scope === 'mine' && !canBypassVisitScheduleAssignmentAccess(accessContext)
        ? (buildCareCaseAssignmentWhere(accessContext) ?? {})
        : {};
    const caseScopeWhere = {
      status: { notIn: ['terminated' as const] },
      ...mineCaseWhere,
    };

    const patientWhere = {
      org_id: ctx.orgId,
      archived_at: null,
      cases: { some: caseScopeWhere },
    };

    const [patients, assignedTotal, auditTasks, openExceptions] = await Promise.all([
      prisma.patient.findMany({
        where: patientWhere,
        orderBy: { name_kana: 'asc' },
        take: foundationIssue ? PATIENT_FILTERED_FETCH_LIMIT : PATIENT_FETCH_LIMIT,
        select: {
          id: true,
          name: true,
          birth_date: true,
          allergy_info: true,
          scheduling_preference: {
            select: {
              swallowing_route: true,
              preferred_contact_name: true,
              preferred_contact_phone: true,
              visit_before_contact_required: true,
              parking_available: true,
              care_level: true,
            },
          },
          contacts: {
            select: {
              is_primary: true,
              is_emergency_contact: true,
              phone: true,
              email: true,
              fax: true,
            },
          },
          residences: {
            where: { is_primary: true },
            take: 1,
            select: {
              facility_id: true,
              building_id: true,
            },
          },
          lab_observations: {
            where: { analyte_code: 'egfr' },
            take: 1,
            select: { id: true },
          },
          cases: {
            where: caseScopeWhere,
            orderBy: { updated_at: 'desc' },
            take: 5,
            select: {
              id: true,
              status: true,
              care_team_links: {
                orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
                select: {
                  role: true,
                  phone: true,
                  email: true,
                  fax: true,
                  is_primary: true,
                },
              },
              care_reports: {
                where: { status: { in: ['response_waiting', 'failed'] } },
                orderBy: { updated_at: 'desc' },
                take: 1,
                select: {
                  id: true,
                  status: true,
                },
              },
              medication_cycles: {
                where: { overall_status: { not: 'cancelled' } },
                orderBy: { updated_at: 'desc' },
                take: 1,
                select: {
                  id: true,
                  overall_status: true,
                  exception_status: true,
                  updated_at: true,
                  prescription_intakes: {
                    orderBy: { created_at: 'desc' },
                    take: 1,
                    select: {
                      lines: {
                        select: {
                          packaging_instruction_tags: true,
                          dispensing_method: true,
                        },
                      },
                    },
                  },
                  inquiries: {
                    orderBy: { inquired_at: 'desc' },
                    take: 1,
                    select: { inquired_at: true, resolved_at: true },
                  },
                  dispense_tasks: {
                    where: { status: 'completed' },
                    orderBy: [{ due_date: 'asc' }],
                    take: 1,
                    select: {
                      due_date: true,
                      audits: {
                        orderBy: { audited_at: 'desc' },
                        take: 1,
                        select: { result: true },
                      },
                    },
                  },
                  workflow_exceptions: {
                    where: { status: 'open' },
                    orderBy: { created_at: 'asc' },
                    take: 1,
                    select: {
                      exception_type: true,
                      description: true,
                      created_at: true,
                    },
                  },
                },
              },
              visit_schedules: {
                where: {
                  scheduled_date: { gte: today },
                  schedule_status: { in: [...ACTIVE_SCHEDULE_STATUSES] },
                },
                orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
                take: 1,
                select: {
                  id: true,
                  scheduled_date: true,
                  time_window_start: true,
                  carry_items_status: true,
                  facility_batch_id: true,
                  facility_batch: { select: { patient_ids: true } },
                  preparation: {
                    select: {
                      prepared_at: true,
                      medication_changes_reviewed: true,
                      carry_items_confirmed: true,
                      previous_issues_reviewed: true,
                      route_confirmed: true,
                      offline_synced: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.patient.count({ where: patientWhere }),
      // 次にやること: 監査待ち(麻薬を最優先)の先頭 1 件
      prisma.dispenseTask.findMany({
        where: { org_id: ctx.orgId, status: 'completed' },
        orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
        take: 10,
        select: {
          due_date: true,
          audits: { orderBy: { audited_at: 'desc' }, take: 1, select: { result: true } },
          cycle: {
            select: {
              case_: { select: { patient: { select: { name: true } } } },
              prescription_intakes: {
                orderBy: { created_at: 'desc' },
                take: 1,
                select: {
                  lines: { select: { packaging_instruction_tags: true } },
                },
              },
            },
          },
        },
      }),
      prisma.workflowException.findMany({
        where: { org_id: ctx.orgId, status: 'open' },
        orderBy: { created_at: 'asc' },
        take: BLOCKED_REASONS_LIMIT,
        select: {
          id: true,
          exception_type: true,
          patient_id: true,
          description: true,
          severity: true,
          created_at: true,
        },
      }),
    ]);

    const cards = patients
      .map((patient) => derivePatientBoardCard(patient as PatientQueryRow, now))
      .filter((card) => matchesFoundationIssue(card, foundationIssue))
      .slice(0, PATIENT_FETCH_LIMIT)
      .sort(compareCards);

    // 本日訪問は対応カテゴリに関わらず「今日訪問がある患者」を数える
    // (今すぐ対応のカードも本日訪問に含まれ得る。例: 麻薬監査待ち × 14:00 訪問)
    const visitTodayCards = cards.filter((card) => card.next_visit_date === todayKey);

    const chipCounts = {
      urgent_now: cards.filter((card) => card.attention === 'urgent_now').length,
      external_wait: cards.filter(
        (card) => card.attention === 'external_wait' || card.attention === 'reply_wait',
      ).length,
      visit_today: visitTodayCards.length,
      paused: cards.filter((card) => card.attention === 'paused').length,
    };

    const facilityBatchSizes = new Map<string, number>();
    let todayVisitCount = 0;
    for (const card of visitTodayCards) {
      if (card.facility_batch_id) {
        facilityBatchSizes.set(card.facility_batch_id, card.facility_batch_patient_count);
      } else {
        todayVisitCount += 1;
      }
    }
    const todayFacilityPatientCount = Array.from(facilityBatchSizes.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

    const auditQueue = auditTasks
      .filter((task) => {
        const latest = task.audits[0] ?? null;
        return latest == null || latest.result === 'hold';
      })
      .map((task) => ({
        patient_name: task.cycle.case_.patient.name,
        due_at: task.due_date?.toISOString() ?? null,
        has_narcotic: (task.cycle.prescription_intakes[0]?.lines ?? []).some((line) =>
          line.packaging_instruction_tags.includes('narcotic'),
        ),
      }))
      .sort((left, right) => {
        if (left.has_narcotic !== right.has_narcotic) return left.has_narcotic ? -1 : 1;
        return (left.due_at ?? '9999').localeCompare(right.due_at ?? '9999');
      });

    const blockedReasons: PatientBoardBlockedReason[] = buildBlockedReasons(openExceptions, now);

    const responseData: PatientBoardResponse = {
      generated_at: now.toISOString(),
      scope,
      assigned_total: assignedTotal,
      // 取得上限で実際に打ち切られたか = 母数 > 取得行数(フィルタ/slice 前の patients)。
      // foundation_issue 等の絞り込みで cards が減るのは truncation ではないため、
      // cards.length ではなく patients.length と比較する(誤検知防止)。
      truncated: assignedTotal > patients.length,
      cards: cards.map((card) => {
        const { facility_batch_id, facility_batch_patient_count, ...publicCard } = card;
        void facility_batch_id;
        void facility_batch_patient_count;
        return publicCard;
      }),
      chip_counts: chipCounts,
      today_facility_patient_count: todayFacilityPatientCount,
      today_visit_count: todayVisitCount,
      safety_tagged_count: cards.filter((card) => card.safety_tags.length > 0).length,
      next_action: auditQueue[0] ?? null,
      blocked_reasons: blockedReasons,
    };

    return success({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
};
