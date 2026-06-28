import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { success, notFound, validationError, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { buildSetPlanAssignmentWhere } from '@/server/services/prescription-access';
import {
  buildCalendarMatrix,
  type CalendarPivotBatch,
  type CalendarPivotLine,
} from '@/lib/dispensing/set-derivations';
import { normalizedDrugCode } from '@/lib/prescription/controlled-handling-tags';

function hasKnownNarcoticClassificationTag(tags: readonly string[]): boolean {
  return tags.includes('narcotic');
}

function latestBatchUpdatedAtIso(batches: Array<{ updated_at?: Date | null }>) {
  return batches.reduce<string | null>((latest, batch) => {
    const current = batch.updated_at?.toISOString();
    if (!current) return latest;
    return !latest || current > latest ? current : latest;
  }, null);
}

function canGenerateSetBatches(cycleStatus: string) {
  return cycleStatus === 'audited' || cycleStatus === 'setting' || cycleStatus === 'set_audited';
}

function canForceRegenerateSetBatches(cycleStatus: string) {
  return cycleStatus === 'audited' || cycleStatus === 'setting';
}

function buildSetBatchGenerationMetadata(args: {
  batchCount: number;
  cycleStatus: string;
  latestBatchUpdatedAt: string | null;
  planUpdatedAt: Date;
}) {
  return {
    batch_count: args.batchCount,
    needs_initial_generation: args.batchCount === 0,
    latest_batch_updated_at: args.latestBatchUpdatedAt,
    expected_updated_at: args.planUpdatedAt.toISOString(),
    can_generate: canGenerateSetBatches(args.cycleStatus),
    can_force_regenerate: args.batchCount > 0 && canForceRegenerateSetBatches(args.cycleStatus),
  };
}

/**
 * GET /api/set-plans/[id]/calendar
 *
 * セット工程「お薬カレンダー」用の 7day(対象期間日数)× 用法スロットのマトリクスを
 * 1レスポンスで返す読み取り専用 BFF。
 * - SetBatch のフラット配列を line×day×slot のセル状態マトリクスへ pivot(純関数 buildCalendarMatrix)
 * - 各セルにセット状態(pending/set/hold)・監査状態(unaudited/ok/ng)・NG分類・保留理由・version を保持
 * - completion_gate(セット完了可否 / セット監査承認可否)を併せて算出
 *
 * 読み取り専用のため確定操作・監査証跡の書込は行わない(確定は bulk-set / set-audits 側)。
 */
const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const rawId = (await routeContext.params).id;
    const planId = normalizeRequiredRouteParam(rawId);
    if (!planId) {
      return validationError('セットプランIDが不正です');
    }

    const assignmentWhere = buildSetPlanAssignmentWhere(ctx);

    const plan = await prisma.setPlan.findFirst({
      where: {
        id: planId,
        org_id: ctx.orgId,
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      },
      select: {
        id: true,
        cycle_id: true,
        target_period_start: true,
        target_period_end: true,
        set_method: true,
        updated_at: true,
        cycle: {
          select: {
            id: true,
            overall_status: true,
            version: true,
          },
        },
      },
    });

    if (!plan) {
      return notFound('セットプランが見つかりません');
    }

    const [batches, intakes] = await Promise.all([
      prisma.setBatch.findMany({
        where: { plan_id: planId, org_id: ctx.orgId },
        orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
        select: {
          id: true,
          line_id: true,
          slot: true,
          day_number: true,
          quantity: true,
          carry_type: true,
          set_state: true,
          audit_state: true,
          ng_code: true,
          held_reason: true,
          packaging_instruction_tags_snapshot: true,
          version: true,
          updated_at: true,
        },
      }),
      prisma.prescriptionIntake.findMany({
        where: { cycle_id: plan.cycle_id, org_id: ctx.orgId },
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
        select: {
          lines: {
            orderBy: { line_number: 'asc' },
            select: {
              id: true,
              drug_code: true,
              drug_name: true,
              dosage_form: true,
              dose: true,
              frequency: true,
              unit: true,
              route: true,
              packaging_instructions: true,
              packaging_instruction_tags: true,
              notes: true,
            },
          },
        },
      }),
    ]);

    const lineSafetyTags = new Map<string, Set<string>>();
    for (const batch of batches) {
      const snapshotTags = batch.packaging_instruction_tags_snapshot ?? [];
      if (!snapshotTags.length) continue;
      const tags = lineSafetyTags.get(batch.line_id) ?? new Set<string>();
      for (const tag of snapshotTags) tags.add(tag);
      lineSafetyTags.set(batch.line_id, tags);
    }

    const intakeLines = intakes.flatMap((intake) => intake.lines);
    const lineSafetyData = intakeLines.map((line) => ({
      line,
      drugCode: normalizedDrugCode(line.drug_code),
      tags: [...(line.packaging_instruction_tags ?? []), ...(lineSafetyTags.get(line.id) ?? [])],
    }));
    const classificationCandidateCodes = new Set<string>();
    for (const item of lineSafetyData) {
      if (item.drugCode && !hasKnownNarcoticClassificationTag(item.tags)) {
        classificationCandidateCodes.add(item.drugCode);
      }
    }
    const classificationMasters =
      classificationCandidateCodes.size > 0
        ? await prisma.drugMaster.findMany({
            where: { yj_code: { in: [...classificationCandidateCodes] } },
            select: { yj_code: true },
          })
        : [];
    const knownMasterYjCodes = new Set(classificationMasters.map((master) => master.yj_code));

    const narcoticClassificationUnresolvedLineIds = new Set<string>();
    const lines: CalendarPivotLine[] = lineSafetyData.map(({ line, drugCode, tags }) => {
      const hasKnownClassification =
        hasKnownNarcoticClassificationTag(tags) ||
        (drugCode != null && knownMasterYjCodes.has(drugCode));
      if (!hasKnownClassification) {
        narcoticClassificationUnresolvedLineIds.add(line.id);
      }

      return {
        id: line.id,
        drug_name: line.drug_name,
        dosage_form: line.dosage_form,
        dose: line.dose,
        frequency: line.frequency,
        unit: line.unit,
        route: line.route,
        packaging_instructions: line.packaging_instructions,
        packaging_instruction_tags: line.packaging_instruction_tags,
        notes: line.notes,
      };
    });

    const pivotBatches: CalendarPivotBatch[] = batches.map((batch) => ({
      id: batch.id,
      line_id: batch.line_id,
      slot: batch.slot,
      day_number: batch.day_number,
      quantity: batch.quantity,
      carry_type: batch.carry_type,
      set_state: batch.set_state,
      audit_state: batch.audit_state,
      ng_code: batch.ng_code,
      held_reason: batch.held_reason,
      version: batch.version,
    }));

    const generation = buildSetBatchGenerationMetadata({
      batchCount: batches.length,
      cycleStatus: plan.cycle.overall_status,
      latestBatchUpdatedAt: latestBatchUpdatedAtIso(batches),
      planUpdatedAt: plan.updated_at,
    });

    const matrix = buildCalendarMatrix({
      periodStart: plan.target_period_start,
      periodEnd: plan.target_period_end,
      lines,
      batches: pivotBatches,
    });

    return success({
      data: {
        plan_id: plan.id,
        cycle_id: plan.cycle_id,
        cycle_version: plan.cycle.version,
        cycle_status: plan.cycle.overall_status,
        set_method: plan.set_method,
        generation,
        narcotic_classification: {
          unresolved_line_count: narcoticClassificationUnresolvedLineIds.size,
          status:
            narcoticClassificationUnresolvedLineIds.size > 0
              ? ('needs_review' as const)
              : ('normal' as const),
        },
        ...matrix,
      },
    });
  },
  { permission: 'canSet' },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
