import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const updateSetBatchSchema = z.object({
  quantity: z.number().positive('数量は正の数です').optional(),
  carry_type: z
    .enum(['carry', 'facility_deposit', 'deferred'], { error: '持参区分を選択してください' })
    .optional(),
  slot: z
    .enum(['morning', 'noon', 'evening', 'bedtime', 'prn'], { error: 'スロットを選択してください' })
    .optional(),
  version: z.number().int().min(1, 'バージョンは1以上の整数です'),
});

export const GET = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const batch = await prisma.setBatch.findFirst({
      where: { id, org_id: ctx.orgId },
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

    if (!batch) return notFound('セットバッチが見つかりません');

    return success({ data: batch });
  },
  { permission: 'canSet' }
);

export const PATCH = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateSetBatchSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { version, ...updates } = parsed.data;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.setBatch.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, version: true },
      });

      if (!existing) return null;

      if (existing.version !== version) {
        throw new Error('CONFLICT:他のユーザーによって更新されています。再読み込みしてください');
      }

      return tx.setBatch.update({
        where: { id },
        data: {
          ...updates,
          version: { increment: 1 },
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
    });

    if (!result) return notFound('セットバッチが見つかりません');

    return success({ data: result });
  },
  { permission: 'canSet' }
);

export const DELETE = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx: AuthContext, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;

    const existing = await prisma.setBatch.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true },
    });

    if (!existing) return notFound('セットバッチが見つかりません');

    await withOrgContext(ctx.orgId, async (tx) => {
      await tx.setBatch.delete({ where: { id } });
    });

    return success({ data: { id } });
  },
  { permission: 'canSet' }
);
