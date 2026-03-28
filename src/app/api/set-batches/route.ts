import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createSetBatchSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  line_id: z.string().min(1, '処方ラインIDは必須です'),
  slot: z.enum(['morning', 'noon', 'evening', 'bedtime', 'prn'], {
    error: 'スロットを選択してください',
  }),
  day_number: z.number().int().min(1, '日数は1以上の整数です'),
  quantity: z.number().positive('数量は正の数です'),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred'], {
    error: '持参区分を選択してください',
  }),
});

export const GET = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext) => {
    const { searchParams } = new URL(req.url);
    const planId = searchParams.get('plan_id');

    if (!planId) {
      return validationError('plan_id は必須パラメータです');
    }

    const batches = await prisma.setBatch.findMany({
      where: { plan_id: planId, org_id: ctx.orgId },
      orderBy: [{ day_number: 'asc' }, { slot: 'asc' }],
      include: {
        line: {
          select: {
            id: true,
            drug_name: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            unit: true,
            packaging_instructions: true,
            notes: true,
          },
        },
      },
    });

    return success({ data: batches });
  },
  { permission: 'canSet' }
);

export const POST = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext): Promise<NextResponse> => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createSetBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { plan_id, line_id, slot, day_number, quantity, carry_type } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const plan = await tx.setPlan.findFirst({
        where: { id: plan_id, org_id: ctx.orgId },
        select: { id: true, cycle_id: true },
      });
      if (!plan) {
        return {
          kind: 'error' as const,
          response: notFound('指定されたセットプランが見つかりません'),
        };
      }

      const line = await tx.prescriptionLine.findFirst({
        where: { id: line_id, org_id: ctx.orgId },
        select: {
          id: true,
          intake: {
            select: {
              cycle_id: true,
            },
          },
        },
      });
      if (!line) {
        return {
          kind: 'error' as const,
          response: notFound('指定された処方ラインが見つかりません'),
        };
      }

      if (line.intake.cycle_id !== plan.cycle_id) {
        return {
          kind: 'error' as const,
          response: validationError('指定された処方ラインはこのセットプランに紐づいていません'),
        };
      }

      const duplicate = await tx.setBatch.findFirst({
        where: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
          slot,
          day_number,
        },
        select: { id: true },
      });
      if (duplicate) {
        return {
          kind: 'error' as const,
          response: conflict('同じ処方ライン・スロット・日付のセットバッチがすでに存在します'),
        };
      }

      const batch = await tx.setBatch.create({
        data: {
          org_id: ctx.orgId,
          plan_id,
          line_id,
          slot,
          day_number,
          quantity,
          carry_type,
        },
        include: {
          line: {
            select: {
              id: true,
              drug_name: true,
              drug_code: true,
              dosage_form: true,
              dose: true,
              frequency: true,
              unit: true,
              packaging_instructions: true,
              notes: true,
            },
          },
        },
      });

      return { kind: 'success' as const, batch };
    });

    if (result.kind === 'error') return result.response;

    return success({ data: result.batch }, 201);
  },
  { permission: 'canSet' }
);
