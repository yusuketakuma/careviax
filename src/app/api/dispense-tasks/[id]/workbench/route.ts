import { format } from 'date-fns';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { batchResolveNames } from '@/lib/utils/name-resolver';
import {
  detectMedicationChanges,
  matchMedicationDiffLines,
} from '@/lib/prescription/medication-diff';
import {
  buildWorkbenchAllergyLabel,
  buildWorkbenchRenalLabel,
  detectDoseDirection,
} from '@/lib/dispensing/workbench-projection';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { findPreviousPrescriptionIntakeForMedicationDiff } from '@/server/services/prescription-intake-pair';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import type { ExceptionSeverity, ExceptionStatus } from '@/types/domain-literals';

/**
 * 調剤/監査ワークベンチ(design/images/new 07_dispense / 08_audit)用の BFF。
 * 1 タスク分の「いまの1件」描画に必要な情報を 1 回で返す:
 * - セーフティボード(腎機能 eGFR / アレルギー / 取扱タグ / 嚥下 / 注意)
 * - 処方比較(前回 / 今回 / 差。減量・増量の方向と照会回答由来かどうか)
 * - 計数テーブル行(処方量 / 調剤実績量 / 危険タグ(麻薬・冷所))
 * - 二人制(調剤実施者と監査者=ログインユーザー、同一人判定)
 * - 当日訪問時刻・直近の照会回答・前回処方日・チーム全体の監査残件数
 *
 * 安全情報の文字列合成は患者詳細サービス(patient-detail.ts)と独立に行う
 * (同サービスは凍結中のため変更しない)。
 */

// ── Label helpers ──

function formatQuantityLabel(line: {
  quantity: number | null;
  unit: string | null;
  days: number;
}): string {
  if (line.quantity != null) return `${line.quantity}${line.unit ?? ''}`;
  return `${line.days}日分`;
}

function doseFrequencyLabel(line: { dose: string; frequency: string }): string {
  return [line.dose, line.frequency].filter((part) => part.trim().length > 0).join(' ');
}

// ── GET: ワークベンチ projection ──

