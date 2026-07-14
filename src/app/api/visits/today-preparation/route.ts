import { withAuthContext } from '@/lib/auth/context';
import { unstable_rethrow } from 'next/navigation';
import { internalError, successWithMeasuredJsonPayload } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { formatTimeOfDay } from '@/lib/datetime/time-of-day';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  buildVisitScheduleAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  buildCareTeamReliabilitySummary,
  buildPatientContactReadiness,
} from '@/lib/patient/care-team-contact';
import { getHomeVisitIntake, specialProcedureLabels } from '@/lib/patient/home-visit-intake';
import { buildPatientHref } from '@/lib/patient/navigation';
import { sortPatientSafetyTags } from '@/lib/patient/safety-tags';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';
import { buildVisitRecordHref } from '@/lib/visits/navigation';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import type {
  VisitPrepBlockedReason,
  VisitPrepCheck,
  VisitPreparationBoardResponse,
  VisitPreparationCard,
} from '@/types/visit-preparation-board';

/**
 * new_04_visit(今日の訪問 — 出発前の準備チェック)用 BFF。
 * 当日の訪問予定を準備チェックカード(個別 / 施設一括)へ整形し、
 * 右レール(次にやること / 止まっている理由 / 根拠・記録)も 1 リクエストで賄う
 * 読み取り専用集計(docs/design-gap-analysis-new.md 04_visit)。
 */

const BLOCKED_REASONS_LIMIT = 2;
const VISIT_PREPARATION_BLOCKED_REASON_LABEL = '対応が必要な未解決項目があります';

const ACTIVE_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;

const PROCEDURE_SAFETY_TAG_PREFIX = 'procedure:';
const KNOWN_SPECIAL_PROCEDURE_KEYS = new Set(Object.keys(specialProcedureLabels));

/** セット工程を通過済みの MedicationCycleStatus。 */
const SET_DONE_STATUSES = ['set_audited', 'visit_ready', 'visit_completed', 'reported'];
const SET_IN_PROGRESS_STATUSES = ['audited', 'setting'];

function minutesBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const diff = Math.round((end.getTime() - start.getTime()) / 60_000);
  return diff > 0 ? diff : null;
}

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

type ScheduleQueryRow = {
  id: string;
  time_window_start: Date | null;
  time_window_end: Date | null;
  route_order: number | null;
  pre_visit_checklist_completed: boolean;
  facility_batch_id: string | null;
  facility_batch: {
    id: string;
    facility_id: string;
    patient_ids: unknown;
    estimated_duration: number | null;
  } | null;
  vehicle_resource: { label: string } | null;
  preparation: {
    medication_changes_reviewed: boolean;
    carry_items_confirmed: boolean;
    previous_issues_reviewed: boolean;
    route_confirmed: boolean;
    prepared_at: Date | null;
    updated_at: Date;
  } | null;
  case_: {
    required_visit_support: unknown;
    care_team_links?: Array<{
      role: string;
      is_primary: boolean;
      phone: string | null;
      email: string | null;
      fax: string | null;
    }>;
    patient: {
      id: string;
      name: string;
      allergy_info: unknown;
      contacts?: Array<{
        is_primary: boolean;
        is_emergency_contact: boolean;
        phone: string | null;
        email: string | null;
        fax: string | null;
      }>;
      scheduling_preference: {
        swallowing_route: string | null;
        preferred_contact_name?: string | null;
        preferred_contact_phone?: string | null;
        visit_before_contact_required?: boolean | null;
        parking_available?: boolean | null;
        care_level?: string | null;
      } | null;
    };
  };
  cycle: {
    overall_status: string;
    prescription_intakes: Array<{
      lines: Array<{
        packaging_instruction_tags: string[];
        dispensing_method: string | null;
      }>;
    }>;
    dispense_tasks: Array<{
      due_date: Date | null;
      audits: Array<{ result: string }>;
    }>;
  } | null;
};

function hasActiveInfectionIsolation(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length > 0 && !['なし', '無し', 'none', 'no', 'false', '不要'].includes(normalized)
  );
}

