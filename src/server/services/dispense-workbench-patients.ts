import { format } from 'date-fns';
import type { Prisma, PrismaClient } from '@prisma/client';
import {
  deriveListBadge,
  PHASE_CYCLE_STATUSES,
  type DispenseWorkbenchPatientRow,
  type DispenseWorkbenchPhase,
} from '@/lib/dispensing/dispense-workbench-shared';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
  type PrescriptionAccessContext,
} from '@/server/services/prescription-access';

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
  return value ? format(value, 'yyyy-MM-dd') : null;
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
      registered_date: format(patient.created_at, 'yyyy-MM-dd'),
      latest_set_plan_id: null,
      latest_set_plan_cycle_id: null,
    });
  }

  if (filters.includeSetPlan) {
    await hydrateLatestSetPlans(prisma, orgId, ctx, rows);
  }

  return sortDispenseWorkbenchPatients(rows, filters);
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