export const GET = withAuthContext(async (_req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense') && !hasPermission(ctx.role, 'canAuditDispense')) {
    return forbidden('調剤ワークベンチの閲覧権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const task = await prisma.dispenseTask.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: {
      id: true,
      status: true,
      priority: true,
      due_date: true,
      results: {
        orderBy: { dispensed_at: 'asc' },
        select: {
          id: true,
          line_id: true,
          actual_drug_name: true,
          actual_quantity: true,
          actual_unit: true,
          discrepancy_reason: true,
          dispensed_by: true,
          dispensed_at: true,
        },
      },
      cycle: {
        select: {
          id: true,
          overall_status: true,
          version: true,
          case_id: true,
          case_: {
            select: {
              id: true,
              patient: {
                select: {
                  id: true,
                  name: true,
                  allergy_info: true,
                  scheduling_preference: { select: { swallowing_route: true } },
                  conditions: {
                    where: { condition_type: 'problem', is_active: true },
                    select: { name: true, noted_at: true, notes: true },
                  },
                },
              },
            },
          },
          inquiries: {
            orderBy: [{ inquired_at: 'desc' }, { created_at: 'desc' }],
            take: 5,
            select: {
              id: true,
              line_id: true,
              result: true,
              proposal_origin: true,
              change_detail: true,
              inquiry_to_physician: true,
              inquired_at: true,
              resolved_at: true,
            },
          },
          packaging_groups: {
            orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
            select: {
              id: true,
              label: true,
              method: true,
              slot: true,
              sort_order: true,
              version: true,
            },
          },
          prescription_intakes: {
            orderBy: { created_at: 'desc' },
            take: 2,
            select: {
              id: true,
              prescribed_date: true,
              created_at: true,
              prescriber_institution: true,
              prescriber_name: true,
              lines: {
                orderBy: { line_number: 'asc' },
                select: {
                  id: true,
                  line_number: true,
                  drug_name: true,
                  drug_code: true,
                  is_generic: true,
                  dose: true,
                  frequency: true,
                  start_date: true,
                  end_date: true,
                  days: true,
                  quantity: true,
                  unit: true,
                  route: true,
                  dispensing_method: true,
                  packaging_method: true,
                  packaging_instructions: true,
                  packaging_instruction_tags: true,
                  packaging_group_id: true,
                  updated_at: true,
                  dispensing_decisions: {
                    where: { task_id: id },
                    take: 1,
                    select: {
                      dispensing_method: true,
                      packaging_method: true,
                      packaging_instructions: true,
                      packaging_group_id: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!task) return notFound('タスクが見つかりません');

  const patient = task.cycle.case_.patient;
  const [currentIntake] = task.cycle.prescription_intakes;
  const previousIntake = currentIntake
    ? await findPreviousPrescriptionIntakeForMedicationDiff(prisma, {
        orgId: ctx.orgId,
        patientId: patient.id,
        caseId: task.cycle.case_id,
        currentIntakeId: currentIntake.id,
        currentPrescribedDate: currentIntake.prescribed_date,
        currentCreatedAt: currentIntake.created_at,
      })
    : null;
  const currentLines = currentIntake?.lines ?? [];
  const previousLines = previousIntake?.lines ?? [];

  const yjCodes = Array.from(
    new Set(
      currentLines
        .map((line) => line.drug_code)
        .filter((code): code is string => Boolean(code?.trim())),
    ),
  );

  const dispenserIds = Array.from(new Set(task.results.map((result) => result.dispensed_by)));
  const now = new Date();

  const [egfrObservation, todayVisit, narcoticMasters, nameMap, teamAuditTotal, latestStock] =
    await Promise.all([
      prisma.patientLabObservation.findFirst({
        where: { org_id: ctx.orgId, patient_id: patient.id, analyte_code: 'egfr' },
        orderBy: { measured_at: 'desc' },
        select: { value_numeric: true, value_text: true, measured_at: true },
      }),
      prisma.visitSchedule.findFirst({
        where: {
          org_id: ctx.orgId,
          case_id: task.cycle.case_id,
          scheduled_date: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
            lte: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59),
          },
          schedule_status: {
            in: ['planned', 'in_preparation', 'ready', 'departed', 'in_progress'],
          },
        },
        orderBy: [{ time_window_start: 'asc' }],
        select: { time_window_start: true },
      }),
      yjCodes.length > 0
        ? prisma.drugMaster.findMany({
            where: { yj_code: { in: yjCodes }, is_narcotic: true },
            select: { yj_code: true },
          })
        : Promise.resolve([]),
      batchResolveNames(prisma, ctx.orgId, [...dispenserIds, ctx.userId]),
      prisma.dispenseTask.count({
        where: {
          org_id: ctx.orgId,
          status: 'completed',
          audits: { none: { result: { notIn: ['hold'] } } },
        },
      }),
      prisma.pharmacyDrugStock.findFirst({
        where: { org_id: ctx.orgId },
        orderBy: { updated_at: 'desc' },
        select: { updated_at: true },
      }),
    ]);

  const narcoticYjCodes = new Set(narcoticMasters.map((master) => master.yj_code));
  const isNarcoticLine = (line: {
    drug_code: string | null;
    packaging_instruction_tags: string[];
  }) =>
    line.packaging_instruction_tags.includes('narcotic') ||
    (line.drug_code != null && narcoticYjCodes.has(line.drug_code));

  // ── セーフティボード ──
  const handlingTags = Array.from(
    new Set(
      currentLines.flatMap((line) => {
        const tags = [...line.packaging_instruction_tags] as string[];
        if (isNarcoticLine(line) && !tags.includes('narcotic')) tags.unshift('narcotic');
        return tags;
      }),
    ),
  );
  const safety = {
    allergy: buildWorkbenchAllergyLabel(patient.allergy_info),
    renal: buildWorkbenchRenalLabel(egfrObservation),
    handling_tags: handlingTags,
    swallowing: patient.scheduling_preference?.swallowing_route?.trim() || null,
    cautions: patient.conditions.map((condition) => {
      const dateLabel = condition.noted_at ? format(condition.noted_at, 'M/d') : null;
      const notes = condition.notes?.trim() || null;
      if (dateLabel) return `${condition.name}(${dateLabel}〜${notes ?? ''})`;
      if (notes) return `${condition.name}(${notes})`;
      return condition.name;
    }),
  };

  // ── 処方比較(前回 / 今回 / 差)──
  const changes = detectMedicationChanges(currentLines, previousLines);
  const changeQueuesByName = new Map<string, typeof changes>();
  for (const change of changes) {
    const queue = changeQueuesByName.get(change.drug_name) ?? [];
    queue.push(change);
    changeQueuesByName.set(change.drug_name, queue);
  }
  const resolvedChangeInquiries = task.cycle.inquiries.filter(
    (inquiry) => inquiry.result === 'changed',
  );
  const changedLineIds = new Set(
    resolvedChangeInquiries
      .map((inquiry) => inquiry.line_id)
      .filter((lineId): lineId is string => lineId != null),
  );
  const hasCycleLevelChangeInquiry = resolvedChangeInquiries.some(
    (inquiry) => inquiry.line_id == null,
  );

  type ComparisonRow = {
    key: string;
    drug_name: string;
    previous_label: string | null;
    current_label: string | null;
    change_type: 'added' | 'removed' | 'dose_changed' | 'frequency_changed' | 'days_changed' | null;
    direction: 'increase' | 'decrease' | null;
    inquiry_origin: boolean;
  };
  const comparison: ComparisonRow[] = matchMedicationDiffLines(
    currentLines,
    previousLines,
  ).flatMap<ComparisonRow>((match) => {
    const line = match.current;
    const previousLine = match.previous;
    if (line) {
      const changeQueue = changeQueuesByName.get(line.drug_name) ?? [];
      const change =
        changeQueue.find((item) =>
          previousLine
            ? item.previous === doseFrequencyLabel(previousLine) &&
              item.current === doseFrequencyLabel(line)
            : item.current === doseFrequencyLabel(line),
        ) ??
        changeQueue.shift() ??
        null;
      if (change) {
        const nextQueue = changeQueue.filter((item) => item !== change);
        if (nextQueue.length > 0) {
          changeQueuesByName.set(line.drug_name, nextQueue);
        } else {
          changeQueuesByName.delete(line.drug_name);
        }
      }
      const previousLabel = previousLine ? doseFrequencyLabel(previousLine) : null;
      const currentLabel = doseFrequencyLabel(line);
      const changeType = change?.change_type ?? null;
      return [
        {
          key: line.id,
          drug_name: line.drug_name,
          previous_label: previousLabel,
          current_label: currentLabel,
          change_type: changeType,
          direction:
            changeType === 'dose_changed'
              ? detectDoseDirection(previousLine?.dose ?? null, line.dose)
              : null,
          inquiry_origin:
            changeType != null && (changedLineIds.has(line.id) || hasCycleLevelChangeInquiry),
        },
      ];
    }

    if (!previousLine) return [];

    return [
      {
        key: `removed-${previousLine.id}`,
        drug_name: previousLine.drug_name,
        previous_label: doseFrequencyLabel(previousLine),
        current_label: null,
        change_type: 'removed' as const,
        direction: null,
        inquiry_origin: changedLineIds.has(previousLine.id) || hasCycleLevelChangeInquiry,
      },
    ];
  });

  // ── 計数テーブル(監査ワークベンチ)。麻薬行を先頭に(最優先で計数する)──
  const resultByLineId = new Map(task.results.map((result) => [result.line_id, result]));
  const countRows = currentLines.map((line) => {
    const result = resultByLineId.get(line.id) ?? null;
    const decision = line.dispensing_decisions[0] ?? null;
    return {
      line_id: line.id,
      result_id: result?.id ?? null,
      line_number: line.line_number,
      drug_name: result?.actual_drug_name ?? line.drug_name,
      dose: line.dose,
      frequency: line.frequency,
      route: line.route,
      tags: line.packaging_instruction_tags as string[],
      is_narcotic: isNarcoticLine(line),
      is_generic: line.is_generic,
      prescribed_label: formatQuantityLabel(line),
      prescribed_quantity: line.quantity,
      start_date: line.start_date ? format(line.start_date, 'yyyy-MM-dd') : null,
      end_date: line.end_date ? format(line.end_date, 'yyyy-MM-dd') : null,
      days: line.days,
      line_updated_at: line.updated_at.toISOString(),
      dispensed_label: result
        ? `${result.actual_quantity}${result.actual_unit ?? line.unit ?? ''}`
        : null,
      dispensed_at: result?.dispensed_at ? format(result.dispensed_at, 'yyyy-MM-dd') : null,
      dispensed_quantity: result?.actual_quantity ?? null,
      discrepancy_reason: result?.discrepancy_reason ?? null,
      unit: result?.actual_unit ?? line.unit ?? '',
      dispensing_method: decision?.dispensing_method ?? line.dispensing_method ?? null,
      packaging_method: decision?.packaging_method ?? line.packaging_method ?? null,
      packaging_instructions:
        decision?.packaging_instructions ?? line.packaging_instructions ?? null,
      packaging_group_id: line.packaging_group_id ?? null,
    };
  });
  countRows.sort((left, right) => Number(right.is_narcotic) - Number(left.is_narcotic));
  const packagingGroups = task.cycle.packaging_groups ?? [];

  // ── 二人制(調剤者 → 監査者)──
  const lastDispensedAt =
    task.results.length > 0 ? task.results[task.results.length - 1].dispensed_at : null;
  const dispenserId = dispenserIds[0] ?? null;
  const dispenser =
    dispenserId != null
      ? {
          id: dispenserId,
          name: nameMap.get(dispenserId) ?? '担当者',
          time_label: lastDispensedAt ? format(lastDispensedAt, 'HH:mm') : null,
        }
      : null;

  const latestResolvedInquiry =
    task.cycle.inquiries.find((inquiry) => inquiry.resolved_at != null) ?? null;

  return success({
    task: {
      id: task.id,
      status: task.status,
      priority: task.priority,
      due_date: task.due_date?.toISOString() ?? null,
    },
    cycle: {
      id: task.cycle.id,
      overall_status: task.cycle.overall_status,
      version: task.cycle.version,
    },
    patient: { id: patient.id, name: patient.name },
    intake: currentIntake
      ? {
          id: currentIntake.id,
          prescribed_date: format(currentIntake.prescribed_date, 'yyyy-MM-dd'),
          prescriber_institution: currentIntake.prescriber_institution,
          prescriber_name: currentIntake.prescriber_name,
        }
      : null,
    previous_intake: previousIntake
      ? { prescribed_date: format(previousIntake.prescribed_date, 'yyyy-MM-dd') }
      : null,
    safety,
    comparison,
    count_rows: countRows,
    packaging_groups: packagingGroups,
    dispenser,
    auditor: { id: ctx.userId, name: nameMap.get(ctx.userId) ?? '担当者' },
    is_self_audit: dispenserIds.includes(ctx.userId),
    has_narcotic: countRows.some((row) => row.is_narcotic),
    visit_time_label: todayVisit?.time_window_start
      ? format(todayVisit.time_window_start, 'HH:mm')
      : null,
    resolved_inquiry: latestResolvedInquiry
      ? {
          inquired_at: latestResolvedInquiry.inquired_at.toISOString(),
          resolved_at: latestResolvedInquiry.resolved_at?.toISOString() ?? null,
          institution: latestResolvedInquiry.inquiry_to_physician.split(/\s+/)[0] ?? null,
          change_detail: latestResolvedInquiry.change_detail,
        }
      : null,
    team_audit_total: teamAuditTotal,
    stock_check_date_label: latestStock ? format(latestStock.updated_at, 'M/d') : null,
  });
});

// ── POST: 中断(理由必須)──

const interruptSchema = z.object({
  action: z.literal('interrupt'),
  reason: z.string().min(1, '中断理由は必須です'),
});

export const POST = withAuthContext(async (req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense')) {
    return forbidden('調剤の中断権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');
  const parsed = interruptSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
  const task = await prisma.dispenseTask.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: {
      id: true,
      cycle_id: true,
      cycle: {
        select: {
          patient_id: true,
        },
      },
    },
  });
  if (!task) return notFound('タスクが見つかりません');

  const exception = await withOrgContext(ctx.orgId, async (tx) => {
    const created = await tx.workflowException.create({
      data: {
        org_id: ctx.orgId,
        cycle_id: task.cycle_id,
        patient_id: task.cycle.patient_id,
        exception_type: 'dispense_interrupted',
        description: `調剤の中断: ${parsed.data.reason}`,
        severity: 'warning' satisfies ExceptionSeverity,
        status: 'open' satisfies ExceptionStatus,
      },
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'dispense_task_interrupted',
      targetType: 'DispenseTask',
      targetId: task.id,
      changes: { reason: parsed.data.reason, exception_id: created.id },
    });

    return created;
  });

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: { source: 'dispense_tasks_update', task_id: task.id, interrupted: true },
  });

  return success(exception, 201);
});
