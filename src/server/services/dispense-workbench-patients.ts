import type { Prisma, PrismaClient } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import {
  classifySetBatchPhase,
  deriveListBadge,
  PHASE_CYCLE_STATUSES,
  REPRESENTATIVE_DISPENSE_TASK_STATUSES,
  selectRepresentativeDispenseTask,
  type DispenseWorkbenchPatientRow,
  type DispenseWorkbenchPhase,
  type SetBatchPhaseCounts,
} from '@/lib/dispensing/dispense-workbench-shared';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
  type PrescriptionAccessContext,
} from '@/server/services/prescription-access';
import { japanDateKey } from '@/lib/utils/date-boundary';

/**
 * 調剤ワークベンチ左ペインの患者中心リスト(計画 §11-2 共通行 / §11-3-1)。
 *
 * `/api/dispense-queue` が DispenseTask(pending/in_progress) 中心なのに対し、本サービスは
 * MedicationCycle を起点に intake_received〜reported 全域を対象とし、患者ごとに「最新サイクル」を
 * 1件選ぶ。状態バッジ3値は overall_status(16値)を `deriveListBadge` で畳み込む。
 *
 * 服用開始日 = CareCase.start_date を優先し、無ければ当該サイクルの最古の処方行 start_date。
 * 登録日 = Patient.created_at。要配慮個人情報は氏名・カナのみに最小化する。
 */

export type DispenseWorkbenchPatientsSort = 'start_date' | 'registered_date' | 'name_kana';

export type DispenseWorkbenchPatientsFilters = {
  sort?: DispenseWorkbenchPatientsSort;
  order?: 'asc' | 'desc';
  includeSetPlan?: boolean;
  /** 工程フィルタ。指定時は当該工程の overall_status 集合のみ返す（未指定は従来どおり全件）。 */
  phase?: DispenseWorkbenchPhase;
};

const MAX_CYCLES = 500;

function formatDate(value: Date | null | undefined): string | null {
  return value ? formatUtcDateKey(value) : null;
}

export async function listDispenseWorkbenchPatients(
  prisma: PrismaClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  filters: DispenseWorkbenchPatientsFilters = {},
): Promise<DispenseWorkbenchPatientRow[]> {
  const assignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
  // 工程指定時は当該工程の status 集合のみ（集合に on_hold/cancelled は含まないため自然に除外）。
  // 未指定時は従来どおり cancelled のみ除外（後方互換）。notIn を上書きせずマージする。
  const overallStatusWhere: Prisma.MedicationCycleWhereInput['overall_status'] = filters.phase
    ? { in: PHASE_CYCLE_STATUSES[filters.phase] }
    : { notIn: ['cancelled'] };
  const where: Prisma.MedicationCycleWhereInput = {
    org_id: orgId,
    overall_status: overallStatusWhere,
    ...(assignmentWhere ?? {}),
  };

  // 最新サイクルを患者ごとに選びたいので、新しい順に取得して patient_id 初出のみ残す。
  const cycles = await prisma.medicationCycle.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: MAX_CYCLES,
    select: {
      id: true,
      patient_id: true,
      overall_status: true,
      case_: {
        select: {
          start_date: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
              created_at: true,
            },
          },
        },
      },
      prescription_intakes: {
        select: {
          lines: {
            where: { start_date: { not: null } },
            orderBy: { start_date: 'asc' },
            take: 1,
            select: { start_date: true },
          },
        },
      },
    },
  });

  const seenPatients = new Set<string>();
  const rows: DispenseWorkbenchPatientRow[] = [];

  for (const cycle of cycles) {
    if (seenPatients.has(cycle.patient_id)) continue;
    seenPatients.add(cycle.patient_id);

    const patient = cycle.case_.patient;

    // 服用開始日: CareCase.start_date 優先、無ければ最古の処方行 start_date。
    const earliestLineStart = cycle.prescription_intakes
      .flatMap((intake) => intake.lines.map((line) => line.start_date))
      .filter((value): value is Date => value != null)
      .sort((left, right) => left.getTime() - right.getTime())[0];
    const startDate = cycle.case_.start_date ?? earliestLineStart ?? null;

    rows.push({
      patient_id: patient.id,
      cycle_id: cycle.id,
      name: patient.name,
      name_kana: patient.name_kana,
      overall_status: cycle.overall_status,
      badge: deriveListBadge(cycle.overall_status),
      start_date: formatDate(startDate),
      registered_date: japanDateKey(patient.created_at),
      latest_set_plan_id: null,
      latest_set_plan_cycle_id: null,
      representative_task_id: null,
      representative_task_status: null,
    });
  }

  if (filters.phase === 'dispense' || filters.phase === 'audit') {
    await hydrateRepresentativeDispenseTasks(prisma, orgId, assignmentWhere, rows, filters.phase);
  }

  // set / set-audit 工程は base status（audited/setting）が同一なので、最新 SetPlan の SetBatch
  // 集計で排他分割する。そのため当該工程では include_set_plan 指定の有無に関わらず最新 SetPlan を解決する。
  const isSetSplitPhase = filters.phase === 'set' || filters.phase === 'set-audit';

  if (filters.includeSetPlan || isSetSplitPhase) {
    await hydrateLatestSetPlans(prisma, orgId, ctx, rows);
  }

  const scopedRows = isSetSplitPhase
    ? await filterRowsBySetBatchPhase(prisma, orgId, rows, filters.phase as 'set' | 'set-audit')
    : rows;

  return sortDispenseWorkbenchPatients(scopedRows, filters);
}