function collectHomeVisitIntakeSafetyTags(schedule: ScheduleQueryRow): string[] {
  const intake = getHomeVisitIntake(schedule.case_.required_visit_support);
  if (!intake) return [];

  const tags = new Set<string>();
  if (intake.narcotics_base === true || intake.narcotics_rescue === true) tags.add('narcotic');
  if (hasActiveInfectionIsolation(intake.infection_isolation)) tags.add('infection_isolation');

  for (const rawProcedure of intake.special_medical_procedures ?? []) {
    const procedureKey = typeof rawProcedure === 'string' ? rawProcedure.trim() : '';
    if (!procedureKey || !KNOWN_SPECIAL_PROCEDURE_KEYS.has(procedureKey)) continue;
    if (procedureKey === 'narcotics' || procedureKey === 'terminal_pain') tags.add('narcotic');
    if (procedureKey !== 'narcotics') tags.add(`${PROCEDURE_SAFETY_TAG_PREFIX}${procedureKey}`);
  }

  return [...tags];
}

function sortSafetyTags(tags: Set<string>): string[] {
  return sortPatientSafetyTags(tags, {
    extraSortedPrefixes: [PROCEDURE_SAFETY_TAG_PREFIX],
  });
}

function collectSafetyTags(schedule: ScheduleQueryRow): Set<string> {
  const tags = new Set<string>();
  for (const line of schedule.cycle?.prescription_intakes[0]?.lines ?? []) {
    for (const tag of line.packaging_instruction_tags) tags.add(tag);
    if (line.dispensing_method === 'unit_dose') tags.add('unit_dose');
  }
  if (hasAllergyInfo(schedule.case_.patient.allergy_info)) tags.add('allergy');
  if (schedule.case_.patient.scheduling_preference?.swallowing_route?.trim()) {
    tags.add('swallowing');
  }
  for (const tag of collectHomeVisitIntakeSafetyTags(schedule)) tags.add(tag);
  return tags;
}

function collectFoundationGapLabels(schedule: ScheduleQueryRow): string[] {
  const patient = schedule.case_.patient;
  const preference = patient.scheduling_preference;
  const contacts = patient.contacts ?? [];
  const contactReadiness = buildPatientContactReadiness({
    contacts,
    preferredContactName: preference?.preferred_contact_name,
    preferredContactPhone: preference?.preferred_contact_phone,
    visitBeforeContactRequired: preference?.visit_before_contact_required,
  });
  const careTeamReliability = buildCareTeamReliabilitySummary({
    contacts,
    careTeamLinks: schedule.case_.care_team_links ?? [],
  });

  return [
    contactReadiness.ready ? null : '訪問前連絡先',
    preference?.parking_available == null ? '駐車可否' : null,
    preference?.care_level ? null : '介護度',
    careTeamReliability.needs_confirmation ? '連携先' : null,
  ].filter((label): label is string => Boolean(label));
}

function narcoticAuditPending(schedule: ScheduleQueryRow): { due: Date | null } | null {
  const cycle = schedule.cycle;
  if (!cycle) return null;
  if (!['dispensed', 'audit_pending'].includes(cycle.overall_status)) return null;
  const hasNarcotic = (cycle.prescription_intakes[0]?.lines ?? []).some((line) =>
    line.packaging_instruction_tags.includes('narcotic'),
  );
  if (!hasNarcotic) return null;
  const task = cycle.dispense_tasks[0] ?? null;
  const latestAudit = task?.audits[0] ?? null;
  if (latestAudit != null && latestAudit.result !== 'hold') return null;
  return { due: task?.due_date ?? null };
}

function summarizeChecks(checks: VisitPrepCheck[]): {
  prep_done: number;
  prep_total: number;
  accent: VisitPreparationCard['accent'];
} {
  const done = checks.filter((check) => check.state === 'done').length;
  const hasAlert = checks.some((check) => check.state === 'alert');
  return {
    prep_done: done,
    prep_total: checks.length,
    accent: hasAlert ? 'caution' : done === checks.length ? 'ready' : 'progress',
  };
}

