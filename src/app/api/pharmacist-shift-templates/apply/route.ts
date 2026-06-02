import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { z } from 'zod';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';

const monthKeyPattern = /^\d{4}-\d{2}$/;

function isValidMonthKey(value: string) {
  if (!monthKeyPattern.test(value)) return false;
  const [, month] = value.split('-').map(Number);
  return month >= 1 && month <= 12;
}

const applyTemplateSchema = z.object({
  month: z
    .string()
    .trim()
    .regex(monthKeyPattern, 'month の形式が不正です（YYYY-MM）')
    .refine(isValidMonthKey, 'month の形式が不正です（YYYY-MM）'),
  user_id: z
    .string()
    .trim()
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});

function datesForWeekday(year: number, monthIndex: number, weekday: number) {
  const dates: Date[] = [];
  const cursor = new Date(year, monthIndex, 1);
  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === weekday) {
      dates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '定型シフトの反映権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = applyTemplateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const [year, month] = parsed.data.month.split('-').map(Number);
  const monthIndex = month - 1;
  const templates = await prisma.pharmacistShiftTemplate.findMany({
    where: {
      org_id: ctx.orgId,
      ...(parsed.data.user_id ? { user_id: parsed.data.user_id } : {}),
    },
  });

  let appliedCount = 0;
  await withOrgContext(ctx.orgId, async (tx) => {
    for (const template of templates) {
      const targetDates = datesForWeekday(year, monthIndex, template.weekday);
      for (const date of targetDates) {
        await tx.pharmacistShift.upsert({
          where: {
            user_id_date: {
              user_id: template.user_id,
              date,
            },
          },
          create: {
            org_id: ctx.orgId,
            user_id: template.user_id,
            site_id: template.site_id,
            date,
            available: template.available,
            available_from: template.available_from,
            available_to: template.available_to,
            note: template.note,
          },
          update: {
            site_id: template.site_id,
            available: template.available,
            available_from: template.available_from,
            available_to: template.available_to,
            note: template.note,
          },
        });
        appliedCount += 1;
      }
    }
  });

  return success({
    data: {
      applied_count: appliedCount,
    },
  });
}
