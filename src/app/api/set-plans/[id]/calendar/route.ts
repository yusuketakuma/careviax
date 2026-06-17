import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { success, notFound, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { buildSetPlanAssignmentWhere } from '@/server/services/prescription-access';
import {
  buildCalendarMatrix,
  type CalendarPivotBatch,
  type CalendarPivotLine,
} from '@/app/api/medication-sets/workspace/set-derivations';

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
export const GET = withAuthContext<{ id: string }>(
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
          version: true,
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

    const lines: CalendarPivotLine[] = intakes.flatMap((intake) =>
      intake.lines.map((line) => ({
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
      })),
    );

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
        ...matrix,
      },
    });
  },
  { permission: 'canSet' },
);
