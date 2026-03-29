import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { z } from 'zod';

const shiftRowSchema = z.object({
  site_id: z.string().min(1, '店舗IDは必須です'),
  user_id: z.string().min(1, '薬剤師IDは必須です'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）'),
  available: z.boolean().default(true),
  available_from: z.string().optional(),
  available_to: z.string().optional(),
  note: z.string().optional(),
});

const bulkShiftSchema = z.object({
  rows: z.array(shiftRowSchema).min(1, '取込対象のシフトがありません').max(500, 'CSV は 500 行までです'),
});

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = bulkShiftSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    for (const [index, row] of parsed.data.rows.entries()) {
      const refResult = await validateOrgReferences(req.orgId, {
        site_id: row.site_id,
        pharmacist_id: row.user_id,
      });
      if (!refResult.ok) {
        return validationError(`${index + 2} 行目の参照先が不正です`, {
          row: index + 2,
          details: await refResult.response.json().catch(() => undefined),
        });
      }
    }

    const applied = await withOrgContext(req.orgId, async (tx) => {
      let count = 0;
      for (const row of parsed.data.rows) {
        const { date, available_from, available_to, ...rest } = row;
        await tx.pharmacistShift.upsert({
          where: { user_id_date: { user_id: rest.user_id, date: new Date(date) } },
          create: {
            org_id: req.orgId,
            date: new Date(date),
            ...(available_from
              ? { available_from: new Date(`1970-01-01T${available_from}`) }
              : {}),
            ...(available_to ? { available_to: new Date(`1970-01-01T${available_to}`) } : {}),
            ...rest,
          },
          update: {
            site_id: rest.site_id,
            ...(available_from !== undefined
              ? {
                  available_from: available_from
                    ? new Date(`1970-01-01T${available_from}`)
                    : null,
                }
              : {}),
            ...(available_to !== undefined
              ? {
                  available_to: available_to
                    ? new Date(`1970-01-01T${available_to}`)
                    : null,
                }
              : {}),
            available: rest.available,
            note: rest.note,
          },
        });
        count += 1;
      }
      return count;
    });

    return success({ data: { applied_count: applied } }, 201);
  },
  {
    permission: 'canVisit',
    message: 'シフト情報の一括作成権限がありません',
  }
);
