import { format } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getCycleWorkspaceAction } from '@/lib/prescription/cycle-workspace';
import { detectMedicationChanges } from '@/lib/prescription/medication-diff';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import { logger } from '@/lib/utils/logger';
import {
  buildAllergyLabel,
  buildCautionLabels,
  sortHandlingTags,
  type WorkspaceConditionInput,
} from '@/server/services/patient-detail-helpers';
import { findPreviousPrescriptionIntakeForMedicationDiff } from '@/server/services/prescription-intake-pair';
import { timeDateToString } from '@/lib/visits/time-of-day';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { buildScheduleFocusHref } from '@/lib/schedules/navigation';

type DbClient = typeof prisma | Prisma.TransactionClient;

type BuildPatientWorkspaceArgs = {
  orgId: string;
  patientId: string;
  caseIds: string[];
  allergyInfo: unknown;
  conditions: WorkspaceConditionInput[];
  swallowingRoute: string | null;
};

const CYCLE_TRANSITION_EVENT_LABELS: Record<string, string> = {
  intake_received: '処方 取込',
  structuring: '処方入力 開始',
  inquiry_pending: '疑義照会 送信',
  inquiry_resolved: '疑義照会 回答受領',
  ready_to_dispense: '処方確認 完了',
  dispensing: '調剤 開始',
  dispensed: '調剤 完了',
  audit_pending: '監査 開始',
  audited: '監査 完了',
  setting: 'セット作業 開始',
  set_audited: 'セット監査 完了',
  visit_ready: '訪問準備 完了',
  visit_completed: '訪問 完了',
  reported: '報告 完了',
  on_hold: '保留',
  cancelled: '中止',
};

/**
 * p0_08 カード詳細ワークスペース用の工程集約。
 * 進行中サイクルの現在工程・止まっている理由・処方の変化・セットの注意に加え、
 * 06_card(カード=1 RX の作業台)用に安全情報・処方明細全行・直近の動き・今日のタスクを集約する。
 */