/** 個別訪問のカード導出。チェックは常に 4 項目(準備 N/4)。 */
function deriveHomeVisitCard(schedule: ScheduleQueryRow): VisitPreparationCard {
  const preparation = schedule.preparation;
  const tags = collectSafetyTags(schedule);
  const safetyTags = sortSafetyTags(tags);
  const audit = narcoticAuditPending(schedule);
  const cycleStatus = schedule.cycle?.overall_status ?? null;
  const foundationGapLabels = collectFoundationGapLabels(schedule);

  const checks: VisitPrepCheck[] = [
    {
      id: 'packet',
      label: 'パケット',
      state: preparation?.carry_items_confirmed ? 'done' : 'pending',
    },
    {
      id: 'route',
      label: 'ルート',
      state: preparation?.route_confirmed ? 'done' : 'pending',
    },
    audit
      ? {
          id: 'carry-narcotic',
          label: `持参薬 — 麻薬監査待ち${audit.due ? `(期限${formatTimeOfDay(audit.due)})` : ''}`,
          state: 'alert',
        }
      : {
          id: 'set',
          label:
            cycleStatus && SET_IN_PROGRESS_STATUSES.includes(cycleStatus)
              ? 'セット作成中'
              : 'セット',
          state:
            cycleStatus && SET_DONE_STATUSES.includes(cycleStatus)
              ? 'done'
              : cycleStatus && SET_IN_PROGRESS_STATUSES.includes(cycleStatus)
                ? 'progress'
                : 'pending',
        },
    tags.has('cold_storage')
      ? {
          id: 'cold-bag',
          label: '保冷バッグ',
          state: preparation?.carry_items_confirmed ? 'done' : 'pending',
        }
      : {
          id: 'changes',
          label: '前回からの変化を確認済',
          state: preparation?.medication_changes_reviewed ? 'done' : 'pending',
        },
  ];

  const summary = summarizeChecks(checks);

  // 監査未完のときは繰り下げ案(訪問時刻+60分)を注記する
  let note: string | null = null;
  let noteTone: VisitPreparationCard['note_tone'] = null;
  if (audit && schedule.time_window_start) {
    const fallback = new Date(schedule.time_window_start.getTime() + 60 * 60_000);
    note = `監査が間に合わない場合: ${timeDateToString(fallback) ?? '時間未定'}繰り下げ案を反映できます(スケジュールで調整)`;
    noteTone = 'warning';
  } else if (foundationGapLabels.length > 0) {
    note = `出発前に正本確認: ${foundationGapLabels.slice(0, 3).join('・')}${
      foundationGapLabels.length > 3 ? ` ほか${foundationGapLabels.length - 3}件` : ''
    }`;
    noteTone = 'warning';
  }

  const patient = schedule.case_.patient;
  const stayMinutes = minutesBetween(schedule.time_window_start, schedule.time_window_end);
  const patientHref = buildPatientHref(patient.id);

  return {
    schedule_id: schedule.id,
    visit_mode_href: buildVisitRecordHref(schedule.id),
    time_label: schedule.time_window_start
      ? (timeDateToString(schedule.time_window_start) ?? null)
      : null,
    title: patient.name,
    is_facility: false,
    patient_count: null,
    meta_label: stayMinutes ? `在宅・滞在${stayMinutes}分` : '在宅',
    safety_tags: safetyTags,
    ...summary,
    accent: foundationGapLabels.length > 0 ? 'caution' : summary.accent,
    checks,
    note,
    note_tone: noteTone,
    actions: audit
      ? [
          { label: '監査へ', href: '/audit' },
          { label: 'カードへ', href: patientHref },
        ]
      : [
          { label: 'カードへ', href: patientHref },
          { label: 'ルート詳細', href: buildScheduleFocusHref(schedule.id) },
        ],
  };
}

