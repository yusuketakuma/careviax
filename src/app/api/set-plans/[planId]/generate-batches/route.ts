import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const generateBatchesSchema = z.object({
  force: z.boolean().optional().default(false),
});

function parseFrequencyToSlots(frequency: string): string[] {
  if (/毎食後|分3|3回/.test(frequency)) return ['morning', 'noon', 'evening'];
  if (/朝夕|2回/.test(frequency)) return ['morning', 'evening'];
  if (/朝食後|朝1回/.test(frequency)) return ['morning'];
  if (/昼食後/.test(frequency)) return ['noon'];
  if (/夕食後/.test(frequency)) return ['evening'];
  if (/就寝|眠前/.test(frequency)) return ['bedtime'];
  if (/頓用|頓服/.test(frequency)) return ['prn'];
  return ['morning'];
}

function resolveCarryType(notes: string | null | undefined, packagingInstructions: string | null | undefined) {
  const detail = `${notes ?? ''} ${packagingInstructions ?? ''}`;
  if (/施設預け|施設保管|預け/.test(detail)) return 'facility_deposit';
  if (/後送|配送|後日持参/.test(detail)) return 'deferred';
  return 'carry';
}

function resolveSlotsForMethod(args: {
  frequency: string;
  setMethod: string;
}) {
  const baseSlots = parseFrequencyToSlots(args.frequency);
  if (baseSlots.includes('prn')) return ['prn'];
  if (args.setMethod === 'bedtime_only') return ['bedtime'];
  if (args.setMethod === 'four_times_daily') {
    return ['morning', 'noon', 'evening', 'bedtime'];
  }
  return baseSlots;
}

function diffInDays(start: Date, end: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay) + 1;
}

export const POST = withAuthContext<{ planId: string }>(
  async (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ planId: string }>
  ) => {
    const { planId } = await routeContext.params;

    const body = await req.json().catch(() => ({}));
    const parsed = generateBatchesSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { force } = parsed.data;

    const plan = await prisma.setPlan.findFirst({
      where: { id: planId, org_id: ctx.orgId },
      select: {
        id: true,
        cycle_id: true,
        target_period_start: true,
        target_period_end: true,
        set_method: true,
        updated_at: true,
        cycle: {
          select: {
            overall_status: true,
          },
        },
      },
    });

    if (!plan) return notFound('セットプランが見つかりません');

    const intakes = await prisma.prescriptionIntake.findMany({
      where: { cycle_id: plan.cycle_id, org_id: ctx.orgId },
      select: {
        updated_at: true,
        lines: {
          select: {
            id: true,
            drug_name: true,
            frequency: true,
            quantity: true,
            packaging_instructions: true,
            notes: true,
          },
        },
      },
    });

    const allLines = intakes.flatMap((intake) => intake.lines);

    if (allLines.length === 0) {
      return validationError('処方ラインが存在しません。処方を先に登録してください');
    }

    if (!['audited', 'setting', 'set_audited'].includes(plan.cycle.overall_status)) {
      return validationError('鑑査未承認のサイクルはセットできません');
    }

    const lineWithoutFrequency = allLines.find((line) => line.frequency.trim().length === 0);
    if (lineWithoutFrequency) {
      return validationError(
        `投与タイミング未定義の処方があります: ${lineWithoutFrequency.drug_name}`
      );
    }

    const totalDays = diffInDays(plan.target_period_start, plan.target_period_end);
    if (totalDays <= 0) {
      return validationError('対象期間が不正です（終了日が開始日より前です）');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existingCount = await tx.setBatch.count({
        where: { plan_id: planId, org_id: ctx.orgId },
      });
      const latestIntakeUpdatedAt = intakes.reduce<Date | null>((latest, intake) => {
        if (!latest || intake.updated_at > latest) return intake.updated_at;
        return latest;
      }, null);

      if (existingCount > 0 && !force) {
        const latestBatch = await tx.setBatch.findFirst({
          where: { plan_id: planId, org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        });
        if (latestBatch && latestIntakeUpdatedAt && latestIntakeUpdatedAt > latestBatch.updated_at) {
          return {
            kind: 'error' as const,
            message: '処方変更があるため、影響セットを再確認して再生成してください',
          } as const;
        }
        const existing = await tx.setBatch.findMany({
          where: { plan_id: planId, org_id: ctx.orgId },
          orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
          include: {
            line: {
              select: {
                id: true,
                drug_name: true,
                dose: true,
                frequency: true,
                unit: true,
              },
            },
          },
        });

        return { count: existing.length, batches: existing, reused: true as const };
      }

      if (force) {
        await tx.setBatch.deleteMany({
          where: { plan_id: planId, org_id: ctx.orgId },
        });
      }

      const batchData: {
        org_id: string;
        plan_id: string;
        line_id: string;
        slot: string;
        day_number: number;
        quantity: number;
        carry_type: string;
      }[] = [];

      for (const line of allLines) {
        const slots = resolveSlotsForMethod({
          frequency: line.frequency,
          setMethod: plan.set_method,
        });
        const quantityPerSlot =
          line.quantity != null && slots.length > 0
            ? line.quantity / slots.length
            : 1;
        const carryType = resolveCarryType(line.notes, line.packaging_instructions);

        for (let day = 1; day <= totalDays; day++) {
          for (const slot of slots) {
            batchData.push({
              org_id: ctx.orgId,
              plan_id: planId,
              line_id: line.id,
              slot,
              day_number: day,
              quantity: quantityPerSlot,
              carry_type: carryType,
            });
          }
        }
      }

      await tx.setBatch.createMany({ data: batchData });

      const created = await tx.setBatch.findMany({
        where: { plan_id: planId, org_id: ctx.orgId },
        orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
        include: {
          line: {
            select: {
              id: true,
              drug_name: true,
              dose: true,
              frequency: true,
              unit: true,
            },
          },
        },
      });

      return { count: batchData.length, batches: created, reused: false as const };
    });

    if ('kind' in result && result.kind === 'error') {
      return validationError(result.message);
    }

    return success({ data: result }, result.reused ? 200 : 201);
  },
  { permission: 'canSet' }
);