export async function buildPatientWorkspace(db: DbClient, args: BuildPatientWorkspaceArgs) {
  if (args.caseIds.length === 0) return null;

  const cycle = await db.medicationCycle.findFirst({
    where: {
      org_id: args.orgId,
      case_id: { in: args.caseIds },
      overall_status: { notIn: ['reported', 'cancelled'] },
    },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      case_id: true,
      overall_status: true,
      exception_status: true,
      prescription_intakes: {
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
        take: 2,
        select: {
          id: true,
          prescribed_date: true,
          original_document_url: true,
          prescription_category: true,
          prescriber_institution: true,
          created_at: true,
          lines: {
            orderBy: { line_number: 'asc' },
            select: {
              id: true,
              drug_name: true,
              drug_master_id: true,
              drug_code: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              start_date: true,
              end_date: true,
              dispensing_method: true,
              packaging_instruction_tags: true,
            },
          },
        },
      },
      set_plans: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: {
          id: true,
          set_method: true,
          notes: true,
          target_period_start: true,
          target_period_end: true,
        },
      },
      workflow_exceptions: {
        where: { status: 'open' },
        orderBy: [{ severity: 'asc' }, { created_at: 'asc' }],
        select: {
          id: true,
          exception_type: true,
          description: true,
          severity: true,
          created_at: true,
        },
      },
      transition_logs: {
        orderBy: { created_at: 'desc' },
        take: 5,
        select: {
          id: true,
          from_status: true,
          to_status: true,
          actor_id: true,
          created_at: true,
        },
      },
      inquiries: {
        orderBy: { inquired_at: 'desc' },
        take: 5,
        select: {
          id: true,
          reason: true,
          inquired_at: true,
          resolved_at: true,
        },
      },
      dispense_tasks: {
        // completed = 調剤完了・監査待ち(/api/dispense-audits のキュー前提)も期限表示の対象。
        where: { status: { in: ['pending', 'in_progress', 'completed'] } },
        orderBy: { due_date: 'asc' },
        take: 1,
        select: {
          id: true,
          due_date: true,
        },
      },
    },
  });

  if (!cycle) return null;

  const now = new Date();
  const todayRange = todayUtcRange(now);
  const [egfrObservation, todayVisits, latestRecordedVisit, actorNameMap] = await Promise.all([
    db.patientLabObservation.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        analyte_code: 'egfr',
      },
      orderBy: { measured_at: 'desc' },
      select: {
        value_numeric: true,
        value_text: true,
        measured_at: true,
      },
    }),
    db.visitSchedule.findMany({
      where: {
        org_id: args.orgId,
        case_id: { in: args.caseIds },
        scheduled_date: todayRange,
        schedule_status: {
          in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
        },
      },
      orderBy: [{ time_window_start: 'asc' }],
      select: {
        id: true,
        time_window_start: true,
      },
    }),
    db.visitSchedule.findFirst({
      where: {
        org_id: args.orgId,
        cycle_id: cycle.id,
        visit_record: { isNot: null },
      },
      orderBy: [{ scheduled_date: 'desc' }, { time_window_start: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        visit_record: {
          select: { id: true },
        },
      },
    }),
    batchResolveNames(db as typeof prisma, args.orgId, [
      ...new Set(cycle.transition_logs.map((log) => log.actor_id)),
    ]).catch((error) => {
      // 名前解決の失敗で workspace 全体を 500 にしない(patient-detail.ts の fail-soft に整合)。
      // actor 名は解決できないが他のパネルは表示する。安全な構造化ログのみ(PHI 非出力)。
      logger.error({ event: 'patient_detail_workspace_actor_names_failed' }, error);
      return new Map<string, string>();
    }),
  ]);

  const [currentIntake] = cycle.prescription_intakes;
  const actionContext = {
    patientId: args.patientId,
    prescriptionIntakeId: currentIntake?.id ?? null,
    visitScheduleId: todayVisits[0]?.id ?? null,
    visitRecordId: latestRecordedVisit?.visit_record?.id ?? null,
    reportId: null,
  };
  const previousIntake = currentIntake
    ? await findPreviousPrescriptionIntakeForMedicationDiff(db, {
        orgId: args.orgId,
        patientId: args.patientId,
        caseId: cycle.case_id,
        currentIntakeId: currentIntake.id,
        currentPrescribedDate: currentIntake.prescribed_date,
        currentCreatedAt: currentIntake.created_at,
      })
    : null;

  const toPeriod = (lines: Array<{ start_date: Date | null; end_date: Date | null }>) => {
    const starts = lines.map((line) => line.start_date).filter((d): d is Date => d != null);
    const ends = lines.map((line) => line.end_date).filter((d): d is Date => d != null);
    return {
      start: starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null,
      end: ends.length > 0 ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    };
  };

  const rawChanges =
    currentIntake && previousIntake
      ? detectMedicationChanges(currentIntake.lines, previousIntake.lines)
      : [];
  const medicationChanges = rawChanges.map((change) => {
    return {
      change_type: change.change_type,
      drug_name: change.drug_name,
      drug_code: change.drug_code,
      frequency: change.current_frequency,
      days: change.current_days,
    };
  });

  const currentLines = currentIntake?.lines ?? [];

  const handlingTags = sortHandlingTags([
    ...currentLines.flatMap((line) => line.packaging_instruction_tags as string[]),
    ...(currentLines.some((line) => line.dispensing_method === 'unit_dose') ? ['unit_dose'] : []),
  ]);
  const egfrValue = egfrObservation?.value_numeric ?? egfrObservation?.value_text ?? null;
  const safety = {
    allergy: buildAllergyLabel(args.allergyInfo),
    renal:
      egfrObservation && egfrValue != null
        ? `eGFR ${egfrValue}(${format(egfrObservation.measured_at, 'M/d')})`
        : null,
    handling_tags: handlingTags,
    swallowing: args.swallowingRoute?.trim() || null,
    cautions: buildCautionLabels(args.conditions),
  };

  const recentActivities = [
    ...cycle.transition_logs.map((log) => ({
      id: `transition-${log.id}`,
      type: 'transition' as const,
      label:
        CYCLE_TRANSITION_EVENT_LABELS[log.to_status] ?? `${log.from_status} → ${log.to_status}`,
      actor: actorNameMap.get(log.actor_id) ?? null,
      at: log.created_at,
      href: getCycleWorkspaceAction(log.to_status, actionContext)?.actionHref ?? '/workflow',
    })),
    ...cycle.inquiries.map((inquiry) => ({
      id: `inquiry-${inquiry.id}`,
      type: 'inquiry' as const,
      label: inquiry.resolved_at
        ? `${inquiry.reason} → 疑義照会 回答受領`
        : `${inquiry.reason} → 疑義照会 回答待ち`,
      actor: null,
      at: inquiry.resolved_at ?? inquiry.inquired_at,
      href: buildCommunicationRequestsHref({
        status: inquiry.resolved_at ? 'responded' : 'sent',
        patientId: args.patientId,
      }),
    })),
    ...cycle.prescription_intakes.map((intake) => ({
      id: `intake-${intake.id}`,
      type: 'intake' as const,
      label: `${intake.prescription_category === 'emergency' ? '臨時' : '定期'}処方 取込${
        intake.prescriber_institution ? `(${intake.prescriber_institution})` : ''
      }`,
      actor: null,
      at: intake.created_at,
      href: buildPrescriptionHref(intake.id),
    })),
  ]
    .sort((left, right) => right.at.getTime() - left.at.getTime())
    .slice(0, 5)
    .map((activity) => ({ ...activity, at: activity.at.toISOString() }));

  const hasNarcotic = currentLines.some((line) =>
    (line.packaging_instruction_tags as string[]).includes('narcotic'),
  );
  const auditPending = ['dispensed', 'audit_pending'].includes(cycle.overall_status);
  const auditDue = cycle.dispense_tasks[0]?.due_date ?? null;
  const auditDueTime = auditDue ? format(auditDue, 'HH:mm') : null;
  const todayTasks = [
    ...(auditPending
      ? [
          {
            id: `audit-${cycle.id}`,
            tone: 'deadline' as const,
            time_label: auditDueTime ? `期限 ${auditDueTime}` : '監査待ち',
            label: hasNarcotic ? '麻薬監査' : '調剤監査',
            href: '/audit',
            action_label: '監査へ',
            due_time: auditDueTime,
          },
        ]
      : []),
    ...(['dispensed', 'audit_pending', 'audited', 'setting'].includes(cycle.overall_status)
      ? [
          {
            id: `set-${cycle.id}`,
            tone: 'waiting' as const,
            time_label: auditPending
              ? '監査後'
              : cycle.overall_status === 'setting'
                ? '進行中'
                : '未着手',
            label: 'セット作成',
            href: '/set',
            action_label: 'セットへ',
            due_time: null,
          },
        ]
      : []),
    ...todayVisits.map((visit) => ({
      id: `visit-${visit.id}`,
      tone: 'scheduled' as const,
      time_label: visit.time_window_start
        ? (timeDateToString(visit.time_window_start) ?? '時間未定')
        : '時間未定',
      label: '訪問',
      href: buildScheduleFocusHref(visit.id),
      action_label: '訪問へ',
      due_time: null,
    })),
  ];

  return {
    cycle_id: cycle.id,
    overall_status: cycle.overall_status,
    exception_status: cycle.exception_status,
    action_context: {
      patient_id: actionContext.patientId,
      prescription_intake_id: actionContext.prescriptionIntakeId,
      visit_schedule_id: actionContext.visitScheduleId,
      visit_record_id: actionContext.visitRecordId,
      report_id: actionContext.reportId,
    },
    current_intake: currentIntake
      ? {
          id: currentIntake.id,
          prescribed_date: currentIntake.prescribed_date.toISOString(),
          // 定期/臨時(regular | emergency)。p1_02 カード種別ラベルの導出に使う
          prescription_category: currentIntake.prescription_category,
        }
      : null,
    safety,
    prescription_lines: currentLines.map((line) => ({
      id: line.id,
      drug_name: line.drug_name,
      dose: line.dose,
      frequency: line.frequency,
      days: line.days,
      quantity: line.quantity,
      unit: line.unit,
      packaging_instruction_tags: line.packaging_instruction_tags as string[],
    })),
    recent_activities: recentActivities,
    today_tasks: todayTasks,
    open_exceptions: cycle.workflow_exceptions.map((exception) => ({
      id: exception.id,
      exception_type: exception.exception_type,
      description: exception.description,
      severity: exception.severity === 'critical' ? 'critical' : 'warning',
      created_at: exception.created_at.toISOString(),
    })),
    medication_changes: medicationChanges,
    previous_medication: previousIntake ? toPeriod(previousIntake.lines) : null,
    current_medication: currentIntake ? toPeriod(currentIntake.lines) : null,
    set_plan: cycle.set_plans[0]
      ? {
          id: cycle.set_plans[0].id,
          set_method: cycle.set_plans[0].set_method,
          notes: cycle.set_plans[0].notes,
          target_period_start: cycle.set_plans[0].target_period_start,
          target_period_end: cycle.set_plans[0].target_period_end,
          processing: {
            unit_dose: (currentIntake?.lines ?? []).some(
              (line) => line.dispensing_method === 'unit_dose',
            ),
            separate_pack: (currentIntake?.lines ?? []).some((line) =>
              line.packaging_instruction_tags.includes('separate_pack'),
            ),
            crushed: (currentIntake?.lines ?? []).some(
              (line) => line.dispensing_method === 'crushed',
            ),
          },
        }
      : null,
    prescription_document_url: currentIntake?.original_document_url ?? null,
  };
}