async function hydrateRepresentativeDispenseTasks(
  prisma: PrismaClient,
  orgId: string,
  assignmentWhere: Prisma.MedicationCycleWhereInput | null,
  rows: DispenseWorkbenchPatientRow[],
  phase: 'dispense' | 'audit',
) {
  if (rows.length === 0) return;

  const cycleIds = rows.map((row) => row.cycle_id).filter((id): id is string => Boolean(id));
  if (cycleIds.length === 0) return;

  const tasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: orgId,
      cycle_id: { in: cycleIds },
      status: { in: [...REPRESENTATIVE_DISPENSE_TASK_STATUSES] },
      ...(assignmentWhere ? { cycle: { is: assignmentWhere } } : {}),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      cycle_id: true,
      status: true,
    },
  });

  const tasksByCycle = new Map<string, Array<{ id: string; status: string }>>();

  for (const task of tasks) {
    const cycleTasks = tasksByCycle.get(task.cycle_id) ?? [];
    cycleTasks.push({ id: task.id, status: task.status });
    tasksByCycle.set(task.cycle_id, cycleTasks);
  }

  for (const row of rows) {
    if (!row.cycle_id) continue;
    const task = selectRepresentativeDispenseTask(tasksByCycle.get(row.cycle_id) ?? [], phase);
    row.representative_task_id = task?.id ?? null;
    row.representative_task_status = task?.status ?? null;
  }
}

/**
 * set / set-audit 工程の患者行を、最新 SetPlan の SetBatch 集計で排他分割する。
 * - set: まだセット作業中（SetPlan 無し / batch 0 / pending>0）。
 * - set-audit: 全セット済かつ監査未完了（set_complete かつ unaudited>0 または ng>0。NG=差戻し再対応待ち）。
 * セット監査まで完了（unaudited===0 && ng===0）した cycle はどちらの待ち行列にも出さない
 * （{@link classifySetBatchPhase}）。SetBatch は plan_id の単一 findMany（org スコープ）で取得し N+1 を避ける。
 */