/** 施設一括訪問のカード導出(同じ facility_batch_id の予定を 1 枚に束ねる)。 */
function deriveFacilityVisitCard(
  schedules: ScheduleQueryRow[],
  facilityName: string | null,
): VisitPreparationCard {
  const lead = schedules[0];
  const batch = lead.facility_batch;
  const batchPatientIds = batch && Array.isArray(batch.patient_ids) ? batch.patient_ids : null;
  const patientCount = batchPatientIds?.length ?? schedules.length;

  const tagSet = new Set<string>();
  for (const schedule of schedules) {
    for (const tag of collectSafetyTags(schedule)) tagSet.add(tag);
  }
  const safetyTags = sortSafetyTags(tagSet);

  const setDoneCount = schedules.filter(
    (schedule) => schedule.cycle && SET_DONE_STATUSES.includes(schedule.cycle.overall_status),
  ).length;
  const setTotal = schedules.length;
  const roomOrderReady = schedules.every((schedule) => schedule.route_order != null);
  const checklistReady = schedules.every((schedule) => schedule.pre_visit_checklist_completed);
  const cartReady = schedules.every((schedule) => schedule.preparation?.carry_items_confirmed);

  const checks: VisitPrepCheck[] = [
    { id: 'room-order', label: '居室順', state: roomOrderReady ? 'done' : 'pending' },
    setDoneCount === setTotal
      ? { id: 'set', label: 'セット', state: 'done' }
      : {
          id: 'set',
          label: `セット ${setDoneCount}/${setTotal} — 事務が先行準備中`,
          state: 'progress',
        },
    {
      id: 'facility-checklist',
      label: '施設チェックリスト',
      state: checklistReady ? 'done' : 'pending',
    },
    { id: 'cart-map', label: '配薬カート対応表', state: cartReady ? 'done' : 'pending' },
  ];

  const summary = summarizeChecks(checks);
  const remaining = setTotal - setDoneCount;
  const foundationGapPatientCount = schedules.filter(
    (schedule) => collectFoundationGapLabels(schedule).length > 0,
  ).length;

  const name = facilityName ?? '施設一括訪問';
  const stayMinutes =
    batch?.estimated_duration ?? minutesBetween(lead.time_window_start, lead.time_window_end);

  return {
    schedule_id: lead.id,
    visit_mode_href: buildVisitRecordHref(lead.id),
    time_label: lead.time_window_start ? (timeDateToString(lead.time_window_start) ?? null) : null,
    title: name.startsWith('施設') ? name : `施設${name}`,
    is_facility: true,
    patient_count: patientCount,
    meta_label: stayMinutes ? `${patientCount}名・滞在${stayMinutes}分` : `${patientCount}名`,
    safety_tags: safetyTags,
    ...summary,
    accent:
      summary.accent === 'ready' && foundationGapPatientCount > 0 ? 'caution' : summary.accent,
    checks,
    note:
      remaining > 0
        ? `セット残り${remaining}名分の確認が残っています — 完了後に配薬カートへ積み込めます`
        : foundationGapPatientCount > 0
          ? `正本未確認の患者が${foundationGapPatientCount}名います — 出発前に患者カードで確認してください`
          : null,
    note_tone: remaining > 0 ? 'info' : foundationGapPatientCount > 0 ? 'warning' : null,
    actions: [
      { label: 'セットへ', href: '/set' },
      { label: '施設パケット', href: buildScheduleFocusHref(lead.id) },
    ],
  };
}

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    // scheduled_date(@db.Date)との比較は「ローカル日付キーの UTC 深夜 Date」で行う
    const todayRange = todayUtcRange(now);

    const accessContext: VisitScheduleAccessContext = { userId: ctx.userId, role: ctx.role };
    const assignmentWhere = buildVisitScheduleAssignmentWhere(accessContext);

    const [schedules, openExceptions, auditTasks] = await Promise.all([
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: todayRange,
          schedule_status: { in: [...ACTIVE_SCHEDULE_STATUSES] },
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        orderBy: [{ time_window_start: 'asc' }, { route_order: 'asc' }],
        select: {
          id: true,
          time_window_start: true,
          time_window_end: true,
          route_order: true,
          pre_visit_checklist_completed: true,
          facility_batch_id: true,
          facility_batch: {
            select: {
              id: true,
              facility_id: true,
              patient_ids: true,
              estimated_duration: true,
            },
          },
          vehicle_resource: { select: { label: true } },
          preparation: {
            select: {
              medication_changes_reviewed: true,
              carry_items_confirmed: true,
              previous_issues_reviewed: true,
              route_confirmed: true,
              prepared_at: true,
              updated_at: true,
            },
          },
          case_: {
            select: {
              required_visit_support: true,
              care_team_links: {
                select: {
                  role: true,
                  is_primary: true,
                  phone: true,
                  email: true,
                  fax: true,
                },
              },
              patient: {
                select: {
                  id: true,
                  name: true,
                  allergy_info: true,
                  contacts: {
                    select: {
                      is_primary: true,
                      is_emergency_contact: true,
                      phone: true,
                      email: true,
                      fax: true,
                    },
                  },
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
                },
              },
            },
          },
          cycle: {
            select: {
              overall_status: true,
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
          severity: true,
          created_at: true,
        },
      }),
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
                select: { lines: { select: { packaging_instruction_tags: true } } },
              },
            },
          },
        },
      }),
    ]);

    const rows = schedules as ScheduleQueryRow[];

    // 施設名の解決(FacilityVisitBatch.facility_id は FK 関係を持たないため別引き)
    const facilityIds = [
      ...new Set(
        rows
          .map((schedule) => schedule.facility_batch?.facility_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const facilities =
      facilityIds.length > 0
        ? await prisma.facility.findMany({
            where: { org_id: ctx.orgId, id: { in: facilityIds } },
            select: { id: true, name: true },
          })
        : [];
    const facilityNameById = new Map(facilities.map((facility) => [facility.id, facility.name]));

    // 施設一括(facility_batch_id)単位でグルーピング
    const facilityGroups = new Map<string, ScheduleQueryRow[]>();
    const homeSchedules: ScheduleQueryRow[] = [];
    for (const schedule of rows) {
      if (schedule.facility_batch_id) {
        const group = facilityGroups.get(schedule.facility_batch_id) ?? [];
        group.push(schedule);
        facilityGroups.set(schedule.facility_batch_id, group);
      } else {
        homeSchedules.push(schedule);
      }
    }

    const cards: VisitPreparationCard[] = [
      ...homeSchedules.map((schedule) => deriveHomeVisitCard(schedule)),
      ...Array.from(facilityGroups.values()).map((group) =>
        deriveFacilityVisitCard(
          group,
          group[0].facility_batch
            ? (facilityNameById.get(group[0].facility_batch.facility_id) ?? null)
            : null,
        ),
      ),
    ].sort((left, right) =>
      (left.time_label ?? '99:99').localeCompare(right.time_label ?? '99:99'),
    );

    // 根拠・記録: ルート計算時刻 / 車両 / 前回訪問記録件数
    const routeCalculatedAt = rows
      .filter((schedule) => schedule.preparation?.route_confirmed)
      .map((schedule) => schedule.preparation?.updated_at)
      .filter((date): date is Date => date != null)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const vehicleLabel =
      rows.map((schedule) => schedule.vehicle_resource?.label).find((label) => label) ?? null;
    const todayPatientIds = [...new Set(rows.map((schedule) => schedule.case_.patient.id))];
    const priorRecordCount =
      todayPatientIds.length > 0
        ? await prisma.visitRecord.count({
            where: { org_id: ctx.orgId, patient_id: { in: todayPatientIds } },
          })
        : 0;

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

    const blockedReasons: VisitPrepBlockedReason[] = buildBlockedReasons(
      openExceptions.map((exception) => ({
        ...exception,
        description: VISIT_PREPARATION_BLOCKED_REASON_LABEL,
      })),
      now,
    );

    const facilityPatientCount = cards
      .filter((card) => card.is_facility)
      .reduce((sum, card) => sum + (card.patient_count ?? 0), 0);

    const responseData: VisitPreparationBoardResponse = {
      generated_at: now.toISOString(),
      visit_count: cards.filter((card) => !card.is_facility).length,
      facility_patient_count: facilityPatientCount,
      cards,
      next_action: auditQueue[0] ?? null,
      blocked_reasons: blockedReasons,
      evidence: {
        route_calculated_at: routeCalculatedAt?.toISOString() ?? null,
        vehicle_label: vehicleLabel,
        prior_record_count: priorRecordCount,
      },
    };

    return successWithMeasuredJsonPayload({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '本日の訪問準備の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      return withSensitiveNoStore(internalError());
    }
  });
};
