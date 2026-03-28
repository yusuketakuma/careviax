import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import type { AuthContext, AuthRouteContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const updateSetPlanSchema = z.object({
  target_period_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  target_period_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  set_method: z
    .enum(['facility_calendar', 'four_times_daily', 'bedtime_only', 'custom'], {
      error: 'セット方式を選択してください',
    })
    .optional(),
  notes: z.string().optional(),
});

const setPlanSelect = {
  id: true,
  cycle_id: true,
  target_period_start: true,
  target_period_end: true,
  set_method: true,
  notes: true,
  created_at: true,
  updated_at: true,
  cycle: {
    select: {
      id: true,
      overall_status: true,
      patient_id: true,
      case_: {
        select: {
          id: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
            },
          },
        },
      },
      prescription_intakes: {
        orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          prescribed_date: true,
          prescriber_name: true,
          updated_at: true,
          lines: {
            orderBy: { line_number: 'asc' },
            select: {
              id: true,
              line_number: true,
              drug_name: true,
              drug_code: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              dosage_form: true,
              packaging_instructions: true,
              notes: true,
            },
          },
        },
      },
      inquiries: {
        where: {
          OR: [{ result: null }, { result: 'pending' }],
        },
        select: {
          id: true,
        },
      },
    },
  },
  audits: {
    orderBy: { audited_at: 'desc' },
    take: 1,
    select: {
      id: true,
      result: true,
      approved_scope: true,
      reject_reason: true,
      audited_at: true,
    },
  },
} satisfies Prisma.SetPlanSelect;

export const GET = withAuthContext<{ id: string }>(
  async (
    _req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>
  ) => {
    const { id } = await routeContext.params;

    const plan = await prisma.setPlan.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: setPlanSelect,
    });

    if (!plan) {
      return notFound('セットプランが見つかりません');
    }

    return success({ data: plan });
  },
  { permission: 'canSet' }
);

export const PATCH = withAuthContext<{ id: string }>(
  async (
    req: NextRequest,
    ctx: AuthContext,
    routeContext: AuthRouteContext<{ id: string }>
  ) => {
    const { id } = await routeContext.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = updateSetPlanSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updates = parsed.data;
    if (Object.keys(updates).length === 0) {
      return validationError('更新項目がありません');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.setPlan.findFirst({
        where: {
          id,
          org_id: ctx.orgId,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return null;
      }

      return tx.setPlan.update({
        where: { id },
        data: {
          ...(updates.target_period_start
            ? { target_period_start: new Date(updates.target_period_start) }
            : {}),
          ...(updates.target_period_end
            ? { target_period_end: new Date(updates.target_period_end) }
            : {}),
          ...(updates.set_method ? { set_method: updates.set_method } : {}),
          ...(updates.notes !== undefined ? { notes: updates.notes || null } : {}),
        },
        select: setPlanSelect,
      });
    });

    if (!result) {
      return notFound('セットプランが見つかりません');
    }

    return success({ data: result });
  },
  { permission: 'canSet' }
);
