import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createSetBatchSchema = z.object({
  plan_id: z.string().min(1, 'セットプランIDは必須です'),
  line_id: z.string().min(1, '処方ラインIDは必須です'),
  slot: z.enum(['morning', 'noon', 'evening', 'bedtime', 'prn'], {
    errorMap: () => ({ message: 'スロットを選択してください' }),
  }),
  day_number: z.number().int().min(1, '日数は1以上の整数です'),
  quantity: z.number().positive('数量は正の数です'),
  carry_type: z.enum(['carry', 'facility_deposit', 'deferred'], {
    errorMap: () => ({ message: '持参区分を選択してください' }),
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
            dose: true,
            frequency: true,
            unit: true,
          },
        },
      },
    });

    return success({ data: batches });
  },
  { permission: 'canSet' }
);

export const POST = withAuthContext<Record<string, string>>(
  async (req: NextRequest, ctx: AuthContext) => {
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
        select: { id: true },
      });
      if (!plan) throw new Error('NOT_FOUND:指定されたセットプランが見つかりません');

      const line = await tx.prescriptionLine.findFirst({
        where: { id: line_id, org_id: ctx.orgId },
        select: { id: true },
      });
      if (!line) throw new Error('NOT_FOUND:指定された処方ラインが見つかりません');

      return tx.setBatch.create({
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
              dose: true,
              frequency: true,
              unit: true,
            },
          },
        },
      });
    });

    return success({ data: result }, 201);
  },
  { permission: 'canSet' }
);