async function filterRowsBySetBatchPhase(
  prisma: PrismaClient,
  orgId: string,
  rows: DispenseWorkbenchPatientRow[],
  phase: 'set' | 'set-audit',
): Promise<DispenseWorkbenchPatientRow[]> {
  const planIds = rows
    .map((row) => row.latest_set_plan_id)
    .filter((id): id is string => id != null);

  const countsByPlan = new Map<string, SetBatchPhaseCounts>();
  if (planIds.length > 0) {
    const batches = await prisma.setBatch.findMany({
      where: { org_id: orgId, plan_id: { in: planIds } },
      select: { plan_id: true, set_state: true, audit_state: true },
    });
    for (const batch of batches) {
      const counts = countsByPlan.get(batch.plan_id) ?? {
        total: 0,
        pending: 0,
        unaudited: 0,
        ng: 0,
      };
      counts.total += 1;
      // set でも hold でもない = 未セット（hold はセット完了を妨げない: set-derivations と同基準）。
      if (batch.set_state !== 'set' && batch.set_state !== 'hold') counts.pending += 1;
      if (batch.audit_state === 'unaudited') counts.unaudited += 1;
      // NG=差戻しは監査未完了（set-derivations: audit_complete は ng===0 も要件）→ set-audit に残す。
      else if (batch.audit_state === 'ng') counts.ng += 1;
      countsByPlan.set(batch.plan_id, counts);
    }
  }

  const wantClass = phase === 'set' ? 'setting' : 'audit-pending';
  return rows.filter((row) => {
    const counts = (row.latest_set_plan_id
      ? countsByPlan.get(row.latest_set_plan_id)
      : undefined) ?? {
      total: 0,
      pending: 0,
      unaudited: 0,
      ng: 0,
    };
    return classifySetBatchPhase(counts) === wantClass;
  });
}

async function hydrateLatestSetPlans(
  prisma: PrismaClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  rows: DispenseWorkbenchPatientRow[],
) {
  if (rows.length === 0) return;

  const assignmentWhere = buildSetPlanAssignmentWhere(ctx);
  const patientIds = rows.map((row) => row.patient_id);
  if (patientIds.length === 0) return;
  const latestPlans = await prisma.setPlan.findMany({
    where: {
      org_id: orgId,
      AND: [
        {
          cycle: {
            patient_id: { in: patientIds },
          },
        },
        ...(assignmentWhere ? [assignmentWhere] : []),
      ],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      cycle_id: true,
      cycle: {
        select: {
          patient_id: true,
        },
      },
    } satisfies Prisma.SetPlanSelect,
  });

  const latestPlanByPatient = new Map<string, { id: string; cycle_id: string }>();
  for (const plan of latestPlans) {
    const patientId = plan.cycle.patient_id;
    if (!latestPlanByPatient.has(patientId)) {
      latestPlanByPatient.set(patientId, { id: plan.id, cycle_id: plan.cycle_id });
    }
  }

  for (const row of rows) {
    const plan = latestPlanByPatient.get(row.patient_id);
    row.latest_set_plan_id = plan?.id ?? null;
    row.latest_set_plan_cycle_id = plan?.cycle_id ?? null;
  }
}

function sortDispenseWorkbenchPatients(
  rows: DispenseWorkbenchPatientRow[],
  filters: DispenseWorkbenchPatientsFilters,
): DispenseWorkbenchPatientRow[] {
  const sort = filters.sort ?? 'name_kana';
  const order = filters.order ?? (sort === 'name_kana' ? 'asc' : 'desc');
  const directionFactor = order === 'asc' ? 1 : -1;

  const compareKana = (left: DispenseWorkbenchPatientRow, right: DispenseWorkbenchPatientRow) =>
    left.name_kana.localeCompare(right.name_kana, 'ja');

  // null は常に末尾に寄せる(昇順・降順いずれでも最後)。
  const compareNullableDate = (left: string | null, right: string | null): number => {
    if (left === right) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return (left < right ? -1 : 1) * directionFactor;
  };

  return [...rows].sort((left, right) => {
    if (sort === 'name_kana') {
      const result = compareKana(left, right);
      return (
        (result !== 0 ? result : left.patient_id.localeCompare(right.patient_id)) * directionFactor
      );
    }

    const key = sort === 'start_date' ? 'start_date' : 'registered_date';
    const primary = compareNullableDate(left[key], right[key]);
    if (primary !== 0) return primary;
    // 同日はカナ昇順で安定化。
    const tieByKana = compareKana(left, right);
    return tieByKana !== 0 ? tieByKana : left.patient_id.localeCompare(right.patient_id);
  });
}
